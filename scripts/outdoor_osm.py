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

เติมรูปตัวอย่าง (ชื่อไฟล์ Wikimedia Commons) จากแท็ก OSM, วิกิสนเทศ P18 และรูปที่ถ่ายใกล้จุด (--no-photos เพื่อข้าม)

เขียน
  OUT/outdoor.json    จุดทั้งหมด (ไฟล์เล็ก หน้าเว็บโหลดเมื่อเปิดชั้นข้อมูล)
  OUT/trails.geojson  เส้นทาง (หน้าเว็บโหลดเมื่อซูมเข้า)
  OUT/bkk_base.json   โครงเมืองกรุงเทพสำหรับหน้า "กรุงเทพตอนนี้" (scripts/bkk_osm.py)

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
KEEP_TAGS = ('website', 'url', 'contact:website', 'opening_hours', 'fee', 'access', 'operator', 'wikidata', 'wikipedia', 'description', 'phone', 'wikimedia_commons', 'image')
UA = 'ChatGeo-outdoor/1.0 (+https://choonahakarn.github.io/chatgeo/; https://github.com/Choonahakarn/chatgeo)'
WM = 'https://commons.wikimedia.org/w/api.php?format=json&'
IMG_EXT = re.compile(r'\.(jpe?g|png|webp)$', re.I)
# ตัดรูปที่ไม่ใช่ภาพสถานที่: ชื่อวิทยาศาสตร์ของสัตว์/พืช (Aethopyga nipalensis ...), ภาพจากอวกาศ, แผนที่ โลโก้
BINOMIAL = re.compile(r'^File:(?!(Doi|Phu|Khao|Nam|Namtok|Wat|Pha|Huai|Mae|Ban|Ko|Koh|Tham|Kew|Kio|Mon|Pang|Sop|Chiang|Phra|Lan|Ang|Kaeng|Thung|Laem|Hat|Ao|View|Summit|Sunset|Sunrise|Mount|Mountain|Lake|The|Top|Forest|Waterfall|Camp|Road|Trail|River|Cave|Temple|Nature|Scenic|Morning|Evening|Sea|Fog|Mist|Cloud|Clouds)\b)[A-Z][a-z]+ (?!(view|views|from|and|the|trail|falls?|waterfall|park|forest|top|peak|summit|camp|area|road|point|national|mountains?|river|lake|cave|temple|sunset|sunrise|landscape|scenery|sea|fog|mist|clouds?)\b)[a-z]{3,}( [a-z]+)?\b')
BINOMIAL2 = re.compile(r'^File:[A-Z][a-z]{4,}-[a-z]{4,}-')
NOT_PLACE = re.compile(r'^File:ISS\d|from space|of earth|astronaut|satellite image|sentinel-?2|landsat|\bmap\b|logo|flag|seal|diagram|chart|locator', re.I)
SCENE = re.compile(r'view|vista|sunset|sunrise|summit|peak|mountain|doi|phu|khao|falls?|waterfall|nam ?tok|national park|trail|camp|lake|cliff|forest|valley|ดอย|ภู|เขา|น้ำตก|อุทยาน|ผา|จุดชมวิว', re.I)
ROMAN = {'khao', 'doi', 'phu', 'haad', 'hat', 'tham', 'wang', 'huai', 'mae', 'nong', 'ban', 'koh', 'ko', 'pak', 'nam', 'pha', 'wat'}
SHORTNAME = {'namtok', 'thung', 'kaeng', 'chiang', 'phang', 'nakhon', 'ratchasima', 'province', 'district', 'daeng', 'yai', 'noi', 'luang', 'thong'}
GENERIC = re.compile(r'^(the|of|and|to|thailand|chiang|province|district|village|temple|river|road|waterfalls?|national|park|forest|nature|trail|view(point)?|point|mountain|peak|summit|camp(ing|site)?|ground|wildlife|sanctuary|reserve|island)$', re.I)
TH_PREFIX = re.compile(r'^(อุทยานแห่งชาติ|วนอุทยาน|น้ำตก|จุดชมวิว|ลานกางเต็นท์|เส้นทางศึกษาธรรมชาติ|เส้นทางเดินป่า)')


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


def wm_json(url, tries=3):
    """ขอ JSON จากวิกิมีเดียแบบสุภาพ (ใส่ User-Agent, รอเมื่อโดนจำกัด)"""
    import urllib.error
    import urllib.request
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) or e.code >= 500:
                time.sleep(5 * (i + 1))
                continue
            return None
        except Exception:  # noqa: BLE001
            time.sleep(3 * (i + 1))
    return None


def file_name(v):
    """ชื่อไฟล์ Commons จากแท็ก wikimedia_commons / image ของ OSM (ไม่รับรูปจากเว็บอื่น เพราะไม่รู้สัญญาอนุญาต)"""
    from urllib.parse import unquote
    v = (v or '').strip()
    m = re.search(r'(?:commons\.wikimedia\.org/wiki/|^)File:([^?#|;]+)', v)
    if m:
        return unquote(m.group(1)).replace('_', ' ').strip()
    m = re.search(r'upload\.wikimedia\.org/wikipedia/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?#]+)', v)
    if m:
        return unquote(m.group(1)).replace('_', ' ').strip()
    return None


def norm(t):
    return re.sub(r'\s+', ' ', re.sub(r'[-_.,()]+', ' ', re.sub(r'^file:', '', str(t or '').lower()))).strip()


def pick_near(rec, titles):
    """เลือกรูปที่ถ่ายใกล้จุด: ชื่อไฟล์ตรงกับชื่อสถานที่ก่อน (named) แล้วค่อยรูปทิวทัศน์ (near) แบบเดียวกับหน้าเว็บ"""
    titles = [t for t in titles if IMG_EXT.search(t) and not BINOMIAL.search(t) and not BINOMIAL2.search(t) and not NOT_PLACE.search(t)]
    phrases, words = [], []
    for nm in [rec.get('en')] + ([rec['n']] if re.search(r'[A-Za-z]', rec.get('n') or '') else []):
        if not nm:
            continue
        ws = [w for w in norm(nm).split(' ') if w and not GENERIC.match(w)]
        if len(ws) >= 2 and len(' '.join(ws)) >= 6:
            phrases.append(' '.join(ws))
        words += [w for w in ws if len(w) >= 5 and w not in SHORTNAME and w not in ROMAN]
    th = TH_PREFIX.sub('', rec.get('n') or '').strip()
    if re.search(r'[\u0E00-\u0E7F]', th) and len(th) >= 3:
        phrases.append(th)
    for t in titles:
        n = norm(t)
        if any(x in n for x in phrases) or any((' ' + x) in (' ' + n + ' ') for x in words):
            return t, False
    for t in titles:
        if SCENE.search(t):
            return t, True
    return None, False


def add_photos(items, budget=1500):
    """เติมรูปตัวอย่างให้แต่ละจุด (เก็บแค่ชื่อไฟล์ Commons หน้าเว็บโหลดรูปจากวิกิมีเดียเอง)
    1) แท็ก wikimedia_commons / image ใน OSM  2) รูปหลัก P18 ในวิกิสนเทศ  3) รูปที่ถ่ายใกล้จุดบน Commons
    img = ชื่อไฟล์ · imgn = 1 ถ้าเป็นรูปบริเวณใกล้เคียง (ไม่ได้ระบุชื่อสถานที่) · cat = หมวดรูปจาก OSM"""
    t0, n_tag, n_wd, n_geo, calls = time.time(), 0, 0, 0, 0
    for r in items:
        x = r.get('x') or {}
        wc, im = x.pop('wikimedia_commons', None), x.pop('image', None)
        if not x and 'x' in r:
            del r['x']
        if wc and wc.startswith('Category:'):
            r['cat'] = wc[9:].strip()[:120]
        f = file_name(wc) or file_name(im)
        if f and IMG_EXT.search(f):
            r['img'] = f
            n_tag += 1
    qs = sorted({(r.get('x') or {}).get('wikidata') for r in items if not r.get('img') and re.match(r'^Q\d+$', (r.get('x') or {}).get('wikidata') or '')})
    p18 = {}
    for i in range(0, len(qs), 50):
        j = wm_json('https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=' + '|'.join(qs[i:i + 50]))
        calls += 1
        for q, e in ((j or {}).get('entities') or {}).items():
            c = ((e.get('claims') or {}).get('P18') or [{}])[0].get('mainsnak', {}).get('datavalue', {}).get('value')
            if c:
                p18[q] = c
        time.sleep(0.2)
    for r in items:
        q = (r.get('x') or {}).get('wikidata')
        if not r.get('img') and q in p18:
            r['img'] = p18[q]
            n_wd += 1
    # รูปใกล้จุด: เรียงจุดสำคัญก่อน เผื่อหมดเวลา
    pri = {'park': 0, 'peak': 1, 'fall': 2, 'view': 3, 'trail': 4, 'camp': 5}
    todo = sorted([r for r in items if not r.get('img') and r['k'] in pri and (r.get('n') or r.get('en'))],
                  key=lambda r: (pri[r['k']], -(r.get('ele') or 0), -(r.get('km2') or 0)))
    left = 0
    for idx, r in enumerate(todo):
        if time.time() - t0 > budget:
            left = len(todo) - idx
            break
        rad = 4000 if r['k'] == 'park' else 2000 if r['k'] == 'trail' else 1200
        j = wm_json(WM + 'action=query&list=geosearch&gsnamespace=6&gslimit=25&gsradius=%d&gscoord=%s|%s' % (rad, r['lat'], r['lon']))
        calls += 1
        hits = [g.get('title') or '' for g in ((j or {}).get('query') or {}).get('geosearch') or []]
        t, near = pick_near(r, hits)
        if t:
            r['img'] = t[5:] if t.startswith('File:') else t
            if near:
                r['imgn'] = 1
            n_geo += 1
        time.sleep(0.1)
    print('รูปตัวอย่าง: แท็ก OSM %d · วิกิสนเทศ %d · ถ่ายใกล้จุด %d · รวม %d จาก %d จุด · เรียก API %d ครั้ง · %.0f วินาที%s' % (
        n_tag, n_wd, n_geo, n_tag + n_wd + n_geo, len(items), calls, time.time() - t0, (' · หมดเวลา เหลือ %d จุดไว้รอบหน้า' % left) if left else ''), flush=True)


def run(pbf, th_path, out_dir, bbox=None, photos=True, photo_budget=1500):
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

    if photos:
        try:
            add_photos(out, photo_budget)
        except Exception as e:  # noqa: BLE001  รูปเป็นของเสริม พังก็ยังเขียนข้อมูลหลักได้
            print('เติมรูปไม่สำเร็จ: %s' % e, flush=True)
    else:
        for r in out:
            for k in ('wikimedia_commons', 'image'):
                (r.get('x') or {}).pop(k, None)
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
    ap.add_argument('--no-photos', action='store_true', help='ไม่ต้องเติมรูปตัวอย่างจากวิกิมีเดีย')
    ap.add_argument('--photo-budget', type=int, default=1500, help='เวลาสูงสุด (วินาที) สำหรับหารูปใกล้จุด')
    a = ap.parse_args()
    if not os.path.exists(a.pbf):
        sys.exit('ไม่พบไฟล์ ' + a.pbf)
    run(a.pbf, a.th, a.out, bbox=(97.0, 5.3, 106.0, 20.7), photos=not a.no_photos, photo_budget=a.photo_budget)
    # โครงเมืองกรุงเทพ (เขต รถไฟฟ้า สถานี สถานที่) สำหรับหน้า "กรุงเทพตอนนี้" ใช้ไฟล์ OSM เดียวกัน พังก็ไม่กระทบข้อมูลเดินป่า
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import bkk_osm
        bkk_osm.build(a.pbf, a.out)
    except Exception as e:  # noqa: BLE001
        print('โครงเมืองกรุงเทพไม่สำเร็จ: %s' % e, flush=True)


if __name__ == '__main__':
    main()
