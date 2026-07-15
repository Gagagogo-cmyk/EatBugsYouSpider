// SDJ — Terminal UI
// run:  node sdj-tui.js
// deps: npm install blessed ws

const blessed   = require('blessed');
const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { spawn, exec } = require('child_process');
const dgram      = require('dgram');
const sessionMgr = require('./session_manager');

// ── ACTIVE SESSION DATA ROOT ─────────────────────────────────────────────────
// This module (app.js) is only ever require()'d AFTER sdj-tui.js's login
// screen has already resolved and written data/current_session.txt — so this
// single read, done once at load time, is enough to scope every data path
// below to the logged-in session. See session_manager.js's header comment
// for the full multi-session design.
const DATA_DIR = sessionMgr.getActiveSessionDataDir();
const ACTIVE_SESSION = sessionMgr.getSession(sessionMgr.getActiveSessionId());

// ── UTILS ─────────────────────────────────────────────────────────────────────

function randCurse() {
  var chars = '@#$%!&*^~';
  var len   = 3 + Math.floor(Math.random() * 3); // 3–5 chars + trailing ?
  var out   = '';
  for (var i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out + '?';
}

// ── SKIN ──────────────────────────────────────────────────────────────────────
// This is the only thing users need to change to create a custom skin.
// Copy this block into a skin file and require() it, or edit in place.

const SKIN = {
  bg:         'default',    // terminal background (matches your terminal theme)
  fg:         'white',      // all text
  dim_fg:     'color7',     // medium white (between grey labels and bright bar fills)
  user_fg:    'magenta',    // user input lines only
  bar_full:   '█',     // █  filled block
  bar_empty:  ' ',          // empty portion of bar
  border:     'line',       // 'line' | 'none'
  border_fg:  'white',
};

// ── CONFIG ────────────────────────────────────────────────────────────────────

const CONFIG = {
  ws_host:      'localhost',    // Max/MSP WebSocket host
  ws_port:      8080,           // Max/MSP WebSocket port
  ollama_host:  'localhost',
  ollama_port:  11434,
  ollama_model: 'llama3.1:latest',
  reconnect_ms: 3000,
};

// ── STATE ─────────────────────────────────────────────────────────────────────

const state = {
  track:    'no track loaded',
  bpm:      0,
  globalBPM: 120,
  key:      '?',
  slices:   [0, 0, 0, 0],
  running:  false,
  connected: false,
  lufs:     null,   // mix loudness LUFS  (null = no signal yet)
  dbfs:     null,   // mix true-peak dBFS
  lufsPeak: null,   // running session max of state.lufs — DAW-style peak-hold, cleared by :resetPeaks
  dbfsPeak: null,   // running session max of state.dbfs (true peak) — same peak-hold behavior
  stems: {
    vocals: { id: '--', pos: 0.0, C: 0, S: 0, E: 0, F: 0, P: 0, H: 0, T: 0, tC: null, tE: null, tF: null, tP: null, tH: null, tT: null, durMs: 0, timeMs: 0, lastPosTime: Date.now(), bars: 32, stay: 0.0, genre: '', genreConf: 0, track: '', weight: 1.0, pinnedSource: null },
    melody: { id: '--', pos: 0.0, C: 0, S: 0, E: 0, F: 0, P: 0, H: 0, T: 0, tC: null, tE: null, tF: null, tP: null, tH: null, tT: null, durMs: 0, timeMs: 0, lastPosTime: Date.now(), bars: 32, stay: 0.0, genre: '', genreConf: 0, track: '', weight: 1.0, pinnedSource: null },
    bass:   { id: '--', pos: 0.0, C: 0, S: 0, E: 0, F: 0, P: 0, H: 0, T: 0, tC: null, tE: null, tF: null, tP: null, tH: null, tT: null, durMs: 0, timeMs: 0, lastPosTime: Date.now(), bars: 32, stay: 0.0, genre: '', genreConf: 0, track: '', weight: 1.0, pinnedSource: null },
    drums:  { id: '--', pos: 0.0, C: 0, S: 0, E: 0, F: 0, P: 0, H: 0, T: 0, tC: null, tE: null, tF: null, tP: null, tH: null, tT: null, durMs: 0, timeMs: 0, lastPosTime: Date.now(), bars: 32, stay: 0.0, genre: '', genreConf: 0, track: '', weight: 1.0, pinnedSource: null },
  },
  beats: { meter: 0, bpm: 0, conf: 0.0 },
  // Status-icon row (header) — tipping session, recording, and a live readout
  // of the last performative param touched (what LINK's missile switch would
  // fire right now).
  session:   { active: false, sessionId: null, deck: null },
  recording: false,
  lastCommandTouched: null,
  // Timestamp of the most recent LINK missile fire (local OR a remote deck —
  // ws_server.js broadcasts 'linkMissile'/'fire_executed' to everyone
  // whenever a fire actually applies, not just to whoever sent it). 0 means
  // never fired this session. Drives a brief flash in the header icon row;
  // the existing 100ms render tick (see bottom of file) fades it back out
  // without needing its own timer.
  linkFiredAt: 0,
  params: {
    quant: true, envelope: 'hann',
    matchProb: 0.9,   // single global (collapsed from per-descriptor)
    entropy:   0.0,   // macro 0=order 1=chaos
    matchC: 0.0, matchS: 0.0, matchE: 0.0, matchF: 0.0, matchP: 0.0, matchH: 0.0, matchT: 0.0, matchD: 0.0,
    dirC:   0.0, dirS:   0.0, dirE:   0.0, dirF:   0.0, dirP:   0.0, dirH:   0.0, dirT:   0.0, dirD:   0.0,
    // M columns (Centroid) shown in the header — default them so the display
    // reads " 0.0"/"+0.0" (aligned, with sign) before the first engine update,
    // instead of an undefined that fmtDir renders as a short, sign-less "0.0".
    matchM: 0.0, dirM: 0.0,
    // Per-descriptor weights (:setWeight <stem|all> C|S|E|F|P|H|T 0–5). Shown in
    // the header above match/dir with the same M/E/F/P/H/T structure. Default
    // 1.0 = neutral. These flat fields are legacy/unused now that weight/
    // match/dir are genuinely per-stem — see state.paramsPerStem below and
    // :wmdScope. Left in place only so anything still reading state.params.*
    // directly doesn't break; the header itself now reads paramsPerStem.
    weightM: 1.0, weightE: 1.0, weightF: 1.0, weightP: 1.0, weightH: 1.0, weightT: 1.0,
  },
  // Real per-stem weight/match/dir values — backs the header's weight/match/dir
  // rows once :wmdScope switches away from 'all'. All four stems start
  // identical (matching slicer.js's own per-stem defaults) and only diverge
  // once the user targets a specific stem with :setWeight/:setMatchProb/
  // :setDirPref/:setDirWeight instead of 'all'. Dimension keys use the real
  // letters (C/S/E/F/P/H/T) — no more the confusing weightM-means-C rename
  // the old flat state.params fields used; "M:" is now purely a header LABEL,
  // not a variable name.
  wmdScope: 'all',   // 'all' | 'vocals' | 'melody' | 'bass' | 'drums'
  paramsPerStem: (() => {
    const mk = () => ({
      weightC: 1.0, weightS: 0.8, weightE: 2.0, weightF: 0.5, weightP: 1.5, weightH: 1.0, weightT: 1.5,
      dirC: 0.0, dirS: 0.0, dirE: 0.0, dirF: 0.0, dirP: 0.0, dirH: 0.0, dirT: 0.0,
      matchProb: 0.9,
      dirWeight: 1.0,
    });
    return { vocals: mk(), melody: mk(), bass: mk(), drums: mk() };
  })(),
  gain: { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 },
  mute: { vocals: 0,   melody: 0,   bass: 0,   drums: 0   },
  triggerMode:  { vocals: false, melody: false, bass: false, drums: false },
  triggerReady: { vocals: false, melody: false, bass: false, drums: false },
  masterGain: 1.0,
  agentName: 'Cricket',  // localized — updates on language select
  mmtWindow: 4,          // momentum window size in bars (used by add_tension.py)
  log: [],
  followGraph: {         // followGraph[from][to] = weight 0–1
    vocals: {}, melody: {}, bass: {}, drums: {},
  },
  // Per-stem 2D spatial position — vocals/melody/bass/drums driven by
  // :joystick <stem> <x> <y>; master driven by :masterJoystick <x> <y>, or
  // by :joystick <x> <y> with the stem omitted (see the WS handler comment
  // near 'joystick' below). x: -1 full left .. +1 full
  // right. y: -1 full rear .. +1 full front. y:0 = spread evenly across all
  // four speakers. Default y is 1 (full front) here to match ms_router.js's
  // real boot default — front stereo pair only, not quad-spread — so the
  // TUI's initial display matches what the patch actually does at boot
  // before any real command is sent. `width` (M/S stereo width, :width
  // <stem> <0-1>) is pan-independent for every stem, including master —
  // master has no live :width source at all, so it just sits at the default
  // until a real signal exists to wire up. It must NOT be derived from x/y
  // — that coupling was a real bug (panning drained the ring toward empty).
  // Default is 0.5, matching ms_router.js's actual real default
  // (`state.width: { vocals: 0.5, melody: 0.5, bass: 0.5, drums: 0.5 }`) —
  // this was previously 1 here, which meant the TUI's initial readout
  // didn't match what the engine was actually doing until the first real
  // width broadcast arrived.
  spatial: {
    vocals: { x: 0, y: 1, width: 0.5 }, melody: { x: 0, y: 1, width: 0.5 },
    bass:   { x: 0, y: 1, width: 0.5 }, drums:  { x: 0, y: 1, width: 0.5 },
    master: { x: 0, y: 1, width: 0.5 },
  },
  // sourceLock[follower] = leaderStem | null — mirrors slicer.js's sourceLock.
  // Default matches slicer.js's default (vocals, bass, AND drums all locked
  // to melody out of the box) so the TUI shows the right state even before
  // the first WS message confirming it arrives (slicer.js re-announces it at
  // :start regardless).
  sourceLock: { vocals: 'melody', melody: null, bass: 'melody', drums: 'melody' },
  // playFullFile[stem] — mirrors slicer.js's PLAY_FULL_FILE. Default true for
  // every stem (whole-file mode is the out-of-the-box behavior). Any stem
  // going false means that stem is bar-chunked — either via an explicit
  // :chunkMode <stem> 1, or implicitly because :setSegmentBars was
  // used (which always clears it — see slicer.js's setSegmentBars()). Drives
  // the [CHUNK MODE ON/OFF] header indicator: ON if ANY stem is chunked, so a
  // partial (single-stem) switch into chunked slicing is still surfaced.
  playFullFile: { vocals: true, melody: true, bass: true, drums: true },
};

// ── GENRE DB ──────────────────────────────────────────────────────────────────
let genreDb = {};
const GENRE_DB_PATH = path.join(DATA_DIR, 'genres.json');
try {
  genreDb = JSON.parse(fs.readFileSync(GENRE_DB_PATH, 'utf8'));
} catch (_) {}

// Pre-populate genre at startup with DREPTO (the default loaded track).
// Prefer a key containing 'DREPTO'; fall back to the first key in the DB.
{
  const drKey = Object.keys(genreDb).find(k => k.toUpperCase().includes('DREPTO'))
              || Object.keys(genreDb)[0];
  if (drKey && genreDb[drKey] && genreDb[drKey].genres && genreDb[drKey].genres.length) {
    const g = genreDb[drKey].genres[0].genre;
    const c = genreDb[drKey].genres[0].confidence || 0;
    Object.keys(state.stems).forEach(n => { state.stems[n].genre = g; state.stems[n].genreConf = c; });
  }
}

// ── ANALYSIS LIBRARY (slice counts for :nextTrack) ────────────────────────────
const LIBRARY_PATH = path.join(DATA_DIR, 'analysis_library.json');
function getSliceCountsForTrack(trackName) {
  // Returns { vocals, melody, bass, drums } slice counts from analysis_library.json.
  // Keys in library are like "TrackName_vocals.wav" → { vocals: { slices: {...} } }
  try {
    const lib = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    const stems = { vocals: 0, melody: 0, bass: 0, drums: 0 };
    const SUFFIXES = { vocals: '_vocals.wav', melody: '_other.wav', bass: '_bass.wav', drums: '_drums.wav' };
    for (const [fileKey, stemObj] of Object.entries(lib)) {
      const lk = fileKey.toLowerCase();
      for (const [stem, suffix] of Object.entries(SUFFIXES)) {
        if (lk.endsWith(suffix) && fileKey.startsWith(trackName)) {
          const data = Object.values(stemObj)[0];  // { slices: {...}, metadata: {...} }
          stems[stem] = data && data.slices ? Object.keys(data.slices).length : 0;
        }
      }
    }
    return stems;
  } catch (_) {
    return { vocals: 0, melody: 0, bass: 0, drums: 0 };
  }
}

// Average slice E (LUFS) per stem for a given track — used in :nextTrack display
function getSliceLufsForTrack(trackName) {
  try {
    const lib = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    const result  = { vocals: null, melody: null, bass: null, drums: null };
    const SUFFIXES = { vocals: '_vocals.wav', melody: '_other.wav', bass: '_bass.wav', drums: '_drums.wav' };
    for (const [fileKey, stemObj] of Object.entries(lib)) {
      const lk = fileKey.toLowerCase();
      for (const [stem, suffix] of Object.entries(SUFFIXES)) {
        if (lk.endsWith(suffix) && fileKey.startsWith(trackName)) {
          const data = Object.values(stemObj)[0];
          if (data && data.slices) {
            const Es = Object.values(data.slices).map(s => parseFloat(s.E)).filter(v => isFinite(v));
            if (Es.length > 0) result[stem] = Es.reduce((a, b) => a + b, 0) / Es.length;
          }
        }
      }
    }
    return result;
  } catch (_) { return null; }
}

// ── BEATS DB ──────────────────────────────────────────────────────────────────
let beatsDb = {};
const BEATS_DB_PATH = path.join(DATA_DIR, 'downbeats.json');

function reloadBeatsDb() {
  try {
    beatsDb = JSON.parse(fs.readFileSync(BEATS_DB_PATH, 'utf8'));
  } catch (_) { beatsDb = {}; }
}
reloadBeatsDb();

function reloadGenreDb() {
  try {
    genreDb = JSON.parse(fs.readFileSync(GENRE_DB_PATH, 'utf8'));
  } catch (_) { genreDb = {}; }
}

// "Electronic---Dub Techno" → { parent: "Electronic", sub: "Dub Techno" }
// "Rock"                    → { parent: "Rock",        sub: "Rock" }
function parseGenre(g) {
  if (!g) return { parent: '', sub: '' };
  const parts = g.split('---');
  return { parent: parts[0].trim(), sub: (parts[1] || parts[0]).trim() };
}

// Assign genre to one or all stems. Called at track load (all stems same source),
// and in future multi-source mode (per stem).
function setGenreForStem(stemName, genre, confidence) {
  if (state.stems[stemName]) {
    state.stems[stemName].genre = genre;
    state.stems[stemName].genreConf = confidence || 0;
  }
}

// Returns { genre, confidence } — confidence is the Discogs-EffNet top-1
// softmax probability (0-1). Note these are typically LOW (often 0.1-0.3)
// even for a confident call, since it's a probability across ~400 genre
// classes — not directly comparable in magnitude to the beats-detector's
// confidence score.
function getGenreForTrack(trackName) {
  if (!trackName) return { genre: '', confidence: 0 };
  const key = Object.keys(genreDb).find(k =>
    k.includes(trackName) || trackName.includes(k) || k === trackName
  );
  return (key && genreDb[key] && genreDb[key].genres && genreDb[key].genres.length)
    ? { genre: genreDb[key].genres[0].genre, confidence: genreDb[key].genres[0].confidence || 0 }
    : { genre: '', confidence: 0 };
}

function updateGenreForTrack(trackName) {
  const { genre, confidence } = getGenreForTrack(trackName);
  // Assign to stems that have no individual source track yet (or still on the main track)
  Object.keys(state.stems).forEach(n => {
    const stemSrc = state.stems[n].track;
    if (!stemSrc || stemSrc === trackName || stemSrc === '') {
      setGenreForStem(n, genre, confidence);
    }
  });
}

function updateBeatsForTrack(trackName) {
  if (!trackName || trackName === 'no track loaded') {
    state.beats = { meter: 0, bpm: 0, conf: 0.0 };
    return;
  }
  // Strip stem suffix to get base track name (same logic as slicer.js)
  const base = trackName.replace(/_(vocals|melody|bass|drums|other|melo)(\.\w+)?$/i, '').trim();
  let entry = beatsDb[base];
  if (!entry) {
    const lower = base.toLowerCase();
    entry = Object.entries(beatsDb).find(([k]) => k.toLowerCase() === lower)?.[1];
  }
  state.beats = entry
    ? { meter: entry.meter || 4, bpm: entry.bpm || 0, conf: entry.confidence || 0 }
    : { meter: 0, bpm: 0, conf: 0.0 };
  if (entry && entry.key && entry.key !== '?') state.key = entry.key;
}

const DOWNBEAT_MIN_CONF = 0.4;  // must match slicer.js

function beatsHeaderLine() {
  const b = state.beats;
  if (!b.meter) return `{grey-fg}beats:{/grey-fg} --`;
  const confBar = Math.round(b.conf * 10);
  const bar = '●'.repeat(confBar) + '○'.repeat(10 - confBar);
  // Show globalBPM (playback tempo) in beats line — not the analyzed source BPM
  const displayBpm = state.globalBPM > 0 ? state.globalBPM : b.bpm.toFixed(0);
  return `{grey-fg}beats:{/grey-fg} ${b.meter}/4 ${displayBpm}bpm ${bar}`;
}

function quantMode() {
  const p = state.params;
  if (!p.quant) return 'off';
  const b = state.beats;
  return (b.meter && b.conf >= DOWNBEAT_MIN_CONF) ? 'beat' : 'grid';
}

// ── TRACK BROWSER ─────────────────────────────────────────────────────────────
let browseList = [];
let browseIdx  = -1;

function getBrowseList() {
  const keys = new Set([...Object.keys(beatsDb), ...Object.keys(genreDb)]);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function showBrowsedTrack() {
  const name  = browseList[browseIdx];
  const beats = beatsDb[name] || {};
  const bpm   = beats.bpm    || 0;
  const meter = beats.meter  || 4;
  const key   = (beats.key && beats.key !== '?') ? beats.key : '?';
  const conf  = beats.confidence || 0;
  const confBar = '●'.repeat(Math.round(conf * 10)) + '○'.repeat(10 - Math.round(conf * 10));
  const genreEntry = genreDb[name];
  const genreStr = (genreEntry && genreEntry.genres && genreEntry.genres.length)
    ? genreEntry.genres[0].genre : '';
  const genreRaw = parseGenre(genreStr);
  const genre = genreRaw.sub && genreRaw.sub !== genreRaw.parent
    ? `${genreRaw.parent} · ${genreRaw.sub}`
    : (genreRaw.parent || '--');
  const n = browseIdx + 1, total = browseList.length;
  const sc   = getSliceCountsForTrack(name);
  const lufs = getSliceLufsForTrack(name);
  const sliceStr = `voc:${sc.vocals} mel:${sc.melody} bas:${sc.bass} drm:${sc.drums}`;
  const fmt  = v => v !== null ? v.toFixed(1) : '--';
  const lufsStr = lufs
    ? `voc:${fmt(lufs.vocals)} mel:${fmt(lufs.melody)} bas:${fmt(lufs.bass)} drm:${fmt(lufs.drums)}`
    : '--';
  logSys(
    `[${n}/${total}] ${name}\n` +
    `  key: ${key}   bpm: ${bpm.toFixed(1)}   meter: ${meter}/4   conf: ${conf.toFixed(2)} ${confBar}\n` +
    `  genre: ${genre}\n` +
    `  slices: ${sliceStr}\n` +
    `  avg LUFS: ${lufsStr}`
  );
}

function browseNext() {
  browseList = getBrowseList();
  if (browseList.length === 0) { logSys('no tracks in bank'); return; }
  browseIdx = (browseIdx + 1) % browseList.length;
  showBrowsedTrack();
}

function browsePrev() {
  browseList = getBrowseList();
  if (browseList.length === 0) { logSys('no tracks in bank'); return; }
  browseIdx = (browseIdx - 1 + browseList.length) % browseList.length;
  showBrowsedTrack();
}

// ── TAGGER ────────────────────────────────────────────────────────────────────
let taggerRunning  = false;
const SPIN_FRAMES  = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let   spinFrame    = 0;
let   spinInterval = null;
let   spinLabel    = '';
let   spinProgress = '';    // white progress-bar portion ('' = none)
let   flucomaTimer = null;  // fake-progress timer for FluCoMa
let   flucomaQueryTimer = null; // polls ws_server for completion (recovers a lost analysisDone)
let   analysisCompleting = false; // guard so completeAnalysis() runs once per run (live + query can both arrive)

function renderSpinner() {
  if (!languageSelected) return;
  const agent   = `${state.agentName.toLowerCase()} — `;
  const frame   = SPIN_FRAMES[spinFrame];
  const content = spinProgress
    ? `{cyan-fg}${agent}{/cyan-fg}{grey-fg}${spinLabel} ${spinProgress} ${frame}{/grey-fg}`
    : `{cyan-fg}${agent}{/cyan-fg}{grey-fg}${spinLabel} ${frame}{/grey-fg}`;
  sepBox.setContent(content);
}

function startSpinner(label) {
  spinLabel    = label;
  spinProgress = '';
  spinFrame    = 0;
  if (spinInterval) clearInterval(spinInterval);
  spinInterval = setInterval(() => {
    spinFrame = (spinFrame + 1) % SPIN_FRAMES.length;
    renderSpinner();
    scheduleRender();
  }, 120);
}

function stopSpinner() {
  if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
  if (flucomaTimer) { clearInterval(flucomaTimer); flucomaTimer = null; }
  if (flucomaQueryTimer) { clearInterval(flucomaQueryTimer); flucomaQueryTimer = null; }
  spinLabel    = '';
  spinProgress = '';
  sepBox.setContent(languageSelected ? '' : '{white-fg}' + randCurse() + '{/white-fg}');
  scheduleRender();
}

// Fake-progress timer for FluCoMa: increments 0→95% over ~3 min, then 100% on analysisDone
function startFlucomaProgress() {
  if (flucomaTimer) clearInterval(flucomaTimer);
  analysisCompleting = false;   // fresh run — allow completeAnalysis() to fire again
  let pct = 0;
  flucomaTimer = setInterval(() => {
    if (pct < 95) pct = Math.min(95, pct + 1);
    const filled = Math.round(pct / 10);
    spinProgress = '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + pct + '%';
  }, 2000);  // ~3 min to reach 95%

  // Reliability net: the live 'analysisDone' broadcast from Max is a single
  // fire-and-forget WS frame — if it's lost (socket reconnecting, ws_server
  // just restarted when Max fired it), the bar would sit at 95% until the
  // 5-min timeout gives up even though analysis actually finished. So while
  // this spinner runs, actively poll ws_server every 5s; it flips its own
  // state.analysisDone true the moment analysis completes (and persists it
  // to disk), and replies 'analysisAlreadyDone', which drives the same
  // completion path below. Recovers a lost analysisDone within ~5s.
  if (flucomaQueryTimer) clearInterval(flucomaQueryTimer);
  flucomaQueryTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'queryAnalysisDone' }));
    }
  }, 5000);
}

// completeAnalysis — the post-FluCoMa pipeline (100% flash → MMT/add_tension
// → buildIndex). Called by a live 'analysisDone' OR, if that frame was lost,
// by the 'analysisAlreadyDone' reply to our poll. The analysisCompleting
// guard makes it idempotent so both arriving can't double-run add_tension.
function completeAnalysis() {
  if (analysisCompleting) return;
  analysisCompleting = true;
  if (flucomaTimer) { clearInterval(flucomaTimer); flucomaTimer = null; }
  if (flucomaQueryTimer) { clearInterval(flucomaQueryTimer); flucomaQueryTimer = null; }
  spinProgress = '██████████ 100%';
  setTimeout(() => {
    stopSpinner();
    logSys('✓ FluCoMa done — computing MMT…');
    startSpinner('mmt…');
    const tensionScript = path.join(__dirname, '..', 'demucs', 'add_tension.py');
    spawnProc([tensionScript], 'tension', null, code => {
      stopSpinner();
      if (code === 0) {
        logSys('✓ MMT computed');
        loadUmapDb(); loadStemRanges();  // pre-load in case UMAP already ran
        sendToMax('buildIndex');
        logSys('→ buildIndex — new tracks available');
        // Precompute per-stem waveform envelopes for the new track(s), then
        // reload so the bars switch from flat progress to real waveforms.
        const wfScript = path.join(__dirname, '..', 'demucs', 'compute_waveforms.py');
        spawnProc([wfScript], 'waveforms', null, wfCode => {
          if (wfCode === 0) { loadWaveforms(); logSys('✓ waveforms ready'); scheduleRender(); }
        });
      } else {
        logSys('⚠ add_tension.py failed (code ' + code + ')');
      }
    });
  }, 400);
}

// python3.10 has madmom + essentia; demucs_env has neither
const ANALYSIS_PY  = '/opt/homebrew/bin/python3.10';
const HTDEMUCS_ROOT = path.join(DATA_DIR, 'stems', 'htdemucs');
const STREAM_TXT_PATH = path.join(DATA_DIR, 'stream.txt');
const ANALYSIS_ENV  = Object.assign({}, process.env, {
  PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '')
});

// regenerateStreamTxt — rebuilds data/stream.txt directly from disk (mirrors
// analyze_reader.js's prepareNextTrack(), but covers every track at once, in
// Node instead of Max) and writes it.
//
// WHY THIS EXISTS: the WS-relayed 'startAnalysis' trigger (sent by
// :analyzeAll below) has to survive a long, fragile hop through Max's patch
// wiring — ws_server.js's outlet → a route object → a prepend box →
// analyze_reader.js — and every one of those hops has independently broken
// at least once this session (dead route, stripped selector, stale patch not
// reloaded). streamWatcher.js's stream.txt-polling trigger, by contrast, has
// worked reliably every single time it's fired. Rather than keep chasing
// wiring bugs in a chain that's proven fragile, this makes :analyzeAll ALSO
// rewrite stream.txt so the proven-reliable path fires too — belt and
// suspenders. analyze_reader.js's re-entrancy guard (analysisActive /
// pendingRestart) already makes it safe for both triggers to fire close
// together.
//
// Blank lines are used to force a genuine byte-level change (so
// streamWatcher.js's content-diff poll always detects it, even when
// re-analyzing the exact same track list as last time) — both
// streamWatcher.js and analyze_reader.js's readStreamTxt() already skip
// blank lines, so this can't corrupt parsing on either side.
function regenerateStreamTxt() {
  const SUFFIXES = ['_vocals.wav', '_drums.wav', '_bass.wav', '_other.wav'];
  const LABELS   = ['vocals',     'drums',      'bass',      'melody'    ];
  let lines = [];
  try {
    const trackDirs = fs.readdirSync(HTDEMUCS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const trackDir of trackDirs) {
      const trackPath = path.join(HTDEMUCS_ROOT, trackDir);
      let files;
      try { files = fs.readdirSync(trackPath); } catch (e) { continue; }
      for (let i = 0; i < SUFFIXES.length; i++) {
        const match = files.find(f => f.toLowerCase().endsWith(SUFFIXES[i]));
        if (match) lines.push(LABELS[i] + ' ' + path.join(trackPath, match));
      }
    }
  } catch (e) {
    logSys('regenerateStreamTxt: ' + e.message);
    return false;
  }
  if (lines.length === 0) return false;

  let content = lines.join('\n') + '\n';
  try {
    if (fs.readFileSync(STREAM_TXT_PATH, 'utf8') === content) content += '\n';
  } catch (e) { /* stream.txt doesn't exist yet — fine, write fresh */ }

  try {
    fs.writeFileSync(STREAM_TXT_PATH, content);
    return true;
  } catch (e) {
    logSys('regenerateStreamTxt: write failed — ' + e.message);
    return false;
  }
}

function spawnProc(args, label, filter, onDone) {
  const proc = spawn(ANALYSIS_PY, args, { env: ANALYSIS_ENV });
  const test = filter ? (l => l.trim() && !filter.test(l)) : (l => l.trim());
  proc.stderr.on('data', d => d.toString().trim().split('\n').forEach(l => { if (test(l)) logSys(l.trim()); }));
  proc.stdout.on('data', d => d.toString().trim().split('\n').forEach(l => { if (test(l)) logSys(l.trim()); }));
  proc.on('error', err => { logSys(`${label} error: ${err.message}`); stopSpinner(); if (onDone) onDone(-1); });
  proc.on('close', code => { if (onDone) onDone(code); });
}

function runMadmomTagger(onDone) {
  logSys('→ madmom: analyzing stems/htdemucs …');
  const script = path.join(__dirname, '..', 'demucs', 'madmom_tagger.py');
  const out    = BEATS_DB_PATH;
  const noise  = /No network created|last created network|WARNING.*network/i;
  spawnProc([script, '--htdemucs-root', HTDEMUCS_ROOT, '--out', out], 'madmom', noise, code => {
    if (code === 0) { reloadBeatsDb(); logSys('✓ madmom done'); sendToMax('reloadDownbeats'); }
    else logSys(`madmom exited with code ${code}`);
    if (onDone) onDone(code);
  });
}

function runGenreTagger(onDone) {
  logSys('→ genre: analyzing stems/htdemucs …');
  const script = path.join(__dirname, '..', 'demucs', 'genre_tagger.py');
  const out    = GENRE_DB_PATH;
  spawnProc([script, '--htdemucs-root', HTDEMUCS_ROOT, '--out', out], 'genre', null, code => {
    if (code === 0) { reloadGenreDb(); updateGenreForTrack(state.track); logSys('✓ genre done'); scheduleRender(); }
    else logSys(`genre_tagger exited with code ${code}`);
    if (onDone) onDone(code);
  });
}

// Run genre + madmom sequentially, then trigger FluCoMa analysis in Max.
// Spinner stops when Max sends back { type: 'analysisDone' }.
function runFullAnalysis() {
  if (taggerRunning) { logSys('analysis already running'); return; }
  taggerRunning = true;
  startSpinner('genre…');
  logSys('→ analyzeAll: genre + beats + descriptors …');
  runGenreTagger(() => {
    startSpinner('beats…');
    runMadmomTagger(() => {
      reloadGenreDb();
      reloadBeatsDb();
      updateGenreForTrack(state.track);
      updateBeatsForTrack(state.track);
      sendToMax('reloadDownbeats');
      // Trigger FluCoMa descriptor analysis in Max — spinner stops on 'analysisDone'
      startSpinner('flucoma…');
      startFlucomaProgress();
      // Rewrite stream.txt so the reliable streamWatcher.js poll-trigger
      // fires too, not just the WS-relayed message (see regenerateStreamTxt
      // doc comment — the WS path has broken repeatedly, this one hasn't).
      const streamOk = regenerateStreamTxt();
      logSys(streamOk ? '→ stream.txt regenerated (streamWatcher will pick it up)'
                       : '⚠ stream.txt regeneration failed — falling back to WS trigger only');
      logSys('→ Max: startAnalysis …');
      sendToMax('startAnalysis');
      taggerRunning = false;
      // Safety fallback: stop spinner after 5 min if Max never replies
      setTimeout(() => { if (spinLabel === 'flucoma…') { stopSpinner(); logSys('⚠ analysisDone not received — spinner stopped'); } }, 5 * 60 * 1000);
    });
  });
}

// Build the genre header line — weighted by stem energy × track weight.
// Groups by parent category, strips it from subs, e.g.:
//   Rock---Pop Rock + Rock---Alternative Rock  →  Rock - pop + alternative
//   above + Classical---Contemporary Classical  →  Rock - pop + alternative / Classical - contemporary
function genreHeaderLine() {
  const stemNames = ['vocals', 'melody', 'bass', 'drums'];

  const weighted = stemNames
    .map(n => {
      const s      = state.stems[n];
      const parsed = parseGenre(s.genre);
      const e      = parseFloat(s.E) || -60;
      const w      = parseFloat(s.weight) || 1.0;
      const dominance = Math.pow(10, e / 20) * w;
      const conf   = parseFloat(s.genreConf) || 0;
      return { parsed, dominance, conf };
    })
    .filter(x => x.parsed.parent);

  if (weighted.length === 0) return `{grey-fg}genre:{/grey-fg} --`;

  weighted.sort((a, b) => b.dominance - a.dominance);

  // Dominance-weighted average confidence across stems, same 10-dot circle
  // style as beatsHeaderLine(). Note: this is a Discogs-EffNet top-1 softmax
  // probability across ~400 genre classes, so even a clearly-correct call
  // often sits around 0.1-0.3 — expect the bar to read "low" more often than
  // the beats-detector's confidence does; that's the nature of the classifier,
  // not a bug.
  const totalDominance = weighted.reduce((a, x) => a + x.dominance, 0);
  const avgConf = totalDominance > 0
    ? weighted.reduce((a, x) => a + x.conf * x.dominance, 0) / totalDominance
    : 0;
  const confBar = Math.round(avgConf * 10);
  const bar = '●'.repeat(confBar) + '○'.repeat(10 - confBar);

  // Group by parent; strip parent word from sub to get the modifier label
  const groups = {};   // parent → [modifier, ...]
  const order  = [];   // parent insertion order (dominant first)
  for (const { parsed } of weighted) {
    const { parent, sub } = parsed;
    if (!parent) continue;
    if (!groups[parent]) { groups[parent] = []; order.push(parent); }
    const modifier = sub
      .replace(new RegExp('\\b' + parent + '\\b', 'gi'), '')
      .trim().toLowerCase();
    if (modifier && !groups[parent].includes(modifier)) groups[parent].push(modifier);
  }

  const parts = order.map(parent => {
    const mods = groups[parent];
    // '-' not '·' — see the dbMeter() comment on the U+00B7 width bug.
    return mods.length ? `${parent} - ${mods.join(' + ')}` : parent;
  });

  return `{grey-fg}genre:{/grey-fg} ${parts.join(' / ')} ${bar}`;
}

// ── SCREEN + LAYOUT ───────────────────────────────────────────────────────────

const screen = blessed.screen({
  // smartCSR uses terminal scroll-region escapes to avoid repainting the
  // whole screen on scroll. With this many stacked, independently-resizing
  // boxes (header/playback/lang/cmd/chat/VU sidebar all changing height on
  // every keystroke, language pick, and window resize), smartCSR's diffing
  // repeatedly tore: ghost glyphs left behind where a box used to be,
  // content bleeding between adjacent boxes, ranges that never got cleared.
  // realloc() on resize patched single instances of this but the same class
  // of corruption re-triggers on the very next normal render (VU meters
  // alone re-render ~10x/sec via the interval below), so it kept coming
  // back. Disabling smartCSR makes every render a plain full-buffer diff —
  // no scroll-region tricks, no partial-redraw assumptions to violate.
  // At a 100ms render tick this is imperceptible in cost and removes the
  // entire bug class instead of patching individual symptoms.
  smartCSR:    false,
  fullUnicode: true,
  title:       'EBYS 0.1.18 — ' + ((ACTIVE_SESSION && ACTIVE_SESSION.name) || 'default'),
  mouse:       true,
});

// Enable all-motion mouse tracking — captures every mouse event so the
// terminal has nothing left to interpret as a text selection drag.
process.stdout.write('\x1b[?1003h\x1b[?1006h');
process.on('exit', () => process.stdout.write('\x1b[?1003l\x1b[?1006l\x1b[?1000l'));

// ── DESCRIPTOR DOT GRID (per stem) ────────────────────────────────────────────
// 6 columns = descriptors C E F P H T
// 3 rows    = levels: row 0 = HIGH (>0.66), row 1 = MID, row 2 = LOW (<0.33)
// One dot per column is lit (●), showing where the current slice sits
// in each descriptor's range relative to all slices of that stem.

const GRAPH_W    = 11;   // 6 descriptors + 5 spaces
const GRAPH_ROWS  = 2;   // bar line + desc line
const GRAPH_SEP   = 0;   // no blank separator between stems

// Normalisation ranges written by ws_server.js after each buildIndex.
// Using a dedicated small file avoids Max JS's 32767-byte JsFile write limit
// that truncates ebys_index.json.
const RANGES_PATH = path.join(DATA_DIR, 'stem_ranges.json');
let   stemRanges  = {};

const stemSliceStartPos   = {}; // track pos (0-1) at the moment each slice started
const stemSliceStartTime  = {}; // wall-clock ms when each slice started playing
const stemSliceEndTime    = {}; // wall-clock ms when segmentEnd arrived (exact audio end)
const stemLearnedExtra    = {}; // EMA of buffer_manager delay per stem (ms) — self-calibrating
let   playbackStopped     = false; // true after :stop, cleared by :start
let   playbackRenderTimer = null;  // drives progress-bar animation between WS events

function ensurePlaybackRender() {
    // Always restart — clears any stale timer so stop→start always gets a fresh loop.
    stopPlaybackRender();
    playbackRenderTimer = setInterval(() => {
        if (state.running && !playbackStopped) scheduleRender();
    }, 250);
}

function stopPlaybackRender() {
    if (playbackRenderTimer) { clearInterval(playbackRenderTimer); playbackRenderTimer = null; }
}
const VU_STEMS = ['vocals', 'melody', 'bass', 'drums', 'master'];
const vuLevels = {};
// Peak-hold per channel, in dB — genuinely the same ballistics as
// state.lufsPeak/state.dbfsPeak: snapped up instantly to any new high
// (see the WS 'vu' handler's snapVuPeak() call below), then released down
// at PEAK_DECAY_DB_PER_SEC by peakDecayTick() — the exact same rate/
// mechanism LUFSs/TP already use, not a separate VU-specific ballistics.
// null = no signal seen yet ("--" via fmtMeterDb, same as lufsPeak/dbfsPeak).
const vuPeaks = {};
VU_STEMS.forEach(s => {
  vuLevels[s] = { FL: 0, FR: 0, RL: 0, RR: 0 };
  vuPeaks[s]  = { FL: null, FR: null, RL: null, RR: null };
});

// ── VU BAR ────────────────────────────────────────────────────────────────────
// level: 0–1 linear peak amplitude (from peakamp~ in Max). Renders through
// dbMeter() — the exact same system LUFSs/TP use: █ filled / ░ empty, a ▐
// peak-hold marker (yellow, red once the peak itself crosses -3dB), single
// hot-red threshold, same slow release rate. peakDb is optional — omit it
// (or pass null) for a bar with no peak marker.
const VU_W      = 12;
const VU_MIN_DB = -60;
function levelToDb(level) {
  return level > 1e-7 ? 20 * Math.log10(level) : VU_MIN_DB;
}
function vuBar(level, peakDb) {
  return dbMeter(levelToDb(level), peakDb === undefined ? null : peakDb, VU_MIN_DB, -3, VU_W);
}
// 4 mini bars for one stem: FL FR · RL RR  (front pair | rear pair)
function vu4(stem) {
  const ch = vuLevels[stem] || { FL: 0, FR: 0, RL: 0, RR: 0 };
  const pk = vuPeaks[stem]  || { FL: null, FR: null, RL: null, RR: null };
  return `${vuBar(ch.FL, pk.FL)}${vuBar(ch.FR, pk.FR)}{grey-fg}·{/grey-fg}${vuBar(ch.RL, pk.RL)}${vuBar(ch.RR, pk.RR)}`;
}

// ── VU SIDEBAR — vcl/mel/bas/drm/mst stacked on the right ────────────────────
// Sits beside sep/lang/cmd/chatHeader/log (all narrowed to CONTENT_W so the
// sidebar never overlaps them) — starts right under the header+playback rows
// and runs down to just above the input line.
const VU_SIDEBAR_STEMS = [
  { key: 'vocals', label: 'vcl' },
  { key: 'melody', label: 'mel' },
  { key: 'bass',   label: 'bas' },
  { key: 'drums',  label: 'drm' },
  { key: 'master', label: 'mst' },
];
// Fixed-width label column ("vcl " / "    ") guarantees FL/FR/RL/RR and their
// bars start in the same column on every row, in every block — pad via code
// rather than hand-counted literal spaces, so it can't drift out of alignment.
const VU_LABEL_W = 5;
// Fixed-width numeric readout after each bar — the peak-hold dB value shown
// the same way LUFSs/TP show theirs (fmtMeterDb: "-inf" below VU_MIN_DB,
// "--" before any signal has arrived). Padded to a constant width so the
// column can't shift as the value's digit count changes tick to tick.
const VU_NUM_W = 5;
function vuSidebarBlock(label, stemKey) {
  const ch = vuLevels[stemKey] || { FL: 0, FR: 0, RL: 0, RR: 0 };
  const pk = vuPeaks[stemKey]  || { FL: null, FR: null, RL: null, RR: null };
  // Source-lock indicator used to live here (row 1, under the label) — moved
  // to the progress-bar info row instead (see descLine in render()), so this
  // is back to a plain blank gap row like FL/RL/RR.
  return ['FL', 'FR', 'RL', 'RR'].map((c, i) => {
    const prefix = i === 0 ? label.padEnd(VU_LABEL_W, ' ')
                 : ''.padEnd(VU_LABEL_W, ' ');
    const num = fmtMeterDb(pk[c], VU_MIN_DB).padStart(VU_NUM_W);
    return `{grey-fg}${prefix}${c}{/grey-fg} ${vuBar(ch[c], pk[c])} {grey-fg}${num}{/grey-fg}`;
  });
}
// Row under each block's FL/FR/RL/RR — was a blank gap row, now carries that
// stem's pan x / pan y / width numbers (the spatial squares show shape, this
// is the actual value). Every block gets one, including the last (mst), so
// there's no dangling blank row and the count is uniform.
function vuSidebarInfoLine(stemKey) {
  const sp  = state.spatial[stemKey] || { x: 0, y: 0, width: 1 };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  return `{grey-fg}${' '.repeat(VU_LABEL_W)}${fmt(sp.x)} ${fmt(sp.y)} ${sp.width.toFixed(2)}{/grey-fg}`;
}
// Fixed content height: 5 blocks × (4 VU rows + 1 info row) = 25. Never
// recalculated — the box's position/size are constant, so nothing about
// lang/cmd/chat resizing can ever touch it. Matches SPATIAL_ZONE_H (also 25)
// so the VU and spatial-ring columns land on identical row offsets.
const VU_ZONE_H = VU_SIDEBAR_STEMS.length * 5;
function renderVuSidebar() {
  const lines = [];
  VU_SIDEBAR_STEMS.forEach(s => {
    lines.push(...vuSidebarBlock(s.label, s.key));
    lines.push(vuSidebarInfoLine(s.key));
  });
  vuSidebarBox.setContent(lines.join('\n'));
}

function loadStemRanges() {
  try {
    const raw = JSON.parse(fs.readFileSync(RANGES_PATH, 'utf8'));
    if (raw && typeof raw === 'object') stemRanges = raw;
  } catch (e) { /* file not written yet — stay empty */ }
}
loadStemRanges();

// Per-stem precomputed waveform envelopes (compute_waveforms.py), keyed by
// track name → { vocals|melody|bass|drums: [0..100 peaks] }. Drawn behind the
// slice window in the per-stem bars. Empty until the file exists, in which case
// the bars fall back to the flat progress bar.
const WAVEFORMS_PATH = path.join(DATA_DIR, 'waveforms.json');
let waveforms = {};
function loadWaveforms() {
  try {
    const raw = JSON.parse(fs.readFileSync(WAVEFORMS_PATH, 'utf8'));
    if (raw && typeof raw === 'object') waveforms = raw;
  } catch (e) { /* not computed yet — bars fall back to flat progress */ }
}
loadWaveforms();

// Momentum direction arrow from MMT tension value (0–1, from add_tension.py).
// Shows the CURRENT SLICE's momentum tendency — not the delta from the previous slice.
// ↑ = building  ─ = stable  ↓ = releasing  · = no tension data
function tensionArrow(t) {
  if (t === null || t === undefined || isNaN(t)) return '·';
  if (t > 0.6) return '↑';
  if (t < 0.4) return '↓';
  return '─';
}

// Keep umapDb around (still written by ws_server.js) but no longer rendered.
let umapDb = {};
function loadUmapDb() {
  try { umapDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'umap_coords.json'), 'utf8')); }
  catch (e) { umapDb = {}; }
}
loadUmapDb();

const DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];

// Range bar: shows current value as a • cursor on a ━━━━ track within min-max range.
// Cursor uses the small • (same glyph as the header record dot), not the larger ●.
// width = number of inner characters (cursor included).
function rangeBar(val, stemName, dim, width) {
  width = width || 5;
  if (Object.keys(stemRanges).length === 0) loadStemRanges();
  const r = stemRanges[stemName];
  const rng = r && r[dim];
  if (!rng || rng.max === rng.min) {
    return `{white-fg}•{/white-fg}{grey-fg}${'─'.repeat(width - 1)}{/grey-fg}`;
  }
  const lv  = Math.max(0, Math.min(1, ((parseFloat(val) || 0) - rng.min) / (rng.max - rng.min)));
  const pos = Math.round(lv * (width - 1));
  return `{grey-fg}${'─'.repeat(pos)}{/grey-fg}{white-fg}•{/white-fg}{grey-fg}${'─'.repeat(width - 1 - pos)}{/grey-fg}`;
}

// DAW-style block meter for a dB-scale reading (LUFS or true-peak dBFS),
// with a peak-hold marker — a distinct cell flagging the loudest/highest
// point hit so far this session (state.lufsPeak/dbfsPeak, never auto-decays,
// cleared by :resetPeaks). floor/ceil are the dB range the bar spans (ceil is
// always 0 = full scale, both metrics' natural top). redAt colors the fill
// and peak marker red once the CURRENT value crosses it (both metrics get
// "hot" near 0 — true-peak because that's clipping, LUFS because a mix
// sitting that loud has effectively no headroom left either).
function dbMeter(value, peak, floor, redAt, width) {
  width = width || 10;
  // Was '·' (U+00B7 MIDDLE DOT) — live-screenshot diagnosis (see the "match
  // row broken" investigation) found this is the ONLY non-ASCII glyph unique
  // to this row's paired left-hand text (envLine), and it's the row that
  // consistently landed short of the shared right edge while sibling rows
  // using other Unicode glyphs (●/○ in the genre/beats line) rendered fine.
  // That points to a font-fallback width mismatch for U+00B7 specifically in
  // this terminal — same bug class as the earlier "⚿" pin-marker fix
  // elsewhere in this file (glyph silently renders 2 cols wide even though
  // it isn't in any documented East-Asian-wide range, so visWidth() can't
  // catch it either). Swapped for a plain ASCII '-' to rule it out for good.
  if (value === null) return '{grey-fg}' + '-'.repeat(width) + '{/grey-fg}';
  const frac = v => Math.max(0, Math.min(1, (v - floor) / (0 - floor)));
  const filled   = Math.round(frac(value) * width);
  const peakCell = (peak !== null) ? Math.min(width - 1, Math.round(frac(peak) * width)) : -1;
  const hot      = value >= redAt;
  let out = '';
  for (let i = 0; i < width; i++) {
    if (i === peakCell) {
      out += hot ? '{red-fg}▐{/red-fg}' : '{yellow-fg}▐{/yellow-fg}';
    } else if (i < filled) {
      out += hot ? '{red-fg}█{/red-fg}' : '{white-fg}█{/white-fg}';
    } else {
      out += '{grey-fg}░{/grey-fg}';
    }
  }
  return out;
}

// Below these floors, the raw number is meaningless noise, not signal — a
// mix at genuine digital silence still produces a tiny nonzero float, and
// 20*log10() of that blows up into huge, nonsensical-looking readings like
// -157.2 or -313.1 instead of the clean "-inf" a real console/DAW shows for
// silence. Two different floors because the two metrics have different
// grounding:
//   LUFS_INF_FLOOR = -70 is not a guess — it's ITU-R BS.1770 / EBU R128's own
//     "absolute gate," the spec's own definition of the point below which a
//     signal doesn't count as programme content at all.
//   TP_INF_FLOOR = -60 has no equivalent official spec for true peak — this
//     is a practical floor (well below any audible programme material, well
//     above the float-underflow noise that produced -313.1 in the first
//     place), not a cited standard like the LUFS one.
// ASCII "-inf" rather than the ∞ glyph deliberately: this codebase has been
// bitten twice already (U+00B7, "⚿") by non-ASCII glyphs quietly rendering
// wider than their counted string length in this terminal and breaking
// column alignment — "-inf" is also what most hardware/DAW meters literally
// print for silence, so it's not a compromise, it's the actual convention.
const LUFS_INF_FLOOR = -70;
const TP_INF_FLOOR   = -60;
function fmtMeterDb(value, floor) {
  if (value === null) return '--';
  return value <= floor ? '-inf' : value.toFixed(1);
}

// Peak-hold release — called every 100ms from the clock-tick interval below.
// state.lufsPeak/dbfsPeak used to be a plain running session max (only ever
// went up), which is wrong for a peak-hold readout: if the mix gets loud then
// settles back down quiet, the number should follow it back down eventually,
// not sit pinned at the old high forever with no way to tell "that was ages
// ago" from "that's still happening." Standard meter-ballistics fix: snap UP
// instantly to any new high (in the WS 'lufs' handler, unchanged), then here,
// every tick, release DOWN at a fixed rate — but never below the current live
// reading, since the peak can't meaningfully be lower than what's playing
// right now. Net effect: peak jumps up immediately, holds while the mix stays
// loud, and drifts back down at a steady, visible rate once it quiets down.
const PEAK_DECAY_DB_PER_SEC = 6;
let lastPeakDecayMs = Date.now();
function peakDecayTick() {
  const now   = Date.now();
  const dtSec = (now - lastPeakDecayMs) / 1000;
  lastPeakDecayMs = now;
  if (dtSec <= 0) return;
  const step = PEAK_DECAY_DB_PER_SEC * dtSec;
  if (state.lufsPeak !== null && state.lufs !== null) {
    state.lufsPeak = Math.max(state.lufs, state.lufsPeak - step);
  }
  if (state.dbfsPeak !== null && state.dbfs !== null) {
    state.dbfsPeak = Math.max(state.dbfs, state.dbfsPeak - step);
  }
  // Same release for every VU channel's peak-hold — 20 independent values
  // (5 stems × FL/FR/RL/RR), each floored at that channel's own current
  // live reading so the marker can't decay below what's actually playing.
  VU_STEMS.forEach(s => {
    const lv = vuLevels[s], pk = vuPeaks[s];
    ['FL', 'FR', 'RL', 'RR'].forEach(ch => {
      if (pk[ch] !== null) pk[ch] = Math.max(levelToDb(lv[ch]), pk[ch] - step);
    });
  });
}

function renderStemGraph(stemName) {
  // Lazy-reload in case stem_ranges.json was written after startup
  if (Object.keys(stemRanges).length === 0) loadStemRanges();

  // Returns array of 6 tier indices (0=HIGH 1=MID 2=LOW), or null if no ranges yet
  if (Object.keys(stemRanges).length === 0) loadStemRanges();
  const s = state.stems[stemName];
  const r = stemRanges[stemName];
  if (!s || !r) return null;

  const levels = DIMS.map(d => {
    const rng = r[d];
    if (!rng || rng.max === rng.min) return 0.5;
    const val = parseFloat(s[d]) || 0;
    return Math.max(0, Math.min(1, (val - rng.min) / (rng.max - rng.min)));
  });
  return levels.map(lv => lv > 0.66 ? 0 : lv > 0.33 ? 1 : 2);
}

// The sidebar sits beside sep/lang/cmd/chatHeader/log, which are all narrowed
// to CONTENT_W so the language zone (and everything else in that column)
// stops short of the right edge instead of running under the VU meters.
// Computed, not hand-counted, from the exact pieces vuSidebarBlock() joins:
// label(5) + channel code "FL"(2) + gap(1) + bar(VU_W) + gap(1) + number(VU_NUM_W).
const VU_SIDEBAR_W = VU_LABEL_W + 2 + 1 + VU_W + 1 + VU_NUM_W;
// Spatial dock — sits to the RIGHT of the VU sidebar (flush against the
// screen's right edge), so the VU sidebar itself shifts left by SPATIAL_W +
// VU_SPATIAL_GAP. SPATIAL_W matches XY_W (the frame's own width) below — no
// extra margin there, box width equals content width exactly; the breathing
// room between the two columns is VU_SPATIAL_GAP alone.
const SPATIAL_W      = 9;
const VU_SPATIAL_GAP = 2;
const SIDE_TOTAL_W  = VU_SIDEBAR_W + VU_SPATIAL_GAP + SPATIAL_W;
const CONTENT_W    = '100%-' + SIDE_TOTAL_W;
function contentW() { return Math.max(20, screen.width - SIDE_TOTAL_W); }

// ── ZONE 1 — Header (version + EBYS state) ───────────────────────────────────
const statusBox = blessed.box({
  top: 0, left: 0, width: '100%', height: 3,
  tags: true, wrap: true,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 2 — Progression bars + descriptors + inline scatter graph ────────────
const playBox = blessed.box({
  top: 3, left: 0, width: '100%', height: 8,
  tags: true, wrap: true,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});
let fixedTop = 11; // 3 (statusBox) + playBox height — recalculated in render

// ── ZONE 2.5 — Separator (bars / chat) ───────────────────────────────────────
const sepBox = blessed.box({
  top: fixedTop, left: 0, width: CONTENT_W, height: 1,
  tags: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ── ZONE 3 — Language selector (expands on boot, collapses after selection) ───
let langCollapsed = false;
let langContent   = '';
const langBox = blessed.box({
  top: fixedTop, left: 0, width: CONTENT_W, height: 1,
  tags: true, wrap: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ── ZONE 4 — Command list (expands on boot, collapses to one-liner) ───────────
let cmdCollapsed = false;
let cmdContent   = '';
const cmdBox = blessed.box({
  top: fixedTop + 1, left: 0, width: CONTENT_W, height: 1,
  tags: true, wrap: true,
  scrollable: true, alwaysScroll: true, mouse: true,
  style: { fg: 'grey', bg: SKIN.bg, scrollbar: { bg: 'grey' } },
});

// ── ZONE 4.5 — Chat header (collapsed placeholder) ───────────────────────────
let chatCollapsed = false;
const chatHeaderBox = blessed.box({
  top: fixedTop + 2, left: 0, width: CONTENT_W, height: 1,
  tags: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ── ZONE 5 — Chat with Cricket (scrollable) ───────────────────────────────────
const logBox = blessed.log({
  top:           fixedTop + 3,
  left:          0,
  width:         CONTENT_W,
  height:        screen.height - fixedTop - 3 - 1,
  tags:          true,
  scrollable:    true,
  alwaysScroll:  false,
  scrollOnInput: false,
  style:         { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 6 — VU meters (vcl/mel/bas/drm/mst) ──────────────────────────────────
// Top-right of its zone: same row as sepBox/langBox start (fixedTop), fixed
// size (height:VU_ZONE_H, never stretches). top is re-set to fixedTop in
// reflow() — it only moves when the header/playback height actually changes,
// not on every language-panel keystroke, since its OWN height no longer
// depends on langH/cmdH/chatHdrH at all.
const vuSidebarBox = blessed.box({
  top: fixedTop, right: SPATIAL_W + VU_SPATIAL_GAP, width: VU_SIDEBAR_W, height: VU_ZONE_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 6.5 — Spatial position readout, one frame per VU stem row ───────────
// Square frame, one per stem, docked right of the VU sidebar. Two live values
// per frame: pan position (the white ● dot, from :joystick <stem> x y /
// :masterJoystick x y) and width (M/S stereo width, from :width <stem> <0-1>)
// — width is drawn as a fill creeping around the border ring itself, using
// its own ●/○ filled-vs-empty glyph language (green fill, grey empty) — kept
// as its own dot-based style deliberately; unlike the VU bars (now dbMeter's
// block system), a bent ring of small block glyphs reads poorly, so this
// stayed circular rather than being folded into the same system. Both W and H
// are odd (9×5) so there's a true
// single center cell for the dead-center/neutral position — even dimensions
// (the old 7×4) can only ever round to one side of center, never sit on it.
// Width narrowed 9 → 5: at 9-wide the frame's left/right border columns sit
// only 4 cells in from each edge of the top/bottom rows' 9-cell span, and
// against a terminal's taller-than-wide character cells that read as visibly
// lopsided rather than a clean, symmetric rectangle — reported directly
// ("it's more symmetric" against a narrower reference design). 5 keeps the
// same interior-row structure (still 3 interior rows for full y-axis
// resolution) just proportioned tighter to the same 5-row height.
// Each frame is its own unit (content + 0 gap) sized so block START rows
// still land on the same offsets as vuSidebarBox's blocks (5 rows here vs.
// VU's 4 content + 1 gap = 5) — the two columns stay row-aligned even though
// SPATIAL_H no longer equals a VU block's raw content height.
const XY_W      = 5;
const SPATIAL_H = 5;
const SPATIAL_ZONE_H = VU_SIDEBAR_STEMS.length * SPATIAL_H;

const spatialBox = blessed.box({
  top: fixedTop, right: 0, width: SPATIAL_W, height: SPATIAL_ZONE_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// Perimeter cell order, clockwise from top-left — the path the width fill
// creeps along. Computed once; length is constant (2*W + 2*H - 4 = 20 here).
const SPATIAL_PERIM = (() => {
  const cells = [];
  for (let c = 0; c < XY_W; c++) cells.push([0, c]);
  for (let r = 1; r < SPATIAL_H - 1; r++) cells.push([r, XY_W - 1]);
  for (let c = XY_W - 1; c >= 0; c--) cells.push([SPATIAL_H - 1, c]);
  for (let r = SPATIAL_H - 2; r >= 1; r--) cells.push([r, 0]);
  return cells;
})();
const SPATIAL_P       = SPATIAL_PERIM.length;
// Angle of each perimeter cell relative to the square's true center — used
// to project pan direction onto the border (see spatialFrameLines). "Up"
// (toward row 0) is +90°, matching atan2(y,x) with y already meaning
// front-positive in our x/y convention, so the projected point and the
// beam land in the same place.
const SPATIAL_CENTER_ROW = (SPATIAL_H - 1) / 2;
const SPATIAL_CENTER_COL = (XY_W - 1) / 2;
const SPATIAL_PERIM_ANGLES = SPATIAL_PERIM.map(([r, c]) =>
  Math.atan2(SPATIAL_CENTER_ROW - r, c - SPATIAL_CENTER_COL)
);
// Beam size (number of lit border cells) compressed to a small, legible
// window rather than ever spanning the whole perimeter (16 dots at the
// current 5×5 size, rescaled proportionally from the original 2/7-of-24) —
// :width 0 -> ~1 dot (never fully dark, a stem always has *some* presence),
// :width 1 -> ~5 dots.
const SPATIAL_MIN_FILL = 1;
const SPATIAL_MAX_FILL = 5;

// All position/angle/perimeter math below stays in LOGICAL column space
// (0..XY_W-1, 5 columns) — only the final render step spreads those columns
// out across actual character cells, at 2 chars per logical column (dot,
// blank, dot, blank, ...) instead of 1. Reason: a terminal row of adjacent
// dot characters sits much closer together than the vertical gap between
// rows (each row is a full line), so a tightly-packed horizontal row read as
// cramped/asymmetric next to the column spacing — direct feedback, with a
// reference image showing every other horizontal cell deliberately left
// blank so the visible dot-to-dot spacing matches the vertical rhythm.
const SPATIAL_RENDER_W = XY_W * 2 - 1;

function spatialFrameLines(x, y, width) {
  const colLo = 1, colHi = XY_W - 2;      // interior columns, border excluded
  const rowLo = 1, rowHi = SPATIAL_H - 2; // interior rows, border excluded
  const col = Math.round(colLo + (x + 1) / 2 * (colHi - colLo));
  const row = Math.round(rowLo + (1 - y) / 2 * (rowHi - rowLo));

  const grid = Array.from({ length: SPATIAL_H }, () => Array(SPATIAL_RENDER_W).fill(' '));

  // Width as a projection on the border: find the border cell closest to
  // the pan direction (x,y), then light a symmetric arc of cells centered
  // there — narrow width = tight cluster right where the marker points,
  // wide width = a broad arc spreading around it. Replaces the old
  // "fixed clockwise sweep from the top-left corner" fill, which had no
  // relationship to the actual pan direction at all.
  const lit   = new Set();
  const radius = Math.sqrt(x * x + y * y);

  if (radius < 0.05) {
    // Dead center (or close enough) — there IS no pan direction here, but
    // Math.atan2(0, 0) still returns exactly 0 ("right") rather than
    // anything meaning "no direction." The beam logic below took that at
    // face value and always clustered every lit cell on the right side of
    // the ring, even at rest — exactly the reported bug ("joystick at 0,0
    // shows all dots to the right"). At true center there's no direction to
    // be biased toward, so show a symmetric "no bias" marker instead: one
    // single dot at each of the four cardinal edge-midpoints (N/E/S/W),
    // ignoring width — matches how a joystick actually looks at rest.
    [Math.PI / 2, 0, -Math.PI / 2, Math.PI].forEach(targetAngle => {
      let idx = 0, bestDelta = Infinity;
      SPATIAL_PERIM_ANGLES.forEach((a, i) => {
        let d = Math.abs(a - targetAngle);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < bestDelta) { bestDelta = d; idx = i; }
      });
      lit.add(idx);
    });
  } else {
    const targetAngle = Math.atan2(y, x);
    let centerIdx = 0, bestDelta = Infinity;
    SPATIAL_PERIM_ANGLES.forEach((a, i) => {
      let d = Math.abs(a - targetAngle);
      if (d > Math.PI) d = 2 * Math.PI - d; // shortest angular distance, wraps past ±180°
      if (d < bestDelta) { bestDelta = d; centerIdx = i; }
    });

    const wClamped = Math.max(0, Math.min(1, width));
    const filled = Math.round(SPATIAL_MIN_FILL + wClamped * (SPATIAL_MAX_FILL - SPATIAL_MIN_FILL));
    const half = (filled - 1) / 2;
    for (let k = Math.ceil(-half); k <= Math.floor(half); k++) {
      lit.add(((centerIdx + k) % SPATIAL_P + SPATIAL_P) % SPATIAL_P);
    }
  }

  // Logical column c -> actual character column 2c (odd columns stay blank).
  SPATIAL_PERIM.forEach(([r, c], i) => {
    grid[r][c * 2] = lit.has(i) ? '{green-fg}●{/green-fg}' : '{grey-fg}○{/grey-fg}';
  });
  grid[row][col * 2] = '{bold}{white-fg}●{/white-fg}{/bold}';
  return grid.map(rowArr => rowArr.join(''));
}
function renderSpatial() {
  const lines = [];
  VU_SIDEBAR_STEMS.forEach(s => {
    const sp = state.spatial[s.key] || { x: 0, y: 0, width: 1 };
    // Width fill is always sp.width directly — NOT derived from pan
    // position/radius. An earlier version computed master's ring fill as
    // "1 - joystick radius", which meant panning away from center always
    // drained the ring toward empty regardless of actual width — a real bug
    // (reported as "panning right loses width"), not a DSP issue. Master
    // has no DSP width parameter of its own (M/S width is only ever
    // computed per-stem — there's no summed-master M/S stage), so its ring
    // is driven by :width all instead — :width master is just an alias for
    // :width all (see the verb === 'width' handling below), both update
    // this same sp.width.
    lines.push(...spatialFrameLines(sp.x, sp.y, sp.width));
  });
  spatialBox.setContent(lines.join('\n'));
}


// ── INPUT ────────────────────────────────────────────────────────────────────
let inputLines = 1;
const inputBox = blessed.textarea({
  bottom: 0, left: 0, width: '100%', height: 1,
  inputOnFocus: true, tags: false, wrap: true,
  style: { fg: SKIN.user_fg, bg: SKIN.bg },
});

// Spinner — top-right corner
const spinnerBox = blessed.text({
  top:    0,
  right:  0,
  width:  'shrink',
  height: 1,
  tags:   true,
  style:  { fg: 'grey', bg: SKIN.bg },
});

screen.append(statusBox);
screen.append(playBox);
screen.append(sepBox);
screen.append(langBox);
screen.append(cmdBox);
screen.append(chatHeaderBox);
screen.append(logBox);
screen.append(vuSidebarBox);
screen.append(spatialBox);
screen.append(inputBox);
screen.append(spinnerBox);

// ── RENDER ────────────────────────────────────────────────────────────────────

function sliceBar(s, name, bpm, width) {
  const durMs   = s.durMs || 0;   // full stem buffer duration (ms)
  const bars    = s.bars  || 4;
  const safeBpm = Math.max(1, bpm || 120);

  // Prefer the actual segDurMs sent by slicer.js (threaded through ws_server).
  // Fall back to BPM-derived estimate only when not yet received.
  const segDurMs = (s.segDurMs > 0) ? s.segDurMs : (bars * 4 * 60000 / safeBpm);

  // Bracket position in the full stem buffer.
  // Use real fracs when available; fall back to startPos estimate.
  let startPos;
  if (s.sliceStart !== undefined) {
    startPos = s.sliceStart;
  } else {
    startPos = stemSliceStartPos[name] !== undefined ? stemSliceStartPos[name] : (s.pos || 0);
  }
  // Bracket end position — prefer the exact endFrac slicer sent (s.sliceEnd).
  // This is the ground truth: it's totalFrac accumulated directly from slice durations.
  // Fallback: derive from segDurMs / durMs (less accurate, used before first seg message).
  let endPos;
  if (s.sliceEnd !== undefined && s.sliceEnd > startPos) {
    endPos = Math.min(1, s.sliceEnd);
  } else {
    const sliceFrac = durMs > 0 ? segDurMs / durMs : segDurMs / 300000;
    endPos = Math.min(1, startPos + sliceFrac);
  }

  // Cursor — driven by two mechanisms:
  // 1. segmentEnd (ground truth): when Max delay fires, we know the audio ended exactly now.
  //    → progress = 1.0 immediately, no estimation needed.
  // 2. Animated estimate: elapsed wall-clock / (segDurMs + learned buffer offset).
  //    stemLearnedExtra is an EMA of the buffer_manager compose delay, converges after
  //    a few segments so the bar reaches the end at almost exactly the right time.
  const startTime = (!playbackStopped && stemSliceStartTime[name]) || 0;
  let progress;
  if (startTime > 0 && segDurMs > 0) {
    // actualPlayMs = totalFrac × durMs × stretchRatio is sent by slicer as segPlayMs.
    // Allow natural 1.0 completion — no artificial 0.99 cap waiting for segmentEnd.
    // segmentEnd fires at snapSegDurMs (FALLBACK_BPM-based), which may be shorter than
    // the actual audio when no globalBPM is set; using it as a snap would cut bars short.
    const elapsed = Date.now() - startTime;
    progress = Math.min(1.0, elapsed / segDurMs);
  } else {
    progress = 0;
  }

  // Map 0→1 progress onto character columns within the bracket.
  const startCh  = Math.floor(startPos * width);
  const endCh    = Math.min(width - 1, Math.ceil(endPos * width));
  const innerW   = Math.max(1, endCh - startCh - 1); // characters inside [ ]
  const filledW  = Math.round(progress * innerW);
  const emptyW   = innerW - filledW;

  const afterLen = Math.max(0, width - endCh - 1);

  // Waveform mode: if this stem's source track has a precomputed envelope, draw
  // the stem's waveform (grey overall, white on the played part of the slice)
  // in place of the flat ░/█ bar. Same geometry — brackets still mark the slice
  // window, the played portion within it is white. Falls back to the flat bar
  // when no envelope is loaded yet.
  // s.track is only ever populated by a 'stemTrack' WS message — which
  // slicer.js only sends for a stem once it has actually selected/pushed a
  // segment for it. A stem with zero analyzed slices for the loaded track
  // (e.g. a near-silent vocal take with nothing for the FluCoMa analyzer to
  // find — confirmed via analysis_library.json for the currently loaded
  // track: vocals had 0 slices vs. drums 182 / melody 66 / bass 2) never
  // gets picked, so s.track stays '' forever and this lookup always missed,
  // falling back to the plain flat bar — visually "disconnected" next to
  // its siblings even though the stem itself isn't broken. Falling back to
  // state.track (the main loaded track, same fallback trackKeyLine already
  // uses) still finds that track's precomputed envelope for this stem name,
  // so it draws its real (possibly near-silent/flat) waveform instead.
  const trackKey = s.track || state.track;
  const env = waveforms[trackKey] && waveforms[trackKey][name];
  if (env && env.length) {
    const playedEnd = startCh + 1 + filledW;            // white run end (exclusive)
    return (
      `{grey-fg}${waveGlyphs(env, 0, startCh, width)}[{/grey-fg}` +
      `{white-fg}${waveGlyphs(env, startCh + 1, playedEnd, width)}{/white-fg}` +
      `{grey-fg}${waveGlyphs(env, playedEnd, endCh, width)}]${waveGlyphs(env, endCh + 1, width, width)}{/grey-fg}`
    );
  }

  return (
    `{grey-fg}${'─'.repeat(startCh)}[{/grey-fg}` +
    `{white-fg}${'█'.repeat(filledW)}{/white-fg}` +
    `{grey-fg}${'░'.repeat(emptyW)}]${'─'.repeat(afterLen)}{/grey-fg}`
  );
}

// Render a run of columns [fromCol, toCol) of a stem's waveform envelope as
// vertical block glyphs (amplitude per column). `totalW` is the full bar width
// the envelope is stretched across (so column → envelope position is stable
// regardless of which run we're drawing). Near-silent columns keep a thin ▁
// baseline so the bar reads as one continuous waveform line.
const WAVE_BLOCKS = '▁▂▃▄▅▆▇█';
function waveGlyphs(env, fromCol, toCol, totalW) {
  let s = '';
  for (let c = fromCol; c < toCol; c++) {
    const bucket = Math.min(env.length - 1, Math.max(0, Math.floor((c / totalW) * env.length)));
    const amp    = (env[bucket] || 0) / 100;            // 0..1
    const idx    = Math.min(7, Math.max(0, Math.round(amp * 7)));
    s += WAVE_BLOCKS[idx];
  }
  return s;
}

function pad(str, len) {
  return (str + ' '.repeat(len)).slice(0, len);
}

// Format milliseconds → H:MM:SS or M:SS
function fmtMs(ms) {
  if (!ms || ms <= 0) return '0:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h  = Math.floor(totalSec / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `0:${mm}:${ss}`;
}

let renderPending = false;
let cachedLogH    = 0;

// ── ZONE LAYOUT ───────────────────────────────────────────────────────────────
function visWidth(text) {
  let cols = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // Directional marks and other zero-width formatting characters
    if (cp === 0x200E || cp === 0x200F ||
        cp >= 0x202A && cp <= 0x202E ||
        cp >= 0x2066 && cp <= 0x2069) continue;
    const wide =
      (cp >= 0x1100 && cp <= 0x115F) ||
      (cp >= 0x2E80 && cp <= 0x303E) ||
      (cp >= 0x3041 && cp <= 0x33FF) ||
      (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0x4E00 && cp <= 0x9FFF) ||
      (cp >= 0xA000 && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE10 && cp <= 0xFE19) ||
      (cp >= 0xFE30 && cp <= 0xFE4F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6);
    cols += wide ? 2 : 1;
  }
  return cols;
}

function visLines(text, w) {
  const plain = text.replace(/\{[^}]+\}/g, '');
  if (!plain.trim()) return 1;
  return Math.max(1, Math.ceil(visWidth(plain) / Math.max(1, w)));
}

function buildLangList() {
  const w = Math.max(1, contentW() || 80);
  const N = LANGUAGES.length;

  const entries = LANGUAGES.map((l, i) => ({
    text:     `‎${i + 1}. ${l.label}`,           // LRM anchors RTL scripts (Arabic, Hebrew) left
    blessedW: visWidth(`${i + 1}. ${l.label}`) + 1,  // +1 for LRM (blessed counts it as 1 col)
  }));

  const maxEntW = Math.max(...entries.map(e => e.blessedW));
  const colW    = maxEntW + 8;                         // +8 gap absorbs CJK/syllabic width discrepancies
  const cols = Math.max(1, Math.floor(w / colW));

  // Distribute entries as evenly as possible:
  // first (N % cols) columns get one extra entry
  const baseH  = Math.floor(N / cols);
  const extras = N % cols;
  const colDefs = [];  // { start, height } per column
  let start = 0;
  for (let c = 0; c < cols; c++) {
    const h = c < extras ? baseH + 1 : baseH;
    colDefs.push({ start, height: h });
    start += h;
  }
  const maxRows = colDefs[0].height; // first col is tallest (or equal)

  const lines = [];
  for (let r = 0; r < maxRows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const { start: s, height: h } = colDefs[c];
      if (r >= h) break;                               // this column is shorter — stop row
      const { text, blessedW } = entries[s + r];
      const isLast = c === cols - 1 || (r >= h - 1 && c === cols - 1);
      line += isLast ? text : text + ' '.repeat(Math.max(0, colW - blessedW));
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const MIN_LOG_H = 5; // always reserve this many lines for chat
const LOG_GAP   = 1; // blank row between the :commands line and the chat log

function reflow() {
  const w = contentW();
  const h = screen.height;

  const langHFull = langCollapsed
    ? 1
    : (langContent || '').split('\n').reduce((s, l) => s + visLines(l, w), 0);
  const cmdHFull  = cmdCollapsed
    ? 1
    : (cmdContent  || '').split('\n').reduce((s, l) => s + visLines(l, w), 0);

  // Layout order: sep → lang → chatHeader → cmd → log
  // chatHeader is always right below lang so :language and :chat stay together
  const chatHdrH = chatCollapsed ? 1 : 0;

  const available = h - fixedTop - 1 - langHFull - chatHdrH - (chatCollapsed ? 0 : MIN_LOG_H + LOG_GAP) - inputLines;
  const langH = langCollapsed ? 1 : Math.min(langHFull, Math.max(1, available + (chatCollapsed ? 0 : MIN_LOG_H)));
  const cmdH  = cmdCollapsed  ? 1 : Math.min(cmdHFull,  Math.max(1, Math.floor(h / 2)));

  sepBox.top = fixedTop;

  langBox.top    = fixedTop + 1;
  langBox.height = langH;

  // chatHeaderBox always sits immediately after langBox
  chatHeaderBox.top    = fixedTop + 1 + langH;
  chatHeaderBox.height = chatHdrH;
  chatHeaderBox.setContent(chatCollapsed ? '{grey-fg}:chat — type to expand{/grey-fg}' : '');

  cmdBox.top    = fixedTop + 1 + langH + chatHdrH;
  cmdBox.height = cmdH;


  const logTop = fixedTop + 1 + langH + chatHdrH + cmdH;
  if (chatCollapsed) {
    logBox.top    = logTop;
    logBox.height = 0;
    cachedLogH    = 0;
  } else {
    // Blank row between the :commands line and the chat log.
    const logTopGapped = logTop + LOG_GAP;
    logBox.top = logTopGapped;
    const newLogH = Math.max(MIN_LOG_H, h - logTopGapped - inputLines);
    if (newLogH !== cachedLogH) {
      const wasBottom   = atBottom();
      const savedScroll = wasBottom ? -1 : logBox.getScroll();
      cachedLogH        = newLogH;
      logBox.height     = newLogH;
      if (!wasBottom) logBox.scrollTo(savedScroll);
    }
  }


  // VU meters — top-right of its zone. height is fixed (VU_ZONE_H, set at
  // creation); top tracks the ":language — type to expand" row (langBox.top =
  // fixedTop + 1) so the meters line up with it rather than the separator.
  vuSidebarBox.top = fixedTop + 1;
  renderVuSidebar();

  // Spatial ring — docked right of the VU sidebar, kept on the same row.
  spatialBox.top = fixedTop + 1;
  renderSpatial();

}

function setLangContent(text) {
  langContent = text;
  langBox.setContent(text);
  reflow();
}

function setCmdContent(text) {
  cmdContent = text;
  cmdBox.setContent(text);
  reflow();
}
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  setImmediate(() => { renderPending = false; render(); });
}

function render() {
  // statusBox and playBox (everything sized against `w` below) are both
  // declared width: '100%' — the FULL terminal width, unlike sepBox/langBox/
  // cmdBox/chatHeaderBox/logBox further down, which use the narrower
  // CONTENT_W to leave room for the VU sidebar sitting beside THEM (the VU
  // sidebar's own top is fixedTop = statusH + 1 + playHeight, i.e. it starts
  // BELOW the header/playback rows, not beside them). A previous pass here
  // switched this to contentW() on the mistaken assumption the sidebar sat
  // beside these rows too — that under-budgeted every width calculation by
  // SIDE_TOTAL_W (31) columns versus what the box can actually show, which
  // is what produced the big dead gap on the right. screen.width is correct.
  const w = screen.width;

  // Status
  const conn  = state.connected ? '{white-fg}[CONNECTED]{/white-fg}' : '{grey-fg}[DISCONNECTED]{/grey-fg}';
  const run   = state.running   ? '{white-fg}[RUNNING]{/white-fg}' : '{grey-fg}[STOPPED]{/grey-fg}';
  const sl    = state.slices.join('/');
  const p = state.params;
  const fmtDir = v => (v >= 0 ? '+' : '') + (parseFloat(v) || 0).toFixed(1);
  const fmtM   = v => (' ' + (parseFloat(v) || 0).toFixed(1)).slice(-4);
  const genreLine = genreHeaderLine();

  // Fixed-column layout for the right-hand block (last touched / weight /
  // dir / dirWgt): each row is now independently right-flushed so its own
  // text ends exactly at w-1, instead of all rows sharing one column
  // derived from whichever row was longest. That shared-column approach
  // left every row EXCEPT the longest one visibly short of the right edge
  // (the actual bug reported — last touched/weight/dir all started at the
  // same left column but only "dir" reached the screen edge). Per-row
  // right-flush also still keeps weight's and dir's M:/E:/F:/P:/H:/T:
  // columns aligned with each other, since dirWgt (the field that used to
  // make dir longer than weight) now lives on its own line below — weight
  // and dir are the same length again, so flushing each to w-1
  // independently makes them line up as a side effect, without needing a
  // shared start column at all.
  const strip = s => s.replace(/\{[^}]+\}/g, '');
  const atCol = (left, right) => {
    const rightVis = strip(right).length;
    const startCol = w - 1 - rightVis; // column `right` must start at to end exactly at w-1
    let leftOut = left;
    let leftVis = strip(left).length;
    if (leftVis > startCol - 1) {
      const plain = strip(left);
      const keep  = Math.max(0, startCol - 2); // -2 reserves room for the ellipsis + gap
      leftOut = plain.slice(0, keep) + (keep < plain.length ? '…' : '');
      leftVis = strip(leftOut).length;
    }
    const pad = Math.max(1, startCol - leftVis);
    return leftOut + ' '.repeat(pad) + right;
  };

  // weight / match / dir — three right-aligned rows with the identical
  // M/E/F/P/H/T column structure (labels padded to 7 chars so the columns line
  // up across all three). weight = per-descriptor :setWeight values.
  // Real per-stem values now (see state.paramsPerStem + :wmdScope). 'all'
  // shows vocals' bucket as a representative view — all four stems start
  // identical and only diverge once the user targets one specifically, so
  // there's no single "all" truth once they've diverged; vocals is just the
  // canonical stand-in, same as picking any one of four equal values.
  const wmdStemKey = state.wmdScope === 'all' ? 'vocals' : state.wmdScope;
  const wp = state.paramsPerStem[wmdStemKey] || state.paramsPerStem.vocals;
  const wmdScope = `[${state.wmdScope}]`;
  const weightStr = `{grey-fg}weight ${wmdScope}{/grey-fg} {grey-fg}M:{/grey-fg}${fmtM(wp.weightC)} {grey-fg}E:{/grey-fg}${fmtM(wp.weightE)} {grey-fg}F:{/grey-fg}${fmtM(wp.weightF)} {grey-fg}P:{/grey-fg}${fmtM(wp.weightP)} {grey-fg}H:{/grey-fg}${fmtM(wp.weightH)} {grey-fg}T:{/grey-fg}${fmtM(wp.weightT)}`;
  // Match moved out of the header — it's now shown per-stem in the
  // progression-bar tail, right after "stay" (see barsStay below), since
  // matchProb is a genuinely per-stem value and the header's "match [all]"
  // row could only ever show one stem's value as a stand-in anyway.
  const dirStr   = `{grey-fg}dir    ${wmdScope}{/grey-fg} {grey-fg}M:{/grey-fg}${fmtDir(wp.dirC)} {grey-fg}E:{/grey-fg}${fmtDir(wp.dirE)} {grey-fg}F:{/grey-fg}${fmtDir(wp.dirF)} {grey-fg}P:{/grey-fg}${fmtDir(wp.dirP)} {grey-fg}H:{/grey-fg}${fmtDir(wp.dirH)} {grey-fg}T:{/grey-fg}${fmtDir(wp.dirT)}`;
  // dirWgt = DIR_WEIGHT — a single per-stem multiplier on how much ALL the
  // directional preferences above (M/E/F/P/H/T) affect scoring overall,
  // separate from each individual descriptor's own preference value. Named
  // "wgt" before, which read as unrelated to "dir" — spelled out for clarity.
  // On its own line below "dir" (used to trail dirStr inline) — that also
  // made dirStr longer than weightStr, which is what broke the M:/E:/F:/…
  // column alignment between the weight and dir rows in the first place.
  const dirWgtStr = `{grey-fg}dirWgt:{/grey-fg}${fmtM(wp.dirWeight)}`;

  // Entropy fader removed from the header for now — state.params.entropy is
  // still tracked (updated by the 'entropy' WS handler / :setEntropy), just not
  // displayed here, so it's ready to drop back in when we find its spot.
  // SegmentBars also stays out (it's shown per stem in the progression bars).
  // LUFS floors at -40 (quiet mix reads near-empty, nothing meaningful below
  // that); true-peak floors at -24 (peaks live in a narrower band close to
  // 0 dBFS — a -40 floor would leave the bar looking empty almost always).
  // Both go "hot" (red) at -3, the conventional headroom line before
  // clipping/limiting starts doing real work.
  const lufsMeter = dbMeter(state.lufs, state.lufsPeak, -40, -3, 10);
  const tpMeter   = dbMeter(state.dbfs, state.dbfsPeak, -24, -3, 10);
  // Numeric readout shows the PEAK (the yellow/red ▐ marker's value), not the
  // live instantaneous level — matches the hardware-meter convention of a
  // numeric peak readout next to a live bar. The bar's fill still shows the
  // current level; peakDecay() (below) keeps this number sliding back down
  // toward reality instead of sitting pinned at an old high forever.
  const envLine   = `{grey-fg}win:{/grey-fg} ${p.envelope}   {grey-fg}slices:{/grey-fg} ${sl}   ` +
    `{grey-fg}LUFSs{/grey-fg} ${lufsMeter} ${fmtMeterDb(state.lufsPeak, LUFS_INF_FLOOR)}   ` +
    `{grey-fg}TP{/grey-fg} ${tpMeter} ${fmtMeterDb(state.dbfsPeak, TP_INF_FLOOR)}`;
  const genreBeatsLine = `${genreLine}   ${beatsHeaderLine()}   {grey-fg}quant:{/grey-fg} ${quantMode()}`;

  // Header indicators — persistent LED-style, always visible (not
  // appearing/disappearing like the old statusIcons row) so they read like
  // hardware LEDs: dim grey when idle, lit when active.
  //   • record   — small dot, sits on the title row next to [CONNECTED]/
  //                [DISCONNECTED]. Red when state.recording, grey otherwise.
  //   [TIP ON]/[TIP OFF]   — white when a tipping session is open, grey otherwise.
  //   [LINK ON]/[LINK OFF] — briefly flips to cyan ("pale blue") when a LINK missile
  //                fires (this deck's own :link fire OR a remote deck's — ws_server.js
  //                broadcasts 'linkMissile'/'fire_executed' to everyone),
  //                fades back to grey after LINK_FLASH_MS. No extra timer
  //                needed — the existing 100ms render tick (bottom of file)
  //                naturally re-evaluates this on every tick.
  //   Both TIP/LINK sit right-aligned on their own row, directly above
  //   "last touched" (see sLines below).
  const LINK_FLASH_MS = 1500;
  // [REC •] — red when recording (on), grey when idle (off). This is the
  // inverse of the TIP/LINK convention (where off is the red/alarm state):
  // for recording, lit-red means "we are capturing right now".
  const recLabel = state.recording
    ? `{white-fg}[REC {/white-fg}{red-fg}•{/red-fg}{white-fg}]{/white-fg}` : `{grey-fg}[REC •]{/grey-fg}`;
  const tipOn        = state.session.active;
  const tipDirect     = tipOn && state.session.deck === 'direct' ? ' DIRECT' : '';
  const tipLabel     = tipOn
    ? `{white-fg}[TIP ON${tipDirect}]{/white-fg}` : `{grey-fg}[TIP OFF]{/grey-fg}`;
  const linkFiring  = state.linkFiredAt > 0 && (Date.now() - state.linkFiredAt < LINK_FLASH_MS);
  // cyan reads as "pale blue" in this terminal palette — same convention
  // already used for the source-lock indicator.
  const linkLabel   = linkFiring
    ? `{white-fg}[LINK ON]{/white-fg}` : `{grey-fg}[LINK OFF]{/grey-fg}`;
  // [CHUNK MODE ON]/[CHUNK MODE OFF] — mirrors slicer.js's PLAY_FULL_FILE per
  // stem (state.playFullFile, updated by the 'playFullFile' WS handler
  // above — still the same underlying broadcast, chunkMode() in slicer.js
  // just replaced the old setPlayFullFile as the command that sets it). OFF
  // (grey, the default) means every stem is still in whole-file mode —
  // :chunkMode 0 is effectively active everywhere. ON (white) means at least
  // one stem has been switched to bar-chunked slicing, whether via an
  // explicit :chunkMode <stem> 1 or (far more commonly) just by
  // running :setSegmentBars, which always clears it for the stem(s) it
  // touches — see slicer.js's setSegmentBars(). "Any stem" rather than "all
  // stems" so a single-stem chunk switch doesn't silently read as OFF.
  const chunkModeOn = Object.keys(state.playFullFile).some(t => !state.playFullFile[t]);
  const chunkLabel  = chunkModeOn
    ? `{white-fg}[CHUNK MODE ON]{/white-fg}` : `{grey-fg}[CHUNK MODE OFF]{/grey-fg}`;
  const iconCluster = `${recLabel}   ${tipLabel}   ${linkLabel}   ${chunkLabel}`;

  // Last command touched — what LINK's missile switch would fire right now
  // if armed. Blank until the first performative command of the session.
  const lastTouchStr = state.lastCommandTouched
    ? `{grey-fg}:{/grey-fg}${state.lastCommandTouched.join(' ')}`
    : `{grey-fg}:--{/grey-fg}`;
  const lastTouchLine = `{grey-fg}last touched:{/grey-fg} ${lastTouchStr}`;

  // Separator is '-' not '·' — see the dbMeter() comment on the U+00B7 width bug.
  const trackKeyLine = `{grey-fg}track:{/grey-fg} ${(() => { const names = ['vocals','melody','bass','drums'].map(n => state.stems[n] && state.stems[n].track).filter(Boolean); const uniq = [...new Set(names)]; return uniq.length ? uniq.join('{grey-fg} - {/grey-fg}') : state.track; })()}   {grey-fg}key:{/grey-fg} ${state.key}`;

  // Stacked block: icon cluster / last touched / weight / dir / dirWgt, each
  // independently right-flushed to the true right edge (see atCol), icon
  // cluster leading (directly above "last touched"), then last touched above
  // weight/dir/dirWgt below it. The record dot lives up on the title row
  // instead, next to [CONNECTED] — same 3-space gap style as between
  // run-state and connection-state.
  const sessionName = (ACTIVE_SESSION && ACTIVE_SESSION.name) || 'default';
  const sessionLabel = `{red-fg}[SESSION: ${sessionName.toUpperCase()}]{/red-fg}`;
  // Header row: state chips left ([SESSION] first, then run/conn/rec),
  // EBYS version centered on the screen, TIP/LINK cluster flush right.
  const withLCR = (left, center, right) => {
    const vis = s => s.replace(/\{[^}]+\}/g, '').length;
    const total = w - 1;
    const lV = vis(left), cV = vis(center), rV = vis(right);
    const gap1 = Math.max(1, Math.floor((total - cV) / 2) - lV);
    const gap2 = Math.max(1, total - rV - (lV + gap1 + cV));
    return left + ' '.repeat(gap1) + center + ' '.repeat(gap2) + right;
  };
  const stateChips = `${sessionLabel}   ${run}   ${conn}`;
  // Each row below is flushed against the right edge of the window
  // independently (see atCol) — no shared column to compute up front
  // anymore.
  const sLines = [
    withLCR(stateChips, `{grey-fg}[EBYS 0.1.18]{/grey-fg}   {grey-fg}[{bold}▼{/bold}? AGPL-3.0]{/grey-fg}`, iconCluster),
    // "last touched" sits directly under the TIP/LINK cluster (it IS the param
    // LINK's missile switch would fire) — right-flushed to the same true
    // right edge as weight/dir/dirWgt below it, even though its own text is
    // shorter than theirs.
    atCol('', lastTouchLine),
    atCol(trackKeyLine, weightStr),
    atCol(envLine, dirStr),
    // dirWgt on its own line under "dir", right-flushed the same way. Paired
    // with genreBeatsLine as the left-hand content (instead of leaving left
    // blank) so "win:"/"genre:" stay on consecutive rows — a blank-left row
    // in between read as a gap splitting them into two blocks even though
    // no line was technically empty.
    atCol(genreBeatsLine, dirWgtStr),
  ];
  const statusH = sLines.reduce((h, l) =>
    h + Math.max(1, Math.ceil(visWidth(l.replace(/\{[^}]+\}/g,'')) / Math.max(1, w))), 0);
  statusBox.height = statusH;
  statusBox.setContent(sLines.join('\n'));
  // One blank row between the header and the progression bars. fixedTop
  // (= statusH + 1 + playHeight) already budgets this +1; placing it here,
  // above playBox, puts the gap between header↔bars instead of bars↔sep.
  playBox.top = statusH + 1;

  // Playback bars — 2 lines per stem, graph merged inline as right column
  const stems  = ['vocals', 'melody', 'bass', 'drums'];
  const nameW  = 6;
  const TS_W   = 8;
  const barW   = Math.max(4, w - nameW - 4 - TS_W);   // VU moved to header — reclaim width
  // +1 for the pin indicator column (was 3 = tMark + ": ", now 4 = pinMark + tMark + ": ")
  const fmtN   = v => String(Math.round(parseFloat(v) || 0)).padStart(5);
  const sid    = id => String(id || '--').replace('slice_', '#').slice(0, 6).padEnd(6);
  const fmtF   = v => (parseFloat(v) || 0).toFixed(2).padStart(5);

  const playLines = [];
  stems.forEach((name, si) => {
    const s         = state.stems[name];
    const b         = sliceBar(s, name, state.beats.bpm || state.bpm || 120, barW);
    // Use slice_ms absolute position when available (most accurate).
    // Fall back to pos*durMs, then BPM estimate when neither is ready yet.
    const baseMs    = s.timeMs > 0
      ? s.timeMs
      : (s.durMs > 0
        ? Math.round(s.pos * s.durMs)
        : Math.round(s.pos * s.bars * 4 * 60000 / Math.max(1, state.bpm)));
    const posMs     = Math.max(0, state.running ? baseMs + (Date.now() - s.lastPosTime) : baseMs);
    const tsStr     = fmtMs(posMs).padStart(TS_W - 1);
    const subGenre  = parseGenre(s.genre).sub;
    const trackShort = s.track.length > 16 ? s.track.slice(0, 15) + '…' : s.track;

    // Fixed-width numbers — padStart (right-align) guarantees column width never overflows.
    // Widths chosen to fit the largest observed value for each descriptor.
    // Left-aligned (padEnd) so each value sits right next to its own range
    // bar instead of floating at the far right of a wide field; the field
    // widths are unchanged, so columns still line up and the width budget
    // (NUM_WIDTHS below) stays correct.
    const nC = String(Math.round(parseFloat(s.C)||0)).padEnd(5);   // up to 99999
    const nS = String(Math.round(parseFloat(s.S)||0)).padEnd(4);   // usually 0-9
    const nE = (parseFloat(s.E)||0).toFixed(1).padEnd(5);          // up to 99.9
    const nF = (parseFloat(s.F)||0).toFixed(2).padEnd(7);          // -100.00 to 0.00
    const nP = String(Math.round(parseFloat(s.P)||0)).padEnd(5);   // up to 99999
    const nH = (parseFloat(s.H)||0).toFixed(2).padEnd(7);          // e.g. 1413.01
    const nT = (parseFloat(s.T)||0).toFixed(2).padEnd(4);          // 0.00 to 1.00

    // Row 0 — progress bar + timestamp (VU meters moved to sidebar)
    // Trigger mode indicator replaces the space before ':':
    //   ' ' = continuous  'T' = trigger mode (yellow)  '●' = ready to fire (red)
    const tRdy  = state.triggerReady[name];
    const tMode = state.triggerMode[name];
    const tMark = tRdy  ? `{red-fg}●{/red-fg}` :
                  tMode ? `{yellow-fg}T{/yellow-fg}` : ' ';
    // Pin indicator: set via :setStemSource, shows this stem is locked to one
    // named source track instead of picking freely. Plain single-width glyph
    // (not an emoji pin) — emoji/wide glyphs render as 2 columns in most
    // terminals and silently break every fixed-width alignment downstream of
    // it, the same class of bug already fought in the VU sidebar this session.
    const pinMark = s.pinnedSource ? `{cyan-fg}•{/cyan-fg}` : ' ';
    playLines.push(`${pad(name, nameW)}${pinMark}${tMark}: ${b} ${tsStr}`);

    // Row 1 — M↑━━●━━ nnnnn   E↓━━━━●━ nnnnnn   …  aligned columns
    // Arrow sits between the descriptor letter and its range bar (replaces the space).
    const aC = tensionArrow(s.tC), aE = tensionArrow(s.tE), aF = tensionArrow(s.tF);
    const aP = tensionArrow(s.tP), aH = tensionArrow(s.tH), aT = tensionArrow(s.tT);

    // This whole row previously summed to 150+ fixed characters (7 range
    // bars at a hardcoded width of 5, 3-space gaps) plus a variable-length
    // tail (bars/stay/sid/genre/track/lock) — reliably wider than most
    // terminals, so it silently wrapped onto extra lines. Everything below
    // is now sized against the ACTUAL terminal width `w` instead, so the
    // whole row — descriptors, spark, and every tail item — fits on one
    // line, shrinking the range bars first and then dropping the least
    // essential tail items (in that order) rather than wrapping.
    const DESC_GAP    = '  '; // was 3 spaces per gap; tightened to buy back room
    // Fixed (non-range-bar) character count for the descriptor block: each
    // of the 7 dims contributes letter+arrow(2) + space(1) + space(1) +
    // its own padded number width, joined by 6 DESC_GAP gaps, plus the
    // leading name-column pad.
    const NUM_WIDTHS  = [5, 4, 5, 7, 5, 7, 4]; // nC nS nE nF nP nH nT
    const nonRbFixed  = NUM_WIDTHS.reduce((sum, wid) => sum + 2 + 1 + 1 + wid, 0)
                       + 6 * DESC_GAP.length + (nameW + 3);
    const RESERVE_FOR_TAIL = 19; // keep at least enough room for "bars:X  stay:Y  match:Z"
    // Floor of 1 (not 2) so genuinely narrow terminals still degrade to a
    // single-character bar instead of the row refusing to shrink any
    // further — better than falling back to wrapping.
    const rbW = Math.max(1, Math.min(6, Math.floor((w - nonRbFixed - RESERVE_FOR_TAIL) / 7)));
    // Range bar: grey ━━●━━ showing where current value sits in observed
    // min-max — width now adaptive (rbW) instead of a hardcoded 5.
    const rb = (dim, val) => rangeBar(val, name, dim, rbW);
    const preLock  = `${pad('', nameW + 3)}C${aC} ${rb('C',s.C)} ${nC}${DESC_GAP}S· ${rb('S',s.S)} ${nS}${DESC_GAP}E${aE} ${rb('E',s.E)} ${nE}${DESC_GAP}F${aF} ${rb('F',s.F)} ${nF}${DESC_GAP}P${aP} ${rb('P',s.P)} ${nP}${DESC_GAP}H${aH} ${rb('H',s.H)} ${nH}${DESC_GAP}T${aT} ${rb('T',s.T)} ${nT}`;
    const preLockVis = preLock.replace(/\{[^}]+\}/g, '').length;
    let   remaining   = Math.max(0, w - 1 - preLockVis);

    // Tail items, highest priority first — each only gets appended if it
    // still fits within whatever room is left, so the row NEVER exceeds `w`
    // regardless of terminal size; lowest-priority items (genre, then
    // track) are the ones that get dropped first on a narrow terminal.
    const lockTo    = state.sourceLock[name];
    // "⚿" (SQUARED KEY, U+26BF). blessed's internal width table
    // (node_modules/blessed/lib/unicode.js) classifies this as width 1, but
    // a live screenshot showed it actually rendering as a tofu box on this
    // system's terminal font (no native glyph → fallback substitution),
    // which draws as 2 columns wide. LOCK_SLOT_W below is set to account for
    // that real on-screen width (7, not 6) rather than blessed's count, so
    // the budget matches what's actually drawn and locked/unlocked stems'
    // tails (bars:/stay:/match:) stay on the same column.
    const lockPlain = lockTo ? `${lockTo.slice(0, 3)}⚿` : '';
    // { text: what actually gets appended (may include color tags), len: its
    //   VISIBLE width (tags stripped) — kept separate since tags cost zero
    //   real screen columns but do add characters that would otherwise
    //   throw the budget off. }
    const candidates = [];
    // Fixed-width slot regardless of whether THIS stem is locked — every
    // stem abbreviation is exactly 3 letters, so the tag itself is always
    // 3 letters + the (double-width-on-screen) "⚿" = 5 visible cols, plus
    // its 2-space lead-in = 7. Always reserving that slot (blank-padded when
    // unlocked, e.g. the leader itself) means "bars:"/"stay:"/etc. that
    // follow always start at the same column on every row — was conditional
    // before, so an unlocked stem's row had nothing there and everything
    // after it drifted left relative to its locked neighbors.
    const LOCK_SLOT_W = 7;
    candidates.push(lockTo
      ? { text: `  {cyan-fg}${lockPlain}{/cyan-fg}`, len: LOCK_SLOT_W }
      : { text: pad('', LOCK_SLOT_W), len: LOCK_SLOT_W });
    // match — moved here from the header: matchProb is genuinely per-stem,
    // so it belongs next to this
    // stem's own bars/stay rather than a single "representative" header row.
    const stemMatch = (state.paramsPerStem[name] && state.paramsPerStem[name].matchProb) || 0;
    const barsStay = `    bars:${s.bars}  stay:${s.stay.toFixed(1)}  match:${stemMatch.toFixed(1)}`;
    candidates.push({ text: barsStay, len: barsStay.length });
    const sidTxt = `  ${sid(s.id)}`;
    candidates.push({ text: sidTxt, len: sidTxt.length });
    if (subGenre) { const t = `  [${subGenre}]`; candidates.push({ text: t, len: t.length }); }
    if (s.track)  { const t = `  ${trackShort}`;  candidates.push({ text: t, len: t.length }); }

    let tail = '';
    for (const c of candidates) {
      if (c.len <= remaining) {
        tail += c.text;
        remaining -= c.len;
      }
      // else: dropped — not enough room left, skip to the next (lower-
      // priority) candidate rather than truncating mid-item.
    }
    const descLine = preLock + tail;
    playLines.push(`{grey-fg}${descLine}{/grey-fg}`);
  });

  // Calculate actual height accounting for line wrapping at current terminal width
  const playHeight = playLines.reduce((h, l) =>
    h + Math.max(1, Math.ceil(visWidth(l.replace(/\{[^}]+\}/g, '')) / Math.max(1, w))), 0);
  playBox.height = playHeight;
  playBox.setContent(playLines.join('\n'));

  fixedTop = statusH + 1 + playHeight;
  reflow();
  screen.render();
}

// ── CRICKET ───────────────────────────────────────────────────────────────────

// Commands Cricket can emit — any line starting with one of these goes to Max.
// Everything else is conversation and stays in the chat.
const COMMANDS = new Set([
  // playback
  'start', 'stop', 'applyNow',
  'next', 'selectSegment',
  'loop', 'unloop', 'unloopAll',
  'lockSource', 'unlockSource',
  // index
  'buildIndex', 'loadIndex', 'saveIndex',
  'reloadDownbeats', 'analyzeAll', 'tagBeats', 'info', 'reset',
  // slicing
  'setSegmentBars', 'setStayProb', 'setSrcWeights', 'setQuantize', 'setMaxSlices', 'setWindow',
  'chunkMode', 'skip', 'returnToBase',
  // tempo
  'setFallbackBPM', 'setGlobalBPM',
  // matching
  'setWeight', 'setMatchProb', 'setDirPref', 'setDirWeight', 'setTrackWeight', 'followStem', 'wmdScope',
  // entropy macro
  'setEntropy',
  // filters
  'setGenreFilter', 'clearGenreFilter', 'setKeyFilter', 'clearKeyFilter', 'listGenres',
  // source pin
  'setStemSource',
  // query
  'dumpDescriptors', 'selectRange', 'nextNearest',
  // audio — channel
  'fader', 'mute', 'solo', 'trim',
  // audio — master
  'master',
  // audio — EQ
  'eqLow', 'eqMid', 'eqMidFreq', 'eqHigh',
  // audio — spatial
  'width', 'joystick', 'masterJoystick', 'pan', 'analysisMode', 'monoSend',
  // audio — FX + outputs
  'fx', 'fxSwitch', 'boothGain', 'recGain', 'record',
  // pitch
  'pitchShift',
  // trigger pad
  'triggerMode', 'trigger',
  // tipping session (payouts) — NOT the login/workspace session
  // (that's :switchSession / :logout). tip* are the preferred names;
  // session* are kept as aliases so nothing already wired to them breaks.
  'tipOpen', 'tipClose', 'sessionOpen', 'sessionClose',
  // training — vertical (score the current layered combo, instant, no session).
  // Horizontal training is :bake (sequence of moves over a loop, see below)
  // and :scoreTransition (did THIS cut flow well, see below). Named "score"
  // rather than "rate" to avoid reading like a speed/tempo parameter next to
  // all the audio-rate terminology elsewhere in the system.
  'score', 'scoreTransition',
  // song structure — tag the bar-range currently playing on a stem with a
  // structural label (verse/chorus/build/drop/etc); intensity is computed
  // automatically. Stored canonically (song_structure.json), not a training
  // log — :listSections reviews what's stored for a track.
  'tag', 'listSections',
  // learned bias — closes the loop from the score/scoreTransition logs above
  // back into slicer.js's live candidate scoring. trainBias is TUI/Node-only
  // (spawns train_bias.py, then tells Max to reloadBias on success) so it's
  // intercepted by its own handler before ever reaching Max; reloadBias and
  // setLearnedWeight are plain passthroughs to slicer.js.
  'trainBias', 'reloadBias', 'setLearnedWeight',
  // TUI-only
  'showState', 'showCommands', 'chat', 'language',
  'nextTrack', 'prevTrack',
  'setMMT', 'resetPeaks',
]);

function isCommand(line) {
  return COMMANDS.has(line.trim().split(/\s+/)[0]);
}

// Load CRICKET.md as the knowledge base
// NOTE: this used to point at EBYS/CRICKET.md (repo root). The 0.1.8 docs
// reorg moved the real file to docs/instrument/CRICKET.md and left only a
// 3-line redirect stub at archive/CRICKET.md — but this path was never
// updated to match, so fs.readFileSync below has been silently failing
// (caught, falls through to the '(CRICKET.md not found)' placeholder) ever
// since. Cricket has had no real knowledge base loaded since that reorg.
// Fixed to point at the actual current location.
const CRICKET_MD_PATH = path.join(__dirname, '..', '..', 'docs', 'instrument', 'CRICKET.md');
let cricketDocs = '';
try {
  cricketDocs = fs.readFileSync(CRICKET_MD_PATH, 'utf8');
  cricketDocs = cricketDocs.replace(
    /1\. \*\*Output ONLY commands\*\*[^\n]*/,
    '1. **Mix commands and conversation freely** — commands go one per line with no extra text on the same line, prose goes in normal sentences. You can do both in the same response.'
  );
} catch (e) {
  cricketDocs = '(CRICKET.md not found)';
}

// Load voice.md — extracted writing style
let voiceNote = '';
try { voiceNote = fs.readFileSync(path.join(__dirname, 'voice.md'), 'utf8').trim(); } catch (e) {}

// Load rules.md — explicit behavioral rules
let rulesNote = '';
try { rulesNote = fs.readFileSync(path.join(__dirname, 'rules.md'), 'utf8').trim(); } catch (e) {}

const CRICKET_SYSTEM = `You are Cricket, the control interface for EBYS — a generative audio collage engine that separates songs into stems (vocals, melody, bass, drums), analyzes every transient slice, and plays them back in real time using spectral descriptors.

EBYS stands for "Eat Bugs You Spider."

Default behavior: when the user gives a musical instruction, respond with engine commands only — one per line, no explanation.
When the user asks a question or starts a conversation, answer clearly and concisely.
You can mix commands and conversation in the same response when it makes sense.
Never invent command names. Only use the exact commands listed in the knowledge base. If a user asks to do something the engine cannot do (like loading a track), say so in plain text — do not make up a command for it.
Never repeat or quote the [current state] block back in your response. It is for your internal context only.
When the user asks to see the state, or when you bring the conversation back to EBYS, emit: showState
When the user asks what commands are available, asks for a list of commands, or asks how to control EBYS, emit: showCommands
Never emit showCommands when the user asks what a specific command or parameter DOES — that is a conversational question, answer it in plain language.
When a conversation goes off-topic, follow it — don't redirect immediately. Let it go for several exchanges. Only bring it back to EBYS naturally if there's an opening, never by force.
Do not use terms of endearment like "mon ami", "friend", "buddy", "mate" or similar. Be warm but don't name the relationship.

When explaining what a command or concept does:
- Use a concrete analogy or metaphor to anchor the idea before going technical.
- Show how values interact with each other — don't explain a parameter in isolation if it only makes sense alongside another.
- Give a short concrete example (what you'd type and what it would do to the sound).
- Keep it tight — one analogy, one example, done. No bullet-point dumps, no restating the same thing twice.
- Write like someone who knows the system deeply and enjoys explaining it, not like a manual.
${rulesNote ? `\n--- RULES (follow these exactly) ---\n${rulesNote}\n` : ''}${voiceNote ? `\n--- VOICE (mirror this writing style in conversation) ---\n${voiceNote}\n` : ''}
--- EBYS KNOWLEDGE BASE ---
${cricketDocs}`;

const chatHistory = [{ role: 'system', content: CRICKET_SYSTEM }];

// ── BAKE SESSION TRACKING ─────────────────────────────────────────────────────
// Captures the intent → Cricket attempt → user corrections loop for fine-tuning.
let bakeIntent     = '';   // last natural language message sent to Cricket
let bakeCricketCmds = [];  // commands Cricket generated from that intent
let bakeUserCmds    = [];  // manual :commands the user sent after Cricket's response

// ── BAKE LOOP STATE ───────────────────────────────────────────────────────────
// Full training bracket: :bake start → loop N bars → bakeRestore → repeat → :bake end
let bakeLoopBars     = 4;      // loop window in bars (set by :bakeloop)
let bakeSessionActive = false; // true while a training bracket is open
let bakeLoopTimer    = null;   // setInterval handle
let bakeAttempt      = 0;      // how many loops have completed this session
let bakeEndQueued    = false;  // :bake end called mid-loop — close at next boundary
let bakeSessionLabel = '';     // NL prompt for this session
let bakeFirstCmds    = null;   // commands from Cricket's first attempt (stored at loop 1 end)

function bakeLoopMs() {
    const bpm    = state.bpm > 0 ? state.bpm : 120;
    const meter  = 4;  // assume 4/4 for now
    return (60000 / bpm) * meter * bakeLoopBars;
}

function startBakeLoop(label) {
    if (bakeLoopTimer) clearInterval(bakeLoopTimer);
    bakeSessionActive = true;
    bakeEndQueued     = false;
    bakeAttempt       = 0;
    bakeFirstCmds     = null;
    bakeSessionLabel  = label;

    const ms = bakeLoopMs();
    logSys('🎯 bake: loop started — "' + label + '"  ' + bakeLoopBars + ' bars @ '
           + (state.bpm || 120) + ' BPM  (' + Math.round(ms / 1000) + 's/loop)');

    bakeLoopTimer = setInterval(() => {
        bakeAttempt++;

        // Store first attempt commands for training pair
        if (bakeAttempt === 1) {
            bakeFirstCmds = bakeCricketCmds.slice();
        }

        if (bakeEndQueued) {
            // This loop just finished — close the session
            stopBakeLoop(true);
            return;
        }

        // Reset ring buffers to snapshot, replay from frozen position
        sendToMax('bakeRestore');
        logSys('🔄 bake: loop ' + bakeAttempt + ' reset → bakeRestore');
    }, ms);
}

function stopBakeLoop(store) {
    if (bakeLoopTimer) { clearInterval(bakeLoopTimer); bakeLoopTimer = null; }
    bakeSessionActive = false;
    bakeEndQueued     = false;

    if (store && bakeSessionLabel) {
        const snapshot = {
            intent:           bakeSessionLabel,
            cricket_cmds:     bakeFirstCmds || bakeCricketCmds.slice(),
            user_corrections: bakeUserCmds.slice(),
            final_cmds:       [...(bakeFirstCmds || bakeCricketCmds), ...bakeUserCmds],
            attempts:         bakeAttempt,
        };
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'bake', ...snapshot }));
        }
        logSys('🫳 bake end — "' + bakeSessionLabel + '"  attempts: ' + bakeAttempt
               + '  stored first + last attempt');
    } else {
        logSys('bake aborted — nothing stored');
    }
}

function ts() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `{grey-fg}[${hh}:${mm}]{/grey-fg} `;
}

function atBottom() {
  return logBox.getScrollPerc() >= 99;
}

const LOG_NOISE = /No network created|last created network has been deleted|VisibleDeprecationWarning|absl::InitializeLog|mlir_graph_optimization|MLIR V1 optimization/i;

function appendLog(line) {
  if (LOG_NOISE.test(line)) return;
  const wasBottom = atBottom();
  const savedPos  = wasBottom ? -1 : logBox.getScroll();
  logBox.add(line);
  if (wasBottom) {
    logBox.setScrollPerc(100);
  } else {
    logBox.scrollTo(savedPos);
  }
  screen.render();
}

function logSys(text) {
  appendLog(`{grey-fg}${text}{/grey-fg}`);
}

// Zone 3 (lang) and Zone 4 (cmd) helpers — defined after reflow() above
const _C = 60;  // description column
const _r = (sig, desc) => sig.padEnd(_C) + desc;

const CMD_LINES = [
  '',
  'command list',
  '── view ──────────────────────────────────────────────────────────────────',
  ':language — type to expand   ·   :commands — toggle   ·   :chat — toggle',
  _r(':showState',                               'print current track/params/stem state'),
  _r(':showCommands',                            'same as :commands — expand/collapse this panel'),
  _r(':resetPeaks',                              'clear the LUFSs/TP peak-hold markers in the header meters'),
  '',
  '── playback ──────────────────────────────────────────────────────────────',
  ':start  ·  :stop',
  _r(':applyNow',                                'force ALL 4 stems to reselect immediately — global reroll, not per-stem'),
  _r(':next [vocals|melody|bass|drums]',         'force-pick next slice now — bare :next hits all unlocked/leader stems; a locked follower advances its leader instead'),
  _r(':selectSegment vocals|melody|bass|drums',  'queue next slice for stem'),
  _r(':loop <stem> <bars>',                      'lock stem to looping slice'),
  _r(':unloop <stem>',                           'release loop on stem'),
  _r(':unloopAll',                               'release all loops — bars resume normal selection'),
  _r(':lockSource <leader> <follower...>',       'follower(s) draw from leader\'s source track, applies at each follower\'s next slice — takes 1+ followers'),
  _r(':lockSource all [leader]',                 'lock every stem to one leader — sequential, no layering'),
  _r(':unlockSource <stem|all>',                 'release source lock'),
  _r(':setStemSource <stem|all> <name>',         'pin stem to one source track, applies at next slice (substring match)'),
  _r(':setStemSource <stem|all> clear',          'release pin'),
  '',
  '── index ─────────────────────────────────────────────────────────────────',
  _r(':buildIndex',                              'rebuild slice index from analysis_library.json'),
  _r(':loadIndex',                               'load cached index (ebys_index.json) — skips rebuild'),
  _r(':saveIndex',                               'save current index to cache'),
  _r(':nextTrack / :prevTrack',                  'browse track bank — shows BPM, key, genre'),
  _r(':reloadDownbeats',                         'reload downbeats.json into Max'),
  _r(':info',                                    'dump slicer state to Max console'),
  _r(':reset',                                   'clear index + stop'),
  _r(':resetMemory',                             'wipe all analysis JSON (two-step)'),
  _r(':restartWatcher',                          'restart watch_demucs service (clears processed-file memory)'),
  _r(':switchSession [name] / :logout',          'no name → session picker; :switchSession <name> jumps straight to that session (skips the picker); :logout returns to the picker'),
  _r(':bakeloop <bars>',                           'set bake loop window length (default 4 bars)'),
  _r(':bake start <prompt>',                       'open training bracket — prompt is fed to NL translator, snapshots state, starts looping'),
  _r(':bake end',                                  'queue close at next loop boundary — stores first + last completed loop'),
  _r(':bake abort',                                'close bracket immediately — discards everything, releases engine'),
  _r(':score <-1..1> [overallSection]',            'vertical training — score the current layered combo (which source track each stem is on + how mixed), logged instantly, no session. Auto-attaches each stem\'s tagged section if one exists'),
  _r(':scoreTransition <-1..1> [stem]',            'horizontal training — score whether the previous→current segment cut flowed well, on one stem or all 4 (default)'),
  _r(':tag <label> [stem]',                        'tag the bar-range currently playing on stem (default melody) as a structural section — verse/chorus/build/drop/intro/bridge/etc. Intensity computed automatically'),
  _r(':listSections [track]',                      'print stored structure tags for a source track (default: whatever\'s loaded)'),
  _r(':trainBias',                                 'fit learned-bias models from accumulated :score/:scoreTransition logs (train_bias.py), then reload into slicer.js'),
  _r(':reloadBias',                                'reload learned_bias.json into Max without retraining'),
  _r(':setLearnedWeight <stem|all> <transition|vertical> <0-5>', 'scale how much a learned model influences scoring for a stem — 0 disables it even if loaded'),
  _r(':resetAll',                                '⚠ wipe everything — stems, uploads, analysis, memory (Y/N)'),
  _r(':analyzeAll',                              'run genre (essentia) + beats (madmom) on all tracks'),
  _r(':tagBeats',                                'run madmom beat tagger only'),
  _r(':setMMT <bars>',                           'momentum window size (reruns tension calc)'),
  '',
  '── trigger pads ──────────────────────────────────────────────────────────',
  _r(':triggerMode <stem|all> 0|1',              '0=continuous  1=stem pauses at slice end, waits for manual fire'),
  _r(':trigger [stem]',                          'fire next slice for stem (or all paused stems)'),
  '{grey-fg}  C-1/C-2/C-3/C-4{/grey-fg}   fire vocals/melody/bass/drums from keyboard',
  '',
  '── slicing ───────────────────────────────────────────────────────────────',
  _r(':chunkMode [stem] 0|1',                    'default 0 — play the whole file, loop it, never auto-switch; 1 = bar-chunked slicing (setSegmentBars)'),
  _r(':skip <stem>',                             'one-shot manual move to a newly-picked file for that stem'),
  _r(':setSegmentBars [stem] 0.5|1|2|4|8|16|32', 'bars/slice, applies at next slice (also switches that stem into chunkMode 1)'),
  _r(':returnToBase [stem|all]',                 'snap back to where the original mix would genuinely be by now, and resume full-file from there'),
  _r(':setStayProb [stem] 0.0–1.0',             '0=jump  1=loop'),
  _r(':setSrcWeights <bpm> <cohesion> [key]',    'source-track prob weights (key=Camelot harmonic fit, default 0)'),
  _r(':setQuantize 0|1',                         'bar-locked cuts, applies at next slice'),
  _r(':setMaxSlices N',                          'cap/stem  0=unlimited'),
  _r(':setWindow hann|hamming|blackman|triangle|rect', 'FFT window for the pitch shifter (fftin~/fftout~ in ebys-pitch.maxpat) — independent of tempo/karma~'),
  '',
  '── tempo ─────────────────────────────────────────────────────────────────',
  '{grey-fg}  pitch and BPM are the only params that affect already-playing audio directly — everything else waits for the next slice{/grey-fg}',
  _r(':setFallbackBPM 40–280',                   'fallback tempo — live'),
  _r(':setGlobalBPM 40–280',                     'BPM override  0=off — live'),
  '',
  '── matching ──────────────────────────────────────────────────────────────',
  _r(':setWeight <stem|all> C|S|E|F|P|H|T 0–5',  'per-stem descriptor weight'),
  _r(':setMatchProb <stem|all> 0–1',             'per-stem transition tightness (one value, applies to all descriptors)'),
  _r(':setDirPref <stem|all> C|S|E|F|P|H|T|D -1–1', 'per-stem direction bias  -1/0/1  (D=density: +1 builds, -1 releases)'),
  _r(':setDirWeight <stem|all> 0–5',             'per-stem direction bias strength'),
  _r(':wmdScope all|vocals|melody|bass|drums',   'which stem\'s weight/match/dir the header rows show (display only)'),
  _r(':setTrackWeight vocals|melody|bass|drums', '0–1  stem influence'),
  _r(':followStem <stem> <target> <weight> …',  'rewire stem to follow another stem\'s descriptors'),
  _r(':followStem <stem> self',                  'reset stem to read its own descriptors'),
  _r(':setEntropy 0–1',                          'ORDER↔CHAOS macro — drives matchProb/stayProb/dirWeight at once'),
  '',
  '── audio ─────────────────────────────────────────────────────────────────',
  _r(':fader <stem|all> <0–1>',                 'post-EQ channel level'),
  _r(':trim <stem|all> <dB>',                   'pre-EQ input gain (-12 to +12)'),
  _r(':mute <stem|all> 0|1',                    '0=unmute  1=mute'),
  _r(':solo <stem|all> 0|1',                    '0=off  1=on  (stacks)'),
  _r(':master <0–1>',                           'master output gain'),
  _r(':eqLow <stem|all> <dB>',                  'low shelf gain'),
  _r(':eqMid <stem|all> <dB>',                  'mid bell gain'),
  _r(':eqMidFreq <stem|all> <Hz>',              'mid bell center (200–8000)'),
  _r(':eqHigh <stem|all> <dB>',                 'high shelf gain'),
  '',
  '── spatial ───────────────────────────────────────────────────────────────',
  _r(':width <stem|all|master> <0–1>',          'M/S stereo width  0=mono  0.5=original stereo (default)  1=wider than original — master is an alias for all, incl. the "mst" ring'),
  _r(':joystick <stem|all> <x> <y>',            '2D pan  x=L/R(-1..1)  y=rear/front(-1..1)  — omit stem to target master'),
  _r(':masterJoystick <x> <y>',                 '2D pan entire mix (same as :joystick <x> <y>)'),
  _r(':pan <stem|all> 0–360',                    'quadraphonic rotation angle — 0/360=front  180=rear  90/270=all 4'),
  _r(':analysisMode on|off',                    'auto-drive width from slice analysis'),
  '',
  '── FX & outputs ──────────────────────────────────────────────────────────',
  _r(':fx <stem> <0–1>',                        'hardware FX send+return level'),
  _r(':fxSwitch <1|2> <0|1>',                   '0=stem  1=live input on FX channel'),
  _r(':monoSend <stem|all> on|off',             'collapse that stem\'s FX-send dac~ pair to a shared mono sum (for mono pedals) — default off (real stereo)'),
  _r(':boothGain <0–1>',                        'monitor output level (dac 15 16)'),
  _r(':recGain <0–1>',                          'recording output level (dac 17 18)'),
  _r(':record start [name]',                    'start WAV recording'),
  _r(':record stop',                            'stop and close recording'),
  _r(':pitchShift <stem> <semitones>',          'pitch shift (+ up / - down)'),
  '',
  '── filters ───────────────────────────────────────────────────────────────',
  _r(':setGenreFilter <genre>',                  'restrict selection to tracks tagged with genre (e.g. Techno)'),
  _r(':clearGenreFilter',                        'remove genre restriction'),
  _r(':listGenres',                              'print available genre tags to Max console'),
  _r(':setKeyFilter <key>',                      'restrict selection to tracks in key (e.g. Am  C#  G)'),
  _r(':clearKeyFilter',                          'remove key restriction'),
  '',
  '── query ─────────────────────────────────────────────────────────────────',
  _r(':dumpDescriptors [stem]',                  'dump all slice descriptors'),
  _r(':selectRange [stem] C:lo,hi W:lo,hi E:lo,hi F:lo,hi P:lo,hi', 'pick random slice in range'),
  _r(':nextNearest <stem> <C> <E> <F> <P>',      'manually jump to the closest slice to these 4 values'),
  '',
  '── link (multi-deck sync) ───────────────────────────────────────────────',
  _r(':link on | off',                           'legacy UDP peer sync (separate link_server process)'),
  _r(':link status',                             'show connected decks + current mode/armed state'),
  _r(':link mode avoid|mirror|complement|off',   'how other decks react to your changes'),
  _r(':link arm',                                'arm the missile switch — param captured at fire time'),
  _r(':link fire',                               'fire the armed switch — sends your last touched param to the group'),
  _r(':link abort',                              'disarm without firing'),
  _r(':link token <hex>',                        'set the shared session token'),
  '',
  '── tipping session (payouts — NOT your login session) ─────────────────────',
  _r(':tipOpen <djId> <venue> web|venue [deck]', 'open a tracked TIPPING session — required before :tip means anything'),
  _r(':tipClose',                                'close the current TIPPING session (alias: :sessionClose)'),
  _r(':tip',                                     'simulate payout — shows split based on active follow graph'),
  _r('  ↳ login session?',                       'to leave your workspace / pick another, use :switchSession or :logout'),
].map(l => `{grey-fg}${l}{/grey-fg}`).join('\n');

function expandCmd() {
  cmdCollapsed = false;
  // Keep the hint line as a header, just flip expand → collapse.
  setCmdContent('{white-fg}:commands — type to collapse{/white-fg}\n' + CMD_LINES);
  screen.render();
}

function collapseCmd() {
  cmdCollapsed = true;
  setCmdContent('{white-fg}:commands — type to expand{/white-fg}');
  screen.render();
}

function expandLang() {
  langCollapsed = false;
  setLangContent(`{white-fg}:language — type to collapse{/white-fg}\n{grey-fg}${buildLangList()}{/grey-fg}`);
  screen.realloc();
  screen.render();
}

function collapseLang() {
  langCollapsed = true;
  setLangContent(`{white-fg}:language — type to expand{/white-fg}`);
  screen.realloc();
  screen.render();
}

function collapseChat() {
  chatCollapsed = true;
  reflow();
  screen.realloc();
  screen.render();
}

function expandChat() {
  chatCollapsed = false;
  reflow();
  screen.realloc();
  screen.render();
}

function displayState() {
  const p = state.params;
  const stems = ['vocals', 'melody', 'bass', 'drums'];
  const stemLines = stems.map(n => {
    const s = state.stems[n];
    return `  ${n.padEnd(7)} slice:${s.id}  pos:${(s.pos*100).toFixed(0).padStart(3)}%  M:${String(s.C).padStart(5)}  E:${String(s.E).padStart(4)}  F:${(parseFloat(s.F)||0).toFixed(2)}  P:${String(s.P).padStart(5)}  H:${(parseFloat(s.H)||0).toFixed(2)}  T:${(parseFloat(s.T)||0).toFixed(2)}`;
  }).join('\n');
  logSys(
    `track: ${state.track}  bpm: ${state.bpm}  key: ${state.key}  running: ${state.running}\n` +
    `bars:${p.bars}  stay:${p.stay}  quant:${p.quant}\n` +
    stemLines
  );
}

function logUser(text) {
  appendLog(`${ts()}{${SKIN.user_fg}-fg}you:{/${SKIN.user_fg}-fg} ${text}`);
}

function logCricket(text) {
  appendLog(`${ts()}{cyan-fg}${state.agentName.toLowerCase()}:{/cyan-fg} ${text}`);
}

function buildStateContext() {
  const p = state.params;
  const stems = ['vocals', 'melody', 'bass', 'drums'];
  const stemInfo = stems.map(n => {
    const s = state.stems[n];
    return `  ${n}: slice ${s.id}, pos ${(s.pos * 100).toFixed(0)}%, M=${s.C}, E=${s.E}, F=${s.F}, P=${s.P}, H=${s.H}, T=${s.T}`;
  }).join('\n');
  return [
    `[current state]`,
    `track: ${state.track}  bpm: ${state.bpm}  key: ${state.key}`,
    `running: ${state.running}`,
    `params: bars=${p.bars} stay=${p.stay} quant=${p.quant}`,
    `stems:\n${stemInfo}`,
  ].join('\n');
}

let cricketThinking = false;
let cricketMsgCount = 0;  // used to throttle state injection

// Brew-style Braille spinner
const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let spinnerFrame = 0;
let spinnerTimer = null;


function startChatSpinner() {
  spinnerFrame = 0;
  spinnerTimer = setInterval(() => {
    if (!languageSelected) return;
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    sepBox.setContent(`{cyan-fg}${state.agentName.toLowerCase()} - loading{/cyan-fg} {white-fg}${SPINNER_FRAMES[spinnerFrame]}{/white-fg}`);
  }, 100);
}

function stopChatSpinner() {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  sepBox.setContent(languageSelected ? '' : '{white-fg}' + randCurse() + '{/white-fg}');
  scheduleRender();
}

function processReply(reply, onCommand) {
  // Strip any [current state] block Cricket echoes back
  const cleaned = reply.replace(/\[current state\][\s\S]*?(?=\n\n|\n[^\s]|$)/i, '').trim();

  const cmdPattern = new RegExp(`(?=\\b(${[...COMMANDS].join('|')})\\b)`, 'g');
  const lines = cleaned.split('\n').flatMap(line => {
    if (isCommand(line) && line.trim().split(cmdPattern).filter(Boolean).length > 1) {
      return line.trim().split(cmdPattern).filter(Boolean).map(s => s.trim());
    }
    return [line];
  });
  const proseLines = [];
  lines.forEach(line => {
    if (isCommand(line)) {
      if (proseLines.length) { logCricket(proseLines.join('\n')); proseLines.length = 0; }
      appendLog(`{grey-fg}: ${line.trim()}{/grey-fg}`);
      if (onCommand) onCommand(line.trim());
    } else {
      proseLines.push(line);
    }
  });
  if (proseLines.length) {
    const t = proseLines.join('\n').trim();
    if (t) logCricket(t);
  }
}

function callCricket(text, onCommand) {
  if (cricketThinking) return;
  cricketThinking = true;

  cricketMsgCount++;
  // Inject live state every 4 messages so Cricket stays grounded without
  // constantly pivoting the conversation back to EBYS status
  const contextualText = (cricketMsgCount % 4 === 1)
    ? buildStateContext() + '\n\n' + text
    : text;
  chatHistory.push({ role: 'user', content: contextualText });

  startChatSpinner();

  // Trim history — keep system prompt + last 20 exchanges to avoid context overflow
  const MAX_HISTORY = 41; // 1 system + 20 pairs
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory.splice(1, chatHistory.length - MAX_HISTORY);
  }

  const body = JSON.stringify({
    model:    CONFIG.ollama_model,
    messages: chatHistory,
    stream:   false,
  });

  function done() {
    cricketThinking = false;
    stopChatSpinner();
  }

  const req = http.request({
    hostname: CONFIG.ollama_host,
    port:     CONFIG.ollama_port,
    path:     '/api/chat',
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout:  60000,  // 60s timeout
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      done();
      try {
        const json  = JSON.parse(data);
        const reply = json.message?.content || '';
        if (!reply) { logSys('no response — check CONFIG.ollama_model'); return; }
        chatHistory.push({ role: 'assistant', content: reply });
        processReply(reply, onCommand);
      } catch (e) {
        logSys('parse error: ' + e.message);
      }
    });
  });

  req.on('timeout', () => {
    req.destroy();
    done();
    logSys('ollama timed out — model may be overloaded');
  });

  req.on('error', () => {
    done();
    logSys('ollama unreachable — is it running? (localhost:11434)');
  });
  req.write(body);
  req.end();
}

// ── MAX/MSP WEBSOCKET ─────────────────────────────────────────────────────────

let ws = null;
let maxWasConnected = false;
let pendingConfirm = null;   // set by :resetMemory; holds callback for 'yes' response

// Watchdog: ws_server.js is a hand-rolled WebSocket server with no ping/pong
// keepalive in either direction (confirmed — it discards client pings instead
// of answering them, and never sends its own). On localhost a hard TCP
// failure is rare, but a wedged/zombie connection where neither side's
// socket ever emits 'close' isn't impossible, and there's no other signal
// that would catch it: audio keeps playing server-side regardless (it has no
// dependency on the TUI), so the only symptom is this client silently
// stops receiving anything — which reads as "the progress bars filled up
// and stopped updating," since the local 250ms render tick (in
// ensurePlaybackRender) keeps computing elapsed-time-since-last-known-start
// forever with nothing ever resetting it. Track the last time ANY message
// arrived; if playback is supposed to be running and nothing has arrived
// for way longer than a segment ever legitimately takes, force a reconnect
// instead of waiting on a 'close' event that may never come.
let lastMsgAt = 0;
const WATCHDOG_TIMEOUT_MS = 20000; // segments/desc updates normally arrive every few seconds
let watchdogTimer = null;
let lastWsErrorLogAt = 0; // rate-limits the message-handler error log below
let wsConnErrorCount = 0;    // consecutive connect-error attempts (reset on 'open')
let lastWsConnErrorLogAt = 0; // rate-limits the connection-error log below

function connectToMax() {
  ws = new WebSocket(`ws://${CONFIG.ws_host}:${CONFIG.ws_port}`);
  lastMsgAt = Date.now();

  ws.on('open', () => {
    state.connected = true;
    maxWasConnected = true;
    lastMsgAt = Date.now();
    wsConnErrorCount = 0;
    logSys('connected to max');
    render();
    // Auto-build index so the flow is: pick language → set params → :start
    setTimeout(() => {
      sendToMax('buildIndex');
      logSys('→ buildIndex (auto)');
    }, 1500);
  });

  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (!state.connected || !state.running || playbackStopped) return;
    if (Date.now() - lastMsgAt > WATCHDOG_TIMEOUT_MS) {
      logSys('⚠ no data from max in ' + Math.round((Date.now() - lastMsgAt) / 1000)
             + 's while running — connection likely wedged, forcing reconnect');
      try { ws.terminate ? ws.terminate() : ws.close(); } catch (e) {}
      // 'close' handler below does the actual reconnect scheduling; this just
      // guarantees it actually fires instead of waiting indefinitely on a
      // socket event that a truly wedged connection may never emit.
    }
  }, 5000);

  ws.on('message', data => {
    lastMsgAt = Date.now();
    // Max sends JSON state updates:
    // { type: 'state', track, bpm, key, slices, running }
    // { type: 'stem',  name, id, pos, E, C }
    // { type: 'param', key, value }
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'state') {
        // Don't let Max overwrite bpm/key with empty/zero values — preserve what the user set
        if (msg.bpm === 0 || msg.bpm === undefined) delete msg.bpm;
        if (!msg.key || msg.key === '?') delete msg.key;
        const prevTrack = state.track;
        Object.assign(state, msg);
        if (state.track !== prevTrack) {
          updateGenreForTrack(state.track);
          updateBeatsForTrack(state.track);
        }
      } else if (msg.type === 'desc' && state.stems[msg.name]) {
        // desc always arrives before seg (slicer.js outlet order) — just update state.
        // Novelty is computed when seg arrives, at which point state already has fresh descriptors.
        Object.assign(state.stems[msg.name], msg);
      } else if (msg.type === 'started') {
        // slicer.js emits "started" after all selectSegments fire in start().
        // Clears the stopped flag so the progress-bar render loop resumes.
        playbackStopped = false;
        state.running   = true;
        ensurePlaybackRender();
        scheduleRender();
      } else if (msg.type === 'segPlayMs') {
        // Actual playback duration from slicer: content_dur × stretchRatio.
        // This is what karma~ physically plays — use it for the progress bar.
        const sn = msg.name;
        if (sn && state.stems[sn] && msg.ms > 0) {
          state.stems[sn].segDurMs = msg.ms;
        }
      } else if (msg.type === 'segRetime') {
        // Live tempo change mid-segment (:setGlobalBPM/:setFallbackBPM while
        // running — see slicer.js's applyGlobalBPMLive) retimed karma~'s
        // actual playback speed for whatever this stem is currently
        // playing. msg.remainingMs is wall-clock time left, from now, until
        // this segment naturally ends at the NEW speed. stemSliceStartTime/
        // segDurMs were captured once at segment start under the OLD speed
        // and never touched again — left as-is, the bar's fill (elapsed /
        // segDurMs) would silently drift from the real audio: finish early
        // and sit pinned at 100% if tempo just dropped, or undershoot and
        // jump forward abruptly at the real end if tempo just rose.
        //
        // Fix: solve for a virtual (startTime, segDurMs) pair that (a)
        // reproduces the CURRENT fill % at this exact instant — so nothing
        // visibly snaps — and (b) reaches exactly 100% after remainingMs at
        // the new rate. Naively overwriting segDurMs alone can't do both,
        // since elapsed/segDurMs is one straight line and the fill needs to
        // change slope right at "now" while staying continuous.
        const sn = msg.name;
        const s  = state.stems[sn];
        if (sn && s && msg.remainingMs > 0 && stemSliceStartTime[sn]) {
          const oldSegDurMs = s.segDurMs || 0;
          const elapsed0    = Date.now() - stemSliceStartTime[sn];
          let progress0     = oldSegDurMs > 0 ? elapsed0 / oldSegDurMs : 0;
          progress0 = Math.max(0, Math.min(0.98, progress0)); // guard the /(1-progress0) below
          const newSegDurMs = msg.remainingMs / (1 - progress0);
          stemSliceStartTime[sn] = Date.now() - Math.round(progress0 * newSegDurMs);
          s.segDurMs = Math.round(newSegDurMs);
        }
      } else if (msg.type === 'stem' && state.stems[msg.name]) {
        // seg arrives after desc, so state.stems[sn] already holds this slice's descriptors.
        // Compute novelty immediately — no timer, no pending flag.
        //
        // This used to gate the reset on `msg.id !== state.stems[name].id` — i.e. trust
        // the patch only if the id string looked different from last time. That's a
        // proxy for "did it actually change," and proxies can be wrong: a locked
        // follower's id could repeat (or, before that was fixed, always be the same
        // literal string) even though slicer.js had genuinely started a new segment,
        // and the bar would sit frozen mid-fill while the real audio had already moved
        // on — the patch and the TUI disagreeing about what's currently playing.
        // A "seg" message arriving at all IS the ground truth that a new segment just
        // started — slicer.js only ever sends one per real segment start (normal pick,
        // synced push, or loop cycle). Trust it unconditionally instead of re-deriving
        // "did it change" from a string comparison that can itself be wrong.
        const sn = msg.name;
        stemSliceStartPos[sn]  = parseFloat(msg.pos) || 0;
        stemSliceStartTime[sn] = Date.now();
        stemSliceEndTime[sn]   = null; // clear end marker — new segment starting
        playbackStopped        = false; // defensive: clear stopped flag on new segment
        Object.assign(state.stems[msg.name], msg);
        if (msg.pos !== undefined) state.stems[msg.name].lastPosTime = Date.now();
        if (!state.running) { state.running = true; ensurePlaybackRender(); }
      } else if (msg.type === 'stemTrack' && state.stems[msg.name]) {
        state.stems[msg.name].track = msg.track || '';
        // Update this stem's genre independently from its actual source track.
        // Without this, all stems share the genre of the main loaded track,
        // causing classical/other genres to appear as the main track's genre.
        if (msg.track) {
          const g = getGenreForTrack(msg.track);
          if (g.genre) {
            state.stems[msg.name].genre     = g.genre;
            state.stems[msg.name].genreConf = g.confidence;
          }
        }
      } else if (msg.type === 'playFullFile') {
        // From slicer.js's outlet(1, "playFullFile", track|"all", 0|1) —
        // fires on an explicit :chunkMode AND implicitly whenever
        // :setSegmentBars is used (that command always clears it). Drives
        // the [CHUNK MODE ON/OFF] header indicator.
        const v = !!msg.value;
        if (msg.track === 'all') {
          Object.keys(state.playFullFile).forEach(t => { state.playFullFile[t] = v; });
        } else if (state.playFullFile.hasOwnProperty(msg.track)) {
          state.playFullFile[msg.track] = v;
        }
      } else if (msg.type === 'stemSource' && state.stems[msg.name]) {
        // From ws_server.js's stemSource handler — set via :setStemSource, cleared
        // via :setStemSource <stem> clear. Drives the pin indicator in the
        // playback bar (see pinMark in render()).
        state.stems[msg.name].pinnedSource = msg.pinnedSource || null;
        scheduleRender();
      } else if (msg.type === 'stemDurMs' && state.stems[msg.track]) {
        state.stems[msg.track].durMs = msg.ms;
      } else if (msg.type === 'segmentEnd') {
        // Fired by slicer.js next(track) the instant the Max delay expires = karma~ done.
        // Snaps bar to 100% at the precise moment audio ends.
        const sn = msg.name;
        if (sn && stemSliceStartTime[sn]) {
          const actual    = Date.now() - stemSliceStartTime[sn];
          const estimated = (state.stems[sn] && state.stems[sn].segDurMs) || 0;
          if (estimated > 0) {
            const diff = actual - estimated;
            stemLearnedExtra[sn] = stemLearnedExtra[sn] !== undefined
              ? stemLearnedExtra[sn] * 0.6 + diff * 0.4
              : diff;
          }
        }
        stemSliceEndTime[sn] = Date.now(); // snap bar to 100% immediately
        scheduleRender();
      } else if (msg.type === 'vu') {
        if (vuLevels[msg.name]) {
          if (msg.FL !== undefined) {
            vuLevels[msg.name].FL = parseFloat(msg.FL) || 0;
            vuLevels[msg.name].FR = parseFloat(msg.FR) || 0;
            vuLevels[msg.name].RL = parseFloat(msg.RL) || 0;
            vuLevels[msg.name].RR = parseFloat(msg.RR) || 0;
          } else if (msg.level !== undefined) {
            const l = parseFloat(msg.level) || 0;
            vuLevels[msg.name].FL = vuLevels[msg.name].FR =
            vuLevels[msg.name].RL = vuLevels[msg.name].RR = l;
          }
          // Snap each channel's peak-hold up instantly to this new reading —
          // same "snap up now, release down later in peakDecayTick()"
          // convention as state.lufsPeak/dbfsPeak.
          const pk = vuPeaks[msg.name];
          ['FL', 'FR', 'RL', 'RR'].forEach(ch => {
            const db = levelToDb(vuLevels[msg.name][ch]);
            if (pk[ch] === null || db > pk[ch]) pk[ch] = db;
          });
        }
      } else if (msg.type === 'lufs') {
        // fluid.loudness~ perceptual loudness (K-weighted dBFS), sampled at 10 Hz
        // short     = short-term loudness  → state.lufs  (displayed as LUFSs in header)
        // integrated = integrated loudness → state.dbfs  (displayed as LUFSi in header)
        const s = parseFloat(msg.short);
        const i = parseFloat(msg.integrated);
        if (isFinite(s)) {
          state.lufs = s;
          if (state.lufsPeak === null || s > state.lufsPeak) state.lufsPeak = s;
        }
        if (isFinite(i)) {
          state.dbfs = i;
          if (state.dbfsPeak === null || i > state.dbfsPeak) state.dbfsPeak = i;
        }
      } else if (msg.type === 'slice_ms' && state.stems[msg.name]) {
        state.stems[msg.name].timeMs = msg.timeMs || 0;
        // Reset elapsed-time anchor so the smooth-count starts from this slice position
        state.stems[msg.name].lastPosTime = Date.now();
      } else if (msg.type === 'entropy') {
        state.params.entropy   = msg.value;
        state.params.matchProb = msg.matchProb;
      } else if (msg.type === 'matchProb') {
        state.params.matchProb = msg.value;
      } else if (msg.type === 'session') {
        // From ws_server.js's :sessionOpen/:sessionClose — drives the $ status icon.
        state.session = { active: !!msg.active, sessionId: msg.sessionId || null, deck: msg.deck || null };
      } else if (msg.type === 'lastTouchedParam') {
        // Live readout of what LINK's missile switch would fire right now.
        state.lastCommandTouched = msg.atoms || null;
      } else if (msg.type === 'linkMissile' && msg.event === 'fire_executed') {
        // ws_server.js's applyMissileParam() broadcasts this to every
        // connected client the instant a fire actually applies — whether it
        // was this deck's own :link fire or a remote peer's. Drives the
        // brief flash on the LINK icon in the header.
        state.linkFiredAt = Date.now();
        scheduleRender();
      } else if (msg.type === 'param' && msg.key === 'recording') {
        // Special-cased rather than folded into state.params below — recording
        // drives its own status icon, not a descriptor-matching param.
        state.recording = !!msg.value;
      } else if (msg.type === 'param' && msg.key === 'masterJoystick') {
        // Live master spatial position — drives the "mst" spatial frame next
        // to the VU sidebar. Shape differs from the generic {key,value}
        // params below (carries x/y instead of value), so it needs its own
        // branch.
        const sp = state.spatial.master;
        if (typeof msg.x === 'number') sp.x = Math.max(-1, Math.min(1, msg.x));
        if (typeof msg.y === 'number') sp.y = Math.max(-1, Math.min(1, msg.y));
      } else if (msg.type === 'param' && msg.key === 'joystick') {
        // Live per-stem spatial position (:joystick <stem> <x> <y>). `stem`
        // arrives as the original target — 'all' expands to every stem here,
        // same as ws_server.js does server-side for state.ms.joy. By the time
        // a message lands here with key 'joystick', ws_server.js has already
        // confirmed msg.stem is a real stem name (vocals/melody/bass/drums/
        // live1/live2/all) — any omitted or invalid stem (including a literal
        // "master") gets rerouted server-side to broadcast key 'masterJoystick'
        // instead (handled in the branch above), so this branch never needs
        // to touch state.spatial.master itself.
        const targets = msg.stem === 'all' ? ['vocals', 'melody', 'bass', 'drums'] : [msg.stem];
        targets.forEach(s => {
          const sp = state.spatial[s];
          if (!sp || s === 'master') return;
          if (typeof msg.x === 'number') sp.x = Math.max(-1, Math.min(1, msg.x));
          if (typeof msg.y === 'number') sp.y = Math.max(-1, Math.min(1, msg.y));
        });
      } else if (msg.type === 'param' && msg.key === 'width') {
        // Live per-stem M/S width (:width <stem> <0-1>) — drives the fill
        // creeping around each spatial frame's border ring. `stem` arrives as
        // the original target ('all' expands here, mirroring ws_server.js);
        // targets outside vocals/melody/bass/drums (e.g. live1/live2) are
        // silently ignored — there's no real :width target for those.
        // ws_server.js normalizes 'master' to 'all' before this ever arrives,
        // so msg.stem is never literally 'master' here — but when it IS
        // 'all', the "mst" ring gets the same value too: there's no separate
        // master-width DSP parameter, :width all *is* what :width master
        // means, so the master ring should visibly track it instead of
        // sitting frozen at its old default.
        const targets = msg.stem === 'all' ? ['vocals', 'melody', 'bass', 'drums'] : [msg.stem];
        targets.forEach(s => {
          const sp = state.spatial[s];
          if (!sp || s === 'master' || typeof msg.value !== 'number') return;
          sp.width = Math.max(0, Math.min(1, msg.value));
        });
        if (msg.stem === 'all' && typeof msg.value === 'number') {
          state.spatial.master.width = Math.max(0, Math.min(1, msg.value));
        }
      } else if (msg.type === 'param' && msg.key === 'sourceLock') {
        // Confirmed lock state from slicer.js itself (via ws_server's
        // Max.addHandler('lockSource'/'unlockSource') — not an optimistic
        // echo of the command). msg.leader === null means msg.follower was
        // unlocked; otherwise msg.follower now draws from msg.leader.
        if (state.sourceLock.hasOwnProperty(msg.follower)) {
          state.sourceLock[msg.follower] = msg.leader || null;
        }
      } else if (msg.type === 'param' &&
                 /^(weight[CSEFPHT]|dir[CSEFPHT]|matchProb|dirWeight)_(vocals|melody|bass|drums)$/.test(msg.key || '')) {
        // Per-stem weight/match/dir feedback from slicer.js — e.g.
        // "weightC_vocals", "dirE_melody", "matchProb_bass", "dirWeight_drums".
        // Confirmed values only (no optimistic local echo for these — there
        // never was one even before per-stem, :setWeight/:setMatchProb/
        // :setDirPref/:setDirWeight fall straight through to sendToMax() with
        // no client-side prediction), so this is the only place these numbers
        // ever actually update.
        const m = msg.key.match(/^(weight[CSEFPHT]|dir[CSEFPHT]|matchProb|dirWeight)_(vocals|melody|bass|drums)$/);
        const field = m[1], stemName = m[2];
        if (state.paramsPerStem[stemName] && state.paramsPerStem[stemName].hasOwnProperty(field)) {
          state.paramsPerStem[stemName][field] = msg.value;
        }
      } else if (msg.type === 'param') {
        // Accept both new names (matchM/dirM) and legacy (matchC/dirC)
        const keyMap = { matchC: 'matchM', dirC: 'dirM', weightC: 'weightM', window: 'envelope' };
        const k = keyMap[msg.key] || msg.key;
        if (state.params.hasOwnProperty(k)) state.params[k] = msg.value;
        // Mirror gain/mute/masterGain/globalBPM into dedicated state fields
        const gainMatch = msg.key && msg.key.match(/^gain_(\w+)$/);
        const muteMatch = msg.key && msg.key.match(/^mute_(\w+)$/);
        if (gainMatch && state.gain[gainMatch[1]] !== undefined) state.gain[gainMatch[1]] = msg.value;
        if (muteMatch && state.mute[muteMatch[1]] !== undefined) state.mute[muteMatch[1]] = msg.value;
        if (msg.key === 'masterGain') state.masterGain = msg.value;
        if (msg.key === 'globalBPM') state.globalBPM = parseFloat(msg.value) || 0;
      } else if (msg.type === 'segmentBars') {
        // { type:'segmentBars', track:'drums'|'all', value:2 }
        const stems = msg.track === 'all' ? ['vocals','melody','bass','drums'] : [msg.track];
        stems.forEach(n => { if (state.stems[n]) state.stems[n].bars = msg.value; });
      } else if (msg.type === 'triggerMode') {
        // { type:'triggerMode', track:'vocals'|'all', value:0|1 }
        const stems = msg.track === 'all' ? ['vocals','melody','bass','drums'] : [msg.track];
        stems.forEach(n => {
          if (state.triggerMode.hasOwnProperty(n)) state.triggerMode[n] = !!msg.value;
          // Leaving trigger mode also clears ready flag
          if (!msg.value && state.triggerReady.hasOwnProperty(n)) state.triggerReady[n] = false;
        });
      } else if (msg.type === 'triggerReady') {
        // { type:'triggerReady', track:'vocals', value:0|1 }
        if (state.triggerReady.hasOwnProperty(msg.track)) {
          state.triggerReady[msg.track] = !!msg.value;
        }
      } else if (msg.type === 'stayProb') {
        // { type:'stayProb', track:'bass'|'all', value:0.5 }
        const stems = msg.track === 'all' ? ['vocals','melody','bass','drums'] : [msg.track];
        stems.forEach(n => { if (state.stems[n]) state.stems[n].stay = msg.value; });
      } else if (msg.type === 'fileDetected') {
        logSys(`[+] new file: ${msg.filename}`);
        startSpinner('queued…');
      } else if (msg.type === 'pipelineStage') {
        const { stage, status, track, percent } = msg;
        if (status === 'start') {
          if (stage === 'demucs') {
            startSpinner('demucs 0%');
            logSys(`→ Demucs: separating "${track}" …`);
          } else if (stage === 'genre') {
            startSpinner('genre…');
            logSys('→ Essentia: classifying genre …');
          } else if (stage === 'madmom') {
            startSpinner('madmom…');
            logSys('→ madmom: detecting beats …');
          }
        } else if (status === 'progress' && stage === 'demucs') {
          const pct    = percent || 0;
          const filled = Math.round(pct / 10);
          spinLabel    = 'demucs';
          spinProgress = '█'.repeat(filled) + '░'.repeat(10 - filled) + ' ' + pct + '%';
          scheduleRender();
        } else if (status === 'done') {
          if (stage === 'demucs') logSys('✓ Demucs done — stems separated');
          else if (stage === 'genre') logSys('✓ genre classified');
          else if (stage === 'madmom') { logSys('✓ beats detected'); stopSpinner(); }
        } else if (status === 'error') {
          const errMsg = msg.msg || '';
          logSys(`✗ ${stage} FAILED ${errMsg} — check watchdemucs.log`);
          stopSpinner();
        }
      } else if (msg.type === 'streamUpdated') {
        // watch_demucs.py finished: genre + madmom written to disk, FluCoMa starting now.
        logSys('✓ genre + beats ready — starting FluCoMa…');
        reloadGenreDb();
        reloadBeatsDb();
        updateGenreForTrack(state.track);
        updateBeatsForTrack(state.track);
        if (spinLabel !== 'flucoma…') startSpinner('flucoma…');
        startFlucomaProgress();
        // Safety fallback: stop spinner after 5 min if analysisDone never arrives
        setTimeout(() => { if (spinLabel === 'flucoma…') { stopSpinner(); logSys('⚠ analysisDone not received — spinner stopped'); } }, 5 * 60 * 1000);
      } else if (msg.type === 'umapDone') {
        loadUmapDb();
        loadStemRanges();
        logSys('✓ UMAP ready — descriptor grids updated');
        scheduleRender();
      } else if (msg.type === 'sys' && msg.msg) {
        // Generic status-line broadcast from ws_server.js (session open/close,
        // :tag/:score confirmations, LINK status, and now slicer.js's own
        // downbeats-reload report via its sysMsg outlet). This branch didn't
        // exist before — every one of those broadcasts was silently dropped
        // here with no visible effect in the TUI at all, so commands like
        // :reloadDownbeats appeared to do nothing even when they'd actually
        // worked (or genuinely failed) on the Max side.
        logSys(msg.msg);
      } else if (msg.type === 'analysisDone') {
        // Live completion signal from Max — run the post-FluCoMa pipeline.
        completeAnalysis();
      } else if (msg.type === 'analysisAlreadyDone') {
        // Sent by ws_server.js either on connect, or in reply to our
        // queryAnalysisDone poll, when it already knows analysis is complete
        // (e.g. the real 'analysisDone' broadcast was lost while this TUI was
        // reconnecting, or arrived while ws_server was restarting — see the
        // comment in ws_server.js for why that can happen).
        //
        // Only acts when a flucoma spinner is genuinely waiting — that means a
        // fresh :analyzeAll is in flight whose completion side-effects
        // (add_tension.py + buildIndex) never ran, so run the FULL pipeline to
        // recover, not just stop the spinner. When NO flucoma spinner is up
        // (e.g. the every-boot reconnect notice), this no-ops — preserving the
        // fix for the double-buildIndex-on-every-boot bug. completeAnalysis()'s
        // own guard prevents a double-run if the live analysisDone also lands.
        if (spinLabel === 'flucoma…') {
          logSys('✓ analysis completed — recovered a lost analysisDone');
          completeAnalysis();
        }
      }
      scheduleRender();
    } catch (e) {
      // This used to be a silent catch(_) {} — meaning if any message ever
      // threw partway through processing (malformed data, an edge case only
      // reached after a long session, etc.), there was zero visibility into
      // it: no crash, no log line, nothing. If the SAME message type keeps
      // arriving and keeps throwing at the same point every time (e.g. a
      // 'stem' broadcast that always dies before reaching the code that
      // resets the progress-bar timer), the result looks exactly like "the
      // bars filled up and stopped updating" with no clue why. Log it now —
      // rate-limited so a recurring failure doesn't spam the log every time
      // a message arrives.
      const now = Date.now();
      if (now - lastWsErrorLogAt > 5000) {
        lastWsErrorLogAt = now;
        logSys('⚠ WS message handler error: ' + (e && e.message ? e.message : e));
      }
    }
  });

  ws.on('close', () => {
    state.connected = false;
    if (maxWasConnected) logSys('disconnected from max');
    maxWasConnected = false;
    render();
    setTimeout(connectToMax, CONFIG.reconnect_ms);
  });

  // Previously a no-op — relying on 'close' always firing after 'error' is
  // an assumption, not a guarantee, for every possible underlying socket
  // failure. Log it and force a close so the reconnect logic above is
  // guaranteed to run either way, instead of risking a connection that's
  // errored but never formally closes.
  ws.on('error', (e) => {
    // While waiting for Max's ws_server to come up (or after it drops), the
    // reconnect loop below retries every CONFIG.reconnect_ms — each attempt
    // hits the same "nobody's listening" condition and throws the identical
    // error (often an AggregateError wrapping ECONNREFUSED on every resolved
    // address), so this used to print one full identical line per retry,
    // flooding the log with dozens of copies of the same non-information and
    // pushing genuinely useful lines out of the visible scrollback. Log the
    // first attempt immediately (so a real problem is still visible right
    // away), then collapse further repeats to at most once every 15s with an
    // attempt count, instead of one line per retry.
    const msg = (e && e.message) ? e.message : String(e);
    wsConnErrorCount++;
    const now = Date.now();
    if (wsConnErrorCount === 1 || now - lastWsConnErrorLogAt > 15000) {
      lastWsConnErrorLogAt = now;
      const suffix = wsConnErrorCount > 1 ? ` (${wsConnErrorCount} attempts so far, still retrying)` : '';
      logSys('⚠ WS error: ' + msg + suffix);
    }
    try { ws.terminate ? ws.terminate() : ws.close(); } catch (_) {}
  });
}

// ── EBYS LINK IPC ─────────────────────────────────────────────────────────────
// Talks to link_server.js (separate process) via localhost UDP.
//   TUI → link_server  : port 9001  (TOUCH / MISSILE / LINK_ON / etc.)
//   link_server → TUI  : port 9002  (incoming peer SET commands)

const LINK_IPC_SEND = 9001;   // port link_server listens on
const LINK_IPC_RECV = 9002;   // port we listen on for incoming peer params

// Keys whose values we track for missile switch + state dump
const LINK_TRACKED_VERBS = new Set([
  'setGlobalBPM', 'setFallbackBPM', 'setEntropy', 'setMatchProb',
  'setWeight', 'setDirPref', 'setDirWeight',
  'setStemGain', 'setMasterGain', 'fxSend',
  'eqLow', 'eqMid', 'eqMidFreq', 'eqHigh', 'trim',
]);

const linkSock = dgram.createSocket('udp4');

// Receive incoming peer params and apply them locally (as if user typed them).
// reuseAddr + an error handler so that during a :logout/:switchSession respawn
// — when the outgoing process still briefly holds LINK_IPC_RECV while the new
// process is starting — binding this port doesn't throw EADDRINUSE and crash
// the fresh TUI. Worst case LINK peer-sync is quiet for a moment; nothing else
// is affected.
const linkRecvSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
linkRecvSock.on('error', (e) => {
  try { logSys('⚠ LINK recv socket ' + (e && e.code || e) + ' — peer sync paused'); } catch (_) {}
});
// Expand a link key back into a Max command.
// "setWeight_vocals_C"  → "setWeight vocals C"
// "setStemGain_vocals"  → "setStemGain vocals"
// "setEntropy"          → "setEntropy"
// "eqLow_bass"          → "eqLow bass"
// All verbs in LINK_TRACKED_VERBS are camelCase with no underscores,
// so a simple underscore→space expansion reconstructs the original command.
function expandLinkKey(key) {
  return key.replace(/_/g, ' ');
}

linkRecvSock.on('message', (buf) => {
  const line  = buf.toString().trim();
  const parts = line.split(' ');
  if (parts[0] === 'SET' && parts[1] && parts[2] !== undefined) {
    const cmd = expandLinkKey(parts[1]) + ' ' + parts[2];
    sendToMax(cmd);
    logSys('← LINK ' + cmd);
  } else if (parts[0] === 'PEER_OFFLINE') {
    logSys('⚠ LINK peer offline');
  } else if (parts[0] === 'PEER_ONLINE') {
    logSys('✓ LINK peer connected');
  }
});
linkRecvSock.bind(LINK_IPC_RECV);

function linkSend(msg) {
  const buf = Buffer.from(msg);
  linkSock.send(buf, 0, buf.length, LINK_IPC_SEND, '127.0.0.1');
}

// Notify link_server that a parameter was touched (updates last-touched register)
function linkTouch(command) {
  const parts = command.trim().split(/\s+/);
  if (!LINK_TRACKED_VERBS.has(parts[0])) return;
  // Flatten verb + args into a single key: e.g. "setWeight vocals C 0.8" → key="weight_vocals_C"
  // For simplicity, use the full command string as key/value split at verb
  const key   = parts[0] + '_' + parts.slice(1, -1).join('_');
  const value = parts[parts.length - 1];
  linkSend(`TOUCH ${key} ${value}`);
}

// ─────────────────────────────────────────────────────────────────────────────

function sendToMax(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', text: command }));
  }
  linkTouch(command);   // always notify link_server, it filters by verb
}

// Expand :selectRange vocals C:200,2000 F:0.2,0.8  →  selectRange vocals 200 2000 -1e9 1e9 0.2 0.8 -1e9 1e9
function expandSelectRange(body) {
  const parts = body.trim().split(/\s+/);
  if (parts[0] !== 'selectRange') return body;
  let i = 1;
  let stem = null;
  if (parts[1] && !/^[CEFPcefp]:/.test(parts[1])) { stem = parts[1]; i = 2; }
  const ranges = { C: null, E: null, F: null, P: null };
  for (; i < parts.length; i++) {
    const m = parts[i].match(/^([CEFPcefp]):([-\d.]+),([-\d.]+)$/);
    if (m) ranges[m[1].toUpperCase()] = [parseFloat(m[2]), parseFloat(m[3])];
  }
  const INF = 1e9;
  const r = d => ranges[d] ? ranges[d] : [-INF, INF];
  const args = [...r('C'), ...r('E'), ...r('F'), ...r('P')].join(' ');
  return stem ? `selectRange ${stem} ${args}` : `selectRange ${args}`;
}

// ── INPUT HANDLING ────────────────────────────────────────────────────────────

function handleInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Two-step confirmation gate (e.g. :resetMemory, :resetAll)
  if (pendingConfirm) {
    const ans = trimmed.toLowerCase().replace(/^[:@]/, '').trim();
    if (ans === 'y' || ans === 'yes') {
      pendingConfirm();
    } else {
      logSys('cancelled');
    }
    pendingConfirm = null;
    return;
  }

  // Shared language lookup — works for number, @number, name, @name, code
  function findLang(query) {
    const q = query.replace(/^[@:]/, '').trim();
    const n = parseInt(q);
    return (!isNaN(n) && LANGUAGES[n - 1])
      || LANGUAGES_BASE.find(l =>
           l.label.toLowerCase().startsWith(q.toLowerCase()) ||
           l.code.toLowerCase() === q.toLowerCase()
         );
  }

  // Language selection gate — number, @name, or :name
  if (!languageSelected) {
    const n = parseInt(trimmed);
    const byNumber = !isNaN(n) && LANGUAGES[n - 1];
    const byAt     = trimmed.startsWith('@') ? findLang(trimmed) : null;
    const byColon  = trimmed.startsWith(':') ? findLang(trimmed) : null;
    const lang = byNumber || byAt || byColon;
    if (lang) {
      languageSelected = true;
      applyLanguage(lang);
    } else {
      logSys('🦗');
    }
    return;
  }

  // @ prefix: commands take priority, then language switching
  if (trimmed.startsWith('@') || trimmed.startsWith(':')) {
    const prefix = trimmed[0];
    const body   = trimmed.slice(1).trim();
    const parts  = body.split(/\s+/);
    const verb   = parts[0];

    // :resetPeaks — clear the LUFS/TP peak-hold markers (see dbMeter()).
    // Purely client-side/TUI state, nothing to forward to Max.
    if (verb === 'resetPeaks') {
      state.lufsPeak = null;
      state.dbfsPeak = null;
      logSys('peak-hold cleared (LUFSs/TP)');
      render();
      return;
    }

    // :wmdScope <all|vocals|melody|bass|drums> — which stem's weight/match/dir
    // values the header rows display (and which :setWeight/:setMatchProb/
    // :setDirPref/:setDirWeight target when you use those commands' own
    // <stem|all> argument — this only changes the DISPLAY, it doesn't send
    // anything to Max by itself). Purely client-side TUI state.
    if (verb === 'wmdScope') {
      const target = (parts[1] || '').toLowerCase();
      if (['all', 'vocals', 'melody', 'bass', 'drums'].includes(target)) {
        state.wmdScope = target;
        logSys('weight/match/dir scope → [' + target + ']');
        render();
      } else {
        logSys('usage: :wmdScope all|vocals|melody|bass|drums  (current: [' + state.wmdScope + '])');
      }
      return;
    }

    // :bakeloop <bars> — set the loop window length
    if (verb === 'bakeloop') {
      const n = parseFloat(parts[1]);
      if (!isNaN(n) && n > 0) {
        bakeLoopBars = n;
        logSys('bake loop window: ' + bakeLoopBars + ' bars ('
               + Math.round(bakeLoopMs() / 1000) + 's @ ' + (state.bpm || 120) + ' BPM)');
      } else {
        logSys('bakeloop: current = ' + bakeLoopBars + ' bars  usage: :bakeloop <bars>');
      }
      return;
    }

    // :bake — training bracket commands
    if (verb === 'bake') {
      const sub = parts[1];

      // :bake start <prompt>
      if (sub === 'start') {
        if (bakeSessionActive) {
          logSys('bake already running — :bake abort first');
          return;
        }
        const label = parts.slice(2).join(' ');
        if (!label) { logSys('usage: :bake start <prompt>'); return; }

        // 1. Take ring buffer snapshot
        sendToMax('bakeSnapshot');

        // 2. Send label to Cricket (first attempt translation)
        bakeIntent      = label;
        bakeCricketCmds = [];
        bakeUserCmds    = [];
        callCricket(label, cmd => {
          const p = cmd.trim().split(/\s+/);
          if ((p[0] === 'setGlobalBPM' || p[0] === 'setFallbackBPM') && parseFloat(p[1]) > 0) {
            state.bpm = parseFloat(p[1]); render();
          }
          bakeCricketCmds.push(cmd.trim());
          sendToMax(expandSelectRange(cmd));
        });

        // 3. Start loop timer — loop resets to snapshot every N bars
        startBakeLoop(label);
        return;
      }

      // :bake end — queue close at next loop boundary
      if (sub === 'end') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        bakeEndQueued = true;
        logSys('bake: close queued — will store at next loop boundary');
        return;
      }

      // :bake abort — stop immediately, discard
      if (sub === 'abort') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        stopBakeLoop(false);
        return;
      }

      // :bake (no subcommand) — legacy: save current intent + corrections as a one-shot snapshot
      if (!bakeIntent) { logSys('nothing to bake — send a message to Cricket first'); return; }
      const snapshot = {
        intent:           bakeIntent,
        cricket_cmds:     bakeCricketCmds.slice(),
        user_corrections: bakeUserCmds.slice(),
        final_cmds:       [...bakeCricketCmds, ...bakeUserCmds],
      };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'bake', ...snapshot }));
      }
      logSys('🫳 baked — intent: "' + bakeIntent + '"  cricket: '
             + bakeCricketCmds.length + ' cmds  corrections: ' + bakeUserCmds.length);
      return;
    }

    // :resetMemory — two-step confirmation to wipe all analysis data
    if (verb === 'resetMemory') {
      logSys('⚠  This will erase ALL analysis data and reset the counter.');
      logSys('Type Y to confirm, anything else to cancel.');
      pendingConfirm = () => {
        sendToMax('resetMemory');
        logSys('→ memory cleared');
        render();
      };
      return;
    }

    // :switchSession / :logout — return to the session picker. Rather than
    // trying to hot-swap DATA_DIR and every path/DB derived from it (genreDb,
    // beatsDb, the analysis library, umap/ranges caches, all the WS/Max
    // wiring) in-process, this destroys the blessed screen (restoring the
    // terminal to normal mode), spawns a fresh sdj-tui.js login process
    // in the SAME terminal (stdio: 'inherit'), and exits once that child
    // exits. The new process re-derives every session-scoped const from
    // scratch at module load, which is the same one-shot load path every
    // normal boot already goes through — no partial-reload bugs possible.
    if (verb === 'switchSession' || verb === 'logout') {
      // With a name argument (:switchSession <name>) switch straight to that
      // session, skipping the picker — resolved by name (case-insensitive) or
      // id. A locked target still routes through the picker so it can be
      // unlocked. With no name (or :logout) just open the picker.
      const targetName = parts.slice(1).join(' ').trim();
      let targetId = null;
      if (verb === 'switchSession' && targetName) {
        const sessions = sessionMgr.listSessions();
        const match = sessions.find(s =>
          s.name.toLowerCase() === targetName.toLowerCase() || s.id === targetName);
        if (!match) {
          logSys(`✗ no session "${targetName}" — available: ${sessions.map(s => s.name).join(', ') || '(none)'}`);
          return;
        }
        if (match.id === sessionMgr.getActiveSessionId()) {
          logSys(`already on session "${match.name}"`);
          return;
        }
        if (match.passwordHash) {
          logSys(`→ "${match.name}" is locked — opening picker to unlock…`);
        } else {
          targetId = match.id;
          logSys(`→ switching to "${match.name}"…`);
        }
      } else {
        logSys('→ returning to session picker…');
      }
      render();
      setImmediate(() => {
        try { screen.destroy(); } catch (e) { /* best-effort */ }
        // This process stays alive to hold the terminal until the child exits,
        // so it must FIRST release the resources the child's fresh app.js will
        // re-acquire — otherwise the child's bind of UDP LINK_IPC_RECV hits
        // EADDRINUSE and the reconnected TUI crashes ("can't connect back").
        try { linkRecvSock.close(); } catch (e) {}
        try { linkSock.close(); } catch (e) {}
        try { if (ws) ws.close(); } catch (e) {}
        // Pass the resolved id (open sessions only) so sdj-tui.js auto-launches
        // it and skips the picker; locked/absent → no arg → normal picker.
        const argv = [path.join(__dirname, 'sdj-tui.js')];
        if (targetId) argv.push(targetId);
        const child = spawn(process.execPath, argv, { stdio: 'inherit' });
        child.on('exit', code => process.exit(code || 0));
      });
      return;
    }

    // :tagBeats — run madmom tagger on all stems
    if (verb === 'tagBeats')   { if (!taggerRunning) { taggerRunning = true; runMadmomTagger(() => { taggerRunning = false; reloadBeatsDb(); updateBeatsForTrack(state.track); scheduleRender(); }); } else { logSys('tagger already running'); } return; }

    // :analyzeAll — run genre + madmom on all tracks in htdemucs
    if (verb === 'analyzeAll') { runFullAnalysis(); return; }

    // :resetAll — two-step confirmation: wipe everything and restart from scratch
    if (verb === 'resetAll') {
      logSys('⚠  RESET ALL — this will permanently delete:');
      logSys('   stems/htdemucs/  ·  raw_uploads/  ·  temp/');
      logSys('   analysis_library.json  ·  genres.json  ·  downbeats.json  ·  stream.txt');
      logSys('   Max slicer memory  ·  watch_demucs service');
      logSys('Type Y to confirm, anything else to cancel.');
      pendingConfirm = () => {
        logSys('→ wiping…');
        scheduleRender();
        setImmediate(() => {
          const { exec } = require('child_process');
          const DATA = DATA_DIR; // active session's data dir — see DATA_DIR above
          const errors = [];
          const wipe = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { errors.push(e.message); } };
          const writeEmpty = (p, content) => { try { fs.writeFileSync(p, content, 'utf8'); } catch (e) { errors.push(e.message); } };

          // 1. Empty stems/htdemucs/ (delete all track folders inside, keep the dir)
          const htRoot = path.join(DATA, 'stems', 'htdemucs');
          if (fs.existsSync(htRoot)) {
            for (const entry of fs.readdirSync(htRoot)) {
              wipe(path.join(htRoot, entry));
            }
          }

          // 2. Empty raw_uploads/
          const rawUploads = path.join(DATA, 'raw_uploads');
          if (fs.existsSync(rawUploads)) {
            for (const entry of fs.readdirSync(rawUploads)) {
              wipe(path.join(rawUploads, entry));
            }
          }

          // 3. Empty temp/
          const tempDir = path.join(DATA, 'temp');
          if (fs.existsSync(tempDir)) {
            for (const entry of fs.readdirSync(tempDir)) {
              wipe(path.join(tempDir, entry));
            }
          }

          // 4. Reset JSON files to empty objects
          writeEmpty(LIBRARY_PATH,                          '{}');  // data/analysis_library.json
          writeEmpty(path.join(DATA, 'analysis_library.json'), '{}');  // data/ copy (ws_server reads this)
          writeEmpty(path.join(DATA, 'genres.json'),        '{}');
          writeEmpty(path.join(DATA, 'downbeats.json'),     '{}');

          // 5. Delete stream.txt so streamWatcher's readFile returns null (no spurious bang)
          wipe(path.join(DATA, 'stream.txt'));

          // 5b. Wipe derived files (ebys_index.json, umap, stem_ranges, feed chunks) —
          // these now live in the session's data dir (DATA_DIR), not src/max/, since
          // migrateLegacyDataIfNeeded() relocated them there for the default session.
          const MAX_DIR = DATA_DIR;
          // Delete ebys_index.json (try unlink first, fall back to wipe)
          const idxPath = path.join(MAX_DIR, 'ebys_index.json');
          try { fs.unlinkSync(idxPath); }
          catch (e) { try { fs.writeFileSync(idxPath, '{}', 'utf8'); } catch (_) {} }
          wipe(path.join(MAX_DIR, 'stem_ranges.json'));
          wipe(path.join(MAX_DIR, 'umap_coords.json'));
          // Delete ebys_feed_*.json chunks
          try {
            fs.readdirSync(MAX_DIR).filter(f => f.startsWith('ebys_feed_')).forEach(f => {
              try { fs.unlinkSync(path.join(MAX_DIR, f)); } catch (_) {}
            });
          } catch (_) {}
          // Write sentinel so ws_server blocks saveIdxChunk on next reload
          try { fs.writeFileSync(path.join(MAX_DIR, 'ebys_reset.flag'), '1', 'utf8'); } catch (_) {}

          // 6. Reload in-memory DBs
          reloadGenreDb();
          reloadBeatsDb();

          // 7. Halt playback FIRST, then wipe slicer memory. The stems live in
          // Max's in-memory buffer~ objects (src_*/ring_*), which karma~ keeps
          // playing regardless of the files being deleted on disk — deleting
          // WAVs never touches RAM. Without this stop, resetAll wiped disk +
          // memory but you'd still HEAR the old tracks looping out of the ring
          // buffers. `stop` → buffer_manager.stop() → slot_router → karma~ "stop"
          // on all four stems, silencing them; resetMemory then clears the index
          // so nothing can re-trigger the stale buffers (which get overwritten
          // on the next track load anyway).
          sendToMax('stop');
          sendToMax('resetMemory');

          // 8. Restart watch_demucs (kill current instance; cron keepalive restarts it within 60s)
          exec('pkill -f watch_demucs.py; sleep 1; /opt/homebrew/bin/python3 -u ' +
               require('path').join(__dirname, '..', 'demucs', 'watch_demucs.py') +
               ' >> /tmp/ebys_watch.log 2>&1 &', (err) => {
            if (errors.length) {
              logSys('⚠  resetAll finished with errors:');
              errors.forEach(e => logSys('   ' + e));
            } else {
              logSys('✓ resetAll complete — system is clean');
            }
            scheduleRender();
          });
        });
      };
      return;
    }

    // :restartWatcher — kill + restart watch_demucs (clears in-memory state)
    if (verb === 'restartWatcher') {
      const watcherPath = require('path').join(__dirname, '..', 'demucs', 'watch_demucs.py');
      exec('pkill -f watch_demucs.py; sleep 1; /opt/homebrew/bin/python3 -u ' +
           watcherPath + ' >> /tmp/ebys_watch.log 2>&1 &', (err) => {
        if (err) logSys('⚠ restartWatcher failed: ' + err.message);
        else logSys('✓ watcher restarted — drop files in raw_uploads to reprocess');
      });
      return;
    }

    // :graph [X Y] [stem]  — change scatter plot axes / stem
    // e.g.  :graph C E        :graph P H vocals      :graph vocals
    if (verb === 'graph') {
      // :graph — show UMAP status / reload
      const stems = Object.keys(umapDb);
      if (!stems.length) {
        logSys('UMAP data not yet available.\n' +
               'Wire fluid.umap~ in Max (see comment in slicer.js) then :buildIndex.');
      } else {
        const counts = stems.map(s => `${s}:${Object.keys(umapDb[s]).length}`).join('  ');
        logSys(`UMAP loaded — ${counts}\nGraphs update automatically on slice change.`);
        loadUmapDb(); loadStemRanges();
        scheduleRender();
      }
      return;
    }

    if (verb === 'setMMT') {
      const n = parseInt(parts[1]);
      if (isNaN(n) || n < 1) { logSys('usage: :setMMT <bars>  e.g. :setMMT 8'); return; }
      state.mmtWindow = n;
      scheduleRender();
      logSys(`→ MMT window set to ${n} bars — recomputing momentum …`);
      const venvPy = path.join(__dirname, '..', 'demucs', 'demucs_env', 'bin', 'python3');
      const script = path.join(__dirname, '..', 'demucs', 'add_tension.py');
      const proc = spawn(venvPy, [script, '--window', String(n)]);
      proc.stderr.on('data', d => {
        d.toString().trim().split('\n').forEach(l => { if (l.trim()) logSys(l.trim()); });
      });
      proc.stdout.on('data', d => {
        d.toString().trim().split('\n').forEach(l => { if (l.trim()) logSys(l.trim()); });
      });
      proc.on('close', code => {
        if (code === 0) {
          logSys(`momentum recomputed (window=${n}) — sending buildIndex`);
          sendToMax('buildIndex');
        } else {
          logSys(`add_tension.py exited with code ${code}`);
        }
      });
      return;
    }

    if (verb === 'nextTrack') { browseNext(); return; }
    if (verb === 'prevTrack') { browsePrev(); return; }

    // Track follow graph locally so :tip can compute payouts
    if (verb === 'followStem') {
      const from = parts[1], to = parts[2], w = parseFloat(parts[3]);
      if (state.followGraph[from]) {
        if (to === 'self') {
          state.followGraph[from] = {};
        } else if (state.stems[to] && !isNaN(w)) {
          state.followGraph[from][to] = w / 100;
        }
      }
    }

    if (verb === 'tip') {
      const STEMS = ['vocals', 'melody', 'bass', 'drums'];
      const N = STEMS.length;

      // ── Curator share ─────────────────────────────────────────────────────
      const FLOOR = 0.40;
      // creative factors (edit_rate, spectral_dist, genre_div) not yet wired from Max
      const curatorShare = FLOOR;  // full eq: 0.40 + 0.60 × creative_factor
      const artistPool   = 1 - curatorShare;  // 0.60

      // ── Artist split (80/20 within artist pool) ───────────────────────────
      const base = 0.8 / N;

      // Sum incoming follows per stem
      const influence = {};
      STEMS.forEach(s => { influence[s] = 0; });
      STEMS.forEach(from => {
        Object.entries(state.followGraph[from] || {}).forEach(([to, w]) => {
          if (influence[to] !== undefined) influence[to] += w;
        });
      });
      const totalInfluence = STEMS.reduce((sum, s) => sum + influence[s], 0);

      const lines = ['── tip simulation ──────────────────'];
      lines.push(`  curator   ${(curatorShare * 100).toFixed(1)}%  (floor — creative factors not yet live)`);
      lines.push(`  ─────────────────────────────────`);
      STEMS.forEach(s => {
        const share      = totalInfluence > 0 ? influence[s] / totalInfluence : 0;
        const stemOfPool = base + 0.2 * share;
        const payout     = artistPool * stemOfPool;
        const pct        = (payout * 100).toFixed(1);
        const inf        = (share * 100).toFixed(1);
        lines.push(`  ${s.padEnd(7)}  ${pct}%  (of tip — influence ${inf}%)`);
      });
      lines.push(`  ─────────────────────────────────`);
      lines.push(`  artists   ${(artistPool * 100).toFixed(1)}%  total`);

      // Show active follow graph
      const edges = [];
      STEMS.forEach(from => {
        Object.entries(state.followGraph[from] || {}).forEach(([to, w]) => {
          edges.push(`${from} → ${to} ${(w * 100).toFixed(0)}%`);
        });
      });
      if (edges.length) {
        lines.push('');
        lines.push('follow graph:');
        edges.forEach(e => lines.push('  ' + e));
      } else {
        lines.push('');
        lines.push('no follow graph active — equal split');
      }
      lines.push('────────────────────────────────────');
      logSys(lines.join('\n'));
      return;
    }

    if (verb === 'reloadDownbeats') {
      reloadBeatsDb();
      reloadGenreDb();
      updateBeatsForTrack(state.track);
      sendToMax('reloadDownbeats');
      scheduleRender();
      return;
    }

    // :trainBias — fits learned_bias.json from whatever :score/:scoreTransition
    // has been logged so far (train_bias.py, numpy-only — same demucs_env venv
    // as :setMMT's add_tension.py, no madmom/essentia needed), then tells Max
    // to pull the fresh file in. Purely a Node-side spawn: this never reaches
    // Max/slicer.js directly (there's no 'trainBias' handler there — training
    // happens offline), only the follow-up reloadBias message does.
    if (verb === 'trainBias') {
      logSys('→ trainBias — fitting learned models from :score/:scoreTransition logs…');
      startSpinner('trainBias…');
      const venvPy = path.join(__dirname, '..', 'demucs', 'demucs_env', 'bin', 'python3');
      const script  = path.join(__dirname, '..', 'demucs', 'train_bias.py');
      const outPath = path.join(DATA_DIR, 'learned_bias.json');
      const proc = spawn(venvPy, [script, '--data-dir', DATA_DIR, '--out', outPath]);
      proc.stdout.on('data', d => d.toString().trim().split('\n').forEach(l => { if (l.trim()) logSys(l.trim()); }));
      proc.stderr.on('data', d => d.toString().trim().split('\n').forEach(l => { if (l.trim()) logSys(l.trim()); }));
      proc.on('error', err => { stopSpinner(); logSys('trainBias error: ' + err.message); });
      proc.on('close', code => {
        stopSpinner();
        if (code === 0) {
          logSys('✓ trainBias done — reloading into slicer.js');
          sendToMax('reloadBias');
        } else {
          logSys(`train_bias.py exited with code ${code}`);
        }
        scheduleRender();
      });
      return;
    }

    // ── EBYS LINK commands ───────────────────────────────────────────────────
    // :sendLink             → send last touched param to peer
    // :sendLink hold        → send full scope dump to peer
    // :link on / :link off  → enable / disable incoming sync
    // :linkscope all                   → dump full state on hold
    // :linkscope weights vocals        → dump all weights for stem on hold
    // :linkscope dirs bass             → dump all dirs for stem on hold
    // :linkscope single weight_vocals_C → dump one key on hold
    if (verb === 'sendLink') {
      if (parts[1] === 'hold') linkSend('MISSILE_HOLD');
      else                     linkSend('MISSILE');
      logSys('sendLink' + (parts[1] === 'hold' ? ' (hold)' : ''));
      return;
    }
    if (verb === 'link') {
      // Two unrelated systems share this word: this legacy on/off toggle talks
      // UDP to a separate link_server.js process (ports 9001/9002); everything
      // else (status/mode/arm/fire/abort/token) is the newer multi-deck LINK
      // subsystem built entirely in ws_server.js/slicer.js — clock+entropy
      // sync, arm-then-fire simultaneous jumps, avoid/mirror/complement modes.
      // Because this check runs before the COMMANDS set is ever consulted,
      // the newer subsystem used to be completely unreachable — any sub-verb
      // besides on/off just printed a usage error instead of forwarding.
      // Preserving on/off exactly as before (existing muscle memory / any
      // external tooling already wired to it); everything else now forwards
      // through to the real handler instead of being swallowed here.
      const onOff = (parts[1] || '').toLowerCase();
      if (onOff === 'on')       { linkSend('LINK_ON');  logSys('LINK on');  }
      else if (onOff === 'off') { linkSend('LINK_OFF'); logSys('LINK off'); }
      else if (onOff)           { sendToMax('link ' + parts.slice(1).join(' ')); }
      else logSys('usage: :link on|off|status|mode <m>|arm|fire|abort|token <hex>');
      return;
    }
    if (verb === 'linkscope') {
      linkSend('MISSILE_SCOPE ' + parts.slice(1).join(' '));
      logSys('LINK scope: ' + parts.slice(1).join(' '));
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // @commands / :commands — toggle command panel
    if (verb === 'commands') { cmdCollapsed ? expandCmd() : collapseCmd(); return; }

    // :language — toggle language panel
    if (verb === 'language') { langCollapsed ? expandLang() : collapseLang(); return; }

    // :chat — toggle chat panel
    if (verb === 'chat') { chatCollapsed ? expandChat() : collapseChat(); return; }

    // @state / :state — show current state
    if (verb === 'state') { displayState(); return; }

    // @ alone — expand language list
    if (!body && prefix === '@') { langCollapsed ? expandLang() : collapseLang(); return; }

    // Check if verb is a known command
    if (COMMANDS.has(verb)) {
      // :lockSource all [leader]  — lock every other stem to one leader's
      // source track, so all four stems always play the same source song in
      // sync (no cross-track layering — behaves like normal sequential
      // playback). lockSource itself has no native 'all' handling (it takes a
      // leader plus one-or-more explicit follower names — see :lockSource
      // <leader> <follower...> above), so this expands client-side into one
      // real lockSource call per follower instead of forwarding "all"
      // literally (which slicer.js would reject — TRACKS doesn't include it).
      // leader defaults to 'vocals' if omitted or not a real stem name.
      if (verb === 'lockSource' && (parts[1] || '').toLowerCase() === 'all') {
        const ALL_STEMS = ['vocals', 'melody', 'bass', 'drums'];
        const leader    = ALL_STEMS.includes(parts[2]) ? parts[2] : 'vocals';
        ALL_STEMS.filter(s => s !== leader).forEach(follower => {
          const cmd = `lockSource ${leader} ${follower}`;
          bakeUserCmds.push(cmd);
          sendToMax(cmd);
          logSys('→ ' + cmd);
        });
        logSys(`{grey-fg}all stems locked to ${leader} — sequential, no layering{/grey-fg}`);
        render();
        return;
      }
      // :width master <val>  — alias for :width all <val>. There's no
      // literal "master" DSP width target (M/S width is only ever computed
      // per-stem, there's no summed-master M/S stage to control), so "master
      // width" means the same thing as "all stems' width" — forward it as
      // such instead of sending "width master" literally, which ws_server.js
      // would otherwise have to special-case too (it does, as a fallback —
      // see its own comment — but rewriting here means the command actually
      // logged/baked reflects what really happened). Also updates the "mst"
      // ring immediately, same as the generic :width all path below.
      if (verb === 'width' && (parts[1] || '').toLowerCase() === 'master') {
        const w = parseFloat(parts[2]);
        const cmd = 'width all ' + parts[2];
        bakeUserCmds.push(cmd);
        sendToMax(cmd);
        logSys('→ ' + cmd + '  (master = all stems)');
        if (!isNaN(w)) {
          const clamped = Math.max(0, Math.min(1, w));
          ['vocals', 'melody', 'bass', 'drums'].forEach(s => { state.spatial[s].width = clamped; });
          state.spatial.master.width = clamped;
        }
        render();
        return;
      }
      if (verb === 'showState' || verb === 'state') { displayState(); return; }
      if (verb === 'showCommands') { cmdCollapsed ? expandCmd() : collapseCmd(); return; }
      if (verb === 'language') { langCollapsed ? expandLang() : collapseLang(); return; }
      if (verb === 'chat') { chatCollapsed ? expandChat() : collapseChat(); return; }
      if (verb === 'stop')  { playbackStopped = true; }
      if (verb === 'start') { playbackStopped = false; }
      if (verb === 'setGlobalBPM') {
        const n = parseFloat(parts[1]);
        if (!isNaN(n)) state.globalBPM = n > 0 ? n : 0;  // 0 = cleared (auto)
      }
      if (verb === 'setFallbackBPM') {
        const n = parseFloat(parts[1]);
        if (!isNaN(n) && n > 0) state.bpm = n;
      }
      if (verb === 'setTrackWeight') {
        const stem = parts[1], w = parseFloat(parts[2]);
        if (state.stems[stem] && !isNaN(w)) state.stems[stem].weight = w;
      }
      if (verb === 'masterJoystick') {
        const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
        const sp = state.spatial.master;
        if (!isNaN(x)) sp.x = Math.max(-1, Math.min(1, x));
        if (!isNaN(y)) sp.y = Math.max(-1, Math.min(1, y));
      }
      if (verb === 'joystick') {
        // :joystick <stem> <x> <y>  — per-stem position
        // :joystick <x> <y>        — stem omitted → targets the master mix
        // (mirrors the ws_server.js fix: a bare numeric first arg is never a
        // valid stem name, so it can't be misread as one).
        const validStems = ['vocals', 'melody', 'bass', 'drums', 'all', 'live1', 'live2'];
        const stemGiven = validStems.includes((parts[1] || '').toLowerCase());
        if (!stemGiven) {
          const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
          const sp = state.spatial.master;
          if (!isNaN(x)) sp.x = Math.max(-1, Math.min(1, x));
          if (!isNaN(y)) sp.y = Math.max(-1, Math.min(1, y));
        } else {
          const stem = parts[1].toLowerCase();
          const x = parseFloat(parts[2]), y = parseFloat(parts[3]);
          const targets = stem === 'all' ? ['vocals', 'melody', 'bass', 'drums'] : [stem];
          targets.forEach(s => {
            const sp = state.spatial[s];
            if (!sp || s === 'master') return;
            if (!isNaN(x)) sp.x = Math.max(-1, Math.min(1, x));
            if (!isNaN(y)) sp.y = Math.max(-1, Math.min(1, y));
          });
        }
      }
      if (verb === 'width') {
        const stem = parts[1];
        const w = parseFloat(parts[2]);
        const targets = stem === 'all' ? ['vocals', 'melody', 'bass', 'drums'] : [stem];
        targets.forEach(s => {
          const sp = state.spatial[s];
          if (!sp || s === 'master' || isNaN(w)) return;
          sp.width = Math.max(0, Math.min(1, w));
        });
        // :width all also drives the "mst" ring — see the :width master
        // short-circuit above for why there's no separate master-width value.
        if (stem === 'all' && !isNaN(w)) {
          state.spatial.master.width = Math.max(0, Math.min(1, w));
        }
      }
      const expanded = expandSelectRange(body);
      bakeUserCmds.push(expanded);   // track as user correction for :bake
      sendToMax(expanded);
      logSys('→ ' + expanded);
      render();
      return;
    }

    // Otherwise: language switch (works with both @ and :)
    const lang = findLang(trimmed);
    if (lang) { applyLanguage(lang); return; }

    if (prefix === '@') {
      logSys('unknown — use :<language> to switch or :<command> to control EBYS');
      return;
    }

    // : prefix fallthrough (raw command to Max)
    sendToMax(body);
    logSys('→ ' + body);
    return;
  }

  // Natural language → Cricket → Max
  // Collapse commands panel on first chat message
  if (!cmdCollapsed) collapseCmd();
  logUser(trimmed);

  // New intent resets the bake session
  bakeIntent      = trimmed;
  bakeCricketCmds = [];
  bakeUserCmds    = [];

  callCricket(trimmed, cmd => {
    if (cmd === 'showState')    displayState();
    else if (cmd === 'showCommands') { cmdCollapsed ? expandCmd() : collapseCmd(); }
    else {
      const parts = cmd.trim().split(/\s+/);
      if ((parts[0] === 'setGlobalBPM' || parts[0] === 'setFallbackBPM') && parseFloat(parts[1]) > 0) {
        state.bpm = parseFloat(parts[1]);
        render();
      }
      bakeCricketCmds.push(cmd.trim());
      sendToMax(expandSelectRange(cmd));
    }
  });
}

// Quit
screen.key(['escape', 'C-c'], () => process.exit(0));


// Scroll
function scrollUp()   {
  logBox.scroll(-5);
  logBox.screen.render();
}
function scrollDown() {
  logBox.scroll(5);
  logBox.screen.render();
}

// Keyboard scroll — many terminal variants
inputBox.key(['pageup',   'S-up',   'shift+up'],   scrollUp);
inputBox.key(['pagedown', 'S-down', 'shift+down'], scrollDown);
screen.key( ['pageup',   'S-up',   'shift+up'],   scrollUp);
screen.key( ['pagedown', 'S-down', 'shift+down'], scrollDown);

// Trigger pad shortcuts — C-1 through C-4 fire each stem's trigger pad.
// The stem must be in trigger mode for this to have any effect (slicer ignores
// trigger() calls when TRIGGER_MODE is false for that stem).
const TRIGGER_STEMS = ['vocals', 'melody', 'bass', 'drums'];
['C-1','C-2','C-3','C-4'].forEach((key, i) => {
  screen.key(key, () => {
    const stem = TRIGGER_STEMS[i];
    sendToMax('trigger ' + stem);
    logSys(`→ trigger ${stem}`);
  });
  inputBox.key(key, () => {
    const stem = TRIGGER_STEMS[i];
    sendToMax('trigger ' + stem);
    logSys(`→ trigger ${stem}`);
  });
});

// Mouse wheel scroll — direct handler bypasses element routing
screen.on('mouse', data => {
  if (data.action === 'wheelup' || data.action === 'wheeldown') {
    const dir = data.action === 'wheelup' ? -3 : 3;
    const overCmd = !cmdCollapsed
      && data.y >= cmdBox.top
      && data.y <  cmdBox.top + cmdBox.height;
    if (overCmd) { cmdBox.scroll(dir); screen.render(); }
    else          { logBox.scroll(dir); screen.render(); }
  }
});


screen.on('resize', () => {
  if (!langCollapsed) setLangContent(`{white-fg}:language — type to collapse{/white-fg}\n{grey-fg}${buildLangList()}{/grey-fg}`);
  reflow(); render();
  // Belt-and-suspenders: with smartCSR off this shouldn't be load-bearing
  // anymore (see screen options above for the real fix), but a full
  // reallocation on resize is cheap and guarantees no stale buffer state
  // survives a dimension change.
  screen.realloc();
  screen.render();
});

function updateInputSize() {
  const text = inputBox.getValue() || '';
  const cols = Math.max(1, screen.width);
  const needed = Math.max(1, Math.ceil((text.length + 1) / cols));
  if (needed !== inputLines) {
    inputLines = needed;
    inputBox.height = inputLines;
    reflow();
    screen.render();
  }
}

inputBox.on('keypress', () => setImmediate(updateInputSize));

// ── Command history (up/down arrow) ──────────────────────────────────────────
let cmdHistory = [];
let historyIdx = -1;

inputBox.key('up', () => {
  if (cmdHistory.length === 0) return;
  historyIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
  inputBox.setValue(cmdHistory[historyIdx]);
  updateInputSize();
  screen.render();
});

inputBox.key('down', () => {
  if (historyIdx <= 0) { historyIdx = -1; inputBox.setValue(''); updateInputSize(); screen.render(); return; }
  historyIdx--;
  inputBox.setValue(cmdHistory[historyIdx]);
  updateInputSize();
  screen.render();
});

inputBox.key('enter', () => {
  const text = inputBox.getValue().replace(/\n/g, ' ').trim();
  if (text) { cmdHistory.unshift(text); historyIdx = -1; }
  handleInput(text);
  inputBox.clearValue();
  inputLines = 1;
  inputBox.height = 1;
  reflow();
  inputBox.focus();
  screen.render();
});

// ── BOOT ──────────────────────────────────────────────────────────────────────

inputBox.focus();
connectToMax();
render();

// ── LANGUAGE SELECTION ────────────────────────────────────────────────────────

const LANGUAGES_BASE = [
  // Western Europe
  { code: 'en',  label: 'English',          name: 'Cricket'    },
  { code: 'fr',  label: 'Français',         name: 'Criquet'    },
  { code: 'qc',  label: 'Franglais',        name: 'Cricket'    },  // user spec
  { code: 'es',  label: 'Español',          name: 'Grillo'     },
  { code: 'de',  label: 'Deutsch',          name: 'Grille'     },
  { code: 'pt',  label: 'Português',        name: 'Grilo'      },
  { code: 'it',  label: 'Italiano',         name: 'Grillo'     },
  { code: 'nl',  label: 'Nederlands',       name: 'Krekel'     },
  { code: 'sv',  label: 'Svenska',          name: 'Syrsa'      },
  { code: 'no',  label: 'Norsk',            name: 'Siriss'     },
  { code: 'da',  label: 'Dansk',            name: 'Fårekylling'},
  { code: 'fi',  label: 'Suomi',            name: 'Sirkka'     },
  // Eastern Europe
  { code: 'ro',  label: 'Română',           name: 'Greier'     },
  { code: 'pl',  label: 'Polski',           name: 'Świerszcz'  },
  { code: 'cs',  label: 'Čeština',          name: 'Cvrček'     },
  { code: 'sk',  label: 'Slovenčina',       name: 'Svrček'     },
  { code: 'hu',  label: 'Magyar',           name: 'Tücsök'     },
  { code: 'bg',  label: 'Български',        name: 'Щурец'      },
  { code: 'sr',  label: 'Srpski',           name: 'Cvrčak'     },
  { code: 'hr',  label: 'Hrvatski',         name: 'Cvrčak'     },
  { code: 'uk',  label: 'Українська',       name: 'Цвіркун'    },
  { code: 'ru',  label: 'Русский',          name: 'Сверчок'    },
  { code: 'lt',  label: 'Lietuvių',         name: 'Svirplys'   },
  { code: 'lv',  label: 'Latviešu',         name: 'Circeņi'    },
  { code: 'et',  label: 'Eesti',            name: 'Siristaja'  },
  // Middle East
  { code: 'ar',  label: 'العربية',          name: 'صرصر'       },
  { code: 'he',  label: 'עברית',            name: 'צרצר'       },
  { code: 'tr',  label: 'Türkçe',           name: 'Cırcır'     },
  // Asia
  { code: 'ja',  label: '日本語',            name: 'コオロギ'    },
  { code: 'zh',  label: '中文',             name: '蟋蟀'        },
  { code: 'ko',  label: '한국어',            name: '귀뚜라미'    },
  // Africa
  { code: 'sw',  label: 'Kiswahili',        name: 'Nyenze'     },
  { code: 'ha',  label: 'Hausa',            name: 'Kirikiri'   },
  { code: 'yo',  label: 'Yorùbá',           name: 'Ìgbín'      },
  { code: 'am',  label: 'አማርኛ',            name: 'ቴምቢሎ'      },
  { code: 'zu',  label: 'isiZulu',          name: 'Ikhilikithi' },
  { code: 'ig',  label: 'Igbo',             name: 'Ogu'        },
  { code: 'so',  label: 'Soomaali',         name: 'Masaakiin'  },
  // Philippines
  { code: 'tl',  label: 'Filipino',         name: 'Kuliglig'   },
  { code: 'ceb', label: 'Cebuano',          name: 'Kuliglig'   },
  // First Nations
  { code: 'cr',  label: 'ᓀᐦᐃᔭᐍᐏᐣ',         name: 'Cricket'    },  // Cree
  { code: 'oj',  label: 'Ojibwe',           name: 'Cricket'    },  // Ojibwe
  { code: 'iu',  label: 'ᐃᓄᒃᑎᑐᑦ',          name: 'Cricket'    },  // Inuktitut
];

// Shuffle on every boot
const LANGUAGES = [...LANGUAGES_BASE].sort(() => Math.random() - 0.5);

// Localized cricket onomatopoeia per language code
const CHIRP = {
  // Western Europe
  en:  'CHIRP!',
  fr:  'CRIC !',
  qc:  'OSTI !',
  es:  '¡CRIC!',
  de:  'ZIRP!',
  pt:  'CRIC!',
  it:  'CRI-CRI!',
  nl:  'TJIRP!',
  sv:  'KRIX!',
  no:  'KRIX!',
  da:  'KRIK!',
  fi:  'SIRKKA!',
  // Eastern Europe
  ro:  'CRIC!',
  pl:  'CYK!',
  cs:  'CÍK!',
  sk:  'CÍK!',
  hu:  'CIRIP!',
  bg:  'ЩУРЕЦ!',
  sr:  'CVRČAK!',
  hr:  'CVRČAK!',
  uk:  'ЦВІРІНЬ!',
  ru:  'ЦИРК!',
  lt:  'ČIRPTI!',
  lv:  'ČIRKST!',
  et:  'SIRISTAB!',
  // Middle East
  ar:  '!صرصر',
  he:  '!צרצר',
  tr:  'CIR CIR!',
  // Asia
  ja:  'コロコロ！',
  zh:  '唧唧！',
  ko:  '귀뚤귀뚤!',
  // Africa
  sw:  'KRIK!',
  ha:  'KRIK!',
  yo:  'KRIK!',
  am:  'ቺርፕ!',
  zu:  'KRIK!',
  ig:  'KRIK!',
  so:  'KRIK!',
  // Philippines
  tl:  'KRIK!',
  ceb: 'KRIK!',
  // First Nations
  cr:  'CHIRP!',
  oj:  'CHIRP!',
  iu:  'CHIRP!',
};

function chirpFor(code) {
  return CHIRP[code] || 'CHIRP!';
}

function langInstruction(lang) {
  if (lang.code === 'qc') {
    return `\n\nLANGUAGE LOCK: Respond in franglais — québécois French grammar with English technical words mixed in naturally. Never translate these English words into French, always keep them in English:

track (never "piste" or "chanson"), stem (never "piste"), load/loader (never "charger"), split/splitter (never "séparer"), buffer (never "tampon"), loop (never "boucle"), slice (never "tranche"), beat (never "temps"), mix/mixer (never "mélanger"), plugin (never "module"), sample (never "échantillon"), file (never "fichier"), folder (never "dossier"), output (never "sortie"), input (never "entrée"), click (never "cliquer"), start (never "démarrer"), stop (never "arrêter"), reset (never "réinitialiser"), settings (never "paramètres"), feature (never "fonctionnalité").

Example: "les stems sont pas encore loadées" not "les pistes ne sont pas encore chargées". "tu veux splitter le track?" not "tu veux séparer la piste?". Short answers. Never use formal French.`;
  }
  return `\n\nLANGUAGE LOCK: You must respond ONLY in ${lang.label}. Never switch to any other language under any circumstances, regardless of what language the user writes in. This is absolute.`;
}

// Per-language model overrides — use a custom Ollama model when available
const LANG_MODELS = {
  qc: 'franglais',  // custom model with baked-in franglais vocabulary
};

function applyLanguage(lang) {
  sepBox.setContent('');
  // Switch Ollama model if this language has a custom one
  CONFIG.ollama_model = LANG_MODELS[lang.code] || 'llama3.1:latest';

  // Update system prompt
  chatHistory[0].content = chatHistory[0].content.replace(/\n\nLANGUAGE LOCK:[\s\S]*/, '');
  chatHistory[0].content += langInstruction(lang);
  // Inject a hard switch into the conversation so the model sees it in context
  chatHistory.push({ role: 'user',      content: `[LANGUAGE SWITCH] From this point forward you must respond exclusively in ${lang.label}. Do not use any other language.` });
  chatHistory.push({ role: 'assistant', content: chirpFor(lang.code) });
  state.langLabel  = lang.label;
  state.agentName  = lang.name || 'Cricket';
  logCricket(chirpFor(lang.code));
  collapseLang();
  expandCmd();
}

// English is the default on boot — the full language picker is kept (archived)
// behind :language for whoever wants to switch, but it's no longer shown first.
// Users type their own language in chat anyway; the panel is opt-in.
let languageSelected = true;

// Boot — default straight to English, land on :commands (collapsed lang panel).
setTimeout(() => {
  const defaultLang = LANGUAGES_BASE.find(l => l.code === 'en');
  applyLanguage(defaultLang);
  reflow();
  screen.render();
}, 200);

// Clock tick — keeps timestamps counting smoothly between Max messages.
setInterval(() => { peakDecayTick(); scheduleRender(); }, 100);

// Refresh playback bars on interval (position updates come from Max in real use)
setInterval(() => {
  // Demo: animate bars to show they work before Max is connected
  if (state.running) {
    ['vocals', 'melody', 'bass', 'drums'].forEach(name => {
      state.stems[name].pos = (state.stems[name].pos + 0.003) % 1.0;
    });
    render();
  }
}, 100);
