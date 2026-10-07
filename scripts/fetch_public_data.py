#!/usr/bin/env python3
"""เก็บข้อมูลสาธารณะสำรองของ ChatGeo ไว้ที่ data/live.json

เว็บจะดึงข้อมูลสดจากต้นทางเองทุกครั้งที่เปิด ไฟล์นี้เป็นแค่ "ของสำรอง"
ใช้ตอนต้นทางล่ม หรือเบราว์เซอร์ดึงตรงไม่ได้

ใช้:  python3 scripts/fetch_public_data.py              ดึงจากเน็ตแล้วเขียน data/live.json
      python3 scripts/fetch_public_data.py --from DIR   อ่าน water.json rain.json fc.json จากโฟลเดอร์ (ไว้ทดสอบ)

แหล่งข้อมูล
- ระดับน้ำ และฝนสะสม 24 ชม.: คลังข้อมูลน้ำแห่งชาติ ThaiWater (สสน.)  https://www.thaiwater.net
- พยากรณ์อากาศ 3 วัน: Open-Meteo (CC BY 4.0)  https://open-meteo.com

ชุดไหนดึงไม่ได้ จะเก็บของเดิมในไฟล์ไว้ และไม่ถือว่าล้มเหลว (exit 0)
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'live.json')
TW = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/'
UA = 'ChatGeo/1.0 (+https://choonahakarn.github.io/chatgeo/)'

# ต้องตรงกับ FC_CITIES ใน app.js (ลำดับเดียวกัน)
FC_CITIES = [
    ('th-n', 'เชียงใหม่', 18.79, 98.98),
    ('th-ne', 'ขอนแก่น', 16.43, 102.83),
    ('th-c', 'กรุงเทพฯ', 13.75, 100.50),
    ('th-e', 'ชลบุรี', 13.36, 100.98),
    ('th-w', 'กาญจนบุรี', 14.02, 99.53),
    ('th-s', 'สุราษฎร์ธานี', 9.14, 99.33),
    ('th-s', 'หาดใหญ่', 7.01, 100.47),
]
TAG_RE = re.compile(r'<[^>]*>')


def clean(v, n=80):
    if isinstance(v, dict):
        s = v.get('th') or v.get('en') or ''
    elif v is None:
        s = ''
    else:
        s = str(v)
    return re.sub(r'\s+', ' ', TAG_RE.sub('', s)).strip()[:n]


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def fc_url():
    q = {
        'latitude': ','.join(str(c[2]) for c in FC_CITIES),
        'longitude': ','.join(str(c[3]) for c in FC_CITIES),
        'daily': 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
        'timezone': 'Asia/Bangkok',
        'forecast_days': '3',
    }
    return 'https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q)


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def parse_water(j):
    arr = ((j or {}).get('waterlevel_data') or {}).get('data') or (j or {}).get('data') or []
    out = []
    for r in arr:
        st, g = r.get('station') or {}, r.get('geocode') or {}
        lat, lon = num(st.get('tele_station_lat')), num(st.get('tele_station_long'))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        lv = r.get('situation_level')
        out.append({
            'id': 'w%s' % (st.get('id') or r.get('id')),
            'name': clean(st.get('tele_station_name')), 'prov': clean(g.get('province_name')),
            'river': clean(r.get('river_name')), 'lat': round(lat, 5), 'lon': round(lon, 5),
            'lv': int(lv) if isinstance(lv, (int, float)) and 0 <= lv <= 5 else 0,
            'pct': num(r.get('storage_percent')), 'msl': num(r.get('waterlevel_msl')),
            'diff': num(r.get('diff_wl_bank')), 'diffText': clean(r.get('diff_wl_bank_text'), 40),
            'time': clean(r.get('waterlevel_datetime'), 20),
        })
    return out


def parse_rain(j):
    out = []
    for r in (j or {}).get('data') or []:
        st, g = r.get('station') or {}, r.get('geocode') or {}
        lat, lon, mm = num(st.get('tele_station_lat')), num(st.get('tele_station_long')), num(r.get('rain_24h'))
        if lat is None or lon is None or mm is None or mm <= 0:
            continue
        out.append({
            'id': 'r%s' % (st.get('id') or r.get('id')),
            'name': clean(st.get('tele_station_name')), 'prov': clean(g.get('province_name')),
            'lat': round(lat, 5), 'lon': round(lon, 5), 'mm': mm, 'mm1': num(r.get('rain_1h')),
            'time': clean(r.get('rainfall_datetime'), 20),
        })
    out.sort(key=lambda o: -o['mm'])
    return out


def parse_fc(j):
    arr = j if isinstance(j, list) else [j]
    out = []
    for i, (zone, city, lat, lon) in enumerate(FC_CITIES):
        d = (arr[i] if i < len(arr) else {}).get('daily') or {}
        if not d.get('time'):
            continue
        days = []
        for k, t in enumerate(d['time']):
            days.append({
                'd': clean(t, 10), 'code': num(d['weather_code'][k]),
                'tmax': num(d['temperature_2m_max'][k]), 'tmin': num(d['temperature_2m_min'][k]),
                'rain': num(d['precipitation_sum'][k]), 'prob': num(d['precipitation_probability_max'][k]),
            })
        out.append({'zone': zone, 'city': city, 'lat': lat, 'lon': lon, 'days': days})
    return out


def main(argv):
    src_dir = argv[argv.index('--from') + 1] if '--from' in argv else None
    try:
        with open(OUT, encoding='utf-8') as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    jobs = [
        ('water', TW + 'waterlevel_load', 'water.json', parse_water),
        ('rain', TW + 'rain_24h', 'rain.json', parse_rain),
        ('fc', fc_url(), 'fc.json', parse_fc),
    ]
    tz = dt.timezone(dt.timedelta(hours=7))
    data = {'at': dt.datetime.now(tz).isoformat(timespec='minutes')}
    ok = 0
    for key, url, fname, parse in jobs:
        try:
            if src_dir:
                with open(os.path.join(src_dir, fname), encoding='utf-8') as f:
                    raw = json.load(f)
            else:
                raw = get(url)
            items = parse(raw)
            if not items:
                raise ValueError('ไม่มีข้อมูล')
            data[key] = items
            ok += 1
            print('%s: %d รายการ' % (key, len(items)))
        except Exception as e:  # noqa: BLE001 ดึงไม่ได้ก็ใช้ของเดิม
            data[key] = old.get(key) or []
            print('%s: ดึงไม่ได้ (%s) ใช้ของเดิม %d รายการ' % (key, e, len(data[key])))
    if not ok and old:
        print('ดึงไม่ได้สักชุด ไม่แก้ไฟล์เดิม')
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    os.replace(tmp, OUT)
    print('เขียน data/live.json แล้ว')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
