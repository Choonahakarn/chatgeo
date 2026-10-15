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
  bkk      กรุงเทพตอนนี้: น้ำในคลอง ฝน น้ำบนถนน (กทม.) ฝุ่น (Air4Thai) แม่น้ำเจ้าพระยา (ThaiWater)
           เรื่องแจ้งจาก Traffy Fondue (เฉพาะตำแหน่ง สถานะ รหัสเรื่อง)          → bkk.json + bkk_hist.json (ย้อนหลัง 24 ชม.)
  bkkbase  โครงเมืองกรุงเทพทุก 7 วัน: เขต รถไฟฟ้า สถานี สถานที่สำคัญ (OSM) สถานีสูบน้ำ ประตูระบายน้ำ จุดเสี่ยง (กทม.) → bkk_base.json
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
START = time.time()  # งานหนักเช็กเวลารวมของรอบ (workflow ให้ 20 นาที)

EVERY = {'sats': 12 * 3600, 'cables': 7 * 86400, 'bkkbase': 7 * 86400}  # งานที่ไม่ต้องทำทุกรอบ (วินาที)
RETRY_AFTER = {'cables': 6 * 3600, 'bkkbase': 3600}  # งานหนักที่พังแล้ว รอเท่านี้ก่อนลองใหม่ (ไม่ทุบเซิร์ฟเวอร์ทุก 20 นาที)


def now_iso():
    return datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def get(url, timeout=60, data=None, headers=None, mock=None, tries=3):
    """ดาวน์โหลด (ลองใหม่ได้ tries ครั้ง) ถ้าอยู่ในโหมดทดสอบอ่านจากไฟล์จำลองแทน"""
    if MOCK is not None:
        p = os.path.join(MOCK, mock or '')
        if not mock or not os.path.exists(p):
            raise RuntimeError('ไม่มีไฟล์จำลอง ' + str(mock))
        with open(p, 'rb') as f:
            return f.read()
    h = {'User-Agent': UA, 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    err = None
    for attempt in range(tries):
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
        if attempt < tries - 1:
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
    keep, mega, mrows, groups = [], {}, [], []
    for o in arr:
        name = str(o.get('OBJECT_NAME', '')).strip()
        nid = int(o.get('NORAD_CAT_ID') or 0)
        m = MEGA.match(name)
        if m and nid not in FEATURED:
            k = m.group(1).upper()
            mega[k] = mega.get(k, 0) + 1
            # กลุ่มดาวเทียมใหญ่ (Starlink ฯลฯ) เก็บแบบย่อไว้วาดเป็นจุดรอบลูกโลกเท่านั้น
            try:
                ep = datetime.strptime(str(o.get('EPOCH'))[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=UTC).timestamp()
                if k not in groups:
                    groups.append(k)
                mrows.append([groups.index(k), nid, int(ep), round(float(o.get('MEAN_MOTION')), 8), round(float(o.get('ECCENTRICITY')), 7),
                              round(float(o.get('INCLINATION')), 4), round(float(o.get('RA_OF_ASC_NODE')), 4), round(float(o.get('ARG_OF_PERICENTER')), 4),
                              round(float(o.get('MEAN_ANOMALY')), 4)])
            except (TypeError, ValueError):
                pass
            continue
        keep.append([name, nid, o.get('OBJECT_ID', ''), o.get('EPOCH'), o.get('MEAN_MOTION'), o.get('ECCENTRICITY'), o.get('INCLINATION'),
                     o.get('RA_OF_ASC_NODE'), o.get('ARG_OF_PERICENTER'), o.get('MEAN_ANOMALY'), o.get('BSTAR'),
                     o.get('MEAN_MOTION_DOT'), o.get('MEAN_MOTION_DDOT'), o.get('REV_AT_EPOCH', 0), o.get('ELEMENT_SET_NO', 999)])
    if len(keep) < 50:
        raise RuntimeError('ได้ดาวเทียมน้อยผิดปกติ %d ดวง' % len(keep))
    write_json(out, 'sats.json', {'v': 1, 't': now_iso(), 'src': 'CelesTrak GP (GROUP=ACTIVE)', 'featured': FEATURED, 'mega': mega, 'total': len(arr),
                                   'cols': ['name', 'norad', 'intl', 'epoch', 'mm', 'ecc', 'inc', 'raan', 'argp', 'ma', 'bstar', 'mmdot', 'mmddot', 'rev', 'elset'],
                                   'omm': keep})
    if mrows:
        write_json(out, 'sats_mega.json', {'v': 1, 't': now_iso(), 'src': 'CelesTrak GP (GROUP=ACTIVE)', 'groups': groups,
                                           'cols': ['group', 'norad', 'epoch_unix', 'mm', 'ecc', 'inc', 'raan', 'argp', 'ma'], 'rows': mrows})
    return {'n': len(keep), 'mega': mega, 'mega_rows': len(mrows)}


# ---------------------------------------------------------------- สายเคเบิลใต้ทะเล
# ถามทั้งโลกทีเดียวเซิร์ฟเวอร์ตอบไม่ทัน (504) จึงแบ่งเป็น 8 กล่อง ถามทีละกล่อง ถ้าเซิร์ฟเวอร์หลักไม่ตอบลองเซิร์ฟเวอร์สำรอง
# กล่องที่ได้แล้วเก็บไว้ใน cables_parts.json รอบหน้าถามเฉพาะกล่องที่ยังขาด ครบทุกกล่องแล้วค่อยเขียน cables.geojson
OVERPASS_MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
                    'https://overpass.private.coffee/api/interpreter']
CABLE_BOXES = [(s, w, s + 90, w + 90) for s in (-90, 0) for w in (-180, -90, 0, 90)]  # ใต้ ตะวันตก เหนือ ตะวันออก
CABLE_Q = """[out:json][timeout:170][bbox:{s},{w},{n},{e}];
(
  way["communication"="line"]["location"~"underwater|underground_sea"];
  way["telecom"="line"]["location"="underwater"];
  way["communication"="line"]["submarine"="yes"];
  way["submarine"="yes"]["power"!~"."]["communication"];
);
out tags geom;"""
CABLE_BUDGET = 9 * 60  # วินาที (งานทั้งหมดต้องจบใน 20 นาทีของ workflow)
CABLE_PARTS = 'cables_parts.json'


def cable_box(box):
    q = CABLE_Q.format(s=box[0], w=box[1], n=box[2], e=box[3])
    err = None
    for u in OVERPASS_MIRRORS:
        try:
            return json.loads(get(u, timeout=200, data=urllib.parse.urlencode({'data': q}).encode(), mock='cables.json', tries=1))
        except Exception as e:  # noqa: BLE001
            err = e
            print('   cables %s ที่ %s ไม่สำเร็จ: %s' % (box, u.split('/')[2], str(e)[:120]), flush=True)
            if MOCK is not None:
                break
    raise err


def cable_ways(j):
    out = []
    for el in j.get('elements') or []:
        g = el.get('geometry') or []
        coords, last = [], None
        for p in g:
            c = [round(p['lon'], 3), round(p['lat'], 3)]
            if c != last:
                coords.append(c)
                last = c
        if len(coords) < 2:
            continue
        tg = el.get('tags') or {}
        out.append([el.get('id'), tg.get('name') or tg.get('cable_name') or '', tg.get('operator', ''), coords])
    return out


def task_cables(out):
    pp = os.path.join(out, CABLE_PARTS)
    try:
        parts = json.load(open(pp, encoding='utf-8'))
        if time.time() - parts.get('ts', 0) > 3 * 86400:  # ของเก่าเกิน 3 วัน เริ่มใหม่
            parts = {}
    except (OSError, ValueError):
        parts = {}
    parts.setdefault('ts', int(time.time()))
    parts.setdefault('boxes', {})
    t0 = time.time()
    for box in CABLE_BOXES:
        key = ','.join(str(x) for x in box)
        if key in parts['boxes']:
            continue
        if time.time() - t0 > CABLE_BUDGET:
            break
        try:
            parts['boxes'][key] = cable_ways(cable_box(box))
            print('   cables %s ได้ %d เส้น' % (key, len(parts['boxes'][key])), flush=True)
        except Exception:  # noqa: BLE001  กล่องนี้ไว้รอบหน้า
            pass
    missing = [b for b in CABLE_BOXES if ','.join(str(x) for x in b) not in parts['boxes']]
    if missing:
        write_json(out, CABLE_PARTS, parts)
        raise RuntimeError('ได้ %d/%d กล่อง เก็บส่วนที่ได้ไว้ รอบหน้าถามต่อ' % (len(CABLE_BOXES) - len(missing), len(CABLE_BOXES)))
    seen, feats = set(), []
    for key in parts['boxes']:
        for wid, name, op, coords in parts['boxes'][key]:
            if wid in seen:  # เส้นที่พาดข้ามกล่องได้มาซ้ำ
                continue
            seen.add(wid)
            feats.append({'type': 'Feature', 'properties': {'name': name, 'operator': op}, 'geometry': {'type': 'LineString', 'coordinates': coords}})
    if len(feats) < 10:
        raise RuntimeError('ได้สายเคเบิลน้อยผิดปกติ %d เส้น' % len(feats))
    write_json(out, 'cables.geojson', {'type': 'FeatureCollection', 'src': '© OpenStreetMap contributors (ODbL)', 't': now_iso(), 'features': feats})
    try:
        os.remove(pp)
    except OSError:
        pass
    return {'n': len(feats), 'named': sum(1 for f in feats if f['properties']['name'])}




# ---------------------------------------------------------------- กรุงเทพตอนนี้ (หน้า "กรุงเทพ" ของเว็บ)
# ลองนึกถึงพนักงานเดินตรวจเมืองที่วนเก็บตัวเลขจากหลายหน่วยงานทุก 20 นาที แล้วจดลงสมุดเล่มเดียว (bkk.json)
# แหล่งหลักคือเว็บสำนักการระบายน้ำ กทม. (weather.bangkok.go.th) ซึ่งเบราว์เซอร์ของผู้ชมดึงตรงไม่ได้ (ไม่มี CORS)
# ถ้า กทม. ไม่ตอบ (เช่นไม่รับเครื่องจากต่างประเทศ) จะใช้ ThaiWater (สสน.) แทนเท่าที่มี แต่ละแหล่งพังได้โดยไม่กระทบแหล่งอื่น
# Traffy Fondue: เก็บแค่ตำแหน่ง สถานะ เวลา และรหัสเรื่อง (ไว้ทำลิงก์) ไม่เก็บข้อความหรือรูปของผู้แจ้ง
BMA = 'https://weather.bangkok.go.th'
BKK_BOX = (100.30, 13.48, 100.96, 13.97)  # ตะวันตก ใต้ ตะวันออก เหนือ
TW = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/'
AIR4THAI = 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php'
TRAFFY = 'https://publicapi.traffy.in.th/share/teamchadchart/search'
BKK_HIST = 'bkk_hist.json'
TH_TZ = timezone(timedelta(hours=7))
FLOOD_RE = re.compile(r'น้ำท่วม|น้ำขัง|ท่วมขัง|น้ำไม่ระบาย|ระบายน้ำไม่|ระบายไม่ทัน|ท่อตัน|ท่ออุดตัน|ท่อระบายน้ำอุดตัน|รอการระบาย')
RIVER_KEY = re.compile(r'ท้ายเขื่อนเจ้าพระยา|บางไทร|นวลฉวี|สามเสน|สะพานกรุงเทพ|ปากเกร็ด|พระนั่งเกล้า|ป้อมพระจุล|บางกระเจ้า|พระประแดง')


def _in_box(lon, lat, pad=0.0):
    return BKK_BOX[0] - pad <= lon <= BKK_BOX[2] + pad and BKK_BOX[1] - pad <= lat <= BKK_BOX[3] + pad


def _f(x, nd=2):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float('inf'), float('-inf')):
        return None
    return round(v, nd)


def _ms_net(s):
    """'/Date(1791981600000)/' (แบบ .NET) -> มิลลิวินาที UTC"""
    m = re.search(r'/Date\((\d+)', str(s or ''))
    return int(m.group(1)) if m else None


def _ms_th(s):
    """'14/10/2569 19:40' (พ.ศ. เวลาไทย) หรือ '2026-10-14 19:40' (ค.ศ. เวลาไทย) -> มิลลิวินาที UTC"""
    s = str(s or '').strip()
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})', s)
    try:
        if m:
            d, mo, y, h, mi = map(int, m.groups())
        else:
            m = re.match(r'(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})', s)
            if not m:
                return None
            y, mo, d, h, mi = map(int, m.groups())
        if y > 2400:
            y -= 543
        return int(datetime(y, mo, d, h, mi, tzinfo=TH_TZ).timestamp() * 1000)
    except ValueError:
        return None


def _bma(path, mock):
    # เว็บ กทม. ให้ข้อมูลแผนที่ผ่าน POST เปล่า (แบบเดียวกับหน้าเว็บของเขา) ไม่ปลอมหัวข้อใดๆ
    raw = get(BMA + path, data=b'', timeout=45, mock=mock, tries=2)
    j = json.loads(raw)
    if not isinstance(j, list):
        raise RuntimeError('รูปแบบข้อมูล กทม. เปลี่ยน')
    return j


def bkk_canal():
    rows = []
    for x in _bma('/water/PageMap/GoogleMap', 'bma_water.json'):
        lon, lat = _f(x.get('longitude'), 5), _f(x.get('latitude'), 5)
        if lon is None or lat is None or not _in_box(lon, lat, 0.12):
            continue
        banks = [b for b in (_f(x.get('left_bank')), _f(x.get('right_bank'))) if b is not None]
        name = re.sub(r'\s*\*+\s*$', '', str(x.get('water_shortname') or x.get('water_name') or '')).strip()
        rows.append([str(x.get('water_code') or ''), name, lon, lat, _f(x.get('wl_in')), min(banks) if banks else None,
                     _f(x.get('warning')), _f(x.get('critical')), str(x.get('txtStatus') or '').strip(),
                     _ms_net(x.get('site_timestamp')) or _ms_th(x.get('site_timestampTH')),
                     re.sub(r'^(เขต|อำเภอ)', '', str(x.get('district_name') or '').strip()), str(x.get('river_name') or '').strip(),
                     str(x.get('water_url') or '')])
    if len(rows) < 30:
        raise RuntimeError('ได้จุดวัดน้ำในคลองน้อยผิดปกติ %d จุด' % len(rows))
    return {'from': 'bma', 'cols': ['code', 'name', 'lon', 'lat', 'wl', 'bank', 'warn', 'crit', 'st', 'ms', 'dist', 'river', 'url'], 'rows': rows}


def bkk_rain():
    cols = ['code', 'name', 'lon', 'lat', 'r15', 'r1h', 'r3h', 'r24h', 'ms', 'dist', 'ok']
    try:
        rows = []
        for x in _bma('/rain/PageMap/GetDataForUpdate', 'bma_rain.json'):
            lon, lat = _f(x.get('longitude'), 5), _f(x.get('latitude'), 5)
            if lon is None or lat is None or not _in_box(lon, lat, 0.12):
                continue
            rows.append([str(x.get('rain_code') or ''), str(x.get('rain_shortname') or x.get('rain_name') or '').strip(), lon, lat,
                         _f(x.get('rf15min'), 1), _f(x.get('rf1hr'), 1), _f(x.get('rf3hr'), 1), _f(x.get('rf24hr'), 1),
                         _ms_net(x.get('site_timestamp')) or _ms_th(x.get('site_timestampTH')), str(x.get('district_name') or '').strip(),
                         1 if x.get('status') in (1, '1', True) else 0])
        if len(rows) < 20:
            raise RuntimeError('ได้สถานีฝนน้อยผิดปกติ %d สถานี' % len(rows))
        return {'from': 'bma', 'cols': cols, 'rows': rows}
    except Exception as e:  # noqa: BLE001
        print('   bkk ฝน กทม. ไม่ตอบ (%s) ใช้ ThaiWater ฝนสะสมวันนี้แทน' % str(e)[:120], flush=True)
    j = json.loads(get(TW + 'rain_today', timeout=90, mock='tw_rain_today.json'))
    now, rows = time.time() * 1000, []
    for x in j.get('data') or []:
        st, geo = x.get('station') or {}, x.get('geocode') or {}
        lon, lat = _f(st.get('tele_station_long'), 5), _f(st.get('tele_station_lat'), 5)
        if lon is None or lat is None or not _in_box(lon, lat, 0.05):
            continue
        ms = _ms_th(x.get('rainfall_datetime'))
        if not ms or now - ms > 36 * 3600e3:
            continue
        rows.append([str(st.get('tele_station_oldcode') or st.get('id') or ''), str((st.get('tele_station_name') or {}).get('th') or '').strip(), lon, lat,
                     None, None, None, _f(x.get('rainfall_value'), 1), ms, str((geo.get('amphoe_name') or {}).get('th') or ''), 1])
    if len(rows) < 10:
        raise RuntimeError('ThaiWater: ได้สถานีฝนในกรุงเทพน้อยผิดปกติ %d สถานี' % len(rows))
    return {'from': 'thaiwater', 'note': 'r24h = ฝนสะสมตั้งแต่ 07:00 วันนี้', 'cols': cols, 'rows': rows}


def bkk_road():
    cols = ['code', 'name', 'lon', 'lat', 'cm', 'st', 'ms', 'kind', 'url']
    try:
        rows = []
        for x in _bma('/flood/PageMap/GoogleMap', 'bma_flood.json'):
            lon, lat = _f(x.get('longitude'), 5), _f(x.get('latitude'), 5)
            if lon is None or lat is None or not _in_box(lon, lat, 0.12):
                continue
            name = re.sub(r'\s*\*+\s*$', '', str(x.get('flood_short_name') or x.get('flood_name') or '')).strip()
            rows.append([str(x.get('flood_code') or ''), name, lon, lat, _f(x.get('flood'), 0), str(x.get('chkStatustxt') or '').strip(),
                         _ms_net(x.get('site_timestamp')) or _ms_th(x.get('site_timestatmpTH')), int(x.get('typesite') or 0), str(x.get('web_url') or '')])
        if len(rows) < 20:
            raise RuntimeError('ได้จุดวัดน้ำบนถนนน้อยผิดปกติ %d จุด' % len(rows))
        return {'from': 'bma', 'cols': cols, 'rows': rows}
    except Exception as e:  # noqa: BLE001
        print('   bkk น้ำบนถนน กทม. ไม่ตอบ (%s) ใช้ ThaiWater แทน' % str(e)[:120], flush=True)
    j = json.loads(get(TW + 'flood_road', timeout=60, mock='tw_flood_road.json'))
    rows = []
    for x in j.get('data') or []:
        st = x.get('station') or {}
        lon, lat = _f(st.get('floodroad_long'), 5), _f(st.get('floodroad_lat'), 5)
        if lon is None or lat is None or not _in_box(lon, lat, 0.05):
            continue
        cm = _f(x.get('floodroad_value'), 0)
        rows.append([str(st.get('floodroad_oldcode') or st.get('id') or ''), str((st.get('floodroad_name') or {}).get('th') or '').strip(), lon, lat, cm,
                     'มีน้ำ' if cm and cm > 0 else 'ปกติ', _ms_th(x.get('floodroad_datetime')), 1, ''])
    if len(rows) < 10:
        raise RuntimeError('ThaiWater: ได้จุดวัดน้ำบนถนนน้อยผิดปกติ %d จุด' % len(rows))
    return {'from': 'thaiwater', 'cols': cols, 'rows': rows}


def bkk_air():
    j = json.loads(get(AIR4THAI, timeout=45, mock='air4thai.json'))
    rows = []
    for s in j.get('stations') or []:
        lon, lat = _f(s.get('long'), 5), _f(s.get('lat'), 5)
        if lon is None or lat is None or not _in_box(lon, lat, 0.08):
            continue
        last = s.get('AQILast') or {}
        pm = _f((last.get('PM25') or {}).get('value'), 1)
        if pm is not None and pm < 0:
            pm = None
        aqi = _f((last.get('AQI') or {}).get('aqi'), 0)
        if aqi is not None and aqi < 0:
            aqi = None
        rows.append([str(s.get('stationID') or ''), str(s.get('nameTH') or s.get('nameEN') or '').strip(), lon, lat, pm, aqi,
                     _ms_th('%s %s' % (last.get('date') or '', last.get('time') or '')), str(s.get('areaTH') or '').strip()])
    if len(rows) < 3:
        raise RuntimeError('ได้สถานีคุณภาพอากาศในกรุงเทพน้อยผิดปกติ %d สถานี' % len(rows))
    return {'from': 'air4thai', 'cols': ['id', 'name', 'lon', 'lat', 'pm25', 'aqi', 'ms', 'area'], 'rows': rows}


def bkk_river():
    """แม่น้ำเจ้าพระยาจากเหนือเขื่อนลงทะเล (ThaiWater สสน.) เฉพาะสถานีบนลำน้ำหลักและในกรุงเทพ"""
    j = json.loads(get(TW + 'waterlevel_load', timeout=90, mock='tw_waterlevel.json'))
    wd = j.get('waterlevel_data')
    data = wd if isinstance(wd, list) else ((wd or {}).get('data') or [])
    now, rows = time.time() * 1000, []
    for x in data:
        st, geo = x.get('station') or {}, x.get('geocode') or {}
        basin = str(((x.get('basin') or {}).get('basin_name') or {}).get('th') or '')
        if 'เจ้าพระยา' not in basin:
            continue
        name = str((st.get('tele_station_name') or {}).get('th') or '').strip()
        lon, lat = _f(st.get('tele_station_long'), 5), _f(st.get('tele_station_lat'), 5)
        if lon is None or lat is None or re.match(r'^(คลอง|ค\.|ปตร|ทรบ|สถานีสูบ|ประตู|ปากคลอง)', name):
            continue
        if not (RIVER_KEY.search(name) or _in_box(lon, lat, 0.02)):
            continue
        ms = _ms_th(x.get('waterlevel_datetime'))
        if not ms or now - ms > 48 * 3600e3:
            continue
        rows.append([name, lon, lat, _f(x.get('waterlevel_msl')), _f(st.get('min_bank')), _f(x.get('storage_percent'), 1), ms,
                     str((geo.get('province_name') or {}).get('th') or ''), x.get('situation_level')])
    rows.sort(key=lambda r: -r[2])
    if not rows:
        raise RuntimeError('ไม่พบสถานีแม่น้ำเจ้าพระยา')
    return {'from': 'thaiwater', 'cols': ['name', 'lon', 'lat', 'wl', 'bank', 'pct', 'ms', 'prov', 'lvl'], 'rows': rows}


def _traffy_ts(s):
    try:
        return datetime.strptime(str(s)[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=UTC).timestamp()
    except ValueError:
        return None


def bkk_traffy():
    since, t0 = time.time() - 24 * 3600, time.time()
    by, rows, n, pages = {}, [], 0, 0
    for page in range(6):  # เรื่องใหม่สุดก่อน หน้าละ 1,000 เรื่อง (ราว 8 ชม.) จนครบ 24 ชม.
        if page and time.time() - t0 > 80:
            break
        try:
            j = json.loads(get(TRAFFY + '?limit=1000&offset=%d' % (page * 1000), timeout=60, mock='traffy.json' if page == 0 else 'traffy_%d.json' % page, tries=2))
        except Exception:  # noqa: BLE001
            if page == 0:
                raise
            break
        res = j.get('results') or []
        pages += 1
        oldest = None
        for x in res:
            ts = _traffy_ts(x.get('timestamp'))
            if ts is None:
                continue
            oldest = ts if oldest is None else min(oldest, ts)
            if ts < since:
                continue
            c = x.get('coords') or []
            try:
                lon, lat = round(float(c[0]), 5), round(float(c[1]), 5)
            except (TypeError, ValueError, IndexError):
                continue
            if not _in_box(lon, lat, 0.03):
                continue
            n += 1
            m = re.search(r'เขต\s*([^\s,]+)', str(x.get('address') or ''))
            d = m.group(1) if m else ''
            by[d] = by.get(d, 0) + 1
            types = ' '.join(t for t in (x.get('problem_type_abdul') or []) if t)
            # ข้อความผู้แจ้งใช้คัดว่าเป็นเรื่องน้ำหรือไม่เท่านั้น ไม่เก็บลงไฟล์
            if re.search(r'น้ำท่วม|ท่อระบายน้ำ', types) or FLOOD_RE.search(str(x.get('description') or '')):
                rows.append([str(x.get('ticket_id') or ''), lon, lat, str(x.get('state') or '')[:24], int(ts * 1000), d])
        if not res or (oldest is not None and oldest < since):
            break
    if n == 0:
        raise RuntimeError('ไม่ได้เรื่องจาก Traffy Fondue ใน 24 ชม.')
    rows.sort(key=lambda r: -r[4])
    return {'from': 'traffy', 'hours': 24, 'n': n, 'pages': pages, 'by': by, 'cols': ['id', 'lon', 'lat', 'state', 'ms', 'dist'], 'rows': rows[:2000]}


def bkk_hist(out, doc):
    """เก็บค่าย้อนหลัง 24 ชม. ทุกรอบ (ราว 20 นาที) ไว้ให้หน้าเว็บเล่นย้อนดู"""
    p = os.path.join(out, BKK_HIST)
    try:
        h = json.load(open(p, encoding='utf-8'))
    except (OSError, ValueError):
        h = {}
    if h.get('v') != 1 or not isinstance(h.get('ts'), list):
        h = {'v': 1, 'ts': []}
    keys = (('canal', 4), ('rain', 5), ('road', 4))
    for k, _ in keys:
        h.setdefault(k, {})
    now = int(time.time())
    if h['ts'] and now - h['ts'][-1] < 12 * 60:
        return len(h['ts'])
    cut = 0
    while cut < len(h['ts']) and now - h['ts'][cut] > 24 * 3600 + 900:
        cut += 1
    h['ts'] = h['ts'][cut:]
    for k, _ in keys:
        for code in list(h[k]):
            h[k][code] = h[k][code][cut:]
    idx = len(h['ts'])
    h['ts'].append(now)
    for k, col in keys:
        sec = doc.get(k) or {}
        fresh = (doc.get('src') or {}).get(k, {}).get('ok') and sec.get('from') == 'bma'
        vals = {}
        if fresh:
            for r in sec.get('rows') or []:
                v = r[col]
                if k == 'road' and re.search(r'ขัดข้อง', str(r[5] or '')):
                    v = None
                vals[r[0]] = v
        for code in set(h[k]) | set(vals):
            arr = h[k].setdefault(code, [])
            arr.extend([None] * (idx - len(arr)))
            del arr[idx:]
            arr.append(vals.get(code))
        for code in list(h[k]):
            if all(v is None for v in h[k][code]):
                del h[k][code]
    h['t'] = now_iso()
    write_json(out, BKK_HIST, h)
    return len(h['ts'])


def task_bkk(out):
    try:
        prev = json.load(open(os.path.join(out, 'bkk.json'), encoding='utf-8'))
    except (OSError, ValueError):
        prev = {}
    doc = {'v': 1, 't': now_iso(), 'src': {}}
    for name, fn in (('canal', bkk_canal), ('rain', bkk_rain), ('road', bkk_road), ('air', bkk_air), ('river', bkk_river), ('traffy', bkk_traffy)):
        t0 = time.time()
        try:
            doc[name] = fn()
            doc['src'][name] = {'ok': True, 'from': doc[name].get('from', ''), 'n': len(doc[name].get('rows') or []), 's': round(time.time() - t0, 1)}
        except Exception as e:  # noqa: BLE001  แหล่งหนึ่งพังไม่กระทบแหล่งอื่น
            doc['src'][name] = {'ok': False, 'err': str(e)[:200]}
            print('   bkk %s ไม่สำเร็จ: %s' % (name, str(e)[:160]), flush=True)
            if prev.get(name):  # ใช้ของรอบก่อน หน้าเว็บจะเห็นเวลาเก่าและติดป้าย "ข้อมูลเก่า" เอง
                doc[name] = prev[name]
                doc['src'][name]['kept'] = prev.get('t')
    if not any(v.get('ok') for v in doc['src'].values()):
        raise RuntimeError('ทุกแหล่งไม่ตอบ: ' + '; '.join('%s=%s' % (k, v.get('err', '')[:60]) for k, v in doc['src'].items()))
    write_json(out, 'bkk.json', doc)
    try:
        nh = bkk_hist(out, doc)
    except Exception as e:  # noqa: BLE001
        nh = 'x'
        print('   bkk ประวัติ 24 ชม. ไม่สำเร็จ: %s' % e, flush=True)
    info = {k: (v.get('from', '') + ':' + str(v.get('n'))) if v.get('ok') else 'x' for k, v in doc['src'].items()}
    info['hist'] = nh
    return info


# ---------------------------------------------------------------- โครงเมืองกรุงเทพ (สัปดาห์ละครั้ง)
# เขต 50 เขต เส้นรถไฟฟ้า สถานี และสถานที่สำคัญจาก OpenStreetMap (ODbL) + สถานีสูบน้ำ ประตูระบายน้ำ จุดเสี่ยงน้ำท่วม จาก data.bangkok.go.th
# ถามทีละส่วน ส่วนที่ได้แล้วเก็บใน bkk_base_parts.json รอบหน้าถามเฉพาะที่ยังขาด (เซิร์ฟเวอร์ Overpass ยุ่งบ่อย)
BKK_PARTS = 'bkk_base_parts.json'
OVP_BOX = '13.40,100.25,14.10,100.98'  # ใต้ ตะวันตก เหนือ ตะวันออก
OVP_IN = '13.48,100.30,13.97,100.96'
BKK_MARKS = [  # (ชื่อใน OSM แบบขึ้นต้น, ชื่อที่แสดง, ชื่ออังกฤษ, ชนิด)
    ('วัดพระศรีรัตนศาสดาราม', 'วัดพระแก้ว', 'Wat Phra Kaew', 'temple'), ('พระบรมมหาราชวัง', 'พระบรมมหาราชวัง', 'Grand Palace', 'palace'),
    ('วัดพระเชตุพน', 'วัดโพธิ์', 'Wat Pho', 'temple'), ('วัดอรุณราชวราราม', 'วัดอรุณฯ', 'Wat Arun', 'temple'),
    ('วัดสระเกศ', 'ภูเขาทอง', 'Golden Mount', 'temple'), ('วัดเบญจมบพิตร', 'วัดเบญจมบพิตรฯ', 'Wat Benchamabophit', 'temple'),
    ('วัดไตรมิตร', 'วัดไตรมิตร', 'Wat Traimit', 'temple'), ('วัดปากน้ำ', 'วัดปากน้ำ', 'Wat Paknam', 'temple'),
    ('เสาชิงช้า', 'เสาชิงช้า', 'Giant Swing', 'monument'), ('อนุสาวรีย์ประชาธิปไตย', 'อนุสาวรีย์ประชาธิปไตย', 'Democracy Monument', 'monument'),
    ('อนุสาวรีย์ชัยสมรภูมิ', 'อนุสาวรีย์ชัยฯ', 'Victory Monument', 'monument'), ('พระที่นั่งอนันตสมาคม', 'พระที่นั่งอนันตสมาคม', 'Ananta Samakhom', 'palace'),
    ('สวนลุมพินี', 'สวนลุมพินี', 'Lumphini Park', 'park'), ('สวนจตุจักร', 'สวนจตุจักร', 'Chatuchak Park', 'park'),
    ('สวนเบญจกิติ', 'สวนเบญจกิติ', 'Benjakitti Park', 'park'), ('ตลาดนัดจตุจักร', 'ตลาดนัดจตุจักร', 'Chatuchak Market', 'market'),
    ('ไอคอนสยาม', 'ไอคอนสยาม', 'ICONSIAM', 'mall'), ('สยามพารากอน', 'สยามพารากอน', 'Siam Paragon', 'mall'),
    ('เซ็นทรัลเวิลด์', 'เซ็นทรัลเวิลด์', 'centralwOrld', 'mall'), ('เอเชียทีค', 'เอเชียทีค', 'Asiatique', 'market'),
    ('สถานีกลางกรุงเทพอภิวัฒน์|สถานีกลางบางซื่อ', 'สถานีกลางกรุงเทพอภิวัฒน์', 'Krung Thep Aphiwat', 'station'),
    ('สถานีรถไฟกรุงเทพ|หัวลำโพง', 'หัวลำโพง', 'Hua Lamphong', 'station'),
    ('ท่าอากาศยานดอนเมือง|ท่าอากาศยานนานาชาติดอนเมือง', 'สนามบินดอนเมือง', 'Don Mueang Airport', 'airport'),
    ('ท่าอากาศยานสุวรรณภูมิ', 'สนามบินสุวรรณภูมิ', 'Suvarnabhumi Airport', 'airport'),
    ('สะพานพระราม 8', 'สะพานพระราม 8', 'Rama VIII Bridge', 'bridge'), ('สะพานพระพุทธยอดฟ้า', 'สะพานพุทธฯ', 'Memorial Bridge', 'bridge'),
    ('สะพานภูมิพล', 'สะพานภูมิพล', 'Bhumibol Bridge', 'bridge'),
    ('มหาวิทยาลัยเกษตรศาสตร์', 'ม.เกษตรศาสตร์', 'Kasetsart University', 'campus'), ('จุฬาลงกรณ์มหาวิทยาลัย', 'จุฬาฯ', 'Chulalongkorn University', 'campus'),
    ('โรงพยาบาลศิริราช', 'รพ.ศิริราช', 'Siriraj Hospital', 'hospital'), ('ศาลาว่าการกรุงเทพมหานคร', 'ศาลาว่าการ กทม.', 'Bangkok City Hall', 'gov'),
    ('ศูนย์ราชการเฉลิมพระเกียรติ', 'ศูนย์ราชการฯ แจ้งวัฒนะ', 'Government Complex', 'gov'),
    ('พิพิธภัณฑสถานแห่งชาติ พระนคร', 'พิพิธภัณฑ์แห่งชาติ', 'National Museum', 'museum'),
    ('ศูนย์การประชุมแห่งชาติสิริกิติ์', 'ศูนย์ฯ สิริกิติ์', 'QSNCC', 'venue'), ('ราชมังคลากีฬาสถาน', 'ราชมังคลากีฬาสถาน', 'Rajamangala Stadium', 'stadium'),
    ('สนามศุภชลาศัย', 'สนามศุภชลาศัย', 'Suphachalasai Stadium', 'stadium'),
    ('ใบหยก 2|อาคารใบหยก 2|ใบหยกสกาย|ใบหยก ทาวเวอร์ 2', 'ใบหยก 2', 'Baiyoke Tower II', 'tower'),
    ('คิง เพาเวอร์ มหานคร|คิงเพาเวอร์ มหานคร|มหานคร$', 'คิง เพาเวอร์ มหานคร', 'King Power MahaNakhon', 'tower'),
    ('สเตท ทาวเวอร์|สเตททาวเวอร์', 'สเตท ทาวเวอร์', 'State Tower', 'tower'),
    ('ท่าเรือกรุงเทพ', 'ท่าเรือกรุงเทพ', 'Bangkok Port', 'port'), ('ถนนเยาวราช|เยาวราช$', 'เยาวราช', 'Yaowarat', 'street'),
]
BMA_CKAN = 'https://data.bangkok.go.th/dataset/'
BMA_CSV = {
    'gate': BMA_CKAN + '83ae5639-a37f-4e19-bd37-e1c97930f39d/resource/42948cf7-0759-4719-a32f-8eeabd89b8ee/download/floodgate.csv',
    'pump': BMA_CKAN + 'f482270f-04cf-4df1-a120-f808110a7a8a/resource/0a30a58c-213f-4aec-bf16-7dd7f61fb5fd/download/pump-station.csv',
    'wpump': BMA_CKAN + '82cb9fcc-ddea-436a-abfa-eb5dc9fc85fc/resource/53205669-40f9-4cb6-b902-7b8fbc945919/download/water-pump-station.csv',
    'risk': BMA_CKAN + '25bc3f04-5707-4b60-a885-5ad45aa38cd6/resource/837b7fb6-ce1f-4356-881e-6bf14eeb075f/download/flood_risk26.csv',
}
TRAIN_KEEP = re.compile(r'แดง|Red|Airport|แอร์พอร์ต|ARL|SRTET', re.I)
LINE_COL = {'subway': '#3B82F6', 'light_rail': '#22C55E', 'monorail': '#EAB308', 'train': '#EF4444'}


def _ovp(q, mock):
    err = None
    for u in OVERPASS_MIRRORS:
        try:
            raw = get(u, timeout=200, data=urllib.parse.urlencode({'data': q}).encode(), mock=mock, tries=1)
            if raw[:1] != b'{':
                raise RuntimeError('Overpass ตอบไม่ใช่ JSON (ยุ่ง)')
            return json.loads(raw)
        except Exception as e:  # noqa: BLE001
            err = e
            print('   bkkbase ที่ %s ไม่สำเร็จ: %s' % (u.split('/')[2], str(e)[:120]), flush=True)
            if MOCK is not None:
                break
    raise err


def _dp(pts, tol):
    """ลดจุดเส้น (Douglas-Peucker) พิกัดองศา ปรับแกน x ตามละติจูดกรุงเทพ"""
    if len(pts) < 4:
        return pts
    kx = math.cos(math.radians(13.75))
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop()
        ax, ay, bx, by = pts[a][0] * kx, pts[a][1], pts[b][0] * kx, pts[b][1]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        md, mi = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * kx, pts[i][1]
            t = ((px - ax) * dx + (py - ay) * dy) / L if L else 0.0
            t = max(0.0, min(1.0, t))
            ex, ey = ax + t * dx - px, ay + t * dy - py
            d = ex * ex + ey * ey
            if d > md:
                md, mi = d, i
        if mi > 0 and md > tol * tol:
            keep[mi] = True
            st.append((a, mi))
            st.append((mi, b))
    return [p for p, k in zip(pts, keep) if k]


def _q5(pts):
    return [[round(p[0], 5), round(p[1], 5)] for p in pts]


def _rings(ways):
    """ต่อเส้นขอบหลายเส้นให้เป็นวงปิด"""
    ways = [w[:] for w in ways if len(w) >= 2]
    rings = []
    while ways:
        ring = ways.pop(0)
        guard = 0
        while ring[0] != ring[-1] and guard < 5000:
            guard += 1
            end = ring[-1]
            k = next((i for i, w in enumerate(ways) if w[0] == end or w[-1] == end), -1)
            if k < 0:
                break
            w = ways.pop(k)
            if w[0] != end:
                w = w[::-1]
            ring += w[1:]
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def _area_km2(r):
    kx, ky = math.cos(math.radians(13.75)) * 111.32, 110.57
    s = 0.0
    for i in range(len(r) - 1):
        s += r[i][0] * kx * r[i + 1][1] * ky - r[i + 1][0] * kx * r[i][1] * ky
    return s / 2


def _inside(pt, ring):
    x, y, c = pt[0], pt[1], False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def base_districts():
    j = _ovp('[out:json][timeout:180];rel["boundary"="administrative"]["admin_level"="6"](%s);out geom;' % OVP_IN, 'ovp_districts.json')
    out = []
    for el in j.get('elements') or []:
        tg = el.get('tags') or {}
        name = str(tg.get('name') or '')
        if not name.startswith('เขต'):  # อำเภอของจังหวัดข้างเคียงขึ้นต้นด้วย "อำเภอ"
            continue
        outer = [[[p['lon'], p['lat']] for p in m.get('geometry') or []] for m in el.get('members') or [] if m.get('type') == 'way' and m.get('role') != 'inner']
        inner = [[[p['lon'], p['lat']] for p in m.get('geometry') or []] for m in el.get('members') or [] if m.get('type') == 'way' and m.get('role') == 'inner']
        ro, ri = _rings(outer), _rings(inner)
        if not ro:
            continue
        km2 = sum(abs(_area_km2(r)) for r in ro) - sum(abs(_area_km2(r)) for r in ri)
        polys = [[_q5(_dp(r, 0.00018))] for r in ro]
        for r in ri:
            for poly in polys:
                if _inside(r[0], poly[0]):
                    poly.append(_q5(_dp(r, 0.00018)))
                    break
        big = max(ro, key=lambda r: abs(_area_km2(r)))
        cx = sum(p[0] for p in big[:-1]) / (len(big) - 1)
        cy = sum(p[1] for p in big[:-1]) / (len(big) - 1)
        lab = tg.get('label_point')
        out.append({'id': el.get('id'), 'th': name[3:].strip(), 'en': re.sub(r'\s*District$', '', str(tg.get('name:en') or '')).strip(),
                    'km2': round(km2, 1), 'c': [round(cx, 4), round(cy, 4)], 'g': polys, 'lab': bool(lab)})
    if len(out) < 40:
        raise RuntimeError('ได้เขตไม่ครบ (%d เขต)' % len(out))
    out.sort(key=lambda d: d['th'])
    return out


def base_lines():
    j = _ovp('[out:json][timeout:180];rel["type"="route"]["route"~"^(subway|light_rail|monorail|train)$"](%s);out geom(%s);' % (OVP_BOX, OVP_BOX), 'ovp_lines.json')
    lines = {}
    for el in j.get('elements') or []:
        tg = el.get('tags') or {}
        kind = tg.get('route')
        label = ' '.join(str(tg.get(k) or '') for k in ('name', 'name:en', 'network', 'ref', 'operator'))
        if kind == 'train' and not TRAIN_KEEP.search(label):
            continue  # รถไฟทางไกลที่วิ่งผ่านกรุงเทพไม่เอา
        name = re.split(r'\s*[:：]\s*', str(tg.get('name') or ''))[0].strip()
        en = re.split(r'\s*[:：]\s*', str(tg.get('name:en') or ''))[0].strip()
        col = str(tg.get('colour') or '').strip() or LINE_COL.get(kind, '#9CA3AF')
        if not re.match(r'^#[0-9A-Fa-f]{3,8}$', col):
            col = LINE_COL.get(kind, '#9CA3AF')
        key = (col.upper(), str(tg.get('ref') or name or en))
        L = lines.setdefault(key, {'k': kind, 'th': name, 'en': en, 'ref': str(tg.get('ref') or ''), 'net': str(tg.get('network') or ''),
                                   'col': col, 'ways': {}})
        for m in el.get('members') or []:
            if m.get('type') != 'way' or m.get('role') in ('platform', 'stop', 'stop_exit_only', 'stop_entry_only'):
                continue
            g = m.get('geometry') or []
            pts = [[p['lon'], p['lat']] for p in g if p]
            if len(pts) >= 2:
                L['ways'][m.get('ref')] = pts
    out = []
    for L in lines.values():
        if not L['ways']:
            continue
        geom, km = [], 0.0
        for pts in L['ways'].values():
            for i in range(len(pts) - 1):
                km += _km(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            geom.append(_q5(_dp(pts, 0.00005)))
        out.append({'k': L['k'], 'th': L['th'], 'en': L['en'], 'ref': L['ref'], 'net': L['net'], 'col': L['col'], 'km': round(km, 1), 'g': geom})
    if len(out) < 5:
        raise RuntimeError('ได้เส้นรถไฟฟ้าน้อยผิดปกติ %d เส้น' % len(out))
    out.sort(key=lambda d: (d['k'], d['net'], d['th']))
    return out


def _km(lon1, lat1, lon2, lat2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(max(0.0, a)))


def _center(el):
    if 'lat' in el and 'lon' in el:
        return el['lon'], el['lat']
    c = el.get('center') or {}
    if 'lat' in c:
        return c['lon'], c['lat']
    return None


def base_stations():
    j = _ovp('[out:json][timeout:120];nwr["railway"="station"](%s);out center tags;' % OVP_BOX, 'ovp_stations.json')
    out, seen = [], set()
    for el in j.get('elements') or []:
        tg, c = el.get('tags') or {}, _center(el)
        name = str(tg.get('name') or '').strip()
        if not c or not name:
            continue
        kind = str(tg.get('station') or ('train' if tg.get('train') == 'yes' else 'train'))
        key = (name, round(c[0], 3), round(c[1], 3))
        if key in seen:
            continue
        seen.add(key)
        out.append([name, str(tg.get('name:en') or ''), round(c[0], 5), round(c[1], 5), kind, str(tg.get('network') or tg.get('operator') or '')])
    if len(out) < 50:
        raise RuntimeError('ได้สถานีน้อยผิดปกติ %d สถานี' % len(out))
    return out


def base_marks():
    pat = '|'.join(p[0] for p in BKK_MARKS)
    q = ('[out:json][timeout:150];(nwr["name"~"^(%s)"](%s);way["building"]["height"](%s)(if: number(t["height"]) >= 220););out center tags;'
         % (pat, OVP_IN, OVP_IN))
    j = _ovp(q, 'ovp_marks.json')
    out = base_marks_from(j.get('elements') or [])
    if len(out) < 10:
        raise RuntimeError('ได้สถานที่สำคัญน้อยผิดปกติ %d แห่ง' % len(out))
    return out


def base_marks_from(els):
    """เลือกวัตถุที่ดีที่สุดของแต่ละชื่อในรายการ + ตึกสูงเกิน 220 ม. (ใช้ทั้งกับผล Overpass และไฟล์ OSM ทั้งประเทศ)"""
    out = []
    for pat1, disp, en, kind in BKK_MARKS:
        rx = re.compile('^(%s)' % pat1)
        best, bs = None, -1
        for el in els:
            tg = el.get('tags') or {}
            name = str(tg.get('name') or '')
            if not rx.search(name) or not _center(el):
                continue
            s = (3 if tg.get('wikidata') else 0) + (2 if name == pat1.split('|')[0] else 0) + (1 if el.get('type') != 'node' else 0) + \
                (1 if any(k in tg for k in ('tourism', 'historic', 'building', 'aeroway', 'railway', 'leisure', 'amenity')) else 0)
            if s > bs:
                best, bs = el, s
        if best:
            c = _center(best)
            out.append([disp, en, round(c[0], 5), round(c[1], 5), kind])
    for el in els:  # ตึกสูงเกิน 220 ม. ที่ยังไม่อยู่ในรายการ
        tg, c = el.get('tags') or {}, _center(el)
        if not c or 'height' not in tg or not tg.get('name'):
            continue
        if any(_km(c[0], c[1], o[2], o[3]) < 0.2 for o in out):
            continue
        h = _f(re.sub(r'[^\d.]', '', str(tg.get('height'))), 0)
        if h is None or h < 220:
            continue
        out.append([str(tg.get('name'))[:40], str(tg.get('name:en') or '')[:40], round(c[0], 5), round(c[1], 5), 'tower', h])
    return out


def _csv_rows(url, mock):
    raw = get(url, timeout=60, mock=mock, tries=2).decode('utf-8-sig', 'replace')
    return list(csv.DictReader(io.StringIO(raw)))


def _ll(lon, lat):
    lon, lat = _f(lon, 5), _f(lat, 5)
    if lon is None or lat is None:
        return None
    if lat > 90 and lon < 90:  # บางแถวสลับคอลัมน์
        lon, lat = lat, lon
    return (lon, lat) if _in_box(lon, lat, 0.1) else None


def base_infra():
    out = {}
    for k in ('gate', 'pump'):
        rows = []
        for r in _csv_rows(BMA_CSV[k], 'ckan_%s.csv' % k):
            ll = _ll(r.get('long'), r.get('lat'))
            if not ll:
                continue
            cap = _f(r.get('gate'), 1) if k == 'pump' else None
            rows.append([re.sub(r'\s+', ' ', str(r.get('name') or '')).strip(), re.sub(r'^เขต', '', str(r.get('district') or '').strip()), ll[0], ll[1], cap])
        out[k] = rows
    rows = []
    for r in _csv_rows(BMA_CSV['wpump'], 'ckan_wpump.csv'):
        ll = _ll(r.get('COOR_X'), r.get('COOR_Y'))
        if ll:
            rows.append([re.sub(r'\s+', ' ', str(r.get('PUMP_NAME') or '')).strip(), str(r.get('CANAL_NAME') or '').strip(), ll[0], ll[1], _f(r.get('GP_CAPACITY'), 1)])
    out['wpump'] = rows
    rows = []
    for r in _csv_rows(BMA_CSV['risk'], 'ckan_risk.csv'):
        ll = _ll(r.get('UTM_X'), r.get('UTM_Y'))
        if ll:
            rows.append([str(r.get('STATION_NAME') or '').strip(), str(r.get('DISTRICT_NAME') or '').strip(), ll[0], ll[1], str(r.get('GROUP_D') or '').strip()])
    out['risk'] = rows
    if sum(len(v) for v in out.values()) < 100:
        raise RuntimeError('ได้ข้อมูลโครงสร้างระบายน้ำน้อยผิดปกติ')
    return out


BASE_PARTS = (('districts', base_districts), ('lines', base_lines), ('stations', base_stations), ('marks', base_marks), ('infra', base_infra))


def task_bkkbase(out):
    pp = os.path.join(out, BKK_PARTS)
    try:
        parts = json.load(open(pp, encoding='utf-8'))
        if time.time() - parts.get('ts', 0) > 3 * 86400:
            parts = {}
    except (OSError, ValueError):
        parts = {}
    parts.setdefault('ts', int(time.time()))
    parts.setdefault('p', {})
    if time.time() - START > 8 * 60:
        return {'skip': 'เวลารอบนี้ไม่พอ'}
    t0, errs = time.time(), []
    for name, fn in BASE_PARTS:
        if name in parts['p']:
            continue
        if time.time() - t0 > 6 * 60:
            errs.append(name + ' (หมดเวลารอบนี้)')
            continue
        try:
            parts['p'][name] = fn()
            print('   bkkbase %s ได้ %d' % (name, len(parts['p'][name])), flush=True)
        except Exception as e:  # noqa: BLE001
            errs.append('%s: %s' % (name, str(e)[:100]))
        time.sleep(0 if MOCK is not None else 2)
    P = parts['p']
    if P:  # เขียนเท่าที่มี หน้าเว็บใช้ส่วนที่ขาดจากไฟล์สำรอง (outdoor-data) ได้
        write_json(out, 'bkk_base.json', {'v': 1, 't': now_iso(), 'from': 'overpass', 'partial': bool(errs),
                                          'src': '© OpenStreetMap contributors (ODbL) · กรุงเทพมหานคร (data.bangkok.go.th)',
                                          'districts': P.get('districts', []), 'lines': P.get('lines', []), 'stations': P.get('stations', []),
                                          'marks': P.get('marks', []), 'infra': P.get('infra', {})})
    if errs:
        write_json(out, BKK_PARTS, parts)
        raise RuntimeError('ยังขาด ' + ' | '.join(errs) + ' (เก็บส่วนที่ได้ไว้ รอบหน้าถามต่อ)')
    try:
        os.remove(pp)
    except OSError:
        pass
    return {'districts': len(P['districts']), 'lines': len(P['lines']), 'stations': len(P['stations']), 'marks': len(P['marks']),
            'infra': {k: len(v) for k, v in P['infra'].items()}}


TASKS = {'fires': task_fires, 'bkk': task_bkk, 'aircraft': task_aircraft, 'ships': task_ships, 'news': task_news, 'sats': task_sats,
         'cables': task_cables, 'bkkbase': task_bkkbase}


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
        if not a.force and not only and name in RETRY_AFTER and not prev.get('ok') and now - prev.get('err_ts', 0) < RETRY_AFTER[name]:
            print('%-8s ข้าม (เพิ่งพังเมื่อ %s รอลองใหม่)' % (name, prev.get('err_at', '')))
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
            rec.update({'ok': False, 'err': str(e)[:300], 'err_at': now_iso(), 'err_ts': int(now)})
            print('%-8s ไม่สำเร็จ (เก็บไฟล์เดิมไว้): %s' % (name, e), flush=True)
        status['tasks'][name] = rec
    status['updated'] = now_iso()
    write_json(a.out, 'status.json', status)
    return 0


if __name__ == '__main__':
    sys.exit(main())
