# ฟังก์ชันหลักของการตรวจน้ำจาก Sentinel-1
# ใช้ร่วมกันโดย scripts/flood_s1.py (รันอัตโนมัติบน GitHub Actions) และโน้ตบุ๊ก notebooks/flood_s1.ipynb (ฝังทั้งไฟล์ตอนสร้างโน้ตบุ๊ก)
import json
import math
import re
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
from scipy import ndimage


def scenes_by_day(client, aoi, start, end):
    """ภาพ Sentinel-1 ในช่วงวันที่ที่กำหนด จัดกลุ่มตามวัน เรียงจากใหม่ไปเก่า"""
    search = client.search(collections=['sentinel-1-rtc'], bbox=aoi,
                           datetime=start.strftime('%Y-%m-%d') + '/' + end.strftime('%Y-%m-%d'))
    by_day = {}
    for it in search.items():
        by_day.setdefault(it.datetime.strftime('%Y-%m-%d'), []).append(it)
    return sorted(by_day.items(), key=lambda x: x[0], reverse=True)


def utm_crs(aoi):
    """เลือกพิกัด UTM ที่ตรงกับกลางพื้นที่ (ไทยอยู่โซน 47 กับ 48)"""
    lon, lat = (aoi[0] + aoi[2]) / 2, (aoi[1] + aoi[3]) / 2
    return 'EPSG:%d' % ((32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1)


def mosaic_latest(days, load_db, max_days=4, target=0.97):
    """ปะภาพหลายวันเข้าด้วยกัน: ใช้ภาพใหม่สุดก่อน ตรงไหนยังว่างค่อยเติมด้วยภาพวันก่อนหน้า
    load_db(items, like) ต้องคืน (db, ds) ที่อยู่บนกริดเดียวกัน
    คืนค่า (db, ds, วันที่ที่ใช้, สัดส่วนพื้นที่ที่มีข้อมูล, src) src บอกว่าแต่ละพิกเซลมาจากวันที่ลำดับไหนใน used (-1 = ไม่มีภาพ)"""
    db, ds, used, src = None, None, [], None
    for day, its in days[:max_days]:
        d, dsx = load_db(its, ds)
        if db is None:
            db, ds = d, dsx
            src = np.where(np.isfinite(db), 0, -1).astype('int8')
        else:
            hole = ~np.isfinite(db) & np.isfinite(d)
            if not hole.any():
                continue
            db[hole] = d[hole]
            src[hole] = len(used)
        used.append(day)
        if np.isfinite(db).mean() >= target:
            break
    if db is None:
        raise RuntimeError('ไม่พบภาพ Sentinel-1 ในช่วงนี้ ลองเพิ่ม DAYS_BACK')
    return db, ds, used, float(np.isfinite(db).mean()), src


def to_db(linear):
    """แปลงค่าการสะท้อนเรดาร์ (linear) เป็นเดซิเบล ค่าที่ใช้ไม่ได้เป็น NaN"""
    lin = np.asarray(linear, dtype='float32')
    out = np.full(lin.shape, np.nan, dtype='float32')
    ok = np.isfinite(lin) & (lin > 0)
    out[ok] = 10.0 * np.log10(lin[ok])
    return out


def speckle_filter(db, size=3):
    """ลดจุดรบกวนแบบเม็ดทราย (speckle) ด้วย median filter โดยไม่ทำให้ NaN ลาม"""
    filled = np.where(np.isfinite(db), db, 0.0)
    med = ndimage.median_filter(filled, size=size)
    return np.where(np.isfinite(db), med, np.nan).astype('float32')


def otsu_threshold(db, lo=-30.0, hi=0.0, clamp=(-24.0, -15.0), fallback=-19.0):
    """หาเส้นแบ่ง 'น้ำ' กับ 'ไม่ใช่น้ำ' จากฮิสโตแกรม (Otsu) แล้วจำกัดให้อยู่ในช่วงที่สมเหตุสมผล"""
    v = db[np.isfinite(db)]
    v = v[(v > lo) & (v < hi)]
    if v.size < 1000:
        return fallback
    try:
        from skimage.filters import threshold_otsu
        t = float(threshold_otsu(v))
    except Exception:  # noqa: BLE001
        return fallback
    return float(min(max(t, clamp[0]), clamp[1]))


def slope_degrees(dem, res):
    """ความชันของพื้นที่ (องศา) จาก DEM ที่อยู่ในพิกัดเมตร"""
    z = np.where(np.isfinite(dem), dem, np.nanmean(dem) if np.isfinite(dem).any() else 0)
    dy, dx = np.gradient(z, res)
    return np.degrees(np.arctan(np.hypot(dx, dy))).astype('float32')


def water_mask(db, threshold):
    """พิกเซลที่มืดกว่าเส้นแบ่ง = น้ำ (ตัดจุดเดี่ยวๆ ออก)"""
    w = np.isfinite(db) & (db < threshold)
    return ndimage.binary_opening(w, structure=np.ones((3, 3)))


def _drop_small(mask, min_pixels):
    """ตัดปื้นที่เล็กกว่า min_pixels พิกเซล"""
    lab, n = ndimage.label(mask)
    if not n:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= min_pixels
    return keep[lab]


def detect_flood(db, threshold, occurrence=None, slope=None, perm_occ=75, max_slope=5.0, min_pixels=10, reference_water=None):
    """น้ำท่วม = ตอนนี้เป็นน้ำ และปกติไม่ใช่แหล่งน้ำถาวร และไม่ใช่พื้นที่ลาดชัน (เงาภูเขาดูเหมือนน้ำ)
    ถ้าให้ reference_water (น้ำที่มีเป็นปกติช่วงนี้) จะตัดน้ำตามฤดูกาลออก เช่น นาข้าวที่ขังน้ำทุกปี"""
    water = water_mask(db, threshold)
    permanent = np.zeros_like(water) if occurrence is None else (np.nan_to_num(occurrence, nan=0) >= perm_occ)
    steep = np.zeros_like(water) if slope is None else (np.nan_to_num(slope, nan=0) > max_slope)
    flood = water & ~permanent & ~steep
    if reference_water is not None:
        # ขยายน้ำอ้างอิงออก 1 พิกเซล กันขอบขยับเล็กน้อยระหว่างสองภาพ
        flood &= ~ndimage.binary_dilation(reference_water, structure=np.ones((3, 3)))
    return _drop_small(flood, min_pixels), water, permanent, steep


def usual_water(masks, valids=None):
    """น้ำที่ "มีเป็นปกติ" ช่วงนี้ = เป็นน้ำเกินครึ่งของปีที่มีภาพ (เช่น 2 ใน 3 ปี)
    ปีที่ไม่มีภาพตรงพิกเซลนั้นไม่นับ จึงไม่ถูกซ่อนเพราะท่วมแค่ปีเดียว"""
    if not masks:
        return None
    cnt = np.zeros(masks[0].shape, 'int16')
    n = np.zeros(masks[0].shape, 'int16')
    for i, m in enumerate(masks):
        v = np.ones(m.shape, bool) if valids is None or valids[i] is None else valids[i]
        cnt += (m & v)
        n += v
    return (n > 0) & (cnt >= n // 2 + 1)


def classify(db, threshold, occurrence=None, slope=None, usual=None, perm_occ=75, max_slope=5.0, min_pixels=10):
    """แยกน้ำเป็น 2 ชั้น: flood = น้ำผิดปกติ (น่าจะท่วม), seasonal = น้ำที่มีเกือบทุกปีช่วงนี้ (นา ทุ่งรับน้ำ)"""
    flood, water, permanent, steep = detect_flood(db, threshold, occurrence, slope, perm_occ, max_slope, min_pixels, reference_water=usual)
    if usual is None:
        seasonal = np.zeros_like(flood)
    else:
        near_usual = ndimage.binary_dilation(usual, structure=np.ones((3, 3)))
        seasonal = _drop_small(water & ~permanent & ~steep & ~flood & near_usual, min_pixels)
    return {'water': water, 'permanent': permanent, 'steep': steep, 'flood': flood, 'seasonal': seasonal}


def round_coords(gj, nd=5):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    for f in gj['features']:
        f['geometry']['coordinates'] = r(f['geometry']['coordinates'])
    return gj


def vectorize_layers(layers, transform, crs, res, src=None, dates=None, min_area_km2=0.05, max_features=4000,
                     big_km2=1.0, near_m=300, nd=4):
    """แปลงหลายชั้น (เช่น {'flood': ..., 'seasonal': ...}) เป็น GeoJSON ชุดเดียว
    แต่ละปื้นมี kind, area_km2, date (วันที่ของภาพที่ใช้มากที่สุดในปื้น)
    ชั้น flood มี conf: high = ผืนน้ำใหญ่ตั้งแต่ big_km2 หรืออยู่ห่างผืนใหญ่ไม่เกิน near_m เมตร
                       low  = ปื้นเล็กที่อยู่โดดๆ อาจเป็นนาที่เพิ่งปล่อยน้ำเข้าหรือบ่อ"""
    from rasterio.features import shapes
    from shapely.geometry import shape, mapping
    from shapely.ops import transform as shp_transform
    from shapely.strtree import STRtree
    from pyproj import Transformer
    tr = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True).transform
    feats = []
    for kind, mask in layers.items():
        if mask is None or not mask.any():
            continue
        lab, n = ndimage.label(mask)
        day = None
        if src is not None and dates:
            k = len(dates)
            s = np.where(src[mask] >= 0, src[mask], k).astype('int64')
            counts = np.zeros((n + 1, k + 1), 'int64')
            np.add.at(counts, (lab[mask], s), 1)
            day = counts[:, :k].argmax(1)
        polys = []
        for geom, val in shapes(lab.astype('int32'), mask=mask, transform=transform):
            g = shape(geom)
            a = g.area / 1e6
            if a >= min_area_km2:
                polys.append((a, g, int(val)))
        polys.sort(key=lambda x: -x[0])
        polys = polys[:max_features]
        conf = {}
        if kind == 'flood':
            big = [g for a, g, _ in polys if a >= big_km2]
            tree = STRtree(big) if big else None
            for a, g, v in polys:
                hi = a >= big_km2 or (tree is not None and len(tree.query(g, predicate='dwithin', distance=near_m)) > 0)
                conf[v] = 'high' if hi else 'low'
        for a, g, v in polys:
            props = {'kind': kind, 'area_km2': round(a, 3)}
            if kind == 'flood':
                props['conf'] = conf[v]
            if day is not None:
                props['date'] = dates[int(day[v])]
            g4326 = shp_transform(tr, g.simplify(res, preserve_topology=True))
            feats.append({'type': 'Feature', 'properties': props,
                          'geometry': json.loads(json.dumps(mapping(g4326), default=float))})
    return round_coords({'type': 'FeatureCollection', 'features': feats}, nd)


def totals(gj):
    """พื้นที่รวม (ตร.กม.) แยกตามชนิดและความมั่นใจ"""
    t = {'flood_high': 0.0, 'flood_low': 0.0, 'seasonal': 0.0}
    for f in gj['features']:
        p = f['properties']
        key = 'seasonal' if p.get('kind') == 'seasonal' else ('flood_low' if p.get('conf') == 'low' else 'flood_high')
        t[key] += p['area_km2']
    return {k: round(v, 1) for k, v in t.items()}


def load_cg_th(url='https://raw.githubusercontent.com/Choonahakarn/chatgeo/main/data/th-regions.js', text=None):
    """อ่านขอบเขตภาค/จังหวัดจากไฟล์ th-regions.js ของ ChatGeo"""
    if text is None:
        with urllib.request.urlopen(url, timeout=60) as r:
            text = r.read().decode('utf-8')
    m = re.search(r'window\.CG_TH\s*=\s*(\{.*\})\s*;?\s*$', text, re.S)
    return json.loads(m.group(1)) if m else None


def province_stats(flood_gj, th):
    """พื้นที่ (ตร.กม.) แยกตามจังหวัด: [{'name', 'flood_high', 'flood_low', 'seasonal'}] เรียงตามน้ำท่วมที่มั่นใจ"""
    from shapely.geometry import shape
    from shapely.strtree import STRtree
    if not th or 'provinces' not in th:
        return []
    provs = [(f['properties']['name'], shape(f['geometry'])) for f in th['provinces']['features']]
    tree = STRtree([g for _, g in provs])
    tot = {}
    for f in flood_gj['features']:
        p = f['properties']
        key = 'seasonal' if p.get('kind') == 'seasonal' else ('flood_low' if p.get('conf') == 'low' else 'flood_high')
        c = shape(f['geometry']).representative_point()
        for i in tree.query(c):
            name, pg = provs[int(i)]
            if pg.contains(c):
                row = tot.setdefault(name, {'name': name, 'flood_high': 0.0, 'flood_low': 0.0, 'seasonal': 0.0})
                row[key] += p['area_km2']
                break
    rows = sorted(tot.values(), key=lambda r: (-r['flood_high'], -r['flood_low'], -r['seasonal']))
    for r in rows:
        for k in ('flood_high', 'flood_low', 'seasonal'):
            r[k] = round(r[k], 1)
    return rows
