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
    x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = dark ? '#0A1220' : '#FFFFFF'; x.stroke();
    x.fillStyle = color; x.fill();
    return x.getImageData(0, 0, w, h);
  }
  function readDataPrefs() {
    var d = { water: true, rain: true, fc: true, sat: false };
    try {
      var j = JSON.parse(localStorage.getItem('cg-data') || 'null');
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

  var FB_COLORS = {
    dark: { ocean: '#0C1829', land: '#15253B', border: '#2E4566', coast: '#22385A' },
    light: { ocean: '#CDDAE8', land: '#F8FAFC', border: '#B4C2D4', coast: '#B9C8DA' }
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
  function readTheme() {
    try { var t = localStorage.getItem('cg-theme'); if (t === 'light' || t === 'dark') return t; } catch (e) { /* ไม่มี storage */ }
    var host = document.documentElement.getAttribute('data-theme');
    if (host === 'light' || host === 'dark') return host;
    try { if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'; } catch (e) { /* ข้าม */ }
    return 'dark';
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
  function pal() { return D.PAL[state.theme]; }
  function numInk() { return state.theme === 'light' ? '#FFFFFF' : '#0A1220'; }

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
      style: usingFallback ? fallbackStyle(state.theme) : osmStyleUrl(state.theme),
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
      if (usingFallback) return;
      if (v.styleLoading) { switchToFallback('ต้องต่ออินเทอร์เน็ต'); return; }
      if (e && e.sourceId && !v.tileOK) {
        v.tileErrors += 1;
        if (v.tileErrors >= 8) switchToFallback('โหลดภาพแผนที่ไม่ได้');
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
      var ids = ['cg-pins-halo', 'cg-water', 'cg-rain'].filter(function (l) { return map.getLayer(l); });
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
      if (topLayersAt(e.point).length) return;
      var f = e.features && e.features[0];
      if (f && f.properties.id !== state.place) goTo(f.properties.id);
    });

    if (kind === 'chat') {
      map.on('zoomend', function () { refreshView(v); });
      map.on('click', 'cg-pins-halo', function (e) {
        if (e.features && e.features.length) selectPin(e.features[0].properties.id);
      });
      map.on('mouseenter', 'cg-pins-halo', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cg-pins-halo', function () { map.getCanvas().style.cursor = ''; });
      ['cg-water', 'cg-rain'].forEach(function (lid) {
        map.on('click', lid, function (e) {
          if (map.queryRenderedFeatures(e.point, { layers: ['cg-pins-halo'] }).length) return;
          // จุดฝนกับสถานีน้ำซ้อนกันได้ ให้สถานีน้ำมาก่อน
          if (lid === 'cg-rain' && state.data.water && map.queryRenderedFeatures(e.point, { layers: ['cg-water'] }).length) return;
          var f = e.features && e.features[0];
          if (f) openStationPopup(v, lid === 'cg-water' ? 'water' : 'rain', f.properties.id);
        });
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
      });
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
      raf = requestAnimationFrame(function () { raf = 0; updateLabels(v); updateFcMarkers(v); });
    });
    updateLabels(v);
    views[kind] = v;
    return v;
  }

  function armFallbackTimer(v) {
    clearTimeout(v.fbTimer);
    if (usingFallback) return;
    v.fbTimer = setTimeout(function () { if (v.styleLoading) switchToFallback('ช้าเกินไป'); }, 9000);
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
        'fill-color': dark ? '#8FB4E8' : '#2450C2',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], dark ? 0.14 : 0.1, dark ? 0.04 : 0.03]
      } }, before);
      map.addLayer({ id: 'cg-thp-line', type: 'line', source: 'cg-thp', minzoom: 4.2, paint: {
        'line-color': dark ? '#9FB6D6' : '#5B6B82', 'line-opacity': state.data.sat ? 0.55 : 0.28, 'line-width': 0.6, 'line-dasharray': [2, 2]
      } }, before);
      map.addLayer({ id: 'cg-thr-line', type: 'line', source: 'cg-thr', paint: {
        'line-color': dark ? '#B9CCE6' : '#4A5A70', 'line-opacity': state.data.sat ? 0.9 : 0.6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.8]
      } }, before);
    }
    map.addSource('cg-country', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'cg-country-fill', type: 'fill', source: 'cg-country', paint: { 'fill-color': p.accent, 'fill-opacity': 0.07 } }, before);
    map.addLayer({ id: 'cg-country-line', type: 'line', source: 'cg-country', paint: { 'line-color': p.accent, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 8, 2.4], 'line-opacity': 0.9 } }, before);
    if (v.kind === 'chat') {
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
        'circle-opacity': 0.6, 'circle-stroke-color': dark ? '#0A1220' : '#FFFFFF', 'circle-stroke-width': 1
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
    if (h === 'brief') return { page: 'brief', place: HOME };
    if (h.indexOf('brief-') === 0 && byId[h.slice(6)]) return { page: 'brief', place: h.slice(6) };
    if (byId[h]) return { page: 'chat', place: h };
    return { page: 'chat', place: HOME };
  }

  function setPage(page, opts) {
    opts = opts || {};
    state.page = page;
    $('pageChat').hidden = page !== 'chat';
    $('pageBrief').hidden = page !== 'brief';
    $('navChat').setAttribute('aria-current', page === 'chat' ? 'page' : 'false');
    $('navBrief').setAttribute('aria-current', page === 'brief' ? 'page' : 'false');
    document.title = page === 'brief' ? 'สรุปเช้านี้ · ChatGeo' : 'ChatGeo · คุยกับโลก';
    if (page !== 'brief') stopSpeech();
    closeAllResults();
    var v = views[page] || createView(page);
    v.map.resize();
    if (v.shownPlace !== state.place) flyToPlace(v, byId[state.place], true);
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
    if (r.page !== state.page) setPage(r.page, { fromHash: true });
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
    openPalette(document.querySelector(state.page === 'brief' ? '#briefMapCard [data-open-search]' : '.mapbar [data-open-search]'));
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
    var all = onList.length === used.length;
    $('filterCount').textContent = all ? 'ทั้งหมด' : onList.length + '/' + used.length;
    $('filterCount').classList.toggle('on', !all);
    $('btnFilter').setAttribute('aria-label', 'หมวดข่าว ' + (all ? 'แสดงทั้งหมด' : 'แสดง ' + onList.length + ' จาก ' + used.length + ' หมวด'));
    $('btnLabels').setAttribute('aria-pressed', String(state.thaiLabels));
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
  $('filterPop').addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function (e) {
    if (!$('filterPop').hidden && !e.target.closest('.filter-wrap')) setFilterOpen(false);
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
    var r = { q: t, place: place, topic: topic, impact: impact, list: [], missing: '', prefix: '', label: '' };

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
    var loc = r.place && isLocalPlace(r.place) && (!r.topic || r.topic === 'flood') ? localHtml({ place: r.place }) : '';
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
    var list = [{ q: 'รอบตัวฉันตอนนี้เป็นยังไง', layer: 'weather', near: true }].concat(suggestions());
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

  /* ---------- ธีม / ลูกโลก ---------- */
  function applyThemeChrome() {
    document.body.classList.toggle('cg-dark', state.theme === 'dark');
    document.body.classList.toggle('cg-light', state.theme === 'light');
    $('icoSun').hidden = state.theme !== 'dark';
    $('icoMoon').hidden = state.theme === 'dark';
    $('btnTheme').setAttribute('aria-label', state.theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด');
  }
  $('btnTheme').addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cg-theme', state.theme); } catch (e) { /* ไม่มี storage */ }
    applyThemeChrome();
    eachView(function (v) {
      v.styleLoading = true;
      v.tileOK = false; v.tileErrors = 0;
      if (!usingFallback) armFallbackTimer(v);
      v.map.setStyle(usingFallback ? fallbackStyle(state.theme) : osmStyleUrl(state.theme), { diff: false });
    });
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
    $('badgeText').textContent = (old ? 'ข่าวล่าสุด ณ ' : 'ข่าว ณ ') + (D.META.dateShort || '');
    $('badgeText').classList.toggle('stale', !!old);
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
    [['cg-water', 'water'], ['cg-rain', 'rain'], ['cg-fc', 'fc'], ['cg-sat', 'sat']].forEach(function (x) {
      if (map.getLayer(x[0])) map.setLayoutProperty(x[0], 'visibility', state.data[x[1]] ? 'visible' : 'none');
    });
    if (map.getLayer('cg-thr-line')) map.setPaintProperty('cg-thr-line', 'line-opacity', state.data.sat ? 0.9 : 0.6);
    if (map.getLayer('cg-thp-line')) map.setPaintProperty('cg-thp-line', 'line-opacity', state.data.sat ? 0.55 : 0.28);
    buildFcMarkers(v);
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

  // ปุ่มเปิดปิดชั้นข้อมูลในเมนู "ชั้นข้อมูล"
  var DATA_ROWS = [
    { id: 'water', name: 'ระดับน้ำในแม่น้ำ', src: 'ThaiWater (สสน.)' },
    { id: 'rain', name: 'ฝนสะสม 24 ชม.', src: 'ThaiWater (สสน.)' },
    { id: 'fc', name: 'พยากรณ์อากาศ 3 วัน', src: 'Open-Meteo' },
    { id: 'sat', name: 'ภาพดาวเทียม', src: 'Sentinel-2 · EOX' }
  ];
  function renderDataChips() {
    var el = $('dataChips');
    if (!el) return;
    el.innerHTML = DATA_ROWS.map(function (r) {
      var on = !!state.data[r.id];
      var n = r.id === 'sat' ? '' : (LIVE[r.id] || []).length;
      var sub = r.src + (r.id !== 'sat' && LIVE.src[r.id] ? ' · ' + (n ? n + ' จุด' : 'ดึงข้อมูลไม่ได้ตอนนี้') : r.id !== 'sat' ? ' · กำลังโหลด' : '');
      return '<button type="button" class="fp-row fp-switch" data-data="' + r.id + '" aria-pressed="' + on + '">' +
        '<span class="fp-two"><span>' + esc(r.name) + '</span><small>' + esc(sub) + '</small></span><span class="sw" aria-hidden="true"><i></i></span></button>';
    }).join('') + (state.data.water ? '<div class="wl-legend" aria-label="สีระดับน้ำ">' + [5, 4, 3, 2, 1].map(function (k) {
      return '<span><i class="tri" style="border-top-color:' + WL[k].c + '"></i>' + WL[k].t + '</span>';
    }).join('') + '</div>' : '') + (state.data.rain ? '<div class="rain-legend" aria-label="สีปริมาณฝน"><span>ฝน</span><span class="sp"></span><span>10</span><i style="background:linear-gradient(90deg,' +
      RAIN_C.join(',') + ')"></i><span>150+ มม.</span></div>' : '') +
      (state.data.water || state.data.rain ? '<p class="fp-fine">ซูมออกจะเห็นเฉพาะสถานีที่น้ำผิดปกติและฝน 35 มม.ขึ้นไป ซูมเข้าเพื่อดูครบทุกสถานี</p>' : '');
  }
  function saveData() { try { localStorage.setItem('cg-data', JSON.stringify(state.data)); } catch (e) { /* ข้าม */ } }
  if ($('dataChips')) {
    $('dataChips').addEventListener('click', function (e) {
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
    wc.hidden = !W.length && !R.length;
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
      return '<div class="m-extra"><div class="m-extra-head">กำลังโหลดข้อมูลน้ำ ฝน และพยากรณ์…</div></div>';
    }
    var cx = near ? near.lon : (p.bx != null ? p.bx : p.lon), cy = near ? near.lat : (p.by != null ? p.by : p.lat);
    function dist(o) { return km(cx, cy, o.lon, o.lat); }
    var showDist = !!near;
    function where(o) { return (o.prov ? 'จ.' + esc(o.prov) : '') + (showDist ? ' · ห่าง ' + Math.round(dist(o)) + ' กม.' : ''); }
    function head(kind, inside) { return kind + (near ? 'ใกล้คุณ' : inside ? 'ใน' + esc(p.name) : 'ใกล้' + esc(p.name)); }
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
    return h;
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
      html: localHtml({ place: p, near: { lon: m.lon, lat: m.lat } })
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
      state.messages.push({ role: 'bot', key: 'near', lon: me.lon, lat: me.lat, prov: pid });
      renderMsgs();
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

  /* ---------- เริ่ม ---------- */
  renderMeta();
  setAskHint();
  var start = parseHash();
  state.place = start.place;
  applyThemeChrome();
  renderSuggest();
  renderMsgs();
  renderChips();
  renderExplorers();
  renderAside();
  setPage(start.page, { fromHash: true });
  connectRuntime();
  renderDataChips();
  loadLive();
  if (IN_ARTIFACT) {
    setTimeout(function () {
      toast('ในแอป Claude ใช้แผนที่โลกแบบออฟไลน์ ซูมถึงระดับถนนไม่ได้ ถ้าอยากเห็นถนนจริงจาก OpenStreetMap ให้เปิดไฟล์ index.html ในเครื่อง');
    }, 1200);
  }
  window.cgViews = views; // ไว้ลองเล่นใน console
})();
