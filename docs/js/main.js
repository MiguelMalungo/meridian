// MERIDIAN — flight atlas: state, atlas list, destination detail, labels,
// split-flap board and Higgsfield renders.

import { Globe } from './globe.js';
import { CITIES, CITY, guessHome, tzOffsetMinutes } from './cities.js';
import * as G from './geo.js';
import * as S from './services.js';
import { sfx } from './sfx.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const isMobile = () => matchMedia('(max-width: 860px)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const PHASE_LABEL = { confirmed: 'Confirmed', planned: 'Planned', active: 'In transit', completed: 'Logged', home: 'Home' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

const state = {
  home: 'LON',
  trips: [],
  selected: null,
  tab: 'manifest',
  query: '',
  wxAll: {},
  recon: {},          // code → { image?, video? } archived Higgsfield renders
  jobs: {},           // request_id → { cityId, kind, status, startedAt }
  hf: { configured: false, reachable: false },
  cost: {},           // kind → { credits, usd } from Higgsfield /estimate
  confirm: null,      // { code, kind }
  mediaView: {},      // code → 'photo' | 'image' | 'video'
  notes: {},          // code → { text, cls }
  batch: null,        // { queue, done, total, running, stop }
  static: false,      // true when there is no local server (e.g. GitHub Pages)
};

const LOCAL_KEY = 'meridian.state.v1';

// Demo manifest for the static site, dated relative to today.
function demoTrips() {
  const day = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const t = (id, city, start, days, status, note) => ({ id, city, depart: day(start), ret: day(start + days), status, note });
  return [
    t('t1', 'REK', -128, 6, 'confirmed', 'Aurora hunt, Golden Circle'),
    t('t2', 'RAK', -41, 5, 'confirmed', 'Medina and an Atlas day trip'),
    t('t3', 'TYO', 17, 11, 'confirmed', 'Tokyo to Kyoto by rail'),
    t('t4', 'TOS', 45, 5, 'planned', 'Polar night, northern lights'),
    t('t5', 'ZQN', 63, 9, 'planned', 'Milford Sound flyover'),
    t('t6', 'CUZ', 118, 8, 'planned', 'Inca Trail permit pending'),
    t('t7', 'CPT', 171, 7, 'planned', 'Cape Peninsula drive'),
  ];
}

function loadLocalState() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
  } catch {
    return null;
  }
}

let globe = null;
let hovered = null;

// ------------------------------------------------------------------ derived
function trips() {
  const today = G.todayISO();
  return state.trips
    .filter((t) => CITY[t.city])
    .map((t) => ({ ...t, phase: G.tripPhase(t, today) }))
    .sort((a, b) => a.depart.localeCompare(b.depart));
}
const homeCity = () => CITY[state.home] || CITY.LON;

function kindOf(code, list = trips()) {
  if (code === state.home) return 'home';
  const rank = { active: 4, confirmed: 3, planned: 2, completed: 1 };
  let best = null;
  for (const t of list) if (t.city === code && (!best || rank[t.phase] > rank[best])) best = t.phase;
  return best || 'catalog';
}

// Unique manifest destinations in departure order (for "Destination 3 of 7").
function manifestCities(list = trips()) {
  return [...new Set(list.map((t) => t.city).filter((c) => c !== state.home))];
}

function fmtFlight(h) {
  const hh = Math.floor(h);
  return `${hh}h ${pad(Math.round((h - hh) * 60))}m`;
}

// ------------------------------------------------------------------ boot
async function boot() {
  const bar = $('#boot-bar');
  const progress = (p) => { bar.style.width = `${p}%`; };

  try {
    globe = new Globe($('#scene'), { onSelect: (code) => select(code), onHover });
    globe.start();
  } catch (err) {
    console.error(err);
    $('#boot em').textContent = 'This browser could not start WebGL.';
    return;
  }

  const geoP = globe.init().catch((err) => console.error('[meridian] geodata failed', err));
  progress(20);

  // No local server (e.g. GitHub Pages): switch to static mode.
  const st = await S.loadState().catch(() => null);
  if (st) {
    state.trips = st.trips || [];
    state.home = st.home && CITY[st.home] ? st.home : guessHome();
    if (!st.home) persist();
  } else {
    state.static = true;
    const saved = loadLocalState();
    state.trips = Array.isArray(saved?.trips) ? saved.trips : demoTrips();
    state.home = saved?.home && CITY[saved.home] ? saved.home : guessHome();
  }
  progress(40);

  if (!state.static) {
    const [hf, idx] = await Promise.all([S.hfStatus().catch(() => null), S.loadRecon().catch(() => null)]);
    if (hf) state.hf = { configured: hf.configured, reachable: true };
    state.recon = idx?.recon || {};
    for (const [id, j] of Object.entries(idx?.jobs || {})) {
      state.jobs[id] = { cityId: j.cityId, kind: j.kind, status: 'queued', startedAt: Date.parse(j.createdAt) || Date.now() };
    }
  } else {
    // Show any renders that were committed alongside the static site.
    try {
      const res = await fetch('media/index.json', { cache: 'no-cache' });
      if (res.ok) state.recon = (await res.json()).recon || {};
    } catch { /* none published */ }
  }
  progress(60);
  await geoP;
  progress(100);

  buildStaticUi();
  refresh();
  applyView();
  setTimeout(() => {
    $('#boot').classList.add('done');
    globe.reveal();
  }, 250);

  S.weatherAll(CITIES)
    .then((wx) => {
      state.wxAll = wx;
      renderRows();
      updateLabelTexts();
    })
    .catch(() => {});
  if (state.hf.configured) loadCosts();
  Object.keys(state.jobs).forEach(track);

  setInterval(tick1s, 1000);
  tick1s();
  requestAnimationFrame(frame);
}

async function loadCosts() {
  const sample = { prompt: 'Cinematic aerial establishing shot', aspect_ratio: '16:9', resolution: '1080p' };
  try {
    state.cost.image = await S.hfEstimate('image', sample);
  } catch { /* shown on demand */ }
  try {
    state.cost.video = await S.hfEstimate('video', {
      prompt: 'Slow cinematic drone push-in', image_url: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Troms%C3%B8_sentrum_%285835702754%29.jpg', duration: 5, resolution: '720p',
    });
  } catch { /* shown on demand */ }
  renderFoot();
  if (state.selected) renderMediaControls();
}

// ------------------------------------------------------------------ static wiring
function buildStaticUi() {
  const sorted = [...CITIES].sort((a, b) => a.name.localeCompare(b.name));
  $('#home-select').innerHTML = sorted.map((c) => `<option value="${c.code}">${esc(c.name)} · ${c.code}</option>`).join('');
  $('#city-list').innerHTML = sorted.map((c) => `<option value="${esc(cityLabel(c))}"></option>`).join('');
  $('#count-explore').textContent = CITIES.length;

  $('#home-select').addEventListener('change', (e) => {
    state.home = e.target.value;
    persist();
    refresh();
    sfx.commit();
  });
  $('#tab-manifest').addEventListener('click', () => setTab('manifest'));
  $('#tab-explore').addEventListener('click', () => setTab('explore'));
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderRows();
  });
  $('#rows').addEventListener('click', onRowsClick);
  $('#btn-add').addEventListener('click', () => openTripDialog());
  $('#btn-back').addEventListener('click', () => select(null));
  $('#btn-batch').addEventListener('click', onBatchClick);
  $('#f-cancel').addEventListener('click', () => $('#dlg-trip').close());
  $('#form-trip').addEventListener('submit', onTripSubmit);
  $('#d-media').addEventListener('click', onMediaClick);
  $('#d-actions').addEventListener('click', onDetailAction);
  $$('.zoom button').forEach((b) => b.addEventListener('click', () => globe?.nudgeZoom(Number(b.dataset.zoom))));

  const sfxBtn = $('#btn-sfx');
  const syncSfx = () => {
    sfxBtn.textContent = sfx.enabled ? 'Sound on' : 'Sound off';
    sfxBtn.setAttribute('aria-pressed', String(sfx.enabled));
  };
  sfxBtn.addEventListener('click', () => { sfx.set(!sfx.enabled); syncSfx(); });
  syncSfx();

  window.addEventListener('keydown', (e) => {
    if ($('#dlg-trip').open || e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape' && state.selected) select(null);
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && state.selected) step(e.key === 'ArrowRight' ? 1 : -1);
  });
  window.addEventListener('resize', () => {
    applyView();
    if ((isMobile() ? 21 : 30) !== flapLen) {
      buildFlaps();
      updateBoard();
    }
  });

  buildLabels();
  buildFlaps();
}

function setTab(tab) {
  state.tab = tab;
  $('#tab-manifest').setAttribute('aria-selected', String(tab === 'manifest'));
  $('#tab-explore').setAttribute('aria-selected', String(tab === 'explore'));
  $('#search').hidden = tab !== 'explore';
  renderRows();
  renderFoot();
  if (tab === 'explore' && !isMobile()) $('#search').focus();
}

// Globe framing: overview sits right of the atlas list; focus pulls in close.
function applyView() {
  if (!globe) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (isMobile()) {
    const top = $('.masthead').getBoundingClientRect().bottom + window.scrollY;
    const h = $('.stage-spacer').getBoundingClientRect().height;
    globe.setView({ fx: W / 2, fy: top + h / 2, frameW: W, frameH: h, zoom: state.selected ? 0.82 : 1 });
    return;
  }
  const listRight = $('.atlas').getBoundingClientRect().right;
  const frameW = W - listRight - 40;
  const frameH = H - 120;
  if (state.selected) {
    globe.setView({ fx: W * 0.33, fy: H * 0.52, frameW, frameH, zoom: 0.62 });
  } else {
    globe.setView({ fx: listRight + (W - listRight) / 2, fy: H * 0.52, frameW, frameH, zoom: 1 });
  }
}

// ------------------------------------------------------------------ refresh / render
function refresh() {
  const list = trips();
  globe?.setData({ home: state.home, trips: list, cities: CITY });
  $('#home-select').value = state.home;
  $('#home-code').textContent = state.home;
  $('#board-label').textContent = `Next out of ${state.home}`;
  $('#count-manifest').textContent = manifestCities(list).length;
  renderTagline(list);
  renderRows(list);
  renderTotals(list);
  renderFoot();
  updateLabelTexts(list);
  updateBoard(list);
  if (state.selected) renderDetail({ animate: false });
}

function renderTagline() {
  const now = new Date();
  const m = now.getMonth();
  const north = homeCity().lat >= 0;
  const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const flip = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
  const season = north ? seasons[m] : flip[seasons[m]];
  $('#tagline').textContent = `Flight atlas, ${season} departures ${now.getFullYear()}`;
}

function spark(values, w = 300, h = 20) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
}

function renderRows(list = trips()) {
  const rows = $('#rows');
  const home = homeCity();
  if (state.tab === 'manifest') {
    const cities = manifestCities(list);
    const n = cities.length;
    const next = list.find((t) => t.phase !== 'completed');
    $('#atlas-sub').textContent = n
      ? `${NUMBER_WORDS[n] || n} destinations on file${next ? `, next wheels-up ${G.fmtDay(next.depart).toLowerCase()}` : ''}`
      : 'Nothing on file yet';
    $('#atlas-sub').hidden = false;
    if (!list.length) {
      rows.innerHTML = '<li class="empty">No trips yet. Explore the globe, or add one below.</li>';
      return;
    }
    const today = G.todayISO();
    rows.innerHTML = list.map((t, i) => {
      const c = CITY[t.city];
      const wx = state.wxAll[t.city];
      const until = G.daysBetween(today, t.depart);
      let b;
      let s;
      if (t.phase === 'completed') { b = 'Logged'; s = `${G.fmtDay(t.depart)} · ${G.daysBetween(t.depart, t.ret)}d`; }
      else if (t.phase === 'active') { b = 'In transit'; s = `day ${G.daysBetween(t.depart, today) + 1} of ${G.daysBetween(t.depart, t.ret) + 1}`; }
      else { b = G.fmtDay(t.depart); s = until === 1 ? 'tomorrow' : `in ${until} days`; }
      const temp = wx && Number.isFinite(wx.t) ? ` · ${Math.round(wx.t)}°` : '';
      return `<li class="row" data-city="${t.city}" data-id="${esc(t.id)}" data-phase="${t.phase}" aria-current="${t.city === state.selected}"${t.note ? ` title="${esc(t.note)}"` : ''}>
        <button class="row-main" type="button" data-act="select">
          <span class="row-n">${pad(i + 1)}</span>
          <span class="row-name">${esc(c.name)}</span>
          <span class="row-meta"><b>${b}</b><span>${s}${temp}</span></span>
          <svg class="row-spark" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="${spark(wx?.hi)}"/></svg>
        </button>
        <div class="row-tools">
          <button type="button" data-act="edit">Edit</button>
          <button type="button" data-act="delete">Delete</button>
        </div>
      </li>`;
    }).join('');
    return;
  }

  $('#atlas-sub').hidden = true;
  const q = state.query.trim().toLowerCase();
  const matches = CITIES
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q) || c.code.toLowerCase() === q)
    .map((c) => ({ c, d: G.distanceKm(home, c) }))
    .sort((a, b) => a.d - b.d);
  rows.innerHTML = matches.length
    ? matches.map(({ c, d }) => {
      const k = kindOf(c.code, list);
      const wx = state.wxAll[c.code];
      const temp = wx && Number.isFinite(wx.t) ? `${Math.round(wx.t)}°` : '';
      return `<li class="row compact" data-city="${c.code}" ${k !== 'catalog' ? `data-phase="${k === 'home' ? 'active' : k}"` : ''} aria-current="${c.code === state.selected}">
        <button class="row-main" type="button" data-act="select">
          <span class="row-name">${esc(c.name)}</span>
          <span class="row-country">${esc(c.country)} · ${c.code}${k !== 'catalog' ? ` · <em>${PHASE_LABEL[k]}</em>` : ''}</span>
          <span class="row-meta"><b>${temp}</b><span>${d < 1 ? 'home' : `${G.fmtInt(d)} km`}</span></span>
        </button>
      </li>`;
    }).join('')
    : `<li class="empty">Nothing matches “${esc(state.query)}”.</li>`;
}

function renderTotals(list = trips()) {
  const home = homeCity();
  let km = 0;
  const nations = new Set();
  for (const t of list) {
    const c = CITY[t.city];
    km += 2 * G.distanceKm(home, c);
    nations.add(c.country);
  }
  $('#totals').innerHTML = `<b>${list.length}</b> trips · <b>${G.fmtInt(km)}</b> km · <b>${nations.size}</b> countries · <b>${((km * G.CO2_KG_PER_KM) / 1000).toFixed(1)}</b> t CO₂`;
}

function renderFoot() {
  const renders = Object.values(state.recon).filter((r) => r.image).length;
  const batchBtn = $('#btn-batch');
  if (state.batch) {
    const b = state.batch;
    $('#foot-note').textContent = `Rendering ${b.done} of ${b.total}…`;
    batchBtn.hidden = false;
    batchBtn.textContent = 'Stop';
    return;
  }
  if (!state.hf.configured) {
    $('#foot-note').textContent = 'Photos courtesy of Wikipedia';
    batchBtn.hidden = true;
    return;
  }
  const missing = state.tab === 'explore' ? CITIES.filter((c) => !state.recon[c.code]?.image) : manifestCities().filter((c) => !state.recon[c]?.image).map((c) => CITY[c]);
  $('#foot-note').textContent = `${renders} cinematic ${renders === 1 ? 'still' : 'stills'} rendered`;
  const unit = Number(state.cost.image?.usd);
  if (missing.length && Number.isFinite(unit)) {
    batchBtn.hidden = false;
    batchBtn.dataset.armed = '';
    batchBtn.textContent = `Render ${missing.length} · $${(unit * missing.length).toFixed(2)}`;
  } else {
    batchBtn.hidden = true;
  }
}

// ------------------------------------------------------------------ globe labels
const labelEls = new Map();
function buildLabels() {
  const host = $('#labels');
  for (const c of CITIES) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.style.opacity = '0';
    el.innerHTML = `<b>${c.code}</b><span></span>`;
    host.appendChild(el);
    labelEls.set(c.code, el);
  }
  document.fonts?.ready.then(() => labelEls.forEach((el) => { el._w = 0; }));
}

function updateLabelTexts(list = trips()) {
  for (const c of CITIES) {
    const el = labelEls.get(c.code);
    if (!el) continue;
    const k = kindOf(c.code, list);
    const t = list.find((x) => x.city === c.code && x.phase !== 'completed') || list.find((x) => x.city === c.code);
    const wx = state.wxAll[c.code];
    let sub = '';
    if (k === 'home') sub = 'home';
    else if (t && k !== 'completed') sub = G.fmtDay(t.depart);
    else if (wx && Number.isFinite(wx.t)) sub = `${Math.round(wx.t)}°`;
    el.dataset.kind = k;
    el.lastChild.textContent = sub;
    el._w = 0;
  }
}

const PRIORITY = { home: 5, active: 4, confirmed: 3, planned: 2, completed: 1, catalog: 0 };
function placeLabels() {
  const pts = globe.projectMarkers();
  pts.sort((a, b) => (PRIORITY[b.kind] - PRIORITY[a.kind]) || (b.facing - a.facing));
  const blocks = [];
  const block = (sel) => {
    const el = $(sel);
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width && getComputedStyle(el).opacity !== '0') blocks.push({ x1: r.left - 10, y1: r.top - 10, x2: r.right + 10, y2: r.bottom + 10 });
  };
  if (!isMobile()) {
    block('.atlas');
    block('.detail');
    block('.masthead');
  }
  const focus = Boolean(state.selected);
  const budget = isMobile() ? 4 : focus ? 6 : 10;
  let catalogShown = 0;
  for (const p of pts) {
    const el = labelEls.get(p.code);
    if (!el) continue;
    let show = p.visible && p.code !== state.selected && p.code !== hovered;
    if (!el._w) el._w = el.offsetWidth || 60;
    const x = p.x + 11;
    const y = p.y - 7;
    const box = { x1: x - 4, y1: y - 4, x2: x + el._w + 4, y2: y + 18 };
    if (show && p.kind === 'catalog' && catalogShown >= budget) show = false;
    if (show) {
      for (const r of blocks) {
        if (box.x1 < r.x2 && box.x2 > r.x1 && box.y1 < r.y2 && box.y2 > r.y1) { show = false; break; }
      }
    }
    if (show) {
      blocks.push(box);
      if (p.kind === 'catalog') catalogShown += 1;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    el.style.opacity = show ? String(Math.min(1, (p.facing - 0.08) * 4)) : '0';
  }
}

// Per-frame overlays: labels, hover ring, lock-on reticle and leader line.
function frame() {
  requestAnimationFrame(frame);
  if (!globe) return;
  placeLabels();

  const ring = $('#hover-ring');
  const hp = hovered && hovered !== state.selected ? globe.project(hovered) : null;
  if (hp && hp.visible) {
    ring.style.transform = `translate(${hp.x.toFixed(1)}px, ${hp.y.toFixed(1)}px)`;
    ring.classList.add('on');
  } else {
    ring.classList.remove('on');
  }

  const ret = $('#reticle');
  const leader = $('#leader');
  const p = state.selected ? globe.project(state.selected) : null;
  if (!p || !p.visible) {
    ret.classList.remove('on');
    leader.classList.add('off');
    return;
  }
  ret.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)${isMobile() ? ' scale(0.7)' : ''}`;
  ret.classList.add('on');

  const dot = $('#kicker-dot');
  if (isMobile() || !dot || $('#detail').hidden) {
    leader.classList.add('off');
    return;
  }
  const d = dot.getBoundingClientRect();
  const tx = d.left - 8;
  const ty = d.top + d.height / 2;
  const r = 85 * 0.7071;
  const sx = p.x + r;
  const sy = p.y - r;
  if (tx - sx < 40 || ty > sy) {
    leader.classList.add('off');
    return;
  }
  const ex = Math.min(sx + (sy - ty), tx - 30);
  leader.querySelector('path').setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ty.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)}`);
  leader.classList.remove('off');
}

// ------------------------------------------------------------------ split-flap board
const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:';
let flapLen = 0;
function buildFlaps() {
  flapLen = isMobile() ? 21 : 30;
  $('#flaps').innerHTML = Array.from({ length: flapLen }, () => '<span class="flap"> </span>').join('');
}

function setBoard(text, hotFrom = text.length) {
  const cells = $('#flaps').children;
  const target = text.toUpperCase().padEnd(flapLen).slice(0, flapLen);
  $('#flaps').setAttribute('aria-label', text);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const ch = target[i];
    cell.classList.toggle('hot', i >= hotFrom && ch !== ' ');
    if (cell.textContent === ch || cell._busy) {
      cell._want = ch;
      continue;
    }
    cell._busy = true;
    cell._want = ch;
    let steps = reducedMotion ? 0 : 2 + ((i * 7) % 5);
    const flip = () => {
      cell.classList.remove('flip');
      void cell.offsetWidth;
      cell.classList.add('flip');
      if (steps-- > 0) {
        cell.textContent = FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
        setTimeout(flip, 55);
      } else {
        cell.textContent = cell._want;
        cell._busy = false;
      }
    };
    flip();
  }
}

function updateBoard(list = trips()) {
  const next = list.find((t) => t.phase === 'active') || list.find((t) => t.phase === 'confirmed' || t.phase === 'planned');
  if (!next) {
    setBoard('NO DEPARTURES');
    return;
  }
  if (next.phase === 'active') {
    const day = G.daysBetween(next.depart, G.todayISO()) + 1;
    const txt = `${next.city} DAY ${pad(day)}`;
    setBoard(`${txt}  ${flapLen > 24 ? 'IN TRANSIT' : 'AWAY'}`, txt.length + 2);
    return;
  }
  const ms = Math.max(0, G.parseDay(next.depart).getTime() + 9 * 3600000 - Date.now());
  const d = Math.floor(ms / G.DAY_MS);
  const hh = pad(Math.floor((ms % G.DAY_MS) / 3600000));
  const mm = pad(Math.floor((ms % 3600000) / 60000));
  const ss = pad(Math.floor((ms % 60000) / 1000));
  const head = flapLen > 24 ? `${next.city}  ${pad(d)}D ${hh}:${mm}:${ss}  ` : `${next.city} ${pad(d)}D ${hh}:${mm}:${ss} `;
  const status = next.phase === 'confirmed' ? (flapLen > 24 ? 'ON SCHEDULE' : 'SET') : (flapLen > 24 ? 'PLANNED' : 'PLAN');
  setBoard(head + status, head.length);
}

// ------------------------------------------------------------------ clock
let lastDay = G.todayISO();
function tick1s() {
  const now = new Date();
  const sp = globe?.sunPoint;
  if (sp) {
    const f = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
    $('#sun-line').textContent = `Sun over ${f(sp.lat, 'N', 'S')} ${f(sp.lon, 'E', 'W')} · ${now.toISOString().slice(11, 16)} UTC`;
  }
  $('#hf-dot').parentElement.hidden = !state.hf.reachable;
  $('#hf-dot').dataset.state = state.hf.configured ? 'ok' : 'warn';
  $('#hf-dot').parentElement.title = state.hf.configured ? 'Higgsfield linked' : 'Add HF_CREDENTIALS to .env to enable renders';
  updateBoard();
  if (state.selected) updateDetailClock();
  updateJobOverlay();
  if (G.todayISO() !== lastDay) {
    lastDay = G.todayISO();
    refresh();
  }
}

// ------------------------------------------------------------------ selection
function select(code, { fly = true, sound = true } = {}) {
  if (code && !CITY[code]) code = null;
  if (code === state.selected) {
    if (code && fly) globe?.select(code, { fly: true });
    return;
  }
  state.selected = code;
  state.confirm = null;
  globe?.select(code, { fly });
  if (sound) (code ? sfx.lock : sfx.release)();
  document.body.classList.toggle('focus', Boolean(code));
  $$('#rows .row').forEach((li) => li.setAttribute('aria-current', String(li.dataset.city === code)));
  $('#detail').hidden = !code;
  if (code) {
    renderDetail({ animate: true });
    const ret = $('#reticle .ring');
    ret.style.animation = 'none';
    void ret.offsetWidth;
    ret.style.animation = '';
    if (isMobile()) window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    else $('#detail').scrollTop = 0;
  }
  applyView();
}

function step(dir) {
  const list = manifestCities();
  const pool = list.includes(state.selected)
    ? list
    : CITIES.map((c) => ({ c: c.code, d: G.distanceKm(homeCity(), c) })).sort((a, b) => a.d - b.d).map((x) => x.c);
  const i = pool.indexOf(state.selected);
  if (i === -1 || !pool.length) return;
  select(pool[(i + dir + pool.length) % pool.length]);
}

function onHover(code) {
  hovered = code;
  if (!code) return;
  sfx.hover();
  const c = CITY[code];
  const d = G.distanceKm(homeCity(), c);
  const wx = state.wxAll[code];
  const temp = wx && Number.isFinite(wx.t) ? ` · <em>${Math.round(wx.t)}°</em>` : '';
  $('#hover-ring span').innerHTML = `${esc(c.name.toUpperCase())} · ${code === state.home ? 'HOME' : `${G.fmtInt(d)} KM`}${temp}`;
}

// ------------------------------------------------------------------ destination detail
function renderDetail({ animate }) {
  const code = state.selected;
  const c = CITY[code];
  if (!c) return;
  const list = trips();
  const home = homeCity();
  const isHome = code === state.home;
  const detail = $('#detail');
  if (animate) {
    detail.classList.remove('enter');
    void detail.offsetWidth;
    detail.classList.add('enter');
  }

  const mc = manifestCities(list);
  const idx = mc.indexOf(code);
  $('#d-kicker').textContent = isHome
    ? `Home base · ${code} · ${c.country}`
    : idx >= 0
      ? `Destination ${idx + 1} of ${mc.length} · ${code} · ${c.country}`
      : `Explore · ${code} · ${c.country}`;
  const nameEl = $('#d-name');
  nameEl.textContent = c.name;
  nameEl.classList.toggle('long', c.name.length > 9);
  updateDetailClock();

  // Blurb + photo come from Wikipedia; the render (if any) takes precedence.
  $('#d-blurb').textContent = c.hint ? `${c.hint.charAt(0).toUpperCase()}${c.hint.slice(1)}.` : '';
  $('#d-blurb').classList.add('loading');
  state.wiki = null;
  S.wiki(c).then((w) => {
    if (state.selected !== code) return;
    state.wiki = w;
    if (w.extract) $('#d-blurb').textContent = w.extract;
    $('#d-blurb').classList.remove('loading');
    renderFigure();
    renderActions();
  }).catch(() => {
    if (state.selected !== code) return;
    $('#d-blurb').classList.remove('loading');
    renderFigure();
  });
  renderFigure();
  renderMediaControls();

  const dist = G.distanceKm(home, c);
  const brg = G.bearingDeg(home, c);
  $('#d-air').textContent = isHome ? '—' : fmtFlight(G.flightHours(dist));
  $('#d-air-sub').innerHTML = isHome ? 'This is where every route begins' : `Nonstop estimate · <em>${G.fmtInt(dist)} km</em> from ${home.code}<br>Heading ${brg.toFixed(0)}° ${compass(brg)}`;
  const dMin = tzOffsetMinutes(c.tz) - tzOffsetMinutes(home.tz);
  const adapt = Math.round(Math.abs(dMin / 60) * (dMin > 0 ? 1 : 0.67));
  $('#d-offset').textContent = isHome ? '±0h' : G.fmtOffset(dMin).toLowerCase();
  $('#d-offset-sub').innerHTML = isHome || !adapt ? 'Same body clock as home' : `About <em>${adapt} ${adapt === 1 ? 'day' : 'days'}</em> to adjust<br>${dMin > 0 ? 'Flying east: harder on sleep' : 'Flying west: gentler on sleep'}`;

  const cityTrips = list.filter((t) => t.city === code);
  const focusTrip = cityTrips.find((t) => t.phase !== 'completed') || cityTrips[cityTrips.length - 1];
  if (focusTrip) {
    const days = G.daysBetween(focusTrip.depart, focusTrip.ret);
    const until = G.daysBetween(G.todayISO(), focusTrip.depart);
    $('#d-trip-k').textContent = focusTrip.phase === 'completed' ? 'Last visit' : 'Your trip';
    $('#d-trip').textContent = `${G.fmtDay(focusTrip.depart)} → ${G.fmtDay(focusTrip.ret)}`.replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase());
    $('#d-trip-sub').innerHTML = `${days} days · ${PHASE_LABEL[focusTrip.phase].toLowerCase()}${until > 0 ? ` · <em>in ${until} days</em>` : ''}${focusTrip.note ? `<br>${esc(focusTrip.note)}` : ''}`;
  } else {
    $('#d-trip-k').textContent = 'Your trip';
    $('#d-trip').textContent = isHome ? 'Home' : 'Not planned';
    $('#d-trip-sub').textContent = isHome ? `${list.length} trips depart from here` : 'Add it to your manifest below';
  }
  $('#d-fx').textContent = c.cur;
  $('#d-fx-sub').textContent = '';
  S.fxRate(home.cur, c.cur).then((rate) => {
    if (state.selected !== code) return;
    if (home.cur === c.cur) {
      $('#d-fx').textContent = c.cur;
      $('#d-fx-sub').textContent = 'Same currency as home';
    } else if (rate) {
      $('#d-fx').textContent = rate.toLocaleString('en-US', { maximumSignificantDigits: 4 });
      $('#d-fx-sub').textContent = `${c.cur} per ${home.cur} · ECB reference`;
    } else {
      $('#d-fx-sub').textContent = 'No ECB reference rate';
    }
  }).catch(() => { if (state.selected === code) $('#d-fx-sub').textContent = 'Rate feed unavailable'; });

  $('#d-spark').innerHTML = '';
  $('#d-days').innerHTML = '';
  S.weather(c).then((wx) => {
    if (state.selected !== code) return;
    wx._code = code;
    state.wxDetail = wx;
    updateDetailClock();
    renderOutlook(wx);
  }).catch(() => {});
  renderActions();
}

function updateDetailClock() {
  const c = CITY[state.selected];
  if (!c) return;
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: c.tz, weekday: 'short' }).format(now);
  const wx = state.wxDetail && state.wxDetail._code === c.code ? state.wxDetail : null;
  const quick = state.wxAll[c.code];
  let weather = '';
  if (wx) weather = ` · ${Math.round(wx.current.temperature_2m)}° ${S.describeWeather(wx.current.weather_code).toLowerCase()}`;
  else if (quick && Number.isFinite(quick.t)) weather = ` · ${Math.round(quick.t)}° ${S.describeWeather(quick.w).toLowerCase()}`;
  const coord = `${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? 'N' : 'S'} ${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? 'E' : 'W'}`;
  $('#d-line').innerHTML = `${coord} · Local <em>${day} ${G.timeIn(c.tz, now)}</em>${weather}`;
  $('#reticle-coord').textContent = coord;
}

function renderOutlook(wx) {
  const hi = wx.daily.temperature_2m_max;
  const lo = wx.daily.temperature_2m_min;
  const top = Math.max(...hi) + 1.5;
  const bot = Math.min(...lo) - 1.5;
  const W = 300;
  const H = 70;
  const px = (i) => (i / (hi.length - 1)) * W;
  const py = (v) => H - ((v - bot) / (top - bot)) * (H - 8) - 4;
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const band = `${path(hi)} ${lo.map((_, i) => { const j = lo.length - 1 - i; return `L${px(j).toFixed(1)} ${py(lo[j]).toFixed(1)}`; }).join(' ')} Z`;
  $('#d-spark').innerHTML = `<path class="band" d="${band}"/><path class="hi" d="${path(hi)}"/><path class="lo" d="${path(lo)}"/>`;
  $('#d-days').innerHTML = wx.daily.time.map((d, i) => {
    const day = new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
    return `<span><b>${day}</b>${Math.round(hi[i])}° / ${Math.round(lo[i])}°</span>`;
  }).join('');
}

function renderActions() {
  const code = state.selected;
  if (!code) return;
  const inManifest = state.trips.some((t) => t.city === code);
  const acts = [];
  if (code !== state.home) {
    acts.push(inManifest
      ? '<button class="link-btn" type="button" data-act="edit">Edit trip</button>'
      : '<button class="link-btn gold" type="button" data-act="add">+ Add to manifest</button>');
  }
  if (state.wiki?.url) acts.push(`<a class="link-btn quiet" href="${esc(state.wiki.url)}" target="_blank" rel="noopener">Wikipedia ↗</a>`);
  acts.push('<button class="link-btn quiet" type="button" data-act="back">← Back to atlas</button>');
  $('#d-actions').innerHTML = acts.join('');
}

function onDetailAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const code = state.selected;
  if (b.dataset.act === 'back') select(null);
  if (b.dataset.act === 'add') openTripDialog(null, code);
  if (b.dataset.act === 'edit') {
    const t = trips().find((x) => x.city === code && x.phase !== 'completed') || state.trips.find((x) => x.city === code);
    if (t) openTripDialog(state.trips.find((x) => x.id === t.id));
  }
}

// ------------------------------------------------------------------ figure: photo / render / flyover
const imagePrompt = (c) => `Cinematic aerial establishing shot of ${c.name}, ${c.country}${c.hint ? `: ${c.hint}` : ''}. Blue-hour light with warm city lights, volumetric atmosphere, crisp detail, sweeping wide-angle composition, travel documentary photography, subtle 35mm film grain, no text.`;
const videoPrompt = (c) => `Slow cinematic drone push-in over ${c.name}, ${c.country}. Smooth forward motion with gentle parallax, drifting clouds, shimmering lights, natural physics, no text or logos.`;
const jobFor = (code) => Object.entries(state.jobs).find(([, j]) => j.cityId === code);
const renderFresh = (entry) => entry && Date.now() - Date.parse(entry.createdAt) < 6.5 * G.DAY_MS;

function currentView(code) {
  const r = state.recon[code] || {};
  const v = state.mediaView[code];
  if (v === 'video' && r.video) return 'video';
  if (v === 'image' && r.image) return 'image';
  if (v === 'photo') return 'photo';
  return r.video ? 'video' : r.image ? 'image' : 'photo';
}

function renderFigure() {
  const code = state.selected;
  const c = CITY[code];
  const r = state.recon[code] || {};
  const fig = $('#d-figure');
  const img = $('#d-img');
  const vid = $('#d-video');
  const view = currentView(code);
  const w = state.wiki;
  let src = null;
  let caption = '';
  let credit = '';
  if (view === 'video') {
    src = r.video.file;
    caption = c.hint.split(/,| and /)[0];
    credit = 'Flyover · Higgsfield Kling';
  } else if (view === 'image') {
    src = r.image.file;
    caption = c.hint.split(/,| and /)[0];
    credit = 'Rendered · Higgsfield Soul';
  } else if (w?.image) {
    src = w.image;
    caption = w.description || `${c.name}, ${c.country}`;
    credit = 'Photo · Wikimedia Commons';
  }
  $('#d-caption').textContent = caption;
  $('#d-credit').textContent = credit;

  if (view === 'video') {
    img.classList.remove('ready');
    if (vid.getAttribute('src') !== src) {
      vid.classList.remove('ready');
      vid.src = src;
      vid.onloadeddata = () => { vid.classList.add('ready'); fig.dataset.state = 'ready'; };
    }
    vid.play().catch(() => {});
    return;
  }
  vid.pause();
  vid.classList.remove('ready');
  if (!src) {
    img.classList.remove('ready');
    fig.dataset.state = w === null ? 'loading' : 'ready';
    return;
  }
  if (img.getAttribute('src') !== src) {
    img.classList.remove('ready');
    fig.dataset.state = 'loading';
    img.onload = () => {
      if (img.getAttribute('src') !== src) return;
      img.classList.add('ready');
      fig.dataset.state = 'ready';
    };
    img.onerror = () => { fig.dataset.state = 'ready'; };
    img.alt = `${view === 'photo' ? 'Photo' : 'Rendered view'} of ${c.name}`;
    img.src = src;
  } else if (img.complete) {
    img.classList.add('ready');
    fig.dataset.state = 'ready';
  }
}

function costLabel(kind) {
  const usd = Number(state.cost[kind]?.usd);
  return Number.isFinite(usd) ? ` · $${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}` : '';
}

function renderMediaControls() {
  const code = state.selected;
  if (!code) return;
  const c = CITY[code];
  const r = state.recon[code] || {};
  const job = jobFor(code);
  const view = currentView(code);
  const parts = [];
  const opts = [['photo', 'Photo']];
  if (r.image) opts.push(['image', 'Render']);
  if (r.video) opts.push(['video', 'Flyover']);
  if (opts.length > 1) {
    parts.push(`<span class="seg">${opts.map(([v, l]) => `<button type="button" data-media="view:${v}" aria-pressed="${view === v}">${l}</button>`).join('')}</span>`);
  } else {
    parts.push('<span class="seg"></span>');
  }

  const rendering = $('#d-rendering');
  if (job) {
    rendering.hidden = false;
    rendering.innerHTML = `<em>Rendering ${job[1].kind === 'video' ? 'a flyover' : 'a still'} of ${esc(c.name)}</em><span id="job-clock"></span>`;
    if (job[1].status === 'queued') parts.push('<button class="link-btn quiet" type="button" data-media="cancel">Cancel</button>');
  } else {
    rendering.hidden = true;
    if (!state.hf.configured) {
      parts.push('');
    } else if (state.confirm?.code === code) {
      const kind = state.confirm.kind;
      const est = state.cost[kind];
      parts.push(`<div class="confirm"><span class="grow">${kind === 'video' ? 'Render a 5-second flyover' : 'Render a cinematic still'} of ${esc(c.name)} for <b>$${est?.usd ?? '?'}</b> (${est ? Number(est.credits) : '?'} credits)?</span>
        <button class="link-btn gold" type="button" data-media="go">Confirm</button>
        <button class="link-btn quiet" type="button" data-media="no">Cancel</button></div>`);
    } else {
      parts.push(`<button class="link-btn" type="button" data-media="ask:image">${r.image ? 'Re-render still' : 'Render cinematic still'}${costLabel('image')}</button>`);
      if (r.image && renderFresh(r.image)) {
        parts.push(`<button class="link-btn quiet" type="button" data-media="ask:video">${r.video ? 'Re-render flyover' : '5s flyover'}${costLabel('video')}</button>`);
      }
    }
  }
  const note = state.notes[code];
  if (note) parts.push(`<span class="d-note ${note.cls || ''}">${esc(note.text)}</span>`);
  $('#d-media').innerHTML = parts.join('');
  updateJobOverlay();
}

function setNote(code, text, cls = '') {
  if (text) state.notes[code] = { text, cls };
  else delete state.notes[code];
  if (state.selected === code) renderMediaControls();
}

function updateJobOverlay() {
  const job = state.selected && jobFor(state.selected);
  const el = $('#job-clock');
  if (!job || !el) return;
  const secs = Math.floor((Date.now() - job[1].startedAt) / 1000);
  el.textContent = `${job[1].status.replace('_', ' ')} · ${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
}

async function onMediaClick(e) {
  const b = e.target.closest('[data-media]');
  if (!b || !state.selected) return;
  const code = state.selected;
  const [act, arg] = b.dataset.media.split(':');
  if (act === 'view') {
    state.mediaView[code] = arg;
    renderFigure();
    renderMediaControls();
  } else if (act === 'ask') {
    if (!state.cost[arg]) {
      try {
        state.cost[arg] = await S.hfEstimate(arg, buildInput(arg, code));
      } catch (err) {
        return setNote(code, errText(err), 'err');
      }
    }
    state.confirm = { code, kind: arg };
    setNote(code, '');
  } else if (act === 'no') {
    state.confirm = null;
    renderMediaControls();
  } else if (act === 'go') {
    const kind = state.confirm?.kind;
    state.confirm = null;
    if (kind) generate(kind, code);
  } else if (act === 'cancel') {
    const job = jobFor(code);
    if (!job) return;
    try {
      await S.hfCancel(job[0]);
      delete state.jobs[job[0]];
      setNote(code, 'Cancelled before it started. Credits refunded.');
    } catch (err) {
      setNote(code, errText(err), 'err');
    }
  }
}

function buildInput(kind, code) {
  const c = CITY[code];
  if (kind === 'video') {
    return { prompt: videoPrompt(c), image_url: state.recon[code]?.image?.remoteUrl, duration: 5, resolution: '720p' };
  }
  return { prompt: imagePrompt(c), aspect_ratio: '16:9', resolution: '1080p' };
}

async function generate(kind, code) {
  try {
    const res = await S.hfGenerate(kind, code, buildInput(kind, code));
    state.jobs[res.request_id] = { cityId: code, kind, status: res.status || 'queued', startedAt: Date.now() };
    setNote(code, '');
    sfx.commit();
    if (state.selected === code) renderMediaControls();
    return track(res.request_id);
  } catch (err) {
    setNote(code, errText(err), 'err');
    sfx.error();
    return null;
  }
}

async function track(id) {
  const job = state.jobs[id];
  if (!job) return null;
  let last = job.status;
  let result = null;
  try {
    const res = await S.pollRequest(id, (r) => {
      if (r.status && r.status !== 'retrying') job.status = r.status;
      if (job.status !== last) {
        last = job.status;
        if (state.selected === job.cityId) renderMediaControls();
      }
    });
    result = res.status;
    delete state.jobs[id];
    if (res.status === 'completed' && res.entry) {
      state.recon[job.cityId] ??= {};
      state.recon[job.cityId][job.kind] = res.entry;
      state.mediaView[job.cityId] = job.kind;
      setNote(job.cityId, `${job.kind === 'video' ? 'Flyover' : 'Still'} saved to docs/${res.entry.file}`, 'ok');
      if (!state.batch) sfx.done();
    } else if (res.status === 'nsfw') {
      setNote(job.cityId, 'Blocked by content moderation. Not charged.', 'err');
    } else if (res.status !== 'completed') {
      setNote(job.cityId, `Render ${res.status}. Not charged.`, 'err');
    }
  } catch (err) {
    delete state.jobs[id];
    setNote(job.cityId, errText(err), 'err');
  }
  if (state.selected === job.cityId) {
    renderFigure();
    renderMediaControls();
  }
  renderFoot();
  return result;
}

function errText(err) {
  const msg = err?.message || String(err);
  if (err?.status === 503 && /not configured/i.test(msg)) return 'Higgsfield is not connected. Add HF_CREDENTIALS to .env and restart.';
  if (err?.status === 401 || /invalid credentials/i.test(msg)) return 'Higgsfield rejected the key (401). Check HF_CREDENTIALS in .env.';
  if (err?.status === 402 || /insufficient|balance|not_enough_credits/i.test(msg)) return 'Your Higgsfield API balance is empty. Top up at console.higgsfield.ai (a saved card alone adds no credits). Nothing was charged.';
  if (/concurrent/i.test(msg)) return 'Too many renders at once. Try again in a moment.';
  return msg;
}

// Batch-render stills for every destination still showing a stock photo.
async function onBatchClick() {
  const btn = $('#btn-batch');
  if (state.batch) {
    state.batch.stop = true;
    btn.textContent = 'Stopping…';
    return;
  }
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    const label = btn.textContent;
    btn.textContent = `Confirm ${label.replace('Render ', '')}?`;
    btn.classList.add('gold');
    setTimeout(() => {
      if (btn.dataset.armed && !state.batch) {
        btn.dataset.armed = '';
        btn.classList.remove('gold');
        renderFoot();
      }
    }, 4000);
    return;
  }
  btn.classList.remove('gold');
  const pool = state.tab === 'explore' ? CITIES.map((c) => c.code) : manifestCities();
  const queue = pool.filter((code) => !state.recon[code]?.image && !jobFor(code));
  state.batch = { queue, done: 0, total: queue.length, stop: false };
  renderFoot();
  const worker = async () => {
    while (state.batch && !state.batch.stop && state.batch.queue.length) {
      const code = state.batch.queue.shift();
      await generate('image', code);
      state.batch.done += 1;
      renderFoot();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  state.batch = null;
  sfx.done();
  renderFoot();
}

// ------------------------------------------------------------------ trips CRUD
let editingId = null;
const cityLabel = (c) => `${c.code} — ${c.name}, ${c.country}`;

function resolveCity(v) {
  const s = v.trim();
  const m = s.match(/^([a-z]{3})\b/i);
  if (m && CITY[m[1].toUpperCase()]) return m[1].toUpperCase();
  const lower = s.toLowerCase();
  const hit = CITIES.find((c) => c.name.toLowerCase() === lower) || CITIES.find((c) => c.name.toLowerCase().startsWith(lower));
  return lower && hit ? hit.code : null;
}

function addDays(iso, n) {
  const d = G.parseDay(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openTripDialog(trip = null, presetCity = null) {
  editingId = trip?.id || null;
  const today = G.todayISO();
  const cityCode = trip?.city || presetCity;
  $('#dlg-kicker').textContent = trip ? 'Edit trip' : 'New trip';
  $('#dlg-title').textContent = cityCode ? CITY[cityCode].name : 'Where to?';
  $('#f-city').value = cityCode ? cityLabel(CITY[cityCode]) : '';
  $('#f-depart').value = trip?.depart || addDays(today, 30);
  $('#f-ret').value = trip?.ret || addDays(today, 37);
  $('#f-status').value = trip?.status || 'planned';
  $('#f-note').value = trip?.note || '';
  $('#f-error').textContent = '';
  $('#dlg-trip').showModal();
  (cityCode ? $('#f-depart') : $('#f-city')).focus();
}

function onTripSubmit(e) {
  e.preventDefault();
  const code = resolveCity($('#f-city').value);
  const depart = $('#f-depart').value;
  const ret = $('#f-ret').value;
  const err = $('#f-error');
  if (!code) { err.textContent = 'Pick a destination from the list.'; sfx.error(); return; }
  if (!depart || !ret) { err.textContent = 'Both dates are needed.'; sfx.error(); return; }
  if (ret < depart) { err.textContent = 'Return has to be on or after departure.'; sfx.error(); return; }
  const entry = { city: code, depart, ret, status: $('#f-status').value, note: $('#f-note').value.trim().slice(0, 140) };
  if (editingId) {
    const t = state.trips.find((x) => x.id === editingId);
    if (t) Object.assign(t, entry);
  } else {
    state.trips.push({ id: `t${Date.now().toString(36)}`, ...entry });
  }
  $('#dlg-trip').close();
  persist();
  refresh();
  sfx.commit();
  if (state.selected !== code) select(code);
  else renderDetail({ animate: false });
}

function onRowsClick(e) {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('.row');
  if (!btn || !li) return;
  const act = btn.dataset.act;
  if (act === 'select') return select(li.dataset.city);
  const trip = state.trips.find((t) => t.id === li.dataset.id);
  if (!trip) return;
  if (act === 'edit') openTripDialog(trip);
  if (act === 'delete') {
    if (btn.classList.contains('armed')) {
      state.trips = state.trips.filter((t) => t.id !== trip.id);
      persist();
      refresh();
      sfx.release();
    } else {
      btn.classList.add('armed');
      btn.textContent = 'Sure?';
      setTimeout(() => {
        btn.classList.remove('armed');
        btn.textContent = 'Delete';
      }, 2600);
    }
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (state.static) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ home: state.home, trips: state.trips }));
      } catch { /* private mode: changes last for this visit only */ }
      return;
    }
    try {
      await S.saveState({ home: state.home, trips: state.trips });
    } catch (err) {
      console.warn('[meridian] save failed', err);
    }
  }, 250);
}

boot();
