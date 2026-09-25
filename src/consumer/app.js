'use strict';

// Gnumbat consumer app -- Radio + Shows + Like/Dislike (spec: no model
// editor, no training UI, no manual model selection -- the app just plays
// whatever the network's current released model/seed is and forwards
// structured feedback). Vanilla JS, no build step, no framework -- matches
// every other UI surface in this repo (src/gui/panel.html, public/tip.html).
//
// Talks to two independent services, per the plan's service-boundary
// design (docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md):
//   - the Node backend (src/backend) for /models, /radio, /feedback
//   - the Go event-crawler's own server for /api/events.json (SHOWS stays
//     with the service that already owns event data end to end)

const CONFIG = {
  BACKEND_URL: (window.GNUMBAT_BACKEND_URL || 'http://localhost:3000'),
  EVENTS_URL: (window.GNUMBAT_EVENTS_URL || 'http://localhost:6969'),
  RADIO_POLL_MS: 8000
};

// ---------- listener identity (no account, no login -- spec §4/5) ----------
// Same no-account posture as src/network/artifacts/votes.js's voterId: a
// stable client-generated id, persisted locally, never tied to a real
// identity.
function getListenerId() {
  const KEY = 'gnumbat_listener_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'listener-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem(KEY, id);
  }
  return id;
}
const LISTENER_ID = getListenerId();

// ---------- tiny fetch helper -- never throws into the UI ----------
async function getJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null; // offline/unreachable -- callers render the honest empty state, never a crash
  }
}
async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// ==========================================================================
// State
// ==========================================================================

const state = {
  view: 'radio',          // 'radio' | 'crkt' | 'shows'
  radio: null,             // last GET /radio/current payload
  lineage: null,            // last GET /models/:hash/lineage payload
  sessionStartMs: null,      // Date.parse(radio.startedAt), for elapsed time
  playing: false,
  events: [],
  eventFilters: { when: '', venue: '', genre: '', q: '' },
  lastFeedback: null          // { hash: 'like'|'dislike' } transient UI pulse
};

// ==========================================================================
// Navigation
// ==========================================================================

const views = {
  radio: document.getElementById('view-radio'),
  crkt: document.getElementById('view-crkt'),
  shows: document.getElementById('view-shows')
};
const floatnav = document.getElementById('floatnav');

function showView(name) {
  state.view = name;
  for (const key of Object.keys(views)) views[key].classList.toggle('hidden', key !== name);
  floatnav.classList.toggle('hidden', name === 'radio');
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.nav === name));
  if (name === 'crkt') renderCrkt();
  if (name === 'shows' && state.events.length === 0) loadEvents();
}

document.querySelectorAll('.tab').forEach((el) => {
  el.addEventListener('click', () => showView(el.dataset.nav));
});
document.getElementById('btn-close').addEventListener('click', () => showView('radio'));
document.getElementById('btn-reload').addEventListener('click', () => showView('crkt'));

// ==========================================================================
// Clock (real date/time -- spec §10)
// ==========================================================================

function tickClock() {
  const now = new Date();
  document.getElementById('clock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('clock-time').textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 15000);

// ==========================================================================
// Radio state (RadioService: GET /radio/current)
// ==========================================================================

const audioEl = document.getElementById('stream-audio');

function fmtElapsed(ms) {
  if (ms == null || ms < 0) return '--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function renderRadio() {
  const r = state.radio;
  const seedline = document.getElementById('np-seedline');
  const fill = document.getElementById('np-fill');

  if (!r || !r.live) {
    seedline.textContent = '-- no model loaded';
    seedline.classList.add('offline');
    fill.style.width = '0%';
    state.sessionStartMs = null;
    return;
  }

  seedline.classList.toggle('offline', !r.model);
  if (r.model) {
    const label = r.model.name || (r.model.hash ? r.model.hash.slice(0, 10) : 'model');
    const seedTag = r.seedHash ? ` · seed ${r.seedHash.slice(0, 8)}` : '';
    seedline.innerHTML = `<span class="live-dot"></span>${label} v${r.model.version || '?'}${seedTag}`;
  } else {
    seedline.textContent = '-- no model loaded';
  }

  // Elapsed = real time since this session started. There is no fixed
  // track length in a live generative radio (spec §3/18 -- this is an
  // ongoing execution of the model, not a playlist), so "remaining" from
  // the mockup is honestly replaced with a LIVE badge rather than a
  // fabricated countdown.
  state.sessionStartMs = r.startedAt ? Date.parse(r.startedAt) : null;
}

function tickElapsed() {
  const elapsedEl = document.getElementById('np-elapsed');
  if (state.sessionStartMs == null) { elapsedEl.textContent = '--:--'; return; }
  elapsedEl.textContent = fmtElapsed(Date.now() - state.sessionStartMs);
}
setInterval(tickElapsed, 1000);

async function pollRadio() {
  const data = await getJSON(`${CONFIG.BACKEND_URL}/radio/current`);
  state.radio = data;
  renderRadio();
}
pollRadio();
setInterval(pollRadio, CONFIG.RADIO_POLL_MS);

// ---- transport ----

document.getElementById('btn-playpause').addEventListener('click', () => {
  const streamUrl = state.radio && state.radio.stream && state.radio.stream.url;
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');

  if (!streamUrl) return; // nothing to play -- radio is honestly offline right now

  if (!state.playing) {
    if (audioEl.src !== streamUrl) audioEl.src = streamUrl;
    audioEl.play().catch(() => {});
    state.playing = true;
  } else {
    audioEl.pause();
    state.playing = false;
  }
  iconPlay.style.display = state.playing ? 'none' : '';
  iconPause.style.display = state.playing ? '' : 'none';
});

// prev/next/reload -- kept visually present per the mockup (spec §9/10),
// but there is currently no API for "skip to a fresh arrangement decision"
// on the instrument side (see docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md
// -- no PyTorch decision model or live-skip endpoint exists yet). Wiring
// these to something fake would misrepresent what the radio is actually
// doing, so they stay inert beyond their own press animation until that
// capability exists.
['btn-prev', 'btn-next'].forEach((id) => {
  document.getElementById(id).addEventListener('click', () => {});
});

// ==========================================================================
// Feedback (Like / Dislike -- spec §4/5/11: fire-and-forget, never blocks
// playback, never opens a dialog, carries full playback context)
// ==========================================================================

function currentPositionMs() {
  if (!audioEl.paused && !isNaN(audioEl.currentTime)) return Math.round(audioEl.currentTime * 1000);
  if (state.sessionStartMs != null) return Date.now() - state.sessionStartMs;
  return null;
}

async function sendFeedback(kind) {
  const r = state.radio;
  const body = {
    listenerId: LISTENER_ID,
    feedback: kind,
    sessionId: r && r.sessionId,
    modelHash: r && r.model && r.model.hash,
    modelVersion: r && r.model && r.model.version,
    seedHash: r && r.seedHash,
    positionMs: currentPositionMs()
  };
  // Optimistic, immediate UI pulse -- never wait on the network before
  // giving feedback (spec §11: "Do not interrupt playback unnecessarily").
  pulseLikeButtons(kind);
  await postJSON(`${CONFIG.BACKEND_URL}/feedback`, body);
}

function pulseLikeButtons(kind) {
  const ids = kind === 'like' ? ['btn-like', 'btn-quicklike'] : ['btn-dislike'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 900);
  });
}

document.getElementById('btn-like').addEventListener('click', () => sendFeedback('like'));
document.getElementById('btn-quicklike').addEventListener('click', () => sendFeedback('like'));
document.getElementById('btn-dislike').addEventListener('click', () => sendFeedback('dislike'));

// ==========================================================================
// CRKT -- read-only seed/branch view (spec §12)
// ==========================================================================

async function renderCrkt() {
  const content = document.getElementById('crkt-content');
  const r = state.radio;

  if (!r || !r.live || !r.model || !r.model.hash) {
    content.innerHTML = `
      <div class="crkt-empties">
        <div class="empty-line">-- no model loaded</div>
        <div class="empty-line">-- no tracks loaded</div>
      </div>`;
    return;
  }

  const tree = await getJSON(`${CONFIG.BACKEND_URL}/models/${r.model.hash}/lineage`);
  state.lineage = tree;

  if (!tree) {
    content.innerHTML = `<div class="crkt-empties"><div class="empty-line">-- lineage unavailable</div></div>`;
    return;
  }

  const rows = [];
  const isCurrent = (node) => node.hash === r.model.hash;

  rows.push(`<div class="seed-row"><span>${escapeHtml(tree.hash.slice(0, 10))} local-${escapeHtml(tree.hash.slice(0, 8))}</span><span>${isCurrent(tree) ? 'CURRENT SEED' : (tree.name ? escapeHtml(tree.name) : '')}</span></div>`);

  function walk(node, prefix, isLast) {
    for (const branch of (node.branches || [])) {
      const idx = node.branches.indexOf(branch);
      const last = idx === node.branches.length - 1;
      const connector = last ? '└─ ' : '├─ ';
      rows.push(`<div class="tree-row"><span class="prefix">${prefix}${connector}</span><span>${escapeHtml(branch.hash.slice(0, 10))} local-${escapeHtml(branch.hash.slice(0, 8))}${isCurrent(branch) ? '  CURRENT SEED' : ''}</span></div>`);
      walk(branch, prefix + (last ? '   ' : '│  '), last);
    }
  }
  walk(tree, '', true);

  content.innerHTML = rows.join('');
}

// ==========================================================================
// SHOWS -- event discovery (spec §13), EventService = the Go crawler's
// own JSON API (GET /api/events.json), not proxied through the Node
// backend.
// ==========================================================================

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function eventsQuery() {
  const p = new URLSearchParams();
  const f = state.eventFilters;
  if (f.when) p.set('when', f.when);
  if (f.venue) p.set('venue', f.venue);
  if (f.genre) p.set('genre', f.genre);
  if (f.q) p.set('q', f.q);
  return p.toString();
}

async function loadEvents() {
  const list = document.getElementById('events-list');
  const meta = document.getElementById('events-meta');
  meta.textContent = 'loading…';

  const data = await getJSON(`${CONFIG.EVENTS_URL}/api/events.json?${eventsQuery()}`);
  if (!data) {
    meta.textContent = '-- events unavailable';
    list.innerHTML = '';
    return;
  }
  state.events = data;
  meta.textContent = `${data.length} event${data.length === 1 ? '' : 's'}`;
  renderEventFilterOptions(data);
  renderEvents(data);
}

function renderEventFilterOptions(events) {
  // Only fills in options the first time real data arrives -- doesn't
  // fight the user's current selection on every reload.
  const genreSel = document.getElementById('f-genre');
  const venueSel = document.getElementById('f-venue');
  if (genreSel.options.length <= 1) {
    const genres = [...new Set(events.flatMap((e) => (e.genre || '').split(',').map((g) => g.trim()).filter(Boolean)))].sort();
    for (const g of genres) genreSel.append(new Option(g, g));
  }
  if (venueSel.options.length <= 1) {
    const venues = [...new Set(events.map((e) => e.venue).filter(Boolean))].sort();
    for (const v of venues) venueSel.append(new Option(v, v));
  }
}

function renderEvents(events) {
  const list = document.getElementById('events-list');
  if (events.length === 0) {
    list.innerHTML = `<div class="empty-line">-- no shows match these filters</div>`;
    return;
  }
  list.innerHTML = events.map(eventCardHtml).join('');
}

function eventCardHtml(e) {
  const artists = (e.name || '').split('+').map((a) => a.trim()).filter(Boolean);
  const chips = artists.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join('');
  const poster = e.event_image
    ? `<img class="poster" src="${escapeHtml(e.event_image)}" alt="" loading="lazy">`
    : '';
  const when = [e.date, e.time].filter(Boolean).join(' · ');
  const price = e.is_free ? 'FREE' : (e.price || '');
  return `
    <div class="event-card">
      ${poster}
      <div class="title">${escapeHtml(e.name)}</div>
      <div class="chips">${chips}</div>
      <div class="venue">${escapeHtml(e.venue)}</div>
      <div class="address">${escapeHtml(e.address)}</div>
      <div class="datetime">${escapeHtml(when)}</div>
      ${price ? `<div class="price">${escapeHtml(price)}</div>` : ''}
      ${e.ticket_url ? `<a class="link" href="${escapeHtml(e.ticket_url)}" target="_blank" rel="noopener">Link to event ↗</a>` : ''}
    </div>`;
}

['f-when', 'f-venue', 'f-genre'].forEach((id) => {
  document.getElementById(id).addEventListener('change', (e) => {
    const key = id.replace('f-', '');
    state.eventFilters[key] = e.target.value;
    loadEvents();
  });
});
let searchDebounce;
document.getElementById('f-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.eventFilters.q = e.target.value;
    loadEvents();
  }, 300);
});
