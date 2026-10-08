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
    var d = { water: true, rain: true, fc: true, sat: false, flood: true, cctv: true, radar: true, cloud: false, wind: !reduceMotion, terrain: false, hist: false, hazard: false, zoning: false };
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
      if (e && e.sourceId && e.sourceId.indexOf('cg-') !== 0 && !v.tileOK) {
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
      if (kind === 'chat' && SITE.pick) return; // กำลังเลือกจุดตรวจทำเล
      if (topLayersAt(e.point).length) return;
      if (kind === 'chat' && state.data.terrain) return; // เปิดความสูงพื้นดินอยู่: กดแผนที่เพื่อดูความสูงแทนการเปลี่ยนพื้นที่
      var f = e.features && e.features[0];
      if (f && f.properties.id !== state.place) goTo(f.properties.id);
    });

    if (kind === 'chat') {
      map.on('zoomend', function () { refreshView(v); });
      map.on('click', 'cg-pins-halo', function (e) {
        if (SITE.pick) return;
        if (e.features && e.features.length) selectPin(e.features[0].properties.id);
      });
      map.on('mouseenter', 'cg-pins-halo', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cg-pins-halo', function () { map.getCanvas().style.cursor = ''; });
      ['cg-water', 'cg-rain'].forEach(function (lid) {
        map.on('click', lid, function (e) {
          if (SITE.pick) return;
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
          if (SITE.pick) return;
          var top = ['cg-pins-halo', 'cg-water', 'cg-rain'].filter(function (l) { return map.getLayer(l); });
          if (map.queryRenderedFeatures(e.point, { layers: top }).length) return;
          var f = e.features && e.features[0];
          if (f) openFloodPopup(v, f.properties, e.lngLat);
        });
        map.on('mouseenter', lid, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lid, function () { map.getCanvas().style.cursor = ''; });
      });
      map.on('click', 'cg-flood-pf', function (e) {
        if (SITE.pick) return;
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
        if (SITE.pick) { openSite(e.lngLat.lng, e.lngLat.lat); return; } // เลือกจุดตรวจทำเล
        if (!state.data.terrain) return;
        if (topLayersAt(e.point).length) return;
        openElevationPopup(v, e.lngLat);
      });
      // คลิกขวาที่จุดใดก็ได้ = ตรวจทำเลจุดนั้น
      if (!IN_ARTIFACT) map.on('contextmenu', function (e) { if (e.originalEvent) e.originalEvent.preventDefault(); openSite(e.lngLat.lng, e.lngLat.lat); });
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
    var sm = /^site=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(h);
    if (sm) return { page: 'chat', place: state.place || HOME, site: { lat: +sm[1], lon: +sm[2] } };
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
    if (r.site && !IN_ARTIFACT) openSite(r.site.lon, r.site.lat);
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
    var r = { q: t, place: place, topic: topic, impact: impact, list: [], missing: '', prefix: '', label: '', sat: /ดาวเทียม|satellite/i.test(t) };
    // กล้อง CCTV: ถามถึงกล้องตรงๆ หรือเอ่ยชื่อจุดที่มีกล้อง (เช่น หาดใหญ่ เขื่อนภูมิพล)
    r.camQ = CC_RE.test(t);
    r.wx = RADAR_RE.test(t) ? 'radar' : ELE_RE.test(t) ? 'terrain' : WIND_RE.test(t) ? 'wind' : HELP_RE.test(t) ? 'help' : '';
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
    if (!IN_ARTIFACT && ((SITE_RE.test(text) && !/ข่าว/.test(text)) || parseCoords(text))) { siteQuery(text); return; }
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
    updateCctvMarkers(v);
    updateRadar(v);
    updateCloud(v);
    updateTerrain(v);
    updateWind(v);
    updateHist(v);
    updateHazard(v);
    updateZoning(v);
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
      '<div class="cc-big"><img referrerpolicy="no-referrer" alt="ภาพล่าสุดจากกล้อง ' + esc(c.name) + '" src="' + esc(ccImg(c, true)) + '" onerror="this.parentNode.classList.add(\'err\')"><span class="cc-err">โหลดภาพจากต้นทางไม่ได้ตอนนี้</span></div>' +
      '<div class="cc-info">' +
        '<div class="cc-line">' + ccChip(l) + (r.veh != null ? '<span class="cc-veh">รถราว ' + r.veh + ' คัน</span>' : '') + '</div>' +
        (r.th ? '<p class="cc-th">' + esc(r.th) + '</p>' : '<p class="cc-th">ยังไม่มีผลจาก AI สำหรับกล้องนี้ ดูภาพสดจากต้นทางได้ด้านบน</p>') +
        (r.en ? '<p class="cc-en"><span>คำบรรยายจาก AI (อังกฤษ)</span>' + esc(r.en) + '</p>' : '') +
        '<p class="cc-note">' + esc(times.join(' · ')) + (times.length ? ' · ' : '') + 'จ.' + esc(s.prov) + (s.approx ? ' · ตำแหน่งโดยประมาณ' : '') + '</p>' +
        '<div class="cc-hist" id="ccHist"><div class="cc-hist-head">ย้อนหลัง 48 ชม.</div><div class="cc-note">กำลังโหลด…</div></div>' +
        '<div class="cc-acts">' +
          '<a class="btn-ghost" href="' + esc(c.img) + '" target="_blank" rel="noopener">ภาพเต็มจากต้นทาง' + ICO.ext + '</a>' +
          '<button type="button" class="btn-ghost" data-cc-site="' + esc(s.id) + '">ดูบนแผนที่</button>' +
          '<button type="button" class="btn-ghost" data-cc-wall="' + esc(ccView.ctx || 'all') + '">กลับจอรวม</button>' +
        '</div>' +
        '<p class="cc-note">' + ccCredit(src) + ' · AI ตัวเล็กอาจผิด ใช้ประกอบการดูภาพเท่านั้น</p>' +
      '</div>' +
      (prev ? '<button type="button" class="cc-nav prev" data-cc-cam="' + esc(prev.id) + '" aria-label="กล้องก่อนหน้า: ' + esc(prev.name) + '">‹</button>' : '') +
      (next ? '<button type="button" class="cc-nav next" data-cc-cam="' + esc(next.id) + '" aria-label="กล้องถัดไป: ' + esc(next.name) + '">›</button>' : '') +
      '</div>';
    if (CCTV.hist) renderCcHist();
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
    var t = e.target.closest && e.target.closest('[data-cc-cam],[data-cc-wall],[data-cc-site]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-cc-cam')) openCcModal('cam', t.getAttribute('data-cc-cam'), t.getAttribute('data-cc-ctx'));
    else if (t.hasAttribute('data-cc-wall')) { setFilterOpen(false); openCcModal('wall', t.getAttribute('data-cc-wall')); }
    else showCctvSite(t.getAttribute('data-cc-site'));
  });

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
      '<div class="fl-areas"><button type="button" class="fl-go" data-cc-wall="all">เปิดจอรวม ' + n + ' กล้อง</button>' +
      (CCTV.idx && ccFilterCams('wet').length ? '<button type="button" class="fl-go" data-cc-wall="wet">AI เห็นน้ำ ' + ccFilterCams('wet').length + ' กล้อง</button>' : '') + '</div>' +
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
    }).catch(function () { /* ไม่มีข้อมูลลม ข้ามไป */ }).then(function () { eachView(updateWind); renderDataChips(); });
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
  function updateWind(v) {
    if (!v || v.kind !== 'chat') return;
    var on = !!state.data.wind && !!WIND.grid;
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
    var el = v.windNote;
    var on = !!state.data.wind && !!WIND.grid;
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
  var ZONE = { ok: false, err: false, legend: null, legendTried: false };
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
    var cv = map.getCanvas(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.min(2048, Math.round(cv.clientWidth * dpr)), h = Math.min(2048, Math.round(cv.clientHeight * dpr));
    var url = ZONE_SVC + '/export?bbox=' + [mercX(b[0]), mercY(b[1]), mercX(b[2]), mercY(b[3])].map(function (x) { return x.toFixed(1); }).join(',') +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&dpi=' + Math.round(96 * dpr) + '&format=png32&transparent=true&f=image';
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
    var d = 0.004, url = ZONE_SVC + '/identify?f=json&geometryType=esriGeometryPoint&sr=4326&geometry=' + lon.toFixed(6) + ',' + lat.toFixed(6) +
      '&layers=visible&tolerance=2&returnGeometry=false&imageDisplay=400,400,96&mapExtent=' + [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(6); }).join(',');
    return getJSON(url, 9000).then(function (j) {
      return ((j && j.results) || []).slice(0, 4).map(function (r) {
        var a = r.attributes || {}, extra = '';
        Object.keys(a).forEach(function (k) { if (!extra && /ประเภท|สี|zone|class|lu_|landuse|type/i.test(k) && a[k] && String(a[k]).length < 60) extra = String(a[k]); });
        return { layer: String(r.layerName || ''), value: String(r.value || ''), extra: extra };
      });
    });
  }
  function zoneLegendHtml() {
    var h = '<div class="m-extra zone-leg"><div class="m-extra-head">ผังเมืองรวม · สีใช้ทำอะไร</div>';
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
    if (v && v.map.getZoom() < ZONE_MINZ) return 'ซูมเข้าถึงระดับอำเภอเพื่อดูสีผังเมือง';
    return ZONE.ok ? 'แสดงผังจากกรมโยธาฯ' : 'กำลังโหลด';
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
  function siteRun(lon, lat, name) {
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
    track('name', placeName(lon, lat));
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
    else if (S.st.zone === 'ok' && S.zone && S.zone.length) h += S.zone.map(function (z) { return '<p><b>' + esc(z.value || z.extra || '-') + '</b> <span class="sv-dim">' + esc(z.layer) + (z.extra && z.extra !== z.value ? ' · ' + esc(z.extra) : '') + '</span></p>'; }).join('');
    else if (S.st.zone === 'ok') h += '<p>ไม่พบผังเมืองรวมที่ประกาศใช้ตรงจุดนี้ในเซิร์ฟเวอร์ของกรมโยธาฯ</p>';
    else h += '<p>อ่านผังเมืองที่จุดนี้จากเว็บนี้ไม่ได้ ลองเปิดชั้นผังเมืองบนแผนที่ หรือตรวจที่เว็บของหน่วยงานด้านล่าง</p>';
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
    $('siteTitle').textContent = siteTitle(S);
    $('siteSub').textContent = S.lat.toFixed(5) + ', ' + S.lon.toFixed(5) + (S.given && S.name ? ' · ' + S.name : '');
    var keepScroll = $('siteBody').scrollTop;
    $('siteBody').innerHTML = siteVerdictHtml(S) + siteChipsHtml(S) + siteSectionsHtml(S);
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
    return window.innerWidth <= 860 ? { top: 56, bottom: 16, left: 16, right: 16 } : { top: 60, bottom: 40, left: 40, right: Math.min(424, W * 0.5 + 12) };
  }
  function openSite(lon, lat, opt) {
    opt = opt || {};
    if (!isFinite(lon) || !isFinite(lat)) return null;
    setSitePick(false);
    if (state.page !== 'chat') setPage('chat');
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
    try { history.replaceState(null, '', location.pathname + location.search + '#site=' + lat.toFixed(5) + ',' + lon.toFixed(5)); } catch (e) { /* ข้าม */ }
    return key;
  }
  function closeSite() {
    SITE.cur = null;
    renderSiteCard();
    if (SITE.marker) { SITE.marker.remove(); }
    var v = views.chat;
    if (v) v.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: reduceMotion ? 0 : 400 });
    if (/^#site=/.test(location.hash)) writeHash(false);
  }
  function setSitePick(on, hint) {
    SITE.pick = !!on;
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
  var HERE_RE = /ตรงนี้|ที่นี่|ที่ฉันอยู่|ตำแหน่งฉัน|ตำแหน่งของฉัน|แถวนี้/;
  function siteQuery(text) {
    if (state.page !== 'chat') setPage('chat');
    state.messages.push({ role: 'user', text: text });
    var m = { role: 'bot', key: 'site', status: 'wait', q: text };
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
    SITE_STRIP.forEach(function (w) { rest = rest.split(w).join(' '); });
    rest = rest.replace(/[?？!,.]/g, ' ').replace(/\s+/g, ' ').trim();
    var place = findPlace(text);
    if (place && place.id === 'world') place = null;
    function pickIn(p, name) {
      state.data.hazard = true; saveData(); eachView(refreshLive); renderDataChips();
      if (p) goTo(p.id);
      done('pick', { where: name || '' });
      setSitePick(true, 'แตะจุดที่อยากตรวจ' + (name ? 'ใน' + name : 'บนแผนที่'));
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
    var head = 'ตรวจทำเล (ทดลอง)';
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
      html: siteChipsHtml(S) + '<button type="button" class="btn-ghost sv-open" data-site-open="' + esc(S.key) + '">เปิดรายงานเต็ม' + ICO.arrow + '</button>' };
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
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-site-open], [data-site-layer], [data-site-ll], [data-site-close], [data-site-copy]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-site-copy')) {
      var C = SITE.res[t.getAttribute('data-site-copy')];
      if (!C) return;
      var url = location.origin + location.pathname + '#site=' + C.lat.toFixed(5) + ',' + C.lon.toFixed(5);
      var ok = function () { toast('คัดลอกลิงก์แล้ว ส่งให้คนอื่นเปิดรายงานเดียวกันได้'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { toast(url); });
      else toast(url);
      return;
    }
    if (t.hasAttribute('data-site-close')) { closeSite(); return; }
    if (t.hasAttribute('data-site-open')) { var S = SITE.res[t.getAttribute('data-site-open')]; if (S) openSite(S.lon, S.lat); return; }
    if (t.hasAttribute('data-site-ll')) { var a = t.getAttribute('data-site-ll').split(',').map(Number); openSite(a[0], a[1]); return; }
    var id = t.getAttribute('data-site-layer');
    state.data[id] = !state.data[id];
    saveData(); eachView(refreshLive); renderDataChips(); renderSiteCard();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (SITE.pick) { e.preventDefault(); setSitePick(false); return; }
    var modal = ($('helpModal') && !$('helpModal').hidden) || ($('ccModal') && !$('ccModal').hidden) || ($('palette') && !$('palette').hidden);
    if (SITE.cur && !modal) closeSite();
  });

  // ปุ่มเปิดปิดชั้นข้อมูลในเมนู "ชั้นข้อมูล"
  var DATA_ROWS = [
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
    { id: 'terrain', name: 'ความสูงพื้นดิน', src: 'Terrain Tiles' },
    { id: 'zoning', name: 'ผังเมืองรวม (ทดลอง)', src: 'กรมโยธาธิการและผังเมือง' },
    { id: 'sat', name: 'ภาพดาวเทียม', src: 'Sentinel-2 · EOX' }
  ];
  function dataSub(r) {
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
  function renderDataChips() {
    var el = $('dataChips');
    if (!el) return;
    el.innerHTML = DATA_ROWS.map(function (r) {
      var on = !!state.data[r.id];
      var sub = dataSub(r);
      return '<button type="button" class="fp-row fp-switch" data-data="' + r.id + '" aria-pressed="' + on + '">' +
        '<span class="fp-two"><span>' + esc(r.name) + '</span><small>' + esc(sub) + '</small></span><span class="sw" aria-hidden="true"><i></i></span></button>';
    }).join('') + (state.data.water ? '<div class="wl-legend" aria-label="สีระดับน้ำ">' + [5, 4, 3, 2, 1].map(function (k) {
      return '<span><i class="tri" style="border-top-color:' + WL[k].c + '"></i>' + WL[k].t + '</span>';
    }).join('') + '</div>' : '') + (state.data.rain ? '<div class="rain-legend" aria-label="สีปริมาณฝน"><span>ฝน</span><span class="sp"></span><span>10</span><i style="background:linear-gradient(90deg,' +
      RAIN_C.join(',') + ')"></i><span>150+ มม.</span></div>' : '') +
      (state.data.water || state.data.rain ? '<p class="fp-fine">ซูมออกจะเห็นเฉพาะสถานีที่น้ำผิดปกติและฝน 35 มม.ขึ้นไป ซูมเข้าเพื่อดูครบทุกสถานี</p>' : '') +
      (state.data.flood && floodReady() ? floodLegendHtml() : '') +
      (state.data.cctv && ccReady() ? ccLegendHtml() : '') + wxLegendHtml() + siteLegendHtml();
  }
  function saveData() { try { localStorage.setItem('cg-data', JSON.stringify(state.data)); } catch (e) { /* ข้าม */ } }
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
  loadFloodIndex();
  loadCctv();
  setInterval(function () { if (!document.hidden) loadCctv(); }, 10 * 60e3); // ผล AI อัปเดตทุกชั่วโมง เช็กทุก 10 นาที
  loadRadar();
  loadWind();
  if (location.hash === '#help') setTimeout(openHelp, 300);
  if (start.site && !IN_ARTIFACT) setTimeout(function () { openSite(start.site.lon, start.site.lat); }, 300);
  setInterval(function () {
    if (document.hidden) return;
    if (state.data.radar) loadRadar(); // เรดาร์ใหม่ทุก 10 นาที
    if (state.data.wind) loadWind();
    if (state.data.cloud) eachView(updateCloud);
  }, 5 * 60e3);
  if (IN_ARTIFACT) {
    setTimeout(function () {
      toast('ในแอป Claude ใช้แผนที่โลกแบบออฟไลน์ ซูมถึงระดับถนนไม่ได้ ถ้าอยากเห็นถนนจริงจาก OpenStreetMap ให้เปิดไฟล์ index.html ในเครื่อง');
    }, 1200);
  }
  window.cgViews = views; // ไว้ลองเล่นใน console
})();
