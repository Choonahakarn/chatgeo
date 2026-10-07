#!/usr/bin/env python3
"""ลงสรุปข่าวเช้าเข้าเว็บ ChatGeo

ใช้:  python3 scripts/publish_brief.py brief.json          ตรวจแล้วเขียนไฟล์
      python3 scripts/publish_brief.py brief.json --check  ตรวจอย่างเดียว ไม่เขียน

สิ่งที่ทำ
1. ตรวจและทำความสะอาด brief.json (ตัด HTML ตัดฟิลด์แปลกปลอม เช็กลิงก์ พิกัด หมวด)
   ข่าวที่ไม่ผ่านจะถูกตัดทิ้ง ถ้าเหลือน้อยกว่า 8 เรื่องจะหยุดโดยไม่เขียนอะไรเลย
2. เขียน data/briefs/<วันที่>.json
3. ลบสรุปที่เก่ากว่า 30 วันใน data/briefs/
4. เขียน data/latest.json = สรุปวันล่าสุด + รายการวันที่ย้อนหลัง (archive)
"""
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIEFS = os.path.join(ROOT, 'data', 'briefs')
LATEST = os.path.join(ROOT, 'data', 'latest.json')
KEEP_DAYS = 30
MIN_STORIES = 8
MAX_STORIES = 24

LAYERS = {'conflict', 'market', 'biz', 'ai', 'weather', 'area', 'news'}
REGIONS = {'th', 'asean', 'world', 'ai'}
LEVELS = {'normal', 'watch', 'warning'}
DIRS = {'up', 'down', 'flat'}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ID_RE = re.compile(r'^[a-z]{1,6}\d{1,3}$')
URL_RE = re.compile(r'^https?://[^\s<>"\']+$')
TAG_RE = re.compile(r'<[^>]*>')
CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

warnings = []


def clean(v, limit):
    """ข้อความล้วน: ตัดแท็ก HTML อักขระควบคุม และช่องว่างซ้ำ แล้วตัดความยาว"""
    if v is None:
        return ''
    s = CTRL_RE.sub('', TAG_RE.sub('', str(v)))
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:limit]


def clean_url(v):
    s = str(v or '').strip()
    return s if URL_RE.match(s) and len(s) <= 800 else ''


def valid_date(s):
    if not DATE_RE.match(str(s or '')):
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def num(v, lo, hi):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f < lo or f > hi:
        return None
    return round(f, 4)


def clean_story(s, i):
    if not isinstance(s, dict):
        warnings.append('ข่าวลำดับ %d ไม่ใช่ออบเจกต์ ตัดทิ้ง' % (i + 1))
        return None
    sid = clean(s.get('id'), 12).lower()
    out = {
        'id': sid,
        'rank': s.get('rank'),
        'top': bool(s.get('top')),
        'region': clean(s.get('region'), 10),
        'layer': clean(s.get('layer'), 10),
        'title': clean(s.get('title'), 140),
        'summary': clean(s.get('summary'), 700),
        'why_label': clean(s.get('why_label') or 'ควรรู้', 30),
        'why': clean(s.get('why'), 400),
        'place': clean(s.get('place'), 60),
        'lon': num(s.get('lon'), -180, 180),
        'lat': num(s.get('lat'), -85, 85),
        'published': clean(s.get('published'), 10),
        'source': clean(s.get('source'), 60),
        'url': clean_url(s.get('url')),
    }
    problems = []
    if not ID_RE.match(sid):
        problems.append('id')
    if out['region'] not in REGIONS:
        problems.append('region')
    if out['layer'] not in LAYERS:
        problems.append('layer')
    for k in ('title', 'summary', 'place', 'source'):
        if not out[k]:
            problems.append(k)
    if out['lon'] is None or out['lat'] is None:
        problems.append('lon/lat')
    if not out['url']:
        problems.append('url')
    if not valid_date(out['published']):
        problems.append('published')
    try:
        out['rank'] = int(out['rank'])
        if out['rank'] < 1:
            raise ValueError
    except (TypeError, ValueError):
        out['rank'] = i + 1
    if problems:
        warnings.append('ตัดข่าว %s (%s): %s' % (sid or '#%d' % (i + 1), out['title'][:40], ', '.join(problems)))
        return None
    return out


def clean_brief(doc):
    if not isinstance(doc, dict):
        raise SystemExit('ไฟล์ต้องเป็น JSON ออบเจกต์')
    date = valid_date(doc.get('date'))
    if not date:
        raise SystemExit('date ต้องเป็นรูปแบบ YYYY-MM-DD')

    stories, seen = [], set()
    for i, s in enumerate(doc.get('stories') or []):
        c = clean_story(s, i)
        if not c:
            continue
        if c['id'] in seen:
            warnings.append('ตัดข่าว id ซ้ำ: ' + c['id'])
            continue
        seen.add(c['id'])
        stories.append(c)
    stories.sort(key=lambda x: x['rank'])
    stories = stories[:MAX_STORIES]
    for n, s in enumerate(stories, 1):
        s['rank'] = n

    markets = []
    for m in (doc.get('markets') or [])[:8]:
        if not isinstance(m, dict):
            continue
        c = {
            'name': clean(m.get('name'), 40), 'value': clean(m.get('value'), 30),
            'unit': clean(m.get('unit'), 30), 'change': clean(m.get('change'), 60),
            'dir': clean(m.get('dir'), 5), 'source': clean(m.get('source'), 60),
            'url': clean_url(m.get('url')),
        }
        if not c['name'] or not c['value']:
            warnings.append('ตัดข้อมูลตลาดที่ไม่มีชื่อหรือค่า')
            continue
        if c['dir'] not in DIRS:
            c['dir'] = 'flat'
        markets.append(c)

    weather = []
    for w in (doc.get('weather') or [])[:8]:
        if not isinstance(w, dict):
            continue
        c = {
            'region': clean(w.get('region'), 40), 'status': clean(w.get('status'), 160),
            'level': clean(w.get('level'), 10), 'place': clean(w.get('place'), 12),
        }
        if not c['region'] or not c['status']:
            continue
        if c['level'] not in LEVELS:
            c['level'] = 'normal'
        if not re.match(r'^[a-z0-9-]{1,12}$', c['place']):
            c['place'] = 'th'
        weather.append(c)

    ws = doc.get('weatherSource') if isinstance(doc.get('weatherSource'), dict) else {}
    questions = []
    for q in (doc.get('questions') or [])[:6]:
        if not isinstance(q, dict):
            continue
        text = clean(q.get('q'), 90)
        layer = clean(q.get('layer'), 10)
        if text:
            questions.append({'q': text, 'layer': layer if layer in LAYERS or layer == 'accent' else 'accent'})

    return {
        'date': date.isoformat(),
        'generatedAt': clean(doc.get('generatedAt'), 40),
        'generatedBy': clean(doc.get('generatedBy') or 'scheduled task', 40),
        'stories': stories,
        'markets': markets,
        'marketsAsOf': clean(doc.get('marketsAsOf'), 60),
        'weather': weather,
        'weatherNote': clean(doc.get('weatherNote'), 300),
        'weatherSource': {'name': clean(ws.get('name'), 60), 'url': clean_url(ws.get('url'))},
        'questions': questions,
    }


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    check_only = '--check' in argv
    if len(args) != 1:
        print(__doc__)
        return 2
    with open(args[0], encoding='utf-8') as f:
        raw = json.load(f)
    brief = clean_brief(raw)
    for w in warnings:
        print('คำเตือน:', w)
    n = len(brief['stories'])
    by_region = {r: sum(1 for s in brief['stories'] if s['region'] == r) for r in ('th', 'ai', 'world', 'asean')}
    if n < MIN_STORIES:
        print('ไม่ลงเว็บ: ข่าวที่ผ่านการตรวจมี %d เรื่อง (ต้องมีอย่างน้อย %d)' % (n, MIN_STORIES))
        return 1
    if check_only:
        print('ผ่าน %s: %d เรื่อง %s (ยังไม่ได้เขียนไฟล์)' % (brief['date'], n, by_region))
        return 0

    os.makedirs(BRIEFS, exist_ok=True)
    write_json(os.path.join(BRIEFS, brief['date'] + '.json'), brief)

    cutoff = dt.date.fromisoformat(brief['date']) - dt.timedelta(days=KEEP_DAYS)
    dates, pruned = [], []
    for name in os.listdir(BRIEFS):
        d = valid_date(name[:-5]) if name.endswith('.json') else None
        if not d:
            continue
        if d < cutoff:
            os.remove(os.path.join(BRIEFS, name))
            pruned.append(name)
        else:
            dates.append(d.isoformat())
    dates.sort(reverse=True)

    with open(os.path.join(BRIEFS, dates[0] + '.json'), encoding='utf-8') as f:
        newest = json.load(f)
    newest['archive'] = dates[:KEEP_DAYS + 1]
    write_json(LATEST, newest)

    print('ลงเว็บแล้ว %s: %d เรื่อง %s · ตลาด %d · อากาศ %d · ย้อนหลัง %d วัน · ลบของเก่า %d ไฟล์'
          % (brief['date'], n, by_region, len(brief['markets']), len(brief['weather']), len(dates), len(pruned)))
    if dates[0] != brief['date']:
        print('หมายเหตุ: มีสรุปที่ใหม่กว่า (%s) จึงใช้เป็นหน้าแรกต่อไป' % dates[0])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
