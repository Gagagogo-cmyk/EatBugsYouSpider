// sdj-tui.js — EBYS entry point: login / session picker.
//
// This is what `node sdj-tui.js` actually runs now. It shows a session
// picker — list existing sessions, create new ones, unlock password-
// protected ones — and once a session is chosen it calls
// session_manager.setActiveSession(id) and hands off to app.js (the real
// TUI) via require('./app.js'). app.js re-derives every session-scoped
// path (analysis library, genre/beats DBs, stems dir, stream.txt, etc.)
// from data/current_session.txt at load time, so by the time app.js's
// top-level code runs, it's already scoped to the chosen session.
//
// app.js's :switchSession / :logout commands come back here by spawning
// a fresh `node sdj-tui.js` in the same terminal (stdio: 'inherit') and
// exiting — so this file only ever has to handle one clean login, once
// per process. See session_manager.js's header comment for the full
// multi-session design (registry format, data layout, password hashing).

const blessed    = require('blessed');
const path       = require('path');
const sessionMgr = require('./session_manager');

const screen = blessed.screen({
  smartCSR:    false,   // see app.js's SCREEN + LAYOUT comment — same repaint-corruption reasons apply here
  fullUnicode: true,
  title:       'EBYS — login',
});

process.on('exit', () => process.stdout.write('\x1b[?1003l\x1b[?1006l\x1b[?1000l'));
screen.key(['C-c'], () => process.exit(0));

// Full-screen layout: title at the top, the session list filling the
// middle, and the shortcut bar pinned to the very bottom.
const root = blessed.box({
  parent: screen,
  top: 0, left: 0, width: '100%', height: '100%',
  style: { fg: 'white' },
});

// Same row: "select a session" pinned left, version + license centered.
const title = blessed.text({
  parent: root, top: 0, left: 1, height: 1,
  tags: true, content: '{red-fg}select a session{/red-fg}',
});

const version = blessed.text({
  parent: root, top: 0, left: 'center', height: 1,
  tags: true,
  content: '{grey-fg}[EBYS 0.1.18]{/grey-fg}  {grey-fg}[{bold}▼{/bold}? AGPL-3.0]{/grey-fg}',
});

const list = blessed.list({
  parent: root, top: 2, left: 1, right: 1, bottom: 2,
  keys: true, vi: true, mouse: true,
  style: {
    selected: { fg: 'black', bg: 'white' },
    item: { fg: 'white' },
  },
});

// ── Command shortcut bar pinned to the very bottom — styled like nano's
// footer: each entry is an inverse-highlighted key "chip" followed by a
// plain label, all on a single row spread evenly across the full width.
// No line borders (nano has none); the chip is just an inverse-video cell,
// which renders reliably in blessed. Each cell is a single text element
// containing the whole `{chip} Label` string, so there's nothing to paint
// over the labels.
const footerHeight = 1;
const footerBox = blessed.box({
  parent: root, bottom: 0, left: 0, right: 0, height: footerHeight,
});

// chip(): key rendered as an inverse cell, padded with a space each side,
// so `^N` looks like the light-background chips in nano.
const chip = (key, label) => `{inverse} ${key} {/inverse} ${label}`;

// Spread the shortcuts evenly across the whole screen width using
// percentage offsets, so the bar scales with the terminal size.
const cells = [
  { left: '1%',  content: chip('^N', 'New')      },
  { left: '21%', content: chip('^R', 'Rename')   },
  { left: '41%', content: chip('^D', 'Delete')   },
  { left: '61%', content: chip('^Q', 'Quit')     },
  { left: '81%', content: chip('Enter', 'Select') },
];
for (const c of cells) {
  blessed.text({
    parent: footerBox, bottom: 0, left: c.left,
    tags: true, content: c.content,
  });
}

// Status line sits just above the footer so a status message never paints
// over the shortcut row.
const status = blessed.text({
  parent: root, bottom: footerHeight, left: 1, right: 1, height: 1,
  tags: true, content: '',
});

let sessions = [];

function setStatus(msg, color) {
  status.setContent(color ? `{${color}-fg}${msg}{/${color}-fg}` : msg);
  screen.render();
}

function fmtLastUsed(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function refreshList(selectId) {
  sessions = sessionMgr.listSessions();
  const items = sessions.map(s => {
    const lock = s.passwordHash ? '🔒 ' : '   ';
    const used = fmtLastUsed(s.lastUsedAt);
    return `${lock}${s.name}${used ? '   {grey-fg}(' + used + '){/grey-fg}' : ''}`;
  });
  list.setItems(items.length ? items : ['{grey-fg}(no sessions — press n to create one){/grey-fg}']);
  if (selectId) {
    const idx = sessions.findIndex(s => s.id === selectId);
    if (idx >= 0) list.select(idx);
  }
  screen.render();
}

// ── password prompt (used both for unlocking an existing session and,
// optionally, for setting one on a newly created session) ───────────────────
function promptText(label, opts, cb) {
  opts = opts || {};
  const box = blessed.box({
    parent: root, top: 2, left: 1, right: 1, bottom: 2,
    style: { fg: 'white' },
  });
  blessed.text({ parent: box, top: 0, left: 0, tags: true, content: label });
  const input = blessed.textbox({
    parent: box, top: 2, left: 0, right: 0, height: 1,
    inputOnFocus: true, censor: !!opts.censor,
    style: { fg: 'magenta' },
  });
  const hint = blessed.text({
    parent: box, top: 4, left: 0, tags: true,
    content: '{grey-fg}[enter] confirm  [esc] cancel{/grey-fg}',
  });
  input.key(['escape'], () => { box.destroy(); list.focus(); screen.render(); cb(null); });
  input.on('submit', value => { box.destroy(); list.focus(); screen.render(); cb(value); });
  if (opts.value) input.setValue(opts.value);
  input.focus();
  screen.render();
}

function openSession(session) {
  if (session.passwordHash) {
    promptText(`password for "${session.name}":`, { censor: true }, pw => {
      if (pw === null) { setStatus('', null); return; }
      if (!sessionMgr.verifyPassword(session.id, pw)) {
        setStatus('wrong password', 'red');
        return;
      }
      launch(session.id);
    });
  } else {
    launch(session.id);
  }
}

function launch(id) {
  sessionMgr.setActiveSession(id);
  screen.destroy();
  // Hand off to the real TUI in the same process — app.js hasn't been
  // require()'d yet in this process, so its top-level code runs fresh now,
  // scoped to the session id we just wrote to current_session.txt.
  require('./app.js');
}

function createSession() {
  promptText('new session name:', {}, name => {
    if (name === null || !name.trim()) { setStatus(name === null ? '' : 'name required', name === null ? null : 'red'); return; }
    promptText('password (optional — leave blank for none):', { censor: true }, pw => {
      if (pw === null) { setStatus('', null); return; }
      try {
        const s = sessionMgr.createSession(name.trim(), pw || null);
        refreshList(s.id);
        setStatus(`created "${s.name}"`, 'green');
      } catch (e) {
        setStatus('failed: ' + e.message, 'red');
      }
    });
  });
}

function renameSelected() {
  const s = sessions[list.selected];
  if (!s) return;
  promptText(`rename "${s.name}" to:`, { value: s.name }, name => {
    if (name === null) { setStatus('', null); return; }
    if (!name.trim()) { setStatus('name required', 'red'); return; }
    try {
      const updated = sessionMgr.renameSession(s.id, name.trim());
      refreshList(updated.id);
      setStatus(`renamed to "${updated.name}"`, 'green');
    } catch (e) {
      setStatus('failed: ' + e.message, 'red');
    }
  });
}

function deleteSelected() {
  const idx = list.selected;
  const s = sessions[idx];
  if (!s) return;
  setStatus(`delete "${s.name}"? data is kept on disk — type y to confirm, any other key cancels`, 'red');
  screen.once('keypress', (ch, key) => {
    const k = (key && key.name) || ch;
    if (k === 'y') {
      sessionMgr.deleteSession(s.id);
      refreshList();
      setStatus(`removed "${s.name}" from the list`, 'grey');
    } else {
      setStatus('', null);
    }
  });
}

list.key(['n', 'C-n'], createSession);
list.key(['r', 'C-r'], renameSelected);
list.key(['d', 'C-d'], deleteSelected);
list.key(['q', 'C-c', 'C-q'], () => process.exit(0));
list.on('select', (item, idx) => {
  const s = sessions[idx];
  if (!s) return; // "(no sessions...)" placeholder row
  openSession(s);
});

// Direct switch: app.js's `:switchSession <name>` resolves the name to an id
// and respawns us as `node sdj-tui.js <id>`. If that id exists and the session
// is open (no password), skip the picker and launch straight into it. Locked
// or unknown ids fall through to the normal picker (so a locked one can still
// be unlocked by hand). launch() takes over the process (require('./app.js')),
// so the picker setup below only runs when we did NOT auto-launch.
const _argId = (process.argv[2] || '').trim();
const _auto  = _argId ? sessionMgr.getSession(_argId) : null;
if (_auto && !_auto.passwordHash) {
  launch(_auto.id);
} else {
  refreshList();
  list.focus();
  screen.render();
}
