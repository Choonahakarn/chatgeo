/* ChatGeo prototype — MapLibre + OpenStreetMap (ผ่าน OpenFreeMap)
   มี 2 หน้า: คุยกับโลก (#) และ สรุปเช้านี้ (#brief)
   ข่าวเป็นข่าวจริงที่รวบรวมไว้ล่วงหน้า (ดู data/data.js) ไม่อัปเดตอัตโนมัติ
   คำตอบในแชทสร้างจากข่าวชุดนี้ ยังไม่ได้ต่อ AI จริง */
(function () {
  'use strict';

  var D = window.CG_DATA;
  var G = window.CG_GEO;
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
  function fallbackStyle(theme) {
    var c = FB_COLORS[theme];
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
  var byId = {}, kids = {};
  D.PLACES.forEach(function (p) { byId[p.id] = p; kids[p.id] = []; });
  D.PLACES.forEach(function (p) { if (p.parent) kids[p.parent].push(p); });
  var SHORT = { sea: 'อาเซียน', 'th-ne': 'ภาคอีสาน', aya: 'อยุธยา', nst: 'นครศรีฯ', sni: 'สุราษฎร์ฯ', ubn: 'อุบลฯ' };

  function pathOf(id) {
    var out = [], cur = byId[id];
    while (cur) { out.unshift(cur); cur = cur.parent ? byId[cur.parent] : null; }
    return out;
  }
  function boxOf(p) {
    var k = p.s >= 40 ? 30 : 54;
    return { hw: p.hw || k / p.s, hh: p.hh || k / 2 / p.s };
  }
  function inPlace(p, lon, lat) {
    if (p.id === 'world') return true;
    var b = boxOf(p);
    return Math.abs(lon - p.lon) <= b.hw && Math.abs(lat - p.lat) <= b.hh;
  }
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
    try { var g = localStorage.getItem('cg-group'); if (g === 'cat' || g === 'region') return g; } catch (e) { /* ข้าม */ }
    return 'cat';
  }
  var allLayers = {};
  D.LAYERS.forEach(function (l) { allLayers[l.id] = true; });
  var state = {
    theme: readTheme(),
    page: 'chat',
    place: 'world',
    layers: Object.assign({}, allLayers),
    thaiLabels: true,
    messages: [{ role: 'bot', key: 'welcome' }],
    typing: false,
    selPin: null,
    selStory: null,
    groupBy: readGroup(),
    filter: 'all',
    globe: false,
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
    continent: [-5, 2.7], ocean: [0.3, 3.3], country: [2.7, 5],
    region: [5, 7.6], neighbor: [4.6, 8.5], province: [6.6, 11.8]
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
    });

    if (kind === 'chat') {
      map.on('zoomend', function () { refreshView(v); });
      map.on('click', 'cg-pins-halo', function (e) {
        if (e.features && e.features.length) selectPin(e.features[0].properties.id);
      });
      map.on('mouseenter', 'cg-pins-halo', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cg-pins-halo', function () { map.getCanvas().style.cursor = ''; });
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
      raf = requestAnimationFrame(function () { raf = 0; updateLabels(v); });
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
    map.addSource('cg-country', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'cg-country-fill', type: 'fill', source: 'cg-country', paint: { 'fill-color': p.accent, 'fill-opacity': 0.07 } }, before);
    map.addLayer({ id: 'cg-country-line', type: 'line', source: 'cg-country', paint: { 'line-color': p.accent, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.2, 8, 2.4], 'line-opacity': 0.9 } }, before);
    if (v.kind === 'chat') {
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
    var b = boxOf(p);
    var s = Math.max(-84, p.lat - b.hh), n = Math.min(84, p.lat + b.hh);
    v.map.fitBounds([[p.lon - b.hw, s], [p.lon + b.hw, n]], Object.assign({ padding: mapPadding(v), maxZoom: 13 }, opts));
  }

  /* ---------- หน้า (routing) ---------- */
  function hashFor(page, place) {
    if (page === 'brief') return place === 'world' ? '#brief' : '#brief-' + place;
    return place === 'world' ? '' : '#' + place;
  }
  function writeHash(push) {
    var url = location.pathname + location.search + hashFor(state.page, state.place);
    try {
      if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    } catch (e) { /* บางที่ห้ามแก้ URL */ }
  }
  function parseHash() {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (h === 'brief') return { page: 'brief', place: 'world' };
    if (h.indexOf('brief-') === 0 && byId[h.slice(6)]) return { page: 'brief', place: h.slice(6) };
    if (byId[h]) return { page: 'chat', place: h };
    return { page: 'chat', place: 'world' };
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
      pick: function (s) { return s.layer === 'market' || s.layer === 'biz'; } }
  };
  function matchKey(t) {
    if (/น้ำมัน|ฮอร์มุซ|opec|oil|อารัมโก|พลังงาน/i.test(t)) return 'topic:oil';
    if (/น้ำท่วม|ฝน|พายุ|อากาศ|เยียวยา|อุทกภัย|มรสุม/.test(t)) return 'topic:flood';
    if (/\bai\b|เอไอ|ปัญญาประดิษฐ์|ไซเบอร์|ศูนย์ข้อมูล|เทคโนโลยี/i.test(t)) return 'topic:ai';
    if (/หุ้น|ตลาด|ดอกเบี้ย|เฟด|ทอง|ค่าเงิน|บาท|เศรษฐกิจ|set\b/i.test(t)) return 'topic:market';
    var pl = findPlace(t);
    if (pl && pl.id !== 'world') return 'place:' + pl.id;
    if (/สรุป|ข่าว|โลก|เช้านี้|วันนี้/.test(t)) return 'topic:world';
    return 'unknown';
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
      if (t.indexOf(p.name) >= 0 || (SHORT[p.id] && t.indexOf(SHORT[p.id]) >= 0)) return p;
    }
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
      return {
        title: 'สรุปเช้านี้ · ' + D.META.dateShort,
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
        follow: found.length ? 'อยากให้ผมเฝ้า' + place.name + ' แล้วแจ้งเตือนเมื่อมีข่าวใหม่ไหมครับ' : ''
      };
    }
    if (m.key === 'story') {
      var s = storyById(m.story);
      if (!s) return { text: 'ข่าวนี้ไม่อยู่ในสรุปที่เปิดอยู่แล้ว' };
      return {
        title: s.place + ' · ' + s.date, text: s.summary,
        why: s.why + ': ' + s.thai,
        points: pointsOf([s]), linkOnly: true,
        follow: 'อยากให้ผมเฝ้าเรื่องนี้ แล้วแจ้งเตือนเมื่อมีความคืบหน้าไหมครับ'
      };
    }
    return { text: D.UNKNOWN || 'ต้นแบบนี้ยังตอบได้เฉพาะข่าวในสรุปเช้านี้ ลองถามเรื่อง น้ำท่วม น้ำมัน AI หรือหุ้น หรือพิมพ์ชื่อพื้นที่' };
  }

  function extraHtml(kind) {
    if (kind === 'weather' && D.WEATHER && D.WEATHER.length) {
      return '<div class="m-extra"><div class="m-extra-head">อากาศวันนี้ (กรมอุตุฯ)</div>' + D.WEATHER.map(function (w) {
        return '<div class="m-row"><span class="dot" style="background:' + levelColor(w.level) + '"></span><div><b>' + esc(w.region) + '</b> <span>' + esc(w.status) + '</span></div></div>';
      }).join('') + '</div>';
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
    $('suggest').innerHTML = suggestions().map(function (q) {
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
          '<a class="src-link" href="' + esc(pt.url) + '" target="_blank" rel="noopener">' + esc(pt.source) + ICO.ext + '</a></div></li>';
      }).join('') + '</ul>';
    }
    if (a.linkOnly && a.points.length) {
      var pt = a.points[0];
      h += '<a class="src-btn" href="' + esc(pt.url) + '" target="_blank" rel="noopener">อ่านข่าวต้นฉบับที่ ' + esc(pt.source) + ICO.ext + '</a>';
    }
    if (a.extra) h += extraHtml(a.extra);
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
      : 'โหมดออฟไลน์: คำตอบสร้างจากข่าวในสรุปเช้านี้ ยังไม่ได้ต่อ AI (เปิดในแอป Claude เพื่อใช้ AI จริง)';
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
          offlineAnswer(storyId ? 'story:' + storyId : matchKey(text));
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
    if (ai.enabled) { askAI(text); return; }
    ask(matchKey(text), text);
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
  function groupKey(s) { return state.groupBy === 'cat' ? s.layer : s.region; }
  function groupDefs() {
    return state.groupBy === 'cat'
      ? D.LAYERS.map(function (l) { return { id: l.id, name: l.name, long: l.long }; })
      : D.REGIONS.map(function (r) { return { id: r.id, name: r.name, long: r.long }; });
  }
  // จัดลำดับข่าวที่จะแสดง: เรื่องเด่น 1 เรื่อง แล้วตามด้วยกลุ่ม
  function briefLayout() {
    var place = byId[state.place];
    var inP = storiesIn(place);
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
    var L = briefLayout(), place = L.place, isWorld = place.id === 'world';
    $('briefTitle').textContent = isWorld
      ? L.inP.length + ' เรื่องที่ควรรู้ก่อนเริ่มวัน'
      : (L.inP.length ? L.inP.length + ' เรื่องใน' + place.name + 'ที่ควรรู้เช้านี้' : 'เช้านี้ยังไม่มีข่าวใน' + place.name);
    $('briefMapLabel').textContent = place.name + ' · ' + L.inP.length + ' เรื่อง';
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
    try { localStorage.setItem('cg-group', state.groupBy); } catch (err) { /* ข้าม */ }
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
  });
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
        region: ['th', 'asean', 'world'].indexOf(s.region) >= 0 ? s.region : 'world',
        layer: LAYER_IDS.indexOf(s.layer) >= 0 ? s.layer : 'news',
        title: String(s.title), summary: String(s.summary || ''),
        why: String(s.why_label || s.whyLabel || 'ควรรู้'), thai: String(s.why || s.thai || ''),
        place: String(s.place || ''), lon: +s.lon, lat: +s.lat,
        date: pd ? pd.getUTCDate() + ' ' + TH_MON_S[pd.getUTCMonth()] : '',
        when: ago <= 0 ? 'วันนี้' : ago === 1 ? 'เมื่อวาน' : ago + ' วันก่อน',
        source: String(s.source || ''), url: String(s.url)
      };
    }).sort(function (a, b) { return a.rank - b.rank; });
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
  function renderMeta() {
    $('briefDate').textContent = D.META.dateLong || '';
    $('badgeText').textContent = 'ต้นแบบ · ข่าว ณ ' + (D.META.dateShort || '');
    $('srcCount').textContent = String(D.META.sources || 0);
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
  if (IN_ARTIFACT) {
    setTimeout(function () {
      toast('ในแอป Claude ใช้แผนที่โลกแบบออฟไลน์ ซูมถึงระดับถนนไม่ได้ ถ้าอยากเห็นถนนจริงจาก OpenStreetMap ให้เปิดไฟล์ index.html ในเครื่อง');
    }, 1200);
  }
  window.cgViews = views; // ไว้ลองเล่นใน console
})();
