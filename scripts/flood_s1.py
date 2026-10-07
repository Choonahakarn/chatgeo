#!/usr/bin/env python3
"""ตรวจน้ำจากดาวเทียม Sentinel-1 แบบอัตโนมัติ (ขั้นตอนเดียวกับโน้ตบุ๊ก notebooks/flood_s1.ipynb)

ใช้:
  python3 scripts/flood_s1.py --check                 ดูว่าพื้นที่ไหนมีภาพใหม่ (ใช้แค่ pystac-client และ planetary-computer)
  python3 scripts/flood_s1.py --check --force         ถือว่าทุกพื้นที่ต้องรันใหม่
  python3 scripts/flood_s1.py --areas ccs,chi --out /tmp/flood
                                                      วิเคราะห์แล้วเขียน /tmp/flood/flood_s1_<พื้นที่>_<วันที่>.geojson

พื้นที่และรายการที่ตรวจทุกวัน (auto) อยู่ใน scripts/flood_areas.json
GitHub Actions (.github/workflows/flood.yml) เรียกใช้วันละ 2 รอบ แล้วส่งผลต่อให้ scripts/add_flood.py ลงเว็บ
ข้อมูลเปิดจาก Microsoft Planetary Computer ไม่ต้องมีบัญชีหรือ API key
"""
import argparse
import json
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
FLOOD_DIR = os.path.join(ROOT, 'data', 'flood')
TH_JS = os.path.join(ROOT, 'data', 'th-regions.js')
STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
DAYS_BACK, RES, MAX_DAYS, BASELINE_YEARS = 24, 30, 4, 3
ID_RE = re.compile(r'^[a-z0-9-]{1,24}$')


def log(*a):
    print(*a, flush=True)


def load_cfg():
    with open(CFG, encoding='utf-8') as fh:
        cfg = json.load(fh)
    for k, a in cfg['areas'].items():
        if not ID_RE.match(k) or len(a.get('aoi') or []) != 4:
            raise SystemExit('flood_areas.json: พื้นที่ %s ไม่ถูกต้อง' % k)
    return cfg


def pick(cfg, arg):
    ids = [x.strip().lower() for x in (arg or '').split(',') if x.strip()] or list(cfg.get('auto') or [])
    bad = [x for x in ids if x not in cfg['areas']]
    if bad:
        raise SystemExit('ไม่รู้จักพื้นที่: %s (มีใน flood_areas.json: %s)' % (', '.join(bad), ', '.join(cfg['areas'])))
    return ids


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


def current(area_id):
    """ผลล่าสุดที่อยู่บนเว็บแล้ว (properties ของ data/flood/<id>.geojson) หรือ None"""
    try:
        with open(os.path.join(FLOOD_DIR, area_id + '.geojson'), encoding='utf-8') as fh:
            return json.load(fh).get('properties') or {}
    except (OSError, ValueError):
        return None


def needs_run(cl, area_id, area, force=False, now=None):
    """มีภาพใหม่กว่าที่อยู่บนเว็บไหม คืน (ต้องรันไหม, เหตุผล)"""
    days = scene_days(cl, area['aoi'], now or datetime.now(timezone.utc))
    if not days:
        return False, 'ไม่พบภาพในช่วง %d วัน' % DAYS_BACK
    newest, its = days[0]
    cur = current(area_id)
    if force:
        return True, 'สั่งให้รันใหม่ (ภาพล่าสุด %s)' % newest
    if not cur or not cur.get('date'):
        return True, 'ยังไม่มีบนเว็บ (ภาพล่าสุด %s)' % newest
    if newest > cur['date']:
        return True, 'ภาพใหม่ %s (บนเว็บ %s)' % (newest, cur['date'])
    seen = (cur.get('scenes') or {}).get(newest, 0)
    if newest == cur['date'] and len(its) > seen:
        return True, 'ภาพวันที่ %s มีเพิ่ม %d → %d แผ่น' % (newest, seen, len(its))
    return False, 'ไม่มีภาพใหม่ (ล่าสุด %s)' % newest


def analyze(cl, area_id, area, out_dir, now=None):
    """วิเคราะห์หนึ่งพื้นที่ แล้วเขียน GeoJSON รูปแบบเดียวกับโน้ตบุ๊ก v3"""
    import numpy as np
    import odc.stac
    sys.path.insert(0, HERE)
    import flood_core as fc

    t0 = time.time()
    aoi = tuple(float(v) for v in area['aoi'])
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
    gj = fc.vectorize_layers({'flood': L['flood'], 'seasonal': L['seasonal']}, ds.odc.geobox.affine, crs, RES,
                             src=src, dates=used)
    tot = fc.totals(gj)
    gj['properties'] = {
        'v': 3, 'id': area_id, 'name': area['name'], 'aoi': list(aoi), 'date': used[0], 'dates': used,
        'scenes': scenes, 'baseline_years': len(masks), 'baseline_dates': base_used,
        'threshold_db': round(float(thr), 1), 'totals': tot, 'auto': True,
        'source': 'Sentinel-1 RTC (Copernicus/ESA) via Microsoft Planetary Computer; JRC Global Surface Water; Copernicus DEM',
        'method': 'ChatGeo v3: Otsu threshold on VV dB; minus JRC permanent water and slope > 5 deg; '
                  'unusual = water not present in most of the previous %d years (same season)' % len(masks)}
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'flood_s1_%s_%s.geojson' % (area_id, used[0]))
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(gj, fh, ensure_ascii=False, separators=(',', ':'))
    log('  น่าจะท่วม %.1f · ไม่แน่ใจ %.1f · มีน้ำเกือบทุกปี %.1f ตร.กม. · %d ปื้น · %.0f วินาที → %s' % (
        tot['flood_high'], tot['flood_low'], tot['seasonal'], len(gj['features']), time.time() - t0, path))
    return path


def write_output(key, value):
    """ส่งค่าให้ขั้นถัดไปของ GitHub Actions"""
    p = os.environ.get('GITHUB_OUTPUT')
    if p:
        with open(p, 'a', encoding='utf-8') as fh:
            fh.write('%s=%s\n' % (key, value))


def main(argv):
    ap = argparse.ArgumentParser(description='ตรวจน้ำจากดาวเทียม Sentinel-1')
    ap.add_argument('--check', action='store_true', help='ดูอย่างเดียวว่าพื้นที่ไหนมีภาพใหม่')
    ap.add_argument('--areas', default='', help='ชื่อย่อพื้นที่ คั่นด้วยจุลภาค (ว่าง = รายการ auto)')
    ap.add_argument('--force', action='store_true', help='รันใหม่แม้ไม่มีภาพใหม่')
    ap.add_argument('--out', default=os.path.join(tempfile.gettempdir(), 'chatgeo-flood'), help='โฟลเดอร์ผลลัพธ์')
    a = ap.parse_args(argv)
    cfg = load_cfg()
    ids = pick(cfg, a.areas)
    cl = client()

    if a.check:
        todo = []
        for k in ids:
            try:
                run, why = needs_run(cl, k, cfg['areas'][k], a.force)
            except Exception as e:  # noqa: BLE001 เช็กไม่ได้ก็ลองรันไปเลย
                run, why = True, 'เช็กไม่ได้ (%s) จะลองรัน' % e
            log('%s: %s' % (k, why))
            if run:
                todo.append(k)
        log('ต้องรัน:', ', '.join(todo) or '-')
        write_output('todo', ','.join(todo))
        return 0

    errors = []
    for k in ids:
        log('%s · %s' % (k, cfg['areas'][k]['name']))
        try:
            analyze(cl, k, cfg['areas'][k], a.out)
        except Exception as e:  # noqa: BLE001 พื้นที่หนึ่งพังไม่ให้พื้นที่อื่นพังตาม
            traceback.print_exc()
            errors.append('%s: %s' % (k, e))
    if errors:
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, 'errors.txt'), 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(errors) + '\n')
        log('มีพื้นที่ที่วิเคราะห์ไม่สำเร็จ:', '; '.join(errors))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
