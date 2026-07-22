// SDJ — Terminal UI
// run:  node sdj-tui.js
// deps: npm install blessed ws

const blessed   = require('blessed');
// blessed 0.1.81's colors.js has a self-poisoning cache bug: at require()
// time it builds its 8-color "ccolors" reduction table by temporarily
// truncating its own 256-color palette (exports.vcolors) down to 8 entries,
// then calling exports.match() on all 256 canonical hex strings to build
// that table — but exports.match() memoizes every result into a
// process-lifetime cache (exports._cache), keyed only by RGB value, with no
// awareness that vcolors was artificially restricted at the time. Any hex
// value that happens to exactly equal one of the 256 canonical colors (e.g.
// pure grey #808080, which is canonical color 244) gets its cache entry
// permanently poisoned by that restricted 8-color lookup — confirmed
// directly: match('#808080') returns index 3 (yellow, [205,205,0]) instead
// of the exact match at 244 ([128,128,128]), and stays wrong for the life
// of the process because the cache is never invalidated afterward. This is
// what was rendering as unexplained orange/yellow cells in the descriptor
// grid (ZONE 6.7) wherever a gradient stop or interpolated value landed
// exactly on a canonical 256-color entry. Wiping the cache here, right
// after blessed finishes its own module-load-time self-poisoning and
// before any of our own color tags get parsed, forces every future match()
// call to run the real nearest-color search against the fully restored
// 256-color table instead of returning a stale, wrongly-computed result.
require('blessed/lib/colors')._cache = {};
const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { spawn, exec, execFile } = require('child_process');
const dgram      = require('dgram');

// Network-detection state, declared early on purpose — networkAddrText()
// (used inside titleCenter, built every render()) reads these, and
// render() itself gets called once synchronously near the bottom of this
// file, well before execution ever reaches these variables' "natural"
// declaration point further down (next to the code that actually
// populates/polls them). Left as `let` there too (see updateWifiSsid(),
// the :network handler, and the networksetup -listallhardwareports
// callback) — those are plain assignments now, not re-declarations; this
// is the one and only `let` for each. Fixes: ReferenceError: Cannot
// access 'wifiConnecting' before initialization.
let macHardwarePortMap = {}; // BSD device name (e.g. "en0") -> 'wifi' | 'ethernet' | null
let wifiSsid            = null;  // current Wi-Fi SSID, once polled
let wifiConnecting      = false; // true while a :network join is in flight
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
  bg:         'color232',   // darker still (was 'color234', before that 'default') — user: "put the background a little darker", then "make the background a little more darker" — color232 is the darkest step in xterm's 232-255 greyscale ramp before true black
  // 'bright-white', not 'brightwhite' — was 'white' (ANSI color 7, actually
  // a dim light-grey), user: "make the whites whiter" — this is ANSI color
  // 15, true #ffffff. Hyphenated form on purpose: style objects (fg:
  // SKIN.fg) accept either (colors.convert() strips hyphens/spaces before
  // looking the name up), but a few spots interpolate these SKIN colors
  // straight into a blessed {tag} string too (see skinTag()'s own comment
  // below), and THAT code path only accepts the hyphenated, space-joined
  // form — so hyphenated is the one spelling that's safe in both places.
  fg:         'bright-white',      // all text
  dim_fg:     'color7',     // medium white (between grey labels and bright bar fills)
  user_fg:    'bright-white',      // user input lines only
  bar_full:   '█',     // █  filled block
  bar_empty:  ' ',          // empty portion of bar
  border:     'line',       // 'line' | 'none'
  border_fg:  'bright-white',
};

// SKIN's color names (and colors.js's colorNames map generally) use the
// fused form ('brightwhite') — correct for style objects (style: { fg:
// SKIN.fg }), which go through colors.convert(). blessed's {tag} markup is
// a DIFFERENT code path (program._attr) that only recognizes multi-word
// color names space-separated, via its own hyphen-to-space conversion on
// the tag text — so a tag has to spell it '{bright-white-fg}', not
// '{brightwhite-fg}' (which silently fails to match and prints literally,
// the exact bug behind "still here" — the tag text showing up as raw text
// instead of coloring anything). This converts a SKIN color name to that
// tag-safe hyphenated form for the few spots that interpolate one into a
// {tag} string dynamically instead of writing the tag out by hand.
//
// Separately, 256-color names like 'color7' (SKIN.dim_fg) hit a THIRD gap:
// program._attr()'s tag path only recognizes bare numbers for indexed
// color ('{7-fg}' -> '7 fg' -> matches /^(-?\d+) (fg|bg)$/), not the
// 'colorN' form colors.convert() accepts for style objects. '{color7-fg}'
// falls through every case in that switch and prints literally — same
// symptom as the brightwhite bug above, different root cause (seen live:
// "cricket: CHIRP!" rendering as raw '{color7-fg}...{/color7-fg}' text).
// Strip the 'color' prefix so the tag gets the bare index instead.
function skinTag(colorName) {
  const m = /^color(\d+)$/.exec(colorName);
  if (m) return m[1];
  return colorName.replace(/^(bright|light)(?=[a-z])/, '$1-');
}

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
  lufsPeak: null,   // running session max of state.lufs — DAW-style peak-hold, cleared by :resetPeaks
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
  session:   {
    active: false, sessionId: null, deck: null, mode: null,
    openedAt: null, djId: null,
  },
  // Tipping backend (TIPPING_URL) reachability — null = unknown, set/reset
  // by ws_server.js's 'tipBackend' WS message (see :tipOpen/pingBackend/
  // :tipClose there). Server reachability only, not a live Stripe API check.
  tipBackendUp: null,
  recording: false,
  lastCommandTouched: null,
  // Timestamp of the most recent LINK missile fire (local OR a remote deck —
  // ws_server.js broadcasts 'linkMissile'/'fire_executed' to everyone
  // whenever a fire actually applies, not just to whoever sent it). 0 means
  // never fired this session. Drives a brief flash in the header icon row;
  // the existing 100ms render tick (see bottom of file) fades it back out
  // without needing its own timer.
  linkFiredAt: 0,
  // Whether link_server.js currently has a peer deck reachable — separate
  // from linkFiredAt above (that's a momentary missile-fire flash; this is
  // the standing "are we actually paired with another deck right now"
  // state). Set by linkRecvSock's PEER_ONLINE/PEER_OFFLINE messages, which
  // used to only be logged (see logSys('✓ LINK peer connected') etc.) with
  // nothing in the header reflecting it — user: "the link protocol could
  // have something more in the header. visible connections to a network."
  linkPeerOnline: false,
  // Local network reachability — refreshed every NETWORK_POLL_MS by
  // updateNetworkInfo() via os.networkInterfaces(), NOT a Wi-Fi-specific
  // check (see that function's own comment for why). null = not polled
  // yet, otherwise { iface, address } or null (no active interface).
  network: null,
  params: {
    quant: true, envelope: 'hann',
    // Boot-time defaults simulate a plausible, already-dialed-in set rather
    // than the engine's raw scaffold values (entropy 0/matchProb 0.9/
    // stayProb 0/dirWeight 1 read as mechanical extremes — near-perfect
    // matching, zero looping — not something a DJ would actually run).
    // Real 'param' WS messages overwrite these the moment Max is live.
    matchProb: 0.72,  // single global (collapsed from per-descriptor)
    entropy:   0.35,  // macro 0=order 1=chaos
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
    // stayProb/dirWeight — the other two params the entropy macro drives
    // alongside matchProb above (see :setEntropy in the commands list).
    // Global "as driven by the last entropy update" readouts, shown in the
    // entropy meter's context line — not per-stem (paramsPerStem has the
    // real per-stem values once :setStayProb/:setDirWeight target one
    // stem directly instead of 'all').
    stayProb: 0.40, dirWeight: 1.15,
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
  // followGraph[from][dim][to] = weight 0–1 — per-dimension now, not
  // whole-stem (mirrors slicer.js's FOLLOW_STEM / ws_server.js's
  // followGraph exactly). Each dim starts as an empty {} (no follows).
  followGraph: {
    vocals: { C: {}, S: {}, E: {}, F: {}, P: {}, H: {}, T: {} },
    melody: { C: {}, S: {}, E: {}, F: {}, P: {}, H: {}, T: {} },
    bass:   { C: {}, S: {}, E: {}, F: {}, P: {}, H: {}, T: {} },
    drums:  { C: {}, S: {}, E: {}, F: {}, P: {}, H: {}, T: {} },
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
  // agentMode[stem] — mirrors slicer.js's AGENT_MODE ('remix' | 'generate').
  // Confirmed values only, via the 'agentMode_<stem>' param broadcast from
  // setAgentMode()'s own outlet(1, "param", ...) call — same one-way
  // confirmation pattern as sourceLock above, no optimistic local echo.
  // Defaults match slicer.js's own default so the gen/remix indicator under
  // each stem's name (see the "Row 1 lead-in" block below STEM_ROW_LABEL)
  // reads correctly even before the first confirmation arrives.
  agentMode: { vocals: 'remix', melody: 'remix', bass: 'remix', drums: 'remix' },
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

// Native (analyzed) BPM of a single stem's own source track, looked up the
// same way updateBeatsForTrack looks up the session's main track — user
// wants this printed next to the current global/fallback BPM on each
// stem's own descriptor line so the amount of pitch-shift actually being
// applied to THAT stem (native vs. playback tempo) is visible per stem,
// not just for the track the session was loaded on. Returns 0 (not found)
// rather than throwing so a missing/unanalyzed source track just silently
// omits the candidate below.
function getNativeBpmForTrack(trackName) {
  if (!trackName) return 0;
  const base = trackName.replace(/_(vocals|melody|bass|drums|other|melo)(\.\w+)?$/i, '').trim();
  let entry = beatsDb[base];
  if (!entry) {
    const lower = base.toLowerCase();
    entry = Object.entries(beatsDb).find(([k]) => k.toLowerCase() === lower)?.[1];
  }
  return (entry && entry.bpm) ? entry.bpm : 0;
}

const DOWNBEAT_MIN_CONF = 0.4;  // must match slicer.js

function beatsHeaderLine() {
  const b = state.beats;
  if (!b.meter) return `{grey-fg}beats:{/grey-fg} --`;
  const confBar = Math.round(b.conf * 10);
  const bar = '●'.repeat(confBar) + '{grey-fg}' + '○'.repeat(10 - confBar) + '{/grey-fg}';
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
  const confBar = '●'.repeat(Math.round(conf * 10)) + '{grey-fg}' + '○'.repeat(10 - Math.round(conf * 10)) + '{/grey-fg}';
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
    ? `{bright-white-fg}${agent}{/bright-white-fg}{grey-fg}${spinLabel} ${spinProgress} ${frame}{/grey-fg}`
    : `{bright-white-fg}${agent}{/bright-white-fg}{grey-fg}${spinLabel} ${frame}{/grey-fg}`;
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
  sepBox.setContent(languageSelected ? chatTopRule() : '{bright-white-fg}' + randCurse() + '{/bright-white-fg}');
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
  const bar = '●'.repeat(confBar) + '{grey-fg}' + '○'.repeat(10 - confBar) + '{/grey-fg}';

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
  title:       'EBYS 0.1.19 — ' + ((ACTIVE_SESSION && ACTIVE_SESSION.name) || 'default'),
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
// Starts true (not false) on purpose — user: "only when :start is entered
// that the visualizer should operate... it should never open playing,
// always open fresh from a stopped state." Every boot/reconnect must assume
// nothing is playing until proven otherwise by a real 'started'/'resumed'
// confirmation from slicer.js (or the user's own :start), even if a stray
// 'state' snapshot with running:true slips in first (e.g. ws_server.js's
// own stop-on-disconnect hasn't finished its quantized freeze yet by the
// time a reconnecting TUI's initial state snapshot goes out — see that
// file's socket 'close'/'hello' handlers). Cleared to false only by the
// 'started'/'resumed' messages and the :start command below — never by the
// plain 'state' merge.
let   playbackStopped     = true;
let   playbackRenderTimer = null;  // drives progress-bar animation between WS events
let   stoppedAtMs         = null;  // Date.now() when the server-confirmed 'stopped'
                                    // message arrived — lets the 'resumed' handler
                                    // rebase per-stem elapsed-time references by the
                                    // real pause duration so position/progress
                                    // readouts freeze through a pause instead of
                                    // silently counting wall-clock time straight
                                    // through it (see msg.type 'stopped'/'resumed').

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
// state.lufsPeak: snapped up instantly to any new high (see the WS 'vu'
// handler's snapVuPeak() call below), then released down at
// PEAK_DECAY_DB_PER_SEC by peakDecayTick() — the exact same rate/mechanism
// LUFSs already uses, not a separate VU-specific ballistics. This per-
// channel peak-hold is also what makes a separate header-level true-peak
// meter redundant — see the removed "TP" meter's comment near envLine.
// null = no signal seen yet ("--" via fmtMeterDb, same as lufsPeak).
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

// ── Per-stem row band ─────────────────────────────────────────────────────
// Each stem's own waveform (the playback progress bar) spans the FULL
// window width, full stop — nothing shares that row. Directly under it,
// the descriptor line (C/S/E/F/P/H/T inline range bars) sits above this
// stem's meters (VU meter, spatial ring, descriptor grid, momentum panel);
// the meters' own first row is aligned with the "weight" row, not with
// dirWgt — user: "align the first line of the visualizer with weight or
// the weight/dir section". weight/dir/dirWgt keep printing on the LEFT
// (in playBox, indented under the name column) on the same absolute rows
// the meters occupy on the RIGHT (in their own boxes), so the two never
// collide — different columns, same rows. Vertical order per stem:
//   waveform + descriptor line (PRE_METERS_ROWS = 2 rows) — then meters
//   start, overlapping rows with weight/dir/dirWgt (which keep printing on
//   the left of playBox for those same rows):
//   meters: VU | spatial | transitions | momentum (STEM_ROW_BAND_H = 7 rows)
//   ...then the next stem's waveform starts right after.
// STEM_ROW_BAND_H = 7 is the tallest of the four meter blocks (descriptor
// grid / momentum: one row per DIMS entry — ['C','S','E','F','P','H','T']);
// VU (5 rows) and spatial (5 rows) are simply shorter, not padded — see
// their own box-array comments below. STEM_BAND_H (9) is the combined
// height every per-stem column uses so stem N's band always starts at row
// N * STEM_BAND_H: playBox is ONE box (real content in rows 0-4 — weight/
// dir/dirWgt still need rows 2-4 even though the meters boxes now also
// start at row 2 — blank in rows 5-8 where the meters keep going after
// playBox's own text runs out), but the VU/spatial/descriptor-grid/
// momentum panels are each an ARRAY of small boxes, one per stem,
// individually positioned at playTop + i*STEM_BAND_H + PRE_METERS_ROWS
// with height STEM_ROW_BAND_H — not one tall box with blank filler rows
// standing in for that gap. A blessed box paints its own background across
// its FULL declared rectangle regardless of content, so a blank row inside
// a tall box still erases whatever playBox's full-width waveform drew
// underneath it at that row — that was the actual bug behind the waveform
// reading as "cut". A small box confined to just one stem's own row band
// can't do that to any other stem's waveform.
const PRE_METERS_ROWS = 2; // waveform, descriptor line — meters start at the weight row
const STEM_ROW_BAND_H = 7; // meters sub-band height
const STEM_BAND_H     = PRE_METERS_ROWS + STEM_ROW_BAND_H;

// ── VU SIDEBAR — vcl/mel/bas/drm meters, one small box per real stem ────────
// Each real stem gets its OWN box, exactly STEM_ROW_BAND_H tall, positioned
// directly under that stem's own waveform block — not one tall box spanning
// the whole per-stem zone with blank filler rows standing in for the gap. A
// blessed box always paints its own background across its full declared
// rectangle regardless of content, so a "blank" row inside a tall box still
// erases whatever playBox's full-width waveform drew underneath it at that
// same row — that was the actual cause of the waveform reading as visually
// "cut". A small box confined to just its own stem's row band simply doesn't
// exist over any OTHER stem's waveform rows, so nothing gets erased there.
// master has no playback row to align with at all — its VU meter lives in
// its own small box up in the header area instead (see masterVuBox below),
// not in this per-stem array.
const VU_SIDEBAR_STEMS = [
  { key: 'vocals', label: 'vcl' },
  { key: 'melody', label: 'mel' },
  { key: 'bass',   label: 'bas' },
  { key: 'drums',  label: 'drm' },
];
const VU_MASTER = { key: 'master', label: 'mst' };
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
// is the actual value). Every block gets one, so there's no dangling blank
// row and the count is uniform.
function vuSidebarInfoLine(stemKey) {
  const sp  = state.spatial[stemKey] || { x: 0, y: 0, width: 1 };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  return `{grey-fg}${' '.repeat(VU_LABEL_W)}${fmt(sp.x)} ${fmt(sp.y)} ${sp.width.toFixed(2)}{/grey-fg}`;
}
// One real stem's VU block, padded to STEM_ROW_BAND_H — this is the FULL
// content of that stem's own small vuStemBoxes[i], no leading gap needed
// since the box itself is already positioned to start right under that
// stem's waveform (see the box array's own top calc, below).
function vuStemLines(label, stemKey) {
  // No padding to STEM_ROW_BAND_H anymore — this box is independent of
  // descGridStemBoxes/momentumStemBoxes now (each stem's meters are
  // separate boxes, not one shared column), so it's sized to its own real
  // 5-row content (4 VU rows + 1 info row) instead of match-padded to 7,
  // which used to leave 2 blank rows of dead space under every VU block.
  return [...vuSidebarBlock(label, stemKey), vuSidebarInfoLine(stemKey)];
}
function renderVuSidebar() {
  VU_SIDEBAR_STEMS.forEach((s, i) => {
    vuStemBoxes[i].setContent(vuStemLines(s.label, s.key).join('\n'));
  });
  masterVuBox.setContent(
    [...vuSidebarBlock(VU_MASTER.label, VU_MASTER.key), vuSidebarInfoLine(VU_MASTER.key)].join('\n'));
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

// Keep umapDb around (still written by ws_server.js) but no longer rendered.
let umapDb = {};
function loadUmapDb() {
  try { umapDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'umap_coords.json'), 'utf8')); }
  catch (e) { umapDb = {}; }
}
loadUmapDb();

const DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];

// Rolling descriptor window — the last DESC_ROLL_PAIRS real transitions per
// stem, not the whole track. Distinct from state.stems[x].C etc. (the single
// live cursor value) and from rangeBar/renderStemGraph (which only ever draw
// that one live point): this is short-term history, one ring-buffer slot per
// stem per ACTUAL transition — not a time-based sample.
//
// Each slot is a PAIR — { out, in } — the two descriptor readings that got
// glued together at that cut: `out` is the OUTGOING segment's own end state,
// `in` is the INCOMING segment's start state. ws_server.js already computes
// this itself: its 'desc' handler snapshots state.stems[track] into
// state.stems[track].prevSegment right before overwriting it with the new
// segment's values ("the one point where 'what was just playing' and 'what's
// about to play' are both still distinguishable" — see that handler's own
// comment), and that prevSegment rides along on every subsequent broadcast,
// including the 'stem' message this file's own handler reads. So `out` here
// is msg.prevSegment.descriptors, not something this file has to derive.
// `out` is null for a stem's very first transition of a session (no prior
// segment to snapshot yet).
//
// A new pair appears exactly when, and only when, that stem really cuts —
// slicer.js only ever sends one 'stem' broadcast per real segment start (see
// the handler's own comment below). A fast-cutting stem (drums) fills and
// scrolls quickly; a slow one (bass) barely moves — that difference IS the
// transition-rate signal, not noise to smooth over. Reuses stemRanges for
// min/max shading, same range the live cursor bars already use.
const DESC_STEMS      = ['vocals', 'melody', 'bass', 'drums'];
const DESC_ROLL_PAIRS = 6;   // 6 transitions × {out,in} = 12 columns of data
const descRollBuffers = { vocals: [], melody: [], bass: [], drums: [] };

// Push one transition's {out, in} pair onto a stem's rolling window,
// dropping the oldest pair once it's full.
function descRollPush(stemName, pair) {
  const buf = descRollBuffers[stemName];
  if (!buf) return;
  buf.push(pair);
  if (buf.length > DESC_ROLL_PAIRS) buf.shift();
}

// ── Momentum panel data — a continuously scrolling strip, not a per-bar one.
// Width (the meter itself) always stays the same — MOM_MAX_SAMPLES columns,
// matching the transition grid's own pairs+seams span exactly (see MOM_W
// below) — user: "the momentum visualization meter should always keep the
// same length". What's variable is the DISPLAYED length, i.e. how much real
// playback time those fixed columns represent: user: "it should depend on
// setSegmentBars [x]. if setSegmentBars 4, the length of the window is 4.
// if it's chunkMode 0, the length of the window is the whole file." See
// momentumBarTick()'s spanMs for exactly how that's derived per stem —
// segDurMs already IS one setSegmentBars-sized segment's real duration (x
// bars long) once chunked, and durMs is the whole stem's file duration for
// the chunkMode-0 case, so no separate bars-count math is needed beyond
// reading whichever of those two applies. Once the strip fills up, it
// doesn't freeze — each new column shifts the oldest one out and keeps
// going, so the window always shows roughly the last spanMs of real time.
// No wipe-on-every-real-transition either (see the 'stemSlice' WS handler
// above, which used to clear curBarBuffers on every single bar) — that's
// what made this a "1 bar" window in the first place; removing it is what
// lets the strip span more than one segment/bar now.
// lastOutDesc[stem] is the snapshot of whatever was playing just before the
// CURRENT bar (ws_server.js's prevSegment, same source descRollPush's `out`
// uses) — kept around so momentumBarTick() below can ramp toward the
// current bar's real descriptor value instead of jumping straight to it,
// same reasoning the old per-pair interpolation used. Still updated on
// every transition (just no longer paired with a buffer wipe) since the
// ramp itself is still a real, useful smoothing within each new bar.
const MOM_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
// Same total column count as the grid's own pairs+seams span (DESC_ROLL_PAIRS
// pairs of 2 cells, plus a seam between each) — not because this panel is
// pair-structured (it isn't, this is one continuous strip), just so its
// width matches the transition grid's exactly. See MOM_W below. This is the
// FIXED meter length — see momentumBarTick() for the variable DISPLAYED
// length it's stretched or compressed to fit.
const MOM_MAX_SAMPLES = DESC_ROLL_PAIRS * 2 + (DESC_ROLL_PAIRS - 1);
const lastOutDesc   = { vocals: null, melody: null, bass: null, drums: null };
// Wall-clock time each stem's strip last advanced by one column — lets
// momentumBarTick() (which itself still only ticks once/second, see the
// setInterval near the bottom of this file) space actual column pushes
// further apart than that when the current span (a long chunk, or a whole
// file in chunkMode 0) is longer than MOM_MAX_SAMPLES seconds.
const lastMomPush   = { vocals: 0, melody: 0, bass: 0, drums: 0 };
const curBarBuffers = {};
DESC_STEMS.forEach(stem => {
  curBarBuffers[stem] = {};
  DIMS.forEach(dim => { curBarBuffers[stem][dim] = []; });
});

// Ticks once a second (see setInterval near the bottom of this file), but
// only actually PUSHES a new column for a stem once enough real time has
// passed for that stem's current column interval — colMs below, sized so
// MOM_MAX_SAMPLES columns together span spanMs of real playback time:
//   - chunked (state.playFullFile[stem] false, i.e. :setSegmentBars is
//     active) — spanMs = segDurMs, this stem's current segment's own real
//     duration, which by construction already covers exactly however many
//     bars :setSegmentBars was set to (see slicer.js's setSegmentBars()).
//   - whole-file (state.playFullFile[stem] true, i.e. chunkMode 0) —
//     spanMs = durMs, the stem's total file duration, so the strip
//     represents the ENTIRE track rather than one slice of it.
// Falls back to a fixed 1 column/second if neither is known yet (e.g.
// before the first real segment/duration message arrives). At a fast
// tempo or a short chunk this can compute an interval shorter than the
// tick's own 1000ms floor — the strip is then capped at 1 column/second
// (can't push more often than momentumBarTick() itself runs) and ends up
// spanning a bit more real time than spanMs, which is the best this tick
// rate can do rather than a hard requirement.
// Ramps from lastOutDesc[stem][dim] toward the current bar's real value
// (state.stems[stem][dim]) by how far through the bar's real duration
// (segDurMs) playback actually is, same stemSliceStartTime the position
// bars already track. No prior `out` (this bar has nothing to ramp from
// yet, e.g. the stem's very first bar) just samples the flat current value.
// Gated on state.running — the system being off (:stop, or before the first
// :start) means no real playback position exists to sample against, so
// nothing gets pushed; the 'stopped' handler above also leaves whatever was
// already in progress in place (freezes, doesn't wipe), so the panel just
// stops advancing rather than going blank while paused.
function momentumBarTick() {
  if (!state.running) return;
  DESC_STEMS.forEach(stem => {
    const s = state.stems[stem];
    const out = lastOutDesc[stem];
    const segDurMs  = s && s.segDurMs;
    const startTime = stemSliceStartTime[stem];
    const wholeFile = !!state.playFullFile[stem];
    const spanMs = wholeFile
      ? ((s && s.durMs > 0) ? s.durMs : null)
      : ((segDurMs > 0) ? segDurMs : null);
    const colMs = spanMs ? spanMs / MOM_MAX_SAMPLES : 1000;
    const now = Date.now();
    if (now - lastMomPush[stem] < colMs) return; // not time for this stem's next column yet
    lastMomPush[stem] = now;
    DIMS.forEach(dim => {
      const buf = curBarBuffers[stem][dim];
      // Window's already full — keep going by dropping the oldest column
      // instead of holding/freezing, so the strip keeps showing roughly
      // the last spanMs of real time instead of stalling once it first
      // fills up.
      if (buf.length >= MOM_MAX_SAMPLES) buf.shift();
      let v = s ? s[dim] : null;
      if (out && typeof out[dim] === 'number' && typeof v === 'number' && segDurMs > 0 && startTime) {
        const elapsed  = Date.now() - startTime;
        const progress = Math.max(0, Math.min(1, elapsed / segDurMs));
        v = out[dim] + (v - out[dim]) * progress;
      }
      buf.push(v === null || v === undefined || isNaN(v) ? null : v);
    });
  });
}

// Same value→glyph mapping renderDescGrid()'s cellFor() uses (stemRanges
// min/max, descIsMissing for "no info"), just picking a block-height glyph
// instead of a density shade.
function momGlyphFor(stem, dim, v) {
  const rng = stemRanges[stem] || {};
  const dimRange = rng[dim];
  const rangeUsable = dimRange && isFinite(dimRange.min) && isFinite(dimRange.max)
    && dimRange.max !== dimRange.min;
  if (descIsMissing(v, dim) || !rangeUsable) return '{grey-fg}·{/grey-fg}';
  const t = Math.max(0, Math.min(1, (v - dimRange.min) / (dimRange.max - dimRange.min)));
  return MOM_CHARS[Math.round(t * (MOM_CHARS.length - 1))];
}

// One row = however much of the current bar's strip has filled in so far —
// samples already taken render as glyphs, seconds still to come render as
// blank space (the strip visibly growing), no '│' seams anywhere since this
// is one continuous run, not discrete cut-marked pairs.
function momSparkline(stem, dim, maxLen) {
  // maxLen lets a caller shrink the strip below its usual MOM_MAX_SAMPLES —
  // used by momentumStemLines() to make room for the follow-graph tag
  // ("[drm]") inline, without widening the box itself. Defaults to the
  // full strip when omitted.
  maxLen = maxLen == null ? MOM_MAX_SAMPLES : Math.max(0, maxLen);
  const buf = curBarBuffers[stem][dim];
  let out = '';
  for (let i = 0; i < maxLen; i++) {
    // No sample at this slot yet (i >= buf.length) reads the same as a
    // sample that came back null — both are "no data here", so both fill
    // with the same grey · placeholder instead of one being a blank space.
    if (i >= buf.length) { out += '{grey-fg}·{/grey-fg}'; continue; }
    const v = buf[i];
    out += v === null ? '{grey-fg}·{/grey-fg}' : momGlyphFor(stem, dim, v);
  }
  return out;
}

// DAW-style block meter for a dB-scale reading (LUFS, or a VU channel's own
// level), with a peak-hold marker — a distinct cell flagging the loudest/
// highest point hit so far this session (state.lufsPeak / vuPeaks, never
// auto-decays, cleared by :resetPeaks). floor/ceil are the dB range the bar spans (ceil is
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
      out += hot ? '{bright-white-fg}{bold}▐{/bold}{/bright-white-fg}' : '{bright-white-fg}▐{/bright-white-fg}';
    } else if (i < filled) {
      out += hot ? '{bright-white-fg}{bold}█{/bold}{/bright-white-fg}' : '{bright-white-fg}█{/bright-white-fg}';
    } else {
      out += '{grey-fg}░{/grey-fg}';
    }
  }
  return out;
}

// Two-tone proportional block bar — solid █ for the DJ/curator's share,
// ░ for the remainder (the artist pool) — same fill/empty glyph convention
// dbMeter() above already uses, reused here for a different meaning
// (proportion of a split, not level-vs-max). Built for the tip equation
// bar specifically (user: "using unicode blocks to represent the tip
// scale") — swapped in for the old dash-and-cursor entropyBar() rendering,
// which read as a range/position control rather than a two-way split.
function splitBar(djFrac, width) {
  width = width || 10;
  const djCells = Math.round(Math.max(0, Math.min(1, djFrac)) * width);
  let out = '';
  for (let i = 0; i < width; i++) {
    out += i < djCells ? '{bright-white-fg}█{/bright-white-fg}' : '{grey-fg}░{/grey-fg}';
  }
  return out;
}

// Below this floor, the raw number is meaningless noise, not signal — a mix
// at genuine digital silence still produces a tiny nonzero float, and
// 20*log10() of that blows up into huge, nonsensical-looking readings like
// -157.2 or -313.1 instead of the clean "-inf" a real console/DAW shows for
// silence. LUFS_INF_FLOOR = -70 is not a guess — it's ITU-R BS.1770 / EBU
// R128's own "absolute gate," the spec's own definition of the point below
// which a signal doesn't count as programme content at all. (There used to
// be a separate TP_INF_FLOOR for a header-level true-peak meter — removed
// along with that meter, since the VU sidebar's own per-channel peak-hold
// already covers true peak, per-channel, more usefully than one global
// number ever did.)
// ASCII "-inf" rather than the ∞ glyph deliberately: this codebase has been
// bitten twice already (U+00B7, "⚿") by non-ASCII glyphs quietly rendering
// wider than their counted string length in this terminal and breaking
// column alignment — "-inf" is also what most hardware/DAW meters literally
// print for silence, so it's not a compromise, it's the actual convention.
const LUFS_INF_FLOOR = -70;
function fmtMeterDb(value, floor) {
  if (value === null) return '--';
  return value <= floor ? '-inf' : value.toFixed(1);
}

// Peak-hold release — called every 100ms from the clock-tick interval below.
// state.lufsPeak used to be a plain running session max (only ever
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

// CONTENT_W/contentW() — the width still used by boxes that genuinely sit
// BESIDE the VU/spatial sidebar for their whole height (reflowLearn()'s
// training panel, which shares rows 3-7 with master's meters — see
// MASTER_METER_BOXES). The chat overlay (sep/menuHeader/lang/cmd/log) used
// to be narrowed to this too, but it never actually shares a row with the
// sidebar — mTop (where the overlay starts) always docks below wherever
// the header cluster (including master's meters) ends, never beside it —
// so that margin was just wasted width there. Widened to '100%' instead
// (user: "the chat should occupy the whole width of the screen... so maybe
// the command list would fit all in one space").
// Computed, not hand-counted, from the exact pieces vuSidebarBlock() joins:
// label(5) + channel code "FL"(2) + gap(1) + bar(VU_W) + gap(1) + number(VU_NUM_W).
const VU_SIDEBAR_W = VU_LABEL_W + 2 + 1 + VU_W + 1 + VU_NUM_W;
// Spatial dock — sits to the RIGHT of the VU sidebar (flush against the
// screen's right edge), so the VU sidebar itself shifts left by SPATIAL_W +
// VU_SPATIAL_GAP. SPATIAL_W matches XY_W (the frame's own width) below — no
// extra margin there, box width equals content width exactly; the breathing
// room between the two columns is VU_SPATIAL_GAP alone.
const SPATIAL_W      = 9;
// Back to 1 (briefly tried 0 — user: "put more space between the VU meter
// numbers and the spatialization viewer... like before"). Zero read as too
// cramped once the VU numbers and the pan-dot grid sat directly adjacent —
// DESC_GRID_GAP/MOM_GAP (the momentum/transition gaps, a separate ask)
// stay at 0, this is the one gap that specifically needed breathing room
// back.
const VU_SPATIAL_GAP = 1;
const SIDE_TOTAL_W  = VU_SIDEBAR_W + VU_SPATIAL_GAP + SPATIAL_W;
const CONTENT_W    = '100%-' + SIDE_TOTAL_W;
function contentW() { return Math.max(20, screen.width - SIDE_TOTAL_W); }

// Header-row alignment anchors for the boxes docked in/under the header —
// shared between render() (which needs them to size playTop) and reflow()
// (which needs them to actually position the boxes), so both stay in sync.
// Header row indices (see sLines in render()): 0 = state chips/version,
// 1 = last touched, 2 = track/key, 3 = win/slices/LUFS/quant, 4 = genre/beats.
// PEER ONLINE/OFFLINE and NETWORK used to get their own row 2 here — moved
// back into the icon cluster on row 0 instead (user: "put the [peer
// offline/online] and the [network] in the menu bar"), so the row indices
// below are back to what they were before that row existed.
// Both land on row 3 (win/slices/LUFS/quant, "quant:beat") rather than row
// 1 ("last touched") — that row flushes ITS OWN text to the true right edge
// (atCol('', lastTouchLine)), the same column master's right-anchored box
// paints into, so starting master there would paint straight over that
// text. Row 2 (track/key) is the first row with empty right-side space,
// but master and tipBox/bakeInfoBox share ONE row deliberately (different
// columns, same top) rather than master landing a row earlier than the
// tip/train column — hence row 3, not 2.
const MASTER_VU_TOP = 3; // masterVuBox/masterSpatialBox — "closer to last touched" (without covering it)
const TRAIN_TIP_TOP = 3; // bakeInfoBox/tipBox — "align prmpt: with the row of quant:beat"
// Column where iconCluster (and therefore [REC •], its first element)
// starts on the title row — recomputed every render() (see withLCR), read
// by reflow() to line tipBox's own left edge up with it (user: "align the
// tipping zone with the [REC] box").
let recColStart = 0;
// agplColStart (used to line up bakeInfoBox's left edge with the header's
// [AGPL-3.0] badge) removed along with the badge itself — both bakeInfoBox
// and the header's version/AGPL center column are gone now (version/AGPL
// moved to the footer, see renderFooter() — user: "move [ebys version] and
// [agpl] in the center of the bottom of the window").

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
// playTop — where the whole per-stem row-band section starts (playback rows
// AND, beside them, the VU/spatial/descriptor-grid/momentum columns). Always
// equal to playBox.top (statusH + 1); kept as its own variable so the side
// columns can read it without depending on playBox's own mutable .top.
let playTop  = 3;
// fixedTop — where sep/menuHeader/lang/cmd/log start, i.e. BELOW the entire
// per-stem section (playback rows AND the side columns beside them, not just
// playback). = playTop + the tallest of those columns + 1 row of gap —
// recalculated in render().
let fixedTop = 11;
// statusH — height of the plain header text block (title/last-touched/
// track-key/env/genre rows). Recalculated in render(); kept module-level so
// reflow() can position masterVuBox/masterSpatialBox right below the header
// instead of overlapping it (see reflow()'s own comment).
let statusH  = 5;

// ── ZONE 2.5 — Separator (bars / chat) ───────────────────────────────────────
// sepBox sits at mTop — the very first row of the chat overlay, directly over
// whichever screen's header is underneath (playback's or the training
// screen's — see reflow()'s chatMaximized block). It doubles as the tagger/
// Cricket "thinking" spinner line (renderSpinner()/startChatSpinner()), so
// its content is usually dynamic — but idle (no spinner running, language
// already selected) it used to just go blank, which left nothing marking
// where the underlying page's header ends and the chat box actually begins
// (user: "find something to demarcate the chat box top, over the header of
// the underlying page"). chatTopRule() is that idle-state content — a plain
// labeled divider, same '── label ──' visual language as the command list's
// own section headers — swapped in everywhere sepBox used to fall back to
// '' once a language is picked (see stopSpinner()/stopChatSpinner()/
// applyLanguage()).
function chatTopRule() {
  const w = Math.max(1, screen.width);
  // Was 'chirp' for a while (user: "keep the tab name chat, but the - chat -
  // name that shows from the demarcation can be 'chirp'"), reverted back
  // (user: "replace the chirp in the chat by chat") — matches the ^C footer
  // chip and :chat command, which both stayed "chat" the whole time anyway.
  const label = ' chat ';
  const dashes = Math.max(0, w - label.length);
  const left = Math.floor(dashes / 2);
  const right = dashes - left;
  return '{grey-fg}' + '─'.repeat(left) + label + '─'.repeat(right) + '{/grey-fg}';
}

const sepBox = blessed.box({
  top: fixedTop, left: 0, width: '100%', height: 1,
  tags: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ── ZONE 3 — Menu header row: :language / :commands / :chat ───────────────────
// These three panels each used to show their own one-line "type to expand"
// hint stacked on a separate row (language, then a dedicated chat-header row,
// then commands) — three rows of near-empty space in the common idle state,
// where all three are collapsed. Merged into one shared header row instead:
// whichever of the three is currently collapsed contributes its hint here,
// side by side. A panel that's expanded owns its own "type to collapse"
// header + list content directly below (see langBox/cmdBox) — its hint drops
// out of this shared row once expanded, so it isn't shown twice.
let langCollapsed = false;
let langContent   = '';
let cmdCollapsed  = false;
let cmdContent    = '';
function buildMenuHeaderLine() {
  const seg = (label, collapsed) =>
    '{bright-white-fg}:' + label + ' — type to ' + (collapsed ? 'expand' : 'collapse') + '{/bright-white-fg}';
  return [
    seg('language', langCollapsed),
    seg('commands', cmdCollapsed),
    // Live saturation meter for Cricket's working memory (see CRICKET'S
    // MEMORY, near chatHistory) — always visible, not a collapse toggle like
    // the two segments above. ':memory' prints the same reading as a chat
    // answer; ':memory clear' empties it.
    memoryBar(8),
  ].join('   ');
}

const menuHeaderBox = blessed.box({
  top: fixedTop, left: 0, width: '100%', height: 1,
  tags: true, wrap: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ⌘/文 shortcut tags — NOT here any more. First tried as clickable tags on
// this row (menuHeaderBox) — user: "ah i see it but thats not what i
// meant. I want them as tabs at the bottom of the screen [^ ⌘] and
// [^文]." Moved into renderFooter() instead, as two more chips in the
// SAME leftChips row ^C/^T already live in (see its own comment) — that
// reuses the exact gap-computation logic already proven correct there,
// rather than another independently-positioned floating box (which is
// exactly what caused the network zone's earlier header-overlap bug).
// ⌘ (U+2318) is the user's own choice; 文 (U+6587, "language/script/
// writing" — see its own comment in renderFooter() for the full
// reasoning) is the proposed symbol for language.

// ── ZONE 3.5 — Language selector (expands on boot, collapses after selection) ─
const langBox = blessed.box({
  top: fixedTop, left: 0, width: '100%', height: 1,
  tags: true, wrap: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// ── ZONE 4 — Command list (expands on boot, collapses to one-liner) ───────────
const cmdBox = blessed.box({
  top: fixedTop + 1, left: 0, width: '100%', height: 1,
  tags: true, wrap: true,
  scrollable: true, alwaysScroll: true, mouse: true,
  style: { fg: 'grey', bg: SKIN.bg, scrollbar: { bg: 'grey' } },
});

// ── ZONE 5 — Chat with Cricket (scrollable) ───────────────────────────────────
const logBox = blessed.log({
  top:           fixedTop + 3,
  left:          0,
  width:         '100%',
  height:        screen.height - fixedTop - 3 - 1,
  tags:          true,
  scrollable:    true,
  alwaysScroll:  false,
  scrollOnInput: false,
  style:         { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 6 — VU meters (vcl/mel/bas/drm), one small box per stem ────────────
// Array, not one tall box: vuStemBoxes[i] is exactly STEM_ROW_BAND_H rows
// tall and gets positioned (in reflow()) at top: playTop + i*STEM_BAND_H +
// PRE_METERS_ROWS — directly under stem i's own waveform block in playBox, and
// nowhere else. See the comment above VU_SIDEBAR_STEMS for why a single tall
// box with blank filler rows doesn't work here (it erases the waveform).
const vuStemBoxes = VU_SIDEBAR_STEMS.map(() => blessed.box({
  top: playTop, right: SPATIAL_W + VU_SPATIAL_GAP, width: VU_SIDEBAR_W, height: 5,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
}));
// master's own VU meter — fixed height (5: 4 VU rows + 1 info row, no
// padding needed since nothing else has to line up under it), docked in the
// header area (see reflow()) instead of threaded through the per-stem array.
const masterVuBox = blessed.box({
  top: 0, right: SPATIAL_W + VU_SPATIAL_GAP, width: VU_SIDEBAR_W, height: 5,
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
// still land on the same offsets as vuStemBoxes' blocks (5 rows here vs.
// VU's 4 content + 1 gap = 5) — the two columns stay row-aligned even though
// SPATIAL_H no longer equals a VU block's raw content height.
const XY_W      = 5;
const SPATIAL_H = 5;
// Array, not one tall box — same reasoning as vuStemBoxes above: each real
// stem's ring gets its own STEM_ROW_BAND_H-tall box, positioned directly
// under that stem's own waveform block, so it never paints over any OTHER
// stem's waveform row.
const spatialStemBoxes = VU_SIDEBAR_STEMS.map(() => blessed.box({
  top: playTop, right: 0, width: SPATIAL_W, height: SPATIAL_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
}));
// master's own ring — fixed height (SPATIAL_H, the raw 5-row frame, no
// padding needed), docked in the header area alongside masterVuBox.
const masterSpatialBox = blessed.box({
  top: 0, right: 0, width: SPATIAL_W, height: SPATIAL_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 6.6 — Bake training readout ────────────────────────────────────────
// Used to have its own header-area box on the PLAYBACK screen (bakeInfoBox,
// docked next to tipBox) — removed (user: "remove the training zone
// indicator in the playback tab. this should all go in the training tab").
// bakeInfoLines() below is the shared content builder; the training screen's
// own 'training' sub-view (see renderTrainingView()) is now the only place
// it's actually rendered, straight into reviewDetailBox — no separate box
// needed here any more, no duplication between the two screens either.
// BAKE_INFO_INDENT used to match VU_LABEL_W — a holdover from when this
// text lined up with "FL"/"FR"/"RL"/"RR" in the VU meters directly above
// it on the playback header. That box is gone; bakeInfoLines() now only
// renders into the training view's reviewDetailBox, where prmpt/bars/rcp
// should sit flush with the left edge like everything else in that panel
// (user: "align prmpt bars and rcp with the left side of the window").
// Table rows still step in one level (+2) relative to their label.
const BAKE_INFO_INDENT     = '';
const BAKE_INFO_SUB_INDENT = ' '.repeat(2);
const RECIPE_NAME_W  = 13;
const RECIPE_VALUE_W = 8;

// "setStayProb all 0.35" → name "stayProb", value "+0.35" — drops the "set"
// prefix and a bare "all" target (the common case) to fit the column
// widths above; a specific stem/dim stays (e.g. "setDirPref all D 1" →
// "dirPref D"). Numeric values get an explicit sign, matching the +/- style
// used elsewhere in this file (see fmtDir).
function formatRecipeLine(cmd) {
  const tokens = cmd.trim().split(/\s+/);
  let verb = tokens[0] || '';
  if (verb.length > 3 && verb.slice(0, 3) === 'set') verb = verb[3].toLowerCase() + verb.slice(4);
  const mid  = tokens.slice(1, -1).filter(t => t.toLowerCase() !== 'all');
  const name = [verb, ...mid].join(' ');
  let value  = tokens.length > 1 ? tokens[tokens.length - 1] : '';
  if (/^-?\d+(\.\d+)?$/.test(value)) value = (parseFloat(value) >= 0 ? '+' : '') + value;
  // padEnd is a no-op (not a truncation) once name/value already exceed
  // their column width — force at least one separating space so a long
  // name doesn't run straight into the value with nothing between them.
  const nameCol = name.length >= RECIPE_NAME_W ? name + ' ' : name.padEnd(RECIPE_NAME_W);
  return BAKE_INFO_SUB_INDENT + nameCol + value.padEnd(RECIPE_VALUE_W);
}

// lockSource rows carry a variable-length list of follower stem names in
// their value slot (the verb "lockSource" also isn't stripped down the way
// "set..." verbs are in formatRecipeLine above), so they're consistently the
// longest/least predictable row in the table — pushed to the end so a long
// lockSource row never throws off the name/value column alignment of the
// shorter rows above it.
function sortRecipeCmds(cmds) {
  const isLock = c => (c.trim().split(/\s+/)[0] || '').toLowerCase() === 'locksource';
  return cmds.filter(c => !isLock(c)).concat(cmds.filter(isLock));
}

// Packs stat tokens ("chk 3", "sc --", "end --", ...) onto as few rows as
// fit within the zone's width, joined by " · ". Plain blessed wrap (the
// box's own wrap:true) breaks at the raw character width and restarts
// continuation lines at column 0 — that's what used to leave "end --"
// dangling flush-left instead of lined up with the rows above it, so
// callers now rely on THIS wrap instead and set wrap:false on their own
// box so blessed's own (separately, less reliably measured — see the '·'
// width-bug note on dbMeter above) wrapping never runs a second pass over
// lines this function already finished wrapping. Only remaining caller is
// tipBox now, which sits flush against tipBox.left (aligned with [REC] —
// see reflow()) with no indent, so this no longer re-adds one either (used
// to prepend BAKE_INFO_INDENT to every row).
// ── BAKE GRAPH (:showBakeGraph) ───────────────────────────────────────────────
// Diagnostic-only, deliberately separate from train_bias.py's real
// multi-dimension fit: reads a training log directly, fits ONE dimension in
// isolation with plain 1D least squares, and renders it as a scatter plot
// using Unicode Braille characters (each character = a 2x4 sub-cell dot
// grid, real technique used by terminal plotting tools like plotext — see
// GENERATIVE_LAYER.md-adjacent discussion on why a GUI isn't required for
// this). Exists so a dimension's actual shape can be SEEN before deciding,
// via :setFitShape, whether it deserves a quadratic term in the real model.

function dimLookupKey(label) {
  // Mirrors slicer.js's learnedDims()/all_dims_with_keys() label convention:
  // level dims look themselves up, tension dims ('Tn' prefix) look up
  // 'tension_<letter>'. Kept as a small parallel here rather than shared
  // code since this file never loads slicer.js (separate process/runtime).
  if (label.indexOf('Tn') === 0) return 'tension_' + label.slice(2);
  return label;
}

function simpleOLS(xs, ys) {
  // Plain closed-form 1D least squares — the same math numpy.linalg.lstsq
  // does for train_bias.py, just solved directly since there's only one
  // input dimension here instead of 13-27.
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varX = 0;
  for (let i = 0; i < n; i++) {
    cov  += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) * (xs[i] - meanX);
  }
  const slope = varX > 1e-12 ? cov / varX : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

// solveLinearSystem — Gaussian elimination with partial pivoting for a
// small (<=4x4 here) dense system Ax = b. Only used by polyFit() below;
// n is always degree+1 <= 4 (cubic is the highest shape :setFitShape
// offers), so nothing fancier than a direct solve is worth reaching for.
// A near-singular pivot column (fewer distinct x values than the degree
// needs) leaves that coefficient at 0 rather than blowing up or throwing —
// same "degrade gracefully, never crash the TUI over a diagnostic graph"
// posture as the rest of this file's bake-graph code.
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-9) continue;
    const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => Math.abs(row[i]) < 1e-9 ? 0 : row[n] / row[i]);
}

// polyFit — ordinary least squares polynomial fit of the given degree
// (1 = linear, matching simpleOLS; 2 = quadratic; 3 = cubic — the same
// three shapes :setFitShape offers), via the normal equations
// (Xᵀ X) c = Xᵀ y solved directly. Same OLS math as simpleOLS/
// train_bias.py's numpy.lstsq, just generalized past one power of x — this
// is what makes the bake-graph PREVIEW actually draw the curve a dim is
// set to fit, instead of always drawing a straight line regardless of
// :setFitShape (see renderBrailleScatter() below for why that used to be
// misleading). Returns coefficients LOW to HIGH degree:
// [c0 (intercept), c1 (x), c2 (x^2), c3 (x^3), ...].
function polyFit(xs, ys, degree) {
  const n = xs.length;
  const terms = degree + 1;
  const powSums = new Array(2 * terms - 1).fill(0);
  const b = new Array(terms).fill(0);
  for (let k = 0; k < n; k++) {
    const xp = [1];
    for (let d = 1; d < 2 * terms - 1; d++) xp.push(xp[d - 1] * xs[k]);
    for (let i = 0; i < 2 * terms - 1; i++) powSums[i] += xp[i];
    let xi = 1;
    for (let i = 0; i < terms; i++) { b[i] += xi * ys[k]; xi *= xs[k]; }
  }
  const A = [];
  for (let i = 0; i < terms; i++) {
    const row = [];
    for (let j = 0; j < terms; j++) row.push(powSums[i + j]);
    A.push(row);
  }
  return solveLinearSystem(A, b);
}

function evalPoly(coeffs, x) {
  let y = 0, p = 1;
  for (let i = 0; i < coeffs.length; i++) { y += coeffs[i] * p; p *= x; }
  return y;
}

// formatPolyEquation — coeffs are LOW to HIGH degree (polyFit()'s own
// order); printed HIGH to LOW since that's the conventional reading order
// for a polynomial (y = ax^3 + bx^2 + cx + d, not the reverse).
function formatPolyEquation(coeffs) {
  let out = 'y = ';
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    const label = i === 0 ? '' : (i === 1 ? 'x' : 'x^' + i);
    const sign = c < 0 ? '-' : '+';
    const mag = Math.abs(c).toFixed(3);
    out += (i === coeffs.length - 1)
      ? (c < 0 ? '-' : '') + mag + label
      : ' ' + sign + ' ' + mag + label;
  }
  return out;
}

// loadFitShapesSync / fitDegreeForDim — mirrors train_bias.py's own
// load_fit_shapes(): reads fit_shapes.json fresh (no caching — this is only
// ever called right before a graph redraw, same frequency the training-log
// reads already happen at, see refreshSelectedBakePage()) and turns a dim
// label into the polynomial degree to preview it at. This is what makes the
// bake-graph PREVIEW actually track :setFitShape — previously
// renderBrailleScatter() always fit a straight line via simpleOLS()
// regardless of this file, so a dim flipped to quadratic/cubic still showed
// a misleading linear preview.
function loadFitShapesSync() {
  const p = path.join(DATA_DIR, 'fit_shapes.json');
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = {};
    for (const k in raw) { if (raw[k] === 'quadratic' || raw[k] === 'cubic') out[k] = raw[k]; }
    return out;
  } catch (e) { return {}; }
}
function fitDegreeForDim(dim) {
  const shape = loadFitShapesSync()[dim];
  return shape === 'cubic' ? 3 : (shape === 'quadratic' ? 2 : 1);
}

function readJsonlSafe(p) {
  if (!fs.existsSync(p)) return [];
  const rows = [];
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch (e) { /* skip a corrupt/partial line, same as train_bias.py's read_jsonl */ }
  }
  return rows;
}

// extractBakePoints — one (x, y) point per usable bake. `feature` selects
// which weight this graph actually corresponds to in train_bias.py's real
// fit — 'delta'/'absDelta' for transition (matches transition_feature_names()'s
// delta<label>/absDelta<label> pair), 'mean'/'std' for vertical (matches
// build_vertical_dataset()'s mean<label>/std<label> pair). Defaults (delta,
// mean) match this function's old single-feature behavior exactly, so every
// existing :showBakeGraph call without a feature arg still renders the same
// graph it always did.
function extractBakePoints(dataDir, dim, model, feature) {
  const key = dimLookupKey(dim);
  const points = [];
  if (model === 'transition') {
    const feat = feature || 'delta';
    const rows = readJsonlSafe(path.join(dataDir, 'training_log_transition.jsonl'));
    for (const row of rows) {
      const rating = row.rating;
      if (rating === undefined || rating === null) continue;
      const stems = row.stems || {};
      for (const stemKey in stems) {
        const pair = stems[stemKey] || {};
        const frm = (pair.from && pair.from.descriptors) || {};
        const to  = (pair.to   && pair.to.descriptors)   || {};
        if (frm[key] === undefined || frm[key] === null) continue;
        if (to[key]  === undefined || to[key]  === null) continue;
        const delta = to[key] - frm[key];
        points.push({ x: feat === 'absDelta' ? Math.abs(delta) : delta, y: rating });
      }
    }
  } else {
    const feat = feature || 'mean';
    const rows = readJsonlSafe(path.join(dataDir, 'training_log_vertical.jsonl'));
    for (const row of rows) {
      const rating = row.rating;
      if (rating === undefined || rating === null) continue;
      const stems = row.stems || {};
      const vals = [];
      for (const stemKey in stems) {
        const desc = (stems[stemKey] && stems[stemKey].descriptors) || {};
        if (desc[key] !== undefined && desc[key] !== null) vals.push(desc[key]);
      }
      if (vals.length < 2) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (feat === 'std') {
        const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
        points.push({ x: Math.sqrt(variance), y: rating });
      } else {
        points.push({ x: mean, y: rating });
      }
    }
  }
  return points;
}

// BAKE_GRAPH_LIST — the graph menu (user: "I will need a graph menu to
// select which graphs I want to view, since there are 50ish possible graph
// (per weights)"). One entry per real weight train_bias.py actually fits:
// 13 dims (7 level + 6 tension) × {delta, absDelta} for transition, ×
// {mean, std} for vertical = 52 entries. Deliberately excludes the sq*/cu*/
// sqMean*/cuMean* non-linear-only terms (see FIT_SHAPES in slicer.js /
// :setFitShape) — those only exist for whichever dims are opted in, so a
// fixed 1-52 numbering would shift under the user's feet as fit_shapes.json
// changes; :showBakeGraph <dim> <model> still reaches those by name.
// :showBakeGraph <n> below indexes into this list (1-based, matches
// :listGraphs' printed numbering).
const BAKE_GRAPH_DIMS = ['C','S','E','F','P','H','T','TnC','TnE','TnF','TnP','TnH','TnT'];
function buildBakeGraphList() {
  const list = [];
  BAKE_GRAPH_DIMS.forEach(dim => list.push({ dim, model: 'transition', feature: 'delta' }));
  BAKE_GRAPH_DIMS.forEach(dim => list.push({ dim, model: 'transition', feature: 'absDelta' }));
  BAKE_GRAPH_DIMS.forEach(dim => list.push({ dim, model: 'vertical', feature: 'mean' }));
  BAKE_GRAPH_DIMS.forEach(dim => list.push({ dim, model: 'vertical', feature: 'std' }));
  return list;
}
const BAKE_GRAPH_LIST = buildBakeGraphList();

// BAKE_GRAPH_PAGES — the picker menu actually shown/stepped through now
// (user: "show multiple graph at the same time to reduce the number of
// options in the menu ... all the descriptor delta graphs on number 1 ...
// then all the Tn[descriptors] delta on number 2"). Groups BAKE_GRAPH_LIST's
// existing 52 entries into 8 pages — one per (model, feature) ×
// {level dims, tension dims} — instead of a flat 1-52 list. Nothing about
// which underlying graphs EXIST changed (still the same 52 dim×model×
// feature combos, still fit exactly as train_bias.py does), just how many
// render on screen per pick: a page shows all 7 level dims (or all 6
// tension dims) for one model/feature stacked together — see
// refreshSelectedBakePage(). LEVEL_DIMS/TENSION_DIMS split BAKE_GRAPH_DIMS
// the same way it was already implicitly ordered (level block then tension
// block within each model×feature run), just made explicit here since a
// page needs to know its own dims as a real array, not a slice offset.
const LEVEL_DIMS   = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];
const TENSION_DIMS = ['TnC', 'TnE', 'TnF', 'TnP', 'TnH', 'TnT'];
function buildBakeGraphPages() {
  const combos = [
    ['transition', 'delta'],
    ['transition', 'absDelta'],
    ['vertical',   'mean'],
    ['vertical',   'std'],
  ];
  const pages = [];
  combos.forEach(([model, feature]) => {
    pages.push({ model, feature, kind: 'level',   dims: LEVEL_DIMS });
    pages.push({ model, feature, kind: 'tension', dims: TENSION_DIMS });
  });
  return pages;
}
const BAKE_GRAPH_PAGES = buildBakeGraphPages(); // 8 pages, 7 or 6 graphs each

// pageIndexForDim — which page (1-based) a given dim/model/feature combo
// lives on, used by :showBakeGraph <dim> [model] [feature] (the named
// single-dim lookup form) and :setFitShape's "refresh the preview if it's
// showing the dim that just changed" check, now that a "current graph" is
// really a whole page of dims rather than one.
function pageIndexForDim(dim, model, feature) {
  const kind = dim.indexOf('Tn') === 0 ? 'tension' : 'level';
  return BAKE_GRAPH_PAGES.findIndex(p => p.model === model && p.feature === feature && p.kind === kind) + 1;
}

const BRAILLE_BASE = 0x2800;
// [row][col] -> dot bit, standard Unicode Braille dot numbering (1-8)
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

// renderBrailleScatter — width/height are CHARACTER cells; the actual dot
// grid is 2x width by 4x height, giving noticeably finer resolution than
// one glyph per data point would. Draws the fitted line first, then real
// data points on top (points always win visually over the line where they
// overlap, since the line is illustrative and the points are ground truth).
// isPoint[][] tracks, per CHARACTER cell (not sub-dot — blessed can only
// color a whole character, not individual Braille sub-dots), whether any
// real data point landed there; the fitted line renders grey, real bakes
// render white (user: "put the weighted line in grey and the actual bakes
// in white") — a cell with both just goes white, same "points win" rule
// the dot-merging itself already followed before this, now carried into
// color too.
// degree (1/2/3) selects linear/quadratic/cubic — see fitDegreeForDim(),
// which derives it from fit_shapes.json for whichever dim is selected.
// Previously this always fit degree-1 (simpleOLS) no matter what
// :setFitShape had that dim set to, so the preview line was flat-out wrong
// for any dim already opted into a curve — see polyFit()'s own comment.
function renderBrailleScatter(points, width, height, degree) {
  const subW = width * 2, subH = height * 4;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
  let yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
  if (xMax - xMin < 1e-9) { xMax += 0.5; xMin -= 0.5; }
  if (yMax - yMin < 1e-9) { yMax += 0.5; yMin -= 0.5; }
  // Can't fit a degree-D polynomial with fewer than D+1 points — falls back
  // to whatever degree the point count actually supports rather than
  // producing a singular/garbage fit (solveLinearSystem() would just zero
  // out the unsolvable coefficients, but capping degree up front reads
  // cleaner in the printed equation too).
  const usableDegree = Math.max(1, Math.min(degree || 1, points.length - 1));
  const coeffs = polyFit(xs, ys, usableDegree);

  const grid = [], isPoint = [];
  for (let r = 0; r < height; r++) {
    grid.push(new Array(width).fill(0));
    isPoint.push(new Array(width).fill(false));
  }

  function setDot(px, py, pointFlag) {
    if (px < 0 || px >= subW || py < 0 || py >= subH) return;
    const cellX = Math.floor(px / 2), cellY = Math.floor(py / 4);
    const subX = px % 2, subY = py % 4;
    grid[cellY][cellX] |= BRAILLE_BIT[subY][subX];
    if (pointFlag) isPoint[cellY][cellX] = true;
  }

  for (let px = 0; px < subW; px++) {
    const x = xMin + (px / (subW - 1)) * (xMax - xMin);
    const yLine = evalPoly(coeffs, x);
    const py = Math.round((1 - (yLine - yMin) / (yMax - yMin)) * (subH - 1));
    setDot(px, py, false);
  }

  for (const p of points) {
    const px = Math.round(((p.x - xMin) / (xMax - xMin)) * (subW - 1));
    const py = Math.round((1 - (p.y - yMin) / (yMax - yMin)) * (subH - 1));
    setDot(px, py, true);
  }

  const lines = [];
  for (let r = 0; r < height; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      if (grid[r][c] === 0) { line += ' '; continue; }
      const ch = String.fromCharCode(BRAILLE_BASE + grid[r][c]);
      line += isPoint[r][c] ? `{white-fg}${ch}{/white-fg}` : `{grey-fg}${ch}{/grey-fg}`;
    }
    lines.push(line);
  }
  return {
    text: lines.join('\n'), coeffs, degree: usableDegree, n: points.length,
    xMin, xMax, yMin, yMax,
  };
}

// featureAxisLabel — what X actually is for a given dim/model/feature combo
// (user: "add axis to the graph. what x is and what y is"). Y is always
// the bake rating (-1..1, whatever :score/:scoreTransition logged) — X
// changes meaning per feature, same four shapes train_bias.py itself fits:
// a raw delta (signed, can be negative), an absolute delta (always >= 0),
// or a cross-stem mean/std at one instant.
function featureAxisLabel(dim, model, feature) {
  if (model === 'transition') {
    return feature === 'absDelta' ? '|Δ' + dim + '| = |to − from|' : 'Δ' + dim + ' = to − from';
  }
  return feature === 'std' ? 'std(' + dim + ') across stems' : 'mean(' + dim + ') across stems';
}

function wrapStatLine(tokens, wrapW) {
  // wrapW defaults to SIDE_TOTAL_W for backward compat, but tipBox's actual
  // rendered width now varies (see reflow()'s tipBox.width clamp — user:
  // "make sure the master VU meter isnt covered by the tip infos"), so
  // renderTipInfo() below passes tipBox.width explicitly instead of relying
  // on this default, keeping the wrap point in sync with where the box
  // itself actually ends.
  const w = wrapW || SIDE_TOTAL_W;
  const rows = [];
  let cur = [];
  let curW = 0;
  tokens.forEach(tok => {
    const tokW = visWidth(tok.replace(/\{[^}]+\}/g, ''));
    const addW = tokW + (cur.length ? 3 : 0); // ' · ' separator = 3 cols
    if (cur.length && curW + addW > w) {
      rows.push(cur.join(' · '));
      cur = [tok];
      curW = tokW;
    } else {
      cur.push(tok);
      curW += addW;
    }
  });
  if (cur.length) rows.push(cur.join(' · '));
  return rows.join('\n');
}

// bakeInfoLines() — the actual line-building logic. Used to feed both
// bakeInfoBox (playback's own header-area readout) and the training
// screen's 'training' sub-view; bakeInfoBox is gone now (see the ZONE 6.6
// comment above) so this only ever renders into reviewDetailBox, via
// renderTrainingView()'s training branch — but kept as its own function
// since that's still the single source of truth for the content itself.
function bakeInfoLines() {
  const scoreShort = bakeScoreCount
    ? bakeScoreCount + '(' + bakeLastScore.value.toFixed(2) + ')' : '--';
  const tagShort = bakeSessionActive ? (bakeTag || '--') : '--';

  // Every sub-item below is ALWAYS printed with its label — "--" fills in
  // for whatever isn't there yet, nothing is omitted. Otherwise a bare "--"
  // with no label (the previous version) reads as unexplained noise; you
  // can't tell what's missing without already knowing the layout by heart.
  // prmpt on its own line, then bars/chk/tag/scr all together on ONE line
  // (user: "put bars, chk, tag and scr on the same line" — was split
  // across two paired-stat rows), then rcp:. "end" (queued save name)
  // dropped from this readout entirely to fit that shape.
  const lines = [BAKE_INFO_INDENT + '{grey-fg}prmpt:{/grey-fg} '
    + (bakeSessionActive ? (bakeSessionLabel || '--') : '--')];

  if (bakeSessionActive && bakeSeqSteps) {
    const step = bakeSeqSteps[bakeSeqIndex];
    // step/chk/tag/scr all on one line now (user: "put bars, chk, tag and
    // scr on the same line" — step name+index stands in for "bars" here,
    // since a sequence step doesn't have one fixed bar count of its own).
    lines.push('{grey-fg}' + BAKE_INFO_INDENT
      + step.name + ' ' + (bakeSeqIndex + 1) + '/' + bakeSeqSteps.length
      + ' · chk ' + bakeAttempt
      + ' · tag ' + tagShort + ' · scr ' + scoreShort + '{/grey-fg}');
    // The currently-playing step's own saved recipe — no * marking here,
    // sequence states aren't being corrected against a single Cricket
    // attempt the way a single-comportment bracket is.
    const stateCmds = sortRecipeCmds((loadBakeStates()[step.name] || {}).commands || []);
    if (stateCmds.length) {
      // rcp: is its own header row, table rows underneath — a separate "--"
      // row can't sit "under" a single-word label in any way that reads as
      // aligned, so the empty case folds onto the SAME line instead (same
      // pattern as corrections: below).
      lines.push('{grey-fg}' + BAKE_INFO_INDENT + 'rcp:{/grey-fg}');
      lines.push(...stateCmds.map(formatRecipeLine));
    } else {
      lines.push('{grey-fg}' + BAKE_INFO_INDENT + 'rcp:{/grey-fg} --');
    }
    const corrCount = bakeUserCmds.length ? resolveComportment(bakeUserCmds).length : 0;
    lines.push('{grey-fg}' + BAKE_INFO_INDENT + 'corrections:{/grey-fg} ' + (corrCount || '--'));
  } else {
    // bars/chk/tag/scr all on one line (user: "put bars, chk, tag and scr
    // on the same line"). "scr" (scores) is NOT gated on bakeSessionActive,
    // unlike bars/chk — it's a running tally across the whole session,
    // meant to stay visible after :bake end instead of dropping back to "--".
    lines.push('{grey-fg}' + BAKE_INFO_INDENT
      + 'bars ' + (bakeSessionActive ? bakeLoopBars : '--')
      + ' · chk ' + (bakeSessionActive ? bakeAttempt : '--')
      + ' · tag ' + tagShort + ' · scr ' + scoreShort + '{/grey-fg}');
    if (bakeSessionActive && bakeComportment.length) {
      lines.push('{grey-fg}' + BAKE_INFO_INDENT + 'rcp:{/grey-fg}');
      const originals = new Map((bakeFirstCmds || bakeCricketCmds).map(c => [comportmentKey(c), c]));
      lines.push(...sortRecipeCmds(bakeComportment).map(c =>
        formatRecipeLine(c) + (originals.get(comportmentKey(c)) !== c ? ' {bright-white-fg}*{/bright-white-fg}' : '')));
    } else {
      lines.push('{grey-fg}' + BAKE_INFO_INDENT + 'rcp:{/grey-fg} --');
    }
  }
  return lines;
}

// ── ZONE 6.8 — Entropy meter, docked directly under the tipping panel.
// Starting binding is state.params.entropy — the existing ORDER(0)↔CHAOS(1)
// macro (:setEntropy 0–1, see the 'entropy' WS handler above), the only
// thing already named "entropy" anywhere in the engine. This is a starting
// point, not a final definition — the intent is to eventually drive this
// off a bespoke combination of parameters the user defines for what "high
// entropy" should mean in the bake/training context specifically, and
// rewire renderEntropyMeter() to that once decided. Visually similar to the
// old per-stem rangeBar() (dash track + • cursor, since removed — see the
// per-stem descriptor-line comment near playLines.push, "remove the range
// bar showing descriptor value under the waveform"), but this one was
// always its own simpler fixed-range implementation, calibrated against a
// single global 0..1 macro rather than a specific stem's learned min/max.
// Two-column layout, fixed at 2 rows — user-specified: bar (row 1) and
// floor readout (row 2) on the left, match/stay (row 1) and dirWgt/bpm
// (row 2) on the right, no blank gap between them. Replaces the old
// 4-row single-column stack (bar / floor / blank / info).
const ENTROPY_MIN_H = 2;
const ENTROPY_MAX_H = 2;
// Right column sits ENTROPY_RIGHT_GAP cols past where the left (bar/floor)
// column's own content ends — see ENTROPY_RIGHT_W below for its width.
const ENTROPY_RIGHT_GAP = 3;
const ENTROPY_RIGHT_W   = 26; // fits "match: 0.72 · stay: 0.40" / "dirWgt: 1.15 · bpm: 120"
const entropyBox = blessed.box({
  top: 0, right: 0, width: SIDE_TOTAL_W + ENTROPY_RIGHT_GAP + ENTROPY_RIGHT_W, height: ENTROPY_MIN_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});
// Sized to fill the rest of the zone's width, not an arbitrary fixed length.
// Shared with the dj/prod equation bar below (EQ_BAR_W) so the two read as
// one consistent design element — both start at the same column ("X " is a
// 2-col lead-in either way) and now END at the same column too. Computed
// from whichever row's own label overhead is TIGHTER (the equation row's
// "aᵢ"/"NN/NN" labels are wider than this row's "❄"/"0.00"), so both bars
// are guaranteed to actually fit in SIDE_TOTAL_W instead of being copied
// from one row's budget and silently overflowing on the other (caught by
// testing with realistic fake tip data — see the width check that flagged
// this).
// TRAIL_MARK_W (defined below, next to the glyphs) is the widest trailing
// marker on either row — "aᵢ" (2 cols) trails the split-equation row —
// so ❄ (1 col) gets padded out to match and both bars END at the same
// column, in addition to already starting at the same column (∫ and ✳
// are both 1-col leading glyphs, no lead padding needed).
const ENTROPY_ROW_OVERHEAD = 2 + 3 + 6; // "✳ " + " ❄ " (❄ padded to aᵢ's width) + "  0.00"
const EQ_ROW_OVERHEAD      = 2 + 3 + 7; // "∫ " + " aᵢ" + "  40/60"
const SHARED_BAR_W = SIDE_TOTAL_W - VU_LABEL_W - Math.max(ENTROPY_ROW_OVERHEAD, EQ_ROW_OVERHEAD);
const ENTROPY_BAR_W = SHARED_BAR_W;
// floorLo/floorHi (both optional, each 0..1) mark the actual travelable
// range on the 0..1 scale — the cursor can only ever really sit between
// them. That range renders in WHITE; anything the floor(s) rule out (below
// floorLo, above floorHi) renders in GREY instead, so the floor is visible
// IN the bar, not just as a separate number next to it. No floor on a side
// (param omitted) means that side stays fully white all the way to its
// end — e.g. the tip bar's artist side, which has no floor at all.
function entropyBar(val, width, dotColor, floorLo, floorHi) {
  width = width || 5;
  // Cursor dot defaults to white, same as the travelable track itself —
  // bolded so it still reads as a distinct marker rather than blending
  // into a run of white dashes on either side of it. Hyphenated
  // 'bright-white', not 'brightwhite' — this gets interpolated straight
  // into a {tag} below, and blessed's tag parser needs multi-word color
  // names space-separated (via its own hyphen-to-space conversion), unlike
  // style-object color names (SKIN.fg etc.) which accept the fused form.
  dotColor = dotColor || 'bright-white';
  const lo  = (typeof floorLo === 'number') ? Math.max(0, Math.min(1, floorLo)) : 0;
  const hi  = (typeof floorHi === 'number') ? Math.max(0, Math.min(1, floorHi)) : 1;
  const lv  = Math.max(0, Math.min(1, parseFloat(val) || 0));
  const pos   = Math.round(lv * (width - 1));
  const loPos = Math.round(lo * (width - 1));
  const hiPos = Math.round(hi * (width - 1));
  let out = '';
  for (let i = 0; i < width; i++) {
    if (i === pos) { out += `{${dotColor}-fg}{bold}•{/bold}{/${dotColor}-fg}`; continue; }
    out += (i < loPos || i > hiPos) ? '{grey-fg}─{/grey-fg}' : '{bright-white-fg}─{/bright-white-fg}';
  }
  return out;
}
// ✳ (U+2733 EIGHT SPOKED ASTERISK) over the plain "S" the header dims use —
// 'S' is already a per-stem descriptor letter (see DIMS/rb('S',...) in the
// stem rows above), so reusing it here for the unrelated global entropy
// macro would read as the same dimension when it isn't. ✳ also just looks
// more like entropy (radiating/scattered) than the flower-like ❋. Still a
// BMP dingbat, not an astral-plane emoji, so it won't hit the blessed
// column-width bug the earlier emoji cleanup fixed. Framed as endpoint
// markers either side of the track itself — ✳ (scatter/chaos) on the left,
// ❄ (crystalline/order) on the right — both plain BMP glyphs, same safety
// reasoning as above.
const ENTROPY_GLYPH_LEFT  = '✳';
const ENTROPY_GLYPH_RIGHT = '❄';
// Visible width of "aᵢ", the wider of the two right-side row markers (❄
// is 1 col). Padding ❄ out to this width means the entropy row's "0.00"
// and the split-equation row's "40/60" both start at the same column
// instead of "0.00" sitting 1 column left of "40/60" (❄ vs aᵢ width).
const TRAIL_MARK_W = 2;
// User-overridable floors for the entropy macro, one per end of the bar —
// same two-floor pattern as floorDj/floorArtist on the tip equation bar
// (see below), just applied to the ✳(warm/chaos)↔❄(cold/order) range
// instead of a DJ/artist split, and on BOTH ends instead of one (entropy
// is bounded on both sides; the tip bar's artist side has no floor at
// all). Both are direct positions on the same 0(order)..1(chaos) scale
// entropy itself uses: floorWarm is the lower bound (val can't drop
// below it — "max cold", i.e. never fully rigid/mechanical matching),
// floorCold is the upper bound (val can't rise above it — "max heat",
// i.e. never fully random/incoherent). Fed straight into entropyBar()'s
// floorLo/floorHi below, which paints the blocked-off range grey and the
// actually-travelable range white. null = not defined yet (per user:
// "haven't defined max heat and max cold yet") — renders "--" and the
// whole bar stays white. No :setEntropyFloor command wired up yet,
// readout only.
let floorWarm = null;
let floorCold = null;
// Pads `s` (blessed color tags stripped for width purposes) out to `width`
// visible columns with trailing spaces, so a second column of text appended
// right after it starts at a fixed, predictable position — same idea as the
// header's atCol/withLCR, just a left-pad-then-append instead of a
// right-flush.
function padToCol(s, width) {
  const vis = visWidth(s.replace(/\{[^}]+\}/g, ''));
  return s + ' '.repeat(Math.max(1, width - vis));
}

function renderEntropyMeter() {
  const val   = state.params.entropy;
  const label = (typeof val === 'number') ? val.toFixed(2) : '--';
  // No BAKE_INFO_INDENT prefix any more — entropy is stuck flush to the
  // left edge of the window now (user: "really stick entropy to the side
  // of the window"), so it starts at column 0 instead of the VU_LABEL_W
  // indent that made sense when it lined up under the VU sidebar/training
  // column.
  const barLine = '{grey-fg}' + ENTROPY_GLYPH_LEFT + '{/grey-fg} '
    + entropyBar(val, ENTROPY_BAR_W, undefined, floorWarm, floorCold)
    + ' {grey-fg}' + ENTROPY_GLYPH_RIGHT + '{/grey-fg}'
    + ' '.repeat(TRAIL_MARK_W - 1) + '  ' + label;

  // Floor readout — directly under the bar, same left column.
  const floorLine = '{grey-fg}floor (' + ENTROPY_GLYPH_LEFT + '):{/grey-fg} ' + (floorWarm !== null ? floorWarm.toFixed(2) : wht('--'))
    + ' · '
    + '{grey-fg}floor (' + ENTROPY_GLYPH_RIGHT + '):{/grey-fg} ' + (floorCold !== null ? floorCold.toFixed(2) : wht('--'));

  // Right column — the raw params the entropy macro is actually turning
  // (match/stay/dirWgt, see :setEntropy in the commands list: "order↔chaos
  // macro"), plus bpm alongside them so it's clear tempo is part of the
  // same live-playback picture, even though :setEntropy itself doesn't
  // touch it. match/stay/dirWgt come from state.params.matchProb/
  // stayProb/dirWeight, kept live by the 'param' key:'entropy' WS handler
  // above whenever slicer.js's own entropy feedback fires (not just the
  // plain :setEntropy echo). bpm mirrors the same globalBPM-or-analyzed-bpm
  // fallback the header's beat line uses. Sits beside the bar/floor column
  // now (row 1 next to the bar, row 2 next to the floor readout) instead of
  // stacked below it — user-specified layout.
  const bpmVal = state.globalBPM > 0 ? state.globalBPM : (state.bpm || 0);
  const matchStayLine = '{grey-fg}match:{/grey-fg} ' + state.params.matchProb.toFixed(2)
    + ' · ' + '{grey-fg}stay:{/grey-fg} ' + state.params.stayProb.toFixed(2);
  const dirBpmLine = '{grey-fg}dirWgt:{/grey-fg} ' + state.params.dirWeight.toFixed(2)
    + ' · ' + '{grey-fg}bpm:{/grey-fg} ' + (bpmVal > 0 ? bpmVal : wht('--'));

  // - VU_LABEL_W: the left column's content shrank by that much once the
  // BAKE_INFO_INDENT prefix was dropped (see barLine/floorLine above).
  const rightColStart = SIDE_TOTAL_W - VU_LABEL_W + ENTROPY_RIGHT_GAP;
  const row1 = padToCol(barLine, rightColStart) + matchStayLine;
  const row2 = padToCol(floorLine, rightColStart) + dirBpmLine;

  const content = [row1, row2].join('\n');
  entropyBox.setContent(content);
  return content.split('\n').length;
}

// ── ZONE 6.7 — Tipping readout, docked under the training panel (above the
// entropy meter) ────────────────────────────────────────────────────────────
// Session open/closed itself already shows in the header ([TIP OPEN/CLOSED]
// on the icon cluster, [LVL n/3] on the title row next to [CONNECTED]) —
// this panel is the detail view: which
// session (id + when it opened, both real, from ws_server.js's :tipOpen/
// :tipClose lifecycle) and the most recent tip (username/amount/split, which
// is SIMULATED via ":tip <username> <amount>" — see lastTip above, there's
// no live Stripe bridge yet).
// Layout — user-specified order, no blank gap row: (1) sid/up/srv (2)
// uid/txn (3) tip/ts (4) equation bar (5) floor readout. The first 3
// groups each go through wrapStatLine (see renderTipInfo) and can wrap to
// 2 rows on their own with realistic-length ids — confirmed with fake test
// data ("sess_9f3a7c2e", "tx_..." etc. push sid/srv and uid/txn to 2 rows
// each) — so MAX allows for all three wrapping at once (6) + the bar (1) +
// the floor row (1).
const TIP_MIN_H = 5;
const TIP_MAX_H = 8;
// wrap:false, not true — renderTipInfo() already does its own wrapping via
// wrapStatLine (inserting real '\n' breaks at a width WE measure), so
// leaving blessed's wrap:true on let blessed re-wrap those already-final
// lines a second time using ITS OWN width measurement, which can disagree
// with ours (see the '·' width-bug note on dbMeter above) — that mismatch
// is what pushed "srv: --" onto its own line even though it fit within our
// own width budget (user: "srv: -- doesn't get split on two lines").
const tipBox = blessed.box({
  top: 0, right: 0, width: SIDE_TOTAL_W, height: TIP_MIN_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// ── ZONE 6.65 — Network zone, docked directly beside (to the LEFT of)
// tipBox — a standalone panel, same hierarchy as tipBox rather than chips
// folded into the icon cluster or spliced under it (user: "i want network
// zone to be next to tip zone. in the same hierarchy. just another zone
// next to it. to its left."). Three rows now: network address and the
// dedicated ethernet indicator stacked ABOVE peer (user: "put network and
// ethernet in the same box as peer. above peer. the need to be in the
// header section, not in the top menu.") — see renderNetworkInfo() for the
// actual line order. Both used to live inlined in the header's title row
// (row 0, next to the EBYS version badge) instead, but that's "the top
// menu" the user wants this OUT of; this box (docked beside tipBox at
// TRAIN_TIP_TOP, header row 3) is "the header section" they want it IN.
// Width widened accordingly from the old peer-only box — network's own
// worst case ("network: [wifi: xxxxxxxxxxxx] 255.255.255.255") is the
// longest line this box now has to fit, not the short peer-dots row.
// Positioned in reflow(), right-anchored as a pair with tipBox against
// masterColLeft rather than pinned to recColStart (see reflow()'s own
// comment on why that changed).
const NETWORK_ZONE_W = 40;
const NETWORK_ZONE_H = 2;
const NETWORK_ZONE_GAP = 2; // breathing room between networkBox and tipBox
const networkBox = blessed.box({
  top: 0, left: 0, width: NETWORK_ZONE_W, height: NETWORK_ZONE_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// LINK deck-select dots — one per slot EBYS can send LINK info to (user:
// "i want 4 dots. grey if slot isnt connected to any system. white is
// connected. and fill the dot if selected. if selected and link is fired,
// the infos goes to that deck."). Three states per dot:
//   grey ○   — not connected to anything
//   white ○  — connected, not the current target
//   white ●  — connected AND selected — this is where :link fire sends
// linkSelectedSlot: 0-3, or null (nothing selected — the pre-existing
// single-peer :link fire behavior, unchanged). Set via ":link select <1-4>"
// (see its handler further down).
const LINK_SLOT_COUNT = 4;
let linkSelectedSlot = null;

// Only slot 0 has a real connectivity signal right now — state.linkPeerOnline,
// from the legacy on/off UDP pairing (linkRecvSock's PEER_ONLINE/
// PEER_OFFLINE handling, see near LINK_IPC_RECV). Slots 1-3 render grey
// until "the newer multi-deck LINK subsystem" (see :link's own handler
// comment — ws_server.js/slicer.js's arm/fire/mode system) actually reports
// back which decks are reachable; there's no such signal wired yet, so
// they're honest placeholders, not fake data.
function linkSlotConnected(i) {
  return i === 0 ? !!state.linkPeerOnline : false;
}

function linkDotsLine() {
  let out = '';
  for (let i = 0; i < LINK_SLOT_COUNT; i++) {
    const selected  = linkSelectedSlot === i;
    const connected = linkSlotConnected(i);
    const glyph = selected ? '●' : '○';
    const color = (selected || connected) ? 'bright-white' : 'grey';
    out += '{' + color + '-fg}' + glyph + '{/' + color + '-fg}';
    if (i < LINK_SLOT_COUNT - 1) out += ' ';
  }
  return out;
}

// [wifi: SSID]/[ethernet: hostname] + IP — the network address text itself.
// Pulled out as its own function so it can be inlined directly into the
// header's title row (see titleCenter in render()) instead of living in a
// separately positioned floating box — user: "make sure the network infos
// stay in the header, aligned with ebys version... right now, the network
// box moved to the menu zone and is covering ebys version and agpl
// license." That covering bug was exactly because a floating box, anchored
// off the master-meter column boundary (meaningful for rows 3+, NOT row 0),
// had no actual guarantee of clearing titleCenter's own CENTERED text on a
// typical terminal width — the two spans just happened to overlap. Folding
// this into titleCenter itself instead means it's now part of the same
// single concatenated string withLCR already pads/sizes correctly, so it
// can never land on top of stateChips or iconCluster — there's nothing left
// to "collide" with, it's just more text in the one line.
// classifyIface() (see its own comment) tells us WHICH kind of connection
// this is; what label we print for it depends on the kind:
//   wifi     — the actual SSID (user: "show the name of the chosen wifi
//              network"), refreshed by the separate updateWifiSsid() poll
//              (see its own comment) since that needs a shell-out, not the
//              free os.networkInterfaces() read. Falls back to the bare
//              [wifi] label until the first lookup lands.
//   ethernet — plain wired Ethernet has no SSID equivalent — nothing
//              broadcasts a "network name" on a wired LAN. The closest
//              useful stand-in is THIS machine's own hostname, since
//              that's what other devices on the same wire would actually
//              use to find it (directly, or via its hostname.local mDNS/
//              Bonjour alias) — user asked "what would be the appropriate
//              way to name machines connected within that ethernet
//              connection?".
//   neither  — (unrecognized interface naming) no label, just the IP, same
//              as before this feature existed.
function networkAddrText() {
  // Spinner frame first, while a :network join is in flight — see
  // wifiConnecting's own comment for why this (not just the sepBox
  // spinner) is the guaranteed-visible spot for it.
  if (wifiConnecting) {
    return '{bright-white-fg}' + SPIN_FRAMES[spinFrame] + ' connecting…{/bright-white-fg}';
  }
  const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const ifaceKind = state.network ? classifyIface(state.network.iface) : null;
  if (!state.network) return '{grey-fg}offline{/grey-fg}';
  const label = ifaceKind === 'wifi'     ? (wifiSsid ? `[wifi: ${trunc(wifiSsid, 12)}] ` : '[wifi] ')
              : ifaceKind === 'ethernet' ? `[ethernet: ${trunc(os.hostname(), 12)}] `
              : '';
  return '{bright-white-fg}' + label + state.network.address + '{/bright-white-fg}';
}

// peer: <4 dots> — same label:value convention tipBox's own sid:/srv:/uid:
// rows use. All that's left in the standalone networkBox now that the
// address line moved into the header (see networkAddrText() above) — back
// to a single row, back beside tipBox (TRAIN_TIP_TOP — see reflow()),
// where there's real free space for a floating box instead of a row
// already fully spoken for by stateChips/titleCenter/iconCluster. peer's
// value used to be plain "online"/"offline" text — replaced with the dots
// themselves (user: "when peer are offline, dont write offline. just show
// the 4 empty grey circles") since they already carry richer per-slot
// state than one boolean ever could.
function renderNetworkInfo() {
  // network, then peer — dedicated ethernet tag removed per user request
  // (it duplicated the [ethernet: ...] label networkAddrText() already
  // folds into the network line itself when that's the active interface).
  const lines = [
    '{grey-fg}network:{/grey-fg} ' + networkAddrText(),
    '{grey-fg}peer:{/grey-fg} ' + linkDotsLine(),
  ];
  networkBox.setContent(lines.join('\n'));
  return lines.length;
}

// DJ/producer split "equation" bar — shares SHARED_BAR_W with the entropy
// meter above (see its comment) rather than its own independently-computed
// width.
const EQ_BAR_W = SHARED_BAR_W;

const pad2 = n => String(n).padStart(2, '0');

// Explicit white — used for "--" placeholders specifically, so a missing
// value stays legible/white even inside a row whose labels are grey,
// instead of quietly inheriting whatever color tag happens to still be
// "open" around it (see the tip/ts row below, which used to wrap its
// whole line — labels AND values — in one outer {grey-fg}).
const wht = s => '{bright-white-fg}' + s + '{/bright-white-fg}';

function fmtClock(ms) {
  if (!ms) return wht('--:--:--');
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

// Elapsed time since a timestamp, as HH:MM:SS — answers "how long has it
// been running", which a bare open clock-time (fmtClock) doesn't without
// the DJ doing the subtraction themselves. Same --:--:-- placeholder style
// as fmtClock for the unknown case, rather than a bare "--".
function fmtDuration(ms) {
  if (ms == null) return wht('--:--:--');
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function renderTipInfo() {
  const sidTxt = state.session.sessionId || wht('--');
  // Backend reachability (see ws_server.js's tipBackendUp / pingBackend) —
  // this reflects the tipping HTTP server's own reachability, not a live
  // Stripe API check — tips.js doesn't expose Stripe's own connection state
  // for the WS bridge to read, so server reachability is the closest
  // available proxy for "is the tipping infrastructure up".
  const srvTxt = state.tipBackendUp === true ? '{bright-white-fg}ok{/bright-white-fg}'
    : state.tipBackendUp === false ? '{bright-white-fg}{bold}offline{/bold}{/bright-white-fg}' : wht('--');
  // uid = the tipper's identity (lastTip.username) — the person the "tip"
  // row's dollar amount came from, not the DJ. Pairs with txn (both are
  // "who/what paid" identifiers), one row above tip/ts.
  const uidTxt = lastTip ? lastTip.username : wht('--');
  const upTxt  = fmtDuration(
    (state.session.active && state.session.openedAt) ? Date.now() - state.session.openedAt : null);

  // lvl — which of the tipping protocol's 3 precision levels this session
  // is running at (see docs/protocol/TIPPING_PROTOCOL.md):
  //   1 = Web Radio (EBYS)           — mode 'web'
  //   2 = Venue (EBYS + Card Reader) — mode 'venue', deck 'ebys'
  //   3 = Venue (Non-EBYS + Reader)  — mode 'venue', deck 'direct'
  // '--' while no tipping session is open at all. Used to sit as its own
  // [LVL n/3] chip in the header (title row, then the icon cluster) —
  // moved here instead, next to tip:/ts: (user: "remove [LVL --] from the
  // menu. put lvl: in the tip zone. next to tip:. right before ts:.").
  const tipLevel = !state.session.active ? null
    : state.session.mode === 'web' ? 1
    : state.session.mode === 'venue' ? (state.session.deck === 'direct' ? 3 : 2)
    : null;
  const lvlTxt = tipLevel ? '{bright-white-fg}' + tipLevel + '/3{/bright-white-fg}' : wht('--');

  // DJ/producer split "equation" — always visible, not gated on lastTip,
  // since it's the standing split rule, not a per-tip result. Leads the
  // panel (above the per-tip sid/uid/tip rows below) since it's the
  // standing rule everything else is measured against, not a result of
  // any one tip — editable live via :setSplit, see currentCuratorShare().
  // ∫ (INTEGRAL SIGN, U+222B) for the DJ — plain Σ (summation) was
  // rejected: the DJ doesn't just combine the artists' fragments, they
  // transform them (EQ, pitch, width, pan, timing — the whole signal
  // chain) while doing it. ∫ already carries both ideas in one glyph —
  // it's literally an elongated Σ (from Latin "summa"), a sum stretched
  // into its transformed, continuous form, rather than spelling "sum" +
  // "transform" out as two separate characters (ΣT). aᵢ ("a" + LATIN
  // SUBSCRIPT SMALL LETTER I, U+1D62) is still the artists/tracks/
  // fragments being folded in — a single general term, "artist i", rather
  // than spelling out literal indices 1/2/3 (which implied exactly three
  // artists, not an arbitrary many). Both plain BMP characters, same
  // safety class as ✳/❄ above (a spider web + insects pairing was
  // considered first but those live in the astral-plane emoji range,
  // U+1F577+ — exactly the glyph class that broke blessed's column-width
  // math earlier in this file).
  const liveCuratorShare = currentCuratorShare();
  const eqPct = Math.round(liveCuratorShare * 100) + '/' + Math.round((1 - liveCuratorShare) * 100);

  // sid/up/srv, uid/txn, and tip/ts each go through wrapStatLine too (not
  // just as one row) — a real session id, username, or txn id can run long
  // enough to overflow SIDE_TOTAL_W on its own (confirmed with realistic
  // fake values), and plain string concatenation has no wrap-with-indent
  // safety net the way wrapStatLine does. Labels are grey, values are left
  // at the box's default white (or explicitly wht()'d when a placeholder)
  // — no row is wrapped in one big outer {grey-fg} anymore, since blessed
  // tags don't nest/revert cleanly (closing an inner {/bright-white-fg} drops
  // back to "no color" rather than back to the outer grey), which is what
  // made "--" placeholders read grey instead of white before.
  // Order — user-specified layout: sid/up/srv, uid/txn, tip/ts lead the
  // panel now, THEN the DJ/artist equation bar and its floor readout
  // (previously the bar led, with a blank gap row before the per-tip
  // lines) — and no blank row anywhere, everything flush.
  // sid/up/srv specifically stays on ONE line, fixed — not wrapStatLine's
  // dynamic width-based wrap, which could push "srv: --" onto its own line
  // (user: "make sure the -- of srv: stays on the same line"). No
  // BAKE_INFO_INDENT prefix any more either — tipBox sits flush against
  // its own left edge now (aligned with [REC •], see reflow() — user:
  // "align the tip section with REC"), not indented under the VU sidebar
  // the way training still is.
  const lines = [];
  lines.push('{grey-fg}sid:{/grey-fg} ' + sidTxt + ' · '
    + '{grey-fg}up{/grey-fg} ' + upTxt + ' · '
    + '{grey-fg}srv:{/grey-fg} ' + srvTxt);

  // uid + txn share one row, above tip/ts — who tipped, and the txn it
  // came in on. tip itself is just the dollar amount.
  lines.push(wrapStatLine([
    '{grey-fg}uid:{/grey-fg} ' + uidTxt,
    '{grey-fg}txn:{/grey-fg} ' + (lastTip ? lastTip.txnId : wht('--')),
  ], tipBox.width));

  // tip is just the dollar amount — who/how much they paid is already
  // covered by uid/txn above; lvl (see tipLevel above) sits right before
  // ts, which is when it landed.
  lines.push(wrapStatLine([
    '{grey-fg}tip{/grey-fg} ' + (lastTip ? '$' + lastTip.amount.toFixed(2) : wht('--')),
    '{grey-fg}lvl{/grey-fg} ' + lvlTxt,
    '{grey-fg}ts{/grey-fg} ' + fmtClock(lastTip ? lastTip.ts : null),
  ], tipBox.width));

  // DJ/producer split "equation" bar — always visible, not gated on
  // lastTip, since it's the standing split rule, not a per-tip result (now
  // an editable one — see :setSplit). Rendered with splitBar() below, the
  // same solid-block convention dbMeter() uses elsewhere in the header.
  // ∫ (INTEGRAL SIGN, U+222B) for the DJ — plain Σ (summation) was
  // rejected: the DJ doesn't just combine the artists' fragments, they
  // transform them (EQ, pitch, width, pan, timing — the whole signal
  // chain) while doing it. ∫ already carries both ideas in one glyph —
  // it's literally an elongated Σ (from Latin "summa"), a sum stretched
  // into its transformed, continuous form, rather than spelling "sum" +
  // "transform" out as two separate characters (ΣT). aᵢ ("a" + LATIN
  // SUBSCRIPT SMALL LETTER I, U+1D62) is still the artists/tracks/
  // fragments being folded in — a single general term, "artist i", rather
  // than spelling out literal indices 1/2/3 (which implied exactly three
  // artists, not an arbitrary many). Both plain BMP characters, same
  // safety class as ✳/❄ above (a spider web + insects pairing was
  // considered first but those live in the astral-plane emoji range,
  // U+1F577+ — exactly the glyph class that broke blessed's column-width
  // math earlier in this file).
  // Solid block bar (splitBar, see its own comment) instead of the old
  // dash-and-cursor entropyBar() rendering — user: "using unicode blocks to
  // represent the tip scale". █ portion = curator/∫ share, ░ portion =
  // artist pool/aᵢ — editable live via :setSplit (see currentCuratorShare()
  // above), not just a readout anymore.
  lines.push('{grey-fg}∫{/grey-fg} ' + splitBar(liveCuratorShare, EQ_BAR_W)
    + ' {grey-fg}aᵢ{/grey-fg}  ' + eqPct
    + (curatorShareOverride !== null ? '  {grey-fg}(:setSplit override){/grey-fg}' : ''));

  // Separate, still-unwired feature: user-settable MINIMUM guarantees for
  // either side (floorDj/floorArtist, no :setFloor command yet — "--" until
  // one exists), distinct from curatorShareOverride above, which is the
  // actual live split value the bar/eqPct/:tip all use right now.
  lines.push(wrapStatLine([
    '{grey-fg}floor ∫:{/grey-fg} ' + (floorDj !== null ? (floorDj * 100).toFixed(0) + '%' : wht('--')),
    '{grey-fg}floor aᵢ:{/grey-fg} ' + (floorArtist !== null ? (floorArtist * 100).toFixed(0) + '%' : wht('--')),
  ], tipBox.width));

  const content = lines.join('\n');
  tipBox.setContent(content);
  return content.split('\n').length;
}

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
    grid[r][c * 2] = lit.has(i) ? '{bright-white-fg}●{/bright-white-fg}' : '{grey-fg}○{/grey-fg}';
  });
  grid[row][col * 2] = '{bold}{bright-white-fg}●{/bright-white-fg}{/bold}';
  return grid.map(rowArr => rowArr.join(''));
}
// Width fill is always sp.width directly — NOT derived from pan
// position/radius. An earlier version computed master's ring fill as
// "1 - joystick radius", which meant panning away from center always
// drained the ring toward empty regardless of actual width — a real bug
// (reported as "panning right loses width"), not a DSP issue. Master has no
// DSP width parameter of its own (M/S width is only ever computed per-stem
// — there's no summed-master M/S stage), so its ring is driven by :width
// all instead — :width master is just an alias for :width all (see the
// verb === 'width' handling below), both update this same sp.width.
function spatialStemLines(stemKey) {
  // No padding to STEM_ROW_BAND_H anymore — same reasoning as vuStemLines
  // above: this box is independent now, sized to the ring's own real
  // SPATIAL_H (5) rows instead of match-padded to 7.
  const sp = state.spatial[stemKey] || { x: 0, y: 0, width: 1 };
  return spatialFrameLines(sp.x, sp.y, sp.width);
}
function renderSpatial() {
  VU_SIDEBAR_STEMS.forEach((s, i) => {
    spatialStemBoxes[i].setContent(spatialStemLines(s.key).join('\n'));
  });
  const sp = state.spatial[VU_MASTER.key] || { x: 0, y: 0, width: 1 };
  masterSpatialBox.setContent(spatialFrameLines(sp.x, sp.y, sp.width).join('\n'));
}

// ── ZONE 6.7 — Descriptor grid: rolling window of real transitions ──────────
// Middle column: docks its own right edge just left of the VU/spatial/bake/
// tip/entropy sidebar (SIDE_TOTAL_W + gap from the screen's right edge), same
// "right:"-anchored convention as vuStemBoxes/spatialStemBoxes above. One
// small box per stem (descGridStemBoxes), each positioned directly under
// that stem's own waveform+stats block in playBox — see the comment above
// VU_SIDEBAR_STEMS for why this is an array of small boxes rather than one
// tall box with blank filler rows.
// One block per stem, no separate title row — the stem abbreviation (same
// vcl/mel/bas/drm labels VU_SIDEBAR_STEMS already uses, same VU_LABEL_W
// column width) sits on the FIRST dimension row's prefix, blank under it,
// same convention vuSidebarBlock() uses. Each column is one real slice from
// that stem's descRollBuffers ring (see its own comment above) — every
// column boundary IS a transition by construction, so every seam gets the
// same '│' divider. No grading by how big the jump was: the ask was "mark
// it when the slice changes," not "mark how much it changed."
// ░▒▓█ = low→high within that dimension's stemRanges min/max, via density
// (ink coverage) rather than color — see DESC_SHADES. This replaced an
// earlier color-lerp version (solid block, hue or lightness read off a
// gradient): the black end of a lightness gradient is invisible against
// this box's own black background, and a hex-color approach also turned
// out to be hitting a real bug in blessed 0.1.81's color cache (see the
// require('blessed/lib/colors')._cache = {} fix up near the top of this
// file) — density sidesteps both problems at once, since every shade glyph
// is legible in a single plain foreground color, nothing ever needs to
// render as literal black, and there's no hex-to-terminal-color matching
// involved at all. · (always grey) = no info, full stop — covers both
// reasons a cell can't be graded: this specific slice has no usable value
// (FluCoMa reports 0 for unpitched/below-confidence P, and drums has no P
// at all — see CRICKET.md's descriptor table), or this stem+dimension has
// no usable stemRanges min/max to grade against (missing entry, or a
// degenerate/non-finite min===max) — see `rangeUsable` in renderDescGrid()
// below. Both collapse to the same dot on purpose: which of the two reasons
// applied doesn't matter. Blank = ring slot not filled yet (fewer than
// DESC_ROLL_PAIRS real transitions have happened since the buffer was last
// cleared) — the grid structure itself (labels, dims, '│' seams) is always
// drawn regardless of whether any real data has arrived yet, see
// renderDescGrid() below; there's no separate "waiting" placeholder state
// anymore, an all-blank grid already reads as "nothing here yet."
// Right-anchored the same distance from the VU sidebar regardless of width,
// so this can never creep into the VU column.
// 0, was 1 — user: "make the visualizers closer. less space in between"
// (horizontal spacing between momentum/transition/vu-spatial specifically).
const DESC_GRID_GAP  = 0;
const DESC_LABEL_W   = VU_LABEL_W;   // shares the vcl/mel/bas/drm column width
const DESC_LABELS    = { vocals: 'vcl', melody: 'mel', bass: 'bas', drums: 'drm' };
// Trailing numeric readout appended to every row in both the descriptor
// grid and the momentum panel (see descValueStr() below) — user: "add
// numbers next to the 2 descriptor visualizations (momentum and
// transition). so we can see the actual value." Width 7 matches the
// widest values the old per-stem range-bar row used to print (F/H can run
// to "-100.00"/"1413.01") before that row was removed (see the comment
// near playLines.push, "remove the range bar showing descriptor value
// under the waveform").
const DESC_VALUE_GAP = 2;
const DESC_VALUE_W   = 7;
// Sized to the grid's actual printed width, not SIDE_TOTAL_W — the box used
// to be forced as wide as the VU+spatial column, which left dead space
// between the last colored cell and the VU meters (box background matches
// the screen background, so that slack was invisible but still pushed the
// grid visually far from the VU zone). Width = label(1 char, e.g. "C") +
// its trailing space + DESC_ROLL_PAIRS pairs of 2 cells each, separated by
// '│' between pairs, all sitting after the DESC_LABEL_W-wide stem-label
// gutter, plus the value gap+column appended at the end.
const DESC_GRID_W = DESC_LABEL_W + 2 + (DESC_ROLL_PAIRS * 2 + (DESC_ROLL_PAIRS - 1))
                   + DESC_VALUE_GAP + DESC_VALUE_W;

// Density, not color: 4 unicode shade glyphs, sparse to solid ink coverage,
// same reading order as the old lightness gradient (low value = sparse,
// high value = solid) but every glyph is legible in one plain foreground
// color — nothing needs a special case for "would be invisible on black."
const DESC_SHADES = ['░', '▒', '▓', '█'];
function descShadeFor(t) {
  t = Math.max(0, Math.min(1, t));
  const i = Math.min(DESC_SHADES.length - 1, Math.floor(t * DESC_SHADES.length));
  return DESC_SHADES[i];
}

// Live numeric value for one stem+dim, appended to the end of that dim's
// row in both the descriptor grid and the momentum panel (see DESC_VALUE_W
// above). Reads straight off state.stems — the same live cursor value the
// old per-stem range-bar row used to print via nC/nE/nF/etc, and the exact
// value momentumBarTick() samples into curBarBuffers each tick — so this is
// always "the current value", not a historical one, regardless of which
// past transitions the grid/sparkline next to it happen to be showing.
// descIsMissing() (defined below) is reused so "missing" reads identically
// here as it does for the shade/glyph cells themselves.
function descValueStr(stem, dim) {
  const s = state.stems[stem];
  const v = s ? s[dim] : null;
  // A stem that's never received a real "seg"/"desc" message yet (id still
  // at its untouched init default, '--' — same neverStarted signal used
  // for the waveform bracket, see its own comment near sliceBar()) has no
  // real C/S/E/F/P/H/T of its own — every dim is still whatever the
  // initial state object was created with (0, or 0.0 depending on dim).
  // Printing those as real numbers read as actual (if boring) measured
  // values instead of "nothing here yet" (user: "when no infos, dont
  // write 0 or 0.0 ... write --. then when the infos comes in, the real
  // numbers should appear").
  const neverStarted = !s || s.id === '--' || s.id === undefined;
  // Left-aligned against the graph (user: "align the descriptors numbers
  // of the descriptor visualization to the actual graph. dont align them
  // to the right side, align them left.") — padEnd instead of padStart so
  // the digits start right after the gap instead of hugging the far edge.
  if (neverStarted || descIsMissing(v, dim)) return '{grey-fg}' + '--'.padEnd(DESC_VALUE_W) + '{/grey-fg}';
  const n = parseFloat(v) || 0;
  let str;
  switch (dim) {
    case 'E': case 'T': case 'F': str = n.toFixed(1); break; // F: user asked for 00.0, not 00.00
    case 'H':           str = n.toFixed(2); break;
    default:            str = String(Math.round(n)); // C, S, P
  }
  return '{grey-fg}' + str.padEnd(DESC_VALUE_W) + '{/grey-fg}';
}

// Array, not one tall box — same reasoning as vuStemBoxes/spatialStemBoxes:
// each stem's 7-dim grid gets its own STEM_ROW_BAND_H-tall box, positioned
// directly under that stem's own waveform block.
const descGridStemBoxes = DESC_STEMS.map(() => blessed.box({
  top: playTop, right: SIDE_TOTAL_W + DESC_GRID_GAP, width: DESC_GRID_W, height: STEM_ROW_BAND_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
}));

// ── ZONE 6.9 — Momentum panel — docked directly left of the descriptor grid,
// same array-of-small-boxes convention descGridStemBoxes itself uses, and
// deliberately the SAME row layout: stem label on the first dim row only,
// dim letter and its bar on one line (not stacked) so every row lines up
// 1:1 with the grid's own rows sitting right next to it. No '│' seam against
// the descriptor grid on purpose — that seam marks "discrete cut boundary"
// over there; here it would just be visual noise against one continuous strip.
// Width matches DESC_GRID_W exactly (MOM_MAX_SAMPLES is defined as that same
// column count above) — same physical width as the transition grid sitting
// next to it, even though this panel fills one column at a time rather
// than one pair per real cut. User: "keep the previous width, it was good"
// (a shorter, decoupled width was tried and reverted — see MOM_MAX_SAMPLES's
// own comment; what actually changed instead is the strip's fill SPEED and
// its behavior once full, not its width).
// 0, was 1 — user: "make the visualizers closer. less space in between"
// (horizontal spacing between momentum/transition/vu-spatial specifically).
const MOM_GAP = 0;
const MOM_W   = DESC_GRID_W;
// Array, same reasoning as descGridStemBoxes — one STEM_ROW_BAND_H-tall box
// per stem, positioned directly under that stem's own waveform block.
const momentumStemBoxes = DESC_STEMS.map(() => blessed.box({
  top: playTop, right: SIDE_TOTAL_W + DESC_GRID_GAP + DESC_GRID_W + MOM_GAP,
  width: MOM_W, height: STEM_ROW_BAND_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
}));

function momentumStemLines(stem) {
  const label = (DESC_LABELS[stem] || '').padEnd(DESC_LABEL_W, ' ');
  const blank = ''.padEnd(DESC_LABEL_W, ' ');
  return DIMS.map((dim, di) => {
    // Follow-graph tag, right next to the dim letter — user: "when one
    // descriptor is following another track, i want a tag next to the
    // momentum visualizer. something like [drms] in grey next to the E of
    // vocals. any parameter that follows another channel should be tagged
    // this way. name of the followed channel next to the descriptor in
    // question." (The descriptor grid already carries a follow indicator
    // of its own — a shade-glyph separator + gutter abbreviation — but
    // that's a different panel; this is the momentum panel's own tag.)
    // Eats into the sparkline's own width rather than widening the box
    // (tuned flush against the descriptor grid beside it), so this panel's
    // total row width — and its alignment with that grid — never changes.
    const followMap = (state.followGraph[stem] && state.followGraph[stem][dim]) || {};
    const followEntries = Object.entries(followMap);
    let tag = '';
    let tagW = 0;
    if (followEntries.length > 0) {
      followEntries.sort((a, b) => b[1] - a[1]); // dominant target first
      const [topTarget] = followEntries[0];
      const abbr = DESC_LABELS[topTarget] || topTarget;
      tag = '{grey-fg}[' + abbr + ']{/grey-fg} ';
      tagW = abbr.length + 3; // "[" + abbr + "]" + trailing space
    }
    return (di === 0 ? label : blank) + dim + ' ' + tag
      + momSparkline(stem, dim, MOM_MAX_SAMPLES - tagW)
      + ' '.repeat(DESC_VALUE_GAP) + descValueStr(stem, dim);
  });
}
function renderMomentumPanel() {
  DESC_STEMS.forEach((stem, i) => {
    momentumStemBoxes[i].setContent(momentumStemLines(stem).join('\n'));
  });
}

function descIsMissing(v, dim) {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return true;
  if (dim === 'P' && v === 0) return true;
  return false;
}

// One stem's 7-dim grid — the FULL content of that stem's own small
// descGridStemBoxes[i], no leading gap needed since the box itself is
// already positioned to start right under that stem's own waveform.
function descGridStemLines(stem) {
  if (Object.keys(stemRanges).length === 0) loadStemRanges();

  // No more "waiting for slice transitions…" placeholder state — the grid
  // structure (stem labels, dimension rows, '│' seams) always renders, same
  // shape whether it's full of real data or completely empty. An empty
  // buffer just means every pair falls into the `i >= buf.length` blank
  // branch below, so the row prints as its label/dims with nothing but
  // blanks and seams — reads as "nothing here yet" on its own, no separate
  // message needed.
  const lines = [];
  const buf   = descRollBuffers[stem];
  const rng   = stemRanges[stem] || {};
  const label = (DESC_LABELS[stem] || '').padEnd(DESC_LABEL_W, ' ');
  const blank = ''.padEnd(DESC_LABEL_W, ' ');

  DIMS.forEach((dim, di) => {
    const dimRange = rng[dim];
    // No info = no info, regardless of which of the two reasons caused it
    // (this specific slice has no usable value, vs. this stem+dimension
    // has no computed range to grade against) — both render as the same
    // dot.
    const rangeUsable = dimRange && isFinite(dimRange.min) && isFinite(dimRange.max)
      && dimRange.max !== dimRange.min;
    const cellFor = v => {
      if (descIsMissing(v, dim) || !rangeUsable) return '{grey-fg}·{/grey-fg}';
      const t = Math.max(0, Math.min(1, (v - dimRange.min) / (dimRange.max - dimRange.min)));
      return descShadeFor(t);
    };
    // Each pair renders as OUT immediately followed by IN — no gap between
    // them, since those two cells are the actual glue point of one real
    // cut. The '│' only goes BETWEEN different transitions.
    const pairs = [];
    for (let i = 0; i < DESC_ROLL_PAIRS; i++) {
      // No transition recorded at this slot yet — same "no data" dot as a
      // recorded transition whose value is missing (see cellFor above),
      // instead of a blank space.
      if (i >= buf.length) { pairs.push('{grey-fg}··{/grey-fg}'); continue; }
      const p = buf[i];
      pairs.push((p.out ? cellFor(p.out[dim]) : ' ') + cellFor(p.in[dim]));
    }
    // followStem indicator — this dimension isn't reading its own
    // descriptor, it's blended from another stem (see :followStem).
    // Two things mark it, both reusing existing width rather than
    // widening the box (which is tuned flush against the VU sidebar):
    //   1. The separator between the dim letter and its cells swaps from
    //      a plain space to a shade glyph, picked by descShadeFor() off
    //      the SAME follow weight the audio engine actually blends by —
    //      a 50% follow reads as a mid shade, 100% reads solid, so the
    //      glyph itself communicates how strongly it's being pulled, not
    //      just that it is.
    //   2. The target's abbreviation (vcl/mel/bas/drm) fills the
    //      left-hand label gutter on rows 2–7, which is otherwise always
    //      blank there (row 1 keeps the stem's own label — the one
    //      unavoidable collision is C specifically being followed, where
    //      the shade-glyph separator is the only indicator since that
    //      gutter slot is already the stem name).
    const followMap = (state.followGraph[stem] && state.followGraph[stem][dim]) || {};
    const followEntries = Object.entries(followMap);
    let sep = ' ';
    let leftGutter = di === 0 ? label : blank;
    if (followEntries.length > 0) {
      followEntries.sort((a, b) => b[1] - a[1]); // dominant target first
      const [topTarget, topWeight] = followEntries[0];
      sep = descShadeFor(topWeight);
      if (di !== 0) {
        leftGutter = ('→' + (DESC_LABELS[topTarget] || topTarget)).padEnd(DESC_LABEL_W, ' ');
      }
    }
    const prefix = leftGutter + dim + sep;
    lines.push(prefix + pairs.join('{grey-fg}│{/grey-fg}')
      + ' '.repeat(DESC_VALUE_GAP) + descValueStr(stem, dim));
  });
  return lines;
}
function renderDescGrid() {
  DESC_STEMS.forEach((stem, i) => {
    descGridStemBoxes[i].setContent(descGridStemLines(stem).join('\n'));
  });
}


// ── ZONE R — the training screen (hidden until ^T / :train) ──────────────────
// The training screen, the peer of playback (see the SCREEN MODEL comment
// near PLAYBACK_HEADER_BOXES/CHAT_OVERLAY_BOXES) — this shows Learn mode's
// two sub-views (learnView: 'training' | 'review' — see the LEARN MODE
// section, right after stopBakeLoop, for the full picture). reviewListBox is
// only used by the 'review' view (hidden in 'training', where
// reviewDetailBox takes the full width) — see reflowLearn(). All three
// start hidden — enterLearnMode()/exitLearnMode() toggle them directly.
const reviewHeaderBox = blessed.box({
  left: 0, width: '100%', height: 1,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});
const reviewListBox = blessed.list({
  left: 0, width: 40, height: 10,
  tags: true, mouse: true,
  // Never .focus()ed — inputBox stays the one focused/keyable widget the
  // whole app relies on (see CURSOR-AWARE INPUT EDITING below). .select()
  // just drives the highlight to match reviewIndex; every Learn-mode action
  // is still a typed :train command, same as :bake/:link/everything else.
  style: {
    selected: { fg: 'black', bg: 'bright-white' },
    item:     { fg: SKIN.fg },
  },
});
const reviewDetailBox = blessed.box({
  left: 41, width: '100%', height: 10,
  tags: true, wrap: true,
  scrollable: true, alwaysScroll: true, mouse: true,
  style: { fg: SKIN.fg, bg: SKIN.bg, scrollbar: { bg: 'grey' } },
});

// Sits where playBox normally does, but ONLY while learnView === 'review' —
// playBox shows the LIVE engine's current per-stem state, which has nothing
// to do with whichever past bake you're browsing (still correct/wanted in
// the 'training' sub-view, where a bracket really is live). render() toggles
// which of the two is shown every tick (see playTop's own comment block) —
// this box itself never needs positioning from reflowLearn(), same as
// playBox is only ever positioned inside render().
const reviewWaveformBox = blessed.box({
  left: 0, width: '100%', height: 2,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// reviewRegressionBox — the regression section (subtitle+rule, fitted-curve
// graph, then its own picker menu underneath — see appendBakeGraphLines())
// as its own full-width box, 'review'-only same as reviewWaveformBox. User:
// "the order must be: bake menu with its own menu to its right [reviewListBox
// + reviewDetailBox, entry-detail only now] ... then under it is the
// recording section ... and then under it is the regression section." Used
// to be crammed into the tail of reviewDetailBox, sharing space (and
// scroll position) with the entry-detail prose above it — pulled out into
// its own box so it's a genuinely separate, independently-sized section
// instead. Positioned/sized in reflowLearn() only (same as reviewListBox/
// reviewDetailBox), never in render() (same reasoning as those two).
const reviewRegressionBox = blessed.box({
  left: 0, width: '100%', height: 10,
  tags: true, wrap: true,
  scrollable: true, alwaysScroll: true, mouse: true,
  style: { fg: SKIN.fg, bg: SKIN.bg, scrollbar: { bg: 'grey' } },
});
[reviewHeaderBox, reviewListBox, reviewDetailBox, reviewWaveformBox, reviewRegressionBox].forEach(b => b.hide());

// ── ZONE F — Footer shortcut bar, pinned to the very bottom, both modes ──────
// Mirrors sdj-tui.js's login-screen footer: inverse-video key "chip"
// followed by a plain label, left-anchored. See the key bindings themselves
// (bottom of this file, near "Mode toggles") for what each one actually
// does and why they're all safe to fire while typing in inputBox.
const FOOTER_H = 1;
const footerBox = blessed.box({
  bottom: 0, left: 0, width: '100%', height: FOOTER_H,
  tags: true,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});
// active=true adds a small dot after the label instead of relabeling the
// chip — Chat/Learn are toggles ON a base playback state, not destinations
// you navigate between, so the chip's own name never changes, just whether
// it's currently on.
function footerChip(key, label) {
  return `{inverse} ${key} {/inverse} ${label}`;
}
// ^T switches between the two SCREENS (playback/Learn) — the label names
// wherever it's about to take you, same "destination, not a dot" idea as
// before. ^C is a pure overlay toggle now, independent of which screen is
// active (see the SCREEN MODEL comment above CHAT_OVERLAY_BOXES) — closing
// it doesn't land you on any one particular screen, it just returns to
// whichever one was already underneath, so "Close" instead of naming a
// destination that isn't always the same one.
// ^L — moved to the right-flushed side (user: "move log out tab control to
// the right side of the screen") — always shown there, both screens, same
// as it always fired from either. ^R/^B — training-screen sub-navigation,
// share that same right side, but only while appMode === 'learn' (user:
// "the training/review sub tab should only appear when train tab is
// open") — the keys themselves still work from Playback (switchLearnView()
// enters Learn mode first), but the chips stay hidden until you're
// actually there. ^L sits outermost/rightmost either way, since it's the
// one action here that isn't training-specific.
function renderFooter() {
  const leftChips = [
    footerChip('^C', chatMaximized ? 'Close' : 'Chat'),
    footerChip('^T', appMode === 'learn' ? 'Playback' : 'Train'),
  ];
  const leftStr = '  ' + leftChips.join('   ');
  const vis = s => s.replace(/\{[^}]+\}/g, '').length;

  // [^Q]/[^A] — shortcut tabs for :commands/:language, chat-only — user:
  // "I want them as tabs at the bottom of the screen" (moved here after an
  // earlier attempt as a clickable tag up on menuHeaderBox — "thats not
  // what i meant"), then moved AGAIN from the left cluster to right before
  // Log out (user: "put them on the right side of the screen right before
  // log out") — spliced into rightChips just ahead of the ^L entry in BOTH
  // branches below instead of living in leftChips, so it's still always
  // immediately left of Log out regardless of appMode.
  // These used to show ⌘/文 as BOTH the key glyph AND (implicitly) the only
  // label, with no real key binding behind them at all — typing
  // :commands/:language was the only actual way to trigger these. Split now
  // (user: "use Q for commands. use the symbols for the desription
  // (commands become the command mac symbol and language becomes the
  // chinese letter)"): the bracketed tab is a real, typeable Control combo —
  // ^Q for commands (Q, user's own pick — Q was already free alongside the
  // ^C/^T/^R/^B/^L set), ^A for language ("A" from lAnguage) — and ⌘/文
  // moved down into the description slot instead, purely decorative there,
  // same as they always visually were. See footerChip() calls below and
  // toggleCommandsPanel()/toggleLanguagePanel() for the matching real
  // bindings.
  const cmdLangChips = chatMaximized ? [footerChip('^Q', '⌘'), footerChip('^A', '文')] : [];

  // Log out (^L) is always the LAST entry in rightChips in both branches,
  // and rightStr is right-flushed all the way to screen.width below (same
  // as it always was) — so it's always the rightmost thing on screen,
  // regardless of whatever else sits in this row (user: "make sure log out
  // is always at the most right side of the screen"). cmdLangChips sits
  // right before it in both branches (see comment above).
  // Bake chip (^B/^D) — always shown on the training screen (stepBake()
  // cold-starts into Review from either sub-view, so both keys always do
  // SOMETHING here, unlike the graph chip below). Collapsed back down to
  // ONE chip covering both directions (user: "put them in the same tab,
  // cause its taking a lot of space for something not so important") —
  // arrows instead of two separate "(up)"/"(down)" chips. Still reads
  // "^B/^D", not "^B/^H" — Ctrl+H is the one request this file can't
  // actually honor: confirmed live (see the mode-toggles comment block
  // above) that it arrives as a plain Backspace keystroke, not a
  // distinguishable Ctrl combo, so the label would be lying about what key
  // to press if it said H.
  const bakeChips = [footerChip('^B/^D', '↑↓ Bake')];
  // Graph chip (^P/^N) — same "only shown where the key actually does
  // something" rule ^R/^B already follow, just one level narrower (review
  // sub-view specifically, not the whole training screen) since stepGraph()
  // itself is a no-op outside Train > Review (see stepGraphKey()). Same
  // one-chip collapse as bakeChips above, same reasoning.
  const graphChips = (appMode === 'learn' && learnView === 'review')
    ? [footerChip('^P/^N', '↑↓ Graph')]
    : [];
  const rightChips = appMode === 'learn'
    ? [footerChip('^R', learnView === 'training' ? 'Review' : 'Training'),
       ...bakeChips,
       ...graphChips,
       ...cmdLangChips,
       footerChip('^L', 'Log out')]
    : [...cmdLangChips, footerChip('^L', 'Log out')];
  const rightStr = rightChips.join('   ') + '  ';
  // EBYS version + AGPL badge moved back up to the header's title row
  // (user: "put back ebys version and agpl license at the top of the
  // screen") — see titleCenter in render()'s withLCR call. This row is
  // just the shortcut chips again, left and right.
  const gap = Math.max(1, screen.width - vis(leftStr) - vis(rightStr));
  footerBox.setContent(leftStr + ' '.repeat(gap) + rightStr);
}

// ── INPUT ────────────────────────────────────────────────────────────────────
let inputLines = 1;
// One blank row between the input line and the footer chip row — the
// cursor used to sit directly on top of the footer with nothing separating
// them. Content boxes that stack up to the input (currently just logBox,
// inside the chat overlay — see reflow()) subtract this too, so the gap is
// actually reserved rather than eaten by whichever box sits above it.
const INPUT_GAP = 1;
const inputBox = blessed.textarea({
  // width: '100%' — same reasoning as sepBox/langBox/cmdBox/logBox above
  // (see the CONTENT_W/contentW() comment near VU_SIDEBAR_W): inputBox is
  // pinned to the very bottom of the screen, nowhere near the master VU/
  // spatial meters' row band (rows 3-7), so there's no actual column to
  // stay clear of down here. bottom: FOOTER_H + INPUT_GAP (not just
  // FOOTER_H) — leaves the footer chip row its own permanent line under
  // the input, with a blank row between them.
  bottom: FOOTER_H + INPUT_GAP, left: 0, width: '100%', height: 1,
  inputOnFocus: true, tags: false, wrap: true,
  style: { fg: SKIN.user_fg, bg: SKIN.bg },
});

// peekBox — "always there" 2-3 line preview of the most recent log
// activity, sitting directly above inputBox — user: ":start and :stop
// should never open the chat. I still want to see their linked messages.
// but i dont want the chat to open fully... maybe have a short window of
// text of 2-3 lines. always there." Mirrors recentLogLines (kept in sync
// by appendLog() regardless of chatMaximized/opts.quiet — see its own
// comment), so a command whose feedback is deliberately marked quiet
// (skips the full chat auto-open) still shows up here instead of
// vanishing into a hidden logBox. Hidden while chat IS maximized (see
// reflow()) since logBox already shows the same tail, in full, right
// there — no need for a redundant duplicate.
const PEEK_H = 3;
const peekBox = blessed.box({
  bottom: FOOTER_H + INPUT_GAP + inputLines, left: 0, width: '100%', height: PEEK_H,
  tags: true, wrap: false,
  style: { fg: SKIN.fg, bg: SKIN.bg },
});

// Thin rule directly above peekBox — demarcates the command/chat preview
// from whatever's stacked above it (log/cmd/lang while chat is maximized,
// or the bare playback/training screen otherwise) — user: "put something
// to demarcate the chat line. maybe a thin line above it?" Always visible
// (inputBox itself is never hidden, so neither is this), and its `bottom`
// tracks inputBox's own height (inputLines can grow past 1 line — see the
// inputLines comment) PLUS peekBox's own height, so the rule always sits
// directly above whichever of peekBox/inputBox is currently the topmost
// of the pair, never overlapping either. Content/position both refreshed
// in reflow(), which runs on every render tick, so width changes (resize)
// and inputLines changes both stay in sync automatically.
const inputRuleBox = blessed.box({
  bottom: FOOTER_H + INPUT_GAP + inputLines + PEEK_H, left: 0, width: '100%', height: 1,
  tags: true,
  style: { fg: 'grey', bg: SKIN.bg },
});

// Ghost-completion box — sits on the SAME row as inputBox, left-offset to
// start exactly where the typed text ends, so it never overlaps a single
// real character (user: "guess what the command will be... propose the
// continuation in grey"). A separate box rather than appending colored text
// into inputBox's own content: inputBox runs with tags:false on purpose (so
// a user typing a literal "{" never gets silently eaten as markup — see the
// CURSOR-AWARE INPUT EDITING block below), and this way that stays
// untouched. width:'shrink' (same trick spinnerBox uses) keeps it exactly
// as wide as the suggestion text, never wider — see updateSuggestion().
const suggestBox = blessed.text({
  bottom: FOOTER_H + INPUT_GAP, left: 0, width: 'shrink', height: 1,
  tags: true, wrap: false,
  style: { fg: SKIN.user_fg, bg: SKIN.bg },
});
suggestBox.hide();

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
screen.append(menuHeaderBox);
screen.append(langBox);
screen.append(cmdBox);
screen.append(logBox);
vuStemBoxes.forEach(b => screen.append(b));
screen.append(masterVuBox);
spatialStemBoxes.forEach(b => screen.append(b));
screen.append(masterSpatialBox);
screen.append(entropyBox);
screen.append(tipBox);
screen.append(networkBox);
descGridStemBoxes.forEach(b => screen.append(b));
momentumStemBoxes.forEach(b => screen.append(b));
screen.append(reviewHeaderBox);
screen.append(reviewListBox);
screen.append(reviewDetailBox);
screen.append(reviewWaveformBox);
screen.append(reviewRegressionBox);
screen.append(inputBox);
screen.append(peekBox);
screen.append(inputRuleBox);
screen.append(suggestBox);
screen.append(footerBox);
screen.append(spinnerBox);

// ── SCREEN MODEL ─────────────────────────────────────────────────────────────
// There are exactly two main SCREENS — playback (appMode 'playback') and
// training (appMode 'learn', ^T toggles between them) — plus exactly one
// OVERLAY, chat (^C), which can toggle on top of whichever screen is
// currently active without changing it. Nothing here is mutually exclusive
// with anything else anymore: ^T keeps working while chat is open (the
// overlay just follows you to the new screen), and ^C keeps working
// regardless of which screen you're on. See the SCREEN VISIBILITY block in
// render() for the one place that actually applies these rules — every box
// group below is just data, not its own show()/hide() logic, specifically
// so two different toggle functions never independently disagree about the
// same box again (that pattern — enterLearnMode/exitLearnMode/
// toggleChatMaximize each separately forcing overlapping box sets — was the
// root cause of several rounds of "X bled into Y" bugs).

// CHAT_OVERLAY_BOXES — the separator, the :language/:commands hint row, the
// two panels themselves, and the actual chat log. All five exist ONLY
// inside the overlay now — never part of either screen's own idle content
// (reflow() only ever positions them while chatMaximized). ^C alone
// controls all five, regardless of which screen is underneath.
const CHAT_OVERLAY_BOXES = [sepBox, menuHeaderBox, langBox, cmdBox, logBox];

// MASTER_METER_BOXES — master's own VU meter + spatial ring. Split out of
// PLAYBACK_HEADER_BOXES (below) — user: "in the training page, dont forget
// to show the VU/spat meters too." Unlike bake/tip/entropy (genuinely
// playback-specific: live bracket state, current tip session, current
// entropy setting), the master meters just reflect the audio actually
// coming out of the engine, which stays meaningful while training/reviewing
// too (`:train play` plays real audio) — so these two stay up on BOTH
// screens instead of being hidden with the rest of the cluster. Reserved
// screen space for them: reflowLearn() narrows the training panel's own
// boxes to contentW() so they stop short of this column — the chat overlay
// boxes below don't need that same margin, since mTop always docks them
// below master's row band rather than beside it (see the CONTENT_W/
// contentW() comment above VU_SIDEBAR_W).
const MASTER_METER_BOXES = [masterVuBox, masterSpatialBox];

// PLAYBACK_HEADER_BOXES — the REST of playback's own header-cluster readouts
// (tip/entropy — bake used to be here too, see the ZONE 6.6 comment above
// for why it isn't any more). The direct analog of Learn's own header
// cluster (reviewHeaderBox/reviewListBox/reviewDetailBox, see
// enterLearnMode()): visible for as long as the playback screen is active,
// chat overlay or not — it's what the overlay docks under (see
// headerClusterBottom in reflow()). Hidden only when the OTHER screen
// (Learn) is active.
const PLAYBACK_HEADER_BOXES = [entropyBox, tipBox, networkBox];

// PLAYBACK_CHANNEL_BOXES — the per-stem VU/spatial/descriptor-grid/momentum
// boxes, "channel content" for whichever screen currently has a LIVE
// 4-stem waveform up (playBox's own per-stem waveform rows are the other
// half of this, handled directly in render() since they're shared between
// Playback and Learn's training sub-view). Up on both Playback and the
// training screen's 'training' sub-view now (user: "add the visualizations
// in the training tab too") — hidden only during the training screen's
// 'review' sub-view (reviewWaveformBox there is one recorded clip, not
// four live stems) or while chat is maximized on top of either screen —
// see the SCREEN VISIBILITY block in render().
const PLAYBACK_CHANNEL_BOXES = [
  ...vuStemBoxes,
  ...spatialStemBoxes,
  ...descGridStemBoxes, ...momentumStemBoxes,
];

// ── RENDER ────────────────────────────────────────────────────────────────────

function sliceBar(s, name, bpm, width) {
  const durMs   = s.durMs || 0;   // full stem buffer duration (ms)
  const bars    = s.bars  || 4;
  const safeBpm = Math.max(1, bpm || 120);

  // Prefer the actual segDurMs sent by slicer.js (threaded through ws_server).
  // Fall back to BPM-derived estimate only when not yet received.
  const segDurMs = (s.segDurMs > 0) ? s.segDurMs : (bars * 4 * 60000 / safeBpm);

  // A stem that has NEVER received a real "seg"/"desc" message (id still at
  // its untouched init default, '--' — e.g. a stem with zero analyzed
  // slices for the loaded track, like a near-silent vocal take slicer.js
  // can never select anything for) has no real durMs/bars/segDurMs to build
  // a bracket from — every value below is still whatever the initial state
  // object was created with. The math further down used to run anyway,
  // producing a small bogus bracket (segDurMs's bars-based fallback ÷ an
  // arbitrary 300000ms constant) sized off numbers that were never actually
  // measured — a bracket in the wrong place/width next to siblings with
  // real geometry, which read as "glitching". Full-width, no-selection is
  // the honest picture: this stem hasn't picked anything, so there's no
  // real window to draw.
  const neverStarted = s.id === '--' || s.id === undefined;

  // Bracket position in the full stem buffer.
  // Use real fracs when available; fall back to startPos estimate.
  let startPos;
  if (neverStarted) {
    startPos = 0;
  } else if (s.sliceStart !== undefined) {
    startPos = s.sliceStart;
  } else {
    startPos = stemSliceStartPos[name] !== undefined ? stemSliceStartPos[name] : (s.pos || 0);
  }
  // Bracket end position — prefer the exact endFrac slicer sent (s.sliceEnd).
  // This is the ground truth: it's totalFrac accumulated directly from slice durations.
  // Fallback: derive from segDurMs / durMs (less accurate, used before first seg message).
  let endPos;
  if (neverStarted) {
    endPos = 1;
  } else if (s.sliceEnd !== undefined && s.sliceEnd > startPos) {
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
      `{bright-white-fg}${waveGlyphs(env, startCh + 1, playedEnd, width)}{/bright-white-fg}` +
      `{grey-fg}${waveGlyphs(env, playedEnd, endCh, width)}]${waveGlyphs(env, endCh + 1, width, width)}{/grey-fg}`
    );
  }

  return (
    `{grey-fg}${'─'.repeat(startCh)}[{/grey-fg}` +
    `{bright-white-fg}${'█'.repeat(filledW)}{/bright-white-fg}` +
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
  const w = Math.max(1, screen.width || 80);
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
  // w = screen.width, not contentW() — lang/cmd (and the rest of the chat
  // overlay) are full width now, not narrowed for the VU sidebar (see the
  // CONTENT_W/contentW() comment above VU_SIDEBAR_W), so their wrapped-line
  // estimate below needs to match that same width or langHFull/cmdHFull
  // would under-count how many rows the content actually needs.
  const w = screen.width;
  const h = screen.height - FOOTER_H; // footerBox always owns the very last row

  // peekBox — sits directly above inputBox, see its own comment near its
  // definition. bottom tracks inputLines so it stays glued to input's
  // current top edge even while input is multiple lines tall.
  peekBox.bottom = FOOTER_H + INPUT_GAP + inputLines;
  // inputRuleBox — thin line directly above peekBox, see its own comment
  // near its definition. Same inputLines tracking, plus PEEK_H so it
  // clears peekBox too.
  inputRuleBox.bottom = FOOTER_H + INPUT_GAP + inputLines + PEEK_H;
  inputRuleBox.setContent('{grey-fg}' + '─'.repeat(Math.max(0, w)) + '{/grey-fg}');

  // langHFull/cmdHFull are the EXPANDED content height only — while collapsed
  // a panel takes 0 rows of its own, since its "type to expand" hint now
  // lives in menuHeaderBox instead (see buildMenuHeaderLine).
  const langHFull = langCollapsed
    ? 0
    : (langContent || '').split('\n').reduce((s, l) => s + visLines(l, w), 0);
  const cmdHFull  = cmdCollapsed
    ? 0
    : (cmdContent  || '').split('\n').reduce((s, l) => s + visLines(l, w), 0);

  // Layout order: sep → menuHeader → lang → cmd → log. lang/cmd only occupy a
  // row while expanded; chat's old dedicated header row is gone the same
  // way — its hint folded into menuHeaderBox too.
  //
  // langH/cmdH themselves are computed further down, inside the
  // chatMaximized block, once mTop (where the overlay actually starts) is
  // known — they used to be computed here instead, against `fixedTop` (a
  // position near the TOP of zone 1) and a `Math.floor(h / 2)` cap that had
  // nothing to do with mTop or with each other. Since the overlay actually
  // docks under mTop — which can be well below fixedTop (under the master
  // header cluster, under the Learn panel, under the review waveform box)
  // — that budget was frequently just wrong: it let lang+cmd claim more
  // rows than were genuinely left above the input line, which is exactly
  // how the log (and cmdBox itself) ended up bleeding down onto the cursor
  // line and the footer below it. See the real computation at `chromeBudget`
  // below for the fix.

  // The whole chat overlay (sep/menuHeader/lang/cmd/log — see
  // CHAT_OVERLAY_BOXES) only ever gets positioned here while chatMaximized;
  // when it's not, all five are hidden (see the SCREEN VISIBILITY block in
  // render()) and nothing below matters. It always docks directly under
  // whichever screen's own header cluster is currently active — playback's
  // (statusBox + master VU/spatial + bake/tip/entropy) or Learn's own panel
  // (learnPanelBottom()) — never a fixedTop-based position of its own,
  // since it's never shown standalone in either base screen anymore. The
  // playback boxes referenced below are positioned later in this same
  // function, so that branch reads back whatever they were set to on the
  // PREVIOUS reflow() tick (one frame stale at worst — same staleness
  // statusH already accepts elsewhere in here); learnPanelBottom() has no
  // such lag, it's derived from statusH/screen.height directly.
  logBox.width = '100%';
  if (chatMaximized) {
    // Review sub-view keeps its own reviewWaveformBox (the recorded clip's
    // waveform + playhead — the "playback of the recorded file" zone) on
    // screen even with chat maximized (see the SCREEN VISIBILITY block
    // below, where it's shown unconditionally while inReview instead of
    // being hidden under chat like playBox). reviewWaveformBox now docks
    // INSIDE the learn-panel footprint, right under the header (user: "put
    // the menu under recording" — see reflowLearn()), not below it anymore
    // — so learnPanelBottom() alone is already the true bottom of the whole
    // cluster (waveform + list/detail together), same as the training
    // sub-view. No more "+1+2" tacked on for the waveform's old spot below
    // the panel.
    const headerClusterBottom = appMode === 'learn'
      ? learnPanelBottom()
      : Math.max(
          statusH + 1,
          masterVuBox.top      + masterVuBox.height,
          masterSpatialBox.top + masterSpatialBox.height,
          tipBox.top            + tipBox.height,
          entropyBox.top        + entropyBox.height
        );
    const mTop = headerClusterBottom + 1; // one blank row of breathing room
    sepBox.top = mTop;

    menuHeaderBox.top    = mTop + 1;
    menuHeaderBox.height = 1;
    menuHeaderBox.setContent(buildMenuHeaderLine());

    // Hard budget for lang+cmd, derived from the REAL mTop (see the comment
    // above `available` for why the old version — computed off `fixedTop`
    // instead — could be wrong). Everything between menuHeaderBox (mTop + 2
    // rows) and the reserved floor (MIN_LOG_H for the log + LOG_GAP +
    // inputLines + INPUT_GAP for the input line) has to fit inside this. lang
    // gets first claim on it, cmd gets whatever's left — and if content
    // doesn't fit, it scrolls inside its own box (both are already
    // scrollable — see ZONE 3.5/ZONE 4) instead of pushing the log further
    // down than there's room for. This is the actual fix for the log/cmdBox
    // bleeding onto the cursor line: nothing below this point can ever claim
    // more vertical space than chromeBudget allows, so logTop can never land
    // past where the input line starts.
    // No row reserved for inputRuleBox here — it's hidden while chat is
    // maximized (see the chatMaximized ? hide : show line above), so the
    // log can reclaim that row instead of leaving it blank underneath a
    // box that isn't drawing anything.
    const chromeBudget = Math.max(0, h - (mTop + 2) - LOG_GAP - MIN_LOG_H - inputLines - INPUT_GAP);
    const langH = langCollapsed ? 0 : Math.min(langHFull, chromeBudget);
    const cmdH  = cmdCollapsed  ? 0 : Math.min(cmdHFull,  Math.max(0, chromeBudget - langH));

    langBox.top    = mTop + 2;
    langBox.height = langH;

    cmdBox.top    = mTop + 2 + langH;
    cmdBox.height = cmdH;

    logBox.left = 0;
    const logTop = mTop + 2 + langH + cmdH + LOG_GAP;
    logBox.top  = logTop;
    // No MIN_LOG_H floor here on purpose — chromeBudget above already
    // reserved room for it in the common case, but this is the last line of
    // defense: if some other box shifted mTop further down than expected
    // this tick, newLogH still can't exceed the real remaining space, so the
    // log shrinks instead of overlapping the input line/footer.
    const newLogH = Math.max(1, h - logTop - inputLines - INPUT_GAP);
    if (newLogH !== cachedLogH) {
      const wasBottom   = atBottom();
      const savedScroll = wasBottom ? -1 : logBox.getScroll();
      cachedLogH        = newLogH;
      logBox.height     = newLogH;
      if (!wasBottom) logBox.scrollTo(savedScroll);
    }
  }


  // VU meters / spatial rings / descriptor grid / momentum panel — one small
  // box per real stem, each positioned directly under THAT stem's own
  // waveform+descriptor-line+weight+dir+dirWgt block (top: playTop +
  // i*STEM_BAND_H + PRE_METERS_ROWS, height STEM_ROW_BAND_H). See the
  // comment above VU_SIDEBAR_STEMS for why these are arrays of small boxes
  // rather than one tall box apiece.
  VU_SIDEBAR_STEMS.forEach((s, i) => { vuStemBoxes[i].top = playTop + i * STEM_BAND_H + PRE_METERS_ROWS; });
  renderVuSidebar();

  spatialStemBoxes.forEach((b, i) => { b.top = playTop + i * STEM_BAND_H + PRE_METERS_ROWS; });
  renderSpatial();

  DESC_STEMS.forEach((stem, i) => {
    descGridStemBoxes[i].top = playTop + i * STEM_BAND_H + PRE_METERS_ROWS;
    momentumStemBoxes[i].top = playTop + i * STEM_BAND_H + PRE_METERS_ROWS;
  });
  renderDescGrid();
  renderMomentumPanel();

  // master's own VU meter + spatial ring — docked right at "last touched"
  // (header row MASTER_VU_TOP = 1), not all the way below the whole header
  // any more — user: "put master VU meter closer to last touched". Not
  // threaded through the per-stem arrays above since master has no
  // waveform row of its own to align with. Right-anchored same as always;
  // shares rows with trackKey/env/genre on the left (different columns,
  // same rows — no collision, same reasoning as the per-stem meters/weight
  // overlap elsewhere in this file).
  masterVuBox.top      = MASTER_VU_TOP;
  masterSpatialBox.top = MASTER_VU_TOP;

  // Network + tip zones, same top (TRAIN_TIP_TOP, header row 3, "quant:
  // beat"'s own row). No longer anchored to recColStart (the [REC] column)
  // — that pinned both zones far into the same tight corner the icon
  // cluster already occupies, which is what squeezed tipBox down to almost
  // nothing (user: "move the zones so tip has enough space to sit
  // correctly. now its all packed up in a corner."). Anchored from the
  // RIGHT instead: masterColLeft is the one hard boundary that actually
  // matters (one column short of master's own VU/spatial column — user:
  // "make sure the master VU meter and spat viewer dont get written over
  // by the tip and network zone") — the pair sizes itself to its full
  // desired width (networkBox's NETWORK_ZONE_W + gap + tipBox's own
  // SIDE_TOTAL_W) flush against that boundary, and only starts eating into
  // either zone's width if the terminal is genuinely too narrow to fit
  // both at their natural size. No minimum-width floor overrides that
  // clamp either — a zone shrinks toward 0 in a real space crunch rather
  // than ever overlapping master.
  const masterColLeft = w - SIDE_TOTAL_W - 1;
  const zonesDesiredW = NETWORK_ZONE_W + NETWORK_ZONE_GAP + SIDE_TOTAL_W;
  const zonesLeft     = Math.max(0, masterColLeft - zonesDesiredW);

  // Back to TRAIN_TIP_TOP, beside tipBox — row 0 (tried per an earlier
  // "align it with ebys version" request) turned out to only be safe in
  // theory: zonesLeft is anchored off masterColLeft, a boundary that means
  // something for rows 3+ (clearing the master VU/spatial column) but has
  // no real relationship to where titleCenter's CENTERED text actually
  // sits on row 0 — on a typical terminal width the two spans genuinely
  // overlapped, and the floating box (drawn after statusBox in z-order)
  // covered the version/AGPL badge. Fixed properly now by moving the
  // network ADDRESS text into titleCenter itself (see networkAddrText()'s
  // own comment) — that's what's actually "aligned with ebys version" —
  // and letting this box go back to being just the peer dots, back in its
  // own free row where it isn't fighting anything else for space.
  networkBox.right = undefined;
  networkBox.left  = zonesLeft;
  networkBox.top   = TRAIN_TIP_TOP;
  networkBox.width = Math.max(0, Math.min(NETWORK_ZONE_W, masterColLeft - zonesLeft));
  renderNetworkInfo();

  // Tips — left edge is networkBox's own right edge plus a gap (0 if
  // networkBox itself got clamped to nothing). left/right reassigned every
  // call since this box was originally created right-anchored.
  // bakeInfoBox — the training-zone panel that used to sit beside this —
  // was removed from the playback screen entirely (user: "remove the
  // training zone indicator in the playback tab. this should all go in
  // the training tab" — its content, bakeInfoLines(), is already shown in
  // full on the training screen's own 'training' sub-view, so showing it
  // here too was pure duplication).
  const tipLeft = zonesLeft + networkBox.width + (networkBox.width > 0 ? NETWORK_ZONE_GAP : 0);
  tipBox.right = undefined;
  tipBox.left  = tipLeft;
  tipBox.top   = TRAIN_TIP_TOP;
  tipBox.width = Math.max(0, Math.min(SIDE_TOTAL_W, masterColLeft - tipLeft));
  const tipRows = renderTipInfo();
  tipBox.height = Math.min(TIP_MAX_H, Math.max(TIP_MIN_H, tipRows));

  // Entropy meter — below genre (header's last row), flush to the left
  // edge of the window (user: "really stick entropy to the side of the
  // window") and one row further down than statusH (user: "move entropy
  // one space downward") — now that it hugs the left edge instead of
  // centering, it no longer shares horizontal space with the training/tips
  // cluster (which now hangs off recColStart, well to the right), so it
  // doesn't need to clear that cluster's bottom, just the header's own
  // last row plus the extra row of breathing room.
  entropyBox.right = undefined;
  entropyBox.left  = 0;
  entropyBox.top   = statusH + 1;
  const entropyRows = renderEntropyMeter();
  entropyBox.height = Math.min(ENTROPY_MAX_H, Math.max(ENTROPY_MIN_H, entropyRows));
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
  // statusBox and playBox are both declared width: '100%' — same full
  // terminal width sepBox/menuHeaderBox/langBox/cmdBox/logBox now use too
  // (see the CONTENT_W/contentW() comment above VU_SIDEBAR_W). Both the
  // header row and the per-stem playback rows (waveform, descriptor line,
  // weight, dir, dirWgt) use `w` = screen.width — the VU/spatial/descriptor-
  // grid/momentum columns dock UNDER each stem's own block (see
  // STEM_BAND_H), not beside it, so nothing needs to narrow these rows.
  const w = screen.width;

  // Status
  const conn  = state.connected ? '{bright-white-fg}[CONNECTED]{/bright-white-fg}' : '{grey-fg}[DISCONNECTED]{/grey-fg}';
  const run   = state.running   ? '{bright-white-fg}[RUNNING]{/bright-white-fg}' : '{grey-fg}[STOPPED]{/grey-fg}';
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
  // edge defaults to the true right edge (w-1) — pass a smaller edge to
  // right-flush against an inner boundary instead (no longer needed for the
  // header rows now that master's column docks below the header rather than
  // beside it — see reflow() — but the param stays available for future use).
  const atCol = (left, right, edge) => {
    if (edge === undefined) edge = w - 1;
    const rightVis = strip(right).length;
    const startCol = edge - rightVis; // column `right` must start at to end exactly at edge
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

  // The old global "weight [all]"/"dir [all]"/dirWgt header row (a single
  // representative stem's values, standing in for all four) is gone —
  // superseded by the real per-stem weight/dir/dirWgt rows in each stem's
  // own playback block below (see spWp in the stems.forEach loop). Removing
  // it frees this side of the header for master's own VU meter + spatial
  // ring instead (see masterVuBox/masterSpatialBox, positioned in reflow()).

  // Entropy fader removed from the header for now — state.params.entropy is
  // still tracked (updated by the 'entropy' WS handler / :setEntropy), just not
  // displayed here, so it's ready to drop back in when we find its spot.
  // SegmentBars also stays out (it's shown per stem in the progression bars).
  // LUFS floors at -40 (quiet mix reads near-empty, nothing meaningful below
  // that); goes "hot" (red) at -3, the conventional headroom line before
  // clipping/limiting starts doing real work.
  // The header used to also show a global "TP" (true-peak) meter here —
  // removed: the VU sidebar already gives true peak per channel, with its
  // own peak-hold, which is strictly more useful than one global dBFS
  // number duplicating what those meters already show.
  const lufsMeter = dbMeter(state.lufs, state.lufsPeak, -40, -3, 10);
  // Numeric readout shows the PEAK (the yellow/red ▐ marker's value), not the
  // live instantaneous level — matches the hardware-meter convention of a
  // numeric peak readout next to a live bar. The bar's fill still shows the
  // current level; peakDecay() (below) keeps this number sliding back down
  // toward reality instead of sitting pinned at an old high forever.
  const envLine   = `{grey-fg}win:{/grey-fg} ${p.envelope}   {grey-fg}slices:{/grey-fg} ${sl}   ` +
    `{grey-fg}LUFSs{/grey-fg} ${lufsMeter} ${fmtMeterDb(state.lufsPeak, LUFS_INF_FLOOR)}   {grey-fg}quant:{/grey-fg} ${quantMode()}`;
  const genreBeatsLine = `${genreLine}   ${beatsHeaderLine()}`;

  // Header indicators — persistent LED-style, always visible (not
  // appearing/disappearing like the old statusIcons row) so they read like
  // hardware LEDs: dim grey when idle, lit when active.
  //   • record   — small dot, sits on the title row next to [CONNECTED]/
  //                [DISCONNECTED]. Red when state.recording, grey otherwise.
  //   [TIP OPEN]/[TIP CLOSED] — white when a tipping session is open, grey otherwise.
  //   [LINK ON]/[LINK OFF] — briefly flips to cyan ("pale blue") when a LINK missile
  //                fires (this deck's own :link fire OR a remote deck's — ws_server.js
  //                broadcasts 'linkMissile'/'fire_executed' to everyone),
  //                fades back to grey after LINK_FLASH_MS. No extra timer
  //                needed — the existing 100ms render tick (bottom of file)
  //                naturally re-evaluates this on every tick.
  //   Both TIP/LINK sit right-aligned on their own row, directly above
  //   "last touched" (see sLines below).
  const LINK_FLASH_MS = 1500;
  // [REC •] — white (bold) when recording (on), grey when idle (off). This is
  // the inverse of the TIP/LINK convention (where off is the alarm state):
  // for recording, lit means "we are capturing right now".
  const recLabel = state.recording
    ? `{bright-white-fg}[REC {bold}•{/bold}]{/bright-white-fg}` : `{grey-fg}[REC •]{/grey-fg}`;
  const tipOn        = state.session.active;
  const tipDirect     = tipOn && state.session.deck === 'direct' ? ' DIRECT' : '';
  const tipLabel     = tipOn
    ? `{bright-white-fg}[TIP OPEN${tipDirect}]{/bright-white-fg}` : `{grey-fg}[TIP CLOSED]{/grey-fg}`;
  // [LVL n/3] used to live here (and before that, on the title row) — moved
  // into the tip zone itself, next to tip:/ts: (user: "remove [LVL --] from
  // the menu. put lvl: in the tip zone. next to tip:. right before ts:.") —
  // see renderTipInfo()'s own lvl comment for the precision-level meaning.
  const linkFiring  = state.linkFiredAt > 0 && (Date.now() - state.linkFiredAt < LINK_FLASH_MS);
  // cyan reads as "pale blue" in this terminal palette — same convention
  // already used for the source-lock indicator.
  const linkLabel   = linkFiring
    ? `{bright-white-fg}[LINK ON]{/bright-white-fg}` : `{grey-fg}[LINK OFF]{/grey-fg}`;
  // PEER/NETWORK used to be chips in this cluster (and before that, a row
  // positioned under one of them) — pulled out entirely now into their own
  // dedicated zone box, networkBox, docked next to tipBox (user: "i want
  // network zone to be next to tip zone. in the same hierarchy. just
  // another zone next to it. to its left") — see renderNetworkInfo() and
  // networkBox's own comments below.
  // [CHUNK MODE ON/OFF] used to be a single header-wide chip here (mirroring
  // slicer.js's PLAY_FULL_FILE, "on" if ANY stem was chunked) — removed
  // (user: "remove [CHUNK MODE] from the menu. instead, when chunk mode is
  // on, we see it in the infos under the waveform. we see the [x] numbers
  // of bars. and when chunk mode is off, the bar number becomes
  // [fullfile]"). Chunk state is genuinely per-stem, so it's now printed
  // per-stem instead, as part of each stem's own bars: field — see the
  // barsTxt/barsStay comment in the stem loop below.
  // [TRAINING ON]/[TRAINING OFF] used to sit here, tied to bakeSessionActive
  // (bracket open/closed) — removed (user: "remove the training zone
  // indicator in the playback tab. this should all go in the training
  // tab"), then asked for back in a different shape: not bracket state
  // (the training screen's own header already covers that, as "[BRACKET
  // OPEN]"/"[no bracket open]" — see renderTrainingView()'s training
  // branch), just which SCREEN is currently active — "[TRAINING MODE] vs
  // [PLAYBACK MODE]". Bright for Learn (the less-common, "you're doing
  // something deliberate" state) — now ALSO bright for Playback (user: "no,
  // i meant the [PLAYBACK MODE] [TRAINING MODE] in the header" / "training
  // mode and playback mode should be white. so this toggle mode is always
  // white."), dropping the earlier grey-for-Playback/bright-for-Training
  // on/off distinction in favor of both states just being white always.
  const modeLabel = appMode === 'learn'
    ? `{bright-white-fg}[TRAINING MODE]{/bright-white-fg}`
    : `{bright-white-fg}[PLAYBACK MODE]{/bright-white-fg}`;
  // Order: REC, TIP, MODE, LINK. NETWORK/PEER no longer chips in here —
  // they're networkBox now, a standalone zone docked beside tipBox (see
  // renderNetworkInfo()/reflow()). LVL no longer lives in this cluster or
  // on the title row either — it's in the tip zone now, next to tip:/ts:
  // (see renderTipInfo()'s own comment). CHUNK is gone too — now per-stem,
  // see the barsTxt comment in the stem loop below.
  const iconCluster = `${recLabel}   ${tipLabel}   ${modeLabel}   ${linkLabel}`;

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
  const sessionLabel = `{bright-white-fg}[SESSION: ${sessionName.toUpperCase()}]{/bright-white-fg}`;
  // Header row: state chips left ([SESSION] first, then run/conn/rec),
  // EBYS version centered on the screen, TIP/LINK cluster flush right.
  // edge defaults to the true right edge, same override convention as atCol.
  // Also records where `right` (iconCluster, which starts with [REC]) ends
  // up starting — tipBox aligns its own left edge to that same column (see
  // reflow() — user: "align the tipping zone with the [REC] box").
  const withLCR = (left, center, right, edge) => {
    if (edge === undefined) edge = w - 1;
    const vis = s => s.replace(/\{[^}]+\}/g, '').length;
    const total = edge;
    const lV = vis(left), cV = vis(center), rV = vis(right);
    const gap1 = Math.max(1, Math.floor((total - cV) / 2) - lV);
    const gap2 = Math.max(1, total - rV - (lV + gap1 + cV));
    recColStart = lV + gap1 + cV + gap2;
    return left + ' '.repeat(gap1) + center + ' '.repeat(gap2) + right;
  };
  const stateChips = `${sessionLabel}   ${run}   ${conn}`;
  // EBYS version + AGPL badge — briefly moved down to the footer, back up
  // here now (user: "put back ebys version and agpl license at the top of
  // the screen"), centered in the title row same as it always was.
  // Network/ethernet used to be inlined right here too, but moved back out
  // (user: "put network and ethernet in the same box as peer. above peer.
  // the need to be in the header section, not in the top menu.") — this row
  // is what the user means by "top menu"; "header section" is networkBox,
  // docked beside tipBox at TRAIN_TIP_TOP — see renderNetworkInfo() for
  // where network/ethernet/peer all live now, stacked in that one box.
  const versionLabel = `{grey-fg}[EBYS 0.1.19]{/grey-fg}   `;
  const agplLabel    = `{grey-fg}[{bold}🄯{/bold} AGPL-3.0]{/grey-fg}`;
  const titleCenter  = versionLabel + agplLabel;
  // These five rows used to share their row-band with masterVuBox/
  // masterSpatialBox (both docked at top:0 back then), so they flushed
  // against an inner boundary short of the true right edge to leave room
  // for that column. Master now docks BELOW the header instead (see
  // reflow()), so nothing else occupies these rows on the right any more —
  // flush straight to the true right edge (atCol's/withLCR's default edge,
  // w-1) again.
  // Learn mode: track/key/win/slices/LUFSs/quant/genre/beats all describe
  // whatever's CURRENTLY loaded live — irrelevant noise while training or
  // paging through PAST bake sessions (each one may even be a different
  // track). Drop those rows entirely rather than blank them, so statusH
  // shrinks and the Learn panel (see LEARN MODE / reflowLearn()) climbs up
  // into the reclaimed space instead of sitting below a gap. The panel
  // itself takes over that space — see renderTrainingView()/reflowLearn().
  const sLines = appMode === 'learn' ? [
    withLCR(stateChips, titleCenter, iconCluster),
    atCol('', lastTouchLine),
  ] : [
    withLCR(stateChips, titleCenter, iconCluster),
    atCol('', lastTouchLine),
    atCol(trackKeyLine, ''),
    atCol(envLine, ''),
    atCol(genreBeatsLine, ''),
  ];
  statusH = sLines.reduce((h, l) =>
    h + Math.max(1, Math.ceil(visWidth(l.replace(/\{[^}]+\}/g,'')) / Math.max(1, w))), 0);
  statusBox.height = statusH;
  statusBox.setContent(sLines.join('\n'));

  // Below the header, several blocks now dock AT specific header rows
  // rather than stacking below the header as one column (see reflow() for
  // where each is actually positioned; MASTER_VU_TOP/TRAIN_TIP_TOP are the
  // shared anchors both this and reflow() use): master's VU+spatial column
  // starts at MASTER_VU_TOP ("closer to last touched"), training+tips start
  // side by side at TRAIN_TIP_TOP ("align prmpt: with quant:beat"), and the
  // entropy meter starts at statusH ("below genre", the header's last row).
  // playTop (where playBox and every per-stem column start) has to clear
  // the lowest bottom edge among all of these. Rendered here (not just left
  // to reflow(), which runs later and re-renders these same boxes anyway)
  // so playTop reserves only what each block ACTUALLY needs right now —
  // idle state is prmpt/stat/rcp (~4 rows) + a short tip block, nowhere
  // near BAKE_INFO_MAX_H/TIP_MAX_H's worst case (a full recipe table, a
  // wrapped multi-tip readout, etc.) — using the real count instead of
  // always the max is what keeps this gap tight instead of permanently
  // reserving room for content that isn't there most of the time.
  const tipH       = Math.min(TIP_MAX_H,       Math.max(TIP_MIN_H,       renderTipInfo()));
  const masterColBottom = MASTER_VU_TOP + 5; // master's own VU+spatial height
  const tipBottom       = TRAIN_TIP_TOP + tipH; // beside training, same top
  // No separate networkBottom candidate needed below — networkBox starts
  // at this same TRAIN_TIP_TOP and is fixed at NETWORK_ZONE_H (2) rows
  // (network/peer — see renderNetworkInfo()), still shorter than tipH's
  // own floor (TIP_MIN_H = 5), so tipBottom already covers it.
  // Entropy docks at statusH + 1 (left-edge column, no longer sharing
  // horizontal space with the training/tips cluster — see reflow()'s own
  // entropyBox.top) — mirrored here so playTop reserves the same real
  // space instead of guessing independently.
  const entropyH       = Math.min(ENTROPY_MAX_H, Math.max(ENTROPY_MIN_H, renderEntropyMeter()));
  const entropyBottom  = statusH + 1 + entropyH;
  // Learn mode: master/bake/tip/entropy are all hidden (PLAYBACK_HEADER_BOXES) —
  // their bottoms above are still computed (harmless, cheap) but shouldn't
  // reserve any space. The Learn panel occupies that space instead — see
  // learnPanelHeight()'s own comment, right above reflowLearn() — so
  // playBox starts below IT instead of below the (invisible) usual cluster.
  // One blank row between whichever block is lowest and the progression bars.
  playTop = appMode === 'learn'
    ? learnPanelBottom() + 1
    : Math.max(masterColBottom, tipBottom, entropyBottom, statusH) + 1;
  playBox.top = playTop;

  // ── SCREEN VISIBILITY ──────────────────────────────────────────────────
  // Single place deciding which box groups are actually on screen, given
  // appMode/learnView/chatMaximized — see the SCREEN MODEL comment above
  // CHAT_OVERLAY_BOXES for why this lives in one spot instead of scattered
  // across enterLearnMode()/exitLearnMode()/toggleChatMaximize(): those used
  // to each independently force their own overlapping box sets, which is
  // exactly what caused several rounds of "X bled into Y" bugs (chat
  // bleeding into playback, commands not showing in chat, playBox bleeding
  // under the maximized chat log, per-stem meters reappearing under Learn
  // mode...). Re-evaluated every render() tick — cheap, and blessed's
  // show()/hide() are no-ops when already in that state.
  const inLearn  = appMode === 'learn';
  const inReview = inLearn && learnView === 'review'; // training sub-view: everything below falls through to the playback-shaped rules, since a live bracket uses playBox the same way playback does

  // The chat overlay — same 5 boxes regardless of which screen is underneath.
  CHAT_OVERLAY_BOXES.forEach(b => chatMaximized ? b.show() : b.hide());

  // inputRuleBox — only while chat is CLOSED (user: "remove the line we
  // just added to demarcate the chat box. the line must exist only when
  // whole chat is closed"). While chat is maximized, logBox itself already
  // sits directly above inputBox and reads as its own boundary; the rule
  // was for demarcating the input line against the bare playback/training
  // screen, not against the chat log. peekBox hides right alongside it for
  // the same reason — logBox already shows this exact tail, in full, once
  // chat is open, so the small preview would just be a redundant duplicate.
  chatMaximized ? inputRuleBox.hide() : inputRuleBox.show();
  chatMaximized ? peekBox.hide()      : peekBox.show();

  // Master VU/spatial — up on BOTH screens (see MASTER_METER_BOXES), so
  // just always shown here regardless of inLearn/chatMaximized (mirrors how
  // the chat overlay itself keeps running "regardless of which screen is
  // underneath" per the SCREEN MODEL comment above).
  MASTER_METER_BOXES.forEach(b => b.show());

  // Playback's own remaining header cluster (bake/tip/entropy) — stays up
  // for as long as the playback screen is active, chat overlay or not
  // (mirrors the Learn panel's own always-up-in-Learn behavior).
  PLAYBACK_HEADER_BOXES.forEach(b => !inLearn ? b.show() : b.hide());
  // Per-stem "channel content" (VU, spatial, descriptor grid/momentum) —
  // user: "dont forget to add the visualizations in the training tab too.
  // descriptor graphs (momentum and transition) and vu/spat graphs." These
  // used to hide whenever inLearn, full stop — now they follow playBox's
  // OWN visibility instead (see the inReview branch right below): up
  // whenever there's a live per-stem waveform to sit next to, whether
  // that's plain Playback or the training screen's own 'training'
  // sub-view, and hidden only during 'review' (reviewWaveformBox there is
  // a single recorded clip, not four live stems — nothing for these to
  // align with) or while chat is maximized on top of either screen.
  PLAYBACK_CHANNEL_BOXES.forEach(b => (!inReview && !chatMaximized) ? b.show() : b.hide());

  // playBox/reviewWaveformBox — the two screens' shared "channel content"
  // slot. playBox serves playback AND Learn's training sub-view (a live
  // bracket really is live); reviewWaveformBox (the recorded clip's
  // waveform + playhead, see updateReviewWaveformBox()) replaces it only in
  // the review sub-view, since playBox's LIVE engine state has nothing to
  // do with whichever past bake you're browsing. playBox still hides under
  // a maximized chat (its content is meaningless once you're mid-conversation
  // — same as before), but reviewWaveformBox is the recorded-file playback
  // zone and stays up regardless of chat, same treatment as reviewHeaderBox/
  // reviewDetailBox get — the chat log docks below it instead (see
  // headerClusterBottom in reflow()) rather than covering it.
  // Position (top/width) is NOT set here anymore — reviewWaveformBox now
  // docks right under the header, ABOVE reviewListBox/reviewDetailBox (user:
  // "put the menu under recording"), which only reflowLearn() has the
  // layout for (see its own comment). Setting `.top = playTop` here too, on
  // every tick, would just fight reflowLearn()'s placement and drag it back
  // down to the OLD below-the-panel spot on the very next render(). This
  // block still owns show/hide and the playhead-content redraw, same as
  // before.
  if (inReview) {
    playBox.hide();
    reviewWaveformBox.show();
    updateReviewWaveformBox(reviewWaveformBox.width || w);
  } else {
    reviewWaveformBox.hide();
    if (!chatMaximized) playBox.show(); else playBox.hide();
  }

  // Playback bars — full window width again. The VU/spatial/descriptor-grid/
  // momentum columns dock UNDER each stem's own waveform+stats block now
  // (see STEM_BAND_H), not beside it, so nothing needs to narrow the bar or
  // the descriptor-line/weight/dir rows anymore — `w` (screen.width, same
  // one the header above uses) is fine for all of them.
  const stems  = ['vocals', 'melody', 'bass', 'drums'];
  // Row label text, distinct from the `stems` keys themselves (state.stems,
  // triggerReady/triggerMode etc. all still key off the full 'vocals' etc.
  // name — only the printed label changes) — user: "this section is
  // important in the design. i want it to be written: vocs, mels, bass,
  // drms", then shortened again (user: "rename the channels vocs, melo,
  // bass, drums by vcl, mel, bas, drm").
  const STEM_ROW_LABEL = { vocals: 'vcl', melody: 'mel', bass: 'bas', drums: 'drm' };
  // nameW trimmed to 4 (was 5, back when labels were 4 chars each — see
  // above) — all four labels are 3 chars now, so this is still a single
  // trailing space before pinMark/tMark, same "reduce the space between the
  // label and the waveform" request as before, just re-tightened to match.
  const nameW  = 4;
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

    // Row 0 — progress bar + timestamp (VU meters moved to sidebar)
    // Trigger mode indicator replaces the space before ':':
    //   ' ' = continuous  'T' = trigger mode  '●' = ready to fire (bold)
    const tRdy  = state.triggerReady[name];
    const tMode = state.triggerMode[name];
    const tMark = tRdy  ? `{bright-white-fg}{bold}●{/bold}{/bright-white-fg}` :
                  tMode ? `{bright-white-fg}T{/bright-white-fg}` : ' ';
    // Pin indicator: set via :setStemSource, shows this stem is locked to one
    // named source track instead of picking freely. Plain single-width glyph
    // (not an emoji pin) — emoji/wide glyphs render as 2 columns in most
    // terminals and silently break every fixed-width alignment downstream of
    // it, the same class of bug already fought in the VU sidebar this session.
    const pinMark = s.pinnedSource ? `{bright-white-fg}•{/bright-white-fg}` : ' ';
    playLines.push(`${pad(STEM_ROW_LABEL[name] || name, nameW)}${pinMark}${tMark}: ${b} ${tsStr}`);

    // Tail row — bars/stay/match/sid/genre/track/lock, right under the
    // waveform row. Used to be preceded by a 7-dim C/S/E/F/P/H/T range-bar
    // block (M↑━━●━━ nnnnn …) on this same line — removed (user: "remove
    // the range bar showing descriptor value under the waveform. now we
    // have the visualization that does a better job" — the descriptor grid
    // and momentum panels, docked beside the VU sidebar, show the same
    // dimensions with actual history instead of one static snapshot; see
    // descGridStemLines()/momentumStemLines(), which now print the live
    // value alongside each of their own rows too, per dim, so nothing
    // that was readable here is actually lost). This is the last row
    // before the meters start (see PRE_METERS_ROWS) — weight/dir/dirWgt
    // below still print on the SAME rows as the meters (left column vs.
    // right-anchored boxes), not above them, so the meters' own first row
    // lines up with "weight".
    // nameW + 4 lines this row's start up with where the waveform bracket
    // itself starts one row up: pad(name, nameW) + pinMark(1) + tMark(1) +
    // ": "(2) = nameW + 4 before `b` (user: "align the infos, such as
    // bars:x with the start of the waveform").
    // Row 1 lead-in — used to be blank padding under the name; now carries
    // this stem's remix/generate mode, stacked directly under STEM_ROW_LABEL
    // on the row above (user: "integrate the gen/remix indicator under the
    // channels name. vcl, mel, bas, drm..."). Sourced from
    // state.agentMode[name], which only ever updates from a confirmed
    // agentMode_<stem> param broadcast off slicer.js's setAgentMode() — see
    // the WS handler above, no optimistic local echo.
    // Both "rmx" and "gen" are always shown together now (user: "I want to
    // see them both, all the time" — a single tag that swapped text was
    // read as one indicator disappearing/changing rather than two fixed
    // options with one currently selected). Both render in grey; whichever
    // one matches the live mode switches to bold white (user: "the selected
    // rmx or gen becomes white"). Fills the full nameW+4 lead width itself
    // (7 visible cols: "rmx" + "/" + "gen", padded 1) — no separate blank
    // pad(''), unlike the single-tag version this replaces.
    const isGen  = state.agentMode[name] === 'generate';
    const rmxSeg = isGen ? '{grey-fg}rmx{/grey-fg}' : '{white-fg}{bold}rmx{/bold}{/white-fg}';
    const genSeg = isGen ? '{white-fg}{bold}gen{/bold}{/white-fg}' : '{grey-fg}gen{/grey-fg}';
    const leadPad     = rmxSeg + '{grey-fg}/{/grey-fg}' + genSeg + ' ';
    // Visible width, not leadPad.length — leadPad carries blessed
    // {tag}...{/tag} color markup (see rmxSeg/genSeg above), which adds
    // characters that cost zero real screen columns; .length would
    // overcount and starve the tail-item budget below (same class of bug
    // the candidates[] `len` field further down exists to avoid). Visible
    // width is 8 (3 + 1 + 3 + 1), matching nameW + 4 exactly, same as the
    // plain-blank leadPad this replaces.
    const preLockVis  = nameW + 4;
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
    // which draws as 2 columns wide — the candidate below accounts for that
    // real on-screen width, not blessed's count, when budgeting remaining
    // space (see the lockTo candidate's `len` further down).
    const lockPlain = lockTo ? `${lockTo.slice(0, 3)}⚿` : '';
    // { text: what actually gets appended (may include color tags), len: its
    //   VISIBLE width (tags stripped) — kept separate since tags cost zero
    //   real screen columns but do add characters that would otherwise
    //   throw the budget off. }
    const candidates = [];
    // match — moved here from the header: matchProb is genuinely per-stem,
    // so it belongs next to this
    // stem's own bars/stay rather than a single "representative" header row.
    const stemMatch = (state.paramsPerStem[name] && state.paramsPerStem[name].matchProb) || 0;
    // No leading literal spaces here any more — leadPad (nameW + 4) already
    // supplies the full offset needed to line "bars:" up with where `b`
    // (the waveform bracket) starts one row up.
    // bars: value — [fullfile] when this stem is in whole-file mode
    // (state.playFullFile[name], mirrors slicer.js's PLAY_FULL_FILE),
    // otherwise the actual segment bar count in brackets. Used to be a
    // header-wide [CHUNK MODE ON/OFF] chip (true if ANY stem was chunked) —
    // removed in favor of this, since chunk mode is genuinely per-stem and
    // this is already the per-stem row (user: "remove [CHUNK MODE] from
    // the menu. instead, when chunk mode is on, we see it in the infos
    // under the waveform. we see the [x] numbers of bars. and when chunk
    // mode is off, the bar number becomes [fullfile]").
    const barsTxt = state.playFullFile[name] ? '[fullfile]' : `[${s.bars}]`;
    const barsStay = `bars:${barsTxt}  stay:${s.stay.toFixed(1)}  match:${stemMatch.toFixed(1)}`;
    candidates.push({ text: barsStay, len: barsStay.length });
    const sidTxt = `  ${sid(s.id)}`;
    candidates.push({ text: sidTxt, len: sidTxt.length });
    // Genre + classifier confidence, e.g. "[house 82%]" — was just the
    // sub-genre label with no sense of how sure the classifier actually is
    // (user: "the sub-genre label but not how confident the classifier is
    // — could go [house 82%]").
    if (subGenre) {
      const t = `  [${subGenre} ${Math.round((parseFloat(s.genreConf) || 0) * 100)}%]`;
      candidates.push({ text: t, len: t.length });
    }
    // Native (analyzed) BPM of this stem's own source track next to the
    // current global/fallback playback BPM — shows how much pitch-shift is
    // actually being applied (user: "the source track's native BPM next to
    // your current global/fallback BPM"). playback→native, dropped
    // entirely when the source track hasn't been analyzed yet.
    const nativeBpm = getNativeBpmForTrack(s.track);
    if (nativeBpm > 0) {
      const playbackBpm = state.globalBPM > 0 ? state.globalBPM : (state.bpm || 0);
      const t = `  bpm:${playbackBpm}→${Math.round(nativeBpm)}`;
      candidates.push({ text: t, len: t.length });
    }
    // Skip when s.track is literally the same string as s.id (already shown
    // a few candidates back via sid(s.id), just truncated differently — 6
    // chars there vs. up to 16 here, so the SAME identifier appeared to
    // repeat on screen, e.g. "ESRGDt ... ESRGDtb923043@$…" — user: "make
    // sure the name of the track doesnt get written twice."). This happens
    // when a stem's real 'stemTrack' name hasn't arrived/been set yet and
    // whatever populated s.track fell back to the same raw id string in the
    // meantime — once a genuine, distinct track name comes in this check
    // stops suppressing it and both fields show their own real values.
    if (s.track && s.track !== s.id) { const t = `  ${trackShort}`; candidates.push({ text: t, len: t.length }); }
    // Lock indicator — LAST, lowest priority, instead of a fixed slot
    // reserved up front. It used to sit first with a fixed-width reserved
    // slot (blank-padded when unlocked) specifically so bars:/stay:/match:
    // that follow would always start at the same column — but that fixed
    // slot itself was the thing throwing rows off (the "⚿" key glyph draws
    // 2 columns wide on this terminal despite blessed counting it as 1, see
    // the width-bug note above). Appended last instead: nothing follows it,
    // so its own presence/width can no longer misalign anything else, and
    // an unlocked stem no longer needs a blank placeholder at all.
    if (lockTo) {
      const t = `  {bright-white-fg}${lockPlain}{/bright-white-fg}`;
      candidates.push({ text: t, len: 2 + lockPlain.length + 1 }); // +1 for ⚿'s real 2-col width vs its 1-char string length
    }

    let tail = '';
    for (const c of candidates) {
      if (c.len <= remaining) {
        tail += c.text;
        remaining -= c.len;
      }
      // else: dropped — not enough room left, skip to the next (lower-
      // priority) candidate rather than truncating mid-item.
    }
    const descLine = leadPad + tail;
    playLines.push(`{grey-fg}${descLine}{/grey-fg}`);

    // This stem's own weight/dir/dirWgt — right under the descriptor line;
    // shares its rows with that stem's meters box (which starts here too —
    // see PRE_METERS_ROWS), so "weight" lines up with the meters' own first
    // row. These used to live once in the header as a
    // single "[wmdScope]"-representative row (see weightStr/dirStr/
    // dirWgtStr above in this same function), which could only ever show
    // one stem's values as a stand-in for all four. Reading straight from
    // state.paramsPerStem[name] here means every stem shows its own real
    // values side by side, not a proxy — state.paramsPerStem is genuinely
    // per-stem storage (see its own comment near state.paramsPerStem's
    // definition), and only ever gets written by the per-stem WS feedback
    // handler above ("weightC_vocals" etc, confirmed values straight from
    // slicer.js — no optimistic local echo), so these numbers are already
    // wired to whatever this actual stem is doing, not a shared/global
    // value. The bracket label WAS still a copy-pasted "[all]" though — a
    // leftover from the old single representative header row — which read
    // as if every stem were showing the same "all stems" value even though
    // the numbers themselves were already stem-specific; user: "make sure
    // the [all] is set to the actual stem". Now uses that stem's own
    // 3-letter code (same abbreviation the descriptor grid/VU sidebar use),
    // same 5-char width as "[all]" so nothing shifts.
    const spWp     = state.paramsPerStem[name];
    // nameW + 4, same offset as leadPad above — lines weight/dir/dirWgt up
    // with where the waveform bracket itself starts (was nameW + 3, one
    // column short; user: "align weight/dir/dirwgt with the start of the
    // waveform").
    const spIndent = pad('', nameW + 4);
    const spLabel  = '[' + (DESC_LABELS[name] || name.slice(0, 3)) + ']';
    playLines.push(`${spIndent}{grey-fg}weight ${spLabel}{/grey-fg} {grey-fg}M:{/grey-fg}${fmtM(spWp.weightC)} {grey-fg}E:{/grey-fg}${fmtM(spWp.weightE)} {grey-fg}F:{/grey-fg}${fmtM(spWp.weightF)} {grey-fg}P:{/grey-fg}${fmtM(spWp.weightP)} {grey-fg}H:{/grey-fg}${fmtM(spWp.weightH)} {grey-fg}T:{/grey-fg}${fmtM(spWp.weightT)}`);
    playLines.push(`${spIndent}{grey-fg}dir    ${spLabel}{/grey-fg} {grey-fg}M:{/grey-fg}${fmtDir(spWp.dirC)} {grey-fg}E:{/grey-fg}${fmtDir(spWp.dirE)} {grey-fg}F:{/grey-fg}${fmtDir(spWp.dirF)} {grey-fg}P:{/grey-fg}${fmtDir(spWp.dirP)} {grey-fg}H:{/grey-fg}${fmtDir(spWp.dirH)} {grey-fg}T:{/grey-fg}${fmtDir(spWp.dirT)}`);
    playLines.push(`${spIndent}{grey-fg}dirWgt:{/grey-fg}${fmtM(spWp.dirWeight)}`);

    // Blank rows under the text block — the meters boxes (which start
    // earlier, at the weight row — see PRE_METERS_ROWS) keep going past
    // dirWgt down to STEM_ROW_BAND_H's full 7 rows; these blank playBox
    // rows just reserve that same space on the left so the next stem's
    // waveform starts exactly at row N * STEM_BAND_H.
    while ((playLines.length % STEM_BAND_H) !== 0) playLines.push('');
  });

  // Calculate actual height accounting for line wrapping at current terminal width
  const playHeight = playLines.reduce((h, l) =>
    h + Math.max(1, Math.ceil(visWidth(l.replace(/\{[^}]+\}/g, '')) / Math.max(1, w))), 0);
  playBox.height = playHeight;
  playBox.setContent(playLines.join('\n'));

  // fixedTop (where sep/menuHeader/lang/cmd/log start) just has to clear
  // playHeight now — master's VU+spatial block and bakeInfo/tip/entropy all
  // moved up into the header zone (rows 0..playTop-1, see playTop's own
  // comment above), so nothing below playTop extends past playHeight
  // anymore (each stem's VU/spatial/descriptor-grid/momentum boxes are
  // confined within that same row range — see vuStemBoxes etc. above).
  fixedTop = playTop + playHeight + 1;
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
  'pitchShift', 'formantShift',
  'setShiftBand', 'setPitchBand', 'setFormantBand', 'clearPitchBand', 'clearFormantBand', 'clearShiftBand',
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
  // generative agent switch — plain passthrough to slicer.js's setAgentMode().
  // Real candidate generation itself (generate_agent.py) runs offline, not
  // from this command — this only flips which already-imported population
  // (real vs. GEN__-prefixed) the live picker chooses from.
  'setAgentMode',
  // fit shape — TUI/Node-only, same shape as trainBias: writes fit_shapes.json
  // and returns, never reaches Max. Doesn't retrain anything by itself —
  // :trainBias reads the file on its next run to actually refit.
  'setFitShape', 'showBakeGraph', 'listGraphs', 'graphs', 'fakeBakes', 'graphNext', 'graphPrev',
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

// ── CRICKET'S MEMORY ─────────────────────────────────────────────────────────
// chatHistory above IS Cricket's working memory — literally what gets sent to
// Ollama on every turn. Two problems this section fixes:
//   1. It used to grow forever within a session and then get silently hard-
//      truncated (oldest turns just dropped, no record, no warning) once it
//      crossed a cap — see maybeSummarizeMemory() below, which condenses the
//      oldest chunk into a compact note instead of discarding it outright.
//   2. It lived in memory only — closing the TUI wiped it completely, so
//      Cricket started every session from zero. The running summary now
//      persists to disk per-session (CRICKET_MEMORY_PATH) and gets reloaded
//      as a seed memory on boot, right after the system prompt.
const CRICKET_MEMORY_PATH      = path.join(DATA_DIR, 'cricket_memory.json');
const CHAT_HISTORY_CAP         = 41;  // 1 system prompt + 20 user/assistant pairs
const MEMORY_SUMMARIZE_AT      = 0.8; // fraction of CHAT_HISTORY_CAP that triggers auto-summarization
const MEMORY_KEEP_RECENT_PAIRS = 6;   // most recent exchanges kept verbatim through a summarization pass

let cricketMemory = { summary: '', turns: 0, updatedAt: null };
try {
  const loadedMem = JSON.parse(fs.readFileSync(CRICKET_MEMORY_PATH, 'utf8'));
  if (loadedMem && typeof loadedMem.summary === 'string') cricketMemory = loadedMem;
} catch (e) { /* no memory file yet — fresh start, nothing to seed */ }

if (cricketMemory.summary) {
  chatHistory.push({
    role: 'system',
    content: '[memory carried over from earlier sessions — use naturally, do not quote verbatim]\n' + cricketMemory.summary,
  });
}

function saveCricketMemory() {
  try { fs.writeFileSync(CRICKET_MEMORY_PATH, JSON.stringify(cricketMemory, null, 2), 'utf8'); }
  catch (e) { /* non-fatal — memory just won't persist past this run */ }
}

// 0–1: how full the live working memory is against its cap. Drives the header
// meter (buildMenuHeaderLine) and the :memory status line.
function memorySaturation() {
  return Math.min(1, chatHistory.length / CHAT_HISTORY_CAP);
}

function memoryBar(width) {
  const w = width || 10;
  const sat = memorySaturation();
  const filled = Math.round(sat * w);
  const pct = Math.round(sat * 100);
  const color = pct >= 95 ? 'red' : (pct >= Math.round(MEMORY_SUMMARIZE_AT * 100) ? 'yellow' : 'grey');
  const bar = '●'.repeat(filled) + '○'.repeat(Math.max(0, w - filled));
  return `{${color}-fg}mem ${bar} ${pct}%{/${color}-fg}`;
}

// Condenses the oldest chunk of chatHistory into a running summary once
// saturation crosses MEMORY_SUMMARIZE_AT, instead of the old silent
// truncate-and-forget behavior. Keeps the most recent MEMORY_KEEP_RECENT_PAIRS
// exchanges verbatim; everything older than that (but after any prior memory
// note) gets folded into cricketMemory.summary and persisted to disk.
let memorySummarizing = false;
function maybeSummarizeMemory() {
  if (memorySummarizing) return;
  if (chatHistory.length < Math.floor(CHAT_HISTORY_CAP * MEMORY_SUMMARIZE_AT)) return;

  const recentCount = MEMORY_KEEP_RECENT_PAIRS * 2;
  const toSummarize = chatHistory.slice(1, Math.max(1, chatHistory.length - recentCount));
  if (toSummarize.length < 2) return; // not enough to bother condensing yet

  memorySummarizing = true;
  const transcript = toSummarize
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const sumBody = JSON.stringify({
    model: CONFIG.ollama_model,
    messages: [
      { role: 'system', content:
        'Summarize this conversation into a short, dense memory note — facts, preferences, names, ' +
        'and decisions worth remembering. Plain prose, no commentary, no engine commands, under 150 words.'
        + (cricketMemory.summary ? ' Fold in and update this earlier memory rather than repeating it verbatim:\n' + cricketMemory.summary : '') },
      { role: 'user', content: transcript },
    ],
    stream: false,
  });

  const req = http.request({
    hostname: CONFIG.ollama_host,
    port:     CONFIG.ollama_port,
    path:     '/api/chat',
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sumBody) },
    timeout:  60000,
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      memorySummarizing = false;
      try {
        const json = JSON.parse(data);
        const summary = (json.message?.content || '').trim();
        if (!summary) return;
        cricketMemory = {
          summary,
          turns: (cricketMemory.turns || 0) + toSummarize.length,
          updatedAt: new Date().toISOString(),
        };
        saveCricketMemory();
        const memNote = {
          role: 'system',
          content: '[memory from earlier in this conversation — use naturally, do not quote verbatim]\n' + summary,
        };
        chatHistory.splice(1, chatHistory.length - recentCount - 1, memNote);
        logCricket('tidying up my memory — condensed the older part so I stay quick. (' + memoryBar(10) + ')');
        render();
      } catch (e) { /* summarization failed silently — history just keeps growing until the next attempt */ }
    });
  });
  req.on('timeout', () => { req.destroy(); memorySummarizing = false; });
  req.on('error',   () => { memorySummarizing = false; });
  req.write(sumBody);
  req.end();
}

// ── BAKE SESSION TRACKING ─────────────────────────────────────────────────────
// Captures the intent → Cricket attempt → user corrections loop for fine-tuning.
let bakeIntent     = '';   // last natural language message sent to Cricket
let bakeCricketCmds = [];  // commands Cricket generated from that intent, RAW/unresolved —
                            // the "before" side of the correction-delta training signal
let bakeUserCmds    = [];  // manual :commands the user sent after Cricket's response, RAW log
let bakeComportment  = []; // the live, editable, resolved recipe for a single-comportment
                            // bracket — see upsertComportment/comportmentKey below and
                            // :bake show/:bake edit/:bake remove in handleInput

// ── BAKE STATES ───────────────────────────────────────────────────────────────
// A "state" is a named, reusable comportment — just a saved list of commands
// (setStayProb/setMatchProb/setDirPref/setGenreFilter/etc), NOT audio, NOT a
// single-moment snapshot. The point: a single flat comportment can't express
// something like "rise for 4 bars then drop for 4" — that's two DIFFERENT
// comportments handed off at a boundary, not one. So instead of trying to
// bake the whole transition in one shot, train each state on its own (open a
// normal :bake bracket, correct + :score it until it reliably feels like
// "rising" or "dropping"), save it under a name with :bake end <name>, then
// assemble named states into a timed sequence with :bake sequence — see
// startBakeSequence below. The commands are what's reusable; the audio each
// state produces is different every time it's applied, same as the
// single-comportment bracket above.
const BAKE_STATES_PATH = path.join(DATA_DIR, 'bake_states.json');

function loadBakeStates() {
    try { return JSON.parse(fs.readFileSync(BAKE_STATES_PATH, 'utf8')); }
    catch (e) { return {}; }
}

function saveBakeState(name, commands, sourceBakeSessionId) {
    const states = loadBakeStates();
    states[name] = {
        commands: commands.slice(),
        savedAt:  new Date().toISOString(),
        sourceBakeSessionId: sourceBakeSessionId || null,
    };
    try {
        fs.writeFileSync(BAKE_STATES_PATH, JSON.stringify(states, null, 2), 'utf8');
        return true;
    } catch (e) {
        logSys('bakeState: failed to save "' + name + '" — ' + e.message);
        return false;
    }
}

// Applies a saved state's commands live, immediately — no bracket needed.
// Returns the command list applied (so sequence mode can log it), or null if
// the name doesn't exist.
function applyBakeState(name) {
    const states = loadBakeStates();
    const st = states[name];
    if (!st) {
        const known = Object.keys(states);
        logSys('bakeState: no saved state named "' + name + '"'
               + (known.length ? '  — known: ' + known.join(', ') : '  — none saved yet, use :bake end <name> after a bracket'));
        return null;
    }
    st.commands.forEach(cmd => sendToMax(cmd));
    return st.commands;
}

// A command's "identity" for comportment purposes — verb + every arg except
// the last token (treated as the value). Heuristic: correct for
// "verb [target] [dim] value" shaped commands (setStayProb, setMatchProb,
// setDirPref, setDirWeight, setSegmentBars, setGenreFilter, etc — everything
// a comportment bracket typically touches). Commands with more than one
// trailing value (:joystick stem x y) won't key correctly by this and are
// rare inside a comportment bracket anyway.
function comportmentKey(cmd) {
    const tokens = cmd.trim().split(/\s+/);
    return tokens.length > 1 ? tokens.slice(0, -1).join(' ') : cmd;
}

// Batch version — collapses an ordered command list down to one command per
// identity, keeping only the LATEST value per identity, in first-seen order.
// Used for sequence mode's trailing live corrections (see stopBakeLoop).
function resolveComportment(cmds) {
    const order = [];
    const byKey = new Map();
    cmds.forEach(cmd => {
        const key = comportmentKey(cmd);
        if (!byKey.has(key)) order.push(key);
        byKey.set(key, cmd);
    });
    return order.map(k => byKey.get(k));
}

// Incremental version, for single-comportment brackets — bakeComportment is
// the live, authoritative, EDITABLE recipe for the bracket. Cricket's
// commands and your live corrections both upsert into it by identity (same
// rule as resolveComportment); :bake edit/:bake remove (see handleInput)
// mutate it directly by the index :bake show prints. Because this stays
// resolved incrementally, final_cmds at :bake end is just bakeComportment
// itself — no separate resolve pass needed, and "removed" really means gone,
// not just superseded.
function upsertComportment(cmd) {
    const key = comportmentKey(cmd);
    const idx = bakeComportment.findIndex(c => comportmentKey(c) === key);
    if (idx === -1) bakeComportment.push(cmd);
    else bakeComportment[idx] = cmd;
}

// ── BAKE LOOP STATE ───────────────────────────────────────────────────────────
// Two bracket modes, both sharing the same timer/close machinery:
//
//   :bake start <prompt>              — single comportment for the whole
//                                        bracket (Cricket's translation of
//                                        the prompt + your live corrections).
//                                        See startBakeLoop.
//   :bake sequence name:bars name:bars ... — cycles through PRE-TRAINED named
//                                        states, handing off comportment at
//                                        each bar boundary and looping the
//                                        whole timeline. See startBakeSequence.
//
// Neither mode freezes/replays audio (no bakeSnapshot/bakeRestore) — every
// checkpoint/handoff is a genuinely live pass: slicer.js keeps picking new
// slices under whatever comportment currently applies. The commands are
// what's held constant (single mode) or scheduled (sequence mode); the audio
// is always different. That's also what makes :score meaningful — it rates
// an actual distinct live-generated layering — and what makes
// :scoreTransition meaningful in sequence mode — it rates the actual cut at
// a state handoff, not a replayed one.
let bakeLoopBars     = 4;      // checkpoint window in bars (set by :bakeloop) — single-comportment mode only
let bakeSessionActive = false; // true while a training bracket is open
let bakeLoopTimer    = null;   // setInterval/setTimeout handle (interchangeable in Node)
let bakeAttempt      = 0;      // how many checkpoints/handoffs have passed this session
let bakeEndQueued    = false;  // :bake end called mid-window — close at next boundary
let bakeSessionLabel = '';     // NL prompt (single mode) or "name:bars → name:bars" spec (sequence mode)
let bakeFirstCmds    = null;   // commands from Cricket's first attempt (single mode only)
let bakeSessionId    = null;   // stable id for the open bracket — lets a :score called
                                // mid-window (see verb === 'score' below) be traced back to
                                // which bake session + which attempt it happened during
let bakeEndSaveName  = null;   // set by ":bake end <name>" — save final_cmds as a reusable state
let bakeSeqSteps     = null;   // [{name, bars}] — non-null only while a sequence bracket is open
let bakeSeqIndex     = 0;      // which step is currently applied
let bakeSeqLog       = [];     // flattened "# state: x" + commands, in handoff order — becomes
                                // final_cmds for the Cricket training example on close, so a
                                // scored-well sequence doubles as an (intent → assembled
                                // multi-phase command timeline) example, not just a live jam aid
let bakeScoreCount   = 0;      // :score + :scoreTransition calls tagged to this bracket
let bakeLastScore    = null;   // { type: 'score'|'transition', value } — most recent of either
let bakeTag          = null;   // label from the most recent :tag typed during this bracket —
                                // structural context (verse/chorus/build/drop/etc, see
                                // ws_server.js's :tag handler) so a bracket also records what
                                // section of the song it was trained against. Bracket-scoped
                                // (reset at :bake start), unlike bakeScoreCount/bakeLastScore.

// Auto-recording for Learn-mode playback (see LEARN MODE below).
// A bake bracket triggers the SAME :record start/stop path a manual
// :record does (ws_server.js has no idea these calls came from a bracket
// rather than the DJ's own fingers) — the only new thing is that app.js
// picks a deterministic filename (bakeSessionId + '.wav') so it can be
// referenced back into the training_log.jsonl snapshot without ws_server.js
// having to echo anything. If the DJ is already recording the whole set
// when a bracket opens, this bracket rides along inside that recording
// instead of splitting it — bakeOwnsRecording stays false, no audioFile.
let bakeRecordingFile = null;  // '<bakeSessionId>.wav', set only if this bracket owns the recording
let bakeOwnsRecording = false; // true only if THIS bracket started the recording (and must stop it)

function startBakeRecording() {
    bakeRecordingFile = null;
    bakeOwnsRecording = false;
    if (state.recording) {
        logSys('  (note: full recording already in progress — this bake won\'t have its own audio clip)');
        return;
    }
    if (!bakeSessionId) return;
    bakeRecordingFile = bakeSessionId + '.wav';
    bakeOwnsRecording = true;
    sendToMax('record start ' + bakeSessionId);
}

// Called from stopBakeLoop. store=false (:bake abort) deletes the clip —
// it was never going to be referenced by a training_log.jsonl entry, so
// there's no point leaving an orphaned .wav in recordings/. Best-effort:
// wrapped in a short delay since Max's own record_cmd 'stop' is async, and
// in try/catch since nothing here should ever block a bracket from closing.
function stopBakeRecording(store) {
    if (!bakeOwnsRecording) return null;
    sendToMax('record stop');
    bakeOwnsRecording = false;
    const file = bakeRecordingFile;
    bakeRecordingFile = null;
    if (!store && file) {
        setTimeout(() => {
            try { fs.unlinkSync(path.join(DATA_DIR, 'recordings', file)); } catch (e) {}
        }, 300);
        return null;
    }
    return file;
}

// Most recent SIMULATED incoming tip (":tip <username> <amount>") — there's
// no real Stripe→ws_server.js bridge yet (see src/backend/routes/tips.js,
// which is a separate, unconnected server), so this is a manual trigger for
// the tipping panel, same pattern as :score/:tag feeding the training panel.
// { username, amount, curator, stems: {vocals,melody,bass,drums}, ts, txnId }
let lastTip = null;

// DJ (curator) share of every tip — module-level so both the :tip handler
// AND the tipping panel's equation bar (renderTipInfo) read the same value.
// Currently a flat floor; full eq is 0.40 + 0.60 × creative_factor once
// edit_rate/spectral_dist/genre_div are wired from Max — see the :tip
// handler's own comment.
const CURATOR_FLOOR = 0.40;

// User-overridable floors — shown under the equation bar so the DJ can see
// (and eventually set, via a :setFloor-style command not wired up yet) a
// per-set override of the ∫ (DJ) and aᵢ (artist) floors, instead of only
// ever running on CURATOR_FLOOR above. null = no override, renders "--".
let floorDj     = null;
let floorArtist = null;

// The ACTUAL live curatorShare, editable via :setSplit — separate from
// floorDj above (that's a still-unwired minimum-guarantee readout; this is
// the real value both :tip and the header's equation bar use every time).
// null = no override, just run on CURATOR_FLOOR's flat default, same as
// before this existed. Clamped to [CURATOR_FLOOR, 1] wherever it's SET
// (see :setSplit's handler) so it can only ever raise the DJ's cut above
// the protocol floor, never drop it below — docs/protocol/SPLIT_EQUATION.md:
// "The DJ is always compensated for the act of curation."
let curatorShareOverride = null;
function currentCuratorShare() {
  return curatorShareOverride !== null ? curatorShareOverride : CURATOR_FLOOR;
}

// Follow-graph influence per stem — shared by the :tip command handler and
// renderTipInfo()'s equation bar/future per-stem breakdown, so the header
// display and the actual payout math read from the exact same numbers
// instead of two independently-maintained copies of this calc.
const TIP_STEMS = ['vocals', 'melody', 'bass', 'drums'];
function computeStemInfluence() {
  const influence = {};
  TIP_STEMS.forEach(s => { influence[s] = 0; });
  TIP_STEMS.forEach(from => {
    DIMS.forEach(dim => {
      Object.entries((state.followGraph[from] && state.followGraph[from][dim]) || {}).forEach(([to, w]) => {
        if (influence[to] !== undefined) influence[to] += w / DIMS.length;
      });
    });
  });
  const totalInfluence = TIP_STEMS.reduce((sum, s) => sum + influence[s], 0);
  return { influence, totalInfluence };
}

// Simulated Stripe-style transaction id (":tip" has no real payment intent
// to attach to — see lastTip's comment above).
function genTxnId() {
  return 'tx_' + Math.random().toString(36).slice(2, 10);
}

function bakeLoopMs() {
    const bpm    = state.bpm > 0 ? state.bpm : 120;
    const meter  = 4;  // assume 4/4 for now
    return (60000 / bpm) * meter * bakeLoopBars;
}

function barsToMs(bars) {
    const bpm    = state.bpm > 0 ? state.bpm : 120;
    const meter  = 4;  // assume 4/4 for now
    return (60000 / bpm) * meter * bars;
}

function startBakeLoop(label) {
    if (bakeLoopTimer) clearInterval(bakeLoopTimer);
    bakeSessionActive = true;
    bakeEndQueued     = false;
    bakeAttempt       = 0;
    bakeFirstCmds     = null;
    bakeSessionLabel  = label;
    bakeSeqSteps      = null;
    bakeSeqLog        = [];
    bakeComportment   = [];
    bakeTag           = null;
    // bakeScoreCount/bakeLastScore deliberately NOT reset here — they're a
    // running tally for the whole TUI session (mirrors how training_log_
    // vertical/transition.jsonl just keep growing across brackets), not
    // scoped to one bracket. See renderBakeInfo, where "sc" is shown
    // regardless of bakeSessionActive for the same reason.
    startBakeRecording();   // see its own comment — no-op if already recording

    const ms = bakeLoopMs();
    logSys('✓ bake: bracket open — "' + label + '"  checkpoint every ' + bakeLoopBars + ' bars @ '
           + (state.bpm || 120) + ' BPM  (' + Math.round(ms / 1000) + 's) — audio keeps generating live,'
           + ' :score whatever just played, tweak comportment any time');

    bakeLoopTimer = setInterval(() => {
        bakeAttempt++;

        // Store first attempt's commands for the Cricket training pair —
        // whatever Cricket translated the prompt into, before any corrections.
        if (bakeAttempt === 1) {
            bakeFirstCmds = bakeCricketCmds.slice();
        }

        if (bakeEndQueued) {
            // This checkpoint just finished — close the session
            stopBakeLoop(true);
            return;
        }

        // No audio reset — playback just keeps running under the current
        // comportment. This tick only marks a new checkpoint boundary so
        // bakeAttempt (and therefore any :score tagged during the next
        // window) advances.
        logSys('↻ bake: checkpoint ' + bakeAttempt + ' — still generating live, comportment unchanged');
    }, ms);
}

// steps: [{name, bars}], each name already validated to exist in bake_states.json.
function startBakeSequence(steps, label) {
    if (bakeLoopTimer) clearInterval(bakeLoopTimer);
    bakeSessionActive = true;
    bakeEndQueued     = false;
    bakeAttempt       = 0;
    bakeFirstCmds     = null;
    bakeCricketCmds   = [];
    bakeUserCmds      = [];
    bakeSessionLabel  = label;
    bakeSessionId     = 'bake_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    bakeSeqSteps      = steps;
    bakeSeqIndex      = 0;
    bakeSeqLog        = [];
    bakeComportment   = [];   // unused in sequence mode — :bake edit/:bake remove are single-mode only
    bakeTag           = null;
    // bakeScoreCount/bakeLastScore NOT reset — see the comment in startBakeLoop.
    startBakeRecording();   // see its own comment — no-op if already recording

    logSys('✓ bake: sequence bracket open — ' + steps.map(s => s.name + ':' + s.bars).join(' → ')
           + '  (loops until :bake end) — applying "' + steps[0].name + '" now');

    const applied = applyBakeState(steps[0].name);
    if (applied) { bakeSeqLog.push('# state: ' + steps[0].name); bakeSeqLog.push(...applied); }

    const scheduleNext = () => {
        const bars = bakeSeqSteps[bakeSeqIndex].bars;
        bakeLoopTimer = setTimeout(() => {
            bakeAttempt++;
            if (bakeEndQueued) { stopBakeLoop(true); return; }

            bakeSeqIndex = (bakeSeqIndex + 1) % bakeSeqSteps.length;
            const next = bakeSeqSteps[bakeSeqIndex];
            const cmds = applyBakeState(next.name);
            if (cmds) { bakeSeqLog.push('# state: ' + next.name); bakeSeqLog.push(...cmds); }
            logSys('↻ bake: checkpoint ' + bakeAttempt + ' — handed off to state "' + next.name
                   + '"  (' + next.bars + ' bars) — :scoreTransition rates this cut, :score rates the state');

            scheduleNext();
        }, barsToMs(bars));
    };
    scheduleNext();
}

function stopBakeLoop(store) {
    if (bakeLoopTimer) { clearInterval(bakeLoopTimer); bakeLoopTimer = null; }
    bakeSessionActive = false;
    bakeEndQueued     = false;
    const wasSequence = !!bakeSeqSteps;
    // Stop (and, if aborted, discard) whatever recording this bracket owns.
    // Must run before bakeSessionId gets nulled below, and before the
    // snapshot object is built so audioFile can be attached to it.
    const audioFile = stopBakeRecording(store);

    if (store && bakeSessionLabel) {
        const snapshot = wasSequence ? {
            bakeSessionId:    bakeSessionId,
            intent:           bakeSessionLabel,
            cricket_cmds:     [],   // no single Cricket call in sequence mode — see bakeSeqLog below
            user_corrections: bakeUserCmds.slice(),
            // The assembled timeline itself: "# state: x" markers + that state's commands, in
            // handoff order — NOT deduped, each state legitimately needs its own conflicting
            // values preserved (e.g. setDirPref D +1 for rise, D -1 for drop; collapsing across
            // states would destroy exactly the distinction that makes them different states).
            // Only the trailing live corrections (not yet tied to one particular state) get
            // resolved among themselves. This is the (intent → multi-phase command sequence)
            // pair convert_bakes.py can fine-tune Cricket on.
            final_cmds:       [...bakeSeqLog, ...resolveComportment(bakeUserCmds)],
            attempts:         bakeAttempt,
            audioFile:        audioFile,   // recorded clip of this bracket, or null — see LEARN MODE
        } : {
            bakeSessionId:    bakeSessionId,   // joins this Cricket example to any
                                                // :score entries logged during the
                                                // same bracket (training_log_vertical.jsonl)
            intent:           bakeSessionLabel,
            cricket_cmds:     bakeFirstCmds || bakeCricketCmds.slice(),   // raw, unresolved — the
                                                // "before" side of the correction-delta training
                                                // signal (see convert_bakes.py's docstring)
            user_corrections: bakeUserCmds.slice(),
            // bakeComportment is already the live, resolved, EDITED recipe — kept current the
            // whole bracket by upsertComportment() (Cricket's cmds, your corrections) and by
            // :bake edit/:bake remove directly. No separate resolve pass needed here, and a
            // :bake remove really means gone, not just superseded. This is what gets saved when
            // :bake end <name> is used, and what Cricket trains toward.
            final_cmds:       bakeComportment.slice(),
            attempts:         bakeAttempt,
            audioFile:        audioFile,   // recorded clip of this bracket, or null — see LEARN MODE
        };
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'bake', ...snapshot }));
        }
        logSys('✓ bake end — "' + bakeSessionLabel + '"  attempts: ' + bakeAttempt
               + (wasSequence ? '  stored assembled sequence' : '  stored first + last attempt')
               + (audioFile ? '  · audio: ' + audioFile : ''));

        // Always saves — name defaults to the prompt itself (naming is only
        // required when you want a short, space-free handle for :bake sequence).
        const saveName = bakeEndSaveName || bakeSessionLabel;
        if (saveName) {
            const ok = saveBakeState(saveName, snapshot.final_cmds, bakeSessionId);
            if (ok) {
                const seqHint = /\s/.test(saveName)
                    ? ' — give it a short name (:bake end <name>) before using :bake sequence, spaces aren\'t allowed there'
                    : ' — use :bake sequence ' + saveName + ':<bars> to schedule it';
                logSys('✓ saved as state "' + saveName + '"  (' + snapshot.final_cmds.length + ' commands)' + seqHint);
            }
        }
    } else {
        logSys('bake aborted — nothing stored');
    }
    bakeSessionId = null;   // any :score after this point is untagged, same as pre-bracket
    bakeEndSaveName = null;
    bakeSeqSteps    = null;
    bakeSeqLog      = [];
}

// ── LEARN MODE ───────────────────────────────────────────────────────────────
// The training screen (^T / :train) — the peer of playback, not a takeover
// of it (see the SCREEN MODEL comment above CHAT_OVERLAY_BOXES/
// PLAYBACK_HEADER_BOXES) — for everything to do with training Cricket rather
// than performing. Its own sub-menu, learnView, picks between two views
// (:train training / :train review — switches take effect immediately, and
// also enter Learn mode if you weren't already in it):
//
//   'training' — the LIVE bake bracket: same :bake start/show/edit/end/
//                abort commands that already work from Playback (those
//                aren't gated by appMode — see handleInput's :bake block),
//                just with somewhere to actually SEE the bracket's status —
//                bakeInfoLines() (bars/prmpt/stat/rcp) now renders ONLY
//                here, not on Playback's own header at all any more (see
//                the ZONE 6.6 comment). playBox (the 4-channel waveforms)
//                stays up here too — a live bracket really is live.
//
//   'review'   — pages back through what's already been baked, off the
//                clock, over two sources:
//                  'bakes'  — training_log.jsonl, one entry per :bake
//                             session (intent, Cricket's raw attempt, your
//                             corrections, final_cmds — what convert_bakes.py
//                             actually fine-tunes Cricket on).
//                  'states' — bake_states.json, the named, reusable recipes
//                             saved by :bake end <name> (see BAKE STATES
//                             above). Not used for fine-tuning at all
//                             (:bake sequence is the only consumer), so
//                             approve/exclude don't apply — only editing does.
//                Default view on entry — reviewing what's already there is
//                the more common reason to open Learn mode than starting a
//                fresh bracket. playBox is replaced by reviewWaveformBox
//                here — the recorded clip's own waveform, not the live
//                engine's current (unrelated) state — see
//                updateReviewWaveformBox().
//
// Every action here is a typed :train command (see handleInput), same as
// the rest of this app — nothing hijacks inputBox's key handling, so there's
// no risk to the live performance controls (see CURSOR-AWARE INPUT EDITING).
const TRAINING_LOG_PATH = path.join(DATA_DIR, 'training_log.jsonl');
const RECORDINGS_DIR    = path.join(DATA_DIR, 'recordings');

let appMode        = 'playback'; // 'playback' | 'learn'
let learnView       = 'review';   // 'training' | 'review' — sub-menu within Learn mode
let reviewSource    = 'bakes';    // 'bakes' | 'states' — only meaningful in the 'review' view
let reviewIndex     = 0;          // index into reviewEntries
let reviewEntries   = [];         // cached list for the current source, newest first
let reviewAudioProc = null;       // spawned afplay/aplay child, or null while nothing's playing
let reviewPlayStartTime = 0;      // Date.now() when reviewAudioProc was spawned — playhead math below
// lastBakePage — always set (see refreshSelectedBakePage() below), shown
// appended under reviewDetailBox's normal content (see renderTrainingView())
// so it sits directly under reviewWaveformBox ("the recording") — but ONLY
// in the 'review' sub-view now (user: "it should only appear under review,
// not in the training tab of the train tab"), not a separate box/geometry
// change, just more content in the box that already occupies that space.
// Holds a whole PAGE's worth of mini-graphs now (user: "show multiple graph
// at the same time") — { model, feature, kind, cols, colW, graphs: [{dim,
// text, coeffs, degree, n, xMin, xMax, yMin, yMax, empty}, ...] } — one
// `graphs` entry per dim on the page (7 for a 'level' page, 6 for
// 'tension'), laid out `cols` per row (see refreshSelectedBakePage() —
// user: "put them on two rows, not only one, so everything can fit in one
// page").
let lastBakePage = null;

// selectedPageIdx — which of BAKE_GRAPH_PAGES' 8 entries is "the" page
// right now (1-based). This is the actual selection state behind the graph
// menu (user: "a menu to select with graph is being shown") — :showBakeGraph
// and :graphNext/:graphPrev both just change this and re-derive
// lastBakePage from it, so there's one source of truth instead of the
// picker and the rendered graphs drifting apart. Defaults to the vertical/
// mean page, level dims — E/vertical/mean lives on it, the one :fakeBakes
// deliberately biases to correlate with rating, so a fresh app + a first
// :fakeBakes run lands on a page with at least one real slope visible
// instead of all noise.
let selectedPageIdx = pageIndexForDim('E', 'vertical', 'mean');

// refreshSelectedBakePage — re-derives lastBakePage from whatever
// selectedPageIdx currently points at, reading the training logs fresh for
// EVERY dim on that page. Always sets lastBakePage, even with zero usable
// bakes for a given dim (user: "when no bakes are baked, i still want to
// see a graph, but with no data in it") — draws a blank frame for that one
// dim instead of skipping it, so every page's SHAPE (and axis labels) are
// always on screen once Review has been opened at least once, not just
// after the first successful bake. Called from three places:
// :showBakeGraph/:graphNext/:graphPrev (user changed the selection),
// :fakeBakes (synthetic data just landed), and the WS 'bakeScored' handler
// (user: "I want it to be automatically drawn when bakes are baked" — a
// REAL :score/:scoreTransition just got logged by ws_server.js).
function refreshSelectedBakePage() {
  const page = BAKE_GRAPH_PAGES[selectedPageIdx - 1];
  if (!page) return;
  // Width source is reviewRegressionBox now, not reviewDetailBox — the
  // regression graph moved into its own full-width box (see reflowLearn()'s
  // review branch), so sizing off reviewDetailBox's now-much-narrower
  // column would squeeze the plot down to a sliver of the space it
  // actually has. Cap raised from 64 to 96 to make use of that extra width
  // instead of leaving it mostly blank on a wide terminal.
  const fullW = Math.max(24, Math.min(96, (reviewRegressionBox.width || 48) - 2));
  // GRID_ROWS fixed at 2 (user: "put them on two rows, not only one, so
  // everything can fit in one page") — cols is whatever spreads this
  // page's dims (7 for level, 6 for tension) across exactly 2 rows, not a
  // straight-down stack of one graph per row. That's what keeps a 7-graph
  // page to ~2 rows of cards instead of ~7, so the whole page (menu +
  // every graph) fits on screen without scrolling, at the cost of each
  // individual graph being narrower.
  const GRID_ROWS = 2;
  const CARD_GAP  = 2; // spaces between adjacent cards in the same row
  const cols = Math.ceil(page.dims.length / GRID_ROWS);
  const colW = Math.max(12, Math.floor((fullW - CARD_GAP * (cols - 1)) / cols));
  // Each mini-graph is only 3 rows tall (vs. the old single graph's 12) —
  // that's what makes fitting up to 7 of them on one page readable instead
  // of requiring 7x the scrolling (user: "can you fit 7 graphs under the
  // regression section and still keep them readable?"). 3 rows still gives
  // 12 sub-dot rows of real Braille resolution (3 × 4), plenty to see a
  // trend/scatter shape at a glance even at colW's narrower width.
  const MINI_H = 3;
  const graphs = page.dims.map(dim => {
    const points = extractBakePoints(DATA_DIR, dim, page.model, page.feature);
    // Degree comes from fit_shapes.json (see fitDegreeForDim()) — this is
    // what keeps the preview honest about whatever :setFitShape last set
    // for THIS dim, instead of always defaulting to a straight line. Each
    // dim on a page can have its own independent shape.
    const degree = fitDegreeForDim(dim);
    // Need at least degree+2 points for a fit that isn't just threading
    // through every point exactly (same "don't trust a saturated fit"
    // spirit as train_bias.py's train_section() 3x-parameters floor, just
    // a much smaller version of it for this 1D diagnostic).
    if (points.length >= Math.max(3, degree + 2)) {
      const result = renderBrailleScatter(points, colW, MINI_H, degree);
      return {
        dim, text: result.text, coeffs: result.coeffs, degree: result.degree, n: result.n,
        xMin: result.xMin, xMax: result.xMax, yMin: result.yMin, yMax: result.yMax,
        empty: false,
      };
    }
    // Blank frame, same footprint a real graph would use — no dots, no
    // fitted curve (there isn't one yet), just empty axes.
    const blankRow = ' '.repeat(colW);
    return {
      dim,
      text: Array.from({ length: MINI_H }, () => blankRow).join('\n'),
      coeffs: [0], degree, n: points.length,
      xMin: 0, xMax: 0, yMin: -1, yMax: 1,
      empty: true,
    };
  });
  lastBakePage = { model: page.model, feature: page.feature, kind: page.kind, cols, colW, graphs };
}
// NOT called eagerly here — reviewRegressionBox.width isn't reliably
// resolved yet this early in module load (before the screen/box tree is
// attached), which would feed NaN into colW's Math.min/repeat below and
// crash on startup. renderTrainingView()'s 'review' branch below calls this itself
// on first use instead (lastBakePage still null), by which point the box
// is definitely sized — same "empty graph if nothing's been baked yet"
// result, just resolved lazily instead of at parse time.

// The recording's waveform, cached by file path so switching entries or
// re-rendering on every 100ms tick (see the review-waveform block in
// render()) doesn't re-parse the WAV each time — only when currentAudioPath()
// actually changes. env is a 0-100 amplitude-per-bucket array, same shape
// waveforms.json's precomputed envelopes use, so it can reuse waveGlyphs().
// null env means "no audio for this entry" (missing file, unsupported/
// unparseable WAV, or nothing recorded) — the bar falls back to a flat line.
let reviewWaveformCache = { path: null, env: null, durationMs: 0 };
const REVIEW_WAVE_BUCKETS = 200; // resampled to actual bar width by waveGlyphs() anyway

// Parse a WAV file's fmt/data chunks directly (no external deps/binaries) —
// handles 8/16/24/32-bit PCM int and 32-bit float, mono or multi-channel,
// which covers whatever Max's sfrecord~ (the actual writer — see ws_server.js's
// 'record' command) is configured to output. Returns null on anything it
// can't parse; callers treat that the same as "no audio" rather than crashing.
function computeWavInfo(filePath, buckets) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
    }
    let offset = 12, fmt = null, dataOffset = -1, dataLen = 0;
    while (offset + 8 <= buf.length) {
        const chunkId   = buf.toString('ascii', offset, offset + 4);
        const chunkLen  = buf.readUInt32LE(offset + 4);
        const bodyStart = offset + 8;
        if (chunkId === 'fmt ') {
            fmt = {
                audioFormat:   buf.readUInt16LE(bodyStart),
                numChannels:   buf.readUInt16LE(bodyStart + 2),
                sampleRate:    buf.readUInt32LE(bodyStart + 4),
                bitsPerSample: buf.readUInt16LE(bodyStart + 14),
            };
        } else if (chunkId === 'data') {
            dataOffset = bodyStart;
            dataLen    = Math.min(chunkLen, buf.length - bodyStart);
        }
        offset = bodyStart + chunkLen + (chunkLen % 2); // chunks are word-aligned
    }
    if (!fmt || dataOffset < 0 || !fmt.numChannels || !fmt.sampleRate || !fmt.bitsPerSample) return null;

    const { numChannels, sampleRate, bitsPerSample, audioFormat } = fmt;
    const bytesPerSample = bitsPerSample / 8;
    const frameSize       = bytesPerSample * numChannels;
    const totalFrames     = Math.floor(dataLen / frameSize);
    if (totalFrames <= 0) return null;
    const durationMs = Math.round((totalFrames / sampleRate) * 1000);

    const readSample = (frameIdx, ch) => {
        const base = dataOffset + frameIdx * frameSize + ch * bytesPerSample;
        if (audioFormat === 3 && bitsPerSample === 32) return buf.readFloatLE(base); // IEEE float
        if (bitsPerSample === 16) return buf.readInt16LE(base) / 32768;
        if (bitsPerSample === 24) {
            let v = buf[base] | (buf[base + 1] << 8) | (buf[base + 2] << 16);
            if (v & 0x800000) v -= 0x1000000;
            return v / 8388608;
        }
        if (bitsPerSample === 32) return buf.readInt32LE(base) / 2147483648;
        if (bitsPerSample === 8)  return (buf.readUInt8(base) - 128) / 128;
        return 0;
    };

    const env = new Array(buckets).fill(0);
    const framesPerBucket = Math.max(1, Math.floor(totalFrames / buckets));
    for (let b = 0; b < buckets; b++) {
        const startFrame = b * framesPerBucket;
        const endFrame    = Math.min(totalFrames, startFrame + framesPerBucket);
        // Stride through each bucket rather than reading every frame — plenty
        // of resolution for a peak read without an O(all samples) scan on a
        // long recording.
        const stride = Math.max(1, Math.floor((endFrame - startFrame) / 200));
        let peak = 0;
        for (let f = startFrame; f < endFrame; f += stride) {
            for (let ch = 0; ch < numChannels; ch++) {
                const v = Math.abs(readSample(f, ch));
                if (v > peak) peak = v;
            }
        }
        env[b] = Math.round(Math.min(1, peak) * 100);
    }
    return { env, durationMs };
}

// Refreshes reviewWaveformCache to match whatever currentAudioPath() returns
// right now — no-ops (cheap) once it's already loaded for that path, so this
// is safe to call every render() tick as well as on entry change.
function loadReviewWaveform() {
    const p = currentAudioPath();
    if (p === reviewWaveformCache.path) return;
    reviewWaveformCache = { path: p, env: null, durationMs: 0 };
    if (!p || !fs.existsSync(p)) return;
    try {
        const info = computeWavInfo(p, REVIEW_WAVE_BUCKETS);
        if (info) { reviewWaveformCache.env = info.env; reviewWaveformCache.durationMs = info.durationMs; }
    } catch (e) { /* leave env null — falls back to the flat placeholder line */ }
}

// One continuous timeline, played portion in bright-white, the rest grey —
// same visual language sliceBar() already uses for the played/unplayed split
// within a live slice window, just without the bracket markers since this is
// the whole recording, not one slice inside a bigger track.
function recordingWaveformLine(env, progress, width) {
    if (!env || !env.length) return '{grey-fg}' + '─'.repeat(Math.max(0, width)) + '{/grey-fg}';
    const playedCols = Math.max(0, Math.min(width, Math.round(progress * width)));
    return '{bright-white-fg}' + waveGlyphs(env, 0, playedCols, width) + '{/bright-white-fg}'
         + '{grey-fg}'         + waveGlyphs(env, playedCols, width, width) + '{/grey-fg}';
}

// Redraws reviewWaveformBox from reviewWaveformCache + however far into
// playback reviewAudioProc currently is. Called from render() every tick
// while learnView === 'review' (see playTop's own block), so the playhead
// advances smoothly without a dedicated interval of its own.
function updateReviewWaveformBox(width) {
    loadReviewWaveform();
    const { env, durationMs } = reviewWaveformCache;
    const elapsedMs = reviewAudioProc ? Math.min(durationMs, Date.now() - reviewPlayStartTime) : 0;
    const progress  = durationMs > 0 ? elapsedMs / durationMs : 0;
    const status = !env
        ? '{grey-fg}(no recorded audio for this entry){/grey-fg}'
        : (reviewAudioProc ? '{bright-white-fg}▶ playing{/bright-white-fg}' : '{grey-fg}stopped{/grey-fg}')
          + '  {grey-fg}' + fmtMs(elapsedMs) + ' / ' + fmtMs(durationMs) + '{/grey-fg}';
    reviewWaveformBox.setContent(
        '{bright-white-fg}recording{/bright-white-fg}   ' + status + '\n' +
        recordingWaveformLine(env, progress, Math.max(4, width))
    );
}

// How many lines the Learn panel's current content actually needs — kept in
// sync by renderTrainingView() every time content changes, and read back by
// learnPanelHeight() so the panel (and therefore where the waveforms start
// right below it) shrinks to fit a short bake/entry instead of always
// reserving its full bounded-fraction cap. Starts at a reasonable guess;
// renderTrainingView() re-derives layout immediately after updating this,
// so it's never actually shown stale. Only the 'training' sub-view still
// uses this one now — 'review' has its own reviewBakeContentLines just
// below (see reflowLearn()'s review branch for why: three independently-
// sized sections now instead of one shared budget).
let learnPanelContentLines = 10;

// reviewBakeContentLines — same idea as learnPanelContentLines above, but
// scoped to just the bake row (reviewListBox + reviewDetailBox's own
// entry-detail text) in the 'review' sub-view, now that regression is a
// separate box with its own independent height (reviewRegressionBox, sized
// to fill whatever's left down to the footer — see reflowLearn()).
let reviewBakeContentLines = 6;

function loadTrainingLog() {
    try {
        return fs.readFileSync(TRAINING_LOG_PATH, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(Boolean);
    } catch (e) { return []; }
}

function saveTrainingLog(entries) {
    try {
        const body = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
        fs.writeFileSync(TRAINING_LOG_PATH, body, 'utf8');
        return true;
    } catch (e) {
        logSys('review: failed to save training_log.jsonl — ' + e.message);
        return false;
    }
}

// Re-loads the current source fresh from disk. _idx (bakes only) records
// each entry's position in loadTrainingLog()'s file-order array, so an edit
// later can find its way back without assuming sort order is stable — see
// mutateCurrentBakeEntry.
function refreshReviewEntries() {
    if (reviewSource === 'bakes') {
        reviewEntries = loadTrainingLog()
            .map((e, i) => ({ ...e, _idx: i }))
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    } else {
        const states = loadBakeStates();
        reviewEntries = Object.keys(states)
            .map(name => ({ _name: name, ...states[name] }))
            .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    }
    if (reviewIndex >= reviewEntries.length) reviewIndex = Math.max(0, reviewEntries.length - 1);
}

function updateBakeStateCommands(name, commands) {
    const states = loadBakeStates();
    if (!states[name]) return false;
    states[name].commands  = commands.slice();
    states[name].editedAt  = new Date().toISOString();
    try {
        fs.writeFileSync(BAKE_STATES_PATH, JSON.stringify(states, null, 2), 'utf8');
        return true;
    } catch (e) {
        logSys('review: failed to save state — ' + e.message);
        return false;
    }
}

// Re-reads training_log.jsonl fresh (appends only ever add new lines at the
// end, so an _idx captured at listing time stays valid), applies `mutator`
// to the target entry in place, writes the whole file back, then refreshes
// the in-memory list so the review UI reflects the change immediately.
function mutateCurrentBakeEntry(mutator) {
    const cur = reviewEntries[reviewIndex];
    if (!cur) { logSys('review: nothing selected'); return false; }
    const all = loadTrainingLog();
    if (cur._idx == null || !all[cur._idx]) { logSys('review: could not locate that entry on disk'); return false; }
    mutator(all[cur._idx]);
    const ok = saveTrainingLog(all);
    if (ok) refreshReviewEntries();
    return ok;
}

function reviewEntryLabel(e) {
    if (reviewSource === 'bakes') {
        const flag   = e.excluded ? '✗' : ' ';
        const aud    = e.audioFile ? '♪' : ' ';
        const when   = (e.timestamp || '').slice(0, 16).replace('T', ' ');
        const intent = (e.intent || '(no intent)').replace(/\s+/g, ' ').slice(0, 40);
        return `${flag}${aud} ${when}  ${intent}`;
    }
    const aud  = e.sourceBakeSessionId ? '♪' : ' ';
    const when = (e.savedAt || '').slice(0, 16).replace('T', ' ');
    return `${aud} ${when}  ${e._name}`;
}

// Resolves the actual audio file for whatever's currently selected. States
// have no recording of their own (see the section comment) — fall back to
// the bake that produced them, if it's still in training_log.jsonl.
function currentAudioPath() {
    const e = reviewEntries[reviewIndex];
    if (!e) return null;
    if (reviewSource === 'bakes') {
        return e.audioFile ? path.join(RECORDINGS_DIR, e.audioFile) : null;
    }
    if (!e.sourceBakeSessionId) return null;
    const src = loadTrainingLog().find(b => b.bakeSessionId === e.sourceBakeSessionId);
    return (src && src.audioFile) ? path.join(RECORDINGS_DIR, src.audioFile) : null;
}

function reviewPlay() {
    const p = currentAudioPath();
    if (!p) { logSys('review: no recorded audio for this ' + (reviewSource === 'bakes' ? 'session' : 'state')); return; }
    if (!fs.existsSync(p)) { logSys('review: audio file missing on disk — ' + p); return; }
    reviewStop();
    const player = process.platform === 'darwin' ? 'afplay'
                 : process.platform === 'linux'  ? 'aplay'
                 : null;
    if (!player) { logSys('review: audio playback isn\'t supported on this platform'); return; }
    try {
        reviewAudioProc = spawn(player, [p]);
        reviewPlayStartTime = Date.now(); // drives the waveform playhead — see updateReviewWaveformBox()
        reviewAudioProc.on('exit', () => { reviewAudioProc = null; renderTrainingView(); });
        reviewAudioProc.on('error', e => { logSys('review: playback failed — ' + e.message); reviewAudioProc = null; renderTrainingView(); });
        logSys('▶ playing ' + path.basename(p));
    } catch (e) {
        logSys('review: playback failed — ' + e.message);
        reviewAudioProc = null;
    }
    renderTrainingView();
}

function reviewStop() {
    if (!reviewAudioProc) return;
    try { reviewAudioProc.kill(); } catch (e) {}
    reviewAudioProc = null;
    renderTrainingView();
}

// Absolute jump — reviewMove()'s relative next/prev below builds on this.
function reviewGoto(i) {
    if (!reviewEntries.length) return;
    reviewIndex = Math.max(0, Math.min(reviewEntries.length - 1, i));
    reviewStop(); // don't let the previous session's audio keep playing under a new one
    renderTrainingView();
}

function reviewMove(delta) {
    if (!reviewEntries.length) return;
    reviewGoto(reviewIndex + delta);
}

function reviewSetSource(src) {
    if (src !== 'bakes' && src !== 'states') { logSys('usage: :train source bakes|states'); return; }
    reviewSource = src;
    reviewIndex  = 0;
    reviewStop();
    refreshReviewEntries();
    renderTrainingView();
}

function reviewApprove() {
    if (reviewSource !== 'bakes') { logSys('review: states aren\'t used for training — nothing to approve'); return; }
    if (mutateCurrentBakeEntry(e => { e.excluded = false; })) logSys('✓ kept for training');
}

function reviewExclude() {
    if (reviewSource !== 'bakes') { logSys('review: states aren\'t used for training — edit the commands directly instead'); return; }
    if (mutateCurrentBakeEntry(e => { e.excluded = true; })) logSys('✗ excluded from training');
}

function reviewEditLine(idxStr, rest) {
    const idx = parseInt(idxStr, 10) - 1;
    const cmd = (rest || []).join(' ').trim();
    if (isNaN(idx) || idx < 0 || !cmd) { logSys('usage: :train edit <n> <command...>'); return; }
    if (reviewSource === 'bakes') {
        let bad = false;
        const ok = mutateCurrentBakeEntry(e => {
            e.final_cmds = e.final_cmds || [];
            if (idx >= e.final_cmds.length) { bad = true; return; }
            e.final_cmds[idx] = cmd;
        });
        if (bad) logSys('review: line ' + (idx + 1) + ' doesn\'t exist');
        else if (ok) logSys('✓ line ' + (idx + 1) + ' updated');
    } else {
        const cur = reviewEntries[reviewIndex];
        if (!cur) { logSys('review: nothing selected'); return; }
        const cmds = (cur.commands || []).slice();
        if (idx >= cmds.length) { logSys('review: line ' + (idx + 1) + ' doesn\'t exist'); return; }
        cmds[idx] = cmd;
        if (updateBakeStateCommands(cur._name, cmds)) { refreshReviewEntries(); renderTrainingView(); logSys('✓ line ' + (idx + 1) + ' updated'); }
    }
}

function reviewRemoveLine(idxStr) {
    const idx = parseInt(idxStr, 10) - 1;
    if (isNaN(idx) || idx < 0) { logSys('usage: :train remove <n>'); return; }
    if (reviewSource === 'bakes') {
        let bad = false;
        const ok = mutateCurrentBakeEntry(e => {
            e.final_cmds = e.final_cmds || [];
            if (idx >= e.final_cmds.length) { bad = true; return; }
            e.final_cmds.splice(idx, 1);
        });
        if (bad) logSys('review: line ' + (idx + 1) + ' doesn\'t exist');
        else if (ok) logSys('✓ line ' + (idx + 1) + ' removed');
    } else {
        const cur = reviewEntries[reviewIndex];
        if (!cur) { logSys('review: nothing selected'); return; }
        const cmds = (cur.commands || []).slice();
        if (idx >= cmds.length) { logSys('review: line ' + (idx + 1) + ' doesn\'t exist'); return; }
        cmds.splice(idx, 1);
        if (updateBakeStateCommands(cur._name, cmds)) { refreshReviewEntries(); renderTrainingView(); logSys('✓ line ' + (idx + 1) + ' removed'); }
    }
}

function reviewAddLine(rest) {
    const cmd = (rest || []).join(' ').trim();
    if (!cmd) { logSys('usage: :train add <command...>'); return; }
    if (reviewSource === 'bakes') {
        const ok = mutateCurrentBakeEntry(e => {
            e.final_cmds = e.final_cmds || [];
            e.final_cmds.push(cmd);
        });
        if (ok) logSys('✓ line added');
    } else {
        const cur = reviewEntries[reviewIndex];
        if (!cur) { logSys('review: nothing selected'); return; }
        const cmds = (cur.commands || []).slice();
        cmds.push(cmd);
        if (updateBakeStateCommands(cur._name, cmds)) { refreshReviewEntries(); renderTrainingView(); logSys('✓ line added'); }
    }
}

function renderReviewDetail(e) {
    if (!e) {
        return '{grey-fg}nothing to review yet — ' + (reviewSource === 'bakes'
            ? 'bake something first (:bake start ... → :bake end)'
            : 'no named states saved yet (:bake end <name>)') + '{/grey-fg}';
    }
    const lines = [];
    if (reviewSource === 'bakes') {
        lines.push('{bright-white-fg}intent:{/bright-white-fg}  ' + (e.intent || '(none)'));
        lines.push('{grey-fg}' + (e.timestamp || '') + '   track: ' + (e.track || '--')
            + '   bpm: ' + (e.bpm || '--') + '   attempts: ' + (e.attempts == null ? '--' : e.attempts) + '{/grey-fg}');
        lines.push('{grey-fg}status: ' + (e.excluded ? '{/grey-fg}{bright-white-fg}✗ excluded from training{/bright-white-fg}' : '{/grey-fg}✓ kept for training')
            + '{grey-fg}   audio: ' + (e.audioFile ? e.audioFile : '(none recorded)') + '{/grey-fg}');
        lines.push('');
        // cricket's attempt + your corrections share one row (":train"
        // panel real estate is tight) — each is usually 0-1 short commands,
        // so joining with "; " reads fine; genuinely long lists just wrap.
        const cricketStr    = (e.cricket_cmds && e.cricket_cmds.length) ? e.cricket_cmds.join('; ') : '(none)';
        const correctionStr = (e.user_corrections && e.user_corrections.length) ? e.user_corrections.join('; ') : '(none)';
        lines.push('{bright-white-fg}cricket\'s attempt:{/bright-white-fg} ' + cricketStr
          + '    {bright-white-fg}corrections:{/bright-white-fg} ' + correctionStr);
        lines.push('');
        lines.push('{bright-white-fg}final_cmds{/bright-white-fg} {grey-fg}(what Cricket trains toward — :train edit/remove/add <n>){/grey-fg}');
        const fc = e.final_cmds || [];
        (fc.length ? fc : ['{grey-fg}(empty){/grey-fg}']).forEach((c, i) => lines.push('  ' + String(i + 1).padStart(2) + '  ' + c));
    } else {
        lines.push('{bright-white-fg}state:{/bright-white-fg}  ' + e._name);
        lines.push('{grey-fg}saved: ' + (e.savedAt || '--') + (e.editedAt ? '   edited: ' + e.editedAt : '')
            + '   from bake: ' + (e.sourceBakeSessionId || '--') + '{/grey-fg}');
        lines.push('');
        lines.push('{bright-white-fg}commands{/bright-white-fg} {grey-fg}(:train edit/remove/add <n>){/grey-fg}');
        const cmds = e.commands || [];
        (cmds.length ? cmds : ['{grey-fg}(empty){/grey-fg}']).forEach((c, i) => lines.push('  ' + String(i + 1).padStart(2) + '  ' + c));
    }
    return lines.join('\n');
}

// Inline training/review indicator, next to TRAIN/source/session in
// reviewHeaderBox's own line — bright-white for whichever sub-view is
// current, grey for the other (user: "keep in the header next to TRAIN
// source and session the current opened tab, the other, not opened, in
// grey"). The actual switching now happens via the footer chips/keys
// (^R — see renderFooter()/toggleLearnSubView()); this is just the at-a-
// glance status readout.
function learnSubMenuLine() {
    const seg = (label, active) => active
        ? '{bright-white-fg}' + label + '{/bright-white-fg}'
        : '{grey-fg}' + label + '{/grey-fg}';
    return seg('Training', learnView === 'training') + '  ' + seg('Review', learnView === 'review');
}

// Shared by the :train training|review command, the ^R key (see
// toggleLearnSubView()), and the footer chip's label — all just need
// "switch sub-view, entering Learn mode first if we weren't already there."
function switchLearnView(view) {
    if (appMode !== 'learn') enterLearnMode();
    learnView = view;
    reflowLearn();
    renderTrainingView();
    renderFooter();
    screen.render();
}

function renderTrainingView() {
    if (appMode !== 'learn') return;

    if (learnView === 'training') {
        // Live bracket view — reviewListBox has nothing to list here (see
        // reflowLearn(), which hides it and gives reviewDetailBox the full
        // width instead), so this only touches header + detail.
        const status = bakeSessionActive
            ? '{bright-white-fg}[BRACKET OPEN]{/bright-white-fg}'
            : '{grey-fg}[no bracket open]{/grey-fg}';
        reviewHeaderBox.setContent(
            '{bright-white-fg}TRAIN{/bright-white-fg}  ' + learnSubMenuLine() + '   ' + status
        );
        const lines = bakeInfoLines().slice();
        if (!bakeSessionActive) {
            lines.push('');
            lines.push('{grey-fg}:bakeloop <bars>  then  :bake start <prompt>  to open a bracket{/grey-fg}');
            lines.push('{grey-fg}(same commands as Playback — :bake works from either mode){/grey-fg}');
        }
        // Bake graph deliberately NOT shown here (user: "it should only
        // appear under review, not in the training tab of the train tab") —
        // see the 'review' branch below instead.
        reviewDetailBox.setContent(lines.join('\n'));
        learnPanelContentLines = lines.length;
        relayoutLearnPanel();
        return;
    }

    const total = reviewEntries.length;
    reviewHeaderBox.setContent(
        '{bright-white-fg}TRAIN{/bright-white-fg}  ' + learnSubMenuLine()
        + '   {grey-fg}source:{/grey-fg} ' + reviewSource
        + '  {grey-fg}session{/grey-fg} ' + (total ? (reviewIndex + 1) : 0) + '/' + total
        + (reviewAudioProc ? '  {bright-white-fg}▶ playing{/bright-white-fg}' : '')
    );
    const items = reviewEntries.map(e => reviewEntryLabel(e));
    reviewListBox.setItems(items.length ? items : ['{grey-fg}(none yet){/grey-fg}']);
    if (total) reviewListBox.select(reviewIndex);
    // Three separate sections now, stacked top to bottom (user: "the order
    // must be: bake menu with its own menu to its right ... then under it
    // is the recording section ... and then under it is the regression
    // section"): bake row (reviewListBox + reviewDetailBox, entry detail
    // ONLY), then reviewWaveformBox ("recording"), then reviewRegressionBox
    // ("regression" + its own picker menu underneath — see
    // appendBakeGraphLines()). Used to be one combined blob — entry detail
    // then regression appended after, both crammed into reviewDetailBox —
    // which is what buried regression (and its 50+ line menu) under
    // whatever the entry detail needed. See reflowLearn() for how the three
    // boxes are actually positioned/sized.
    const detailLines = renderReviewDetail(reviewEntries[reviewIndex]).split('\n');
    reviewDetailBox.setContent(detailLines.join('\n'));
    const regressionLines = [];
    appendBakeGraphLines(regressionLines);
    reviewRegressionBox.setContent(regressionLines.join('\n'));
    // reviewBakeContentLines drives ONLY the bake row's height now (see
    // reflowLearn()) — needs enough rows to show every list entry too, not
    // just whatever the detail text needs, same reasoning as before, just
    // no longer conflated with regression's own (much larger) line count.
    reviewBakeContentLines = Math.max(detailLines.length, items.length);
    relayoutLearnPanel();
}

// appendBakeGraphLines — mutates `lines` in place, adding the last
// :showBakeGraph result (a whole page's worth of graphs, if any) below
// whatever detail content was already there. Persists across every
// renderTrainingView() rebuild (navigation, ticks, etc.) since it's driven
// by module-level lastBakePage rather than being computed fresh each time —
// same reasoning as bakeSessionActive and everything else this function
// reads without recomputing.
// FEATURE_GLYPH — short marker for the page-menu grid below; keeps each
// entry to a compact, scannable width instead of spelling out
// "absDelta"/"mean" etc. every time. mean's glyph is 'avg', not the more
// textbook x̄ (x-bar) — deliberately: x̄ is 'x' + a COMBINING MACRON, TWO
// UTF-16 code units that render as ONE terminal column, so pad()'s raw
// .length-based padding below counted it a character too long and threw
// every column after a mean-page entry out of alignment (user: "make sure
// the space between the infos in the menu is equal for all" — this is what
// broke it). 'avg' is plain ASCII, same visible length as its own
// .length, no such landmine.
const FEATURE_GLYPH = { delta: 'Δ', absDelta: '|Δ|', mean: 'avg', std: 'σ' };
// KIND_LABEL — 'level' page shows C/S/E/F/P/H/T, 'tension' shows the Tn*
// six — short words used in both the page menu and each page's own header.
const KIND_LABEL = { level: 'level', tension: 'tension' };
const MODEL_LABEL = { transition: 'trans', vertical: 'vert' };

// bakeGraphMenuLines — the page picker (user originally: "dont forget the
// submenu that shows the graph attributed to each possible weight of this
// system (50-ish)"; later: "show multiple graph at the same time to reduce
// the number of options in the menu" — see BAKE_GRAPH_PAGES for the
// grouping this now reflects). One entry per BAKE_GRAPH_PAGES item (8, not
// 52), wrapped into a grid that fits `width`; the live selection
// (selectedPageIdx) renders bold white, everything else grey — same "blank
// unless it's the thing that matters" convention as the gen/remix tag and
// pinMark elsewhere in this file. Labels are padded to a fixed width
// BEFORE being wrapped in {tag}s (same reason as modeCol near
// STEM_ROW_LABEL — pad()'s raw .length/.slice would otherwise miscount/cut
// blessed markup).
function bakeGraphMenuLines(width) {
  const w = Math.max(20, width || 48);
  const itemW = 20;
  const perRow = Math.max(1, Math.floor(w / itemW));
  const rows = [];
  let row = '', count = 0;
  BAKE_GRAPH_PAGES.forEach((p, i) => {
    const n = i + 1;
    const label = pad(n + '.' + KIND_LABEL[p.kind] + ' ' + MODEL_LABEL[p.model]
      + ' ' + (FEATURE_GLYPH[p.feature] || p.feature), itemW);
    row += (n === selectedPageIdx)
      ? `{white-fg}{bold}${label}{/bold}{/white-fg}`
      : `{grey-fg}${label}{/grey-fg}`;
    count++;
    if (count === perRow) { rows.push(row); row = ''; count = 0; }
  });
  if (row) rows.push(row);
  return rows;
}

// DIM_SHAPE_LABEL — degree -> the word :setFitShape uses for it, for status
// lines/log messages that need to say which shape is active in English
// rather than just printing "2".
const DIM_SHAPE_LABEL = { 1: 'linear', 2: 'quadratic', 3: 'cubic' };
// DIM_SHAPE_SHORT — same, abbreviated for the narrow per-card headers in
// the 2-row grid below, where "quadratic" alone can be a third of the
// card's whole width.
const DIM_SHAPE_SHORT = { 1: 'lin', 2: 'quad', 3: 'cub' };

// padVis — pads `str` with plain (untagged) spaces up to `len` VISIBLE
// characters, not raw string length — needed because the grid rows below
// splice multiple already-{tag}ged card lines side by side, and a raw
// .length/.padEnd would count each {white-fg}/{/white-fg} etc. as visible
// characters and misalign every column after the first (same class of bug
// pad()'s own comment elsewhere in this file warns about, just here the
// tags are already embedded mid-string instead of wrapped around the whole
// thing afterward, so pad() itself can't be reused as-is).
function padVis(str, len) {
  const visLen = str.replace(/\{[^}]+\}/g, '').length;
  return visLen >= len ? str : str + ' '.repeat(len - visLen);
}

// composeGridRow — zips N same-height card line-arrays into single output
// lines, column by column, `colW` wide with `gap` spaces between — this is
// what actually puts multiple graphs side by side (user: "put them on two
// rows, not only one, so everything can fit in one page"). Cards can have
// different heights (shouldn't in practice — every card here is built by
// buildGraphCard() below, always the same shape — but this stays correct
// either way rather than assuming).
function composeGridRow(cards, colW, gap) {
  const height = Math.max(0, ...cards.map(c => c.length));
  const rows = [];
  for (let li = 0; li < height; li++) {
    rows.push(cards.map(c => padVis(c[li] || '', colW)).join(' '.repeat(gap)));
  }
  return rows;
}

// buildGraphCard — one dim's compact card: a one-line header (dim name,
// sample count, abbreviated fit shape — the full equation doesn't fit at
// colW anymore, see formatPolyEquation() for where it's still shown in
// full), the mini scatter itself, then its own x-range (the numeric range
// varies per dim even though every card shares the same y meaning — see
// the shared y note printed once above the grid instead of per-card).
function buildGraphCard(g) {
  const lines = [];
  const shapeShort = DIM_SHAPE_SHORT[g.degree] || 'lin';
  lines.push('{bold}{white-fg}' + g.dim + '{/white-fg}{/bold} '
    + (g.empty ? '{grey-fg}no data{/grey-fg}' : '{grey-fg}n=' + g.n + ' ' + shapeShort + '{/grey-fg}'));
  lines.push(...g.text.split('\n'));
  lines.push(g.empty ? '{grey-fg}—{/grey-fg}' : '{grey-fg}[' + g.xMin.toFixed(2) + '..' + g.xMax.toFixed(2) + ']{/grey-fg}');
  return lines;
}

function appendBakeGraphLines(lines) {
    // Lazy-init instead of at module load — see refreshSelectedBakePage()'s
    // own comment on why calling it eagerly at parse time isn't safe (box
    // sizing not resolved yet). By the time anything actually renders the
    // training screen, reviewRegressionBox is definitely sized, so this is
    // safe.
    if (!lastBakePage) refreshSelectedBakePage();
    if (!lastBakePage) return;
    // Same subtitle-over-a-rule header reviewWaveformBox uses for
    // "recording" (user: "use the layout of the recording section, with
    // the subtitle and the line ... use the same layout but for the graph
    // section"): a bold one-word subtitle + status on row one, one plain
    // rule on row two, then the actual content underneath.
    // "regression" over plain "graph": this box is specifically a scatter
    // plot with a fitted regression curve overlaid (linear/quadratic/cubic
    // depending on :setFitShape) — see recordingWaveformLine()'s own
    // subtitle ("recording") for the pattern this is matching.
    // ruleW spans the box's FULL width now (user: "align regression line
    // with recording line, make them the same length") — was capped at 96
    // to match the old single big graph's own readability cap, but a plain
    // repeated-character rule has no such readability concern, so nothing
    // stops it from running the box's actual full width the same way
    // recording's own line (recordingWaveformLine(), sized off the same
    // reviewWaveformBox.width) already does. The plot width below keeps its
    // own separate, smaller cap — more Braille columns past ~96 doesn't
    // make a ~20-50-point scatter more readable, just sparser.
    const fullW = reviewRegressionBox.width || contentW();
    const kindWord = lastBakePage.kind === 'level'
      ? 'level (C S E F P H T)'
      : 'tension (TnC TnE TnF TnP TnH TnT)';
    const status = '{grey-fg}' + lastBakePage.model + ' ' + lastBakePage.feature
      + ' · ' + kindWord + '{/grey-fg}';
    lines.push('');
    lines.push('{bright-white-fg}regression{/bright-white-fg}   ' + status);
    lines.push('{grey-fg}' + '─'.repeat(Math.max(1, fullW)) + '{/grey-fg}');
    // Menu right under the header, ABOVE the graphs (user: "put the graph
    // menu above the graph, right under the regression section") — was
    // graphs-then-menu for one release; this is the correction back.
    lines.push('{grey-fg}^P/^N to page through, or :showBakeGraph <n> / :graphNext / :graphPrev{/grey-fg}');
    bakeGraphMenuLines(fullW).forEach(r => lines.push(r));
    lines.push('');
    // Shared axis notes — every graph on a page plots the SAME thing on y
    // (the bake rating) and the same KIND of thing on x (just a different
    // dim each time), so both get stated once here instead of repeated
    // verbatim on every card (user: "add axis to the graph. what x is and
    // what y is", amortized now that up to 7 graphs share a page). Each
    // card below still prints its own numeric x-range, since that DOES
    // vary per dim even though the meaning doesn't.
    lines.push('{grey-fg}y: rating  [-1 .. 1]  ·  x: '
      + featureAxisLabel('<dim>', lastBakePage.model, lastBakePage.feature)
      + ', range shown per card below{/grey-fg}');
    // The graphs themselves — two rows of compact cards (user: "put them
    // on two rows, not only one, so everything can fit in one page"),
    // `lastBakePage.cols` per row (see refreshSelectedBakePage()), each
    // card built by buildGraphCard() and zipped together side by side by
    // composeGridRow().
    for (let i = 0; i < lastBakePage.graphs.length; i += lastBakePage.cols) {
      const rowCards = lastBakePage.graphs.slice(i, i + lastBakePage.cols).map(buildGraphCard);
      composeGridRow(rowCards, lastBakePage.colW, 2).forEach(r => lines.push(r));
      lines.push('');
    }
}

// Content height just changed (learnPanelContentLines was updated right
// before this is called) — re-run render() first so statusH/playTop pick up
// the new learnPanelHeight() this same tick (same staleness this file
// already guards against elsewhere — see enterLearnMode()'s render()-before-
// reflowLearn() comment), then reflowLearn() to reposition the panel boxes
// off that same fresh number, then repaint.
function relayoutLearnPanel() {
    render();
    reflowLearn();
    screen.render();
}

// learnPanelHeight()/learnPanelBottom() — the Learn panel (reviewHeaderBox +
// reviewListBox/reviewDetailBox) lives IN the header cluster now, replacing
// track/key/win/slices/LUFSs/quant/genre/beats (see sLines' appMode
// branch above) rather than sitting below playBox — same spot bakeInfoBox/
// tipBox/entropyBox/master normally occupy, all of which are hidden in
// Learn mode (PLAYBACK_HEADER_BOXES). Both render() (which needs the bottom edge
// to place playBox) and reflowLearn() (which needs the same numbers to
// actually size the boxes) call these, so the two can never disagree.
//
// Content-driven within a bounded fraction of the screen (not a flat
// fraction): a short bake/entry (a couple lines, "(none)" corrections, no
// bracket open) shouldn't reserve up to 40% of the header cluster and push
// the waveforms way down — see learnPanelContentLines, kept current by
// renderTrainingView() every time content changes.
function learnPanelHeight() {
    const h   = screen.height - FOOTER_H;
    const cap = Math.max(10, Math.min(24, Math.floor(h * 0.4)));
    return Math.max(6, Math.min(cap, learnPanelContentLines + 2));
}
// No "+ 1" blank row here (there used to be one) — user: "move the whole
// TRAIN section one space up... so it aligns with the playback page header
// height." Playback's own secondary panels (bakeInfoBox/tipBox/masterVuBox)
// dock directly at their own fixed header rows (MASTER_VU_TOP/TRAIN_TIP_TOP,
// both 3) rather than one row below statusH — this panel now does the same,
// starting right at statusH instead of one row under it.
function learnPanelTop()    { return statusH; }
function learnPanelBodyTop(){ return learnPanelTop() + 2; } // header row + one blank row
function learnPanelBodyH()  { return Math.max(3, learnPanelHeight() - 2); }
function learnPanelBottom() { return learnPanelBodyTop() + learnPanelBodyH(); }

// reviewStackBottom() — how far down 'review's own 3-section stack (bake
// row, recording, regression) is allowed to run. Deliberately NOT
// learnPanelBottom() — that's the shared, 24-row-capped bottom the
// 'training' sub-view and the playback screen still use, sized to leave
// room for playBox/the per-stem VU-spatial-descriptor columns underneath.
// None of that exists while inReview — playBox and PLAYBACK_CHANNEL_BOXES
// are hidden there (see render()'s SCREEN VISIBILITY block) — so the space
// down to just above the footer is otherwise sitting empty, and this
// reclaims it for regression instead of leaving it capped at the same 24
// rows a short entry list gets on the training screen.
// EXCEPT while chat is maximized: chat overlay docks right under
// headerClusterBottom (see reflow()), which for appMode 'learn' is
// learnPanelBottom() regardless of learnView — reclaiming the extra space
// here too would run regression right underneath chat's own sep/menuHeader/
// log rows with nothing left for them. So this falls back to
// learnPanelBottom() itself whenever chat is open, matching exactly where
// headerClusterBottom already expects this stack to end — reviewDetailBox
// is scrollable, so a taller regression graph just scrolls in that case
// instead of losing content. toggleChatMaximize() calls reflowLearn() so
// this takes effect the moment chat opens/closes, not on the next
// unrelated layout pass.
function reviewStackBottom() {
  if (chatMaximized) return learnPanelBottom();
  return screen.height - FOOTER_H - 1;
}

function reflowLearn() {
    // w = contentW() (screen width minus SIDE_TOTAL_W), not the raw screen
    // width — master VU/spatial now stay visible on the training screen too
    // (see MASTER_METER_BOXES, user: "in the training page, dont forget to
    // show the VU/spat meters too"), docked at the same right-hand columns
    // they always use. Same margin CONTENT_W already reserves for the chat
    // overlay boxes, applied here so reviewHeaderBox/reviewListBox/
    // reviewDetailBox stop short of the right edge instead of running under
    // them.
    const w = contentW();
    const top = learnPanelTop();
    reviewHeaderBox.top = top;
    reviewHeaderBox.width = w;

    const bodyTop = learnPanelBodyTop();
    const bodyH   = learnPanelBodyH();

    if (learnView === 'training') {
        // No list to browse in the live-bracket view — reviewDetailBox
        // takes the full width instead (see renderTrainingView()'s
        // training branch, which only ever touches header + detail).
        // reviewWaveformBox (the recording) doesn't apply here either —
        // it's a 'review'-only box, playBox covers the live-bracket case
        // (see render()'s inReview branch) — so this leaves it untouched.
        // reviewRegressionBox is 'review'-only too — hidden here same as
        // reviewWaveformBox effectively is (render() never shows() it
        // outside inReview).
        reviewListBox.hide();
        reviewRegressionBox.hide();
        reviewDetailBox.left    = 0;
        reviewDetailBox.width   = w;
        reviewDetailBox.top     = bodyTop;
        reviewDetailBox.height  = bodyH;
    } else {
        // Three stacked sections, top to bottom (user: "the order must be:
        // bake menu with its own menu to its right ... then under it is the
        // recording section ... and then under it is the regression
        // section"):
        //   1. bake row — reviewListBox (session picker) beside
        //      reviewDetailBox (that session's own intent/track/status/
        //      corrections/final_cmds — entry detail ONLY now, see
        //      renderTrainingView()'s review branch).
        //   2. reviewWaveformBox ("recording") — full width, fixed height.
        //   3. reviewRegressionBox ("regression") — full width, its own
        //      picker menu at the BOTTOM of its own content (see
        //      appendBakeGraphLines()) — fills whatever's left down to
        //      reviewStackBottom() instead of sharing the old shared/capped
        //      bodyH the training sub-view still uses (bodyH itself is
        //      unused in this branch now).
        const GAP = 1;

        // 1. Bake row — sized off reviewBakeContentLines (entry-detail line
        // count only, now that regression moved into its own box), not the
        // old shared learnPanelContentLines that used to include regression
        // too — that's what made this row balloon to the 24-row cap the
        // moment a 50-entry graph menu got appended to the same content.
        const bakeH = Math.max(4, Math.min(10, reviewBakeContentLines + 1));
        const listW = Math.max(24, Math.min(48, Math.floor(w * 0.32)));
        // Just the named, scrollable list — no numbered quick-tab strip
        // above it any more (user: "there cant be a hundred boxes with
        // numbers above the list" — a fixed-width row of number tabs is a
        // toy at 5 sessions and useless at 100+; reviewListBox already
        // scrolls/selects fine on its own at any count).
        reviewListBox.show();
        reviewListBox.top    = bodyTop;
        reviewListBox.width  = listW;
        reviewListBox.height = bakeH;
        reviewDetailBox.left   = listW + 1;
        reviewDetailBox.width  = w - listW - 1;
        reviewDetailBox.top    = bodyTop;
        reviewDetailBox.height = bakeH;

        // 2. Recording — fixed 2 rows, right under the bake row.
        const RECORDING_H = reviewWaveformBox.height; // 2 — fixed at box creation
        const recordingTop = bodyTop + bakeH + GAP;
        reviewWaveformBox.top   = recordingTop;
        reviewWaveformBox.width = w;

        // 3. Regression — everything left, down to just above the footer.
        const regressionTop = recordingTop + RECORDING_H + GAP;
        const regressionH   = Math.max(6, reviewStackBottom() - regressionTop);
        reviewRegressionBox.show();
        reviewRegressionBox.top    = regressionTop;
        reviewRegressionBox.width  = w;
        reviewRegressionBox.height = regressionH;
    }
}

function enterLearnMode() {
    if (appMode === 'learn') return;
    // Chat (if open) is left exactly as it was — ^T only ever switches
    // which SCREEN is underneath the overlay, never touches the overlay
    // itself (see the SCREEN MODEL comment above CHAT_OVERLAY_BOXES).
    appMode = 'learn';
    refreshReviewEntries();
    reviewHeaderBox.show(); reviewDetailBox.show(); // reviewListBox: reflowLearn() decides, per learnView
    // render() FIRST, not after — it's what shrinks statusH down to Learn
    // mode's 2-row header (sLines' appMode branch) AND applies the SCREEN
    // VISIBILITY rules (hides PLAYBACK_HEADER_BOXES/PLAYBACK_CHANNEL_BOXES
    // now that appMode is 'learn' — no separate forEach needed here
    // anymore). reflowLearn() sizes the review boxes off THAT statusH (via
    // learnPanelTop/BodyH), and playTop (set inside render(), every tick)
    // is derived from the exact same numbers — but only once render() has
    // actually run with appMode already 'learn'. Calling reflowLearn()
    // first, off the stale 5-row statusH from the moment before this
    // function ran, sized the panel a few rows too tall — that overlap ate
    // the topmost stem's rows (vocals, first in the stems array) as soon as
    // the NEXT render() tick moved playBox up to the (correct, smaller)
    // statusH.
    render();
    reflowLearn();
    renderTrainingView();
    renderFooter();
    screen.render();
}

function exitLearnMode() {
    if (appMode !== 'learn') return;
    reviewStop();
    appMode = 'playback';
    reviewHeaderBox.hide(); reviewListBox.hide(); reviewDetailBox.hide(); reviewRegressionBox.hide();
    // PLAYBACK_HEADER_BOXES/PLAYBACK_CHANNEL_BOXES reappear on their own —
    // see the SCREEN VISIBILITY block in render(), which this call runs
    // (render(), not just reflow() — same statusH-staleness reasoning as
    // enterLearnMode() above, just in reverse).
    render();
    renderFooter();
    screen.render();
}

function toggleLearnMode() { appMode === 'learn' ? exitLearnMode() : enterLearnMode(); }

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

// Last few lines appended, kept regardless of chatMaximized — feeds
// peekBox (see its own comment near its definition), the "always there"
// 2-3 line preview that shows a command + its message without opening the
// whole chat overlay. Capped well past what peekBox itself displays so
// there's headroom if PEEK_H ever grows.
let recentLogLines = [];
const RECENT_LOG_KEEP = 8;
function updatePeekBox() {
  peekBox.setContent(recentLogLines.slice(-PEEK_H).join('\n'));
}

function appendLog(line, opts) {
  if (LOG_NOISE.test(line)) return;
  opts = opts || {};
  // Used to auto-open chat the moment there was anything real to show in it
  // (a whole round of "open the whole chat, i want to see the feedback").
  // Reversed now (user: "actually, never open the chat automatically. let
  // the user open it by typing control c.") — appendLog() no longer forces
  // chatMaximized on for ANY message, logSys/logCricket/logUser alike.
  // Feedback that lands while chat is closed still isn't silently lost: it
  // goes into logBox regardless (so it's there the next time chat DOES open,
  // via ^C or :chat) and into peekBox, the always-visible 2-3 line preview
  // right above the input line — see updatePeekBox() below and peekBox's
  // own comment. Only the forced full-overlay-open behavior is gone.
  const wasBottom = atBottom();
  const savedPos  = wasBottom ? -1 : logBox.getScroll();
  logBox.add(line);
  if (wasBottom) {
    logBox.setScrollPerc(100);
  } else {
    logBox.scrollTo(savedPos);
  }
  recentLogLines.push(line);
  if (recentLogLines.length > RECENT_LOG_KEEP) recentLogLines.shift();
  updatePeekBox();
  screen.render();
}

function logSys(text, opts) {
  appendLog(`{grey-fg}${text}{/grey-fg}`, opts);
}

// Zone 3 (lang) and Zone 4 (cmd) helpers — defined after reflow() above
// _r used to bake sig+desc into one fixed-width-padded string (padEnd to a
// gutter column). That made every row's width sig.length-independent of the
// column it eventually landed in, so a handful of long rows (formantShift,
// setLearnedWeight, the tipping section's long tip-open signature) could
// each single-handedly force a whole column — and therefore the whole
// layout — wider than the terminal, collapsing everything back down to one
// column (user: "it is too long ... only one big column" — still true even
// at 160-column-wide terminals with the old fixed-gutter math, since two
// ~80-char sections in the same layout needed ~164 columns just for 2).
// _r now just keeps sig/desc apart as data; buildCmdColumns() picks the
// column width straight from the terminal (see pickCmdColumnLayout()) and
// lays each row out — and wraps it onto extra lines if it doesn't fit —
// against THAT width, so column count actually responds to how wide the
// terminal really is instead of being held hostage by a few long rows.
const _r = (sig, desc) => ({ sig, desc });

// CMD_SECTIONS — same content that used to be one flat CMD_LINES array (one
// long single-column dump, 150+ rows, only ever using the left ~60 columns
// of the panel no matter how wide the terminal was) — user: "the list is
// very long ... find a way to split it in columns ... cover the whole
// width". Grouped by the same section titles the old '── title ──' dividers
// used, now as structured data so buildCmdColumns() below can pack whole
// sections side by side instead. Sections are kept intact within a single
// column (never split a section's own rows across two columns) — that's
// what actually keeps this scannable instead of turning into a grid of
// unrelated fragments.
const CMD_SECTIONS = [
  { title: 'view', rows: [
    _r(':showState',                               'print state'),
    _r(':showCommands',                            'toggle this panel'),
    _r(':resetPeaks',                              'clear peak-hold markers'),
  ]},
  { title: 'cricket / memory', rows: [
    _r(':language',                                'toggle language panel'),
    _r(':chat',                                    'maximize/un-maximize chat'),
    _r(':memory',                                  'report memory saturation'),
    _r(':memory clear',                            'wipe chat memory (2-step)'),
  ]},
  { title: 'playback', rows: [
    ':start  ·  :stop',
    _r(':applyNow',                                'reroll all 4 stems now'),
    _r(':next [vocals|melody|bass|drums]',         'force next slice'),
    _r(':selectSegment vocals|melody|bass|drums',  'queue next slice'),
    _r(':loop <stem> <bars>',                      'loop stem N bars'),
    _r(':unloop <stem>',                           'release loop'),
    _r(':unloopAll',                               'release all loops'),
    _r(':lockSource <leader> <follower...>',       'follower(s) copy leader source'),
    _r(':lockSource all [leader]',                 'lock all to one leader'),
    _r(':unlockSource <stem|all>',                 'release source lock'),
    _r(':setStemSource <stem|all> <name>',         'pin stem to source (match)'),
    _r(':setStemSource <stem|all> clear',          'release pin'),
  ]},
  { title: 'index', rows: [
    _r(':buildIndex',                              'rebuild slice index'),
    _r(':loadIndex',                               'load cached index'),
    _r(':saveIndex',                               'save index to cache'),
    _r(':nextTrack / :prevTrack',                  'browse track bank'),
    _r(':reloadDownbeats',                         'reload downbeats.json'),
    _r(':info',                                    'dump state to console'),
    _r(':reset',                                   'clear index + stop'),
    _r(':resetMemory',                             'wipe analysis JSON (2-step)'),
    _r(':restartWatcher',                          'restart watch_demucs'),
    _r(':switchSession [name] / :logout',          'switch or leave session'),
    _r(':bakeloop <bars>',                           'set checkpoint window'),
    _r(':bake start [bars] <prompt>',                'open bake bracket'),
    _r(':bake show',                                 'show current bracket'),
    _r(':bake edit <n> <command...>',                'replace bracket line n'),
    _r(':bake remove <n>',                           'drop bracket line n'),
    _r(':bake sequence name:bars [name:bars ...]',   'open sequence bracket'),
    _r(':bake end [name]',                           'queue bracket close'),
    _r(':bake abort',                                'discard bracket now'),
    _r(':bakeState list',                            'list saved states'),
    _r(':bakeState show <name>',                     'show saved state'),
    _r(':bakeState apply <name>',                    'apply saved state live'),
    _r(':bakeState drop <name>',                     'delete saved state'),
  ]},
  { title: 'train (training + review)', rows: [
    '{grey-fg}  ^C chat  ·  ^T train  ·  ^R training/review  ·  ^B next bake  ·  ^L log out{/grey-fg}',
    _r(':train',                                     'toggle the training screen (^T)'),
    _r(':train training',                            'sub-menu: live bake bracket'),
    _r(':train review',                              'sub-menu: browse past bakes'),
    _r(':train source bakes|states',                 'review: switch data source'),
    _r(':train next / :train prev',                  'review: browse sessions'),
    _r(':train play / :train stop',                  'review: play/stop this session\'s audio'),
    _r(':train approve',                             'review: keep this bake for training'),
    _r(':train exclude',                             'review: drop this bake from training'),
    _r(':train edit <n> <command...>',               'review: replace final_cmds line n'),
    _r(':train remove <n>',                          'review: drop final_cmds line n'),
    _r(':train add <command...>',                    'review: append a final_cmds line'),
    _r(':score <-1..1> [overallSection]',            'score current combo'),
    _r(':scoreTransition <-1..1> [stem]',            'score last cut'),
    _r(':tag <label> [stem]',                        'tag current bar-range'),
    _r(':listSections [track]',                      'list structure tags'),
    _r(':trainBias',                                 'fit bias models'),
    _r(':reloadBias',                                'reload learned bias'),
    _r(':setLearnedWeight <stem|all> <transition|vertical> <0-5>', 'scale learned model use'),
    _r(':setAgentMode <stem|all> <remix|generate>', 'switch candidate source'),
    _r(':setFitShape <dim> <linear|quadratic|cubic>', 'change one dim\'s fit shape'),
    _r(':showBakeGraph <n>|<dim> [transition|vertical] [feature]', 'scatter + fitted curve'),
    _r(':listGraphs', 'numbered menu of all 8 graph pages'),
    _r(':graphNext / :graphPrev', 'cycle the picker in Train > Review'),
    _r('^P / ^N',                                    'same cycle (up/down), while on Train > Review'),
    _r('^B / ^D',                                    'step through bakes (up/down) in Train > Review'),
    _r(':fakeBakes <n>', 'synthetic bake data, for demoing graphs'),
    _r(':resetAll',                                '⚠ wipe everything (Y/N)'),
    _r(':analyzeAll',                              'run genre + beat analysis'),
    _r(':tagBeats',                                'run beat tagger only'),
    _r(':setMMT <bars>',                           'momentum window size'),
  ]},
  { title: 'trigger pads', rows: [
    _r(':triggerMode <stem|all> 0|1',              '0=auto  1=manual fire'),
    _r(':trigger [stem]',                          'fire next slice'),
    '{grey-fg}  C-1/C-2/C-3/C-4{/grey-fg}   fire vocals/melody/bass/drums',
  ]},
  { title: 'slicing', rows: [
    _r(':chunkMode [stem] 0|1',                    '0=full file  1=bar chunks'),
    _r(':skip <stem>',                             'jump to new file'),
    _r(':setSegmentBars [stem] 0.5|1|2|4|8|16|32', 'bars/slice, sets chunkMode 1'),
    _r(':returnToBase [stem|all]',                 'snap back to base mix'),
    _r(':setStayProb [stem] 0.0–1.0',             '0=jump  1=loop'),
    _r(':setSrcWeights <bpm> <cohesion> [key]',    'source-track prob weights'),
    _r(':setQuantize 0|1',                         'bar-locked cuts'),
    _r(':setMaxSlices N',                          'cap slices/stem'),
    _r(':setWindow hann|hamming|blackman|triangle|rect', 'FFT window, pitch shifter'),
  ]},
  { title: 'tempo', rows: [
    '{grey-fg}  pitch/BPM affect audio live; rest waits for next slice{/grey-fg}',
    _r(':setFallbackBPM 40–280',                   'fallback tempo, live'),
    _r(':setGlobalBPM 40–280',                     'BPM override, live'),
  ]},
  { title: 'matching', rows: [
    _r(':setWeight <stem|all> C|S|E|F|P|H|T 0–5',  'descriptor weight'),
    _r(':setMatchProb <stem|all> 0–1',             'transition tightness'),
    _r(':setDirPref <stem|all> C|S|E|F|P|H|T|D -1–1', 'direction bias'),
    _r(':setDirWeight <stem|all> 0–5',             'direction bias strength'),
    _r(':wmdScope all|vocals|melody|bass|drums',   'which stem header shows'),
    _r(':setTrackWeight vocals|melody|bass|drums', 'stem influence 0–1'),
    _r(':followStem <stem> <dim> <target> <w> …', 'that dim follows another stem'),
    _r(':followStem <stem> all <target> <w> …',   'every dim follows another stem'),
    _r(':followStem <stem> <dim> self',            'reset just that dimension'),
    _r(':followStem <stem> self',                  'reset every dimension'),
    _r(':setEntropy 0–1',                          'order↔chaos macro'),
  ]},
  { title: 'audio', rows: [
    _r(':fader <stem|all> <0–1>',                 'channel level'),
    _r(':trim <stem|all> <dB>',                   'input gain'),
    _r(':mute <stem|all> 0|1',                    '0=unmute  1=mute'),
    _r(':solo <stem|all> 0|1',                    '0=off  1=on'),
    _r(':master <0–1>',                           'master gain'),
    _r(':eqLow <stem|all> <dB>',                  'low shelf gain'),
    _r(':eqMid <stem|all> <dB>',                  'mid bell gain'),
    _r(':eqMidFreq <stem|all> <Hz>',              'mid bell center'),
    _r(':eqHigh <stem|all> <dB>',                 'high shelf gain'),
  ]},
  { title: 'spatial', rows: [
    _r(':width <stem|all|master> <0–1>',          'stereo width'),
    _r(':joystick <stem|all> <x> <y>',            '2D pan'),
    _r(':masterJoystick <x> <y>',                 '2D pan (master)'),
    _r(':pan <stem|all> 0–360',                    'quad rotation angle'),
    _r(':analysisMode on|off',                    'auto width from analysis'),
  ]},
  { title: 'FX & outputs', rows: [
    _r(':fx <stem> <0–1>',                        'FX send/return level'),
    _r(':fxSwitch <1|2> <0|1>',                   '0=stem  1=live input'),
    _r(':monoSend <stem|all> on|off',             'mono sum for FX send'),
    _r(':boothGain <0–1>',                        'monitor level'),
    _r(':recGain <0–1>',                          'recording level'),
    _r(':record start [name]',                    'start recording'),
    _r(':record stop',                            'stop recording'),
    _r(':pitchShift <stem> <semitones>',          'pitch shift'),
    _r(':formantShift <stem> <semitones>',        'formant shift, independent of pitch'),
    _r(':setShiftBand <stem> <loHz> <hiHz>',       'shared pitch+formant band limit'),
    _r(':setPitchBand <stem> <loHz> <hiHz>',       'pitch-only band override'),
    _r(':setFormantBand <stem> <loHz> <hiHz>',     'formant-only band override'),
    _r(':clearPitchBand <stem>',                   'drop pitch band override'),
    _r(':clearFormantBand <stem>',                 'drop formant band override'),
    _r(':clearShiftBand <stem>',                   'reset shared band, clear overrides'),
  ]},
  { title: 'filters', rows: [
    _r(':setGenreFilter <genre>',                  'restrict to genre'),
    _r(':clearGenreFilter',                        'remove genre filter'),
    _r(':listGenres',                              'list genre tags'),
    _r(':setKeyFilter <key>',                      'restrict to key'),
    _r(':clearKeyFilter',                          'remove key filter'),
  ]},
  { title: 'query', rows: [
    _r(':dumpDescriptors [stem]',                  'dump slice descriptors'),
    _r(':selectRange [stem] C:lo,hi W:lo,hi E:lo,hi F:lo,hi P:lo,hi', 'pick slice in range'),
    _r(':nextNearest <stem> <C> <E> <F> <P>',      'jump to closest slice'),
  ]},
  { title: 'network', rows: [
    _r(':network <ssid> [password]',               'join a wifi network'),
  ]},
  { title: 'link (multi-deck sync)', rows: [
    _r(':link on | off',                           'legacy UDP peer sync'),
    _r(':link status',                             'show connected decks'),
    _r(':link mode avoid|mirror|complement|off',   'how decks react'),
    _r(':link arm',                                'arm missile switch'),
    _r(':link fire',                               'fire armed switch'),
    _r(':link abort',                              'disarm without firing'),
    _r(':link token <hex>',                        'set session token'),
    _r(':link select <1-4>',                       'pick which deck fire targets'),
    _r(':link select clear',                       'deselect target deck'),
  ]},
  { title: 'tipping session (payouts — NOT your login session)', rows: [
    _r(':tipOpen <djId> <venue> web|venue [deck]', 'open tipping session'),
    _r(':tipClose',                                'close tipping session'),
    _r(':tip',                                     'dry-run split %'),
    _r(':tip <username> <amount>',                 'simulate incoming tip'),
    _r(':setSplit <dj 0-100>',                     'override dj/artist split, clamped ≥ floor'),
    _r(':setSplit clear',                          'reset split to floor'),
    _r('  ↳ login session?',                       'use :switchSession/:logout'),
  ]},
];

// ── GHOST COMPLETION ─────────────────────────────────────────────────────────
// All distinct command verbs a user might type after ':'/'@' — pulled from
// CMD_SECTIONS (the exact same data :showCommands renders) unioned with
// COMMANDS (the Cricket→Max passthrough set, which covers a few verbs like
// 'start'/'stop' that CMD_SECTIONS only shows folded into one decorative
// display string, ':start  ·  :stop', rather than as their own {sig,desc}
// rows) — so ghost-suggestions read from the same source of truth as the
// real command list instead of a third, independently-maintained copy that
// could drift out of sync with either. Built once; both source lists are
// static. Only the FIRST word of each sig counts (verb-level completion —
// see suggestCompletion()'s own comment for why arguments aren't included).
const ALL_CMD_VERBS = (() => {
  const set = new Set(COMMANDS);
  CMD_SECTIONS.forEach(sec => sec.rows.forEach(r => {
    if (typeof r === 'string') return; // decorative rows, not real commands
    const verb = r.sig.replace(/^:/, '').split(/\s+/)[0];
    if (verb) set.add(verb);
  }));
  return Array.from(set);
})();

// Best ghost-completion for whatever verb has been typed so far, or '' if
// there's nothing to add (no match, or the typed text already IS a full
// verb). Verb-level only — once the whole verb is typed and the user moves
// on to arguments, this stops suggesting; an argument placeholder like
// "<bpm 40-280>" from the command list isn't literal text that belongs in
// the command, so it's not safe to offer as a fill-with-Right-Arrow
// completion the way the verb itself is.
// SHORTEST matching verb wins ties, not first-alphabetical: ":setG" matches
// both setGenreFilter and setGlobalBPM, and the shorter one is what actually
// gets suggested — the shorter completion is the likelier target, and typing
// past it to the longer one still works fine either way.
function suggestCompletion(typedVerb) {
  if (!typedVerb) return '';
  let best = null;
  for (const v of ALL_CMD_VERBS) {
    if (v.length > typedVerb.length && v.startsWith(typedVerb)) {
      if (!best || v.length < best.length || (v.length === best.length && v < best)) best = v;
    }
  }
  return best ? best.slice(typedVerb.length) : '';
}

// Every verb matching typedVerb (empty string matches everything — see
// below), ordered the same way suggestCompletion()'s tie-break already
// does: shortest first, alphabetical after that. Used for CYCLING (repeated
// Right Arrow — see inputBox._listener below), where the first press should
// land on the exact same candidate suggestCompletion()'s ghost box was
// already previewing, and each press after that just keeps walking down
// the same ordered list instead of stopping at one.
function matchingVerbs(typedVerb) {
  return ALL_CMD_VERBS
    .filter(v => v.length > typedVerb.length && v.startsWith(typedVerb))
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
}

// Recomputes and (re)paints the ghost-completion box against inputBox's
// CURRENT value/cursor — called after every keystroke (see the
// CURSOR-AWARE INPUT EDITING block below) and after any programmatic value
// change (setInputValue — history recall, clear-on-submit). Only offers a
// suggestion while: the cursor sits at the true end of the text (a ghost
// tail mid-edit doesn't mean anything — nothing to "continue" from there),
// the line starts with ':' or '@' (plain chat/NL prompts to Cricket aren't
// commands, nothing to complete), and no space has been typed yet (still on
// the verb itself, not into its arguments — see suggestCompletion()).
function updateSuggestion() {
  const v   = inputBox.value || '';
  const pos = inputBox._cursorPos;
  const body = (v[0] === ':' || v[0] === '@') ? v.slice(1) : null;
  const suggestion = (body !== null && pos === v.length && !/\s/.test(body))
    ? suggestCompletion(body) : '';
  if (suggestion) {
    suggestBox.left = inputBox.strWidth(v);
    suggestBox.setContent('{grey-fg}' + suggestion + '{/grey-fg}');
    suggestBox.show();
  } else {
    suggestBox.hide();
  }
}

// visWidth() (defined above, near visLines()) already strips {tag} markup to
// measure real on-screen width — reused here for column sizing/padding so a
// row like the trigger-pads C-1..C-4 line (which carries its own {grey-fg}
// tag) measures by its visible text, not its raw character count.
function plainWidth(line) { return visWidth(line.replace(/\{[^}]+\}/g, '')); }
function padVisible(line, width) {
  return line + ' '.repeat(Math.max(0, width - plainWidth(line)));
}

// Plain (untagged) word-wrap — used for a {sig, desc} row's own text, which
// never carries {tag} markup itself (only the occasional decorative section
// row does — see wrapTaggedLine() below for those). Never splits a single
// word even if it alone exceeds width — it just overflows that one line
// rather than breaking mid-word.
function wrapPlainText(text, width) {
  const words = text.split(' ').filter(w => w.length);
  if (!words.length) return [''];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else { cur += ' ' + w; }
  }
  lines.push(cur);
  return lines;
}

// Tag-aware word-wrap for the handful of decorative section rows that carry
// their own {grey-fg}/{inverse} markup (the train sub-view's key-hint line,
// the trigger-pads C-1..C-4 line, tempo's live-vs-next-slice note). Walks
// word-by-word same as wrapPlainText, but tracks which tags are currently
// "open" so a line broken mid-tag gets that tag closed at the break and
// reopened on the next line — otherwise a wrapped {grey-fg} line would bleed
// its color into whatever renders after it.
function wrapTaggedLine(text, width) {
  const tokens = text.match(/\{\/?[\w\-,;!#]*\}|\s+|\S+/g) || [];
  const lines = [];
  let cur = '', curVis = 0;
  const openStack = [];
  const closeTagsStr = () => openStack.slice().reverse().map(t => `{/${t}}`).join('');
  const openTagsStr  = () => openStack.map(t => `{${t}}`).join('');
  function breakLine() {
    lines.push(cur.replace(/ +$/, '') + closeTagsStr());
    cur = openTagsStr();
    curVis = 0;
  }
  tokens.forEach(tok => {
    if (/^\{\//.test(tok)) { openStack.pop(); cur += tok; return; }
    if (/^\{/.test(tok))   { openStack.push(tok.slice(1, -1)); cur += tok; return; }
    if (/^\s+$/.test(tok)) { if (curVis > 0) { cur += ' '; curVis++; } return; }
    if (curVis > 0 && curVis + tok.length > width) breakLine();
    cur += tok; curVis += tok.length;
  });
  lines.push(cur.replace(/ +$/, '') + closeTagsStr());
  return lines;
}

// Lays a single {sig, desc} row out against a known column width and a
// (possibly 0) shared alignment column — sigCol, see sectionSigCol() below.
// Three cases, in order:
//   1. sig fits sigCol AND the padded row still fits colWidth — the common
//      case: pad sig out to sigCol so every row's description in this
//      section starts at the same column, table-style (user: "align the
//      description of the command[s]" — within each section, like a
//      table, not just sig + 2 spaces + desc).
//   2. sigCol doesn't apply (0, or this row's own sig is an outlier longer
//      than sigCol) but sig + gap + desc still fits colWidth as-is — same
//      ragged single-line fallback as before, just without the padding.
//   3. Doesn't fit at all — sig on its own line, desc word-wrapped
//      underneath with a 2-space hanging indent, same as before.
// sig rendered in {bright-white-fg} (desc is left uncolored, so it just
// inherits the panel's base {grey-fg} from buildCmdColumns()'s outer wrap)
// — the whole panel used to be one flat shade of grey with nothing to
// distinguish "what to type" from "what it does" (user: "its really hard
// to read ... figure out a solution to make it more accessible"). Padding
// math below still runs on the PLAIN sig/desc strings (sig.length,
// padEnd) so the tag markup never throws off column alignment — sigTag()
// only wraps the already-padded text right before it goes in the line.
function layoutSigDescRow(sig, desc, colWidth, sigCol) {
  const gap = 2;
  const sigTag = s => '{bright-white-fg}' + s + '{/bright-white-fg}';
  if (sigCol && sig.length <= sigCol && sigCol + gap + desc.length <= colWidth) {
    return [sigTag(sig.padEnd(sigCol)) + ' '.repeat(gap) + desc];
  }
  if (sig.length + gap + desc.length <= colWidth) return [sigTag(sig) + ' '.repeat(gap) + desc];
  const lines = (sig.length <= colWidth ? [sig] : wrapPlainText(sig, colWidth)).map(sigTag);
  const indent = '  ';
  wrapPlainText(desc, Math.max(4, colWidth - indent.length)).forEach(l => lines.push(indent + l));
  return lines;
}

// The shared sig-column width for one section at a given colWidth. MEDIAN
// signature length among the section's {sig, desc} rows (excluding plain
// decorative strings) — not the widest one. Every section has a handful of
// long outlier signatures (:setLearnedWeight's is 56 chars; :lockSource
// <leader> <follower...> is 35) sitting alongside a majority of short ones
// — aligning to the widest would drag EVERY row's description out to that
// same distant column, including short signatures that would rather sit
// close to their own description. Aligning to the median instead lines up
// the typical row cleanly and lets the few outliers fall back to their own
// ragged/wrapped layout (see layoutSigDescRow's case 2/3) — a much better
// trade for overall readability than one section-wide number everything
// has to answer to.
function sectionSigCol(sec, colWidth) {
  const gap = 2, minDescRoom = 10;
  const cap = Math.max(8, colWidth - gap - minDescRoom);
  const sigLens = sec.rows
    .filter(r => typeof r !== 'string' && r.sig.length <= cap)
    .map(r => r.sig.length)
    .sort((a, b) => a - b);
  if (!sigLens.length) return 0;
  const mid = Math.floor(sigLens.length / 2);
  return sigLens.length % 2
    ? sigLens[mid]
    : Math.round((sigLens[mid - 1] + sigLens[mid]) / 2);
}

// Section header line(s) — dash-filled on one line normally, but a couple of
// section titles (the tipping session one, at 51 chars) are wider than even
// the widest column gets once 3-4 columns are in play, so wrap the title
// itself rather than let it blow past colWidth and drag the whole merged
// row wider than the terminal.
// Title in {bright-white-fg} so it reads as an anchor when scanning down a
// column, dashes left grey (inherited from the outer wrap) so the divider
// recedes instead of competing with the text — same bright/grey split as
// layoutSigDescRow's sig/desc (user: "make it more accessible").
function renderSectionHeader(title, colWidth) {
  const prefix = '── ';
  const titleTag = s => '{bright-white-fg}' + s + '{/bright-white-fg}';
  if (prefix.length + title.length + 1 <= colWidth) {
    const dashes = Math.max(0, colWidth - (prefix.length + title.length + 1));
    return [titleTag(prefix + title) + ' ' + '─'.repeat(dashes)];
  }
  return wrapPlainText(title, Math.max(4, colWidth - prefix.length))
    .map((l, i) => titleTag((i === 0 ? prefix : '  ') + l));
}

// One section's rows rendered against a known column width — the single
// source of truth for both a section's LINE COUNT (used to balance columns
// in packCmdColumns()) and its actual rendered content (renderCmdColumnLines()),
// so the two can never disagree about how tall a section turns out to be.
function renderSectionLines(sec, colWidth) {
  const lines = renderSectionHeader(sec.title, colWidth);
  const sigCol = sectionSigCol(sec, colWidth);
  sec.rows.forEach(r => {
    if (typeof r === 'string') {
      lines.push(...(plainWidth(r) <= colWidth ? [r] : wrapTaggedLine(r, colWidth)));
    } else {
      lines.push(...layoutSigDescRow(r.sig, r.desc, colWidth, sigCol));
    }
  });
  return lines;
}

// Greedy bin-pack (longest-processing-time-first): sections sorted tallest
// first, each one dropped into whichever column currently has the fewest
// lines — keeps columns level in HEIGHT, which is what actually shortens
// the panel vertically. Height is measured AFTER wrapping (renderSectionLines
// at the real colWidth), not by row count, so a section that wraps heavily
// at a narrow column width is weighted correctly instead of looking cheap.
function packCmdColumns(numCols, colWidth) {
  const cols = Array.from({ length: numCols }, () => ({ sections: [], lineCount: 0 }));
  const withHeights = CMD_SECTIONS.map(sec => ({ sec, h: renderSectionLines(sec, colWidth).length + 1 }));
  withHeights
    .slice()
    .sort((a, b) => b.h - a.h)
    .forEach(({ sec, h }) => {
      let target = cols[0];
      for (const c of cols) if (c.lineCount < target.lineCount) target = c;
      target.sections.push(sec);
      target.lineCount += h;
    });
  // Restore original top-to-bottom reading order within each column —
  // tallest-first was only for the placement DECISION above.
  cols.forEach(c => c.sections.sort((a, b) => CMD_SECTIONS.indexOf(a) - CMD_SECTIONS.indexOf(b)));
  return cols;
}

function renderCmdColumnLines(col, colWidth) {
  const lines = [];
  col.sections.forEach((sec, i) => {
    if (i > 0) lines.push('');
    renderSectionLines(sec, colWidth).forEach(l => lines.push(padVisible(l, colWidth)));
  });
  return lines;
}

const CMD_COL_GAP    = 3;  // spaces between adjacent columns
const CMD_MAX_COLS   = 4;  // sanity ceiling
const CMD_MIN_COL_W  = 34; // below this, a column wraps too aggressively to be worth splitting off

// Column count/width now comes straight from the terminal width — divide it
// into as many equal-ish columns as fit at >= CMD_MIN_COL_W each (capped at
// CMD_MAX_COLS) — instead of being derived from section content, which is
// what made the old version need a 160+ column terminal before it would
// ever produce more than one column (two of the widest sections alone
// needed ~164 columns together). Content that doesn't fit the chosen
// column width wraps (see renderSectionLines()) rather than vetoing the
// column count, so a normal 80–120 column terminal now actually gets 2–3
// columns instead of the single long list the user was still seeing.
function pickCmdColumnLayout(width) {
  for (let n = CMD_MAX_COLS; n >= 1; n--) {
    const colWidth = Math.floor((width - CMD_COL_GAP * (n - 1)) / n);
    if (colWidth >= CMD_MIN_COL_W || n === 1) return { n, colWidth: Math.max(colWidth, 20) };
  }
}

// Rebuilt fresh against the CURRENT terminal width every time the panel
// opens (and on resize while it's open — see the screen.on('resize')
// handler) rather than baked in once at startup, same reasoning as
// buildLangList().
function buildCmdColumns(width) {
  const { n, colWidth } = pickCmdColumnLayout(width);
  const cols = packCmdColumns(n, colWidth);

  const colLines = cols.map(c => renderCmdColumnLines(c, colWidth));
  const maxRows  = Math.max(0, ...colLines.map(l => l.length));
  const lastCol  = colLines.length - 1;
  const merged = [];
  for (let r = 0; r < maxRows; r++) {
    const parts = colLines.map((lines, c) => {
      const line = lines[r] || '';
      return c === lastCol ? line : padVisible(line, colWidth);
    });
    merged.push(parts.join(' '.repeat(CMD_COL_GAP)));
  }

  return ['', '{bright-white-fg}command list{/bright-white-fg}', '', ...merged].map(l => `{grey-fg}${l}{/grey-fg}`).join('\n');
}

function expandCmd() {
  cmdCollapsed = false;
  // The "type to collapse" hint now lives permanently in menuHeaderBox
  // (always shows all three panels' state — see buildMenuHeaderLine), so
  // this panel's own content is just the list, no duplicate header line.
  // Built fresh against the current width (see buildCmdColumns) instead of
  // a static string, so the column count matches whatever room is actually
  // available right now. screen.width, not contentW() — cmdBox is full
  // width now (user: "the chat should occupy the whole width of the
  // screen... so maybe the command list would fit all in one space").
  setCmdContent(buildCmdColumns(screen.width));
  screen.render();
}

function collapseCmd() {
  cmdCollapsed = true;
  // Hint text now lives in menuHeaderBox (see buildMenuHeaderLine) — this
  // panel itself takes 0 rows while collapsed, nothing to show here.
  setCmdContent('');
  screen.render();
}

function expandLang() {
  langCollapsed = false;
  // Same as expandCmd — hint lives in menuHeaderBox now, content is just the list.
  setLangContent(`{grey-fg}${buildLangList()}{/grey-fg}`);
  screen.realloc();
  screen.render();
}

function collapseLang() {
  langCollapsed = true;
  // Hint text now lives in menuHeaderBox (see buildMenuHeaderLine) — this
  // panel itself takes 0 rows while collapsed, nothing to show here.
  setLangContent('');
  screen.realloc();
  screen.render();
}

// :commands/:language now only ever actually render while chat is
// maximized (see reflow()'s langH/cmdH gating on chatMaximized) — they're
// part of the same takeover as the chat log now, not a standalone playback
// panel. So an interactive request to open one (typing :commands, :language,
// the bare "@" shortcut, or Cricket itself returning a showCommands action)
// has to open chat too, or cmdCollapsed/langCollapsed would flip to
// "expanded" with nothing on screen to show for it — the exact "I typed
// :commands and nothing happened" bug this replaces. Boot's own
// applyLanguage() → expandCmd() call is deliberately NOT routed through
// these — that runs before the user has done anything, and chat must stay
// hidden by default (chatMaximized starts false) even though the commands
// panel starts pre-expanded, ready to appear the first time chat actually
// opens.
// No longer force-opens chat as a side effect (user: "actually, never open
// the chat automatically. let the user open it by typing control c.") —
// these panels only actually RENDER while chat is maximized (see reflow()'s
// langH/cmdH gating), so typing :commands/:language (or ^Q/^A) while chat is
// closed now flips cmdCollapsed/langCollapsed to expanded with nothing
// visible for it until the user opens chat themselves — same tradeoff as
// every other message below, all deliberately reverted back to this.
function openCmdPanel()  { expandCmd(); }
function openLangPanel() { expandLang(); }

// ── CHAT MAXIMIZE (^C) ─────────────────────────────────────────────────────
// Chat is a pure overlay now, fully independent of appMode — see the
// SCREEN MODEL comment above CHAT_OVERLAY_BOXES. Toggling it never touches
// appMode/appMode-specific boxes itself; it just flips chatMaximized and
// lets render()'s SCREEN VISIBILITY block (which the render() call below
// runs) work out what that means for whichever screen happens to be
// active — CHAT_OVERLAY_BOXES show, PLAYBACK_CHANNEL_BOXES/playBox hide
// underneath it. reviewWaveformBox (the recorded-file playback zone in the
// training tab's review sub-view) is the one exception — it stays visible
// even under a maximized chat; the chat log docks below it instead of
// covering it. Nothing here ever touches the audio engine either way —
// hiding a box is purely visual, playback (or a live training bracket)
// keeps running exactly as it was.
let chatMaximized = false;

function toggleChatMaximize() {
  chatMaximized = !chatMaximized;
  render();
  // reviewStackBottom() (used by reflowLearn()'s review branch to size
  // reviewRegressionBox) branches on chatMaximized directly, so opening/
  // closing chat while on Train > Review has to re-run reflowLearn() right
  // here — otherwise regression would keep its pre-toggle height for a tick
  // and run underneath the chat overlay that just appeared, instead of
  // shrinking back to leave it room (see reviewStackBottom()'s own comment).
  if (appMode === 'learn') reflowLearn();
  renderFooter();
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

// Speaker color used to be label-only ("you:"/"cricket:" tinted, the actual
// sentence after it left at the log's own default fg) — and both labels
// happened to resolve to the exact same bright-white besides, so the whole
// log read as one undifferentiated wall of text with no way to tell, at a
// skim, who said what. Now the WHOLE line (label + body) is tinted per
// speaker, and the two speakers get genuinely different shades: user lines
// stay full-bright (SKIN.user_fg — your own words, full emphasis), Cricket's
// lines use SKIN.dim_fg, a medium grey a step down from bright-white but a
// step up from logSys's plain grey-fg housekeeping lines — so at a glance:
// brightest = you, mid-grey = Cricket, dim grey = system notices.
function logUser(text) {
  const c = skinTag(SKIN.user_fg);
  appendLog(`${ts()}{${c}-fg}you: ${text}{/${c}-fg}`);
}

function logCricket(text, opts) {
  const c = skinTag(SKIN.dim_fg);
  appendLog(`${ts()}{${c}-fg}${state.agentName.toLowerCase()}: ${text}{/${c}-fg}`, opts);
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
    sepBox.setContent(`{bright-white-fg}${state.agentName.toLowerCase()} - loading{/bright-white-fg} {bright-white-fg}${SPINNER_FRAMES[spinnerFrame]}{/bright-white-fg}`);
  }, 100);
}

function stopChatSpinner() {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  sepBox.setContent(languageSelected ? chatTopRule() : '{bright-white-fg}' + randCurse() + '{/bright-white-fg}');
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

  // Safety net only. Normal trimming now happens via maybeSummarizeMemory()
  // below (called after each reply) — it condenses the oldest chunk into a
  // running summary instead of throwing it away. This hard cap just protects
  // against unbounded growth if summarization itself is failing (Ollama
  // down, etc.) — it's roughly 2x the normal cap so summarization gets
  // several chances to catch up before this ever fires.
  if (chatHistory.length > CHAT_HISTORY_CAP * 2) {
    chatHistory.splice(1, chatHistory.length - CHAT_HISTORY_CAP);
    logSys('memory summarization fell behind — trimmed oldest turns to stay responsive');
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
        maybeSummarizeMemory();
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

// Identifies THIS running app.js process to ws_server.js across reconnects —
// sent as 'hello' the instant the socket opens (see ws.on('open') below).
// ws_server.js uses it to tell "the same TUI process reconnecting after its
// own watchdog-forced socket kill (below)" apart from "a genuinely new TUI
// launch" when deciding whether a just-closed connection should force Max
// back to a stopped state (see that file's socket.on('close') comment) — a
// real exit must never leave playback running in the background, but a
// same-process reconnect must never interrupt a live set just because the
// WS link hiccuped. No crypto dependency needed, just needs to be unique
// per process lifetime.
const RUN_ID = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);

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
    // Identify this process to ws_server.js first, before anything else can
    // race it — see RUN_ID's own comment above.
    ws.send(JSON.stringify({ type: 'hello', runId: RUN_ID }));
    // quiet — same reasoning as the WS error case just below: this can
    // fire within milliseconds of launch if Max is already running,
    // before the user has done anything at all — shouldn't force chat
    // open at boot any more than the error path should (user: "make sure
    // the tui open on playback screen. not chat.").
    logSys('connected to max', { quiet: true });
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
          // New track — the rolling descriptor window's buffered slices
          // belong to whatever was loaded before, so drop them rather than
          // showing a grid (and the momentum panel's in-progress bar — see
          // momSparkline()) that's half old-track, half new-track.
          DESC_STEMS.forEach(s => {
            descRollBuffers[s].length = 0;
            lastOutDesc[s] = null;
            lastMomPush[s] = 0;
            DIMS.forEach(d => { curBarBuffers[s][d] = []; });
          });
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
      } else if (msg.type === 'stopped') {
        // slicer.js confirms :stop actually froze the transport (its own
        // stop(), see outlet(1,"stopped")). state.running must flip false
        // here — nothing else in this dispatch table ever clears it back to
        // false, so without this branch the elapsed-time overlays below
        // (posMs's `state.running ? baseMs + (Date.now()-s.lastPosTime) : baseMs`,
        // and the progress-bar fill) kept counting real wall-clock time
        // straight through the pause even though the audio was genuinely
        // frozen — the display drifting ahead of what was actually playing.
        state.running   = false;
        playbackStopped = true;
        stoppedAtMs      = Date.now();
        // Momentum panel keeps whatever it had built up — momentumBarTick()
        // already stops advancing while !state.running, so pausing just
        // freezes the strip mid-fill instead of wiping it. It picks up
        // filling in the rest again once :start/resume flips running back on.
        scheduleRender();
      } else if (msg.type === 'resumed') {
        // slicer.js confirms :start took the resume branch — already-loaded
        // segments, karma~ re-armed from exactly its paused position (see
        // slicer.js's start()/stop(), which now also re-arms each stem's
        // auto-advance countdown with the real remaining time instead of
        // letting it count through the pause). Rebase every stem's
        // elapsed-time reference points forward by the real pause duration
        // so the position readout and progress-bar fill pick up right where
        // they were frozen instead of jumping ahead by however long
        // playback was stopped — same rebase reasoning as segRetime above,
        // just for a full pause/resume instead of a live tempo change.
        const pauseDurationMs = stoppedAtMs ? Math.max(0, Date.now() - stoppedAtMs) : 0;
        stoppedAtMs = null;
        Object.keys(state.stems).forEach(name => {
          const s = state.stems[name];
          if (s && s.lastPosTime) s.lastPosTime += pauseDurationMs;
          if (stemSliceStartTime[name]) stemSliceStartTime[name] += pauseDurationMs;
        });
        playbackStopped = false;
        state.running   = true;
        ensurePlaybackRender();
        scheduleRender();
      } else if (msg.type === 'downbeat') {
        // Real downbeat pulse from slicer.js's scheduleDownbeatPulse() (see
        // ws_server.js's Max.addHandler('downbeat', ...)) — phase-locked to
        // the actual music, not a client-side bpm guess.
        // Used to wipe descRollBuffers here on the theory that the
        // descriptor grid represents "this bar" — but that's NOT what
        // DESC_ROLL_PAIRS actually is (see its own comment: "the last
        // DESC_ROLL_PAIRS real TRANSITIONS per stem", not "this bar's
        // transitions"). A downbeat fires every single musical bar, real
        // transitions only fire on an actual segment change (e.g. every 32
        // bars with a long :setSegmentBars) — wiping on every downbeat
        // cleared the rolling window far more often than real transitions
        // could ever fill it, so the grid read as permanently empty
        // whenever a segment spanned more than ~1 bar (user: "the
        // transition edges visualization doesn't work anymore"). Removed —
        // descRollPush() (called from the real 'stem' transition handler
        // above) is the only thing that should ever touch this buffer now.
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
        // This IS the transition — push the {out, in} pair onto this stem's
        // rolling window (see descRollBuffers' own comment). `in` is the
        // segment starting now (state.stems[sn], just updated above). `out`
        // is ws_server.js's own prevSegment snapshot of whatever this stem
        // was just playing, riding along on this same message — null on a
        // stem's first transition, when there's nothing to have snapshotted.
        const outDesc = msg.prevSegment && msg.prevSegment.descriptors;
        descRollPush(sn, {
          out: outDesc ? {
            C: outDesc.C, S: outDesc.S, E: outDesc.E,
            F: outDesc.F, P: outDesc.P, H: outDesc.H, T: outDesc.T,
          } : null,
          in: {
            C: state.stems[sn].C, S: state.stems[sn].S, E: state.stems[sn].E,
            F: state.stems[sn].F, P: state.stems[sn].P, H: state.stems[sn].H,
            T: state.stems[sn].T,
          },
        });
        // Momentum panel's bar just ended — snapshot what it's ramping FROM
        // (same outDesc the grid's `out` uses) for the new bar's own ramp.
        // See momentumBarTick()'s own comment for how that ramp is used.
        // No longer wipes curBarBuffers here — the strip now scrolls
        // continuously across multiple bars (MOM_BARS_SPAN) instead of
        // resetting to empty on every single transition; momentumBarTick()
        // itself handles dropping old columns once the strip is full.
        lastOutDesc[sn] = outDesc ? {
          C: outDesc.C, S: outDesc.S, E: outDesc.E,
          F: outDesc.F, P: outDesc.P, H: outDesc.H, T: outDesc.T,
        } : null;
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
          // convention as state.lufsPeak.
          const pk = vuPeaks[msg.name];
          ['FL', 'FR', 'RL', 'RR'].forEach(ch => {
            const db = levelToDb(vuLevels[msg.name][ch]);
            if (pk[ch] === null || db > pk[ch]) pk[ch] = db;
          });
        }
      } else if (msg.type === 'lufs') {
        // fluid.loudness~ perceptual loudness (K-weighted dBFS), sampled at 10 Hz
        // short = short-term loudness → state.lufs (displayed as LUFSs in header).
        // msg.integrated was previously mirrored into state.dbfs to drive the
        // header's separate "TP" meter — removed along with that meter, since
        // the VU sidebar's own per-channel peak-hold already covers true peak.
        const s = parseFloat(msg.short);
        if (isFinite(s)) {
          state.lufs = s;
          if (state.lufsPeak === null || s > state.lufsPeak) state.lufsPeak = s;
        }
      } else if (msg.type === 'slice_ms' && state.stems[msg.name]) {
        state.stems[msg.name].timeMs = msg.timeMs || 0;
        // Reset elapsed-time anchor so the smooth-count starts from this slice position
        state.stems[msg.name].lastPosTime = Date.now();
      } else if (msg.type === 'param' && msg.key === 'entropy') {
        // :setEntropy — value always arrives; matchProb/stayProb/dirWeight
        // only come along when this is slicer.js's own feedback (Max.
        // addHandler('entropy', ...) in ws_server.js, fired from its
        // outlet 1 whenever the macro actually derives new values), not
        // the plain command passthrough, which only echoes value. Was
        // previously listening for msg.type === 'entropy', a type
        // ws_server.js never actually sends (it's always type:'param',
        // key:'entropy') — so this branch never fired and the entropy
        // meter's context line had nothing real to show.
        state.params.entropy = msg.value;
        if (typeof msg.matchProb === 'number') state.params.matchProb = msg.matchProb;
        if (typeof msg.stayProb  === 'number') state.params.stayProb  = msg.stayProb;
        if (typeof msg.dirWeight === 'number') state.params.dirWeight = msg.dirWeight;
      } else if (msg.type === 'matchProb') {
        state.params.matchProb = msg.value;
      } else if (msg.type === 'session') {
        // From ws_server.js's :sessionOpen/:sessionClose — drives the $ status icon.
        // mode + deck together pick the tipping protocol's precision level
        // (see the [LVL n/3] header chip); openedAt is a server timestamp,
        // shown in the tipping panel.
        state.session = {
          active: !!msg.active, sessionId: msg.sessionId || null,
          deck: msg.deck || null, mode: msg.mode || null,
          openedAt: msg.openedAt || null, djId: msg.djId || null,
        };
      } else if (msg.type === 'tipBackend') {
        // Tipping HTTP server reachability — see :tipOpen/pingBackend/
        // :tipClose in ws_server.js. msg.up is true/false/null.
        state.tipBackendUp = (msg.up === undefined) ? null : msg.up;
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
      } else if (msg.type === 'param' && msg.key === 'followStem') {
        // Authoritative follow-state confirmation from ws_server.js's own
        // :followStem parsing (broadcast to every connected client, not
        // just the one that typed the command) — this used to have no
        // handler at all, so state.followGraph only ever reflected this
        // TUI's own local optimistic echo above, never a change made by
        // another client or session. msg.dim is 'all' (reset-everything or
        // apply-to-every-dim), a single dim key, or absent for a legacy
        // whole-stem message; msg.follows is an array of {target,weight}
        // or null (self).
        if (state.followGraph[msg.stem]) {
          const dims = msg.dim === 'all' || !msg.dim ? DIMS : [msg.dim];
          if (!msg.follows) {
            dims.forEach(d => { state.followGraph[msg.stem][d] = {}; });
          } else {
            const map = {};
            msg.follows.forEach(p => { map[p.target] = p.weight; });
            dims.forEach(d => { state.followGraph[msg.stem][d] = map; });
          }
        }
      } else if (msg.type === 'param' &&
                 /^agentMode_(vocals|melody|bass|drums)$/.test(msg.key || '')) {
        // Confirmed candidate-source mode from slicer.js's setAgentMode() —
        // e.g. "agentMode_vocals" -> 'remix' | 'generate'. Same confirmed-
        // only pattern as sourceLock/weight*_stem below: no optimistic local
        // echo, this is the only place state.agentMode ever updates. Drives
        // the "rmx"/"gen" tag stacked directly under this stem's vcl/mel/
        // bas/drm label — see the "Row 1 lead-in" block near STEM_ROW_LABEL.
        const stemName = msg.key.slice('agentMode_'.length);
        if (state.agentMode.hasOwnProperty(stemName)) {
          state.agentMode[stemName] = msg.value;
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
      } else if (msg.type === 'bakeScored') {
        // A real :score/:scoreTransition just got appended to
        // training_log_vertical.jsonl / training_log_transition.jsonl by
        // ws_server.js (see its own 'bakeScored' broadcasts). Re-derive
        // whatever graph is currently selected so it updates on its own
        // (user: "I want it to be automatically drawn when bakes are
        // baked") — only worth an actual re-render if Review is on screen
        // right now; refreshSelectedBakePage() itself is cheap (a couple
        // hundred jsonl lines at most, times up to 7 dims) so it's fine to
        // always run.
        refreshSelectedBakePage();
        if (appMode === 'learn' && learnView === 'review') { renderTrainingView(); screen.render(); }
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
    // quiet — same reasoning as the 'open'/'error' handlers above.
    if (maxWasConnected) logSys('disconnected from max', { quiet: true });
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
      // quiet — same reasoning as :start/:stop (see the command handler's
      // own comment): Max not being connected yet is an expected,
      // recurring condition on launch, not something that should force
      // chat open (user: "make sure the tui open on playback screen. not
      // chat."). Still lands in logBox and the always-visible peekBox —
      // see appendLog()'s own comment on opts.quiet — so a genuine
      // connection problem is never actually hidden, it just doesn't
      // yank focus the moment it happens.
      logSys('⚠ WS error: ' + msg + suffix, { quiet: true });
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
    state.linkPeerOnline = false;
    logSys('⚠ LINK peer offline');
    scheduleRender();
  } else if (parts[0] === 'PEER_ONLINE') {
    state.linkPeerOnline = true;
    logSys('✓ LINK peer connected');
    scheduleRender();
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

function sendToMax(command, extra) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // extra — optional plain object merged into the outgoing envelope
    // alongside {type, text}. Used by the :score handler below to carry
    // bakeSessionId/bakeAttempt/bakeIntent without changing the command
    // string a user actually typed or ws_server's atom-parsing of `text`.
    ws.send(JSON.stringify({ type: 'command', text: command, ...(extra || {}) }));
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

  // Two-step confirmation gate (e.g. :resetMemory, :resetAll, ^L logout).
  // pendingConfirm must be cleared BEFORE the callback runs, not after:
  // confirmExitToLogin()'s callback is `() => handleInput(':logout')`, which
  // re-enters this very function recursively. If pendingConfirm were still
  // set at that point, the recursive call would see it as still-pending,
  // read ":logout" as the confirm/cancel answer (neither "y" nor "yes"),
  // and immediately log "cancelled" — which is exactly why typing Y to
  // confirm logout self-cancelled instead of going through.
  if (pendingConfirm) {
    const ans     = trimmed.toLowerCase().replace(/^[:@]/, '').trim();
    const confirm = pendingConfirm;
    pendingConfirm = null;
    if (ans === 'y' || ans === 'yes') {
      confirm();
    } else {
      logSys('cancelled');
    }
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
      logSys('…');
    }
    return;
  }

  // @ prefix: commands take priority, then language switching
  if (trimmed.startsWith('@') || trimmed.startsWith(':')) {
    const prefix = trimmed[0];
    const body   = trimmed.slice(1).trim();
    const parts  = body.split(/\s+/);
    const verb   = parts[0];

    // :resetPeaks — clear the LUFS peak-hold marker (see dbMeter()).
    // Purely client-side/TUI state, nothing to forward to Max.
    if (verb === 'resetPeaks') {
      state.lufsPeak = null;
      logSys('peak-hold cleared (LUFSs)');
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

      // :bake start [bars] <prompt> — bars is optional; when given as a bare
      // number right after "start", it sets bakeLoopBars for this bracket so
      // you don't need a separate :bakeloop call first. Omit it to keep
      // whatever :bakeloop last set (default 4).
      if (sub === 'start') {
        if (bakeSessionActive) {
          logSys('bake already running — :bake abort first');
          return;
        }
        const rest = parts.slice(2);
        if (rest.length && /^\d+(\.\d+)?$/.test(rest[0])) {
          bakeLoopBars = parseFloat(rest.shift());
        }
        const label = rest.join(' ');
        if (!label) { logSys('usage: :bake start [bars] <prompt>'); return; }

        // No ring-buffer snapshot here on purpose — this bracket never freezes
        // audio (see the BAKE LOOP STATE comment above). Playback just keeps
        // running live once Cricket's commands land.

        // 1. Send label to Cricket (first attempt translation)
        bakeSessionId   = 'bake_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        bakeIntent      = label;
        bakeCricketCmds = [];
        bakeUserCmds    = [];
        callCricket(label, cmd => {
          const p = cmd.trim().split(/\s+/);
          if ((p[0] === 'setGlobalBPM' || p[0] === 'setFallbackBPM') && parseFloat(p[1]) > 0) {
            state.bpm = parseFloat(p[1]); render();
          }
          bakeCricketCmds.push(cmd.trim());
          upsertComportment(cmd.trim());   // seeds the editable recipe — see :bake show/edit/remove
          sendToMax(expandSelectRange(cmd));
        });

        // 2. Start the checkpoint timer — marks a new bakeAttempt every N bars,
        //    no audio reset (see startBakeLoop)
        startBakeLoop(label);
        return;
      }

      // :bake show — review the current comportment before deciding whether
      // to correct further, :score it, or :bake end it. "Editing" a
      // comportment just means typing a new command — it applies live
      // immediately, same as always — but there was no way to see the
      // resolved result of everything typed so far, only the raw log. This
      // is that missing review step.
      if (sub === 'show') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        if (bakeSeqSteps) {
          logSys('sequence "' + bakeSessionLabel + '" — assembled timeline so far:');
          bakeSeqLog.forEach(l => logSys('  ' + l));
          if (bakeUserCmds.length) {
            logSys('  live corrections (not yet tied to one state):');
            resolveComportment(bakeUserCmds).forEach(c => logSys('    ' + c));
          }
        } else {
          logSys('bracket "' + bakeSessionLabel + '" — current comportment ('
                 + bakeComportment.length + ' commands, :bake edit <n> <cmd> / :bake remove <n> to change):');
          bakeComportment.forEach((c, i) => logSys('  ' + String(i + 1).padStart(2) + '  ' + c));
          logSys('cricket\'s original attempt: ' + (bakeFirstCmds || bakeCricketCmds).length
                 + ' cmds  ·  corrections since: ' + bakeUserCmds.length);
        }
        return;
      }

      // :bake edit <n> <command...> — replace the nth line from :bake show
      // with a new command, applied live immediately. This is the actual
      // "modify the commands" step: type the corrected line back in by
      // number instead of having to remember + retype Cricket's exact
      // original verb/target to override it.
      if (sub === 'edit') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        if (bakeSeqSteps) { logSys('bake edit: not supported inside a sequence bracket — retrain the individual state instead (:bake start ... :bake end <name>)'); return; }
        const n = parseInt(parts[2]);
        const newCmd = parts.slice(3).join(' ');
        if (isNaN(n) || n < 1 || n > bakeComportment.length || !newCmd) {
          logSys('usage: :bake edit <n> <command...>  (n from :bake show, 1-' + bakeComportment.length + ')');
          return;
        }
        const old = bakeComportment[n - 1];
        bakeComportment[n - 1] = newCmd;
        bakeUserCmds.push(newCmd);
        sendToMax(newCmd);
        logSys('* edited ' + n + ':  ' + old + '  →  ' + newCmd);
        return;
      }

      // :bake remove <n> — drop the nth line entirely. Note: this removes it
      // from the RECIPE (what gets saved/scored going forward) — it does not
      // itself revert the engine's current live value, since most verbs have
      // no generic "unset" opcode to call. Send a replacement value if you
      // need the live behavior to change right now too.
      if (sub === 'remove') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        if (bakeSeqSteps) { logSys('bake remove: not supported inside a sequence bracket'); return; }
        const n = parseInt(parts[2]);
        if (isNaN(n) || n < 1 || n > bakeComportment.length) {
          logSys('usage: :bake remove <n>  (n from :bake show, 1-' + bakeComportment.length + ')');
          return;
        }
        const [removed] = bakeComportment.splice(n - 1, 1);
        logSys('x removed ' + n + ':  ' + removed + '  (live engine unchanged — send a new value if needed)');
        return;
      }

      // :bake sequence name:bars [name:bars ...] — assemble PRE-TRAINED states
      // into a timed, looping handoff instead of one static comportment.
      // Each name must already exist in bake_states.json (train + save it
      // first with a normal :bake start/.../:bake end <name>).
      if (sub === 'sequence') {
        if (bakeSessionActive) {
          logSys('bake already running — :bake abort first');
          return;
        }
        const specs = parts.slice(2);
        if (!specs.length) { logSys('usage: :bake sequence name:bars [name:bars ...]'); return; }

        const steps = [];
        const bad   = [];
        for (const spec of specs) {
          const m = spec.match(/^([A-Za-z0-9_-]+):(\d+(?:\.\d+)?)$/);
          if (!m) { bad.push(spec); continue; }
          steps.push({ name: m[1], bars: parseFloat(m[2]) });
        }
        if (bad.length) {
          logSys('usage: :bake sequence name:bars [name:bars ...] — bad step(s): ' + bad.join(', '));
          return;
        }

        const states  = loadBakeStates();
        const missing = steps.map(s => s.name).filter(n => !states[n]);
        if (missing.length) {
          const known = Object.keys(states);
          logSys('bake sequence: unknown state(s): ' + missing.join(', ')
                 + (known.length ? '  — known: ' + known.join(', ') : '  — nothing saved yet, train one with :bake start then :bake end <name>'));
          return;
        }

        startBakeSequence(steps, steps.map(s => s.name + ':' + s.bars).join(' '));
        return;
      }

      // :bake end [name] — queue close at next checkpoint/handoff boundary.
      // Always saves the final assembled commands as a reusable state (single
      // mode: the corrected comportment; sequence mode: the whole assembled
      // timeline) — see saveBakeState / stopBakeLoop. The name defaults to
      // the bracket's own prompt (naming isn't required for the common case:
      // train Cricket, done), but an explicit name overrides it — e.g. after
      // ":bake start move the shit up", ":bake end" alone saves it AS "move
      // the shit up", while ":bake end rise" saves it as "rise" instead. A
      // short name is really only necessary later, for :bake sequence
      // (name:bars can't contain spaces) — see its usage note.
      if (sub === 'end') {
        if (!bakeSessionActive) { logSys('no bake session running'); return; }
        bakeEndSaveName = parts.slice(2).join(' ') || null;
        bakeEndQueued   = true;
        logSys('bake: close queued — will store at next checkpoint boundary'
               + '  (saving as state "' + (bakeEndSaveName || bakeSessionLabel) + '")');
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
      logSys('✓ baked — intent: "' + bakeIntent + '"  cricket: '
             + bakeCricketCmds.length + ' cmds  corrections: ' + bakeUserCmds.length);
      return;
    }

    // :bakeState list|show|apply|drop — inspect/use named states saved via
    // :bake end <name>. These are what :bake sequence assembles.
    if (verb === 'bakeState') {
      const sub  = parts[1];
      const name = parts.slice(2).join(' ');   // joined — default state names are the
                                                // full prompt now, so they can contain spaces
      const states = loadBakeStates();

      if (sub === 'list') {
        const names = Object.keys(states);
        if (!names.length) { logSys('bakeState: none saved yet — :bake start ... then :bake end <name>'); return; }
        logSys('saved states: ' + names.map(n => n + ' (' + states[n].commands.length + ' cmds)').join('  ·  '));
        return;
      }

      if (sub === 'show') {
        if (!name || !states[name]) { logSys('usage: :bakeState show <name>' + (!name ? '' : ' — unknown "' + name + '"')); return; }
        logSys('state "' + name + '"  saved ' + states[name].savedAt + ':');
        states[name].commands.forEach(c => logSys('  ' + c));
        return;
      }

      if (sub === 'apply') {
        if (!name) { logSys('usage: :bakeState apply <name>'); return; }
        const applied = applyBakeState(name);
        if (applied) logSys('→ applied state "' + name + '"  (' + applied.length + ' commands)');
        return;
      }

      if (sub === 'drop') {
        if (!name || !states[name]) { logSys('usage: :bakeState drop <name>' + (!name ? '' : ' — unknown "' + name + '"')); return; }
        delete states[name];
        try { fs.writeFileSync(BAKE_STATES_PATH, JSON.stringify(states, null, 2), 'utf8'); logSys('dropped state "' + name + '"'); }
        catch (e) { logSys('bakeState: failed to drop "' + name + '" — ' + e.message); }
        return;
      }

      logSys('usage: :bakeState list | show <name> | apply <name> | drop <name>');
      return;
    }

    // :score <-1..1> [overallSection] — handled here, ahead of the generic
    // COMMANDS.has(verb) block further down, for two reasons:
    //   1. That block unconditionally does bakeUserCmds.push(expanded) for
    //      every command it forwards, treating it as a "user correction" fed
    //      to Cricket's fine-tune log at :bake end. A rating isn't an engine
    //      parameter Cricket should learn to emit, so :score needs to bypass
    //      that push entirely — previously it didn't, and every :score typed
    //      during a bracket silently leaked into cricket_finetune.jsonl.
    //   2. When a :bake bracket is open, this attaches bakeSessionId + which
    //      attempt is currently playing (bakeAttempt hasn't incremented yet
    //      for the in-progress loop, hence +1) so ws_server.js can tag the
    //      training_log_vertical.jsonl entry — see sendToMax's `extra` param
    //      and ws_server.js's :score handler. Outside a bracket this is a
    //      plain passthrough, identical to before.
    if (verb === 'score') {
      const extra = bakeSessionActive
        ? { bakeSessionId, bakeAttempt: bakeAttempt + 1, bakeIntent: bakeSessionLabel }
        : null;
      if (bakeSessionActive) {
        const v = parseFloat(parts[1]);
        if (!isNaN(v)) { bakeScoreCount++; bakeLastScore = { type: 'score', value: v }; }
      }
      sendToMax(body, extra);
      logSys('→ ' + body + (extra ? '  {grey-fg}[bake ' + bakeSessionId + ' · attempt '
             + extra.bakeAttempt + ']{/grey-fg}' : ''));
      return;
    }

    // :scoreTransition <-1..1> [stem] — same treatment as :score immediately
    // above, and for the same two reasons (doesn't belong in bakeUserCmds,
    // gets tagged to the open bracket). This is the primary signal for
    // :bake sequence handoffs — see startBakeSequence's checkpoint log line.
    if (verb === 'scoreTransition') {
      const extra = bakeSessionActive
        ? { bakeSessionId, bakeAttempt: bakeAttempt + 1, bakeIntent: bakeSessionLabel }
        : null;
      if (bakeSessionActive) {
        const v = parseFloat(parts[1]);
        if (!isNaN(v)) { bakeScoreCount++; bakeLastScore = { type: 'transition', value: v }; }
      }
      sendToMax(body, extra);
      logSys('→ ' + body + (extra ? '  {grey-fg}[bake ' + bakeSessionId + ' · attempt '
             + extra.bakeAttempt + ']{/grey-fg}' : ''));
      return;
    }

    // :tag <label> [stem] — same treatment as :score/:scoreTransition above:
    // a structural section label isn't an engine parameter Cricket should
    // learn to emit, so it bypasses bakeUserCmds/bakeComportment entirely.
    // Tracked in bakeTag purely for the training panel's own "tag:" line, so
    // a bracket also records what section of the song it was trained against.
    if (verb === 'tag') {
      if (bakeSessionActive) bakeTag = parts[1] || null;
      sendToMax(body);
      logSys('→ ' + body);
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
      // :followStem <stem> self                       — reset every dimension
      // :followStem <stem> <dim|all> self               — reset just those dimension(s)
      // :followStem <stem> <dim|all> <target> <w> ...   — set that dimension's blend
      // Local optimistic echo only — the server's broadcast (msg.type==='param',
      // key==='followStem') is what actually confirms this, see below.
      const from   = parts[1];
      const second = parts[2];
      if (state.followGraph[from]) {
        if (second === undefined || second === 'self') {
          DIMS.forEach(d => { state.followGraph[from][d] = {}; });
        } else {
          const dims = second === 'all' ? DIMS : (DIMS.includes(second) ? [second] : null);
          if (dims) {
            if (parts[3] === 'self') {
              dims.forEach(d => { state.followGraph[from][d] = {}; });
            } else {
              const pairs = [];
              let totalW = 0;
              for (let i = 3; i + 1 < parts.length; i += 2) {
                const target = parts[i], w = parseFloat(parts[i + 1]);
                if (state.stems[target] && !isNaN(w) && w >= 0) { pairs.push([target, w]); totalW += w; }
              }
              if (pairs.length && totalW > 0) {
                const map = {};
                pairs.forEach(([target, w]) => { map[target] = w / totalW; });
                dims.forEach(d => { state.followGraph[from][d] = map; });
              }
            }
          }
        }
      }
    }

    if (verb === 'tip') {
      const STEMS = TIP_STEMS;
      const N = STEMS.length;

      // ── Curator share ─────────────────────────────────────────────────────
      // curatorShareOverride (see :setSplit below) takes over once set;
      // until then this is CURATOR_FLOOR's flat default, same behavior as
      // before — see currentCuratorShare() above. Full eq (0.40 + 0.60 ×
      // creative_factor) still isn't wired from Max.
      const curatorShare = currentCuratorShare();
      const artistPool   = 1 - curatorShare;  // 0.60

      // ── Artist split (80/20 within artist pool) ───────────────────────────
      const base = 0.8 / N;

      // Follow-graph influence per stem — see computeStemInfluence()'s own
      // comment; shared with renderTipInfo() instead of duplicating this
      // math a second time.
      const { influence, totalInfluence } = computeStemInfluence();

      // :tip <username> <amount> — a simulated INCOMING tip (someone actually
      // tipped $X), as opposed to bare :tip below (a dry-run showing the
      // current split percentages with no dollar amount attached). Updates
      // lastTip so the tipping panel shows who tipped, how much, and the
      // resulting split — same dollar math as the dry-run, just scaled by
      // amount instead of printed as bare percentages.
      const tipUser = parts[1];
      const tipAmt  = parseFloat(parts[2]);
      if (tipUser && !isNaN(tipAmt) && tipAmt > 0) {
        const stemAmts = {};
        STEMS.forEach(s => {
          const share      = totalInfluence > 0 ? influence[s] / totalInfluence : 0;
          const stemOfPool = base + 0.2 * share;
          stemAmts[s] = artistPool * stemOfPool * tipAmt;
        });
        lastTip = {
          username: tipUser, amount: tipAmt,
          curator: curatorShare * tipAmt,
          stems: stemAmts,
          ts: Date.now(),
          txnId: genTxnId(),
        };
        logSys('✓ tip: ' + tipUser + ' → $' + tipAmt.toFixed(2)
          + '  {grey-fg}(curator $' + lastTip.curator.toFixed(2) + ' · ' + lastTip.txnId + '){/grey-fg}');
        render();
        return;
      }

      const lines = ['── tip simulation ──────────────────'];
      lines.push(`  curator   ${(curatorShare * 100).toFixed(1)}%  (${curatorShareOverride !== null ? 'override — :setSplit clear to reset' : 'floor — creative factors not yet live'})`);
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

      // Show active follow graph, per dimension
      const edges = [];
      STEMS.forEach(from => {
        DIMS.forEach(dim => {
          Object.entries((state.followGraph[from] && state.followGraph[from][dim]) || {}).forEach(([to, w]) => {
            edges.push(`${from}.${dim} → ${to} ${(w * 100).toFixed(0)}%`);
          });
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

    // :setSplit <dj 0-100> — override curatorShare (the ∫/DJ side of the
    // split) directly, live — user: "a tab for tips could show the actual
    // split equation, and allow user to modify it." Clamped to
    // [CURATOR_FLOOR, 1] so a DJ can only ever raise their own cut above
    // the protocol floor, never drop below the guaranteed minimum. Bare
    // ":setSplit" or ":setSplit clear" resets back to CURATOR_FLOOR's flat
    // default. Feeds both :tip's actual payout math and the header
    // equation bar (renderTipInfo) — see currentCuratorShare().
    if (verb === 'setSplit') {
      const arg = parts[1];
      if (!arg || arg === 'clear') {
        curatorShareOverride = null;
        logSys('✓ split reset to floor (' + Math.round(CURATOR_FLOOR * 100) + '% dj / '
          + Math.round((1 - CURATOR_FLOOR) * 100) + '% artist)');
        scheduleRender();
        return;
      }
      const pct = parseFloat(arg);
      if (isNaN(pct)) {
        logSys('usage: :setSplit <dj 0-100> | :setSplit clear');
        return;
      }
      const frac = Math.max(CURATOR_FLOOR, Math.min(1, pct / 100));
      curatorShareOverride = frac;
      logSys('✓ split set: ' + Math.round(frac * 100) + '% dj / ' + Math.round((1 - frac) * 100) + '% artist'
        + (Math.abs(frac - pct / 100) > 0.001 ? '  {grey-fg}(clamped to floor){/grey-fg}' : ''));
      scheduleRender();
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

    // :setFitShape <dim> <linear|quadratic|cubic> — TUI/Node-only, same
    // shape as :trainBias above: writes fit_shapes.json into DATA_DIR and
    // returns, never reaches Max/slicer.js directly. Doesn't retrain the
    // REAL model by itself — train_bias.py reads this file at the START of
    // its next run (before building any feature matrix), so run :trainBias
    // afterward to actually refit with the new shape. 'linear' removes the
    // dim's entry rather than writing it explicitly, since linear is the
    // default for any dim with no entry at all — keeps the file only
    // listing the dims someone deliberately opted up. 'cubic' is a strict
    // extension of 'quadratic' (see train_bias.py's load_fit_shapes()
    // docstring), not a separate third option someone has to pick between —
    // the PREVIEW graph, though, DOES update immediately (refreshSelectedBakePage()
    // below), even though the real weights don't — that's the whole point:
    // look at the curve here before committing to a shape via :trainBias.
    if (verb === 'setFitShape') {
      const VALID_FIT_DIMS = ['C','S','E','F','P','H','T','TnC','TnE','TnF','TnP','TnH','TnT'];
      const dim   = parts[1];
      const shape = (parts[2] || '').toLowerCase();
      if (!VALID_FIT_DIMS.includes(dim)) {
        logSys('usage: :setFitShape <dim> <linear|quadratic|cubic> — dim must be one of ' + VALID_FIT_DIMS.join(', '));
        return;
      }
      if (shape !== 'linear' && shape !== 'quadratic' && shape !== 'cubic') {
        logSys('usage: :setFitShape <dim> <linear|quadratic|cubic>');
        return;
      }
      const shapesPath = path.join(DATA_DIR, 'fit_shapes.json');
      let shapes = {};
      try { shapes = JSON.parse(fs.readFileSync(shapesPath, 'utf8')); } catch (e) {}
      if (shape === 'linear') {
        delete shapes[dim];
      } else {
        shapes[dim] = shape;
      }
      fs.writeFileSync(shapesPath, JSON.stringify(shapes, null, 2));
      logSys('✓ fitShape[' + dim + '] = ' + shape + ' — preview graph updated; run :trainBias to refit the real weights with this shape');
      // Re-derive the preview right away if this dim is on the page
      // currently showing, so flipping the shape and looking at Train >
      // Review in the same breath shows the new curve without needing a
      // manual :showBakeGraph/:graphNext nudge first. "Currently showing"
      // now means "part of the selected PAGE", not "the one selected
      // graph" — a page holds 6-7 dims at once, and the one that just
      // changed shape might be any of them.
      const curPage = BAKE_GRAPH_PAGES[selectedPageIdx - 1];
      if (curPage && curPage.dims.includes(dim)) refreshSelectedBakePage();
      scheduleRender();
      return;
    }

    // :listGraphs — prints the 8-page menu (user originally: "I will need a
    // graph menu to select which graphs I want to view, since there are
    // 50ish possible graph (per weights)"; later grouped down to 8 pages —
    // see BAKE_GRAPH_PAGES). Numbers match BAKE_GRAPH_PAGES' own order 1:1,
    // so ":showBakeGraph 3" below always means the same page this prints as
    // "3." — this file's whole interaction model is typed commands read off
    // the scrolling log (see reviewListBox's own comment on why nothing
    // here is a focused/arrow-navigated widget), so a numbered log listing
    // IS this app's menu, same as :help's own list.
    if (verb === 'listGraphs' || verb === 'graphs') {
      logSys('bake graph pages — :showBakeGraph <n>, or :showBakeGraph <dim> <transition|vertical> [feature] — a live picker also sits above the graphs themselves in Train > Review:');
      BAKE_GRAPH_PAGES.forEach((p, i) => {
        logSys('  ' + (i + 1) + '. ' + KIND_LABEL[p.kind] + ' (' + p.dims.join(', ') + ') ' + p.model + ' ' + p.feature
          + (i + 1 === selectedPageIdx ? '  ← current' : ''));
      });
      return;
    }

    // :fakeBakes <n> — appends n synthetic vertical + n synthetic transition
    // bake rows to the real training_log_*.jsonl files, purely so
    // :showBakeGraph has something to draw (user: "can you create fake
    // bakes in the TUI? just for the sake of seeing the graph"). Matches
    // ws_server.js's real :score/:scoreTransition row shape exactly (see
    // its 'score'/'scoreTransition' handlers) so extractBakePoints() — and
    // train_bias.py itself, if ever pointed at this data — read it no
    // differently than a real bake. Every row carries synthetic: true (an
    // extra field both readers already ignore) so these rows stay
    // identifiable/removable later; nothing here is meant to train a real
    // model, just to populate a graph. `vertical`'s E and `transition`'s
    // tension_T delta are deliberately biased to correlate with rating —
    // everything else is plain noise — so at least a couple of the 52
    // graphs show a real slope instead of all 52 looking like static.
    if (verb === 'fakeBakes') {
      const n = parseInt(parts[1], 10);
      if (!n || n < 1) {
        logSys('usage: :fakeBakes <n> — appends n synthetic vertical + n synthetic transition bake rows (tagged synthetic:true), for :showBakeGraph demo purposes only');
        return;
      }
      const stemKeys = ['vocals', 'melody', 'bass', 'drums'];
      const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
      function randDesc() {
        const d = {};
        ['C', 'S', 'E', 'F', 'P', 'H', 'T'].forEach(k => { d[k] = Math.random(); });
        ['C', 'E', 'F', 'P', 'H', 'T'].forEach(k => { d['tension_' + k] = Math.random(); });
        return d;
      }
      let vertLines = '', transLines = '';
      for (let i = 0; i < n; i++) {
        const vStems = {};
        let sumE = 0;
        stemKeys.forEach(s => {
          const desc = randDesc();
          vStems[s] = {
            sourceTrack: 'FAKE_' + s, slot: 0, descriptors: desc,
            segmentBars: 4, pan: 0, width: 0.5, section: null, sectionIntensity: null,
          };
          sumE += desc.E;
        });
        const meanE   = sumE / stemKeys.length;
        const vRating = clamp(2 * meanE - 1 + (Math.random() * 0.4 - 0.2), -1, 1);
        vertLines += JSON.stringify({
          timestamp: new Date().toISOString(), type: 'vertical', rating: vRating,
          overallSection: null, bakeSessionId: null, bakeAttempt: null, bakeIntent: null,
          track: 'FAKE_TRACK', bpm: 120, globalBPM: 120, key: 'Am',
          stems: vStems, master: { joy: 0, boothGain: 0, recGain: 0 }, synthetic: true,
        }) + '\n';

        const stem     = stemKeys[Math.floor(Math.random() * stemKeys.length)];
        const fromDesc = randDesc(), toDesc = randDesc();
        const dTnT     = toDesc.tension_T - fromDesc.tension_T;
        const tRating  = clamp(-1.5 * dTnT + (Math.random() * 0.4 - 0.2), -1, 1);
        transLines += JSON.stringify({
          timestamp: new Date().toISOString(), type: 'horizontal_transition', rating: tRating,
          bakeSessionId: null, bakeAttempt: null, bakeIntent: null,
          stems: { [stem]: {
            from: { sourceTrack: 'FAKE_' + stem, id: 'fake_from_' + i, descriptors: fromDesc, section: null },
            to:   { sourceTrack: 'FAKE_' + stem, id: 'fake_to_' + i,   descriptors: toDesc,   section: null },
          } },
          synthetic: true,
        }) + '\n';
      }
      fs.appendFileSync(path.join(DATA_DIR, 'training_log_vertical.jsonl'), vertLines);
      fs.appendFileSync(path.join(DATA_DIR, 'training_log_transition.jsonl'), transLines);
      // These rows are scoring data only (training_log_vertical.jsonl /
      // training_log_transition.jsonl — what train_bias.py fits on, and now
      // what :showBakeGraph reads) — a completely different file from
      // training_log.jsonl, which is what the Review sub-view's
      // reviewEntries list actually browses (real :bake bracket sessions —
      // command sequences, corrections, audioFile). So fake bakes will
      // never show up in Review's own session list, by design — that's not
      // a bug, they're not bake sessions. The GRAPH itself, though, always
      // lives in Review now (user: "it should only appear under review, not
      // in the training tab") — refreshSelectedBakePage() re-derives
      // whatever's currently selected from the data that just landed.
      refreshSelectedBakePage();
      logSys('✓ appended ' + n + ' synthetic vertical + ' + n + ' synthetic transition bake rows (synthetic:true) — see Train > Review for the graphs; :listGraphs for the other 7 pages');
      switchLearnView('review');
      return;
    }

    // :graphNext / :graphPrev — cycle selectedPageIdx by one and re-derive
    // lastBakePage, the actual mechanism behind the picker rendered above
    // the graphs in Train > Review (bakeGraphMenuLines()) — same relative-
    // move pattern as reviewMove()/:train next for browsing reviewEntries.
    // Shares its actual logic with the ^P/^N key bindings below (see
    // stepGraph()) so the typed command and the keys can never drift apart.
    if (verb === 'graphNext' || verb === 'graphPrev') {
      stepGraph(verb === 'graphNext' ? 1 : -1);
      return;
    }

    // :showBakeGraph <n> | <dim> [transition|vertical] [feature] — diagnostic
    // scatter plots, TUI/Node-only (reads the training log directly, never
    // reaches Max). Fits each dim in isolation, not the real 13-27 dim
    // model — this is for deciding whether a dim LOOKS linear or curved
    // before touching :setFitShape, not a substitute for train_bias.py's
    // actual fit. `<n>` indexes BAKE_GRAPH_PAGES/​:listGraphs directly (the
    // "graph menu" — see its own comment above); the named form still
    // resolves a single dim down to whichever PAGE it lives on (see
    // pageIndexForDim()) — handy for jumping straight to it without knowing
    // the page number offhand. Just moves selectedPageIdx and calls
    // refreshSelectedBakePage() — same one source of truth
    // :graphNext/:graphPrev and :fakeBakes use, so whichever page you last
    // picked here is also what auto-refreshes the next time a real bake
    // gets logged (see the WS 'bakeScored' handler).
    if (verb === 'showBakeGraph') {
      const VALID_FIT_DIMS = ['C','S','E','F','P','H','T','TnC','TnE','TnF','TnP','TnH','TnT'];
      let idx = parseInt(parts[1], 10);
      if (!(parts[1] !== undefined && String(idx) === parts[1] && idx >= 1 && idx <= BAKE_GRAPH_PAGES.length)) {
        const dim   = parts[1];
        const model = (parts[2] || 'vertical').toLowerCase();
        if (!VALID_FIT_DIMS.includes(dim)) {
          logSys('usage: :showBakeGraph <n> (1-' + BAKE_GRAPH_PAGES.length + ', see :listGraphs) | <dim> [transition|vertical] [feature] — dim must be one of ' + VALID_FIT_DIMS.join(', '));
          return;
        }
        if (model !== 'vertical' && model !== 'transition') {
          logSys('usage: :showBakeGraph <dim> [transition|vertical] [feature]');
          return;
        }
        const validFeatures = model === 'transition' ? ['delta', 'absDelta'] : ['mean', 'std'];
        const rawFeature = (parts[3] || validFeatures[0]).toLowerCase();
        const feature = validFeatures.find(f => f.toLowerCase() === rawFeature);
        if (!feature) {
          logSys('usage: :showBakeGraph ' + dim + ' ' + model + ' <' + validFeatures.join('|') + '>');
          return;
        }
        idx = pageIndexForDim(dim, model, feature);
      }
      selectedPageIdx = idx;
      refreshSelectedBakePage();
      const p = BAKE_GRAPH_PAGES[selectedPageIdx - 1];
      const withData = lastBakePage.graphs.filter(g => !g.empty).length;
      logSys('✓ bake graph page — ' + selectedPageIdx + '. ' + KIND_LABEL[p.kind] + ' (' + p.dims.join(', ') + ') ' + p.model + ' ' + p.feature
        + ' — ' + withData + '/' + lastBakePage.graphs.length + ' dim(s) with usable bakes'
        + (withData === 0 ? ' (try :fakeBakes 12)' : '')
        + (appMode === 'learn' && learnView === 'review' ? ' (shown under the recording in Train > Review)' : ' — press ^T then :train review to see it'));
      if (appMode === 'learn' && learnView === 'review') {
        renderTrainingView();
        screen.render();
      }
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
      // :link select <1-4> — which deck slot the network zone's dots mark
      // as the LINK fire target (user: "if selected and link is fired, the
      // infos goes to that deck"). TUI-side only, not forwarded to Max —
      // nothing there needs to know which dot is lit; per-deck routing
      // itself still runs through the same single :link fire as before
      // (see the 'fire' branch below) since the underlying protocol has no
      // way to address one specific deck out of several yet. "clear"/
      // "none" deselects.
      else if (onOff === 'select') {
        const arg = (parts[2] || '').toLowerCase();
        if (arg === 'clear' || arg === 'none') {
          linkSelectedSlot = null;
          logSys('✓ LINK selection cleared');
        } else {
          const n = parseInt(arg);
          if (n >= 1 && n <= LINK_SLOT_COUNT) {
            linkSelectedSlot = n - 1;
            logSys('✓ LINK target: deck ' + n
              + (linkSlotConnected(n - 1) ? '' : '  {grey-fg}(not connected yet){/grey-fg}'));
          } else {
            logSys('usage: :link select <1-' + LINK_SLOT_COUNT + '> | :link select clear');
          }
        }
        scheduleRender();
      }
      // 'fire' still just forwards to Max like every other sub-verb below —
      // this branch only adds the log line naming which deck was targeted,
      // so a selection actually means something visible even before real
      // per-deck wire routing exists.
      else if (onOff === 'fire') {
        if (linkSelectedSlot !== null) logSys('→ LINK fire (targeting deck ' + (linkSelectedSlot + 1) + ')');
        sendToMax('link fire');
      }
      else if (onOff)           { sendToMax('link ' + parts.slice(1).join(' ')); }
      else logSys('usage: :link on|off|status|mode <m>|arm|fire|abort|token <hex>|select <1-4>');
      return;
    }
    if (verb === 'linkscope') {
      linkSend('MISSILE_SCOPE ' + parts.slice(1).join(' '));
      logSys('LINK scope: ' + parts.slice(1).join(' '));
      return;
    }

    // :network <ssid|ip> [password] — join a wifi network (user: "create a
    // command to enter in a wifi. :network [name or ip adress] and
    // [password]"). Two platform branches now — this box's actual OS at
    // deploy time isn't pinned down (most likely a dedicated Linux venue
    // box, but tested/run from a Mac in the meantime — see
    // classifyIface()/macHardwarePortMap's own comments, which already
    // made this same macOS-vs-Linux split for READING connection info):
    //   darwin  — networksetup -setairportnetwork <device> <ssid> [pass],
    //             using whichever device macHardwarePortMap identified as
    //             Wi-Fi (built once at startup — see its own comment).
    //             ENOENT here (nmcli not installed) is exactly the bug
    //             report that prompted this split.
    //   other   — nmcli (NetworkManager), as before.
    // execFile, not exec, in both branches — the password goes straight
    // into an argv array rather than a shell string, so a password
    // containing $, ", `, etc. can't break out into a shell injection.
    // Note: the password still gets typed into inputBox in the clear and
    // lands in cmdHistory (see setInputValue/cmdHistory above) — there's
    // no masked-input mode in this TUI yet, so anyone with scrollback
    // access can see it. Worth knowing before typing it on a shared screen.
    if (verb === 'network') {
      const ssid = parts[1];
      const password = parts[2];
      if (!ssid) { logSys('usage: :network <ssid> [password]'); return; }
      logSys('→ connecting to wifi "' + ssid + '"...');
      // Spinner (user: "add a little spinner for when connecting to the
      // wifi") — reuses the same sepBox-based spinner the genre/FluCoMa
      // analysis and Cricket's own "thinking" indicator already use (see
      // startSpinner()/stopSpinner()); chat is guaranteed visible for it
      // to show up in since appendLog() (right above, called by the
      // logSys() line just above this) already auto-opened chat the
      // moment there was something to report. Every exit path below stops
      // it — success, failure, or the final "still not showing connected"
      // verification outcome.
      // wifiConnecting drives the header's OWN spinner frame (networkAddrText())
      // — the always-visible one, row 0, next to the EBYS version badge.
      // startSpinner()/stopSpinner() drive a second one inside the chat
      // log itself; both get set/cleared together everywhere below.
      wifiConnecting = true;
      startSpinner('connecting to wifi "' + ssid + '"');
      const stopAll = () => { wifiConnecting = false; stopSpinner(); };
      if (process.platform === 'darwin') {
        const device = Object.keys(macHardwarePortMap).find(d => macHardwarePortMap[d] === 'wifi');
        if (!device) {
          stopAll();
          logSys('✗ wifi connect failed: no Wi-Fi hardware port found via networksetup -listallhardwareports'
            + '  {grey-fg}(macHardwarePortMap empty/still loading — try again in a second, or this Mac genuinely has no Wi-Fi adapter){/grey-fg}');
          return;
        }
        const args = ['-setairportnetwork', device, ssid];
        if (password) args.push(password);
        execFile('networksetup', args, { timeout: 20000 }, (err, stdout, stderr) => {
          if (err) {
            stopAll();
            const reason = ((stderr || err.message) + '').trim().split('\n')[0];
            logSys('✗ wifi connect failed: ' + reason);
            return;
          }
          // networksetup is notorious for returning exit code 0 even when
          // the join actually failed (wrong password, SSID not found,
          // etc.) — the REAL reason, when there is one, usually shows up
          // as plain text on stdout instead ("Could not find network...",
          // "Invalid password...") even though err is null. Surfacing it
          // directly instead of silently discarding it, since it's the
          // most likely place the actual cause of "still not working"
          // lives — Location Services showing no Terminal entry at all
          // suggests that's NOT what's blocking this particular Mac, so
          // the real reason is more likely sitting right here.
          const immediate = (stdout || '').trim();
          if (immediate) logSys('  {grey-fg}networksetup: ' + immediate + '{/grey-fg}');
          // Verify against the interface's own state instead of trusting
          // exit code 0 alone. Reads the SSID directly here rather than
          // going through the module-level wifiSsid/updateWifiSsid() (both
          // async on their own timer) so this check isn't racing that
          // separate poll. 5s, not 2 — association + DHCP genuinely takes
          // a few seconds on a real network, and 2s was reading as
          // "failed" on connections that would've succeeded a moment
          // later (user: "still not working").
          setTimeout(() => {
            updateNetworkInfo();
            execFile('networksetup', ['-getairportnetwork', device], { timeout: 4000 }, (err2, stdout2) => {
              stopAll();
              const m = !err2 && stdout2 && stdout2.match(/Current Wi-Fi Network:\s*(.+)/);
              const nowSsid = m ? m[1].trim() : null;
              if (nowSsid === ssid) {
                logSys('✓ wifi: ' + ssid);
              } else {
                // Report what's ACTUALLY associated (or "not connected to
                // any network" / "couldn't read Wi-Fi status") instead of
                // just "didn't work" — most likely causes on macOS: Wi-Fi
                // switched off, the SSID out of range or hidden, the
                // password wrong, or (on some macOS versions) missing
                // Location Services permission for the calling process —
                // though if that entry isn't even showing up in System
                // Settings, this Mac probably isn't hitting that
                // particular wall, so check the networksetup line above
                // first if one printed.
                const nowTxt = nowSsid ? `"${nowSsid}"` : (err2 ? 'unreadable — ' + ((stderr || err2.message || '') + '').trim().split('\n')[0] : 'no network');
                logSys('⚠ not connected to "' + ssid + '" — currently: ' + nowTxt
                  + '  {grey-fg}(check Wi-Fi is on, the network is in range and not hidden, and the password is right){/grey-fg}');
              }
              if (nowSsid) wifiSsid = nowSsid;
              scheduleRender();
            });
          }, 5000);
        });
        return;
      }
      const args = ['device', 'wifi', 'connect', ssid];
      if (password) args.push('password', password);
      execFile('nmcli', args, { timeout: 20000 }, (err, stdout, stderr) => {
        stopAll();
        if (err) {
          const reason = ((stderr || err.message) + '').trim().split('\n')[0];
          logSys('✗ wifi connect failed: ' + reason
            + '  {grey-fg}(assumes nmcli/NetworkManager — wrong network stack for this box? this is the one spot to change){/grey-fg}');
          return;
        }
        logSys('✓ wifi: ' + (stdout || '').trim().split('\n').pop());
        updateNetworkInfo();
        scheduleRender();
      });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // @commands / :commands — toggle command panel. Opening it now reads as
    // an actual answer from Cricket in the chat log instead of a silent panel
    // flip — same treatment the natural-language showCommands path gets
    // (see the onCommand callback below), so both ways of asking feel consistent.
    if (verb === 'commands') { toggleCommandsPanel(); return; }

    // :language — toggle language panel, same chat-answer treatment as :commands.
    if (verb === 'language') { toggleLanguagePanel(); return; }

    // :chat — same as ^C: maximize/un-maximize chat. There's no more small
    // docked state to toggle into — chat is either hidden or maximized.
    if (verb === 'chat') { toggleChatMaximize(); return; }

    // :memory — Cricket's own conversational memory (see CRICKET'S MEMORY,
    // near chatHistory). Distinct from :resetMemory, which wipes the audio
    // ANALYSIS data — this only touches the chat/summary side.
    //   :memory            report saturation + whether a persisted summary
    //                      exists, as an actual Cricket chat answer
    //   :memory clear      two-step confirm — empties live history back to
    //                      just the system prompt and deletes the summary
    //                      persisted on disk (same pattern as :resetMemory)
    if (verb === 'memory') {
      const sub = (parts[1] || '').toLowerCase();
      if (sub === 'clear' || sub === 'forget') {
        logSys('⚠  This will erase Cricket\'s conversational memory — the running summary and everything said this session.');
        logSys('Type Y to confirm, anything else to cancel.');
        pendingConfirm = () => {
          chatHistory.splice(1, chatHistory.length - 1); // keep only the system prompt at index 0
          cricketMemory = { summary: '', turns: 0, updatedAt: null };
          try { fs.unlinkSync(CRICKET_MEMORY_PATH); } catch (e) {}
          cricketMsgCount = 0;
          logCricket('clean slate — memory cleared.');
          render();
        };
        return;
      }
      const persisted = cricketMemory.summary
        ? `carrying a summary from earlier sessions (${cricketMemory.turns} turns folded in).`
        : `nothing persisted from earlier sessions yet.`;
      logCricket(`memory: ${memoryBar(10)}  —  ${Math.max(0, chatHistory.length - 1)} messages live this session. ${persisted}`);
      return;
    }

    // :train — toggle the training screen (same as ^T), switch its
    // training/review sub-menu, or run a review sub-action while already on
    // that view. See LEARN MODE, right after stopBakeLoop, for what each one
    // actually does (still named for the internal appMode/learnView state —
    // only the user-facing command/label changed from :learn/"Learn" to :train/"Train").
    if (verb === 'train') {
      const sub = (parts[1] || '').toLowerCase();
      if (!sub) { toggleLearnMode(); return; }
      // training/review switch the sub-menu — and enter the training screen
      // first if you weren't already there, so ":train training" alone is
      // enough to jump straight to the live bracket view from Playback.
      if (sub === 'training' || sub === 'review') { switchLearnView(sub); return; }
      if (appMode !== 'learn') { logSys('train: not on the training screen — type :train or press ^T first'); return; }
      if (learnView !== 'review') { logSys('train: this only applies to the review view — :train review first'); return; }
      if (sub === 'source')                 { reviewSetSource((parts[2] || '').toLowerCase()); return; }
      if (sub === 'next' || sub === 'n')    { reviewMove(1); return; }
      if (sub === 'prev' || sub === 'p')    { reviewMove(-1); return; }
      if (sub === 'play')                   { reviewPlay(); return; }
      if (sub === 'stop')                   { reviewStop(); return; }
      if (sub === 'approve')                { reviewApprove(); return; }
      if (sub === 'exclude')                { reviewExclude(); return; }
      if (sub === 'edit')                   { reviewEditLine(parts[2], parts.slice(3)); return; }
      if (sub === 'remove' || sub === 'rm') { reviewRemoveLine(parts[2]); return; }
      if (sub === 'add')                    { reviewAddLine(parts.slice(2)); return; }
      logSys('usage: :train [training | review | source bakes|states | next | prev | play | stop'
             + ' | approve | exclude | edit <n> <cmd...> | remove <n> | add <cmd...>]');
      return;
    }

    // @state / :state — show current state
    if (verb === 'state') { displayState(); return; }

    // @ alone — expand language list, same chat-answer treatment as :language.
    if (!body && prefix === '@') {
      if (langCollapsed) { openLangPanel(); logCricket('pick a language — number, name, or code all work.'); }
      else               { collapseLang(); }
      return;
    }

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
          if (bakeSessionActive && !bakeSeqSteps) upsertComportment(cmd);
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
        if (bakeSessionActive && !bakeSeqSteps) upsertComportment(cmd);
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
      if (verb === 'showCommands') {
        if (cmdCollapsed) { openCmdPanel(); logCricket('command list — panel\'s up.'); }
        else              { collapseCmd(); }
        return;
      }
      if (verb === 'language') {
        if (langCollapsed) { openLangPanel(); logCricket('pick a language — number, name, or code all work.'); }
        else               { collapseLang(); }
        return;
      }
      if (verb === 'chat') { toggleChatMaximize(); return; }
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
      if (bakeSessionActive && !bakeSeqSteps) upsertComportment(expanded);   // live-edit the recipe
      sendToMax(expanded);
      // :start/:stop go quiet here — user: ":start and :stop should never
      // open the chat. I still want to see their linked messages. but i
      // dont want the chat to open fully." These are the two commands
      // that fire constantly mid-set, unlike most things that land here
      // (a handful of taps, not a running rhythm) — forcing the whole
      // overlay open every single time would be disruptive. The message
      // still lands in logBox AND peekBox (the always-visible preview —
      // see appendLog()'s own comment on opts.quiet), just without
      // yanking focus to a full-screen chat.
      const quiet = (verb === 'start' || verb === 'stop');
      logSys('→ ' + expanded, { quiet });
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
  // Used to force the chat overlay open here so the message (and Cricket's
  // reply) wouldn't land silently in a hidden logBox. Reverted (user:
  // "actually, never open the chat automatically. let the user open it by
  // typing control c.") — a message sent while chat is closed still gets
  // logged/answered, just not visibly, until the user opens chat themselves.
  // Collapse commands panel on first chat message
  if (!cmdCollapsed) collapseCmd();
  logUser(trimmed);

  // New intent resets the bake session
  bakeIntent      = trimmed;
  bakeCricketCmds = [];
  bakeUserCmds    = [];

  callCricket(trimmed, cmd => {
    if (cmd === 'showState')    displayState();
    else if (cmd === 'showCommands') {
      if (cmdCollapsed) { openCmdPanel(); logCricket('command list — panel\'s up.'); }
      else              { collapseCmd(); }
    }
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

// Quit — 'C-c' used to live here too; it's now the chat-maximize chip (see
// below), so escape is the only key bound to a hard exit.
screen.key(['escape'], () => process.exit(0));

// Mode toggles — bound on both screen AND inputBox (inputBox has focus
// essentially always, and its own readInput lifecycle grabs keys ahead of
// screen-level bindings — see the C-1..C-4 trigger pads below and the
// pageup/pagedown scroll bindings for the same dual-binding pattern).
// All five are Control combos, not Option/Alt — tried Option first (user
// request), but Option+letter isn't a real modifier at the terminal-protocol
// level on macOS by default, it's how accented/special characters get
// typed. Confirmed live: unconfigured, it doesn't fire the binding at all,
// it inserts the special character straight into whatever's being typed in
// the chat box (user: "⌥ only outputs special characters in the chat ™¶").
// Control chars don't have that failure mode — they're raw control bytes,
// universally understood with zero terminal configuration — so back to ⌃,
// and each is already excluded by inputBox's own _cursorPos/_listener
// character-insert regex (see CURSOR-AWARE INPUT EDITING below) so none of
// them leak into whatever's currently typed either.
//
// There are two SCREENS — playback and training — plus one OVERLAY, chat,
// that can toggle on top of whichever screen is active without changing it
// (see the SCREEN MODEL comment above CHAT_OVERLAY_BOXES, near where
// PLAYBACK_HEADER_BOXES/PLAYBACK_CHANNEL_BOXES are defined). ^C and ^T are
// therefore fully independent: ^T keeps working while chat is open (the
// overlay just follows to the new screen), and ^C keeps working regardless
// of which screen you're on.
//
//   ^C — open/close the chat overlay, on top of whichever screen is active
//   ^T — switch between the playback and training screens (training has
//        its own sub-menu — training/review — see :train training|review
//        and the LEARN MODE section). Was ^R; moved to ^T so the letter
//        matches "Train".
//   ^R — switch training's own sub-menu, training <-> review (see
//        toggleLearnSubView()) — only fires once you're already on the
//        training screen (user: "the control r command should only work
//        [...] on the training tab" — it used to also enter the training
//        screen from Playback, same as :train training|review does, but
//        the footer chip only ever SHOWED on the training screen, so the
//        key now matches what's actually shown instead of doing more).
//   ^B / ^D — jump straight to the review sub-view showing whichever bake
//        is currently selected (same as ^R would, if not already there); if
//        already on review, step through reviewEntries instead — ^B up
//        (previous), ^D down (next) — wrapping past either end (see
//        stepBake()). Was a single forward-only ^B (cycleBake()); split into
//        a pair once both directions were wanted. ^H was the first choice
//        for "down" (user request) but isn't usable — confirmed live that
//        Ctrl+H arrives as a plain Backspace keypress, indistinguishable
//        from the Backspace key at the terminal-protocol level (both send
//        the same 0x08 byte), so it can't be bound separately without
//        breaking text editing in inputBox. "D" (Down) took its place.
//   ^P / ^N — step the graph picker in Train > Review — ^P up (previous),
//        ^N down (next), classic Emacs previous/next letters. ^J was the
//        first choice for "down" (user request) but isn't usable either —
//        confirmed live that Ctrl+J arrives as a plain Enter keypress (both
//        send the same 0x0A byte), which is already bound to SUBMIT
//        whatever's typed in inputBox — so it would've submitted the
//        command line instead of moving the picker. "P" took its place,
//        keeping the "N" half of the original request. See stepGraph()/
//        stepGraphKey() below.
//   ^L — leave this session, back to the login/session picker (2-step
//        confirm — reuses :logout's own logic, see that verb's own comment).
//   ^Q — toggle the :commands panel (see openCmdPanel()/collapseCmd()) —
//        same chat-answer treatment as typing :commands, chip only shows
//        while chat is maximized. "Q" is just the user's preferred letter;
//        the ⌘ glyph moved down into the chip's description slot instead
//        (no longer the key glyph) — see footerChip() call above.
//   ^A — toggle the :language panel (openLangPanel()/collapseLang()), same
//        deal as ^Q. "A" from lAnguage; 文 likewise moved to the description.
screen.key(   ['C-c'], toggleChatMaximize);
inputBox.key( ['C-c'], toggleChatMaximize);
screen.key(   ['C-t'], toggleLearnMode);
inputBox.key( ['C-t'], toggleLearnMode);
function toggleLearnSubView() {
  if (appMode !== 'learn') return; // training tab only — see the ^R comment above
  switchLearnView(learnView === 'training' ? 'review' : 'training');
}

// stepBake — shared by the ^B/^D keys below: on first press from outside
// Review, jumps there (same cold-start behavior cycleBake() always had,
// regardless of which of the two keys triggered it — either one means "take
// me to my bakes"); once already on Review, moves reviewIndex by delta,
// wrapping past either end. ^B = -1 (up/previous), ^D = +1 (down/next).
function stepBake(delta) {
  const wasReview = appMode === 'learn' && learnView === 'review';
  if (!wasReview) { switchLearnView('review'); return; }
  if (reviewEntries.length) {
    reviewGoto(((reviewIndex + delta) % reviewEntries.length + reviewEntries.length) % reviewEntries.length);
  }
}
screen.key(   ['C-r'], toggleLearnSubView);
inputBox.key( ['C-r'], toggleLearnSubView);
screen.key(   ['C-b'], () => stepBake(-1));
inputBox.key( ['C-b'], () => stepBake(-1));
screen.key(   ['C-d'], () => stepBake(1));
inputBox.key( ['C-d'], () => stepBake(1));

// stepGraph — shared by :graphNext/:graphPrev (see handleInput's verb
// check) and the ^P/^N keys right below: moves selectedPageIdx by delta
// (wrapping past either end) and re-derives lastBakePage, logging +
// redrawing the same way either entry point always did. Pulled out into
// its own function so the typed command and the keys share one definition
// instead of drifting apart, same reasoning as toggleLearnSubView()/
// stepBake() just above.
function stepGraph(delta) {
  selectedPageIdx = ((selectedPageIdx - 1 + delta + BAKE_GRAPH_PAGES.length) % BAKE_GRAPH_PAGES.length) + 1;
  refreshSelectedBakePage();
  const p = BAKE_GRAPH_PAGES[selectedPageIdx - 1];
  const withData = lastBakePage.graphs.filter(g => !g.empty).length;
  logSys('✓ bake graph page — ' + selectedPageIdx + '. ' + KIND_LABEL[p.kind] + ' ' + p.model + ' ' + p.feature
    + ' — ' + withData + '/' + lastBakePage.graphs.length + ' dim(s) with data');
  if (appMode === 'learn' && learnView === 'review') { renderTrainingView(); screen.render(); }
}

// ^P / ^N — step the graph picker, review-tab only (user originally asked
// for control-M as the "enter graph nav mode" key, then control-N/control-J
// for direction — see the mode-toggles comment block above for why both M
// and J turned out to be unusable, confirmed live with an actual keypress
// test rather than assumed: Ctrl+M is the same byte as Enter (name:
// 'return'), Ctrl+J is the same byte as Enter's OTHER common name (name:
// 'enter', the exact one inputBox.key('enter') below listens for) — either
// would submit the command line, not move the picker. ^P/^N are plain
// single control-byte keys (0x10/0x0E) with no such collision — verified
// the same way — and happen to match readline/Emacs' own previous/next
// convention, so ^P still reads as "up" and ^N as "down" without needing a
// modifier+arrow combo at all. Plain Up/Down stay untouched everywhere,
// including here — those are hard-reserved for command history (see that
// binding's own comment for why mixing in a second meaning there was
// deliberately reverted once already).
function stepGraphKey(delta) {
  if (!(appMode === 'learn' && learnView === 'review')) return; // review-tab only — mirrors ^R's own restriction
  stepGraph(delta);
}
screen.key(   ['C-p'], () => stepGraphKey(-1));
inputBox.key( ['C-p'], () => stepGraphKey(-1));
screen.key(   ['C-n'], () => stepGraphKey(1));
inputBox.key( ['C-n'], () => stepGraphKey(1));
// Same toggle logic the :commands/:language verb handlers use (see those,
// up near the other handleInput() verb checks) — pulled out into named
// functions here so both the typed command AND ^Q/^A share one definition
// instead of drifting apart.
function toggleCommandsPanel() {
  if (cmdCollapsed) { openCmdPanel(); logCricket('command list — panel\'s up.'); }
  else              { collapseCmd(); }
}
function toggleLanguagePanel() {
  if (langCollapsed) { openLangPanel(); logCricket('pick a language — number, name, or code all work.'); }
  else                { collapseLang(); }
}
screen.key(   ['C-q'], toggleCommandsPanel);
inputBox.key( ['C-q'], toggleCommandsPanel);
screen.key(   ['C-a'], toggleLanguagePanel);
inputBox.key( ['C-a'], toggleLanguagePanel);
function confirmExitToLogin() {
  // The confirm prompt is a logSys() line into logBox, which only exists
  // inside the chat overlay now (see CHAT_OVERLAY_BOXES) — used to force
  // chat open FIRST so the prompt was guaranteed visible. No longer does
  // (user: "actually, never open the chat automatically. let the user open
  // it by typing control c.") — the prompt still logs via logSys() below,
  // just silently if chat happens to be closed, same as everything else now.
  // Also drop out of Learn mode explicitly: chat and Learn are fully
  // independent toggles now (toggleChatMaximize() no longer touches
  // appMode), so nothing else will do this for us, and there's no reason
  // to leave the training screen "active in the background" through a logout.
  if (appMode === 'learn') exitLearnMode();
  logSys('leaving this session — back to the login screen. Type Y to confirm, anything else to cancel.');
  pendingConfirm = () => handleInput(':logout');
  render();
}
screen.key(   ['C-l'], confirmExitToLogin);
inputBox.key( ['C-l'], confirmExitToLogin);


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

// Mouse wheel scroll + clicks — direct handler bypasses element routing
screen.on('mouse', data => {
  if (data.action === 'wheelup' || data.action === 'wheeldown') {
    const dir = data.action === 'wheelup' ? -3 : 3;
    const overCmd = !cmdCollapsed
      && data.y >= cmdBox.top
      && data.y <  cmdBox.top + cmdBox.height;
    if (overCmd) { cmdBox.scroll(dir); screen.render(); }
    else          { logBox.scroll(dir); screen.render(); }
    return;
  }

  // Training/review switching lives in the footer chips/keys (^R — see
  // renderFooter()/toggleLearnSubView()); bake browsing is reviewListBox's
  // own mouse:true list selection. No other in-panel widget needs
  // hit-testing here.
});


screen.on('resize', () => {
  if (!langCollapsed) setLangContent(`{bright-white-fg}:language — type to collapse{/bright-white-fg}\n{grey-fg}${buildLangList()}{/grey-fg}`);
  // Same reasoning as the lang rebuild above — the command panel's column
  // count depends on terminal width, so it has to be rebuilt on resize too,
  // not just at expandCmd() time (see buildCmdColumns()).
  if (!cmdCollapsed) setCmdContent(buildCmdColumns(screen.width));
  // renderFooter() bakes its right-flushed padding off screen.width at the
  // time it's called (see its own gap computation) — it was only ever
  // re-run on state changes (chat toggle, learn sub-view switch, etc.),
  // never on a plain resize, so Log out's "always" right edge (user: "make
  // [log out] tab stick to the right side of the window. always") went
  // stale — right for whatever width the terminal was at the last state
  // change, not the current one — until the next thing happened to call
  // it. Rebuilding it here keeps it glued to the true right edge across
  // resizes too, not just state changes.
  renderFooter();
  reflow(); render();
  if (appMode === 'learn') { reflowLearn(); renderTrainingView(); }
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

// ── CURSOR-AWARE INPUT EDITING ────────────────────────────────────────────────
// blessed's Textarea is append-only + backspace-from-the-end only — its own
// _listener has a literal "// TODO: Handle directional keys." no-op for
// left/right/up/down (node_modules/blessed/lib/widgets/textarea.js). There's
// no way to move into the middle of a typed command and fix it without
// clearing the whole line. Overridden at the INSTANCE level (not the
// Textarea prototype, so nothing else using blessed is affected) so the
// existing readInput()/grabKeys/escape-to-cancel lifecycle from
// inputOnFocus stays intact — only what a keypress actually DOES changes.
// up/down stay bound to command history (below); this only adds left/right
// cursor movement, Home/End (C-a/C-e, readline-style), insert-at-cursor, and
// delete-forward (the "delete" key — backspace already existed, just always
// deleted from the end before this).
inputBox._cursorPos = 0;

// Ghost-completion CYCLING state — null while not cycling; otherwise
// { lead, candidates, index }. Repeated Right Arrow presses (once a
// suggestion has fired) walk through EVERY matching verb in turn instead of
// only ever offering the single best (shortest) one — user: "if the user
// keeps pressing the right arrow, all the available options should be
// proposed." An empty line counts too — user: "if the chat is empty and
// the user presses the right arrow, it should propose all the commands one
// by one" — matchingVerbs('') matches every verb (v.startsWith('') is
// always true), so this falls out of the same code path for free.
// Left Arrow exits cycling — user: "if the user press[es] the left arrow,
// it exits this mode and the left/right arrows become[] the original
// moving through the [text] options" — handled by the generic "any key
// except Right clears cycling" line right at the top of this function;
// Left's own branch below is completely unchanged, so once cycling is
// cleared, left/right immediately go back to plain one-character cursor
// movement, same as before this feature existed.
let suggestCycle = null;

inputBox._listener = function(ch, key) {
  const done = this._done;
  const prevValue = this.value;
  const v   = this.value;
  const pos = this._cursorPos;

  if (key.name === 'return') return;
  if (key.name === 'enter') { ch = '\n'; }

  // Any key other than Right Arrow drops out of cycling mode — including
  // Left Arrow (which then just falls through to its own unchanged branch
  // below and moves the cursor left by one, same as always), typing a
  // character, backspace/delete, history recall, everything.
  if (key.name !== 'right' && suggestCycle) suggestCycle = null;

  if (key.name === 'left') {
    this._cursorPos = Math.max(0, pos - 1);
  } else if (key.name === 'right') {
    if (suggestCycle) {
      // Already cycling — advance to the next candidate, wrapping back to
      // the first once every option has been shown.
      suggestCycle.index = (suggestCycle.index + 1) % suggestCycle.candidates.length;
      this.value = suggestCycle.lead + suggestCycle.candidates[suggestCycle.index];
      this._cursorPos = this.value.length;
    } else if (pos === v.length && (v === '' || v[0] === ':' || v[0] === '@')) {
      // First press — same acceptance moment fish/zsh autosuggestions use
      // (user: "the user now has two choices, either continue typing
      // manually, or press the right arrow to fill with the proposed
      // continuation"), except this now STARTS a cycle rather than
      // committing to just the one candidate. An empty line defaults to
      // ':' (every real command needs it) so accepting always lands on a
      // directly-submittable line.
      const lead = v === '' ? ':' : v[0];
      const body = v === '' ? '' : v.slice(1);
      const candidates = /\s/.test(body) ? [] : matchingVerbs(body);
      if (candidates.length) {
        suggestCycle = { lead, candidates, index: 0 };
        this.value = lead + candidates[0];
        this._cursorPos = this.value.length;
      } else {
        this._cursorPos = Math.min(v.length, pos + 1);
      }
    } else {
      this._cursorPos = Math.min(v.length, pos + 1);
    }
  } else if (key.ctrl && key.name === 'a') {
    this._cursorPos = 0;                 // readline-style: start of line
  } else if (key.ctrl && key.name === 'e') {
    this._cursorPos = v.length;          // readline-style: end of line
  } else if (key.name === 'escape') {
    done(null, null);
  } else if (key.name === 'backspace') {
    if (pos > 0) {
      this.value = v.slice(0, pos - 1) + v.slice(pos);
      this._cursorPos = pos - 1;
    }
  } else if (key.name === 'delete') {
    if (pos < v.length) {
      this.value = v.slice(0, pos) + v.slice(pos + 1);
    }
  } else if (ch) {
    if (!/^[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]$/.test(ch)) {
      this.value = v.slice(0, pos) + ch + v.slice(pos);
      this._cursorPos = pos + ch.length;
    }
  }

  updateSuggestion();
  if (this.value !== prevValue || this._cursorPos !== pos) {
    this.screen.render();
  }
};

// Default _updateCursor always places the terminal cursor at the END of the
// content (based on the last rendered line's width) — that stopped matching
// _cursorPos the moment left/right could move it anywhere else. Simplified
// to the display width of value up to _cursorPos; treats the field as
// single-line, which matches how it's actually used here (Enter always
// submits via the 'enter' key binding below, so text never really
// accumulates a literal embedded newline in practice).
inputBox._updateCursor = function(get) {
  if (this.screen.focused !== this) return;
  const lpos = get ? this.lpos : this._getCoords();
  if (!lpos) return;
  const program = this.screen.program;
  const before  = this.value.slice(0, this._cursorPos || 0);
  const cy = lpos.yi + this.itop;
  const cx = lpos.xi + this.ileft + this.strWidth(before);
  if (cy === program.y && cx === program.x) return;
  if (cy === program.y) {
    if (cx > program.x) program.cuf(cx - program.x);
    else if (cx < program.x) program.cub(program.x - cx);
  } else {
    program.cup(cy, cx);
  }
};

// setValue() (history recall, clearValue) doesn't know about _cursorPos —
// keep it at the end after any programmatic value change, same place
// blessed's own default behavior always left it.
function setInputValue(v) {
  inputBox.setValue(v);
  inputBox._cursorPos = inputBox.value.length;
  updateSuggestion();
}

// ── Command history (up/down arrow) ──────────────────────────────────────────
let cmdHistory = [];
let historyIdx = -1;

// up/down are ALWAYS command history, everywhere — including Learn/review.
// They used to double as session-browse (reviewMove()) while learnView was
// 'review', on the theory that the command line "wasn't really for typing
// prose" there — but that made up/down behave differently depending on
// which tab you were in, with no visual cue which mode you'd get, which is
// exactly what made it confusing/felt "broken." Browsing sessions already
// has its own dedicated, unambiguous command — :train next / :train n and
// :train prev / :train p (see handleInput's :train verb) — so nothing is
// lost by keeping arrows reserved for their one job.
inputBox.key('up', () => {
  if (cmdHistory.length === 0) return;
  historyIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
  setInputValue(cmdHistory[historyIdx]);
  updateInputSize();
  screen.render();
});

inputBox.key('down', () => {
  if (historyIdx <= 0) { historyIdx = -1; setInputValue(''); updateInputSize(); screen.render(); return; }
  historyIdx--;
  setInputValue(cmdHistory[historyIdx]);
  updateInputSize();
  screen.render();
});

inputBox.key('enter', () => {
  const text = inputBox.getValue().replace(/\n/g, ' ').trim();
  if (text) { cmdHistory.unshift(text); historyIdx = -1; }
  handleInput(text);
  setInputValue('');
  inputLines = 1;
  inputBox.height = 1;
  reflow();
  inputBox.focus();
  screen.render();
});

// ── BOOT ──────────────────────────────────────────────────────────────────────

inputBox.focus();
connectToMax();
renderFooter();
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

function applyLanguage(lang, opts) {
  sepBox.setContent(chatTopRule());
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
  // opts.quiet — only the BOOT call below uses this (user: "make sure the
  // tui open on playback screen. not chat."). A manual language switch
  // (picked from :language, or typed mid-chat) is a deliberate user
  // action whose confirmation SHOULD open chat like any other feedback —
  // this greeting is the one call site that fires automatically before
  // the user has done anything at all.
  logCricket(chirpFor(lang.code), opts);
  collapseLang();
  expandCmd();
}

// English is the default on boot — the full language picker is kept (archived)
// behind :language for whoever wants to switch, but it's no longer shown first.
// Users type their own language in chat anyway; the panel is opt-in.
let languageSelected = true;

// Boot — default straight to English, land on :commands (collapsed lang panel).
// applyLanguage()'s greeting goes quiet here specifically — user: "make
// sure the tui open on playback screen. not chat." Without this, the
// chat-auto-open behavior (appendLog()'s opts.quiet check — see its own
// comment) fired on this exact boot-time greeting and landed the app on
// the chat overlay instead of the playback screen every single launch.
setTimeout(() => {
  const defaultLang = LANGUAGES_BASE.find(l => l.code === 'en');
  applyLanguage(defaultLang, { quiet: true });
  reflow();
  screen.render();
}, 200);

// ── Network reachability, for the header's [NETWORK ...] chip ──────────────
// user: "this system will have to run on a wifi. so i'll need to see a wifi
// connectivity zone... maybe find a better way to call it then on/off."
// Deliberately NOT a Wi-Fi-specific check (no nmcli/airport/iwgetid shell-
// out) — this box's actual OS at deploy time isn't pinned down yet, and a
// platform-specific command silently does nothing useful on the other two.
// os.networkInterfaces() is built into Node, works identically on Linux/
// macOS/Windows, and answers the question that actually matters here: is
// there ANY live, non-loopback interface with an address right now — which
// covers Wi-Fi or a wired fallback alike, exactly what LINK's UDP peer sync
// needs regardless of which physical radio carries it. Picks the first
// non-internal IPv4 it finds; if venues turn out to need to distinguish
// Wi-Fi from Ethernet specifically, this is the one place that would grow a
// platform check.
const NETWORK_POLL_MS = 2000;

// Wi-Fi vs Ethernet label, off the interface NAME os.networkInterfaces()
// returns (state.network.iface) — user: "if no wifi is available, can an
// ethernet cable connection still work? so then the network: name will be
// [ethernet]?" Answer: yes — updateNetworkInfo() below never checked which
// radio/cable carried the connection, only that SOME non-internal IPv4
// exists, so a wired link already worked exactly like Wi-Fi did; this just
// adds the label.
//
// Two strategies, since interface naming isn't consistent across
// platforms:
//   - Linux: predictable/legacy interface names directly encode the type
//     (wlan0/wlp2s0/wlx… = Wi-Fi, eth0/enp3s0/eno1/ens33 = wired) — same
//     assumption the :network command's nmcli call already makes (see its
//     own comment) — so this is a pure pattern match, no shell-out needed.
//   - macOS: en0/en1/… tell you nothing on their own (which one is Wi-Fi
//     vs Ethernet varies by Mac model/dock), so macHardwarePortMap below
//     is built once at startup from `networksetup -listallhardwareports`,
//     which macOS itself uses to label each BSD device — definitive,
//     not a guess, same reasoning as shelling out to nmcli on Linux.
// Windows names ("Ethernet", "Wi-Fi") aren't handled by either path yet;
// unrecognized names fall back to showing the plain IP address instead of
// guessing wrong.
// (macHardwarePortMap itself is declared near the top of the file — see
// the comment there — this just populates it.)
if (process.platform === 'darwin') {
  execFile('networksetup', ['-listallhardwareports'], { timeout: 5000 }, (err, stdout) => {
    if (err || !stdout) return; // networksetup missing/failed — classifyIface just falls back to the IP
    // Output comes in repeated "Hardware Port: X\nDevice: Y\n..." blocks —
    // pair each Hardware Port line with the Device line directly under it.
    const lines = stdout.split('\n');
    let pendingPort = null;
    for (const line of lines) {
      const portM = line.match(/^Hardware Port:\s*(.+)$/);
      if (portM) { pendingPort = portM[1].trim(); continue; }
      const devM = line.match(/^Device:\s*(.+)$/);
      if (devM && pendingPort) {
        const port = pendingPort.toLowerCase();
        macHardwarePortMap[devM[1].trim()] =
          /wi-fi|airport/.test(port) ? 'wifi' :
          /ethernet/.test(port)      ? 'ethernet' : null;
        pendingPort = null;
      }
    }
    scheduleRender(); // in case the network zone already rendered once with no label yet
  });
}
function classifyIface(name) {
  if (process.platform === 'darwin') {
    const mac = macHardwarePortMap[name];
    if (mac) return mac; // definitive — skip the Linux pattern guess entirely
  }
  const n = (name || '').toLowerCase();
  if (/^wl/.test(n)) return 'wifi';
  if (/^(eth|en[ops])/.test(n)) return 'ethernet';
  return null;
}

function updateNetworkInfo() {
  const ifaces = os.networkInterfaces();
  let found = null;
  for (const iface of Object.keys(ifaces)) {
    const addr = (ifaces[iface] || []).find(a => a.family === 'IPv4' && !a.internal);
    if (addr) { found = { iface, address: addr.address }; break; }
  }
  state.network = found;
}
updateNetworkInfo();
setInterval(() => { updateNetworkInfo(); scheduleRender(); }, NETWORK_POLL_MS);

// Wi-Fi SSID — user: "show the name of the chosen wifi network". A
// separate, slower poll from updateNetworkInfo() above on purpose: getting
// the SSID needs an OS shell-out (there's no SSID field in
// os.networkInterfaces()), unlike the plain address read, which is free.
// wifiSsid stays null (renderNetworkInfo falls back to the bare [wifi]
// label) whenever the active interface isn't Wi-Fi, or the lookup hasn't
// landed/failed. macOS: networksetup -getairportnetwork <device>, using
// whichever device macHardwarePortMap identified as Wi-Fi (skip the call
// entirely if that map hasn't been populated yet, or found no Wi-Fi port).
// Linux: nmcli's own "active,ssid" table — same nmcli dependency the
// :network join command already assumes (see its own comment).
// (wifiSsid itself is declared near the top of the file — see the comment
// there — this section just polls/assigns it.)
// Set true for the duration of a :network join attempt, false once it
// resolves (success/failure/timeout) — read by networkAddrText() to show a
// spinner frame right in the header itself (user: "dont forget the
// spinner. for the loading"). The sepBox-based spinner (startSpinner() —
// see the :network handler) is real too, but it lives inside the
// collapsible/scrollable chat log area, which isn't always in view; the
// header's network: line is ALWAYS on screen (row 0, next to the EBYS
// version badge), so that's the one guaranteed-visible place to show
// "still connecting" — same spinFrame/SPIN_FRAMES tick startSpinner()
// already drives, just read from a second spot instead of running a
// second timer. (wifiConnecting itself is declared near the top of the
// file — see the comment there — the :network command handler is what
// actually flips it true/false.)
const WIFI_SSID_POLL_MS = 5000;
function updateWifiSsid() {
  if (!state.network || classifyIface(state.network.iface) !== 'wifi') { wifiSsid = null; return; }
  if (process.platform === 'darwin') {
    execFile('networksetup', ['-getairportnetwork', state.network.iface], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return;
      const m = stdout.match(/Current Wi-Fi Network:\s*(.+)/);
      wifiSsid = m ? m[1].trim() : null;
      scheduleRender();
    });
  } else {
    execFile('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi'], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return;
      const line = (stdout.split('\n')).find(l => l.startsWith('yes:'));
      wifiSsid = line ? line.slice(4) : null;
      scheduleRender();
    });
  }
}
updateWifiSsid();
setInterval(updateWifiSsid, WIFI_SSID_POLL_MS);

// Clock tick — keeps timestamps counting smoothly between Max messages.
setInterval(() => { peakDecayTick(); scheduleRender(); }, 100);
// Momentum panel — one new sample per bar-in-progress per second, separate
// from the 100ms render/decay tick above since this one actually mutates
// data (see momentumBarTick()'s own comment) rather than just redrawing.
setInterval(() => { momentumBarTick(); scheduleRender(); }, 1000);

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
