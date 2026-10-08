#!/usr/bin/env python3
"""กล้อง CCTV + AI ดูภาพ (ทดลอง) สำหรับ ChatGeo

ทุกชั่วโมง GitHub Actions เรียกสคริปต์นี้:
  1. ดึงภาพล่าสุดของทุกกล้องใน data/cctv.json (ภาพจากเว็บของหน่วยงานเจ้าของกล้อง)
  2. ตรวจว่าภาพเสีย ค้าง หรือมืดไหม
  3. ให้ VLM ตัวเล็กตอบคำถามใช่/ไม่ใช่ (น้ำท่วมไหม น้ำสูงไหม ฝนตกไหม) และบรรยายภาพสั้นๆ
  4. นับรถด้วยโมเดลตรวจจับวัตถุ (เฉพาะกล้องถนน) นับเป็นจำนวนเท่านั้น
  5. เขียน index.json (สถานะล่าสุด) และ history.json (ย้อนหลัง 48 ชม.) ลงโฟลเดอร์ --data

AI ดูเฉพาะ "ฉาก" (น้ำ ถนน อากาศ จำนวนรถ) ไม่จดจำใบหน้า ไม่อ่านทะเบียน และไม่ติดตามคน
เก็บภาพย่อเฉพาะแหล่งที่สัญญาอนุญาตให้เผยแพร่ต่อ (sources.<src>.thumbs) และเก็บแค่ภาพล่าสุด

ใช้:
  python scripts/cctv_scan.py --registry data/cctv.json --data /tmp/cctv-data [--budget 30]
  python scripts/cctv_scan.py ... --mock --fake-dir DIR   # ทดสอบโดยไม่โหลดโมเดลและไม่ต่อเน็ต
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

BKK = timezone(timedelta(hours=7))
UA = 'ChatGeo-CCTV/1.0 (+https://choonahakarn.github.io/chatgeo/)'
VLM_MODELS = {'smolvlm': 'HuggingFaceTB/SmolVLM-500M-Instruct', 'qwen2vl': 'Qwen/Qwen2-VL-2B-Instruct'}
DET_MODEL = 'PekingU/rtdetr_r50vd'
STALE_H = 3          # ภาพจากต้นทางเก่ากว่านี้ (ดูจาก Last-Modified) = ภาพค้าง
FROZEN_H = 6         # ภาพเหมือนเดิมทุกไบต์นานเกินนี้ = ภาพค้าง
HIST_H = 48          # เก็บประวัติย้อนหลังกี่ชั่วโมง
THUMB_SIDE = 480
NIGHT_MEAN = 45      # ความสว่างเฉลี่ยต่ำกว่านี้ = กลางคืน/มืด
FLAT_STD = 4         # ภาพสีเดียวทั้งภาพ = กล้องไม่ส่งภาพ
VEHICLES = ('car', 'motorcycle', 'bus', 'truck')

# คำถามใช่/ไม่ใช่ (ภาษาอังกฤษ โมเดลตัวเล็กตอบภาษาอังกฤษได้แม่นกว่า)
Q = {
    'flood_road': 'Is the road in this picture flooded with water?',
    'flood': 'Is there floodwater covering roads, land or buildings in this picture?',
    'high': 'Is the water in the river or canal very high, near the top of the bank or overflowing?',
    'spill': 'Is water flowing out through the dam spillway gates in this picture?',
    'rain': 'Is it raining in this picture?',
}
ASK = {
    'road': [('flood', 'flood_road'), ('rain', 'rain')],
    'water': [('high', 'high'), ('flood', 'flood'), ('rain', 'rain')],
    'mixed': [('flood', 'flood'), ('high', 'high'), ('rain', 'rain')],
    'dam': [('spill', 'spill'), ('rain', 'rain')],
}
CAP_EN = 'Describe this CCTV image in one short sentence: the road, the water and the weather. Do not describe people.'
CAP_TH = 'บรรยายภาพจากกล้องวงจรปิดนี้เป็นภาษาไทย 1 ประโยคสั้นๆ เน้นสภาพถนน น้ำ และอากาศ ไม่ต้องบรรยายลักษณะคน'
# ประโยคที่พูดถึงคนหรือทะเบียนรถ ตัดทิ้ง (AI ดูแค่ฉาก)
PEOPLE_RE = re.compile(r'\b(man|men|woman|women|person|people|boy|girl|child|face|license plate|plate number)\b|คน|ผู้ชาย|ผู้หญิง|ใบหน้า|ทะเบียน', re.I)
PLATE_RE = re.compile(r'[ก-ฮ]{1,2}\s?\d{1,4}|\b[A-Z]{1,3}[- ]?\d{2,4}\b')


def now_bkk():
    return datetime.now(BKK).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(BKK).strftime('%Y-%m-%dT%H:%M')


def parse_iso(s):
    try:
        return datetime.strptime(s, '%Y-%m-%dT%H:%M').replace(tzinfo=BKK)
    except (TypeError, ValueError):
        return None


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, doc):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


# ---------- ดึงภาพ ----------
def fetch(url, timeout=25):
    """คืน (bytes, last_modified datetime หรือ None) · ลองซ้ำ 1 ครั้ง"""
    err = None
    for attempt in range(2):
        try:
            sep = '&' if '?' in url else '?'
            req = urllib.request.Request(url + sep + 't=%d' % int(time.time()), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read(12 * 1024 * 1024)
                lm = r.headers.get('Last-Modified')
            try:
                lm = parsedate_to_datetime(lm) if lm else None
            except (TypeError, ValueError):
                lm = None
            return data, lm
        except Exception as e:  # noqa: BLE001 ต้นทางล่มได้หลายแบบ
            err = e
            time.sleep(2)
    raise err


def fake_fetcher(fake_dir):
    """สำหรับทดสอบ: ไฟล์ <fake_dir>/<cam id>.jpg (+ .lm = เวลา Last-Modified แบบ ISO)"""
    def f(url, cam_id):
        p = os.path.join(fake_dir, cam_id + '.jpg')
        if not os.path.exists(p):
            raise OSError('ไม่มีไฟล์ทดสอบ')
        lm = None
        if os.path.exists(p + '.lm'):
            lm = datetime.fromisoformat(open(p + '.lm').read().strip())
        return open(p, 'rb').read(), lm
    return f


def image_stats(img):
    import numpy as np
    g = np.asarray(img.convert('L').resize((160, 90)), dtype='float32')
    return float(g.mean()), float(g.std())


# ---------- AI ----------
class VLM:
    """VLM จาก Hugging Face (ค่าเริ่มต้น SmolVLM-500M, Apache-2.0) รันบน CPU"""

    def __init__(self, name):
        import torch
        from transformers import AutoProcessor
        try:
            from transformers import AutoModelForImageTextToText as Auto
        except ImportError:  # transformers รุ่นเก่า
            from transformers import AutoModelForVision2Seq as Auto
        self.torch = torch
        self.name = name
        self.model_id = VLM_MODELS[name]
        kw = {}
        if name == 'smolvlm':
            kw = {'size': {'longest_edge': 512}, 'do_image_splitting': False}  # ภาพเดียว 512 px ไม่ตัดเป็นหลายชิ้น เร็วขึ้นมากบน CPU
        elif name == 'qwen2vl':
            kw = {'min_pixels': 224 * 224, 'max_pixels': 448 * 448}
        self.proc = AutoProcessor.from_pretrained(self.model_id, **kw)
        self.model = Auto.from_pretrained(self.model_id, torch_dtype=torch.float32).eval()
        tok = self.proc.tokenizer
        def first_ids(words):
            out = set()
            for w in words:
                ids = tok.encode(w, add_special_tokens=False)
                if ids:
                    out.add(ids[0])
            return sorted(out)
        self.yes = first_ids(['Yes', ' Yes', 'yes', ' yes', 'YES'])
        self.no = first_ids(['No', ' No', 'no', ' no', 'NO'])
        self.thai = name == 'qwen2vl'

    def _inputs(self, img, text):
        msgs = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': text}]}]
        prompt = self.proc.apply_chat_template(msgs, add_generation_prompt=True)
        inp = self.proc(text=prompt, images=[img], return_tensors='pt')
        inp.pop('token_type_ids', None)  # บาง tokenizer ส่งมาแต่โมเดลไม่รับ
        return inp

    def p_yes(self, img, question):
        """ความน่าจะเป็นที่โมเดลตอบ "ใช่" (เทียบ logit ของคำว่า Yes กับ No ที่ตำแหน่งคำตอบแรก)"""
        t = self.torch
        with t.no_grad():
            out = self.model(**self._inputs(img, question + ' Answer yes or no.'))
        lg = out.logits[0, -1].float()
        d = t.logsumexp(lg[self.yes], 0) - t.logsumexp(lg[self.no], 0)
        return float(t.sigmoid(d))

    def caption(self, img, thai=False, max_new=48):
        inp = self._inputs(img, CAP_TH if thai else CAP_EN)
        with self.torch.no_grad():
            g = self.model.generate(**inp, max_new_tokens=max_new, do_sample=False)
        txt = self.proc.batch_decode(g[:, inp['input_ids'].shape[1]:], skip_special_tokens=True)[0]
        return clean_caption(txt)


class Detector:
    """RT-DETR (Apache-2.0) นับรถเท่านั้น ไม่เก็บกรอบ ไม่นับคน"""

    def __init__(self):
        import torch
        from transformers import RTDetrForObjectDetection, RTDetrImageProcessor
        self.torch = torch
        self.proc = RTDetrImageProcessor.from_pretrained(DET_MODEL)
        self.model = RTDetrForObjectDetection.from_pretrained(DET_MODEL).eval()
        self.veh = {int(i) for i, n in self.model.config.id2label.items() if n in VEHICLES}

    def vehicles(self, img, thr=0.5):
        t = self.torch
        inp = self.proc(images=img, return_tensors='pt')
        with t.no_grad():
            out = self.model(**inp)
        res = self.proc.post_process_object_detection(out, target_sizes=t.tensor([(img.height, img.width)]), threshold=thr)[0]
        return sum(1 for lab in res['labels'].tolist() if int(lab) in self.veh)


class MockVLM:
    """ทดสอบ: ตอบจากความสว่าง/สีของภาพ (ภาพทดสอบสีฟ้ามาก = น้ำท่วม)"""
    name = 'mock'
    model_id = 'mock'
    thai = False

    def p_yes(self, img, question):
        import numpy as np
        a = np.asarray(img.convert('RGB').resize((32, 18)), dtype='float32')
        blue = float((a[..., 2] - a[..., 0]).mean()) / 255
        if 'rain' in question:
            return 0.2
        return max(0.02, min(0.98, 0.5 + blue * 2))

    def caption(self, img, thai=False):
        return clean_caption('A road next to a canal under a cloudy sky. A man in a red shirt walks by.')


class MockDetector:
    def vehicles(self, img, thr=0.5):
        return 3


def clean_caption(txt):
    txt = re.sub(r'\s+', ' ', (txt or '').replace('Assistant:', '')).strip()
    parts = re.split(r'(?<=[.!?。])\s+', txt)
    keep = [p for p in parts if p and not PEOPLE_RE.search(p) and not PLATE_RE.search(p)]
    out = ' '.join(keep).strip()
    return out[:220]


# ---------- ตัดสินป้าย และประโยคภาษาไทย ----------
LABEL_TH = {'flood': 'น่าจะมีน้ำท่วม', 'high': 'น้ำค่อนข้างสูง', 'spill': 'กำลังระบายน้ำ', 'watch': 'น้ำมากกว่าปกติเล็กน้อย',
            'normal': 'ปกติ', 'night': 'มืด อ่านยาก', 'stale': 'ภาพค้าง', 'offline': 'ไม่มีภาพ', 'pending': 'รอวิเคราะห์'}


def decide(kind, p, night):
    f, h, s = p.get('flood', 0), p.get('high', 0), p.get('spill', 0)
    if kind == 'dam':
        return 'spill' if s >= 60 else ('night' if night else 'normal')
    if f >= 60:
        return 'flood'
    if h >= 60:
        return 'high'
    if night:
        return 'night'
    if max(f, h) >= 40:
        return 'watch'
    return 'normal'


def thai_text(kind, label, p, veh, night):
    f, h, s, r = (p.get(k, 0) for k in ('flood', 'high', 'spill', 'rain'))
    where = {'road': 'ผิวถนน', 'water': 'ริมลำน้ำ', 'mixed': 'ในภาพ'}.get(kind, 'ในภาพ')
    if label == 'flood':
        t = 'AI ประเมินว่าน่าจะมีน้ำท่วม' + where + ' (คะแนน %d)' % f
    elif label == 'high':
        t = 'AI ประเมินว่าระดับน้ำค่อนข้างสูง ใกล้ตลิ่ง (คะแนน %d)' % h
    elif label == 'spill':
        t = 'AI เห็นน้ำไหลผ่านทางระบายน้ำของเขื่อน (คะแนน %d)' % s
    elif label == 'watch':
        t = 'AI เห็นน้ำมากกว่าปกติเล็กน้อย ยังไม่ชัด (คะแนน %d)' % max(f, h)
    elif label == 'night':
        t = 'ภาพกลางคืนหรือมืด AI อ่านได้ไม่ชัด'
    elif kind == 'road':
        t = 'AI ไม่เห็นน้ำท่วมบนถนน'
    elif kind == 'dam':
        t = 'AI ไม่เห็นน้ำไหลผ่านทางระบายน้ำในมุมนี้'
    else:
        t = 'AI ไม่เห็นน้ำท่วมหรือน้ำสูงผิดปกติ'
    if r >= 60 and label != 'night':
        t += ' · น่าจะมีฝนตก'
    if veh is not None and kind in ('road', 'mixed'):
        t += ' · รถในภาพราว %d คัน' % veh if veh else ' · ไม่เห็นรถในภาพ'
    return t


def th_date(dt):
    m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][dt.month - 1]
    return '%d %s %d' % (dt.day, m, dt.year + 543)


# ---------- งานหลัก ----------
def scan(args):
    reg = load_json(args.registry, None)
    if not reg:
        sys.exit('อ่าน %s ไม่ได้' % args.registry)
    os.makedirs(args.data, exist_ok=True)
    thumbs_dir = os.path.join(args.data, 'thumbs')
    os.makedirs(thumbs_dir, exist_ok=True)
    idx_path, hist_path = os.path.join(args.data, 'index.json'), os.path.join(args.data, 'history.json')
    prev = load_json(idx_path, {}).get('cams', {})
    hist = load_json(hist_path, {}).get('cams', {})
    now = now_bkk()
    t0 = time.time()
    only = set(filter(None, (args.only or '').split(',')))

    cams = []
    for s in reg['sites']:
        src = reg['sources'].get(s['src'], {})
        for c in s['cams']:
            if not only or c['id'] in only or s['id'] in only:
                cams.append((s, src, c))
    # กล้องถนนและกล้องที่รอบก่อนเห็นน้ำ ได้คิวก่อน (ถ้าเวลาไม่พอ กล้องท้ายๆ จะใช้ผลเดิม)
    order = {'flood': 0, 'high': 0, 'watch': 1}
    cams.sort(key=lambda x: (order.get((prev.get(x[2]['id']) or {}).get('label'), 2), {'road': 0, 'mixed': 1, 'water': 2, 'dam': 3}[x[2]['kind']]))

    vlm = det = None
    if args.mock:
        vlm, det = MockVLM(), MockDetector()
    else:
        if args.vlm != 'none':
            print('โหลด VLM', VLM_MODELS[args.vlm], flush=True)
            vlm = VLM(args.vlm)
        if args.det != 'none':
            print('โหลดตัวนับรถ', DET_MODEL, flush=True)
            det = Detector()
        print('โหลดโมเดลเสร็จ %.0f วินาที' % (time.time() - t0), flush=True)
    getter = fake_fetcher(args.fake_dir) if args.fake_dir else (lambda url, cid: fetch(url))

    from PIL import Image
    out, stats = {}, {'ok': 0, 'ai': 0, 'reuse': 0, 'stale': 0, 'offline': 0, 'late': 0}
    keep_thumbs = set()
    for i, (site, src, c) in enumerate(cams):
        cid, kind = c['id'], c['kind']
        old = prev.get(cid) or {}
        rec = {'seen': iso(now)}
        try:
            data, lm = getter(c['img'], cid)
            img = Image.open(io.BytesIO(data))
            img.load()
            img = img.convert('RGB')
            if len(data) < 2000 or min(img.size) < 32:
                raise ValueError('ภาพเล็กผิดปกติ')
        except Exception as e:  # noqa: BLE001
            rec.update(status='offline', label='offline', th='กล้องไม่ส่งภาพตอนนี้ (%s)' % type(e).__name__)
            for k in ('img_t', 'hash', 'changed'):
                if old.get(k):
                    rec[k] = old[k]
            out[cid] = rec
            stats['offline'] += 1
            print('[%d/%d] %s ✗ ดึงภาพไม่ได้: %s' % (i + 1, len(cams), cid, e), flush=True)
            continue

        h = hashlib.sha1(data).hexdigest()[:12]
        rec['hash'] = h
        rec['size'] = list(img.size)
        changed = parse_iso(old.get('changed')) if old.get('hash') == h else now
        rec['changed'] = iso(changed or now)
        if lm:
            rec['img_t'] = iso(lm)
        mean, std = image_stats(img)
        night = mean < NIGHT_MEAN
        rec['night'] = night

        stale_since = None
        if lm and now - lm > timedelta(hours=STALE_H):
            stale_since = lm
        elif changed and now - changed > timedelta(hours=FROZEN_H):
            stale_since = changed
        if std < FLAT_STD:
            rec.update(status='offline', label='offline', th='กล้องส่งภาพว่างหรือสีเดียวทั้งภาพ')
            stats['offline'] += 1
        elif stale_since:
            rec.update(status='stale', label='stale', th='ภาพไม่อัปเดตตั้งแต่ ' + th_date(stale_since.astimezone(BKK)))
            stats['stale'] += 1
        else:
            rec['status'] = 'ok'
            stats['ok'] += 1

        # ภาพย่อ (เฉพาะแหล่งที่อนุญาตให้เผยแพร่ต่อ) เก็บแค่ภาพล่าสุด
        if src.get('thumbs') and rec['status'] != 'offline':
            tp = os.path.join(thumbs_dir, cid + '.jpg')
            if old.get('hash') != h or not os.path.exists(tp):
                th = img.copy()
                th.thumbnail((THUMB_SIDE, THUMB_SIDE))
                th.save(tp, 'JPEG', quality=72, optimize=True)
            keep_thumbs.add(cid + '.jpg')
            rec['thumb'] = h

        if rec['status'] == 'ok':
            same = old.get('hash') == h and old.get('p') is not None and old.get('model') == (vlm.model_id if vlm else '')
            late = time.time() - t0 > args.budget * 60
            if same:
                for k in ('p', 'veh', 'en', 'th', 'label', 'ai', 'model'):
                    if k in old:
                        rec[k] = old[k]
                stats['reuse'] += 1
            elif late or not vlm:
                rec.update(label='pending', th='ยังไม่ได้ให้ AI ดูภาพนี้' + (' (หมดเวลารอบนี้)' if late else ''))
                stats['late'] += 1
            else:
                ta = time.time()
                p = {}
                for key, qk in ASK[kind]:
                    p[key] = int(round(vlm.p_yes(img, Q[qk]) * 100))
                veh = det.vehicles(img) if det and kind in ('road', 'mixed') else None
                cap = vlm.caption(img, thai=vlm.thai)
                label = decide(kind, p, night)
                rec.update(p=p, label=label, ai=iso(now), model=vlm.model_id)
                if veh is not None:
                    rec['veh'] = veh
                if vlm.thai and cap:
                    rec['th'] = cap + ' · ' + thai_text(kind, label, p, veh, night)
                else:
                    rec['th'] = thai_text(kind, label, p, veh, night)
                    if cap:
                        rec['en'] = cap
                stats['ai'] += 1
                print('[%d/%d] %s %s %s %.1fs · %s' % (i + 1, len(cams), cid, label, p, time.time() - ta, rec.get('en', '')[:80]), flush=True)
        out[cid] = rec

        # ประวัติ: จุดละ 1 ครั้งต่อรอบ [เวลา, ป้าย, คะแนนหลัก, จำนวนรถ]
        pp = rec.get('p') or {}
        score = max([pp.get('flood', 0), pp.get('high', 0), pp.get('spill', 0)] or [0])
        pts = [x for x in hist.get(cid, []) if parse_iso(x[0]) and now - parse_iso(x[0]) <= timedelta(hours=HIST_H)]
        pts = [x for x in pts if x[0] != iso(now)]
        pts.append([iso(now), rec.get('label'), score if rec.get('p') else None, rec.get('veh')])
        hist[cid] = pts[-HIST_H * 2:]

    # กล้องที่ไม่ได้ตรวจรอบนี้ (ใช้ --only) เก็บผลเดิมไว้
    for cid, old in prev.items():
        if cid not in out and any(cid == c['id'] for s in reg['sites'] for c in s['cams']):
            out[cid] = old
            if old.get('thumb'):
                keep_thumbs.add(cid + '.jpg')
    for fn in os.listdir(thumbs_dir):
        if fn not in keep_thumbs:
            os.remove(os.path.join(thumbs_dir, fn))
    valid = set(out)
    hist = {k: v for k, v in hist.items() if k in valid}

    labels = {}
    for r in out.values():
        labels[r.get('label')] = labels.get(r.get('label'), 0) + 1
    idx = {'v': 1, 'updated': iso(now), 'run_secs': int(time.time() - t0),
           'model': {'vlm': vlm.model_id if vlm else '', 'det': (DET_MODEL if det and not args.mock else ('mock' if det else ''))},
           'counts': labels, 'cams': out}
    save_json(idx_path, idx)
    save_json(hist_path, {'v': 1, 'updated': iso(now), 'hours': HIST_H, 'cams': hist})
    print('เสร็จ %d กล้อง · AI ดู %d · ใช้ผลเดิม %d · ภาพค้าง %d · ไม่มีภาพ %d · รอรอบหน้า %d · %.0f วินาที' % (
        len(out), stats['ai'], stats['reuse'], stats['stale'], stats['offline'], stats['late'], time.time() - t0))
    print('ป้าย:', ', '.join('%s %d' % (LABEL_TH.get(k, k), n) for k, n in sorted(labels.items(), key=lambda x: -x[1])))
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--registry', default='data/cctv.json')
    ap.add_argument('--data', required=True, help='โฟลเดอร์ผล (branch cctv-data)')
    ap.add_argument('--vlm', default='smolvlm', choices=sorted(VLM_MODELS) + ['none'])
    ap.add_argument('--det', default='rtdetr', choices=['rtdetr', 'none'])
    ap.add_argument('--budget', type=float, default=30, help='นาทีสูงสุดที่ให้ AI ดูภาพ เกินแล้วกล้องที่เหลือรอรอบหน้า')
    ap.add_argument('--only', default='', help='เฉพาะกล้องหรือจุด เช่น hy-bangsala,egat-bb')
    ap.add_argument('--mock', action='store_true', help='ใช้ AI จำลอง (ทดสอบ)')
    ap.add_argument('--fake-dir', default='', help='อ่านภาพจากโฟลเดอร์แทนการดึงจากเว็บ (ทดสอบ)')
    scan(ap.parse_args())


if __name__ == '__main__':
    main()
