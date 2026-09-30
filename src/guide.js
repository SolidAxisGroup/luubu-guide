/*!
 * Luubu Guide v2.1
 * Script-driven walkthroughs for Luubu.
 * Tours live in /tours/*.json. The nightly watcher keeps their anchors current.
 */
(function () {
  'use strict';
  if (window.__luubuGuide) return;
  var GEN = (window.__luubuGen = (window.__luubuGen || 0) + 1);

  // ---------- config ----------
  var script = document.currentScript;
  var scriptBase = script && script.src ? script.src.replace(/\/src\/guide(\.min)?\.js.*$/, '/') : null;
  var CFG = Object.assign({
    locations: null,            // array of location IDs allowed, null = all
    base: scriptBase,           // repo root URL (tours/ lives under it)
    telemetry: null,            // optional URL for sendBeacon events
    support: 'hello@luubu.com',
    stepTimeout: 20000,
    tours: null                 // optional inline tours (testing)
  }, window.LUUBU_GUIDE_CONFIG || {});

  var NAVY = '#002C69', GOLD = '#F8D99B';

  // ---------- helpers ----------
  function locId() { var m = location.pathname.match(/\/v2\/location\/([^\/]+)/); return m ? m[1] : null; }
  function relPath() { return location.pathname.replace(/^\/v2\/location\/[^\/]+/, '') || '/'; }
  function allowed() { var l = locId(); return !!l && (!CFG.locations || CFG.locations.indexOf(l) !== -1); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }
  function storeKey() { return 'luubuGuide:' + (locId() || 'x'); }
  function load() { try { return JSON.parse(localStorage.getItem(storeKey())) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(storeKey(), JSON.stringify(s)); } catch (e) {} }
  function emit(type, data) {
    var ev = Object.assign({ type: type, loc: locId(), path: relPath(), t: Date.now() }, data || {});
    try { window.dispatchEvent(new CustomEvent('luubu-guide', { detail: ev })); } catch (e) {}
    if (CFG.telemetry && navigator.sendBeacon) { try { navigator.sendBeacon(CFG.telemetry, JSON.stringify(ev)); } catch (e) {} }
  }

  // ---------- anchor resolution ----------
  // target: strategy or array of strategies, tried in order.
  //   { css: "#sb_automation" }
  //   { text: "New website", tag: "button" }      exact, then contains
  //   { frame: true }                             largest visible iframe (coach mode)
  //   { coach: true }                             no highlight, just the card
  // phase: 0 = css/text only, 1 = + frame, 2 = + coach (default). Pages load
  // slowly, so the runner widens the search over time before settling.
  var COACH = { coach: true };
  function resolve(target, phase) {
    if (!target) return null;
    if (phase == null) phase = 2;
    var list = Array.isArray(target) ? target : [target];
    var hasPrecise = list.some(function (x) { return x.css || x.text; });
    var hasFrame = list.some(function (x) { return x.frame; });
    for (var i = 0; i < list.length; i++) {
      var s = list[i], el = null;
      if (s.frame && phase < 1 && hasPrecise) continue;
      if (s.coach) { if (phase >= 2 || (!hasPrecise && !hasFrame)) return COACH; continue; }
      try {
        if (s.css) {
          var all = document.querySelectorAll(s.css);
          for (var j = 0; j < all.length; j++) if (visible(all[j])) { el = all[j]; break; }
        } else if (s.text) {
          var tags = s.tag || 'a,button,[role=button],[role=tab],label,h1,h2,h3,span,div';
          var want = s.text.toLowerCase().trim(), exact = null, partial = null;
          var nodes = document.querySelectorAll(tags);
          for (var k = 0; k < nodes.length; k++) {
            var n = nodes[k];
            if (host && host.contains(n)) continue;
            if (!visible(n)) continue;
            var t = (n.innerText || n.getAttribute('aria-label') || n.getAttribute('title') || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!t || t.length > want.length + 40) continue;
            if (t === want) { exact = n; break; }
            if (!partial && t.indexOf(want) !== -1) partial = n;
          }
          el = exact || partial;
        } else if (s.frame) {
          var best = null, area = 0;
          document.querySelectorAll('iframe').forEach(function (f) {
            if (!visible(f)) return;
            var r = f.getBoundingClientRect(), a = r.width * r.height;
            if (a > area) { area = a; best = f; }
          });
          el = area > 60000 ? best : null;
        }
      } catch (e) { el = null; }
      if (el) return el;
    }
    return null;
  }

  // ---------- navigation ----------
  function nav(path) {
    var full = '/v2/location/' + locId() + path;
    var a = document.querySelector('a[href="' + full + '"]');
    if (a && visible(a)) { a.click(); return; }
    // Luubu is several apps stitched together; a real page load is the only
    // cross-app jump that is always safe. The active step resumes after load.
    location.assign(full);
  }

  // ---------- tours ----------
  var TOURS = null, INDEX = null, SCREENS = [];
  function fetchJSON(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (CFG.tours) { INDEX = CFG.tours; SCREENS = CFG.screens || []; TOURS = {}; CFG.tours.forEach(function (t) { TOURS[t.id] = t; }); return Promise.resolve(INDEX); }
    return fetchJSON(CFG.base + 'tours/index.json').then(function (ix) { INDEX = ix.tours; SCREENS = ix.screens || []; TOURS = {}; return INDEX; });
  }
  function loadTour(id) {
    if (TOURS && TOURS[id] && TOURS[id].steps) return Promise.resolve(TOURS[id]);
    return fetchJSON(CFG.base + 'tours/' + id + '.json').then(function (t) { TOURS[id] = t; return t; });
  }

  // ---------- UI (shadow DOM keeps our styles away from Luubu's) ----------
  var host, root, els = {};
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Poppins,Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '.fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;pointer-events:auto;display:flex;align-items:center;gap:8px;height:46px;padding:0 18px 0 14px;border-radius:23px;border:0;cursor:pointer;background:' + NAVY + ';color:#fff;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,30,80,.35);transition:transform .15s}',
    '.fab:hover{transform:translateY(-2px)}',
    '.fab svg{width:26px;height:14px}',
    '.fab.hid,.fab.dock{right:-4px;height:40px;width:34px;padding:0;justify-content:center;border-radius:10px 0 0 10px}',
    '.fab.hid span,.fab.dock span{display:none}',
    '.fab.drag{transition:none;cursor:grabbing;transform:none}',
    '.panel{position:fixed;right:22px;bottom:80px;width:380px;max-height:calc(100vh - 120px);display:flex;flex-direction:column;z-index:2147483001;pointer-events:auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,30,80,.35);color:#1B2433}',
    '.ph{background:' + NAVY + ';color:#fff;padding:18px 18px 14px}',
    '.ph .k{color:' + GOLD + ';font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:600}',
    '.ph h3{margin:4px 0 2px;font-size:18px}',
    '.ph p{margin:0;color:#C9D5EA;font-size:12px}',
    '.ph .x{position:absolute;right:14px;top:12px;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;opacity:.8}',
    '.bar{height:4px;background:rgba(255,255,255,.18);border-radius:2px;margin-top:12px;overflow:hidden}.bar i{display:block;height:100%;background:' + GOLD + '}',
    '.search{padding:12px 14px 4px}',
    '.search input{width:100%;height:38px;border:1px solid #D9E0EC;border-radius:10px;padding:0 12px;font-size:13px;outline:none}',
    '.search input:focus{border-color:' + NAVY + '}',
    '.list{overflow:auto;padding:8px 10px 10px}',
    '.item{display:flex;gap:12px;align-items:center;width:100%;text-align:left;background:#fff;border:1px solid #E6EBF3;border-radius:12px;padding:11px 12px;margin:6px 0;cursor:pointer;color:inherit}',
    '.item:hover{border-color:' + NAVY + ';background:#F6F8FC}',
    '.ic{flex:0 0 36px;height:36px;border-radius:10px;background:#EEF3FB;display:flex;align-items:center;justify-content:center;color:' + NAVY + '}',
    '.ic svg{width:18px;height:18px}',
    '.item b{display:block;font-size:13.5px;color:' + NAVY + '}',
    '.item small{display:block;font-size:11.5px;color:#5B6678;line-height:1.35}',
    '.done .ic{background:' + GOLD + '}',
    '.tick{margin-left:auto;font-size:11px;color:#1E8E4E;font-weight:600;white-space:nowrap}',
    '.empty{padding:14px;font-size:12.5px;color:#5B6678}',
    '.sec{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8A94A6;font-weight:600;margin:12px 4px 4px}',
    '.hero{display:flex;gap:12px;align-items:center;width:100%;text-align:left;background:' + NAVY + ';color:#fff;border:0;border-radius:12px;padding:12px;margin:6px 0 8px;cursor:pointer}',
    '.hero b{display:block;font-size:14px;color:#fff}.hero small{display:block;font-size:11.5px;color:#C9D5EA;line-height:1.35}',
    '.hero .ic{background:rgba(255,255,255,.12);color:' + GOLD + '}.hero .go{margin-left:auto;background:' + GOLD + ';color:' + NAVY + ';font-weight:700;font-size:11.5px;border-radius:8px;padding:6px 10px}',
    '.area{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:#fff;border:0;border-bottom:1px solid #EEF1F6;padding:9px 4px;cursor:pointer;color:' + NAVY + '}',
    '.area .ic{flex:0 0 30px;height:30px}.area b{font-size:13px}.area .cnt{margin-left:auto;font-size:11px;color:#8A94A6}.area .chev{font-size:18px;color:#8A94A6;transition:transform .15s}.area.open .chev{transform:rotate(90deg)}',
    '.sub{padding:2px 0 8px 8px}.item.pg{border-style:dashed}',
    '.pf{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-top:1px solid #EEF1F6;font-size:11.5px;color:#5B6678}',
    '.pf button{background:none;border:0;color:' + NAVY + ';font-weight:600;cursor:pointer;font-size:11.5px}',
    '.pf a{color:' + NAVY + '}',
    '.spot{position:fixed;z-index:2147482990;pointer-events:none;border-radius:10px;box-shadow:0 0 0 3px ' + GOLD + ',0 0 0 9999px rgba(0,22,55,.45);transition:all .2s ease}',
    '.spot.pulse:after{content:"";position:absolute;inset:-8px;border-radius:14px;border:2px solid ' + GOLD + ';animation:p 1.6s infinite}',
    '@keyframes p{0%{opacity:1;transform:scale(.96)}100%{opacity:0;transform:scale(1.08)}}',
    '.frame{position:fixed;z-index:2147482990;pointer-events:none;border-radius:8px;box-shadow:0 0 0 3px ' + GOLD + ' inset}',
    '.card{position:fixed;z-index:2147483002;pointer-events:auto;width:330px;background:#fff;border-radius:14px;box-shadow:0 16px 48px rgba(0,30,80,.35);color:#1B2433;overflow:hidden}',
    '.ch{background:' + NAVY + ';color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}',
    '.ch .n{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:' + GOLD + ';font-weight:600}',
    '.ch .tt{font-size:11.5px;color:#C9D5EA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ch .x{margin-left:auto;background:none;border:0;color:#fff;font-size:18px;cursor:pointer;opacity:.8}',
    '.cb{padding:14px 16px 6px}',
    '.cb h4{margin:0 0 6px;font-size:15.5px;color:' + NAVY + '}',
    '.cb p{margin:0 0 8px;font-size:13px;line-height:1.5}',
    '.cb .hint{font-size:11.5px;color:#5B6678;background:#F5F7FB;border-radius:8px;padding:7px 9px;margin-top:4px}',
    '.cb .warn{background:#FFF8EA;color:#6B4E12}',
    '.cf{display:flex;align-items:center;gap:8px;padding:10px 16px 14px}',
    '.dots{display:flex;gap:4px;margin-right:auto}.dots i{width:6px;height:6px;border-radius:3px;background:#D9E0EC}.dots i.on{background:' + NAVY + ';width:16px}',
    '.btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid #D9E0EC;background:#fff;color:' + NAVY + ';font-weight:600;font-size:12.5px;cursor:pointer}',
    '.btn.pri{background:' + NAVY + ';border-color:' + NAVY + ';color:#fff}',
    '.btn.gold{background:' + GOLD + ';border-color:' + GOLD + ';color:' + NAVY + '}',
    '.wait{display:inline-block;width:10px;height:10px;border:2px solid #C9D5EA;border-top-color:' + NAVY + ';border-radius:50%;animation:s .8s linear infinite;vertical-align:-1px;margin-right:6px}@keyframes s{to{transform:rotate(360deg)}}'
  ].join('\n');

  var ICONS = {
    mail: '<path d="M3 6h18v12H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="2"/>',
    share: '<circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" stroke="currentColor" stroke-width="2"/>',
    flow: '<rect x="3" y="3" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="15" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 9v4a2 2 0 002 2H14" fill="none" stroke="currentColor" stroke-width="2"/>',
    globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="2"/>',
    page: '<rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2"/>',
    megaphone: '<path d="M4 10v4h3l7 4V6L7 10H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M17 9a4 4 0 010 6" fill="none" stroke="currentColor" stroke-width="2"/>',
    phone: '<path d="M6 3h3l1.5 4.5L8 9a11 11 0 007 7l1.5-2.5L21 15v3a3 3 0 01-3 3A15 15 0 013 6a3 3 0 013-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    users: '<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c1.9.8 3.1 2.6 3.5 5.2" fill="none" stroke="currentColor" stroke-width="2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10.5h18M7 15h4" stroke="currentColor" stroke-width="2"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" stroke-width="2" fill="none"/>',
    cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2"/>',
    book: '<path d="M4 4.5h6a2 2 0 012 2V20a2 2 0 00-2-2H4zM20 4.5h-6a2 2 0 00-2 2V20a2 2 0 012-2h6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="9.5" r="1.8" fill="currentColor"/><path d="M21 16l-5-5-9 9" fill="none" stroke="currentColor" stroke-width="2"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/>'
  };
  var INF = '<svg viewBox="0 0 52 28"><path d="M14 4a10 10 0 100 20c5 0 8-4 12-10s7-10 12-10a10 10 0 110 20c-5 0-8-4-12-10" fill="none" stroke="' + GOLD + '" stroke-width="5" stroke-linecap="round"/></svg>';
  function icon(n) { return '<svg viewBox="0 0 24 24">' + (ICONS[n] || ICONS.page) + '</svg>'; }
  var AREAS = [['start', 'Getting started', 'grid'], ['home', 'Dashboard & Ask AI', 'chart'], ['conversations', 'Conversations', 'chat'], ['contacts', 'Contacts', 'users'], ['opportunities', 'Opportunities', 'flow'], ['calendars', 'Calendars', 'calendar'], ['payments', 'Payments', 'card'], ['marketing', 'Marketing', 'megaphone'], ['automation', 'Automation', 'flow'], ['ai', 'AI Agents & AI Studio', 'bot'], ['sites', 'Sites', 'globe'], ['memberships', 'Memberships', 'book'], ['reputation', 'Reputation', 'star'], ['reporting', 'Reporting', 'chart'], ['more', 'Media & Apps', 'image'], ['settings', 'Settings', 'cog']];

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'luubu-guide-root';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482990';
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style><div id="layer"></div>';
    els.layer = root.getElementById('layer');
    renderFab();
  }

  function renderFab() {
    var st = load();
    if (els.fab) els.fab.remove();
    var b = document.createElement('button');
    b.className = 'fab' + (st.hidden ? ' hid' : '');
    b.title = st.hidden ? 'Show Luubu Guide (Alt+H)' : 'Luubu Guide';
    b.innerHTML = INF + '<span>Guide</span>';
    b.onclick = function () {
      if (dragged) { dragged = false; return; }
      var s = load();
      if (s.hidden) { s.hidden = false; save(s); renderFab(); }
      togglePanel();
    };
    // drag up or down the right edge to park it somewhere else; the spot is remembered
    b.onpointerdown = function (e) {
      if (e.button) return;
      var y0 = e.clientY, b0 = fabBottom, moved = false;
      function mv(ev) {
        var d = y0 - ev.clientY;
        if (!moved && Math.abs(d) < 5) return;
        moved = true; b.classList.add('drag');
        setBottom(Math.max(10, Math.min(innerHeight - 60, b0 + d)));
      }
      function up() {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        b.classList.remove('drag');
        if (moved) { dragged = true; var s = load(); s.fabB = fabBottom; save(s); }
      }
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
    els.layer.appendChild(b);
    els.fab = b;
    fabBottom = -1; dodge(true);
  }

  // ---------- keep the launcher off the page's own buttons ----------
  var fabBottom = -1, dragged = false;
  var CLICKY = 'button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[onclick],[contenteditable=""],[contenteditable=true]';
  function setBottom(v) {
    fabBottom = v;
    if (els.fab) els.fab.style.bottom = v + 'px';
    if (els.panel) { els.panel.style.bottom = (v + 58) + 'px'; els.panel.style.maxHeight = Math.max(240, innerHeight - v - 90) + 'px'; }
  }
  // what the page has under a point, ignoring the Guide itself
  function under(x, y) {
    var list = document.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) if (list[i] !== host && list[i] !== document.documentElement && list[i] !== document.body) return list[i];
    return null;
  }
  function busy(x, y) {
    var el = under(x, y);
    if (!el) return 0;
    if (el.tagName === 'IFRAME') return 1; // can't see inside a secure frame, so treat it as unknown
    if (el.closest(CLICKY)) return 2;
    try { if (getComputedStyle(el).cursor === 'pointer') return 2; } catch (e) {}
    return 0;
  }
  // score a launcher position: 0 clear, 1 over a frame, 2 over something clickable
  function spotScore(bottom, w, h) {
    var right = innerWidth - 22, left = right - w, top = innerHeight - bottom - h, worst = 0;
    var pts = [[left + 3, top + 3], [right - 3, top + 3], [left + 3, top + h - 3], [right - 3, top + h - 3], [left + w / 2, top + h / 2], [left + w / 2, top + 3], [left + w / 2, top + h - 3]];
    for (var i = 0; i < pts.length && worst < 2; i++) worst = Math.max(worst, busy(pts[i][0], pts[i][1]));
    return worst;
  }
  function dodge(force) {
    var b = els.fab;
    if (!b || !b.isConnected || b.classList.contains('drag')) return;
    var st = load(), H = innerHeight, home = st.hidden ? 120 : 22;
    var want = st.fabB != null ? Math.max(10, Math.min(H - 60, st.fabB)) : home;
    var docked = b.classList.contains('dock');
    b.classList.remove('dock');
    var w = st.hidden ? 34 : (b.offsetWidth || 110), h = st.hidden ? 40 : 46;
    // stay put if the current spot is still clear
    if (!force && !docked && fabBottom >= 0 && spotScore(fabBottom, w, h) === 0) return;
    var cands = [want];
    for (var y = 22; y < H - 120; y += 62) if (y !== want) cands.push(y);
    var best = null, bestScore = 3;
    for (var i = 0; i < cands.length; i++) {
      var sc = spotScore(cands[i], w, h);
      if (sc < bestScore) { best = cands[i]; bestScore = sc; }
      if (sc === 0) break;
    }
    if (bestScore === 0) { setBottom(best); return; }
    // nowhere clear: shrink to a small tab on the right edge, halfway up
    b.classList.add('dock');
    setBottom(st.fabB != null ? want : Math.round(H * 0.45));
  }

  // ---------- panel ----------
  var openArea = null;
  function togglePanel(force) {
    var open = !!els.panel;
    if (force === false || (open && force !== true)) { if (els.panel) els.panel.remove(); els.panel = null; return; }
    if (open) return;
    var p = document.createElement('div');
    p.className = 'panel';
    p.innerHTML = '<div class="ph" style="position:relative"><div class="k">Luubu Guide</div><h3>What do you want to do?</h3><p>Pick a guide and we\'ll walk you through it, click by click.</p><div class="bar"><i style="width:0"></i></div><button class="x" title="Close">&times;</button></div>' +
      '<div class="search"><input placeholder="Search, e.g. &quot;import contacts&quot; or &quot;invoice&quot;"></div>' +
      '<div class="list"><div class="empty"><span class="wait"></span>Loading guides…</div></div>' +
      '<div class="pf"><span>Stuck? <a href="mailto:' + esc(CFG.support) + '">' + esc(CFG.support) + '</a></span><button data-hide>Hide button</button></div>';
    els.layer.appendChild(p);
    els.panel = p;
    if (fabBottom >= 0) setBottom(fabBottom);
    p.querySelector('.x').onclick = function () { togglePanel(false); };
    p.querySelector('[data-hide]').onclick = function () { var s = load(); s.hidden = true; save(s); togglePanel(false); renderFab(); };
    var input = p.querySelector('input');
    input.oninput = function () { renderList(input.value); };
    loadIndex().then(function () { renderList(''); input.focus(); }).catch(function () {
      p.querySelector('.list').innerHTML = '<div class="empty">Guides couldn\'t load just now. Try again in a minute.</div>';
    });
  }

  // which screen(s) are we on? longest matching path wins
  function hereScreens() {
    var path = relPath().toLowerCase(), best = -1, out = [];
    SCREENS.forEach(function (sc) {
      var sp = sc.path.split('?')[0].toLowerCase();
      if (path === sp || path.indexOf(sp + '/') === 0) {
        if (sp.length > best) { best = sp.length; out = [sc]; } else if (sp.length === best) out.push(sc);
      }
    });
    return out;
  }

  function score(t, q) {
    if (!q) return 1;
    var title = t.title.toLowerCase();
    var hay = (t.title + ' ' + t.blurb + ' ' + (t.keywords || []).join(' ') + ' ' + (t.area || '')).toLowerCase();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean), s = 0;
    words.forEach(function (w) { if (title.indexOf(w) !== -1) s += 1.5; else if (hay.indexOf(w) !== -1) s += 1; });
    return s / words.length + (t.kind === 'page' ? -0.1 : 0);
  }

  function itemHTML(t, done, extra) {
    return '<button class="item' + (done[t.id] ? ' done' : '') + (extra || '') + '" data-id="' + esc(t.id) + '"><span class="ic">' + icon(t.icon) + '</span><span><b>' + esc(t.title) + '</b><small>' + esc(t.blurb) + '</small></span>' +
      (done[t.id] ? '<span class="tick">Done</span>' : '<span class="tick" style="color:#8A94A6">' + (t.minutes || 3) + ' min</span>') + '</button>';
  }

  function renderList(q) {
    if (!els.panel || !INDEX) return;
    var st = load(), done = st.done || {};
    var n = INDEX.filter(function (t) { return done[t.id]; }).length;
    els.panel.querySelector('.bar i').style.width = Math.round(100 * n / INDEX.length) + '%';
    var box = els.panel.querySelector('.list'), html = '';
    q = (q || '').trim();

    if (q) {
      var hits = INDEX.map(function (t) { return { t: t, s: score(t, q) }; }).filter(function (x) { return x.s >= 0.5; })
        .sort(function (a, b) { return b.s - a.s; }).slice(0, 30);
      html = hits.length ? '<div class="sec">' + hits.length + ' guide' + (hits.length > 1 ? 's' : '') + '</div>' + hits.map(function (x) { return itemHTML(x.t, done); }).join('')
        : '<div class="empty">No guide for that yet. Email <b>' + esc(CFG.support) + '</b> and we\'ll help.</div>';
    } else {
      var here = hereScreens(), keys = here.map(function (h) { return h.key; });
      if (here.length) {
        var pageT = INDEX.filter(function (t) { return t.kind === 'page' && keys.indexOf(t.screen) !== -1; })[0];
        var howtos = INDEX.filter(function (t) { return t.kind !== 'page' && keys.indexOf(t.screen) !== -1; });
        html += '<div class="sec">On this page &middot; ' + esc(here[0].label) + '</div>';
        if (pageT) html += '<button class="hero" data-id="' + esc(pageT.id) + '"><span class="ic">' + icon('page') + '</span><span><b>Show me this page</b><small>' + esc(pageT.blurb) + '</small></span><span class="go">Start</span></button>';
        html += howtos.map(function (t) { return itemHTML(t, done); }).join('');
      } else {
        html += '<div class="sec">Getting started</div>' + INDEX.filter(function (t) { return t.area === 'start'; }).map(function (t) { return itemHTML(t, done); }).join('');
      }
      html += '<div class="sec">Browse everything</div>';
      AREAS.forEach(function (a) {
        var ts = INDEX.filter(function (t) { return t.area === a[0]; });
        if (!ts.length) return;
        var dn = ts.filter(function (t) { return done[t.id]; }).length, isOpen = openArea === a[0];
        html += '<button class="area' + (isOpen ? ' open' : '') + '" data-area="' + a[0] + '"><span class="ic">' + icon(a[2]) + '</span><b>' + esc(a[1]) + '</b><span class="cnt">' + (dn ? dn + '/' : '') + ts.length + '</span><span class="chev">&rsaquo;</span></button>';
        if (isOpen) {
          ts.sort(function (x, y) { return (x.kind === 'page' ? 0 : 1) - (y.kind === 'page' ? 0 : 1); });
          html += '<div class="sub">' + ts.map(function (t) { return itemHTML(t, done, t.kind === 'page' ? ' pg' : ''); }).join('') + '</div>';
        }
      });
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-id]').forEach(function (b) { b.onclick = function () { start(b.getAttribute('data-id')); }; });
    box.querySelectorAll('[data-area]').forEach(function (b) {
      b.onclick = function () { var a = b.getAttribute('data-area'); openArea = openArea === a ? null : a; var top = box.scrollTop; renderList(''); box.scrollTop = top; };
    });
  }

  // ---------- runner ----------
  var run = null; // { tour, i, el, raf, poll, clickOff }

  function start(id, stepIndex) {
    togglePanel(false);
    loadIndex().then(function () { return loadTour(id); }).then(function (tour) {
      stop(true);
      run = { tour: tour, i: stepIndex || 0 };
      var s = load(); s.active = { id: id, i: run.i }; save(s);
      if (!stepIndex) emit('tour_start', { tour: id });
      show();
    }).catch(function (e) { console.warn('[Luubu Guide] tour load failed', e); });
  }

  function stop(silent) {
    if (!run) return;
    clearTimers();
    ['spot', 'frame', 'card'].forEach(function (k) { if (els[k]) { els[k].remove(); els[k] = null; } });
    if (!silent) emit('tour_exit', { tour: run.tour.id, step: run.i });
    run = null;
    var s = load(); delete s.active; save(s);
  }

  function clearTimers() {
    if (!run) return;
    if (run.raf) cancelAnimationFrame(run.raf);
    if (run.poll) clearInterval(run.poll);
    if (run.clickOff) run.clickOff();
    run.raf = run.poll = run.clickOff = null;
    run.el = null;
  }

  function step() { return run.tour.steps[run.i]; }
  function onRoute(st) { return !st.route || new RegExp(st.route, 'i').test(relPath() + location.search); }

  function show() {
    clearTimers();
    var st = step();
    var s = load(); s.active = { id: run.tour.id, i: run.i }; save(s);
    emit('step_view', { tour: run.tour.id, step: st.id || run.i });

    // already where this step would take them? skip it
    var adv0 = st.advance;
    if (adv0 && adv0.route && new RegExp(adv0.route, 'i').test(relPath() + location.search) && run.i < run.tour.steps.length - 1) { run.i++; show(); return; }

    if (!onRoute(st)) { renderCard(st, 'away'); watchRouteUntil(st); return; }

    var needsTarget = !!st.target;
    if (!needsTarget) {
      ['spot', 'frame'].forEach(function (k) { if (els[k]) { els[k].remove(); els[k] = null; } });
      renderCard(st, 'ok'); place(null, false); hookAdvance(st, null); return;
    }

    renderCard(st, 'finding');
    var t0 = Date.now();
    var tick = function () {
      if (!run) return;
      if (!onRoute(st)) { show(); return; }
      var dt = Date.now() - t0;
      var el = resolve(st.target, dt < 2000 ? 0 : dt < 5000 ? 1 : 2);
      if (el === COACH) {
        clearInterval(run.poll); run.poll = null;
        ['spot', 'frame'].forEach(function (k) { if (els[k]) { els[k].remove(); els[k] = null; } });
        renderCard(st, 'ok'); place(null, false); hookAdvance(st, null);
        return;
      }
      if (el) {
        clearInterval(run.poll); run.poll = null;
        run.el = el;
        var isFrame = el.tagName === 'IFRAME';
        renderCard(st, 'ok', isFrame);
        track(isFrame);
        hookAdvance(st, isFrame ? null : el);
      } else if (Date.now() - t0 > (st.timeout || CFG.stepTimeout)) {
        clearInterval(run.poll); run.poll = null;
        emit('anchor_missing', { tour: run.tour.id, step: st.id || run.i, target: st.target });
        renderCard(st, 'missing');
        hookAdvance(st, null);
      }
    };
    run.poll = setInterval(tick, 300);
    tick();
  }

  function watchRouteUntil(st) {
    run.poll = setInterval(function () { if (run && onRoute(st)) { clearInterval(run.poll); run.poll = null; show(); } }, 400);
  }

  function hookAdvance(st, el) {
    var adv = st.advance || 'next';
    if (adv === 'click' && el) {
      var h = function (e) { if (run && run.el && (run.el === e.target || run.el.contains(e.target))) setTimeout(next, 350); };
      document.addEventListener('click', h, true);
      run.clickOff = function () { document.removeEventListener('click', h, true); };
    }
    if (adv && adv.route) {
      var re = new RegExp(adv.route, 'i'), p = setInterval(function () { if (run && re.test(relPath() + location.search)) { clearInterval(p); next(); } }, 400);
      var prev = run.clickOff;
      run.clickOff = function () { clearInterval(p); if (prev) prev(); };
    }
  }

  function next() {
    if (!run) return;
    if (run.i >= run.tour.steps.length - 1) return finish();
    run.i++; show();
  }
  function back() { if (run && run.i > 0) { run.i--; show(); } }
  function finish() {
    var id = run.tour.id;
    var s = load(); s.done = s.done || {}; s.done[id] = Date.now(); save(s);
    emit('tour_complete', { tour: id });
    stop(true);
    toast(run ? '' : 'Nice work. That\'s set up.');
  }

  function toast(msg) {
    var c = document.createElement('div');
    c.className = 'card';
    c.style.cssText = 'right:22px;bottom:80px;width:auto;padding:12px 16px;font-size:13px;color:' + NAVY + ';font-weight:600';
    c.textContent = msg;
    els.layer.appendChild(c);
    setTimeout(function () { c.remove(); }, 3200);
  }

  // spotlight follows the element as the page moves
  function track(isFrame) {
    var key = isFrame ? 'frame' : 'spot';
    ['spot', 'frame'].forEach(function (k) { if (els[k]) { els[k].remove(); els[k] = null; } });
    var d = document.createElement('div');
    d.className = key + (isFrame ? '' : ' pulse');
    els.layer.insertBefore(d, els.layer.firstChild);
    els[key] = d;
    var last = '';
    (function loop() {
      if (!run || !run.el) return;
      if (!run.el.isConnected) { show(); return; }
      var r = run.el.getBoundingClientRect(), pad = isFrame ? 0 : 6;
      var sig = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      if (sig !== last) {
        last = sig;
        d.style.left = (r.left - pad) + 'px'; d.style.top = (r.top - pad) + 'px';
        d.style.width = (r.width + pad * 2) + 'px'; d.style.height = (r.height + pad * 2) + 'px';
        place(r, isFrame);
      }
      run.raf = requestAnimationFrame(loop);
    })();
  }

  function renderCard(st, mode, isFrame) {
    if (!els.card) { els.card = document.createElement('div'); els.card.className = 'card'; els.layer.appendChild(els.card); }
    if (mode !== 'ok') ['spot', 'frame'].forEach(function (k) { if (els[k]) { els[k].remove(); els[k] = null; } });
    var total = run.tour.steps.length, i = run.i, last = i === total - 1;
    var dots = ''; for (var k = 0; k < total; k++) dots += '<i class="' + (k === i ? 'on' : '') + '"></i>';
    var body = '<h4>' + esc(st.title) + '</h4><p>' + md(st.body) + '</p>';
    if (mode === 'away') {
      body = '<h4>' + esc(st.title) + '</h4><p>' + md(st.awayText || 'This happens on a different screen. Tap **Take me there** and we\'ll open it for you.') + '</p>';
    } else if (mode === 'finding') {
      body += '<div class="hint"><span class="wait"></span>Finding it on your screen…</div>';
    } else if (mode === 'missing') {
      body += '<div class="hint warn">Can\'t spot this on your screen. It may have moved slightly. Look for <b>' + esc(st.lookFor || st.title) + '</b>, then press Next.</div>';
    }
    if (st.tip && mode !== 'away') body += '<div class="hint">' + md(st.tip) + '</div>';
    var adv = st.advance || 'next';
    var nextLabel = last ? 'Finish' : 'Next';
    var buttons = (i > 0 ? '<button class="btn" data-a="back">Back</button>' : '');
    if (mode === 'away' && st.go) buttons += '<button class="btn gold" data-a="go">Take me there</button>';
    else if (mode === 'ok' && adv === 'click' && !isFrame) buttons += '<button class="btn" data-a="next">Skip</button>';
    else buttons += '<button class="btn pri" data-a="next">' + nextLabel + '</button>';
    els.card.innerHTML = '<div class="ch"><div><div class="n">Step ' + (i + 1) + ' of ' + total + '</div><div class="tt">' + esc(run.tour.title) + '</div></div><button class="x" title="Exit guide">&times;</button></div>' +
      '<div class="cb">' + body + '</div><div class="cf"><div class="dots">' + dots + '</div>' + buttons + '</div>';
    els.card.querySelector('.x').onclick = function () { stop(); };
    els.card.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-a');
        if (a === 'next') next(); else if (a === 'back') back(); else if (a === 'go') { b.disabled = true; b.innerHTML = '<span class="wait"></span>Opening…'; nav(st.go); }
      };
    });
    if (mode !== 'ok') place(null, false);
  }

  // card placement: beside the target, or docked inside the frame
  function place(r, isFrame) {
    var c = els.card; if (!c) return;
    var W = innerWidth, H = innerHeight, cw = 330, ch = c.offsetHeight || 220, m = 14, x, y;
    if (!r) { x = W - cw - 22; y = H - ch - 84; }
    else if (isFrame) { x = r.left + 18; y = Math.max(r.top + 18, r.bottom - ch - 18); if (y + ch > H - 10) y = H - ch - 10; }
    else if (r.right + m + cw < W) { x = r.right + m + 8; y = r.top + r.height / 2 - ch / 2; }
    else if (r.bottom + m + ch < H) { x = r.left; y = r.bottom + m + 8; }
    else if (r.left - m - cw > 0) { x = r.left - cw - m - 8; y = r.top; }
    else { x = r.left; y = r.top - ch - m - 8; }
    x = Math.max(10, Math.min(x, W - cw - 10)); y = Math.max(10, Math.min(y, H - ch - 10));
    c.style.left = x + 'px'; c.style.top = y + 'px';
  }

  // ---------- boot ----------
  function boot() {
    if (!allowed()) { if (host) { stop(true); host.remove(); host = null; els = {}; } return; }
    mount();
    var s = load();
    if (s.active && !run) start(s.active.id, s.active.i);
  }

  var lastLoc = null;
  var lastPath = null;
  function tick() { if (window.__luubuGen !== GEN) return; if (els.panel && relPath() !== lastPath) { lastPath = relPath(); var inp = els.panel.querySelector('input'); renderList(inp ? inp.value : ''); } var l = locId(); if (l !== lastLoc) { lastLoc = l; boot(); } }
  window.addEventListener('routeChangeEvent', tick);
  setInterval(tick, 1000);
  setInterval(function () { if (window.__luubuGen === GEN && host && host.isConnected && !els.panel) dodge(false); }, 700);
  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === 'h' || e.key === 'H') && allowed()) { var s = load(); s.hidden = false; save(s); mount(); renderFab(); togglePanel(); }
  });
  addEventListener('resize', function () { if (run && !run.el) place(null, false); dodge(true); });

  window.__luubuGuide = { start: start, stop: function () { stop(); }, open: function () { mount(); togglePanel(true); }, resolve: resolve, config: CFG, version: '2.1.0', screen: function () { return hereScreens(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick); else tick();
})();
