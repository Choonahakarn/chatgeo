#!/usr/bin/env python3
"""ตารางลมรายชั่วโมงสำหรับเส้นลมบนแผนที่ ChatGeo

ดึงลมที่ความสูง 10 ม. ตอนนี้ จาก Open-Meteo (CC BY 4.0, ใช้ฟรีแบบไม่ใช่เชิงพาณิชย์) เป็นตารางทุก 1.5 องศา
ครอบไทยและประเทศรอบๆ (143 จุด) แล้วเขียน wind.json (องค์ประกอบ u ไปทางตะวันออก, v ไปทางเหนือ หน่วย ม./วินาที)
GitHub Actions เรียกทุกชั่วโมง ผู้ชมเว็บโหลดไฟล์เดียว ไม่ต้องเรียก Open-Meteo เอง

ใช้: python scripts/wx_grid.py --out DIR [--mock]
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BKK = timezone(timedelta(hours=7))
LON0, LAT0, STEP, NX, NY = 94.5, 4.5, 1.5, 11, 13   # 94.5–109.5°E, 4.5–22.5°N
API = 'https://api.open-meteo.com/v1/forecast'
UA = 'ChatGeo-wind/1.0 (+https://choonahakarn.github.io/chatgeo/)'


def grid_points():
    return [(LAT0 + j * STEP, LON0 + i * STEP) for j in range(NY) for i in range(NX)]


def fetch_chunk(pts):
    q = 'latitude=%s&longitude=%s&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=Asia%%2FBangkok' % (
        ','.join('%.2f' % p[0] for p in pts), ','.join('%.2f' % p[1] for p in pts))
    req = urllib.request.Request(API + '?' + q, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.load(r)
    return j if isinstance(j, list) else [j]


def to_uv(speed, deg):
    """ทิศลมของ Open-Meteo คือทิศที่ลมพัดมา → แปลงเป็นทิศที่ลมพัดไป"""
    if speed is None or deg is None:
        return 0.0, 0.0
    r = math.radians(deg)
    return -speed * math.sin(r), -speed * math.cos(r)


def build(mock=False):
    pts = grid_points()
    u, v, times = [], [], []
    for k in range(0, len(pts), 50):
        chunk = pts[k:k + 50]
        if mock:
            rows = [{'current': {'time': '2026-10-08T17:00', 'wind_speed_10m': 3 + (lat % 5), 'wind_direction_10m': (lon * 20) % 360}} for lat, lon in chunk]
        else:
            for attempt in range(3):
                try:
                    rows = fetch_chunk(chunk)
                    break
                except Exception as e:  # noqa: BLE001
                    if attempt == 2:
                        raise
                    print('ลองใหม่:', e, flush=True)
                    time.sleep(5 * (attempt + 1))
        if len(rows) != len(chunk):
            raise ValueError('ได้ข้อมูล %d จุด จากที่ขอ %d จุด' % (len(rows), len(chunk)))
        for row in rows:
            cur = row.get('current') or {}
            a, b = to_uv(cur.get('wind_speed_10m'), cur.get('wind_direction_10m'))
            u.append(round(a, 1))
            v.append(round(b, 1))
            if cur.get('time'):
                times.append(cur['time'])
    t = max(times) if times else datetime.now(BKK).strftime('%Y-%m-%dT%H:%M')
    return {'ver': 1, 'time': t[:16], 'source': 'Open-Meteo (CC BY 4.0)', 'lon0': LON0, 'lat0': LAT0, 'dx': STEP, 'dy': STEP,
            'nx': NX, 'ny': NY, 'u': u, 'v': v}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mock', action='store_true')
    a = ap.parse_args()
    try:
        doc = build(a.mock)
    except Exception as e:  # noqa: BLE001 ลมเป็นของเสริม ล้มเหลวก็ใช้ไฟล์เดิมต่อ
        print('ดึงลมไม่สำเร็จ ใช้ไฟล์เดิม:', e)
        return 0
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'wind.json'), 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    sp = [math.hypot(x, y) for x, y in zip(doc['u'], doc['v'])]
    print('ลม %s · %d จุด · เฉลี่ย %.1f สูงสุด %.1f ม./วินาที' % (doc['time'], len(sp), sum(sp) / len(sp), max(sp)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
