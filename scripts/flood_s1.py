#!/usr/bin/env python3
"""ตรวจน้ำจากดาวเทียม Sentinel-1 ทั้งประเทศไทย (ขั้นตอนเดียวกับโน้ตบุ๊ก notebooks/flood_s1.ipynb)

แบ่งประเทศเป็นกรอบละ 1 องศา (ราว 110×110 กม.) 76 กรอบ แต่ละรอบตรวจเฉพาะกรอบที่มีภาพใหม่

ใช้ (GitHub Actions เรียกตามลำดับนี้ ดู .github/workflows/flood.yml):
  python3 scripts/flood_s1.py --grid-check --data DIR --todo FILE [--tiles t100_13,...] [--force]
        เช็กว่ากรอบไหนมีภาพใหม่กว่าผลใน DIR/index.json แล้วเขียนรายการลง FILE
        (ใช้แค่ pystac-client, planetary-computer และ shapely)
  python3 scripts/flood_s1.py --grid-run --todo FILE --out DIR [--budget 300]
        วิเคราะห์ทีละกรอบตามรายการ เขียน DIR/tiles/<กรอบ>.geojson หยุดเริ่มกรอบใหม่เมื่อใช้เวลาเกิน budget นาที
  จากนั้น scripts/add_flood.py --grid DIR/tiles --dest <โฟลเดอร์ branch flood-data> รวมผลและสร้าง index.json

วิเคราะห์พื้นที่เดียวแบบโน้ตบุ๊ก (ไว้ลองเอง):
  python3 scripts/flood_s1.py --areas ccs --out /tmp/flood     (ชื่อพื้นที่อยู่ใน scripts/flood_areas.json)

ข้อมูลเปิดจาก Microsoft Planetary Computer ไม่ต้องมีบัญชีหรือ API key
"""
import argparse
import json
import math
import os
import re
import sys
import tempfile
import time
import traceback
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(HERE, 'flood_areas.json')
TH_JS = os.path.join(ROOT, 'data', 'th-regions.js')
LIVE = os.path.join(ROOT, 'data', 'live.json')
STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
DAYS_BACK, RES, MAX_DAYS, BASELINE_YEARS = 24, 30, 4, 3
GRID = 1.0
TH_BBOX = (97.0, 5.0, 106.0, 21.0)
ID_RE = re.compile(r'^[a-z0-9-]{1,24}$')
TILE_RE = re.compile(r'^t(\d{2,3})_(\d{1,2})$')


def log(*a):
    print(*a, flush=True)


# ---------- ขอบเขตประเทศไทยและกรอบ ----------
_TH = {}


def th_data():
    if 'th' not in _TH:
        with open(TH_JS, encoding='utf-8') as fh:
            m = re.search(r'window\.CG_TH\s*=\s*(\{.*\})\s*;?\s*$', fh.read(), re.S)
        _TH['th'] = json.loads(m.group(1))
    return _TH['th']


def th_land():
    """แผ่นดินไทย (รวม 6 ภาค) เป็นรูปหลายเหลี่ยมพิกัดองศา"""
    if 'land' not in _TH:
        from shapely.geometry import shape
        from shapely.ops import unary_union
        _TH['land'] = unary_union([shape(f['geometry']) for f in th_data()['regions']['features']])
    return _TH['land']


def tile_id(x, y):
    return 't%d_%d' % (x, y)


def tile_bbox(tid):
    m = TILE_RE.match(tid)
    if not m:
        raise ValueError('ชื่อกรอบไม่ถูกต้อง: %s' % tid)
    x, y = int(m.group(1)), int(m.group(2))
    return (float(x), float(y), x + GRID, y + GRID)


def grid_tiles():
    """กรอบ 1 องศาทุกกรอบที่ทับแผ่นดินไทย: {id: (bbox ทั้งกรอบ, bbox ที่ตัดเหลือเฉพาะส่วนที่ทับแผ่นดิน)}"""
    from shapely.geometry import box
    land = th_land()
    out = {}
    for x in range(int(math.floor(land.bounds[0])), int(math.ceil(land.bounds[2]))):
        for y in range(int(math.floor(land.bounds[1])), int(math.ceil(land.bounds[3]))):
            b = box(x, y, x + GRID, y + GRID)
            inter = b.intersection(land)
            if inter.is_empty or inter.area <= 0:
                continue
            ib = inter.bounds
            # วิเคราะห์เฉพาะส่วนที่ทับแผ่นดิน (เผื่อขอบ 0.02°) ประหยัดเวลาในกรอบริมทะเล/ชายแดน
            aoi = (max(x, ib[0] - 0.02), max(y, ib[1] - 0.02), min(x + GRID, ib[2] + 0.02), min(y + GRID, ib[3] + 0.02))
            out[tile_id(x, y)] = ((float(x), float(y), x + GRID, y + GRID), tuple(round(v, 4) for v in aoi))
    return out


def tile_name(bbox):
    """ชื่อกรอบจากจังหวัดที่อยู่ในกรอบ (ใกล้กลางกรอบก่อน) เช่น 'ฉะเชิงเทรา · ปราจีนบุรี · นครนายก'"""
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    cand = []
    for f in th_data()['provinces']['features']:
        p = f['properties']
        if p['cx'] + p['hw'] < bbox[0] or p['cx'] - p['hw'] > bbox[2] or p['cy'] + p['hh'] < bbox[1] or p['cy'] - p['hh'] > bbox[3]:
            continue
        inside = bbox[0] <= p['lon'] <= bbox[2] and bbox[1] <= p['lat'] <= bbox[3]
        cand.append((0 if inside else 1, math.hypot(p['lon'] - cx, p['lat'] - cy), p['name']))
    cand.sort()
    return ' · '.join(c[2] for c in cand[:3]) or tile_id(int(bbox[0]), int(bbox[1]))


# ---------- ภาพดาวเทียม ----------
def client():
    import planetary_computer
    import pystac_client
    return pystac_client.Client.open(STAC, modifier=planetary_computer.sign_inplace)


def scene_days(cl, aoi, end, days_back=DAYS_BACK):
    """ภาพ Sentinel-1 RTC ในช่วงที่กำหนด จัดกลุ่มตามวัน (UTC) เรียงใหม่ไปเก่า"""
    start = end - timedelta(days=days_back)
    search = cl.search(collections=['sentinel-1-rtc'], bbox=list(aoi),
                       datetime=start.strftime('%Y-%m-%d') + '/' + end.strftime('%Y-%m-%d'))
    by_day = {}
    for it in search.items():
        by_day.setdefault(it.datetime.strftime('%Y-%m-%d'), []).append(it)
    return sorted(by_day.items(), key=lambda x: x[0], reverse=True)


def newest_by_tile(cl, tiles, end, days_back=DAYS_BACK):
    """ค้นภาพทั้งประเทศครั้งเดียว แล้วหาวันที่ล่าสุดและจำนวนแผ่นภาพของวันนั้นในแต่ละกรอบ"""
    from shapely.geometry import box, shape
    start = end - timedelta(days=days_back)
    search = cl.search(collections=['sentinel-1-rtc'], bbox=list(TH_BBOX),
                       datetime=start.strftime('%Y-%m-%d') + '/' + end.strftime('%Y-%m-%d'))
    items = [(it.datetime.strftime('%Y-%m-%d'), shape(it.geometry)) for it in search.items()]
    out = {}
    for tid, (_, aoi) in tiles.items():
        b = box(*aoi)
        days = {}
        for d, g in items:
            if g.intersects(b):
                days[d] = days.get(d, 0) + 1
        if days:
            d = max(days)
            out[tid] = (d, days[d])
    return out, len(items)


def overflow_tiles(tiles):
    """กรอบที่มีสถานี ThaiWater ล้นตลิ่ง (จาก data/live.json) จะได้วิเคราะห์ก่อน"""
    try:
        with open(LIVE, encoding='utf-8') as fh:
            water = json.load(fh).get('water') or []
    except (OSError, ValueError):
        return {}
    cnt = {}
    for w in water:
        if w.get('lv') != 5:
            continue
        for tid, (bb, _) in tiles.items():
            if bb[0] <= w['lon'] < bb[2] and bb[1] <= w['lat'] < bb[3]:
                cnt[tid] = cnt.get(tid, 0) + 1
    return cnt


def read_index(data_dir):
    try:
        with open(os.path.join(data_dir, 'index.json'), encoding='utf-8') as fh:
            return {t['id']: t for t in (json.load(fh).get('tiles') or [])}
    except (OSError, ValueError):
        return {}


def grid_check(cl, data_dir, only=None, force=False, now=None):
    """รายการกรอบที่ต้องวิเคราะห์ เรียงตาม: มีสถานีล้นตลิ่ง → ยังไม่เคยตรวจ → ภาพใหม่สุด"""
    tiles = grid_tiles()
    if only:
        bad = [t for t in only if t not in tiles]
        if bad:
            raise SystemExit('ไม่มีกรอบนี้ในประเทศไทย: %s' % ', '.join(bad))
        tiles = {t: tiles[t] for t in only}
    newest, n_items = newest_by_tile(cl, tiles, now or datetime.now(timezone.utc))
    done = read_index(data_dir)
    over = overflow_tiles(tiles)
    todo = []
    for tid in tiles:
        if tid not in newest:
            continue
        d, n = newest[tid]
        cur = done.get(tid)
        why = None
        if force:
            why = 'สั่งให้รันใหม่'
        elif not cur:
            why = 'ยังไม่เคยตรวจ'
        elif d > cur.get('date', ''):
            why = 'ภาพใหม่ %s (เดิม %s)' % (d, cur.get('date'))
        elif d == cur.get('date') and n > (cur.get('scenes') or {}).get(d, 0):
            why = 'ภาพวันที่ %s เพิ่มเป็น %d แผ่น' % (d, n)
        if why:
            todo.append((0 if over.get(tid) else 1, 0 if not cur else 1, d, tid, why, over.get(tid, 0)))
    todo.sort(key=lambda x: (x[0], -x[5], x[1], -int(x[2].replace('-', '')), x[3]))
    log('ภาพทั้งประเทศ %d แผ่น · กรอบทั้งหมด %d · ตรวจแล้ว %d · ต้องรัน %d' % (n_items, len(tiles), len(done), len(todo)))
    for _, _, d, tid, why, ov in todo:
        log('  %s %s%s' % (tid, why, ' · สถานีล้นตลิ่ง %d' % ov if ov else ''))
    return [t[3] for t in todo]


# ---------- วิเคราะห์หนึ่งพื้นที่ ----------
def land_mask(geobox_affine, shape_hw, crs):
    """พิกเซลที่อยู่บนแผ่นดินไทย (ตัดทะเลและประเทศเพื่อนบ้านออก)"""
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from shapely.ops import transform as shp_transform
    tr = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform
    g = shp_transform(tr, th_land())
    return geometry_mask([g.__geo_interface__], out_shape=shape_hw, transform=geobox_affine, invert=True)


def analyze(cl, area_id, name, aoi, out_path, now=None, clip_land=False):
    """วิเคราะห์หนึ่งพื้นที่ แล้วเขียน GeoJSON รูปแบบเดียวกับโน้ตบุ๊ก v3"""
    import numpy as np
    import odc.stac
    sys.path.insert(0, HERE)
    import flood_core as fc

    t0 = time.time()
    aoi = tuple(float(v) for v in aoi)
    crs = fc.utm_crs(aoi)
    end = now or datetime.now(timezone.utc)
    start = end - timedelta(days=DAYS_BACK)

    def load_db(its, like=None):
        if like is None:
            ds = odc.stac.load(its, bands=['vv'], crs=crs, resolution=RES, bbox=aoi, groupby='solar_day')
        else:
            ds = odc.stac.load(its, bands=['vv'], like=like, groupby='solar_day')
        vv = ds['vv'].max('time').values if ds.sizes.get('time', 1) > 1 else ds['vv'].isel(time=0).values
        return fc.speckle_filter(fc.to_db(vv)), (like if like is not None else ds)

    days = fc.scenes_by_day(cl, aoi, start, end)
    db, ds, used, cover, src = fc.mosaic_latest(days, load_db, MAX_DAYS)
    scenes = {d: len(its) for d, its in days if d in used}
    thr = fc.otsu_threshold(db)
    log('  ภาพ %s · มีข้อมูล %.0f%% · ขนาด %s · เส้นแบ่งน้ำ %.1f dB' % (' / '.join(used), cover * 100, db.shape, thr))

    def load_like(collection, band, valid):
        try:
            its = list(cl.search(collections=[collection], bbox=list(aoi)).items())
            if not its:
                return None
            da = odc.stac.load(its, bands=[band], like=ds)[band].astype('float32')
            return da.where(valid(da)).max('time').values
        except Exception as e:  # noqa: BLE001 โหลดไม่ได้ก็ข้ามขั้นนี้
            log('  โหลด %s ไม่ได้: %s' % (collection, e))
            return None

    occ = load_like('jrc-gsw', 'occurrence', lambda d: d <= 100)
    dem = load_like('cop-dem-glo-30', 'data', lambda d: d > -1000)
    slope = fc.slope_degrees(dem, RES) if dem is not None else None
    del dem

    masks, valids, base_used = [], [], []
    for y in range(1, BASELINE_YEARS + 1):
        try:
            past = fc.scenes_by_day(cl, aoi, start - timedelta(days=365 * y), end - timedelta(days=365 * y))
            dbp, _, used_p, cov_p, _ = fc.mosaic_latest(past, lambda its, like: load_db(its, ds), MAX_DAYS)
            masks.append(fc.water_mask(dbp, thr))
            valids.append(np.isfinite(dbp))
            base_used.append(used_p[0])
            log('  ย้อนหลัง %d ปี: %s · มีข้อมูล %.0f%%' % (y, used_p[0], cov_p * 100))
            del dbp
        except Exception as e:  # noqa: BLE001
            log('  ย้อนหลัง %d ปี: โหลดไม่ได้ ข้าม (%s)' % (y, e))
    usual = fc.usual_water(masks, valids)

    L = fc.classify(db, thr, occ, slope, usual)
    flood, seasonal = L['flood'], L['seasonal']
    if clip_land:
        land = land_mask(ds.odc.geobox.affine, db.shape, crs)
        flood, seasonal = flood & land, seasonal & land
    gj = fc.vectorize_layers({'flood': flood, 'seasonal': seasonal}, ds.odc.geobox.affine, crs, RES, src=src, dates=used)
    tot = fc.totals(gj)
    gj['properties'] = {
        'v': 3, 'id': area_id, 'name': name, 'aoi': list(aoi), 'date': used[0], 'dates': used,
        'scenes': scenes, 'baseline_years': len(masks), 'baseline_dates': base_used,
        'threshold_db': round(float(thr), 1), 'totals': tot, 'auto': True,
        'source': 'Sentinel-1 RTC (Copernicus/ESA) via Microsoft Planetary Computer; JRC Global Surface Water; Copernicus DEM',
        'method': 'ChatGeo v3: Otsu threshold on VV dB; minus JRC permanent water and slope > 5 deg; '
                  'unusual = water not present in most of the previous %d years (same season)' % len(masks)}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(gj, fh, ensure_ascii=False, separators=(',', ':'))
    log('  น่าจะท่วม %.1f · ไม่แน่ใจ %.1f · มีน้ำเกือบทุกปี %.1f ตร.กม. · %d ปื้น · %.0f วินาที' % (
        tot['flood_high'], tot['flood_low'], tot['seasonal'], len(gj['features']), time.time() - t0))
    return out_path


def grid_run(cl, todo, out_dir, budget_min=300.0, now=None):
    """วิเคราะห์ทีละกรอบจนกว่าจะหมดรายการหรือหมดเวลา คืนรายการ error"""
    tiles = grid_tiles()
    t0, errors, done = time.time(), [], 0
    for i, tid in enumerate(todo):
        used = (time.time() - t0) / 60
        if used > budget_min:
            log('ใช้เวลาไป %.0f นาที เกินงบ %.0f นาที หยุดไว้ก่อน เหลือ %d กรอบไว้รอบหน้า' % (used, budget_min, len(todo) - i))
            break
        bb, aoi = tiles[tid]
        name = tile_name(bb)
        log('[%d/%d] %s · %s · %.0f นาที' % (i + 1, len(todo), tid, name, used))
        try:
            analyze(cl, tid, name, aoi, os.path.join(out_dir, 'tiles', tid + '.geojson'), now=now, clip_land=True)
            done += 1
        except Exception as e:  # noqa: BLE001 กรอบหนึ่งพังไม่ให้กรอบอื่นพังตาม
            traceback.print_exc()
            errors.append('%s: %s' % (tid, e))
    log('เสร็จ %d กรอบ · พัง %d · ใช้เวลา %.0f นาที' % (done, len(errors), (time.time() - t0) / 60))
    return errors


# ---------- โหมดพื้นที่เดียว (ตามรายการใน flood_areas.json) ----------
def load_cfg():
    with open(CFG, encoding='utf-8') as fh:
        cfg = json.load(fh)
    for k, a in cfg['areas'].items():
        if not ID_RE.match(k) or len(a.get('aoi') or []) != 4:
            raise SystemExit('flood_areas.json: พื้นที่ %s ไม่ถูกต้อง' % k)
    return cfg


def write_output(key, value):
    """ส่งค่าให้ขั้นถัดไปของ GitHub Actions"""
    p = os.environ.get('GITHUB_OUTPUT')
    if p:
        with open(p, 'a', encoding='utf-8') as fh:
            fh.write('%s=%s\n' % (key, value))


def write_errors(out_dir, errors):
    if errors:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, 'errors.txt'), 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(errors) + '\n')
        log('มีส่วนที่วิเคราะห์ไม่สำเร็จ:', '; '.join(errors))


def main(argv):
    ap = argparse.ArgumentParser(description='ตรวจน้ำจากดาวเทียม Sentinel-1')
    ap.add_argument('--grid-check', action='store_true', help='เช็กว่ากรอบไหนมีภาพใหม่')
    ap.add_argument('--grid-run', action='store_true', help='วิเคราะห์กรอบตามรายการ --todo')
    ap.add_argument('--data', default='', help='โฟลเดอร์ผลเดิม (branch flood-data) ที่มี index.json')
    ap.add_argument('--todo', default='', help='ไฟล์รายการกรอบที่ต้องรัน')
    ap.add_argument('--tiles', default='', help='จำกัดเฉพาะกรอบเหล่านี้ คั่นด้วยจุลภาค เช่น t100_13,t101_13')
    ap.add_argument('--budget', type=float, default=300.0, help='เวลาสูงสุด (นาที) ที่จะเริ่มกรอบใหม่')
    ap.add_argument('--areas', default='', help='วิเคราะห์พื้นที่จาก flood_areas.json คั่นด้วยจุลภาค')
    ap.add_argument('--force', action='store_true', help='รันใหม่แม้ไม่มีภาพใหม่')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'chatgeo-flood'), help='โฟลเดอร์ผลลัพธ์')
    a = ap.parse_args(argv)
    cl = client()

    if a.grid_check:
        only = [x.strip() for x in a.tiles.split(',') if x.strip()] or None
        todo = grid_check(cl, a.data, only, a.force)
        if a.todo:
            os.makedirs(os.path.dirname(os.path.abspath(a.todo)), exist_ok=True)
            with open(a.todo, 'w', encoding='utf-8') as fh:
                fh.write('\n'.join(todo) + ('\n' if todo else ''))
        if a.data:
            # รายชื่อกรอบทั้งหมด ไว้ให้หน้าเว็บรู้ว่าตรวจไปแล้วกี่กรอบจากทั้งหมด
            os.makedirs(a.data, exist_ok=True)
            grid = [{'id': k, 'bbox': list(bb), 'aoi': list(aoi), 'name': tile_name(bb)} for k, (bb, aoi) in sorted(grid_tiles().items())]
            with open(os.path.join(a.data, 'grid.json'), 'w', encoding='utf-8') as fh:
                json.dump({'grid': GRID, 'tiles': grid}, fh, ensure_ascii=False, separators=(',', ':'))
        write_output('count', str(len(todo)))
        return 0

    if a.grid_run:
        with open(a.todo, encoding='utf-8') as fh:
            todo = [x.strip() for x in fh if x.strip()]
        write_errors(a.out, grid_run(cl, todo, a.out, a.budget))
        return 0

    if a.areas:
        cfg = load_cfg()
        errors = []
        for k in [x.strip() for x in a.areas.split(',') if x.strip()]:
            if k not in cfg['areas']:
                raise SystemExit('ไม่รู้จักพื้นที่: %s (มีใน flood_areas.json: %s)' % (k, ', '.join(cfg['areas'])))
            ar = cfg['areas'][k]
            log('%s · %s' % (k, ar['name']))
            try:
                analyze(cl, k, ar['name'], ar['aoi'], os.path.join(a.out, 'flood_s1_%s.geojson' % k))
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                errors.append('%s: %s' % (k, e))
        write_errors(a.out, errors)
        return 0

    ap.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
