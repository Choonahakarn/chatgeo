#!/usr/bin/env python3
"""โครงเมืองกรุงเทพจากไฟล์ OSM ของไทย (ทางสำรองของงาน bkkbase ในข้อมูลสด เมื่อเซิร์ฟเวอร์ Overpass ยุ่ง)

ลองนึกถึงการเปิดแผนที่เล่มใหญ่ทั้งประเทศ แล้วตัดเฉพาะหน้ากรุงเทพมาเย็บเป็นเล่มเล็ก
อ่าน thailand-latest.osm.pbf (Geofabrik) ที่งาน "เดินป่าและธรรมชาติ (OSM)" โหลดมาอยู่แล้ว แล้วเก็บ
  districts  เขต 50 เขต (ขอบเขต พื้นที่ ตร.กม. จุดวางชื่อ)
  lines      เส้นรถไฟฟ้า/รถไฟชานเมือง พร้อมสีจริงจากแท็ก colour
  stations   สถานีรถไฟฟ้าและรถไฟ
  marks      สถานที่สำคัญ (รายชื่อเดียวกับงานข้อมูลสด) + ตึกสูงเกิน 220 ม.
  infra      สถานีสูบน้ำ ประตูระบายน้ำ จุดเสี่ยงน้ำท่วม จาก data.bangkok.go.th (ถ้าดึงได้)
เขียน OUT/bkk_base.json (รูปแบบเดียวกับ live-data/bkk_base.json หน้าเว็บใช้ไฟล์ไหนก็ได้)

ข้อมูล © OpenStreetMap contributors (ODbL)
ใช้: python scripts/bkk_osm.py --pbf thailand-latest.osm.pbf --out /tmp/outdoor-data
"""
import argparse
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_feeds as LF  # noqa: E402  ใช้รายชื่อสถานที่ สีเส้น และตัวดึงข้อมูล กทม. ชุดเดียวกัน

BOX = (100.25, 13.40, 100.98, 14.10)  # ตะวันตก ใต้ ตะวันออก เหนือ (เส้นรถไฟฟ้าและสถานี)
IN = (100.30, 13.48, 100.96, 13.97)   # เขตและสถานที่


def _in(lon, lat, b):
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]


def _q(cs):
    return [[round(x, 5), round(y, 5)] for x, y in cs]


def build(pbf, out_dir, infra=True):
    import osmium
    from shapely import wkb
    t0 = time.time()
    os.makedirs(out_dir, exist_ok=True)
    # รอบ 1: เส้นทางรถไฟฟ้า (relation) และทางที่เป็นสมาชิก
    routes, need = {}, set()
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION):
        tg = {t.k: t.v for t in r.tags}
        kind = tg.get('route')
        if tg.get('type') != 'route' or kind not in ('subway', 'light_rail', 'monorail', 'train'):
            continue
        label = ' '.join(str(tg.get(k) or '') for k in ('name', 'name:en', 'network', 'ref', 'operator'))
        if kind == 'train' and not LF.TRAIN_KEEP.search(label):
            continue
        ways = [m.ref for m in r.members if m.type == 'w' and m.role not in ('platform', 'stop', 'stop_exit_only', 'stop_entry_only')]
        routes[r.id] = (tg, ways)
        need.update(ways)
    print('กรุงเทพ รอบ 1: เส้นทางรถไฟฟ้า %d · %.0f วินาที' % (len(routes), time.time() - t0), flush=True)

    # รอบ 2: พิกัดทาง สถานี สถานที่ ตึกสูง และพื้นที่เขต
    rx = re.compile('^(%s)' % '|'.join(p[0] for p in LF.BKK_MARKS))
    gf = osmium.geom.WKBFactory()
    way_coords, dists, stations, cands = {}, [], [], []
    fp = (osmium.FileProcessor(pbf).with_locations().with_areas(osmium.filter.KeyFilter('boundary'))
          .with_filter(osmium.filter.KeyFilter('boundary', 'railway', 'name', 'height')))
    for o in fp:
        if o.is_area():
            tg = {t.k: t.v for t in o.tags}
            if tg.get('boundary') != 'administrative' or tg.get('admin_level') != '6' or not str(tg.get('name') or '').startswith('เขต'):
                continue
            try:
                g = wkb.loads(gf.create_multipolygon(o), hex=True)
            except Exception:  # noqa: BLE001  ขอบเขตวาดไม่สมบูรณ์
                continue
            c = g.representative_point()
            if _in(c.x, c.y, IN):
                dists.append((o.orig_id(), tg, g, c))
            continue
        tg = {t.k: t.v for t in o.tags}
        if o.is_node():
            if not o.location.valid():
                continue
            lon, lat = o.location.lon, o.location.lat
        elif o.is_way():
            try:
                cs = [(n.lon, n.lat) for n in o.nodes if n.location.valid()]
            except osmium.InvalidLocationError:
                cs = []
            if not cs:
                continue
            if o.id in need:
                way_coords[o.id] = cs
            lon, lat = sum(p[0] for p in cs) / len(cs), sum(p[1] for p in cs) / len(cs)
        else:
            continue
        if not _in(lon, lat, BOX):
            continue
        name = str(tg.get('name') or '').strip()
        if tg.get('railway') == 'station' and name:
            stations.append([name, str(tg.get('name:en') or ''), round(lon, 5), round(lat, 5), str(tg.get('station') or 'train'), str(tg.get('network') or tg.get('operator') or '')])
        if _in(lon, lat, IN) and ((name and rx.search(name)) or ('height' in tg and 'building' in tg)):
            cands.append({'type': 'node' if o.is_node() else 'way', 'tags': tg, 'lon': lon, 'lat': lat})
    print('กรุงเทพ รอบ 2: เขต %d · สถานี %d · สถานที่ที่เข้าข่าย %d · %.0f วินาที' % (len(dists), len(stations), len(cands), time.time() - t0), flush=True)

    # เขต
    kx = math.cos(math.radians(13.75)) * 111.32 * 110.57
    D = []
    for oid, tg, g, c in dists:
        s = g.simplify(0.00018, preserve_topology=True)
        polys = list(s.geoms) if s.geom_type == 'MultiPolygon' else [s]
        D.append({'id': oid, 'th': tg['name'][3:].strip(), 'en': re.sub(r'\s*District$', '', str(tg.get('name:en') or '')).strip(), 'km2': round(g.area * kx, 1),
                  'c': [round(c.x, 4), round(c.y, 4)], 'g': [[_q(p.exterior.coords)] + [_q(h.coords) for h in p.interiors] for p in polys if not p.is_empty]})
    D.sort(key=lambda d: d['th'])
    # เส้นรถไฟฟ้า (รวมสองทิศทางเป็นเส้นเดียว)
    lines = {}
    for rid, (tg, ways) in routes.items():
        kind = tg.get('route')
        col = str(tg.get('colour') or '').strip()
        if not re.match(r'^#[0-9A-Fa-f]{3,8}$', col):
            col = LF.LINE_COL.get(kind, '#9CA3AF')
        name = re.split(r'\s*[:：]\s*', str(tg.get('name') or ''))[0].strip()
        en = re.split(r'\s*[:：]\s*', str(tg.get('name:en') or ''))[0].strip()
        L = lines.setdefault((col.upper(), str(tg.get('ref') or name or en)), {'k': kind, 'th': name, 'en': en, 'ref': str(tg.get('ref') or ''),
                                                                               'net': str(tg.get('network') or ''), 'col': col, 'ways': {}})
        for w in ways:
            cs = way_coords.get(w)
            if cs and len(cs) >= 2 and any(_in(x, y, BOX) for x, y in cs):
                L['ways'][w] = [p for p in cs]
    out_lines = []
    for L in lines.values():
        if not L['ways']:
            continue
        km = 0.0
        geom = []
        for cs in L['ways'].values():
            for i in range(len(cs) - 1):
                km += LF._km(cs[i][0], cs[i][1], cs[i + 1][0], cs[i + 1][1])
            geom.append(LF._q5(LF._dp([list(p) for p in cs], 0.00005)))
        out_lines.append({'k': L['k'], 'th': L['th'], 'en': L['en'], 'ref': L['ref'], 'net': L['net'], 'col': L['col'], 'km': round(km, 1), 'g': geom})
    out_lines.sort(key=lambda d: (d['k'], d['net'], d['th']))
    # สถานี (ตัดซ้ำ)
    seen, st = set(), []
    for s in stations:
        key = (s[0], round(s[2], 3), round(s[3], 3))
        if key not in seen:
            seen.add(key)
            st.append(s)
    # สถานที่: ใช้ตัวเลือกเดียวกับงานข้อมูลสด
    els = [{'type': c['type'], 'tags': c['tags'], 'center': {'lon': c['lon'], 'lat': c['lat']}} for c in cands]
    marks = LF.base_marks_from(els)
    doc = {'v': 1, 't': LF.now_iso(), 'from': 'geofabrik', 'src': '© OpenStreetMap contributors (ODbL) · กรุงเทพมหานคร (data.bangkok.go.th)',
           'districts': D, 'lines': out_lines, 'stations': st, 'marks': marks, 'infra': {}}
    if infra:
        try:
            doc['infra'] = LF.base_infra()
        except Exception as e:  # noqa: BLE001  ข้อมูล กทม. เป็นของเสริม
            print('กรุงเทพ: ดึงข้อมูลสถานีสูบน้ำ/ประตูระบายน้ำไม่ได้ (%s)' % str(e)[:120], flush=True)
    p = os.path.join(out_dir, 'bkk_base.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('กรุงเทพ: เขต %d · รถไฟฟ้า %d สาย · สถานี %d · สถานที่ %d · %.1f MB · %.0f วินาที' % (len(D), len(out_lines), len(st), len(marks), os.path.getsize(p) / 1e6, time.time() - t0), flush=True)
    if len(D) < 40:
        print('กรุงเทพ: เตือน ได้เขตไม่ครบ (%d)' % len(D), flush=True)
    return doc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--no-infra', action='store_true')
    a = ap.parse_args()
    build(a.pbf, a.out, infra=not a.no_infra)


if __name__ == '__main__':
    main()
