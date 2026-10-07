#!/usr/bin/env python3
"""เอาผลตรวจน้ำท่วมจากดาวเทียม (ไฟล์ GeoJSON จากโน้ตบุ๊ก notebooks/flood_s1.ipynb) ขึ้นแผนที่ ChatGeo

ใช้:  python3 scripts/add_flood.py flood_s1_ccs_2026-10-02.geojson     เพิ่มหรือแทนที่พื้นที่นั้น
      python3 scripts/add_flood.py FILE --id ccs --name "ฉะเชิงเทรา"    กำหนดชื่อย่อ/ชื่อพื้นที่เอง
      python3 scripts/add_flood.py --rebuild                             สร้าง data/flood/index.json ใหม่อย่างเดียว

สิ่งที่ทำ
1. ตรวจและทำความสะอาดไฟล์: เก็บเฉพาะรูปหลายเหลี่ยมในประเทศไทย ปัดพิกัดเหลือ 4 ตำแหน่ง ตัดปื้นเล็กกว่า 0.05 ตร.กม.
2. ถ้าไฟล์ยังไม่มีความมั่นใจ (conf) จะคำนวณให้: ผืนตั้งแต่ 1 ตร.กม. หรือห่างผืนใหญ่ไม่เกิน 300 ม. = high
3. สรุปพื้นที่รายจังหวัดจาก data/th-regions.js
4. เขียน data/flood/<ชื่อย่อ>.geojson (พื้นที่เดิมชื่อเดียวกันจะถูกแทนที่) แล้วสร้าง data/flood/index.json ใหม่
ใช้แค่ Python มาตรฐาน ไม่ต้องติดตั้งอะไรเพิ่ม
"""
import datetime as dt
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'data', 'flood')
TH_JS = os.path.join(ROOT, 'data', 'th-regions.js')
TH_BOX = (97.0, 5.3, 106.0, 20.7)
MIN_KM2 = 0.05
MAX_FEATURES = {'flood': 3000, 'seasonal': 1500}
BIG_KM2, NEAR_M = 1.0, 300.0
ID_RE = re.compile(r'^[a-z0-9-]{1,24}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TAG_RE = re.compile(r'<[^>]*>')


def clean(v, n=80):
    return re.sub(r'\s+', ' ', TAG_RE.sub('', str(v or ''))).strip()[:n]


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def rings_of(geom):
    """คืนรายการรูปหลายเหลี่ยม แต่ละอันคือ [วงนอก, รู...]"""
    t, c = geom.get('type'), geom.get('coordinates')
    if t == 'Polygon':
        return [c]
    if t == 'MultiPolygon':
        return list(c)
    return []


def ring_area_km2(ring):
    """พื้นที่ของวงพิกัด (ลองจิจูด/ละติจูด) แบบประมาณบนผิวโลก"""
    if len(ring) < 4:
        return 0.0
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111.32 * math.cos(lat0), 110.57
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(s) / 2


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def in_polys(x, y, polys):
    for p in polys:
        if in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:]):
            return True
    return False


def rep_point(polys):
    """จุดตัวแทนของรูป: จุดศูนย์ถ่วงของวงนอกที่ใหญ่สุด ถ้าตกนอกรูปใช้จุดกึ่งกลางของขอบแรก"""
    outer = max((p[0] for p in polys), key=ring_area_km2)
    n = len(outer) - 1 or 1
    cx = sum(p[0] for p in outer[:-1]) / n
    cy = sum(p[1] for p in outer[:-1]) / n
    if in_polys(cx, cy, polys):
        return cx, cy
    (x1, y1), (x2, y2) = outer[0], outer[1]
    return (x1 + x2) / 2, (y1 + y2) / 2


def bbox(polys):
    xs = [p[0] for poly in polys for r in poly for p in r]
    ys = [p[1] for poly in polys for r in poly for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def round_c(c, nd=4):
    return [round_c(x, nd) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]


def add_conf(feats):
    """ความมั่นใจของปื้นน้ำผิดปกติ ใช้ระยะระหว่างจุดยอดของรูป (ตาราง 300 ม.) แทนระยะขอบจริง"""
    flood = [f for f in feats if f['properties']['kind'] == 'flood']
    big = [f for f in flood if f['properties']['area_km2'] >= BIG_KM2]
    cell = NEAR_M / 111320.0
    grid = {}
    for f in big:
        for poly in rings_of(f['geometry']):
            for x, y in poly[0]:
                grid.setdefault((int(x // cell), int(y // cell)), []).append((x, y))

    def near_big(f):
        for poly in rings_of(f['geometry']):
            for x, y in poly[0]:
                gx, gy = int(x // cell), int(y // cell)
                kx = 111320.0 * math.cos(math.radians(y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for bx, by in grid.get((gx + dx, gy + dy), ()):
                            if math.hypot((bx - x) * kx, (by - y) * 110570.0) <= NEAR_M:
                                return True
        return False

    for f in flood:
        p = f['properties']
        if p.get('conf') not in ('high', 'low'):
            p['conf'] = 'high' if p['area_km2'] >= BIG_KM2 or near_big(f) else 'low'


def load_provinces():
    with open(TH_JS, encoding='utf-8') as fh:
        m = re.search(r'window\.CG_TH\s*=\s*(\{.*\})\s*;?\s*$', fh.read(), re.S)
    th = json.loads(m.group(1))
    out = []
    for f in th['provinces']['features']:
        polys = rings_of(f['geometry'])
        out.append((f['properties']['name'], f['properties'].get('zone', ''), bbox(polys), polys))
    return out


def province_table(feats, provs):
    tot = {}
    for f in feats:
        p = f['properties']
        key = 'seasonal' if p['kind'] == 'seasonal' else ('flood_low' if p.get('conf') == 'low' else 'flood_high')
        x, y = rep_point(rings_of(f['geometry']))
        for name, zone, b, polys in provs:
            if b[0] <= x <= b[2] and b[1] <= y <= b[3] and in_polys(x, y, polys):
                row = tot.setdefault(name, {'name': name, 'zone': zone, 'flood_high': 0.0, 'flood_low': 0.0, 'seasonal': 0.0})
                row[key] += p['area_km2']
                break
    rows = sorted(tot.values(), key=lambda r: (-r['flood_high'], -r['flood_low'], -r['seasonal']))
    for r in rows:
        for k in ('flood_high', 'flood_low', 'seasonal'):
            r[k] = round(r[k], 1)
    return rows


def normalize(doc, area_id, name):
    props = doc.get('properties') or {}
    legacy = props.get('v') != 3 and not any((f.get('properties') or {}).get('kind') for f in doc.get('features') or [])
    dates = [d for d in (props.get('dates') or [props.get('date')]) if isinstance(d, str) and DATE_RE.match(d)]
    if not dates:
        raise SystemExit('ไม่พบวันที่ของภาพ (properties.date หรือ dates)')
    dates = sorted(set(dates), reverse=True)
    feats = []
    for f in doc.get('features') or []:
        p, g = f.get('properties') or {}, f.get('geometry') or {}
        polys = rings_of(g)
        if not polys or any(len(r) < 4 for poly in polys for r in poly):
            continue
        b = bbox(polys)
        if not (TH_BOX[0] <= b[0] and b[2] <= TH_BOX[2] and TH_BOX[1] <= b[1] and b[3] <= TH_BOX[3]):
            continue
        kind = 'flood' if legacy else clean(p.get('kind'), 10)
        if kind not in ('flood', 'seasonal'):
            continue
        a = num(p.get('area_km2'))
        if a is None:
            a = sum(ring_area_km2(poly[0]) - sum(ring_area_km2(h) for h in poly[1:]) for poly in polys)
        if a < MIN_KM2:
            continue
        q = {'kind': kind, 'area_km2': round(a, 3)}
        if kind == 'flood' and p.get('conf') in ('high', 'low') and not legacy:
            q['conf'] = p['conf']
        # ไฟล์รุ่นเก่า (v2) ใส่วันที่ล่าสุดให้ทุกปื้น ซึ่งอาจไม่ตรง จึงไม่เก็บวันที่รายปื้น
        if not legacy and isinstance(p.get('date'), str) and p['date'] in dates:
            q['date'] = p['date']
        feats.append({'type': 'Feature', 'properties': q,
                      'geometry': {'type': g['type'], 'coordinates': round_c(g['coordinates'])}})
    out = []
    for kind, cap in MAX_FEATURES.items():
        ks = sorted((f for f in feats if f['properties']['kind'] == kind), key=lambda f: -f['properties']['area_km2'])
        out += ks[:cap]
    if not out:
        print('หมายเหตุ: ไม่มีปื้นน้ำเลย (อาจไม่มีน้ำท่วมในพื้นที่นี้) จะบันทึกเป็นพื้นที่ที่ตรวจแล้วแต่ไม่พบน้ำ')
    add_conf(out)
    aoi = props.get('aoi')
    if not (isinstance(aoi, list) and len(aoi) == 4 and all(num(v) is not None for v in aoi)):
        if not out:
            raise SystemExit('ไม่มีปื้นน้ำและไม่มีขอบเขตพื้นที่ (properties.aoi) บันทึกไม่ได้')
        b = bbox([poly for f in out for poly in rings_of(f['geometry'])])
        aoi = [b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02]
    aoi = [round(float(v), 4) for v in aoi]
    provs = province_table(out, load_provinces())
    t = {'flood_high': 0.0, 'flood_low': 0.0, 'seasonal': 0.0}
    for f in out:
        p = f['properties']
        t['seasonal' if p['kind'] == 'seasonal' else 'flood_' + p['conf']] += p['area_km2']
    meta = {
        'v': 2 if legacy else 3, 'id': area_id, 'name': name, 'aoi': aoi, 'date': dates[0], 'dates': dates,
        'baseline_years': int(num(props.get('baseline_years')) or (1 if legacy else 0)),
        'has_seasonal': any(f['properties']['kind'] == 'seasonal' for f in out),
        'totals': {k: round(v, 1) for k, v in t.items()}, 'provinces': provs,
        'scenes': {d: int(n) for d, n in (props.get('scenes') or {}).items()
                   if isinstance(d, str) and DATE_RE.match(d) and num(n) is not None} if isinstance(props.get('scenes'), dict) else {},
        'baseline_dates': [d for d in (props.get('baseline_dates') or []) if isinstance(d, str) and DATE_RE.match(d)][:10],
        'threshold_db': num(props.get('threshold_db')),
        'auto': bool(props.get('auto')),
        'source': clean(props.get('source') or 'Sentinel-1 RTC (Copernicus/ESA) via Microsoft Planetary Computer', 200),
        'method': clean(props.get('method'), 300),
        'added': dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat(timespec='minutes'),
    }
    return {'type': 'FeatureCollection', 'properties': meta, 'features': out}


def write_json(path, data, compact=True):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        if compact:
            json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    os.replace(tmp, path)


def rebuild_index():
    areas = []
    for path in sorted(glob.glob(os.path.join(DIR, '*.geojson'))):
        try:
            with open(path, encoding='utf-8') as fh:
                p = json.load(fh).get('properties') or {}
        except (OSError, ValueError):
            print('ข้ามไฟล์ที่อ่านไม่ได้:', os.path.basename(path))
            continue
        if not p.get('id') or not p.get('date'):
            continue
        areas.append({
            'id': p['id'], 'file': os.path.basename(path), 'name': p.get('name') or p['id'], 'aoi': p.get('aoi'),
            'date': p['date'], 'dates': p.get('dates') or [p['date']], 'v': p.get('v'),
            'baseline_years': p.get('baseline_years', 0), 'has_seasonal': bool(p.get('has_seasonal')), 'added': p.get('added', ''),
            'auto': bool(p.get('auto')),
            'totals': p.get('totals') or {}, 'provinces': p.get('provinces') or [],
        })
    areas.sort(key=lambda a: a['date'], reverse=True)
    idx = {'updated': dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat(timespec='minutes'), 'areas': areas}
    write_json(os.path.join(DIR, 'index.json'), idx, compact=False)
    print('index.json: %d พื้นที่ %s' % (len(areas), ', '.join('%s (%s)' % (a['id'], a['date']) for a in areas)))


def main(argv):
    os.makedirs(DIR, exist_ok=True)
    if '--rebuild' in argv:
        rebuild_index()
        return 0
    args, opts, i = [], {}, 0
    while i < len(argv):
        if argv[i] in ('--id', '--name') and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if len(args) != 1:
        print(__doc__)
        return 2
    with open(args[0], encoding='utf-8') as fh:
        doc = json.load(fh)
    props = doc.get('properties') or {}
    m = re.search(r'flood_s1_([a-z0-9-]+)_\d{4}-\d{2}-\d{2}', os.path.basename(args[0]))
    area_id = (opts.get('id') or props.get('id') or (m.group(1) if m else '')).lower()
    if not ID_RE.match(area_id):
        raise SystemExit('ต้องมีชื่อย่อพื้นที่ (a-z, 0-9) เช่น --id ccs')
    name = clean(opts.get('name') or props.get('name') or area_id, 60)
    out = normalize(doc, area_id, name)
    path = os.path.join(DIR, area_id + '.geojson')
    write_json(path, out)
    t = out['properties']['totals']
    print('บันทึก %s: %s ภาพ %s · น่าจะท่วม %.1f ตร.กม. · ไม่แน่ใจ %.1f · มีน้ำเกือบทุกปี %.1f · %d ปื้น · %.0f KB'
          % (os.path.relpath(path, ROOT), name, ' / '.join(out['properties']['dates']), t['flood_high'], t['flood_low'],
             t['seasonal'], len(out['features']), os.path.getsize(path) / 1024))
    for r in out['properties']['provinces'][:6]:
        print('  จ.%s  น่าจะท่วม %.1f · ไม่แน่ใจ %.1f · ทุกปี %.1f' % (r['name'], r['flood_high'], r['flood_low'], r['seasonal']))
    rebuild_index()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
