/* ChatGeo prototype — MapLibre + OpenStreetMap (ผ่าน OpenFreeMap)
   มี 2 หน้า: คุยกับโลก (#) และ สรุปเช้านี้ (#brief)
   ข่าวเป็นข่าวจริงที่รวบรวมไว้ล่วงหน้า (ดู data/data.js) ไม่อัปเดตอัตโนมัติ
   คำตอบในแชทสร้างจากข่าวชุดนี้ ยังไม่ได้ต่อ AI จริง */
(function () {
  'use strict';

  var D = window.CG_DATA;
  var G = window.CG_GEO || null; // แผนที่สำรอง (840 KB) โหลดเฉพาะตอนต้องใช้
  var C = window.CG_COUNTRIES || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var find = function (arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return null; };
  var storyById = function (id) { return find(D.STORIES, function (s) { return s.id === id; }); };
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ข้าม */ }

  var ICO = {
    ext: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
    pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
  };

  /* ---------- แผนที่พื้นหลัง ---------- */
  var OSM_STYLE = {
    dark: 'https://tiles.openfreemap.org/styles/dark',
    light: 'https://tiles.openfreemap.org/styles/positron'
  };
  var params = new URLSearchParams(location.search);
  var styleOverride = params.get('style'); // เช่น ?style=liberty

  // ข้อมูลสาธารณะ
  var SAT_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
  var SAT_ATTR = '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2016</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)';
  var TW_API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/';
  var TW_ATTR = 'ข้อมูลน้ำและฝน: <a href="https://www.thaiwater.net" target="_blank" rel="noopener">ThaiWater (สสน.)</a>';
  var FC_ATTR = 'พยากรณ์: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)';
  // สีระดับน้ำตามเกณฑ์ของคลังข้อมูลน้ำแห่งชาติ
  var WL = {
    1: { t: 'น้อยวิกฤต', c: '#B5652B' }, 2: { t: 'น้อย', c: '#E0A526' }, 3: { t: 'ปกติ', c: '#2FA36B' },
    4: { t: 'น้ำมาก', c: '#2F7FE0' }, 5: { t: 'ล้นตลิ่ง', c: '#E5484D' }
  };
  var RAIN_C = ['#BFE3FF', '#6CB8FF', '#2F80ED', '#1B4FB8'];
  function triIcon(color, dark) {
    var w = 30, h = 26, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var x = cv.getContext('2d');
    x.beginPath(); x.moveTo(3, 3); x.lineTo(w - 3, 3); x.lineTo(w / 2, h - 3); x.closePath();
    x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = dark ? '#0A0F1F' : '#FFFFFF'; x.stroke();
    x.fillStyle = color; x.fill();
    return x.getImageData(0, 0, w, h);
  }
  function readDataPrefs() {
    // เริ่มแบบโล่ง (ข่าว + น้ำจากดาวเทียม + กล้อง) ให้แผนที่ไม่รก เปิดชั้นอื่นได้จากปุ่ม "ชั้นข้อมูล" หรือมุมมองสำเร็จรูป
    // คีย์ cg-data3: ทุกคน (รวมเครื่องที่เคยเปิดหลายชั้นไว้) เริ่มที่หน้าตาแบบใหม่ครั้งเดียว
    var d = { water: false, rain: false, fc: false, sat: false, flood: true, cctv: true, radar: false, cloud: false, wind: false, terrain: false, hist: false, hazard: false, zoning: false, props: false,
      quakes: false, gdacs: false, fires: false, daynight: false, sats: false, aircraft: false, ships: false, news: false, cables: false };
    try {
      var j = JSON.parse(localStorage.getItem('cg-data3') || 'null');
      if (j) Object.keys(d).forEach(function (k) { if (typeof j[k] === 'boolean') d[k] = j[k]; });
    } catch (e) { /* ไม่มี storage */ }
    return d;
  }

  function osmStyleUrl(theme) {
    if (styleOverride) {
      return /^https?:/.test(styleOverride) ? styleOverride : 'https://tiles.openfreemap.org/styles/' + styleOverride;
    }
    return OSM_STYLE[theme];
  }
  // แผนที่ฐานให้เลือกแบบ Longdo (ใช้ได้ฟรีไม่ต้องมีคีย์ ใส่เครดิตทุกแหล่ง)
  // ไม่มี Google / GISTDA / Longdo เพราะต้องใช้คีย์ และเงื่อนไขให้แสดงผ่านแผนที่ของเขาเองเท่านั้น
  var BASES = [
    { id: 'auto', t: 'ChatGeo', sub: 'ตามธีม สว่าง/มืด' },
    { id: 'liberty', t: 'ถนนสีสด', sub: 'OpenFreeMap', url: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'osm', t: 'OpenStreetMap', sub: 'แผนที่มาตรฐาน', raster: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], max: 19,
      thumb: 'https://tile.openstreetmap.org/5/24/14.png', attr: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' },
    { id: 'topo', t: 'ภูมิประเทศ', sub: 'OpenTopoMap', raster: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'], max: 17,
      thumb: 'https://a.tile.opentopomap.org/5/24/14.png', attr: 'แผนที่ © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA) · ข้อมูล © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM' },
    { id: 'sat', t: 'ภาพดาวเทียม', sub: 'Sentinel-2 · EOX', raster: [SAT_URL], max: 14, thumb: SAT_URL.replace('{z}/{y}/{x}', '5/14/24'), attr: SAT_ATTR }
  ];
  var BASE = { id: 'auto' };
  try { var bsv = localStorage.getItem('cg-base'); if (BASES.some(function (b) { return b.id === bsv; })) BASE.id = bsv; } catch (e) { /* ไม่มีที่เก็บ */ }
  function baseStyle(theme) {
    if (usingFallback) return fallbackStyle(theme);
    var id = typeof OPS !== 'undefined' && OPS && OPS.on ? 'auto' : BASE.id;
    var b = BASES.filter(function (x) { return x.id === id; })[0];
    if (!b || b.id === 'auto' || styleOverride) return osmStyleUrl(theme);
    if (b.url) return b.url;
    return { version: 8, name: 'ChatGeo ' + b.id,
      sources: { base: { type: 'raster', tiles: b.raster, tileSize: 256, maxzoom: b.max, attribution: b.attr } },
      layers: [{ id: 'base-bg', type: 'background', paint: { 'background-color': theme === 'dark' ? '#0A0F1F' : '#E8EBF2' } }, { id: 'base', type: 'raster', source: 'base' }] };
  }

  var FB_COLORS = {
    dark: { ocean: '#070C1A', land: '#111A33', border: '#2C3963', coast: '#232D5E' },
    light: { ocean: '#DDE3F6', land: '#FFFFFF', border: '#C7CDE6', coast: '#C3CBEA' }
  };
  var geoLoading = null;
  function ensureGeo() {
    if (window.CG_GEO) return Promise.resolve();
    if (!geoLoading) {
      geoLoading = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = 'data/geo.js';
        sc.onload = resolve;
        sc.onerror = function () { geoLoading = null; reject(new Error('geo')); };
        document.head.appendChild(sc);
      });
    }
    return geoLoading;
  }
  function fallbackStyle(theme) {
    var c = FB_COLORS[theme];
    G = window.CG_GEO || null;
    if (!G) {
      // ยังไม่มีไฟล์แผนที่สำรอง: แสดงพื้นทะเลไปก่อน โหลดเสร็จแล้วค่อยวาดแผ่นดิน
      ensureGeo().then(function () {
        if (!usingFallback) return;
        eachView(function (v) { v.styleLoading = true; v.map.setStyle(fallbackStyle(state.theme), { diff: false }); });
      }).catch(function () { /* ไม่มีเน็ตเลย */ });
      return { version: 8, name: 'ChatGeo loading', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': c.ocean } }] };
    }
    return {
      version: 8,
      name: 'ChatGeo offline',
      sources: {
        'ne-land': { type: 'geojson', data: G.land, attribution: 'แผนที่สำรอง: Natural Earth' },
        'ne-borders': { type: 'geojson', data: G.borders }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': c.ocean } },
        { id: 'land', type: 'fill', source: 'ne-land', paint: { 'fill-color': c.land, 'fill-antialias': true } },
        { id: 'coast', type: 'line', source: 'ne-land', paint: { 'line-color': c.coast, 'line-width': 0.8 } },
        { id: 'borders', type: 'line', source: 'ne-borders', paint: { 'line-color': c.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.4] } }
      ]
    };
  }

  /* ---------- หมวด พื้นที่ และต้นไม้พื้นที่ ---------- */
  var NAME = {}, LONG = {}, RNAME = {};
  D.LAYERS.forEach(function (l) { NAME[l.id] = l.name; LONG[l.id] = l.long; });
  D.REGIONS.forEach(function (r) { RNAME[r.id] = r.name; });
  RNAME.ai = 'AI โลก';
  var HOME = 'th'; // หน้าแรกเปิดที่ประเทศไทย
  var TH = window.CG_TH || null;
  var ZONE_IDS = ['th-n', 'th-ne', 'th-c', 'th-e', 'th-w', 'th-s'];
  var ZONE_FEAT = {};
  if (TH) TH.regions.features.forEach(function (f) { ZONE_FEAT[f.properties.id] = f; C[f.properties.id] = f; });
  // กลุ่ม "ตามพื้นที่" ในหน้าสรุป
  var ZONES = [
    { id: 'th-n', name: 'เหนือ', long: 'ภาคเหนือ' },
    { id: 'th-ne', name: 'อีสาน', long: 'ภาคตะวันออกเฉียงเหนือ (อีสาน)' },
    { id: 'th-c', name: 'กลาง', long: 'ภาคกลางและกรุงเทพฯ' },
    { id: 'th-e', name: 'ตะวันออก', long: 'ภาคตะวันออก' },
    { id: 'th-w', name: 'ตะวันตก', long: 'ภาคตะวันตก' },
    { id: 'th-s', name: 'ใต้', long: 'ภาคใต้' },
    { id: 'ai', name: 'AI โลก', long: 'AI ทั่วโลก · งานวิจัยและผลิตภัณฑ์' },
    { id: 'world', name: 'ต่างประเทศ', long: 'ต่างประเทศ' }
  ];
  // ครบ 77 จังหวัด: เติมจังหวัดที่ยังไม่มี และผูกขอบเขตจริง (Natural Earth) กับทุกจังหวัด
  var PROV_FEAT = {};
  if (TH && TH.provinces) {
    var placeIdx = {};
    D.PLACES.forEach(function (p) { placeIdx[p.id] = p; });
    TH.provinces.features.forEach(function (f) {
      var pr = f.properties, p = placeIdx[pr.id];
      if (!p) {
        p = { id: pr.id, name: pr.name, lon: pr.lon, lat: pr.lat, s: 60 };
        D.PLACES.push(p);
        D.LABELS.push({ kind: 'province', t: pr.name, lon: pr.lon, lat: pr.lat });
      }
      p.parent = pr.zone;
      p.bx = pr.cx; p.by = pr.cy;
      p.hw = Math.max(pr.hw, 0.12); p.hh = Math.max(pr.hh, 0.1);
      p.full = pr.name;
      PROV_FEAT[pr.id] = f;
      C[pr.id] = f;
    });
  }
  var byId = {}, kids = {};
  D.PLACES.forEach(function (p) { byId[p.id] = p; kids[p.id] = []; });
  D.PLACES.forEach(function (p) { if (p.parent) kids[p.parent].push(p); });
  var SHORT = { sea: 'อาเซียน', 'th-ne': 'ภาคอีสาน', aya: 'อยุธยา', nst: 'นครศรีฯ', sni: 'สุราษฎร์ฯ', ubn: 'อุบลฯ' };
  // ชื่อเรียกอื่นที่คนพิมพ์บ่อย ใช้ตอนจับพื้นที่จากคำถามในแชท
  var ALIAS = {
    us: ['สหรัฐ', 'อเมริกา'], uk: ['อังกฤษ', 'ลอนดอน'], kr: ['เกาหลี', 'โซล'], 'th-ne': ['อีสาน'], 'th-s': ['ปักษ์ใต้'],
    bkk: ['กรุงเทพ', 'กทม'], cmi: ['เชียงใหม่'], jp: ['โตเกียว'], cn: ['ปักกิ่ง'], fr: ['ปารีส'], ae: ['ดูไบ'],
    sg: ['สิงคโปร์'], vn: ['โฮจิมินห์', 'ฮานอย'], ph: ['มะนิลา', 'มินดาเนา'], mm: ['พม่า'], kh: ['เขมร'],
    nma: ['โคราช'], skh: ['หาดใหญ่'], cbi: ['พัทยา'], sni: ['สมุย'], scs: ['สแปรตลี'], me: ['ฮอร์มุซ', 'อ่าวเปอร์เซีย']
  };

  function pathOf(id) {
    var out = [], cur = byId[id];
    while (cur) { out.unshift(cur); cur = cur.parent ? byId[cur.parent] : null; }
    return out;
  }
  function boxOf(p) {
    var k = p.s >= 40 ? 30 : 54;
    return { hw: p.hw || k / p.s, hh: p.hh || k / 2 / p.s };
  }
  function inBox(p, lon, lat) {
    var b = boxOf(p);
    return Math.abs(lon - (p.bx != null ? p.bx : p.lon)) <= b.hw && Math.abs(lat - (p.by != null ? p.by : p.lat)) <= b.hh;
  }
  function inPlace(p, lon, lat) {
    if (p.id === 'world') return true;
    if (p.id === 'th' && TH) return !!zoneAt(lon, lat);
    if (ZONE_FEAT[p.id]) return zoneAt(lon, lat) === p.id;
    if (PROV_FEAT[p.id]) return provinceAt(lon, lat) === p.id;
    return inBox(p, lon, lat);
  }
  // จังหวัดที่จุดนี้อยู่ (ถ้าตกทะเลใกล้ฝั่ง ใช้จังหวัดในภาคเดียวกันที่ใกล้ที่สุด)
  var provCache = {};
  function provinceAt(lon, lat) {
    if (!TH || !TH.provinces) return null;
    var key = lon.toFixed(3) + ',' + lat.toFixed(3);
    if (key in provCache) return provCache[key];
    var z = zoneAt(lon, lat), feats = TH.provinces.features, best = null, i;
    for (i = 0; i < feats.length && !best; i++) {
      if ((!z || feats[i].properties.zone === z) && inGeom(lon, lat, feats[i].geometry)) best = feats[i].properties.id;
    }
    for (i = 0; i < feats.length && !best && z; i++) if (inGeom(lon, lat, feats[i].geometry)) best = feats[i].properties.id;
    if (!best && z) {
      var dmin = 0.4 * 0.4;
      feats.forEach(function (f) {
        var pr = f.properties;
        if (pr.zone !== z) return;
        var dx = pr.cx - lon, dy = pr.cy - lat, d = dx * dx + dy * dy;
        if (d < dmin) { dmin = d; best = pr.id; }
      });
    }
    provCache[key] = best;
    return best;
  }

  /* ---------- 6 ภาคของไทย (ขอบเขตจริงจาก Natural Earth) ---------- */
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeom(lon, lat, g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (var i = 0; i < polys.length; i++) {
      if (!inRing(lon, lat, polys[i][0])) continue;
      var hole = false;
      for (var k = 1; k < polys[i].length; k++) if (inRing(lon, lat, polys[i][k])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  // ภาคที่จุดนี้อยู่ (ถ้าตกทะเลใกล้ฝั่งเล็กน้อย ใช้กรอบของภาคแทน) ไม่อยู่ในไทยได้ null
  var zoneCache = {};
  function zoneAt(lon, lat) {
    if (!TH) return null;
    var key = lon.toFixed(3) + ',' + lat.toFixed(3);
    if (key in zoneCache) return zoneCache[key];
    var z = null, i;
    for (i = 0; i < ZONE_IDS.length && !z; i++) if (inGeom(lon, lat, ZONE_FEAT[ZONE_IDS[i]].geometry)) z = ZONE_IDS[i];
    if (!z) {
      for (i = 0; i < ZONE_IDS.length && !z; i++) {
        var p = byId[ZONE_IDS[i]];
        if (p && inBox(p, lon, lat) && byId.th && inBox(byId.th, lon, lat)) z = ZONE_IDS[i];
      }
    }
    zoneCache[key] = z;
    return z;
  }
  // กลุ่มพื้นที่ของข่าว: 6 ภาคของไทย, AI โลก หรือต่างประเทศ
  function zoneOfStory(s) {
    if (s.region === 'ai') return 'ai';
    var z = zoneAt(s.lon, s.lat);
    if (z) return z;
    return s.region === 'th' ? 'th-c' : 'world';
  }
  D.STORIES.forEach(function (s) { s.zone = zoneOfStory(s); });
  function storiesIn(p) {
    return D.STORIES.filter(function (s) { return inPlace(p, s.lon, s.lat); });
  }
  function deepestPlace(lon, lat) {
    var best = byId.world, bestDepth = 1, bestArea = Infinity;
    D.PLACES.forEach(function (p) {
      if (p.id === 'world' || !inPlace(p, lon, lat)) return;
      var depth = pathOf(p.id).length, b = boxOf(p), area = b.hw * b.hh;
      if (depth > bestDepth || (depth === bestDepth && area < bestArea)) { best = p; bestDepth = depth; bestArea = area; }
    });
    if (best.s >= 40 && best.parent) best = byId[best.parent]; // ข่าวดูระดับภาคจะเห็นภาพรวมกว่า
    return best;
  }
  function levelName(node) {
    if (node.id === 'world') return 'ทวีป';
    if (node.id === 'asia') return 'ภูมิภาค';
    if (node.id === 'th') return 'ภาค';
    if (node.parent === 'th') return 'จังหวัด';
    return 'ประเทศ';
  }

  /* ---------- สถานะ ---------- */
  // ธีมน้ำเงิน-ขาวเป็นค่าเริ่มต้นของทุกคน (คีย์ใหม่ cg-theme2 ค่าเดิมที่เคยเลือกไว้จึงเริ่มใหม่ครั้งเดียว) กดปุ่มสลับเป็นน้ำเงินกรมท่าได้
  function readTheme() {
    try { var t = localStorage.getItem('cg-theme2'); if (t === 'light' || t === 'dark') return t; } catch (e) { /* ไม่มี storage */ }
    var host = document.documentElement.getAttribute('data-theme');
    if (host === 'light' || host === 'dark') return host;
    return 'light';
  }
  function readGroup() {
    try { var g = localStorage.getItem('cg-group2'); if (g === 'cat' || g === 'region') return g; } catch (e) { /* ข้าม */ }
    return 'region';
  }
  var allLayers = {};
  D.LAYERS.forEach(function (l) { allLayers[l.id] = true; });
  var state = {
    theme: readTheme(),
    page: 'chat',
    place: HOME,
    layers: Object.assign({}, allLayers),
    thaiLabels: true,
    messages: [{ role: 'bot', key: 'welcome' }],
    typing: false,
    selPin: null,
    selStory: null,
    groupBy: readGroup(),
    filter: 'all',
    globe: false,
    data: readDataPrefs(),
    channels: { line: true, email: false, app: true }
  };
  // สีหลักของธีมน้ำเงิน-ขาว (เส้นประเทศที่เลือก ไฮไลต์) ทับค่าเดิมในไฟล์ข้อมูล
  D.PAL.light.accent = '#4F46E5'; D.PAL.dark.accent = '#818CF8';
  function pal() { return D.PAL[state.theme]; }
  function numInk() { return state.theme === 'light' ? '#FFFFFF' : '#0A0F1F'; }

  // หน้าใน claude.ai (artifact) โหลดแผนที่จากเว็บอื่นไม่ได้ จึงเริ่มด้วยแผนที่สำรองเลย
  var IN_ARTIFACT = window.CG_ENV === 'artifact';
  var usingFallback = IN_ARTIFACT || params.get('offline') === '1';
  var FB_MAXZOOM = 10.5;

  /* ---------- มุมมองแผนที่ (หน้าแชทและหน้าสรุปมีแผนที่ของตัวเอง) ---------- */
  var views = {};
  var TIERS = {
    continent: [-5, 2.7], ocean: [0.3, 3.3], country: [2.7, 4.6],
    region: [4.3, 7.6], neighbor: [4.6, 8.5], province: [6.6, 11.8]
  };
  var UI_TH = {
    'NavigationControl.ZoomIn': 'ซูมเข้า',
    'NavigationControl.ZoomOut': 'ซูมออก',
    'Popup.Close': 'ปิด',
    'AttributionControl.ToggleAttribution': 'แหล่งที่มาของแผนที่',
    'CooperativeGesturesHandler.WindowsHelpText': 'กด Ctrl ค้างไว้แล้วเลื่อนเพื่อซูมแผนที่',
    'CooperativeGesturesHandler.MacHelpText': 'กด ⌘ ค้างไว้แล้วเลื่อนเพื่อซูมแผนที่',
    'CooperativeGesturesHandler.MobileHelpText': 'ใช้สองนิ้วเพื่อเลื่อนแผนที่'
  };

  function worldZoom(v) {
    var el = v && v.el;
    var w = (el && el.clientWidth) || 900, h = (el && el.clientHeight) || 600;
    if (state.globe) {
      var avail = Math.min(w, h - (v && v.kind === 'chat' ? 90 : 40));
      return Math.max(0.4, Math.min(2.6, Math.log2(0.82 * avail * Math.PI / 512)));
    }
    return Math.max(-0.9, Math.min(2.2, Math.log2(w / 512) + 0.05));
  }

  function createView(kind) {
    var v = {
      kind: kind, el: $(kind === 'chat' ? 'mapChat' : 'mapBrief'),
      styleLoading: true, tileOK: false, tileErrors: 0, fbTimer: null,
      labels: [], storyMarkers: [], popup: null, shownPlace: null
    };
    var map = v.map = new maplibregl.Map({
      container: v.el,
      style: baseStyle(state.theme),
      center: state.globe ? [95, 15] : [20, 20],
      zoom: worldZoom(v),
      minZoom: -1,
      maxZoom: usingFallback ? FB_MAXZOOM : 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
      cooperativeGestures: kind === 'brief',
      locale: UI_TH
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    if (kind === 'chat') map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');

    armFallbackTimer(v);
    map.on('error', function (e) {
      if (usingFallback || Date.now() - (BASE.revertAt || 0) < 4000) return;
      if (v.styleLoading) { if (!baseFailed()) switchToFallback('ต้องต่ออินเทอร์เน็ต'); return; }
      if (e && e.sourceId && e.sourceId.indexOf('cg-') !== 0 && !v.tileOK) {
        v.tileErrors += 1;
        if (v.tileErrors >= 8 && !baseFailed()) switchToFallback('โหลดภาพแผนที่ไม่ได้');
      }
    });
    // เครดิตแผนที่ยาวขึ้นหลังเพิ่มชั้นข้อมูล หุบไว้ก่อน กดปุ่ม i เพื่อดู
    map.once('idle', function () {
      v.el.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(function (el) { el.classList.remove('maplibregl-compact-show'); });
    });
    map.on('sourcedata', function (e) {
      if (e.tile && e.sourceId && e.sourceId.indexOf('cg-') !== 0) v.tileOK = true;
    });
    map.on('style.load', function () {
      v.styleLoading = false;
      clearTimeout(v.fbTimer);
      addOverlays(v);
      applyBasemapLabels(v);
      applyProjection(v);
      refreshView(v);
      refreshLive(v);
    });

    // กดภาคบนแผนที่ = ไปดูภาคนั้น (ยกเว้นกดโดนหมุด/สถานี/ป้าย)
    var hoverZone = null;
    function setHover(id) {
      if (hoverZone === id || !map.getSource('cg-thr')) return;
      if (hoverZone) map.setFeatureState({ source: 'cg-thr', id: hoverZone }, { hover: false });
      hoverZone = id;
      if (id) map.setFeatureState({ source: 'cg-thr', id: id }, { hover: true });
    }
    function topLayersAt(pt) {
      var ids = ['cg-pins-halo', 'cg-water', 'cg-rain', 'cg-flood-f', 'cg-flood-s', 'cg-flood-pf'].filter(function (l) { return map.getLayer(l); });
      return ids.length ? map.queryRenderedFeatures(pt, { layers: ids }) : [];
    }
    map.on('mousemove', 'cg-thr-fill', function (e) {
      var f = e.features && e.features[0];
      setHover(f ? f.properties.id : null);
      if (!topLayersAt(e.point).length) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'cg-thr-fill', function () { setHover(null); map.getCanvas().style.cursor = ''; });
    map.on('click', 'cg-thr-fill', function (e) {
      var t = e.originalEvent && e.originalEvent.target;
      if (t && t.closest && t.closest('.maplibregl-marker, .maplibregl-popup')) return;
      if (kind === 'chat' && (SITE.pick || PARCEL.on)) return; // กำลังเลือกจุดตรวจทำเลหรือวาดแปลง
      if (topLayersAt(e.point).length) return;
      if (kind === 'chat' && state.data.terrain) return; // เปิดความสูงพื้นดินอยู่: กดแผนที่เพื่อดูความสูงแทนการเปลี่ยนพื้นที่
      var f = e.features && e.features[0];
      if (f && f.properties.id !== state.place) goTo(f.properties.id);
    });

    if (kind === 'chat') {
      map.on('zoomend', function () { refreshView(v); });
      map.on('click', 'cg-pins-halo', function (e) {
        if (SITE.pick || PARCEL.on) return;
        if (e.features && e.features.length) selectPin(e.features[0].properties.id);
      });
      map.on('mouseenter', 'cg-pins-halo', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cg-pins-halo', function () { map.getCanvas().style.cursor = ''; });
      ['cg-water', 'cg-rain'].forEach(function (lid) {
        map.on('click', lid, function (e) {
          if (SITE.pick || PARCEL.on) return;
          if (map.queryRenderedFeatures(e.point, { layers: ['cg-pins-halo'] }).length) return;
          // จุดฝนกับสถานีน้ำซ้อนกันได้ ให้สถานีน้ำมาก่อน
          if (lid === 'cg-rain' && state.data.water && map.queryRenderedFeatures(e.point, { layers: ['cg-water'] }).length) return;
          var f = e.features && e.features[0];
          if (f) openStationPopup(v, lid === 'cg-water' ? 'water' : 'rain', f.properties.id);
        });
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
      });
      // ปื้นน้ำจากดาวเทียม (หมุดข่าวและสถานีมาก่อน)
      ['cg-flood-f', 'cg-flood-s'].forEach(function (lid) {
        map.on('click', lid, function (e) {
          if (SITE.pick || PARCEL.on) return;
          var top = ['cg-pins-halo', 'cg-water', 'cg-rain'].filter(function (l) { return map.getLayer(l); });
          if (map.queryRenderedFeatures(e.point, { layers: top }).length) return;
          var f = e.features && e.features[0];
          if (f) openFloodPopup(v, f.properties, e.lngLat);
        });
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
      });
      map.on('click', 'cg-flood-pf', function (e) {
        if (SITE.pick || PARCEL.on) return;
        var top = ['cg-pins-halo', 'cg-water', 'cg-rain', 'cg-flood-f', 'cg-flood-s'].filter(function (l) { return map.getLayer(l); });
        if (map.queryRenderedFeatures(e.point, { layers: top }).length) return;
        var f = e.features && e.features[0];
        if (f) openFloodProvPopup(v, f.properties, e.lngLat);
      });
      map.on('mouseenter', 'cg-flood-pf', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('moveend', function () { updateFloodTiles(v); });
      // ความสูงพื้นดิน: กดจุดว่างบนแผนที่ (ไม่โดนหมุดหรือสถานี)
      map.on('click', function (e) {
        var t = e.originalEvent && e.originalEvent.target;
        if (t && t.closest && t.closest('.maplibregl-marker, .maplibregl-popup')) return;
        if (PARCEL.on) { parcelClick(e.lngLat); return; } // กำลังวาดขอบเขตแปลง
        if (PP.pick) { ppPickAt(e.lngLat); return; } // ปักหมุดให้ทรัพย์ที่ยังไม่มีพิกัด
        if (SITE.pick) { openSite(e.lngLat.lng, e.lngLat.lat); return; } // เลือกจุดตรวจทำเล
        if (!state.data.terrain) return;
        if (topLayersAt(e.point).length) return;
        openElevationPopup(v, e.lngLat);
      });
      worldClicks(v);
      // คลิกขวาที่จุดใดก็ได้ = ตรวจทำเลจุดนั้น
      if (!IN_ARTIFACT) map.on('contextmenu', function (e) { if (e.originalEvent) e.originalEvent.preventDefault(); if (PARCEL.on) return; openSite(e.lngLat.lng, e.lngLat.lat); });
    }

    // ป้ายชื่อภาษาไทย
    v.labels = D.LABELS.map(function (l) {
      var el = document.createElement('div');
      el.className = 'th-lbl ' + l.kind;
      el.textContent = l.t;
      var m = new maplibregl.Marker({
        element: el, anchor: l.kind === 'province' ? 'left' : 'center',
        offset: l.kind === 'province' ? [-3, 0] : [0, 0], opacityWhenCovered: '0'
      }).setLngLat([l.lon, l.lat]).addTo(map);
      return { m: m, el: el, kind: l.kind, shown: true };
    });
    var raf = 0;
    map.on('zoom', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; updateLabels(v); updateFcMarkers(v); updateCctvMarkers(v); });
    });
    updateLabels(v);
    views[kind] = v;
    return v;
  }

  function armFallbackTimer(v) {
    clearTimeout(v.fbTimer);
    if (usingFallback) return;
    v.fbTimer = setTimeout(function () { if (v.styleLoading && !baseFailed()) switchToFallback('ช้าเกินไป'); }, 9000);
  }
  function eachView(fn) { Object.keys(views).forEach(function (k) { fn(views[k]); }); }

  function switchToFallback(reason) {
    if (usingFallback) return;
    usingFallback = true;
    eachView(function (v) {
      clearTimeout(v.fbTimer);
      v.styleLoading = true;
      v.map.setMaxZoom(FB_MAXZOOM);
      v.map.setStyle(fallbackStyle(state.theme), { diff: false });
    });
    toast('โหลดแผนที่ OpenStreetMap ไม่ได้ (' + reason + ') ตอนนี้ใช้แผนที่สำรองแบบออฟไลน์ ถ้าต่ออินเทอร์เน็ตแล้ว กดรีเฟรชอีกครั้ง');
  }

  function applyProjection(v) {
    try { v.map.setProjection({ type: state.globe ? 'globe' : 'mercator' }); } catch (e) { /* รุ่นเก่าไม่มีลูกโลก */ }
    if (OPS && OPS.on) opsSky(v);
  }
  function firstSymbolId(map) {
    var layers = map.getStyle().layers || [];
    for (var i = 0; i < layers.length; i++) if (layers[i].type === 'symbol') return layers[i].id;
    return undefined;
  }
  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function addOverlays(v) {
    var map = v.map, p = pal();
    var before = firstSymbolId(map);
    var dark = state.theme !== 'light';
    if (v.kind === 'chat') {
      // ภาพดาวเทียมอยู่ใต้เส้นภาคและป้ายชื่อ จึงยังอ่านชื่อสถานที่ได้
      map.addSource('cg-sat', { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 14, attribution: SAT_ATTR });
      map.addLayer({ id: 'cg-sat', type: 'raster', source: 'cg-sat', layout: { visibility: state.data.sat ? 'visible' : 'none' } }, before);
    }
    if (TH) {
      map.addSource('cg-thr', { type: 'geojson', data: TH.regions, promoteId: 'id', attribution: 'ขอบเขตภาคและจังหวัด: Natural Earth' });
      map.addSource('cg-thp', { type: 'geojson', data: TH.provinceLines });
      map.addLayer({ id: 'cg-thr-fill', type: 'fill', source: 'cg-thr', paint: {
        'fill-color': dark ? '#A5B4FC' : '#4F46E5',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], dark ? 0.14 : 0.1, dark ? 0.04 : 0.03]
      } }, before);
      map.addLayer({ id: 'cg-thp-line', type: 'line', source: 'cg-thp', minzoom: 4.2, paint: {
        'line-color': dark ? '#A5B4FC' : '#6366F1', 'line-opacity': state.data.sat ? 0.55 : 0.28, 'line-width': 0.6, 'line-dasharray': [2, 2]
      } }, before);
      map.addLayer({ id: 'cg-thr-line', type: 'line', source: 'cg-thr', paint: {
        'line-color': dark ? '#C7D2FE' : '#4338CA', 'line-opacity': state.data.sat ? 0.9 : 0.6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.8]
      } }, before);
    }
    map.addSource('cg-country', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'cg-country-fill', type: 'fill', source: 'cg-country', paint: { 'fill-color': p.accent, 'fill-opacity': 0.07 } }, before);
    map.addLayer({ id: 'cg-country-line', type: 'line', source: 'cg-country', paint: { 'line-color': p.accent, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 8, 2.4], 'line-opacity': 0.9 } }, before);
    if (v.kind === 'chat') {
      // น้ำจากดาวเทียม (ทดลอง): ซูมออกเห็นสีรายจังหวัด ซูมเข้าเห็นปื้นน้ำ อยู่ใต้ป้ายชื่อของแผนที่
      var fvis = state.data.flood ? 'visible' : 'none';
      map.addSource('cg-flood-prov', { type: 'geojson', data: FLOOD.provFC || emptyFC(), attribution: floodAttr() });
      map.addSource('cg-flood', { type: 'geojson', data: emptyFC() });
      v.floodProvSet = FLOOD.provFC; v.floodKey = null;
      // ทาสีเฉพาะจังหวัดที่น่าจะท่วมตั้งแต่ 5 ตร.กม. (ปื้นเล็กๆ ที่ไม่แน่ใจไม่นับ) ภาพรวมจะได้ไม่แดงทั้งประเทศ
      var provHas = ['>=', ['get', 'fh'], FL_PROV_MIN];
      map.addLayer({ id: 'cg-flood-pf', type: 'fill', source: 'cg-flood-prov', maxzoom: FL_DETAIL_Z + 0.5, filter: provHas, layout: { visibility: fvis },
        paint: { 'fill-color': FL_C.flood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'],
          FL_DETAIL_Z - 0.5, ['interpolate', ['linear'], ['get', 'fh'], FL_PROV_MIN, 0.16, 20, 0.28, 50, 0.4, 150, 0.55],
          FL_DETAIL_Z + 0.5, 0] } }, before);
      map.addLayer({ id: 'cg-flood-pl', type: 'line', source: 'cg-flood-prov', maxzoom: FL_DETAIL_Z, filter: ['>=', ['get', 'fh'], 20], layout: { visibility: fvis },
        paint: { 'line-color': FL_C.flood, 'line-width': 1, 'line-opacity': 0.7 } }, before);
      map.addLayer({ id: 'cg-flood-s', type: 'fill', source: 'cg-flood', minzoom: FL_DETAIL_Z - 0.5, filter: ['==', ['get', 'kind'], 'seasonal'], layout: { visibility: fvis },
        paint: { 'fill-color': FL_C.seasonal, 'fill-opacity': 0.45 } }, before);
      map.addLayer({ id: 'cg-flood-f', type: 'fill', source: 'cg-flood', minzoom: FL_DETAIL_Z - 0.5, filter: ['==', ['get', 'kind'], 'flood'], layout: { visibility: fvis },
        paint: { 'fill-color': FL_C.flood, 'fill-opacity': ['case', ['==', ['get', 'conf'], 'low'], 0.26, 0.66] } }, before);
      map.addLayer({ id: 'cg-flood-l', type: 'line', source: 'cg-flood', minzoom: 9,
        filter: ['all', ['==', ['get', 'kind'], 'flood'], ['!=', ['get', 'conf'], 'low']], layout: { visibility: fvis },
        paint: { 'line-color': FL_C.flood, 'line-width': 0.8, 'line-opacity': 0.9 } }, before);
      // ข้อมูลสาธารณะ: ฝน 24 ชม. และระดับน้ำ (ThaiWater) อยู่ใต้หมุดข่าว
      map.addSource('cg-rain', { type: 'geojson', data: emptyFC(), attribution: TW_ATTR });
      map.addLayer({ id: 'cg-rain', type: 'circle', source: 'cg-rain', layout: { visibility: state.data.rain ? 'visible' : 'none' }, paint: {
        // ซูมออกเห็นเฉพาะฝนหนัก (35 มม.+) ซูมเข้าเห็นมากขึ้น จะได้ไม่รก
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          4, ['case', ['>=', ['get', 'mm'], 35], ['interpolate', ['linear'], ['get', 'mm'], 35, 4, 90, 8, 150, 11], 0],
          6.5, ['case', ['>=', ['get', 'mm'], 10], ['interpolate', ['linear'], ['get', 'mm'], 10, 3, 35, 5, 90, 9, 150, 12], 0],
          9, ['interpolate', ['linear'], ['get', 'mm'], 0, 2.5, 10, 4, 35, 7, 90, 11, 150, 15]],
        'circle-sort-key': ['get', 'mm'],
        'circle-color': ['interpolate', ['linear'], ['get', 'mm'], 10, RAIN_C[0], 35, RAIN_C[1], 90, RAIN_C[2], 150, RAIN_C[3]],
        'circle-opacity': 0.6, 'circle-stroke-color': dark ? '#0A0F1F' : '#FFFFFF', 'circle-stroke-width': 1
      } });
      map.addSource('cg-water', { type: 'geojson', data: emptyFC(), attribution: TW_ATTR });
      // สถานีวัดน้ำเป็นสามเหลี่ยมคว่ำ แยกจากหมุดข่าวที่เป็นวงกลม
      [0, 1, 2, 3, 4, 5].forEach(function (k) {
        if (!map.hasImage('wl-' + k)) map.addImage('wl-' + k, triIcon(WL[k] ? WL[k].c : '#8A94A6', dark), { pixelRatio: 2 });
      });
      map.addLayer({ id: 'cg-water', type: 'symbol', source: 'cg-water', layout: {
        visibility: state.data.water ? 'visible' : 'none',
        'icon-image': ['concat', 'wl-', ['to-string', ['get', 'lv']]],
        // ซูมออกเห็นเฉพาะสถานีผิดปกติ (ล้นตลิ่ง น้ำมาก น้อยวิกฤต) ซูมเข้าเห็นครบ
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          4, ['match', ['get', 'lv'], [1, 4, 5], 0.8, 0],
          6.5, ['match', ['get', 'lv'], [1, 4, 5], 0.95, 0.55],
          9, 1.15],
        'symbol-sort-key': ['match', ['get', 'lv'], 5, 10, 4, 8, 1, 6, 0],
        'icon-allow-overlap': true, 'icon-ignore-placement': true
      } });
      // จุดล่องหนไว้แสดงเครดิต Open-Meteo ตอนเปิดพยากรณ์
      map.addSource('cg-fc', { type: 'geojson', data: emptyFC(), attribution: FC_ATTR });
      map.addLayer({ id: 'cg-fc', type: 'circle', source: 'cg-fc', layout: { visibility: state.data.fc ? 'visible' : 'none' }, paint: { 'circle-radius': 0, 'circle-opacity': 0 } });
      map.addSource('cg-pins', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'cg-pins-halo', type: 'circle', source: 'cg-pins', paint: { 'circle-radius': 15, 'circle-color': ['get', 'color'], 'circle-opacity': 0.16 } });
      map.addLayer({ id: 'cg-pins', type: 'circle', source: 'cg-pins', paint: { 'circle-radius': 6.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': numInk(), 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'cg-pin-sel', type: 'circle', source: 'cg-pins', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': p.accent, 'circle-stroke-width': 2.5 } });
    }
  }
  function applyBasemapLabels(v) {
    var style = v.map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach(function (l) {
      if (l.type === 'symbol' && /country|continent|state/i.test(l.id)) {
        try { v.map.setLayoutProperty(l.id, 'visibility', state.thaiLabels ? 'none' : 'visible'); } catch (e) { /* ข้าม */ }
      }
    });
  }
  function updateLabels(v) {
    var z = v.map.getZoom();
    v.labels.forEach(function (o) {
      var t = TIERS[o.kind] || [0, 30];
      var show = state.thaiLabels && z >= t[0] && z < t[1];
      if (show !== o.shown) { o.el.classList.toggle('off', !show); o.shown = show; }
    });
  }

  // ข่าวที่อยู่จุดเดียวกัน (เช่น กรุงเทพฯ) ให้กระจายเป็นวงรอบจุดนั้น จะได้กดได้ทุกอัน
  function spreadOffsets(list, radius) {
    var groups = {}, out = {};
    list.forEach(function (s) {
      var k = Math.round(s.lon * 2) / 2 + ',' + Math.round(s.lat * 2) / 2;
      (groups[k] = groups[k] || []).push(s);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      g.forEach(function (s, i) {
        if (g.length < 2) { out[s.id] = [0, 0]; return; }
        var a = -Math.PI / 2 + 2 * Math.PI * i / g.length, r = radius + (g.length > 3 ? 6 : 0);
        out[s.id] = [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
      });
    });
    return out;
  }

  function refreshView(v) {
    if (!v || v.styleLoading || !v.map.getSource('cg-country')) return;
    var p = pal();
    if (v.kind === 'chat') {
      var shown = D.STORIES.filter(function (s) { return state.layers[s.layer]; });
      var off = spreadOffsets(shown, 11);
      var degPx = 360 / (512 * Math.pow(2, v.map.getZoom()));
      var feats = shown.map(function (s) {
        var o = off[s.id];
        var lon = s.lon + o[0] * degPx, lat = s.lat - o[1] * degPx * Math.cos(s.lat * Math.PI / 180);
        return { type: 'Feature', properties: { id: s.id, color: p[s.layer] }, geometry: { type: 'Point', coordinates: [lon, lat] } };
      });
      v.map.getSource('cg-pins').setData({ type: 'FeatureCollection', features: feats });
      v.map.setFilter('cg-pin-sel', ['==', ['get', 'id'], state.selPin || '']);
    }
    var path = pathOf(state.place), feat = null;
    for (var i = path.length - 1; i >= 0; i--) { if (C[path[i].id]) { feat = C[path[i].id]; break; } }
    v.map.getSource('cg-country').setData(feat ? { type: 'FeatureCollection', features: [feat] } : emptyFC());
  }

  function mapPadding(v) {
    var small = window.innerWidth <= 860;
    if (v.kind === 'chat') {
      var mt = document.querySelector('.map-top');
      return { top: (mt ? mt.offsetHeight : 90) + 24, bottom: small ? 24 : 40, left: small ? 16 : 40, right: small ? 16 : 60 };
    }
    return { top: 56, bottom: 28, left: small ? 16 : 36, right: small ? 16 : 56 };
  }
  function flyToPlace(v, p, instant) {
    if (!v) return;
    v.shownPlace = p.id;
    var opts = { duration: instant || reduceMotion ? 0 : 1400, essential: true };
    if (p.id === 'world') {
      v.map.flyTo(Object.assign({ center: state.globe ? [95, 15] : [20, 20], zoom: worldZoom(v), padding: { top: 0, bottom: 0, left: 0, right: 0 } }, opts));
      return;
    }
    var b = boxOf(p), cx = p.bx != null ? p.bx : p.lon, cy = p.by != null ? p.by : p.lat;
    var s = Math.max(-84, cy - b.hh), n = Math.min(84, cy + b.hh);
    v.map.fitBounds([[cx - b.hw, s], [cx + b.hw, n]], Object.assign({ padding: mapPadding(v), maxZoom: 11 }, opts));
  }

  /* ---------- หน้า (routing) ---------- */
  function hashFor(page, place) {
    if (page === 'cctv') return '#cctv' + (/^(wet|src:|site:)/.test(CV.filter) ? '=' + CV.filter : '');
    if (page === 'props') return '#props';
    if (page === 'brief') return place === HOME ? '#brief' : '#brief-' + place;
    return place === HOME ? '' : '#' + place;
  }
  function writeHash(push) {
    var url = location.pathname + location.search + hashFor(state.page, state.place);
    try {
      if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    } catch (e) { /* บางที่ห้ามแก้ URL */ }
  }
  function parseHash() {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (h === 'ops') return { page: 'chat', place: state.place || HOME, ops: true };
    if (h === 'props') return { page: 'props', place: state.place || HOME };
    var cm = /^cctv(?:=([\w:-]+))?$/.exec(h);
    if (cm) return { page: 'cctv', place: state.place || HOME, cv: cm[1] || 'all' };
    var sm = /^(site|twin)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(h);
    if (sm) return { page: 'chat', place: state.place || HOME, site: { lat: +sm[2], lon: +sm[3] }, tab: sm[1] === 'twin' ? 'twin' : 'risk' };
    if (h === 'brief') return { page: 'brief', place: HOME };
    if (h.indexOf('brief-') === 0 && byId[h.slice(6)]) return { page: 'brief', place: h.slice(6) };
    if (byId[h]) return { page: 'chat', place: h };
    return { page: 'chat', place: HOME };
  }

  function setPage(page, opts) {
    opts = opts || {};
    if (page !== 'chat' && OPS.on) exitOps();
    state.page = page;
    $('pageChat').hidden = page !== 'chat';
    $('pageBrief').hidden = page !== 'brief';
    $('pageCctv').hidden = page !== 'cctv';
    $('pagePp').hidden = page !== 'props';
    $('navChat').setAttribute('aria-current', page === 'chat' ? 'page' : 'false');
    $('navBrief').setAttribute('aria-current', page === 'brief' ? 'page' : 'false');
    $('navCctv').setAttribute('aria-current', page === 'cctv' ? 'page' : 'false');
    $('navPp').setAttribute('aria-current', page === 'props' ? 'page' : 'false');
    document.title = page === 'brief' ? 'สรุปเช้านี้ · ChatGeo' : page === 'cctv' ? 'กล้อง CCTV สด · ChatGeo' : page === 'props' ? 'ค้นทรัพย์ · ตรวจทำเลหลายแปลง · ChatGeo' : 'ChatGeo · คุยกับโลก';
    if (page !== 'brief') stopSpeech();
    closeAllResults();
    if (page === 'cctv' || page === 'props') {
      if (page === 'cctv') cvStart(); else { cvStop(); renderPropsPage(); }
      if (!opts.fromHash) writeHash(true);
      return;
    }
    cvStop();
    var v = views[page] || createView(page);
    v.map.resize();
    if (opts.intro && page === 'chat') { v.shownPlace = state.place; v.map.jumpTo({ center: [100.5, 12], zoom: worldZoom(v) }); }
    else if (v.shownPlace !== state.place) flyToPlace(v, byId[state.place], true);
    refreshView(v);
    if (page === 'brief') renderBrief();
    if (!opts.fromHash) writeHash(true);
    if (page === 'brief' && !opts.keepScroll) $('pageBrief').scrollTop = 0;
  }
  document.querySelectorAll('[data-page]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var page = a.getAttribute('data-page');
      if (page !== state.page) setPage(page);
    });
  });
  function onRoute() {
    var r = parseHash();
    if (r.place !== state.place) goTo(r.place, { noHash: true, instant: r.page !== state.page });
    if (r.page === 'cctv' && r.cv !== CV.filter && !(r.cv === 'all' && CV.filter === 'near')) { CV.filter = r.cv; if (state.page === 'cctv') renderCctvPage(); }
    if (r.page !== state.page) setPage(r.page, { fromHash: true });
    if (r.site && !IN_ARTIFACT) openSite(r.site.lon, r.site.lat, { tab: r.tab });
    if (r.ops) enterOps();
  }
  window.addEventListener('popstate', onRoute);
  window.addEventListener('hashchange', onRoute);

  /* ---------- ไปยังพื้นที่ ---------- */
  function goTo(id, opts) {
    opts = opts || {};
    if (!byId[id]) return;
    state.place = id;
    state.selPin = null;
    state.selStory = null;
    state.filter = 'all';
    closePopup();
    stopSpeech();
    closeAllResults();
    renderExplorers();
    renderPinCard();
    renderBrief();
    eachView(refreshView);
    var active = views[state.page];
    if (active) flyToPlace(active, byId[id], opts.instant);
    if (!opts.noHash) writeHash(false);
  }

  /* ---------- แถบเลือกพื้นที่ (breadcrumb) ---------- */
  var chev = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var sep = '<svg class="crumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function explorerHtml() {
    var path = pathOf(state.place);
    var html = '', n = 0;
    path.forEach(function (node, i) {
      var ks = kids[node.id];
      if (!ks.length) return;
      var next = path[i + 1];
      var isCurrent = next && next.id === state.place;
      var cls = 'crumb' + (next ? (isCurrent ? ' current' : '') : ' next');
      var text = next ? (SHORT[next.id] || next.name) : 'เลือก' + levelName(node);
      var opts = '<option value="">' + (node.id === 'world' ? 'ทั้งโลก' : 'ทั้งหมด') + '</option>' + ks.map(function (k) {
        var c = storiesIn(k).length;
        return '<option value="' + k.id + '"' + (next && next.id === k.id ? ' selected' : '') + '>' + esc(k.name) + (c ? ' · ' + c + ' ข่าว' : '') + '</option>';
      }).join('');
      if (n > 0) html += sep;
      html += '<span class="' + cls + '"><span>' + esc(text) + '</span>' + chev +
        '<select aria-label="เลือก' + levelName(node) + '" data-node="' + node.id + '">' + opts + '</select></span>';
      n++;
    });
    if (state.place !== 'world') {
      html += '<button type="button" class="x-btn" data-reset="1" aria-label="ล้างพื้นที่ กลับไปดูทั้งโลก" title="กลับไปดูทั้งโลก">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>';
    }
    return html;
  }
  function renderExplorers() {
    var html = explorerHtml();
    ['crumbsChat', 'crumbsBrief'].forEach(function (id) {
      var el = $(id);
      el.innerHTML = html;
      el.scrollLeft = el.scrollWidth;
    });
  }
  ['crumbsChat', 'crumbsBrief'].forEach(function (id) {
    $(id).addEventListener('change', function (e) {
      var sel = e.target.closest('select');
      if (sel) goTo(sel.value || sel.getAttribute('data-node'));
    });
    $(id).addEventListener('click', function (e) {
      if (e.target.closest('[data-reset]')) goTo('world');
    });
  });

  /* ---------- ค้นหาพื้นที่ (หน้าต่างค้นหากลางจอ) ---------- */
  var EN = {
    world: 'world', asia: 'asia', europe: 'europe', africa: 'africa', namerica: 'north america', samerica: 'south america',
    oceania: 'oceania', sea: 'southeast asia asean', scs: 'south china sea spratly', eastasia: 'east asia', southasia: 'south asia', me: 'middle east',
    th: 'thailand', la: 'laos', kh: 'cambodia', mm: 'myanmar burma', vn: 'vietnam', my: 'malaysia', sg: 'singapore',
    id: 'indonesia', ph: 'philippines', cn: 'china', jp: 'japan', kr: 'south korea', in: 'india', pk: 'pakistan',
    bd: 'bangladesh', sa: 'saudi arabia', ir: 'iran', ae: 'uae united arab emirates dubai', iq: 'iraq', fr: 'france paris',
    de: 'germany', uk: 'united kingdom britain england london', ua: 'ukraine', eg: 'egypt', ng: 'nigeria', ke: 'kenya',
    za: 'south africa', us: 'united states usa america', ca: 'canada', mx: 'mexico', br: 'brazil', ar: 'argentina',
    cl: 'chile', au: 'australia', nz: 'new zealand', 'th-n': 'northern thailand north', 'th-ne': 'isan northeast',
    'th-c': 'central thailand', 'th-e': 'eastern thailand east', 'th-w': 'western thailand west', 'th-s': 'southern thailand south',
    cmi: 'chiang mai', cri: 'chiang rai', lpg: 'lampang', nan: 'nan', kkn: 'khon kaen', ret: 'roi et', udn: 'udon thani',
    nma: 'nakhon ratchasima korat', ubn: 'ubon ratchathani', yst: 'yasothon', bkk: 'bangkok', aya: 'ayutthaya',
    nsn: 'nakhon sawan', cbi: 'chonburi pattaya', ryg: 'rayong', cti: 'chanthaburi', kri: 'kanchanaburi', tak: 'tak',
    rbr: 'ratchaburi', pkt: 'phuket', sni: 'surat thani samui', nst: 'nakhon si thammarat', skh: 'songkhla hat yai'
  };
  if (TH && TH.provinces) TH.provinces.features.forEach(function (f) { if (!EN[f.properties.id]) EN[f.properties.id] = f.properties.en.toLowerCase(); });
  function kindOf(p) {
    if (p.id === 'world') return 'ทั้งโลก';
    if (p.id === 'scs') return 'ทะเล';
    if (p.parent === 'world') return 'ทวีป';
    if (p.parent === 'asia') return 'ภูมิภาค';
    if (p.parent === 'th') return 'ภาค';
    if (byId[p.parent] && byId[p.parent].parent === 'th') return 'จังหวัด';
    return 'ประเทศ';
  }
  function markMatch(name, q) {
    var i = q ? name.indexOf(q) : -1;
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }
  var pal_ = { items: [], idx: 0, opener: null };
  function paletteItems(q) {
    q = q.trim();
    if (!q) {
      // ยังไม่พิมพ์: แนะนำพื้นที่ที่มีข่าวเช้านี้
      var list = D.PLACES.filter(function (p) { return p.id !== 'world' && storiesIn(p).length; })
        .sort(function (a, b) {
          var d = pathOf(a.id).length - pathOf(b.id).length;
          return d || storiesIn(b).length - storiesIn(a).length;
        });
      // เอาระดับต่างๆ มาผสมกัน ไม่ให้มีแต่ทวีป
      var pick = [], seen = {};
      [['ทวีป', 2], ['ภูมิภาค', 2], ['ประเทศ', 3], ['ภาค', 2], ['จังหวัด', 1]].forEach(function (k) {
        list.filter(function (p) { return kindOf(p) === k[0]; }).slice(0, k[1]).forEach(function (p) { if (!seen[p.id]) { seen[p.id] = 1; pick.push(p); } });
      });
      if (state.place !== 'world') pick.unshift(byId.world);
      return { title: 'พื้นที่ที่มีข่าวเช้านี้', items: pick };
    }
    var ql = q.toLowerCase();
    var hits = D.PLACES.filter(function (p) {
      return p.name.indexOf(q) >= 0 || (SHORT[p.id] || '').indexOf(q) >= 0 || (EN[p.id] || '').indexOf(ql) >= 0;
    }).sort(function (a, b) {
      var sa = a.name.indexOf(q) === 0 ? 0 : 1, sb = b.name.indexOf(q) === 0 ? 0 : 1;
      return sa - sb || pathOf(a.id).length - pathOf(b.id).length;
    }).slice(0, 10);
    return { title: hits.length ? 'ผลการค้นหา' : '', items: hits };
  }
  function renderPalette() {
    var q = $('palQ').value.trim();
    var r = paletteItems(q);
    pal_.items = r.items;
    pal_.idx = Math.min(pal_.idx, Math.max(0, r.items.length - 1));
    if (!r.items.length) {
      $('palList').innerHTML = '<div class="pal-empty"><b>ไม่พบ "' + esc(q) + '"</b><span>ต้นแบบนี้มี ' + D.PLACES.length + ' พื้นที่ ลองพิมพ์ชื่อประเทศ ภาค หรือจังหวัด เช่น ญี่ปุ่น ภาคใต้ เชียงใหม่ หรือพิมพ์ภาษาอังกฤษก็ได้</span></div>';
      $('palQ').removeAttribute('aria-activedescendant');
      return;
    }
    var p = pal();
    $('palList').innerHTML = (r.title ? '<div class="pal-sec">' + r.title + '</div>' : '') + r.items.map(function (pl, i) {
      var n = storiesIn(pl).length;
      var path = pathOf(pl.id).slice(1, -1).map(function (x) { return SHORT[x.id] || x.name; }).join(' › ');
      var cur = pl.id === state.place;
      return '<button type="button" role="option" id="pal-' + pl.id + '" class="pal-item' + (i === pal_.idx ? ' active' : '') + '" data-id="' + pl.id + '" aria-selected="' + (i === pal_.idx) + '">' +
        '<span class="pal-kind">' + kindOf(pl) + '</span>' +
        '<span class="pal-main"><span class="pal-name">' + markMatch(pl.name, q) + (cur ? '<em>กำลังดูอยู่</em>' : '') + '</span>' +
        (path ? '<span class="pal-path">' + esc(path) + '</span>' : '') + '</span>' +
        (n ? '<span class="pal-n">' + n + ' ข่าว</span>' : '') +
        '</button>';
    }).join('');
    $('palQ').setAttribute('aria-activedescendant', 'pal-' + pal_.items[pal_.idx].id);
  }
  function openPalette(opener) {
    pal_.opener = opener || document.activeElement;
    pal_.idx = 0;
    $('palQ').value = '';
    $('palette').hidden = false;
    renderPalette();
    setTimeout(function () { $('palQ').focus(); }, 0);
  }
  function closePalette(silent) {
    if ($('palette').hidden) return;
    $('palette').hidden = true;
    if (!silent && pal_.opener && pal_.opener.focus) pal_.opener.focus();
  }
  function closeAllResults() { closePalette(true); }
  function choosePalette(i) {
    var pl = pal_.items[i];
    if (!pl) return;
    closePalette(true);
    goTo(pl.id);
    if (state.page === 'brief') $('briefMapCard').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  document.querySelectorAll('[data-open-search]').forEach(function (b) {
    b.addEventListener('click', function () { openPalette(b); });
  });
  $('palette').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closePalette(); return; }
    var it = e.target.closest('.pal-item');
    if (it) choosePalette(pal_.items.map(function (x) { return x.id; }).indexOf(it.getAttribute('data-id')));
  });
  $('palList').addEventListener('mousemove', function (e) {
    var it = e.target.closest('.pal-item');
    if (!it) return;
    var i = pal_.items.map(function (x) { return x.id; }).indexOf(it.getAttribute('data-id'));
    if (i !== pal_.idx) {
      pal_.idx = i;
      $('palList').querySelectorAll('.pal-item').forEach(function (el, k) { el.classList.toggle('active', k === i); el.setAttribute('aria-selected', String(k === i)); });
      $('palQ').setAttribute('aria-activedescendant', 'pal-' + pal_.items[i].id);
    }
  });
  $('palQ').addEventListener('input', function () { pal_.idx = 0; renderPalette(); });
  $('palQ').addEventListener('keydown', function (e) {
    var n = pal_.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); pal_.idx = (pal_.idx + 1) % n; renderPalette(); keepActiveVisible(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); pal_.idx = (pal_.idx - 1 + n) % n; renderPalette(); keepActiveVisible(); }
    else if (e.key === 'Enter') { e.preventDefault(); choosePalette(pal_.idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    else if (e.key === 'Tab') { e.preventDefault(); } // เก็บโฟกัสไว้ในหน้าต่างค้นหา
  });
  function keepActiveVisible() {
    var el = $('palList').querySelector('.pal-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    openPalette(document.querySelector(state.page === 'brief' ? '#briefMapCard [data-open-search]' : '.map-rail [data-open-search]'));
  });

  /* ---------- ตัวกรองหมวดข่าว (หน้าแชท) ---------- */
  var CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  function usedLayers() {
    return D.LAYERS.filter(function (l) { return D.STORIES.some(function (s) { return s.layer === l.id; }); });
  }
  function renderChips() {
    var p = pal(), used = usedLayers();
    $('layerChips').innerHTML = used.map(function (l) {
      var on = !!state.layers[l.id];
      var n = D.STORIES.filter(function (s) { return s.layer === l.id; }).length;
      return '<button type="button" class="fp-row" data-layer="' + l.id + '" aria-pressed="' + on + '">' +
        '<span class="box">' + (on ? CHECK : '') + '</span>' +
        '<span class="nm"><span class="dot" style="background:' + p[l.id] + '"></span>' + esc(l.long) + '</span><span class="n">' + n + '</span></button>';
    }).join('');
    var onList = used.filter(function (l) { return state.layers[l.id]; });
    $('filterDots').innerHTML = onList.map(function (l) { return '<i style="background:' + p[l.id] + '"></i>'; }).join('');
    $('btnLabels').setAttribute('aria-pressed', String(state.thaiLabels));
    railBadge();
  }
  // ตัวเลขบนปุ่มชั้นข้อมูล = จำนวนชั้นที่เปิดอยู่ (ข่าวไม่นับ เพราะเปิดเสมอ)
  function railBadge() {
    if (!DATA_ROWS || !$('filterCount')) return;
    var n = DATA_ROWS.filter(function (r) { return r.id && state.data[r.id]; }).length;
    var used = usedLayers(), onN = used.filter(function (l) { return state.layers[l.id]; }).length;
    $('filterCount').textContent = n ? String(n) : '';
    if ($('drCount')) $('drCount').textContent = 'เปิดอยู่ ' + n + ' ชั้น' + (onN < used.length ? ' · ข่าว ' + onN + '/' + used.length + ' หมวด' : '');
    $('btnFilter').setAttribute('aria-label', 'ชั้นข้อมูลบนแผนที่ เปิดอยู่ ' + n + ' ชั้น' + (onN < used.length ? ' ข่าวแสดง ' + onN + ' จาก ' + used.length + ' หมวด' : ''));
  }
  function setFilterOpen(open) {
    $('filterPop').hidden = !open;
    $('btnFilter').setAttribute('aria-expanded', String(open));
  }
  $('btnFilter').addEventListener('click', function (e) {
    e.stopPropagation();
    setFilterOpen($('filterPop').hidden);
  });
  // คลิกในเมนูแล้วรายการถูกวาดใหม่ จึงกันไม่ให้คลิกนั้นไปปิดเมนู
  // ยกเว้นปุ่มที่ทำงานผ่านตัวดักระดับหน้า (เปิดหน้ากล้อง ดาวเทียมทั้งหมด ฯลฯ) ต้องให้คลิกผ่านขึ้นไปได้
  var POP_PASS = '[data-cv-open],[data-cc-wall],[data-cc-cam],[data-cc-site],[data-sat-all],[data-site-open],[data-site-layer],[data-world-fly],[data-terrain3d]';
  $('filterPop').addEventListener('click', function (e) { if (!e.target.closest(POP_PASS)) e.stopPropagation(); });
  if ($('filterClose')) $('filterClose').addEventListener('click', function () { setFilterOpen(false); $('btnFilter').focus(); });
  document.addEventListener('click', function (e) {
    if (!$('filterPop').hidden && e.target.isConnected && !e.target.closest('#filterPop, #btnFilter')) setFilterOpen(false);
  });
  $('layerChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-layer]');
    if (!b) return;
    var id = b.getAttribute('data-layer');
    state.layers[id] = !state.layers[id];
    var sp = state.selPin && storyById(state.selPin);
    if (sp && !state.layers[sp.layer]) state.selPin = null;
    renderChips();
    renderPinCard();
    refreshView(views.chat);
  });
  $('fpAll').addEventListener('click', function () {
    D.LAYERS.forEach(function (l) { state.layers[l.id] = true; });
    renderChips();
    refreshView(views.chat);
  });
  $('btnLabels').addEventListener('click', function () {
    state.thaiLabels = !state.thaiLabels;
    eachView(function (v) { updateLabels(v); applyBasemapLabels(v); });
    renderChips();
  });

  /* ---------- การ์ดข่าวบนแผนที่แชท ---------- */
  function selectPin(id) {
    var s = storyById(id);
    if (!s) return;
    if (!state.layers[s.layer]) { state.layers[s.layer] = true; renderChips(); }
    state.selPin = id;
    renderPinCard();
    refreshView(views.chat);
    if (views.chat) views.chat.map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(views.chat.map.getZoom(), 4.5), duration: reduceMotion ? 0 : 700 });
  }
  function renderPinCard() {
    var s = state.selPin ? storyById(state.selPin) : null;
    var card = $('pinCard');
    if (!s) { card.hidden = true; return; }
    var p = pal();
    $('pinMeta').innerHTML = '<span class="dot" style="background:' + p[s.layer] + '"></span><b>' + esc(NAME[s.layer]) + '</b> · ' + esc(s.place) + ' · ' + esc(s.date);
    $('pinTitle').textContent = s.title;
    $('pinSum').textContent = s.summary;
    $('pinLink').href = s.url;
    $('pinLink').innerHTML = 'อ่านที่ ' + esc(s.source) + ' ' + ICO.ext;
    card.hidden = false;
  }
  $('pinClose').addEventListener('click', function () { state.selPin = null; renderPinCard(); refreshView(views.chat); });
  $('pinAsk').addEventListener('click', function () {
    var s = storyById(state.selPin);
    if (s) ask('story:' + s.id, 'เล่าเรื่อง "' + s.title + '" เพิ่มหน่อย');
  });

  /* ---------- แชท ---------- */
  // หัวข้อสำเร็จรูป ใช้ตอนไม่มี AI (เปิดไฟล์ในเครื่อง) และใช้จับคู่คำถามแนะนำ
  var TOPIC_DEF = {
    world: { title: 'สรุปข่าวเช้านี้', place: 'world', layers: null, pick: function (s) { return s.rank <= 5; } },
    flood: { title: 'ฝน น้ำท่วม และภัยพิบัติ', place: 'th', layers: ['weather', 'conflict', 'area'], extra: 'weather',
      pick: function (s) { return s.layer === 'weather' || /น้ำท่วม|อุทกภัย|ฝน|พายุ|เยียวยา/.test(s.title + s.summary); } },
    oil: { title: 'พลังงานและราคาน้ำมัน', place: 'me', layers: ['conflict', 'market'],
      pick: function (s) { return /น้ำมัน|ฮอร์มุซ|พลังงาน|อารัมโก|ก๊าซ|opec/i.test(s.title + s.summary); } },
    ai: { title: 'ข่าวเทคโนโลยีและ AI', place: 'world', layers: ['ai', 'biz'], pick: function (s) { return s.layer === 'ai'; } },
    market: { title: 'เศรษฐกิจและตลาด', place: 'world', layers: ['market', 'biz'], extra: 'markets',
      pick: function (s) { return s.layer === 'market' || s.layer === 'biz'; } },
    politics: { title: 'การเมืองและความมั่นคง', place: 'world', layers: ['conflict'], pick: function (s) { return s.layer === 'conflict'; } },
    biz: { title: 'ธุรกิจและการลงทุน', place: 'world', layers: ['biz', 'market'], pick: function (s) { return s.layer === 'biz'; } },
    society: { title: 'สังคมและสิ่งแวดล้อม', place: 'world', layers: ['area', 'news'], pick: function (s) { return s.layer === 'area' || s.layer === 'news'; } }
  };
  // คำในคำถาม → หมวดข่าว (เรียงจากเจาะจงไปกว้าง)
  var TOPIC_RE = [
    ['oil', /น้ำมัน|ฮอร์มุซ|opec|\boil\b|อารัมโก|พลังงาน|ก๊าซ/i],
    ['flood', /น้ำท่วม|ฝน|พายุ|อากาศ|เยียวยา|อุทกภัย|มรสุม|น้ำป่า|ภัยพิบัติ|แผ่นดินไหว|ดินถล่ม|weather|flood/i],
    ['ai', /\bai\b|เอไอ|ปัญญาประดิษฐ์|ไซเบอร์|ศูนย์ข้อมูล|เทคโนโลยี|ดิจิทัล|ชิป/i],
    ['market', /หุ้น|ตลาด|ดอกเบี้ย|เฟด|ทองคำ|ราคาทอง|ค่าเงิน|ค่าบาท|เงินบาท|เศรษฐกิจ|เงินเฟ้อ|จีดีพี|\bgdp\b|\bset\b/i],
    ['politics', /การเมือง|ความมั่นคง|รัฐบาล|เลือกตั้ง|รัฐสภา|นายกฯ|นายกรัฐมนตรี|ทหาร|สงคราม|ขัดแย้ง|ชายแดน|politic/i],
    ['biz', /ธุรกิจ|บริษัท|ลงทุน|ซื้อกิจการ|ควบรวม|สตาร์ทอัพ|ค้าปลีก|ส่งออก|การค้า|business/i],
    ['society', /สังคม|ประวัติศาสตร์|สิ่งแวดล้อม|สุขภาพ|การศึกษา|รำลึก/]
  ];
  var IMPACT_RE = /กระทบ(คน)?ไทย|ผลต่อ(คน)?ไทย|เกี่ยวกับคนไทย|กระทบ.*มากที่สุด|สำคัญที่สุด|ควรรู้/;
  var GENERIC_RE = /สรุป|เช้านี้|วันนี้มีอะไร|ข่าวเด่น|ข่าวสำคัญ|^ข่าว|headline/i;
  var FOREIGN_RE = /ต่างประเทศ|ทั่วโลก|นานาชาติ/;
  function topicOf(t) {
    for (var i = 0; i < TOPIC_RE.length; i++) if (TOPIC_RE[i][1].test(t)) return TOPIC_RE[i][0];
    return null;
  }
  // คำถาม/คำลงท้ายที่ไม่ใช่สาระ ตัดทิ้งก่อนค้นในข่าว
  var STOP = ('ข่าว เรื่อง วันนี้ เช้านี้ ตอนนี้ ล่าสุด มี มั้ย ไหม ไหน อะไร บ้าง ยังไง อย่างไร เป็น แค่ไหน เท่าไร เท่าไหร่ หน่อย ' +
    'ครับ คับ ค่ะ คะ นะ จ้า ขอ อยาก รู้ เกี่ยวกับ ของ ที่ ใน กับ และ หรือ จาก ให้ ได้ ไป มา คือ การ ความ สรุป บอก เล่า ช่วย ' +
    'ทำไม ใคร เมื่อ จะ แล้ว ว่า นี้ นั้น อย่าง ยัง ตอน เกิด ขึ้น สถานการณ์ กระทบ ผล ต่อ คน มาก ที่สุด สุด สำคัญ ควร ' +
    'เช้า วัน เรา ผม ฉัน หนู มัน เขา the a an of in on to is are was what how why news today about').split(' ');
  var SEG = null;
  try { if (typeof Intl !== 'undefined' && Intl.Segmenter) SEG = new Intl.Segmenter('th', { granularity: 'word' }); } catch (e) { SEG = null; }
  function wordsOf(t) {
    t = String(t || '').toLowerCase();
    var out = [];
    if (SEG) {
      Array.from(SEG.segment(t)).forEach(function (s) { if (s.isWordLike) out.push(s.segment); });
    } else {
      out = t.split(/[\s,.;:!?()"'“”‘’\-–—\/]+/);
    }
    return out.filter(function (w, i) {
      return w.length >= 2 && STOP.indexOf(w) < 0 && !/^\d{1,2}$/.test(w) && out.indexOf(w) === i;
    });
  }
  function hayOf(s) {
    if (!s._hay) s._hay = (s.title + ' ' + s.summary + ' ' + s.place + ' ' + s.thai + ' ' + s.source).toLowerCase();
    return s._hay;
  }
  // ค้นข่าวด้วยคำสำคัญ: คำที่เจอในข่าวน้อยเรื่องได้น้ำหนักมาก เจอในหัวข้อได้คะแนนเพิ่ม
  function rankByTerms(terms, pool) {
    var all = D.STORIES, n = all.length, weight = {};
    terms.forEach(function (w) {
      var df = all.filter(function (s) { return hayOf(s).indexOf(w) >= 0; }).length;
      weight[w] = df && df <= Math.max(2, n * 0.6) ? Math.log(1 + n / df) * Math.min(1, w.length / 3) : 0;
    });
    return pool.map(function (s) {
      var h = hayOf(s), title = s.title.toLowerCase(), sc = 0;
      terms.forEach(function (w) { if (weight[w] && h.indexOf(w) >= 0) sc += weight[w] * (title.indexOf(w) >= 0 ? 1.5 : 1); });
      return { s: s, sc: sc };
    }).sort(function (a, b) { return b.sc - a.sc || a.s.rank - b.s.rank; });
  }
  function hitsOf(ranked) {
    var best = ranked.length ? ranked[0].sc : 0;
    if (!best) return [];
    return ranked.filter(function (x) { return x.sc >= best * 0.5; }).slice(0, 5).map(function (x) { return x.s; });
  }
  function byRank(a, b) { return a.rank - b.rank; }
  // พื้นที่เล็กที่สุดที่ครอบข่าวทุกเรื่องในรายการ
  function commonPlace(list) {
    if (!list.length) return byId.world;
    var path = pathOf(deepestPlace(list[0].lon, list[0].lat).id).reverse();
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      if (list.every(function (s) { return inPlace(p, s.lon, s.lat); })) return p;
    }
    return byId.world;
  }
  // แปลคำถามเป็นคำตอบจากข่าวในสรุปที่เปิดอยู่ (ไม่ใช้ AI)
  function resolveQuery(raw) {
    var t = String(raw || '').trim();
    var impact = IMPACT_RE.test(t);
    var tp = impact ? t.replace(/(คน|ประเทศ)?ไทย/g, ' ') : t;
    var place = findPlace(tp);
    if (place && place.id === 'world') place = null;
    var topic = topicOf(t);
    var rest = tp;
    if (place) {
      [place.name, SHORT[place.id]].concat(ALIAS[place.id] || []).forEach(function (nm) { if (nm) rest = rest.split(nm).join(' '); });
    }
    var terms = wordsOf(rest.replace(FOREIGN_RE, ' ').replace(/ประเทศ/g, ' '));
    var r = { q: t, place: place, topic: topic, impact: impact, list: [], missing: '', prefix: '', label: '', sat: /ดาวเทียม|satellite/i.test(t) };
    // กล้อง CCTV: ถามถึงกล้องตรงๆ หรือเอ่ยชื่อจุดที่มีกล้อง (เช่น หาดใหญ่ เขื่อนภูมิพล)
    r.camQ = CC_RE.test(t);
    r.wx = RADAR_RE.test(t) ? 'radar' : ELE_RE.test(t) ? 'terrain' : WIND_RE.test(t) ? 'wind' : HELP_RE.test(t) ? 'help' : '';
    r.live = r.wx || IN_ARTIFACT ? '' : liveIntent(t);
    r.cam = ccMatch(t);

    var pool = D.STORIES.slice().sort(byRank), scope = null;
    if (place) {
      var inP = storiesIn(place).sort(byRank);
      if (inP.length) { pool = inP; scope = place; }
      else { r.missing = place.name; r.prefix = 'เช้านี้ยังไม่มีข่าวใน' + place.name + ' แต่ในข่าวทั้งหมด'; }
    }
    if (FOREIGN_RE.test(t) && !scope) {
      var fr = pool.filter(function (s) { return s.region === 'world'; });
      if (fr.length) { pool = fr; r.label = 'ข่าวต่างประเทศ'; }
    }
    if (topic) {
      var def = TOPIC_DEF[topic];
      var tp2 = pool.filter(def.pick);
      if (!tp2.length && scope) {
        tp2 = D.STORIES.filter(def.pick).sort(byRank);
        if (tp2.length) r.prefix = 'เช้านี้ยังไม่มีข่าว' + def.title + 'ใน' + place.name + ' แต่ในภาพรวม';
        scope = null;
      }
      // ในหมวดเดียวกัน เรียงเรื่องที่ตรงคำถามขึ้นก่อน
      r.list = rankByTerms(terms, tp2).map(function (x) { return x.s; }).slice(0, 5);
      r.label = def.title + (scope ? ' · ' + scope.name : '');
      r.extra = def.extra;
    } else if (impact && !scope) {
      var direct = D.STORIES.filter(function (s) { return s.why === 'ผลต่อไทย'; }).sort(byRank);
      r.list = (direct.length ? direct : D.STORIES.slice().sort(byRank)).slice(0, 4);
      r.label = 'เรื่องที่กระทบคนไทยมากที่สุดเช้านี้';
      r.impact = true;
    } else {
      var hits = hitsOf(rankByTerms(terms, pool));
      if (hits.length) r.list = hits;
      else if (scope) r.list = pool.slice(0, 6);
      else if (r.label) r.list = pool.slice(0, 5);
      else if (GENERIC_RE.test(t) && !r.missing) {
        r.list = D.STORIES.slice().sort(byRank).slice(0, 5); r.label = (staleDays(D.META.date) ? 'สรุปล่าสุด · ' : 'สรุปข่าวเช้านี้ · ') + (D.META.dateShort || ''); r.cta = true;
        r.lead = 'เช้านี้มีข่าว ' + D.STORIES.length + ' เรื่องจาก ' + D.META.sources + ' สำนักข่าว 5 เรื่องที่ควรรู้ก่อนคือ';
      }
      if (!r.label) r.label = scope ? scope.name : '';
    }
    r.scope = scope;
    return r;
  }
  // ขยับแผนที่ไปยังข่าวที่ใช้ตอบ: เรื่องเดียวเปิดหมุด หลายเรื่องซูมให้เห็นทั้งหมด
  function showQueryOnMap(r) {
    var list = r.list;
    if (r.wx) {
      if (r.wx === 'help') setTimeout(openHelp, 50); else wxOn(r.wx);
      if (r.place && r.place.id !== HOME) goTo(r.place.id);
      return;
    }
    if (r.live) { worldShow(r); return; }
    if (ccFirst(r) && ccQueryOnMap(r)) return;
    if (r.topic === 'flood' && r.sat && (!r.place || r.place.id === HOME) && floodReady()) {
      var tp = topFloodProvinces(1)[0];
      if (tp) { showFloodProvince(PID_BY_NAME[tp.name]); return; }
    }
    if (!list.length) { if (r.place) goTo(r.place.id); return; }
    var def = r.topic ? TOPIC_DEF[r.topic] : null;
    D.LAYERS.forEach(function (l) {
      state.layers[l.id] = !def || !def.layers || def.layers.indexOf(l.id) >= 0 ||
        list.some(function (s) { return s.layer === l.id; });
    });
    renderChips();
    if (list.length === 1 && !r.impact) {
      var s = list[0];
      goTo(deepestPlace(s.lon, s.lat).id);
      state.selPin = s.id; renderPinCard(); refreshView(views.chat);
      return;
    }
    goTo((r.scope || commonPlace(list)).id);
  }
  // หาพื้นที่จากข้อความ (ไทยหรืออังกฤษ) ชื่อยาวก่อน
  function findPlace(t) {
    t = String(t || '').trim();
    if (!t) return null;
    if (byId[t]) return byId[t];
    var tl = t.toLowerCase();
    var places = D.PLACES.slice().sort(function (a, b) { return b.name.length - a.name.length; });
    for (var i = 0; i < places.length; i++) {
      var p = places[i];
      if (t.indexOf(p.name) >= 0 || (SHORT[p.id] && t.indexOf(SHORT[p.id]) >= 0)) {
        // "ไทย" มักเป็นคำขยาย (คนไทย ราคาน้ำมันไทย) ถ้ามีพื้นที่อื่นในประโยคให้ใช้พื้นที่นั้น
        if (p.id === 'th') { var other = findPlace(t.split('ไทย').join(' ')); if (other) return other; }
        return p;
      }
    }
    var aliasHit = null, aliasLen = 0;
    Object.keys(ALIAS).forEach(function (id) {
      ALIAS[id].forEach(function (a) { if (byId[id] && a.length > aliasLen && t.indexOf(a) >= 0) { aliasHit = byId[id]; aliasLen = a.length; } });
    });
    if (aliasHit) return aliasHit;
    for (var j = 0; j < places.length; j++) {
      var en = EN[places[j].id];
      if (en && en.split(' ').length && (tl.indexOf(en) >= 0 || en.indexOf(tl) === 0)) return places[j];
    }
    return null;
  }
  function pointsOf(list) {
    return list.map(function (s) { return { layer: s.layer, text: s.title, url: s.url, source: s.source, story: s.id }; });
  }
  function answerFor(m) {
    if (m.key === 'welcome') {
      var oldW = staleDays(D.META.date);
      return {
        title: (oldW ? 'สรุปล่าสุด · ' : 'สรุปเช้านี้ · ') + D.META.dateShort + (oldW ? ' (ยังไม่มีของวันนี้)' : ''),
        text: 'สวัสดีครับ ผมคือ ChatGeo เช้านี้มีข่าว ' + D.STORIES.length + ' เรื่องจาก ' + D.META.sources + ' สำนักข่าวอยู่บนแผนที่ ถามเรื่องข่าว หรือพิมพ์ชื่อประเทศ ภาค จังหวัดก็ได้ครับ 3 เรื่องที่ควรรู้ก่อนคือ',
        points: pointsOf(D.STORIES.slice(0, 3)), cta: true
      };
    }
    if (m.key.indexOf('topic:') === 0) {
      var k = m.key.slice(6), t = TOPIC_DEF[k] || TOPIC_DEF.world;
      var snap = (D.TOPICS || {})[k];
      var list = D.STORIES.filter(t.pick).slice(0, 4);
      return {
        title: snap ? snap.title : t.title,
        text: snap ? snap.text : (list.length ? 'ในสรุปเช้านี้มีข่าวที่เกี่ยวข้อง ' + list.length + ' เรื่อง' : 'ในสรุปเช้านี้ยังไม่มีข่าวเรื่องนี้'),
        points: pointsOf(list), extra: t.extra, follow: snap ? snap.follow : '', cta: k === 'world'
      };
    }
    if (m.key === 'place') {
      var place = byId[m.place];
      var found = storiesIn(place);
      return {
        title: place.name,
        text: found.length
          ? 'ในสรุปเช้านี้มีข่าวเกี่ยวกับ' + place.name + ' ' + found.length + ' เรื่อง'
          : 'ในสรุปเช้านี้ยังไม่มีข่าวเกี่ยวกับ' + place.name + ' ลองซูมดูสถานที่บนแผนที่ได้เลย',
        points: pointsOf(found.slice(0, 4)),
        html: isLocalPlace(place) ? localHtml({ place: place }) : ''
      };
    }
    if (m.key === 'near') return nearAnswer(m);
    if (m.key === 'site') return siteAnswer(m);
    if (m.key === 'pp') return { title: 'ค้นทรัพย์ · ตรวจทำเลทีละหลายแปลง', text: (PP.list.length ? 'ในรายการของคุณมี ' + PP.list.length + ' ทรัพย์ ตรวจทำเลแล้ว ' + PP.list.filter(function (p) { return p.chk; }).length + ' รายการ ' : '') +
      'วางรายการทรัพย์ที่สนใจ (พิกัดหรือลิงก์ Google Maps ราคา ขนาด วันขาย) หรือไฟล์ CSV ที่หน้า "ทรัพย์" ระบบจะตรวจความเสี่ยงน้ำท่วมทีละแปลง แล้วกรองและเรียงตามราคา ราคาต่อตารางวา หรือความเสี่ยงได้ ' +
      'ChatGeo ไม่ได้เก็บประกาศขายทอดตลาดเอง ค้นทรัพย์ได้ที่เว็บกรมบังคับคดีแล้วคัดลอกพิกัดมาวาง',
      html: '<button type="button" class="btn-ghost sv-open" data-pp-go="1">เปิดหน้าทรัพย์' + ICO.arrow + '</button>' };
    if (m.key === 'nearfail') {
      return { title: 'รอบตัวคุณ', text: m.code === 1
        ? 'ยังไม่ได้รับอนุญาตให้ใช้ตำแหน่ง ถ้าอยากใช้ ให้กดอนุญาตตำแหน่งในเบราว์เซอร์แล้วกด "รอบตัวฉัน" อีกครั้ง หรือพิมพ์ชื่อจังหวัดแทนก็ได้ เช่น ร้อยเอ็ดตอนนี้เป็นยังไง'
        : 'หาตำแหน่งไม่สำเร็จ ลองอีกครั้ง หรือพิมพ์ชื่อจังหวัดแทนก็ได้ เช่น ร้อยเอ็ดตอนนี้เป็นยังไง' };
    }
    if (m.key === 'story') {
      var s = storyById(m.story);
      if (!s) return { text: 'ข่าวนี้ไม่อยู่ในสรุปที่เปิดอยู่แล้ว' };
      return storyAnswer(s);
    }
    if (m.key === 'q') return queryAnswer(resolveQuery(m.q));
    return { text: unknownText('') };
  }
  function storyAnswer(s, lead) {
    return {
      title: s.place + ' · ' + s.date, text: (lead ? lead + ' ' : '') + s.summary,
      why: s.why + ': ' + s.thai,
      points: pointsOf([s]), linkOnly: true
    };
  }
  function shortText(t, n) {
    t = String(t || '');
    return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  }
  function unknownText(q) {
    var eg = [];
    D.STORIES.slice().sort(byRank).forEach(function (s) {
      var pl = deepestPlace(s.lon, s.lat);
      if (eg.length < 3 && pl.id !== 'world' && eg.indexOf(pl.name) < 0) eg.push(pl.name);
    });
    return (q ? 'ยังไม่เจอเรื่อง "' + shortText(q, 40) + '" ในสรุปเช้านี้ครับ ' : '') +
      'ตอนนี้ ChatGeo ตอบจากข่าว ' + D.STORIES.length + ' เรื่องของเช้านี้เท่านั้น ลองพิมพ์ชื่อพื้นที่ เช่น ' + eg.join(' ') +
      ' หรือหมวดข่าว เช่น การเมือง เศรษฐกิจ อากาศ หรือคำสำคัญที่อยู่ในข่าว';
  }
  function queryAnswer(r) {
    var list = r.list;
    // ถามถึงดาวเทียมโดยตรง: ตอบด้วยผลตรวจจากดาวเทียมก่อน
    if (r.topic === 'flood' && r.sat && (!r.place || r.place.id === HOME) && floodReady()) {
      return { title: 'น้ำจากดาวเทียม (ทดลอง)', html: floodSummaryHtml(),
        text: 'ดาวเทียมเรดาร์ Sentinel-1 ถ่ายทะลุเมฆได้ ChatGeo ตรวจทั่วประเทศทุกครั้งที่มีภาพใหม่ ' +
          (topFloodProvinces(1).length ? 'นี่คือจังหวัดที่น่าจะมีน้ำท่วมมากที่สุดตอนนี้' : 'ภาพล่าสุดยังไม่พบน้ำท่วมผิดปกติที่ชัดเจน') +
          (list.length ? ' ส่วนข่าวน้ำท่วมเช้านี้มี ' + list.length + ' เรื่อง พิมพ์ว่า "น้ำท่วม" เพื่อดูข่าว' : '') };
    }
    if (r.wx) return wxAnswer(r);
    if (r.live) return worldAnswer(r);
    if (ccFirst(r)) return cctvAnswer(r);
    var loc = r.place && isLocalPlace(r.place) && (!r.topic || r.topic === 'flood') ? localHtml({ place: r.place }) : '';
    if (!loc && r.topic === 'flood' && (!r.place || r.place.id === HOME)) loc = floodSummaryHtml();
    if (r.cam && !(r.place && isLocalPlace(r.place) && loc)) loc += ccBlockHtml(r.cam.cams, r.cam.label, r.cam.sites.length === 1 ? 'site:' + r.cam.sites[0].id : 'all', { showSite: r.cam.sites.length > 1, max: 4 });
    if (!list.length) {
      return { title: r.label || (loc ? r.place.name : ''), html: loc, text: r.missing
        ? 'เช้านี้ยังไม่มีข่าวใน' + r.missing + (loc ? ' แต่นี่คือสถานการณ์น้ำ ฝน และพยากรณ์ตอนนี้' : ' ลองซูมดูพื้นที่บนแผนที่ หรือถามเรื่องอื่นได้ครับ')
        : unknownText(r.q) };
    }
    if (list.length === 1 && !r.impact) {
      var a = storyAnswer(list[0], r.prefix ? r.prefix + 'มี 1 เรื่อง:' : '');
      a.extra = r.extra;
      a.html = loc;
      return a;
    }
    var points = list.map(function (s) {
      return { layer: s.layer, text: s.title, url: s.url, source: s.source, story: s.id,
        sub: r.impact ? s.thai : shortText(s.summary, 110) };
    });
    var lead = r.lead || r.impact
      ? r.lead || 'เลือกจากข่าวที่มีผลต่อคนไทยโดยตรง เรียงตามความสำคัญ'
      : (r.prefix ? r.prefix + 'มี ' : 'ในสรุปเช้านี้มี ') + list.length + ' เรื่องที่เกี่ยวข้อง กดหัวข้อเพื่อดูบนแผนที่';
    return { title: r.label || 'จากข่าวเช้านี้', text: lead, points: points, extra: r.extra, cta: r.cta, html: loc };
  }

  function extraHtml(kind) {
    if (kind === 'weather' && ((D.WEATHER && D.WEATHER.length) || LIVE.rain.length)) {
      var h = '';
      if (D.WEATHER && D.WEATHER.length) {
        h += '<div class="m-extra"><div class="m-extra-head">อากาศวันนี้ (กรมอุตุฯ)</div>' + D.WEATHER.map(function (w) {
          return '<div class="m-row"><span class="dot" style="background:' + levelColor(w.level) + '"></span><div><b>' + esc(w.region) + '</b> <span>' + esc(w.status) + '</span></div></div>';
        }).join('') + '</div>';
      }
      if (LIVE.rain.length) {
        h += '<div class="m-extra"><div class="m-extra-head">ฝนสะสม 24 ชม. สูงสุด · ThaiWater · ' + esc(whenText('rain')) + '</div>' + LIVE.rain.slice(0, 5).map(function (o) {
          return '<div class="m-row">' + DROP + '<div><b>' + esc(o.name) + '</b> <span>จ.' + esc(o.prov) + ' · ' + o.mm.toFixed(0) + ' มม.</span></div></div>';
        }).join('') + '</div>';
      }
      return h;
    }
    if (kind === 'markets' && D.MARKETS && D.MARKETS.length) {
      return '<div class="m-extra"><div class="m-extra-head">' + esc(D.MARKETS_ASOF || '') + '</div>' + D.MARKETS.map(function (m) {
        return '<div class="m-row m-mkt"><b>' + esc(m.name) + '</b><span class="num">' + esc(m.value) + '</span><span style="color:' + (m.dir === 'up' ? 'var(--up)' : m.dir === 'down' ? 'var(--down)' : 'var(--muted)') + '">' + esc(m.change) + '</span></div>';
      }).join('') + '</div>';
    }
    return '';
  }
  function levelColor(level) {
    var p = pal();
    return level === 'warning' ? p.conflict : level === 'watch' ? p.market : p.weather;
  }

  // คำถามแนะนำ: มาจากสรุปที่เปิดอยู่ ถ้าไม่มีใช้ชุดมาตรฐาน
  function suggestions() {
    if (D.QUESTIONS && D.QUESTIONS.length && typeof D.QUESTIONS[0] === 'object') return D.QUESTIONS;
    if (D.QUESTIONS && D.QUESTIONS.length && D.TOPICS) {
      return D.QUESTIONS.map(function (k) { var t = D.TOPICS[k]; return { q: t.q, layer: t.layer }; });
    }
    return [
      { q: 'สรุปข่าวเช้านี้', layer: 'accent' },
      { q: 'ข่าวในไทยวันนี้มีอะไรบ้าง', layer: 'weather' },
      { q: 'เรื่องไหนกระทบคนไทยมากที่สุด', layer: 'conflict' },
      { q: 'ข่าวเศรษฐกิจและตลาดล่าสุด', layer: 'market' }
    ];
  }
  function renderSuggest() {
    var p = pal();
    var list = [{ q: 'รอบตัวฉันตอนนี้เป็นยังไง', layer: 'weather', near: true }]
      .concat(floodReady() ? [{ q: 'ดาวเทียมเห็นน้ำท่วมที่ไหนบ้าง', layer: 'weather' }] : [])
      .concat(ccReady() ? [{ q: CCTV.idx ? 'กล้องไหนเห็นน้ำท่วมบ้าง' : 'ดูกล้อง CCTV หาดใหญ่', layer: 'weather' }] : [])
      .concat(suggestions());
    $('suggest').innerHTML = list.map(function (q) {
      return '<button type="button" class="q-chip" data-q="' + esc(q.q) + '"><span class="dot" style="background:' + (p[q.layer] || p.accent) + '"></span>' + esc(q.q) + '</button>';
    }).join('');
  }
  $('suggest').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-q]');
    if (b) submitQuestion(b.getAttribute('data-q'));
  });

  function botHtml(m, i) {
    if (m.ai) return aiHtml(m, i);
    var a = answerFor(m);
    var p = pal();
    var h = '<div class="msg-bot">';
    if (a.title) h += '<div class="m-title">' + esc(a.title) + '</div>';
    h += '<p>' + esc(a.text) + '</p>';
    if (a.why) h += '<div class="m-why">' + esc(a.why) + '</div>';
    if (a.points && a.points.length && !a.linkOnly) {
      h += '<ul class="m-points">' + a.points.map(function (pt) {
        return '<li><span class="dot" style="background:' + p[pt.layer] + '"></span><div><button type="button" class="pt-title" data-story="' + pt.story + '" title="ดูบนแผนที่">' + esc(pt.text) + '</button>' +
          '<a class="src-link" href="' + esc(pt.url) + '" target="_blank" rel="noopener">' + esc(pt.source) + ICO.ext + '</a>' +
          (pt.sub ? '<span class="pt-sub">' + esc(pt.sub) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul>';
    }
    if (a.linkOnly && a.points.length) {
      var pt = a.points[0];
      h += '<a class="src-btn" href="' + esc(pt.url) + '" target="_blank" rel="noopener">อ่านข่าวต้นฉบับที่ ' + esc(pt.source) + ICO.ext + '</a>';
    }
    if (a.extra) h += extraHtml(a.extra);
    if (a.html) h += a.html;
    if (a.follow) h += '<div class="follow">' + esc(a.follow) + '</div>';
    if (a.cta) {
      h += '<button type="button" class="msg-cta" data-goto="brief">อ่านสรุปเช้านี้ทั้งหมด · ' + D.STORIES.length + ' เรื่อง' + ICO.arrow + '</button>';
    }
    return h + '</div>';
  }

  // ข้อความจาก AI: ย่อหน้า, รายการ "- ", **ตัวหนา** และ [รหัสข่าว] เป็นปุ่มอ้างอิง
  function citeChip(id) {
    var s = storyById(id);
    if (!s) return '';
    return '<button type="button" class="cite" data-story="' + s.id + '" title="' + esc(s.title) + '">' + esc(s.source) + '</button>';
  }
  function mdLite(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var out = [], list = [];
    function inline(t) {
      return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([a-z]{1,6}\d{1,3})\]/gi, function (m0, id) { return citeChip(id) || m0; });
    }
    function flush() { if (list.length) { out.push('<ul class="ai-ul">' + list.join('') + '</ul>'); list = []; } }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { flush(); return; }
      var mm = t.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
      if (mm) { list.push('<li>' + inline(mm[1]) + '</li>'); return; }
      flush();
      t = t.replace(/^#+\s*/, '');
      out.push('<p>' + inline(t) + '</p>');
    });
    flush();
    return out.join('');
  }
  function citedIds(text) {
    var ids = [], re = /\[([a-z]{1,6}\d{1,3})\]/gi, m;
    while ((m = re.exec(String(text)))) { var id = m[1].toLowerCase(); if (storyById(id) && ids.indexOf(id) < 0) ids.push(id); }
    return ids;
  }
  function aiHtml(m) {
    var h = '<div class="msg-bot ai" data-mid="' + m.mid + '">';
    if (m.status === 'thinking' && !m.text) {
      h += '<div class="ai-think"><span class="typing-dots"><i></i><i></i><i></i></span>' + esc(m.note || 'กำลังอ่านข่าวและคิดคำตอบ') + '</div>';
    } else {
      h += mdLite(m.text || '');
    }
    var ids = citedIds(m.text || '');
    if (m.status === 'done' && ids.length) {
      h += '<div class="ai-srcs"><span>แหล่งข่าว</span>' + ids.map(function (id) {
        var s = storyById(id);
        return '<a class="src-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.source) + ICO.ext + '</a>';
      }).join('') + '</div>';
    }
    if (m.error) h += '<div class="ai-err">' + esc(m.error) + '</div>';
    return h + '</div>';
  }
  function renderMsgs() {
    var h = state.messages.map(function (m, i) {
      return m.role === 'user' ? '<div class="msg-user">' + esc(m.text) + '</div>' : botHtml(m, i);
    }).join('');
    if (state.typing) h += '<div class="typing" aria-label="ChatGeo กำลังพิมพ์"><i></i><i></i><i></i></div>';
    $('msgs').innerHTML = h;
    var sc = $('msgsScroll');
    sc.scrollTop = sc.scrollHeight;
  }
  function updateAiBubble(m) {
    var el = document.querySelector('.msg-bot[data-mid="' + m.mid + '"]');
    if (!el) { renderMsgs(); return; }
    var tmp = document.createElement('div');
    tmp.innerHTML = aiHtml(m);
    el.replaceWith(tmp.firstChild);
    var sc = $('msgsScroll');
    sc.scrollTop = sc.scrollHeight;
  }
  $('msgs').addEventListener('click', function (e) {
    if (e.target.closest('[data-goto]')) {
      if (state.place !== 'world') goTo('world', { noHash: true, instant: true });
      setPage('brief');
      return;
    }
    var st = e.target.closest('[data-story]');
    if (st) selectPin(st.getAttribute('data-story'));
  });

  /* ---------- AI จริงผ่าน Claude (เมื่อเปิดหน้าเว็บในแอป Claude) ---------- */
  var ai = { sample: null, enabled: false, tools: false, busy: false, ctl: null, turns: [], seq: 0 };
  function setAskHint() {
    $('askHint').textContent = ai.enabled
      ? 'ตอบโดย Claude จากข่าวในสรุปเช้านี้ · ใช้โควตา Claude ของคนที่เปิดดู'
      : 'ตอบจากข่าวในสรุปเช้านี้ (ยังไม่ใช้ AI) · พิมพ์ชื่อพื้นที่ หมวดข่าว หรือคำสำคัญได้เลย';
  }
  function aiRules() {
    var stories = D.STORIES.map(function (s) {
      return '[' + s.id + '] ' + NAME[s.layer] + ' | ' + (RNAME[s.region] || '') + ' | ' + s.place + ' | ' + s.date + ' | ' + s.title +
        ' — ' + s.summary + ' (' + s.why + ': ' + s.thai + ') ที่มา: ' + s.source;
    }).join('\n');
    var weather = (D.WEATHER || []).map(function (w) { return w.region + ': ' + w.status; }).join('; ');
    var markets = (D.MARKETS || []).map(function (m) { return m.name + ' ' + m.value + ' ' + (m.unit || '') + ' (' + m.change + ')'; }).join('; ');
    var here = byId[state.place];
    return 'คุณคือ ChatGeo ผู้ช่วยเล่าข่าวโลกบนแผนที่ ตอบเป็นภาษาไทยแบบเข้าใจง่าย เป็นกันเอง ใช้ครับ\n' +
      'กฎ:\n' +
      '1. ตอบจากข้อมูลข่าวด้านล่างเท่านั้น ถ้าไม่มีในข้อมูล ให้บอกตรงๆ ว่าสรุปเช้านี้ยังไม่มีเรื่องนั้น ห้ามแต่งข้อเท็จจริง ตัวเลข หรือลิงก์เอง\n' +
      '2. ทุกครั้งที่อ้างข่าว ให้ใส่รหัสข่าวในวงเล็บเหลี่ยม เช่น [th1] ท้ายประโยค\n' +
      '3. ตอบสั้น กระชับ ไม่เกิน 6 บรรทัด ใช้รายการ "- " ได้ ปิดท้ายด้วยข้อสังเกตว่าเรื่องนี้เกี่ยวกับคนไทยอย่างไร ถ้ามี\n' +
      '4. ถ้าคำถามเกี่ยวกับสถานที่หรือข่าวเรื่องใดเรื่องหนึ่ง ให้เรียกเครื่องมือ show_on_map หนึ่งครั้งเพื่อพาแผนที่ไปที่นั่นก่อนตอบ\n' +
      '5. ถ้าผู้ใช้ขอดูเฉพาะบางหมวด ให้เรียก set_categories\n\n' +
      'สรุปเช้านี้ ' + D.META.dateLong + ' (' + D.STORIES.length + ' ข่าว):\n' + stories + '\n\n' +
      (weather ? 'อากาศไทยวันนี้: ' + weather + '\n' : '') +
      (markets ? 'ตลาด (' + (D.MARKETS_ASOF || '') + '): ' + markets + '\n' : '') +
      'แผนที่ตอนนี้แสดง: ' + here.name + '\n' +
      'หมวดที่ใช้ได้: ' + D.LAYERS.map(function (l) { return l.id + '=' + l.name; }).join(', ');
  }
  function aiTools(m) {
    return [
      {
        name: 'show_on_map',
        description: 'พาแผนที่ไปที่ข่าวหรือพื้นที่ ใส่รหัสข่าว (เช่น th1) หรือชื่อพื้นที่ภาษาไทย/อังกฤษ (เช่น ภาคเหนือ, japan) คืนค่าว่าไปที่ไหนและมีข่าวอะไรในพื้นที่นั้น',
        inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'รหัสข่าวหรือชื่อพื้นที่' } }, required: ['target'] },
        execute: function (input) {
          var t = String(input && input.target || '').trim();
          var s = storyById(t.toLowerCase());
          m.mapMoved = true;
          if (s) {
            goTo(deepestPlace(s.lon, s.lat).id);
            state.selPin = s.id; renderPinCard(); refreshView(views.chat);
            return 'แสดงข่าว ' + s.id + ' ที่ ' + s.place + ' บนแผนที่แล้ว';
          }
          var pl = findPlace(t);
          if (!pl) { m.mapMoved = false; throw new Error('ไม่พบพื้นที่ "' + t + '" ในแผนที่ต้นแบบ'); }
          goTo(pl.id);
          var ids = storiesIn(pl).map(function (x) { return x.id; });
          return 'ย้ายแผนที่ไปที่ ' + pl.name + ' แล้ว ข่าวในพื้นที่นี้: ' + (ids.join(', ') || 'ไม่มี');
        }
      },
      {
        name: 'set_categories',
        description: 'เลือกหมวดข่าวที่จะแสดงบนแผนที่ ใส่รายการรหัสหมวด หรือใส่ ["all"] เพื่อแสดงทั้งหมด คืนค่าหมวดที่แสดงอยู่',
        inputSchema: { type: 'object', properties: { categories: { type: 'array', items: { type: 'string' } } }, required: ['categories'] },
        execute: function (input) {
          var cats = (input && input.categories || []).map(String);
          var all = cats.indexOf('all') >= 0 || !cats.length;
          D.LAYERS.forEach(function (l) { state.layers[l.id] = all || cats.indexOf(l.id) >= 0; });
          renderChips(); refreshView(views.chat);
          return 'แสดงหมวด: ' + D.LAYERS.filter(function (l) { return state.layers[l.id]; }).map(function (l) { return l.name; }).join(', ');
        }
      }
    ];
  }
  var AI_ERR = {
    rate_limited: 'ตอนนี้ถามถี่เกินไปหรือโควตา Claude ใกล้หมด ลองใหม่อีกสักครู่ครับ',
    session_expired: 'ต้องเข้าสู่ระบบ Claude ใหม่ก่อนครับ',
    refused: 'Claude ไม่ตอบคำถามนี้ ลองถามแบบอื่นครับ',
    empty_completion: 'ไม่ได้คำตอบกลับมา ลองถามใหม่ให้สั้นลงครับ',
    prompt_too_large: 'บทสนทนายาวเกินไป ผมล้างประวัติเก่าแล้ว ลองถามใหม่ได้เลยครับ',
    upstream_error: 'การเชื่อมต่อกับ Claude ขัดข้องชั่วคราว ลองใหม่อีกครั้งครับ'
  };
  function setBusy(b) {
    ai.busy = b;
    $('askForm').classList.toggle('busy', b);
    $('sendBtn').setAttribute('aria-label', b ? 'หยุดตอบ' : 'ส่งคำถาม');
  }
  function askAI(text, storyId) {
    if (state.page !== 'chat') setPage('chat');
    state.messages.push({ role: 'user', text: text });
    var m = { role: 'bot', ai: true, mid: 'm' + (++ai.seq), text: '', status: 'thinking' };
    state.messages.push(m);
    renderMsgs();
    setBusy(true);
    ai.ctl = new AbortController();
    var content = storyId ? text + ' (รหัสข่าว ' + storyId + ')' : text;
    var turns = [{ role: 'user', content: aiRules() }].concat(ai.turns.slice(-6), [{ role: 'user', content: content }]);
    var opts = { signal: ai.ctl.signal, modelTier: 'quick', onText: function (u) { m.text = u.text; m.status = 'streaming'; updateAiBubble(m); } };
    if (ai.tools) opts.tools = aiTools(m); else opts.cache = false;
    ai.sample(turns, opts).then(function (res) {
      m.text = res.text; m.status = 'done';
      ai.turns.push({ role: 'user', content: content }, { role: 'assistant', content: res.text });
      if (!m.mapMoved) { var ids = citedIds(res.text); if (ids.length) selectPin(ids[0]); }
      if (res.truncated) m.error = 'คำตอบยาวเกินเลยถูกตัด ลองถามให้แคบลงครับ';
    }).catch(function (e) {
      var code = e && e.code;
      m.status = 'done';
      m.text = (e && e.text) || '';
      if (code === 'cancelled') { if (!m.text) m.text = '(หยุดตอบแล้ว)'; }
      else if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed' || code === 'tools_unavailable') {
        if (code === 'tools_unavailable') { ai.tools = false; m.error = 'ใช้เครื่องมือแผนที่ไม่ได้ในหน้านี้ ลองถามใหม่อีกครั้งครับ'; }
        else {
          ai.enabled = false; setAskHint();
          var i = state.messages.indexOf(m); if (i >= 0) state.messages.splice(i, 1);
          offlineAnswer(storyId ? 'story:' + storyId : 'q:' + text);
          toast('ไม่ได้อนุญาตให้ใช้ Claude ในหน้านี้ เลยตอบจากข่าวแบบออฟไลน์แทน');
        }
      } else {
        if (code === 'prompt_too_large') ai.turns = [];
        m.error = AI_ERR[code] || AI_ERR.upstream_error;
      }
    }).then(function () {
      setBusy(false);
      ai.ctl = null;
      renderMsgs();
    });
  }

  /* ---------- ส่งคำถาม: ใช้ AI ถ้ามี ไม่งั้นตอบแบบออฟไลน์ ---------- */
  function submitQuestion(text) {
    if (!text || state.typing || ai.busy) return;
    if (!IN_ARTIFACT && PP_RE.test(text) && !parseCoords(text)) {
      if (state.page !== 'chat') setPage('chat');
      state.messages.push({ role: 'user', text: text }, { role: 'bot', key: 'pp' });
      renderMsgs();
      return;
    }
    if (!IN_ARTIFACT && (((SITE_RE.test(text) || TWIN_RE.test(text)) && !/ข่าว/.test(text)) || parseCoords(text))) { siteQuery(text); return; }
    if (NEAR_RE.test(text)) {
      if (state.page !== 'chat') setPage('chat');
      state.messages.push({ role: 'user', text: text });
      renderMsgs();
      locateMe();
      return;
    }
    if (ai.enabled) { askAI(text); return; }
    ask('q:' + text, text);
  }
  var askTimer = null;
  // ตอบแบบออฟไลน์ (ไม่มี AI): ใส่ข้อความตอบ แล้วขยับแผนที่ตามหัวข้อ
  function offlineAnswer(key) {
    if (key.indexOf('place:') === 0) {
      state.messages.push({ role: 'bot', key: 'place', place: key.slice(6) });
      renderMsgs();
      goTo(key.slice(6));
      return;
    }
    if (key.indexOf('story:') === 0) {
      var s = storyById(key.slice(6));
      state.messages.push({ role: 'bot', key: 'story', story: key.slice(6) });
      renderMsgs();
      if (s) { goTo(deepestPlace(s.lon, s.lat).id); state.selPin = s.id; renderPinCard(); refreshView(views.chat); }
      return;
    }
    if (key.indexOf('q:') === 0) {
      var q = key.slice(2);
      state.messages.push({ role: 'bot', key: 'q', q: q });
      renderMsgs();
      showQueryOnMap(resolveQuery(q));
      return;
    }
    state.messages.push({ role: 'bot', key: key });
    var t = key.indexOf('topic:') === 0 ? TOPIC_DEF[key.slice(6)] : null;
    if (t) {
      D.LAYERS.forEach(function (l) { state.layers[l.id] = !t.layers || t.layers.indexOf(l.id) >= 0; });
      renderChips();
      renderMsgs();
      goTo(t.place);
    } else {
      renderMsgs();
    }
  }
  function ask(key, text) {
    if (state.typing || ai.busy) return;
    if (ai.enabled) { askAI(text, key.indexOf('story:') === 0 ? key.slice(6) : null); return; }
    if (state.page !== 'chat') setPage('chat');
    state.messages.push({ role: 'user', text: text });
    state.typing = true;
    renderMsgs();
    clearTimeout(askTimer);
    askTimer = setTimeout(function () {
      state.typing = false;
      offlineAnswer(key);
    }, 900);
  }
  $('askForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (ai.busy) { if (ai.ctl) ai.ctl.abort(); return; }
    var t = $('askInput').value.trim();
    if (!t || state.typing) return;
    $('askInput').value = '';
    submitQuestion(t);
  });

  /* ---------- หน้าสรุปเช้านี้ ---------- */
  function groupKey(s) { return state.groupBy === 'cat' ? s.layer : s.zone; }
  function groupDefs() {
    return state.groupBy === 'cat'
      ? D.LAYERS.map(function (l) { return { id: l.id, name: l.name, long: l.long }; })
      : ZONES;
  }
  // จัดลำดับข่าวที่จะแสดง: เรื่องเด่น 1 เรื่อง แล้วตามด้วยกลุ่ม
  function briefLayout() {
    var place = byId[state.place];
    // หน้าแรก (ประเทศไทย) แสดงทุกเรื่อง ทั้งข่าวไทย AI โลก และต่างประเทศ
    var inP = place.id === HOME ? D.STORIES.slice().sort(byRank) : storiesIn(place);
    var list = inP.filter(function (s) { return state.filter === 'all' || groupKey(s) === state.filter; });
    var lead = state.filter === 'all' && list.length >= 4 ? list[0] : null;
    var rest = lead ? list.slice(1) : list;
    var groups = groupDefs().map(function (g) {
      return { def: g, items: rest.filter(function (s) { return groupKey(s) === g.id; }) };
    }).filter(function (g) { return g.items.length; });
    var seq = (lead ? [lead] : []).concat(groups.reduce(function (a, g) { return a.concat(g.items); }, []));
    var num = {};
    seq.forEach(function (s, i) { num[s.id] = i + 1; });
    return { place: place, inP: inP, list: list, lead: lead, groups: groups, seq: seq, num: num };
  }

  function storyCard(s, n, lead) {
    var p = pal(), ink = numInk();
    return '<article class="story' + (lead ? ' lead' : '') + (state.selStory === s.id ? ' sel' : '') + '" id="story-' + s.id + '">' +
      (lead ? '<div class="lead-tag">เรื่องเด่นเช้านี้</div>' : '') +
      '<div class="s-top"><span class="s-num" style="background:' + p[s.layer] + ';color:' + ink + '">' + n + '</span>' +
      '<div class="s-meta"><b style="color:' + p[s.layer] + '">' + esc(NAME[s.layer]) + '</b><span>' + esc(s.place) + '</span><span>' + esc(s.date) + '</span></div></div>' +
      '<h3 class="s-title"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></h3>' +
      '<p class="s-sum">' + esc(s.summary) + '</p>' +
      '<div class="s-why"><b>' + esc(s.why) + '</b><span>' + esc(s.thai) + '</span></div>' +
      '<div class="s-foot"><a class="src-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">อ่านต่อที่ ' + esc(s.source) + ICO.ext + '</a>' +
      '<div class="s-actions"><button type="button" class="act" data-show="' + s.id + '">' + ICO.pin + 'ดูบนแผนที่</button>' +
      '<button type="button" class="act" data-ask="' + s.id + '">' + ICO.chat + 'ถาม ChatGeo</button></div></div>' +
      '</article>';
  }

  function renderBrief() {
    var p = pal();
    var L = briefLayout(), place = L.place, isWorld = place.id === 'world' || place.id === HOME;
    $('briefTitle').textContent = isWorld
      ? L.inP.length + ' เรื่องที่ควรรู้ก่อนเริ่มวัน'
      : (L.inP.length ? L.inP.length + ' เรื่องใน' + place.name + 'ที่ควรรู้เช้านี้' : 'เช้านี้ยังไม่มีข่าวใน' + place.name);
    var fdef = state.filter !== 'all' ? find(groupDefs(), function (g) { return g.id === state.filter; }) : null;
    $('briefMapLabel').textContent = fdef
      ? fdef.long + ' · ' + L.list.length + ' เรื่อง'
      : place.id === HOME
        ? 'ประเทศไทย · ' + L.inP.filter(function (s) { return ZONE_FEAT[s.zone]; }).length + ' เรื่อง'
        : place.name + ' · ' + L.inP.length + ' เรื่อง';
    $('btnClearSel').hidden = !state.selStory;

    // ตัวเลือกการแบ่ง และชิปกรอง
    $('groupSeg').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-group') === state.groupBy));
    });
    var defs = groupDefs().filter(function (g) { return L.inP.some(function (s) { return groupKey(s) === g.id; }); });
    $('briefFilters').innerHTML = L.inP.length ? [{ id: 'all', name: 'ทั้งหมด' }].concat(defs).map(function (g) {
      var on = state.filter === g.id;
      var count = g.id === 'all' ? L.inP.length : L.inP.filter(function (s) { return groupKey(s) === g.id; }).length;
      var dot = state.groupBy === 'cat' && g.id !== 'all' ? '<span class="dot" style="background:' + p[g.id] + '"></span>' : '';
      return '<button type="button" class="f-chip" data-f="' + g.id + '" aria-pressed="' + on + '">' + dot + esc(g.name) + '<span class="cnt">' + count + '</span></button>';
    }).join('') : '';

    if (!L.list.length) {
      $('briefList').innerHTML = '<div class="empty-card"><div><strong>ยังไม่มีข่าวใน' + esc(place.name) + 'เช้านี้</strong>' +
        '<span>ลองขึ้นไป 1 ระดับ หรือเลือกพื้นที่ใกล้เคียงจากแถบด้านบน</span></div>' +
        (place.parent ? '<button type="button" class="btn-ghost" data-up="' + place.parent + '">ขึ้นไปดู' + esc(byId[place.parent].name) + '</button>' : '') + '</div>';
    } else {
      var html = '';
      if (L.lead) html += storyCard(L.lead, 1, true);
      L.groups.forEach(function (g) {
        var dot = state.groupBy === 'cat' ? '<span class="dot" style="background:' + p[g.def.id] + '"></span>' : '';
        html += '<section class="news-sec" aria-label="' + esc(g.def.long) + '"><div class="sec-head">' + dot + '<h3>' + esc(g.def.long) + '</h3><span class="cnt">' + g.items.length + ' เรื่อง</span></div>' +
          '<div class="card-grid">' + g.items.map(function (s) { return storyCard(s, L.num[s.id], false); }).join('') + '</div></section>';
      });
      $('briefList').innerHTML = html;
    }
    renderStoryMarkers(L);
    renderPlayer();
    var chars = L.seq.reduce(function (n, s) { return n + s.title.length + s.summary.length + s.thai.length; }, 0);
    $('readMins').textContent = String(Math.max(1, Math.round(chars / 500)));
  }

  function renderStoryMarkers(L) {
    var v = views.brief;
    if (!v) return;
    L = L || briefLayout();
    v.storyMarkers.forEach(function (m) { m.remove(); });
    v.storyMarkers = [];
    var p = pal(), ink = numInk();
    var off = spreadOffsets(L.seq, 17);
    L.seq.slice().reverse().forEach(function (s) {
      var n = L.num[s.id];
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 's-marker' + (state.selStory === s.id ? ' sel' : '');
      el.style.background = p[s.layer];
      el.style.color = ink;
      el.textContent = String(n);
      el.setAttribute('aria-label', n + '. ' + s.title);
      el.addEventListener('click', function (ev) { ev.stopPropagation(); selectStory(s.id, { popup: true }); });
      v.storyMarkers.push(new maplibregl.Marker({ element: el, opacityWhenCovered: '0', offset: off[s.id] }).setLngLat([s.lon, s.lat]).addTo(v.map));
    });
  }

  function closePopup() {
    var v = views.brief;
    if (v && v.popup) { v.popup.remove(); v.popup = null; }
  }
  function selectStory(id, opts) {
    opts = opts || {};
    var v = views.brief;
    var s = storyById(id);
    if (!s) return;
    state.selStory = id;
    if (opts.light) markSelected(); else renderBrief();
    if (!v) return;
    closePopup();
    var z = v.map.getZoom();
    v.map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(z, state.place === 'world' ? 3.4 : z), duration: reduceMotion ? 0 : 1100, essential: true });
    if (opts.popup) {
      var n = briefLayout().num[id] || '';
      var box = document.createElement('div');
      box.innerHTML = '<div class="pop-meta">' + n + ' · ' + esc(NAME[s.layer]) + ' · ' + esc(s.place) + '</div>' +
        '<div class="pop-title">' + esc(s.title) + '</div><div class="pop-acts"><button type="button" class="pop-btn">อ่านสรุป</button>' +
        '<a class="pop-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.source) + ' ' + ICO.ext + '</a></div>';
      box.querySelector('button.pop-btn').addEventListener('click', function () {
        var card = $('story-' + id);
        if (card) card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
      v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 20, maxWidth: '300px', focusAfterOpen: false })
        .setLngLat([s.lon, s.lat]).setDOMContent(box).addTo(v.map);
    }
    if (opts.scrollMap) $('briefMapCard').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function markSelected() {
    document.querySelectorAll('.story').forEach(function (el) {
      el.classList.toggle('sel', el.id === 'story-' + state.selStory);
    });
    renderStoryMarkers();
    $('btnClearSel').hidden = !state.selStory;
  }

  $('groupSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-group]');
    if (!b || b.getAttribute('data-group') === state.groupBy) return;
    state.groupBy = b.getAttribute('data-group');
    try { localStorage.setItem('cg-group2', state.groupBy); } catch (err) { /* ข้าม */ }
    state.filter = 'all';
    state.selStory = null;
    closePopup();
    stopSpeech();
    renderBrief();
  });
  $('briefFilters').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (!b) return;
    state.filter = b.getAttribute('data-f');
    state.selStory = null;
    closePopup();
    stopSpeech();
    renderBrief();
    fitBriefToList();
  });
  // กดชิปกลุ่ม (เช่น AI โลก) แล้วให้แผนที่ซูมให้เห็นข่าวกลุ่มนั้นครบ
  function fitBriefToList() {
    var v = views.brief;
    if (!v) return;
    if (state.filter === 'all') { flyToPlace(v, byId[state.place]); return; }
    if (ZONE_FEAT[state.filter] && byId[state.filter]) { flyToPlace(v, byId[state.filter]); return; }
    var list = briefLayout().list;
    if (!list.length) return;
    var w = 180, e = -180, so = 90, n = -90;
    list.forEach(function (s) { w = Math.min(w, s.lon); e = Math.max(e, s.lon); so = Math.min(so, s.lat); n = Math.max(n, s.lat); });
    var pad = 2;
    v.map.fitBounds([[Math.max(-180, w - pad), Math.max(-80, so - pad)], [Math.min(180, e + pad), Math.min(80, n + pad)]],
      { padding: mapPadding(v), maxZoom: 6, duration: reduceMotion ? 0 : 1200 });
  }
  $('briefList').addEventListener('click', function (e) {
    var up = e.target.closest('[data-up]');
    if (up) { goTo(up.getAttribute('data-up')); return; }
    var show = e.target.closest('[data-show]');
    if (show) { selectStory(show.getAttribute('data-show'), { scrollMap: true, popup: true }); return; }
    var a = e.target.closest('[data-ask]');
    if (a) {
      var s = storyById(a.getAttribute('data-ask'));
      if (s) ask('story:' + s.id, 'เล่าเรื่อง "' + s.title + '" เพิ่มหน่อย');
    }
  });
  $('btnClearSel').addEventListener('click', function () {
    state.selStory = null;
    closePopup();
    renderBrief();
    flyToPlace(views.brief, byId[state.place]);
  });

  /* ข้อมูลประกอบด้านขวา */
  var DIR_ICON = { up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', flat: 'M5 12h14' };
  var CHANNELS = [{ id: 'line', name: 'LINE' }, { id: 'email', name: 'อีเมล' }, { id: 'app', name: 'แจ้งเตือนในแอป' }];
  function renderAside() {
    var mk = D.MARKETS || [], wx = D.WEATHER || [];
    $('marketsAsOf').textContent = D.MARKETS_ASOF || '';
    $('markets').closest('.side-card').hidden = !mk.length;
    $('weather').closest('.side-card').hidden = !wx.length;
    $('markets').innerHTML = mk.map(function (m) {
      var dir = DIR_ICON[m.dir] ? m.dir : 'flat';
      var color = m.dir === 'up' ? 'var(--up)' : m.dir === 'down' ? 'var(--down)' : 'var(--muted)';
      return '<a class="mkt-row" href="' + esc(m.url || '#') + '" target="_blank" rel="noopener" title="ที่มา: ' + esc(m.source || '') + '">' +
        '<span class="mkt-name">' + esc(m.name) + '</span>' +
        '<span class="mkt-val"><span class="num">' + esc(m.value || '–') + '</span> <small>' + esc(m.unit || '') + '</small></span>' +
        '<span class="mkt-chg" style="color:' + color + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + DIR_ICON[dir] + '"/></svg>' + esc(m.change || '') + '</span></a>';
    }).join('');
    $('weather').innerHTML = wx.map(function (w) {
      var lv = w.level === 'warning' ? 'เตือน' : w.level === 'watch' ? 'เฝ้าระวัง' : 'ปกติ';
      return '<button type="button" class="wx-row" data-wx="' + esc(byId[w.place] ? w.place : 'th') + '"><span class="wx-head"><b>' + esc(w.region) + '</b>' +
        '<span class="wx-lv" style="color:' + levelColor(w.level) + '"><span class="dot" style="background:' + levelColor(w.level) + '"></span>' + lv + '</span></span>' +
        '<span class="wx-txt">' + esc(w.status) + '</span></button>';
    }).join('');
    var ws = D.WEATHER_SRC;
    $('weatherNote').innerHTML = esc(D.WEATHER_NOTE || '') + (ws && ws.url ? ' <a class="src-link" href="' + esc(ws.url) + '" target="_blank" rel="noopener">' + esc(ws.name || 'ที่มา') + ICO.ext + '</a>' : '');
    $('channels').innerHTML = CHANNELS.map(function (c) {
      var on = !!state.channels[c.id];
      return '<button type="button" class="ch-btn" data-ch="' + c.id + '" aria-pressed="' + on + '">' +
        (on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : '') + esc(c.name) + '</button>';
    }).join('');
  }
  $('weather').addEventListener('click', function (e) {
    var b = e.target.closest('[data-wx]');
    if (b) { goTo(b.getAttribute('data-wx')); $('briefMapCard').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); }
  });
  $('channels').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ch]');
    if (!b) return;
    var id = b.getAttribute('data-ch');
    state.channels[id] = !state.channels[id];
    renderAside();
  });

  /* ฟังสรุปเสียงภาษาไทย (ใช้เสียงอ่านของเครื่อง) */
  var speech = { playing: false, idx: 0, segs: [], token: 0 };
  function buildSegments() {
    var L = briefLayout();
    var segs = [{ text: 'สรุปเช้านี้ ' + D.META.speakDate + '. ' + $('briefTitle').textContent, story: null }];
    L.seq.forEach(function (s) {
      segs.push({ text: 'เรื่องที่ ' + L.num[s.id] + '. ' + s.title + '. ' + s.summary + '. ' + s.why + '. ' + s.thai, story: s.id });
    });
    return segs;
  }
  function thaiVoice() {
    try {
      return find(window.speechSynthesis.getVoices(), function (x) { return /^th/i.test(x.lang); });
    } catch (e) { return null; }
  }
  function renderPlayer() {
    $('icoPlay').hidden = speech.playing;
    $('icoPause').hidden = !speech.playing;
    $('btnPlay').setAttribute('aria-label', speech.playing ? 'หยุดเสียงชั่วคราว' : 'ฟังสรุปเสียงภาษาไทย');
    var n = briefLayout().seq.length;
    $('playBar').style.width = speech.playing || speech.idx > 0 ? Math.round(100 * speech.idx / (n + 1)) + '%' : '0%';
    if (speech.playing) {
      $('playInfo').textContent = speech.idx === 0 ? 'กำลังอ่านบทนำ' : 'กำลังอ่านเรื่องที่ ' + speech.idx + ' จาก ' + n;
    } else if (speech.idx > 0) {
      $('playInfo').textContent = 'หยุดไว้ที่เรื่องที่ ' + speech.idx + ' จาก ' + n;
    } else {
      $('playInfo').textContent = n ? n + ' เรื่อง · ประมาณ ' + Math.max(1, Math.round(n * 0.4)) + ' นาที' : 'ยังไม่มีเรื่องให้ฟัง';
    }
  }
  function stopSpeech(keepPos) {
    speech.token++;
    speech.playing = false;
    if (!keepPos) speech.idx = 0;
    try { window.speechSynthesis.cancel(); } catch (e) { /* ข้าม */ }
    if ($('btnPlay')) renderPlayer();
  }
  function speakFrom(i, token) {
    if (token !== speech.token) return;
    if (i >= speech.segs.length) { stopSpeech(); return; }
    speech.idx = i;
    renderPlayer();
    var seg = speech.segs[i];
    if (seg.story) selectStory(seg.story, { light: true });
    var u = new SpeechSynthesisUtterance(seg.text);
    u.lang = 'th-TH';
    var voice = thaiVoice();
    if (voice) u.voice = voice;
    u.onend = function () { speakFrom(i + 1, token); };
    u.onerror = function (ev) {
      if (token !== speech.token) return;
      if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
      stopSpeech();
      toast('อ่านออกเสียงไม่สำเร็จ ลองเปิดหน้านี้ใน Safari หรือ Chrome');
    };
    window.speechSynthesis.speak(u);
  }
  function startSpeech() {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast('เบราว์เซอร์นี้อ่านออกเสียงไม่ได้ ลองเปิดใน Safari หรือ Chrome');
      return;
    }
    var go = function () {
      if (!thaiVoice()) {
        toast('เครื่องนี้ยังไม่มีเสียงอ่านภาษาไทย บน Mac เพิ่มได้ที่ การตั้งค่าระบบ › การช่วยการเข้าถึง › เนื้อหาที่พูด › เสียงของระบบ แล้วเลือกเสียงภาษาไทย');
        return;
      }
      speech.segs = buildSegments();
      speech.playing = true;
      speech.token++;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ข้าม */ }
      closePopup();
      speakFrom(Math.min(speech.idx, speech.segs.length - 1), speech.token);
    };
    if (window.speechSynthesis.getVoices().length) { go(); return; }
    var done = false;
    var once = function () { if (done) return; done = true; go(); };
    try { window.speechSynthesis.addEventListener('voiceschanged', once, { once: true }); } catch (e) { /* ข้าม */ }
    setTimeout(once, 1200);
  }
  $('btnPlay').addEventListener('click', function () {
    if (speech.playing) stopSpeech(true); else startSpeech();
  });

  /* ---------- ซ่อน/แสดงแชทด้านข้าง (แผนที่เต็มกว้าง) ---------- */
  var chatHidden = false;
  try { chatHidden = localStorage.getItem('cg-chat-hidden') === '1'; } catch (e) { /* ข้าม */ }
  function setChatHidden(h, quiet) {
    chatHidden = !!h;
    document.body.classList.toggle('chat-hidden', chatHidden);
    var b = $('btnChatTab');
    if (b) {
      b.setAttribute('aria-expanded', String(!chatHidden));
      b.setAttribute('aria-label', chatHidden ? 'แสดงแชท' : 'ซ่อนแชท ให้แผนที่เต็มจอ');
      b.title = chatHidden ? 'แสดงแชท' : 'ซ่อนแชท';
      b.querySelector('.ct-t').textContent = chatHidden ? 'แชท' : '';
    }
    if (quiet) return;
    try { localStorage.setItem('cg-chat-hidden', chatHidden ? '1' : '0'); } catch (e) { /* ข้าม */ }
    var v = views.chat;
    if (v) setTimeout(function () { v.map.resize(); }, 30);
    if (!chatHidden && $('askInput') && window.matchMedia('(min-width: 861px)').matches) $('askInput').focus();
  }
  if ($('btnChatTab')) {
    setChatHidden(chatHidden, true);
    $('btnChatTab').addEventListener('click', function () { setChatHidden(!chatHidden); });
  }

  /* ---------- ธีม / ลูกโลก ---------- */
  function applyThemeChrome() {
    document.body.classList.toggle('cg-dark', state.theme === 'dark');
    document.body.classList.toggle('cg-light', state.theme === 'light');
    $('icoSun').hidden = state.theme !== 'dark';
    $('icoMoon').hidden = state.theme === 'dark';
    $('btnTheme').setAttribute('aria-label', state.theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด');
  }
  function reloadBase() {
    eachView(function (v) {
      v.styleLoading = true;
      v.tileOK = false; v.tileErrors = 0;
      if (!usingFallback) armFallbackTimer(v);
      v.map.setStyle(baseStyle(state.theme), { diff: false });
    });
  }
  // แผนที่ฐานที่เลือกโหลดไม่ได้: กลับไปใช้แผนที่ ChatGeo ชั่วคราว (ไม่ลบค่าที่เลือกไว้ เปิดครั้งหน้าจะลองใหม่)
  function baseFailed() {
    if (BASE.id === 'auto' || (OPS && OPS.on) || usingFallback || styleOverride) return false;
    var b = BASES.filter(function (x) { return x.id === BASE.id; })[0];
    BASE.id = 'auto'; BASE.revertAt = Date.now();
    toast('โหลดแผนที่ ' + (b ? b.t : '') + ' ไม่ได้ตอนนี้ กลับมาใช้แผนที่ ChatGeo ก่อน');
    reloadBase(); renderBaseChips();
    return true;
  }
  function setBase(id) {
    if (id === BASE.id) return;
    BASE.id = id;
    try { localStorage.setItem('cg-base', id); } catch (e) { /* ข้าม */ }
    if (!(OPS && OPS.on)) reloadBase();
    renderBaseChips();
  }
  function renderBaseChips() {
    var el = $('baseChips');
    if (!el) return;
    el.innerHTML = BASES.map(function (b) {
      return '<button type="button" class="base-opt" data-base="' + b.id + '" aria-pressed="' + (BASE.id === b.id) + '" title="' + esc(b.t + ' · ' + b.sub) + '">' +
        '<span class="base-th base-' + b.id + '" aria-hidden="true">' + (b.thumb && !usingFallback ? '<img alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" src="' + esc(b.thumb) + '">' : '') + '</span>' +
        '<span class="base-t">' + esc(b.t) + '</span><small>' + esc(b.sub) + '</small></button>';
    }).join('') + (usingFallback ? '<p class="fp-fine">โหมดออฟไลน์ใช้แผนที่สำรองแบบเดียว</p>' : '');
  }
  if ($('baseChips')) $('baseChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-base]');
    if (b) setBase(b.getAttribute('data-base'));
  });
  $('btnTheme').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cg-theme2', state.theme); } catch (e) { /* ไม่มี storage */ }
    applyThemeChrome();
    reloadBase();
    renderSuggest();
    renderMsgs();
    renderChips();
    renderBrief();
    renderAside();
    renderPinCard();
  });
  $('btnGlobe').addEventListener('click', function () {
    state.globe = !state.globe;
    $('btnGlobe').setAttribute('aria-pressed', String(state.globe));
    $('globeText').textContent = state.globe ? 'แผนที่แบน' : 'ลูกโลก';
    eachView(applyProjection);
    var v = views[state.page];
    if (v && state.place === 'world') flyToPlace(v, byId.world);
  });

  /* ---------- อื่นๆ ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 8000);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('filterPop').hidden) { setFilterOpen(false); $('btnFilter').focus(); return; }
    if (state.selPin) { state.selPin = null; renderPinCard(); refreshView(views.chat); }
    closePopup();
  });
  window.addEventListener('resize', function () {
    var v = views[state.page];
    if (v && state.place === 'world') v.map.setZoom(worldZoom(v));
  });

  /* ---------- สรุปข่าวรายวันจากฐานข้อมูลของหน้า (อัปเดตเองทุกเช้า) ---------- */
  var TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var TH_MON = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var TH_MON_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function parseYMD(str) {
    var m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function thaiDates(ymd) {
    var d = parseYMD(ymd);
    if (!d) return null;
    var be = d.getUTCFullYear() + 543;
    return {
      dateLong: TH_DAY[d.getUTCDay()] + 'ที่ ' + d.getUTCDate() + ' ' + TH_MON[d.getUTCMonth()] + ' ' + be,
      dateShort: d.getUTCDate() + ' ' + TH_MON_S[d.getUTCMonth()] + ' ' + be,
      speakDate: 'วัน' + TH_DAY[d.getUTCDay()] + 'ที่ ' + d.getUTCDate() + ' ' + TH_MON[d.getUTCMonth()]
    };
  }
  var LAYER_IDS = D.LAYERS.map(function (l) { return l.id; });
  function normalizeBrief(doc) {
    var base = parseYMD(doc.date);
    var stories = (doc.stories || []).filter(function (s) {
      return s && s.id && s.title && s.url && isFinite(+s.lon) && isFinite(+s.lat);
    }).map(function (s, i) {
      var pd = parseYMD(s.published) || base;
      var ago = base && pd ? Math.round((base - pd) / 86400000) : 0;
      return {
        id: String(s.id).toLowerCase(), rank: +s.rank || i + 1, top: !!s.top,
        region: ['th', 'asean', 'world', 'ai'].indexOf(s.region) >= 0 ? s.region : 'world',
        layer: LAYER_IDS.indexOf(s.layer) >= 0 ? s.layer : 'news',
        title: String(s.title), summary: String(s.summary || ''),
        why: String(s.why_label || s.whyLabel || 'ควรรู้'), thai: String(s.why || s.thai || ''),
        place: String(s.place || ''), lon: +s.lon, lat: +s.lat,
        date: pd ? pd.getUTCDate() + ' ' + TH_MON_S[pd.getUTCMonth()] : '',
        when: ago <= 0 ? 'วันนี้' : ago === 1 ? 'เมื่อวาน' : ago + ' วันก่อน',
        source: String(s.source || ''), url: String(s.url)
      };
    }).sort(function (a, b) { return a.rank - b.rank; });
    stories.forEach(function (s) { s.zone = zoneOfStory(s); });
    var td = thaiDates(doc.date) || {};
    return {
      key: doc.date + '|' + (doc.generatedAt || ''),
      META: {
        date: doc.date, dateLong: doc.dateLong || td.dateLong, dateShort: doc.dateShort || td.dateShort, speakDate: td.speakDate,
        sources: stories.reduce(function (acc, s) { if (acc.indexOf(s.source) < 0) acc.push(s.source); return acc; }, []).length
      },
      STORIES: stories,
      MARKETS: doc.markets || [], MARKETS_ASOF: doc.marketsAsOf || '',
      WEATHER: doc.weather || [], WEATHER_NOTE: doc.weatherNote || '',
      WEATHER_SRC: doc.weatherSource || doc.weatherSrc || null,
      QUESTIONS: (doc.questions && doc.questions.length) ? doc.questions : null
    };
  }
  var currentKey = 'seed|' + D.META.date;
  function applyBrief(doc) {
    var b = normalizeBrief(doc);
    if (!b.STORIES.length || b.key === currentKey) return;
    currentKey = b.key;
    D.META = b.META; D.STORIES = b.STORIES;
    D.MARKETS = b.MARKETS; D.MARKETS_ASOF = b.MARKETS_ASOF;
    D.WEATHER = b.WEATHER; D.WEATHER_NOTE = b.WEATHER_NOTE; D.WEATHER_SRC = b.WEATHER_SRC;
    D.QUESTIONS = b.QUESTIONS; D.TOPICS = null;
    if (state.selPin && !storyById(state.selPin)) state.selPin = null;
    if (state.selStory && !storyById(state.selStory)) state.selStory = null;
    stopSpeech();
    closePopup();
    renderMeta();
    renderSuggest();
    renderMsgs();
    renderChips();
    renderExplorers();
    renderAside();
    renderPinCard();
    renderBrief();
    eachView(refreshView);
  }
  // สรุปที่เปิดอยู่เก่ากว่าเช้านี้ไหม (เวลาไทย) ก่อน 7 โมงยังถือว่าของเมื่อวานปกติ
  function staleDays(ymd) {
    var d = parseYMD(ymd);
    if (!d) return 0;
    var n = new Date(Date.now() + 7 * 3600000);
    var today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    var days = Math.round((today - d.getTime()) / 86400000);
    if (days <= 0 || (days === 1 && n.getUTCHours() < 7)) return 0;
    return days;
  }
  function renderMeta() {
    $('briefDate').textContent = D.META.dateLong || '';
    var old = archive.pinned ? 0 : staleDays(D.META.date);
    if ($('badgeText')) {
      $('badgeText').textContent = (old ? 'ข่าวล่าสุด ณ ' : 'ข่าว ณ ') + (D.META.dateShort || '');
      $('badgeText').classList.toggle('stale', !!old);
    }
    $('srcCount').textContent = String(D.META.sources || 0);
    var sn = $('staleNote');
    if (sn) {
      sn.hidden = !old;
      sn.textContent = old ? 'สรุปนี้เป็นของ' + (D.META.dateLong || '') + ' (' + (old === 1 ? 'เมื่อวาน' : old + ' วันก่อน') +
        ') สรุปของเช้านี้ยังไม่มา ข้อมูลน้ำ ฝน และพยากรณ์บนแผนที่ยังเป็นของล่าสุด' : '';
    }
  }
  var archive = { list: [], pinned: null };
  function renderArchive() {
    var sel = $('briefDateSel');
    if (archive.list.length < 2) { sel.hidden = true; $('briefDate').hidden = false; return; }
    sel.innerHTML = archive.list.map(function (d, i) {
      var td = thaiDates(d.date) || { dateLong: d.date };
      return '<option value="' + esc(d.date) + '">' + esc(td.dateLong) + (i === 0 ? ' (ล่าสุด)' : '') + '</option>';
    }).join('');
    sel.value = D.META.date;
    sel.hidden = false;
    $('briefDate').hidden = true;
  }
  $('briefDateSel').addEventListener('change', function () {
    var d = find(archive.list, function (x) { return x.date === $('briefDateSel').value; });
    if (!d) return;
    archive.pinned = archive.list.indexOf(d) === 0 ? null : d.date;
    if (d.stories) { applyBrief(d); return; }
    // บนเว็บจริง: โหลดสรุปย้อนหลังจากไฟล์ data/briefs/<วันที่>.json
    fetchJSON('data/briefs/' + d.date + '.json').then(function (doc) {
      if (doc && doc.stories) { d.stories = doc.stories; Object.assign(d, doc); applyBrief(d); renderArchive(); }
    }).catch(function () { toast('โหลดสรุปของวันนั้นไม่สำเร็จ ลองใหม่อีกครั้งครับ'); });
  });
  function fetchJSON(url) {
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  // เปิดบนเว็บจริง (http/https): อ่านสรุปล่าสุดจาก data/latest.json ที่ระบบหลังบ้านอัปเดตทุกเช้า
  function connectStaticSite() {
    if (!/^https?:$/.test(location.protocol)) return;
    fetchJSON('data/latest.json').then(function (doc) {
      if (!doc || !doc.stories || !doc.stories.length) return;
      applyBrief(doc);
      var dates = (doc.archive || []).filter(function (x) { return x && x !== doc.date; });
      archive.list = [doc].concat(dates.map(function (x) { return { date: x }; }));
      renderArchive();
    }).catch(function () { /* ไม่มีไฟล์ ใช้ข่าวที่มากับเว็บ */ });
  }

  function connectRuntime() {
    if (!window.claude || typeof window.claude.use !== 'function') { connectStaticSite(); return; } // เว็บจริงหรือไฟล์ในเครื่อง
    window.claude.use('db').then(function (db) {
      if (!db) return;
      db.collection('briefs').orderBy('date', 'desc').limit(14).onSnapshot(function (snap) {
        archive.list = snap.docs.filter(function (d) { return d.exists; }).map(function (d) { return d.data(); })
          .filter(function (d) { return d && d.date && d.stories && d.stories.length; });
        if (!archive.list.length) return;
        var target = archive.pinned ? (find(archive.list, function (x) { return x.date === archive.pinned; }) || archive.list[0]) : archive.list[0];
        applyBrief(target);
        renderArchive();
      }, function () { /* ใช้ข้อมูลที่มากับหน้าเว็บต่อไป */ });
    }).catch(function () {});
    window.claude.use('sample').then(function (fn) {
      if (!fn) return;
      ai.sample = fn;
      ai.enabled = true;
      setAskHint();
      if (typeof fn.limits === 'function') {
        fn.limits().then(function (l) { ai.tools = !!(l && l.tools); }).catch(function () { ai.tools = false; });
      }
    }).catch(function () {});
  }

  /* ---------- ข้อมูลสาธารณะสด: ระดับน้ำ ฝน (ThaiWater) พยากรณ์ (Open-Meteo) ภาพดาวเทียม ---------- */
  // เมืองตัวแทนของแต่ละภาค ใช้ดึงพยากรณ์ 3 วัน
  var FC_CITIES = [
    { zone: 'th-n', city: 'เชียงใหม่', lat: 18.79, lon: 98.98 },
    { zone: 'th-ne', city: 'ขอนแก่น', lat: 16.43, lon: 102.83 },
    { zone: 'th-c', city: 'กรุงเทพฯ', lat: 13.75, lon: 100.50, anchor: 'bottom-left', offset: [6, -6] },
    { zone: 'th-e', city: 'ชลบุรี', lat: 13.36, lon: 100.98, anchor: 'left', offset: [10, 2] },
    { zone: 'th-w', city: 'กาญจนบุรี', lat: 14.02, lon: 99.53, anchor: 'top-right', offset: [-4, 8] },
    { zone: 'th-s', city: 'สุราษฎร์ธานี', lat: 9.14, lon: 99.33 },
    { zone: 'th-s', city: 'หาดใหญ่', lat: 7.01, lon: 100.47 }
  ];
  var TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var LIVE = { water: [], rain: [], fc: [], src: {}, at: {} };
  function wmoText(c) {
    c = +c;
    if (c === 0) return 'แจ่มใส';
    if (c <= 2) return 'มีเมฆบางส่วน';
    if (c === 3) return 'เมฆมาก';
    if (c === 45 || c === 48) return 'หมอก';
    if (c >= 51 && c <= 57) return 'ฝนปรอย';
    if (c >= 61 && c <= 67) return c >= 65 ? 'ฝนหนัก' : 'ฝน';
    if (c >= 80 && c <= 82) return c === 82 ? 'ฝนซู่หนัก' : 'ฝนซู่';
    if (c >= 95) return 'พายุฝนฟ้าคะนอง';
    return '–';
  }
  function txtOf(o) { return o == null ? '' : typeof o === 'string' ? o : String(o.th || o.en || ''); }
  function numOf(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function parseWater(j) {
    var arr = (j && j.waterlevel_data && j.waterlevel_data.data) || (j && j.data) || [];
    return arr.map(function (r) {
      var st = r.station || {}, g = r.geocode || {};
      var lat = numOf(st.tele_station_lat), lon = numOf(st.tele_station_long);
      if (lat == null || lon == null) return null;
      return {
        id: 'w' + (st.id || r.id), name: txtOf(st.tele_station_name), prov: txtOf(g.province_name), river: String(r.river_name || ''),
        lat: lat, lon: lon, lv: +r.situation_level || 0, pct: numOf(r.storage_percent), msl: numOf(r.waterlevel_msl),
        diff: numOf(r.diff_wl_bank), diffText: String(r.diff_wl_bank_text || ''), time: String(r.waterlevel_datetime || '')
      };
    }).filter(Boolean);
  }
  function parseRain(j) {
    var arr = (j && j.data) || [];
    return arr.map(function (r) {
      var st = r.station || {}, g = r.geocode || {};
      var lat = numOf(st.tele_station_lat), lon = numOf(st.tele_station_long), mm = numOf(r.rain_24h);
      if (lat == null || lon == null || mm == null || mm <= 0) return null;
      return { id: 'r' + (st.id || r.id), name: txtOf(st.tele_station_name), prov: txtOf(g.province_name),
        lat: lat, lon: lon, mm: mm, mm1: numOf(r.rain_1h), time: String(r.rainfall_datetime || '') };
    }).filter(function (o) { return o && o.mm >= 1; }).sort(function (a, b) { return b.mm - a.mm; }).slice(0, 1500);
  }
  function parseForecast(j) {
    var arr = Array.isArray(j) ? j : [j];
    return FC_CITIES.map(function (c, i) {
      var d = arr[i] && arr[i].daily;
      if (!d || !d.time) return null;
      return {
        zone: c.zone, city: c.city, lat: c.lat, lon: c.lon,
        days: d.time.map(function (t, k) {
          return { d: t, code: d.weather_code[k], tmax: d.temperature_2m_max[k], tmin: d.temperature_2m_min[k],
            rain: d.precipitation_sum[k], prob: d.precipitation_probability_max[k] };
        })
      };
    }).filter(Boolean);
  }
  function fcUrl() {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + FC_CITIES.map(function (c) { return c.lat; }).join(',') +
      '&longitude=' + FC_CITIES.map(function (c) { return c.lon; }).join(',') +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max' +
      '&timezone=Asia%2FBangkok&forecast_days=3';
  }
  function getJSON(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 9000);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }
  // ดึงจากต้นทางสดก่อน ถ้าไม่ได้ (เช่น ติด CORS หรือเน็ตล่ม) ใช้ data/live.json ที่งานเช้าเก็บไว้
  function loadLive() {
    if (IN_ARTIFACT) return;
    var snap = null;
    function snapshot() {
      if (!snap) snap = fetchJSON('data/live.json').catch(function () { return null; });
      return snap;
    }
    function one(key, url, parse) {
      return getJSON(url).then(function (j) {
        var a = parse(j);
        if (!a.length) throw new Error('empty');
        LIVE[key] = a; LIVE.src[key] = 'live'; LIVE.at[key] = '';
      }).catch(function () {
        return snapshot().then(function (s) {
          if (s && s[key] && s[key].length) {
            LIVE[key] = key === 'rain' ? s[key].filter(function (o) { return o.mm >= 1; }).slice(0, 1500) : s[key];
            LIVE.src[key] = 'snap'; LIVE.at[key] = s.at || '';
          }
          else LIVE.src[key] = 'none';
        });
      }).then(onLive, onLive);
    }
    one('water', TW_API + 'waterlevel_load', parseWater);
    one('rain', TW_API + 'rain_24h', parseRain);
    one('fc', fcUrl(), parseForecast);
  }
  function onLive() {
    eachView(refreshLive);
    renderDataChips();
    renderLiveCards();
    if (state.messages.some(function (m) { return m.key === 'near' || m.key === 'place' || m.key === 'q'; })) renderMsgs();
  }
  function ptFC(list, props) {
    return { type: 'FeatureCollection', features: list.map(function (o) {
      return { type: 'Feature', properties: props(o), geometry: { type: 'Point', coordinates: [o.lon, o.lat] } };
    }) };
  }
  function refreshLive(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map;
    map.getSource('cg-water').setData(ptFC(LIVE.water, function (o) { return { id: o.id, lv: o.lv }; }));
    map.getSource('cg-rain').setData(ptFC(LIVE.rain, function (o) { return { id: o.id, mm: o.mm }; }));
    map.getSource('cg-fc').setData(ptFC(LIVE.fc, function (o) { return { id: o.city }; }));
    // ไฟล์น้ำท่วมใหญ่ ส่งเข้าแผนที่เฉพาะตอนที่ข้อมูลเปลี่ยน
    if (map.getSource('cg-flood-prov') && v.floodProvSet !== FLOOD.provFC) { map.getSource('cg-flood-prov').setData(FLOOD.provFC || emptyFC()); v.floodProvSet = FLOOD.provFC; }
    [['cg-water', 'water'], ['cg-rain', 'rain'], ['cg-fc', 'fc'], ['cg-sat', 'sat'], ['cg-flood-pf', 'flood'], ['cg-flood-pl', 'flood'],
      ['cg-flood-s', 'flood'], ['cg-flood-f', 'flood'], ['cg-flood-l', 'flood']].forEach(function (x) {
      if (map.getLayer(x[0])) map.setLayoutProperty(x[0], 'visibility', state.data[x[1]] ? 'visible' : 'none');
    });
    if (map.getLayer('cg-thr-line')) map.setPaintProperty('cg-thr-line', 'line-opacity', state.data.sat ? 0.9 : 0.6);
    if (map.getLayer('cg-thp-line')) map.setPaintProperty('cg-thp-line', 'line-opacity', state.data.sat ? 0.55 : 0.28);
    buildFcMarkers(v);
    updateFloodTiles(v);
    updateFloodChip(v);
    if (v.ccMarkers) updateCctvMarkers(v); else buildCctvMarkers(v); // แผนที่ที่สร้างทีหลัง (เปิดหน้ากล้องก่อน) ยังไม่มีหมุด
    updateParcel(v);
    updatePropsMarkers(v);
    updateRadar(v);
    updateCloud(v);
    updateTerrain(v);
    updateWind(v);
    updateHist(v);
    updateHazard(v);
    updateZoning(v);
    updateWorld(v);
  }
  // ป้ายพยากรณ์วันนี้ที่เมืองตัวแทนของแต่ละภาค
  function buildFcMarkers(v) {
    (v.fcMarkers || []).forEach(function (m) { m.remove(); });
    v.fcMarkers = LIVE.fc.map(function (f) {
      var d = f.days[0] || {};
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'fc-chip';
      el.title = f.city + ': ' + f.days.map(function (x) {
        return dowOf(x.d) + ' ' + wmoText(x.code) + ' ฝน ' + Math.round(x.prob || 0) + '% ' + Math.round(x.tmin) + '–' + Math.round(x.tmax) + '°';
      }).join(' · ');
      el.innerHTML = '<b>' + esc(f.city) + '</b>' + DROP + '<span>' + Math.round(d.prob || 0) + '%</span><span class="t">' + Math.round(d.tmax) + '°</span>';
      el.setAttribute('aria-label', 'พยากรณ์' + f.city + ' วันนี้ ' + wmoText(d.code) + ' โอกาสฝน ' + Math.round(d.prob || 0) + ' เปอร์เซ็นต์ สูงสุด ' + Math.round(d.tmax) + ' องศา');
      el.addEventListener('click', function (ev) { ev.stopPropagation(); goTo(f.zone); });
      var c = find(FC_CITIES, function (x) { return x.city === f.city; }) || {};
      return new maplibregl.Marker({ element: el, anchor: c.anchor || 'top', offset: c.offset || [0, 8] }).setLngLat([f.lon, f.lat]).addTo(v.map);
    });
    updateFcMarkers(v);
  }
  function updateFcMarkers(v) {
    if (!v || !v.fcMarkers) return;
    var z = v.map.getZoom();
    var show = state.data.fc && z >= 4 && z < 8.5;
    v.fcMarkers.forEach(function (m) { m.getElement().classList.toggle('off', !show); });
  }
  var DROP = '<svg class="drop" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5s-6.5 7.6-6.5 12.1A6.5 6.5 0 0 0 18.5 14.6C18.5 10.1 12 2.5 12 2.5z"/></svg>';
  function dowOf(ymd) { var d = parseYMD(ymd); return d ? TH_DOW[d.getUTCDay()] : ''; }
  function whenText(key) {
    var list = LIVE[key] || [];
    var t = list.reduce(function (m, o) { return o.time && o.time > m ? o.time : m; }, '');
    var m = String(t).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    var s = m ? +m[3] + ' ' + TH_MON_S[+m[2] - 1] + ' ' + m[4] + ' น.' : '';
    return s + (LIVE.src[key] === 'snap' ? ' (สำรอง)' : '');
  }
  function openStationPopup(v, kind, id) {
    var o = find(LIVE[kind], function (x) { return x.id === id; });
    if (!o) return;
    var box = document.createElement('div');
    var head = '<div class="pop-meta">' + (kind === 'water' ? 'ระดับน้ำ' : 'ฝนสะสม 24 ชม.') + (o.prov ? ' · จ.' + esc(o.prov) : '') + '</div>' +
      '<div class="pop-title">' + esc(o.name || 'สถานี') + '</div>';
    var body;
    if (kind === 'water') {
      var lv = WL[o.lv] || { t: 'ไม่ทราบ', c: '#888' };
      body = '<div class="pop-stat"><i class="tri" style="border-top-color:' + lv.c + '"></i><b>' + lv.t + '</b>' +
        (o.pct != null ? ' · ' + Math.round(o.pct) + '% ของความจุลำน้ำ' : '') + '</div>' +
        (o.diff != null && o.diffText ? '<div class="pop-sub">' + esc(o.diffText.replace(/\s*\(ม\.\)/, '')) + ' ' + Math.abs(o.diff).toFixed(2) + ' ม.</div>' : '') +
        (o.river ? '<div class="pop-sub">' + esc(o.river) + '</div>' : '');
    } else {
      body = '<div class="pop-stat"><b>' + o.mm.toFixed(1) + ' มม.</b> ใน 24 ชม.' + (o.mm1 ? ' · ชั่วโมงล่าสุด ' + o.mm1.toFixed(1) + ' มม.' : '') + '</div>';
    }
    box.innerHTML = head + body + '<div class="pop-sub">วัดเมื่อ ' + esc(o.time) + ' · <a href="https://www.thaiwater.net" target="_blank" rel="noopener">ThaiWater (สสน.)</a></div>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 10, maxWidth: '280px', focusAfterOpen: false })
      .setLngLat([o.lon, o.lat]).setDOMContent(box).addTo(v.map);
  }

  /* ---------- น้ำจากดาวเทียม Sentinel-1 ทั้งประเทศ (ทดลอง) ---------- */
  // GitHub Actions (.github/workflows/flood.yml) วิเคราะห์ทีละกรอบ 1 องศา แล้วเก็บผลใน branch flood-data
  // index.json (เล็ก โหลดทันที) = รายการกรอบ + สรุปรายจังหวัด · ไฟล์ปื้นน้ำรายกรอบโหลดเมื่อซูมเข้าเท่านั้น
  var FL_C = { flood: '#E5484D', seasonal: '#4FA3E8' };
  var FLOOD_BASE = 'https://raw.githubusercontent.com/Choonahakarn/chatgeo/flood-data/';
  var FL_DETAIL_Z = 8;   // ซูมตั้งแต่ระดับนี้ โหลดปื้นน้ำรายกรอบ (ซูมออกเห็นเป็นสีรายจังหวัด)
  var FL_MAX_TILES = 8;  // โหลดพร้อมกันไม่เกินกี่กรอบ
  var FL_PROV_MIN = 5;   // ซูมออก: ทาสีจังหวัดที่น่าจะท่วมตั้งแต่กี่ ตร.กม.
  var FLOOD = { index: null, tiles: {}, loading: {}, provFC: null, provByName: {} };
  var NB_URL = 'https://github.com/Choonahakarn/chatgeo/blob/main/notebooks/flood_s1.ipynb';
  var PID_BY_NAME = {};
  Object.keys(PROV_FEAT).forEach(function (id) { PID_BY_NAME[PROV_FEAT[id].properties.name] = id; });
  function floodReady() { return !!(FLOOD.index && FLOOD.index.tiles && FLOOD.index.tiles.length); }
  function floodAttr() {
    var y = FLOOD.index && FLOOD.index.date_max ? String(FLOOD.index.date_max).slice(0, 4) : String(new Date().getFullYear());
    return 'น้ำจากดาวเทียม (ทดลอง): ChatGeo · Contains modified Copernicus Sentinel data ' + y;
  }
  function floodTile(id) { return find((FLOOD.index && FLOOD.index.tiles) || [], function (t) { return t.id === id; }); }
  function fmtKm2(v) {
    v = +v || 0;
    return v >= 10 ? Math.round(v).toLocaleString('th-TH') : v >= 0.1 ? v.toFixed(1) : 'ไม่ถึง 0.1';
  }
  // ['2026-10-02', '2026-10-01'] → '1–2 ต.ค.'
  function shortDates(dates) {
    var ds = (dates || []).filter(Boolean).slice().sort();
    var a = parseYMD(ds[0]), b = parseYMD(ds[ds.length - 1]);
    if (!a || !b) return '';
    var ma = TH_MON_S[a.getUTCMonth()], mb = TH_MON_S[b.getUTCMonth()];
    if (ds[0] === ds[ds.length - 1]) return b.getUTCDate() + ' ' + mb;
    return ma === mb ? a.getUTCDate() + '–' + b.getUTCDate() + ' ' + mb : a.getUTCDate() + ' ' + ma + ' – ' + b.getUTCDate() + ' ' + mb;
  }
  // อายุของภาพ นับเป็นวันตามเวลาไทย
  var FL_OLD_DAYS = 4;
  function daysAgo(ymd) {
    var d = parseYMD(ymd);
    if (!d) return null;
    var now = new Date(Date.now() + 7 * 3600e3);
    return Math.max(0, Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - d.getTime()) / 86400e3));
  }
  function ageText(ymd) {
    var n = daysAgo(ymd);
    return n == null ? '' : n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : n + ' วันก่อน';
  }
  // '1–2 ต.ค. (6 วันก่อน)'
  function dateAge(dates) {
    var ds = (dates || []).filter(Boolean).sort();
    return ds.length ? shortDates(ds) + ' (' + ageText(ds[ds.length - 1]) + ')' : '';
  }
  function floodOldNote(ymd) {
    var n = daysAgo(ymd);
    return n != null && n >= FL_OLD_DAYS ? 'ภาพดาวเทียมช้ากว่าความจริง ' + n + ' วัน สถานการณ์ตอนนี้อาจต่างไป ดูระดับน้ำ ThaiWater ประกอบ' : '';
  }
  // น้ำเพิ่มหรือลด เทียบกับภาพก่อนหน้าของจังหวัดเดียวกัน (ต่างกันไม่ถึง 2 ตร.กม. หรือ 10% ถือว่าใกล้เคียง)
  function floodDelta(cur, prev, from) {
    if (prev == null || !from) return null;
    var d = (+cur || 0) - (+prev || 0), base = Math.max(+cur || 0, +prev || 0);
    return { d: d, from: from, flat: Math.abs(d) < Math.max(2, base * 0.1) };
  }
  function provDelta(r) { return r && r.prev ? floodDelta(r.flood_high, r.prev.flood_high, r.prev.date) : null; }
  function deltaText(dl) {
    if (!dl) return '';
    return dl.flat ? 'ใกล้เคียงภาพ ' + shortDates([dl.from]) :
      (dl.d > 0 ? 'น้ำเพิ่ม ' : 'น้ำลด ') + fmtKm2(Math.abs(dl.d)) + ' ตร.กม. จากภาพ ' + shortDates([dl.from]);
  }
  function deltaBadge(dl) {
    if (!dl || dl.flat) return '';
    return ' <span class="fl-d ' + (dl.d > 0 ? 'up' : 'down') + '" title="' + esc(deltaText(dl)) + '">' + (dl.d > 0 ? '▲' : '▼') + fmtKm2(Math.abs(dl.d)) + '</span>';
  }
  // ป้ายมุมซ้ายล่างของแผนที่: ภาพดาวเทียมเก่าแค่ไหน
  function updateFloodChip(v) {
    if (!v || v.kind !== 'chat') return;
    if (!v.flAge) {
      v.flAge = document.createElement('div');
      v.flAge.className = 'fl-age';
      mapStack(v).appendChild(v.flAge);
    }
    var show = !!(state.data.flood && floodReady());
    v.flAge.hidden = !show;
    if (!show) return;
    var I = FLOOD.index, n = daysAgo(I.date_max);
    v.flAge.classList.toggle('old', n != null && n >= FL_OLD_DAYS);
    // อายุภาพมาก่อนวันที่ จอแคบตัดท้ายแล้วยังเห็นว่าเก่าแค่ไหน
    var age = ageText(I.date_max);
    v.flAge.textContent = 'น้ำจากดาวเทียม · ภาพ' + (age ? (n > 1 ? 'เมื่อ ' : '') + age : '') + ' (' + shortDates([I.date_min, I.date_max].filter(Boolean)) + ')';
    v.flAge.title = floodOldNote(I.date_max) || 'ภาพเรดาร์ Sentinel-1 ล่าสุดที่ประมวลผลแล้ว';
    v.stackLift();
  }
  // มุมซ้ายล่างของแผนที่: ป้ายอายุภาพดาวเทียม + แถบเวลาเรดาร์ ซ้อนกันเป็นกลุ่มเดียว
  function mapStack(v) {
    if (v.stack) return v.stack;
    var st = v.stack = document.createElement('div');
    st.className = 'map-stack';
    v.el.appendChild(st);
    // ยกกลุ่มให้อยู่เหนือแถบแหล่งที่มาของแผนที่ (แถบนี้สูงไม่เท่ากันตามขนาดจอ และย่อ/ขยายได้)
    var at = v.el.querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib');
    var lift = function () {
      var r = at && at.getBoundingClientRect(), box = v.el.getBoundingClientRect();
      // ถ้าแถบกว้างมาถึงฝั่งซ้าย ให้ยกขึ้นเหนือแถบ ไม่งั้นวางชิดล่างตามปกติ
      st.style.bottom = (r && r.height && r.left - box.left < st.offsetWidth + 24 ? Math.round(box.bottom - r.top) + 6 : 10) + 'px';
    };
    v.stackLift = lift;
    if (at && window.ResizeObserver) new ResizeObserver(lift).observe(at);
    window.addEventListener('resize', lift);
    return st;
  }
  function floodCoverage() {
    var I = FLOOD.index || {};
    return 'ตรวจแล้ว ' + ((I.tiles || []).length) + ' จาก ' + (I.tiles_total || (I.tiles || []).length) + ' กรอบทั่วประเทศ';
  }
  // สีรายจังหวัด (ตอนซูมออก) จากสรุปใน index.json
  function buildProvFC() {
    FLOOD.provByName = {};
    ((FLOOD.index && FLOOD.index.provinces) || []).forEach(function (r) { FLOOD.provByName[r.name] = r; });
    if (!TH || !TH.provinces) return emptyFC();
    return { type: 'FeatureCollection', features: TH.provinces.features.map(function (f) {
      var r = FLOOD.provByName[f.properties.name] || {};
      return { type: 'Feature', geometry: f.geometry,
        properties: { id: f.properties.id, name: f.properties.name, fh: +r.flood_high || 0, fl: +r.flood_low || 0, s: +r.seasonal || 0 } };
    }) };
  }
  function loadFloodIndex() {
    if (IN_ARTIFACT) { FLOOD.index = { tiles: [], provinces: [] }; return; }
    fetch(FLOOD_BASE + 'index.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      FLOOD.index = j && j.v === 4 && Array.isArray(j.tiles) ? j : { tiles: [], provinces: [] };
      FLOOD.index.tiles = FLOOD.index.tiles.filter(function (t) { return t && t.id && t.file && Array.isArray(t.bbox) && t.bbox.length === 4; });
    }).catch(function () { FLOOD.index = { tiles: [], provinces: [] }; }).then(function () {
      FLOOD.provFC = buildProvFC();
      eachView(refreshLive);
      if (CVM.ready) cvmFlood();
      if (state.page === 'cctv' && CV.mode === 'map') cvmTicker();
      renderSbar();
      renderDataChips();
      renderLiveCards();
      renderSuggest();
      if (state.messages.some(function (m) { return m.key === 'near' || m.key === 'place' || m.key === 'q'; })) renderMsgs();
    });
  }
  // กรอบที่ควรโหลดตอนนี้: ทับจอ เรียงจากใกล้กลางจอ ไม่เกิน FL_MAX_TILES
  function floodWanted(v) {
    if (!floodReady() || !state.data.flood || v.map.getZoom() < FL_DETAIL_Z - 0.5) return [];
    var b = v.map.getBounds(), c = v.map.getCenter();
    return FLOOD.index.tiles.filter(function (t) {
      return t.bbox[0] < b.getEast() && t.bbox[2] > b.getWest() && t.bbox[1] < b.getNorth() && t.bbox[3] > b.getSouth();
    }).sort(function (p, q) {
      return Math.hypot((p.bbox[0] + p.bbox[2]) / 2 - c.lng, (p.bbox[1] + p.bbox[3]) / 2 - c.lat) -
        Math.hypot((q.bbox[0] + q.bbox[2]) / 2 - c.lng, (q.bbox[1] + q.bbox[3]) / 2 - c.lat);
    }).slice(0, FL_MAX_TILES);
  }
  function updateFloodTiles(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-flood')) return;
    var want = floodWanted(v);
    v.floodWant = want.map(function (t) { return t.id; });
    want.forEach(function (t) { if (!FLOOD.tiles[t.id] && !FLOOD.loading[t.id]) loadFloodTile(t); });
    setFloodData(v);
  }
  function loadFloodTile(t) {
    FLOOD.loading[t.id] = true;
    fetch(FLOOD_BASE + t.file + '?v=' + encodeURIComponent(t.added || t.date)).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }).then(function (j) {
        delete FLOOD.loading[t.id];
        FLOOD.tiles[t.id] = ((j && j.features) || []).map(function (f) { f.properties = f.properties || {}; f.properties.tile = t.id; return f; });
        // เก็บในหน่วยความจำไม่เกิน 16 กรอบ ทิ้งกรอบที่ไม่ได้ใช้ก่อน
        var keep = (views.chat && views.chat.floodWant) || [];
        var ids = Object.keys(FLOOD.tiles);
        for (var i = 0; ids.length > 16 && i < ids.length; i++) {
          if (keep.indexOf(ids[i]) < 0) { delete FLOOD.tiles[ids[i]]; ids = Object.keys(FLOOD.tiles); i = -1; }
        }
        eachView(setFloodData);
      });
  }
  function setFloodData(v) {
    if (!v || v.kind !== 'chat' || !v.map.getSource('cg-flood')) return;
    var ids = (v.floodWant || []).filter(function (id) { return FLOOD.tiles[id]; });
    var key = ids.join(',');
    if (key === v.floodKey) return;
    v.floodKey = key;
    v.map.getSource('cg-flood').setData({ type: 'FeatureCollection', features: [].concat.apply([], ids.map(function (id) { return FLOOD.tiles[id]; })) });
  }
  function showFloodProvince(pid) {
    if (!byId[pid]) return;
    state.data.flood = true;
    saveData();
    if (state.page !== 'chat') setPage('chat');
    eachView(refreshLive);
    renderDataChips();
    goTo(pid);
    // จังหวัดใหญ่ซูมไม่ถึงระดับที่เห็นปื้นน้ำ: ซูมต่อไปที่กรอบที่น้ำมากที่สุดในจังหวัด
    var v = views.chat, r = FLOOD.provByName[PROV_FEAT[pid] ? PROV_FEAT[pid].properties.name : ''];
    if (!v || !r) return;
    var best = (r.tiles || []).map(floodTile).filter(Boolean).sort(function (a, b) { return (b.totals.flood_high || 0) - (a.totals.flood_high || 0); })[0];
    var p = byId[pid];
    setTimeout(function () {
      if (!best || v.map.getZoom() >= FL_DETAIL_Z) return;
      var cx = Math.min(Math.max((best.bbox[0] + best.bbox[2]) / 2, p.bx - p.hw), p.bx + p.hw);
      var cy = Math.min(Math.max((best.bbox[1] + best.bbox[3]) / 2, p.by - p.hh), p.by + p.hh);
      v.map.flyTo({ center: [cx, cy], zoom: FL_DETAIL_Z + 0.4, duration: reduceMotion ? 0 : 900, essential: true });
    }, reduceMotion ? 50 : 1500);
  }
  function openFloodPopup(v, p, ll) {
    var t = floodTile(p.tile) || {};
    var low = p.conf === 'low', seasonal = p.kind === 'seasonal';
    var title = seasonal ? 'น้ำที่มีเกือบทุกปีช่วงนี้' : low ? 'น้ำผิดปกติ (ยังไม่แน่ใจ)' : 'น่าจะเป็นน้ำท่วม';
    var yrs = +t.baseline_years || 1;
    var why = seasonal ? 'ช่วงเดียวกันของปีก่อนๆ ก็มีน้ำตรงนี้ เช่น นาข้าวหรือทุ่งรับน้ำ อาจท่วมจริงแต่เป็นประจำ'
      : low ? 'ปื้นเล็กที่อยู่โดดๆ อาจเป็นนาที่เพิ่งปล่อยน้ำเข้าหรือบ่อมากกว่าน้ำท่วม'
      : yrs > 1 ? 'ช่วงเดียวกันของ ' + yrs + ' ปีก่อน ส่วนใหญ่ไม่มีน้ำตรงนี้' : 'ช่วงเดียวกันของปีที่แล้วไม่มีน้ำตรงนี้';
    var when = p.date ? shortDates([p.date]) : shortDates(t.dates);
    var box = document.createElement('div');
    box.innerHTML = '<div class="pop-meta">ดาวเทียม Sentinel-1 · ทดลอง' + (t.name ? ' · ' + esc(t.name) : '') + '</div>' +
      '<div class="pop-title">' + title + '</div>' +
      '<div class="pop-stat"><i class="sq' + (low ? ' faint' : '') + '" style="background:' + (seasonal ? FL_C.seasonal : FL_C.flood) + '"></i>' +
      '<b>ราว ' + fmtKm2(p.area_km2) + ' ตร.กม.</b></div>' +
      '<div class="pop-sub">ภาพวันที่ ' + esc(when) + ' (' + esc(ageText(p.date || t.date)) + ')</div>' +
      '<div class="pop-sub">' + why + '</div>' +
      (floodOldNote(p.date || t.date) ? '<div class="pop-sub pop-warn">' + esc(floodOldNote(p.date || t.date)) + '</div>' : '') +
      '<div class="pop-sub">ต้นแบบทดลอง ไม่ใช่ประกาศเตือนภัย ควรดูคู่กับ GISTDA และ ThaiWater · <a href="' + NB_URL + '" target="_blank" rel="noopener">วิธีทำ</a></div>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 4, maxWidth: '290px', focusAfterOpen: false })
      .setLngLat(ll).setDOMContent(box).addTo(v.map);
  }
  function openFloodProvPopup(v, p, ll) {
    var r = FLOOD.provByName[p.name] || {};
    var box = document.createElement('div');
    box.innerHTML = '<div class="pop-meta">น้ำจากดาวเทียม Sentinel-1 · ทดลอง</div>' +
      '<div class="pop-title">จ.' + esc(p.name) + '</div>' +
      '<div class="pop-stat"><i class="sq" style="background:' + FL_C.flood + '"></i><b>น่าจะท่วมราว ' + fmtKm2(r.flood_high) + ' ตร.กม.</b></div>' +
      (r.flood_low >= 0.1 ? '<div class="pop-sub">ไม่แน่ใจ (ปื้นเล็ก) ' + fmtKm2(r.flood_low) + ' ตร.กม. · มีน้ำเกือบทุกปี ' + fmtKm2(r.seasonal) + ' ตร.กม.</div>' : '') +
      '<div class="pop-sub">ภาพวันที่ ' + esc(dateAge([r.date_min, r.date_max])) + '</div>' +
      '<div class="pop-sub">' + (r.prev ? deltaBadge(provDelta(r)) + ' ' + esc(deltaText(provDelta(r))) : 'ยังไม่มีภาพก่อนหน้าให้เทียบว่าน้ำเพิ่มหรือลด') + '</div>' +
      (floodOldNote(r.date_max) ? '<div class="pop-sub pop-warn">' + esc(floodOldNote(r.date_max)) + '</div>' : '') +
      '<button type="button" class="btn-ghost fl-go" data-flood-prov="' + esc(p.id) + '">ซูมดูปื้นน้ำ</button>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 4, maxWidth: '260px', focusAfterOpen: false })
      .setLngLat(ll).setDOMContent(box).addTo(v.map);
  }
  function topFloodProvinces(n, min) {
    return ((FLOOD.index && FLOOD.index.provinces) || []).filter(function (r) { return r.flood_high >= (min || 0.5) && PID_BY_NAME[r.name]; }).slice(0, n);
  }
  function floodLegendHtml() {
    var I = FLOOD.index, top = topFloodProvinces(3);
    return '<div class="fl-legend" aria-label="สีน้ำจากดาวเทียม">' +
      '<span><i class="sq" style="background:' + FL_C.flood + '"></i>น่าจะท่วม</span>' +
      '<span><i class="sq faint" style="background:' + FL_C.flood + '"></i>ไม่แน่ใจ (ปื้นเล็ก)</span>' +
      '<span><i class="sq" style="background:' + FL_C.seasonal + '"></i>มีน้ำเกือบทุกปี</span></div>' +
      '<div class="rain-legend" aria-label="สีรายจังหวัด"><span>ซูมออก: จังหวัดที่น่าจะท่วม</span><span class="sp"></span><span>' + FL_PROV_MIN + '</span>' +
      '<i style="background:linear-gradient(90deg,rgba(229,72,77,.16),rgba(229,72,77,.55))"></i><span>150+ ตร.กม.</span></div>' +
      (top.length ? '<div class="fl-areas">' + top.map(function (r) {
        return '<button type="button" class="fl-go" data-flood-prov="' + esc(PID_BY_NAME[r.name]) + '">จ.' + esc(r.name) + ' ' + fmtKm2(r.flood_high) + ' ตร.กม.' + deltaBadge(provDelta(r)) + '</button>';
      }).join('') + '</div>' : '') +
      '<p class="fp-fine">' + floodCoverage() + ' · ภาพ ' + esc(dateAge([I.date_min, I.date_max])) +
      ' · ซูมถึงระดับจังหวัดเพื่อดูปื้นน้ำ · ระบบเช็กภาพใหม่วันละ 2 รอบ · ต้นแบบทดลอง ไม่ใช่ประกาศเตือนภัยทางการ</p>';
  }
  // จังหวัดที่เกี่ยวกับคำถาม: จังหวัดเดียว ทั้งภาค หรือจังหวัดที่ผู้ใช้อยู่
  function floodTarget(opt) {
    var p = opt.place, near = opt.near, provs = [], label = '';
    if (!TH || !TH.provinces) return null;
    if (near) {
      var pid = provinceAt(near.lon, near.lat);
      if (!pid || !PROV_FEAT[pid]) return null;
      provs = [PROV_FEAT[pid].properties]; label = PROV_FEAT[pid].properties.name;
    } else if (p && PROV_FEAT[p.id]) {
      provs = [PROV_FEAT[p.id].properties]; label = p.name;
    } else if (p && ZONE_FEAT[p.id]) {
      provs = TH.provinces.features.map(function (f) { return f.properties; }).filter(function (q) { return q.zone === p.id; });
      label = p.name;
    } else return null;
    return { provs: provs, label: label };
  }
  function floodHtml(opt) {
    var tg = floodReady() ? floodTarget(opt) : null;
    if (!tg) return '';
    var I = FLOOD.index, s = { h: 0, l: 0, s: 0, ph: 0 }, dates = [], best = null, from = '', hasPrev = false;
    tg.provs.forEach(function (q) {
      var r = FLOOD.provByName[q.name];
      if (!r) return;
      s.h += r.flood_high; s.l += r.flood_low; s.s += r.seasonal;
      // จังหวัดที่ยังไม่มีภาพก่อนหน้า ถือว่าเท่าเดิม
      s.ph += r.prev ? r.prev.flood_high : r.flood_high;
      if (r.prev) { hasPrev = true; if (r.prev.date > from) from = r.prev.date; }
      dates.push(r.date_min, r.date_max);
      if (!best || r.flood_high > best.flood_high) best = r;
    });
    var covered = dates.length || tg.provs.some(function (q) {
      return I.tiles.some(function (t) { return q.lon >= t.bbox[0] && q.lon < t.bbox[2] && q.lat >= t.bbox[1] && q.lat < t.bbox[3]; });
    });
    var head = '<div class="m-extra"><div class="m-extra-head">น้ำจากดาวเทียม Sentinel-1 (ทดลอง) · ' + esc(tg.label) + (dates.length ? ' · ภาพ ' + esc(dateAge(dates)) : '') + '</div>';
    if (!covered) return head + '<div class="m-row m-none"><span></span><div><span>ยังไม่ได้ตรวจพื้นที่นี้ (' + floodCoverage() + ')</span></div></div></div>';
    var rows = '';
    if (s.h >= 0.1) rows += '<div class="m-row"><i class="sq" style="background:' + FL_C.flood + '"></i><div><b>น่าจะท่วม</b> <span>ราว ' + fmtKm2(s.h) + ' ตร.กม.</span></div></div>';
    if (s.l >= 0.1) rows += '<div class="m-row"><i class="sq faint" style="background:' + FL_C.flood + '"></i><div><b>ไม่แน่ใจ</b> <span>ปื้นเล็กราว ' + fmtKm2(s.l) + ' ตร.กม. อาจเป็นนาหรือบ่อ</span></div></div>';
    if (s.s >= 0.1) rows += '<div class="m-row"><i class="sq" style="background:' + FL_C.seasonal + '"></i><div><b>มีน้ำเกือบทุกปี</b> <span>ราว ' + fmtKm2(s.s) + ' ตร.กม. เช่น นาหรือทุ่งรับน้ำ</span></div></div>';
    if (!rows) rows = '<div class="m-row m-none"><span></span><div><span>ภาพล่าสุดไม่พบน้ำผิดปกติใน' + esc(tg.label) + '</span></div></div>';
    var dl = hasPrev ? floodDelta(s.h, s.ph, from) : null;
    if (dl) rows += '<div class="m-row"><span></span><div><b>เทียบภาพก่อน</b> <span>' + deltaBadge(dl) + ' ' + esc(deltaText(dl)) + '</span></div></div>';
    var old = floodOldNote(dates.sort()[dates.length - 1]);
    if (old) rows += '<div class="m-row m-none"><span></span><div><span>' + esc(old) + '</span></div></div>';
    var pid = best && PID_BY_NAME[best.name];
    return head + rows + (pid ? '<div class="m-row m-act"><span></span><div><button type="button" class="btn-ghost fl-go" data-flood-prov="' + esc(pid) + '">ดูบนแผนที่</button></div></div>' : '') + '</div>';
  }
  function floodSummaryHtml() {
    if (!floodReady()) return '';
    var I = FLOOD.index, top = topFloodProvinces(5);
    var ups = ((I.provinces) || []).map(function (r) { return { r: r, dl: provDelta(r) }; })
      .filter(function (x) { return x.dl && !x.dl.flat && x.dl.d > 0 && PID_BY_NAME[x.r.name]; })
      .sort(function (a, b) { return b.dl.d - a.dl.d; }).slice(0, 3);
    var old = floodOldNote(I.date_max);
    return '<div class="m-extra"><div class="m-extra-head">น้ำจากดาวเทียม Sentinel-1 (ทดลอง) · ' + floodCoverage() + ' · ภาพ ' + esc(dateAge([I.date_min, I.date_max])) + '</div>' +
      (top.length ? top.map(function (r) {
        return '<div class="m-row"><i class="sq" style="background:' + FL_C.flood + '"></i><div><b>จ.' + esc(r.name) + '</b> <span>น่าจะท่วมราว ' + fmtKm2(r.flood_high) +
          ' ตร.กม.' + deltaBadge(provDelta(r)) + ' · ภาพ ' + esc(shortDates([r.date_min, r.date_max])) + '</span> <button type="button" class="btn-ghost fl-go" data-flood-prov="' + esc(PID_BY_NAME[r.name]) + '">ดู</button></div></div>';
      }).join('') : '<div class="m-row m-none"><span></span><div><span>ภาพล่าสุดยังไม่พบน้ำท่วมผิดปกติที่ชัดเจน</span></div></div>') +
      (ups.length ? '<div class="m-row"><span></span><div><b>น้ำเพิ่มมากสุด</b> <span>' + ups.map(function (x) {
        return 'จ.' + esc(x.r.name) + deltaBadge(x.dl);
      }).join(' · ') + ' (เทียบภาพก่อนหน้า)</span></div></div>' : '') +
      (old ? '<div class="m-row m-none"><span></span><div><span>' + esc(old) + '</span></div></div>' : '') + '</div>';
  }
  // ปุ่ม "ดูบนแผนที่" ของน้ำจากดาวเทียม (แชท การ์ดหน้าสรุป และ popup)
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-flood-prov]');
    if (g) { e.preventDefault(); if (views.chat && views.chat.popup) { views.chat.popup.remove(); views.chat.popup = null; } showFloodProvince(g.getAttribute('data-flood-prov')); }
  });

  /* ---------- กล้อง CCTV + AI ดูภาพ (ทดลอง) ---------- */
  // รายชื่อกล้องอยู่ใน data/cctv.json (ขึ้นเว็บพร้อมหน้าเว็บ) · ผล AI รายชั่วโมงอยู่ใน branch cctv-data
  // (GitHub Actions .github/workflows/cctv.yml) ภาพจริงโหลดจากเว็บของหน่วยงานเจ้าของกล้องโดยตรง
  // AI ดูแค่ฉาก (น้ำ ถนน อากาศ จำนวนรถ) ไม่จดจำใบหน้า ไม่อ่านทะเบียน ไม่ติดตามคน
  var CCTV_BASE = 'https://raw.githubusercontent.com/Choonahakarn/chatgeo/cctv-data/';
  var CCTV = { reg: null, idx: null, hist: null, histAt: 0, histP: null, cams: {}, site: {}, siteOf: {}, loaded: false };
  var CC_L = {
    flood: { t: 'น่าจะมีน้ำท่วม', c: '#E5484D', r: 0 },
    high: { t: 'น้ำค่อนข้างสูง', c: '#F2803A', r: 1 },
    watch: { t: 'น้ำมากกว่าปกติเล็กน้อย', c: '#D99A1E', r: 2 },
    spill: { t: 'กำลังระบายน้ำ', c: '#3B82F6', r: 3 },
    normal: { t: 'ปกติ', c: '#2FA36B', r: 4 },
    night: { t: 'มืด อ่านยาก', c: '#7A8BA6', r: 5 },
    pending: { t: 'รอ AI', c: '#8A93A3', r: 6 },
    stale: { t: 'ภาพค้าง', c: '#8A93A3', r: 7 },
    offline: { t: 'ไม่มีภาพ', c: '#8A93A3', r: 8 },
    none: { t: 'ยังไม่มีผล AI', c: '#8A93A3', r: 9 }
  };
  var CC_WET = ['flood', 'high', 'watch'];
  var CC_SITE_Z = 9.5; // ซูมน้อยกว่านี้ รวมจุดในพื้นที่เดียวกัน (เช่น หาดใหญ่) เป็นหมุดเดียว
  var CC_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h13l5-3v12l-5-3H3z"/><circle cx="9" cy="10" r="2"/></svg>';
  function ccReady() { return !!(CCTV.reg && CCTV.reg.sites && CCTV.reg.sites.length); }
  function ccRec(id) { return (CCTV.idx && CCTV.idx.cams && CCTV.idx.cams[id]) || null; }
  function ccLab(id) { var r = ccRec(id); return r && CC_L[r.label] ? r.label : 'none'; }
  function ccSrc(c) { var s = CCTV.siteOf[c.id]; return (CCTV.reg.sources || {})[s && s.src] || {}; }
  function ccParse(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])) : null;
  }
  // '13:35 น.' ถ้าเป็นวันนี้ ไม่งั้น '7 ต.ค. 13:35 น.'
  function ccTime(s) {
    var d = ccParse(s);
    if (!d) return '';
    var b = new Date(d.getTime() + 7 * 3600e3), n = new Date(Date.now() + 7 * 3600e3);
    var hm = ('0' + b.getUTCHours()).slice(-2) + ':' + ('0' + b.getUTCMinutes()).slice(-2) + ' น.';
    return b.toISOString().slice(0, 10) === n.toISOString().slice(0, 10) ? hm : b.getUTCDate() + ' ' + TH_MON_S[b.getUTCMonth()] + ' ' + hm;
  }
  function ccHoursAgo(s) { var d = ccParse(s); return d ? (Date.now() - d.getTime()) / 3600e3 : null; }
  function ccOldNote() {
    var h = CCTV.idx && ccHoursAgo(CCTV.idx.updated);
    return h != null && h >= 3 ? 'ผล AI ไม่ได้อัปเดตมาราว ' + Math.round(h) + ' ชม. ภาพในป๊อปอัปยังเป็นภาพล่าสุดจากต้นทาง' : '';
  }
  function ccImg(c, full) {
    var r = ccRec(c.id);
    if (!full && ccSrc(c).thumbs && r && r.thumb) return CCTV_BASE + 'thumbs/' + c.id + '.jpg?v=' + r.thumb;
    return c.img + (c.img.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 600000);
  }
  function ccChip(l) { var L = CC_L[l] || CC_L.none; return '<span class="cc-lab" style="--c:' + L.c + '">' + esc(L.t) + '</span>'; }
  function ccWorst(cams) {
    return cams.reduce(function (w, c) { var l = ccLab(c.id); return CC_L[l].r < CC_L[w].r ? l : w; }, 'none');
  }
  function ccSorted(cams) {
    return cams.slice().sort(function (a, b) { return CC_L[ccLab(a.id)].r - CC_L[ccLab(b.id)].r; });
  }
  function ccAllCams() { return Object.keys(CCTV.cams).map(function (k) { return CCTV.cams[k]; }); }
  function loadCctv() {
    if (IN_ARTIFACT) return;
    var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function () { return null; }); };
    Promise.all([CCTV.reg ? Promise.resolve(CCTV.reg) : get('data/cctv.json'), get(CCTV_BASE + 'index.json')]).then(function (a) {
      var reg = a[0];
      if (reg && Array.isArray(reg.sites)) {
        CCTV.reg = reg;
        reg.sites.forEach(function (s) {
          CCTV.site[s.id] = s;
          s.cams.forEach(function (c) { CCTV.cams[c.id] = c; CCTV.siteOf[c.id] = s; });
        });
      }
      CCTV.idx = a[1] && a[1].v === 1 && a[1].cams ? a[1] : CCTV.idx;
      CCTV.loaded = true;
      eachView(buildCctvMarkers);
      renderDataChips();
      renderLiveCards();
      renderSuggest();
      if (!$('ccModal').hidden) renderCcModal();
      if (state.page === 'cctv') renderCctvPage();
      renderSbar();
      if (state.messages.some(function (m) { return m.key === 'near' || m.key === 'place' || m.key === 'q'; })) renderMsgs();
    });
  }
  function loadCctvHist() {
    if (CCTV.histP && Date.now() - CCTV.histAt < 600e3) return CCTV.histP;
    CCTV.histAt = Date.now();
    CCTV.histP = fetch(CCTV_BASE + 'history.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { CCTV.hist = j && j.cams ? j : { cams: {} }; return CCTV.hist; })
      .catch(function () { CCTV.hist = CCTV.hist || { cams: {} }; return CCTV.hist; });
    return CCTV.histP;
  }

  // หมุดบนแผนที่: ซูมออกรวมเป็นหมุดรายพื้นที่ ซูมเข้าแยกรายจุด
  function buildCctvMarkers(v) {
    if (!v || v.kind !== 'chat' || !ccReady()) return;
    (v.ccMarkers || []).forEach(function (m) { m.mk.remove(); });
    var groups = {};
    CCTV.reg.sites.forEach(function (s) { (groups[s.area] = groups[s.area] || []).push(s); });
    var list = [];
    Object.keys(groups).forEach(function (area) {
      var ss = groups[area];
      var mk = function (sites, level) {
        var cams = [].concat.apply([], sites.map(function (s) { return s.cams; }));
        var lon = sites.reduce(function (t, s) { return t + s.lon; }, 0) / sites.length;
        var lat = sites.reduce(function (t, s) { return t + s.lat; }, 0) / sites.length;
        var w = ccWorst(cams), L = CC_L[w];
        var name = level === 'area' ? area : sites[0].name;
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'cc-pin' + (CC_WET.indexOf(w) >= 0 ? ' wet' : '');
        el.style.setProperty('--c', L.c);
        el.innerHTML = CC_ICO + '<b>' + cams.length + '</b>';
        el.title = 'กล้อง ' + name + ' ' + cams.length + ' ตัว · ' + L.t;
        el.setAttribute('aria-label', 'กล้อง CCTV ' + name + ' ' + cams.length + ' ตัว สถานะ ' + L.t);
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (SITE.pick) { openSite(lon, lat); return; }
          if (level === 'area' && sites.length > 1) {
            var b = sites.reduce(function (bb, s) { return [Math.min(bb[0], s.lon), Math.min(bb[1], s.lat), Math.max(bb[2], s.lon), Math.max(bb[3], s.lat)]; }, [999, 999, -999, -999]);
            v.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 90, maxZoom: 11.5, duration: reduceMotion ? 0 : 900 });
          } else openCctvSitePopup(v, sites[0]);
        });
        list.push({ mk: new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(v.map), level: level, multi: sites.length > 1 });
      };
      if (ss.length > 1) mk(ss, 'area');
      ss.forEach(function (s) { mk([s], ss.length > 1 ? 'site' : 'one'); });
    });
    v.ccMarkers = list;
    updateCctvMarkers(v);
  }
  function updateCctvMarkers(v) {
    if (!v || !v.ccMarkers) return;
    var z = v.map.getZoom(), on = !!state.data.cctv;
    v.ccMarkers.forEach(function (m) {
      var show = on && z >= 4.5 && (m.level === 'one' || (m.level === 'area' ? z < CC_SITE_Z : z >= CC_SITE_Z));
      m.mk.getElement().classList.toggle('off', !show);
    });
  }
  function ccTile(c, ctx) {
    var r = ccRec(c.id), l = ccLab(c.id), s = CCTV.siteOf[c.id];
    return '<button type="button" class="cc-tile" data-cc-cam="' + esc(c.id) + '"' + (ctx ? ' data-cc-ctx="' + esc(ctx) + '"' : '') + '>' +
      '<span class="cc-img"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" src="' + esc(ccImg(c)) + '" onerror="this.parentNode.classList.add(\'err\')"></span>' +
      ccChip(l) + '<span class="cc-name">' + esc(c.name) + '</span>' +
      (ctx && ctx.indexOf('site:') !== 0 ? '<span class="cc-sub">' + esc(s.name) + '</span>' : '') +
      '<span class="cc-sub">' + (r && (r.ai || r.seen) ? 'AI ' + esc(ccTime(r.ai || r.seen)) : 'ยังไม่มีผล AI') + '</span></button>';
  }
  function ccCredit(src) {
    return 'ภาพ: <a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.name) + '</a>' +
      (src.license ? ' (<a href="' + esc(src.license_url || src.url) + '" target="_blank" rel="noopener">' + esc(src.license) + '</a>)' : '');
  }
  function openCctvSitePopup(v, s, noPan) {
    // แผนที่เตี้ย (มือถือ) ป๊อปอัปจะล้นจอ เปิดเป็นจอรวมของจุดนี้แทน
    if (v.map.getContainer().clientHeight < 460) { openCcModal('wall', 'site:' + s.id); return; }
    var src = CCTV.reg.sources[s.src] || {};
    // ป๊อปอัปสูง: เลื่อนจุดลงไปด้านล่างของแผนที่ แล้วเปิดป๊อปอัปเหนือจุด
    if (!noPan) v.map.easeTo({ center: [s.lon, s.lat], offset: [0, Math.round(v.map.getContainer().clientHeight * 0.32)], duration: reduceMotion ? 0 : 500 });
    var box = document.createElement('div');
    box.innerHTML = '<div class="pop-meta">กล้อง CCTV + AI (ทดลอง) · จ.' + esc(s.prov) + '</div>' +
      '<div class="pop-title">' + esc(s.name) + '</div>' +
      (s.approx ? '<div class="pop-sub">ตำแหน่งโดยประมาณ ต้นทางไม่มีพิกัด' + (src.map ? ' · <a href="' + esc(src.map) + '" target="_blank" rel="noopener">แผนที่กล้องต้นทาง</a>' : '') + '</div>' : '') +
      (s.note ? '<div class="pop-sub">' + esc(s.note) + '</div>' : '') +
      '<div class="cc-grid">' + ccSorted(s.cams).map(function (c) { return ccTile(c, 'site:' + s.id); }).join('') + '</div>' +
      (ccOldNote() ? '<div class="pop-sub pop-warn">' + esc(ccOldNote()) + '</div>' : '') +
      '<div class="pop-sub">' + ccCredit(src) + ' · AI ตัวเล็กอาจผิด ดูภาพประกอบเสมอ</div>' +
      '<button type="button" class="btn-ghost cc-wall-btn" data-cc-wall="site:' + esc(s.id) + '">เปิดจอรวม</button>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup cc-popup', anchor: 'bottom', offset: 18, maxWidth: '340px', focusAfterOpen: false })
      .setLngLat([s.lon, s.lat]).setDOMContent(box).addTo(v.map);
  }
  function showCctvSite(id) {
    var s = CCTV.site[id], v = views.chat;
    if (!s || !v) return;
    if (!state.data.cctv) { state.data.cctv = true; saveData(); renderDataChips(); eachView(updateCctvMarkers); }
    if (state.page !== 'chat') setPage('chat');
    closeCcModal(true);
    v.map.flyTo({ center: [s.lon, s.lat], offset: [0, Math.round(v.map.getContainer().clientHeight * 0.32)], zoom: Math.max(v.map.getZoom(), s.approx ? 11 : 10), duration: reduceMotion ? 0 : 900, essential: true });
    setTimeout(function () { openCctvSitePopup(v, s, true); }, reduceMotion ? 0 : 950);
  }

  // หน้าต่างกล้อง: โหมดจอรวม (หลายกล้อง) และโหมดดูกล้องเดียว
  var ccView = { mode: 'wall', filter: 'all', cam: null, ctx: null, opener: null };
  function ccFilterCams(f) {
    var all = ccAllCams();
    if (f === 'wet') return all.filter(function (c) { return CC_WET.indexOf(ccLab(c.id)) >= 0; });
    if (f.indexOf('site:') === 0) return (CCTV.site[f.slice(5)] || { cams: [] }).cams.slice();
    if (f.indexOf('src:') === 0) return all.filter(function (c) { return CCTV.siteOf[c.id].src === f.slice(4); });
    if (f.indexOf('prov:') === 0) return all.filter(function (c) { return CCTV.siteOf[c.id].prov === f.slice(5); });
    return all;
  }
  function ccFilterName(f) {
    if (f === 'wet') return 'AI เห็นน้ำ';
    if (f.indexOf('site:') === 0) return (CCTV.site[f.slice(5)] || {}).name || '';
    if (f === 'src:hatyai') return 'หาดใหญ่';
    if (f === 'src:egat') return 'เขื่อน กฟผ.';
    if (f.indexOf('prov:') === 0) return 'จ.' + f.slice(5);
    return 'ทั้งหมด';
  }
  function openCcModal(mode, arg, ctx) {
    if (!ccReady()) { toast('กำลังโหลดรายชื่อกล้อง ลองอีกครั้งในไม่กี่วินาที'); return; }
    if (!$('ccModal').hidden && ccView.mode === mode && mode === 'cam' && ccView.cam === arg) return;
    if ($('ccModal').hidden) ccView.opener = document.activeElement;
    ccView.mode = mode;
    if (mode === 'wall') ccView.filter = arg || 'all';
    else { ccView.cam = arg; ccView.ctx = ctx || ccView.ctx || ccView.filter; loadCctvHist().then(function () { if (!$('ccModal').hidden && ccView.mode === 'cam') renderCcHist(); }); }
    $('ccModal').hidden = false;
    renderCcModal();
    setTimeout(function () { var b = $('ccModal').querySelector('[data-cc-close].pal-x'); if (b) b.focus(); }, 0);
  }
  function closeCcModal(silent) {
    if ($('ccModal').hidden) return;
    $('ccModal').hidden = true;
    ccLiveStop();
    $('ccBody').innerHTML = '';
    if (!silent && ccView.opener && ccView.opener.focus) ccView.opener.focus();
  }
  function renderCcModal() {
    if (ccView.mode === 'cam') return renderCcCam();
    var f = ccView.filter, cams = ccSorted(ccFilterCams(f));
    var tabs = ['all', 'wet', 'src:hatyai', 'src:egat'];
    if (tabs.indexOf(f) < 0) tabs.push(f);
    $('ccTitle').textContent = 'จอรวมกล้อง CCTV + AI (ทดลอง)';
    $('ccBody').innerHTML = '<div class="cc-tabs" role="group" aria-label="เลือกกล้อง">' + tabs.map(function (t) {
      return '<button type="button" class="q-chip" data-cc-filter="' + esc(t) + '" aria-pressed="' + (t === f) + '">' + esc(ccFilterName(t)) + ' <b>' + ccFilterCams(t).length + '</b></button>';
    }).join('') + '</div>' +
      (ccOldNote() ? '<p class="cc-note pop-warn">' + esc(ccOldNote()) + '</p>' : '') +
      (cams.length ? '<div class="cc-wall">' + cams.map(function (c) { return ccTile(c, f); }).join('') + '</div>'
        : '<p class="cc-note">ตอนนี้ AI ยังไม่เห็นน้ำผิดปกติในกล้องไหน' + (CCTV.idx ? ' (ดูเมื่อ ' + esc(ccTime(CCTV.idx.updated)) + ')' : '') + '</p>') +
      '<div class="cc-acts"><button type="button" class="btn-ghost" data-cv-open="' + esc(f) + '">เปิดหน้ากล้องเต็มจอ (รีเฟรชภาพเอง)</button></div>' +
      '<p class="cc-note">' + ccFootNote() + '</p>';
  }
  function ccFootNote() {
    var srcs = CCTV.reg.sources || {};
    return Object.keys(srcs).map(function (k) { return ccCredit(srcs[k]); }).join(' · ') +
      ' · AI ดูทุกชั่วโมง' + (CCTV.idx ? ' (ล่าสุด ' + esc(ccTime(CCTV.idx.updated)) + ')' : '') +
      ' ด้วยโมเดลขนาดเล็กบน GitHub Actions ดูแค่สภาพน้ำ ถนน อากาศ และนับรถ ไม่จดจำใบหน้า ไม่อ่านทะเบียน · ต้นแบบทดลอง ไม่ใช่ประกาศเตือนภัย';
  }
  function renderCcCam() {
    var c = CCTV.cams[ccView.cam];
    if (!c) { ccView.mode = 'wall'; return renderCcModal(); }
    var s = CCTV.siteOf[c.id], src = ccSrc(c), r = ccRec(c.id) || {}, l = ccLab(c.id);
    var list = ccSorted(ccFilterCams(ccView.ctx || 'all'));
    var i = list.map(function (x) { return x.id; }).indexOf(c.id);
    var prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    var times = [];
    if (r.img_t) times.push('ภาพจากต้นทาง ' + ccTime(r.img_t));
    if (r.ai) times.push('AI ดูเมื่อ ' + ccTime(r.ai));
    else if (r.seen) times.push('ตรวจเมื่อ ' + ccTime(r.seen));
    $('ccTitle').textContent = c.name + ' · ' + s.name;
    $('ccBody').innerHTML = '<div class="cc-view">' +
      '<div class="cc-big"><img referrerpolicy="no-referrer" alt="ภาพล่าสุดจากกล้อง ' + esc(c.name) + '" src="' + esc(c.img + (c.img.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / CC_LIVE_MS)) + '" onerror="this.parentNode.classList.add(\'err\')">' +
        '<span class="cc-live" title="ต้นทางเป็นภาพนิ่ง เราขอภาพใหม่ทุก ' + (CC_LIVE_MS / 1000) + ' วินาทีขณะเปิดกล้องนี้ (ต้นทางบางแห่งอัปเดตภาพช้ากว่านี้)"><i></i>ภาพล่าสุด</span><span class="cc-err">โหลดภาพจากต้นทางไม่ได้ตอนนี้</span></div>' +
      '<div class="cc-info">' +
        '<div class="cc-line">' + ccChip(l) + (r.veh != null ? '<span class="cc-veh">รถราว ' + r.veh + ' คัน</span>' : '') + '</div>' +
        (r.th ? '<p class="cc-th">' + esc(r.th) + '</p>' : '<p class="cc-th">ยังไม่มีผลจาก AI สำหรับกล้องนี้ ดูภาพสดจากต้นทางได้ด้านบน</p>') +
        (r.en ? '<p class="cc-en"><span>คำบรรยายจาก AI (อังกฤษ)</span>' + esc(r.en) + '</p>' : '') +
        '<p class="cc-note">' + esc(times.join(' · ')) + (times.length ? ' · ' : '') + 'จ.' + esc(s.prov) + (s.approx ? ' · ตำแหน่งโดยประมาณ' : '') + '</p>' +
        '<div class="cc-hist" id="ccHist"><div class="cc-hist-head">ย้อนหลัง 48 ชม.</div><div class="cc-note">กำลังโหลด…</div></div>' +
        '<div class="cc-acts">' +
          '<a class="btn-ghost" href="' + esc(c.img) + '" target="_blank" rel="noopener">ภาพเต็มจากต้นทาง' + ICO.ext + '</a>' +
          '<button type="button" class="btn-ghost" data-cc-site="' + esc(s.id) + '">ดูบนแผนที่</button>' +
          (state.page === 'cctv' ? '<button type="button" class="btn-ghost" data-cc-close="1">กลับหน้ากล้อง</button>'
            : '<button type="button" class="btn-ghost" data-cc-wall="' + esc(ccView.ctx || 'all') + '">กลับจอรวม</button>') +
        '</div>' +
        '<p class="cc-note">' + ccCredit(src) + ' · AI ตัวเล็กอาจผิด ใช้ประกอบการดูภาพเท่านั้น</p>' +
      '</div>' +
      (prev ? '<button type="button" class="cc-nav prev" data-cc-cam="' + esc(prev.id) + '" aria-label="กล้องก่อนหน้า: ' + esc(prev.name) + '">‹</button>' : '') +
      (next ? '<button type="button" class="cc-nav next" data-cc-cam="' + esc(next.id) + '" aria-label="กล้องถัดไป: ' + esc(next.name) + '">›</button>' : '') +
      '</div>';
    if (CCTV.hist) renderCcHist();
    ccLiveStart(c);
  }
  // ดูกล้องเดียว: ขอภาพใหม่จากต้นทางทุก 20 วินาที ให้ใกล้เคียงภาพสด (ต้นทางเป็นภาพนิ่ง ไม่ใช่วิดีโอ จึงไม่เขียนว่า LIVE)
  var CC_LIVE_MS = 20e3;
  function ccLiveStop() { clearInterval(ccView.liveTick); ccView.liveTick = 0; ccView.liveBusy = false; }
  function ccLiveStart(c) {
    ccLiveStop();
    ccView.liveAt = Date.now(); ccView.liveNext = Date.now() + CC_LIVE_MS; ccView.liveErr = 0;
    var paint = function () {
      var box = document.querySelector('#ccBody .cc-big'), b = box && box.querySelector('.cc-live'), now = Date.now();
      if (!b) return;
      var ago = Math.max(0, Math.round((now - ccView.liveAt) / 1000)), nx = Math.max(0, Math.ceil((ccView.liveNext - now) / 1000));
      b.innerHTML = ccView.liveErr ? '<i class="off"></i>ต้นทางไม่ตอบ จะลองใหม่ใน ' + nx + ' วิ'
        : '<i></i>ภาพล่าสุด · ' + (ago < 5 ? 'เมื่อสักครู่' : ago + ' วิที่แล้ว') + '<span class="ccl-n"> · ภาพใหม่ใน ' + nx + ' วิ</span>';
    };
    paint();
    ccView.liveTick = setInterval(function () {
      var box = document.querySelector('#ccBody .cc-big');
      if ($('ccModal').hidden || ccView.mode !== 'cam' || ccView.cam !== c.id || !box) { ccLiveStop(); return; }
      var now = Date.now();
      if (!document.hidden && now >= ccView.liveNext && !ccView.liveBusy) {
        ccView.liveBusy = true;
        var im = new Image();
        im.referrerPolicy = 'no-referrer';
        im.onload = function () {
          ccView.liveBusy = false;
          if (ccView.cam !== c.id) return;
          var cur = box.querySelector('img');
          if (cur) { im.alt = cur.alt; im.onerror = cur.onerror; im.onload = null; cur.replaceWith(im); box.classList.remove('err'); } // ใช้รูปที่โหลดแล้ว ไม่ต้องดึงซ้ำ
          ccView.liveAt = Date.now(); ccView.liveErr = 0; ccView.liveNext = Date.now() + CC_LIVE_MS; paint();
        };
        im.onerror = function () { ccView.liveBusy = false; ccView.liveErr++; ccView.liveNext = Date.now() + CC_LIVE_MS * Math.min(4, 1 + ccView.liveErr); paint(); };
        im.src = c.img + (c.img.indexOf('?') < 0 ? '?' : '&') + 't=' + now;
      }
      paint();
    }, 1000);
  }
  // แถบสีรายชั่วโมง: แต่ละช่องคือผลหนึ่งรอบ (ป้ายและคะแนน AI)
  function renderCcHist() {
    var el = $('ccHist');
    if (!el || !CCTV.hist) return;
    var pts = (CCTV.hist.cams || {})[ccView.cam] || [];
    if (!pts.length) { el.innerHTML = '<div class="cc-hist-head">ย้อนหลัง 48 ชม.</div><div class="cc-note">ยังไม่มีประวัติของกล้องนี้</div>'; return; }
    var wet = pts.filter(function (p) { return CC_WET.indexOf(p[1]) >= 0; }).length;
    var vs = pts.filter(function (p) { return p[3] != null; }).map(function (p) { return p[3]; });
    el.innerHTML = '<div class="cc-hist-head">ย้อนหลัง ' + pts.length + ' รอบ (' + esc(ccTime(pts[0][0])) + ' ถึง ' + esc(ccTime(pts[pts.length - 1][0])) + ')' +
      (wet ? ' · AI เห็นน้ำ ' + wet + ' รอบ' : ' · ไม่เห็นน้ำผิดปกติ') + (vs.length ? ' · รถ ' + Math.min.apply(null, vs) + '–' + Math.max.apply(null, vs) + ' คัน' : '') + '</div>' +
      '<div class="cc-strip">' + pts.map(function (p) {
        var L = CC_L[p[1]] || CC_L.none;
        var tip = ccTime(p[0]) + ' · ' + L.t + (p[2] != null ? ' · คะแนน ' + p[2] : '') + (p[3] != null ? ' · รถ ' + p[3] + ' คัน' : '');
        return '<i style="background:' + L.c + '" title="' + esc(tip) + '"></i>';
      }).join('') + '</div>' +
      '<div class="cc-strip-ax"><span>' + esc(ccTime(pts[0][0])) + '</span><span>ล่าสุด</span></div>';
  }
  $('ccModal').addEventListener('click', function (e) {
    if (e.target.closest('[data-cc-close]')) { closeCcModal(); return; }
    var f = e.target.closest('[data-cc-filter]');
    if (f) { ccView.filter = f.getAttribute('data-cc-filter'); renderCcModal(); }
  });
  document.addEventListener('keydown', function (e) {
    if ($('ccModal').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCcModal(); }
    else if (ccView.mode === 'cam' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var b = $('ccModal').querySelector('.cc-nav.' + (e.key === 'ArrowRight' ? 'next' : 'prev'));
      if (b) b.click();
    }
  });
  // ปุ่มกล้องจากทุกที่ (แชท ป๊อปอัป จอรวม การ์ดหน้าสรุป)
  document.addEventListener('click', function (e) {
    var o = e.target.closest && e.target.closest('[data-cv-open]');
    if (o) {
      e.preventDefault();
      setFilterOpen(false);
      closeCcModal(true);
      CV.filter = o.getAttribute('data-cv-open') || 'all';
      if (state.page === 'cctv') { renderCctvPage(); writeHash(false); } else setPage('cctv');
      return;
    }
    var t = e.target.closest && e.target.closest('[data-cc-cam],[data-cc-wall],[data-cc-site]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-cc-cam')) openCcModal('cam', t.getAttribute('data-cc-cam'), t.getAttribute('data-cc-ctx'));
    else if (t.hasAttribute('data-cc-wall')) { setFilterOpen(false); openCcModal('wall', t.getAttribute('data-cc-wall')); }
    else showCctvSite(t.getAttribute('data-cc-site'));
  });

  /* ---------- หน้ากล้อง CCTV: จอรวมเต็มหน้า ดูง่ายแบบห้องดูกล้อง ---------- */
  // ภาพดึงจากต้นทางโดยตรง รีเฟรชทุก 2 นาที เฉพาะภาพที่อยู่บนจอ (ภาพที่เลื่อนผ่านไปไม่โหลดซ้ำ)
  // ป้ายสีมาจากผล AI รอบล่าสุดใน cctv-data (ทุกชั่วโมง) เบราว์เซอร์ไม่ได้วิเคราะห์ภาพเอง
  var CV_REFRESH = 120e3;
  var CV_KINDS = [['all', 'ทุกประเภท'], ['road', 'ถนน'], ['water', 'คลอง/แม่น้ำ'], ['dam', 'เขื่อน']];
  var CV_SIZES = [['s', 'เล็ก'], ['m', 'กลาง'], ['l', 'ใหญ่']];
  var CV_SRC_NAME = { hatyai: 'หาดใหญ่ · สงขลา', egat: 'เขื่อน กฟผ.' };
  var CV = { filter: 'all', kind: 'all', q: '', size: 'm', near: null, busy: false, bucket: Math.floor(Date.now() / CV_REFRESH), timer: 0, io: null, vis: [], fs: false };
  try { var cvSz = localStorage.getItem('cg-cv-size'); if (/^[sml]$/.test(cvSz || '')) CV.size = cvSz; } catch (e) { /* ไม่มีที่เก็บ */ }

  // มือถือเลื่อนทั้งหน้า จอใหญ่เลื่อนเฉพาะฝั่งภาพ
  function cvSc() { return window.matchMedia('(max-width: 860px)').matches ? $('pageCctv') : $('cvScroll'); }
  function cvImg(c) { return c.img + (c.img.indexOf('?') < 0 ? '?' : '&') + 't=' + CV.bucket; }
  function cvThumb(c) { var r = ccRec(c.id); return ccSrc(c).thumbs && r && r.thumb ? CCTV_BASE + 'thumbs/' + c.id + '.jpg?v=' + r.thumb : ''; }
  function cvKindOk(c) {
    if (CV.kind === 'all') return true;
    var k = c.kind || 'mixed';
    return k === CV.kind || (k === 'mixed' && CV.kind !== 'dam');
  }
  function cvNorm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function cvQOk(c) {
    if (!CV.q) return true;
    var s = CCTV.siteOf[c.id] || {};
    return cvNorm([c.name, s.name, s.area, s.prov, 'จ.' + s.prov].join('|')).indexOf(cvNorm(CV.q)) >= 0;
  }
  function cvBase() {
    var f = CV.filter;
    return f === 'all' || f === 'near' ? ccAllCams() : ccFilterCams(f);
  }
  function cvCams() { return cvBase().filter(function (c) { return cvKindOk(c) && cvQOk(c); }); }
  function cvValidFilter() {
    var f = CV.filter;
    if (f === 'near' && !CV.near) CV.filter = 'all';
    if (f.indexOf('site:') === 0 && !CCTV.site[f.slice(5)]) CV.filter = 'all';
    if (f.indexOf('src:') === 0 && !(CCTV.reg.sources || {})[f.slice(4)]) CV.filter = 'all';
  }
  function cvFilterLabel(f) {
    if (f === 'near') return 'ใกล้ฉัน';
    if (f.indexOf('src:') === 0) return CV_SRC_NAME[f.slice(4)] || ccFilterName(f);
    return ccFilterName(f);
  }
  function cvDot(cams) { var w = ccWorst(cams); return '<i class="cc-dot" style="background:' + CC_L[w].c + '" title="' + esc(CC_L[w].t) + '"></i>'; }

  // แถบซ้าย: มุมมอง รายการพื้นที่ (ตามแหล่งภาพ) และประเภทกล้อง
  function cvSideHtml() {
    var all = ccAllCams(), wet = ccFilterCams('wet');
    var vs = [['all', 'ทั้งหมด', all.length], ['wet', 'AI เห็นน้ำ', CCTV.idx ? wet.length : '–'], ['near', CV.busy ? 'กำลังหาตำแหน่ง…' : 'ใกล้ฉัน', '']];
    $('cvViews').innerHTML = vs.map(function (o) {
      return '<button type="button" class="q-chip" data-cv-f="' + o[0] + '" aria-pressed="' + (CV.filter === o[0]) + '"' + (o[0] === 'wet' && wet.length ? ' data-hot="1"' : '') + '>' +
        (o[0] === 'near' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>' : '') +
        esc(o[1]) + (o[2] !== '' ? ' <b>' + o[2] + '</b>' : '') + '</button>';
    }).join('');
    var bySrc = {}, order = [];
    CCTV.reg.sites.forEach(function (s) { if (!bySrc[s.src]) { bySrc[s.src] = []; order.push(s.src); } bySrc[s.src].push(s); });
    $('cvTree').innerHTML = order.map(function (k) {
      var ss = bySrc[k], cams = [].concat.apply([], ss.map(function (s) { return s.cams; }));
      return '<div class="cv-grp"><button type="button" class="cv-node head" data-cv-f="src:' + esc(k) + '" aria-pressed="' + (CV.filter === 'src:' + k) + '">' + cvDot(cams) +
        '<span>' + esc(CV_SRC_NAME[k] || (CCTV.reg.sources[k] || {}).name || k) + '</span><b>' + cams.length + '</b></button>' +
        ss.map(function (s) {
          var nm = s.src === 'hatyai' ? s.name : s.name + ' · ' + s.prov;
          return '<button type="button" class="cv-node" data-cv-f="site:' + esc(s.id) + '" aria-pressed="' + (CV.filter === 'site:' + s.id) + '">' + cvDot(s.cams) +
            '<span>' + esc(nm) + '</span><b>' + s.cams.length + '</b></button>';
        }).join('') + '</div>';
    }).join('');
    $('cvSel').innerHTML = '<option value="all">ทุกพื้นที่ (' + all.length + ')</option>' + order.map(function (k) {
      return '<optgroup label="' + esc(CV_SRC_NAME[k] || k) + '"><option value="src:' + esc(k) + '">ทั้งหมดใน' + esc(CV_SRC_NAME[k] || k) + '</option>' +
        bySrc[k].map(function (s) { return '<option value="site:' + esc(s.id) + '">' + esc(s.name) + ' (' + s.cams.length + ')</option>'; }).join('') + '</optgroup>';
    }).join('');
    $('cvSel').value = /^(src|site):/.test(CV.filter) ? CV.filter : 'all';
    $('cvKinds').innerHTML = '<span class="cv-lbl">ประเภท</span>' + CV_KINDS.map(function (o) {
      return '<button type="button" class="q-chip" data-cv-k="' + o[0] + '" aria-pressed="' + (CV.kind === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
    $('cvMode').innerHTML = [['wall', 'จอรวมภาพ'], ['map', 'แผนที่']].map(function (o) {
      return '<button type="button" data-cv-mode="' + o[0] + '" aria-pressed="' + (CV.mode === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
    $('cvSize').innerHTML = CV_SIZES.map(function (o) {
      return '<button type="button" data-cv-size="' + o[0] + '" aria-pressed="' + (CV.size === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
  }

  function cvTile(c, opt) {
    var r = ccRec(c.id) || {}, l = ccLab(c.id), L = CC_L[l], s = CCTV.siteOf[c.id], th = cvThumb(c);
    var quiet = l === 'normal' || l === 'none' || l === 'pending';
    var sub = opt && opt.site ? s.name : '';
    return '<button type="button" class="cv-tile' + (CC_WET.indexOf(l) >= 0 ? ' wet' : '') + '" style="--c:' + L.c + '" data-cc-cam="' + esc(c.id) + '" data-cc-ctx="' + esc(opt && opt.ctx || 'all') + '"' +
      ' aria-label="' + esc(c.name + ' · ' + s.name + ' · ' + L.t) + '">' +
      '<span class="cv-img"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" data-b="' + CV.bucket + '"' + (th ? ' data-th="' + esc(th) + '"' : '') + ' src="' + esc(cvImg(c)) + '"><i class="cv-th-tag">ภาพรอบ AI</i></span>' +
      '<span class="cv-badge' + (quiet ? ' quiet' : '') + '" title="' + esc(L.t) + '">' + ccChip(l) + '</span>' +
      '<span class="cv-cap"><span class="cv-n">' + esc(c.name) + '</span>' +
        (sub ? '<span class="cv-s">' + esc(sub) + '</span>' : '') +
        '<span class="cv-t">' + (r.ai || r.seen ? 'AI ' + esc(ccTime(r.ai || r.seen)) : '') + '</span></span></button>';
  }
  function cvGroupHtml(s, cams, dist) {
    var src = CCTV.reg.sources[s.src] || {};
    return '<section class="cv-sec" aria-label="' + esc(s.name) + '">' +
      '<div class="cv-sec-h">' + cvDot(cams) + '<h2>' + esc(s.name) + '</h2>' +
        '<span class="cv-sec-m">' + (s.src === 'hatyai' ? 'หาดใหญ่ · ' : '') + 'จ.' + esc(s.prov) + ' · ' + cams.length + ' กล้อง' +
        (dist != null ? ' · ห่างราว ' + (dist < 10 ? dist.toFixed(1) : Math.round(dist)) + ' กม.' : '') + (s.approx ? ' · ตำแหน่งโดยประมาณ' : '') + '</span>' +
        '<button type="button" class="cv-sec-a" data-cc-site="' + esc(s.id) + '">แผนที่</button>' +
        (CV.filter !== 'site:' + s.id ? '<button type="button" class="cv-sec-a" data-cv-f="site:' + esc(s.id) + '">ดูเฉพาะจุดนี้</button>' : '') +
      '</div>' +
      (s.note ? '<p class="cv-sec-note">' + esc(s.note) + '</p>' : '') +
      '<div class="cv-wall">' + cams.map(function (c) { return cvTile(c, { ctx: 'site:' + s.id }); }).join('') + '</div>' +
      (src.name ? '<p class="cv-cred">' + ccCredit(src) + '</p>' : '') + '</section>';
  }

  function renderCctvPage() {
    if (state.page !== 'cctv' || !$('pageCctv')) return;
    var body = $('cvBody');
    $('pageCctv').setAttribute('data-size', CV.size);
    if (IN_ARTIFACT) {
      body.innerHTML = '<p class="cv-empty">ภาพกล้องโหลดได้เฉพาะบนเว็บจริง (choonahakarn.github.io/chatgeo) ในแอป Claude เปิดภาพจากเว็บอื่นไม่ได้</p>';
      return;
    }
    if (!ccReady()) {
      body.innerHTML = '<div class="cv-wall cv-skel">' + new Array(9).join('<span class="cv-tile"><span class="cv-img"></span></span>') + '</div><p class="cv-empty">กำลังโหลดรายชื่อกล้อง…</p>';
      return;
    }
    cvValidFilter();
    cvSideHtml();
    var cams = cvCams(), ids = {};
    cams.forEach(function (c) { ids[c.id] = 1; });
    var all = ccAllCams(), cnt = {};
    all.forEach(function (c) { var l = ccLab(c.id); cnt[l] = (cnt[l] || 0) + 1; });
    var wetN = CC_WET.reduce(function (t, k) { return t + (cnt[k] || 0); }, 0);
    var badN = (cnt.stale || 0) + (cnt.offline || 0);
    $('cvStats').innerHTML =
      '<span class="cv-stat"><b>' + all.length + '</b> กล้อง</span>' +
      '<span class="cv-stat' + (wetN ? ' hot' : '') + '"><i class="cc-dot" style="background:' + CC_L.flood.c + '"></i>AI เห็นน้ำ <b>' + (CCTV.idx ? wetN : '–') + '</b></span>' +
      ((cnt.spill || 0) ? '<span class="cv-stat"><i class="cc-dot" style="background:' + CC_L.spill.c + '"></i>ระบายน้ำ <b>' + cnt.spill + '</b></span>' : '') +
      '<span class="cv-stat"><i class="cc-dot" style="background:' + CC_L.normal.c + '"></i>ปกติ <b>' + (cnt.normal || 0) + '</b></span>' +
      (badN ? '<span class="cv-stat"><i class="cc-dot" style="background:' + CC_L.stale.c + '"></i>ภาพค้าง/ไม่มีภาพ <b>' + badN + '</b></span>' : '') +
      '<span class="cv-stat dim">AI ล่าสุด ' + (CCTV.idx ? esc(ccTime(CCTV.idx.updated)) : '–') + '</span>';

    var mapMode = CV.mode === 'map';
    $('pageCctv').classList.toggle('cv-mapmode', mapMode);
    $('cvMapView').hidden = !mapMode;
    body.hidden = mapMode;
    if (mapMode) {
      body.innerHTML = '';
      $('cvFoot').innerHTML = ccFootNote() + ' · มุมมองแผนที่: จุดคือที่ตั้งกล้อง ตัวเลขคือจำนวนกล้อง คอลัมน์ขวาคือภาพจากกล้องที่อยู่ในกรอบแผนที่ (รีเฟรชทุก 2 นาที)';
      cvmRender();
      cvTick();
      return;
    }
    var html = '';
    var oldH = CCTV.idx && ccHoursAgo(CCTV.idx.updated);
    if (oldH != null && oldH >= 3) html += '<p class="cv-warn">ป้ายสีจาก AI ไม่ได้อัปเดตมาราว ' + Math.round(oldH) + ' ชม. (อาจไม่ตรงกับภาพตอนนี้) แต่ภาพในหน้านี้ยังโหลดสดจากกล้องต้นทาง</p>';
    var head = cvFilterLabel(CV.filter) + (CV.kind !== 'all' ? ' · ' + CV_KINDS.filter(function (k) { return k[0] === CV.kind; })[0][1] : '') + (CV.q ? ' · “' + CV.q + '”' : '');
    html += '<div class="cv-now"><span>' + esc(head) + ' · ' + cams.length + ' กล้อง</span>' +
      (CV.filter !== 'all' || CV.kind !== 'all' || CV.q ? '<button type="button" class="cv-sec-a" data-cv-reset="1">ล้างตัวกรอง</button>' : '') + '</div>';

    if (!cams.length) {
      html += '<p class="cv-empty">' + (CV.filter === 'wet' && !CV.q && CV.kind === 'all'
        ? 'ตอนนี้ AI ยังไม่เห็นน้ำผิดปกติในกล้องไหน' + (CCTV.idx ? ' (ดูเมื่อ ' + esc(ccTime(CCTV.idx.updated)) + ')' : '') + ' ลองดูทั้งหมดได้'
        : 'ไม่มีกล้องที่ตรงกับตัวกรองนี้') + '</p>';
    } else if (CV.filter === 'wet') {
      // AI เห็นน้ำ: เรียงจากหนักไปเบา แสดงชื่อจุดในการ์ด
      html += '<div class="cv-wall">' + ccSorted(cams).map(function (c) { return cvTile(c, { ctx: 'wet', site: true }); }).join('') + '</div>';
    } else {
      // กล้องที่ AI เห็นน้ำขึ้นแถบบนสุดก่อน (เฉพาะหน้าแรกที่ไม่ได้กรอง)
      var hot = CV.filter === 'all' && !CV.q && CV.kind === 'all' ? ccSorted(ccFilterCams('wet')) : [];
      if (hot.length) {
        html += '<section class="cv-sec cv-hot"><div class="cv-sec-h">' + cvDot(hot) + '<h2>AI เห็นน้ำตอนนี้</h2><span class="cv-sec-m">' + hot.length + ' กล้อง · เรียงจากหนักไปเบา</span>' +
          (hot.length > 8 ? '<button type="button" class="cv-sec-a" data-cv-f="wet">ดูครบ ' + hot.length + ' กล้อง</button>' : '') + '</div>' +
          '<div class="cv-wall">' + hot.slice(0, 8).map(function (c) { return cvTile(c, { ctx: 'wet', site: true }); }).join('') + '</div></section>';
      }
      var sites = CCTV.reg.sites.filter(function (s) { return s.cams.some(function (c) { return ids[c.id]; }); });
      var dists = {};
      if (CV.filter === 'near' && CV.near) {
        sites.forEach(function (s) { dists[s.id] = km(CV.near.lon, CV.near.lat, s.lon, s.lat); });
        sites.sort(function (a, b) { return dists[a.id] - dists[b.id]; });
      }
      html += sites.map(function (s) {
        return cvGroupHtml(s, s.cams.filter(function (c) { return ids[c.id]; }), CV.filter === 'near' ? dists[s.id] : null);
      }).join('');
    }
    var sc = cvSc(), y = sc.scrollTop;
    body.innerHTML = html;
    sc.scrollTop = y;
    $('cvFoot').innerHTML = ccFootNote() + ' · ภาพบนหน้านี้โหลดตรงจากต้นทาง รีเฟรชทุก 2 นาทีเฉพาะภาพที่อยู่บนจอ';
    cvObserve();
    cvTick();
  }

  // รีเฟรชภาพ: โหลดภาพใหม่เบื้องหลังก่อน แล้วค่อยสลับ ภาพจะไม่กะพริบ
  function cvSwap(img) {
    var b = String(CV.bucket);
    if (img.getAttribute('data-b') === b || img.getAttribute('data-thumb') === '1') return;
    var t = img.closest('[data-cc-cam]'), c = t && CCTV.cams[t.getAttribute('data-cc-cam')];
    if (!c) return;
    img.setAttribute('data-b', b);
    var pre = new Image(), url = cvImg(c);
    pre.referrerPolicy = 'no-referrer';
    pre.onload = function () { img.src = url; img.parentNode.classList.remove('err'); };
    pre.src = url;
  }
  function cvObserve() {
    if (CV.io) CV.io.disconnect();
    CV.vis = [];
    if (!('IntersectionObserver' in window)) return;
    CV.io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        var i = CV.vis.indexOf(en.target);
        if (en.isIntersecting) { if (i < 0) CV.vis.push(en.target); cvSwap(en.target); }
        else if (i >= 0) CV.vis.splice(i, 1);
      });
    }, { rootMargin: '200px 0px' });
    $('pageCctv').querySelectorAll('#cvBody .cv-img img, #cvmCol .cv-img img').forEach(function (im) { CV.io.observe(im); });
  }
  function cvRefreshNow() {
    CV.bucket = Math.max(CV.bucket + 1, Math.floor(Date.now() / CV_REFRESH));
    CV.next = Date.now() + CV_REFRESH;
    (CV.io ? CV.vis : Array.prototype.slice.call($('pageCctv').querySelectorAll('#cvBody .cv-img img, #cvmCol .cv-img img'))).forEach(cvSwap);
  }
  function cvClockText() {
    var b = new Date(Date.now() + 7 * 3600e3);
    var p = function (n) { return ('0' + n).slice(-2); };
    return '<span class="cv-c-d">' + TH_DAY[b.getUTCDay()].slice(0, 2) + '. ' + b.getUTCDate() + ' ' + TH_MON_S[b.getUTCMonth()] + '</span> ' +
      '<b>' + p(b.getUTCHours()) + ':' + p(b.getUTCMinutes()) + '<span class="cv-c-s">:' + p(b.getUTCSeconds()) + '</span></b> <span class="cv-c-d">น.</span>';
  }
  function cvTick() {
    if (state.page !== 'cctv') return;
    $('cvClock').innerHTML = cvClockText();
    if (!CV.next) CV.next = Date.now() + CV_REFRESH;
    if (!document.hidden && Date.now() >= CV.next) cvRefreshNow();
    var s = Math.max(0, Math.round((CV.next - Date.now()) / 1000));
    $('cvCount').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
  }
  function cvStart() {
    renderCctvPage();
    clearInterval(CV.timer);
    CV.timer = setInterval(cvTick, 1000);
  }
  function cvStop() {
    clearInterval(CV.timer);
    CV.timer = 0;
    if (CV.io) { CV.io.disconnect(); CV.io = null; CV.vis = []; }
    if (CV.fs) cvFull(false);
    if (typeof cvmStopWind === 'function') cvmStopWind();
  }
  function cvSetFilter(f) {
    CV.filter = f;
    renderCctvPage();
    cvSc().scrollTop = 0;
    writeHash(false);
  }
  function cvNear() {
    if (CV.near) { cvSetFilter('near'); return; }
    if (me.lon != null) { CV.near = { lon: me.lon, lat: me.lat }; cvSetFilter('near'); return; }
    if (!navigator.geolocation) { toast('เบราว์เซอร์นี้หาตำแหน่งไม่ได้'); return; }
    CV.busy = true; cvSideHtml();
    navigator.geolocation.getCurrentPosition(function (pos) {
      CV.busy = false;
      CV.near = { lon: pos.coords.longitude, lat: pos.coords.latitude };
      me.lon = CV.near.lon; me.lat = CV.near.lat;
      cvSetFilter('near');
    }, function () {
      CV.busy = false; cvSideHtml();
      toast('หาตำแหน่งไม่ได้ ลองอนุญาตตำแหน่งในเบราว์เซอร์ หรือเลือกพื้นที่จากรายการแทน');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }
  // เต็มจอ: ใช้ Fullscreen API ถ้ามี (มือถือบางรุ่นไม่มี ใช้โหมดซ่อนแถบแทน)
  function cvFull(on) {
    var el = $('pageCctv');
    CV.fs = on;
    el.classList.toggle('cv-fs', on);
    document.body.classList.toggle('cv-fs-on', on);
    $('cvFull').setAttribute('aria-pressed', String(on));
    $('cvFullT').textContent = on ? 'ออกจากเต็มจอ' : 'เต็มจอ';
    try {
      var root = document.documentElement;
      if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(function () { /* ใช้โหมดซ่อนแถบแทน */ });
      if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () { /* ข้าม */ });
    } catch (e) { /* ข้าม */ }
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && CV.fs) cvFull(false);
  });
  function cvShowMap() {
    var f = CV.filter;
    if (f.indexOf('site:') === 0) { showCctvSite(f.slice(5)); return; }
    var cams = cvCams();
    if (!cams.length) cams = ccAllCams();
    var sites = [];
    cams.forEach(function (c) { var s = CCTV.siteOf[c.id]; if (sites.indexOf(s) < 0) sites.push(s); });
    if (sites.length === 1) { showCctvSite(sites[0].id); return; }
    if (!state.data.cctv) { state.data.cctv = true; saveData(); renderDataChips(); eachView(updateCctvMarkers); }
    setPage('chat');
    var v = views.chat;
    var b = sites.reduce(function (bb, s) { return [Math.min(bb[0], s.lon), Math.min(bb[1], s.lat), Math.max(bb[2], s.lon), Math.max(bb[3], s.lat)]; }, [999, 999, -999, -999]);
    setTimeout(function () { v.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: mapPadding(v), maxZoom: 11, duration: reduceMotion ? 0 : 900 }); }, 60);
  }
  if ($('pageCctv')) {
    $('pageCctv').addEventListener('click', function (e) {
      var t = e.target.closest('[data-cv-f],[data-cv-k],[data-cv-size],[data-cv-reset],[data-cv-mode]');
      if (!t) return;
      if (t.hasAttribute('data-cv-mode')) { cvSetMode(t.getAttribute('data-cv-mode')); return; }
      if (t.hasAttribute('data-cv-f')) {
        var f = t.getAttribute('data-cv-f');
        if (f === 'near') cvNear(); else cvSetFilter(f);
      } else if (t.hasAttribute('data-cv-k')) {
        CV.kind = t.getAttribute('data-cv-k'); renderCctvPage();
      } else if (t.hasAttribute('data-cv-size')) {
        CV.size = t.getAttribute('data-cv-size');
        try { localStorage.setItem('cg-cv-size', CV.size); } catch (er) { /* ข้าม */ }
        renderCctvPage();
      } else {
        CV.kind = 'all'; CV.q = ''; $('cvQ').value = ''; cvSetFilter('all');
      }
    });
    // ภาพจากต้นทางโหลดไม่ได้: ใช้ภาพย่อรอบ AI ล่าสุดแทน (ถ้าแหล่งนั้นอนุญาตให้เก็บ) ไม่งั้นขึ้นว่าไม่มีภาพ
    $('pageCctv').addEventListener('error', function (e) {
      var im = e.target;
      if (!im || im.tagName !== 'IMG' || !im.parentNode.classList.contains('cv-img')) return;
      var th = im.getAttribute('data-th');
      if (th && im.getAttribute('data-thumb') !== '1') { im.setAttribute('data-thumb', '1'); im.parentNode.classList.add('th'); im.src = th; }
      else im.parentNode.classList.add('err');
    }, true);
    var cvQT = 0;
    $('cvQ').addEventListener('input', function () {
      clearTimeout(cvQT);
      cvQT = setTimeout(function () { CV.q = $('cvQ').value.trim(); renderCctvPage(); }, 180);
    });
    $('cvSel').addEventListener('change', function () { cvSetFilter($('cvSel').value); });
    $('cvRefresh').addEventListener('click', function () { cvRefreshNow(); cvTick(); });
    $('cvMap').addEventListener('click', cvShowMap);
    $('cvFull').addEventListener('click', function () { cvFull(!CV.fs); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && CV.fs && !e.defaultPrevented && $('ccModal').hidden) cvFull(false);
    });
  }

  /* ---------- หน้ากล้อง: มุมมองแผนที่ (แผนที่มืด + เรดาร์ฝน + ลม ซ้าย · คอลัมน์ภาพกล้องขวา · แถบสถานการณ์น้ำวิ่งด้านบน) ---------- */
  var CVM = { map: null, v: null, ready: false, wind: true, radar: true, flood: false, ai: false, site: null, mk: [], colSig: '', tickSig: '', radarT: 0, colT: 0 };
  try {
    var cvmP = JSON.parse(localStorage.getItem('cg-cvm') || '{}');
    ['wind', 'radar', 'flood', 'ai'].forEach(function (k) { if (typeof cvmP[k] === 'boolean') CVM[k] = cvmP[k]; });
    if (localStorage.getItem('cg-cv-mode') === 'map') CV.mode = 'map';
  } catch (e) { /* ไม่มีที่เก็บ */ }
  if (!CV.mode) CV.mode = 'wall';
  function cvmSave() { try { localStorage.setItem('cg-cvm', JSON.stringify({ wind: CVM.wind, radar: CVM.radar, flood: CVM.flood, ai: CVM.ai })); localStorage.setItem('cg-cv-mode', CV.mode); } catch (e) { /* ข้าม */ } }
  var CVM_STILL = '#38A8F0';
  function cvmWet(c) { return CC_WET.indexOf(ccLab(c.id)) >= 0; }
  function cvmCams() { var cams = cvCams(); return CVM.ai ? cams.filter(cvmWet) : cams; }
  // จุดบนแผนที่ = จุดติดตั้ง (กล้องในจุดเดียวกันใช้พิกัดเดียวกัน) รวมจุดที่อยู่ชิดกันบนจอเป็นวงตัวเลข
  function cvmSites(cams) {
    var by = {}, out = [];
    cams.forEach(function (c) {
      var s = CCTV.siteOf[c.id];
      if (!s) return;
      if (!by[s.id]) { by[s.id] = { s: s, cams: [], wet: 0 }; out.push(by[s.id]); }
      by[s.id].cams.push(c);
      if (cvmWet(c)) by[s.id].wet++;
    });
    return out;
  }
  function cvmClusters(sites) {
    var map = CVM.map, cl = [];
    sites.slice().sort(function (a, b) { return b.wet - a.wet; }).forEach(function (g) {
      var p = map.project([g.s.lon, g.s.lat]), hit = null;
      for (var i = 0; i < cl.length; i++) { var q = cl[i]; if (Math.abs(q.px - p.x) < 42 && Math.abs(q.py - p.y) < 42) { hit = q; break; } }
      if (!hit) { hit = { px: p.x, py: p.y, groups: [], n: 0, wet: 0 }; cl.push(hit); }
      hit.groups.push(g); hit.n += g.cams.length; hit.wet += g.wet;
    });
    cl.forEach(function (q) {
      q.lon = q.groups.reduce(function (t, g) { return t + g.s.lon; }, 0) / q.groups.length;
      q.lat = q.groups.reduce(function (t, g) { return t + g.s.lat; }, 0) / q.groups.length;
    });
    return cl;
  }
  function cvmMarkers() {
    if (!CVM.ready) return;
    CVM.mk.forEach(function (m) { m.remove(); });
    CVM.mk = [];
    cvmClusters(cvmSites(cvmCams())).forEach(function (q) {
      var el = document.createElement('button'), one = q.groups.length === 1, g = q.groups[0];
      el.type = 'button';
      el.className = 'cvm-pin' + (q.wet ? ' wet' : '') + (one && CVM.site === g.s.id ? ' sel' : '') + (q.n >= 10 ? ' big' : '');
      el.innerHTML = '<b>' + q.n + '</b>' + (q.wet ? '<i class="cvm-ai" aria-hidden="true">AI ' + q.wet + '</i>' : '');
      var nm = one ? g.s.name + ' · จ.' + g.s.prov : q.groups.length + ' จุด';
      el.title = nm + ' · ' + q.n + ' กล้อง' + (q.wet ? ' · AI เห็นน้ำ ' + q.wet + ' กล้อง' : '');
      el.setAttribute('aria-label', el.title);
      if (one) el.setAttribute('data-site', g.s.id);
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (one) { cvmPickSite(g.s.id, true); return; }
        var b = q.groups.reduce(function (bb, x) { return [Math.min(bb[0], x.s.lon), Math.min(bb[1], x.s.lat), Math.max(bb[2], x.s.lon), Math.max(bb[3], x.s.lat)]; }, [999, 999, -999, -999]);
        CVM.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, maxZoom: 15, duration: reduceMotion ? 0 : 700 });
      });
      CVM.mk.push(new maplibregl.Marker({ element: el }).setLngLat([q.lon, q.lat]).addTo(CVM.map));
    });
  }
  function cvmPickSite(id, fly) {
    CVM.site = CVM.site === id && !fly ? null : id;
    var s = CCTV.site[id];
    if (fly && s) CVM.map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(CVM.map.getZoom(), 13), duration: reduceMotion ? 0 : 800 });
    CVM.colSig = '';
    cvmMarkers(); cvmCol();
    var col = $('cvmCol'); if (col) col.scrollTop = 0;
  }
  // คอลัมน์ขวา: กล้องที่อยู่ในกรอบแผนที่ตอนนี้ (AI เห็นน้ำขึ้นก่อน)
  function cvmCol() {
    var col = $('cvmCol');
    if (!col || !CVM.ready) return;
    var all = cvmCams(), b = CVM.map.getBounds(), cams;
    if (CVM.site && CCTV.site[CVM.site]) cams = all.filter(function (c) { return CCTV.siteOf[c.id].id === CVM.site; });
    else { CVM.site = null; cams = all.filter(function (c) { var s = CCTV.siteOf[c.id]; return b.contains([s.lon, s.lat]); }); }
    cams = ccSorted(cams);
    var shown = cams.slice(0, 60), sig = CV.bucket + '|' + (CVM.site || '') + '|' + shown.map(function (c) { return c.id + ':' + ccLab(c.id); }).join(',');
    var head = CVM.site ? '<span class="cvm-h-t">' + esc(CCTV.site[CVM.site].name) + '</span><button type="button" class="cv-sec-a" data-cvm-site="">ดูทั้งกรอบ</button>'
      : '<span class="cvm-h-t">ในกรอบแผนที่</span>';
    var n = '<span class="cvm-h-n">แสดง <b>' + cams.length + '</b>/' + ccAllCams().length + ' กล้อง' + (CVM.ai ? ' · เฉพาะ AI เห็นน้ำ' : '') + (cams.length > shown.length ? ' · ' + shown.length + ' แรก' : '') + '</span>';
    if (sig === CVM.colSig) { var hh = col.querySelector('.cvm-h'); if (hh) hh.innerHTML = head + n; return; }
    CVM.colSig = sig;
    col.innerHTML = '<div class="cvm-h">' + head + n + '</div>' + (shown.length ? '<div class="cvm-list">' + shown.map(function (c) { return cvTile(c, { ctx: 'all', site: true }); }).join('') + '</div>'
      : '<p class="cv-empty">' + (CVM.ai ? 'ตอนนี้ AI ยังไม่เห็นน้ำในกล้องที่อยู่ในกรอบนี้' : 'ไม่มีกล้องในกรอบนี้ ลองซูมออกหรือเลื่อนแผนที่') + '</p>');
    cvObserve();
  }
  function cvmColSoon() { clearTimeout(CVM.colT); CVM.colT = setTimeout(cvmCol, 120); }
  // แถบบน: AI เห็นน้ำในกล้อง + จังหวัดที่ดาวเทียมเห็นน้ำท่วม
  function cvmTickItems() {
    var out = [];
    ccSorted(ccFilterCams('wet')).forEach(function (c) {
      var r = ccRec(c.id) || {}, l = ccLab(c.id), s = CCTV.siteOf[c.id];
      out.push({ k: 'AI ' + CC_L[l].t, c: CC_L[l].c, t: c.name + ' · ' + s.name, ago: r.ai ? ccTime(r.ai) : '', cam: c.id });
    });
    topFloodProvinces(6, FL_PROV_MIN).forEach(function (r) {
      out.push({ k: 'ดาวเทียม', c: FL_C.flood, t: 'น่าจะมีน้ำท่วม จ.' + r.name + ' ราว ' + fmtKm2(r.flood_high) + ' ตร.กม.', ago: FLOOD.index && FLOOD.index.date_max ? 'ภาพ' + ageText(FLOOD.index.date_max) : '', prov: PID_BY_NAME[r.name] });
    });
    return out;
  }
  function cvmTicker() {
    var run = $('cvmTick');
    if (!run) return;
    var items = cvmTickItems(), sig = items.map(function (it) { return it.k + it.t + it.ago; }).join('~');
    if (sig === CVM.tickSig && run.innerHTML) return;
    CVM.tickSig = sig;
    CVM.tick = items;
    if (!items.length) {
      run.classList.remove('go');
      run.innerHTML = '<span class="cvm-ti quiet">ตอนนี้ AI ยังไม่เห็นน้ำผิดปกติในกล้องไหน' + (CCTV.idx ? ' (ดูเมื่อ ' + esc(ccTime(CCTV.idx.updated)) + ')' : '') + ' และดาวเทียมยังไม่เห็นน้ำท่วมเด่นชัด</span>';
      return;
    }
    var one = function (hid) {
      return items.map(function (it, i) {
        return '<button type="button" class="cvm-ti" data-cvm-tk="' + i + '"' + (hid ? ' tabindex="-1" aria-hidden="true"' : '') + '><span class="cvm-tk" style="--c:' + it.c + '">' + esc(it.k) + '</span>' + esc(it.t) +
          (it.ago ? '<span class="cvm-ago">' + esc(it.ago) + '</span>' : '') + '</button>';
      }).join('<span class="cvm-sep" aria-hidden="true">·</span>');
    };
    run.innerHTML = '<span class="ot-half">' + one(false) + '<span class="cvm-sep" aria-hidden="true">·</span></span><span class="ot-half" aria-hidden="true">' + one(true) + '<span class="cvm-sep">·</span></span>';
    run.classList.add('go');
    run.style.animationDuration = Math.max(25, Math.round(run.scrollWidth / 2 / 60)) + 's';
  }
  function cvmLegend() {
    var el = $('cvmLeg');
    if (!el) return;
    var h = '<div class="cvm-li"><i style="background:' + CVM_STILL + '"></i>กล้องภาพนิ่ง (รีเฟรชเอง)</div>' +
      '<div class="cvm-li"><i style="background:' + CC_L.flood.c + '"></i>AI เห็นน้ำในภาพกล้อง</div>';
    if (CVM.flood) h += '<div class="cvm-li"><i class="sq" style="background:' + FL_C.flood + '"></i>น้ำท่วมจากดาวเทียม (รายจังหวัด)</div>';
    if (CVM.radar && RADAR.frames.length) h += '<div class="cvm-li cvm-rain"><span>ฝน</span><span class="cvm-grad" style="background:linear-gradient(90deg,' + RADAR_LEG.slice(0, 6).map(function (x) { return x[0]; }).join(',') + ')"></span><span>เบา · หนัก</span></div>' +
      '<div class="cvm-li dim">เรดาร์ ' + esc(radarTime(RADAR.frames.length - 1)) + '</div>';
    else if (CVM.radar && RADAR.err) h += '<div class="cvm-li dim">เรดาร์ฝนโหลดไม่ได้ตอนนี้</div>';
    if (CVM.wind && WIND.grid) h += '<div class="cvm-li dim">ลม ' + (WIND.grid.time ? esc(ccTime(WIND.grid.time)) : '') + ' · Open-Meteo</div>';
    el.innerHTML = h;
  }
  function cvmBtns() {
    document.querySelectorAll('[data-cvm]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!CVM[b.getAttribute('data-cvm')])); });
  }
  function cvmRadar() {
    var map = CVM.map;
    if (!CVM.ready) return;
    var f = RADAR.frames[RADAR.frames.length - 1], on = CVM.radar && !!f;
    if (on && CVM.radarT !== f.time) {
      if (map.getLayer('cvm-radar')) map.removeLayer('cvm-radar');
      if (map.getSource('cvm-radar')) map.removeSource('cvm-radar');
      map.addSource('cvm-radar', { type: 'raster', tiles: [RADAR.host + f.path + '/512/{z}/{x}/{y}/2/1_1.png'], tileSize: 512, maxzoom: 7,
        attribution: 'เรดาร์ฝน: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>' });
      map.addLayer({ id: 'cvm-radar', type: 'raster', source: 'cvm-radar', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } }, map.getLayer('cvm-fl') ? 'cvm-fl' : undefined);
      CVM.radarT = f.time;
    }
    if (map.getLayer('cvm-radar')) map.setLayoutProperty('cvm-radar', 'visibility', on ? 'visible' : 'none');
    cvmLegend();
  }
  function cvmFlood() {
    var map = CVM.map;
    if (!CVM.ready) return;
    if (!map.getSource('cvm-fl')) {
      map.addSource('cvm-fl', { type: 'geojson', data: FLOOD.provFC || emptyFC(), attribution: floodAttr() });
      map.addLayer({ id: 'cvm-fl', type: 'fill', source: 'cvm-fl', filter: ['>=', ['get', 'fh'], FL_PROV_MIN],
        paint: { 'fill-color': FL_C.flood, 'fill-opacity': ['interpolate', ['linear'], ['get', 'fh'], FL_PROV_MIN, 0.18, 20, 0.3, 50, 0.42, 150, 0.55] } });
      map.addLayer({ id: 'cvm-fl-l', type: 'line', source: 'cvm-fl', filter: ['>=', ['get', 'fh'], 20], paint: { 'line-color': FL_C.flood, 'line-width': 1, 'line-opacity': 0.8 } });
      CVM.flSet = FLOOD.provFC;
    } else if (CVM.flSet !== FLOOD.provFC) { map.getSource('cvm-fl').setData(FLOOD.provFC || emptyFC()); CVM.flSet = FLOOD.provFC; }
    ['cvm-fl', 'cvm-fl-l'].forEach(function (id) { map.setLayoutProperty(id, 'visibility', CVM.flood ? 'visible' : 'none'); });
    cvmLegend();
  }
  function cvmWind() {
    if (!CVM.v) return;
    if (CVM.wind && state.page === 'cctv' && CV.mode === 'map') loadWind();
    updateWind(CVM.v);
    cvmLegend();
  }
  function cvmEnsure() {
    if (CVM.map) { CVM.map.resize(); return; }
    var el = $('cvmMap');
    if (!el || !window.maplibregl) return;
    var map = CVM.map = new maplibregl.Map({
      container: el, style: usingFallback ? fallbackStyle('dark') : osmStyleUrl('dark'),
      center: [100.6, 12.9], zoom: el.clientWidth < 600 ? 4.4 : 5.2, minZoom: 2.5, maxZoom: usingFallback ? FB_MAXZOOM : 18,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: true }, locale: UI_TH
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    CVM.v = { kind: 'cvm', map: map, el: el };
    map.on('load', function () {
      CVM.ready = true;
      // เริ่มที่กรอบที่เห็นกล้องครบทุกจุด
      var ss = (CCTV.reg && CCTV.reg.sites) || [];
      if (ss.length) {
        var bb = ss.reduce(function (b, x) { return [Math.min(b[0], x.lon), Math.min(b[1], x.lat), Math.max(b[2], x.lon), Math.max(b[3], x.lat)]; }, [999, 999, -999, -999]);
        map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: { top: 70, bottom: el.clientWidth < 600 ? 150 : 40, left: 40, right: 40 }, maxZoom: 9, duration: 0 });
      }
      cvmFlood(); cvmRadar(); cvmWind();
      cvmMarkers(); cvmCol();
    });
    map.on('moveend', function () { cvmMarkers(); cvmColSoon(); });
    map.on('click', function () { if (CVM.site) cvmPickSite(CVM.site); });
    if (CVM.radar) loadRadar();
  }
  function cvmRender() {
    cvmEnsure();
    cvmBtns(); cvmTicker(); cvmLegend();
    if (CVM.ready) { cvmFlood(); cvmRadar(); cvmWind(); cvmMarkers(); cvmCol(); }
  }
  function cvmStopWind() { var v = CVM.v; if (v && v.wind) { cancelAnimationFrame(v.wind.raf); v.wind.cv.remove(); v.wind = null; } }
  function cvSetMode(m) {
    CV.mode = m;
    cvmSave();
    if (m !== 'map') cvmStopWind();
    renderCctvPage();
    if (m === 'map' && CVM.map) setTimeout(function () { CVM.map.resize(); cvmMarkers(); cvmCol(); }, 30);
  }
  if ($('cvMapView')) {
    $('cvMapView').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cvm]');
      if (b) {
        var k = b.getAttribute('data-cvm');
        CVM[k] = !CVM[k];
        cvmSave(); cvmBtns();
        if (k === 'radar') { if (CVM.radar) loadRadar(); cvmRadar(); }
        else if (k === 'flood') cvmFlood();
        else if (k === 'wind') cvmWind();
        else { CVM.colSig = ''; cvmMarkers(); cvmCol(); }
        return;
      }
      var st = e.target.closest('[data-cvm-site]');
      if (st) { if (st.getAttribute('data-cvm-site')) cvmPickSite(st.getAttribute('data-cvm-site'), true); else { CVM.site = null; CVM.colSig = ''; cvmMarkers(); cvmCol(); } return; }
      var tk = e.target.closest('[data-cvm-tk]');
      if (tk) {
        var it = (CVM.tick || [])[+tk.getAttribute('data-cvm-tk')];
        if (!it) return;
        if (it.cam) { var s = CCTV.siteOf[it.cam]; if (s) cvmPickSite(s.id, true); openCcModal('cam', it.cam, 'wet'); }
        else if (it.prov) {
          if (!CVM.flood) { CVM.flood = true; cvmSave(); cvmBtns(); cvmFlood(); }
          var f = TH && TH.provinces && TH.provinces.features.filter(function (x) { return x.properties.id === it.prov; })[0];
          if (f) CVM.map.flyTo({ center: [f.properties.cx, f.properties.cy], zoom: 7.5, duration: reduceMotion ? 0 : 900 });
        }
      }
    });
    // ชี้ภาพในคอลัมน์ = จุดบนแผนที่สว่างขึ้น
    $('cvMapView').addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('#cvmCol [data-cc-cam]');
      var sid = t && CCTV.siteOf[t.getAttribute('data-cc-cam')] && CCTV.siteOf[t.getAttribute('data-cc-cam')].id;
      if (sid === CVM.hl) return;
      CVM.hl = sid;
      CVM.mk.forEach(function (m) { var el = m.getElement(); el.classList.toggle('hl', !!sid && el.getAttribute('data-site') === sid); });
    });
  }

  // แชท: หยิบกล้องที่เกี่ยวกับคำถามมาตอบ (ไม่ใช้ AI ตอบ ใช้เฉพาะผลที่บันทึกไว้ อ้างชื่อกล้องและเวลาทุกครั้ง)
  var CC_RE = /กล้อง|cctv|ซีซีทีวี|ภาพสด|จอรวม/i;
  var CC_WET_RE = /น้ำท่วม|ท่วม|น้ำขัง|น้ำสูง|น้ำล้น|เห็นน้ำ|flood/i;
  var CC_GENERIC = ['ประตูระบายน้ำ', 'สะพาน', 'ริมคลอง', 'ท้ายซอย', 'ด้านหน้า', 'ด้านหลัง', 'คลองอู่ตะเภา'];
  function ccMatch(t) {
    if (!ccReady()) return null;
    t = String(t || '');
    var hit = [], seen = {};
    CCTV.reg.sites.forEach(function (s) {
      var names = [s.name, s.area].concat(s.area === s.name ? [s.name.replace(/^เขื่อน/, '')] : []);
      s.name.split(/[()–\s]+/).forEach(function (w) { if (w.length >= 4) names.push(w); });
      if (names.some(function (n) { return n && n.length >= 3 && t.indexOf(n) >= 0; })) {
        // ชื่อพื้นที่ย่อย (เช่น คอหงส์) ตรงกว่าชื่อพื้นที่ใหญ่ (หาดใหญ่)
        var solo = CCTV.reg.sites.filter(function (x) { return x.area === s.area; }).length === 1;
        var exact = solo || [s.name].concat(s.name.split(/[()–\s]+/)).some(function (n) { return n.length >= 3 && n !== s.area && t.indexOf(n) >= 0; });
        hit.push({ s: s, exact: exact });
      }
      s.cams.forEach(function (c) {
        if (c.kind === 'dam' || seen[c.id]) return;
        var parts = [c.name].concat(c.name.split(/[()–\s]+/)).filter(function (w) { return w.length >= 5 && CC_GENERIC.indexOf(w) < 0; });
        if (parts.some(function (w) { return t.indexOf(w) >= 0; })) { seen[c.id] = 1; hit.push({ s: s, cam: c, exact: true }); }
      });
    });
    var exact = hit.filter(function (h) { return h.exact; });
    var use = exact.length ? exact : hit;
    if (!use.length) return null;
    var sites = [], cams = [];
    use.forEach(function (h) {
      if (sites.indexOf(h.s) < 0) sites.push(h.s);
      (h.cam ? [h.cam] : h.s.cams).forEach(function (c) { if (cams.indexOf(c) < 0) cams.push(c); });
    });
    return { sites: sites, cams: cams, exact: exact.length > 0, label: use.length === 1 && use[0].cam ? use[0].cam.name : sites.length === 1 ? sites[0].name : sites[0].area };
  }
  // ตอบด้วยกล้องก่อนข่าว: ถามถึงกล้อง, เอ่ยชื่อจุดเจาะจง (เช่น คอหงส์ เขื่อนภูมิพล), ถามว่าน้ำท่วมไหม หรือไม่มีข่าวในพื้นที่นั้น
  function ccFirst(r) {
    return !!(r.camQ || (r.cam && (r.cam.exact || !r.list.length || r.missing || CC_WET_RE.test(r.q))));
  }
  // ลิงก์กล้องของหน่วยงานอื่นในจังหวัด (เปิดที่เว็บต้นทาง ไม่ดึงภาพมาแสดง)
  function ccLinksHtml(provNames, withAll) {
    if (!ccReady()) return '';
    var L = (CCTV.reg.links || []).filter(function (l) {
      return l.provs === '*' ? withAll : (l.provs || []).some(function (p) { return provNames.indexOf(p) >= 0; });
    });
    if (!L.length) return '';
    return '<div class="m-row"><span></span><div><b>กล้องของหน่วยงาน (เปิดที่เว็บต้นทาง)</b> <span>' + L.map(function (l) {
      return '<a class="src-link" href="' + esc(l.url) + '" target="_blank" rel="noopener" title="' + esc(l.note || '') + '">' + esc(l.name) + ICO.ext + '</a>';
    }).join(' ') + '</span></div></div>';
  }
  function ccRowsHtml(cams, max, showSite) {
    var list = ccSorted(cams), more = list.length - max;
    return list.slice(0, max).map(function (c) {
      var r = ccRec(c.id), l = ccLab(c.id), s = CCTV.siteOf[c.id];
      return '<div class="m-row"><i class="cc-dot" style="background:' + CC_L[l].c + '"></i><div><button type="button" class="pt-title" data-cc-cam="' + esc(c.id) + '">' + esc(c.name) + '</button> ' +
        '<span>' + (showSite ? esc(s.name) + ' · ' : '') + esc(CC_L[l].t) + (r && r.th && l !== 'none' ? ' · ' + esc(r.th) : '') +
        (r && (r.ai || r.seen) ? ' · ' + esc(ccTime(r.ai || r.seen)) : '') + '</span></div></div>';
    }).join('') + (more > 0 ? '<div class="m-row m-none"><span></span><div><span>และอีก ' + more + ' กล้อง</span></div></div>' : '');
  }
  function ccBlockHtml(cams, label, wall, opt) {
    opt = opt || {};
    var wet = cams.filter(function (c) { return CC_WET.indexOf(ccLab(c.id)) >= 0; }).length;
    var head = '<div class="m-extra"><div class="m-extra-head">กล้อง CCTV + AI (ทดลอง) · ' + esc(label) + ' · ' + cams.length + ' กล้อง' +
      (CCTV.idx ? ' · AI ดูเมื่อ ' + esc(ccTime(CCTV.idx.updated)) : ' · ยังไม่มีผล AI') + '</div>';
    var rows = ccRowsHtml(cams, opt.max || 6, opt.showSite);
    var old = ccOldNote();
    return head + (CCTV.idx ? '<div class="m-row"><span></span><div><b>' + (wet ? 'AI เห็นน้ำผิดปกติ ' + wet + ' กล้อง' : 'AI ยังไม่เห็นน้ำผิดปกติ') + '</b> <span>ใน ' + cams.length + ' กล้อง กดชื่อกล้องเพื่อดูภาพจริงประกอบเสมอ</span></div></div>' : '') +
      rows + (old ? '<div class="m-row m-none"><span></span><div><span>' + esc(old) + '</span></div></div>' : '') +
      (opt.links || '') +
      '<div class="m-row m-act"><span></span><div><button type="button" class="btn-ghost" data-cc-wall="' + esc(wall) + '">เปิดจอรวม</button>' +
      (opt.site ? ' <button type="button" class="btn-ghost" data-cc-site="' + esc(opt.site) + '">ดูบนแผนที่</button>' : '') + '</div></div></div>';
  }
  // กล้องในจังหวัด/ภาค หรือใกล้ตำแหน่งผู้ใช้ (ต่อท้ายคำตอบรายพื้นที่)
  function ccLocalHtml(opt) {
    if (!ccReady()) return '';
    var tg = floodTarget(opt);
    if (!tg) return '';
    var names = tg.provs.map(function (q) { return q.name; });
    var cams = ccAllCams().filter(function (c) { return names.indexOf(CCTV.siteOf[c.id].prov) >= 0; });
    if (opt.near) {
      cams = ccAllCams().filter(function (c) { var s = CCTV.siteOf[c.id]; return km(opt.near.lon, opt.near.lat, s.lon, s.lat) <= 60; });
    }
    var links = ccLinksHtml(names, false);
    if (!cams.length) {
      return links ? '<div class="m-extra"><div class="m-extra-head">กล้อง CCTV · ' + esc(tg.label) + '</div>' + links + '</div>' : '';
    }
    var wall = names.length === 1 ? 'prov:' + names[0] : 'all';
    var sites = cams.map(function (c) { return CCTV.siteOf[c.id].id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    return ccBlockHtml(cams, opt.near ? (opt.nearLabel || 'ใกล้คุณ') : tg.label, wall, { showSite: sites.length > 1, links: links, max: 5, site: sites.length === 1 ? sites[0] : '' });
  }
  function cctvAnswer(r) {
    if (!ccReady()) return { title: 'กล้อง CCTV', text: CCTV.loaded ? 'โหลดรายชื่อกล้องไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง' : 'กำลังโหลดรายชื่อกล้อง ลองถามอีกครั้งในไม่กี่วินาทีครับ' };
    var m = r.cam, wetQ = CC_WET_RE.test(r.q);
    var aiNote = CCTV.idx ? '' : ' ตอนนี้ยังไม่มีผลจาก AI (ระบบดูภาพจะเริ่มทำงานหลังเปิดใช้) แต่กดดูภาพสดจากต้นทางได้';
    if (m && m.sites.length) {
      var s0 = m.sites[0];
      var wet = m.cams.filter(function (c) { return CC_WET.indexOf(ccLab(c.id)) >= 0; });
      var spill = m.cams.filter(function (c) { return ccLab(c.id) === 'spill'; });
      var txt = (m.cams.length === 1 ? 'กล้อง' + m.cams[0].name + ' (' + s0.name + ')' : m.label + ' มีกล้องที่ ChatGeo ดูภาพได้ ' + m.cams.length + ' ตัว') +
        (CCTV.idx ? (wet.length ? ' AI เห็นน้ำผิดปกติ ' + wet.length + ' กล้อง: ' + ccSorted(wet).slice(0, 3).map(function (c) { return c.name + ' (' + CC_L[ccLab(c.id)].t + ')'; }).join(', ')
          : ' AI ยังไม่เห็นน้ำผิดปกติ') + (spill.length ? ' และเห็นน้ำไหลผ่านทางระบายน้ำ ' + spill.length + ' มุม' : '') + ' จากภาพที่ดูเมื่อ ' + ccTime(CCTV.idx.updated) : aiNote) +
        ' AI ตัวเล็กอาจผิด กดชื่อกล้องเพื่อดูภาพจริงประกอบ';
      var prov = PID_BY_NAME[s0.prov] && byId[PID_BY_NAME[s0.prov]];
      var wall = m.sites.length === 1 ? 'site:' + s0.id : 'prov:' + s0.prov;
      return { title: 'กล้อง CCTV · ' + m.label,
        text: txt,
        html: ccBlockHtml(m.cams, m.label, wall, { showSite: m.sites.length > 1, max: 8, site: m.sites.length === 1 ? s0.id : '' }) +
          (prov && isLocalPlace(prov) && wetQ ? localHtml({ place: prov }) : '') };
    }
    if (r.place && isLocalPlace(r.place)) {
      var loc = ccLocalHtml({ place: r.place });
      var tg = floodTarget({ place: r.place }) || { provs: [] };
      var nm = tg.provs.map(function (q) { return q.name; });
      var n = ccAllCams().filter(function (c) { return nm.indexOf(CCTV.siteOf[c.id].prov) >= 0; }).length;
      return { title: 'กล้อง CCTV · ' + r.place.name,
        text: n ? r.place.name + ' มีกล้องที่ ChatGeo ดูภาพได้ ' + n + ' ตัว' + aiNote
          : 'ChatGeo ยังไม่มีกล้องที่ดึงภาพมาให้ AI ดูใน' + r.place.name + ' ตอนนี้มีที่หาดใหญ่และเขื่อน กฟผ. 10 เขื่อน ส่วนกล้องของหน่วยงานอื่นเปิดดูที่เว็บต้นทางได้ตามลิงก์ด้านล่าง',
        html: (loc || '') + (n ? '' : '<div class="m-extra"><div class="m-extra-head">กล้องทั่วประเทศ (เปิดที่เว็บต้นทาง)</div>' + ccLinksHtml([], true) + '</div>') };
    }
    var all = ccAllCams(), wetAll = all.filter(function (c) { return CC_WET.indexOf(ccLab(c.id)) >= 0; });
    if (wetQ) {
      return { title: 'กล้องที่ AI เห็นน้ำผิดปกติ',
        text: !CCTV.idx ? aiNote.trim()
          : wetAll.length ? 'จาก ' + all.length + ' กล้อง AI เห็นน้ำผิดปกติ ' + wetAll.length + ' กล้อง (ภาพที่ดูเมื่อ ' + ccTime(CCTV.idx.updated) + ') AI ตัวเล็กอาจผิด กดชื่อกล้องเพื่อดูภาพจริง'
            : 'จาก ' + all.length + ' กล้อง AI ยังไม่เห็นน้ำผิดปกติ (ภาพที่ดูเมื่อ ' + ccTime(CCTV.idx.updated) + ')',
        html: ccBlockHtml(wetAll.length ? wetAll : all, wetAll.length ? 'AI เห็นน้ำ' : 'ทุกกล้อง', wetAll.length ? 'wet' : 'all', { showSite: true, max: 8 }) };
    }
    return { title: 'กล้อง CCTV + AI (ทดลอง)',
      text: 'ChatGeo ดึงภาพจากกล้อง ' + all.length + ' ตัว (หาดใหญ่ และเขื่อน กฟผ. 10 เขื่อน) ให้ AI ดูทุกชั่วโมงว่ามีน้ำท่วม น้ำสูง หรือฝนตกไหม ' +
        'ถามชื่อพื้นที่ได้ เช่น "หาดใหญ่น้ำท่วมไหม" "เขื่อนภูมิพลเป็นยังไง" หรือ "กล้องไหนเห็นน้ำท่วม"' + aiNote,
      html: ccBlockHtml(all, 'ทุกกล้อง', 'all', { showSite: true, max: 6, links: ccLinksHtml([], true) }) };
  }
  function ccQueryOnMap(r) {
    var m = r.cam;
    if (!m || !m.sites.length || !views.chat) return false;
    if (!state.data.cctv) { state.data.cctv = true; saveData(); renderDataChips(); eachView(updateCctvMarkers); }
    if (m.sites.length === 1) { showCctvSite(m.sites[0].id); return true; }
    var b = m.sites.reduce(function (bb, s) { return [Math.min(bb[0], s.lon), Math.min(bb[1], s.lat), Math.max(bb[2], s.lon), Math.max(bb[3], s.lat)]; }, [999, 999, -999, -999]);
    views.chat.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 11, duration: reduceMotion ? 0 : 900 });
    return true;
  }
  function ccLegendHtml() {
    var n = ccAllCams().length;
    return '<div class="fl-legend cc-legend" aria-label="สีป้ายกล้อง">' + ['flood', 'high', 'watch', 'spill', 'normal', 'stale'].map(function (k) {
      return '<span><i class="cc-dot" style="background:' + CC_L[k].c + '"></i>' + CC_L[k].t + '</span>';
    }).join('') + '</div>' +
      '<div class="fl-areas"><button type="button" class="fl-go" data-cv-open="all">เปิดหน้ากล้อง ' + n + ' ตัว</button>' +
      (CCTV.idx && ccFilterCams('wet').length ? '<button type="button" class="fl-go" data-cv-open="wet">AI เห็นน้ำ ' + ccFilterCams('wet').length + ' กล้อง</button>' : '') + '</div>' +
      '<p class="fp-fine">ภาพจาก HatyaiCityClimate.Org และ กฟผ. · AI ตัวเล็กดูทุกชั่วโมง ดูแค่น้ำ ถนน อากาศ และนับรถ ไม่จดจำใบหน้า ไม่อ่านทะเบียน · ต้นแบบทดลอง</p>';
  }

  /* ---------- เรดาร์ฝน เมฆ ลม และความสูงพื้นดิน ---------- */
  // เรดาร์: RainViewer (ย้อนหลัง 2 ชม. ทุก 10 นาที ซูมสุด 7 ใช้ได้เพื่อการส่วนตัว/การศึกษา ต้องให้เครดิต)
  // เมฆ: ภาพอินฟราเรดดาวเทียม Himawari-9 จาก NASA GIBS (ช้ากว่าจริงราว 1 ชม.)
  // ลม: ตารางลมรายชั่วโมงจาก Open-Meteo ที่ GitHub Actions ดึงเก็บไว้ (cctv-data/wind.json) วาดเป็นเส้นลมเคลื่อนไหว
  // ความสูง: Terrain Tiles (Terrarium, AWS Open Data) ทำเงาภูเขา และอ่านความสูงจุดที่กด
  var RADAR_API = 'https://api.rainviewer.com/public/weather-maps.json';
  var RADAR = { host: '', frames: [], idx: -1, playing: false, timer: 0, at: 0, err: false };
  var CLOUD_LAYER = 'Himawari_AHI_Band13_Clean_Infrared';
  var DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var DEM_ATTR = 'ความสูง: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen, SRTM)';
  var WIND = { grid: null, at: 0 };
  // สีเรดาร์ Universal Blue ของ RainViewer (ใช้ทำคำอธิบายสี)
  var RADAR_LEG = [['#88DDEE', 'ปรอย'], ['#0091CA', 'เบา'], ['#004A70', 'ปานกลาง'], ['#FFC500', 'หนัก'], ['#FF4400', 'หนักมาก'], ['#C10000', 'รุนแรง'], ['#FF77FF', 'พายุ']];

  function loadRadar(force) {
    if (IN_ARTIFACT) return;
    if (!force && RADAR.frames.length && Date.now() - RADAR.at < 5 * 60e3) return;
    RADAR.at = Date.now();
    fetch(RADAR_API).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var past = (j && j.radar && j.radar.past) || [];
      if (!j.host || !past.length) throw new Error('ไม่มีภาพ');
      var keep = RADAR.idx >= 0 && RADAR.idx < RADAR.frames.length - 1 && RADAR.playing;
      RADAR.host = j.host;
      RADAR.frames = past.map(function (f) { return { time: f.time, path: f.path }; });
      if (!keep) RADAR.idx = RADAR.frames.length - 1;
      RADAR.err = false;
    }).catch(function () { RADAR.err = true; }).then(function () {
      eachView(updateRadar);
      if (CVM.ready) cvmRadar();
      renderDataChips();
    });
  }
  function radarTime(i) {
    var f = RADAR.frames[i];
    if (!f) return '';
    var d = new Date((f.time + 7 * 3600) * 1000);
    var hm = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ' น.';
    var ago = Math.round((Date.now() / 1000 - f.time) / 60);
    return hm + (ago >= 1 ? ' (' + (ago >= 60 ? Math.floor(ago / 60) + ' ชม. ' + (ago % 60 ? ago % 60 + ' นาที' : '') : ago + ' นาที') + 'ก่อน)' : '');
  }
  // เรดาร์แต่ละช่วงเวลาเป็นชั้นของตัวเอง เปิดทีละชั้น (โหลดภาพล่วงหน้าตอนเล่น)
  function radarLayerId(i) { return 'cg-radar-' + RADAR.frames[i].time; }
  function ensureRadarLayer(v, i) {
    var map = v.map, id = radarLayerId(i);
    if (map.getLayer(id)) return id;
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'raster', tiles: [RADAR.host + RADAR.frames[i].path + '/512/{z}/{x}/{y}/2/1_1.png'], tileSize: 512, maxzoom: 7,
        attribution: 'เรดาร์ฝน: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>' });
    }
    map.addLayer({ id: id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 } },
      map.getLayer('cg-flood-pf') ? 'cg-flood-pf' : undefined);
    return id;
  }
  function updateRadar(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, on = !!state.data.radar && RADAR.frames.length > 0;
    var want = {};
    if (on) {
      want[ensureRadarLayer(v, RADAR.idx)] = 1;
      if (RADAR.playing) ensureRadarLayer(v, (RADAR.idx + 1) % RADAR.frames.length);
    }
    // ลบชั้นของเวลาที่หลุดช่วง 2 ชม. แล้ว และซ่อน/แสดงตามเวลาที่เลือก
    (map.getStyle().layers || []).forEach(function (l) {
      if (l.id.indexOf('cg-radar-') !== 0) return;
      var t = +l.id.slice(9);
      if (!RADAR.frames.some(function (f) { return f.time === t; })) { map.removeLayer(l.id); if (map.getSource(l.id)) map.removeSource(l.id); return; }
      map.setPaintProperty(l.id, 'raster-opacity', want[l.id] ? 0.72 : 0);
    });
    updateRadarBar(v);
  }
  function updateRadarBar(v) {
    var bar = v.radarBar;
    var show = !!state.data.radar && RADAR.frames.length > 0;
    if (!bar) {
      if (!show) return;
      bar = v.radarBar = document.createElement('div');
      bar.className = 'wx-bar';
      bar.innerHTML = '<button type="button" class="wx-play" aria-label="เล่นเรดาร์ย้อนหลัง"></button>' +
        '<input type="range" class="wx-range" min="0" max="0" step="1" aria-label="เลือกเวลาของภาพเรดาร์">' +
        '<span class="wx-time" aria-live="off"></span>';
      mapStack(v).appendChild(bar);
      bar.querySelector('.wx-play').addEventListener('click', function () { setRadarPlaying(!RADAR.playing); });
      bar.querySelector('.wx-range').addEventListener('input', function (e) {
        setRadarPlaying(false);
        RADAR.idx = +e.target.value;
        eachView(updateRadar);
      });
    }
    bar.hidden = !show;
    if (!show) return;
    var rg = bar.querySelector('.wx-range');
    rg.max = RADAR.frames.length - 1;
    rg.value = RADAR.idx;
    bar.querySelector('.wx-play').innerHTML = RADAR.playing
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>';
    bar.querySelector('.wx-play').setAttribute('aria-label', RADAR.playing ? 'หยุดเรดาร์' : 'เล่นเรดาร์ย้อนหลัง 2 ชั่วโมง');
    bar.querySelector('.wx-time').textContent = 'เรดาร์ ' + radarTime(RADAR.idx) + (RADAR.idx === RADAR.frames.length - 1 ? ' · ล่าสุด' : '');
    if (v.stackLift) v.stackLift();
  }
  function setRadarPlaying(on) {
    RADAR.playing = !!on && !reduceMotion;
    clearInterval(RADAR.timer);
    if (RADAR.playing) {
      if (RADAR.idx >= RADAR.frames.length - 1) RADAR.idx = 0;
      RADAR.timer = setInterval(function () {
        RADAR.idx = RADAR.idx + 1;
        if (RADAR.idx >= RADAR.frames.length) RADAR.idx = 0;
        eachView(updateRadar);
        if (RADAR.idx === RADAR.frames.length - 1) setTimeout(function () { if (RADAR.playing && RADAR.idx === RADAR.frames.length - 1) setRadarPlaying(false); }, 900);
      }, 650);
    } else if (reduceMotion && on) toast('ปิดการเคลื่อนไหวในเครื่องอยู่ ใช้แถบเลื่อนเลือกเวลาแทนได้');
    eachView(updateRadar);
  }

  // เมฆ: เลือกภาพที่ GIBS น่าจะทำเสร็จแล้ว (ย้อนไปราว 70 นาที ปัดลงทีละ 10 นาที)
  function cloudTime() {
    var t = new Date(Date.now() - 70 * 60e3);
    t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
    return t.toISOString().slice(0, 19) + 'Z';
  }
  function updateCloud(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, on = !!state.data.cloud && !IN_ARTIFACT;
    var t = cloudTime();
    if (map.getLayer('cg-cloud') && (!on || v.cloudTime !== t)) { map.removeLayer('cg-cloud'); map.removeSource('cg-cloud'); }
    if (on && !map.getLayer('cg-cloud')) {
      v.cloudTime = t;
      map.addSource('cg-cloud', { type: 'raster', tileSize: 256, maxzoom: 6,
        tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + CLOUD_LAYER + '/default/' + t + '/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'],
        attribution: 'เมฆ: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> (Himawari-9, JMA)' });
      // ภาพอินฟราเรด: เมฆยอดสูง (เย็น) สว่าง พื้นดินมืด ใช้โปร่งแสงให้เห็นแผนที่ด้านล่าง
      map.addLayer({ id: 'cg-cloud', type: 'raster', source: 'cg-cloud', paint: { 'raster-opacity': 0.55, 'raster-contrast': 0.25, 'raster-brightness-min': 0 } },
        map.getLayer('cg-thr-fill') ? 'cg-thr-fill' : undefined);
    }
  }

  // ความสูงพื้นดิน: เงาภูเขา + อ่านค่าความสูงจากภาพ Terrarium (R*256 + G + B/256 − 32768 เมตร)
  function updateTerrain(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, on = !!state.data.terrain && !IN_ARTIFACT, dark = state.theme !== 'light';
    if (on && !map.getSource('cg-dem')) {
      map.addSource('cg-dem', { type: 'raster-dem', tiles: [DEM_URL], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: DEM_ATTR });
    }
    if (on && !map.getLayer('cg-hill')) {
      map.addLayer({ id: 'cg-hill', type: 'hillshade', source: 'cg-dem', paint: {
        'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': dark ? '#000814' : '#3C4A5C',
        'hillshade-highlight-color': dark ? '#5B6B82' : '#FFFFFF', 'hillshade-accent-color': dark ? '#1A2638' : '#6B7A8C'
      } }, map.getLayer('cg-thr-fill') ? 'cg-thr-fill' : undefined);
    }
    if (map.getLayer('cg-hill')) map.setLayoutProperty('cg-hill', 'visibility', on ? 'visible' : 'none');
    if (!on && v.terrain3d) setTerrain3d(v, false);
  }
  function setTerrain3d(v, on) {
    var map = v.map;
    v.terrain3d = !!on;
    if (v.kind === 'chat' && $('btnTerrain3d')) $('btnTerrain3d').setAttribute('aria-pressed', String(!!on));
    if (v.kind === 'chat' && $('btnExit3d')) $('btnExit3d').hidden = !on; // ปุ่มออกจาก 3 มิติ (ไม่มีปุ่ม 3 มิติบนแถบแล้ว เพราะซ้ำกับลูกโลกในความรู้สึกผู้ใช้)
    try {
      if (on) {
        if (!map.getSource('cg-dem')) { state.data.terrain = true; saveData(); updateTerrain(v); renderDataChips(); }
        map.setTerrain({ source: 'cg-dem', exaggeration: 1.6 });
        map.easeTo({ pitch: 62, duration: reduceMotion ? 0 : 900 });
      } else {
        map.setTerrain(null);
        map.easeTo({ pitch: 0, duration: reduceMotion ? 0 : 600 });
      }
    } catch (e) { toast('เปิดภาพ 3 มิติไม่ได้ในเบราว์เซอร์นี้'); }
  }
  var DEM_CACHE = {};
  function demTile(z, x, y) {
    var k = z + '/' + x + '/' + y;
    if (!DEM_CACHE[k]) {
      DEM_CACHE[k] = fetch(DEM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) { return createImageBitmap(b); }).then(function (bmp) {
        var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        var g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      });
      DEM_CACHE[k].catch(function () { delete DEM_CACHE[k]; });
    }
    return DEM_CACHE[k];
  }
  // ความสูงที่จุด + เทียบกับพื้นที่รอบๆ รัศมีราว 1 กม. (บอกว่าเป็นที่ลุ่มหรือที่ดอน)
  function elevationAt(lon, lat) {
    var z = 12, n = Math.pow(2, z), r = Math.PI / 180;
    var fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * n;
    var tx = Math.floor(fx), ty = Math.floor(fy);
    var px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256));
    return demTile(z, tx, ty).then(function (img) {
      function at(x, y) {
        x = Math.max(0, Math.min(255, x)); y = Math.max(0, Math.min(255, y));
        var i = (y * 256 + x) * 4, d = img.data;
        return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
      }
      var e = at(px, py);
      var mPerPx = 40075016 * Math.cos(lat * r) / (n * 256);
      var rad = Math.max(3, Math.round(1000 / mPerPx)), vals = [];
      for (var dy = -rad; dy <= rad; dy += 2) for (var dx = -rad; dx <= rad; dx += 2) if (dx * dx + dy * dy <= rad * rad) vals.push(at(px + dx, py + dy));
      vals.sort(function (a, b) { return a - b; });
      var below = vals.filter(function (x) { return x < e; }).length / vals.length;
      return { ele: e, med: vals[Math.floor(vals.length / 2)], min: vals[0], max: vals[vals.length - 1], pct: below };
    });
  }
  function eleText(o) {
    if (!o) return '';
    var d = o.ele - o.med;
    var rel = o.pct <= 0.15 ? 'ต่ำกว่าพื้นที่รอบๆ เกือบทั้งหมด (ที่ลุ่ม น้ำมักไหลมารวม)' : o.pct >= 0.85 ? 'สูงกว่าพื้นที่รอบๆ เกือบทั้งหมด (ที่ดอน)'
      : Math.abs(d) < 1 ? 'ระดับใกล้เคียงพื้นที่รอบๆ' : (d < 0 ? 'ต่ำกว่า' : 'สูงกว่า') + 'ระดับกลางของพื้นที่รอบๆ ราว ' + Math.abs(d).toFixed(d > -10 && d < 10 ? 1 : 0) + ' ม.';
    return rel;
  }
  function openElevationPopup(v, ll) {
    var box = document.createElement('div');
    box.innerHTML = '<div class="pop-meta">ความสูงพื้นดิน (ทดลอง)</div><div class="pop-title">กำลังอ่านค่าความสูง…</div>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 6, maxWidth: '280px', focusAfterOpen: false }).setLngLat(ll).setDOMContent(box).addTo(v.map);
    elevationAt(ll.lng, ll.lat).then(function (o) {
      box.innerHTML = '<div class="pop-meta">ความสูงพื้นดิน (ทดลอง) · ' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + '</div>' +
        '<div class="pop-title">ราว ' + Math.round(o.ele) + ' ม. จากระดับน้ำทะเล</div>' +
        '<div class="pop-sub">' + esc(eleText(o)) + '</div>' +
        '<div class="pop-sub">รัศมี 1 กม.: ต่ำสุด ' + Math.round(o.min) + ' · กลาง ' + Math.round(o.med) + ' · สูงสุด ' + Math.round(o.max) + ' ม.</div>' +
        '<div class="pop-sub">ค่าจากแผนที่ความสูงความละเอียดราว 30 ม. ที่ราบลุ่มอาจคลาดเคลื่อนหลายเมตร ใช้ดูภาพรวม ไม่ใช่ค่ารังวัด · ' + DEM_ATTR + '</div>' +
        '<div class="pop-acts"><button type="button" class="btn-ghost fl-go" data-site-ll="' + ll.lng.toFixed(6) + ',' + ll.lat.toFixed(6) + '">ตรวจทำเลจุดนี้</button>' +
        '<button type="button" class="btn-ghost fl-go" data-terrain3d="' + (v.terrain3d ? '0' : '1') + '">' + (v.terrain3d ? 'กลับเป็นแผนที่แบน' : 'ดูแบบ 3 มิติ') + '</button></div>';
    }).catch(function () {
      box.innerHTML = '<div class="pop-meta">ความสูงพื้นดิน</div><div class="pop-title">อ่านค่าความสูงไม่ได้ตอนนี้</div><div class="pop-sub">ลองใหม่อีกครั้ง หรือเช็กอินเทอร์เน็ต</div>';
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-terrain3d]');
    if (b && views.chat) { e.preventDefault(); setTerrain3d(views.chat, b.getAttribute('data-terrain3d') === '1'); if (views.chat.popup) views.chat.popup.remove(); }
  });

  // ลม: เส้นลมเคลื่อนไหวบน canvas ซ้อนแผนที่ (หยุดตอนเลื่อนแผนที่ เพื่อไม่ให้หน่วง)
  function loadWind() {
    if (IN_ARTIFACT || (WIND.grid && Date.now() - WIND.at < 20 * 60e3)) return;
    WIND.at = Date.now();
    fetch(CCTV_BASE + 'wind.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      if (j && j.nx && j.ny && j.u && j.u.length === j.nx * j.ny) WIND.grid = j;
    }).catch(function () { /* ไม่มีข้อมูลลม ข้ามไป */ }).then(function () { eachView(updateWind); if (CVM.v) { updateWind(CVM.v); cvmLegend(); } renderDataChips(); });
  }
  function windAt(lon, lat) {
    var g = WIND.grid;
    var fx = (lon - g.lon0) / g.dx, fy = (lat - g.lat0) / g.dy;
    if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return null;
    var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    function bl(a) {
      var i00 = y0 * g.nx + x0, i10 = y0 * g.nx + x1, i01 = y1 * g.nx + x0, i11 = y1 * g.nx + x1;
      return (a[i00] * (1 - ax) + a[i10] * ax) * (1 - ay) + (a[i01] * (1 - ax) + a[i11] * ax) * ay;
    }
    return [bl(g.u), bl(g.v)];
  }
  function windColor(s) {
    return s < 2 ? 'rgba(170,205,235,.55)' : s < 5 ? 'rgba(130,215,235,.7)' : s < 9 ? 'rgba(240,235,150,.8)' : s < 14 ? 'rgba(250,170,90,.85)' : 'rgba(255,110,110,.9)';
  }
  function windWanted(v) { return (v.kind === 'cvm' ? CVM.wind && state.page === 'cctv' && CV.mode === 'map' : !!state.data.wind) && !!WIND.grid; }
  function updateWind(v) {
    if (!v || (v.kind !== 'chat' && v.kind !== 'cvm')) return;
    var on = windWanted(v);
    if (!on) { if (v.wind) { cancelAnimationFrame(v.wind.raf); v.wind.cv.remove(); v.wind = null; } updateWindNote(v); return; }
    if (!v.wind) {
      var cv = document.createElement('canvas');
      cv.className = 'wx-wind';
      v.map.getCanvasContainer().appendChild(cv);
      v.wind = { cv: cv, ps: [], raf: 0, moving: false };
      v.map.on('movestart', function () { if (v.wind) { v.wind.moving = true; v.wind.cv.getContext('2d').clearRect(0, 0, v.wind.cv.width, v.wind.cv.height); } });
      v.map.on('moveend', function () { if (v.wind) { v.wind.moving = false; seedWind(v); } });
      v.map.on('resize', function () { if (v.wind) seedWind(v); });
      seedWind(v);
      windLoop(v);
    }
    updateWindNote(v);
  }
  function updateWindNote(v) {
    if (v.kind === 'cvm') return; // มุมมองแผนที่กล้องบอกเวลาลมในคำอธิบายสีแทน
    var el = v.windNote;
    var on = windWanted(v);
    if (!el && !on) return;
    if (!el) { el = v.windNote = document.createElement('div'); el.className = 'wx-wind-note'; v.el.appendChild(el); }
    el.hidden = !on;
    if (on) el.textContent = 'ลม ' + (WIND.grid.time ? ccTime(WIND.grid.time) : '') + ' · Open-Meteo';
  }
  function seedWind(v) {
    var w = v.wind, cv = w.cv, c = v.map.getCanvas();
    var dpr = window.devicePixelRatio || 1;
    cv.width = c.clientWidth * dpr; cv.height = c.clientHeight * dpr;
    cv.style.width = c.clientWidth + 'px'; cv.style.height = c.clientHeight + 'px';
    var n = Math.max(250, Math.min(1800, Math.round(c.clientWidth * c.clientHeight / 1100)));
    w.ps = [];
    for (var i = 0; i < n; i++) w.ps.push(newParticle(v, true));
  }
  function newParticle(v, rnd) {
    var c = v.map.getCanvas();
    return { x: Math.random() * c.clientWidth, y: Math.random() * c.clientHeight, age: rnd ? Math.floor(Math.random() * 80) : 0 };
  }
  function windLoop(v) {
    var w = v.wind;
    if (!w) return;
    w.raf = requestAnimationFrame(function () { windLoop(v); });
    if (w.moving || document.hidden) return;
    var g = w.cv.getContext('2d'), dpr = window.devicePixelRatio || 1, map = v.map;
    var c = map.getCanvas(), W = c.clientWidth, H = c.clientHeight;
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.93)';
    g.fillRect(0, 0, w.cv.width, w.cv.height);
    g.restore();
    g.lineWidth = 1.2 * dpr;
    g.lineCap = 'round';
    var z = map.getZoom(), k = 0.22 * Math.pow(1.25, Math.max(0, 7 - z)) / Math.pow(2, Math.max(0, z - 7));
    w.ps.forEach(function (p, i) {
      var ll = map.unproject([p.x, p.y]);
      var uv = windAt(ll.lng, ll.lat);
      if (!uv || p.age > 90 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) { w.ps[i] = newParticle(v, false); return; }
      var s = Math.sqrt(uv[0] * uv[0] + uv[1] * uv[1]);
      var nx = p.x + uv[0] * k * 6, ny = p.y - uv[1] * k * 6;
      g.strokeStyle = windColor(s);
      g.beginPath(); g.moveTo(p.x * dpr, p.y * dpr); g.lineTo(nx * dpr, ny * dpr); g.stroke();
      p.x = nx; p.y = ny; p.age++;
    });
  }
  function wxLegendHtml() {
    var h = '';
    if (state.data.radar) {
      h += '<div class="rain-legend wx-legend" aria-label="สีเรดาร์ฝน"><span>เรดาร์</span><span class="sp"></span>' + RADAR_LEG.map(function (x) {
        return '<i title="' + x[1] + '" style="background:' + x[0] + '"></i>';
      }).join('') + '<span>เบา → หนัก</span></div>';
      h += '<p class="fp-fine">' + (RADAR.err ? 'โหลดเรดาร์ไม่ได้ตอนนี้ · ' : RADAR.frames.length ? 'ย้อนหลัง 2 ชม. ทุก 10 นาที กดปุ่มเล่นที่ด้านล่างแผนที่ · ' : '') +
        'เรดาร์ครอบเฉพาะพื้นที่ที่มีสถานีเรดาร์ ซูมได้ถึงระดับจังหวัด · <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a></p>';
    }
    if (state.data.terrain) h += '<p class="fp-fine">ความสูงพื้นดิน: กดจุดใดก็ได้บนแผนที่เพื่อดูความสูงและเทียบกับพื้นที่รอบๆ (ที่ลุ่ม/ที่ดอน) · ดูแบบ 3 มิติได้จากป๊อปอัป</p>';
    return h;
  }

  // แชท: เรดาร์ ลม ความสูง และวิธีใช้งาน
  var RADAR_RE = /เรดาร์|กลุ่มฝน|กลุ่มเมฆ|เมฆฝน|ฝนตก(ตรง|ที่)ไหน|ฝนกำลังตก|ตอนนี้ฝนตก|radar/i;
  var ELE_RE = /ความสูง(พื้น|จาก|ของ)|ระดับน้ำทะเล|ที่ลุ่ม|ที่ดอน|elevation|3 ?มิติ/i;
  var WIND_RE = /ลมแรง|ลมพัด|ทิศลม|ความเร็วลม|ทิศทางลม/;
  var HELP_RE = /วิธีใช้|ใช้งานยังไง|ใช้ยังไง|ทำอะไรได้บ้าง|help/i;
  function wxOn(id) {
    if (!state.data[id]) { state.data[id] = true; saveData(); eachView(refreshLive); renderDataChips(); }
  }
  function wxAnswer(r) {
    var loc = r.place && isLocalPlace(r.place) ? localHtml({ place: r.place }) : '';
    if (r.wx === 'help') {
      return { title: 'วิธีใช้งาน ChatGeo', text: 'เปิดหน้าวิธีใช้งานให้แล้ว อ่านทีละหัวข้อได้เลย หรือกดปุ่ม "วิธีใช้" มุมขวาบนเมื่อไรก็ได้' };
    }
    if (r.wx === 'radar') {
      var t = RADAR.frames.length ? 'ภาพล่าสุด ' + radarTime(RADAR.frames.length - 1) : (RADAR.err ? 'ตอนนี้โหลดเรดาร์ไม่ได้' : 'กำลังโหลดเรดาร์');
      return { title: 'เรดาร์ฝน · กลุ่มฝนตอนนี้', extra: 'weather', html: loc,
        text: 'เปิดเรดาร์ฝนบนแผนที่แล้ว (' + t + ') สีฟ้าคือฝนเบา เหลือง ส้ม แดง คือฝนหนัก กดปุ่มเล่นที่มุมซ้ายล่างของแผนที่เพื่อดูกลุ่มฝนเคลื่อนที่ย้อนหลัง 2 ชม. ' +
          'เรดาร์บอกว่าฝนตกตรงไหนตอนนี้ ส่วนตัวเลขฝนสะสม 24 ชม. ด้านล่างมาจากสถานีวัดจริงของ ThaiWater' };
    }
    if (r.wx === 'terrain') {
      return { title: 'ความสูงพื้นดิน', html: loc,
        text: 'เปิดความสูงพื้นดินแล้ว กดจุดใดก็ได้บนแผนที่ จะบอกความสูงจากระดับน้ำทะเล และเทียบกับพื้นที่รอบๆ รัศมี 1 กม. ว่าเป็นที่ลุ่ม (น้ำมักไหลมารวม) หรือที่ดอน ' +
          'ในป๊อปอัปมีปุ่มดูแบบ 3 มิติ ค่ามาจากแผนที่ความสูงราว 30 ม. ที่ราบลุ่มอาจคลาดเคลื่อนหลายเมตร' };
    }
    var g = WIND.grid, sp = '';
    if (g) {
      var s = g.u.map(function (u, i) { return Math.sqrt(u * u + g.v[i] * g.v[i]); });
      sp = ' ลมแรงสุดในพื้นที่ราว ' + Math.max.apply(null, s).toFixed(1) + ' ม./วินาที (' + ccTime(g.time) + ')';
    }
    return { title: 'ลมตอนนี้', html: loc,
      text: 'เปิดเส้นลมบนแผนที่แล้ว เส้นเคลื่อนตามทิศที่ลมพัดไป สีฟ้าคือลมเบา เหลือง ส้ม แดง คือลมแรง' + (sp ? sp : ' (ข้อมูลลมจะมาเมื่อระบบรายชั่วโมงทำงาน)') + ' · Open-Meteo' };
  }

  // หน้าต่าง "วิธีใช้งาน"
  var helpOpener = null;
  function openHelp() {
    if (!$('helpModal')) return;
    helpOpener = document.activeElement;
    $('helpModal').hidden = false;
    setTimeout(function () { var b = $('helpModal').querySelector('.pal-x'); if (b) b.focus(); }, 0);
  }
  function closeHelp() {
    if (!$('helpModal') || $('helpModal').hidden) return;
    $('helpModal').hidden = true;
    if (helpOpener && helpOpener.focus) helpOpener.focus();
  }
  if ($('btnHelp')) $('btnHelp').addEventListener('click', openHelp);
  if ($('helpModal')) {
    $('helpModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-help-close]')) { closeHelp(); return; }
      var q = e.target.closest('[data-help-q]');
      if (q) { closeHelp(); if (state.page !== 'chat') setPage('chat'); submitQuestion(q.getAttribute('data-help-q')); return; }
      var a = e.target.closest('.help-toc a');
      if (a) { e.preventDefault(); var t = $(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('helpModal').hidden) { e.preventDefault(); closeHelp(); } });
  }

  /* ---------- ตรวจทำเล: น้ำในอดีต 41 ปี + แบบจำลองน้ำท่วมใหญ่ + ความสูง + ผังเมือง ---------- */
  // น้ำในอดีต: JRC Global Surface Water (Landsat 1984–2024) ภาพสำเร็จรูป ซูมได้ถึงระดับ 13 (ราว 19 ม./จุด)
  var GSW_URL = 'https://storage.googleapis.com/water-world/tiles2024/';
  var GSW_ATTR = 'น้ำในอดีต: <a href="https://global-surface-water.appspot.com/" target="_blank" rel="noopener">Source: EC JRC/Google</a> (Landsat 1984–2024)';
  var GSW_Z = 13;
  // สีของชั้น transitions (เทียบปีแรกกับปีล่าสุด) อ่านจากภาพจริงของ JRC แล้วจับคู่สีที่ใกล้สุด
  var GSW_TR = [
    { k: 'perm', c: [0, 0, 221], t: 'แหล่งน้ำถาวร (แม่น้ำ คลอง บ่อ อ่าง)' },
    { k: 'newperm', c: [34, 177, 76], t: 'กลายเป็นแหล่งน้ำถาวรในช่วงหลัง เช่น บ่อหรืออ่างที่ขุดใหม่' },
    { k: 'lostperm', c: [147, 7, 62], t: 'เคยเป็นแหล่งน้ำถาวร ตอนนี้แห้งหรือถูกถมแล้ว' },
    { k: 'seas', c: [153, 217, 234], t: 'มีน้ำตามฤดูกาลแทบทุกปี เช่น ทุ่งรับน้ำ นาที่น้ำขัง' },
    { k: 'newseas', c: [181, 230, 29], t: 'เริ่มมีน้ำตามฤดูกาลในช่วงหลัง' },
    { k: 'lostseas', c: [235, 180, 187], t: 'เคยมีน้ำตามฤดูกาล ตอนนี้ไม่มีแล้ว (อาจถูกถมหรือมีคันกั้น)' },
    { k: 'seas2perm', c: [255, 139, 55], t: 'จากน้ำตามฤดูกาล กลายเป็นแหล่งน้ำถาวร' },
    { k: 'perm2seas', c: [255, 221, 102], t: 'จากแหล่งน้ำถาวร กลายเป็นน้ำตามฤดูกาล' },
    { k: 'ephperm', c: [127, 127, 127], t: 'เคยมีน้ำขังนานช่วงหนึ่งแล้วหายไป' },
    { k: 'ephseas', c: [172, 172, 172], t: 'เคยมีน้ำเป็นครั้งคราวบางปี (มักเป็นน้ำท่วม)' }
  ];
  var GSW_PERM = { perm: 1, newperm: 1, seas2perm: 1 };
  var GSW_FILLED = { lostperm: 1, lostseas: 1 };
  // แบบจำลองน้ำท่วมจากแม่น้ำ: JRC GloFAS flood hazard v2.1 (90 ม.) อ่านไฟล์ COG ทีละส่วนจาก Source Cooperative
  var GLOFAS_BASE = 'https://data.source.coop/nlebovits/jrc-glofas/';
  var GLOFAS_TILES = ['ID200_N30_E90', 'ID201_N20_E90', 'ID202_N10_E90', 'ID209_N30_E100', 'ID210_N20_E100', 'ID211_N10_E100'];
  var GLOFAS_ATTR = 'แบบจำลองน้ำท่วม: <a href="https://source.coop/nlebovits/jrc-glofas" target="_blank" rel="noopener">European Union, 2016-2021, GloFAS</a> (CC BY 4.0)';
  var GLOFAS_RP = [10, 20, 50, 100, 500];
  // ชั้นความลึกในไฟล์ของ JRC (ตรวจจากไฟล์ความลึกจริง): 1 = 0.1–1 ม., 2 = 1–3 ม., 3 ขึ้นไป = มากกว่า 3 ม.
  var HAZ_T = { 1: 'ลึกไม่เกิน 1 ม.', 2: 'ลึก 1–3 ม.', 3: 'ลึกเกิน 3 ม.', 4: 'ลึกเกิน 3 ม.' };
  var HAZ_RGBA = { 1: [173, 140, 245, 150], 2: [128, 82, 224, 185], 3: [84, 40, 176, 215], 4: [84, 40, 176, 215] };
  var HAZ = { err: false };
  // ผังเมืองรวม: แสดงภาพจากเซิร์ฟเวอร์ของกรมโยธาธิการและผังเมืองตรงๆ ไม่คัดลอกข้อมูลมาเก็บ
  var ZONE_SVC = 'https://onedpt.dpt.go.th/arcgis/rest/services/TOWNPLAN/CPLLU_NON/MapServer';
  var ZONE_ATTR = 'ผังเมือง: <a href="https://plludds.dpt.go.th/landuse/" target="_blank" rel="noopener">กรมโยธาธิการและผังเมือง</a> (ใช้อ้างอิงทางกฎหมายไม่ได้)';
  var ZONE_MINZ = 11;
  // บริการนี้ (ตรวจจาก ?f=pjson 8 ต.ค. 2569) มีเฉพาะร่างผังเมืองรวมจังหวัดที่กำลังทำ/รับฟังความเห็น 2 จังหวัด
  // ทุกชั้นปิดไว้เป็นค่าเริ่มต้น จึงต้องระบุชั้นเอง: "แผนผังแสดงการใช้ประโยชน์ที่ดินอนาคต" ทุกขั้น (ปิดประกาศ 15/30/90 วัน) ของทุกฉบับ
  var ZONE_LU = [6, 21, 36, 55, 70, 85, 105, 120, 135, 154, 169, 184];
  var ZONE_FLOOD = [18, 33, 48, 67, 82, 97, 117, 132, 147, 166, 181, 196]; // "พื้นที่เสี่ยงอุทกภัย" ในแผนผังน้ำของร่างผัง
  var ZONE_PROVS = ['phetchaburi', 'saraburi'];
  var ZONE = { ok: false, err: false, legend: null, legendTried: false, outside: false };
  function zoneProvBox() {
    if (ZONE.box !== undefined) return ZONE.box;
    var bb = null;
    ZONE_PROVS.forEach(function (id) {
      var f = PROV_FEAT[id];
      if (!f) return;
      (function walk(c) { if (typeof c[0] === 'number') { bb = bb || [c[0], c[1], c[0], c[1]]; bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); } else c.forEach(walk); })(f.geometry.coordinates);
    });
    ZONE.box = bb;
    return bb;
  }
  function zoneCovers(lon, lat) { return ZONE_PROVS.indexOf(provinceAt(lon, lat)) >= 0; }
  // สีมาตรฐานของผังเมืองรวมแบบคร่าวๆ (ไม่ใช่ค่าสีทางการ) ใช้อธิบาย ส่วนสีจริงบนแผนที่มาจากเซิร์ฟเวอร์กรมโยธาฯ
  var ZONE_LEG = [
    ['#FFE15A', 'ย.1–ย.4 สีเหลือง', 'ที่อยู่อาศัยหนาแน่นน้อย บ้านเดี่ยวเป็นหลัก'],
    ['#FF9F3F', 'ย.5–ย.7 สีส้ม', 'ที่อยู่อาศัยหนาแน่นปานกลาง ทาวน์เฮาส์ อาคารชุดขนาดกลาง'],
    ['#A86A3D', 'ย.8–ย.10 สีน้ำตาล', 'ที่อยู่อาศัยหนาแน่นมาก ในเมือง ใกล้ระบบขนส่ง'],
    ['#E5484D', 'พ. สีแดง', 'พาณิชยกรรม ร้านค้า สำนักงาน ศูนย์กลางเมือง'],
    ['#8E5BC4', 'อ. สีม่วง', 'อุตสาหกรรม'],
    ['#D9A2E0', 'คลังสินค้า สีเม็ดมะปราง', 'คลังสินค้าและโลจิสติกส์'],
    ['#7CC56B', 'ก. สีเขียว', 'ชนบทและเกษตรกรรม'],
    ['hatch', 'ก. ขาวลายเขียว', 'อนุรักษ์ชนบทและเกษตรกรรม (มักเป็นทางระบายน้ำ ฟลัดเวย์)'],
    ['#C9A27E', 'ศ. สีน้ำตาลอ่อน', 'อนุรักษ์เพื่อส่งเสริมเอกลักษณ์ศิลปวัฒนธรรมไทย'],
    ['#3B6FD6', 'ส. สีน้ำเงิน', 'สถาบันราชการ สาธารณูปโภค']
  ];
  var NOMI = 'https://nominatim.openstreetmap.org/';
  var SITE = { pick: false, cur: null, res: {}, marker: null, pickMsg: null };

  // ---------- อ่านไฟล์ GeoTIFF แบบ COG ทีละส่วนผ่าน HTTP Range (ไม่ต้องโหลดทั้งไฟล์) ----------
  // รองรับ TIFF ปกติ แบ่งเป็นช่อง (tile) บีบอัด DEFLATE หรือไม่บีบอัด predictor 1/2/3 ภาพมีภาพย่อ (overview) ในไฟล์เดียวกัน
  var COG_OPEN = {}, COG_BLOCKS = new Map(), COG_BLOCK_MAX = 40;
  function rangeGet(url, a, b) {
    return fetch(url, { headers: { Range: 'bytes=' + a + '-' + b } }).then(function (r) {
      if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer().then(function (buf) { return r.status === 200 && buf.byteLength > b - a + 1 ? buf.slice(a, b + 1) : buf; });
    });
  }
  function cogOpen(url) {
    if (COG_OPEN[url]) return COG_OPEN[url];
    var p = (async function () {
      var hdr = new Uint8Array(await rangeGet(url, 0, 16383));
      async function need(end) { // ขยายส่วนหัวที่โหลดไว้ให้ครอบถึงตำแหน่ง end
        if (end <= hdr.length) return;
        var more = new Uint8Array(await rangeGet(url, hdr.length, Math.max(end, hdr.length * 2) - 1));
        var n = new Uint8Array(hdr.length + more.length); n.set(hdr); n.set(more, hdr.length); hdr = n;
      }
      function dv() { return new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength); }
      var le = hdr[0] === 0x49;
      if (dv().getUint16(2, le) !== 42) throw new Error('ไม่ใช่ TIFF ปกติ');
      var SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4, 11: 4, 12: 8, 16: 8 };
      async function values(type, count, at) {
        var size = (SZ[type] || 1) * count;
        await need(at + size);
        var d = dv(), out = [];
        if (type === 2) return new TextDecoder().decode(hdr.subarray(at, at + count)).replace(/\0+$/, '');
        for (var i = 0; i < count; i++) {
          var o = at + i * SZ[type];
          out.push(type === 3 ? d.getUint16(o, le) : type === 4 ? d.getUint32(o, le) : type === 12 ? d.getFloat64(o, le) :
            type === 1 || type === 7 ? d.getUint8(o) : type === 8 ? d.getInt16(o, le) : type === 9 ? d.getInt32(o, le) : type === 11 ? d.getFloat32(o, le) : 0);
        }
        return out;
      }
      var levels = [], off = dv().getUint32(4, le), geo = null, nodata = null;
      while (off && levels.length < 16) {
        await need(off + 2);
        var n = dv().getUint16(off, le), T = {};
        await need(off + 2 + n * 12 + 4);
        for (var i = 0; i < n; i++) {
          var e = off + 2 + i * 12, d = dv();
          var tag = d.getUint16(e, le), type = d.getUint16(e + 2, le), cnt = d.getUint32(e + 4, le);
          var inl = (SZ[type] || 1) * cnt <= 4;
          T[tag] = await values(type, cnt, inl ? e + 8 : d.getUint32(e + 8, le));
        }
        var next = dv().getUint32(off + 2 + n * 12, le);
        var sub = T[254] ? T[254][0] : 0;
        if (!(sub & 4) && T[322] && T[324]) { // ข้ามภาพหน้ากาก (mask)
          levels.push({ w: T[256][0], h: T[257][0], tw: T[322][0], th: T[323][0], bps: (T[258] || [8])[0], comp: (T[259] || [1])[0],
            pred: (T[317] || [1])[0], sf: (T[339] || [1])[0], offsets: T[324], counts: T[325] });
          if (!geo && T[33550] && T[33922]) {
            var s = T[33550], tp = T[33922];
            geo = { x0: tp[3] - tp[0] * s[0], y0: tp[4] + tp[1] * s[1], sx: s[0], sy: s[1] };
          }
          if (nodata == null && T[42113] != null) nodata = parseFloat(T[42113]);
        }
        off = next;
      }
      if (!levels.length || !geo) throw new Error('ไฟล์ไม่มีข้อมูลพิกัด');
      var W = levels[0].w * geo.sx, H = levels[0].h * geo.sy;
      levels.forEach(function (L) { L.rx = W / L.w; L.ry = H / L.h; L.nx = Math.ceil(L.w / L.tw); });
      return { url: url, levels: levels, west: geo.x0, north: geo.y0, east: geo.x0 + W, south: geo.y0 - H, nodata: nodata };
    })();
    COG_OPEN[url] = p;
    p.catch(function () { delete COG_OPEN[url]; });
    return p;
  }
  function inflate(u8) {
    var ds = new DecompressionStream('deflate');
    return new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unpredict(b, L) {
    var w = L.tw, h = L.th, by = L.bps / 8, r, i, o;
    if (L.pred === 2) { // ผลต่างตามแนวนอน: บวกสะสมทีละค่า (ตามขนาดข้อมูล 8/16/32 บิต)
      var a = by === 1 ? b : by === 2 ? new Uint16Array(b.buffer, b.byteOffset, w * h) : new Uint32Array(b.buffer, b.byteOffset, w * h);
      var mask = by === 1 ? 255 : by === 2 ? 65535 : 0;
      for (r = 0; r < h; r++) {
        o = r * w;
        for (i = 1; i < w; i++) a[o + i] = by === 4 ? (a[o + i] + a[o + i - 1]) >>> 0 : (a[o + i] + a[o + i - 1]) & mask;
      }
    } else if (L.pred === 3) { // floating point predictor (แยกไบต์ตามลำดับความสำคัญ แล้วบวกสะสม)
      var rowB = w * by, out = new Uint8Array(b.length);
      for (r = 0; r < h; r++) {
        o = r * rowB;
        for (i = 1; i < rowB; i++) b[o + i] = (b[o + i] + b[o + i - 1]) & 255;
        for (var c = 0; c < w; c++) for (var k = 0; k < by; k++) out[o + c * by + k] = b[o + (by - k - 1) * w + c];
      }
      b = out;
    } else if (L.pred !== 1) throw new Error('predictor ' + L.pred);
    if (L.sf === 3 && by === 4) return new Float32Array(b.buffer, b.byteOffset, w * h);
    if (by === 1) return b;
    if (by === 2) return L.sf === 2 ? new Int16Array(b.buffer, b.byteOffset, w * h) : new Uint16Array(b.buffer, b.byteOffset, w * h);
    throw new Error('ชนิดข้อมูลที่ยังไม่รองรับ');
  }
  function cogBlock(cog, li, tx, ty) {
    var L = cog.levels[li], idx = ty * L.nx + tx, key = cog.url + '|' + li + '|' + idx;
    var hit = COG_BLOCKS.get(key);
    if (hit) { COG_BLOCKS.delete(key); COG_BLOCKS.set(key, hit); return hit; }
    var p = (async function () {
      var off = L.offsets[idx], n = L.counts[idx];
      if (!n) return null; // ช่องว่าง = ไม่มีข้อมูลทั้งช่อง
      var raw = new Uint8Array(await rangeGet(cog.url, off, off + n - 1));
      var bytes = L.comp === 8 || L.comp === 32946 ? await inflate(raw) : L.comp === 1 ? raw : null;
      if (!bytes) throw new Error('การบีบอัดแบบ ' + L.comp + ' ยังไม่รองรับ');
      return unpredict(bytes, L);
    })();
    COG_BLOCKS.set(key, p);
    if (COG_BLOCKS.size > COG_BLOCK_MAX) COG_BLOCKS.delete(COG_BLOCKS.keys().next().value);
    p.catch(function () { COG_BLOCKS.delete(key); });
    return p;
  }
  // ค่าที่จุด (ความละเอียดเต็ม) และค่ามากสุดในรัศมี rad ช่อง (ไม่นับ nodata)
  async function cogPoint(cog, lon, lat, rad) {
    var L = cog.levels[0];
    var cx = Math.floor((lon - cog.west) / L.rx), cy = Math.floor((cog.north - lat) / L.ry);
    if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return null;
    rad = rad || 0;
    var want = {};
    for (var y = cy - rad; y <= cy + rad; y++) for (var x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
      var k = Math.floor(x / L.tw) + ',' + Math.floor(y / L.th);
      (want[k] = want[k] || []).push([x, y]);
    }
    var v = null, max = null, nod = cog.nodata;
    await Promise.all(Object.keys(want).map(function (k) {
      var t = k.split(',').map(Number);
      return cogBlock(cog, 0, t[0], t[1]).then(function (blk) {
        want[k].forEach(function (p) {
          var val = blk ? blk[(p[1] - t[1] * L.th) * L.tw + (p[0] - t[0] * L.tw)] : nod;
          if (val === nod || val !== val) return;
          if (p[0] === cx && p[1] === cy) v = val;
          if (max == null || val > max) max = val;
        });
      });
    }));
    return { v: v, max: max };
  }
  // วาดภาพขนาด size×size สำหรับกรอบแผนที่ z/x/y (Web Mercator) จากไฟล์ COG หลายไฟล์ (พิกัดองศา) เลือกภาพย่อที่พอดี
  async function cogRender(cogs, z, x, y, size, colorOf) {
    var n = Math.pow(2, z), west = x / n * 360 - 180, east = (x + 1) / n * 360 - 180;
    function latOf(yy) { var a = Math.PI * (1 - 2 * yy / n); return 180 / Math.PI * Math.atan(Math.sinh(a)); }
    var north = latOf(y), south = latOf(y + 1), px = (east - west) / size;
    var lons = [], lats = [], i, j;
    for (i = 0; i < size; i++) lons.push(west + (i + 0.5) * px);
    for (j = 0; j < size; j++) lats.push(latOf(y + (j + 0.5) / size));
    var rgba = new Uint8ClampedArray(size * size * 4), any = false;
    await Promise.all(cogs.map(async function (cog) {
      if (cog.east <= west || cog.west >= east || cog.north <= south || cog.south >= north) return;
      var li = 0;
      for (var k = 1; k < cog.levels.length; k++) if (cog.levels[k].rx <= px * 1.01) li = k;
      var L = cog.levels[li], cols = [], rows = [], need = {};
      for (i = 0; i < size; i++) { var c = Math.floor((lons[i] - cog.west) / L.rx); cols.push(c >= 0 && c < L.w ? c : -1); }
      for (j = 0; j < size; j++) { var r = Math.floor((cog.north - lats[j]) / L.ry); rows.push(r >= 0 && r < L.h ? r : -1); }
      var cTiles = {}, rTiles = {};
      cols.forEach(function (c) { if (c >= 0) cTiles[Math.floor(c / L.tw)] = 1; });
      rows.forEach(function (r) { if (r >= 0) rTiles[Math.floor(r / L.th)] = 1; });
      var blocks = {};
      await Promise.all([].concat.apply([], Object.keys(rTiles).map(function (ty) {
        return Object.keys(cTiles).map(function (tx) {
          return cogBlock(cog, li, +tx, +ty).then(function (b) { blocks[tx + ',' + ty] = b; });
        });
      })));
      for (j = 0; j < size; j++) {
        var rr = rows[j];
        if (rr < 0) continue;
        var ty2 = Math.floor(rr / L.th), ry = rr - ty2 * L.th;
        for (i = 0; i < size; i++) {
          var cc = cols[i];
          if (cc < 0) continue;
          var tx2 = Math.floor(cc / L.tw), blk = blocks[tx2 + ',' + ty2];
          if (!blk) continue;
          var val = blk[ry * L.tw + (cc - tx2 * L.tw)];
          if (val === cog.nodata || val !== val) continue;
          var col = colorOf(val);
          if (!col) continue;
          var o = (j * size + i) * 4;
          rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = col[3];
          any = true;
        }
      }
    }));
    return any ? rgba : null;
  }
  // ---------- น้ำในอดีต: อ่านค่าจากภาพของ JRC ที่จุด ----------
  var GSW_CACHE = {};
  function gswTile(layer, x, y) {
    var k = layer + '/' + x + '/' + y;
    if (!GSW_CACHE[k]) {
      GSW_CACHE[k] = fetch(GSW_URL + layer + '/' + GSW_Z + '/' + x + '/' + y + '.png').then(function (r) {
        if (r.status === 404 || r.status === 403) return null; // ไม่มีภาพ = ไม่เคยพบน้ำทั้งกรอบ
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob().then(function (b) { return createImageBitmap(b, { premultiplyAlpha: 'none' }).catch(function () { return createImageBitmap(b); }); }).then(function (bmp) {
          var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
          return { w: bmp.width, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
        });
      });
      GSW_CACHE[k].catch(function () { delete GSW_CACHE[k]; });
    }
    return GSW_CACHE[k];
  }
  function gswClass(r, g, b) {
    var best = null, bd = 1e9;
    GSW_TR.forEach(function (t) { var d = (t.c[0] - r) * (t.c[0] - r) + (t.c[1] - g) * (t.c[1] - g) + (t.c[2] - b) * (t.c[2] - b); if (d < bd) { bd = d; best = t.k; } });
    return best;
  }
  // อ่านที่จุด + รัศมี 300 ม.: occurrence (ความถี่ที่มีน้ำ %) จากความทึบของสี, transitions (ประเภท), recurrence (% ของปีที่น้ำกลับมา)
  function gswAt(lon, lat) {
    var n = Math.pow(2, GSW_Z) * 256, r = Math.PI / 180;
    var fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * n;
    var cx = Math.floor(fx), cy = Math.floor(fy);
    var mpp = 40075016 * Math.cos(lat * r) / n, R = Math.ceil(300 / mpp);
    var keys = [];
    for (var ty = Math.floor((cy - R) / 256); ty <= Math.floor((cy + R) / 256); ty++) {
      for (var tx = Math.floor((cx - R) / 256); tx <= Math.floor((cx + R) / 256); tx++) keys.push([tx, ty]);
    }
    return Promise.all(keys.map(function (t) {
      return Promise.all(['occurrence', 'transitions', 'recurrence'].map(function (l) { return gswTile(l, t[0], t[1]); }));
    })).then(function (arr) {
      var T = {};
      keys.forEach(function (t, i) { T[t[0] + '/' + t[1]] = arr[i]; });
      function px(li, gx, gy) {
        var tx2 = Math.floor(gx / 256), ty2 = Math.floor(gy / 256), im = T[tx2 + '/' + ty2] && T[tx2 + '/' + ty2][li];
        if (!im) return null;
        var i = ((gy - ty2 * 256) * im.w + (gx - tx2 * 256)) * 4;
        return im.d[i + 3] ? [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]] : null;
      }
      var o = px(0, cx, cy), t = px(1, cx, cy), q = px(2, cx, cy);
      var res = { occ: o ? Math.round(o[3] / 2.55) : 0, tr: t ? gswClass(t[0], t[1], t[2]) : null,
        rec: q ? Math.max(0, Math.min(100, Math.round((255 - q[0]) / 102 * 100))) : null,
        histNear: null, permNear: null, filledNear: null, occMax100: 0, wet: 0, n: 0, hist: 0, filled: 0 };
      for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
        var dm = Math.sqrt(dx * dx + dy * dy) * mpp;
        if (dm > 300) continue;
        res.n++;
        var tc = px(1, cx + dx, cy + dy);
        if (!tc) continue;
        res.wet++;
        var k = gswClass(tc[0], tc[1], tc[2]);
        if (GSW_PERM[k]) { if (res.permNear == null || dm < res.permNear) res.permNear = dm; }
        else {
          res.hist++;
          if (res.histNear == null || dm < res.histNear) res.histNear = dm;
          if (GSW_FILLED[k]) { res.filled++; if (res.filledNear == null || dm < res.filledNear) res.filledNear = dm; }
        }
        if (dm <= 100) { var oc = px(0, cx + dx, cy + dy); if (oc && !GSW_PERM[k]) res.occMax100 = Math.max(res.occMax100, Math.round(oc[3] / 2.55)); }
      }
      res.fHist = res.n ? res.hist / res.n : 0;     // สัดส่วนพื้นที่ในรัศมี 300 ม. ที่เคยมีน้ำท่วม/ขัง (ไม่นับแหล่งน้ำถาวร)
      res.fFilled = res.n ? res.filled / res.n : 0; // สัดส่วนที่เคยเป็นที่น้ำขังแล้วแห้งหรือถูกถม
      return res;
    });
  }
  function gswLevel(g) {
    if (!g) return null;
    if (g.tr && GSW_PERM[g.tr]) return { lv: 'water', s: 0, t: 'จุดนี้เป็นแหล่งน้ำ' };
    if (g.tr) {
      if (g.occ >= 25 || g.tr === 'seas' || g.tr === 'perm2seas' || g.tr === 'newseas') return { lv: 'often', s: 3, t: 'มีน้ำขังบ่อย' };
      return { lv: 'some', s: 2, t: 'เคยมีน้ำท่วมหรือน้ำขัง' };
    }
    if (g.occ > 0) return { lv: 'some', s: 2, t: 'เคยมีน้ำท่วมหรือน้ำขัง' };
    if (g.fHist >= 0.25) return { lv: 'near', s: 1.5, t: 'รอบๆ เคยมีน้ำท่วมเป็นวงกว้าง' };
    if (g.histNear != null && g.histNear <= 100) return { lv: 'near', s: 1, t: 'ใกล้จุดที่เคยมีน้ำ' };
    if (g.histNear != null) return { lv: 'near2', s: 0.5, t: 'ในรัศมี 300 ม. เคยมีน้ำ' };
    return { lv: 'none', s: 0, t: 'ไม่พบน้ำในอดีต' };
  }
  function trText(k) { var t = find(GSW_TR, function (x) { return x.k === k; }); return t ? t.t : ''; }
  function mText(m) { return m < 50 ? 'ไม่ถึง 50 ม.' : 'ราว ' + Math.round(m / 10) * 10 + ' ม.'; }

  // ---------- แบบจำลองน้ำท่วมใหญ่: ชั้นความลึกที่จุด ทุกระดับความถี่ (รอบ 10–500 ปี) ----------
  function glofasUrl(rp, t) { return GLOFAS_BASE + 'hazard-rp' + rp + '/' + t + '/' + t + '_RP' + rp + '_depth_reclass.tif'; }
  function glofasTilesFor(w, s, e, n) {
    return GLOFAS_TILES.filter(function (t) {
      var m = /_N(\d+)_E(\d+)/.exec(t), top = +m[1], left = +m[2];
      return left - 0.1 < e && left + 10.1 > w && top - 10.1 < n && top + 0.1 > s;
    });
  }
  function hazAt(lon, lat) {
    var ts = glofasTilesFor(lon, lat, lon, lat);
    if (!ts.length) return Promise.resolve(null);
    return Promise.all(GLOFAS_RP.map(function (rp) {
      return Promise.all(ts.map(function (t) { return cogOpen(glofasUrl(rp, t)).catch(function () { return null; }); })).then(function (cogs) {
        var ok = cogs.filter(Boolean);
        if (!ok.length) throw new Error('อ่านแบบจำลองไม่ได้');
        var cog = find(ok, function (c) { return lon >= c.west && lon < c.east && lat > c.south && lat <= c.north; });
        return cog ? cogPoint(cog, lon, lat, 1) : null;
      }).then(function (r) { return { rp: rp, v: r ? r.v : null, max: r ? r.max : null }; });
    }));
  }
  function chance20(rp) { return Math.round((1 - Math.pow(1 - 1 / rp, 20)) * 100); }
  function hazLevel(h) {
    if (!h) return null;
    var first = find(h, function (x) { return x.v != null; }), near = find(h, function (x) { return x.max != null; });
    if (first) return { lv: 'in', rp: first.rp, s: first.rp <= 20 ? 3 : first.rp <= 100 ? 2 : 1, t: 'ท่วมตั้งแต่ระดับรอบ ' + first.rp + ' ปี' };
    if (near) return { lv: 'near', rp: near.rp, s: 1, t: 'ใกล้พื้นที่ท่วมรอบ ' + near.rp + ' ปี' };
    return { lv: 'none', s: 0, t: 'แบบจำลองไม่พบน้ำท่วมจากแม่น้ำ' };
  }
  // ชั้นแผนที่ "พื้นที่น้ำท่วมใหญ่ รอบ 100 ปี": วาดเองจากไฟล์ COG ทีละกรอบ (ใช้ภาพย่อในไฟล์ตอนซูมออก)
  var EMPTY_PNG = null;
  function rgbaToPng(rgba, size) {
    var img = new ImageData(rgba, size, size);
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        var oc = new OffscreenCanvas(size, size), og = oc.getContext('2d');
        if (og && oc.convertToBlob) { og.putImageData(img, 0, 0); return oc.convertToBlob({ type: 'image/png' }).then(function (b) { return b.arrayBuffer(); }); }
      }
    } catch (e) { /* ใช้ canvas ปกติแทน */ }
    var c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').putImageData(img, 0, 0);
    return new Promise(function (ok, no) { c.toBlob(function (b) { if (b) ok(b.arrayBuffer()); else no(new Error('toBlob')); }, 'image/png'); });
  }
  function emptyPng() { if (!EMPTY_PNG) EMPTY_PNG = rgbaToPng(new Uint8ClampedArray(4), 1); return EMPTY_PNG; }
  function hazTile(z, x, y) {
    var n = Math.pow(2, z);
    function latOf(yy) { return 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))); }
    var ts = glofasTilesFor(x / n * 360 - 180, latOf(y + 1), (x + 1) / n * 360 - 180, latOf(y));
    if (!ts.length) return emptyPng();
    return Promise.all(ts.map(function (t) { return cogOpen(glofasUrl(100, t)).catch(function () { return null; }); })).then(function (cogs) {
      var ok = cogs.filter(Boolean);
      if (!ok.length) throw new Error('อ่านแบบจำลองไม่ได้');
      return cogRender(ok, z, x, y, 256, function (v) { return HAZ_RGBA[v] || null; });
    }).then(function (rgba) {
      if (HAZ.err) { HAZ.err = false; renderDataChips(); }
      return rgba ? rgbaToPng(rgba, 256) : emptyPng();
    }, function () {
      if (!HAZ.err) { HAZ.err = true; renderDataChips(); }
      return emptyPng();
    });
  }
  if (!IN_ARTIFACT && window.maplibregl && maplibregl.addProtocol && typeof DecompressionStream !== 'undefined') {
    maplibregl.addProtocol('cghaz', function (params) {
      var m = /cghaz:\/\/rp100\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if (!m) return Promise.reject(new Error('bad url'));
      return hazTile(+m[1], +m[2], +m[3]).then(function (buf) { return { data: buf }; });
    });
  }

  // ---------- ชั้นแผนที่: น้ำในอดีต + แบบจำลองน้ำท่วม ----------
  function belowData(map) { return map.getLayer('cg-thr-fill') ? 'cg-thr-fill' : undefined; }
  function updateHist(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, on = !!state.data.hist && !IN_ARTIFACT;
    if (on && !map.getSource('cg-hist')) {
      map.addSource('cg-hist', { type: 'raster', tileSize: 256, maxzoom: GSW_Z, tiles: [GSW_URL + 'occurrence/{z}/{x}/{y}.png'], attribution: GSW_ATTR });
      map.addLayer({ id: 'cg-hist', type: 'raster', source: 'cg-hist', paint: { 'raster-opacity': 0.85 } }, belowData(map));
    }
    if (map.getLayer('cg-hist')) map.setLayoutProperty('cg-hist', 'visibility', on ? 'visible' : 'none');
  }
  function updateHazard(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, on = !!state.data.hazard && !IN_ARTIFACT && typeof DecompressionStream !== 'undefined';
    if (on && !map.getSource('cg-haz')) {
      map.addSource('cg-haz', { type: 'raster', tileSize: 256, minzoom: 5, maxzoom: 12, tiles: ['cghaz://rp100/{z}/{x}/{y}'], attribution: GLOFAS_ATTR,
        bounds: [97.2, 5.5, 105.8, 20.6] });
      map.addLayer({ id: 'cg-haz', type: 'raster', source: 'cg-haz', paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest' } }, belowData(map));
    }
    if (map.getLayer('cg-haz')) map.setLayoutProperty('cg-haz', 'visibility', on ? 'visible' : 'none');
  }

  // ---------- ผังเมือง: วางภาพจากเซิร์ฟเวอร์กรมโยธาฯ ทับแผนที่ (ไม่ต้องใช้ CORS) ----------
  function mercX(lon) { return lon * 20037508.342789 / 180; }
  function mercY(lat) { return Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137; }
  function placeZoneImg(v) {
    var im = v.zoneImg;
    if (!im || !im._b) return;
    var map = v.map, b = im._b;
    if (map.getPitch() > 1 || map.getZoom() < ZONE_MINZ - 0.01) { im.style.visibility = 'hidden'; return; }
    var p1 = map.project([b[0], b[3]]), p2 = map.project([b[2], b[1]]);
    im.style.visibility = 'visible';
    im.style.left = p1.x + 'px'; im.style.top = p1.y + 'px';
    im.style.width = (p2.x - p1.x) + 'px'; im.style.height = (p2.y - p1.y) + 'px';
  }
  function requestZone(v) {
    var map = v.map, im = v.zoneImg;
    if (!im) return;
    if (map.getZoom() < ZONE_MINZ - 0.01 || map.getPitch() > 1) { placeZoneImg(v); return; }
    var bb = map.getBounds(), b = [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()];
    var zb = zoneProvBox(), out = !!zb && (b[2] < zb[0] || b[0] > zb[2] || b[3] < zb[1] || b[1] > zb[3]);
    if (out !== ZONE.outside) { ZONE.outside = out; renderDataChips(); }
    if (out) { im.style.visibility = 'hidden'; im._b = null; im._want = ''; return; }
    var cv = map.getCanvas(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.min(2048, Math.round(cv.clientWidth * dpr)), h = Math.min(2048, Math.round(cv.clientHeight * dpr));
    var url = ZONE_SVC + '/export?bbox=' + [mercX(b[0]), mercY(b[1]), mercX(b[2]), mercY(b[3])].map(function (x) { return x.toFixed(1); }).join(',') +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&dpi=' + Math.round(96 * dpr) + '&format=png32&transparent=true&layers=show:' + ZONE_LU.join(',') + '&f=image';
    if (im._want === url) return;
    im._want = url;
    var pre = new Image();
    pre.decoding = 'async';
    pre.onload = function () {
      if (im._want !== url || !v.zoneImg) return;
      im.src = url; im._b = b;
      placeZoneImg(v);
      if (!ZONE.ok || ZONE.err) { ZONE.ok = true; ZONE.err = false; renderDataChips(); }
    };
    pre.onerror = function () {
      if (im._want !== url) return;
      if (!ZONE.err) { ZONE.err = true; renderDataChips(); }
    };
    pre.src = url;
  }
  function updateZoning(v) {
    if (!v || v.kind !== 'chat') return;
    var on = !!state.data.zoning && !IN_ARTIFACT, map = v.map;
    if (!on) { if (v.zoneImg) { v.zoneImg.remove(); v.zoneImg = null; } return; }
    if (!v.zoneImg) {
      var im = v.zoneImg = document.createElement('img');
      im.className = 'zone-ov'; im.alt = ''; im.setAttribute('aria-hidden', 'true');
      var cc = map.getCanvasContainer(), cv = map.getCanvas();
      cc.insertBefore(im, cv.nextSibling);
      if (!v.zoneHooked) {
        v.zoneHooked = true;
        var raf = 0;
        map.on('move', function () { if (!v.zoneImg || raf) return; raf = requestAnimationFrame(function () { raf = 0; placeZoneImg(v); }); });
        map.on('moveend', function () { if (v.zoneImg) { clearTimeout(v.zoneT); v.zoneT = setTimeout(function () { requestZone(v); }, 250); } });
        map.on('resize', function () { if (v.zoneImg) requestZone(v); });
      }
      loadZoneLegend();
    }
    requestZone(v);
  }
  // สัญลักษณ์สีจริงจากเซิร์ฟเวอร์ (ถ้าเซิร์ฟเวอร์อนุญาตให้อ่านข้ามเว็บ)
  function loadZoneLegend() {
    if (ZONE.legendTried) return;
    ZONE.legendTried = true;
    getJSON(ZONE_SVC + '/legend?f=json', 9000).then(function (j) {
      var seen = {}, out = [];
      ((j && j.layers) || []).forEach(function (l) {
        if (ZONE_LU.indexOf(l.layerId) < 0) return;
        (l.legend || []).forEach(function (g) {
          var lab = String(g.label || '').trim();
          if (!lab || seen[lab] || !g.imageData || out.length >= 40) return;
          seen[lab] = 1;
          out.push({ label: lab, img: 'data:' + (g.contentType || 'image/png') + ';base64,' + g.imageData });
        });
      });
      if (out.length) { ZONE.legend = out; renderDataChips(); }
    }).catch(function () { /* อ่านข้ามเว็บไม่ได้ ใช้คำอธิบายสีมาตรฐานแทน */ });
  }
  // ผังเมืองที่จุด (ต้องอ่านข้ามเว็บได้) ถ้าไม่ได้ ให้ลิงก์ไปเว็บกรมโยธาฯ
  function zoningAt(lon, lat) {
    if (!zoneCovers(lon, lat)) return Promise.resolve({ outside: true, list: [] });
    var d = 0.004, url = ZONE_SVC + '/identify?f=json&geometryType=esriGeometryPoint&sr=4326&geometry=' + lon.toFixed(6) + ',' + lat.toFixed(6) +
      '&layers=all:' + ZONE_LU.concat(ZONE_FLOOD).join(',') + '&tolerance=2&returnGeometry=false&imageDisplay=400,400,96&mapExtent=' +
      [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(6); }).join(',');
    return getJSON(url, 9000).then(function (j) {
      var list = [], flood = false;
      ((j && j.results) || []).forEach(function (r) {
        if (ZONE_FLOOD.indexOf(r.layerId) >= 0) { flood = true; return; }
        if (list.length >= 3) return;
        var a = r.attributes || {}, extra = '';
        Object.keys(a).forEach(function (k) { if (!extra && /ประเภท|สี|zone|class|lu_|landuse|type/i.test(k) && a[k] && String(a[k]).length < 60) extra = String(a[k]); });
        list.push({ layer: String(r.layerName || ''), value: String(r.value || ''), extra: extra });
      });
      return { outside: false, list: list, flood: flood };
    });
  }
  function zoneLegendHtml() {
    var h = '<div class="m-extra zone-leg"><div class="m-extra-head">ผังเมืองรวม · สีใช้ทำอะไร</div>' +
      '<p class="fp-fine">บริการแผนที่ที่กรมโยธาฯ เปิดให้เว็บอื่นใช้ ตอนนี้มีเฉพาะร่างผังที่กำลังรับฟังความเห็นของเพชรบุรีและสระบุรี ยังไม่ใช่ผังที่บังคับใช้ จังหวัดอื่นตรวจที่ <a href="https://plludds.dpt.go.th/landuse/" target="_blank" rel="noopener">ระบบตรวจสอบผังเมือง</a></p>';
    if (ZONE.legend) {
      h += ZONE.legend.slice(0, 24).map(function (g) { return '<div class="zl-row"><img src="' + esc(g.img) + '" alt="" width="18" height="18"><span>' + esc(g.label) + '</span></div>'; }).join('');
      h += '<p class="fp-fine">สีจากเซิร์ฟเวอร์กรมโยธาธิการและผังเมือง</p>';
    } else {
      h += ZONE_LEG.map(function (z) {
        return '<div class="zl-row"><i class="zl-sw' + (z[0] === 'hatch' ? ' hatch' : '') + '"' + (z[0] === 'hatch' ? '' : ' style="background:' + z[0] + '"') + '></i><span><b>' + esc(z[1]) + '</b> ' + esc(z[2]) + '</span></div>';
      }).join('');
      h += '<p class="fp-fine">สีโดยประมาณตามแบบที่ใช้ทั่วไป รหัสย่อยและข้อห้ามต่างกันในแต่ละผัง ดูรายละเอียดในกฎกระทรวงของผังนั้น</p>';
    }
    return h + '</div>';
  }
  function zoneStatusText() {
    if (ZONE.err) return 'เซิร์ฟเวอร์ผังเมืองไม่ตอบตอนนี้ (บางครั้งเปิดได้เฉพาะในไทย)';
    var v = views.chat;
    if (ZONE.outside) return 'ตอนนี้มีเฉพาะร่างผังเพชรบุรีและสระบุรี เลื่อนแผนที่ไปที่ 2 จังหวัดนี้';
    if (v && v.map.getZoom() < ZONE_MINZ) return 'ซูมเข้าถึงระดับอำเภอเพื่อดูสีผังเมือง';
    return ZONE.ok ? 'แสดงร่างผังจากกรมโยธาฯ' : 'กำลังโหลด';
  }
  function zoneLinksHtml(lon, lat) {
    var bkk = provinceAt(lon, lat) === 'bkk';
    return '<a class="src-link" href="https://plludds.dpt.go.th/landuse/" target="_blank" rel="noopener">ระบบตรวจสอบผังเมือง กรมโยธาฯ' + ICO.ext + '</a>' +
      (bkk ? '<a class="src-link" href="https://cityplangis.bangkok.go.th/cpdPortal/" target="_blank" rel="noopener">ผังเมืองกรุงเทพฯ (สำนักการวางผังฯ)' + ICO.ext + '</a>' : '');
  }

  // ---------- น้ำท่วมตอนนี้ที่จุด (ปื้นน้ำจาก Sentinel-1 ล่าสุด) ----------
  function floodAtPoint(lon, lat) {
    if (!floodReady()) return Promise.resolve(null);
    var t = find(FLOOD.index.tiles, function (b) { return lon >= b.bbox[0] && lon < b.bbox[2] && lat >= b.bbox[1] && lat < b.bbox[3]; });
    if (!t) return Promise.resolve({ covered: false });
    var feats = FLOOD.tiles[t.id];
    var p = feats ? Promise.resolve(feats) : fetch(FLOOD_BASE + t.file + '?v=' + encodeURIComponent(t.added || t.date))
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return (j && j.features) || []; });
    return p.then(function (fs) {
      var hit = null, best = null;
      fs.forEach(function (f) {
        if (!f.geometry) return;
        if (inGeom(lon, lat, f.geometry)) { if (!hit || (hit.kind === 'seasonal' && f.properties.kind !== 'seasonal')) hit = f.properties; return; }
        var cs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        cs.forEach(function (poly) { (poly[0] || []).forEach(function (c) { var d = km(lon, lat, c[0], c[1]); if (d < 2 && (!best || d < best.d)) best = { d: d, p: f.properties }; }); });
      });
      return { covered: true, date: (hit && hit.date) || t.date || '', hit: hit, near: best };
    });
  }

  // ---------- ชื่อสถานที่ (OpenStreetMap Nominatim ใช้เฉพาะตอนผู้ใช้กดตรวจ) ----------
  function placeName(lon, lat) {
    return getJSON(NOMI + 'reverse?format=jsonv2&zoom=16&accept-language=th&lat=' + lat.toFixed(5) + '&lon=' + lon.toFixed(5), 8000).then(function (j) {
      var a = (j && j.address) || {}, parts = [];
      [a.road, a.suburb || a.village || a.hamlet || a.quarter || a.neighbourhood, a.city_district || a.district || a.county || a.town || a.municipality, a.state || a.province || a.city]
        .forEach(function (x) { if (x && parts.indexOf(x) < 0) parts.push(x); });
      return parts.slice(-3).join(' · ');
    });
  }
  function geocode(q) {
    return getJSON(NOMI + 'search?format=jsonv2&limit=1&countrycodes=th&accept-language=th&q=' + encodeURIComponent(q), 9000).then(function (a) {
      var r = a && a[0];
      if (!r) return null;
      var bb = (r.boundingbox || []).map(Number);
      return { lon: +r.lon, lat: +r.lat, name: String(r.display_name || q).split(',').slice(0, 3).join(','), kind: r.addresstype || r.type || '',
        bbox: bb.length === 4 ? [bb[2], bb[0], bb[3], bb[1]] : null };
    });
  }

  // ---------- รวมผลตรวจทำเล ----------
  function siteKey(lon, lat) { return lat.toFixed(5) + ',' + lon.toFixed(5); }
  function siteRun(lon, lat, name, quiet) {
    var key = siteKey(lon, lat), S = SITE.res[key];
    if (S) { if (name && !S.given) S.given = name; return key; }
    S = SITE.res[key] = { key: key, lon: lon, lat: lat, given: name || '', prov: provinceAt(lon, lat), name: '', ele: null, gsw: null, haz: null, zone: null, flood: null, st: {} };
    function track(k, p) {
      S.st[k] = 'loading';
      p.then(function (x) { S[k] = x; S.st[k] = 'ok'; }, function () { S.st[k] = 'err'; }).then(function () { siteChanged(key); });
    }
    track('ele', elevationAt(lon, lat));
    track('gsw', gswAt(lon, lat));
    track('haz', typeof DecompressionStream !== 'undefined' ? hazAt(lon, lat) : Promise.reject(new Error('old browser')));
    track('zone', zoningAt(lon, lat));
    track('flood', floodAtPoint(lon, lat));
    if (!quiet) track('name', placeName(lon, lat)); // ตรวจหลายแปลงพร้อมกัน: ไม่ถามชื่อสถานที่ (Nominatim ให้ไม่เกิน 1 ครั้งต่อวินาที)
    return key;
  }
  function siteChanged(key) {
    if (SITE.cur === key) renderSiteCard();
    if (state.messages.some(function (m) { return m.key === 'site' && m.site === key; })) renderMsgs();
  }
  function siteVerdict(S) {
    var g = gswLevel(S.gsw), h = hazLevel(S.haz), why = [], score = 0, known = 0;
    if (g) { known++; score += g.s; if (g.s > 0) why.push(g.t + ' (ภาพดาวเทียม 1984–2024)'); }
    if (g && g.lv === 'near' && S.gsw.fHist >= 0.25) why[why.length - 1] = 'ในรัศมี 300 ม. ราว ' + Math.round(S.gsw.fHist * 100) + '% ของพื้นที่เคยมีน้ำท่วมหรือน้ำขัง (ภาพดาวเทียม 1984–2024)';
    if (S.gsw && S.gsw.tr && GSW_FILLED[S.gsw.tr]) { score += 1; why.push('จุดนี้เคยเป็นที่น้ำขังแล้วแห้งไปหรือถูกถม ควรตรวจการทรุดตัวและการระบายน้ำ'); }
    else if (S.gsw && S.gsw.fFilled >= 0.15) { score += 0.5; why.push('รอบๆ ราว ' + Math.round(S.gsw.fFilled * 100) + '% ของพื้นที่เคยเป็นที่น้ำขังตามฤดูกาล แล้วแห้งไปหรือถูกถม (เช่น นาที่กลายเป็นหมู่บ้าน)'); }
    if (h) { known++; score += h.s; if (h.s > 0) why.push(h.t + ' (แบบจำลองแม่น้ำ)'); }
    if (S.ele) {
      if (S.ele.pct <= 0.15) { score += 1; why.push('ต่ำกว่าพื้นที่รอบๆ เกือบทั้งหมด น้ำมักไหลมารวม'); }
      else if (S.ele.pct >= 0.85) { score -= 1; why.push('สูงกว่าพื้นที่รอบๆ (ที่ดอน)'); }
    }
    if (S.flood && S.flood.hit && S.flood.hit.kind !== 'seasonal' && S.flood.hit.conf !== 'low') { score += 2; why.push('ภาพดาวเทียมล่าสุดพบน้ำท่วมตรงจุดนี้'); }
    if (S.zone && S.zone.flood) { score += 1; why.push('ร่างผังเมืองรวมของกรมโยธาฯ กำหนดเป็นพื้นที่เสี่ยงอุทกภัย'); }
    if (g && g.lv === 'water') return { lv: 'water', t: 'จุดนี้อยู่ในแหล่งน้ำ', why: ['ภาพดาวเทียมเห็นน้ำตรงนี้เกือบตลอด 41 ปี ลองแตะจุดบนบกใกล้ๆ อีกครั้ง'] };
    if (!known) return null;
    var lv = score >= 4 ? 'high' : score >= 2 ? 'mid' : 'low';
    if (lv === 'low') why.push('ข้อมูลชุดนี้มองไม่เห็นน้ำท่วมขังในเมืองจากฝนหนักหรือระบายน้ำไม่ทัน (เช่น ตัวเมืองหาดใหญ่) ควรถามประวัติน้ำท่วมกับคนในพื้นที่ด้วย');
    return { lv: lv, t: lv === 'high' ? 'พบสัญญาณเสี่ยงน้ำท่วมสูง' : lv === 'mid' ? 'พบสัญญาณเสี่ยงน้ำท่วมบางส่วน' : 'ไม่พบสัญญาณน้ำท่วมชัดเจน', why: why, partial: known < 2 };
  }
  var SV_C = { high: '#E5484D', mid: '#E0A526', low: '#2FA36B', water: '#2F7FE0' };
  function siteTitle(S) {
    return S.given || S.name || (S.prov && byId[S.prov] ? (byId[S.prov].full || byId[S.prov].name) : 'จุดที่เลือก');
  }
  function siteChipsHtml(S) {
    function tile(lab, val, sub, st) {
      return '<div class="sv-tile"><span class="sv-lab">' + lab + '</span><b>' + (st === 'loading' ? '<span class="sv-load">กำลังอ่าน…</span>' : st === 'err' ? 'อ่านไม่ได้' : esc(val)) + '</b>' +
        (sub && st === 'ok' ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    }
    var g = gswLevel(S.gsw), h = hazLevel(S.haz), e = S.ele, f = S.flood;
    var eleV = e ? 'ราว ' + Math.round(e.ele) + ' ม.' : '', eleS = e ? (e.pct <= 0.15 ? 'ที่ลุ่ม' : e.pct >= 0.85 ? 'ที่ดอน' : 'ระดับใกล้เคียงรอบๆ') : '';
    var fV = !f ? 'ยังไม่มีข้อมูล' : !f.covered ? 'ยังไม่ได้ตรวจ' : f.hit ? (f.hit.kind === 'seasonal' ? 'มีน้ำตามฤดูกาล' : f.hit.conf === 'low' ? 'อาจมีน้ำ' : 'พบน้ำท่วม') : 'ไม่พบน้ำ';
    var fS = f && f.covered && f.date ? 'ภาพ ' + ageText(f.date) : '';
    var hS = h && h.rp ? 'โอกาสเกิดใน 20 ปี ~' + chance20(h.rp) + '%' : h && h.lv === 'none' ? 'เฉพาะแม่น้ำสายใหญ่' : '';
    return '<div class="sv-grid">' +
      tile('น้ำในอดีต 41 ปี', g ? g.t : '', g ? (g.lv === 'none' ? 'ในรัศมี 300 ม.' : 'ดาวเทียม Landsat') : '', S.st.gsw) +
      tile('น้ำท่วมใหญ่ (แบบจำลอง)', h ? h.t : (S.st.haz === 'ok' ? 'นอกพื้นที่แบบจำลอง' : ''), hS, S.st.haz) +
      tile('ความสูงพื้นดิน', eleV, eleS, S.st.ele) +
      tile('น้ำตอนนี้ (ดาวเทียม)', fV, fS, S.st.flood) + '</div>';
  }
  function siteVerdictHtml(S) {
    var busy = S.st.gsw === 'loading' || S.st.haz === 'loading' || S.st.ele === 'loading';
    var V = busy ? null : siteVerdict(S);
    if (!V) return busy ? '<div class="sv-verdict"><span class="sv-load">กำลังรวบรวมข้อมูล…</span></div>' : '<div class="sv-verdict">สรุปไม่ได้ตอนนี้ (โหลดข้อมูลหลักไม่ได้)</div>';
    return '<div class="sv-verdict" style="--c:' + SV_C[V.lv] + '"><b><i></i>' + esc(V.t) + (V.partial ? ' (ข้อมูลยังไม่ครบ)' : '') + '</b><ul>' +
      V.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
  }
  function siteSectionsHtml(S) {
    var h = '', g = S.gsw;
    // 1) น้ำในอดีต
    h += '<section class="sv-sec"><h3>น้ำในอดีต 41 ปี <small>ภาพดาวเทียม Landsat 1984–2024</small></h3>';
    if (S.st.gsw === 'loading') h += '<p class="sv-load">กำลังอ่านภาพ…</p>';
    else if (S.st.gsw === 'err') h += '<p>อ่านภาพดาวเทียมย้อนหลังไม่ได้ตอนนี้</p>';
    else if (g) {
      if (g.tr) {
        h += '<p><b>' + esc(trText(g.tr)) + '</b></p>';
        if (!GSW_PERM[g.tr]) h += '<p>ช่วงที่มีภาพ ดาวเทียมเห็นน้ำตรงนี้ราว ' + Math.max(1, g.occ) + '% ของเวลา' + (g.rec != null ? ' · ในปีที่มีน้ำ น้ำกลับมาซ้ำราว ' + g.rec + '% ของปี' : '') + '</p>';
      } else if (g.occ > 0) {
        h += '<p><b>เคยมีน้ำท่วมหรือน้ำขังตรงนี้</b> ดาวเทียมเห็นน้ำราว ' + g.occ + '% ของเวลา</p>';
      } else {
        h += '<p><b>ดาวเทียมไม่เคยเห็นน้ำขังตรงจุดนี้</b></p>';
        if (g.histNear != null) h += '<p>แต่ห่างไป' + mText(g.histNear) + ' เคยมีน้ำท่วมหรือน้ำขัง' + (g.occMax100 ? ' (ในรัศมี 100 ม. มีน้ำราว ' + g.occMax100 + '% ของเวลา)' : '') + '</p>';
        else h += '<p>ในรัศมี 300 ม. ก็ไม่พบน้ำท่วมหรือน้ำขังตลอด 41 ปี</p>';
      }
      if (g.fHist >= 0.05) h += '<p>ในรัศมี 300 ม. ราว ' + Math.round(g.fHist * 100) + '% ของพื้นที่เคยมีน้ำท่วมหรือน้ำขัง</p>';
      if (g.permNear != null && !(g.tr && GSW_PERM[g.tr])) h += '<p>แหล่งน้ำถาวรใกล้สุด (แม่น้ำ คลอง บ่อ) ห่าง' + mText(g.permNear) + '</p>';
      if (g.filledNear != null && !(g.tr && GSW_FILLED[g.tr])) h += '<p>ห่าง' + mText(g.filledNear) + ' มีจุดที่เคยเป็นที่น้ำขังแล้วแห้งไปหรือถูกถม' + (g.fFilled >= 0.05 ? ' (ราว ' + Math.round(g.fFilled * 100) + '% ของพื้นที่รอบๆ)' : '') + '</p>';
      h += '<p class="sv-note">ดาวเทียมผ่านทุก 8–16 วันและมองผ่านเมฆไม่ได้ น้ำท่วมที่มาเร็วไปเร็ว น้ำท่วมขังบนถนนในเมือง หรือใต้ร่มไม้ อาจไม่ถูกบันทึก "ไม่พบ" จึงไม่ได้แปลว่าไม่เคยท่วม</p>';
    }
    h += '<button type="button" class="btn-ghost sv-btn" data-site-layer="hist">' + (state.data.hist ? 'ซ่อน' : 'เปิด') + 'ชั้นน้ำในอดีตบนแผนที่</button></section>';
    // 2) แบบจำลองน้ำท่วมใหญ่ + โอกาสใน 20 ปี
    h += '<section class="sv-sec"><h3>ถ้าเกิดน้ำท่วมใหญ่ <small>แบบจำลองน้ำล้นแม่น้ำ JRC GloFAS (90 ม.)</small></h3>';
    if (S.st.haz === 'loading') h += '<p class="sv-load">กำลังอ่านแบบจำลอง…</p>';
    else if (S.st.haz === 'err') h += '<p>อ่านแบบจำลองไม่ได้ตอนนี้' + (typeof DecompressionStream === 'undefined' ? ' (เบราว์เซอร์นี้เก่าเกินไป)' : '') + '</p>';
    else if (!S.haz) h += '<p>จุดนี้อยู่นอกพื้นที่ของแบบจำลอง</p>';
    else {
      h += '<table class="sv-table"><thead><tr><th>ระดับน้ำท่วม</th><th>โอกาสเจอใน 20 ปี</th><th>ที่จุดนี้</th></tr></thead><tbody>' +
        S.haz.map(function (x) {
          var at = x.v != null ? HAZ_T[x.v] || 'ท่วม' : x.max != null ? 'ไม่ท่วม (ใกล้ๆ ' + (HAZ_T[x.max] || 'ท่วม').replace('ลึก', 'ลึก') + ')' : 'ไม่ท่วม';
          return '<tr' + (x.v != null ? ' class="hit"' : '') + '><td>รอบ ' + x.rp + ' ปี</td><td>~' + chance20(x.rp) + '%</td><td>' + esc(at) + '</td></tr>';
        }).join('') + '</tbody></table>';
      h += '<p class="sv-note">"รอบ 100 ปี" คือน้ำท่วมขนาดที่มีโอกาสเกิด 1% ในแต่ละปี ในช่วง 20 ปีจึงมีโอกาสเจออย่างน้อยหนึ่งครั้งราว 18% ตัวเลขนี้คิดจากภูมิอากาศปัจจุบัน ' +
        'รายงาน IPCC AR6 ประเมินว่าฝนตกหนักมีแนวโน้มรุนแรงและบ่อยขึ้นเมื่อโลกร้อนขึ้น โอกาสจริงในอนาคตจึงอาจสูงกว่านี้ ' +
        'แบบจำลองนี้ครอบเฉพาะแม่น้ำสายใหญ่ ไม่รวมคันกั้นน้ำ ระบบระบายน้ำ น้ำป่าจากลำห้วยเล็ก และน้ำท่วมขังจากฝนในเมือง</p>';
    }
    h += '<button type="button" class="btn-ghost sv-btn" data-site-layer="hazard">' + (state.data.hazard ? 'ซ่อน' : 'เปิด') + 'พื้นที่น้ำท่วมรอบ 100 ปีบนแผนที่</button></section>';
    // 3) ความสูง
    h += '<section class="sv-sec"><h3>ความสูงพื้นดิน <small>แผนที่ความสูงราว 30 ม.</small></h3>';
    if (S.st.ele === 'loading') h += '<p class="sv-load">กำลังอ่าน…</p>';
    else if (!S.ele) h += '<p>อ่านค่าความสูงไม่ได้ตอนนี้</p>';
    else h += '<p><b>ราว ' + Math.round(S.ele.ele) + ' ม. จากระดับน้ำทะเล</b> · ' + esc(eleText(S.ele)) + '</p><p>รัศมี 1 กม.: ต่ำสุด ' + Math.round(S.ele.min) + ' · กลาง ' + Math.round(S.ele.med) + ' · สูงสุด ' + Math.round(S.ele.max) + ' ม.</p>' +
      '<p class="sv-note">ค่าจากเรดาร์ดาวเทียม (SRTM) รวมความสูงของต้นไม้และอาคาร ที่ราบลุ่มอาจคลาดเคลื่อนหลายเมตร ใช้ดูว่าเป็นที่ลุ่มหรือที่ดอนเทียบกับรอบๆ ไม่ใช่ค่ารังวัด</p>';
    h += '</section>';
    // 4) ผังเมือง
    h += '<section class="sv-sec"><h3>ผังเมืองรวม <small>กรมโยธาธิการและผังเมือง</small></h3>';
    if (S.st.zone === 'loading') h += '<p class="sv-load">กำลังถามเซิร์ฟเวอร์ผังเมือง…</p>';
    else if (S.st.zone === 'ok' && S.zone && S.zone.outside) h += '<p>ผังเมืองของจุดนี้ยังดูผ่านเว็บนี้ไม่ได้ ตอนนี้กรมโยธาฯ เปิดบริการแผนที่ให้เว็บอื่นใช้ได้เฉพาะร่างผังของเพชรบุรีและสระบุรี ตรวจผังที่ใช้อยู่จริงได้ที่ระบบของหน่วยงานด้านล่าง</p>';
    else if (S.st.zone === 'ok' && S.zone && (S.zone.list.length || S.zone.flood)) {
      h += S.zone.list.map(function (z) { return '<p><b>' + esc(z.value || z.extra || '-') + '</b> <span class="sv-dim">' + esc(z.layer) + (z.extra && z.extra !== z.value ? ' · ' + esc(z.extra) : '') + '</span></p>'; }).join('');
      if (S.zone.flood) h += '<p><b>ร่างผังกำหนดให้จุดนี้อยู่ใน "พื้นที่เสี่ยงอุทกภัย"</b></p>';
      h += '<p class="sv-note">เป็นร่างผังเมืองรวมที่กำลังจัดทำหรือรับฟังความเห็น ยังไม่ใช่ผังที่บังคับใช้ อาจเปลี่ยนก่อนประกาศ</p>';
    }
    else if (S.st.zone === 'ok') h += '<p>ร่างผังของจังหวัดนี้ไม่ครอบจุดนี้</p>';
    else h += '<p>อ่านผังเมืองที่จุดนี้จากเว็บนี้ไม่ได้ (เซิร์ฟเวอร์อาจไม่อนุญาตให้เว็บอื่นอ่านข้อมูล) ลองเปิดชั้นผังเมืองบนแผนที่ หรือตรวจที่เว็บของหน่วยงานด้านล่าง</p>';
    h += '<div class="sv-links">' + zoneLinksHtml(S.lon, S.lat) + '</div>';
    h += '<button type="button" class="btn-ghost sv-btn" data-site-layer="zoning">' + (state.data.zoning ? 'ซ่อน' : 'เปิด') + 'สีผังเมืองบนแผนที่</button>';
    h += '<p class="sv-note">ข้อมูลผังเมืองบนเว็บใช้อ้างอิงทางกฎหมายไม่ได้ ก่อนซื้อหรือขออนุญาตก่อสร้าง ให้ขอหนังสือรับรองการใช้ประโยชน์ที่ดินจากสำนักงานโยธาธิการและผังเมืองจังหวัดหรือเขต</p></section>';
    // 5) สถานการณ์ตอนนี้รอบจุด (ใช้ส่วนเดียวกับ "รอบตัวฉัน")
    var p = S.prov && byId[S.prov];
    if (p) h += '<section class="sv-sec"><h3>ตอนนี้รอบจุดนี้ <small>ระดับน้ำ ฝน พยากรณ์ กล้อง</small></h3>' + localHtml({ place: p, near: { lon: S.lon, lat: S.lat }, nearLabel: 'ใกล้จุดนี้' }) + '</section>';
    // 6) ตรวจต่อ
    var ll = S.lat.toFixed(6) + ',' + S.lon.toFixed(6);
    h += '<section class="sv-sec"><h3>ตรวจต่อที่แหล่งข้อมูลจริง</h3><div class="sv-links">' +
      '<a class="src-link" href="https://www.google.com/maps/search/?api=1&query=' + ll + '" target="_blank" rel="noopener">Google Maps' + ICO.ext + '</a>' +
      '<a class="src-link" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + ll + '" target="_blank" rel="noopener">Street View' + ICO.ext + '</a>' +
      '<a class="src-link" href="https://landsmaps.dol.go.th/" target="_blank" rel="noopener">LandsMaps กรมที่ดิน' + ICO.ext + '</a>' +
      '<a class="src-link" href="https://asset.led.go.th/newbidreg/" target="_blank" rel="noopener">ค้นทรัพย์ขายทอดตลาด กรมบังคับคดี' + ICO.ext + '</a>' +
      '</div><p class="sv-note">ChatGeo ไม่ได้เก็บประกาศขายทอดตลาดไว้เอง ถ้าเจอทรัพย์ที่สนใจ คัดลอกพิกัดหรือลิงก์ Google Maps ของทรัพย์นั้นมาวางในแชทเพื่อตรวจทำเลได้</p></section>';
    h += '<div class="sv-share"><button type="button" class="btn-ghost sv-btn" data-site-copy="' + esc(S.key) + '">คัดลอกลิงก์รายงานนี้</button></div>';
    h += '<p class="sv-foot">สรุปจากข้อมูลเปิดและแบบจำลองระดับโลก เพื่อใช้คัดกรองเบื้องต้น ไม่ใช่การประเมินอย่างเป็นทางการ และไม่ใช่คำแนะนำการลงทุน ' +
      'ควรดูหน้างานหลังฝนหนัก ถามคนในพื้นที่ และตรวจเอกสารกับหน่วยงาน · ' + GSW_ATTR + ' · ' + GLOFAS_ATTR + ' · ' + DEM_ATTR + ' · ชื่อสถานที่ © OpenStreetMap</p>';
    return h;
  }
  function renderSiteCard() {
    var el = $('siteCard');
    if (!el) return;
    var S = SITE.cur && SITE.res[SITE.cur];
    if (!S) { el.hidden = true; return; }
    el.hidden = false;
    // กำลังพิมพ์ราคาแปลงอยู่: ยังไม่วาดใหม่ (ช่องพิมพ์จะหลุด) วาดตอนออกจากช่อง
    if (document.activeElement && document.activeElement.id === 'twinPrice') { TWIN.pending = true; return; }
    var twin = TWIN.tab === 'twin';
    $('siteTitle').textContent = siteTitle(S);
    $('siteSub').textContent = S.lat.toFixed(5) + ', ' + S.lon.toFixed(5) + (S.given && S.name ? ' · ' + S.name : '');
    $('siteKicker').textContent = twin ? 'วิเคราะห์ที่ดิน · Digital Twin (ทดลอง)' : 'ตรวจทำเล · ทดลอง';
    el.querySelectorAll('[role="tab"][data-site-tab]').forEach(function (b) {
      var on = b.getAttribute('data-site-tab') === TWIN.tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    $('siteBody').setAttribute('aria-labelledby', twin ? 'siteTabTwin' : 'siteTabRisk');
    if (twin) twinLoad(S);
    var keepScroll = $('siteBody').scrollTop;
    $('siteBody').innerHTML = twin ? twinHtml(S) : siteVerdictHtml(S) + siteChipsHtml(S) + siteSectionsHtml(S);
    $('siteBody').scrollTop = keepScroll;
  }
  function siteMarker(lon, lat) {
    var v = views.chat;
    if (!v) return;
    if (!SITE.marker) {
      var el = document.createElement('div');
      el.className = 'site-pin';
      el.setAttribute('aria-label', 'จุดที่ตรวจทำเล');
      SITE.marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(v.map);
    } else SITE.marker.setLngLat([lon, lat]).addTo(v.map);
  }
  function sitePadding() {
    var v = views.chat, W = v ? v.el.clientWidth : 800;
    // จอเล็ก: การ์ดอยู่ครึ่งล่างของจอ (ทับแชท) แผนที่ไม่ถูกบัง
    return window.innerWidth <= 860 ? { top: 56, bottom: 16, left: 16, right: 64 } : { top: 60, bottom: 40, left: 40, right: Math.min(500, W * 0.5 + 88) };
  }
  function openSite(lon, lat, opt) {
    opt = opt || {};
    if (!isFinite(lon) || !isFinite(lat)) return null;
    setSitePick(false);
    if (PARCEL.on) parcelEnd(false);
    if (state.page !== 'chat') setPage('chat');
    if (opt.tab) TWIN.tab = opt.tab === 'twin' ? 'twin' : 'risk';
    var key = siteRun(lon, lat, opt.name);
    SITE.cur = key;
    var pc = $('pinCard'); if (pc) pc.hidden = true;
    var v = views.chat;
    if (v && v.popup) { v.popup.remove(); v.popup = null; }
    siteMarker(lon, lat);
    renderSiteCard();
    if (v) {
      var z = Math.max(v.map.getZoom(), opt.zoom || 14);
      v.map.easeTo({ center: [lon, lat], zoom: Math.min(z, 16), padding: sitePadding(), duration: reduceMotion ? 0 : 900 });
    }
    siteHash(SITE.res[key]);
    if (v) updateParcel(v);
    return key;
  }
  function closeSite() {
    if (PARCEL.on) parcelEnd(false);
    SITE.cur = null;
    renderSiteCard();
    updateParcel(views.chat);
    if (SITE.marker) { SITE.marker.remove(); }
    var v = views.chat;
    if (v) v.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: reduceMotion ? 0 : 400 });
    if (/^#(site|twin)=/.test(location.hash)) writeHash(false);
  }
  function setSitePick(on, hint) {
    SITE.pick = !!on;
    if (!on && PP) PP.pick = null;
    var v = views.chat, el = $('sitePick');
    if (v) v.el.classList.toggle('picking', SITE.pick);
    if (el) {
      el.hidden = !SITE.pick;
      if (SITE.pick) $('sitePickText').textContent = hint || 'แตะจุดบนแผนที่ที่อยากตรวจทำเล';
    }
    var b = $('btnSite');
    if (b) b.setAttribute('aria-pressed', String(SITE.pick));
  }
  // พิกัดหรือลิงก์ Google Maps ในข้อความ
  function parseCoords(t) {
    t = String(t || '');
    var m = /@(-?\d{1,2}\.\d+),\s*(-?\d{2,3}\.\d+)/.exec(t) || /!3d(-?\d{1,2}\.\d+)!4d(-?\d{2,3}\.\d+)/.exec(t) ||
      /[?&](?:q|query|ll|destination|center)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{2,3}\.\d+)/i.exec(t) ||
      /(-?\d{1,3}\.\d{2,})\s*[,\s]\s*(-?\d{1,3}\.\d{2,})/.exec(t);
    if (!m) return null;
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a > 90 && b <= 90) { var x = a; a = b; b = x; } // ใส่ลองจิจูดมาก่อน
    if (!(a >= 4 && a <= 22 && b >= 96 && b <= 107)) return { out: true, lat: a, lon: b };
    return { lat: a, lon: b };
  }
  var SITE_RE = /ตรวจทำเล|เช็[คก]ทำเล|ทำเล|อสังหา|ที่ดิน|ซื้อ(บ้าน|คอนโด|ทาวน์|ที่)|บ้านมือสอง|บังคับคดี|ขายทอดตลาด|ทรัพย์ npa|\bnpa\b|น้ำเคยท่วม|เคยน้ำท่วม|เคยท่วม|ท่วมซ้ำ|น้ำท่วมย้อนหลัง|ผังเมือง|ผังสี|สีผัง|น้ำท่วม(ใน)?อนาคต|ความเสี่ยงน้ำท่วม|เสี่ยงน้ำท่วม|ท่วมไหมถ้า|maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i;
  var SITE_STRIP = ['ตรวจทำเล', 'เช็คทำเล', 'เช็กทำเล', 'ทำเล', 'อสังหาริมทรัพย์', 'อสังหา', 'ที่ดิน', 'บ้านมือสอง', 'ทรัพย์บังคับคดี', 'บังคับคดี', 'ขายทอดตลาด',
    'น้ำท่วมย้อนหลัง', 'น้ำเคยท่วม', 'เคยน้ำท่วม', 'เคยท่วม', 'ท่วมซ้ำ', 'ผังเมือง', 'ผังสี', 'สีผัง', 'น้ำท่วมในอนาคต', 'น้ำท่วมอนาคต', 'ความเสี่ยงน้ำท่วม', 'เสี่ยงน้ำท่วม',
    'ซื้อบ้าน', 'ซื้อคอนโด', 'ซื้อที่', 'น่าซื้อ', 'ดีไหม', 'ไหม', 'มั้ย', 'หน่อย', 'ครับ', 'ค่ะ', 'คะ', 'ช่วย', 'อยากรู้', 'อยาก', 'ตรวจ', 'เช็ค', 'เช็ก', 'ให้', 'ดู', 'แถว', 'ย่าน', 'บริเวณ', 'ว่า', 'เป็นยังไง', 'ยังไง', 'อย่างไร', 'น้ำท่วม', 'ท่วม'];
  // วิเคราะห์ที่ดินเพื่อเพาะปลูก (แท็บดิจิทัลทวิน)
  var TWIN_RE = /ปลูกอะไร|เหมาะปลูก|เหมาะกับการปลูก|ปลูก(ข้าว|มัน|อ้อย|ยางพารา|ปาล์ม|ทุเรียน|มะม่วง)|เพาะปลูก|ชั้นดิน|เนื้อดิน|คุณภาพดิน|วิเคราะห์ดิน|วิเคราะห์ที่ดิน|ตรวจดิน|ดินเปรี้ยว|ดินเค็ม|ค่า ?ph ?ดิน|digital ?twin|ดิจิ(ทั|ตอ)ล ?ทวิน|ทำเกษตร|ทำสวน|ทำไร่|ทำนา(?!ย)/i;
  var TWIN_STRIP = ['วิเคราะห์ที่ดิน', 'วิเคราะห์ดิน', 'ตรวจดิน', 'ปลูกอะไรดี', 'ปลูกอะไร', 'เหมาะกับการปลูก', 'เหมาะปลูก', 'เพาะปลูก', 'ชั้นดิน', 'เนื้อดิน', 'คุณภาพดิน', 'ดินเปรี้ยว', 'ดินเค็ม',
    'ดิจิทัลทวิน', 'ดิจิตอลทวิน', 'digital twin', 'ทำเกษตร', 'ทำสวน', 'ทำไร่', 'ทำนา', 'มันสำปะหลัง', 'ข้าวโพด', 'ยางพารา', 'ปาล์มน้ำมัน', 'ปาล์ม', 'ทุเรียน', 'มะม่วง', 'อ้อย', 'ปลูกข้าว', 'ปลูก', 'เหมาะ'];
  var HERE_RE = /ตรงนี้|ที่นี่|ที่ฉันอยู่|ตำแหน่งฉัน|ตำแหน่งของฉัน|แถวนี้/;
  function siteQuery(text) {
    if (state.page !== 'chat') setPage('chat');
    state.messages.push({ role: 'user', text: text });
    var tw = TWIN_RE.test(text);
    TWIN.tab = tw ? 'twin' : 'risk';
    var m = { role: 'bot', key: 'site', status: 'wait', q: text, twin: tw };
    state.messages.push(m);
    renderMsgs();
    function done(st, extra) { m.status = st; Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; }); renderMsgs(); }
    var c = parseCoords(text);
    if (c && c.out) { done('out'); return; }
    if (c) { done('ok', { site: openSite(c.lon, c.lat, { name: 'พิกัดที่ให้มา' }) }); return; }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text)) { done('short'); return; }
    if (HERE_RE.test(text)) {
      if (me.lon != null) { done('ok', { site: openSite(me.lon, me.lat, { name: 'ตำแหน่งของคุณ' }) }); return; }
      if (!navigator.geolocation) { done('pick'); setSitePick(true); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        me.lon = pos.coords.longitude; me.lat = pos.coords.latitude; showMeMarker();
        done('ok', { site: openSite(me.lon, me.lat, { name: 'ตำแหน่งของคุณ' }) });
      }, function () { done('pick'); setSitePick(true); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
      return;
    }
    var rest = text;
    if (tw) TWIN_STRIP.forEach(function (w) { rest = rest.split(w).join(' '); });
    SITE_STRIP.forEach(function (w) { rest = rest.split(w).join(' '); });
    rest = rest.replace(/[?？!,.]/g, ' ').replace(/\s+/g, ' ').trim();
    var place = findPlace(text);
    if (place && place.id === 'world') place = null;
    function pickIn(p, name) {
      state.data.hazard = true; saveData(); eachView(refreshLive); renderDataChips();
      if (p) goTo(p.id);
      done('pick', { where: name || '' });
      setSitePick(true, 'แตะจุดที่อยาก' + (tw ? 'วิเคราะห์ดิน' : 'ตรวจ') + (name ? 'ใน' + name : 'บนแผนที่'));
    }
    var onlyPlace = place && rest.replace(place.name, '').replace(SHORT[place.id] || '\u0000', '').replace(/จังหวัด|จ\./g, '').trim().length < 2;
    if (rest.replace(/\s/g, '').length < 2 || onlyPlace) { pickIn(place, place ? place.name : ''); return; }
    geocode(rest).then(function (r) {
      if (!r) { place ? pickIn(place, place.name) : done('notfound', { what: rest }); if (!place) setSitePick(true); return; }
      if (/^(state|province|country|region)$/.test(r.kind) && r.bbox) {
        var v = views.chat;
        if (v) v.map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 40, duration: reduceMotion ? 0 : 900 });
        done('pick', { where: r.name.split(',')[0] });
        setSitePick(true, 'แตะจุดที่อยากตรวจใน' + r.name.split(',')[0]);
        return;
      }
      var big = /^(county|district|municipality|city|town)$/.test(r.kind);
      done('ok', { site: openSite(r.lon, r.lat, { name: r.name.split(',')[0], zoom: big ? 13 : 15 }), geo: r.name, big: big });
    }).catch(function () { if (place) pickIn(place, place.name); else { done('notfound', { what: rest }); setSitePick(true); } });
  }
  function siteAnswer(m) {
    var head = m.twin ? 'วิเคราะห์ที่ดิน · Digital Twin (ทดลอง)' : 'ตรวจทำเล (ทดลอง)';
    if (m.twin && m.status === 'pick') return { title: head, text: 'แตะจุดบนแผนที่' + (m.where ? 'ใน' + m.where : '') + ' ที่อยากวิเคราะห์ ระบบจะสร้างแบบจำลองที่ดินจุดนั้น: ชั้นดินลึก 2 เมตร ฝนและอุณหภูมิตลอดปี ความลาดชัน ความเสี่ยงน้ำท่วม และความเหมาะกับพืชเศรษฐกิจ 8 ชนิด หรือจะวางพิกัด ลิงก์ Google Maps หรือพิมพ์ชื่อตำบลก็ได้' };
    if (m.twin && m.status === 'ok' && SITE.res[m.site]) {
      var ST = SITE.res[m.site];
      twinLoad(ST);
      return { title: 'วิเคราะห์ที่ดิน · ' + siteTitle(ST), text: (m.big ? 'ใช้จุดกลางของ' + siteTitle(ST) + ' ถ้าอยากวิเคราะห์แปลงจริง แตะตรงแปลงนั้นบนแผนที่อีกครั้ง ' : '') + twinAnswerText(ST),
        html: '<button type="button" class="btn-ghost sv-open" data-site-open="' + esc(ST.key) + '" data-site-tab="twin">เปิดรายงานดิน · เพาะปลูก' + ICO.arrow + '</button>' };
    }
    if (m.status === 'wait') return { title: head, text: 'กำลังหาตำแหน่ง…' };
    if (m.status === 'out') return { title: head, text: 'พิกัดนี้อยู่นอกประเทศไทย ตอนนี้ตรวจทำเลได้เฉพาะในไทย ลองวางพิกัดแบบ ละติจูด, ลองจิจูด เช่น 13.7563, 100.5018' };
    if (m.status === 'short') return { title: head, text: 'ลิงก์ย่อของ Google Maps (maps.app.goo.gl) อ่านพิกัดไม่ได้ ให้เปิดลิงก์นั้น แล้วกดค้างที่หมุดเพื่อคัดลอกตัวเลขพิกัด (เช่น 13.7563, 100.5018) มาวางแทน หรือแตะจุดบนแผนที่ก็ได้' };
    if (m.status === 'notfound') return { title: head, text: 'หาสถานที่ "' + (m.what || '') + '" ไม่เจอ ลองพิมพ์ชื่อตำบล อำเภอ หรือโครงการให้ชัดขึ้น วางพิกัด หรือแตะจุดบนแผนที่ได้เลย' };
    if (m.status === 'pick') return { title: head, text: 'แตะจุดบนแผนที่' + (m.where ? 'ใน' + m.where : '') + ' ที่อยากตรวจ ระบบจะบอกว่าน้ำเคยท่วมไหมตลอด 41 ปี โอกาสเจอน้ำท่วมใหญ่ใน 20 ปีตามแบบจำลอง ความสูงพื้นดิน และผังเมือง ' +
      'เปิดชั้น "พื้นที่น้ำท่วมใหญ่ (แบบจำลอง)" ให้แล้ว สีม่วงคือพื้นที่ที่น้ำล้นแม่น้ำท่วมถึงในแบบจำลอง หรือจะวางพิกัด ลิงก์ Google Maps หรือพิมพ์ชื่อตำบลก็ได้' };
    var S = SITE.res[m.site];
    if (!S) return { title: head, text: 'ปิดรายงานนี้ไปแล้ว ลองถามใหม่อีกครั้ง' };
    var V = S.st.gsw === 'loading' || S.st.haz === 'loading' || S.st.ele === 'loading' ? null : siteVerdict(S);
    var txt = (m.big ? 'ใช้จุดกลางของ' + siteTitle(S) + ' ถ้าอยากตรวจแปลงจริง แตะตรงแปลงนั้นบนแผนที่อีกครั้ง ' : '') +
      (!V ? 'กำลังอ่านภาพดาวเทียมย้อนหลังและแบบจำลองน้ำท่วม…'
        : V.lv === 'water' ? V.t + ' ' + V.why[0]
        : V.lv === 'low' ? 'ภาพรวมจากข้อมูลเปิด: ไม่พบสัญญาณน้ำท่วมชัดเจนจากดาวเทียมย้อนหลังและแบบจำลอง แต่ดาวเทียมมองไม่เห็นน้ำท่วมขังในเมือง ควรถามประวัติน้ำท่วมกับคนในพื้นที่ด้วย'
        : 'ภาพรวมจากข้อมูลเปิด: ' + V.t + ' เพราะ' + V.why.slice(0, 2).join(' และ'));
    return { title: 'ตรวจทำเล · ' + siteTitle(S), text: txt,
      html: siteChipsHtml(S) + '<button type="button" class="btn-ghost sv-open" data-site-open="' + esc(S.key) + '" data-site-tab="risk">เปิดรายงานเต็ม' + ICO.arrow + '</button>' };
  }

  function siteLegendHtml() {
    var h = '';
    if (state.data.hist) {
      h += '<div class="rain-legend" aria-label="สีน้ำในอดีต"><span>น้ำในอดีต</span><span class="sp"></span><span>นานๆ ครั้ง</span><i style="background:linear-gradient(90deg,rgba(255,0,0,.3),rgba(140,0,120,.75),#0000FF)"></i><span>เกือบตลอด</span></div>' +
        '<p class="fp-fine">ภาพดาวเทียม Landsat 1984–2024 · สีแดงจาง = เคยมีน้ำท่วมหรือน้ำขังบางช่วง สีน้ำเงิน = แหล่งน้ำถาวร · ' + GSW_ATTR + '</p>';
    }
    if (state.data.hazard) {
      h += '<div class="haz-legend" aria-label="ความลึกน้ำในแบบจำลอง">' + [1, 2, 3].map(function (k) {
        var c = HAZ_RGBA[k];
        return '<span><i style="background:rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] / 255).toFixed(2) + ')"></i>' + HAZ_T[k] + '</span>';
      }).join('') + '</div>' +
        '<p class="fp-fine">พื้นที่ที่น้ำล้นแม่น้ำท่วมถึงในแบบจำลอง ถ้าเกิดน้ำท่วมใหญ่ระดับรอบ 100 ปี (โอกาสราว 18% ใน 20 ปี) เฉพาะแม่น้ำสายใหญ่ ไม่รวมคันกั้นน้ำ · ' +
        'กด "ตรวจทำเล" หรือคลิกขวาที่แผนที่เพื่อดูรายจุด · ' + GLOFAS_ATTR + '</p>';
    }
    if (state.data.zoning) h += zoneLegendHtml() + '<p class="fp-fine">' + esc(zoneStatusText()) + ' · ' + ZONE_ATTR + '</p>';
    return h;
  }
  if ($('btnSite')) {
    if (IN_ARTIFACT) $('btnSite').hidden = true;
    $('btnSite').addEventListener('click', function () {
      if (SITE.pick) { setSitePick(false); return; }
      if (state.page !== 'chat') setPage('chat');
      setSitePick(true);
    });
  }
  if ($('sitePickX')) $('sitePickX').addEventListener('click', function () { setSitePick(false); });
  if ($('btnExit3d')) $('btnExit3d').addEventListener('click', function () { if (views.chat) setTerrain3d(views.chat, false); });
  if ($('btnTerrain3d')) {
    if (IN_ARTIFACT) $('btnTerrain3d').hidden = true;
    $('btnTerrain3d').addEventListener('click', function () {
      if (state.page !== 'chat') setPage('chat');
      var v = views.chat;
      if (!v) return;
      setTerrain3d(v, !v.terrain3d);
      if (v.terrain3d) toast('ภูมิประเทศ 3 มิติ: ลากด้วยคลิกขวาหรือสองนิ้วเพื่อหมุนและเอียง กดปุ่มเดิมอีกครั้งเพื่อกลับเป็นแผนที่แบน');
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-site-open], [data-site-layer], [data-site-ll], [data-site-close], [data-site-copy]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-site-copy')) {
      var C = SITE.res[t.getAttribute('data-site-copy')];
      if (!C) return;
      var url = location.origin + location.pathname + '#' + (t.getAttribute('data-site-tab') === 'twin' ? 'twin' : 'site') + '=' + C.lat.toFixed(5) + ',' + C.lon.toFixed(5);
      var ok = function () { toast('คัดลอกลิงก์แล้ว ส่งให้คนอื่นเปิดรายงานเดียวกันได้'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { toast(url); });
      else toast(url);
      return;
    }
    if (t.hasAttribute('data-site-close')) { closeSite(); return; }
    if (t.hasAttribute('data-site-open')) { var S = SITE.res[t.getAttribute('data-site-open')]; if (S) openSite(S.lon, S.lat, { tab: t.getAttribute('data-site-tab') || 'risk' }); return; }
    if (t.hasAttribute('data-site-ll')) { var a = t.getAttribute('data-site-ll').split(',').map(Number); openSite(a[0], a[1]); return; }
    var id = t.getAttribute('data-site-layer');
    state.data[id] = !state.data[id];
    saveData(); eachView(refreshLive); renderDataChips(); renderSiteCard();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (PARCEL.on) { e.preventDefault(); parcelEnd(false); return; }
    if (SITE.pick) { e.preventDefault(); setSitePick(false); return; }
    var modal = ($('helpModal') && !$('helpModal').hidden) || ($('ccModal') && !$('ccModal').hidden) || ($('palette') && !$('palette').hidden);
    if (SITE.cur && !modal) closeSite();
  });

  /* ---------- วิเคราะห์ที่ดิน (Digital Twin): ชั้นดิน ภูมิอากาศ ภูมิประเทศ น้ำ และความเหมาะกับพืช ---------- */
  // เหมือนสร้าง "ฝาแฝด" ของแปลงที่ดินในคอมพิวเตอร์: ดึงชั้นดินจากแบบจำลองดินโลก (SoilGrids) ภูมิอากาศเฉลี่ยจาก NASA POWER
  // ความลาดชันจากแผนที่ความสูง และประวัติน้ำจากรายงานทำเล แล้วเทียบกับเกณฑ์ของพืชเศรษฐกิจไทย 8 ชนิด
  // ทุกอย่างคำนวณในเบราว์เซอร์ เรียกข้อมูลเฉพาะตอนผู้ใช้เปิดแท็บนี้ (SoilGrids จำกัด 5 ครั้งต่อนาที)
  var SG_URL = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
  var POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
  var SG_DEPTHS = ['0-5cm', '5-15cm', '15-30cm', '30-60cm', '60-100cm', '100-200cm'];
  var SG_TOP = [0, 5, 15, 30, 60, 100], SG_BOT = [5, 15, 30, 60, 100, 200];
  var SG_ATTR = 'ดิน: <a href="https://soilgrids.org/" target="_blank" rel="noopener">SoilGrids 2.0</a> (ISRIC, CC BY 4.0; Poggio et al. 2021)';
  var POWER_ATTR = 'ภูมิอากาศ: <a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener">NASA POWER</a> (NASA Langley Research Center POWER Project)';
  var TWIN = { tab: 'risk', soilCache: {}, climCache: {}, sgTimes: [] };
  var MON_K = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var MON_D = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var DRY_MM = 60; // เดือนที่ฝนน้อยกว่า 60 มม. นับเป็นเดือนแล้ง
  try { var twC = JSON.parse(localStorage.getItem('cg-twin-soil') || '{}'); if (twC && typeof twC === 'object') TWIN.soilCache = twC; } catch (e) { /* ไม่มีที่เก็บ */ }

  // เนื้อดินตามสามเหลี่ยมเนื้อดิน (USDA) จาก % ทราย ทรายแป้ง ดินเหนียว
  var TEX = {
    S: ['ดินทราย', 'sand'], LS: ['ดินทรายปนร่วน', 'coarse'], SL: ['ดินร่วนปนทราย', 'modcoarse'],
    L: ['ดินร่วน', 'medium'], SiL: ['ดินร่วนปนทรายแป้ง', 'medium'], Si: ['ดินทรายแป้ง', 'medium'],
    SCL: ['ดินร่วนเหนียวปนทราย', 'modfine'], CL: ['ดินร่วนเหนียว', 'modfine'], SiCL: ['ดินร่วนเหนียวปนทรายแป้ง', 'modfine'],
    SC: ['ดินเหนียวปนทราย', 'fine'], SiC: ['ดินเหนียวปนทรายแป้ง', 'fine'], C: ['ดินเหนียว', 'fine']
  };
  var TEX_GRP = { sand: 'ดินทราย', coarse: 'ดินทรายปนร่วน', modcoarse: 'ดินร่วนปนทราย', medium: 'ดินร่วน', modfine: 'ดินร่วนเหนียว', fine: 'ดินเหนียว' };
  var TEX_COL = { sand: '#DCC38B', coarse: '#CDAA6E', modcoarse: '#B98D5A', medium: '#A0754C', modfine: '#8A5E3E', fine: '#704731' };
  function texClass(sa, si, cl) {
    if (sa == null || si == null || cl == null) return null;
    var t = sa + si + cl;
    if (t > 0 && Math.abs(t - 100) > 0.5) { sa = sa * 100 / t; si = si * 100 / t; cl = cl * 100 / t; }
    var k;
    if (si + 1.5 * cl < 15) k = 'S';
    else if (si + 2 * cl < 30) k = 'LS';
    else if (cl >= 40 && si >= 40) k = 'SiC';
    else if (cl >= 35 && sa > 45) k = 'SC';
    else if (cl >= 40) k = 'C';
    else if (cl >= 27 && sa <= 20) k = 'SiCL';
    else if (cl >= 27 && sa <= 45) k = 'CL';
    else if (cl >= 20 && si < 28 && sa > 45) k = 'SCL';
    else if (si >= 80 && cl < 12) k = 'Si';
    else if (si >= 50) k = 'SiL';
    else if (cl >= 7 && si >= 28 && sa <= 52) k = 'L';
    else k = 'SL';
    return { k: k, t: TEX[k][0], grp: TEX[k][1] };
  }
  function phText(p) {
    return p < 4.5 ? 'กรดรุนแรงมาก' : p < 5.1 ? 'กรดจัดมาก' : p < 5.6 ? 'กรดจัด' : p < 6.1 ? 'กรดปานกลาง' : p < 6.6 ? 'กรดเล็กน้อย' :
      p <= 7.3 ? 'เป็นกลาง' : p <= 7.8 ? 'ด่างเล็กน้อย' : p <= 8.4 ? 'ด่างปานกลาง' : 'ด่างจัด';
  }
  function omText(om) {
    return om < 0.5 ? 'ต่ำมาก' : om < 1 ? 'ต่ำ' : om < 1.5 ? 'ค่อนข้างต่ำ' : om < 2.5 ? 'ปานกลาง' : om < 3.5 ? 'ค่อนข้างสูง' : om < 4.5 ? 'สูง' : 'สูงมาก';
  }
  function cecText(c) {
    return c < 3 ? 'ต่ำมาก' : c < 5 ? 'ต่ำ' : c < 10 ? 'ค่อนข้างต่ำ' : c < 15 ? 'ปานกลาง' : c < 20 ? 'ค่อนข้างสูง' : c < 40 ? 'สูง' : 'สูงมาก';
  }
  function nf(n) { return Math.round(n).toLocaleString('en-US'); }

  // ---------- ดึงข้อมูล ----------
  function twinGet(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, { signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function sgParse(j) {
    var out = {}, map = { clay: 'clay', sand: 'sand', silt: 'silt', phh2o: 'ph', soc: 'soc', cec: 'cec', bdod: 'bd', nitrogen: 'n' };
    ((j && j.properties && j.properties.layers) || []).forEach(function (l) {
      var k = map[l.name];
      if (!k) return;
      var f = (l.unit_measure && l.unit_measure.d_factor) || 1;
      out[k] = SG_DEPTHS.map(function (lab) {
        var d = find(l.depths || [], function (x) { return x.label === lab; });
        var v = d && d.values ? d.values.mean : null;
        return v == null ? null : v / f;
      });
    });
    out.ok = !!(out.clay && out.clay.some(function (v) { return v != null; }));
    return out;
  }
  // SoilGrids จำกัด 5 ครั้งต่อนาที: เข้าคิวรอถ้าเกิน
  function soilAt(lon, lat) {
    var key = lat.toFixed(3) + ',' + lon.toFixed(3);
    if (TWIN.soilCache[key]) return Promise.resolve(TWIN.soilCache[key]);
    var now = Date.now();
    TWIN.sgTimes = TWIN.sgTimes.filter(function (t) { return now - t < 60e3; });
    var wait = TWIN.sgTimes.length >= 5 ? 60e3 - (now - TWIN.sgTimes[0]) + 500 : 0;
    TWIN.sgTimes.push(now + wait);
    var url = SG_URL + '?lon=' + lon.toFixed(5) + '&lat=' + lat.toFixed(5) +
      ['clay', 'sand', 'silt', 'phh2o', 'soc', 'cec', 'bdod', 'nitrogen'].map(function (p) { return '&property=' + p; }).join('') +
      SG_DEPTHS.map(function (d) { return '&depth=' + d; }).join('') + '&value=mean';
    var go = function () { return twinGet(url, 45000); };
    return new Promise(function (res) { setTimeout(res, wait); }).then(go).catch(function (e) {
      // ถูกจำกัดความถี่: รอแล้วลองอีกครั้งเดียว
      if (e && e.status === 429) return new Promise(function (res) { setTimeout(res, 15000); }).then(go);
      throw e;
    }).then(function (j) {
      var o = sgParse(j);
      if (o.ok) {
        TWIN.soilCache[key] = o;
        try {
          var ks = Object.keys(TWIN.soilCache);
          if (ks.length > 30) delete TWIN.soilCache[ks[0]];
          localStorage.setItem('cg-twin-soil', JSON.stringify(TWIN.soilCache));
        } catch (er) { /* ข้าม */ }
      }
      return o;
    });
  }
  function climAt(lon, lat) {
    var key = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (TWIN.climCache[key]) return TWIN.climCache[key];
    var p = twinGet(POWER_URL + '?parameters=PRECTOTCORR,T2M,RH2M&community=AG&longitude=' + lon.toFixed(4) + '&latitude=' + lat.toFixed(4) + '&format=JSON', 30000).then(function (j) {
      var P = j && j.properties && j.properties.parameter;
      if (!P || !P.PRECTOTCORR || !P.T2M) throw new Error('no data');
      var fill = (j.header && j.header.fill_value) || -999;
      var rain = MON_K.map(function (k, i) { var v = P.PRECTOTCORR[k]; return v == null || v === fill ? null : v * MON_D[i]; });
      var t = MON_K.map(function (k) { var v = P.T2M[k]; return v == null || v === fill ? null : v; });
      if (rain.some(function (v) { return v == null; }) || t.some(function (v) { return v == null; })) throw new Error('missing');
      var range = (j.header && j.header.range) || '';
      var yrs = /(\d{4})\s*-\s*\w+\s+(\d{4})/.exec(range.replace(/January|December/g, '').replace(/\s+/g, ' ')) || /(\d{4}).*?(\d{4})/.exec(range);
      return {
        rain: rain, t: t, rainAnn: rain.reduce(function (a, b) { return a + b; }, 0),
        tAnn: P.T2M.ANN != null && P.T2M.ANN !== fill ? P.T2M.ANN : t.reduce(function (a, b) { return a + b; }, 0) / 12,
        dry: rain.map(function (v) { return v < DRY_MM; }), years: yrs ? yrs[1] + '–' + yrs[2] : ''
      };
    });
    TWIN.climCache[key] = p;
    p.catch(function () { delete TWIN.climCache[key]; });
    return p;
  }
  // ความลาดชัน: ผลต่างความสูงรอบจุดจากแผนที่ความสูง (ราว 17 ม. ต่อพิกเซลที่ซูม 13) ใช้ค่ามัธยฐานในรัศมีราว 70 ม.
  function slopeAt(lon, lat) {
    var z = 13, n = Math.pow(2, z), r = Math.PI / 180;
    var fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * n;
    var tx = Math.floor(fx), ty = Math.floor(fy);
    var px = Math.max(8, Math.min(247, Math.floor((fx - tx) * 256))), py = Math.max(8, Math.min(247, Math.floor((fy - ty) * 256)));
    return demTile(z, tx, ty).then(function (img) {
      var d = img.data;
      function at(x, y) { var i = (y * 256 + x) * 4; return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768; }
      var m = 40075016 * Math.cos(lat * r) / (n * 256), vals = [], lo = Infinity, hi = -Infinity;
      for (var dy = -4; dy <= 4; dy += 2) for (var dx = -4; dx <= 4; dx += 2) {
        if (dx * dx + dy * dy > 16) continue;
        var x = px + dx, y = py + dy;
        var gx = (at(x + 2, y) - at(x - 2, y)) / (4 * m), gy = (at(x, y + 2) - at(x, y - 2)) / (4 * m);
        vals.push(100 * Math.sqrt(gx * gx + gy * gy));
        lo = Math.min(lo, at(x, y)); hi = Math.max(hi, at(x, y));
      }
      vals.sort(function (a, b) { return a - b; });
      var pct = vals[Math.floor(vals.length / 2)];
      return { pct: pct, cls: slopeCls(pct), relief: hi - lo };
    });
  }
  function slopeCls(p) {
    return p < 2 ? ['A', 'ที่ราบ'] : p < 5 ? ['B', 'ลาดเล็กน้อย'] : p < 12 ? ['C', 'ลาดปานกลาง'] : p < 20 ? ['D', 'ลาดค่อนข้างชัน'] : p < 35 ? ['E', 'ลาดชัน'] : ['F', 'ชันมาก'];
  }
  function twinLoad(S, retry) {
    var T = S.twin || (S.twin = { st: {} });
    function track(k, f) {
      if (T.st[k] === 'loading' || T.st[k] === 'ok' || (T.st[k] === 'err' && !retry)) return;
      T.st[k] = 'loading';
      f().then(function (x) { T[k] = x; T.st[k] = 'ok'; }, function () { T.st[k] = 'err'; }).then(function () { siteChanged(S.key); });
    }
    track('soil', function () { return soilAt(S.lon, S.lat); });
    track('clim', function () { return climAt(S.lon, S.lat); });
    track('slope', function () { return slopeAt(S.lon, S.lat); });
  }

  // ---------- สรุปค่าดินและสภาพแวดล้อม ----------
  function wavg(arr, idx) {
    var s = 0, w = 0;
    idx.forEach(function (i) { var v = arr && arr[i]; if (v != null) { var t = SG_BOT[i] - SG_TOP[i]; s += v * t; w += t; } });
    return w ? s / w : null;
  }
  function twinFacts(S) {
    var T = S.twin || { st: {} }, so = T.soil && T.soil.ok ? T.soil : null, F = { soil: so, clim: T.clim || null, slope: T.slope || null };
    if (so) {
      var top = [0, 1, 2], sub = [3, 4];
      F.top = texClass(wavg(so.sand, top), wavg(so.silt, top), wavg(so.clay, top));
      F.sub = texClass(wavg(so.sand, sub), wavg(so.silt, sub), wavg(so.clay, sub));
      F.ph = wavg(so.ph, top);
      F.soc = wavg(so.soc, top);
      F.om = F.soc != null ? F.soc * 1.724 / 10 : null;
      F.cec = wavg(so.cec, top);
      F.bd = wavg(so.bd, top);
      F.pct = { sand: wavg(so.sand, top), silt: wavg(so.silt, top), clay: wavg(so.clay, top) };
      F.layers = SG_DEPTHS.map(function (d, i) {
        return { top: SG_TOP[i], bot: SG_BOT[i], tex: texClass(so.sand[i], so.silt[i], so.clay[i]), ph: so.ph ? so.ph[i] : null, soc: so.soc ? so.soc[i] : null, clay: so.clay[i] };
      });
    }
    if (F.clim) F.dryN = F.clim.dry.filter(Boolean).length;
    F.flood = twinFloodLv(S);
    F.drain = twinDrain(S, F);
    F.ele = S.ele ? S.ele.ele : null;
    return F;
  }
  function twinFloodLv(S) {
    var g = gswLevel(S.gsw), h = hazLevel(S.haz);
    if (g && g.lv === 'water') return { k: 'water', t: 'จุดนี้เป็นแหล่งน้ำ' };
    if ((g && g.lv === 'often') || (h && h.lv === 'in' && h.rp <= 10)) return { k: 'often', t: g && g.lv === 'often' ? 'ดาวเทียมเห็นน้ำขังบ่อย' : 'แบบจำลองท่วมตั้งแต่รอบ 10 ปี' };
    if ((g && g.lv === 'some') || (h && h.lv === 'in' && h.rp <= 50)) return { k: 'some', t: g && g.lv === 'some' ? 'เคยมีน้ำท่วมหรือน้ำขัง' : 'แบบจำลองท่วมตั้งแต่รอบ ' + h.rp + ' ปี' };
    if ((h && h.lv === 'in') || (g && g.lv === 'near')) return { k: 'rare', t: h && h.lv === 'in' ? 'ท่วมเฉพาะน้ำท่วมใหญ่ (รอบ ' + h.rp + ' ปี)' : 'รอบๆ เคยมีน้ำ' };
    if (!g && !h) return null;
    return { k: 'none', t: 'ไม่พบสัญญาณน้ำท่วม' };
  }
  var DRAIN_T = { poor: 'ระบายน้ำเลว น้ำขังง่าย', mod: 'ระบายน้ำค่อนข้างดี', well: 'ระบายน้ำดี', exc: 'ระบายน้ำเร็วเกินไป เก็บน้ำได้น้อย' };
  var DRAIN_S = { poor: 'ระบายน้ำเลว', mod: 'ค่อนข้างดี', well: 'ระบายน้ำดี', exc: 'เร็วเกินไป' };
  // การระบายน้ำ (ประเมิน ไม่ได้วัดจริง): เริ่มจากเนื้อดิน แล้วปรับตามประวัติน้ำขัง ที่ลุ่ม และความลาดชัน
  function twinDrain(S, F) {
    var order = ['poor', 'mod', 'well', 'exc'], g = gswLevel(S.gsw), sl = F.slope ? F.slope.pct : null, why = [];
    var grp = F.top ? F.top.grp : null;
    if (!grp) return g && g.lv === 'often' ? { k: 'poor', why: ['ดาวเทียมเห็นน้ำขังบ่อย'] } : null;
    var i = { sand: 3, coarse: 3, modcoarse: 2, medium: 2, modfine: 1, fine: 1 }[grp];
    why.push(F.top.t);
    if (grp === 'fine' && (sl == null || sl < 2)) { i -= 1; why.push('บนที่ราบ'); }
    if (g && g.lv === 'often') { i -= 2; why.push('ดาวเทียมเห็นน้ำขังบ่อย'); }
    else if (g && g.lv === 'some') { i -= 1; why.push('เคยมีน้ำขัง'); }
    if (S.ele && S.ele.pct <= 0.15 && (sl == null || sl < 2)) { i -= 1; why.push('อยู่ที่ลุ่ม'); }
    if (sl != null && sl >= 5) { i += 1; why.push('พื้นลาด น้ำไหลออกเร็ว'); }
    return { k: order[Math.max(0, Math.min(3, i))], why: why };
  }

  // ---------- เกณฑ์พืช: เรียบเรียงจากตารางความเหมาะสมของที่ดิน กรมพัฒนาที่ดิน และ FAO ECOCROP (ปรับให้ใช้กับข้อมูลระดับโลก) ----------
  // ช่วงค่า [เหมาะมากต่ำ, เหมาะมากสูง, ปานกลางต่ำ, ปานกลางสูง, เหมาะน้อยต่ำ, เหมาะน้อยสูง] นอกช่วงสุดท้าย = ไม่เหมาะ
  // tex/drain: 1 เหมาะมาก 2 ปานกลาง 3 เหมาะน้อย 4 ไม่เหมาะ · slope/elev/dry: [เหมาะมากไม่เกิน, ปานกลางไม่เกิน, เหมาะน้อยไม่เกิน]
  var CROPS = [
    { id: 'rice', t: 'ข้าว (นาน้ำฝน)', type: 'rice', temp: [22, 30, 20, 33, 18, 35], rain: [1200, 2500, 1000, 3000, 800, 4000], ph: [5.5, 7.3, 5.0, 7.8, 4.0, 8.5],
      tex: { fine: 1, modfine: 1, medium: 2, modcoarse: 3, coarse: 4, sand: 4 }, drain: { poor: 1, mod: 1, well: 3, exc: 4 }, slope: [2, 5, 12] },
    { id: 'cassava', t: 'มันสำปะหลัง', type: 'field', temp: [25, 29, 22, 32, 18, 35], rain: [1000, 1500, 800, 2000, 500, 3000], ph: [5.5, 7.3, 4.8, 7.8, 4.0, 8.5],
      tex: { coarse: 1, modcoarse: 1, medium: 2, modfine: 2, fine: 3, sand: 3 }, drain: { well: 1, exc: 1, mod: 2, poor: 4 }, slope: [5, 12, 20] },
    { id: 'sugarcane', t: 'อ้อย', type: 'field', temp: [24, 32, 21, 35, 15, 40], rain: [1400, 2500, 1100, 3000, 900, 5000], ph: [5.6, 7.3, 5.0, 8.0, 4.5, 9.0],
      tex: { modfine: 1, medium: 1, modcoarse: 2, fine: 2, coarse: 3, sand: 4 }, drain: { well: 1, mod: 1, exc: 2, poor: 3 }, slope: [5, 12, 20] },
    { id: 'maize', t: 'ข้าวโพดเลี้ยงสัตว์', type: 'field', temp: [24, 30, 20, 33, 15, 38], rain: [800, 1500, 600, 2000, 400, 2800], ph: [5.5, 7.3, 5.0, 7.8, 4.5, 8.5],
      tex: { modcoarse: 1, medium: 1, modfine: 1, fine: 2, coarse: 3, sand: 4 }, drain: { well: 1, mod: 2, exc: 2, poor: 4 }, slope: [5, 12, 20] },
    { id: 'rubber', t: 'ยางพารา', type: 'tree', temp: [24, 30, 22, 32, 20, 34], rain: [1500, 2500, 1250, 3000, 1000, 4000], ph: [4.5, 6.5, 4.0, 7.3, 3.5, 8.0],
      tex: { modcoarse: 1, medium: 1, modfine: 1, fine: 2, coarse: 3, sand: 4 }, drain: { well: 1, mod: 2, exc: 2, poor: 4 }, slope: [12, 20, 35], elev: [300, 600, 900], dry: [3, 4, 6] },
    { id: 'palm', t: 'ปาล์มน้ำมัน', type: 'tree', temp: [24, 30, 22, 33, 18, 36], rain: [2000, 3000, 1600, 4000, 1200, 6000], ph: [4.5, 6.0, 4.0, 7.0, 3.5, 8.0],
      tex: { medium: 1, modfine: 1, fine: 1, modcoarse: 2, coarse: 3, sand: 4 }, drain: { mod: 1, well: 1, exc: 3, poor: 3 }, slope: [12, 20, 35], elev: [300, 500, 1000], dry: [1, 3, 4] },
    { id: 'durian', t: 'ทุเรียน', type: 'tree', temp: [24, 30, 22, 32, 20, 34], rain: [1600, 2500, 1300, 3000, 1000, 4000], ph: [5.5, 6.5, 5.0, 7.0, 4.5, 7.8],
      tex: { medium: 1, modfine: 1, modcoarse: 2, fine: 3, coarse: 3, sand: 4 }, drain: { well: 1, mod: 2, exc: 3, poor: 4 }, slope: [12, 20, 35], elev: [600, 800, 1200], dry: [3, 5, 6] },
    { id: 'mango', t: 'มะม่วง', type: 'tree', temp: [24, 30, 21, 33, 15, 38], rain: [1000, 1800, 700, 2500, 400, 3500], ph: [5.5, 7.3, 5.0, 7.8, 4.5, 8.5],
      tex: { medium: 1, modfine: 1, modcoarse: 2, fine: 2, coarse: 3, sand: 4 }, drain: { well: 1, mod: 1, exc: 2, poor: 4 }, slope: [12, 20, 35], elev: [800, 1200, 1500], dryMin: [3, 2, 1] }
  ];
  var CLS_T = ['ยังไม่ทราบ', 'เหมาะมาก', 'เหมาะปานกลาง', 'เหมาะน้อย', 'ไม่เหมาะ'];
  var CLS_C = ['#8A93A3', '#2FA36B', '#7DAE2E', '#E0A526', '#E5484D'];
  function rCls(v, r) { return v == null ? 0 : v >= r[0] && v <= r[1] ? 1 : v >= r[2] && v <= r[3] ? 2 : v >= r[4] && v <= r[5] ? 3 : 4; }
  function maxCls(v, t) { return v == null ? 0 : v <= t[0] ? 1 : v <= t[1] ? 2 : v <= t[2] ? 3 : 4; }
  function minCls(v, t) { return v == null ? 0 : v >= t[0] ? 1 : v >= t[1] ? 2 : v >= t[2] ? 3 : 4; }
  function s1List(m, names) { return Object.keys(m).filter(function (k) { return m[k] === 1; }).map(function (k) { return names[k]; }).join(', '); }
  function cropSuit(c, F) {
    var f = [], C = F.clim;
    f.push({ t: 'อุณหภูมิเฉลี่ยทั้งปี', v: C ? C.tAnn.toFixed(1) + ' °C' : '', need: c.temp[0] + '–' + c.temp[1] + ' °C', c: rCls(C ? C.tAnn : null, c.temp) });
    f.push({ t: 'ฝนทั้งปี', v: C ? nf(C.rainAnn) + ' มม.' : '', need: nf(c.rain[0]) + '–' + nf(c.rain[1]) + ' มม.', c: rCls(C ? C.rainAnn : null, c.rain), water: true });
    if (c.dry) f.push({ t: 'เดือนแล้ง (ฝน <' + DRY_MM + ' มม.)', v: C ? F.dryN + ' เดือน' : '', need: 'ไม่เกิน ' + c.dry[0] + ' เดือน', c: maxCls(C ? F.dryN : null, c.dry), water: true });
    if (c.dryMin) f.push({ t: 'เดือนแล้ง (ช่วยออกดอก)', v: C ? F.dryN + ' เดือน' : '', need: 'อย่างน้อย ' + c.dryMin[0] + ' เดือน', c: minCls(C ? F.dryN : null, c.dryMin) });
    f.push({ t: 'pH ดินบน', v: F.ph != null ? F.ph.toFixed(1) : '', need: c.ph[0] + '–' + c.ph[1], c: rCls(F.ph, c.ph), fix: 'lime' });
    f.push({ t: 'เนื้อดินบน', v: F.top ? F.top.t : '', need: s1List(c.tex, TEX_GRP), c: F.top ? c.tex[F.top.grp] : 0 });
    f.push({ t: 'การระบายน้ำ (ประเมิน)', v: F.drain ? DRAIN_S[F.drain.k] : '', need: s1List(c.drain, DRAIN_S), c: F.drain ? c.drain[F.drain.k] : 0, fix: 'drain' });
    f.push({ t: 'ความลาดชัน', v: F.slope ? F.slope.pct.toFixed(1) + '%' : '', need: 'ไม่เกิน ' + c.slope[0] + '%', c: maxCls(F.slope ? F.slope.pct : null, c.slope) });
    if (c.elev) f.push({ t: 'ความสูง', v: F.ele != null ? nf(F.ele) + ' ม.' : '', need: 'ไม่เกิน ' + nf(c.elev[0]) + ' ม.', c: maxCls(F.ele, c.elev) });
    var fl = F.flood, fc = 0;
    if (fl) {
      var tbl = c.type === 'rice' ? { none: 1, rare: 1, some: 1, often: 2 } : c.type === 'field' ? { none: 1, rare: 1, some: 2, often: 3 } : { none: 1, rare: 2, some: 3, often: 4 };
      fc = fl.k === 'water' ? 4 : tbl[fl.k];
    }
    f.push({ t: 'น้ำท่วม', v: fl ? fl.t : '', need: c.type === 'rice' ? 'ทนน้ำขังได้ แต่ไม่ชอบน้ำลึก' : c.type === 'field' ? 'ไม่ชอบน้ำขังนาน' : 'ไม่ทนน้ำท่วมขัง (รากเน่า ต้นตาย)', c: fc });
    var known = f.filter(function (x) { return x.c > 0; });
    var cls = known.length ? Math.max.apply(null, known.map(function (x) { return x.c; })) : 0;
    var sum = known.reduce(function (a, x) { return a + x.c; }, 0) + (f.length - known.length) * 2;
    return { c: c, f: f, cls: cls, score: cls * 100 + sum, lim: cls > 1 ? f.filter(function (x) { return x.c === cls; }) : [], partial: known.length < f.length };
  }
  function twinCrops(F) {
    if (!F.clim && !F.soil) return [];
    return CROPS.map(function (c) { return cropSuit(c, F); }).sort(function (a, b) { return a.score - b.score; });
  }
  function limText(x) {
    if (x.t === 'น้ำท่วม') return 'เสี่ยงน้ำท่วมขัง';
    if (x.t === 'การระบายน้ำ (ประเมิน)') return DRAIN_T[x.v === 'ระบายน้ำเลว' ? 'poor' : x.v === 'เร็วเกินไป' ? 'exc' : 'mod'] || x.v;
    return x.t + ' ' + x.v + ' (ต้องการ ' + x.need + ')';
  }

  // ---------- วาด ----------
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (x) { return Math.max(0, Math.min(255, Math.round(k < 0 ? x * (1 + k) : x + (255 - x) * k))); };
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  // บล็อกดิน 3 มิติแบบไอโซเมตริก: ผิวดินด้านบน ชั้นดิน 0–200 ซม. ด้านหน้า (ความลึกสเกลรากที่สอง ชั้นบนบางจึงยังอ่านได้)
  function soilBlockSvg(F) {
    var X0 = 30, X1 = 128, Y0 = 34, H = 176, DX = 30, DY = 16;
    var yOf = function (d) { return Y0 + H * Math.sqrt(d / 200); };
    var s = '<svg class="tw-block" viewBox="0 0 330 232" role="img" aria-label="ภาพตัดชั้นดินลึก 2 เมตรจากแบบจำลอง">';
    s += '<polygon points="' + [X0, Y0, X0 + DX, Y0 - DY, X1 + DX, Y0 - DY, X1, Y0].join(',') + '" fill="#5E8F3E"/>';
    for (var gx = 0; gx < 9; gx++) {
      var bx = X0 + 8 + gx * 11 + (gx % 2) * 6, by = Y0 - 3 - (gx % 3) * 4;
      s += '<path d="M' + bx + ' ' + by + 'l-2 -5M' + bx + ' ' + by + 'l2 -6M' + bx + ' ' + by + 'l5 -4" stroke="#8CC063" stroke-width="1.3" stroke-linecap="round" fill="none"/>';
    }
    F.layers.forEach(function (L, i) {
      var y0 = yOf(L.top), y1 = yOf(L.bot), grp = L.tex ? L.tex.grp : 'medium';
      var col = shade(TEX_COL[grp], -Math.min(0.38, (L.soc || 0) / 70));
      s += '<rect x="' + X0 + '" y="' + y0.toFixed(1) + '" width="' + (X1 - X0) + '" height="' + (y1 - y0 + 0.4).toFixed(1) + '" fill="' + col + '"/>';
      s += '<polygon points="' + [X1, y0, X1 + DX, y0 - DY, X1 + DX, y1 - DY, X1, y1].map(function (v) { return v.toFixed ? v.toFixed(1) : v; }).join(',') + '" fill="' + shade(col, -0.22) + '"/>';
      if (i) s += '<line x1="' + X0 + '" x2="' + X1 + '" y1="' + y0.toFixed(1) + '" y2="' + y0.toFixed(1) + '" stroke="rgba(0,0,0,.18)"/>';
      var ym = (y0 + y1) / 2;
      s += '<text class="tw-bl" x="' + (X1 + DX + 8) + '" y="' + (ym - DY / 2 + 4).toFixed(1) + '">' + esc(L.tex ? L.tex.t.replace(/^ดิน/, '') : '—') +
        (L.ph != null ? ' · pH ' + L.ph.toFixed(1) : '') + '</text>';
    });
    [0, 30, 100, 200].forEach(function (d) {
      var y = yOf(d);
      s += '<line x1="' + (X0 - 5) + '" x2="' + X0 + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="tw-ax"/>' +
        '<text class="tw-dl" x="' + (X0 - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + d + '</text>';
    });
    s += '<text class="tw-dl" x="' + (X0 - 8) + '" y="' + (Y0 + H + 16) + '" text-anchor="end">ซม.</text>';
    return s + '</svg>';
  }
  function climChartSvg(C) {
    var W = 330, Hh = 150, L = 34, R = 30, T = 12, B = 24, w = (W - L - R) / 12;
    var mx = Math.max.apply(null, C.rain), top = mx <= 100 ? 100 : mx <= 200 ? 200 : mx <= 300 ? 300 : mx <= 400 ? 400 : Math.ceil(mx / 100) * 100;
    var tmin = Math.floor(Math.min.apply(null, C.t) - 1), tmax = Math.ceil(Math.max.apply(null, C.t) + 1);
    var y = function (v) { return T + (Hh - T - B) * (1 - v / top); }, yt = function (v) { return T + (Hh - T - B) * (1 - (v - tmin) / (tmax - tmin)); };
    var s = '<svg class="tw-chart" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="ฝนและอุณหภูมิรายเดือนเฉลี่ย ฝนรวม ' + nf(C.rainAnn) + ' มม. ต่อปี">';
    [0, top / 2, top].forEach(function (v) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="tw-grid"/>' +
        '<text class="tw-dl" x="' + (L - 5) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });
    [tmin, tmax].forEach(function (v) { s += '<text class="tw-dl tw-tl" x="' + (W - R + 5) + '" y="' + (yt(v) + 3.5).toFixed(1) + '">' + v + '°</text>'; });
    C.rain.forEach(function (v, i) {
      var x = L + i * w + w * 0.16, bw = w * 0.68;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(0) - y(v)).toFixed(1) + '" rx="2" class="' + (C.dry[i] ? 'tw-dry' : 'tw-wet') + '"><title>' +
        TH_MON[i] + ' ฝน ' + nf(v) + ' มม. · ' + C.t[i].toFixed(1) + ' °C</title></rect>' +
        '<text class="tw-ml" x="' + (L + i * w + w / 2).toFixed(1) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + TH_MON_S[i].replace(/\./g, '') + '</text>';
    });
    s += '<polyline class="tw-tline" points="' + C.t.map(function (v, i) { return (L + i * w + w / 2).toFixed(1) + ',' + yt(v).toFixed(1); }).join(' ') + '"/>';
    C.t.forEach(function (v, i) { s += '<circle class="tw-tdot" cx="' + (L + i * w + w / 2).toFixed(1) + '" cy="' + yt(v).toFixed(1) + '" r="2.4"/>'; });
    return s + '</svg>';
  }
  function dryRangeText(dry) {
    // ช่วงเดือนแล้งต่อเนื่อง (ข้ามปีได้) เช่น พ.ย.–มี.ค.
    if (!dry.some(Boolean)) return '';
    if (dry.every(Boolean)) return 'ทั้งปี';
    var start = -1;
    for (var i = 0; i < 12; i++) if (dry[i] && !dry[(i + 11) % 12]) { start = i; break; }
    var runs = [], j = start;
    for (var n = 0; n < 12; n++) {
      var k = (start + n) % 12;
      if (dry[k] && !dry[(k + 11) % 12]) j = k;
      if (dry[k] && !dry[(k + 1) % 12]) runs.push(j === k ? TH_MON_S[k] : TH_MON_S[j] + '–' + TH_MON_S[k]);
    }
    return runs.join(', ');
  }
  function twinTips(F) {
    var t = [];
    if (F.ph != null && F.ph < 5.1) t.push('ดินเป็นกรดจัด พืชส่วนใหญ่ต้องปรับด้วยปูนโดโลไมท์หรือปูนมาร์ล ใส่ตามผลตรวจดิน');
    else if (F.ph != null && F.ph < 5.6) t.push('ดินค่อนข้างเป็นกรด พืชไร่และไม้ผลหลายชนิดต้องปรับด้วยปูน (ยางพาราและปาล์มทนกรดได้ดีกว่า)');
    else if (F.ph != null && F.ph > 7.8) t.push('ดินเป็นด่าง ธาตุเหล็ก สังกะสี และแมงกานีสอาจขาด ใช้ปุ๋ยอินทรีย์และกำมะถันช่วย');
    if (F.om != null && F.om < 1.5) t.push('อินทรียวัตถุต่ำ ควรเพิ่มปุ๋ยหมัก ปุ๋ยคอก หรือไถกลบพืชปุ๋ยสด');
    if (F.top && (F.top.grp === 'sand' || F.top.grp === 'coarse')) t.push('ดินทราย เก็บน้ำและปุ๋ยได้น้อย ต้องให้น้ำบ่อยและแบ่งใส่ปุ๋ยหลายครั้ง');
    if (F.drain && F.drain.k === 'poor') t.push('น้ำขังง่าย เหมาะทำนา ถ้าจะปลูกไม้ผลหรือพืชไร่ต้องยกร่องหรือขุดทางระบายน้ำ');
    if (F.slope && F.slope.pct >= 12) t.push('พื้นที่ลาดชัน ควรปลูกตามแนวระดับ ทำขั้นบันได หรือปลูกหญ้าแฝก กันหน้าดินถูกชะ');
    if (F.flood && F.flood.k === 'often') t.push('ที่น้ำท่วมขังบ่อย ไม้ผลยืนต้นเสี่ยงตาย เหมาะกับข้าวหรือพืชอายุสั้นนอกฤดูน้ำหลาก');
    if (F.dryN >= 5) t.push('แล้งนานราว ' + F.dryN + ' เดือนต่อปี ไม้ผลและยางพาราต้องมีแหล่งน้ำสำรอง เช่น สระหรือบ่อบาดาล');
    if (F.bd != null && F.bd >= 1.6) t.push('ดินบนค่อนข้างแน่น รากชอนไชยาก ควรไถระเบิดดินดานและเพิ่มอินทรียวัตถุ');
    return t;
  }
  function raiText(m2) {
    var w = Math.round(m2 / 4 * 10) / 10, rai = Math.floor(w / 400), ngan = Math.floor((w - rai * 400) / 100), wa = Math.round((w - rai * 400 - ngan * 100) * 10) / 10;
    return (rai ? rai + ' ไร่ ' : '') + (rai || ngan ? ngan + ' งาน ' : '') + wa.toFixed(wa % 1 ? 1 : 0) + ' ตร.วา';
  }
  function twinHtml(S) {
    var T = S.twin || { st: {} }, F = twinFacts(S), h = '', st = T.st;
    var busy = st.soil === 'loading' || st.clim === 'loading' || st.slope === 'loading';
    if (F.flood && F.flood.k === 'water') return '<div class="sv-verdict" style="--c:' + SV_C.water + '"><b><i></i>จุดนี้เป็นแหล่งน้ำ</b><ul><li>ภาพดาวเทียมเห็นน้ำตรงนี้เกือบตลอด 41 ปี ลองแตะจุดบนบกใกล้ๆ อีกครั้ง</li></ul></div>';
    var crops = twinCrops(F);
    // 1) สรุปพืช
    if (crops.length) {
      var good = crops.filter(function (x) { return x.cls === 1 || x.cls === 2; });
      h += '<div class="sv-verdict tw-sum" style="--c:' + (good.length ? CLS_C[good[0].cls] : CLS_C[3]) + '"><b><i></i>' +
        (good.length ? 'พืชที่เข้ากับที่ดินนี้มากที่สุด: ' + good.slice(0, 3).map(function (x) { return x.c.t.replace(/ \(.+\)/, ''); }).join(', ') : 'ไม่มีพืชในรายการที่เหมาะมากหรือปานกลาง') + '</b>' +
        '<ul>' + (good.length ? good.slice(0, 3).map(function (x) { return '<li>' + esc(x.c.t) + ' · ' + CLS_T[x.cls] + (x.lim.length ? ' (ข้อจำกัด: ' + esc(x.lim.map(limText).slice(0, 2).join(', ')) + ')' : '') + '</li>'; }).join('')
          : '<li>ถ้าจะปลูก ต้องปรับดิน ทำทางระบายน้ำ หรือหาแหล่งน้ำ ดูข้อจำกัดของแต่ละพืชด้านล่าง</li>') +
        (busy ? '<li class="sv-load">ยังโหลดข้อมูลไม่ครบ ผลอาจเปลี่ยน</li>' : '') +
        (!F.soil && st.soil !== 'loading' ? '<li><b>ยังไม่มีข้อมูลดิน</b> ผลนี้ดูแค่ภูมิอากาศ ความลาดชัน และน้ำท่วม ยังไม่รวมเนื้อดิน pH และการระบายน้ำ' +
          (st.soil === 'err' ? ' <button type="button" class="btn-ghost sv-btn" data-twin-retry="' + esc(S.key) + '">โหลดข้อมูลดินอีกครั้ง</button>' : '') + '</li>' : '') + '</ul></div>';
    } else if (busy) h += '<div class="sv-verdict"><span class="sv-load">กำลังสร้างแบบจำลองที่ดิน: อ่านชั้นดินจาก SoilGrids (อาจใช้ 10–20 วินาที) ภูมิอากาศจาก NASA และความลาดชัน…</span></div>';
    else h += '<div class="sv-verdict">อ่านข้อมูลดินและภูมิอากาศไม่ได้ตอนนี้ <button type="button" class="btn-ghost sv-btn" data-twin-retry="' + esc(S.key) + '">ลองใหม่</button></div>';
    // 2) ตัวเลขหลัก
    function tile(lab, val, sub, s) {
      return '<div class="sv-tile"><span class="sv-lab">' + lab + '</span><b>' + (s === 'loading' ? '<span class="sv-load">กำลังอ่าน…</span>' : s === 'err' ? 'อ่านไม่ได้' : esc(val || '—')) + '</b>' + (sub && s === 'ok' ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    }
    var sS = T.soil && !T.soil.ok && st.soil === 'ok' ? 'none' : st.soil;
    h += '<div class="sv-grid">' +
      tile('เนื้อดินบน 0–30 ซม.', F.top ? F.top.t : (sS === 'none' ? 'ไม่มีข้อมูล' : ''), F.pct ? 'ทราย ' + Math.round(F.pct.sand) + '% · ทรายแป้ง ' + Math.round(F.pct.silt) + '% · เหนียว ' + Math.round(F.pct.clay) + '%' : '', sS === 'none' ? 'ok' : st.soil) +
      tile('ความเป็นกรด-ด่าง', F.ph != null ? 'pH ' + F.ph.toFixed(1) : '', F.ph != null ? phText(F.ph) : '', sS === 'none' ? 'ok' : st.soil) +
      tile('อินทรียวัตถุ', F.om != null ? F.om.toFixed(1) + '%' : '', F.om != null ? omText(F.om) + (F.cec != null ? ' · เก็บธาตุอาหาร (CEC) ' + cecText(F.cec) : '') : '', sS === 'none' ? 'ok' : st.soil) +
      tile('ฝนเฉลี่ยต่อปี', F.clim ? nf(F.clim.rainAnn) + ' มม.' : '', F.clim ? 'แล้ง ' + F.dryN + ' เดือน' + (F.dryN ? ' (' + dryRangeText(F.clim.dry) + ')' : '') : '', st.clim) +
      tile('ความลาดชัน', F.slope ? F.slope.pct.toFixed(1) + '% · ' + F.slope.cls[1] : '', F.slope ? 'ชั้น ' + F.slope.cls[0] + ' · สูง ' + (F.ele != null ? nf(F.ele) + ' ม.' : '–') : '', st.slope) +
      tile('การระบายน้ำ (ประเมิน)', F.drain ? DRAIN_S[F.drain.k] : '', F.drain ? F.drain.why.join(' · ') : '', F.drain ? 'ok' : st.soil === 'loading' ? 'loading' : 'ok') +
      '</div>';
    // 3) ภาพตัดชั้นดิน
    h += '<section class="sv-sec"><h3>ภาพตัดชั้นดิน 2 เมตร <small>แบบจำลอง SoilGrids ความละเอียด 250 ม.</small></h3>';
    if (st.soil === 'loading') h += '<p class="sv-load">กำลังอ่านชั้นดิน (อาจใช้ 10–20 วินาที)…</p>';
    else if (st.soil === 'err') h += '<p>อ่านข้อมูลดินจาก SoilGrids ไม่ได้ตอนนี้ (บริการอาจปิดปรับปรุงหรือมีคนใช้มาก) <button type="button" class="btn-ghost sv-btn" data-twin-retry="' + esc(S.key) + '">ลองใหม่</button></p>';
    else if (!F.soil) h += '<p>SoilGrids ไม่มีข้อมูลดินตรงจุดนี้ (อาจเป็นแหล่งน้ำหรือเขตเมืองหนาแน่น)</p>';
    else {
      h += '<div class="tw-blockwrap">' + soilBlockSvg(F) + '</div>';
      if (F.sub && F.top && F.sub.k !== F.top.k) h += '<p>ดินล่าง (30–100 ซม.) เป็น<b>' + esc(F.sub.t) + '</b>' + (F.sub.grp === 'fine' && F.top.grp !== 'fine' ? ' น้ำซึมลงช้า อาจมีน้ำขังใต้ดินช่วงฝนชุก' : '') + '</p>';
      var tips = twinTips(F);
      if (tips.length) h += '<ul class="tw-tips">' + tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    h += '</section>';
    // 4) ภูมิอากาศ
    h += '<section class="sv-sec"><h3>ฝนและอุณหภูมิตลอดปี <small>ค่าเฉลี่ย NASA POWER' + (F.clim && F.clim.years ? ' ' + esc(F.clim.years) : '') + '</small></h3>';
    if (st.clim === 'loading') h += '<p class="sv-load">กำลังอ่านภูมิอากาศ…</p>';
    else if (!F.clim) h += '<p>อ่านข้อมูลภูมิอากาศไม่ได้ตอนนี้</p>';
    else {
      var wet = F.clim.rain.indexOf(Math.max.apply(null, F.clim.rain));
      h += '<div class="tw-leg"><span><i class="tw-wet"></i>ฝน (มม./เดือน)</span><span><i class="tw-dry"></i>เดือนแล้ง (&lt;' + DRY_MM + ' มม.)</span><span><i class="tw-tl"></i>อุณหภูมิเฉลี่ย (°C)</span></div>' + climChartSvg(F.clim) +
        '<p>ฝนรวม <b>' + nf(F.clim.rainAnn) + ' มม./ปี</b> ชุกสุดเดือน' + TH_MON[wet] + ' (' + nf(F.clim.rain[wet]) + ' มม.) · อุณหภูมิเฉลี่ย ' + F.clim.tAnn.toFixed(1) + ' °C' +
        (F.dryN ? ' · แล้ง ' + F.dryN + ' เดือน (' + dryRangeText(F.clim.dry) + ')' : ' · ไม่มีเดือนที่แล้งจัด') + '</p>' +
        '<p class="sv-note">ค่าจากแบบจำลองภูมิอากาศความละเอียดราว 50 กม. ใช้ดูฤดูกาลโดยรวม ฝนในพื้นที่จริงต่างกันได้มากโดยเฉพาะแถบภูเขา</p>';
    }
    h += '</section>';
    // 5) พืชทีละชนิด
    if (crops.length) {
      h += '<section class="sv-sec"><h3>ความเหมาะกับพืชเศรษฐกิจ <small>กดชื่อพืชเพื่อดูทีละปัจจัย</small></h3><div class="tw-crops">' + crops.map(function (x) {
        return '<details class="tw-crop"><summary><span class="tw-cn">' + esc(x.c.t) + '</span><span class="tw-cls" style="--c:' + CLS_C[x.cls] + '">' + CLS_T[x.cls] + '</span>' +
          (x.lim.length ? '<span class="tw-lim">' + esc(x.lim.map(limText).join(' · ')) + '</span>' : x.cls === 1 ? '<span class="tw-lim">ไม่พบข้อจำกัดจากข้อมูลที่มี</span>' : '') + '</summary>' +
          '<table class="sv-table tw-ft"><thead><tr><th>ปัจจัย</th><th>ที่จุดนี้</th><th>พืชนี้ชอบ</th><th></th></tr></thead><tbody>' + x.f.map(function (y) {
            return '<tr><td>' + esc(y.t) + '</td><td>' + esc(y.v || '–') + '</td><td>' + esc(y.need) + '</td><td><i class="tw-dot" style="background:' + CLS_C[y.c] + '" title="' + CLS_T[y.c] + '"></i></td></tr>';
          }).join('') + '</tbody></table></details>';
      }).join('') + '</div><p class="sv-note">ประเมินแบบอาศัยน้ำฝน ถ้ามีชลประทาน สระ หรือบ่อบาดาล ข้อจำกัดเรื่องฝนและเดือนแล้งจะลดลง · pH และการระบายน้ำแก้ได้บางส่วนด้วยปูนและการยกร่อง · ' +
        'เกณฑ์เรียบเรียงจากตารางความเหมาะสมของที่ดินของกรมพัฒนาที่ดินและ FAO ECOCROP แบบย่อ ไม่รวมราคา ตลาด แรงงาน และโรคพืช</p></section>';
    }
    // 6) แปลงที่ดิน + 3 มิติ
    var P = S.parcel;
    h += '<section class="sv-sec"><h3>แปลงและภูมิประเทศ <small>วาดขอบเขต วัดเนื้อที่ ดู 3 มิติ</small></h3>';
    if (P) {
      h += '<p>เนื้อที่ราว <b>' + raiText(P.m2) + '</b> (' + nf(P.m2) + ' ตร.ม.) · เส้นรอบแปลง ' + nf(P.perim) + ' ม. · ' + P.pts.length + ' มุม</p>' +
        '<label class="tw-price"><span>ราคาที่เสนอขาย (บาท)</span><input id="twinPrice" type="text" inputmode="numeric" autocomplete="off" placeholder="เช่น 2500000" value="' + (P.price ? esc(String(P.price)) : '') + '"></label>' +
        '<p class="tw-pout" id="twinPriceOut">' + priceText(P) + '</p>';
    } else h += '<p>วาดขอบเขตแปลงบนแผนที่เพื่อวัดเนื้อที่เป็นไร่-งาน-ตารางวา และคิดราคาต่อไร่ (ค่าจากแผนที่ ไม่ใช่การรังวัด)</p>';
    h += '<div class="tw-acts"><button type="button" class="btn-ghost sv-btn" data-twin-draw="' + esc(S.key) + '">' + (P ? 'วาดแปลงใหม่' : 'วาดขอบเขตแปลง') + '</button>' +
      (P ? '<button type="button" class="btn-ghost sv-btn" data-twin-clear="' + esc(S.key) + '">ลบแปลง</button>' : '') +
      '<button type="button" class="btn-ghost sv-btn" data-twin-3d="' + esc(S.key) + '">ดูภูมิประเทศ 3 มิติ</button></div>';
    var g = S.gsw;
    if (g && g.permNear != null && !(g.tr && GSW_PERM[g.tr])) h += '<p>แหล่งน้ำถาวรใกล้สุด (แม่น้ำ คลอง สระ) ห่าง' + mText(g.permNear) + ' จากภาพดาวเทียม</p>';
    h += '</section>';
    // 7) ตรวจต่อ
    h += '<section class="sv-sec"><h3>ตรวจดินจริงก่อนตัดสินใจ</h3><p>เก็บตัวอย่างดินลึก 0–30 ซม. หลายจุดในแปลง ส่งตรวจที่สถานีพัฒนาที่ดินประจำจังหวัด หรือขอคำแนะนำจากหมอดินอาสาในพื้นที่</p><div class="sv-links">' +
      '<a class="src-link" href="https://tswc.ldd.go.th/DownloadGIS/Index_Soil.html" target="_blank" rel="noopener">แผนที่ชุดดิน กรมพัฒนาที่ดิน' + ICO.ext + '</a>' +
      '<a class="src-link" href="https://agri-map-online.moac.go.th/" target="_blank" rel="noopener">Agri-Map กระทรวงเกษตรฯ' + ICO.ext + '</a>' +
      '<a class="src-link" href="https://soilgrids.org/" target="_blank" rel="noopener">SoilGrids' + ICO.ext + '</a></div></section>';
    h += '<div class="sv-share"><button type="button" class="btn-ghost sv-btn" data-site-copy="' + esc(S.key) + '" data-site-tab="twin">คัดลอกลิงก์รายงานนี้</button></div>';
    h += '<p class="sv-foot">ดิจิทัลทวินนี้สร้างจากแบบจำลองระดับโลก ค่าดินที่จุดหนึ่งอาจต่างจากดินจริงในแปลงมาก (SoilGrids ประเมินจากตัวอย่างดินทั่วโลก ความละเอียด 250 ม.) ใช้คัดกรองเบื้องต้นก่อนไปดูที่ ไม่ใช่ผลวิเคราะห์ดินหรือคำแนะนำการลงทุน · ' +
      SG_ATTR + ' · ' + POWER_ATTR + ' · ' + DEM_ATTR + '</p>';
    return h;
  }
  function priceText(P) {
    if (!P || !P.price || !P.m2) return '';
    var rai = P.m2 / 1600, wa = P.m2 / 4;
    return 'ตกไร่ละ <b>' + nf(P.price / rai) + '</b> บาท · ตารางวาละ <b>' + nf(P.price / wa) + '</b> บาท';
  }
  function twinAnswerText(S) {
    var T = S.twin || { st: {} }, F = twinFacts(S), st = T.st;
    if (st.soil === 'loading' || st.clim === 'loading') return 'กำลังอ่านชั้นดินจาก SoilGrids และภูมิอากาศจาก NASA (อาจใช้ 10–20 วินาที)…';
    var crops = twinCrops(F), good = crops.filter(function (x) { return x.cls === 1 || x.cls === 2; });
    var parts = [];
    if (F.top) parts.push('ดินบนเป็น' + F.top.t + (F.ph != null ? ' pH ' + F.ph.toFixed(1) + ' (' + phText(F.ph) + ')' : ''));
    if (F.clim) parts.push('ฝนเฉลี่ย ' + nf(F.clim.rainAnn) + ' มม./ปี แล้ง ' + F.dryN + ' เดือน');
    if (F.slope) parts.push('ความลาดชัน ' + F.slope.pct.toFixed(1) + '%');
    var txt = parts.length ? 'จากแบบจำลอง: ' + parts.join(' · ') + ' ' : '';
    if (!crops.length) return txt + 'อ่านข้อมูลดินและภูมิอากาศไม่ได้ตอนนี้ ลองเปิดรายงานแล้วกดลองใหม่';
    return txt + (good.length ? 'พืชที่เข้ากับสภาพนี้มากที่สุด: ' + good.slice(0, 3).map(function (x) { return x.c.t + ' (' + CLS_T[x.cls] + ')'; }).join(', ')
      : 'ไม่มีพืชในรายการที่เหมาะมากหรือปานกลางถ้าไม่ปรับดินหรือหาแหล่งน้ำ') + ' · ค่าจากแบบจำลอง ควรตรวจดินจริงก่อนตัดสินใจ';
  }

  // ---------- วาดขอบเขตแปลงบนแผนที่ ----------
  var PARCEL = { on: false, key: null, pts: [] };
  function polyM2(pts) {
    if (pts.length < 3) return 0;
    var R = 6371008.8, r = Math.PI / 180, lat0 = pts.reduce(function (a, p) { return a + p[1]; }, 0) / pts.length * r, a = 0;
    var xy = pts.map(function (p) { return [p[0] * r * R * Math.cos(lat0), p[1] * r * R]; });
    for (var i = 0; i < xy.length; i++) { var j = (i + 1) % xy.length; a += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1]; }
    return Math.abs(a) / 2;
  }
  function polyPerim(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) { var j = (i + 1) % pts.length; s += km(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) * 1000; }
    return s;
  }
  function parcelFC() {
    var feats = [], pts = PARCEL.on ? PARCEL.pts : null, S = !PARCEL.on && SITE.cur && SITE.res[SITE.cur];
    if (!pts && S && S.parcel) pts = S.parcel.pts;
    if (pts && pts.length) {
      if (pts.length >= 3) feats.push({ type: 'Feature', properties: { k: 'poly' }, geometry: { type: 'Polygon', coordinates: [pts.concat([pts[0]])] } });
      else if (pts.length === 2) feats.push({ type: 'Feature', properties: { k: 'line' }, geometry: { type: 'LineString', coordinates: pts } });
      if (PARCEL.on) pts.forEach(function (p, i) { feats.push({ type: 'Feature', properties: { k: 'pt', first: i === 0 ? 1 : 0 }, geometry: { type: 'Point', coordinates: p } }); });
    }
    return { type: 'FeatureCollection', features: feats };
  }
  function updateParcel(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    var map = v.map, fc = parcelFC();
    if (!map.getSource('cg-parcel')) {
      if (!fc.features.length) return;
      map.addSource('cg-parcel', { type: 'geojson', data: fc });
      map.addLayer({ id: 'cg-parcel-f', type: 'fill', source: 'cg-parcel', filter: ['==', ['get', 'k'], 'poly'], paint: { 'fill-color': '#F5C04A', 'fill-opacity': 0.22 } });
      map.addLayer({ id: 'cg-parcel-l', type: 'line', source: 'cg-parcel', filter: ['!=', ['get', 'k'], 'pt'], paint: { 'line-color': '#F5C04A', 'line-width': 2.6 } });
      map.addLayer({ id: 'cg-parcel-p', type: 'circle', source: 'cg-parcel', filter: ['==', ['get', 'k'], 'pt'], paint: {
        'circle-radius': ['case', ['==', ['get', 'first'], 1], 7, 5], 'circle-color': '#F5C04A', 'circle-stroke-color': '#101B2C', 'circle-stroke-width': 2 } });
    } else map.getSource('cg-parcel').setData(fc);
  }
  function parcelBar() {
    var el = $('parcelBar');
    if (!el) return;
    el.hidden = !PARCEL.on;
    document.body.classList.toggle('parcel-on', PARCEL.on);
    if (!PARCEL.on) return;
    var n = PARCEL.pts.length, m2 = polyM2(PARCEL.pts);
    $('parcelText').innerHTML = n < 3 ? '<b>แตะมุมแปลงบนแผนที่ทีละจุด</b><small>วางแล้ว ' + n + ' จุด ต้องมีอย่างน้อย 3 จุด</small>'
      : '<b>' + esc(raiText(m2)) + '</b><small>' + n + ' มุม · แตะจุดแรกหรือกด "เสร็จ" เพื่อปิดแปลง</small>';
    $('parcelUndo').disabled = !n;
    $('parcelDone').disabled = n < 3;
  }
  function parcelStart(key) {
    var S = SITE.res[key], v = views.chat;
    if (!S || !v) return;
    PARCEL.on = true; PARCEL.key = key; PARCEL.pts = [];
    setSitePick(false);
    v.el.classList.add('picking');
    v.map.doubleClickZoom.disable();
    if (v.map.getZoom() < 15.5) v.map.easeTo({ center: [S.lon, S.lat], zoom: Math.min(16.5, v.map.getMaxZoom()), padding: sitePadding(), duration: reduceMotion ? 0 : 700 });
    updateParcel(v); parcelBar();
  }
  function parcelEnd(save) {
    var v = views.chat, S = SITE.res[PARCEL.key];
    if (save && S && PARCEL.pts.length >= 3) {
      var pts = PARCEL.pts.slice();
      S.parcel = { pts: pts, m2: polyM2(pts), perim: polyPerim(pts), price: S.parcel && S.parcel.price || null };
    }
    PARCEL.on = false; PARCEL.pts = [];
    if (v) { v.el.classList.remove('picking'); v.map.doubleClickZoom.enable(); updateParcel(v); }
    parcelBar();
    if (S && save && S.parcel && v) {
      var b = S.parcel.pts.reduce(function (bb, p) { return [Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])]; }, [999, 999, -999, -999]);
      v.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: sitePadding(), maxZoom: 17.5, duration: reduceMotion ? 0 : 700 });
    }
    renderSiteCard();
  }
  function parcelClick(ll) {
    var v = views.chat, pts = PARCEL.pts;
    if (pts.length >= 3 && v) {
      var a = v.map.project(pts[0]), b = v.map.project([ll.lng, ll.lat]);
      if (Math.abs(a.x - b.x) < 14 && Math.abs(a.y - b.y) < 14) { parcelEnd(true); return; }
    }
    pts.push([ll.lng, ll.lat]);
    updateParcel(v); parcelBar();
  }
  if ($('parcelBar')) {
    $('parcelUndo').addEventListener('click', function () { PARCEL.pts.pop(); updateParcel(views.chat); parcelBar(); });
    $('parcelDone').addEventListener('click', function () { parcelEnd(true); });
    $('parcelX').addEventListener('click', function () { parcelEnd(false); });
  }
  function twin3d(S) {
    var v = views.chat;
    if (!v) return;
    if (!state.data.sat) { state.data.sat = true; saveData(); eachView(refreshLive); renderDataChips(); }
    setTerrain3d(v, true);
    v.map.easeTo({ center: [S.lon, S.lat], zoom: Math.max(14, Math.min(15.5, v.map.getZoom())), pitch: 64, bearing: -25, padding: sitePadding(), duration: reduceMotion ? 0 : 1200 });
    toast('ภาพดาวเทียมบนแผนที่ความสูง (ขยายความสูง 1.6 เท่า) ลากด้วยคลิกขวาหรือสองนิ้วเพื่อหมุนมุมมอง');
  }
  function setSiteTab(tab) {
    TWIN.tab = tab === 'twin' ? 'twin' : 'risk';
    var S = SITE.cur && SITE.res[SITE.cur];
    if (S) { $('siteBody').scrollTop = 0; renderSiteCard(); siteHash(S); }
  }
  function siteHash(S) {
    try { history.replaceState(null, '', location.pathname + location.search + '#' + (TWIN.tab === 'twin' ? 'twin' : 'site') + '=' + S.lat.toFixed(5) + ',' + S.lon.toFixed(5)); } catch (e) { /* ข้าม */ }
  }
  if ($('siteCard')) {
    $('siteCard').addEventListener('click', function (e) {
      var t = e.target.closest('[role="tab"][data-site-tab],[data-twin-retry],[data-twin-draw],[data-twin-clear],[data-twin-3d]');
      if (!t) return;
      if (t.hasAttribute('data-site-tab')) { setSiteTab(t.getAttribute('data-site-tab')); return; }
      var S = SITE.res[t.getAttribute('data-twin-retry') || t.getAttribute('data-twin-draw') || t.getAttribute('data-twin-clear') || t.getAttribute('data-twin-3d')];
      if (!S) return;
      if (t.hasAttribute('data-twin-retry')) { twinLoad(S, true); renderSiteCard(); }
      else if (t.hasAttribute('data-twin-draw')) parcelStart(S.key);
      else if (t.hasAttribute('data-twin-clear')) { S.parcel = null; updateParcel(views.chat); renderSiteCard(); }
      else twin3d(S);
    });
    $('siteCard').addEventListener('input', function (e) {
      if (e.target.id !== 'twinPrice') return;
      var S = SITE.cur && SITE.res[SITE.cur];
      if (!S || !S.parcel) return;
      var n = parseFloat(String(e.target.value).replace(/[^\d.]/g, ''));
      S.parcel.price = isFinite(n) && n > 0 ? n : null;
      $('twinPriceOut').innerHTML = priceText(S.parcel);
    });
    $('siteCard').addEventListener('focusout', function (e) { if (e.target.id === 'twinPrice' && TWIN.pending) { TWIN.pending = false; setTimeout(renderSiteCard, 0); } });
    $('siteCard').addEventListener('keydown', function (e) {
      var t = e.target.closest('[role="tab"]');
      if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      setSiteTab(TWIN.tab === 'twin' ? 'risk' : 'twin');
      var n = $('siteCard').querySelector('[role="tab"][aria-selected="true"]');
      if (n) n.focus();
    });
  }

  /* ---------- หน้าทรัพย์: วางรายการทรัพย์ของคุณเอง แล้วตรวจทำเลทีละหลายแปลง (คัดกรองแบบเว็บค้นทรัพย์ขายทอดตลาด) ---------- */
  // ChatGeo ไม่ดึงประกาศของใครมาเก็บ ผู้ใช้วางรายการเอง (คัดลอกจากเว็บหรือ Google Sheets หรือไฟล์ CSV) รายการอยู่ในเบราว์เซอร์นี้เท่านั้น
  // ชื่อบุคคล (จำเลย โจทก์ เจ้าของ) ถูกตัดทิ้งตั้งแต่ตอนอ่าน ไม่แสดงและไม่เก็บ
  var PP_KEY = 'cg-props-v1', PP_MAX = 300;
  var PP_RE = /ค้นทรัพย์|หาทรัพย์|รายการทรัพย์|หน้าทรัพย์|ตรวจหลายแปลง|หลายแปลง/;
  var PP_TYPES = [['land', 'ที่ดินเปล่า'], ['house', 'บ้าน'], ['condo', 'คอนโด'], ['shop', 'อาคารพาณิชย์'], ['factory', 'โรงงาน/โกดัง'], ['other', 'อื่นๆ']];
  var PP_TYPE_T = {};
  PP_TYPES.forEach(function (t) { PP_TYPE_T[t[0]] = t[1]; });
  var PP_FLOODS = [['all', 'ทั้งหมด'], ['low', 'ไม่พบสัญญาณ'], ['mid', 'บางส่วน'], ['high', 'เสี่ยงสูง'], ['none', 'ยังไม่ตรวจ']];
  var PP_SORTS = [['new', 'เพิ่มล่าสุด'], ['price', 'ราคาน้อย → มาก'], ['price-d', 'ราคามาก → น้อย'], ['ppw', 'ราคาต่อตารางวาถูกสุด'], ['area-d', 'เนื้อที่มากสุด'],
    ['risk', 'เสี่ยงน้ำท่วมน้อยก่อน'], ['date', 'วันขายใกล้สุด'], ['near', 'ใกล้ฉัน']];
  var PP = { list: [], q: '', type: 'all', prov: 'all', flood: 'all', pmin: '', pmax: '', sort: 'new', run: false, done: 0, todo: 0, pick: null, near: null, ver: 1, rt: 0, clearArm: 0 };
  try { var ppL = JSON.parse(localStorage.getItem(PP_KEY) || '[]'); if (Array.isArray(ppL)) PP.list = ppL.slice(0, PP_MAX); } catch (e) { /* ไม่มีที่เก็บ */ }
  function ppSave() {
    PP.ver++;
    try { localStorage.setItem(PP_KEY, JSON.stringify(PP.list)); } catch (e) { toast('เบราว์เซอร์นี้เก็บรายการไม่ได้ (เช่น โหมดส่วนตัว) รายการจะหายเมื่อปิดหน้า'); }
  }

  // ---------- อ่านรายการที่วางมา ----------
  // ตัดคำนำหน้าบทบาท + ชื่อคนต่อท้ายไม่เกิน 4 คำ (หยุดเมื่อเจอข้อมูลทรัพย์ เช่น ราคา พิกัด ลิงก์ ตัวเลข)
  var PP_SENS = /(จำเลย|โจทก์|ผู้ถือกรรมสิทธิ์|เจ้าของกรรมสิทธิ์|ชื่อเจ้าของ|เจ้าของ|ลูกหนี้|ผู้กู้|ผู้ขาย)\s*(ที่\s*\d+)?\s*[:：]?\s*(?:(?!ราคา|พิกัด|http|ขาย|เนื้อที่|ขนาด|ประเภท|ที่ดิน|บ้าน|คอนโด|ห้องชุด|ตร\.|ไร่|งาน|วันที่|นัด|จำเลย|โจทก์|ผู้ถือ|เจ้าของ|ลูกหนี้|ผู้กู้|ผู้ขาย)[^\s,|\t\n;\d]+\s*){0,4}/g;
  var PP_PHONE = /(โทร\.?|tel\.?|ติดต่อ|มือถือ)?\s*0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/gi;
  var PP_MON = {};
  TH_MON.forEach(function (m, i) { PP_MON[m] = i; });
  TH_MON_S.forEach(function (m, i) { PP_MON[m.replace(/\./g, '')] = i; });
  var PP_DATE_RE = new RegExp('(\\d{1,2})\\s*(' + TH_MON.concat(TH_MON_S.map(function (s) { return s.replace(/\./g, '\\.?'); })).join('|') + ')\\s*(\\d{2,4})');
  function ppLL(la, lo) {
    if (la == null || lo == null) return null;
    if (la > 90 && lo <= 90) { var x = la; la = lo; lo = x; }
    return la >= 4 && la <= 22 && lo >= 96 && lo <= 107 ? { lat: la, lon: lo } : { out: true, lat: la, lon: lo };
  }
  function ppNum(s) { var n = parseFloat(String(s == null ? '' : s).replace(/[,\s฿]/g, '')); return isFinite(n) ? n : null; }
  function ppYear(y) { y = +y; if (y < 100) y += 2500; return y > 2400 ? y - 543 : y; }
  function ppIso(y, m, d) {
    if (!(m >= 0 && m < 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return '';
    return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function ppDate(t) {
    var m = PP_DATE_RE.exec(t);
    if (m) return ppIso(ppYear(m[3]), PP_MON[m[2].replace(/\./g, '')], +m[1]);
    m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
    if (m) return ppIso(ppYear(m[1]), +m[2] - 1, +m[3]);
    m = /(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/.exec(t);
    if (m) return ppIso(ppYear(m[3]), +m[2] - 1, +m[1]);
    return '';
  }
  function ppPrice(t) {
    var m = /([\d,]+(?:\.\d+)?)\s*(?:ล้าน|ลบ\.|ล\.)/.exec(t);
    if (m && ppNum(m[1]) != null) return ppNum(m[1]) * 1e6;
    m = /ราคา[^\d\n]{0,20}([\d,]+(?:\.\d+)?)/.exec(t) || /([\d,]+(?:\.\d+)?)\s*(?:บาท|฿)/.exec(t) || /(?:^|[^\d.,])(\d{1,3}(?:,\d{3}){1,})(?![\d,])/.exec(t);
    var n = m ? ppNum(m[1]) : null;
    return n != null && n >= 1000 ? n : null;
  }
  function ppArea(t) {
    var a = /(?:เนื้อที่|ขนาด)\s*[:：]?\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+(?:\.\d+)?)/.exec(t) || /(\d+)\s*-\s*(\d+)\s*-\s*(\d+(?:\.\d+)?)\s*ไร่/.exec(t);
    if (a) return +a[1] * 1600 + +a[2] * 400 + +a[3] * 4;
    var r = /(\d+(?:\.\d+)?)\s*ไร่/.exec(t), g = /(\d+(?:\.\d+)?)\s*งาน/.exec(t), w = /([\d,]+(?:\.\d+)?)\s*(?:ตร\.?\s*ว\.?|ตารางวา)/.exec(t);
    if (r || g || w) return (r ? +r[1] * 1600 : 0) + (g ? +g[1] * 400 : 0) + (w ? ppNum(w[1]) * 4 : 0);
    var m2 = /([\d,]+(?:\.\d+)?)\s*(?:ตร\.?\s*ม\.?|ตารางเมตร|sq\.?\s*m|m2|ม²)/i.exec(t);
    return m2 ? ppNum(m2[1]) : null;
  }
  function ppType(t) {
    if (/คอนโด|ห้องชุด|condo/i.test(t)) return 'condo';
    if (/อาคารพาณิชย์|ตึกแถว|โฮมออฟฟิศ|shophouse/i.test(t)) return 'shop';
    if (/โรงงาน|โกดัง|คลังสินค้า|warehouse|factory/i.test(t)) return 'factory';
    if (/บ้านเดี่ยว|บ้านแฝด|บ้านพร้อม|บ้านชั้น|ทาวน์|^บ้าน|\sบ้าน\s|townhouse|house/i.test(t)) return 'house';
    if (/ที่ดิน|ที่นา|ที่สวน|ที่ไร่|land/i.test(t)) return 'land';
    return 'other';
  }
  var PP_COORD_RE = /-?\d{1,3}\.\d{3,}\s*[,\s]\s*-?\d{1,3}\.\d{3,}/g;
  function ppName(t) {
    var s = t.replace(/https?:\/\/\S+/g, ' ').replace(PP_COORD_RE, ' ').replace(PP_SENS, ' ')
      .replace(/ราคา[^\d\n|]{0,20}[\d,]+(?:\.\d+)?\s*(ล้าน|ล\.)?\s*(บาท|฿)?/g, ' ').replace(/[\d,]+(?:\.\d+)?\s*(ล้าน|ล\.)\s*(บาท)?/g, ' ').replace(/[\d,]+(?:\.\d+)?\s*(บาท|฿)/g, ' ')
      .replace(/[\d,]+(?:\.\d+)?\s*ลบ\./g, ' ').replace(PP_DATE_RE, ' ').replace(/\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/(วันขาย|นัดที่\s*\d+|ขาย|พิกัด|ลิงก์)\s*[:：]?/g, ' ')
      .replace(/โฉนด(เลขที่)?\s*[\d\/-]+/g, ' ').replace(/[|\t;]+/g, ' · ').replace(/\s+/g, ' ').replace(/^[\s·,:-]+|[\s·,:-]+$/g, '');
    s = s.replace(/(\s·\s)+/g, ' · ');
    return s.length > 80 ? s.slice(0, 78) + '…' : s;
  }
  function ppFromText(t, extra) {
    extra = extra || {};
    var clean = String(t || '').replace(PP_SENS, ' ').replace(PP_PHONE, ' ');
    var c = extra.lat != null ? { lat: extra.lat, lon: extra.lon } : parseCoords(clean);
    var url = extra.url || ((/https?:\/\/\S+/.exec(clean) || [])[0] || '').replace(/[),.]+$/, '');
    var p = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: extra.name || ppName(clean),
      type: extra.type || ppType(clean),
      price: extra.price != null ? extra.price : ppPrice(clean),
      m2: extra.m2 != null ? extra.m2 : ppArea(clean),
      date: extra.date || ppDate(clean),
      url: /^https?:\/\//.test(url) ? url : '',
      note: extra.note || '',
      lat: c && !c.out ? +c.lat.toFixed(6) : null, lon: c && !c.out ? +c.lon.toFixed(6) : null,
      out: !!(c && c.out), added: Date.now(), chk: null
    };
    if (!p.name) p.name = PP_TYPE_T[p.type] + (p.m2 ? ' ' + raiShort(p.m2) : '');
    return p;
  }
  // CSV/TSV (รองรับเครื่องหมายคำพูด)
  function ppRows(text, sep) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"' && f === '') q = true;
      else if (ch === sep) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  var PP_COLS = [
    ['sens', /จำเลย|โจทก์|เจ้าของ|ผู้ถือกรรมสิทธิ์|ลูกหนี้|owner|โฉนด|deed/i],
    ['lat', /^\s*(lat|latitude|ละติจูด)/i], ['lon', /^\s*(lon|lng|long|longitude|ลองจิจูด)/i],
    ['coord', /พิกัด|coord|location|ตำแหน่ง|google|แผนที่|map/i], ['url', /ลิงก์|ลิ้งค์|link|url|เว็บ/i],
    ['price', /ราคา|price/i], ['area', /เนื้อที่|ขนาด|area|size/i], ['type', /ประเภท|type|ชนิด/i],
    ['date', /วันที่|วันขาย|นัด|date/i], ['note', /หมายเหตุ|note|รายละเอียด|detail/i], ['name', /ชื่อ|รายการ|ทรัพย์|name|title/i]
  ];
  function ppParse(text) {
    text = String(text || '').replace(/^﻿/, '');
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : lines[0].split(',').length >= 3 && !parseCoords(lines[0]) ? ',' : null;
    var out = [];
    if (sep) {
      var rows = ppRows(text, sep), head = rows[0].map(function (h) {
        var k = find(PP_COLS, function (c) { return c[1].test(h); });
        return k ? k[0] : null;
      });
      var hasHead = head.filter(Boolean).length >= 2;
      (hasHead ? rows.slice(1) : rows).forEach(function (r) {
        if (!hasHead) { out.push(ppFromText(r.join(' | '))); return; }
        var ex = {}, rest = [], col = function (k) { var i = head.indexOf(k); return i >= 0 ? String(r[i] || '').trim() : ''; };
        r.forEach(function (v, i) { if (!head[i] || head[i] === 'name' || head[i] === 'note') rest.push(v); });
        if (col('lat') && col('lon')) { var cc = ppLL(ppNum(col('lat')), ppNum(col('lon'))); if (cc && !cc.out) { ex.lat = cc.lat; ex.lon = cc.lon; } }
        else if (col('coord')) { var c2 = parseCoords(col('coord')); if (c2 && !c2.out) { ex.lat = c2.lat; ex.lon = c2.lon; } }
        if (col('url')) ex.url = col('url');
        if (col('price')) ex.price = ppPrice(col('price') + (/บาท|ล้าน/.test(col('price')) ? '' : ' บาท'));
        if (col('area')) {
          var hi = head.indexOf('area'), hn = rows[0][hi] || '', v = col('area');
          ex.m2 = /[ไร่งานวาม]/.test(v) || /-/.test(v) ? ppArea(/ไร่|งาน|วา|ตร/.test(v) ? v : v + ' ไร่') : ppNum(v) == null ? null : /ไร่/.test(hn) ? ppNum(v) * 1600 : /ตร\.?\s*ม|ตารางเมตร|m2/i.test(hn) ? ppNum(v) : ppNum(v) * 4;
        }
        if (col('type')) ex.type = ppType(col('type'));
        if (col('date')) ex.date = ppDate(col('date'));
        if (col('note')) ex.note = ppName(col('note'));
        if (col('name')) ex.name = ppName(col('name'));
        out.push(ppFromText(rest.concat(col('coord'), col('url')).join(' | '), ex));
      });
    } else lines.forEach(function (l) { out.push(ppFromText(l)); });
    return out.filter(function (p) { return p.name || p.lat != null; });
  }
  function ppAdd(items) {
    var seen = {}, added = 0, skipped = 0;
    PP.list.forEach(function (p) { seen[p.name + '|' + p.lat + '|' + p.lon] = 1; });
    items.forEach(function (p) {
      var k = p.name + '|' + p.lat + '|' + p.lon;
      if (seen[k] || PP.list.length >= PP_MAX) { skipped++; return; }
      seen[k] = 1; PP.list.unshift(p); added++;
    });
    ppSave();
    return { added: added, skipped: skipped };
  }

  // ---------- ตรวจทำเลทีละแปลง (ใช้ระบบเดียวกับการ์ดตรวจทำเล ไม่เรียกชื่อสถานที่จาก Nominatim เพื่อไม่ให้ยิงถี่) ----------
  function ppCheckOne(p) {
    var key = siteRun(p.lon, p.lat, p.name, true), S = SITE.res[key], t0 = Date.now();
    return new Promise(function (res) {
      (function wait() {
        var done = ['gsw', 'haz', 'ele'].every(function (k) { return S.st[k] && S.st[k] !== 'loading'; });
        if (done || Date.now() - t0 > 45000) res(); else setTimeout(wait, 400);
      })();
    }).then(function () {
      var V = siteVerdict(S), h = hazLevel(S.haz), g = gswLevel(S.gsw);
      p.chk = { lv: V ? V.lv : 'na', t: V ? V.t : 'ตรวจไม่ได้ตอนนี้', why: V ? V.why.slice(0, 2) : [], rp: h && h.lv === 'in' ? h.rp : null, g: g ? g.lv : null,
        ele: S.ele ? Math.round(S.ele.ele) : null, rel: S.ele ? (S.ele.pct <= 0.15 ? 'low' : S.ele.pct >= 0.85 ? 'high' : 'mid') : null, at: Date.now() };
      p.prov = p.prov || provinceAt(p.lon, p.lat) || '';
    });
  }
  function ppRun() {
    if (PP.run) return;
    var q = PP.list.filter(function (p) { return p.lat != null && !p.chk; });
    if (!q.length) return;
    PP.run = true; PP.done = 0; PP.todo = q.length;
    var i = 0;
    function next() {
      if (!PP.run) return Promise.resolve();
      var p = q[i++];
      if (!p) return Promise.resolve();
      return ppCheckOne(p).catch(function () { p.chk = { lv: 'na', t: 'ตรวจไม่ได้ตอนนี้', why: [], at: Date.now() }; }).then(function () {
        PP.done++; ppSave(); ppRenderSoon(); return next();
      });
    }
    Promise.all([next(), next()]).then(function () { PP.run = false; ppSave(); renderPropsPage(); eachView(updatePropsMarkers); });
    renderPropsPage();
  }
  function ppRenderSoon() {
    if (PP.rt) return;
    PP.rt = setTimeout(function () { PP.rt = 0; if (state.page === 'props') renderPropsPage(); eachView(updatePropsMarkers); }, 700);
  }

  // ---------- กรองและเรียง ----------
  function ppProvName(p) { var id = p.prov || (p.lat != null ? provinceAt(p.lon, p.lat) : ''); return id && byId[id] ? byId[id].name : ''; }
  function ppPpw(p) { return p.price && p.m2 ? p.price / (p.m2 / 4) : null; }
  function ppFiltered() {
    var q = cvNorm(PP.q), pmin = ppNum(PP.pmin), pmax = ppNum(PP.pmax);
    var L = PP.list.filter(function (p) {
      if (PP.type !== 'all' && p.type !== PP.type) return false;
      if (PP.prov !== 'all' && (p.prov || provinceAt(p.lon, p.lat)) !== PP.prov) return false;
      if (pmin != null && !(p.price >= pmin * 1e6)) return false;
      if (pmax != null && !(p.price != null && p.price <= pmax * 1e6)) return false;
      if (PP.flood === 'none' && p.chk) return false;
      if (PP.flood !== 'all' && PP.flood !== 'none' && !(p.chk && p.chk.lv === PP.flood)) return false;
      if (q && cvNorm([p.name, p.note, ppProvName(p), PP_TYPE_T[p.type]].join('|')).indexOf(q) < 0) return false;
      return true;
    });
    var R = { low: 0, mid: 1, high: 2, water: 3, na: 4 };
    var big = 9e15, by = {
      'new': function (p) { return -p.added; },
      price: function (p) { return p.price == null ? big : p.price; },
      'price-d': function (p) { return p.price == null ? big : -p.price; },
      ppw: function (p) { var v = ppPpw(p); return v == null ? big : v; },
      'area-d': function (p) { return p.m2 == null ? big : -p.m2; },
      risk: function (p) { return p.chk ? R[p.chk.lv] * 1e4 + (p.chk.rp ? 1000 - p.chk.rp : 0) : 5e4; },
      date: function (p) { var t = p.date ? Date.parse(p.date) : NaN; return isNaN(t) ? big : t < Date.now() - 864e5 ? big / 2 + t : t; },
      near: function (p) { return PP.near && p.lat != null ? km(PP.near.lon, PP.near.lat, p.lon, p.lat) : big; }
    }[PP.sort] || function () { return 0; };
    return L.slice().sort(function (a, b) { return by(a) - by(b); });
  }

  // ---------- วาดหน้า ----------
  function raiShort(m2) {
    var w = m2 / 4, r = Math.floor(w / 400), g = Math.floor((w - r * 400) / 100), wa = Math.round(w - r * 400 - g * 100);
    if (wa === 100) { wa = 0; g++; } if (g === 4) { g = 0; r++; }
    return r + '-' + g + '-' + wa + ' ไร่';
  }
  function moneyShort(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + ' ล้าน' : nf(n); }
  function ppDateText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), days = Math.round((d.getTime() - Date.now()) / 864e5);
    return +m[3] + ' ' + TH_MON_S[+m[2] - 1] + ' ' + String(+m[1] + 543).slice(-2) + (days >= 0 && days <= 60 ? ' (อีก ' + days + ' วัน)' : days < 0 ? ' (ผ่านไปแล้ว)' : '');
  }
  function ppCard(p) {
    var c = p.chk, col = c ? (SV_C[c.lv] || '#8A93A3') : '#8A93A3', prov = ppProvName(p), ppw = ppPpw(p);
    var facts = [];
    if (c && c.g) facts.push(c.g === 'none' ? 'ดาวเทียมไม่เคยเห็นน้ำขัง' : c.g === 'water' ? 'อยู่ในแหล่งน้ำ' : c.g === 'often' ? 'มีน้ำขังบ่อย' : c.g === 'some' ? 'เคยมีน้ำท่วมหรือน้ำขัง' : 'ใกล้จุดที่เคยมีน้ำ');
    if (c && c.rp) facts.push('แบบจำลองท่วมตั้งแต่รอบ ' + c.rp + ' ปี');
    if (c && c.rel) facts.push(c.rel === 'low' ? 'ที่ลุ่ม' : c.rel === 'high' ? 'ที่ดอน' : 'ระดับใกล้เคียงรอบๆ');
    return '<article class="pp-card" style="--c:' + col + '">' +
      '<div class="pp-top"><span class="pp-type">' + esc(PP_TYPE_T[p.type] || 'อื่นๆ') + '</span>' + (p.date ? '<span class="pp-date">ขาย ' + esc(ppDateText(p.date)) + '</span>' : '') + '</div>' +
      '<h3 class="pp-name">' + esc(p.name || 'ไม่มีชื่อ') + '</h3>' +
      '<div class="pp-loc">' + (prov ? 'จ.' + esc(prov) + ' · ' : '') + (p.lat != null ? p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) : p.out ? 'พิกัดอยู่นอกประเทศไทย' : 'ยังไม่มีพิกัด') + '</div>' +
      '<div class="pp-price">' + (p.price ? '<b>' + moneyShort(p.price) + ' บาท</b>' : '<span class="pp-dim">ไม่ระบุราคา</span>') +
        (p.m2 ? '<span> · ' + (p.type === 'condo' ? nf(p.m2) + ' ตร.ม.' : raiShort(p.m2)) + '</span>' : '') +
        (ppw && p.type !== 'condo' ? '<span> · ' + nf(ppw) + ' บาท/ตร.วา</span>' : ppw && p.type === 'condo' ? '<span> · ' + nf(p.price / p.m2) + ' บาท/ตร.ม.</span>' : '') + '</div>' +
      (p.lat == null ? '<div class="pp-risk none"><b>ตรวจทำเลไม่ได้ ยังไม่มีพิกัด</b><small>ปักหมุดบนแผนที่ หรือวางบรรทัดนี้ใหม่พร้อมพิกัดหรือลิงก์ Google Maps แบบเต็ม</small></div>'
        : !c ? '<div class="pp-risk none"><b>' + (PP.run ? 'รอตรวจทำเล…' : 'ยังไม่ได้ตรวจทำเล') + '</b></div>'
        : '<div class="pp-risk"><b><i></i>' + esc(c.t) + '</b>' + (facts.length ? '<small>' + esc(facts.join(' · ')) + (c.ele != null ? ' · สูงราว ' + c.ele + ' ม.' : '') + '</small>' : '') + '</div>') +
      (p.note ? '<p class="pp-note">' + esc(p.note) + '</p>' : '') +
      '<div class="pp-acts">' +
        (p.lat != null ? '<button type="button" class="btn-ghost" data-pp-open="' + p.id + '">รายงานทำเล</button><button type="button" class="btn-ghost" data-pp-twin="' + p.id + '">ดิน · เพาะปลูก</button>'
          : '<button type="button" class="btn-ghost" data-pp-pick="' + p.id + '">ปักหมุดบนแผนที่</button>') +
        (p.url ? '<a class="btn-ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">ประกาศต้นทาง' + ICO.ext + '</a>' : '') +
        '<button type="button" class="btn-ghost pp-del" data-pp-del="' + p.id + '" aria-label="ลบ ' + esc(p.name) + '">ลบ</button></div></article>';
  }
  function renderPropsPage() {
    if (state.page !== 'props' || !$('pagePp')) return;
    var all = PP.list, L = ppFiltered(), checked = all.filter(function (p) { return p.chk; }).length, noLL = all.filter(function (p) { return p.lat == null; }).length;
    var todo = all.filter(function (p) { return p.lat != null && !p.chk; }).length;
    // แถบซ้าย
    var cnt = function (f) { return all.filter(f).length; };
    $('ppTypes').innerHTML = [['all', 'ทั้งหมด']].concat(PP_TYPES).map(function (t) {
      var n = t[0] === 'all' ? all.length : cnt(function (p) { return p.type === t[0]; });
      return n || t[0] === 'all' ? '<button type="button" class="q-chip" data-pp-type="' + t[0] + '" aria-pressed="' + (PP.type === t[0]) + '">' + esc(t[1]) + ' <b>' + n + '</b></button>' : '';
    }).join('');
    $('ppFloods').innerHTML = PP_FLOODS.map(function (t) {
      var n = t[0] === 'all' ? all.length : t[0] === 'none' ? cnt(function (p) { return !p.chk; }) : cnt(function (p) { return p.chk && p.chk.lv === t[0]; });
      return '<button type="button" class="q-chip" data-pp-flood="' + t[0] + '" aria-pressed="' + (PP.flood === t[0]) + '">' +
        (SV_C[t[0]] ? '<i class="cc-dot" style="background:' + SV_C[t[0]] + '"></i>' : '') + esc(t[1]) + ' <b>' + n + '</b></button>';
    }).join('');
    var provs = {};
    all.forEach(function (p) { var id = p.prov || (p.lat != null ? provinceAt(p.lon, p.lat) : ''); if (id && byId[id]) provs[id] = (provs[id] || 0) + 1; });
    $('ppProv').innerHTML = '<option value="all">ทุกจังหวัด</option>' + Object.keys(provs).sort(function (a, b) { return byId[a].name.localeCompare(byId[b].name, 'th'); }).map(function (id) {
      return '<option value="' + id + '">' + esc(byId[id].name) + ' (' + provs[id] + ')</option>';
    }).join('');
    $('ppProv').value = provs[PP.prov] ? PP.prov : 'all';
    if (!provs[PP.prov]) PP.prov = 'all';
    $('ppSort').innerHTML = PP_SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (PP.sort === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
    // แถบบน
    $('ppStats').innerHTML = '<span class="cv-stat"><b>' + all.length + '</b> ทรัพย์</span>' +
      '<span class="cv-stat"><b>' + checked + '</b> ตรวจแล้ว</span>' +
      (PP.run ? '<span class="cv-stat hot">กำลังตรวจ ' + PP.done + '/' + PP.todo + '</span>' : '') +
      (noLL ? '<span class="cv-stat dim">ไม่มีพิกัด ' + noLL + '</span>' : '') +
      ['high', 'mid', 'low'].map(function (k) { var n = cnt(function (p) { return p.chk && p.chk.lv === k; }); return n ? '<span class="cv-stat"><i class="cc-dot" style="background:' + SV_C[k] + '"></i>' + PP_FLOODS.filter(function (f) { return f[0] === k; })[0][1] + ' <b>' + n + '</b></span>' : ''; }).join('');
    $('ppRun').hidden = !PP.run && !todo;
    $('ppRunT').textContent = PP.run ? 'หยุดตรวจ' : 'ตรวจทำเล ' + todo + ' รายการ';
    $('ppMap').disabled = !all.some(function (p) { return p.lat != null; });
    $('ppCsv').disabled = !all.length;
    $('ppImport').open = $('ppImport').open || !all.length;
    // รายการ
    var h = '';
    if (!all.length) {
      h = '<div class="pp-empty"><b>ยังไม่มีทรัพย์ในรายการ</b><p>วางรายการทรัพย์ที่สนใจในช่องด้านบน หนึ่งบรรทัดต่อหนึ่งทรัพย์ ใส่พิกัดหรือลิงก์ Google Maps แบบเต็ม ราคา ขนาด และวันขายได้ตามสะดวก หรือเลือกไฟล์ CSV ' +
        'ระบบจะตรวจทำเลทีละแปลง (น้ำท่วมย้อนหลัง แบบจำลองน้ำท่วมใหญ่ ที่ลุ่มที่ดอน) แล้วให้กรองและเรียงได้แบบเว็บค้นทรัพย์</p></div>';
    } else if (!L.length) h = '<p class="cv-empty">ไม่มีทรัพย์ที่ตรงกับตัวกรองนี้ <button type="button" class="cv-sec-a" data-pp-reset="1">ล้างตัวกรอง</button></p>';
    else h = '<div class="cv-now"><span>แสดง ' + L.length + ' จาก ' + all.length + ' รายการ</span>' +
      (PP.type !== 'all' || PP.prov !== 'all' || PP.flood !== 'all' || PP.q || PP.pmin || PP.pmax ? '<button type="button" class="cv-sec-a" data-pp-reset="1">ล้างตัวกรอง</button>' : '') + '</div>' +
      '<div class="pp-grid">' + L.map(ppCard).join('') + '</div>';
    var sc = ppSc(), y = sc.scrollTop;
    $('ppBody').innerHTML = h;
    sc.scrollTop = y;
  }
  function ppSc() { return window.matchMedia('(max-width: 860px)').matches ? $('pagePp') : $('ppScroll'); }

  // ---------- หมุดบนแผนที่ ----------
  function updatePropsMarkers(v) {
    if (!v || v.kind !== 'chat') return;
    var on = !!state.data.props;
    if (v.ppVer === PP.ver && v.ppOn === on) return;
    (v.ppMarkers || []).forEach(function (m) { m.remove(); });
    v.ppMarkers = []; v.ppVer = PP.ver; v.ppOn = on;
    if (!on) return;
    PP.list.forEach(function (p) {
      if (p.lat == null) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'pp-pin';
      el.style.setProperty('--c', p.chk ? (SV_C[p.chk.lv] || '#8A93A3') : '#8A93A3');
      el.textContent = p.price ? moneyShort(p.price).replace(' ล้าน', 'ล.') : (PP_TYPE_T[p.type] || '').slice(0, 6);
      el.title = p.name + (p.chk ? ' · ' + p.chk.t : '');
      el.setAttribute('aria-label', 'ทรัพย์: ' + p.name + (p.chk ? ' ' + p.chk.t : ''));
      el.addEventListener('click', function (ev) { ev.stopPropagation(); if (SITE.pick || PARCEL.on) return; openSite(p.lon, p.lat, { name: p.name, tab: 'risk' }); });
      v.ppMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(v.map));
    });
  }
  function ppShowMap() {
    var pts = ppFiltered().filter(function (p) { return p.lat != null; });
    if (!pts.length) pts = PP.list.filter(function (p) { return p.lat != null; });
    if (!pts.length) return;
    if (!state.data.props) { state.data.props = true; saveData(); renderDataChips(); }
    setPage('chat');
    var v = views.chat;
    eachView(updatePropsMarkers);
    var b = pts.reduce(function (bb, p) { return [Math.min(bb[0], p.lon), Math.min(bb[1], p.lat), Math.max(bb[2], p.lon), Math.max(bb[3], p.lat)]; }, [999, 999, -999, -999]);
    setTimeout(function () { v.map.fitBounds([[b[0] - 0.01, b[1] - 0.01], [b[2] + 0.01, b[3] + 0.01]], { padding: mapPadding(v), maxZoom: 14, duration: reduceMotion ? 0 : 900 }); }, 60);
  }
  function ppCsv() {
    var cols = ['ชื่อ', 'ประเภท', 'ราคา (บาท)', 'เนื้อที่ (ตร.วา)', 'ราคาต่อตร.วา', 'จังหวัด', 'ละติจูด', 'ลองจิจูด', 'วันขาย', 'ลิงก์', 'สัญญาณน้ำท่วม', 'เหตุผล', 'แบบจำลองท่วมตั้งแต่รอบ (ปี)', 'ความสูง (ม.)', 'หมายเหตุ'];
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = ppFiltered().map(function (p) {
      var c = p.chk || {};
      return [p.name, PP_TYPE_T[p.type], p.price || '', p.m2 ? Math.round(p.m2 / 4 * 10) / 10 : '', ppPpw(p) ? Math.round(ppPpw(p)) : '', ppProvName(p), p.lat, p.lon, p.date, p.url,
        c.t || '', (c.why || []).join(' / '), c.rp || '', c.ele != null ? c.ele : '', p.note].map(q).join(',');
    });
    var blob = new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chatgeo-ทรัพย์-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  var PP_SAMPLE = [
    'ตัวอย่าง: ที่ดินเปล่า 2 ไร่ 1 งาน ใกล้ถนนสายเอเชีย | 14.4100, 100.5800 | ราคา 3,200,000 บาท',
    'ตัวอย่าง: บ้านเดี่ยว 2 ชั้น 60 ตร.วา | 13.9930, 100.6100 | 2.1 ล้านบาท | ขาย 24 ต.ค. 2569',
    'ตัวอย่าง: ทาวน์เฮ้าส์ 21 ตร.วา | 13.8600, 100.5150 | ราคา 1,450,000 บาท',
    'ตัวอย่าง: ที่ดินเปล่า เนื้อที่ 5-0-0 ติดคลอง | 14.2050, 100.4500 | 4.5 ล้าน',
    'ตัวอย่าง: ที่ดินเปล่า 15 ไร่ บนเนิน | 14.6500, 101.4000 | ราคา 6,000,000 บาท',
    'ตัวอย่าง: คอนโด 32 ตร.ม. ใกล้รถไฟฟ้า | 13.7250, 100.5300 | 1.8 ล้านบาท',
    'ตัวอย่าง: ที่ดินเปล่า 3 ไร่ ยังไม่มีพิกัด | ราคา 900,000 บาท'
  ].join('\n');
  function ppImport(text, src) {
    var items = ppParse(text);
    if (!items.length) { toast('อ่านรายการไม่ได้ ลองวางหนึ่งบรรทัดต่อหนึ่งทรัพย์ พร้อมพิกัดหรือลิงก์ Google Maps แบบเต็ม'); return; }
    var r = ppAdd(items);
    var noLL = items.filter(function (p) { return p.lat == null; }).length;
    toast('เพิ่ม ' + r.added + ' รายการ' + (r.skipped ? ' (ข้ามรายการซ้ำหรือเกิน ' + PP_MAX + ' ' + r.skipped + ')' : '') + (noLL ? ' · ' + noLL + ' รายการไม่มีพิกัด' : '') + (src ? ' จาก ' + src : ''));
    $('ppText').value = '';
    $('ppImport').open = false;
    renderPropsPage();
    ppRun();
  }
  if ($('pagePp')) {
    $('pagePp').addEventListener('click', function (e) {
      var t = e.target.closest('[data-pp-type],[data-pp-flood],[data-pp-reset],[data-pp-open],[data-pp-twin],[data-pp-del],[data-pp-pick]');
      if (!t) return;
      var id = t.getAttribute('data-pp-open') || t.getAttribute('data-pp-twin') || t.getAttribute('data-pp-del') || t.getAttribute('data-pp-pick');
      var p = id && find(PP.list, function (x) { return x.id === id; });
      if (t.hasAttribute('data-pp-type')) PP.type = t.getAttribute('data-pp-type');
      else if (t.hasAttribute('data-pp-flood')) PP.flood = t.getAttribute('data-pp-flood');
      else if (t.hasAttribute('data-pp-reset')) { PP.type = 'all'; PP.prov = 'all'; PP.flood = 'all'; PP.q = ''; PP.pmin = ''; PP.pmax = ''; $('ppQ').value = ''; $('ppMin').value = ''; $('ppMax').value = ''; }
      else if (!p) return;
      else if (t.hasAttribute('data-pp-open') || t.hasAttribute('data-pp-twin')) { openSite(p.lon, p.lat, { name: p.name, tab: t.hasAttribute('data-pp-twin') ? 'twin' : 'risk' }); return; }
      else if (t.hasAttribute('data-pp-del')) { PP.list = PP.list.filter(function (x) { return x !== p; }); ppSave(); eachView(updatePropsMarkers); }
      else if (t.hasAttribute('data-pp-pick')) {
        PP.pick = p.id;
        setPage('chat');
        setSitePick(true, 'แตะตำแหน่งของ "' + p.name.slice(0, 40) + '" บนแผนที่');
        PP.pick = p.id;
        return;
      }
      renderPropsPage();
    });
    var ppT = 0;
    $('ppQ').addEventListener('input', function () { clearTimeout(ppT); ppT = setTimeout(function () { PP.q = $('ppQ').value.trim(); renderPropsPage(); }, 200); });
    ['ppMin', 'ppMax'].forEach(function (id) {
      $(id).addEventListener('input', function () { clearTimeout(ppT); ppT = setTimeout(function () { PP.pmin = $('ppMin').value; PP.pmax = $('ppMax').value; renderPropsPage(); }, 300); });
    });
    $('ppProv').addEventListener('change', function () { PP.prov = $('ppProv').value; renderPropsPage(); });
    $('ppSort').addEventListener('change', function () {
      PP.sort = $('ppSort').value;
      if (PP.sort === 'near' && !PP.near) {
        if (me.lon != null) PP.near = { lon: me.lon, lat: me.lat };
        else if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(function (pos) { PP.near = { lon: pos.coords.longitude, lat: pos.coords.latitude }; me.lon = PP.near.lon; me.lat = PP.near.lat; renderPropsPage(); },
            function () { toast('หาตำแหน่งไม่ได้ ลองอนุญาตตำแหน่งในเบราว์เซอร์'); }, { timeout: 12000, maximumAge: 600000 });
        }
      }
      renderPropsPage();
    });
    $('ppAdd').addEventListener('click', function () { ppImport($('ppText').value); });
    $('ppSample').addEventListener('click', function () { ppImport(PP_SAMPLE, 'ตัวอย่าง'); });
    $('ppFile').addEventListener('change', function () {
      var f = $('ppFile').files && $('ppFile').files[0];
      if (!f) return;
      if (f.size > 2e6) { toast('ไฟล์ใหญ่เกินไป (เกิน 2 MB)'); return; }
      var r = new FileReader();
      r.onload = function () { ppImport(String(r.result || ''), f.name); $('ppFile').value = ''; };
      r.readAsText(f, 'utf-8');
    });
    $('ppRun').addEventListener('click', function () { if (PP.run) { PP.run = false; renderPropsPage(); } else ppRun(); });
    $('ppMap').addEventListener('click', ppShowMap);
    $('ppFilt').addEventListener('click', function () {
      var side = $('ppFilt').closest('.pp-side'), on = !side.classList.contains('open');
      side.classList.toggle('open', on);
      $('ppFilt').setAttribute('aria-expanded', String(on));
    });
    $('ppCsv').addEventListener('click', ppCsv);
    $('ppClear').addEventListener('click', function () {
      if (Date.now() - PP.clearArm > 4000) { PP.clearArm = Date.now(); $('ppClear').textContent = 'กดอีกครั้งเพื่อลบทั้งหมด'; setTimeout(function () { $('ppClear').textContent = 'ลบทั้งหมด'; }, 4000); return; }
      PP.clearArm = 0; PP.run = false; PP.list = []; ppSave(); $('ppClear').textContent = 'ลบทั้งหมด'; eachView(updatePropsMarkers); renderPropsPage();
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pp-go]');
    if (b) { e.preventDefault(); setPage('props'); }
  });
  // ปักหมุดให้ทรัพย์ที่ไม่มีพิกัด (เรียกจากตัวดักคลิกแผนที่)
  function ppPickAt(ll) {
    var p = find(PP.list, function (x) { return x.id === PP.pick; });
    PP.pick = null;
    setSitePick(false);
    if (!p) return;
    var c = parseCoords(ll.lat.toFixed(6) + ', ' + ll.lng.toFixed(6));
    if (!c || c.out) { toast('จุดนี้อยู่นอกประเทศไทย'); return; }
    p.lat = +ll.lat.toFixed(6); p.lon = +ll.lng.toFixed(6); p.chk = null; p.out = false; p.prov = '';
    ppSave(); eachView(updatePropsMarkers);
    openSite(p.lon, p.lat, { name: p.name, tab: 'risk' });
    toast('บันทึกตำแหน่งของ "' + p.name.slice(0, 30) + '" แล้ว กำลังตรวจทำเล');
    ppCheckOne(p).then(function () { ppSave(); eachView(updatePropsMarkers); });
  }

  /* ---------- โลกตอนนี้ (แบบห้องควบคุม): แผ่นดินไหว ภัยพิบัติ จุดความร้อน กลางวัน/กลางคืน ดาวเทียม เครื่องบิน เรือ ข่าวสด สายเคเบิล ---------- */
  var LD_BASE = 'https://raw.githubusercontent.com/Choonahakarn/chatgeo/live-data/';
  var USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
  var GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app';
  var GDACS_GEOM = 'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry';
  var W_ATTR = {
    quakes: 'แผ่นดินไหว: <a href="https://earthquake.usgs.gov/" target="_blank" rel="noopener">USGS</a>',
    gdacs: 'ภัยพิบัติ: <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a> (EC, CC BY 4.0)',
    fires: 'จุดความร้อน: <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> (VIIRS NOAA-20)',
    sats: 'วงโคจร: <a href="https://celestrak.org/" target="_blank" rel="noopener">CelesTrak</a> · satellite.js (MIT)',
    aircraft: 'เครื่องบิน: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL)',
    ships: 'เรือ: <a href="https://aisstream.io/" target="_blank" rel="noopener">aisstream.io</a>',
    news: 'หัวข่าว: Bangkok Post · BBC · DW (ลิงก์ไปข่าวต้นฉบับ)',
    cables: 'สายเคเบิล: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL)'
  };
  var WD = {
    quakes: { fc: null, at: 0, err: false },
    gdacs: { list: null, at: 0, err: false, tc: {} },
    fires: { grid: null, sea: null, at: 0, err: false },
    sats: { doc: null, at: 0, err: false, recs: [], all: false, timer: 0, sel: null, lib: null },
    aircraft: { doc: null, at: 0, err: false },
    ships: { doc: null, at: 0, err: false },
    news: { doc: null, at: 0, err: false },
    cables: { fc: null, at: 0, err: false },
    status: null
  };
  var WORLD_IDS = ['quakes', 'gdacs', 'fires', 'daynight', 'sats', 'aircraft', 'ships', 'news', 'cables'];

  function msTime(ms) {
    if (!ms) return '';
    var b = new Date(ms + 7 * 3600e3), n = new Date(Date.now() + 7 * 3600e3);
    var hm = ('0' + b.getUTCHours()).slice(-2) + ':' + ('0' + b.getUTCMinutes()).slice(-2) + ' น.';
    return b.toISOString().slice(0, 10) === n.toISOString().slice(0, 10) ? hm : b.getUTCDate() + ' ' + TH_MON_S[b.getUTCMonth()] + ' ' + hm;
  }
  function agoText(ms) {
    var m = Math.max(0, (Date.now() - ms) / 60e3);
    return m < 1 ? 'เมื่อสักครู่' : m < 60 ? Math.round(m) + ' นาทีก่อน' : m < 48 * 60 ? Math.round(m / 60) + ' ชม.ก่อน' : Math.round(m / 1440) + ' วันก่อน';
  }
  function isoMs(s) { var t = Date.parse(s); return isFinite(t) ? t : 0; }
  function fmtN(n) { return (n || 0).toLocaleString('th-TH'); }
  function ldJSON(name) {
    return getJSON(LD_BASE + name + '?t=' + Math.floor(Date.now() / 300e3), 20000);
  }
  // ระยะจากไทย (กม.) ใช้คัดเหตุการณ์ใกล้บ้าน
  function kmFromThai(lon, lat) { return km(100.5, 13.75, lon, lat); }

  // ---------- โหลดข้อมูล ----------
  function loadWorld(id, force) {
    var W = WD[id];
    if (!W || IN_ARTIFACT) return;
    var maxAge = { quakes: 5 * 60e3, gdacs: 15 * 60e3, sats: 6 * 3600e3, cables: 24 * 3600e3 }[id] || 10 * 60e3;
    if (!force && (W.loading || (W.at && Date.now() - W.at < maxAge))) return;
    W.loading = true;
    var p;
    if (id === 'quakes') p = getJSON(USGS_URL, 20000).then(function (j) { W.fc = j; });
    else if (id === 'gdacs') p = getJSON(GDACS_URL, 20000).then(function (j) { W.list = (j && j.features) || []; });
    else if (id === 'fires') p = Promise.all([ldJSON('fires_grid.json'), ldJSON('fires_sea.json').catch(function () { return null; })]).then(function (a) { W.grid = a[0]; W.sea = a[1]; });
    else if (id === 'sats') p = ldJSON('sats.json').then(function (j) { W.doc = j; return satLib(); }).then(function () { buildSatRecs(); });
    else if (id === 'cables') p = getJSON(LD_BASE + 'cables.geojson', 30000).then(function (j) { W.fc = j; });
    else p = ldJSON(id + '.json').then(function (j) { W.doc = j; });
    p.then(function () { W.err = false; W.at = Date.now(); }, function () { W.err = true; W.at = Date.now() - maxAge + 60e3; })
      .then(function () { W.loading = false; eachView(updateWorld); renderDataChips(); renderOpsHud(); if (id === 'quakes') renderSbar(); if (state.messages.some(function (m) { return m.key === 'q' && /แผ่นดินไหว|พายุ|ไฟป่า|จุดความร้อน|ดาวเทียม|ISS|เครื่องบิน|เรือ|ข่าว|เคเบิล/i.test(m.q || ''); })) renderMsgs(); });
    if (!WD.status && id !== 'quakes' && id !== 'gdacs') ldJSON('status.json').then(function (j) { WD.status = j; renderDataChips(); }, function () { /* ข้าม */ });
  }
  function worldOn(id) { return !!state.data[id] && !IN_ARTIFACT; }

  // ---------- ชั้นแผนที่ ----------
  function setGeo(map, id, data) {
    var s = map.getSource(id);
    if (s) s.setData(data); else map.addSource(id, { type: 'geojson', data: data });
  }
  function vis(map, ids, on) { ids.forEach(function (l) { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'); }); }
  function topBelow(map) { return map.getLayer('cg-pins-halo') ? 'cg-pins-halo' : undefined; }

  function quakeFC() {
    var fc = WD.quakes.fc;
    if (!fc) return emptyFC();
    var now = Date.now();
    return { type: 'FeatureCollection', features: (fc.features || []).filter(function (f) { return f.geometry && f.properties && f.properties.mag != null; }).map(function (f) {
      var p = f.properties;
      return { type: 'Feature', geometry: { type: 'Point', coordinates: f.geometry.coordinates.slice(0, 2) },
        properties: { id: f.id, mag: Math.round(p.mag * 10) / 10, place: p.place || '', time: p.time, depth: f.geometry.coordinates[2], url: p.url || '', tsu: p.tsunami || 0,
          ageH: (now - p.time) / 3600e3, alert: p.alert || '' } };
    }).sort(function (a, b) { return a.properties.mag - b.properties.mag; }) };
  }
  function updateQuakes(v) {
    var map = v.map, on = worldOn('quakes');
    if (on) loadWorld('quakes');
    if (on && WD.quakes.fc) {
      setGeo(map, 'cg-qk', quakeFC());
      if (!map.getLayer('cg-qk')) {
        map.addLayer({ id: 'cg-qk', type: 'circle', source: 'cg-qk', paint: {
          'circle-radius': ['interpolate', ['exponential', 1.6], ['get', 'mag'], 2.5, 2.5, 5, 7, 7, 17, 9, 30],
          'circle-color': ['step', ['get', 'ageH'], '#FF3B30', 1, '#FF7A1A', 24, '#FFB020', 72, '#E8D44D'],
          'circle-opacity': ['step', ['get', 'ageH'], 0.9, 24, 0.75, 72, 0.5],
          'circle-stroke-color': state.theme === 'dark' ? '#0A0F1F' : '#FFFFFF', 'circle-stroke-width': 1
        } }, topBelow(map));
      }
    }
    vis(map, ['cg-qk'], on);
  }
  var GD_T = { TC: ['พายุหมุนเขตร้อน', '🌀'], EQ: ['แผ่นดินไหว', '〰️'], FL: ['น้ำท่วม', '🌊'], VO: ['ภูเขาไฟ', '🌋'], DR: ['ภัยแล้ง', '☀️'], WF: ['ไฟป่า', '🔥'], TS: ['สึนามิ', '🌊'] };
  var GD_C = { Green: '#2FA36B', Orange: '#FF9500', Red: '#E5484D' };
  var GD_L = { Green: 'ผลกระทบต่ำ', Orange: 'ผลกระทบปานกลาง', Red: 'ผลกระทบรุนแรง' };
  function gdacsEvents() {
    var seen = {};
    return (WD.gdacs.list || []).filter(function (f) {
      var p = f.properties || {};
      if (!f.geometry || f.geometry.type !== 'Point' || !GD_T[p.eventtype]) return false;
      if (p.eventtype === 'EQ' && p.alertlevel === 'Green') return false; // แผ่นดินไหวเล็กดูจากชั้น USGS แทน
      var k = p.eventtype + p.eventid;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }
  function updateGdacs(v) {
    var on = worldOn('gdacs');
    if (on) loadWorld('gdacs');
    if (v.gdSet === WD.gdacs.list && v.gdOn === on) return;
    v.gdSet = WD.gdacs.list; v.gdOn = on;
    (v.gdMarkers || []).forEach(function (m) { m.remove(); });
    v.gdMarkers = [];
    if (!on || !WD.gdacs.list) { if (v.map.getLayer('cg-gdtc-l')) vis(v.map, ['cg-gdtc-f', 'cg-gdtc-l', 'cg-gdtc-p'], false); return; }
    vis(v.map, ['cg-gdtc-f', 'cg-gdtc-l', 'cg-gdtc-p'], true);
    gdacsEvents().forEach(function (f) {
      var p = f.properties, T = GD_T[p.eventtype];
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'gd-pin';
      el.style.setProperty('--c', GD_C[p.alertlevel] || '#888');
      el.textContent = T[1];
      el.title = T[0] + ' · ' + (p.name || '') + ' · ' + (GD_L[p.alertlevel] || '');
      el.setAttribute('aria-label', el.title);
      el.addEventListener('click', function (ev) { ev.stopPropagation(); openGdacsPopup(v, f); });
      v.gdMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(v.map));
    });
  }
  function openGdacsPopup(v, f) {
    var p = f.properties, T = GD_T[p.eventtype] || ['ภัยพิบัติ', '⚠️'];
    var link = (p.url && (p.url.report || p.url.details)) || ('https://www.gdacs.org/report.aspx?eventtype=' + p.eventtype + '&eventid=' + p.eventid);
    var box = document.createElement('div');
    box.innerHTML = '<div class="pop-meta">' + T[1] + ' ' + esc(T[0]) + ' · GDACS</div><div class="pop-title">' + esc(p.name || p.description || '') + '</div>' +
      '<div class="pop-sub"><span class="gd-lv" style="--c:' + (GD_C[p.alertlevel] || '#888') + '"></span>' + esc(GD_L[p.alertlevel] || p.alertlevel || '') + (p.country ? ' · ' + esc(p.country) : '') + '</div>' +
      '<div class="pop-sub">' + esc(msTime(isoMs(p.fromdate + 'Z'))) + (p.todate && p.todate !== p.fromdate ? ' – ' + esc(msTime(isoMs(p.todate + 'Z'))) : '') + '</div>' +
      (p.severitydata && p.severitydata.severitytext ? '<div class="pop-sub">' + esc(p.severitydata.severitytext) + '</div>' : '') +
      (p.eventtype === 'TC' ? '<div class="pop-sub gd-trk">กำลังโหลดเส้นทางพายุ…</div>' : '') +
      '<a class="src-link" href="' + esc(link) + '" target="_blank" rel="noopener">รายงานเต็มที่ GDACS' + ICO.ext + '</a>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 14, maxWidth: '300px', focusAfterOpen: false }).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(v.map);
    if (p.eventtype === 'TC') loadTcTrack(v, p, box);
  }
  // เส้นทางพายุ (ถ้า GDACS ส่งรูปเรขาคณิตมาให้)
  function loadTcTrack(v, p, box) {
    var key = p.eventid + '_' + p.episodeid, G = WD.gdacs.tc;
    var pr = G[key] || (G[key] = getJSON(GDACS_GEOM + '?eventtype=TC&eventid=' + p.eventid + '&episodeid=' + p.episodeid, 20000));
    pr.then(function (fc) {
      var feats = (fc && fc.features) || [];
      var lines = feats.filter(function (f) { return f.geometry && /LineString/.test(f.geometry.type); });
      var polys = feats.filter(function (f) { return f.geometry && /Polygon/.test(f.geometry.type); });
      var pts = feats.filter(function (f) { return f.geometry && f.geometry.type === 'Point'; });
      var map = v.map;
      setGeo(map, 'cg-gdtc', { type: 'FeatureCollection', features: polys.concat(lines, pts) });
      if (!map.getLayer('cg-gdtc-f')) {
        map.addLayer({ id: 'cg-gdtc-f', type: 'fill', source: 'cg-gdtc', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#FF9500', 'fill-opacity': 0.12 } }, topBelow(map));
        map.addLayer({ id: 'cg-gdtc-l', type: 'line', source: 'cg-gdtc', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#FF9500', 'line-width': 2.5, 'line-dasharray': [2, 1] } }, topBelow(map));
        map.addLayer({ id: 'cg-gdtc-p', type: 'circle', source: 'cg-gdtc', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3, 'circle-color': '#FF9500' } }, topBelow(map));
      }
      var t = box.querySelector('.gd-trk');
      if (t) t.textContent = lines.length || pts.length ? 'เส้นประสีส้มคือเส้นทางพายุ พื้นที่สีส้มจางคือแนวลมแรง' : 'GDACS ยังไม่มีเส้นทางของพายุนี้';
    }).catch(function () {
      var t = box.querySelector('.gd-trk');
      if (t) t.textContent = 'โหลดเส้นทางพายุไม่ได้ตอนนี้ ดูในรายงานเต็มที่ GDACS';
    });
  }

  function fireFCs() {
    var g = WD.fires.grid, s = WD.fires.sea;
    var grid = !g ? emptyFC() : { type: 'FeatureCollection', features: (g.c || []).map(function (c) {
      var inSea = s && s.bbox && c[0] >= s.bbox[0] && c[0] <= s.bbox[2] && c[1] >= s.bbox[1] && c[1] <= s.bbox[3];
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [c[0], c[1]] }, properties: { n: c[2], frp: c[3], sea: inSea ? 1 : 0 } };
    }) };
    var pts = !s ? emptyFC() : { type: 'FeatureCollection', features: (s.p || []).map(function (p) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [p[0], p[1]] }, properties: { frp: p[2], conf: p[3], time: p[4], day: p[5] } };
    }) };
    return { grid: grid, pts: pts };
  }
  function updateFires(v) {
    var map = v.map, on = worldOn('fires');
    if (on) loadWorld('fires');
    if (on && WD.fires.grid && (v.fireSet !== WD.fires.grid || !map.getSource('cg-fire-g'))) {
      var F = fireFCs();
      setGeo(map, 'cg-fire-g', F.grid);
      setGeo(map, 'cg-fire-p', F.pts);
      v.fireSet = WD.fires.grid;
      if (!map.getLayer('cg-fire-g')) {
        map.addLayer({ id: 'cg-fire-g', type: 'circle', source: 'cg-fire-g',
          filter: ['any', ['==', ['get', 'sea'], 0], ['<', ['zoom'], 5.5]],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 2, 6, 6, 20, 14],
            'circle-color': ['interpolate', ['linear'], ['get', 'frp'], 5, '#FFC94D', 50, '#FF7A1A', 300, '#E5302B'],
            'circle-opacity': 0.75, 'circle-blur': 0.3 } }, topBelow(map));
        map.addLayer({ id: 'cg-fire-p', type: 'circle', source: 'cg-fire-p', minzoom: 5.5,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5.5, 2.5, 10, 5, 14, 8],
            'circle-color': ['interpolate', ['linear'], ['get', 'frp'], 2, '#FFC94D', 20, '#FF7A1A', 100, '#E5302B'],
            'circle-stroke-color': '#3A0A00', 'circle-stroke-width': 0.6, 'circle-opacity': 0.9 } }, topBelow(map));
      }
    }
    vis(map, ['cg-fire-g', 'cg-fire-p'], on);
  }
  function firesInThai() {
    var s = WD.fires.sea;
    if (!s) return null;
    var byProv = {}, n = 0;
    (s.p || []).forEach(function (p) {
      if (p[0] < 97 || p[0] > 106 || p[1] < 5.5 || p[1] > 20.6) return;
      var pid = provinceAt(p[0], p[1]);
      if (!pid) return;
      n++;
      byProv[pid] = (byProv[pid] || 0) + 1;
    });
    return { n: n, top: Object.keys(byProv).map(function (k) { return { id: k, n: byProv[k] }; }).sort(function (a, b) { return b.n - a.n; }) };
  }

  // กลางวัน/กลางคืน: ตำแหน่งดวงอาทิตย์อย่างง่าย (ความแม่นระดับนาที) แล้วหาเส้นแบ่งตามมุมเงย
  function sunPos(d) {
    var rad = Math.PI / 180, n = (d.getTime() / 86400e3) + 2440587.5 - 2451545.0;
    var L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, eps = (23.439 - 0.0000004 * n) * rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    var lon = ((ra / rad - gmst) % 360 + 540) % 360 - 180;
    return { dec: dec, lon: lon };
  }
  function nightPoly(d, hDeg) {
    var s = sunPos(d), rad = Math.PI / 180, sh = Math.sin(hDeg * rad), ring = [], lim = 84.9;
    for (var lon = -180; lon <= 180; lon += 2) {
      var H = (lon - s.lon) * rad, a = Math.sin(s.dec), b = Math.cos(s.dec) * Math.cos(H);
      var R = Math.sqrt(a * a + b * b), al = Math.atan2(b, a), lat;
      if (Math.abs(sh / R) >= 1) lat = (sh > 0) === (s.dec > 0) ? lim : -lim; // ทั้งเส้นแวงไม่มีจุดที่มุมเงยเท่านี้
      else {
        lat = (Math.asin(sh / R) - al) / rad;
        if (lat < -90) lat += 180; if (lat > 90) lat -= 180;
        if (lat < -90 || lat > 90) lat = Math.max(-lim, Math.min(lim, (Math.PI - Math.asin(sh / R) - al) / rad));
      }
      ring.push([lon, Math.max(-lim, Math.min(lim, lat))]);
    }
    var pole = s.dec > 0 ? -lim : lim; // ซีกที่เป็นกลางคืนต่อเนื่องคือขั้วฝั่งตรงข้ามดวงอาทิตย์
    ring.push([180, pole], [-180, pole], ring[0]);
    return { type: 'Feature', properties: { h: hDeg }, geometry: { type: 'Polygon', coordinates: [ring] } };
  }
  function updateDayNight(v) {
    var map = v.map, on = worldOn('daynight');
    if (on) {
      var d = new Date(), s = sunPos(d);
      setGeo(map, 'cg-night', { type: 'FeatureCollection', features: [nightPoly(d, 0), nightPoly(d, -12)] });
      setGeo(map, 'cg-sun', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lon, s.dec * 180 / Math.PI] } }] });
      if (!map.getLayer('cg-night')) {
        map.addLayer({ id: 'cg-night', type: 'fill', source: 'cg-night', paint: { 'fill-color': '#020817', 'fill-opacity': 0.22 } }, map.getLayer('cg-thr-fill') ? 'cg-thr-fill' : undefined);
        map.addLayer({ id: 'cg-sun', type: 'circle', source: 'cg-sun', paint: { 'circle-radius': 9, 'circle-color': '#FFD54A', 'circle-blur': 0.4, 'circle-stroke-color': '#FFF3B0', 'circle-stroke-width': 2 } }, topBelow(map));
      }
      clearInterval(v.dnTimer);
      v.dnTimer = setInterval(function () { if (!document.hidden) updateDayNight(v); }, 60e3);
    } else clearInterval(v.dnTimer);
    vis(map, ['cg-night', 'cg-sun'], on);
  }

  // ---------- ดาวเทียม ----------
  var SAT_INFO = {
    25544: ['สถานีอวกาศนานาชาติ (ISS)', 'มีนักบินอวกาศอยู่ตลอด โคจรรอบโลกทุก 90 นาที'],
    48274: ['สถานีอวกาศเทียนกง (จีน)', 'สถานีอวกาศของจีน มีนักบินอวกาศอยู่'],
    33396: ['ไทยโชต (THEOS)', 'ดาวเทียมสำรวจโลกดวงแรกของไทย ดูแลโดย GISTDA'],
    58016: ['THEOS-2', 'ดาวเทียมสำรวจโลกของไทย ถ่ายภาพละเอียด 0.5 ม. ดูแลโดย GISTDA'],
    46320: ['NAPA-1', 'ดาวเทียมขนาดเล็กของกองทัพอากาศไทย'],
    67683: ['KNACKSAT-2', 'ดาวเทียมขนาดเล็กฝีมือนักศึกษา มจพ.'],
    41836: ['Himawari-9', 'ดาวเทียมอุตุนิยมวิทยาของญี่ปุ่น อยู่นิ่งเหนือเส้นศูนย์สูตร · ภาพเมฆบน ChatGeo มาจากดวงนี้'],
    39634: ['Sentinel-1A', 'ดาวเทียมเรดาร์ของยุโรป มองทะลุเมฆได้ · ChatGeo ใช้ตรวจน้ำท่วม'],
    62261: ['Sentinel-1C', 'ดาวเทียมเรดาร์ของยุโรป · ChatGeo ใช้ตรวจน้ำท่วม'],
    40697: ['Sentinel-2A', 'ภาพสีจริงละเอียด 10 ม. ของยุโรป · ภาพพื้นหลังดาวเทียม'],
    42063: ['Sentinel-2B', 'ภาพสีจริงละเอียด 10 ม. ของยุโรป'],
    60989: ['Sentinel-2C', 'ภาพสีจริงละเอียด 10 ม. ของยุโรป'],
    39084: ['Landsat 8', 'ดาวเทียมสำรวจโลกของสหรัฐฯ · ข้อมูลน้ำในอดีต 41 ปีมาจากตระกูลนี้'],
    49260: ['Landsat 9', 'ดาวเทียมสำรวจโลกของสหรัฐฯ รุ่นล่าสุดในตระกูล Landsat'],
    43013: ['NOAA-20', 'ดาวเทียมอุตุฯ วงโคจรขั้วโลก · จุดความร้อนบน ChatGeo มาจากดวงนี้'],
    54234: ['NOAA-21', 'ดาวเทียมอุตุฯ วงโคจรขั้วโลก ตรวจจุดความร้อนได้'],
    37849: ['Suomi NPP', 'ดาวเทียมอุตุฯ วงโคจรขั้วโลก ตรวจจุดความร้อนได้'],
    28786: ['ไทยคม 4', 'ดาวเทียมสื่อสารของไทย อยู่นิ่งเหนือเส้นศูนย์สูตร'],
    39500: ['ไทยคม 6', 'ดาวเทียมสื่อสารของไทย อยู่นิ่งเหนือเส้นศูนย์สูตร'],
    41552: ['ไทยคม 8', 'ดาวเทียมสื่อสารของไทย อยู่นิ่งเหนือเส้นศูนย์สูตร']
  };
  function satLib() {
    if (window.satellite) return Promise.resolve(window.satellite);
    if (WD.sats.lib) return WD.sats.lib;
    WD.sats.lib = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = 'vendor/satellite.min.js';
      s.onload = function () { if (window.satellite) ok(window.satellite); else no(new Error('no lib')); };
      s.onerror = function () { WD.sats.lib = null; no(new Error('load')); };
      document.head.appendChild(s);
    });
    return WD.sats.lib;
  }
  function buildSatRecs() {
    var S = WD.sats, doc = S.doc, lib = window.satellite;
    if (!doc || !lib) return;
    var feat = {};
    (doc.featured || []).forEach(function (id) { feat[id] = 1; });
    S.recs = [];
    (doc.omm || []).forEach(function (r) {
      try {
        var rec = lib.json2satrec({ OBJECT_NAME: r[0], NORAD_CAT_ID: r[1], OBJECT_ID: r[2], EPOCH: r[3], MEAN_MOTION: r[4], ECCENTRICITY: r[5], INCLINATION: r[6],
          RA_OF_ASC_NODE: r[7], ARG_OF_PERICENTER: r[8], MEAN_ANOMALY: r[9], BSTAR: r[10], MEAN_MOTION_DOT: r[11], MEAN_MOTION_DDOT: r[12],
          REV_AT_EPOCH: r[13], ELEMENT_SET_NO: r[14], EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U' });
        S.recs.push({ id: r[1], name: r[0], rec: rec, feat: !!feat[r[1]], geo: r[4] < 1.1 });
      } catch (e) { /* ข้ามดวงที่ข้อมูลเสีย */ }
    });
  }
  function satPos(s, d) {
    var lib = window.satellite, pv = lib.propagate(s.rec, d);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    var g = lib.eciToGeodetic(pv.position, lib.gstime(d)), v = pv.velocity;
    return { lon: lib.degreesLong(g.longitude), lat: lib.degreesLat(g.latitude), h: g.height, v: v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0, eci: pv.position };
  }
  function satLabel(s) { return (SAT_INFO[s.id] || [s.name])[0]; }
  function updateSats(v) {
    var map = v.map, on = worldOn('sats'), S = WD.sats;
    if (on) loadWorld('sats');
    clearInterval(v.satTimer);
    if (!on || !S.recs.length) {
      vis(map, ['cg-sat-all', 'cg-sat-trk'], false);
      (v.satMarkers || []).forEach(function (m) { m.mk.remove(); });
      v.satMarkers = [];
      return;
    }
    if (!v.satMarkers || !v.satMarkers.length) {
      v.satMarkers = S.recs.filter(function (s) { return s.feat; }).map(function (s) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'sat-pin' + (s.id === 25544 || s.id === 48274 ? ' crew' : '') + (SAT_INFO[s.id] && /ไทย|THEOS|NAPA|KNACK/.test(SAT_INFO[s.id][0]) ? ' th' : '');
        el.innerHTML = '<i></i><span>' + esc(satLabel(s)) + '</span>';
        el.setAttribute('aria-label', 'ดาวเทียม ' + satLabel(s));
        el.addEventListener('click', function (ev) { ev.stopPropagation(); S.sel = s.id; openSatPopup(v, s); drawSatTrack(v); });
        return { s: s, mk: new maplibregl.Marker({ element: el }).setLngLat([0, 0]).addTo(map) };
      });
    }
    function tick() {
      var d = new Date();
      v.satMarkers.forEach(function (m) { var p = satPos(m.s, d); if (p) { m.mk.setLngLat([p.lon, p.lat]); m.last = p; } });
      if (v.popup && v.popup._sat) { var m = find(v.satMarkers, function (x) { return x.s.id === v.popup._sat; }); if (m && m.last) { v.popup.setLngLat([m.last.lon, m.last.lat]); satPopupText(v.popup._box, m.s, m.last); } }
    }
    tick();
    v.satTimer = setInterval(function () { if (!document.hidden) tick(); }, 1000);
    // ดาวเทียมทั้งหมด (จุดเล็ก) อัปเดตทุก 5 วินาที
    if (S.all) {
      var all = function () {
        var d = new Date();
        setGeo(map, 'cg-sat-all', { type: 'FeatureCollection', features: S.recs.filter(function (s) { return !s.feat; }).map(function (s) {
          var p = satPos(s, d);
          return p ? { type: 'Feature', properties: { id: s.id, n: s.name, geo: s.geo ? 1 : 0, h: Math.round(p.h) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } } : null;
        }).filter(Boolean) });
        if (!map.getLayer('cg-sat-all')) {
          map.addLayer({ id: 'cg-sat-all', type: 'circle', source: 'cg-sat-all', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.5],
            'circle-color': ['case', ['==', ['get', 'geo'], 1], '#B48CFF', ['<', ['get', 'h'], 2000], '#7FD4FF', '#FFE07A'], 'circle-opacity': 0.8 } }, topBelow(map));
        }
      };
      all();
      var k = 0;
      var t0 = v.satTimer;
      clearInterval(t0);
      v.satTimer = setInterval(function () { if (document.hidden) return; tick(); if (++k % 5 === 0) all(); }, 1000);
    }
    opsSatPaint(map);
    vis(map, ['cg-sat-all'], !!S.all);
    vis(map, ['cg-sat-trk'], !!S.sel);
  }
  function satPopupText(box, s, p) {
    var info = SAT_INFO[s.id];
    box.innerHTML = '<div class="pop-meta">🛰 ดาวเทียม · NORAD ' + s.id + '</div><div class="pop-title">' + esc(satLabel(s)) + '</div>' +
      (info ? '<div class="pop-sub">' + esc(info[1]) + '</div>' : '') +
      '<div class="pop-sub">สูง ' + fmtN(Math.round(p.h)) + ' กม. · ความเร็ว ' + fmtN(Math.round(p.v * 3600)) + ' กม./ชม. · เหนือ ' + p.lat.toFixed(1) + '°, ' + p.lon.toFixed(1) + '°</div>' +
      '<div class="pop-sub">เส้นประคือแนวที่ดาวเทียมจะผ่านใน 90 นาทีข้างหน้า</div>';
  }
  function openSatPopup(v, s) {
    var p = satPos(s, new Date());
    if (!p) return;
    var box = document.createElement('div');
    satPopupText(box, s, p);
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 12, maxWidth: '290px', focusAfterOpen: false }).setLngLat([p.lon, p.lat]).setDOMContent(box).addTo(v.map);
    v.popup._sat = s.id; v.popup._box = box;
    v.popup.on('close', function () { WD.sats.sel = null; vis(v.map, ['cg-sat-trk'], false); });
  }
  function drawSatTrack(v) {
    var S = WD.sats, s = find(S.recs, function (x) { return x.id === S.sel; });
    if (!s) return;
    var segs = [], cur = [], prevLon = null, now = Date.now();
    for (var t = -10; t <= 90; t += 1) {
      var p = satPos(s, new Date(now + t * 60e3));
      if (!p) continue;
      if (prevLon != null && Math.abs(p.lon - prevLon) > 180) { segs.push(cur); cur = []; }
      cur.push([p.lon, p.lat]);
      prevLon = p.lon;
    }
    segs.push(cur);
    var map = v.map;
    setGeo(map, 'cg-sat-trk', { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segs.filter(function (x) { return x.length > 1; }) } });
    if (!map.getLayer('cg-sat-trk')) map.addLayer({ id: 'cg-sat-trk', type: 'line', source: 'cg-sat-trk', paint: { 'line-color': '#7FD4FF', 'line-width': 1.6, 'line-dasharray': [2, 2] } }, topBelow(map));
    vis(map, ['cg-sat-trk'], true);
  }
  // รอบที่ ISS ผ่านหัว (48 ชม.) และมองเห็นด้วยตาเปล่าไหม (ฟ้ามืด + ดาวเทียมโดนแดด)
  function issPasses(lat, lon, hours) {
    var lib = window.satellite, S = WD.sats, s = find(S.recs, function (x) { return x.id === 25544; });
    if (!lib || !s) return null;
    var obs = { longitude: lon * Math.PI / 180, latitude: lat * Math.PI / 180, height: 0.05 }, out = [], cur = null, t0 = Date.now();
    for (var t = 0; t < hours * 3600; t += 30) {
      var d = new Date(t0 + t * 1000), pv = lib.propagate(s.rec, d);
      if (!pv || !pv.position) continue;
      var gm = lib.gstime(d), la = lib.ecfToLookAngles(obs, lib.eciToEcf(pv.position, gm)), el = la.elevation * 180 / Math.PI;
      if (el > 10) {
        if (!cur) cur = { start: d.getTime(), max: el, maxAt: d.getTime(), lit: false, dark: false };
        if (el > cur.max) { cur.max = el; cur.maxAt = d.getTime(); }
        var sun = sunPos(d), H = (lon - sun.lon) * Math.PI / 180;
        var sunEl = Math.asin(Math.sin(lat * Math.PI / 180) * Math.sin(sun.dec) + Math.cos(lat * Math.PI / 180) * Math.cos(sun.dec) * Math.cos(H)) * 180 / Math.PI;
        if (sunEl < -6) cur.dark = true;
        if (satSunlit(pv.position, d)) cur.lit = true;
      } else if (cur) { cur.end = d.getTime(); out.push(cur); cur = null; if (out.length >= 6) break; }
    }
    return out;
  }
  function satSunlit(r, d) { // เงาโลกแบบทรงกระบอก
    var sun = sunPos(d), gm = window.satellite.gstime(d);
    var ra = sun.lon * Math.PI / 180 + gm; // ทิศดวงอาทิตย์ในกรอบ ECI โดยประมาณ
    var sx = Math.cos(sun.dec) * Math.cos(ra), sy = Math.cos(sun.dec) * Math.sin(ra), sz = Math.sin(sun.dec);
    var dot = r.x * sx + r.y * sy + r.z * sz;
    if (dot > 0) return true;
    var px = r.x - dot * sx, py = r.y - dot * sy, pz = r.z - dot * sz;
    return Math.sqrt(px * px + py * py + pz * pz) > 6371;
  }

  // ---------- เครื่องบินและเรือ ----------
  function ensureIcon(map, id, draw) {
    if (map.hasImage(id)) return;
    var c = document.createElement('canvas'); c.width = c.height = 48;
    var g = c.getContext('2d'); draw(g);
    map.addImage(id, g.getImageData(0, 0, 48, 48), { pixelRatio: 2, sdf: true });
  }
  function drawPlane(g) {
    g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(24, 3); g.lineTo(27, 16); g.lineTo(44, 26); g.lineTo(44, 30); g.lineTo(27, 25); g.lineTo(26, 38); g.lineTo(32, 43); g.lineTo(32, 45);
    g.lineTo(24, 43); g.lineTo(16, 45); g.lineTo(16, 43); g.lineTo(22, 38); g.lineTo(21, 25); g.lineTo(4, 30); g.lineTo(4, 26); g.lineTo(21, 16); g.closePath(); g.fill();
  }
  function drawShip(g) {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(24, 4); g.lineTo(34, 30); g.lineTo(30, 44); g.lineTo(18, 44); g.lineTo(14, 30); g.closePath(); g.fill();
  }
  function updateAircraft(v) {
    var map = v.map, on = worldOn('aircraft'), D = WD.aircraft.doc;
    if (on) loadWorld('aircraft');
    if (on && D && (v.acSet !== D || !map.getSource('cg-ac'))) {
      v.acSet = D;
      ensureIcon(map, 'cg-plane', drawPlane);
      setGeo(map, 'cg-ac', { type: 'FeatureCollection', features: (D.ac || []).map(function (a) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [a[2], a[3]] },
          properties: { hex: a[0], f: a[1], alt: a[4] == null ? -1 : a[4], gs: a[5], trk: a[6], t: a[7], r: a[8] } };
      }) });
      if (!map.getLayer('cg-ac')) {
        map.addLayer({ id: 'cg-ac', type: 'symbol', source: 'cg-ac', layout: { 'icon-image': 'cg-plane', 'icon-rotate': ['get', 'trk'], 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.45, 8, 0.8, 12, 1] },
          paint: { 'icon-color': ['case', ['<=', ['get', 'alt'], 0], '#9AA8BC', ['<', ['get', 'alt'], 10000], '#6EE7A8', ['<', ['get', 'alt'], 30000], '#FFD166', '#5CC8FF'],
            'icon-halo-color': '#0A0F1F', 'icon-halo-width': 1 } }, topBelow(map));
      }
    }
    vis(map, ['cg-ac'], on);
  }
  var NAV = { 0: 'กำลังแล่น', 1: 'ทอดสมอ', 2: 'ไม่มีคนบังคับ', 3: 'บังคับทิศได้จำกัด', 5: 'จอดเทียบท่า', 6: 'เกยตื้น', 7: 'กำลังทำประมง', 8: 'แล่นด้วยใบ' };
  function updateShips(v) {
    var map = v.map, on = worldOn('ships'), D = WD.ships.doc;
    if (on) loadWorld('ships');
    if (on && D && (v.shSet !== D || !map.getSource('cg-sh'))) {
      v.shSet = D;
      ensureIcon(map, 'cg-ship', drawShip);
      setGeo(map, 'cg-sh', { type: 'FeatureCollection', features: (D.s || []).map(function (s) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [s[2], s[3]] }, properties: { m: s[0], n: s[1], sog: s[4], cog: s[5], st: s[6] } };
      }) });
      if (!map.getLayer('cg-sh')) {
        map.addLayer({ id: 'cg-sh', type: 'symbol', source: 'cg-sh', layout: { 'icon-image': 'cg-ship', 'icon-rotate': ['get', 'cog'], 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.22, 7, 0.5, 12, 0.8] },
          paint: { 'icon-color': ['case', ['==', ['get', 'st'], 7], '#FFB020', ['<', ['get', 'sog'], 0.5], '#8FA3B8', '#4FD1C5'] } }, topBelow(map));
      }
    }
    vis(map, ['cg-sh'], on);
  }

  // ---------- ข่าวสด ----------
  function newsPlaces() {
    var D = WD.news.doc, by = {};
    ((D && D.items) || []).forEach(function (it) {
      if (!it.place) return;
      var k = it.place.lon.toFixed(2) + ',' + it.place.lat.toFixed(2);
      (by[k] = by[k] || { place: it.place, items: [] }).items.push(it);
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function updateNews(v) {
    var map = v.map, on = worldOn('news');
    if (on) loadWorld('news');
    if (on && WD.news.doc && (v.nwSet !== WD.news.doc || !map.getSource('cg-nw'))) {
      v.nwSet = WD.news.doc;
      setGeo(map, 'cg-nw', { type: 'FeatureCollection', features: newsPlaces().map(function (g, i) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [g.place.lon, g.place.lat] }, properties: { i: i, n: g.items.length, name: g.place.name, newest: isoMs(g.items[0].t) } };
      }) });
      v.nwGroups = newsPlaces();
      if (!map.getLayer('cg-nw')) {
        map.addLayer({ id: 'cg-nw', type: 'circle', source: 'cg-nw', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 6, 10, 13],
          'circle-color': '#B07CFF', 'circle-opacity': 0.85, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.5 } }, topBelow(map));
      }
    }
    vis(map, ['cg-nw'], on);
  }
  function newsRowsHtml(items, max) {
    return items.slice(0, max).map(function (it) {
      return '<a class="nw-row" href="' + esc(it.url) + '" target="_blank" rel="noopener"><b>' + esc(it.title) + '</b><span>' + esc(it.src) + ' · ' + esc(agoText(isoMs(it.t))) +
        (it.place ? ' · ' + esc(it.place.name) : '') + '</span></a>';
    }).join('');
  }
  function openNewsPopup(v, idx, ll) {
    var g = (v.nwGroups || [])[idx];
    if (!g) return;
    var box = document.createElement('div');
    box.className = 'nw-pop';
    box.innerHTML = '<div class="pop-meta">📰 ข่าวล่าสุด · ' + esc(g.place.name) + '</div>' + newsRowsHtml(g.items, 6) +
      '<div class="pop-sub">หัวข่าวภาษาอังกฤษจากสำนักข่าวต้นทาง กดเพื่ออ่านข่าวเต็ม</div>';
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 10, maxWidth: '320px', focusAfterOpen: false }).setLngLat(ll).setDOMContent(box).addTo(v.map);
  }

  // ---------- สายเคเบิลใต้ทะเล ----------
  function updateCables(v) {
    var map = v.map, on = worldOn('cables');
    if (on) loadWorld('cables');
    if (on && WD.cables.fc && (v.cbSet !== WD.cables.fc || !map.getSource('cg-cb'))) {
      v.cbSet = WD.cables.fc;
      setGeo(map, 'cg-cb', WD.cables.fc);
      if (!map.getLayer('cg-cb')) {
        map.addLayer({ id: 'cg-cb', type: 'line', source: 'cg-cb', paint: { 'line-color': '#36D1DC', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 8, 1.6], 'line-opacity': 0.7 } },
          map.getLayer('cg-thr-fill') ? 'cg-thr-fill' : undefined);
      }
    }
    vis(map, ['cg-cb'], on);
  }

  function updateWorld(v) {
    if (!v || v.kind !== 'chat' || v.styleLoading || !v.map.getSource('cg-water')) return;
    updateDayNight(v);
    updateCables(v);
    updateFires(v);
    updateQuakes(v);
    updateNews(v);
    updateShips(v);
    updateAircraft(v);
    updateSats(v);
    updateGdacs(v);
  }
  function openQuakePopup(v, f) {
    var p = f.properties, c = f.geometry.coordinates, box = document.createElement('div'), d = Math.round(kmFromThai(c[0], c[1]));
    var mag = Math.round(p.mag * 10) / 10, dep = c[2] != null ? c[2] : p.depth;
    box.innerHTML = '<div class="pop-meta">แผ่นดินไหว · USGS</div><div class="pop-title">ขนาด ' + mag + ' · ' + esc(p.place || '') + '</div>' +
      '<div class="pop-sub">' + esc(msTime(+p.time)) + ' (' + esc(agoText(+p.time)) + ')' + (dep != null ? ' · ลึก ' + Math.round(dep) + ' กม.' : '') + '</div>' +
      '<div class="pop-sub">ห่างกรุงเทพฯ ราว ' + fmtN(d) + ' กม.' + (+p.tsunami || +p.tsu ? ' · มีการแจ้งเตือนสึนามิจากหน่วยงาน ตรวจประกาศทางการ' : '') + '</div>' +
      (p.url ? '<a class="src-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">รายละเอียดที่ USGS' + ICO.ext + '</a>' : '');
    if (v.popup) v.popup.remove();
    v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 8, maxWidth: '290px', focusAfterOpen: false }).setLngLat(c.slice(0, 2)).setDOMContent(box).addTo(v.map);
  }
  // คลิกบนชั้นโลก
  function worldClicks(v) {
    var map = v.map;
    function on(layer, fn) {
      map.on('click', layer, function (e) { if (SITE.pick || PARCEL.on) return; var f = e.features && e.features[0]; if (f) fn(f, e); });
      map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
    }
    on('cg-qk', function (f) { openQuakePopup(v, f); });
    function firePop(f) {
      var p = f.properties, box = document.createElement('div');
      box.innerHTML = p.n != null
        ? '<div class="pop-meta">จุดความร้อน 24 ชม. · NASA FIRMS</div><div class="pop-title">' + fmtN(+p.n) + ' จุดในช่องนี้ (ราว 55×55 กม.)</div><div class="pop-sub">ความแรงสูงสุด ' + Math.round(p.frp) + ' MW · ซูมเข้าใกล้ไทยเพื่อดูรายจุด</div>'
        : '<div class="pop-meta">จุดความร้อน · NASA FIRMS (VIIRS 375 ม.)</div><div class="pop-title">ความแรง ' + (+p.frp).toFixed(1) + ' MW</div>' +
          '<div class="pop-sub">' + esc(msTime(isoMs(p.time))) + ' · ' + (+p.day ? 'กลางวัน' : 'กลางคืน') + ' · ความมั่นใจ ' + ['ต่ำ', 'ปกติ', 'สูง'][+p.conf] + '</div>';
      box.innerHTML += '<div class="pop-sub">จุดความร้อนอาจเป็นไฟป่า การเผาในไร่ หรือโรงงาน ไม่ใช่ไฟป่าทุกจุด</div>';
      if (v.popup) v.popup.remove();
      v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 6, maxWidth: '280px', focusAfterOpen: false }).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(map);
    }
    on('cg-fire-g', firePop);
    on('cg-fire-p', firePop);
    on('cg-ac', function (f) {
      var p = f.properties, box = document.createElement('div'), alt = +p.alt;
      box.innerHTML = '<div class="pop-meta">✈️ เครื่องบิน · adsb.lol</div><div class="pop-title">' + esc(p.f || p.hex) + (p.t ? ' · ' + esc(p.t) : '') + '</div>' +
        '<div class="pop-sub">' + (alt <= 0 ? 'อยู่บนพื้น' : 'สูง ' + fmtN(alt) + ' ฟุต (' + fmtN(Math.round(alt * 0.3048)) + ' ม.)') + ' · ' + fmtN(Math.round(p.gs * 1.852)) + ' กม./ชม. · ทิศ ' + Math.round(p.trk) + '°</div>' +
        (p.r ? '<div class="pop-sub">ทะเบียน ' + esc(p.r) + '</div>' : '') +
        '<div class="pop-sub">ตำแหน่ง ณ ' + esc(msTime(isoMs(WD.aircraft.doc.t))) + ' (ภาพทุก ~20 นาที ไม่ใช่ตำแหน่งสด)</div>';
      if (v.popup) v.popup.remove();
      v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 8, maxWidth: '280px', focusAfterOpen: false }).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(map);
    });
    on('cg-sh', function (f) {
      var p = f.properties, box = document.createElement('div');
      box.innerHTML = '<div class="pop-meta">🚢 เรือ · AIS</div><div class="pop-title">' + esc(p.n || 'ไม่ทราบชื่อ') + '</div>' +
        '<div class="pop-sub">MMSI ' + esc(p.m) + ' · ' + (+p.sog).toFixed(1) + ' นอต · ทิศ ' + Math.round(p.cog) + '° · ' + esc(NAV[+p.st] || 'ไม่ระบุสถานะ') + '</div>' +
        '<div class="pop-sub">ตำแหน่ง ณ ' + esc(msTime(isoMs(WD.ships.doc.t))) + ' (ภาพทุก ~20 นาที)</div>';
      if (v.popup) v.popup.remove();
      v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 8, maxWidth: '280px', focusAfterOpen: false }).setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(map);
    });
    on('cg-nw', function (f, e) { openNewsPopup(v, +f.properties.i, e.lngLat); });
    on('cg-cb', function (f, e) {
      var p = f.properties, box = document.createElement('div');
      box.innerHTML = '<div class="pop-meta">สายเคเบิลใต้ทะเล · OpenStreetMap</div><div class="pop-title">' + esc(p.name || 'ไม่ทราบชื่อ') + '</div>' +
        (p.operator ? '<div class="pop-sub">' + esc(p.operator) + '</div>' : '') +
        '<div class="pop-sub">ข้อมูลจากอาสาสมัคร OSM อาจไม่ครบทุกเส้น แผนที่ฉบับเต็มดูที่ <a href="https://www.submarinecablemap.com/" target="_blank" rel="noopener">submarinecablemap.com</a></div>';
      if (v.popup) v.popup.remove();
      v.popup = new maplibregl.Popup({ className: 'cg-popup', offset: 6, maxWidth: '280px', focusAfterOpen: false }).setLngLat(e.lngLat).setDOMContent(box).addTo(map);
    });
    on('cg-sat-all', function (f) {
      var s = find(WD.sats.recs, function (x) { return x.id === +f.properties.id; });
      if (s) { WD.sats.sel = s.id; openSatPopup(v, s); drawSatTrack(v); }
    });
  }

  // ---------- คำอธิบายในเมนูชั้นข้อมูล ----------
  function worldSub(id) {
    var W = WD[id], st = WD.status && WD.status.tasks && WD.status.tasks[id];
    if (id === 'daynight') { var s = sunPos(new Date()); return 'อัปเดตทุกนาที · ดวงอาทิตย์อยู่เหนือ ' + (s.dec * 180 / Math.PI).toFixed(1) + '°, ' + s.lon.toFixed(0) + '°'; }
    if (!W) return '';
    if (W.err) return id === 'ships' ? 'ยังไม่มีข้อมูล (ต้องตั้งคีย์ aisstream ฟรี)' : 'โหลดไม่ได้ตอนนี้';
    if (id === 'quakes') return W.fc ? 'USGS · 7 วัน ' + fmtN((W.fc.features || []).length) + ' ครั้ง (M2.5+)' : 'USGS · ทั่วโลก';
    if (id === 'gdacs') return W.list ? 'GDACS · ' + gdacsEvents().length + ' เหตุการณ์' : 'GDACS · พายุ น้ำท่วม ภูเขาไฟ';
    if (id === 'fires') return W.grid ? 'NASA FIRMS · 24 ชม. ' + fmtN(W.grid.n) + ' จุด · ' + msTime(isoMs(W.grid.t)) : 'NASA FIRMS · ทั่วโลก';
    if (id === 'sats') return W.doc ? 'CelesTrak · ' + fmtN(W.recs.length) + ' ดวง (ไม่รวม Starlink ' + fmtN((W.doc.mega || {}).STARLINK || 0) + ')' : 'CelesTrak · ตำแหน่งคำนวณสด';
    if (id === 'aircraft') return W.doc ? 'adsb.lol · ' + fmtN((W.doc.ac || []).length) + ' ลำ รอบไทย · ' + msTime(isoMs(W.doc.t)) : 'adsb.lol · ไทยและเพื่อนบ้าน';
    if (id === 'ships') return W.doc ? 'AIS · ' + fmtN((W.doc.s || []).length) + ' ลำ ทั่วโลก · ' + msTime(isoMs(W.doc.t)) : (st && st.info && st.info.skip ? 'ยังไม่ได้ตั้งคีย์ aisstream' : 'AIS · ทั่วโลก');
    if (id === 'news') return W.doc ? 'RSS · ' + (W.doc.items || []).length + ' หัวข่าว 48 ชม. · ' + msTime(isoMs(W.doc.t)) : 'Bangkok Post · BBC · DW';
    if (id === 'cables') return W.fc ? 'OpenStreetMap · ' + fmtN((W.fc.features || []).length) + ' เส้น' : 'OpenStreetMap · ทั่วโลก';
    return '';
  }
  function worldLegendHtml() {
    var h = '';
    if (state.data.quakes) h += '<div class="rain-legend wx-legend"><span>แผ่นดินไหว</span><span class="sp"></span><i style="background:#FF3B30" title="1 ชม."></i><i style="background:#FF7A1A" title="24 ชม."></i><i style="background:#FFB020" title="3 วัน"></i><i style="background:#E8D44D" title="7 วัน"></i><span>ใหม่ → เก่า (วงใหญ่ = แรง)</span></div>';
    if (state.data.fires) h += '<div class="rain-legend wx-legend"><span>จุดความร้อน</span><span class="sp"></span><i style="background:#FFC94D"></i><i style="background:#FF7A1A"></i><i style="background:#E5302B"></i><span>อ่อน → แรง</span></div>';
    if (state.data.aircraft) h += '<p class="fp-fine">เครื่องบิน: เทา = บนพื้น เขียว = ต่ำกว่า 10,000 ฟุต เหลือง = กำลังไต่/ลด ฟ้า = ระดับบิน · ภาพทุก ~20 นาที ไม่ใช่ตำแหน่งสด</p>';
    if (state.data.sats) h += '<button type="button" class="fp-row fp-switch" data-sat-all aria-pressed="' + !!WD.sats.all + '"><span class="fp-two"><span>แสดงดาวเทียมทั้งหมด</span><small>จุดเล็ก ฟ้า = วงโคจรต่ำ เหลือง = สูง ม่วง = ค้างฟ้า</small></span><span class="sw" aria-hidden="true"><i></i></span></button>';
    var on = WORLD_IDS.filter(function (k) { return state.data[k] && W_ATTR[k]; });
    if (on.length) h += '<p class="fp-fine">' + on.map(function (k) { return W_ATTR[k]; }).join(' · ') + '</p>';
    return h;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sat-all]');
    if (!b) return;
    WD.sats.all = !WD.sats.all;
    eachView(function (v) { updateSats(v); });
    renderDataChips();
  });
  /* ---------- โหมดห้องควบคุม (หน้าตาแบบศูนย์ปฏิบัติการ: อวกาศมืด ลูกโลกหมุน แถบไอคอน แถบข่าววิ่ง) ---------- */
  var OPS = { on: false, prev: null, clock: 0, raf: 0, idleAt: 0, theme: null, globe: null, spin: true, satAll: null, kp: null, kpAt: 0, tickSig: '', items: [], tick: [] };
  function opsIco(d, extra) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>'; }
  var OPS_ROWS = [
    ['quakes', 'แผ่นดินไหว 24 ชม.', '<path d="M2 12h3.5l2-5 3.5 11 3-14 2.5 10 1.5-2H22"/>'],
    ['gdacs', 'ภัยพิบัติโลก', '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.4v.1"/>'],
    ['fires', 'จุดความร้อน 24 ชม.', '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7.5 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>'],
    ['sats', 'ดาวเทียม', '<path d="M12 9l3 3-3 3-3-3z"/><path d="M10.5 10.5 8 8"/><path d="M3.5 7 7 3.5 9.5 6 6 9.5z"/><path d="M13.5 13.5 16 16"/><path d="M14.5 18 18 14.5l2.5 2.5-3.5 3.5z"/>'],
    ['aircraft', 'เครื่องบิน', '<path d="M10.5 3.5a1.5 1.5 0 0 1 3 0V9l8 5v2l-8-2.5V19l2.5 2v1.5L12 21.6l-4 .9V21l2.5-2v-5.5l-8 2.5v-2l8-5V3.5z"/>'],
    ['ships', 'เรือ', '<path d="M3 15h18l-2.5 5h-13L3 15z"/><path d="M6 15V9.5h12V15"/><path d="M10 9.5V5.5h4v4"/>'],
    ['news', 'ข่าว 48 ชม.', '<path d="M4 5h12v14H6a2 2 0 0 1-2-2V5z"/><path d="M16 9h4v8a2 2 0 0 1-2 2h-2"/><path d="M7 9h6M7 12.5h6M7 16h4"/>'],
    ['cables', 'สายเคเบิลใต้ทะเล', '<path d="M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6"/><circle cx="3" cy="15" r="1.3"/><circle cx="21" cy="9" r="1.3"/>'],
    ['daynight', 'กลางวัน / กลางคืน', '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'],
    ['cctv', 'กล้อง CCTV ในไทย', '<path d="M3 6l13 3.5-1.5 5L1.5 11z"/><path d="M8 12.8 7 18H3"/><path d="M16 10.4l4.5-1.2v4.3l-5.2.4"/>'],
    ['radar', 'เรดาร์ฝน', '<path d="M7 16.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.75 3.75 0 0 1-.5 7.5H7z"/><path d="M9 19.5l-.8 1.5M13 19.5l-.8 1.5M17 19.5l-.8 1.5"/>']
  ];
  // สีจุดดาวเทียมทั้งหมดในห้องควบคุม: เขียว = วงโคจรต่ำ เหลือง = ระดับกลาง ฟ้า = ค้างฟ้า (เส้นวงแหวนรอบเส้นศูนย์สูตร)
  var SAT_ALL_OPS = ['case', ['==', ['get', 'geo'], 1], '#3FE6FF', ['<', ['get', 'h'], 2000], '#3DFF9A', '#FFE07A'];
  var SAT_ALL_DEF = ['case', ['==', ['get', 'geo'], 1], '#B48CFF', ['<', ['get', 'h'], 2000], '#7FD4FF', '#FFE07A'];
  function opsSatPaint(map) {
    if (!map.getLayer('cg-sat-all')) return;
    var on = !!(OPS && OPS.on);
    map.setPaintProperty('cg-sat-all', 'circle-color', on ? SAT_ALL_OPS : SAT_ALL_DEF);
    map.setPaintProperty('cg-sat-all', 'circle-opacity', on ? 0.9 : 0.8);
  }
  // แสงบรรยากาศรอบลูกโลก (เฉพาะห้องควบคุม)
  function opsSky(v) {
    if (!v || v.kind !== 'chat' || !v.map.setSky) return;
    try {
      v.map.setSky(OPS.on ? { 'sky-color': '#00030A', 'horizon-color': '#0E4C86', 'fog-color': '#06223D', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.9,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.75, 6.5, 0] } : { 'atmosphere-blend': 0 });
    } catch (e) { /* รุ่นเก่าไม่มี */ }
  }
  function opsCount(id) {
    var W = WD[id];
    if (id === 'quakes') return W.fc ? (W.fc.features || []).filter(function (f) { return Date.now() - f.properties.time < 86400e3; }).length : null;
    if (id === 'gdacs') return W.list ? gdacsEvents().length : null;
    if (id === 'fires') return W.grid ? W.grid.n : null;
    if (id === 'sats') return W.recs && W.recs.length ? W.recs.length : null;
    if (id === 'aircraft') return W.doc ? (W.doc.ac || []).length : null;
    if (id === 'ships') return W.doc ? (W.doc.s || []).length : null;
    if (id === 'news') return W.doc ? (W.doc.items || []).length : null;
    if (id === 'cables') return W.fc ? (W.fc.features || []).length : null;
    if (id === 'cctv') return ccReady() ? ccAllCams().length : null;
    return null;
  }
  function opsCompact(n) {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    if (n >= 1e3) return (Math.round(n / 100) / 10) + 'K';
    return String(n);
  }
  function opsFeedItems() {
    var out = [], now = Date.now();
    var Q = WD.quakes.fc;
    ((Q && Q.features) || []).forEach(function (f) {
      var p = f.properties, c = f.geometry.coordinates, d = kmFromThai(c[0], c[1]);
      if ((p.mag >= 4.5 && now - p.time < 48 * 3600e3) || (p.mag >= 3 && d < 1500)) {
        out.push({ t: p.time, ico: '〰️', c: p.mag >= 6 ? 'red' : p.mag >= 5 ? 'orange' : '', k: 'แผ่นดินไหว', title: 'แผ่นดินไหว M' + (Math.round(p.mag * 10) / 10) + ' · ' + (p.place || ''),
          tk: 'M' + (Math.round(p.mag * 10) / 10) + ' ' + (p.place || ''), sub: (d < 1500 ? 'ห่างไทย ' + fmtN(Math.round(d)) + ' กม. · ' : '') + agoText(p.time), lon: c[0], lat: c[1], z: 5, kind: 'quake', f: f });
      }
    });
    gdacsEvents().forEach(function (f) {
      var p = f.properties;
      if (p.alertlevel === 'Green' && p.eventtype !== 'TC') return;
      var nm = (GD_T[p.eventtype] || ['ภัยพิบัติ'])[0];
      out.push({ t: isoMs(p.fromdate + 'Z'), ico: (GD_T[p.eventtype] || ['', '⚠️'])[1], c: p.alertlevel === 'Red' ? 'red' : p.alertlevel === 'Orange' ? 'orange' : '', k: nm,
        title: nm + ' · ' + (p.name || ''), tk: (p.name || '') + (p.country ? ' · ' + p.country : '') + ' · ' + (GD_L[p.alertlevel] || ''), sub: (GD_L[p.alertlevel] || '') + (p.country ? ' · ' + p.country : ''),
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], z: 4, kind: 'gdacs', f: f });
    });
    var N = WD.news.doc;
    ((N && N.items) || []).slice(0, 25).forEach(function (it) {
      out.push({ t: isoMs(it.t), ico: '📰', c: 'news', k: 'ข่าว', title: it.title, tk: it.title + ' (' + it.src + ')', sub: it.src + (it.place ? ' · ' + it.place.name : '') + ' · ' + agoText(isoMs(it.t)),
        lon: it.place && it.place.lon, lat: it.place && it.place.lat, z: it.place && it.place.kind === 'prov' ? 8 : 4, kind: 'news', url: it.url });
    });
    var F = firesInThai();
    if (F && F.n) {
      var top = F.top[0] && byId[F.top[0].id];
      out.push({ t: isoMs(WD.fires.grid.t), ico: '🔥', c: 'fire', k: 'จุดความร้อน', title: 'จุดความร้อนในไทย 24 ชม. ' + fmtN(F.n) + ' จุด', tk: 'ในไทย 24 ชม. ' + fmtN(F.n) + ' จุด' + (top ? ' · มากสุด ' + (top.full || top.name) : ''),
        sub: top ? 'มากสุด ' + (top.full || top.name) + ' ' + F.top[0].n + ' จุด' : '', lon: 100.8, lat: 15.2, z: 5.6, kind: 'fires' });
    }
    return out.sort(function (a, b) { return b.t - a.t; }).slice(0, 50);
  }
  function opsHms(x) { return ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2) + ':' + ('0' + x.getUTCSeconds()).slice(-2); }
  function opsClockText() {
    var d = new Date(), b = new Date(d.getTime() + 7 * 3600e3);
    return '<b>' + opsHms(d) + 'Z</b><span class="oc-l"> · ไทย ' + opsHms(b).slice(0, 5) + ' น.</span><span class="oc-d"> · ' + b.getUTCDate() + ' ' + TH_MON_S[b.getUTCMonth()] + ' ' + String(b.getUTCFullYear() + 543).slice(-2) + '</span>';
  }
  // ดัชนีสนามแม่เหล็กโลก (Kp) จาก NOAA SWPC: 0–2 สงบ 3–4 ปั่นป่วน 5 ขึ้นไป = พายุสุริยะ G1–G5
  function opsKp() {
    if (OPS.kpAt && Date.now() - OPS.kpAt < 30 * 60e3) return;
    OPS.kpAt = Date.now();
    fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      var last = j && j[j.length - 1], v = last && (Array.isArray(last) ? parseFloat(last[1]) : parseFloat(last.Kp != null ? last.Kp : last.kp_index));
      if (isFinite(v)) { OPS.kp = { v: v, t: Array.isArray(last) ? last[0] : last.time_tag }; if (OPS.on) renderOpsStatus(); renderSbar(); }
    }).catch(function () { OPS.kpAt = Date.now() - 25 * 60e3; });
  }
  function kpText(v) {
    var k = Math.round(v);
    return k >= 5 ? 'พายุสุริยะ G' + Math.min(5, k - 4) : k >= 4 ? 'ปั่นป่วน' : k >= 3 ? 'ปั่นป่วนเล็กน้อย' : 'สงบ';
  }
  function renderOpsStatus() {
    var on = 0, ent = 0;
    OPS_ROWS.forEach(function (r) { if (!state.data[r[0]]) return; on++; var n = opsCount(r[0]); if (n) ent += n; });
    var h = '<span class="os-live"><i aria-hidden="true"></i>สด</span><span class="os-n os-layers"><b>' + on + '</b> ชั้น</span><span class="os-n os-ent"><b>' + fmtN(ent) + '</b> จุดข้อมูล</span>';
    if (OPS.kp) {
      var k = OPS.kp.v;
      h += '<span class="os-kp' + (k >= 5 ? ' storm' : k >= 4 ? ' warn' : '') + '" title="ดัชนีสนามแม่เหล็กโลก (Kp) จาก NOAA SWPC · 0–2 สงบ 3–4 ปั่นป่วน 5 ขึ้นไปคือพายุสุริยะ">อวกาศ <b>Kp ' + (Math.round(k * 10) / 10) + '</b> ' + kpText(k) + '</span>';
    }
    $('opsStatRest').innerHTML = h;
  }
  function renderOpsRail() {
    $('opsStats').innerHTML = OPS_ROWS.map(function (r) {
      var n = opsCount(r[0]), on = !!state.data[r[0]], W = WD[r[0]];
      var badge = n == null ? (on && W && W.loading ? '…' : on && W && W.err ? '!' : '') : n ? opsCompact(n) : '0';
      var lab = r[1] + (n != null ? ' · ' + fmtN(n) : on && W && W.err ? ' · โหลดไม่ได้' : '');
      return '<button type="button" class="ops-rb" data-ops-layer="' + r[0] + '" aria-pressed="' + on + '" aria-label="' + esc(lab) + '">' + opsIco(r[2]) +
        (badge && on ? '<span class="ops-badge">' + badge + '</span>' : '') + '<span class="ops-tip">' + esc(lab) + (on ? '' : ' (ปิดอยู่)') + '</span></button>';
    }).join('');
  }
  function renderOpsTicker(items) {
    var tk = items.slice(0, 24), sig = tk.map(function (it) { return it.tk + '|' + it.t; }).join('~');
    OPS.tick = tk;
    if (sig === OPS.tickSig) return;
    OPS.tickSig = sig;
    var one = function (hid) {
      return tk.map(function (it, i) {
        return '<button type="button" class="ot-it" data-ops-tk="' + i + '"' + (hid ? ' tabindex="-1" aria-hidden="true"' : '') + '><span class="ot-k ' + (it.c || '') + '">' + esc(it.k) + '</span>' + esc(it.tk) +
          '<span class="ot-ago">' + esc(agoText(it.t)) + '</span></button>';
      }).join('<span class="ot-sep" aria-hidden="true">◆</span>');
    };
    var run = $('opsTicker');
    if (!tk.length) { run.innerHTML = '<span class="ot-it">กำลังรวบรวมเหตุการณ์…</span>'; run.style.animationDuration = ''; run.classList.remove('go'); return; }
    run.innerHTML = '<span class="ot-half">' + one(false) + '<span class="ot-sep" aria-hidden="true">◆</span></span><span class="ot-half" aria-hidden="true">' + one(true) + '<span class="ot-sep">◆</span></span>';
    run.classList.add('go');
    run.style.animationDuration = Math.max(30, Math.round(run.scrollWidth / 2 / 70)) + 's'; // ราว 70 พิกเซลต่อวินาที
  }
  function renderOpsHud() {
    var hud = $('opsHud');
    if (!hud) return;
    hud.hidden = !OPS.on;
    if (!OPS.on) return;
    $('opsClock').innerHTML = opsClockText();
    renderOpsStatus();
    renderOpsRail();
    var items = opsFeedItems();
    $('opsFeedN').textContent = items.length ? items.length : '';
    $('opsFeedN2').textContent = items.length ? items.length : '';
    $('opsFeedList').innerHTML = items.length ? items.map(function (it, i) {
      return '<button type="button" class="ops-ev' + (it.c ? ' ' + it.c : '') + '" data-ops-ev="' + i + '"><span class="ops-ico" aria-hidden="true">' + it.ico + '</span><span class="ops-ev-t"><b>' + esc(it.title) + '</b><small>' + esc(it.sub || '') + '</small></span></button>';
    }).join('') : '<p class="ops-empty">กำลังรวบรวมเหตุการณ์…</p>';
    OPS.items = items;
    renderOpsTicker(items);
    opsModeState();
  }
  function opsModeState() {
    document.querySelectorAll('[data-ops-proj]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-ops-proj') === 'globe') === !!state.globe)); });
    document.querySelectorAll('[data-ops-base]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-ops-base') === 'sat') === !!state.data.sat)); });
    var sp = document.querySelector('[data-ops-tool="spin"]'); if (sp) sp.setAttribute('aria-pressed', String(OPS.spin && !reduceMotion));
    var fs = document.querySelector('[data-ops-tool="fs"]'); if (fs) fs.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  }
  // แถบมาตราส่วนและพิกัดใต้เมาส์ (อัปเดตไม่เกินเฟรมละครั้ง)
  function opsNiceDist(m) { var p = Math.pow(10, Math.floor(Math.log10(m))), d = m / p; return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * p; }
  function opsMeasure(lngLat) {
    var v = views.chat;
    if (!OPS.on || !v) return;
    var map = v.map, z = map.getZoom(), c = map.getCenter();
    var mpp = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (512 * Math.pow(2, z)), nice = opsNiceDist(mpp * 90), w = Math.round(nice / mpp);
    var sc = $('opsScale');
    sc.querySelector('i').style.width = w + 'px';
    sc.querySelector('span').textContent = nice >= 1000 ? fmtN(nice / 1000) + ' กม.' : fmtN(nice) + ' ม.';
    var p = lngLat || c, pid = provinceAt(p.lng, p.lat), pr = pid && byId[pid];
    $('opsCursor').innerHTML = '<span>' + Math.abs(p.lat).toFixed(3) + '°' + (p.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(((p.lng + 540) % 360) - 180).toFixed(3) + '°' + ((((p.lng + 540) % 360) - 180) >= 0 ? 'E' : 'W') + '</span>' +
      (pr ? '<span>' + esc(pr.full || pr.name) + '</span>' : '') + '<span>ซูม ' + z.toFixed(1) + '</span>' + (lngLat ? '' : '<span class="oc-c">กลางจอ</span>');
  }
  var opsMeasureQ = 0, opsMouse = null;
  function opsMeasureSoon() { if (opsMeasureQ) return; opsMeasureQ = requestAnimationFrame(function () { opsMeasureQ = 0; opsMeasure(opsMouse); }); }
  function opsBindMap() {
    var v = views.chat;
    if (!v || v.opsBound) return;
    v.opsBound = true;
    v.map.on('mousemove', function (e) { if (!OPS.on) return; opsMouse = e.lngLat; opsMeasureSoon(); });
    v.map.getCanvas().addEventListener('mouseleave', function () { opsMouse = null; if (OPS.on) opsMeasureSoon(); });
    v.map.on('move', function () { if (OPS.on) opsMeasureSoon(); });
  }
  function opsSpin() {
    cancelAnimationFrame(OPS.raf);
    if (!OPS.on || reduceMotion || !OPS.spin) return;
    var v = views.chat, last = performance.now();
    function frame(now) {
      if (!OPS.on || !OPS.spin) return;
      var dt = Math.min(100, now - last); last = now;
      if (v && !document.hidden && Date.now() - OPS.idleAt > 12000 && v.map.getZoom() < 3.2 && !v.map.isMoving()) {
        var c = v.map.getCenter();
        v.map.setCenter([c.lng + dt * 0.004, c.lat]); // ราว 4 องศาต่อวินาที
      }
      OPS.raf = requestAnimationFrame(frame);
    }
    OPS.raf = requestAnimationFrame(frame);
  }
  function opsWorldView(v) { return { center: [100.5, 14], zoom: v.el.clientWidth < 700 ? 1.15 : 2.1 }; }
  function enterOps() {
    if (OPS.on || IN_ARTIFACT) return;
    if (state.page !== 'chat') setPage('chat');
    OPS.on = true;
    OPS.prev = Object.assign({}, state.data);
    ['quakes', 'gdacs', 'fires', 'daynight', 'sats', 'aircraft', 'ships', 'news', 'cables'].forEach(function (k) { state.data[k] = true; });
    ['water', 'rain', 'fc', 'flood', 'hist', 'hazard', 'zoning', 'terrain', 'wind', 'radar', 'cloud', 'props', 'sat', 'cctv'].forEach(function (k) { state.data[k] = false; });
    OPS.satAll = WD.sats.all; WD.sats.all = true;
    OPS.theme = state.theme; OPS.globe = state.globe;
    if (state.theme !== 'dark') $('btnTheme').click();
    else if (BASE.id !== 'auto') reloadBase(); // ห้องควบคุมใช้แผนที่มืดเสมอ
    if (!state.globe) $('btnGlobe').click();
    document.body.classList.add('ops');
    if ($('opsFeed')) { $('opsFeed').hidden = true; $('opsFeedBtn').setAttribute('aria-pressed', 'false'); }
    if (SITE.cur) closeSite();
    OPS.idleAt = 0; OPS.tickSig = '';
    var v = views.chat;
    if (v && v.popup) { v.popup.remove(); v.popup = null; }
    opsBindMap();
    setTimeout(function () { if (v) { v.map.resize(); opsSky(v); var w = opsWorldView(v); v.map.flyTo({ center: w.center, zoom: w.zoom, duration: reduceMotion ? 0 : 1600 }); opsMeasure(null); } }, 60);
    clearInterval(OPS.clock);
    OPS.clock = setInterval(function () { if (OPS.on && !document.hidden) { $('opsClock').innerHTML = opsClockText(); } }, 1000);
    OPS.refresh = setInterval(function () { if (OPS.on && !document.hidden) { WORLD_IDS.forEach(function (k) { if (state.data[k]) loadWorld(k); }); opsKp(); renderOpsHud(); } }, 60e3);
    opsKp();
    eachView(refreshLive);
    renderDataChips();
    renderOpsHud();
    opsSpin();
    $('btnOps').setAttribute('aria-pressed', 'true');
    try { history.replaceState(null, '', location.pathname + location.search + '#ops'); } catch (e) { /* ข้าม */ }
  }
  function exitOps() {
    if (!OPS.on) return;
    OPS.on = false;
    cancelAnimationFrame(OPS.raf);
    clearInterval(OPS.clock); clearInterval(OPS.refresh);
    if (OPS.prev) state.data = OPS.prev;
    if (OPS.satAll != null) WD.sats.all = OPS.satAll;
    document.body.classList.remove('ops');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ข้าม */ });
    if (OPS.theme && state.theme !== OPS.theme) $('btnTheme').click();
    else if (BASE.id !== 'auto') reloadBase();
    if (OPS.globe === false && state.globe) $('btnGlobe').click();
    var v = views.chat;
    if (v) { opsSky(v); opsSatPaint(v.map); }
    setTimeout(function () { if (v) { v.map.resize(); goTo(state.place || HOME); } }, 60);
    eachView(refreshLive);
    renderDataChips();
    renderOpsHud();
    $('btnOps').setAttribute('aria-pressed', 'false');
    if (location.hash === '#ops') writeHash(false);
  }
  if ($('btnOps')) {
    if (IN_ARTIFACT) $('btnOps').hidden = true;
    $('btnOps').addEventListener('click', function () { if (OPS.on) exitOps(); else enterOps(); });
  }
  function opsGo(it) {
    var v = views.chat;
    if (!it || !v) return;
    OPS.idleAt = Date.now() + 60e3;
    if (it.lon == null) { if (it.url) window.open(it.url, '_blank', 'noopener'); return; }
    v.map.flyTo({ center: [it.lon, it.lat], zoom: it.z || 5, duration: reduceMotion ? 0 : 1400 });
    v.map.once('moveend', function () {
      if (it.kind === 'gdacs') openGdacsPopup(v, it.f);
      else if (it.kind === 'quake') openQuakePopup(v, it.f);
      else if (it.kind === 'news') { var gi = (v.nwGroups || []).findIndex(function (g) { return Math.abs(g.place.lon - it.lon) < 0.01 && Math.abs(g.place.lat - it.lat) < 0.01; }); if (gi >= 0) openNewsPopup(v, gi, [it.lon, it.lat]); }
    });
  }
  function opsFeedOpen(on) {
    $('opsFeed').hidden = !on;
    $('opsFeedBtn').setAttribute('aria-pressed', String(on));
  }
  if ($('opsHud')) {
    $('opsHud').addEventListener('click', function (e) {
      var v = views.chat;
      if (e.target.closest('#opsExit')) { exitOps(); return; }
      if (e.target.closest('#opsFeedBtn')) { opsFeedOpen($('opsFeed').hidden); return; }
      if (e.target.closest('#opsFeedX')) { opsFeedOpen(false); $('opsFeedBtn').focus(); return; }
      var b = e.target.closest('[data-ops-layer]');
      if (b) {
        var id = b.getAttribute('data-ops-layer');
        state.data[id] = !state.data[id];
        eachView(refreshLive); renderDataChips(); renderOpsHud();
        var nb = document.querySelector('[data-ops-layer="' + id + '"]'); if (nb) nb.focus();
        return;
      }
      var t = e.target.closest('[data-ops-tool]');
      if (t && v) {
        var k = t.getAttribute('data-ops-tool');
        if (k === 'search') { openPalette(t); return; }
        if (k === 'th') { OPS.idleAt = Date.now() + 60e3; v.map.flyTo({ center: [100.8, 13.2], zoom: v.el.clientWidth < 700 ? 4.2 : 4.9, duration: reduceMotion ? 0 : 1600 }); return; }
        if (k === 'world') { OPS.idleAt = 0; var w = opsWorldView(v); v.map.flyTo({ center: w.center, zoom: w.zoom, pitch: 0, bearing: 0, duration: reduceMotion ? 0 : 1600 }); return; }
        if (k === 'spin') { OPS.spin = !OPS.spin; OPS.idleAt = 0; opsSpin(); opsModeState(); return; }
        if (k === 'fs') {
          var de = document.documentElement;
          if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(function () { /* ข้าม */ }); }
          else if (de.requestFullscreen) de.requestFullscreen().catch(function () { toast('เบราว์เซอร์นี้ไม่ให้เปิดเต็มจอ'); });
          return;
        }
      }
      var pj = e.target.closest('[data-ops-proj]');
      if (pj) { if ((pj.getAttribute('data-ops-proj') === 'globe') !== !!state.globe) $('btnGlobe').click(); opsModeState(); return; }
      var bs = e.target.closest('[data-ops-base]');
      if (bs) { var sat = bs.getAttribute('data-ops-base') === 'sat'; if (sat !== !!state.data.sat) { state.data.sat = sat; eachView(refreshLive); renderDataChips(); } opsModeState(); return; }
      var zm = e.target.closest('[data-ops-zoom]');
      if (zm && v) {
        var a = zm.getAttribute('data-ops-zoom');
        OPS.idleAt = Date.now();
        if (a === 'in') v.map.zoomIn(); else if (a === 'out') v.map.zoomOut(); else v.map.easeTo({ bearing: 0, pitch: 0 });
        return;
      }
      var tk = e.target.closest('[data-ops-tk]');
      if (tk) { opsGo(OPS.tick[+tk.getAttribute('data-ops-tk')]); return; }
      var ev = e.target.closest('[data-ops-ev]');
      if (ev) opsGo((OPS.items || [])[+ev.getAttribute('data-ops-ev')]);
    });
    document.addEventListener('fullscreenchange', function () { if (OPS.on) { opsModeState(); setTimeout(function () { if (views.chat) views.chat.map.resize(); }, 120); } });
  }
  ['mousedown', 'touchstart', 'wheel', 'keydown'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (OPS.on && (t === 'keydown' || (e.target.closest && e.target.closest('#mapChat')))) OPS.idleAt = Date.now(); }, { passive: true });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !OPS.on) return;
    var modal = ($('helpModal') && !$('helpModal').hidden) || ($('ccModal') && !$('ccModal').hidden) || ($('palette') && !$('palette').hidden) || SITE.cur || SITE.pick;
    if (modal) return;
    if ($('opsFeed') && !$('opsFeed').hidden) { opsFeedOpen(false); $('opsFeedBtn').focus(); return; }
    exitOps();
  });

  // ---------- แชท: ถามเรื่องโลกตอนนี้ ----------
  var QUAKE_RE = /แผ่นดินไหว|แผ่นดินไหว|ดินไหว|สึนามิ|earthquake|quake/i;
  var STORM_RE = /พายุ|ไต้ฝุ่น|ไซโคลน|ดีเปรสชัน|ภูเขาไฟ|ภัยพิบัติ(ทั่ว)?โลก|typhoon|cyclone|gdacs/i;
  var FIRE_RE = /ไฟป่า|จุดความร้อน|hotspot|หมอกควัน|การเผา|เผาไร่|เผาป่า/i;
  var SATQ_RE = /^(?!.*น้ำ).*(ดาวเทียม|สถานีอวกาศ|\bISS\b|ไอเอสเอส|THEOS|ธีออส|ไทยโชต|ไทยคม|starlink)/i;
  var PLANE_RE = /เครื่องบิน|เที่ยวบิน|อากาศยาน|flight|aircraft/i;
  var SHIP_RE = /เรือ(?!น)|\bships?\b|vessels?|\bAIS\b/i;
  var LNEWS_RE = /ข่าวด่วน|ข่าวล่าสุด|ข่าวสด|ข่าวตอนนี้|ข่าวทั่วโลกตอนนี้|breaking/i;
  var CABLE_RE = /สายเคเบิล|เคเบิลใต้|อินเทอร์เน็ตใต้ทะเล|submarine cable/i;
  var DN_RE = /กลางวัน.*กลางคืน|ตอนนี้ที่ไหน(เป็น)?กลางคืน|พระอาทิตย์(ขึ้น|ตก)|เส้นแบ่งกลางวัน/;
  var OPS_RE = /ห้องควบคุม|โหมดควบคุม|war ?room|control room/i;
  function liveIntent(t) {
    return OPS_RE.test(t) ? 'ops' : QUAKE_RE.test(t) ? 'quakes' : STORM_RE.test(t) ? 'gdacs' : FIRE_RE.test(t) ? 'fires' : CABLE_RE.test(t) ? 'cables'
      : SATQ_RE.test(t) ? 'sats' : PLANE_RE.test(t) ? 'aircraft' : SHIP_RE.test(t) ? 'ships' : LNEWS_RE.test(t) ? 'news' : DN_RE.test(t) ? 'daynight' : '';
  }
  function flyRow(lon, lat, z, title, sub) {
    return '<div class="m-row"><span></span><div><button type="button" class="pt-title" data-world-fly="' + lon.toFixed(3) + ',' + lat.toFixed(3) + ',' + z + '">' + esc(title) + '</button>' + (sub ? ' <span>' + esc(sub) + '</span>' : '') + '</div></div>';
  }
  function obsPoint() { return me.lon != null ? { lon: me.lon, lat: me.lat, name: 'ตำแหน่งของคุณ' } : { lon: 100.5, lat: 13.75, name: 'กรุงเทพฯ' }; }
  function sunTimes(lat, lon) { // เวลาพระอาทิตย์ขึ้นและตกวันนี้ (สแกนทีละนาที)
    var b = new Date(Date.now() + 7 * 3600e3), day0 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - 7 * 3600e3, rise = null, set = null, prev = null;
    for (var m = 0; m <= 1440; m += 2) {
      var d = new Date(day0 + m * 60e3), s = sunPos(d), H = (lon - s.lon) * Math.PI / 180;
      var el = Math.asin(Math.sin(lat * Math.PI / 180) * Math.sin(s.dec) + Math.cos(lat * Math.PI / 180) * Math.cos(s.dec) * Math.cos(H)) * 180 / Math.PI;
      if (prev != null) { if (prev < -0.83 && el >= -0.83) rise = d.getTime(); if (prev >= -0.83 && el < -0.83) set = d.getTime(); }
      prev = el;
    }
    return { rise: rise, set: set };
  }
  function worldAnswer(r) {
    var id = r.live, W = WD[id], loading = W && !W.at && !W.err;
    if (id === 'ops') return { title: 'ห้องควบคุม', text: 'เปิดโหมดห้องควบคุมแล้ว ลูกโลกจะหมุนช้าๆ แถบซ้ายคือตัวเลขแต่ละชั้น (กดเพื่อเปิดปิด) แถบขวาคือเหตุการณ์ล่าสุดทั่วโลก กดรายการเพื่อบินไปดู กด Esc หรือปุ่ม "ออก" เพื่อกลับ' };
    if (W && W.err) return { title: 'โลกตอนนี้', text: id === 'ships' ? 'ยังไม่มีข้อมูลเรือ ต้องตั้งคีย์ฟรีของ aisstream.io ในระบบอัตโนมัติก่อน (ดูวิธีในหน้าวิธีใช้)' : 'ตอนนี้โหลดข้อมูลชุดนี้ไม่ได้ ลองใหม่อีกครั้งในไม่กี่นาที' };
    if (loading) return { title: 'โลกตอนนี้', text: 'กำลังโหลดข้อมูล… เปิดชั้นนี้บนแผนที่ให้แล้ว' };
    var h = '', txt = '';
    if (id === 'quakes') {
      var fs = (W.fc.features || []), near = fs.filter(function (f) { return kmFromThai(f.geometry.coordinates[0], f.geometry.coordinates[1]) < 1500; }).sort(function (a, b) { return b.properties.mag - a.properties.mag; });
      var big = fs.filter(function (f) { return Date.now() - f.properties.time < 86400e3; }).sort(function (a, b) { return b.properties.mag - a.properties.mag; });
      txt = 'ใน 7 วันที่ผ่านมา มีแผ่นดินไหวขนาด 2.5 ขึ้นไปทั่วโลก ' + fmtN(fs.length) + ' ครั้ง ' + (near.length ? 'ในรัศมี 1,500 กม. จากไทย ' + near.length + ' ครั้ง แรงสุด M' + near[0].properties.mag.toFixed(1) : 'ไม่มีครั้งไหนอยู่ในรัศมี 1,500 กม. จากไทย') +
        ' เปิดชั้นแผ่นดินไหวบนแผนที่แล้ว วงแดงคือเพิ่งเกิด วงใหญ่คือแรง';
      if (near.length) h += '<div class="m-extra"><div class="m-extra-head">ใกล้ไทย 7 วัน · USGS</div>' + near.slice(0, 4).map(function (f) { var p = f.properties, c = f.geometry.coordinates; return flyRow(c[0], c[1], 6, 'M' + p.mag.toFixed(1) + ' · ' + p.place, agoText(p.time) + ' · ห่าง ' + fmtN(Math.round(kmFromThai(c[0], c[1]))) + ' กม.'); }).join('') + '</div>';
      if (big.length) h += '<div class="m-extra"><div class="m-extra-head">แรงสุดทั่วโลก 24 ชม.</div>' + big.slice(0, 3).map(function (f) { var p = f.properties, c = f.geometry.coordinates; return flyRow(c[0], c[1], 5, 'M' + p.mag.toFixed(1) + ' · ' + p.place, agoText(p.time)); }).join('') + '</div>';
      h += '<p class="fp-fine">ประกาศเตือนภัยทางการในไทยดูที่กรมอุตุนิยมวิทยาและ ปภ.</p>';
    } else if (id === 'gdacs') {
      var ev = gdacsEvents(), tc = ev.filter(function (f) { return f.properties.eventtype === 'TC'; }), bad = ev.filter(function (f) { return f.properties.alertlevel !== 'Green'; });
      var asia = tc.filter(function (f) { var c = f.geometry.coordinates; return c[0] > 60 && c[0] < 180 && c[1] > -15 && c[1] < 45; });
      txt = 'GDACS ติดตามเหตุภัยพิบัติทั่วโลกตอนนี้ ' + ev.length + ' เหตุการณ์ เป็นพายุหมุนเขตร้อน ' + tc.length + ' ลูก' + (asia.length ? ' อยู่ฝั่งเอเชีย ' + asia.length + ' ลูก' : '') + (bad.length ? ' และระดับผลกระทบปานกลางขึ้นไป ' + bad.length + ' เหตุการณ์' : '') + ' กดไอคอนบนแผนที่เพื่อดูรายละเอียดและเส้นทางพายุ';
      var rows = asia.concat(bad.filter(function (f) { return asia.indexOf(f) < 0; })).slice(0, 6);
      if (rows.length) h += '<div class="m-extra"><div class="m-extra-head">เหตุการณ์ที่ควรรู้ · GDACS</div>' + rows.map(function (f) { var p = f.properties, c = f.geometry.coordinates; return flyRow(c[0], c[1], 4, (GD_T[p.eventtype] || ['ภัยพิบัติ'])[0] + ' · ' + p.name, (GD_L[p.alertlevel] || '') + (p.country ? ' · ' + p.country : '')); }).join('') + '</div>';
      h += '<p class="fp-fine">พายุที่จะเข้าไทย ให้ติดตามประกาศกรมอุตุนิยมวิทยา · ' + W_ATTR.gdacs + '</p>';
    } else if (id === 'fires') {
      var F = firesInThai();
      txt = 'ใน 24 ชม. ล่าสุด ดาวเทียมพบจุดความร้อนทั่วโลก ' + fmtN(W.grid.n) + ' จุด' + (F ? ' ในไทย ' + fmtN(F.n) + ' จุด' : '') + ' (ข้อมูล ' + msTime(isoMs(W.grid.t)) + ') จุดความร้อนอาจเป็นไฟป่า การเผาในไร่ หรือโรงงาน ใช้ดูแนวโน้มหมอกควัน';
      if (F && F.top.length) h += '<div class="m-extra"><div class="m-extra-head">จังหวัดที่พบมากสุด 24 ชม.</div>' + F.top.slice(0, 5).map(function (x) { var p = byId[x.id]; return p ? flyRow(p.lon, p.lat, 7.5, p.full || p.name, x.n + ' จุด') : ''; }).join('') + '</div>';
    } else if (id === 'sats') {
      var o = obsPoint(), iss = find(W.recs, function (s) { return s.id === 25544; }), pos = iss && satPos(iss, new Date());
      var pk = o.lat.toFixed(2) + ',' + o.lon.toFixed(2) + ',' + Math.floor(Date.now() / 300e3);
      if (!WD.sats.passKey || WD.sats.passKey !== pk) { WD.sats.passKey = pk; WD.sats.passes = issPasses(o.lat, o.lon, 48) || []; }
      var passes = WD.sats.passes || [], vis2 = passes.filter(function (p) { return p.dark && p.lit; });
      txt = 'ติดตามดาวเทียม ' + fmtN(W.recs.length) + ' ดวง (ไม่รวม Starlink) ' + (pos ? 'ตอนนี้ ISS อยู่เหนือ ' + pos.lat.toFixed(1) + '°, ' + pos.lon.toFixed(1) + '° สูง ' + fmtN(Math.round(pos.h)) + ' กม. ' : '') +
        (vis2.length ? 'ISS จะผ่านให้เห็นด้วยตาเปล่าจาก' + o.name + ' ' + vis2.length + ' รอบใน 48 ชม.' : 'ใน 48 ชม. ISS ไม่ผ่านในช่วงที่มองเห็นด้วยตาเปล่าจาก' + o.name);
      if (passes.length) h += '<div class="m-extra"><div class="m-extra-head">ISS ผ่านเหนือ' + esc(o.name) + ' (มุมเงยเกิน 10°)</div>' + passes.slice(0, 5).map(function (p) {
        return '<div class="m-row"><span></span><div><b>' + esc(msTime(p.start)) + '</b> <span>นาน ' + Math.max(1, Math.round((p.end - p.start) / 60e3)) + ' นาที · สูงสุด ' + Math.round(p.max) + '° · ' + (p.dark && p.lit ? 'มองเห็นด้วยตาเปล่าได้' : p.dark ? 'ฟ้ามืดแต่ ISS อยู่ในเงาโลก' : 'ฟ้ายังสว่าง มองไม่เห็น') + '</span></div></div>';
      }).join('') + '</div>';
      h += '<p class="fp-fine">กดชื่อดาวเทียมบนแผนที่เพื่อดูเส้นทาง · ดาวเทียมของไทยมีป้ายสีทอง · ' + W_ATTR.sats + '</p>';
    } else if (id === 'aircraft') {
      txt = 'ภาพเครื่องบินรอบไทยและเพื่อนบ้าน ' + fmtN((W.doc.ac || []).length) + ' ลำ ณ ' + msTime(isoMs(W.doc.t)) + ' (อัปเดตทุก ~20 นาที ไม่ใช่ตำแหน่งสด) สีบอกระดับความสูง กดเครื่องบินเพื่อดูเที่ยวบินและความเร็ว ข้อมูลจากอาสาสมัครที่ตั้งเครื่องรับสัญญาณ บางพื้นที่จึงไม่ครบ';
    } else if (id === 'ships') {
      txt = 'ภาพเรือทั่วโลก ' + fmtN((W.doc.s || []).length) + ' ลำ จากสัญญาณ AIS ณ ' + msTime(isoMs(W.doc.t)) + ' (อัปเดตทุก ~20 นาที) สีส้มคือเรือที่กำลังทำประมง สีเทาคือจอดหรือทอดสมอ';
    } else if (id === 'news') {
      var items = (W.doc.items || []);
      txt = 'หัวข่าวล่าสุด ' + items.length + ' เรื่องใน 48 ชม. จาก ' + (W.doc.feeds || []).join(', ') + ' (ภาษาอังกฤษ กดเพื่ออ่านข่าวต้นฉบับ) จุดสีม่วงบนแผนที่คือที่ที่ข่าวพูดถึง';
      h += '<div class="m-extra nw-list">' + newsRowsHtml(items, 8) + '</div>';
    } else if (id === 'cables') {
      var fsC = W.fc.features || [], thai = fsC.filter(function (f) { return f.geometry.coordinates.some(function (c) { return c[0] > 97 && c[0] < 106 && c[1] > 5 && c[1] < 14; }); });
      var names = thai.map(function (f) { return f.properties.name; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      txt = 'สายเคเบิลใต้ทะเลจาก OpenStreetMap ' + fmtN(fsC.length) + ' เส้นทั่วโลก ' + (names.length ? 'เส้นที่เข้าใกล้ไทยเช่น ' + names.slice(0, 5).join(', ') : '') + ' ข้อมูลอาสาสมัครอาจไม่ครบ แผนที่ฉบับเต็มดูที่ submarinecablemap.com';
    } else if (id === 'daynight') {
      var o2 = obsPoint(), st = sunTimes(o2.lat, o2.lon), s = sunPos(new Date());
      txt = 'เปิดเส้นแบ่งกลางวันกลางคืนแล้ว ส่วนที่มืดคือกลางคืน วงสีเหลืองคือจุดที่ดวงอาทิตย์อยู่ตรงหัว (' + (s.dec * 180 / Math.PI).toFixed(1) + '°, ' + s.lon.toFixed(0) + '°)' +
        (st.rise ? ' วันนี้ที่' + o2.name + ' พระอาทิตย์ขึ้น ' + msTime(st.rise) + ' ตก ' + msTime(st.set) : '');
    }
    return { title: { quakes: 'แผ่นดินไหวทั่วโลก', gdacs: 'ภัยพิบัติทั่วโลกตอนนี้', fires: 'จุดความร้อน/ไฟป่า', sats: 'ดาวเทียมตอนนี้', aircraft: 'เครื่องบินตอนนี้', ships: 'เรือตอนนี้',
      news: 'ข่าวล่าสุด', cables: 'สายเคเบิลใต้ทะเล', daynight: 'กลางวัน/กลางคืน' }[id] || 'โลกตอนนี้', text: txt, html: h };
  }
  function worldShow(r) {
    var id = r.live, v = views.chat;
    if (id === 'ops') { enterOps(); return; }
    if (!state.data[id]) { state.data[id] = true; saveData(); eachView(refreshLive); renderDataChips(); }
    loadWorld(id);
    if (!v) return;
    var go = { quakes: [97, 16, 3.3], gdacs: [110, 15, 1.8], fires: null, sats: [100, 10, 1.4], aircraft: [101, 13.5, 4.6], ships: [101, 9, 3.4], news: [100, 20, 1.5], cables: [104, 8, 3.2], daynight: [100, 10, 1.2] }[id];
    if (id === 'fires') { goTo('th'); return; }
    if (r.place && r.place.id !== HOME && r.place.id !== 'th') { goTo(r.place.id); return; }
    if (go) v.map.flyTo({ center: [go[0], go[1]], zoom: go[2], duration: reduceMotion ? 0 : 1200 });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-world-fly]');
    if (!b || !views.chat) return;
    var a = b.getAttribute('data-world-fly').split(',').map(Number);
    if (state.page !== 'chat') setPage('chat');
    views.chat.map.flyTo({ center: [a[0], a[1]], zoom: a[2], duration: reduceMotion ? 0 : 1200 });
  });

  // ปุ่มเปิดปิดชั้นข้อมูลในเมนู "ชั้นข้อมูล"
  var DATA_ROWS = [
    { head: 'ไทย: น้ำ ฝน อากาศ' },
    { id: 'water', name: 'ระดับน้ำในแม่น้ำ', src: 'ThaiWater (สสน.)' },
    { id: 'rain', name: 'ฝนสะสม 24 ชม.', src: 'ThaiWater (สสน.)' },
    { id: 'radar', name: 'เรดาร์ฝน (กลุ่มฝนตอนนี้)', src: 'RainViewer' },
    { id: 'cloud', name: 'เมฆจากดาวเทียม', src: 'Himawari-9 · NASA GIBS' },
    { id: 'wind', name: 'ลม (เส้นเคลื่อนไหว)', src: 'Open-Meteo' },
    { id: 'fc', name: 'พยากรณ์อากาศ 3 วัน', src: 'Open-Meteo' },
    { id: 'flood', name: 'น้ำจากดาวเทียม (ทดลอง)', src: 'Sentinel-1' },
    { id: 'hist', name: 'น้ำในอดีต 41 ปี (1984–2024)', src: 'Landsat · JRC' },
    { id: 'hazard', name: 'พื้นที่น้ำท่วมใหญ่ (แบบจำลอง)', src: 'JRC GloFAS · รอบ 100 ปี' },
    { id: 'cctv', name: 'กล้อง CCTV + AI (ทดลอง)', src: 'หาดใหญ่ · เขื่อน กฟผ.' },
    { head: 'ที่ดินและภาพพื้นผิว' },
    { id: 'terrain', name: 'ความสูงพื้นดิน', src: 'Terrain Tiles' },
    { id: 'zoning', name: 'ร่างผังเมืองรวม (ทดลอง)', src: 'กรมโยธาฯ · เพชรบุรี สระบุรี' },
    { id: 'sat', name: 'ภาพดาวเทียม', src: 'Sentinel-2 · EOX' },
    { id: 'props', name: 'ทรัพย์ในรายการของฉัน', src: 'จากหน้า "ทรัพย์"' },
    { head: 'โลกตอนนี้ (ห้องควบคุม)' },
    { id: 'quakes', name: 'แผ่นดินไหวทั่วโลก', src: 'USGS' },
    { id: 'gdacs', name: 'พายุ น้ำท่วม ภูเขาไฟ ทั่วโลก', src: 'GDACS' },
    { id: 'fires', name: 'จุดความร้อน/ไฟป่า', src: 'NASA FIRMS' },
    { id: 'daynight', name: 'กลางวัน/กลางคืน', src: 'คำนวณจากตำแหน่งดวงอาทิตย์' },
    { id: 'sats', name: 'ดาวเทียม (ตำแหน่งสด)', src: 'CelesTrak' },
    { id: 'aircraft', name: 'เครื่องบิน', src: 'adsb.lol' },
    { id: 'ships', name: 'เรือ', src: 'AIS' },
    { id: 'news', name: 'ข่าวล่าสุดบนแผนที่', src: 'RSS' },
    { id: 'cables', name: 'สายเคเบิลใต้ทะเล', src: 'OpenStreetMap' }
  ];
  function dataSub(r) {
    if (WORLD_IDS.indexOf(r.id) >= 0) return worldSub(r.id);
    if (r.id === 'sat') return r.src;
    if (r.id === 'flood') {
      if (!FLOOD.index) return r.src + ' · กำลังโหลด';
      if (!floodReady()) return r.src + ' · ยังไม่มีข้อมูล';
      return r.src + ' · ภาพ ' + dateAge([FLOOD.index.date_min, FLOOD.index.date_max]) + ' · ตรวจ ' + FLOOD.index.tiles.length + '/' + (FLOOD.index.tiles_total || FLOOD.index.tiles.length) + ' กรอบ';
    }
    if (r.id === 'radar') return r.src + (RADAR.err ? ' · โหลดไม่ได้ตอนนี้' : RADAR.frames.length ? ' · ภาพ ' + radarTime(RADAR.frames.length - 1) : ' · กำลังโหลด');
    if (r.id === 'cloud') return r.src + ' · ช้ากว่าจริงราว 1 ชม.';
    if (r.id === 'wind') return r.src + (WIND.grid ? ' · ' + ccTime(WIND.grid.time) : ' · ยังไม่มีข้อมูล (ระบบดึงทุกชั่วโมง)');
    if (r.id === 'terrain') return 'เงาภูเขา · กดแผนที่ดูความสูง ที่ลุ่ม/ที่ดอน';
    if (r.id === 'hist') return r.src + ' · ภาพย้อนหลัง ไม่ใช่ตอนนี้';
    if (r.id === 'props') return PP.list.length ? PP.list.length + ' รายการ · ตรวจแล้ว ' + PP.list.filter(function (p) { return p.chk; }).length : 'ยังไม่มี เพิ่มได้ที่หน้า "ทรัพย์"';
    if (r.id === 'hazard') return typeof DecompressionStream === 'undefined' ? 'เบราว์เซอร์นี้เก่าเกินไป' : r.src + (HAZ.err ? ' · โหลดไม่ได้ตอนนี้' : '');
    if (r.id === 'zoning') return state.data.zoning ? zoneStatusText() : r.src + ' · ซูมระดับอำเภอ';
    if (r.id === 'cctv') {
      if (!CCTV.loaded) return r.src + ' · กำลังโหลด';
      if (!ccReady()) return r.src + ' · โหลดรายชื่อกล้องไม่ได้';
      return ccAllCams().length + ' กล้อง · ' + (CCTV.idx ? 'AI ดูเมื่อ ' + ccTime(CCTV.idx.updated) : 'ยังไม่มีผล AI');
    }
    var n = (LIVE[r.id] || []).length;
    return r.src + (LIVE.src[r.id] ? ' · ' + (n ? n + ' จุด' : 'ดึงข้อมูลไม่ได้ตอนนี้') : ' · กำลังโหลด');
  }
  // มุมมองสำเร็จรูป: กดครั้งเดียวเปิดชุดชั้นที่ใช้ด้วยกัน ที่เหลือปิด (แผนที่จะไม่รก)
  var PRESETS = [
    { id: 'news', t: 'ข่าว', on: ['flood', 'cctv'] },
    { id: 'water', t: 'น้ำ · ฝน', on: ['water', 'rain', 'radar', 'flood', 'cctv'] },
    { id: 'wx', t: 'อากาศ', on: ['radar', 'cloud', 'wind', 'fc'] },
    { id: 'land', t: 'ที่ดิน · ทำเล', on: ['hist', 'hazard', 'terrain', 'zoning', 'props'] },
    { id: 'world', t: 'โลกตอนนี้', on: ['quakes', 'gdacs', 'fires', 'daynight', 'sats', 'aircraft', 'ships', 'news', 'cables'] },
    { id: 'none', t: 'ปิดทั้งหมด', on: [] }
  ];
  var LYR_C = { water: '#2563EB', rain: '#0EA5E9', radar: '#3B82F6', cloud: '#94A3B8', wind: '#38BDF8', fc: '#F59E0B', flood: '#E5484D', hist: '#7C3AED',
    hazard: '#8052E0', cctv: '#10B981', terrain: '#A16207', zoning: '#EAB308', sat: '#16A34A', props: '#4F46E5', quakes: '#F97316', gdacs: '#EF4444',
    fires: '#DC2626', daynight: '#64748B', sats: '#06B6D4', aircraft: '#0EA5E9', ships: '#0284C7', news: '#A855F7', cables: '#14B8A6' };
  function presetNow() {
    var ids = DATA_ROWS.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
    var p = find(PRESETS, function (x) { return ids.every(function (id) { return !!state.data[id] === (x.on.indexOf(id) >= 0); }); });
    return p ? p.id : '';
  }
  function applyPreset(id) {
    var P = find(PRESETS, function (x) { return x.id === id; });
    if (!P) return;
    DATA_ROWS.forEach(function (r) { if (r.id) state.data[r.id] = P.on.indexOf(r.id) >= 0; });
    saveData();
    if (views.chat && views.chat.popup) { views.chat.popup.remove(); views.chat.popup = null; }
    eachView(refreshLive);
    renderDataChips();
  }
  function renderDataChips() {
    var el = $('dataChips');
    if (!el) return;
    var pn = presetNow();
    if ($('presetChips')) $('presetChips').innerHTML = PRESETS.map(function (x) {
      return '<button type="button" class="dr-preset" data-preset="' + x.id + '" aria-pressed="' + (pn === x.id) + '">' + esc(x.t) + '</button>';
    }).join('');
    railBadge();
    var leg = (state.data.water ? '<div class="wl-legend" aria-label="สีระดับน้ำ">' + [5, 4, 3, 2, 1].map(function (k) {
      return '<span><i class="tri" style="border-top-color:' + WL[k].c + '"></i>' + WL[k].t + '</span>';
    }).join('') + '</div>' : '') + (state.data.rain ? '<div class="rain-legend" aria-label="สีปริมาณฝน"><span>ฝน</span><span class="sp"></span><span>10</span><i style="background:linear-gradient(90deg,' +
      RAIN_C.join(',') + ')"></i><span>150+ มม.</span></div>' : '') +
      (state.data.water || state.data.rain ? '<p class="fp-fine">ซูมออกจะเห็นเฉพาะสถานีที่น้ำผิดปกติและฝน 35 มม.ขึ้นไป ซูมเข้าเพื่อดูครบทุกสถานี</p>' : '') +
      (state.data.flood && floodReady() ? floodLegendHtml() : '') +
      (state.data.cctv && ccReady() ? ccLegendHtml() : '') + wxLegendHtml() + siteLegendHtml() + worldLegendHtml();
    el.innerHTML = DATA_ROWS.map(function (r) {
      if (r.head) return '<div class="fp-head fp-sub fp-grp"><span>' + esc(r.head) + '</span></div>';
      var on = !!state.data[r.id];
      var sub = dataSub(r);
      return '<button type="button" class="fp-row fp-switch" data-data="' + r.id + '" aria-pressed="' + on + '">' +
        '<i class="lyr-dot" style="background:' + (LYR_C[r.id] || '#8A93A3') + '" aria-hidden="true"></i>' +
        '<span class="fp-two"><span>' + esc(r.name) + '</span><small>' + esc(sub) + '</small></span><span class="sw" aria-hidden="true"><i></i></span></button>';
    }).join('') + (leg ? '<div class="fp-head fp-sub fp-grp dr-leg"><span>คำอธิบายสัญลักษณ์</span></div><div class="dr-legend">' + leg + '</div>' : '');
  }
  if ($('presetChips')) $('presetChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-preset]');
    if (b) applyPreset(b.getAttribute('data-preset'));
  });
  function saveData() { if (OPS.on) return; try { localStorage.setItem('cg-data3', JSON.stringify(state.data)); } catch (e) { /* ข้าม */ } }
  if ($('dataChips')) {
    $('dataChips').addEventListener('click', function (e) {
      var g = e.target.closest('[data-flood-prov]');
      if (g) { setFilterOpen(false); showFloodProvince(g.getAttribute('data-flood-prov')); return; }
      var b = e.target.closest('[data-data]');
      if (!b) return;
      var id = b.getAttribute('data-data');
      state.data[id] = !state.data[id];
      saveData();
      if (views.chat && views.chat.popup) { views.chat.popup.remove(); views.chat.popup = null; }
      eachView(refreshLive);
      renderDataChips();
    });
  }

  // การ์ดด้านขวาในหน้าสรุป: น้ำและฝนวันนี้ + พยากรณ์ 3 วัน
  function renderLiveCards() {
    var wc = $('liveCard'), fc = $('fcCard');
    if (!wc || !fc) return;
    var W = LIVE.water, R = LIVE.rain;
    var FA = floodReady() ? topFloodProvinces(3) : [];
    var CW = ccReady() && CCTV.idx ? ccSorted(ccFilterCams('wet')).slice(0, 3) : [];
    wc.hidden = !W.length && !R.length && !FA.length && !CW.length;
    if (!wc.hidden) {
      var over = W.filter(function (o) { return o.lv === 5; }).length, high = W.filter(function (o) { return o.lv === 4; }).length;
      var worst = W.slice().sort(function (a, b) { return b.lv - a.lv || (b.pct || 0) - (a.pct || 0); }).slice(0, 3);
      var h = '';
      if (W.length) {
        h += '<div class="lv-sum"><span><i class="tri" style="border-top-color:' + WL[5].c + '"></i>ล้นตลิ่ง <b class="num">' + over + '</b></span>' +
          '<span><i class="tri" style="border-top-color:' + WL[4].c + '"></i>น้ำมาก <b class="num">' + high + '</b></span>' +
          '<span class="muted">จาก ' + W.length + ' สถานีที่รายงานล่าสุด</span></div>';
        h += worst.map(function (o) {
          var lv = WL[o.lv] || { t: '', c: '#888' };
          return '<button type="button" class="live-row" data-live="water:' + esc(o.id) + '"><i class="tri" style="border-top-color:' + lv.c + '"></i>' +
            '<span class="lr-name">' + esc(o.name) + (o.prov ? ' <small>จ.' + esc(o.prov) + '</small>' : '') + '</span>' +
            '<span class="lr-val">' + (o.pct != null ? Math.round(o.pct) + '%' : lv.t) + '</span></button>';
        }).join('');
      }
      if (R.length) {
        h += '<div class="live-sub">ฝนหนักสุดใน 24 ชม.</div>' + R.slice(0, 3).map(function (o) {
          return '<button type="button" class="live-row" data-live="rain:' + esc(o.id) + '">' + DROP +
            '<span class="lr-name">' + esc(o.name) + (o.prov ? ' <small>จ.' + esc(o.prov) + '</small>' : '') + '</span>' +
            '<span class="lr-val">' + o.mm.toFixed(0) + ' มม.</span></button>';
        }).join('');
      }
      if (FA.length) {
        var fAge = ageText(FLOOD.index.date_max);
        h += '<div class="live-sub">น้ำท่วมจากดาวเทียม (ทดลอง) · มากสุด' + (fAge ? ' · ภาพ' + (daysAgo(FLOOD.index.date_max) > 1 ? 'เมื่อ ' : '') + esc(fAge) : '') + '</div>' + FA.map(function (r) {
          return '<button type="button" class="live-row" data-flood-prov="' + esc(PID_BY_NAME[r.name]) + '" title="ภาพ ' + esc(dateAge([r.date_min, r.date_max])) + '"><i class="sq" style="background:' + FL_C.flood + '"></i>' +
            '<span class="lr-name">จ.' + esc(r.name) + '</span>' +
            '<span class="lr-val">' + fmtKm2(r.flood_high) + ' ตร.กม.' + deltaBadge(provDelta(r)) + '</span></button>';
        }).join('');
      }
      if (CW.length) {
        h += '<div class="live-sub">กล้อง CCTV ที่ AI เห็นน้ำ (ทดลอง) · ' + esc(ccTime(CCTV.idx.updated)) + '</div>' + CW.map(function (c) {
          var l = ccLab(c.id);
          return '<button type="button" class="live-row" data-cc-cam="' + esc(c.id) + '" data-cc-ctx="wet"><i class="cc-dot" style="background:' + CC_L[l].c + '"></i>' +
            '<span class="lr-name">' + esc(c.name) + ' <small>' + esc(CCTV.siteOf[c.id].name) + '</small></span><span class="lr-val">' + esc(CC_L[l].t) + '</span></button>';
        }).join('');
      }
      h += '<button type="button" class="btn-ghost live-map" data-live="map">ดูบนแผนที่</button>';
      $('liveWater').innerHTML = h;
      $('liveAsOf').textContent = whenText(W.length ? 'water' : 'rain');
    }
    var F = LIVE.fc;
    fc.hidden = !F.length;
    if (F.length) {
      $('fcList').innerHTML = F.map(function (f) {
        var d0 = f.days[0] || {};
        var zname = (find(ZONES, function (z) { return z.id === f.zone; }) || {}).name || '';
        return '<button type="button" class="fc-row" data-wx="' + f.zone + '"><span class="fc-city"><b>' + esc(f.city) + '</b><small>' + esc(zname) + '</small></span>' +
          '<span class="fc-today"><span class="fc-txt">' + esc(wmoText(d0.code)) + '</span><span class="fc-p">' + DROP + Math.round(d0.prob || 0) + '%</span>' +
          '<span class="fc-t num">' + Math.round(d0.tmin) + '–' + Math.round(d0.tmax) + '°</span></span>' +
          '<span class="fc-next">' + f.days.slice(1).map(function (x) { return dowOf(x.d) + ' ' + Math.round(x.prob || 0) + '%'; }).join(' · ') + '</span></button>';
      }).join('');
      $('fcNote').innerHTML = 'วันนี้และอีก 2 วัน · โอกาสฝนสูงสุดของวัน · ' + FC_ATTR + (LIVE.src.fc === 'snap' ? ' · ใช้ข้อมูลสำรองจากเช้านี้ เพราะดึงสดไม่ได้' : '');
    }
  }
  function showLiveOnMap(kind, id) {
    if (kind) { state.data[kind] = true; saveData(); }
    if (state.place !== HOME) goTo(HOME, { noHash: true, instant: true });
    setPage('chat');
    eachView(refreshLive);
    renderDataChips();
    var v = views.chat;
    if (!v || !id) return;
    var o = find(LIVE[kind], function (x) { return x.id === id; });
    if (!o) return;
    setTimeout(function () {
      v.map.flyTo({ center: [o.lon, o.lat], zoom: Math.max(v.map.getZoom(), 8), duration: reduceMotion ? 0 : 1000, essential: true });
      openStationPopup(v, kind, id);
    }, 80);
  }
  if ($('liveWater')) {
    $('liveWater').addEventListener('click', function (e) {
      var b = e.target.closest('[data-live]');
      if (!b) return;
      var a = b.getAttribute('data-live').split(':');
      if (a[0] === 'map') { state.data.water = true; state.data.rain = true; saveData(); showLiveOnMap(null); return; }
      showLiveOnMap(a[0], a[1]);
    });
  }
  if ($('fcList')) {
    $('fcList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-wx]');
      if (b) { goTo(b.getAttribute('data-wx')); $('briefMapCard').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); }
    });
  }

  /* ---------- รอบตัวฉัน: ตำแหน่ง → จังหวัด → น้ำ ฝน พยากรณ์ และข่าวใกล้ตัว ---------- */
  // ตำแหน่งใช้คำนวณในเครื่องผู้ใช้เท่านั้น ไม่ส่งไปที่ไหนและไม่บันทึกไว้
  var NEAR_RE = /รอบตัว|ใกล้ฉัน|ใกล้บ้าน|แถวบ้าน|แถวนี้|ตรงนี้|ตำแหน่งฉัน|near me/i;
  var me = { lon: null, lat: null, marker: null, busy: false };
  function km(lon1, lat1, lon2, lat2) {
    var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function isLocalPlace(p) { return !!(p && (ZONE_FEAT[p.id] || PROV_FEAT[p.id])); }
  function inLocal(p, o) { return ZONE_FEAT[p.id] ? zoneAt(o.lon, o.lat) === p.id : provinceAt(o.lon, o.lat) === p.id; }
  function zoneOfPlace(p) { return ZONE_FEAT[p.id] ? p.id : p.parent; }
  // ข้อมูลน้ำ ฝน พยากรณ์ ของจังหวัด/ภาค หรือรอบตำแหน่งผู้ใช้
  function localHtml(opt) {
    var p = opt.place, near = opt.near;
    if (!LIVE.src.water && !LIVE.src.rain && !LIVE.src.fc) {
      return '<div class="m-extra"><div class="m-extra-head">กำลังโหลดข้อมูลน้ำ ฝน และพยากรณ์…</div></div>' + floodHtml(opt) + ccLocalHtml(opt);
    }
    var cx = near ? near.lon : (p.bx != null ? p.bx : p.lon), cy = near ? near.lat : (p.by != null ? p.by : p.lat);
    function dist(o) { return km(cx, cy, o.lon, o.lat); }
    var showDist = !!near;
    function where(o) { return (o.prov ? 'จ.' + esc(o.prov) : '') + (showDist ? ' · ห่าง ' + Math.round(dist(o)) + ' กม.' : ''); }
    function head(kind, inside) { return kind + (near ? (opt.nearLabel || 'ใกล้คุณ') : inside ? 'ใน' + esc(p.name) : 'ใกล้' + esc(p.name)); }
    var h = '';
    if (LIVE.water.length) {
      var W = near ? [] : LIVE.water.filter(function (o) { return inLocal(p, o); }).sort(function (a, b) { return b.lv - a.lv || (b.pct || 0) - (a.pct || 0); });
      var wIn = W.length > 0;
      if (!wIn) W = LIVE.water.filter(function (o) { return dist(o) <= 80; }).sort(function (a, b) { return dist(a) - dist(b); });
      showDist = !!near || !wIn;
      h += '<div class="m-extra"><div class="m-extra-head">' + head('ระดับน้ำ', wIn) + ' · ThaiWater · ' + esc(whenText('water')) + '</div>' +
        (W.length ? W.slice(0, 3).map(function (o) {
          var lv = WL[o.lv] || { t: '–', c: '#888' };
          return '<div class="m-row"><i class="tri" style="border-top-color:' + lv.c + '"></i><div><b>' + esc(o.name) + '</b> <span>' + lv.t +
            (o.pct != null ? ' ' + Math.round(o.pct) + '%' : '') + ' · ' + where(o) + '</span></div></div>';
        }).join('') : '<div class="m-row m-none"><span></span><div><span>ไม่มีสถานีวัดน้ำที่รายงานล่าสุดในรัศมี 80 กม.</span></div></div>') + '</div>';
    }
    if (LIVE.rain.length) {
      var R = near ? [] : LIVE.rain.filter(function (o) { return inLocal(p, o); });
      var rIn = R.length > 0;
      if (!rIn) R = LIVE.rain.filter(function (o) { return dist(o) <= 60; });
      R = R.sort(function (a, b) { return b.mm - a.mm; }).slice(0, 3);
      showDist = !!near || !rIn;
      h += '<div class="m-extra"><div class="m-extra-head">' + head('ฝนสะสม 24 ชม. ', rIn) + '</div>' +
        (R.length ? R.map(function (o) {
          return '<div class="m-row">' + DROP + '<div><b>' + esc(o.name) + '</b> <span>' + o.mm.toFixed(0) + ' มม. · ' + where(o) + '</span></div></div>';
        }).join('') : '<div class="m-row m-none"><span></span><div><span>ไม่มีรายงานฝนจากสถานีใกล้เคียงใน 24 ชม.</span></div></div>') + '</div>';
    }
    var z = near ? zoneAt(cx, cy) : zoneOfPlace(p);
    var F = LIVE.fc.filter(function (f) { return f.zone === z; }).sort(function (a, b) { return km(cx, cy, a.lon, a.lat) - km(cx, cy, b.lon, b.lat); })[0];
    if (F) {
      h += '<div class="m-extra"><div class="m-extra-head">พยากรณ์ ' + esc(F.city) + ' (ใกล้สุดในภาค) · Open-Meteo</div>' + F.days.map(function (d, i) {
        return '<div class="m-row">' + DROP + '<div><b>' + (i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : dowOf(d.d)) + '</b> <span>' + esc(wmoText(d.code)) +
          ' · โอกาสฝน ' + Math.round(d.prob || 0) + '% · ' + Math.round(d.tmin) + '–' + Math.round(d.tmax) + '°C</span></div></div>';
      }).join('') + '</div>';
    }
    return h + floodHtml(opt) + ccLocalHtml(opt);
  }
  function nearAnswer(m) {
    var p = m.prov && byId[m.prov];
    if (!p) {
      return { title: 'รอบตัวคุณ', text: 'ตำแหน่งของคุณอยู่นอกประเทศไทย ตอนนี้ข้อมูลน้ำ ฝน และข่าวรายภาคของ ChatGeo ครอบคลุมเฉพาะประเทศไทย' };
    }
    var zone = byId[p.parent];
    var news = storiesIn(p), scope = 'จังหวัดนี้';
    if (!news.length && zone) { news = storiesIn(zone); scope = zone.name; }
    return {
      title: 'รอบตัวคุณ · ' + (p.full || p.name),
      text: 'คุณอยู่แถว' + (p.full || p.name) + (zone ? ' (' + zone.name + ')' : '') + ' นี่คือสถานการณ์ใกล้คุณตอนนี้' +
        (news.length ? ' และข่าวเช้านี้ใน' + scope + ' ' + news.length + ' เรื่อง' : ' เช้านี้ยังไม่มีข่าวในภาคนี้'),
      points: pointsOf(news.slice(0, 3)),
      html: (m.ele ? '<div class="m-extra"><div class="m-extra-head">ความสูงพื้นดินที่ตำแหน่งคุณ (ทดลอง)</div><div class="m-row"><span></span><div><b>ราว ' + Math.round(m.ele.ele) +
        ' ม. จากระดับน้ำทะเล</b> <span>' + esc(eleText(m.ele)) + ' · ค่าจากแผนที่ความสูงราว 30 ม. อาจคลาดเคลื่อนหลายเมตร</span></div></div></div>' : '') +
        localHtml({ place: p, near: { lon: m.lon, lat: m.lat } })
    };
  }
  function showMeMarker() {
    var v = views.chat;
    if (!v || me.lon == null) return;
    if (!me.marker) {
      var el = document.createElement('div');
      el.className = 'me-dot';
      el.setAttribute('aria-label', 'ตำแหน่งของคุณ');
      me.marker = new maplibregl.Marker({ element: el }).setLngLat([me.lon, me.lat]).addTo(v.map);
    } else me.marker.setLngLat([me.lon, me.lat]);
  }
  function setNearBusy(b) {
    me.busy = b;
    var btn = $('btnNear');
    if (btn) { btn.classList.toggle('busy', b); btn.setAttribute('aria-busy', String(b)); }
  }
  function locateMe() {
    if (me.busy) return;
    if (!navigator.geolocation) {
      state.messages.push({ role: 'bot', key: 'nearfail', code: 0 });
      renderMsgs();
      return;
    }
    setNearBusy(true);
    navigator.geolocation.getCurrentPosition(function (pos) {
      setNearBusy(false);
      me.lon = pos.coords.longitude; me.lat = pos.coords.latitude;
      var pid = provinceAt(me.lon, me.lat);
      if (state.page !== 'chat') setPage('chat');
      var nm = { role: 'bot', key: 'near', lon: me.lon, lat: me.lat, prov: pid };
      state.messages.push(nm);
      renderMsgs();
      if (!IN_ARTIFACT) elevationAt(me.lon, me.lat).then(function (o) { nm.ele = o; renderMsgs(); }).catch(function () { /* ข้าม */ });
      if (pid) {
        state.data.water = true; state.data.rain = true; saveData();
        eachView(refreshLive); renderDataChips();
        goTo(pid);
      }
      showMeMarker();
    }, function (err) {
      setNearBusy(false);
      state.messages.push({ role: 'bot', key: 'nearfail', code: err && err.code });
      renderMsgs();
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }
  if ($('btnNear')) {
    $('btnNear').addEventListener('click', function () {
      if (state.page !== 'chat') setPage('chat');
      state.messages.push({ role: 'user', text: 'รอบตัวฉันตอนนี้เป็นยังไง' });
      renderMsgs();
      locateMe();
    });
  }

  /* ---------- แถบสถานะล่างสุด (แบบ OSIRIS): ลิงก์ · ตัวหนังสือวิ่ง แผ่นดินไหว ราคา น้ำท่วม ข่าว · สถานะออนไลน์ ---------- */
  var SB = { q: null, qAt: 0, px: null, pxAt: 0, fx: null, fxAt: 0, keys: '', items: [] };
  var SB_QUAKE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
  var SB_CG = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
  var SB_BN = 'https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22%5D';
  var SB_FX = 'https://api.frankfurter.dev/v1/';
  function sbJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function sbLoad() {
    if (IN_ARTIFACT || document.hidden) return;
    var now = Date.now(), jobs = [];
    if (!(WD.quakes && WD.quakes.fc) && now - SB.qAt > 5 * 60e3) { SB.qAt = now; jobs.push(sbJSON(SB_QUAKE).then(function (j) { SB.q = j; }, function () { /* ข้าม */ })); }
    if (now - SB.pxAt > 5 * 60e3) {
      SB.pxAt = now;
      jobs.push(sbJSON(SB_CG).then(function (j) {
        SB.px = { src: 'CoinGecko', BTC: [j.bitcoin.usd, j.bitcoin.usd_24h_change], ETH: [j.ethereum.usd, j.ethereum.usd_24h_change] };
      }).catch(function () {
        return sbJSON(SB_BN).then(function (a) {
          var m = {}; a.forEach(function (r) { m[r.symbol] = [+r.lastPrice, +r.priceChangePercent]; });
          SB.px = { src: 'Binance', BTC: m.BTCUSDT, ETH: m.ETHUSDT };
        });
      }).catch(function () { /* ราคาโหลดไม่ได้ ซ่อนไว้ */ }));
    }
    if (now - SB.fxAt > 6 * 3600e3) {
      SB.fxAt = now;
      // อัตราแลกเปลี่ยนอ้างอิง ECB (วันทำการ) เทียบกับวันทำการก่อนหน้า
      var from = new Date(now - 10 * 86400e3).toISOString().slice(0, 10);
      jobs.push(sbJSON(SB_FX + from + '..?base=USD&symbols=THB').then(function (j) {
        var ds = Object.keys(j.rates || {}).sort(), a = ds.length > 1 ? j.rates[ds[ds.length - 2]].THB : null, b = ds.length ? j.rates[ds[ds.length - 1]].THB : null;
        if (b) SB.fx = { v: b, ch: a ? (b - a) / a * 100 : null, d: ds[ds.length - 1] };
      }, function () { /* ข้าม */ }));
    }
    if (typeof opsKp === 'function') opsKp();
    Promise.all(jobs).then(renderSbar);
  }
  function sbMoney(v) { return v >= 1e4 ? '$' + (Math.round(v / 100) / 10).toFixed(1) + 'K' : v >= 100 ? '$' + Math.round(v).toLocaleString('en-US') : '$' + v.toFixed(2); }
  function sbCh(c) { return c == null || !isFinite(c) ? '' : '<span class="' + (c >= 0 ? 'sb-up' : 'sb-dn') + '">' + (c >= 0 ? '▲' : '▼') + Math.abs(c).toFixed(1) + '%</span>'; }
  function sbShort(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function sbItems() {
    var out = [], now = Date.now();
    var fc = (WD.quakes && WD.quakes.fc) || SB.q, qs = [];
    ((fc && fc.features) || []).forEach(function (f) {
      var p = f.properties, c = f.geometry.coordinates, d = kmFromThai(c[0], c[1]);
      if ((p.mag >= 4.5 && now - p.time < 24 * 3600e3) || (p.mag >= 3 && d < 1500 && now - p.time < 48 * 3600e3)) qs.push(f);
    });
    qs.sort(function (a, b) { return b.properties.time - a.properties.time; });
    var qi = qs.slice(0, 10).map(function (f) {
      var p = f.properties, m = Math.round(p.mag * 10) / 10;
      return { k: 'q' + f.id, act: 'q', f: f, h: '<i class="sb-dot" style="--c:' + (m >= 6 ? '#FF4D4F' : m >= 5 ? '#FF7A45' : '#F5A524') + '"></i><b class="sb-k" style="--c:' + (m >= 6 ? '#FF6B6B' : '#FF8A65') + '">M' + m.toFixed(1) + '</b>' +
        esc(sbShort(p.place, 34)) + '<span class="sb-ago">' + esc(agoText(p.time)) + '</span>', t: 'แผ่นดินไหว M' + m + ' · ' + (p.place || '') + ' (USGS) กดเพื่อดูบนแผนที่' };
    });
    out = out.concat(qi.slice(0, 5));
    if (SB.px) ['BTC', 'ETH'].forEach(function (s) {
      var r = SB.px[s]; if (!r || !isFinite(r[0])) return;
      out.push({ k: 'p' + s, h: '<b class="sb-sym">' + s + '</b>' + sbMoney(r[0]) + sbCh(r[1]), t: s + ' (USD) เปลี่ยนแปลง 24 ชม. · ข้อมูล ' + SB.px.src + ' · ราคาอ้างอิง ไม่ใช่คำแนะนำการลงทุน' });
    });
    if (SB.fx) out.push({ k: 'fx', h: '<b class="sb-sym">USD/THB</b>' + SB.fx.v.toFixed(2) + sbCh(SB.fx.ch), t: 'อัตราอ้างอิง ECB วันที่ ' + SB.fx.d + ' (Frankfurter) เทียบวันทำการก่อนหน้า' });
    if (ccReady() && CCTV.idx) {
      var wet = ccFilterCams('wet').length;
      out.push({ k: 'cc', act: 'cc', h: '<i class="sb-dot" style="--c:' + (wet ? '#FF4D4F' : '#3DDC84') + '"></i><b class="sb-sym">CCTV</b>' + (wet ? 'AI เห็นน้ำ ' + wet + ' กล้อง' : 'AI ไม่เห็นน้ำผิดปกติ'), t: 'ผล AI ดูกล้อง ' + ccTime(CCTV.idx.updated) + ' กดเพื่อเปิดหน้ากล้อง' });
    }
    topFloodProvinces(3, FL_PROV_MIN).forEach(function (r) {
      out.push({ k: 'fl' + r.name, act: 'fl', pid: PID_BY_NAME[r.name], h: '<i class="sb-dot" style="--c:' + FL_C.flood + '"></i><b class="sb-sym">ดาวเทียม</b>น้ำท่วม จ.' + esc(r.name) + ' ~' + fmtKm2(r.flood_high) + ' ตร.กม.', t: 'น้ำจากดาวเทียม Sentinel-1 กดเพื่อดูบนแผนที่' });
    });
    if (typeof OPS !== 'undefined' && OPS.kp) out.push({ k: 'kp', h: '<b class="sb-sym">SOLAR</b>Kp ' + (Math.round(OPS.kp.v * 10) / 10) + ' ' + kpText(OPS.kp.v), t: 'ดัชนีสนามแม่เหล็กโลกจาก NOAA SWPC · 0–2 สงบ 5 ขึ้นไปคือพายุสุริยะ' });
    D.STORIES.filter(function (s) { return s.rank && s.rank <= 4; }).sort(function (a, b) { return a.rank - b.rank; }).forEach(function (s) {
      out.push({ k: 'n' + s.id, act: 'n', id: s.id, h: '<b class="sb-sym news">ข่าว</b>' + esc(sbShort(s.title, 60)), t: s.title + (s.source ? ' · ' + s.source : '') });
    });
    return out.concat(qi.slice(5));
  }
  function sbItemHtml(it, hid) {
    var tag = it.act ? 'button type="button"' : 'span';
    return '<' + tag + ' class="sb-it" data-sbk="' + esc(it.k) + '" title="' + esc(it.t || '') + '"' + (hid ? ' tabindex="-1" aria-hidden="true"' : '') + '>' + it.h + '</' + (it.act ? 'button' : 'span') + '>';
  }
  function renderSbar() {
    var run = $('sbRun');
    if (!run) return;
    var items = sbItems(), keys = items.map(function (it) { return it.k; }).join('|');
    SB.items = items;
    if (keys === SB.keys && run.childNodes.length) {
      // รายการเดิม ค่าเปลี่ยน: แก้เฉพาะข้อความ ตัวหนังสือไม่กระตุกกลับไปเริ่มใหม่
      items.forEach(function (it) { run.querySelectorAll('[data-sbk="' + it.k + '"]').forEach(function (el) { if (el.innerHTML !== it.h) el.innerHTML = it.h; el.title = it.t || ''; }); });
      return;
    }
    SB.keys = keys;
    if (!items.length) { run.classList.remove('go'); run.innerHTML = '<span class="sb-it dim">กำลังโหลดเหตุการณ์ล่าสุด…</span>'; return; }
    var half = function (hid) { return '<span class="ot-half"' + (hid ? ' aria-hidden="true"' : '') + '>' + items.map(function (it) { return sbItemHtml(it, hid); }).join('') + '</span>'; };
    run.innerHTML = half(false) + half(true);
    run.classList.add('go');
    run.style.animationDuration = Math.max(40, Math.round(run.scrollWidth / 2 / 55)) + 's';
  }
  function sbOnline() {
    var el = $('sbOn');
    if (!el) return;
    var on = navigator.onLine !== false;
    el.classList.toggle('off', !on);
    el.querySelector('span').textContent = on ? 'ออนไลน์' : 'ออฟไลน์';
  }
  if ($('sbar')) {
    $('sbar').addEventListener('click', function (e) {
      var soc = e.target.closest('[data-soc]');
      if (soc) {
        var hr = (soc.getAttribute('href') || '').trim();
        if (!hr || hr === '#') { e.preventDefault(); toast('ยังไม่ได้ใส่ลิงก์ ' + soc.getAttribute('data-soc') + ' (ใส่ได้ในไฟล์ index.html ตรงแถบล่างสุด)'); }
        return;
      }
      var b = e.target.closest('button[data-sbk]');
      if (!b) return;
      var it = SB.items.filter(function (x) { return x.k === b.getAttribute('data-sbk'); })[0];
      if (!it) return;
      if (it.act === 'cc') { location.hash = '#cctv=wet'; return; }
      if (it.act === 'fl') { if (it.pid) showFloodProvince(it.pid); return; }
      if (it.act === 'n') { if (state.page !== 'chat') setPage('chat'); selectStory(it.id); return; }
      if (it.act === 'q') {
        if (state.page !== 'chat') setPage('chat');
        if (!state.data.quakes) { state.data.quakes = true; saveData(); eachView(refreshLive); renderDataChips(); }
        var v = views.chat, c = it.f.geometry.coordinates;
        if (!v) return;
        if (OPS.on) OPS.idleAt = Date.now() + 60e3;
        v.map.flyTo({ center: [c[0], c[1]], zoom: Math.max(4, Math.min(6, v.map.getZoom() + 2)), duration: reduceMotion ? 0 : 1400 });
        v.map.once('moveend', function () { openQuakePopup(v, it.f); });
      }
    });
    window.addEventListener('online', sbOnline);
    window.addEventListener('offline', sbOnline);
    sbOnline();
  }

  /* ---------- เริ่ม ---------- */
  renderMeta();
  setAskHint();
  var start = parseHash();
  state.place = start.place;
  if (start.cv) CV.filter = start.cv;
  applyThemeChrome();
  renderSuggest();
  renderMsgs();
  renderChips();
  renderExplorers();
  renderAside();
  // เปิดเว็บครั้งแรก (ไม่มีลิงก์เฉพาะ) เห็นลูกโลกเต็มใบก่อน ซูมเข้าเองได้ หรือกดชื่อพื้นที่ด้านบนเพื่อบินไป
  var intro = start.page === 'chat' && !location.hash && !IN_ARTIFACT;
  if (intro) { state.globe = true; $('btnGlobe').setAttribute('aria-pressed', 'true'); $('globeText').textContent = 'แผนที่แบน'; }
  setPage(start.page, { fromHash: true, intro: intro });
  renderBaseChips();
  connectRuntime();
  renderDataChips();
  loadLive();
  loadFloodIndex();
  loadCctv();
  setInterval(function () { if (!document.hidden) loadCctv(); }, 10 * 60e3); // ผล AI อัปเดตทุกชั่วโมง เช็กทุก 10 นาที
  loadRadar();
  loadWind();
  renderSbar();
  setTimeout(sbLoad, 2500);
  setInterval(function () { sbLoad(); renderSbar(); }, 60e3);
  if (location.hash === '#help') setTimeout(openHelp, 300);
  if (start.site && !IN_ARTIFACT) setTimeout(function () { openSite(start.site.lon, start.site.lat, { tab: start.tab }); }, 300);
  if (start.ops && !IN_ARTIFACT) setTimeout(enterOps, 400);
  setInterval(function () {
    if (document.hidden) return;
    if (state.data.radar) loadRadar(); // เรดาร์ใหม่ทุก 10 นาที
    if (state.data.wind) loadWind();
    if (state.data.cloud) eachView(updateCloud);
    WORLD_IDS.forEach(function (k) { if (state.data[k] && WD[k]) loadWorld(k); });
  }, 5 * 60e3);
  if (IN_ARTIFACT) {
    setTimeout(function () {
      toast('ในแอป Claude ใช้แผนที่โลกแบบออฟไลน์ ซูมถึงระดับถนนไม่ได้ ถ้าอยากเห็นถนนจริงจาก OpenStreetMap ให้เปิดไฟล์ index.html ในเครื่อง');
    }, 1200);
  }
  window.cgViews = views; // ไว้ลองเล่นใน console
})();
