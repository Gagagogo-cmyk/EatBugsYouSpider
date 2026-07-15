// session_manager.js — multi-session support for the EBYS TUI ("hardware").
//
// A "session" is a named, isolated workspace: its own analysis library
// (uploaded/analyzed tracks), its own learned "brain" (song-structure tags,
// vertical/horizontal training logs — everything :score/:tag/:scoreTransition
// write), its own downbeats/genre databases, and its own Demucs stem output.
// Everything a session owns lives under data/sessions/<id>/, isolated from
// every other session. A session MAY be password-protected (hashed with
// Node's built-in scrypt — no plaintext storage, no extra dependencies) or
// left open for quick switching; both modes are supported side by side.
//
// data/sessions.json — the registry:
//   {
//     "sessions": [
//       { "id": "default", "name": "Default", "passwordHash": null,
//         "createdAt": "...", "lastUsedAt": "..." },
//       ...
//     ]
//   }
//
// data/current_session.txt — a single line holding the active session id.
// Every data-path-resolving function across the whole stack (this file's
// getSessionDataDir(), and the equivalent getDataDir() helpers in
// analyze_reader.js / slice_writer.js / streamWatcher.js / ws_server.js /
// watch_demucs.py / genre_tagger.py / madmom_tagger.py) reads this ONE file
// to decide which session's data/ subtree to use. That's the entire
// mechanism — no session id needs to be threaded through every message.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_ROOT       = path.join(__dirname, '..', '..', 'data');
const SESSIONS_ROOT   = path.join(DATA_ROOT, 'sessions');
const REGISTRY_PATH   = path.join(DATA_ROOT, 'sessions.json');
const CURRENT_PATH    = path.join(DATA_ROOT, 'current_session.txt');
const DEFAULT_ID      = 'default';

// Legacy top-level files that predate the session system — moved (not
// copied) into data/sessions/default/ the first time this module loads on
// an install that doesn't have sessions.json yet. Includes the three files
// ws_server.js has always written next to itself in src/max/ instead of
// data/ (ebys_index.json, stem_ranges.json, umap_coords.json) — folding
// those into the session dir here also fixes that long-standing leak.
const LEGACY_DATA_FILES = [
  'analysis_library.json', 'downbeats.json', 'genres.json', 'stream.txt',
  'song_structure.json', 'training_log.jsonl', 'training_log_vertical.jsonl',
  'training_log_transition.jsonl',
];
const LEGACY_DATA_DIRS  = ['stems'];
const LEGACY_MAX_FILES  = ['ebys_index.json', 'stem_ranges.json', 'umap_coords.json'];
const MAX_DIR           = path.join(__dirname, '..', 'max');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPasswordHash(password, stored) {
  if (!stored) return true; // no password set on this session
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // Constant-time compare
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function slugify(name) {
  const base = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'session';
  return base;
}

function loadRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const reg = JSON.parse(raw);
    if (!reg.sessions) reg.sessions = [];
    return reg;
  } catch (e) {
    return { sessions: [] };
  }
}

function saveRegistry(reg) {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

// migrateLegacyDataIfNeeded — one-time upgrade path. If sessions.json
// doesn't exist yet, this install predates the session system: create a
// "default" session and MOVE the existing top-level data files into it, so
// nothing already analyzed is lost or duplicated.
function migrateLegacyDataIfNeeded() {
  if (fs.existsSync(REGISTRY_PATH)) return; // already migrated

  ensureDir(SESSIONS_ROOT);
  const defaultDir = path.join(SESSIONS_ROOT, DEFAULT_ID);
  ensureDir(defaultDir);

  for (const f of LEGACY_DATA_FILES) {
    const src = path.join(DATA_ROOT, f);
    const dst = path.join(defaultDir, f);
    try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch (e) { /* best-effort */ }
  }
  for (const d of LEGACY_DATA_DIRS) {
    const src = path.join(DATA_ROOT, d);
    const dst = path.join(defaultDir, d);
    try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch (e) { /* best-effort */ }
  }
  // Fold in the three files ws_server.js has always written to src/max/
  // instead of data/ — see LEGACY_MAX_FILES doc comment above.
  for (const f of LEGACY_MAX_FILES) {
    const src = path.join(MAX_DIR, f);
    const dst = path.join(defaultDir, f);
    try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch (e) { /* best-effort */ }
  }

  const now = new Date().toISOString();
  saveRegistry({
    sessions: [
      { id: DEFAULT_ID, name: 'Default', passwordHash: null, createdAt: now, lastUsedAt: now },
    ],
  });
  fs.writeFileSync(CURRENT_PATH, DEFAULT_ID);
}

function listSessions() {
  migrateLegacyDataIfNeeded();
  const reg = loadRegistry();
  return reg.sessions.slice().sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
}

function getSession(id) {
  const reg = loadRegistry();
  return reg.sessions.find(s => s.id === id) || null;
}

// createSession — name is required, password is optional (null/undefined/''
// = no password, open session). Returns the new session object, or throws
// if the name is already taken.
function createSession(name, password) {
  migrateLegacyDataIfNeeded();
  const reg = loadRegistry();
  let id = slugify(name);
  // Ensure uniqueness — append -2, -3, ... if the slug collides.
  if (reg.sessions.some(s => s.id === id)) {
    let n = 2;
    while (reg.sessions.some(s => s.id === id + '-' + n)) n++;
    id = id + '-' + n;
  }
  const now = new Date().toISOString();
  const session = {
    id,
    name: String(name).trim() || id,
    passwordHash: password ? hashPassword(password) : null,
    createdAt: now,
    lastUsedAt: now,
  };
  reg.sessions.push(session);
  saveRegistry(reg);
  ensureDir(getSessionDataDir(id));
  ensureDir(path.join(getSessionDataDir(id), 'stems', 'htdemucs'));
  return session;
}

function deleteSession(id) {
  const reg = loadRegistry();
  reg.sessions = reg.sessions.filter(s => s.id !== id);
  saveRegistry(reg);
  // Deliberately does NOT delete the session's data directory — losing a
  // whole analysis library + trained brain to a typo'd delete would be a
  // much worse failure mode than leaving an orphaned folder on disk.
}

// renameSession — updates the display name AND re-slugs the id so the on-disk
// data folder (data/sessions/<id>/) tracks the name. Rename only ever happens
// at the login picker, where no session is active and nothing (TUI, Max js
// objects, ws_server) has cached these paths yet — so physically moving the
// data directory here is safe. An *in-session* rename would instead need every
// layer to re-resolve its cached paths, which is why we don't expose one.
// Throws if the name is blank, already used, or the target folder exists.
function renameSession(id, newName) {
  const name = String(newName || '').trim();
  if (!name) throw new Error('name required');
  const reg = loadRegistry();
  const s = reg.sessions.find(x => x.id === id);
  if (!s) throw new Error('session not found');
  if (reg.sessions.some(x => x.id !== id && x.name === name)) {
    throw new Error('name already in use');
  }

  // Fresh unique slug from the new name (filesystem-safe — "Chirp!" → "chirp").
  let newId = slugify(name);
  if (newId !== id && reg.sessions.some(x => x.id === newId)) {
    let n = 2;
    while (reg.sessions.some(x => x.id === newId + '-' + n)) n++;
    newId = newId + '-' + n;
  }

  if (newId !== id) {
    const oldDir = getSessionDataDir(id);
    const newDir = getSessionDataDir(newId);
    if (fs.existsSync(oldDir)) {
      if (fs.existsSync(newDir)) throw new Error('target folder already exists: ' + newId);
      fs.renameSync(oldDir, newDir);
    }
    s.id = newId;
    // Keep the active-session pointer valid if it referenced this session.
    try {
      if (fs.existsSync(CURRENT_PATH) && fs.readFileSync(CURRENT_PATH, 'utf8').trim() === id) {
        fs.writeFileSync(CURRENT_PATH, newId);
      }
    } catch (e) { /* best-effort */ }
  }

  s.name = name;
  saveRegistry(reg);
  return s;
}

function verifyPassword(id, password) {
  const session = getSession(id);
  if (!session) return false;
  return verifyPasswordHash(password || '', session.passwordHash);
}

function touchSession(id) {
  const reg = loadRegistry();
  const s = reg.sessions.find(x => x.id === id);
  if (s) { s.lastUsedAt = new Date().toISOString(); saveRegistry(reg); }
}

function getActiveSessionId() {
  migrateLegacyDataIfNeeded();
  try {
    const id = fs.readFileSync(CURRENT_PATH, 'utf8').trim();
    if (id && getSession(id)) return id;
  } catch (e) { /* no pointer file yet */ }
  return DEFAULT_ID;
}

// Stable pointer to the active session's data dir. Anything that needs a fixed
// path — especially hardcoded `read` messages in the Max patch — can reference
// data/current/… and transparently follow the active session, without ever
// knowing the (changing) session-folder name. Repointed on every session
// switch. Relative target so the link stays valid if the repo is moved.
function updateCurrentSymlink(id) {
  const linkPath = path.join(DATA_ROOT, 'current');
  const target   = path.join('sessions', id || DEFAULT_ID);
  try {
    try { fs.unlinkSync(linkPath); } catch (e) { /* no existing link */ }
    fs.symlinkSync(target, linkPath, 'dir');
  } catch (e) { /* best-effort; symlinks may be unsupported on some filesystems */ }
}

function setActiveSession(id) {
  ensureDir(DATA_ROOT);
  fs.writeFileSync(CURRENT_PATH, id);
  updateCurrentSymlink(id);
  touchSession(id);
}

function getSessionDataDir(id) {
  return path.join(SESSIONS_ROOT, id || getActiveSessionId());
}

function getActiveSessionDataDir() {
  return getSessionDataDir(getActiveSessionId());
}

module.exports = {
  DEFAULT_ID,
  migrateLegacyDataIfNeeded,
  listSessions,
  getSession,
  createSession,
  deleteSession,
  renameSession,
  verifyPassword,
  touchSession,
  getActiveSessionId,
  setActiveSession,
  getSessionDataDir,
  getActiveSessionDataDir,
};
