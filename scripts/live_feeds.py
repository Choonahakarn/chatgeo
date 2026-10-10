#!/usr/bin/env python3
"""ข้อมูลสดสำหรับโหมดห้องควบคุมของ ChatGeo (GitHub Actions เรียกทุก 20 นาที เก็บใน branch live-data)

ลองนึกถึงเด็กส่งหนังสือพิมพ์ที่วิ่งไปเก็บข่าวจากหลายสำนักทุก 20 นาที แล้วสรุปเป็นแผ่นเดียวให้หน้าเว็บอ่าน
เพราะหลายแหล่งไม่ยอมให้เบราว์เซอร์ของผู้ชมดึงตรง (ไม่มี CORS) หรือไม่ควรให้ทุกคนดึงพร้อมกัน

งาน (แต่ละงานพังได้โดยไม่กระทบงานอื่น ถ้าพังจะเก็บไฟล์เดิมไว้):
  fires    จุดความร้อนจากดาวเทียม VIIRS NOAA-20 ทั่วโลก 24 ชม. (NASA FIRMS)  → fires_grid.json (ทั่วโลก รวมเป็นช่อง 0.5°) + fires_sea.json (เอเชียตะวันออกเฉียงใต้ รายจุด)
  aircraft เครื่องบินรอบไทยและเพื่อนบ้าน (adsb.lol, ODbL)                   → aircraft.json
  ships    เรือทั่วโลก (aisstream.io ต้องมีคีย์ฟรีใน secret AISSTREAM_KEY)     → ships.json
  news     หัวข่าวล่าสุด ไทยและโลก (RSS: Bangkok Post, BBC, DW) เก็บแค่หัวข่าว+ลิงก์ → news.json
  sats     วงโคจรดาวเทียม (CelesTrak) ทุก 12 ชม.                             → sats.json
  cables   สายเคเบิลใต้ทะเลจาก OpenStreetMap (ODbL) ทุก 7 วัน               → cables.geojson
สถานะทุกงานอยู่ใน status.json

ใช้: python scripts/live_feeds.py --out DIR [--only fires,news] [--force] [--mock DIR]
"""
import argparse
import asyncio
import csv
import gzip
import hashlib
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UTC = timezone.utc
UA = 'ChatGeo-live/1.0 (+https://choonahakarn.github.io/chatgeo/; github.com/Choonahakarn/chatgeo)'
MOCK = None  # โฟลเดอร์ไฟล์จำลองสำหรับทดสอบ (ชื่อไฟล์ตามงาน)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EVERY = {'sats': 12 * 3600, 'cables': 7 * 86400}  # งานที่ไม่ต้องทำทุกรอบ (วินาที)


def now_iso():
    return datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def get(url, timeout=60, data=None, headers=None, mock=None):
    """ดาวน์โหลด (ลองใหม่ 2 ครั้ง) ถ้าอยู่ในโหมดทดสอบอ่านจากไฟล์จำลองแทน"""
    if MOCK is not None:
        p = os.path.join(MOCK, mock or '')
        if not mock or not os.path.exists(p):
            raise RuntimeError('ไม่มีไฟล์จำลอง ' + str(mock))
        with open(p, 'rb') as f:
            return f.read()
    h = {'User-Agent': UA, 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    b = gzip.decompress(b)
                return b
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                raise
            err = e
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(3 * (attempt + 1))
    raise err


def write_json(out, name, obj):
    tmp = os.path.join(out, name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, os.path.join(out, name))


# ---------------------------------------------------------------- จุดความร้อน
FIRMS = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv'
SEA = (88.0, -11.0, 125.0, 28.0)  # เอเชียตะวันออกเฉียงใต้ + จีนใต้ + บังกลาเทศ เก็บรายจุด


def task_fires(out):
    raw = get(FIRMS, timeout=120, mock='fires.csv').decode('utf-8', 'replace')
    rows = csv.DictReader(io.StringIO(raw))
    grid, pts, n = {}, [], 0
    conf_code = {'l': 0, 'n': 1, 'h': 2, 'low': 0, 'nominal': 1, 'high': 2}
    for r in rows:
        try:
            lat, lon = float(r['latitude']), float(r['longitude'])
            frp = float(r.get('frp') or 0)
        except (KeyError, ValueError):
            continue
        n += 1
        c = conf_code.get(str(r.get('confidence', 'n')).strip().lower(), 1)
        k = (math.floor(lon / 0.5), math.floor(lat / 0.5))
        g = grid.get(k)
        if g:
            g[0] += 1
            g[1] = max(g[1], frp)
        else:
            grid[k] = [1, frp]
        if SEA[0] <= lon <= SEA[2] and SEA[1] <= lat <= SEA[3]:
            t = str(r.get('acq_time', '')).zfill(4)
            pts.append([round(lon, 3), round(lat, 3), round(frp, 1), c, str(r.get('acq_date', '')) + 'T' + t[:2] + ':' + t[2:] + 'Z',
                        1 if str(r.get('daynight', 'D')).upper() == 'D' else 0])
    if n == 0:
        raise RuntimeError('ไฟล์ FIRMS ว่าง')
    cells = [[round(k[0] * 0.5 + 0.25, 2), round(k[1] * 0.5 + 0.25, 2), v[0], round(v[1])] for k, v in grid.items()]
    t = now_iso()
    write_json(out, 'fires_grid.json', {'v': 1, 't': t, 'src': 'NASA FIRMS VIIRS NOAA-20', 'cell': 0.5, 'n': n, 'c': cells})
    write_json(out, 'fires_sea.json', {'v': 1, 't': t, 'src': 'NASA FIRMS VIIRS NOAA-20', 'bbox': SEA,
                                        'cols': ['lon', 'lat', 'frp', 'conf', 'time', 'day'], 'p': pts})
    return {'n': n, 'cells': len(cells), 'sea': len(pts)}


# ---------------------------------------------------------------- เครื่องบิน
ADSB = 'https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/250'
AC_CIRCLES = [  # จุดศูนย์กลางรัศมี 250 ไมล์ทะเล ครอบไทยและเพื่อนบ้าน
    (13.7, 100.6), (18.8, 99.0), (8.1, 98.3), (17.4, 102.8), (6.9, 100.4), (15.0, 104.5),
    (3.1, 101.6), (1.35, 103.9), (10.8, 106.7), (21.0, 105.8), (16.8, 96.2), (11.6, 104.9),
]


def task_aircraft(out):
    seen, ok = {}, 0
    for i, (lat, lon) in enumerate(AC_CIRCLES):
        try:
            j = json.loads(get(ADSB.format(lat=lat, lon=lon), timeout=30, mock='aircraft_%d.json' % i))
            ok += 1
        except Exception as e:  # noqa: BLE001
            print('  adsb.lol', lat, lon, 'ไม่ได้:', e, flush=True)
            continue
        for a in j.get('ac') or []:
            if a.get('lat') is None or a.get('lon') is None or not a.get('hex'):
                continue
            alt = a.get('alt_baro')
            seen[a['hex']] = [a['hex'], (a.get('flight') or '').strip(), round(a['lon'], 3), round(a['lat'], 3),
                              0 if alt == 'ground' else (int(alt) if isinstance(alt, (int, float)) else None),
                              round(a.get('gs') or 0), round(a.get('track') or 0), a.get('t') or '', a.get('r') or '']
        if MOCK is None:
            time.sleep(1.2)  # สุภาพกับบริการฟรี
    if not ok:
        raise RuntimeError('adsb.lol ไม่ตอบเลย')
    write_json(out, 'aircraft.json', {'v': 1, 't': now_iso(), 'src': 'adsb.lol (ODbL)', 'circles': AC_CIRCLES,
                                       'cols': ['hex', 'flight', 'lon', 'lat', 'alt_ft', 'gs_kt', 'track', 'type', 'reg'], 'ac': list(seen.values())})
    return {'n': len(seen), 'circles_ok': ok}


# ---------------------------------------------------------------- เรือ
AIS_URL = 'wss://stream.aisstream.io/v0/stream'


async def _ais_collect(key, secs):
    import websockets  # pip install websockets (ติดตั้งเฉพาะเมื่อมีคีย์)
    ships = {}
    async with websockets.connect(AIS_URL, max_size=2 ** 22, open_timeout=20) as ws:
        await ws.send(json.dumps({'APIKey': key, 'BoundingBoxes': [[[-90, -180], [90, 180]]],
                                  'FilterMessageTypes': ['PositionReport', 'StandardClassBPositionReport']}))
        end = time.time() + secs
        while time.time() < end:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=max(1, end - time.time()))
            except asyncio.TimeoutError:
                break
            try:
                j = json.loads(msg)
            except ValueError:
                continue
            if j.get('error'):
                raise RuntimeError('aisstream: ' + str(j.get('error')))
            md = j.get('MetaData') or {}
            body = (j.get('Message') or {}).get(j.get('MessageType') or '', {}) or {}
            lat, lon = md.get('latitude'), md.get('longitude')
            if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180 or md.get('MMSI') is None:
                continue
            ships[md['MMSI']] = [md['MMSI'], (md.get('ShipName') or '').strip(), round(lon, 3), round(lat, 3),
                                 round(body.get('Sog') or 0, 1), round(body.get('Cog') or 0), body.get('NavigationalStatus', 15)]
    return ships


def task_ships(out):
    key = os.environ.get('AISSTREAM_KEY', '').strip()
    if MOCK is not None:
        ships = {s[0]: s for s in json.loads(get('', mock='ships.json'))}
    elif not key:
        return {'skip': 'ไม่มี AISSTREAM_KEY (สมัครฟรีที่ aisstream.io แล้วใส่เป็น secret)'}
    else:
        ships = asyncio.run(_ais_collect(key, int(os.environ.get('AIS_SECS', '60'))))
    if not ships:
        raise RuntimeError('ไม่ได้ตำแหน่งเรือเลย')
    write_json(out, 'ships.json', {'v': 1, 't': now_iso(), 'src': 'aisstream.io', 'secs': int(os.environ.get('AIS_SECS', '60')),
                                    'cols': ['mmsi', 'name', 'lon', 'lat', 'sog', 'cog', 'status'], 's': list(ships.values())})
    return {'n': len(ships)}


# ---------------------------------------------------------------- ข่าว
FEEDS = [
    ('Bangkok Post', 'https://www.bangkokpost.com/rss/data/thailand.xml', 'th'),
    ('Bangkok Post', 'https://www.bangkokpost.com/rss/data/most-recent.xml', 'th'),
    ('Bangkok Post', 'https://www.bangkokpost.com/rss/data/world.xml', 'world'),
    ('BBC News', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'world'),
    ('BBC News', 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', 'world'),
    ('DW', 'https://rss.dw.com/rdf/rss-en-top', 'world'),
]
# ชื่อประเทศ (อังกฤษ) → ชื่อไทย และพิกัดเมืองหลวงโดยประมาณ ใช้ปักหมุดข่าวต่างประเทศ
COUNTRIES = {
    'Thailand': ('ไทย', 100.50, 13.75), 'Myanmar': ('เมียนมา', 96.13, 19.75), 'Burma': ('เมียนมา', 96.13, 19.75),
    'Laos': ('ลาว', 102.60, 17.97), 'Cambodia': ('กัมพูชา', 104.92, 11.56), 'Vietnam': ('เวียดนาม', 105.85, 21.03),
    'Malaysia': ('มาเลเซีย', 101.69, 3.14), 'Singapore': ('สิงคโปร์', 103.82, 1.35), 'Indonesia': ('อินโดนีเซีย', 106.85, -6.21),
    'Philippines': ('ฟิลิปปินส์', 120.98, 14.60), 'Brunei': ('บรูไน', 114.94, 4.89), 'Timor-Leste': ('ติมอร์-เลสเต', 125.57, -8.56),
    'China': ('จีน', 116.40, 39.90), 'Taiwan': ('ไต้หวัน', 121.56, 25.03), 'Hong Kong': ('ฮ่องกง', 114.17, 22.32),
    'Japan': ('ญี่ปุ่น', 139.69, 35.69), 'South Korea': ('เกาหลีใต้', 126.98, 37.57), 'North Korea': ('เกาหลีเหนือ', 125.75, 39.03),
    'Mongolia': ('มองโกเลีย', 106.92, 47.92), 'India': ('อินเดีย', 77.21, 28.61), 'Pakistan': ('ปากีสถาน', 73.05, 33.68),
    'Bangladesh': ('บังกลาเทศ', 90.41, 23.81), 'Sri Lanka': ('ศรีลังกา', 79.86, 6.93), 'Nepal': ('เนปาล', 85.32, 27.72),
    'Bhutan': ('ภูฏาน', 89.64, 27.47), 'Maldives': ('มัลดีฟส์', 73.51, 4.18), 'Afghanistan': ('อัฟกานิสถาน', 69.17, 34.53),
    'Iran': ('อิหร่าน', 51.39, 35.69), 'Iraq': ('อิรัก', 44.37, 33.31), 'Syria': ('ซีเรีย', 36.29, 33.51),
    'Israel': ('อิสราเอล', 35.21, 31.77), 'Gaza': ('กาซา', 34.46, 31.50), 'West Bank': ('เวสต์แบงก์', 35.20, 31.90),
    'Palestinian': ('ปาเลสไตน์', 35.20, 31.90), 'Lebanon': ('เลบานอน', 35.50, 33.89), 'Jordan': ('จอร์แดน', 35.93, 31.95),
    'Saudi Arabia': ('ซาอุดีอาระเบีย', 46.68, 24.71), 'Yemen': ('เยเมน', 44.21, 15.37), 'Oman': ('โอมาน', 58.41, 23.59),
    'United Arab Emirates': ('สหรัฐอาหรับเอมิเรตส์', 54.37, 24.45), 'UAE': ('สหรัฐอาหรับเอมิเรตส์', 54.37, 24.45),
    'Qatar': ('กาตาร์', 51.53, 25.29), 'Kuwait': ('คูเวต', 47.98, 29.38), 'Bahrain': ('บาห์เรน', 50.59, 26.23),
    'Turkey': ('ตุรกี', 32.86, 39.93), 'Türkiye': ('ตุรกี', 32.86, 39.93), 'Egypt': ('อียิปต์', 31.24, 30.04),
    'Libya': ('ลิเบีย', 13.19, 32.89), 'Tunisia': ('ตูนิเซีย', 10.18, 36.81), 'Algeria': ('แอลจีเรีย', 3.06, 36.75),
    'Morocco': ('โมร็อกโก', -6.84, 34.02), 'Sudan': ('ซูดาน', 32.56, 15.50), 'South Sudan': ('ซูดานใต้', 31.58, 4.85),
    'Ethiopia': ('เอธิโอเปีย', 38.76, 9.03), 'Somalia': ('โซมาเลีย', 45.32, 2.05), 'Kenya': ('เคนยา', 36.82, -1.29),
    'Uganda': ('ยูกันดา', 32.58, 0.35), 'Tanzania': ('แทนซาเนีย', 39.27, -6.79), 'Rwanda': ('รวันดา', 30.06, -1.94),
    'Congo': ('คองโก', 15.27, -4.44), 'Nigeria': ('ไนจีเรีย', 7.49, 9.06), 'Ghana': ('กานา', -0.19, 5.60),
    'Senegal': ('เซเนกัล', -17.44, 14.69), 'Mali': ('มาลี', -8.00, 12.64), 'Niger': ('ไนเจอร์', 2.11, 13.51),
    'Burkina Faso': ('บูร์กินาฟาโซ', -1.53, 12.37), 'Chad': ('ชาด', 15.04, 12.13), 'Cameroon': ('แคเมอรูน', 11.52, 3.85),
    'South Africa': ('แอฟริกาใต้', 28.19, -25.75), 'Zimbabwe': ('ซิมบับเว', 31.05, -17.83), 'Mozambique': ('โมซัมบิก', 32.57, -25.97),
    'Madagascar': ('มาดากัสการ์', 47.52, -18.88), 'Angola': ('แองโกลา', 13.23, -8.84),
    'Russia': ('รัสเซีย', 37.62, 55.76), 'Ukraine': ('ยูเครน', 30.52, 50.45), 'Belarus': ('เบลารุส', 27.56, 53.90),
    'Poland': ('โปแลนด์', 21.01, 52.23), 'Germany': ('เยอรมนี', 13.40, 52.52), 'France': ('ฝรั่งเศส', 2.35, 48.86),
    'United Kingdom': ('สหราชอาณาจักร', -0.13, 51.51), 'Britain': ('สหราชอาณาจักร', -0.13, 51.51), 'UK': ('สหราชอาณาจักร', -0.13, 51.51),
    'England': ('อังกฤษ', -0.13, 51.51), 'Scotland': ('สกอตแลนด์', -3.19, 55.95), 'Ireland': ('ไอร์แลนด์', -6.26, 53.35),
    'Spain': ('สเปน', -3.70, 40.42), 'Portugal': ('โปรตุเกส', -9.14, 38.72), 'Italy': ('อิตาลี', 12.50, 41.90),
    'Greece': ('กรีซ', 23.73, 37.98), 'Netherlands': ('เนเธอร์แลนด์', 4.90, 52.37), 'Belgium': ('เบลเยียม', 4.35, 50.85),
    'Switzerland': ('สวิตเซอร์แลนด์', 7.45, 46.95), 'Austria': ('ออสเตรีย', 16.37, 48.21), 'Czech': ('เช็กเกีย', 14.42, 50.08),
    'Hungary': ('ฮังการี', 19.04, 47.50), 'Romania': ('โรมาเนีย', 26.10, 44.43), 'Bulgaria': ('บัลแกเรีย', 23.32, 42.70),
    'Serbia': ('เซอร์เบีย', 20.46, 44.79), 'Croatia': ('โครเอเชีย', 15.98, 45.81), 'Moldova': ('มอลโดวา', 28.86, 47.01),
    'Georgia': ('จอร์เจีย', 44.83, 41.72), 'Armenia': ('อาร์เมเนีย', 44.51, 40.18), 'Azerbaijan': ('อาเซอร์ไบจาน', 49.87, 40.41),
    'Kazakhstan': ('คาซัคสถาน', 71.43, 51.13), 'Uzbekistan': ('อุซเบกิสถาน', 69.24, 41.30),
    'Sweden': ('สวีเดน', 18.07, 59.33), 'Norway': ('นอร์เวย์', 10.75, 59.91), 'Finland': ('ฟินแลนด์', 24.94, 60.17),
    'Denmark': ('เดนมาร์ก', 12.57, 55.68), 'Iceland': ('ไอซ์แลนด์', -21.94, 64.15), 'Estonia': ('เอสโตเนีย', 24.75, 59.44),
    'Latvia': ('ลัตเวีย', 24.11, 56.95), 'Lithuania': ('ลิทัวเนีย', 25.28, 54.69),
    'United States': ('สหรัฐอเมริกา', -77.04, 38.91), 'US': ('สหรัฐอเมริกา', -77.04, 38.91), 'USA': ('สหรัฐอเมริกา', -77.04, 38.91),
    'America': ('สหรัฐอเมริกา', -77.04, 38.91), 'Washington': ('สหรัฐอเมริกา', -77.04, 38.91), 'Canada': ('แคนาดา', -75.70, 45.42),
    'Mexico': ('เม็กซิโก', -99.13, 19.43), 'Guatemala': ('กัวเตมาลา', -90.51, 14.63), 'Cuba': ('คิวบา', -82.38, 23.11),
    'Haiti': ('เฮติ', -72.34, 18.54), 'Venezuela': ('เวเนซุเอลา', -66.90, 10.49), 'Colombia': ('โคลอมเบีย', -74.07, 4.71),
    'Ecuador': ('เอกวาดอร์', -78.47, -0.18), 'Peru': ('เปรู', -77.04, -12.05), 'Brazil': ('บราซิล', -47.88, -15.79),
    'Bolivia': ('โบลิเวีย', -68.15, -16.50), 'Chile': ('ชิลี', -70.67, -33.45), 'Argentina': ('อาร์เจนตินา', -58.38, -34.60),
    'Paraguay': ('ปารากวัย', -57.58, -25.26), 'Uruguay': ('อุรุกวัย', -56.16, -34.90), 'Panama': ('ปานามา', -79.52, 8.98),
    'Australia': ('ออสเตรเลีย', 149.13, -35.28), 'New Zealand': ('นิวซีแลนด์', 174.78, -41.29),
    'Papua New Guinea': ('ปาปัวนิวกินี', 147.18, -9.44), 'Fiji': ('ฟิจิ', 178.44, -18.14),
}
DEMONYM = {  # คำคุณศัพท์ที่ข่าวใช้บ่อย → ชื่อประเทศในตารางด้านบน
    'Cambodian': 'Cambodia', 'Burmese': 'Myanmar', 'Laotian': 'Laos', 'Lao': 'Laos', 'Vietnamese': 'Vietnam', 'Malaysian': 'Malaysia',
    'Singaporean': 'Singapore', 'Indonesian': 'Indonesia', 'Filipino': 'Philippines', 'Chinese': 'China', 'Beijing': 'China',
    'Taiwanese': 'Taiwan', 'Japanese': 'Japan', 'Tokyo': 'Japan', 'Korean': 'South Korea', 'Seoul': 'South Korea', 'Pyongyang': 'North Korea',
    'Indian': 'India', 'Pakistani': 'Pakistan', 'Bangladeshi': 'Bangladesh', 'Iranian': 'Iran', 'Tehran': 'Iran', 'Iraqi': 'Iraq',
    'Syrian': 'Syria', 'Israeli': 'Israel', 'Palestinians': 'Palestinian', 'Lebanese': 'Lebanon', 'Saudi': 'Saudi Arabia',
    'Turkish': 'Turkey', 'Egyptian': 'Egypt', 'Sudanese': 'Sudan', 'Russian': 'Russia', 'Moscow': 'Russia', 'Kremlin': 'Russia',
    'Ukrainian': 'Ukraine', 'Kyiv': 'Ukraine', 'German': 'Germany', 'Berlin': 'Germany', 'French': 'France', 'Paris': 'France',
    'British': 'United Kingdom', 'London': 'United Kingdom', 'Spanish': 'Spain', 'Italian': 'Italy', 'Greek': 'Greece', 'Polish': 'Poland',
    'American': 'United States', 'Trump': 'United States', 'White House': 'United States', 'Canadian': 'Canada', 'Mexican': 'Mexico',
    'Brazilian': 'Brazil', 'Argentine': 'Argentina', 'Venezuelan': 'Venezuela', 'Australian': 'Australia', 'Nigerian': 'Nigeria',
    'Kenyan': 'Kenya', 'Ethiopian': 'Ethiopia', 'South African': 'South Africa', 'Afghan': 'Afghanistan', 'Nepali': 'Nepal',
}
# ชื่อเมืองไทยที่ข่าวภาษาอังกฤษมักใช้ → จังหวัด (ชื่ออังกฤษตามข้อมูลจังหวัด)
TH_ALIAS = {
    'Pattaya': 'Chon Buri', 'Hua Hin': 'Prachuap Khiri Khan', 'Hat Yai': 'Songkhla', 'Koh Samui': 'Surat Thani', 'Ko Samui': 'Surat Thani',
    'Samui': 'Surat Thani', 'Koh Phangan': 'Surat Thani', 'Ayutthaya': 'Phra Nakhon Si Ayutthaya', 'Korat': 'Nakhon Ratchasima',
    'Mae Sai': 'Chiang Rai', 'Mae Sot': 'Tak', 'Koh Tao': 'Surat Thani', 'Krabi': 'Krabi', 'Phi Phi': 'Krabi', 'Koh Lanta': 'Krabi',
    'Suvarnabhumi': 'Samut Prakan', 'Don Mueang': 'Bangkok', 'Hat Yai': 'Songkhla', 'Betong': 'Yala', 'Khao Lak': 'Phangnga',
    'Koh Chang': 'Trat', 'Sattahip': 'Chon Buri', 'U-Tapao': 'Rayong', 'Map Ta Phut': 'Rayong', 'Kanchanaburi': 'Kanchanaburi',
    'Chiang Mai': 'Chiang Mai', 'Chiangmai': 'Chiang Mai', 'Phuket': 'Phuket', 'Bangkok': 'Bangkok',
}


def _load_provinces():
    p = os.path.join(ROOT, 'data', 'th-regions.js')
    out = {}
    try:
        s = open(p, encoding='utf-8').read()
        for m in re.finditer(r'"properties":\{"id":"([^"]+)","iso":"[^"]*","name":"([^"]+)","en":"([^"]+)","zone":"[^"]*","lon":([\d.]+),"lat":([\d.]+)', s):
            out[m.group(3)] = (m.group(2), float(m.group(4)), float(m.group(5)))
    except OSError:
        pass
    if 'Bangkok' not in out:
        out['Bangkok'] = ('กรุงเทพมหานคร', 100.50, 13.75)
    return out


def _variants(name):
    v = {name, name.replace(' ', ''), name.replace(' ', '-')}
    if name == 'Phangnga':
        v.add('Phang Nga')
    if name == 'Chon Buri':
        v.add('Chonburi')
    if name == 'Buri Ram':
        v.add('Buriram')
    if name == 'Si Sa Ket':
        v.add('Sisaket')
    if name == 'Nong Khai':
        v.add('Nongkhai')
    return v


def geotag(title, scope, provs):
    t = ' ' + re.sub(r'[^\w\s\-]', ' ', title) + ' '
    best = None
    for en, (th, lon, lat) in provs.items():  # จังหวัด (ชื่อยาวก่อน)
        for v in _variants(en):
            if re.search(r'\b' + re.escape(v) + r'\b', t, re.I) and (best is None or len(v) > best[0]):
                best = (len(v), {'name': th, 'en': en, 'lon': lon, 'lat': lat, 'kind': 'prov'})
    for a, en in TH_ALIAS.items():
        if en in provs and re.search(r'\b' + re.escape(a) + r'\b', t, re.I) and (best is None or len(a) > best[0]):
            th, lon, lat = provs[en]
            best = (len(a), {'name': th, 'en': en, 'lon': lon, 'lat': lat, 'kind': 'prov'})
    if best:
        return best[1]
    names = [(en, en) for en in COUNTRIES] + [(d, c) for d, c in DEMONYM.items()]
    for word, en in sorted(names, key=lambda kv: -len(kv[0])):
        if en == 'Thailand' and scope == 'th':
            continue
        if re.search(r'\b' + re.escape(word) + r'\b', t, re.I if len(word) > 3 else 0):
            th, lon, lat = COUNTRIES[en]
            return {'name': th, 'en': en, 'lon': lon, 'lat': lat, 'kind': 'country'}
    return None


def parse_feed(raw):
    root = ET.fromstring(raw)
    items = []
    for it in root.iter():
        tag = it.tag.split('}')[-1]
        if tag != 'item':
            continue
        f = {}
        for c in it:
            ct = c.tag.split('}')[-1]
            if ct in ('title', 'link', 'pubDate', 'date', 'guid') and c.text:
                f[ct] = c.text.strip()
        if f.get('title') and (f.get('link') or f.get('guid')):
            items.append(f)
    return items


def _when(f):
    s = f.get('pubDate') or f.get('date')
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace('Z', '+00:00'))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.astimezone(UTC)


def task_news(out):
    provs = _load_provinces()
    old = []
    try:
        old = json.load(open(os.path.join(out, 'news.json'), encoding='utf-8')).get('items') or []
    except (OSError, ValueError):
        pass
    by_url = {o['url']: o for o in old if o.get('url')}
    ok = 0
    for i, (src, url, scope) in enumerate(FEEDS):
        try:
            items = parse_feed(get(url, timeout=30, mock='news_%d.xml' % i))
            ok += 1
        except Exception as e:  # noqa: BLE001
            print('  RSS', src, url, 'ไม่ได้:', e, flush=True)
            continue
        for f in items[:40]:
            link = (f.get('link') or f.get('guid')).strip()
            if not link.startswith('http') or link in by_url:
                continue
            d = _when(f) or datetime.now(UTC)
            title = re.sub(r'\s+', ' ', f['title'])[:220]
            by_url[link] = {'id': hashlib.sha1(link.encode()).hexdigest()[:10], 't': d.strftime('%Y-%m-%dT%H:%M:%SZ'), 'src': src,
                            'scope': scope, 'title': title, 'url': link, 'place': geotag(title, scope, provs)}
    if not ok:
        raise RuntimeError('อ่าน RSS ไม่ได้เลย')
    cut = (datetime.now(UTC) - timedelta(hours=48)).strftime('%Y-%m-%dT%H:%M:%SZ')
    items = sorted([o for o in by_url.values() if o['t'] >= cut], key=lambda o: o['t'], reverse=True)[:250]
    write_json(out, 'news.json', {'v': 1, 't': now_iso(), 'feeds': sorted({f[0] for f in FEEDS}), 'items': items})
    return {'n': len(items), 'placed': sum(1 for o in items if o.get('place')), 'feeds_ok': ok}


# ---------------------------------------------------------------- ดาวเทียม
CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=JSON'
FEATURED = [25544, 48274, 33396, 58016, 46320, 67683, 41836, 39634, 62261, 40697, 42063, 60989, 39084, 49260, 43013, 54234, 37849,
            28786, 39500, 41552]
MEGA = re.compile(r'^(STARLINK|ONEWEB|KUIPER|QIANFAN|G60|GUOWANG|HULIANWANG|SPACEMOBILE)', re.I)


def task_sats(out):
    raw = get(CELESTRAK, timeout=120, mock='sats.json')
    arr = json.loads(raw)
    keep, mega = [], {}
    for o in arr:
        name = str(o.get('OBJECT_NAME', '')).strip()
        nid = int(o.get('NORAD_CAT_ID') or 0)
        m = MEGA.match(name)
        if m and nid not in FEATURED:
            k = m.group(1).upper()
            mega[k] = mega.get(k, 0) + 1
            continue
        keep.append([name, nid, o.get('OBJECT_ID', ''), o.get('EPOCH'), o.get('MEAN_MOTION'), o.get('ECCENTRICITY'), o.get('INCLINATION'),
                     o.get('RA_OF_ASC_NODE'), o.get('ARG_OF_PERICENTER'), o.get('MEAN_ANOMALY'), o.get('BSTAR'),
                     o.get('MEAN_MOTION_DOT'), o.get('MEAN_MOTION_DDOT'), o.get('REV_AT_EPOCH', 0), o.get('ELEMENT_SET_NO', 999)])
    if len(keep) < 50:
        raise RuntimeError('ได้ดาวเทียมน้อยผิดปกติ %d ดวง' % len(keep))
    write_json(out, 'sats.json', {'v': 1, 't': now_iso(), 'src': 'CelesTrak GP (GROUP=ACTIVE)', 'featured': FEATURED, 'mega': mega, 'total': len(arr),
                                   'cols': ['name', 'norad', 'intl', 'epoch', 'mm', 'ecc', 'inc', 'raan', 'argp', 'ma', 'bstar', 'mmdot', 'mmddot', 'rev', 'elset'],
                                   'omm': keep})
    return {'n': len(keep), 'mega': mega}


# ---------------------------------------------------------------- สายเคเบิลใต้ทะเล
OVERPASS = 'https://overpass-api.de/api/interpreter'
CABLE_Q = """[out:json][timeout:600];
(
  way["communication"="line"]["location"~"underwater|underground_sea"];
  way["telecom"="line"]["location"="underwater"];
  way["communication"="line"]["submarine"="yes"];
  way["submarine"="yes"]["power"!~"."]["communication"];
);
out tags geom;"""


def task_cables(out):
    raw = get(OVERPASS, timeout=900, data=urllib.parse.urlencode({'data': CABLE_Q}).encode(), mock='cables.json')
    j = json.loads(raw)
    feats = []
    for el in j.get('elements') or []:
        g = el.get('geometry') or []
        if len(g) < 2:
            continue
        coords, last = [], None
        for p in g:
            c = [round(p['lon'], 3), round(p['lat'], 3)]
            if c != last:
                coords.append(c)
                last = c
        if len(coords) < 2:
            continue
        tg = el.get('tags') or {}
        feats.append({'type': 'Feature', 'properties': {'name': tg.get('name') or tg.get('cable_name') or '', 'operator': tg.get('operator', '')},
                      'geometry': {'type': 'LineString', 'coordinates': coords}})
    if len(feats) < 10:
        raise RuntimeError('ได้สายเคเบิลน้อยผิดปกติ %d เส้น' % len(feats))
    write_json(out, 'cables.geojson', {'type': 'FeatureCollection', 'src': '© OpenStreetMap contributors (ODbL)', 't': now_iso(), 'features': feats})
    return {'n': len(feats), 'named': sum(1 for f in feats if f['properties']['name'])}


TASKS = {'fires': task_fires, 'aircraft': task_aircraft, 'ships': task_ships, 'news': task_news, 'sats': task_sats, 'cables': task_cables}


def main():
    global MOCK
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true', help='ไม่สนรอบเวลาของงานรายวัน/รายสัปดาห์')
    ap.add_argument('--mock', default=None)
    a = ap.parse_args()
    MOCK = a.mock
    os.makedirs(a.out, exist_ok=True)
    sp = os.path.join(a.out, 'status.json')
    try:
        status = json.load(open(sp, encoding='utf-8'))
    except (OSError, ValueError):
        status = {}
    status.setdefault('tasks', {})
    only = [x.strip() for x in a.only.split(',') if x.strip()]
    now = time.time()
    for name, fn in TASKS.items():
        if only and name not in only:
            continue
        prev = status['tasks'].get(name) or {}
        if not a.force and not only and name in EVERY and prev.get('ok') and now - prev.get('ts', 0) < EVERY[name]:
            print('%-8s ข้าม (ยังไม่ถึงรอบ)' % name)
            continue
        t0 = time.time()
        try:
            info = fn(a.out) or {}
            rec = {'ok': 'skip' not in info, 'at': now_iso(), 'ts': int(now), 'secs': round(time.time() - t0, 1), 'info': info}
            if 'skip' in info:
                rec['ok'] = prev.get('ok', False)
                rec['ts'] = prev.get('ts', 0)
            print('%-8s %s %.1fs %s' % (name, 'ข้าม' if 'skip' in info else 'สำเร็จ', time.time() - t0, json.dumps(info, ensure_ascii=False)), flush=True)
        except Exception as e:  # noqa: BLE001  งานหนึ่งพังไม่กระทบงานอื่น
            rec = dict(prev)
            rec.update({'ok': False, 'err': str(e)[:300], 'err_at': now_iso()})
            print('%-8s ไม่สำเร็จ (เก็บไฟล์เดิมไว้): %s' % (name, e), flush=True)
        status['tasks'][name] = rec
    status['updated'] = now_iso()
    write_json(a.out, 'status.json', status)
    return 0


if __name__ == '__main__':
    sys.exit(main())
