#!/usr/bin/env python3
"""เดินป่าและธรรมชาติ: ดึงจุดจาก OpenStreetMap ของไทย สำหรับชั้นข้อมูล "เดินป่า" ของ ChatGeo

อ่านไฟล์ OSM ของประเทศไทย (thailand-latest.osm.pbf จาก Geofabrik) แล้วเก็บ
  park   อุทยานแห่งชาติ วนอุทยาน เขตรักษาพันธุ์สัตว์ป่า (จุดกลางพื้นที่ + ขนาด)
  peak   ยอดเขาที่มีชื่อ (+ ความสูงถ้ามี)
  camp   จุดกางเต็นท์ / ลานกางเต็นท์
  fall   น้ำตกที่มีชื่อ
  view   จุดชมวิวที่มีชื่อ
  head   จุดเริ่มเส้นทางเดินป่า
  trail  เส้นทางเดินป่า (route=hiking/foot และทางเดินที่ชื่อเป็นเส้นทางศึกษาธรรมชาติ/เดินป่า)
ระบุจังหวัดจาก data/th-regions.js · ตัดจุดนอกประเทศไทยทิ้ง

เขียน
  OUT/outdoor.json    จุดทั้งหมด (ไฟล์เล็ก หน้าเว็บโหลดเมื่อเปิดชั้นข้อมูล)
  OUT/trails.geojson  เส้นทาง (หน้าเว็บโหลดเมื่อซูมเข้า)

ข้อมูล © OpenStreetMap contributors (ODbL) ผลที่ได้ใช้สัญญาอนุญาต ODbL เช่นเดียวกัน

ใช้: python scripts/outdoor_osm.py --pbf thailand-latest.osm.pbf --th data/th-regions.js --out /tmp/outdoor-data
"""
import argparse
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

BKK = timezone(timedelta(hours=7))
PARK_RE = re.compile(r'อุทยาน|วนอุทยาน|เขตรักษาพันธุ์|เขตห้ามล่า|สวนพฤกษศาสตร์|National Park|Forest Park|Wildlife Sanctuary|Non-Hunting', re.I)
TRAIL_NAME_RE = re.compile(r'เส้นทางศึกษาธรรมชาติ|เส้นทางเดินป่า|เส้นทางเดินศึกษา|nature trail|hiking trail|trail', re.I)
KEEP_TAGS = ('website', 'url', 'contact:website', 'opening_hours', 'fee', 'access', 'operator', 'wikidata', 'wikipedia', 'description', 'phone')


def num(s):
    """'1,234 m' → 1234.0 · อ่านไม่ได้ → None"""
    if not s:
        return None
    m = re.search(r'-?\d+(?:[.,]\d+)?', str(s).replace(',', ''))
    try:
        v = float(m.group(0)) if m else None
    except ValueError:
        return None
    return v if v is not None and -100 < v < 9000 else None


def park_type(name, tags):
    n = name or ''
    if 'วนอุทยาน' in n or re.search(r'forest park', n, re.I):
        return 'fp'
    if 'อุทยาน' in n or tags.get('boundary') == 'national_park' or re.search(r'national park', n, re.I):
        return 'np'
    if 'เขตรักษาพันธุ์' in n or re.search(r'wildlife sanctuary', n, re.I):
        return 'ws'
    if 'เขตห้ามล่า' in n or re.search(r'non-hunting', n, re.I):
        return 'nh'
    return 'pa'


def classify(tags, kind):
    """คืนชนิดจุด หรือ None ถ้าไม่ใช่สิ่งที่สนใจ · kind = n/w/a (node/way/area)"""
    g = tags.get
    name = g('name') or g('name:th') or g('name:en')
    if kind == 'a':
        if g('boundary') in ('national_park', 'protected_area') or g('leisure') == 'nature_reserve':
            if name and PARK_RE.search(name):
                return 'park'
        if g('tourism') == 'camp_site':
            return 'camp'
        return None
    if g('natural') == 'peak' and name:
        return 'peak'
    if (g('waterway') == 'waterfall' or g('natural') == 'waterfall') and name:
        return 'fall'
    if g('tourism') == 'viewpoint' and name:
        return 'view'
    if g('tourism') == 'camp_site' and kind == 'n':
        return 'camp'
    if g('highway') == 'trailhead':
        return 'head'
    return None


class Th:
    """หาจังหวัดจากพิกัด ด้วยขอบเขตใน th-regions.js"""

    def __init__(self, path):
        from shapely.geometry import shape
        from shapely.strtree import STRtree
        from shapely.prepared import prep
        text = open(path, encoding='utf-8').read()
        m = re.search(r'window\.CG_TH\s*=\s*(\{.*\})\s*;?\s*$', text, re.S)
        th = json.loads(m.group(1))
        self.names, geoms = [], []
        for f in th['provinces']['features']:
            self.names.append(f['properties']['name'])
            geoms.append(shape(f['geometry']).buffer(0.02))  # เผื่อขอบหยาบของ Natural Earth (ชายฝั่ง เกาะ)
        self.geoms = geoms
        self.prep = [prep(gm) for gm in geoms]
        self.tree = STRtree(geoms)

    def at(self, lon, lat):
        from shapely.geometry import Point
        p = Point(lon, lat)
        for i in self.tree.query(p):
            if self.prep[int(i)].contains(p):
                return self.names[int(i)]
        return None


def km_line(coords):
    t = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        r = math.pi / 180
        a = math.sin((y2 - y1) * r / 2) ** 2 + math.cos(y1 * r) * math.cos(y2 * r) * math.sin((x2 - x1) * r / 2) ** 2
        t += 12742 * math.asin(min(1, math.sqrt(a)))
    return t


def extra_tags(tags):
    out = {}
    for k in KEEP_TAGS:
        v = tags.get(k)
        if v:
            out[k.replace('contact:', '')] = v[:200]
    return out


def run(pbf, th_path, out_dir, bbox=None):
    import osmium
    from shapely import wkb
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge
    t0 = time.time()
    th = Th(th_path)
    os.makedirs(out_dir, exist_ok=True)

    # รอบ 1: หาความสัมพันธ์ (relation) ที่เป็นเส้นทางเดินป่า และสมาชิกที่เป็นทาง (way)
    routes, need = {}, {}
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION):
        tg = {t.k: t.v for t in r.tags}
        if tg.get('type') == 'route' and tg.get('route') in ('hiking', 'foot') and (tg.get('name') or tg.get('name:en')):
            ways = [m.ref for m in r.members if m.type == 'w']
            routes[r.id] = {'name': tg.get('name') or tg.get('name:en'), 'en': tg.get('name:en'), 'ways': ways,
                            'tags': extra_tags(tg), 'sac': tg.get('sac_scale'), 'dist': num(tg.get('distance'))}
            for w in ways:
                need.setdefault(w, []).append(r.id)
    print('รอบ 1: เส้นทางเดินป่า (relation) %d เส้น · %.0f วินาที' % (len(routes), time.time() - t0), flush=True)

    # รอบ 2: อ่านทุกอย่างพร้อมพิกัด และประกอบพื้นที่ (อุทยาน ลานกางเต็นท์ที่วาดเป็นพื้นที่)
    items, way_coords, path_lines = {}, {}, []
    gf = osmium.geom.WKBFactory()
    n_obj = 0
    for o in osmium.FileProcessor(pbf).with_locations().with_areas(osmium.filter.KeyFilter('boundary', 'leisure', 'tourism')):
        n_obj += 1
        if not len(o.tags) and not (o.is_way() and o.id in need):
            continue
        tg = {t.k: t.v for t in o.tags}  # ต้องคัดลอก: วัตถุของ osmium ใช้ได้แค่ในรอบวนนี้
        if o.is_node():
            k = classify(tg, 'n')
            if not k or not o.location.valid():
                continue
            items['n%d' % o.id] = (k, tg, o.location.lon, o.location.lat, None)
        elif o.is_way():
            if o.id in need or (tg.get('highway') in ('path', 'footway', 'track') and TRAIL_NAME_RE.search(tg.get('name') or '')):
                try:
                    cs = [(n.lon, n.lat) for n in o.nodes if n.location.valid()]
                except osmium.InvalidLocationError:
                    cs = []
                if len(cs) >= 2:
                    if o.id in need:
                        way_coords[o.id] = cs
                    if o.id not in need and tg.get('name'):
                        path_lines.append({'id': 'w%d' % o.id, 'name': tg.get('name'), 'en': tg.get('name:en'), 'coords': cs,
                                           'sac': tg.get('sac_scale'), 'tags': extra_tags(tg)})
        elif o.is_area():
            k = classify(tg, 'a')
            if not k:
                continue
            try:
                g = wkb.loads(gf.create_multipolygon(o), hex=True)
            except Exception:  # noqa: BLE001 พื้นที่ที่วาดไม่สมบูรณ์
                continue
            c = g.representative_point()
            lat0 = math.radians(c.y)
            area_km2 = g.area * (111.32 ** 2) * math.cos(lat0)
            oid = ('w%d' if o.from_way() else 'r%d') % o.orig_id()
            items[oid] = (k, tg, c.x, c.y, area_km2)
    print('รอบ 2: อ่าน %d รายการ · จุดที่สนใจ %d · %.0f วินาที' % (n_obj, len(items), time.time() - t0), flush=True)

    out, counts, skipped = [], {}, 0
    for oid, (k, tg, lon, lat, area_km2) in items.items():
        if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            skipped += 1
            continue
        prov = th.at(lon, lat)
        if not prov:
            skipped += 1
            continue
        name = tg.get('name') or tg.get('name:th') or tg.get('name:en') or ''
        rec = {'id': oid, 'k': k, 'n': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'p': prov}
        en = tg.get('name:en')
        if en and en != name:
            rec['en'] = en
        if k == 'peak':
            e = num(tg.get('ele'))
            if e is not None:
                rec['ele'] = int(round(e))
        if k == 'park':
            rec['t'] = park_type(name, tg)
            rec['km2'] = round(area_km2, 1) if area_km2 else None
            if rec['km2'] is not None and rec['km2'] < 0.05:
                continue
        x = extra_tags(tg)
        if x:
            rec['x'] = x
        out.append(rec)
        counts[k] = counts.get(k, 0) + 1

    # เส้นทาง: ต่อทางของแต่ละ relation เป็นเส้นเดียว ย่อจุดให้ไฟล์เล็ก
    feats = []

    def add_line(fid, name, en, lines, sac, tags, dist):
        try:
            g = linemerge(MultiLineString([LineString(c) for c in lines if len(c) >= 2]))
        except Exception:  # noqa: BLE001
            return
        if g.is_empty:
            return
        g2 = g.simplify(0.00015, preserve_topology=False)
        parts = [list(g2.coords)] if g2.geom_type == 'LineString' else [list(p.coords) for p in g2.geoms]
        parts = [[(round(x, 5), round(y, 5)) for x, y in p] for p in parts if len(p) >= 2]
        if not parts:
            return
        allc = [c for p in parts for c in p]
        mid = allc[len(allc) // 2]
        prov = th.at(mid[0], mid[1])
        if not prov:
            return
        length = round(sum(km_line(p) for p in ([list(g.coords)] if g.geom_type == 'LineString' else [list(q.coords) for q in g.geoms])), 2)
        start = parts[0][0]
        props = {'id': fid, 'k': 'trail', 'n': name, 'p': prov, 'km': dist or length, 'lat': start[1], 'lon': start[0]}
        if en and en != name:
            props['en'] = en
        if sac:
            props['sac'] = sac
        if tags:
            props['x'] = tags
        feats.append({'type': 'Feature', 'properties': props,
                      'geometry': {'type': 'MultiLineString', 'coordinates': parts}})

    for rid, r in routes.items():
        add_line('r%d' % rid, r['name'], r['en'], [way_coords[w] for w in r['ways'] if w in way_coords], r['sac'], r['tags'], r['dist'])
    # ทางเดินชื่อเดียวกันที่อยู่ใกล้กัน รวมเป็นเส้นทางเดียว
    groups = {}
    for pl in path_lines:
        key = (pl['name'], round(pl['coords'][0][0], 1), round(pl['coords'][0][1], 1))
        groups.setdefault(key, []).append(pl)
    for (name, _, _), pls in groups.items():
        add_line(pls[0]['id'], name, pls[0]['en'], [p['coords'] for p in pls], pls[0]['sac'], pls[0]['tags'], None)
    for f in feats:
        p = f['properties']
        out.append({k: p[k] for k in ('id', 'k', 'n', 'en', 'lat', 'lon', 'p', 'km', 'sac') if k in p})
    counts['trail'] = len(feats)

    order = {'park': 0, 'peak': 1, 'trail': 2, 'fall': 3, 'view': 4, 'camp': 5, 'head': 6}
    out.sort(key=lambda r: (order.get(r['k'], 9), -(r.get('ele') or 0), -(r.get('km2') or 0), r['n']))
    stamp = datetime.now(BKK).strftime('%Y-%m-%dT%H:%M')
    doc = {'v': 1, 'updated': stamp, 'source': 'OpenStreetMap (ODbL) · Geofabrik', 'counts': counts, 'items': out}
    with open(os.path.join(out_dir, 'outdoor.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(out_dir, 'trails.geojson'), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'updated': stamp, 'features': feats}, f, ensure_ascii=False, separators=(',', ':'))
    print('เสร็จ: ' + ' · '.join('%s %d' % (k, counts.get(k, 0)) for k in order) + ' · ตัดนอกไทย %d · %.0f วินาที' % (skipped, time.time() - t0))
    for fn in ('outdoor.json', 'trails.geojson'):
        print('  %s %.1f MB' % (fn, os.path.getsize(os.path.join(out_dir, fn)) / 1e6))
    return doc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pbf', required=True, help='ไฟล์ OSM (.osm.pbf หรือ .osm)')
    ap.add_argument('--th', default='data/th-regions.js')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if not os.path.exists(a.pbf):
        sys.exit('ไม่พบไฟล์ ' + a.pbf)
    run(a.pbf, a.th, a.out, bbox=(97.0, 5.3, 106.0, 20.7))


if __name__ == '__main__':
    main()
