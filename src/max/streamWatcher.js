// streamWatcher.js — polls stream.txt every 1s, bangs on content change.
// Replaces filewatch (unreliable for paths outside Max's search path).
// Outlet 0: bang when stream.txt changes.

autowatch = 0;
inlets   = 0;   // no inlet — auto-starts, nothing to bang externally
outlets  = 1;

// Compute data/ dir relative to this patch — works on any machine.
// Patch lives at EBYS/src/max/  →  strip "max/"  →  strip "src/"  →  append "data/"
function getDataDir() {
    var p = patcher.filepath;
    var slash = p.indexOf('/');
    if (slash > 0) p = p.slice(slash);   // normalise Max volume prefix
    p = p.replace(/[^\/]+$/, '');        // strip filename  → .../src/max/
    p = p.replace(/[^\/]+\/$/, '');      // strip max/      → .../src/
    p = p.replace(/[^\/]+\/$/, '');      // strip src/      → .../EBYS/
    return p + 'data/';
}

// getSessionId — reads data/current_session.txt (written by the TUI's
// session_manager.js / sdj-tui.js login screen), falling back to "default"
// if the pointer file is missing/empty — the same fallback
// session_manager.js itself uses, so an install with no sessions.json yet
// just behaves exactly as before. Read fresh every call (not cached) so a
// mid-run :switchSession in the TUI is picked up on this watcher's very
// next 1s poll, without needing Max's patch reloaded.
function getSessionId() {
    var f = new File(getDataDir() + "current_session.txt", "read", "TEXT");
    if (!f || !f.isopen) return "default";
    var id = f.readline();
    f.close();
    id = (id || "").replace(/^\s+|\s+$/g, "");
    return id || "default";
}

// getSessionDataDir — data/sessions/<id>/, the per-session data root.
function getSessionDataDir() {
    return getDataDir() + "sessions/" + getSessionId() + "/";
}

function streamPath() { return getSessionDataDir() + "stream.txt"; }

var lastContent   = null;
var lastSessionId = null;
var pollTask      = null;

function readFile() {
    var f = new File(streamPath(), "read", "TEXT");
    if (!f || !f.isopen) return null;
    var lines = [];
    while (true) {
        var line = f.readline();
        if (line === null || line === undefined) break;
        lines.push(line);
    }
    f.close();
    return lines.join("\n");
}

function poll() {
    // If :switchSession moved us to a different session since the last poll,
    // forget the old session's last-seen content — otherwise a new session
    // whose stream.txt happens to read identically (e.g. both empty) would
    // never bang, since the plain content !== lastContent check below
    // wouldn't see any difference across the switch.
    var sid = getSessionId();
    if (sid !== lastSessionId) {
        if (lastSessionId !== null) post("streamWatcher: session changed (" + lastSessionId + " → " + sid + ") — resetting baseline\n");
        lastSessionId = sid;
        lastContent = null;
    }

    var content = readFile();

    if (content !== null) {
        var isFirstRead = (lastContent === null);
        if (content !== lastContent) {
            lastContent = content;
            var lines = content.split("\n").filter(function(l){ return l.trim(); });
            if (lines.length > 0) {
                // BUG (found + fixed here): the first-ever read used to just silently
                // record `content` as a "baseline" and return WITHOUT banging — the
                // idea being "nothing changed yet, so nothing to react to." But
                // stream.txt is written by watch_demucs.py the moment Demucs/madmom
                // finish for a track, entirely independent of whether Max happens to
                // be running yet. Every time Max was quit/reopened (which happened
                // repeatedly during this session to pick up code fixes) while an
                // already-written, not-yet-analyzed stream.txt sat on disk, this
                // watcher's first poll silently adopted it as "baseline" and the
                // FluCoMa pass for that track never auto-started — this is the exact
                // "FLUCOMA doesn't start automatically after madmom" symptom.
                // Fix: treat the first successful read the same as any other change
                // and bang. This is safe even when stream.txt still holds an
                // already-fully-analyzed track from a prior run — analyze_reader.js's
                // startStem() already checks the registry per-stem and fast-skips
                // anything already analyzed, so a redundant bang just no-ops quickly
                // instead of silently doing nothing.
                post("streamWatcher: " + (isFirstRead ? "baseline read" : "change detected")
                     + " → bang (" + lines.length + " stems)\n");
                outlet(0, "bang");
            } else {
                post("streamWatcher: stream.txt empty — skipping bang\n");
            }
        }
    }

    // Always reschedule
    pollTask = new Task(poll, this);
    pollTask.schedule(1000);
}

// Start after 300ms so Max is fully initialized
var _init = new Task(poll, this);
_init.schedule(300);
