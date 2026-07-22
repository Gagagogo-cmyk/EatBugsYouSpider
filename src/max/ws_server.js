// ws_server.js — EBYS WebSocket bridge (no external dependencies)
// Uses Node.js built-in http + manual WebSocket handshake (RFC 6455)

const Max    = require('max-api');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const dgram      = require('dgram');
const sessionMgr = require('../tui/session_manager');

const PORT = 8080;

// ── SESSION-SCOPED DATA DIR ───────────────────────────────────────────────────
// Unlike the TUI (a short-lived process that's relaunched by sdj-tui.js on
// every session switch), ws_server.js is a long-running Node process spawned
// once by Max's node.script and never restarted just because the user ran
// :switchSession. So sessionDataDir() re-reads data/current_session.txt fresh
// on every call — see session_manager.js's header comment — instead of
// caching the path once at load time, keeping every read/write below scoped
// to whichever session is active *right now*, not whichever was active when
// this process started. (Named sessionDataDir, not dataDir, to avoid
// colliding with the local `const dataDir` already used inside the
// :resetAll handler further down.)
function sessionDataDir() {
    return sessionMgr.getActiveSessionDataDir();
}

// followGraph dimension keys — mirrors slicer.js's FOLLOW_DIMS exactly (S
// included: it's real, independent data now, not the analysis-pipeline
// duplicate-of-C bug the docs used to warn about).
const FOLLOW_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];
function emptyFollowMap() {
    const m = {};
    FOLLOW_DIMS.forEach(d => { m[d] = null; });
    return m;
}

// ── State cache ───────────────────────────────────────────────────────────────
const state = {
    running:      false,
    track:        'no track loaded',
    bpm:          0,
    globalBPM:    0,       // override from :setGlobalBPM (0 = use analyzed BPM)
    key:          '?',
    slices:       [0, 0, 0, 0],
    analysisDone: false,   // set true when analysisDone arrives (or library already exists)
    ms: {
        width:    { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
        joy:      { vocals: {x:0,y:1}, melody: {x:0,y:1},   // 2D joystick per stem
                    bass:   {x:0,y:1}, drums:  {x:0,y:1},   // y:1 matches ms_router.js's
                    live1:  {x:0,y:1}, live2:  {x:0,y:1} }, // real boot default (front-only)
        fx: { vocals: 0, drums: 0, bass: 0, melody: 0, live1: 0, live2: 0 },
        fxSwitch: { 1: 0, 2: 0 },
        boothGain: 0.7,
        recGain:   1.0,
        masterL: 1,
        masterR: 1,
        masterJoy: { x: 0, y: 1 }, // matches ms_router.js's real boot default (front-only)
    },
    recording:     false,
    recordingFile: null,
    stems: {
        vocals: { id: '--', pos: 0.0, C: 0, E: 0, F: 0, P: 0, H: 0, T: 0, track: '', slot: 0 },
        melody: { id: '--', pos: 0.0, C: 0, E: 0, F: 0, P: 0, H: 0, T: 0, track: '', slot: 0 },
        bass:   { id: '--', pos: 0.0, C: 0, E: 0, F: 0, P: 0, H: 0, T: 0, track: '', slot: 0 },
        drums:  { id: '--', pos: 0.0, C: 0, E: 0, F: 0, P: 0, H: 0, T: 0, track: '', slot: 0 },
    },
    // Engine macros
    entropy:     0.5,
    // followGraph[stem][dim] = [{target, weight}, ...] or null — per-dimension
    // now, not whole-stem (see the :followStem handler below and slicer.js's
    // matching FOLLOW_STEM/followStem() for the full design).
    followGraph: {
        vocals: emptyFollowMap(), melody: emptyFollowMap(),
        bass:   emptyFollowMap(), drums:  emptyFollowMap(),
    },
    // Track mode: page (1=global, 2=per-stem) × subpage (a=lo range, b=hi range)
    // 'all' = no stem selected (global context, always page 1)
    trackMode:   { all: '1a', vocals: '1a', drums: '1a', bass: '1a', melody: '1a', live1: '1a', live2: '1a' },
    // Last touched performative parameter (for LINK missile)
    lastTouchedParam: null,
    // Tipping session
    segBars:     { vocals: 4, melody: 4, bass: 4, drums: 4 },
    sessionId:   null,
    djId:        null,    // DJ's user id, set by :tipOpen <djId> ... — see the 'session'
                           // broadcast's djId field
    sessionDeck: 'ebys',  // 'ebys' | 'direct' — direct = no pings, no slice logging
    sessionMode: null,    // 'web' | 'venue' — set by :tipOpen, paired with sessionDeck to
                           // pick the protocol's precision level (see TIPPING_PROTOCOL.md)
    tipBackendUp: null,   // null = unknown (not checked yet), true/false = last known
                           // reachability of the tipping backend (TIPPING_URL). This is
                           // ws_server.js's own HTTP server reachability, NOT a live Stripe
                           // API check — tips.js doesn't expose one, so this is the closest
                           // available proxy for "is the tipping infrastructure up".
};

// ── Last touched param tracker ───────────────────────────────────────────────
// Called after every performative TUI command.  Missile fires this.
const TOUCH_COMMANDS = new Set([
    'eqLow','eqMid','eqHigh','eqMidFreq',
    'trim','fader','mute','solo','width','joystick','masterJoystick',
    'entropy','pitchShift','formantShift',
    'setShiftBand','setPitchBand','setFormantBand','clearPitchBand','clearFormantBand','clearShiftBand',
    'boothGain','recGain','fx','fxSwitch',
    'followStem','master',
    // Structural/compositional performative commands — narrowly scoped to
    // pure live-mixing gestures before, so ":setSegmentBars 4" (and its
    // usual companions) never showed up in "last touched" even though
    // they're just as much a live performance move as a fader touch.
    'setSegmentBars','setStayProb','setGlobalBPM','setFallbackBPM',
]);
function touch(atoms) {
    if (!TOUCH_COMMANDS.has(atoms[0])) return;
    state.lastTouchedParam = atoms.slice();   // snapshot
    // Broadcast so the TUI can show a live "last command touched" readout —
    // this is exactly what LINK's missile switch would fire if armed right
    // now, so surfacing it in the header lets the user see what they're
    // about to send before they commit to firing.
    broadcast({ type: 'lastTouchedParam', atoms: state.lastTouchedParam });
}

// ── Tipping backend ──────────────────────────────────────────────────────────
const TIPPING_URL = 'http://localhost:3000';

// Count how many distinct source tracks are playing simultaneously across the 4 stems.
// Each stem carries a slot index (0 = first alphabetical track, 1 = second, etc.)
// Unique slot count = simultaneousN for the split equation.
function computeSimultaneousN() {
    const slots = new Set();
    for (const track of ['vocals', 'melody', 'bass', 'drums']) {
        const s = state.stems[track];
        if (s && s.slot !== undefined) slots.add(s.slot);
    }
    return slots.size || 1;
}

async function pingBackend() {
    if (!state.sessionId) return;
    if (state.sessionDeck === 'direct') return;  // no pings in direct mode
    const simultaneousN = computeSimultaneousN();
    const segVoc = state.segBars.vocals || 4;
    const segMel = state.segBars.melody || 4;
    const segBas = state.segBars.bass   || 4;
    const segDrm = state.segBars.drums  || 4;
    const segMean = (segVoc + segMel + segBas + segDrm) / 4;
    const segVariance = [(segVoc - segMean), (segMel - segMean), (segBas - segMean), (segDrm - segMean)]
        .reduce((s, d) => s + d * d, 0) / 4;
    try {
        const res = await fetch(`${TIPPING_URL}/slices/ping`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sessionId: state.sessionId, simultaneousN, segVoc, segMel, segBas, segDrm, segVariance }),
        });
        if (!res.ok) Max.post('ws_server: ping failed — ' + res.status + '\n');
        // Piggyback backend reachability on the ping that's already running
        // every few bars while a session is open, rather than a separate
        // health-check timer — only broadcasts when the status actually
        // FLIPS, so this doesn't spam a message every ping.
        if (state.tipBackendUp !== true) {
            state.tipBackendUp = true;
            broadcast({ type: 'tipBackend', up: true });
        }
    } catch(e) {
        Max.post('ws_server: ping error — ' + e.message + '\n');
        if (state.tipBackendUp !== false) {
            state.tipBackendUp = false;
            broadcast({ type: 'tipBackend', up: false });
        }
    }
}

let pingTimer = null;
function updatePingTimer() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (!state.sessionId || state.sessionDeck === 'direct') return;
    const bpm      = state.globalBPM > 0 ? state.globalBPM : (state.bpm || 120);
    const interval = Math.round((4 * 4 * 60000) / bpm);
    pingTimer      = setInterval(pingBackend, interval);
    Max.post('ws_server: ping every ' + interval + 'ms (BPM=' + bpm + ')\n');
}

// Pre-check: if analysis_library.json already has entries, mark analysisDone now so
// new TUI clients that connect after the patch loads get the flag immediately.
try {
    const lib = parseMaxDictJSON(fs.readFileSync(path.join(sessionDataDir(), 'analysis_library.json'), 'utf8'));
    if (Object.keys(lib).length > 0) {
        state.analysisDone = true;
        Max.post('ws_server: library present — analysisDone pre-set\n');
    }
} catch(e) { /* no library yet — that's fine */ }

const clients = new Set();

// Backs the "last TUI disconnected → force Max to stop" logic below (see
// socket.on('close') and the 'hello' handler). A bare zero-clients check
// would also fire during the TUI's own watchdog-triggered reconnect (app.js
// force-closes and reopens its socket after ~20s of no data while
// state.running is true — "connection likely wedged" — then reconnects a
// few seconds later from the SAME process), which would otherwise hard-stop
// a perfectly good live performance just because the WS link hiccuped.
// app.js tags every connection with a per-process RUN_ID (sent as a 'hello'
// message right after the socket opens); the reconnecting process's id
// always matches lastDisconnectedRunId, so that case cancels the pending
// stop. A genuinely new TUI launch (fresh :logout/:switchSession child, or
// the user quitting and relaunching by hand) gets a new RUN_ID every time,
// so it never matches and the stop goes through — immediately, without
// waiting out the grace window. The timer itself is just a backstop for
// TUI builds/processes too old to send 'hello' at all, or the rare case
// where nothing ever reconnects.
let pendingStopTimer     = null;
let lastDisconnectedRunId = null;
const STOP_ON_DISCONNECT_GRACE_MS = 8000;

// ── Chunk stream helpers ──────────────────────────────────────────────────────
// Every chunked send gets a unique streamId so receivers can detect interleaving.
// Format: label  streamId  chunkIndex  totalChunks  data
let chunkStreamCounter = 0;
function sendChunked(label, str, chunkSize) {
    chunkSize = chunkSize || 2048;
    const sid   = ++chunkStreamCounter;
    const total = Math.ceil(str.length / chunkSize);
    for (let i = 0; i < total; i++) {
        Max.outlet(label, sid, i, total, str.substring(i * chunkSize, (i + 1) * chunkSize));
    }
    return { sid, total };
}

// ── WebSocket frame helpers ───────────────────────────────────────────────────

// FIN + pong (0x8A), mirroring back whatever payload the ping carried — per
// the WS spec a pong should echo the ping's payload exactly. Small, unmasked
// server→client frame, same header-length branches as encodeFrame below.
function encodePongFrame(payload) {
    payload = payload || Buffer.alloc(0);
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x8a;
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x8a;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x8a;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function encodeFrame(data) {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text frame
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function decodeFrames(buf) {
    const messages = [];
    // Client-sent WS pings (opcode 0x9) used to just be skipped over — never
    // answered. Per spec a server should reply with a pong carrying the same
    // payload; not doing so isn't fatal (browsers/ws-library clients don't
    // depend on it to stay connected) but it's a real, previously-missing
    // piece of connection-liveness signaling this server was skipping.
    // Collected here so the caller (which has the actual socket) can write
    // pong replies.
    const pings = [];
    let offset = 0;
    while (offset < buf.length) {
        if (offset + 2 > buf.length) break;
        const b1 = buf[offset];
        const b2 = buf[offset + 1];
        const opcode = b1 & 0x0f;
        const masked  = (b2 & 0x80) !== 0;
        let payloadLen = b2 & 0x7f;
        let headerLen = 2;
        if (payloadLen === 126) {
            if (offset + 4 > buf.length) break;
            payloadLen = buf.readUInt16BE(offset + 2);
            headerLen = 4;
        } else if (payloadLen === 127) {
            if (offset + 10 > buf.length) break;
            payloadLen = Number(buf.readBigUInt64BE(offset + 2));
            headerLen = 10;
        }
        const maskOffset = offset + headerLen;
        const dataOffset = maskOffset + (masked ? 4 : 0);
        if (dataOffset + payloadLen > buf.length) break;
        if (opcode === 8) { messages.push(null); offset = dataOffset + payloadLen; break; } // close
        const rawFrame = buf.slice(dataOffset, dataOffset + payloadLen);
        let payload;
        if (masked) {
            const mask = buf.slice(maskOffset, maskOffset + 4);
            payload = Buffer.alloc(payloadLen);
            for (let i = 0; i < payloadLen; i++) payload[i] = rawFrame[i] ^ mask[i % 4];
        } else {
            payload = rawFrame;
        }
        if (opcode === 0x9) { // ping — unmask it (client frames are always masked) and queue a pong reply
            pings.push(payload);
            offset = dataOffset + payloadLen; continue;
        }
        messages.push(payload.toString('utf8'));
        offset = dataOffset + payloadLen;
    }
    // Return messages, how many bytes were consumed (so the caller can trim
    // the buffer), and any pings seen (so the caller can pong them back).
    return { messages, consumed: offset, pings };
}

// ── HTTP server + WebSocket upgrade ──────────────────────────────────────────

const server = http.createServer((req, res) => {
    // POST /progress — watch_demucs.py sends Demucs progress here; we broadcast to TUI
    if (req.method === 'POST' && req.url === '/progress') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const msg = JSON.parse(body);
                broadcast(msg);
                // stemsReady → watch_demucs.py just finished separating a track and
                // wrote stream.txt for it; tell Max to read it and start the FluCoMa
                // analysis pass (onset detection, spectral shape, MFCC, etc).
                //
                // BUG (found + fixed here): this used to send Max.outlet('stemsReady')
                // — but no route token, no JS function, nothing anywhere in the Max
                // patch or codebase is named "stemsReady". That message went into the
                // void every single time, silently. Genre (Essentia) and beat
                // (madmom) analysis both ran fine because watch_demucs.py runs those
                // itself in Python, entirely independent of Max — only the FluCoMa
                // pass (which genuinely needs Max/MSP running) was ever silently
                // skipped, which is exactly the "analysis ran, but not the FluCoMa
                // one" symptom this was root-caused from.
                //
                // Fix: reuse startAnalysis — the exact same trigger :analyzeAll
                // already sends successfully (see runFullAnalysis() in sdj-tui.js and
                // analyze_reader.js's startAnalysis(), whose own doc comment lists
                // this as one of three valid entry points). It reads stream.txt
                // (already written above) and kicks off the real analysis pass.
                if (msg.type === 'stemsReady') {
                    Max.outlet('startAnalysis');
                }
            } catch(e) {}
            res.writeHead(200); res.end('ok');
        });
        return;
    }
    res.writeHead(200); res.end('EBYS ws_server');
});

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    clients.add(socket);
    Max.post('ws_server: TUI connected (' + clients.size + ')\n');
    // NOTE: whether this connection should cancel a pending auto-stop (see
    // pendingStopTimer's own comment) isn't decided here — it depends on the
    // RUN_ID carried in this socket's 'hello' message, which hasn't arrived
    // yet at this point in the handshake. See the 'hello' handler below.

    // Send operational state snapshot on connect — match the shape of all other
    // 'state' broadcasts (no stems: TUI has its own defaults and they must not be
    // overwritten by ws_server's thin stem objects which lack stay/bars/S/etc.)
    socket.write(encodeFrame(JSON.stringify({
        type: 'state',
        running: state.running,
        track:   state.track,
        bpm:     state.bpm,
        key:     state.key,
        slices:  state.slices,
    })));
    // Status-icon state (tipping session, recording) — sent separately so a
    // reconnecting TUI shows the right icons immediately instead of assuming
    // "nothing active" until the next state-changing command happens to fire.
    // Only sent when a session is actually open — app.js's 'session' handler
    // does a full replace of state.session (sid/up/djId/etc, not a merge),
    // so broadcasting an empty snapshot here on every connect was wiping out
    // the TUI's own state (including its fake preview data) even when
    // nothing real had happened yet. No session open = say nothing, let the
    // TUI keep whatever it already has.
    if (state.sessionId) {
        socket.write(encodeFrame(JSON.stringify({
            type: 'session', active: true, sessionId: state.sessionId, deck: state.sessionDeck,
            mode: state.sessionMode, djId: state.djId,
        })));
    }
    socket.write(encodeFrame(JSON.stringify({ type: 'param', key: 'recording', value: state.recording })));
    // NOTE: do NOT send analysisDone here. analysisDone means "a fresh analysis just
    // completed this session" — it triggers add_tension.py + buildIndex in the TUI.
    // Sending it on every reconnect caused a second buildIndex on every boot.
    //
    // BUG (found + fixed here): the flip side of that fix was never handled —
    // if ws_server.js's node.script itself restarts (or the TUI reconnects)
    // WHILE or shortly after a real analysis run finishes in Max, the live
    // 'analysisDone' broadcast fires into a socket that isn't open yet (or
    // fires on the old, since-replaced socket) and is lost forever. The TUI's
    // spinner has no way to know the work already completed, so it just sits
    // at 95% until its own 5-minute safety timeout gives up — even though
    // analysis genuinely succeeded. state.analysisDone is already correctly
    // pre-set from disk above, so use it: send a distinct, side-effect-free
    // 'analysisAlreadyDone' notice (NOT the real 'analysisDone' message) so
    // the TUI can stop a spinner that's actively waiting, without also
    // re-triggering add_tension.py / buildIndex like a fresh 'analysisDone'
    // would.
    if (state.analysisDone) {
        socket.write(encodeFrame(JSON.stringify({ type: 'analysisAlreadyDone' })));
    }

    let buf = Buffer.alloc(0);
    socket.on('data', async chunk => {
        buf = Buffer.concat([buf, chunk]);
        const { messages, consumed, pings } = decodeFrames(buf);
        buf = buf.slice(consumed); // trim processed bytes so old frames aren't replayed
        for (const p of pings) { try { socket.write(encodePongFrame(p)); } catch (e) {} }
        for (const msg of messages) {
            if (msg === null) { socket.destroy(); break; }
            try {
                const m = JSON.parse(msg);

                // 'hello' — first message app.js sends after the socket opens, carrying
                // its per-process RUN_ID (see that constant's own comment in app.js).
                // Tags this socket with it, then resolves whatever auto-stop is
                // pending from the last disconnect (see pendingStopTimer's comment
                // above): the SAME process reconnecting (watchdog-forced socket kill)
                // cancels it — playback was never really abandoned; anything else
                // (a fresh launch, :logout's replacement child, a manual restart) is
                // a genuinely new session, so the previous one's stop fires right now
                // instead of waiting out the rest of the grace window.
                if (m.type === 'hello') {
                    socket.runId = m.runId || null;
                    if (pendingStopTimer) {
                        const sameProcess = socket.runId && socket.runId === lastDisconnectedRunId;
                        clearTimeout(pendingStopTimer);
                        pendingStopTimer = null;
                        if (sameProcess) {
                            Max.post('ws_server: same TUI reconnected — cancelled pending auto-stop\n');
                        } else {
                            Max.post('ws_server: new TUI session — stopping previous playback now\n');
                            Max.outlet('stop');
                        }
                    }
                    continue;
                }

                // :bake — save training snapshot (intent + Cricket cmds + user corrections + live state)
                if (m.type === 'bake') {
                    const snapshot = {
                        timestamp:        new Date().toISOString(),
                        bakeSessionId:    m.bakeSessionId     || null,  // joins to :score entries
                                                                         // from the same bracket in
                                                                         // training_log_vertical.jsonl
                        intent:           m.intent           || '',
                        cricket_cmds:     m.cricket_cmds     || [],
                        user_corrections: m.user_corrections || [],
                        final_cmds:       m.final_cmds       || [],
                        attempts:         m.attempts         || null,
                        // Filename under recordings/, set by app.js's TRAINING REVIEW MODE
                        // (bracket auto-records via the same :record start/stop path a
                        // manual :record uses) — null if nothing was captured, e.g. a
                        // full-set recording was already in progress. Lets review mode
                        // play back what this bake actually sounded like.
                        audioFile:        m.audioFile         || null,
                        track:            state.track,
                        bpm:              state.bpm,
                        stems:            JSON.parse(JSON.stringify(state.stems)),
                    };
                    const logPath = path.join(sessionDataDir(), 'training_log.jsonl');
                    fs.appendFileSync(logPath, JSON.stringify(snapshot) + '\n');
                    Max.post('ws_server: ✓ baked\n');
                    broadcast({ type: 'sys', msg: '✓ baked' });
                    continue;
                }

                // queryAnalysisDone — the TUI polls this while it's waiting on a
                // fresh :analyzeAll, in case the one-shot 'analysisDone' broadcast
                // was lost (socket reconnecting, or this node.script restarted the
                // instant Max fired it). state.analysisDone is authoritative (set
                // when analyze_reader finishes, and pre-set from disk on boot), so
                // reply — side-effect-free, to just this socket — when it's true.
                if (m.type === 'queryAnalysisDone') {
                    if (state.analysisDone) {
                        try { socket.write(encodeFrame(JSON.stringify({ type: 'analysisAlreadyDone' }))); } catch (e) {}
                    }
                    continue;
                }

                if (m.type === 'command' && m.text) {
                    const parts = m.text.trim().split(/\s+/);
                    const atoms = parts.map(p => isNaN(p) ? p : parseFloat(p));
                    touch(atoms);   // record last touched performative param for LINK missile
                    if (atoms[0] === 'tipOpen' || atoms[0] === 'sessionOpen') {
                        // :tipOpen <djId> <venue> <mode: web|venue> [deck: ebys|direct]
                        // (alias: :sessionOpen — the TIPPING/payout session, NOT the
                        //  login/workspace session, which is :switchSession/:logout)
                        const djId  = String(atoms[1] || '1');
                        const venue = String(atoms[2] || 'unknown');
                        const mode  = String(atoms[3] || 'venue');
                        const deck  = String(atoms[4] || 'ebys');
                        try {
                            const res  = await fetch(`${TIPPING_URL}/slices/session/open`, {
                                method:  'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body:    JSON.stringify({ djId, venue, mode, deck }),
                            });
                            const data = await res.json();
                            state.sessionId   = data.sessionId;
                            state.sessionDeck = deck;
                            state.sessionMode = mode;
                            state.djId        = djId;
                            state.tipBackendUp = true;
                            broadcast({ type: 'tipBackend', up: true });
                            const deckLabel = deck === 'direct' ? ' [direct]' : ' [ebys]';
                            broadcast({ type: 'sys', msg: '✓ session ' + state.sessionId + ' open (' + mode + ')' + deckLabel });
                            // mode ('web'|'venue') + deck ('ebys'|'direct') together pick which of
                            // the protocol's 3 precision levels this session is running at — see
                            // docs/protocol/TIPPING_PROTOCOL.md. Broadcast so the TUI can show the
                            // [LVL n/3] header chip without duplicating this logic client-side.
                            // openedAt is a server timestamp (not the TUI's own Date.now() on
                            // receipt) so it reflects the moment the backend actually opened the
                            // session, not whenever this particular client happened to get the message.
                            // djId is the DJ's user id (":tipOpen <djId> ...") — what the tipping
                            // panel's "uid:" field shows, distinct from sessionId (an opaque
                            // per-session token the backend generates, not a user identity).
                            broadcast({ type: 'session', active: true, sessionId: state.sessionId, deck, mode, openedAt: Date.now(), djId });
                            Max.post('ws_server: session opened — id=' + state.sessionId + ' deck=' + deck + '\n');
                            updatePingTimer();  // no-op in direct mode
                        } catch(e) {
                            state.tipBackendUp = false;
                            broadcast({ type: 'tipBackend', up: false });
                            broadcast({ type: 'sys', msg: '✗ sessionOpen failed — ' + e.message });
                        }
                        continue;
                    } else if (atoms[0] === 'tipClose' || atoms[0] === 'sessionClose') {
                        // :tipClose  (alias: :sessionClose) — closes the TIPPING session
                        if (!state.sessionId) { broadcast({ type: 'sys', msg: '✗ no active tipping session' }); continue; }
                        const closingId = state.sessionId;
                        // Notify the tipping backend (best-effort) — but the LOCAL
                        // teardown below runs no matter what. Previously the state
                        // reset lived inside this try, so if the backend was down or
                        // unreachable (fetch throws / times out) the deck stayed stuck
                        // "open" with no way to close it — which read as ":sessionClose
                        // doesn't work". A short AbortController timeout also stops a
                        // black-holed host from hanging the close.
                        try {
                            const ctl = new AbortController();
                            const to  = setTimeout(() => ctl.abort(), 3000);
                            await fetch(`${TIPPING_URL}/slices/session/close`, {
                                method:  'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body:    JSON.stringify({ sessionId: closingId }),
                                signal:  ctl.signal,
                            });
                            clearTimeout(to);
                            Max.post('ws_server: session closed (backend acked) — id=' + closingId + '\n');
                        } catch (e) {
                            Max.post('ws_server: sessionClose backend unreachable (' + e.message + ') — closing locally\n');
                        }
                        // Local teardown — always.
                        state.sessionId   = null;
                        state.djId        = null;
                        state.sessionDeck = 'ebys';
                        state.sessionMode = null;
                        state.tipBackendUp = null;  // unknown again — no session, no pings to judge it by
                        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
                        broadcast({ type: 'tipBackend', up: null });
                        broadcast({ type: 'session', active: false, sessionId: null, deck: null, mode: null, openedAt: null, djId: null });
                        broadcast({ type: 'sys', msg: '✓ session ' + closingId + ' closed' });
                        continue;
                    } else if (atoms[0] === 'pitchShift') {
                        // :pitchShift <stem> <semitones>
                        // stem = vocals | melody | bass | drums | all
                        // semitones = positive (up) or negative (down), e.g. 3 or -2
                        const stem      = String(atoms[1] || 'all');
                        const semitones = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'pitchShift', stem, semitones });
                        Max.outlet('pitchShift', stem, semitones);
                    } else if (atoms[0] === 'formantShift') {
                        // :formantShift <stem> <semitones>
                        // stem = vocals | melody | bass | drums | all
                        // semitones = positive (up) or negative (down), e.g. 3 or -2
                        // Independent of :pitchShift — see slot_router.js's setFormant()/
                        // FORMANT_OUT for what this actually drives (the second gizmo~
                        // inside ebys-pitch.maxpat, warping the spectral envelope rather
                        // than the pitch-shifted excitation). 0 = formants untouched,
                        // matching ReaPitch's formant slider at rest.
                        const stem      = String(atoms[1] || 'all');
                        const semitones = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'formantShift', stem, semitones });
                        Max.outlet('formantShift', stem, semitones);
                    } else if (atoms[0] === 'setShiftBand') {
                        // :setShiftBand <stem> <loHz> <hiHz>
                        // stem = vocals | melody | bass | drums | all
                        // Sets the SHARED frequency band both :pitchShift and :formantShift
                        // are restricted to on this stem — everything outside [loHz,hiHz]
                        // passes through unshifted. Clears any independent per-effect
                        // override (see setPitchBand/setFormantBand) — this is the "go back
                        // to one band for everything" call. See slot_router.js's
                        // setShiftBand() for the actual bin-mask math.
                        {
                            const stem = String(atoms[1] || 'all');
                            const loHz = parseFloat(atoms[2]) || 0;
                            const hiHz = parseFloat(atoms[3]) || 0;
                            broadcast({ type: 'param', key: 'setShiftBand', stem, loHz, hiHz });
                            Max.outlet('setShiftBand', stem, loHz, hiHz);
                        }
                    } else if (atoms[0] === 'setPitchBand') {
                        // :setPitchBand <stem> <loHz> <hiHz> — independent override,
                        // pitch only. Formant keeps using the shared band (or its own override).
                        {
                            const stem = String(atoms[1] || 'all');
                            const loHz = parseFloat(atoms[2]) || 0;
                            const hiHz = parseFloat(atoms[3]) || 0;
                            broadcast({ type: 'param', key: 'setPitchBand', stem, loHz, hiHz });
                            Max.outlet('setPitchBand', stem, loHz, hiHz);
                        }
                    } else if (atoms[0] === 'setFormantBand') {
                        // :setFormantBand <stem> <loHz> <hiHz> — independent override, formant only.
                        {
                            const stem = String(atoms[1] || 'all');
                            const loHz = parseFloat(atoms[2]) || 0;
                            const hiHz = parseFloat(atoms[3]) || 0;
                            broadcast({ type: 'param', key: 'setFormantBand', stem, loHz, hiHz });
                            Max.outlet('setFormantBand', stem, loHz, hiHz);
                        }
                    } else if (atoms[0] === 'clearPitchBand') {
                        // :clearPitchBand <stem> — drop pitch's band override, back to shared.
                        {
                            const stem = String(atoms[1] || 'all');
                            broadcast({ type: 'param', key: 'clearPitchBand', stem });
                            Max.outlet('clearPitchBand', stem);
                        }
                    } else if (atoms[0] === 'clearFormantBand') {
                        // :clearFormantBand <stem> — drop formant's band override, back to shared.
                        {
                            const stem = String(atoms[1] || 'all');
                            broadcast({ type: 'param', key: 'clearFormantBand', stem });
                            Max.outlet('clearFormantBand', stem);
                        }
                    } else if (atoms[0] === 'clearShiftBand') {
                        // :clearShiftBand <stem> — full reset: shared band back to full
                        // range (no restriction), both pitch/formant overrides cleared.
                        {
                            const stem = String(atoms[1] || 'all');
                            broadcast({ type: 'param', key: 'clearShiftBand', stem });
                            Max.outlet('clearShiftBand', stem);
                        }
                    } else if (atoms[0] === 'width') {
                        // :width <stem> <0–1>  — M/S stereo width (0=mono, 1=full wide)
                        // stem = vocals | melody | bass | drums | all | master
                        // 'master' has no literal DSP width parameter of its own —
                        // there's no summed-master M/S stage, width is only ever
                        // computed per-stem — so it's normalized to 'all' right here,
                        // same meaning the TUI already gives :width all. Doing this
                        // server-side (not just client-side) means it's correct
                        // regardless of what sent the raw command (TUI optimistic
                        // expansion, :bake replay, another client, etc).
                        const rawStem = String(atoms[1] || 'all');
                        const stem    = rawStem.toLowerCase() === 'master' ? 'all' : rawStem;
                        const value = Math.max(0, Math.min(1, parseFloat(atoms[2]) || 0));
                        const targets = stem === 'all' ? ['vocals','melody','bass','drums','live1','live2'] : [stem];
                        targets.forEach(s => { if (state.ms.width.hasOwnProperty(s)) state.ms.width[s] = value; });
                        broadcast({ type: 'param', key: 'width', stem, value });
                        Max.outlet('width', stem, value);
                    } else if (atoms[0] === 'pan') {
                        // :pan <stem> <0–360>  — quadraphonic rotation angle
                        //   0° / 360° = front pair (FL+FR)
                        //   180°      = rear pair  (RL+RR)
                        //   90°/270°  = all four equally
                        const stem  = String(atoms[1] || 'all');
                        const raw   = parseFloat(atoms[2]) || 0;
                        const value = ((raw % 360) + 360) % 360;  // normalise to [0, 360)
                        const targets = stem === 'all' ? ['vocals','melody','bass','drums'] : [stem];
                        targets.forEach(s => { if (state.ms.pan.hasOwnProperty(s)) state.ms.pan[s] = value; });
                        broadcast({ type: 'param', key: 'pan', stem, value });
                        Max.outlet('pan', stem, value);
                    } else if (atoms[0] === 'master') {
                        // :master <L|R|gain> <0–1>
                        // master gain = both L and R linked
                        // master L / master R = independent
                        const side  = String(atoms[1] || 'gain');
                        const value = Math.max(0, Math.min(1, parseFloat(atoms[2]) || 0));
                        if (side === 'L') {
                            state.ms.masterL = value;
                            broadcast({ type: 'param', key: 'masterPanLeft', value });
                            Max.outlet('masterPanLeft', value);
                        } else if (side === 'R') {
                            state.ms.masterR = value;
                            broadcast({ type: 'param', key: 'masterPanRight', value });
                            Max.outlet('masterPanRight', value);
                        } else {
                            // linked — move both
                            state.ms.masterL = value; state.ms.masterR = value;
                            broadcast({ type: 'param', key: 'master_gain', value });
                            Max.outlet('master_gain', value);
                        }
                    } else if (atoms[0] === 'masterJoystick') {
                        // :masterJoystick <x> <y>  — 2D position of entire 4ch mix
                        //   x: -1 (full left)  to +1 (full right)
                        //   y: -1 (full rear)  to +1 (full front)
                        const x = Math.max(-1, Math.min(1, parseFloat(atoms[1]) || 0));
                        const y = Math.max(-1, Math.min(1, parseFloat(atoms[2]) || 0));
                        state.ms.masterJoy = { x, y };
                        broadcast({ type: 'param', key: 'masterJoystick', x, y });
                        Max.outlet('masterJoystick', x, y);
                    } else if (atoms[0] === 'joystick') {
                        // :joystick <stem> <x> <y>  — per-stem position
                        // :joystick <x> <y>         — stem omitted → targets the MASTER mix
                        //   stem: vocals | drums | bass | melody | all
                        //   x: -1 (full left)  to +1 (full right)
                        //   y: -1 (full rear)  to +1 (full front)
                        //
                        // BUG FIX (was: const stem = String(atoms[1] || 'all')): when the
                        // stem arg is omitted, atoms[1] is actually the user's X value. If
                        // that X happened to be 0, `0 || 'all'` fell through to 'all' (0 is
                        // falsy) and silently ate the arg; for any other X, String(atoms[1])
                        // became a bogus stem name. Either way atoms[2] (the user's real Y)
                        // got read into the x slot, and atoms[3] (undefined) became y=0 — a
                        // one-column shift, exactly the "y ends up in x" symptom reported.
                        // Fix: only treat atoms[1] as a stem if it's actually a valid stem
                        // name; otherwise shift the args down by one and route to master.
                        const validStems = ['vocals','melody','bass','drums','all','live1','live2'];
                        const stemArg   = atoms[1];
                        const stemGiven = typeof stemArg === 'string' && validStems.includes(stemArg.toLowerCase());
                        if (!stemGiven) {
                            // No valid stem given — behave like :masterJoystick <x> <y>.
                            const x = Math.max(-1, Math.min(1, parseFloat(atoms[1]) || 0));
                            const y = Math.max(-1, Math.min(1, parseFloat(atoms[2]) || 0));
                            state.ms.masterJoy = { x, y };
                            broadcast({ type: 'param', key: 'masterJoystick', x, y });
                            Max.outlet('masterJoystick', x, y);
                            break;
                        }
                        const stem    = stemArg.toLowerCase();
                        const x       = Math.max(-1, Math.min(1, parseFloat(atoms[2]) || 0));
                        const y       = Math.max(-1, Math.min(1, parseFloat(atoms[3]) || 0));
                        const targets = stem === 'all'
                            ? ['vocals','melody','bass','drums','live1','live2'] : [stem];
                        targets.forEach(s => {
                            if (state.ms.joy.hasOwnProperty(s)) {
                                state.ms.joy[s] = { x, y };
                            }
                        });
                        broadcast({ type: 'param', key: 'joystick', stem, x, y });
                        Max.outlet('joystick', stem, x, y);
                    } else if (atoms[0] === 'fx') {
                        // :fx <stem> <0–1>  — FX knob: controls send + return together
                        // stem = vocals|drums|bass|melody|live1|live2
                        const stem  = String(atoms[1] || 'vocals');
                        if (!['vocals','drums','bass','melody','live1','live2'].includes(stem)) break;
                        const value = Math.max(0, Math.min(1, parseFloat(atoms[2]) || 0));
                        state.ms.fx[stem] = value;
                        broadcast({ type: 'param', key: 'fx_' + stem, value });
                        Max.outlet('fxSend',   stem, value);
                        Max.outlet('fxReturn', stem, value);
                    } else if (atoms[0] === 'fxSwitch') {
                        // :fxSwitch <1|2> <0|1>
                        // 0 = stem uses hardware FX channel (vocals ch1, drums ch2)
                        // 1 = live input uses hardware FX channel (live1 ch1, live2 ch2)
                        const ch  = parseInt(atoms[1]) || 1;
                        const val = parseInt(atoms[2]) || 0;
                        if (ch !== 1 && ch !== 2) break;
                        state.ms.fxSwitch[ch] = val;
                        broadcast({ type: 'param', key: 'fxSwitch' + ch, value: val });
                        Max.outlet('fxSwitch', ch, val);
                    } else if (atoms[0] === 'boothGain') {
                        // :boothGain <0–1>  — booth monitor level (dac~ 15 16)
                        const val = Math.min(1, Math.max(0, parseFloat(atoms[1]) || 0));
                        state.ms.boothGain = val;
                        broadcast({ type: 'param', key: 'boothGain', value: val });
                        Max.outlet('boothGain', val);
                    } else if (atoms[0] === 'recGain') {
                        // :recGain <0–1>  — recording output level (dac~ 17 18)
                        const val = Math.min(1, Math.max(0, parseFloat(atoms[1]) || 0));
                        state.ms.recGain = val;
                        broadcast({ type: 'param', key: 'recGain', value: val });
                        Max.outlet('recGain', val);
                    } else if (atoms[0] === 'eqLow') {
                        // :eqLow <stem|all> <dB>   — low shelf gain (-96 = kill, +12 = boost)
                        const stem  = String(atoms[1] || 'all');
                        const db    = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'eqLow', stem, value: db });
                        Max.outlet('eqLow', stem, db);
                    } else if (atoms[0] === 'eqMid') {
                        // :eqMid <stem|all> <dB>   — mid bell gain
                        const stem  = String(atoms[1] || 'all');
                        const db    = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'eqMid', stem, value: db });
                        Max.outlet('eqMid', stem, db);
                    } else if (atoms[0] === 'eqHigh') {
                        // :eqHigh <stem|all> <dB>  — high shelf gain
                        const stem  = String(atoms[1] || 'all');
                        const db    = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'eqHigh', stem, value: db });
                        Max.outlet('eqHigh', stem, db);
                    } else if (atoms[0] === 'eqMidFreq') {
                        // :eqMidFreq <stem|all> <hz>  — mid bell center frequency (200–8000 Hz)
                        const stem = String(atoms[1] || 'all');
                        const hz   = parseFloat(atoms[2]) || 1000;
                        broadcast({ type: 'param', key: 'eqMidFreq', stem, value: hz });
                        Max.outlet('eqMidFreq', stem, hz);
                    } else if (atoms[0] === 'mute') {
                        // :mute <stem|all> <0|1>  — mute (1=mute, 0=unmute)
                        const stem = String(atoms[1] || 'all');
                        const val  = parseInt(atoms[2]) ? 1 : 0;
                        broadcast({ type: 'param', key: 'mute', stem, value: val });
                        Max.outlet('setStemMute', stem, val);
                    } else if (atoms[0] === 'solo') {
                        // :solo <stem|all> <0|1>  — solo (1=on, 0=off); multiple solos stack
                        const stem = String(atoms[1] || 'all');
                        const val  = parseInt(atoms[2]) ? 1 : 0;
                        broadcast({ type: 'param', key: 'solo', stem, value: val });
                        Max.outlet('setStemSolo', stem, val);
                    } else if (atoms[0] === 'trim') {
                        // :trim <stem|all> <dB>    — input gain before EQ (-12 to +12 dB)
                        const stem  = String(atoms[1] || 'all');
                        const db    = parseFloat(atoms[2]) || 0;
                        broadcast({ type: 'param', key: 'trim', stem, value: db });
                        Max.outlet('trim', stem, db);
                    } else if (atoms[0] === 'fader') {
                        // :fader <stem|all> <0–1>  — post-EQ channel fader
                        const stem  = String(atoms[1] || 'all');
                        const val   = Math.min(1, Math.max(0, parseFloat(atoms[2]) || 0));
                        broadcast({ type: 'param', key: 'fader', stem, value: val });
                        Max.outlet('setFader', stem, val);
                    } else if (atoms[0] === 'analysisMode') {
                        // :analysisMode on | off
                        // on  = slicer auto-drives pan/width per slice (default)
                        // off = manual :width / :pan override mode
                        const val = String(atoms[1] || 'on');
                        broadcast({ type: 'param', key: 'analysisMode', value: val });
                        Max.outlet('analysisMode', val);
                    } else if (atoms[0] === 'record') {
                        // :record start            — open timestamped file and begin recording
                        // :record stop             — stop and close file
                        // :record start <name>     — use custom filename (no spaces)
                        const sub = String(atoms[1] || 'start').toLowerCase();
                        if (sub === 'stop') {
                            Max.outlet('record_cmd', 'stop');
                            state.recording = false;
                            broadcast({ type: 'param', key: 'recording', value: false });
                            Max.post('ws_server: recording stopped\n');
                        } else {
                            // Build filename: recordings/EBYS_YYYYMMDD_HHMMSS.wav
                            const customName = atoms[2] ? String(atoms[2]) : null;
                            const now  = new Date();
                            const pad  = n => String(n).padStart(2, '0');
                            const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                            const fname = customName ? `${customName}.wav` : `EBYS_${stamp}.wav`;
                            const recDir  = path.join(sessionDataDir(), 'recordings');
                            const recPath = path.join(recDir, fname);
                            try { fs.mkdirSync(recDir, { recursive: true }); } catch(e) {}
                            Max.outlet('record_cmd', 'open', recPath);
                            setTimeout(() => Max.outlet('record_cmd', 'start'), 50);
                            state.recording = true;
                            state.recordingFile = fname;
                            broadcast({ type: 'param', key: 'recording', value: true, file: fname });
                            Max.post(`ws_server: recording → ${recPath}\n`);
                        }
                    } else if (atoms[0] === 'buildIndex') {
                        if (buildIndexInProgress) {
                            Max.post('ws_server: buildIndex already running — skipping duplicate\n');
                            return;
                        }
                        buildIndexInProgress = true;
                        // Safety backstop: a hung/failed t-SNE (e.g. a single-track
                        // library) used to leave this gate stuck `true` forever,
                        // silently skipping EVERY future buildIndex — the "analyzed
                        // on disk but 0 tracks, :start does nothing" wedge. Force-
                        // clear after 15s no matter what happens below.
                        const bipGuard = setTimeout(() => {
                            if (buildIndexInProgress) {
                                buildIndexInProgress = false;
                                Max.post('ws_server: buildIndex guard timeout — cleared stuck flag\n');
                            }
                        }, 15000);
                        // Pre-populate the named dict from Node before triggering slicer.js,
                        // then run t-SNE in the background (no patch wiring needed).
                        prepareLibraryDict()
                            .then(() => {
                                Max.outlet(...atoms);   // → slicer.js builds its live index
                                // A successful rebuild from a NON-EMPTY library means any
                                // leftover post-reset "block saves" state is stale (the
                                // analysis likely finished while the TUI was disconnected,
                                // so completeAnalysis never cleared it). Clear it so the
                                // index can persist and reload cleanly.
                                clearResetPendingIfPopulated();
                                // The gate only exists to prevent CONCURRENT rebuilds; that
                                // job is done the instant slicer.js has the buildIndex.
                                // Clear it now so the fire-and-forget t-SNE below can never
                                // strand it again.
                                clearTimeout(bipGuard);
                                buildIndexInProgress = false;
                                Max.post('ws_server: scheduling t-SNE in 500ms…\n');
                                setTimeout(() => {
                                    Max.post('ws_server: t-SNE timer fired\n');
                                    try { computeAndWriteUMAP(); }
                                    catch(e) { Max.post('ws_server: UMAP error: ' + String(e) + '\n'); }
                                }, 500);
                            })
                            .catch(e => {
                                Max.post('ws_server: library prep failed: ' + String(e) + '\n');
                                Max.outlet(...atoms);
                                clearTimeout(bipGuard);
                                buildIndexInProgress = false;
                            });
                    } else if (atoms[0] === 'mode') {
                        // :mode <stem> [1 | 2 [a|b]]
                        // Page 1  — global descriptors (all stems), no subpage
                        // Page 2a — per-stem descriptors, low range
                        // Page 2b — per-stem descriptors, high range
                        // No args after stem → cycle: 1 → 2a → 2b → 1
                        // Sticky — stays until explicitly changed
                        const stem = String(atoms[1] || '');
                        if (!stem || !state.trackMode.hasOwnProperty(stem)) break;
                        // 'all' = no stem selected — page 1 only, page 2 is invalid
                        const isAll = stem === 'all';
                        const cycle = isAll ? ['1a', '1b'] : ['1a', '1b', '2a', '2b'];
                        let newMode;
                        if (!atoms[2]) {
                            // cycle through valid pages for this stem
                            const cur = state.trackMode[stem];
                            newMode = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
                        } else {
                            const arg2 = String(atoms[2]).toLowerCase();
                            const cur  = state.trackMode[stem];
                            if (arg2 === 'a' || arg2 === 'b') {
                                // subpage only — keep current page
                                newMode = cur[0] + arg2;
                            } else if (arg2 === '1' || (arg2 === '2' && !isAll)) {
                                const subp = atoms[3] ? String(atoms[3]).toLowerCase() : null;
                                const curSub = cur[0] === arg2 ? cur[1] : 'a';
                                newMode = arg2 + (subp || curSub);
                            } else {
                                break; // invalid (e.g. :mode all 2 ...)
                            }
                        }
                        state.trackMode[stem] = newMode;
                        broadcast({ type: 'mode', track: stem, mode: newMode });

                    } else if (atoms[0] === 'entropy' || atoms[0] === 'setEntropy') {
                        // :entropy <0–1> / :setEntropy <0–1>  — ORDER (0) ↔ CHAOS (1) macro
                        // Drives matchProb, stayProb, dirWeight simultaneously in slicer.js
                        // Both spellings handled here — the TUI's COMMANDS set (and slicer.js's
                        // own function name) use "setEntropy", but this handler used to only
                        // match the shorter "entropy". Typing :setEntropy as documented fell
                        // through to the generic passthrough, which reached slicer.js fine but
                        // silently skipped state tracking, the broadcast to other clients, and
                        // LINK sync below — a real, undetectable bug since nothing errored.
                        const val = Math.min(1, Math.max(0, parseFloat(atoms[1]) || 0));
                        state.entropy = val;
                        broadcast({ type: 'param', key: 'entropy', value: val });
                        Max.outlet('setEntropy', val);
                        if (link.active) link.broadcastState();

                    } else if (atoms[0] === 'followStem') {
                        // Per-dimension — mirrors slicer.js's followStem() grammar exactly,
                        // this parser just needs to stay in sync for state.followGraph/broadcast:
                        // :followStem <stem> self                          — reset every dimension
                        // :followStem <stem> <dim> self                    — reset just that dimension
                        // :followStem <stem> <dim> <target> <weight> ...   — that dimension follows
                        //   a weighted blend of target(s)' SAME dimension end-descriptor
                        // :followStem <stem> all <target> <weight> ...     — apply the same blend
                        //   to every dimension at once
                        const stem = String(atoms[1] || '');
                        if (stem && state.followGraph.hasOwnProperty(stem)) {
                            const second = atoms[2] !== undefined ? String(atoms[2]) : null;
                            if (second === null || second === 'self') {
                                state.followGraph[stem] = emptyFollowMap();
                                broadcast({ type: 'param', key: 'followStem', stem, dim: 'all', follows: null });
                            } else {
                                const dims = second === 'all' ? FOLLOW_DIMS
                                    : (FOLLOW_DIMS.includes(second) ? [second] : null);
                                if (!dims) {
                                    // Unknown dimension token — don't touch state/broadcast, but
                                    // still forward below so slicer.js's own validation (and log
                                    // message) fires too.
                                } else if (String(atoms[3]) === 'self' && atoms.length === 4) {
                                    dims.forEach(d => { state.followGraph[stem][d] = null; });
                                    broadcast({ type: 'param', key: 'followStem', stem, dim: second, follows: null });
                                } else {
                                    const pairs = [];
                                    let totalW = 0;
                                    for (let i = 3; i + 1 < atoms.length; i += 2) {
                                        const w = parseFloat(atoms[i + 1]) || 0;
                                        pairs.push({ target: String(atoms[i]), weight: w });
                                        totalW += w;
                                    }
                                    if (totalW > 0) pairs.forEach(p => p.weight /= totalW);
                                    dims.forEach(d => { state.followGraph[stem][d] = pairs.map(p => ({ ...p })); });
                                    broadcast({ type: 'param', key: 'followStem', stem, dim: second, follows: pairs });
                                }
                            }
                        }
                        Max.outlet(...atoms);   // forward all args to slicer.js

                    } else if (atoms[0] === 'setGenreFilter') {
                        // :setGenreFilter <genre>  — restrict slice selection to tracks matching genre
                        // Uses case-insensitive substring match against Essentia genre tags
                        // Run :listGenres first to see what tags are available
                        Max.outlet(...atoms);

                    } else if (atoms[0] === 'lockSource') {
                        // :lockSource <leader> <follower>  — follower always draws from leader's source track
                        // :lockSource <stem>               — clear lock on stem
                        // No optimistic broadcast here — slicer.js's own outlet(1, "lockSource"/
                        // "unlockSource", ...) (see Max.addHandler('lockSource'/'unlockSource')
                        // below) is the confirmed state and arrives within the same tick; a
                        // separate echo here just risked showing "locked" in the TUI for a
                        // command slicer.js actually rejected (unknown stem, cycle guard, etc.).
                        const leader   = String(atoms[1] || '');
                        const follower = atoms[2] ? String(atoms[2]) : null;
                        if (follower) {
                            Max.outlet('lockSource', leader, follower);
                        } else {
                            Max.outlet('unlockSource', leader);
                        }

                    } else if (atoms[0] === 'unlockSource') {
                        // :unlockSource <stem>  — clear source lock (confirmed via slicer.js's
                        // own outlet(1, "unlockSource", ...), same as above)
                        Max.outlet('unlockSource', String(atoms[1] || 'all'));

                    } else if (atoms[0] === 'score') {
                        // :score <-1..1> [overallSection]  — "vertical" training signal:
                        // scores the CURRENT layered combination (which source track each
                        // stem is drawing from, right now, plus how they're mixed
                        // together) as opposed to :bake's "horizontal" signal (was the
                        // right SEQUENCE of moves made over time) or :scoreTransition's
                        // "horizontal" signal (did THIS cut, specifically, flow well).
                        // Named "score" rather than "rate" — "rate" reads like a
                        // speed/tempo parameter next to all the audio-rate terminology
                        // elsewhere in this system. No bracket/session needed — the
                        // window being scored is implicitly whatever's live this instant,
                        // bounded by each stem's own current SEGMENT_BARS. Logged only
                        // for now, same as :bake — this file is what a future offline
                        // training pass reads to nudge live selection scoring once a
                        // model exists.
                        //
                        // Per-stem `section` below is looked up automatically from
                        // song_structure.json (whatever a prior :tag stored for that
                        // stem's current position) — "when signaling a layering of slice
                        // is good, also signal what section it corresponds to" without
                        // making the user retype it. The optional trailing arg lets the
                        // user additionally label the OVERALL combined moment (e.g. the
                        // mix as a whole reads as a "build" even if individual stems'
                        // own tagged sections differ) — freeform, not required to match
                        // an existing :tag'd section.
                        const score = Math.max(-1, Math.min(1, parseFloat(atoms[1])));
                        const overallSection = atoms[2] ? String(atoms[2]) : null;
                        if (isNaN(score)) {
                            broadcast({ type: 'sys', msg: 'usage: :score <-1..1> [overallSection]' });
                        } else {
                            const stemKeys  = ['vocals', 'melody', 'bass', 'drums'];
                            const structure = loadSongStructure();
                            // bakeSessionId/bakeAttempt/bakeIntent arrive only when this
                            // :score was issued from inside an open :bake bracket (see
                            // app.js's verb === 'score' handler) — they let a future pass
                            // group vertical ratings by which bracket + which looped
                            // attempt produced them, instead of a flat disconnected
                            // stream. null/undefined for a bare :score outside a bracket,
                            // same shape as before this field existed.
                            const snapshot = {
                                timestamp: new Date().toISOString(),
                                type:      'vertical',
                                rating:    score,
                                overallSection,
                                bakeSessionId: m.bakeSessionId || null,
                                bakeAttempt:   m.bakeAttempt   || null,
                                bakeIntent:    m.bakeIntent    || null,
                                track:     state.track,
                                bpm:       state.bpm,
                                globalBPM: state.globalBPM,
                                key:       state.key,
                                stems: Object.fromEntries(stemKeys.map(s => {
                                    const st  = state.stems[s];
                                    const mid = (st.sliceStart !== undefined && st.sliceEnd !== undefined)
                                                ? (st.sliceStart + st.sliceEnd) / 2 : null;
                                    const sec = (st.track && mid !== null) ? findSection(structure, st.track, mid) : null;
                                    return [s, {
                                        sourceTrack: st.track,
                                        slot:        st.slot,
                                        descriptors: {
                                            C: st.C, S: st.S, E: st.E, F: st.F, P: st.P, H: st.H, T: st.T,
                                            tension_C: st.tC, tension_E: st.tE, tension_F: st.tF,
                                            tension_P: st.tP, tension_H: st.tH, tension_T: st.tT,
                                        },
                                        segmentBars:     state.segBars[s],
                                        pan:             state.ms.joy[s],
                                        width:           state.ms.width[s],
                                        section:          sec ? sec.tag : null,
                                        sectionIntensity: sec ? sec.intensity : null,
                                    }];
                                })),
                                master: {
                                    joy:       state.ms.masterJoy,
                                    boothGain: state.ms.boothGain,
                                    recGain:   state.ms.recGain,
                                },
                            };
                            const logPath = path.join(sessionDataDir(), 'training_log_vertical.jsonl');
                            fs.appendFileSync(logPath, JSON.stringify(snapshot) + '\n');
                            const bakeTag = snapshot.bakeSessionId
                                ? ' [bake ' + snapshot.bakeSessionId + ' attempt ' + snapshot.bakeAttempt + ']' : '';
                            Max.post('ws_server: ✓ scored ' + score.toFixed(2) + bakeTag + '\n');
                            broadcast({ type: 'sys', msg: '✓ scored ' + score.toFixed(2) + ' — layered combo logged' + bakeTag });
                            // Tells app.js a real vertical bake just landed on disk, so it can
                            // re-derive/re-render its bake graph immediately (user: "I want it
                            // to be automatically drawn when bakes are baked") — a separate,
                            // structured broadcast rather than app.js pattern-matching the
                            // human-readable 'sys' string above.
                            broadcast({ type: 'bakeScored', model: 'vertical' });
                        }

                    } else if (atoms[0] === 'tag') {
                        // :tag <label> [stem]  — tag the bar-range CURRENTLY PLAYING on
                        // `stem` (default melody) with a structural label (verse/chorus/
                        // build/drop/intro/bridge/etc — see STRUCTURE_TAGS; any label is
                        // accepted, that list is just a soft nudge toward consistency).
                        // Stored in song_structure.json keyed by SOURCE TRACK, not by
                        // stem — structure is a property of the song. `stem` is only
                        // used to identify which bar range is currently playing;
                        // computeIntensity() then pools descriptors from all 4 stems'
                        // slices in that range, not just the one that was on-screen.
                        const label = atoms[1] ? String(atoms[1]) : '';
                        const stem  = atoms[2] ? String(atoms[2]) : 'melody';
                        if (!label) {
                            broadcast({ type: 'sys', msg: 'usage: :tag <label> [stem]  (stems: vocals/melody/bass/drums, default melody)' });
                        } else if (!state.stems[stem]) {
                            broadcast({ type: 'sys', msg: 'usage: :tag <label> [stem] — unknown stem "' + stem + '"' });
                        } else {
                            const st = state.stems[stem];
                            const sourceTrack = st.track;
                            if (!sourceTrack || st.sliceStart === undefined || st.sliceEnd === undefined) {
                                broadcast({ type: 'sys', msg: ':tag — ' + stem + ' has no active segment yet' });
                            } else {
                                if (!STRUCTURE_TAGS.includes(label)) {
                                    broadcast({ type: 'sys', msg: 'note: "' + label + '" isn\'t in the standard tag vocabulary (' + STRUCTURE_TAGS.join(', ') + ') — stored anyway' });
                                }
                                const startFrac = st.sliceStart, endFrac = st.sliceEnd;
                                const result    = computeIntensity(sourceTrack, startFrac, endFrac);

                                const structure = loadSongStructure();
                                if (!structure[sourceTrack]) structure[sourceTrack] = { sections: [] };
                                const sections = structure[sourceTrack].sections;

                                // Update an existing section instead of duplicating it if
                                // this tag clearly re-covers one already stored (>50%
                                // overlap of the shorter of the two ranges) — keeps the
                                // store clean when re-tagging the same passage rather than
                                // piling up near-duplicate entries every time.
                                const overlapMs = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
                                let existing = null;
                                for (const sec of sections) {
                                    const ov      = overlapMs(startFrac, endFrac, sec.startFrac, sec.endFrac);
                                    const shorter = Math.min(endFrac - startFrac, sec.endFrac - sec.startFrac);
                                    if (shorter > 0 && ov / shorter > 0.5) { existing = sec; break; }
                                }

                                const entry = {
                                    startFrac, endFrac, tag: label,
                                    intensity:           result.intensity,
                                    intensityBreakdown:  result.breakdown,
                                    taggedAt:            new Date().toISOString(),
                                    taggedByStem:        stem,
                                };
                                if (existing) {
                                    Object.assign(existing, entry);
                                } else {
                                    sections.push(entry);
                                    sections.sort((a, b) => a.startFrac - b.startFrac);
                                }
                                saveSongStructure(structure);

                                const intensityStr = (result.intensity !== null)
                                    ? result.intensity.toFixed(3) : 'n/a (' + result.error + ')';
                                Max.post('ws_server: # tagged ' + sourceTrack + ' [' + startFrac.toFixed(3) + '-'
                                         + endFrac.toFixed(3) + '] as "' + label + '"  intensity=' + intensityStr + '\n');
                                broadcast({ type: 'sys', msg: '# tagged "' + label + '"  intensity=' + intensityStr
                                         + (existing ? ' (updated existing section)' : '') });
                            }
                        }

                    } else if (atoms[0] === 'listSections') {
                        // :listSections [track]  — print stored structure tags for a
                        // source track. No track arg = whatever's currently loaded on
                        // melody (falling back to vocals/bass/drums if melody is empty).
                        const structure = loadSongStructure();
                        let track = atoms[1] ? String(atoms[1]) : null;
                        if (!track) {
                            for (const s of ['melody', 'vocals', 'bass', 'drums']) {
                                if (state.stems[s] && state.stems[s].track) { track = state.stems[s].track; break; }
                            }
                        }
                        if (!track || !structure[track] || !structure[track].sections.length) {
                            broadcast({ type: 'sys', msg: ':listSections — no tagged sections for "' + (track || '?') + '"' });
                        } else {
                            const lines = structure[track].sections.map(sec =>
                                sec.startFrac.toFixed(3) + '-' + sec.endFrac.toFixed(3) + '  ' + sec.tag
                                + '  intensity=' + (sec.intensity !== null && sec.intensity !== undefined ? sec.intensity.toFixed(2) : 'n/a'));
                            Max.post('ws_server: sections for ' + track + ':\n  ' + lines.join('\n  ') + '\n');
                            broadcast({ type: 'sys', msg: structure[track].sections.length + ' section(s) for ' + track + ' — see console' });
                        }

                    } else if (atoms[0] === 'scoreTransition') {
                        // :scoreTransition <-1..1> [stem]  — "horizontal" signal, but a
                        // different one than :bake's: :bake asks "was the right SEQUENCE
                        // of Cricket commands issued" (a command-level training signal).
                        // This asks "did the AUDIO itself flow well crossing from the
                        // previous segment into the current one" (a signal about the cut
                        // itself) — on one stem, or all 4 at once if no stem is given,
                        // mirroring :score's whole-mix-by-default shape. Needs both sides
                        // of the boundary, which the 'desc' handler above snapshots into
                        // state.stems[s].prevSegment right before it's overwritten by the
                        // incoming segment's own descriptors.
                        const score      = Math.max(-1, Math.min(1, parseFloat(atoms[1])));
                        const stemFilter = atoms[2] ? String(atoms[2]) : null;
                        if (isNaN(score)) {
                            broadcast({ type: 'sys', msg: 'usage: :scoreTransition <-1..1> [stem]' });
                        } else if (stemFilter && !state.stems[stemFilter]) {
                            broadcast({ type: 'sys', msg: 'usage: :scoreTransition <-1..1> [stem] — unknown stem "' + stemFilter + '"' });
                        } else {
                            const stemKeys  = stemFilter ? [stemFilter] : ['vocals', 'melody', 'bass', 'drums'];
                            const structure = loadSongStructure();
                            const stemsOut  = {};
                            let any = false;
                            for (const s of stemKeys) {
                                const st = state.stems[s];
                                if (!st || !st.prevSegment) continue;
                                any = true;
                                const fromMid = (st.prevSegment.sliceStart + st.prevSegment.sliceEnd) / 2;
                                const toMid   = (st.sliceStart !== undefined && st.sliceEnd !== undefined)
                                                ? (st.sliceStart + st.sliceEnd) / 2 : null;
                                const fromSec = findSection(structure, st.prevSegment.sourceTrack, fromMid);
                                const toSec   = (st.track && toMid !== null) ? findSection(structure, st.track, toMid) : null;
                                stemsOut[s] = {
                                    from: {
                                        sourceTrack: st.prevSegment.sourceTrack, id: st.prevSegment.id,
                                        descriptors: st.prevSegment.descriptors, section: fromSec ? fromSec.tag : null,
                                    },
                                    to: {
                                        sourceTrack: st.track, id: st.id,
                                        descriptors: {
                                            C: st.C, S: st.S, E: st.E, F: st.F, P: st.P, H: st.H, T: st.T,
                                            tension_C: st.tC, tension_E: st.tE, tension_F: st.tF,
                                            tension_P: st.tP, tension_H: st.tH, tension_T: st.tT,
                                        },
                                        section: toSec ? toSec.tag : null,
                                    },
                                };
                            }
                            if (!any) {
                                broadcast({ type: 'sys', msg: ':scoreTransition — no transition recorded yet' + (stemFilter ? ' for ' + stemFilter : '') });
                            } else {
                                const snapshot = {
                                    timestamp: new Date().toISOString(),
                                    type:      'horizontal_transition',
                                    rating:    score,
                                    // Same bake-bracket tagging as :score — see its handler's
                                    // comment. Primary use: :bake sequence handoffs, so a
                                    // transition rating can be traced back to which two named
                                    // states it was rating the cut between.
                                    bakeSessionId: m.bakeSessionId || null,
                                    bakeAttempt:   m.bakeAttempt   || null,
                                    bakeIntent:    m.bakeIntent    || null,
                                    stems:     stemsOut,
                                };
                                const logPath = path.join(sessionDataDir(), 'training_log_transition.jsonl');
                                fs.appendFileSync(logPath, JSON.stringify(snapshot) + '\n');
                                Max.post('ws_server: ✓ transition scored ' + score.toFixed(2) + '\n');
                                broadcast({ type: 'sys', msg: '✓ transition scored ' + score.toFixed(2) + ' — logged' });
                                // See the 'vertical' bakeScored broadcast above — same reasoning,
                                // other log file.
                                broadcast({ type: 'bakeScored', model: 'transition' });
                            }
                        }

                    } else if (atoms[0] === 'clearGenreFilter') {
                        // :clearGenreFilter  — remove genre restriction
                        Max.outlet('clearGenreFilter');

                    } else if (atoms[0] === 'listGenres') {
                        // :listGenres  — print available genre tags to Max console
                        Max.outlet('listGenres');

                    } else if (atoms[0] === 'setKeyFilter') {
                        // :setKeyFilter <key>  — restrict to tracks in this key (e.g. Am, C#, G)
                        Max.outlet(...atoms);

                    } else if (atoms[0] === 'clearKeyFilter') {
                        // :clearKeyFilter  — remove key restriction
                        Max.outlet('clearKeyFilter');

                    } else if (atoms[0] === 'setSrcWeights') {
                        // :setSrcWeights <bpm_weight> <cohesion_weight>
                        // Tune probabilistic source-track selection at runtime.
                        // Values are renormalised inside slicer.js so they sum to 1.0.
                        Max.outlet(...atoms);

                    } else if (atoms[0] === 'link') {
                        // :link on | off | status | mode <m> | arm [entropy] | fire | abort | token <hex>
                        const sub = String(atoms[1] || '');
                        if (sub === 'on') {
                            if (!link.active) linkActivate();
                            else broadcast({ type: 'sys', msg: 'LINK already active' });
                        } else if (sub === 'off') {
                            linkDeactivate();
                        } else if (sub === 'status') {
                            const deckList = Object.entries(link.decks).map(([id, d]) => ({
                                id, entropy: d.entropy, mode: d.mode,
                                agoSec: Math.round((Date.now() - d.lastSeen) / 1000),
                            }));
                            broadcast({ type: 'linkStatus', deckId: link.deckId, token: link.token,
                                        active: link.active, decks: deckList,
                                        mode: link.mode, armed: [...link.armed] });
                        } else if (sub === 'mode') {
                            const m = String(atoms[2] || 'off');
                            if (['avoid','mirror','complement','off'].includes(m)) {
                                link.mode = m;
                                broadcast({ type: 'param', key: 'linkMode', value: m });
                                if (link.active) link.broadcastState();
                            }
                        } else if (sub === 'arm') {
                            // :link arm  — arm the missile switch; param is captured at fire-time
                            link.armed.add(link.deckId);
                            broadcast({ type: 'linkMissile', event: 'arm',
                                        deck: link.deckId, armed: [...link.armed] });
                            sendLinkMissile('arm', null);
                        } else if (sub === 'fire') {
                            // Capture lastTouchedParam at the moment the switch is flipped
                            const param = state.lastTouchedParam;
                            sendLinkMissile('fire', param);
                            handleLinkMissile({ event: 'fire', deckId: link.deckId, syncParam: param });
                        } else if (sub === 'abort') {
                            link.armed.clear();
                            broadcast({ type: 'linkMissile', event: 'abort' });
                            sendLinkMissile('abort', null);
                        } else if (sub === 'token') {
                            const tok = String(atoms[2] || '');
                            if (tok) {
                                link.token = tok;
                                if (link.active) link.broadcastState();
                                broadcast({ type: 'param', key: 'linkToken', value: tok });
                            }
                        }

                    } else if (atoms[0] === 'resetAll') {
                        // :resetAll — wipe ALL analysis data, index, and library.
                        // Keeps source audio (mp4/wav in data/) and stem audio (data/stems/).
                        // Run the analysis pipeline again after this to rebuild from scratch.
                        // All three of these used to point at different legacy locations
                        // (data/, src/max/, src/) — now that migrateLegacyDataIfNeeded()
                        // has consolidated everything into the active session's dir, all
                        // three collapse to the same sessionDataDir() so :resetAll wipes
                        // the CURRENTLY active session, not a stale default location.
                        const dataDir = sessionDataDir();
                        const maxDir  = sessionDataDir();
                        const srcDir  = sessionDataDir();

                        const wipe = (p, empty) => {
                            try { fs.writeFileSync(p, empty, 'utf8'); } catch(e) {}
                        };
                        const del = (p) => {
                            try { fs.unlinkSync(p); } catch(e) {}
                        };
                        const delGlob = (dir, prefix) => {
                            try {
                                fs.readdirSync(dir)
                                  .filter(f => f.startsWith(prefix))
                                  .forEach(f => del(path.join(dir, f)));
                            } catch(e) {}
                        };

                        // ── data/ ─────────────────────────────────────────
                        wipe(path.join(dataDir, 'downbeats.json'),        '{}');
                        wipe(path.join(dataDir, 'analysis_library.json'), '{}');
                        wipe(path.join(dataDir, 'genres.json'),           '{}');
                        wipe(path.join(dataDir, 'stream.txt'),            '');
                        del( path.join(dataDir, 'ebys.db'));

                        // ── src/max/ ──────────────────────────────────────
                        // Delete ebys_index.json; if locked, wipe to {} as fallback.
                        (() => {
                            const p = path.join(maxDir, 'ebys_index.json');
                            try { fs.unlinkSync(p); Max.post('ws_server: ebys_index.json deleted\n'); }
                            catch(e) {
                                Max.post('ws_server: ebys_index.json delete failed (' + e.code + ') — wiping to {}\n');
                                try { fs.writeFileSync(p, '{}', 'utf8'); } catch(e2) {}
                            }
                        })();
                        del( path.join(maxDir,  'stem_ranges.json'));
                        del( path.join(maxDir,  'umap_coords.json'));
                        wipe(path.join(maxDir,  'dict_analysis.json'),    '{}');
                        wipe(path.join(maxDir,  'analysis_library.json'), '{}');
                        delGlob(maxDir, 'ebys_feed_');

                        // ── src/ duplicates ───────────────────────────────
                        wipe(path.join(srcDir, 'downbeats.json'), '{}');
                        wipe(path.join(srcDir, 'genres.json'),    '{}');

                        // ── notify ────────────────────────────────────────
                        // Write sentinel so resetAllPending survives a patch reload.
                        try { fs.writeFileSync(path.join(maxDir, 'ebys_reset.flag'), '1', 'utf8'); } catch(e) {}
                        resetAllPending = true;   // block stale index saves until new analysis
                        Max.outlet('resetAll');
                        broadcast({ type: 'resetAll' });
                        Max.post('ws_server: resetAll — all data wiped\n');

                    } else if (atoms[0] === 'triggerMode') {
                        // :triggerMode <stem|all> <0|1>
                        // 0 = continuous auto-play, 1 = stem pauses at slice end waiting for trigger
                        const stem = String(atoms[1] || 'all');
                        const val  = parseInt(atoms[2]) ? 1 : 0;
                        broadcast({ type: 'triggerMode', track: stem, value: val });
                        Max.outlet('setTriggerMode', stem, val);

                    } else if (atoms[0] === 'trigger') {
                        // :trigger [stem]  — fire next slice for a paused stem (or all paused stems)
                        const stem = atoms[1] ? String(atoms[1]) : '';
                        if (stem) Max.outlet('trigger', stem);
                        else      Max.outlet('trigger');

                    } else if (atoms[0] === 'next') {
                        // :next [stem]  — force-pick the next slice right now, per stem or all.
                        // Deliberately renamed to 'forceNext' on the way to slicer.js rather
                        // than forwarded as a plain 'next' — that literal message is also what
                        // every stem's own auto-advance delay timer sends when a segment
                        // naturally finishes playing, and slicer.js's next() has a guard (see
                        // its Q2 self-pull fix) that silently no-ops a locked follower already
                        // synced to its leader's current cycle. Correct for the automatic
                        // timer case, wrong for a manual command — the user asking for bass's
                        // next slice should always get a fresh one. forceNext() in slicer.js is
                        // the separate, non-guarded path for that (locked followers advance
                        // their leader instead, keeping the lock intact).
                        const stem = atoms[1] ? String(atoms[1]) : 'all';
                        Max.outlet('forceNext', stem);

                    } else {
                        Max.outlet(...atoms);
                    }
                }  // end command
            } catch(e) {}
        }  // end for...of messages
    });

    socket.on('close', () => {
        clients.delete(socket);
        Max.post('ws_server: TUI disconnected (' + clients.size + ')\n');
        // Last TUI closed — force Max back to a stopped state instead of
        // leaving it (and the descriptor visualizer's transport) running
        // silently in the background. Without this, closing the TUI any way
        // other than :stop-then-:logout (escape key, Ctrl-C, killing the
        // terminal, a crash) left slicer.js's `running` flag exactly as it
        // was, so the NEXT TUI launch would reconnect, get `state.running:
        // true` in the very first 'state' broadcast, and start rendering
        // live playback immediately — looking exactly like the visualizer
        // "started on its own" even though nobody typed :start.
        //
        // Debounced via RUN_ID matching (see pendingStopTimer's own comment
        // above) so this only fires for a real exit, never a same-process
        // watchdog reconnect. stop() is idempotent (no-ops if already
        // stopped) and goes through the same quantized-freeze path as a
        // manual :stop.
        if (clients.size === 0) {
            lastDisconnectedRunId = socket.runId || null;
            if (pendingStopTimer) clearTimeout(pendingStopTimer);
            pendingStopTimer = setTimeout(() => {
                pendingStopTimer = null;
                if (clients.size === 0) Max.outlet('stop');
            }, STOP_ON_DISCONNECT_GRACE_MS);
        }
    });

    socket.on('error', () => { clients.delete(socket); });
});

// Toggling DSP or closing/reopening the patch in quick succession kills the
// previous node.script child process and immediately spawns a new one — but
// the OS doesn't always release a just-closed TCP port instantly (TIME_WAIT/
// lingering close), so the new process used to hit EADDRINUSE and just give
// up, leaving the TUI permanently disconnected until a manual reload. That
// dead WebSocket bridge is one concrete, fixable piece of "the patch is
// fragile on open/close/open" — retry with backoff instead of giving up
// immediately; the port is almost always free within a second or two.
const LISTEN_RETRY_DELAYS_MS = [300, 600, 1200, 2000, 3000]; // ~7s total before giving up
let listenAttempt = 0;

function startServer() {
    server.listen(PORT);
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        if (listenAttempt < LISTEN_RETRY_DELAYS_MS.length) {
            const delay = LISTEN_RETRY_DELAYS_MS[listenAttempt++];
            Max.post('ws_server: port ' + PORT + ' still held by a previous session — retrying in '
                     + delay + 'ms (' + listenAttempt + '/' + LISTEN_RETRY_DELAYS_MS.length + ')\n');
            setTimeout(startServer, delay);
        } else {
            Max.post('ws_server: port ' + PORT + ' still in use after retrying — close other Max '
                     + 'sessions (check Activity Monitor for stray "node" processes) and reload\n');
        }
    } else {
        Max.post('ws_server: server error — ' + err.message + '\n');
    }
});

// Best-effort graceful shutdown — close the HTTP/WS server and drop any open
// sockets immediately instead of letting them linger in the OS's TIME_WAIT
// state, so the *next* node.script instance (patch reopen / DSP retoggle)
// finds the port free right away instead of needing the retry loop above.
function shutdown() {
    try { for (const c of clients) { try { c.destroy(); } catch(e) {} } } catch(e) {}
    try { clients.clear(); } catch(e) {}
    try { server.close(); } catch(e) {}
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('exit',    shutdown);

startServer();

server.on('listening', () => {
    listenAttempt = 0;
    Max.post('ws_server: ready on port ' + PORT + '\n');
    Max.outlet('ws_ready');   // signals the patch to start the meter metro

    // Restore resetAllPending across patch reloads via sentinel file.
    const flagPath = path.join(sessionDataDir(), 'ebys_reset.flag');
    if (fs.existsSync(flagPath)) {
        resetAllPending = true;
        try { fs.unlinkSync(flagPath); } catch(e) {}
        Max.post('ws_server: resetAll flag found — index saves blocked until new analysis\n');
    }

    // Send downbeats.json before the cached index so loadDownbeats() finds data ready.
    // downbeatchunk goes out outlet 0 → route else [24] → slicer.js inlet 0.
    try {
        const dbStr = fs.readFileSync(path.join(sessionDataDir(), 'downbeats.json'), 'utf8');
        const { sid, total } = sendChunked('downbeatchunk', dbStr);
        Max.post('ws_server: downbeats sent (stream ' + sid + ', ' + total + ' chunks)\n');
    } catch(e) {
        Max.post('ws_server: downbeats error — ' + e + '\n');
    }

    // Send learned_bias.json (if train_bias.py has ever produced one) the same
    // way — biaschunk goes out outlet 0 → route else [24] → slicer.js inlet 0.
    // Fine if it doesn't exist yet: loadLearnedBias() treats "never arrived"
    // as "no learned bias yet" and behaves exactly as before.
    try {
        const lbStr = fs.readFileSync(path.join(sessionDataDir(), 'learned_bias.json'), 'utf8');
        const { sid, total } = sendChunked('biaschunk', lbStr);
        Max.post('ws_server: learned_bias sent (stream ' + sid + ', ' + total + ' chunks)\n');
    } catch(e) {
        Max.post('ws_server: no learned_bias.json yet — skipping\n');
    }

    // Send cached index to slicer immediately so it's ready before TUI connects.
    // idxchunk goes out outlet 0 → route else [24] → slicer.js inlet 0.
    const idxPath = path.join(sessionDataDir(), 'ebys_index.json');
    try {
        const idxStr = fs.readFileSync(idxPath, 'utf8');
        JSON.parse(idxStr); // validate before sending — skip if file is corrupted/truncated
        Max.post('ws_server: sending cached index…\n');
        const { sid, total } = sendChunked('idxchunk', idxStr);
        Max.post('ws_server: cached index sent (stream ' + sid + ', ' + total + ' chunks)\n');
    } catch(e) {
        Max.post('ws_server: no cached index — will build on first connect\n');
    }
});

// ── Song structure tagging ──────────────────────────────────────────────────
// Lets a human tag a bar-range of a source track with a structural label
// (intro/verse/chorus/build/drop/bridge/outro/etc) live, while listening, via
// :tag — so the engine eventually has real song-structure data to work with,
// not just spectral distance between adjacent slices. Storage is
// data/song_structure.json, keyed by source track name, same convention as
// downbeats.json/analysis_library.json (canonical current state, overwritten
// in place) — NOT an append-only training log like :bake/:score/
// :scoreTransition use, since a structure tag describes a fact about the
// song rather than a training example about a decision made.
//
// Intensity is computed automatically rather than rated by hand (that was
// the explicit scoping decision) — see computeIntensity() below.
// Resolved fresh on every load/save (not cached) — same reasoning as
// sessionDataDir() above: this process outlives any single session.
function songStructurePath() {
    return path.join(sessionDataDir(), 'song_structure.json');
}

// Not enforced — :tag accepts any label — but Cricket and :listSections both
// treat this as the canonical vocabulary; anything else gets a soft warning.
const STRUCTURE_TAGS = [
    'intro', 'verse', 'pre-chorus', 'chorus', 'build', 'drop',
    'breakdown', 'bridge', 'outro', 'hook', 'interlude',
];

function loadSongStructure() {
    try {
        return JSON.parse(fs.readFileSync(songStructurePath(), 'utf8'));
    } catch (e) {
        return {}; // no file yet (first :tag ever) or unreadable — start fresh
    }
}

function saveSongStructure(data) {
    fs.writeFileSync(songStructurePath(), JSON.stringify(data, null, 2));
}

// findSection — the stored section (if any) covering `frac` (0..1) of
// sourceTrack. Shared by :score (attach a tag to a vertical rating) and
// :scoreTransition (attach tags to both sides of a transition) so both
// mechanisms read the same canonical structure data instead of duplicating
// the lookup.
function findSection(structure, sourceTrack, frac) {
    const entry = structure[sourceTrack];
    if (!entry || !entry.sections) return null;
    for (const sec of entry.sections) {
        if (frac >= sec.startFrac && frac < sec.endFrac) return sec;
    }
    return null;
}

// computeIntensity — averages normalized density + centroid (C) + spread (S)
// across every analyzed slice, on ALL FOUR stems, that falls within
// [startFrac, endFrac) of sourceTrack. Structure is a property of the SONG,
// not of whichever one stem happened to be playing when :tag fired — that
// stem is only used to identify WHICH bar range to tag, not which
// descriptors to average.
//
// C and S are normalized per-source-track (min/max across every slice of
// that track, all 4 stems pooled together) so "the brightest/loudest moment
// of THIS song" anchors 1.0 consistently regardless of which section is
// being tagged — same convention add_stereo_features.py already uses for
// per-stem width normalization. density is already a 0-1 field, used as-is.
//
// NOTE on S: as of this session, S (spectral spread) is a known-broken exact
// duplicate of C for every slice in the library — a buffer~ channel-count
// bug in ebys-analyze.maxpat's spectral-shape feature extraction, not a bug
// in this formula (see the follow-up task tracking that fix). Included here
// anyway per explicit instruction — this improves automatically once the
// analysis pipeline is fixed and re-run; no formula change needed then.
function computeIntensity(sourceTrack, startFrac, endFrac) {
    let lib;
    try {
        lib = JSON.parse(fs.readFileSync(
            path.join(sessionDataDir(), 'analysis_library.json'), 'utf8'));
    } catch (e) {
        return { intensity: null, breakdown: null, error: 'analysis_library.json unreadable: ' + e.message };
    }

    const stemSuffixes = { vocals: '_vocals.wav', melody: '_other.wav', bass: '_bass.wav', drums: '_drums.wav' };
    let cMin = Infinity, cMax = -Infinity, sMin = Infinity, sMax = -Infinity;
    const inRange = [];

    for (const stemName in stemSuffixes) {
        const fileKey  = sourceTrack + stemSuffixes[stemName];
        const stemData = lib[fileKey] && lib[fileKey][stemName];
        if (!stemData || !stemData.slices) continue;
        for (const sid in stemData.slices) {
            const s = stemData.slices[sid];
            if (typeof s.C !== 'number' || typeof s.S !== 'number' || typeof s.time !== 'number') continue;
            if (s.C < cMin) cMin = s.C;
            if (s.C > cMax) cMax = s.C;
            if (s.S < sMin) sMin = s.S;
            if (s.S > sMax) sMax = s.S;
            if (s.time >= startFrac && s.time < endFrac) inRange.push(s);
        }
    }

    if (inRange.length === 0) {
        return { intensity: null, breakdown: null, error: 'no analyzed slices found in that range for ' + sourceTrack };
    }

    const norm = (v, lo, hi) => (hi > lo) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;

    let dSum = 0, cSum = 0, sSum = 0, n = 0;
    for (const s of inRange) {
        dSum += (typeof s.density === 'number') ? s.density : 0.5;
        cSum += norm(s.C, cMin, cMax);
        sSum += norm(s.S, sMin, sMax);
        n++;
    }

    const breakdown = { density: dSum / n, centroid: cSum / n, spread: sSum / n };
    const intensity = (breakdown.density + breakdown.centroid + breakdown.spread) / 3;
    return { intensity, breakdown, sliceCount: n };
}

// ── Library dict pre-loader ───────────────────────────────────────────────────
// Max's JS Dict.readfromfile() is unavailable; instead we read the JSON in Node
// (no size limit) and push it into a named Max dict via Max.setDict().
// slicer.js then opens the same named dict — no file I/O in the JS object needed.
let cachedLibraryData = null;
let buildIndexInProgress = false;

// Max Dict JSON export uses `{}` as a preamble — byte 1 is `}` where standard JSON
// needs `"`. Fix: replace the leading `{}` with `{"` before parsing.
function parseMaxDictJSON(raw) {
    if (raw.charCodeAt(0) === 0x7b && raw.charCodeAt(1) === 0x7d) {
        raw = '{"' + raw.slice(2);
    }
    return JSON.parse(raw);
}

function prepareLibraryDict() {
    const libPath = path.join(sessionDataDir(), 'analysis_library.json');
    const raw  = fs.readFileSync(libPath, 'utf8');
    cachedLibraryData = parseMaxDictJSON(raw);

    // Max.setDict fails for large nested objects (>~1 MB), and Max's built-in
    // JsFile API is capped at 32 767 bytes — both too small for analysis_library.json.
    // Solution: send the JSON string to slicer.js in 2 KB chunks via Max outlet.
    // slicer.js accumulates libchunk messages and parses once all arrive.
    const jsonStr = JSON.stringify(cachedLibraryData);
    const { sid: libSid, total: libTotal } = sendChunked('libchunk', jsonStr);
    Max.post('ws_server: library sent (stream ' + libSid + ', ' + libTotal + ' chunks, ' + jsonStr.length + ' chars)\n');

    // Send genres.json the same way — slicer.js uses it to tag slices for genre filtering.
    try {
        const genresPath = path.join(sessionDataDir(), 'genres.json');
        const genresStr  = fs.readFileSync(genresPath, 'utf8');
        const { sid: gSid, total: gTotal } = sendChunked('genrechunk', genresStr);
        Max.post('ws_server: genres sent (stream ' + gSid + ', ' + gTotal + ' chunks)\n');
    } catch(e) {
        Max.post('ws_server: genres.json not found — genre filtering unavailable\n');
    }

    return Promise.resolve();  // keep .then()/.catch() callers happy
}

// ── Node-side t-SNE (replaces fluid.umap~ — no patch wiring needed) ──────────

function runTSNE(features, opts) {
    opts = opts || {};
    const perplexity = Math.min(opts.perplexity || 30, Math.floor(features.length / 3));
    const nIter = opts.nIter || 250;
    const lr    = opts.lr    || 200;
    const n = features.length;
    const dim = features[0].length;

    if (n < 5) return features.map(() => [(Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1]);

    // Normalise each dimension to [0,1]
    const mins = [], rngs = [];
    for (let j = 0; j < dim; j++) {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < n; i++) {
            if (features[i][j] < mn) mn = features[i][j];
            if (features[i][j] > mx) mx = features[i][j];
        }
        mins.push(mn); rngs.push(mx > mn ? mx - mn : 1);
    }
    const X = features.map(f => f.map((v, j) => (v - mins[j]) / rngs[j]));

    // Pairwise squared distances
    const D2 = Array.from({length: n}, (_, i) =>
        Array.from({length: n}, (_, j) => {
            if (i === j) return 0;
            let s = 0;
            for (let k = 0; k < dim; k++) { const d = X[i][k] - X[j][k]; s += d*d; }
            return s;
        })
    );

    // Conditional probabilities with perplexity-based bandwidth search
    const P = Array.from({length: n}, () => new Array(n).fill(0));
    const logPerp = Math.log(perplexity);
    for (let i = 0; i < n; i++) {
        let lo = -Infinity, hi = Infinity, beta = 1;
        for (let t = 0; t < 50; t++) {
            let sum = 0;
            for (let j = 0; j < n; j++) { if (i !== j) sum += Math.exp(-D2[i][j] * beta); }
            if (sum === 0) sum = 1e-10;
            let H = 0;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const p = Math.exp(-D2[i][j] * beta) / sum;
                if (p > 1e-12) H -= p * Math.log(p);
            }
            const diff = H - logPerp;
            if (Math.abs(diff) < 1e-5) break;
            if (diff > 0) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }
            else          { hi = beta; beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2; }
        }
        let sum = 0;
        for (let j = 0; j < n; j++) { if (i !== j) sum += Math.exp(-D2[i][j] * beta); }
        if (sum === 0) sum = 1e-10;
        for (let j = 0; j < n; j++) P[i][j] = i === j ? 0 : Math.exp(-D2[i][j] * beta) / sum;
    }

    // Symmetrise P_ij = (P_i|j + P_j|i) / 2n, clipped for stability
    const Ps = Array.from({length: n}, (_, i) =>
        Array.from({length: n}, (_, j) => Math.max((P[i][j] + P[j][i]) / (2*n), 1e-12))
    );

    // Random init in low-D
    const Y     = Array.from({length: n}, () => [(Math.random()-0.5)*0.01, (Math.random()-0.5)*0.01]);
    const iY    = Array.from({length: n}, () => [0, 0]);
    const gains = Array.from({length: n}, () => [1, 1]);

    for (let iter = 0; iter < nIter; iter++) {
        const exag = iter < 100 ? 4 : 1;

        // Student-t kernel in low-D
        const num = Array.from({length: n}, (_, i) =>
            Array.from({length: n}, (_, j) => {
                if (i === j) return 0;
                const dx = Y[i][0]-Y[j][0], dy = Y[i][1]-Y[j][1];
                return 1 / (1 + dx*dx + dy*dy);
            })
        );
        let sumQ = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sumQ += num[i][j];
        if (sumQ === 0) sumQ = 1e-10;

        // Gradient
        const dY = Array.from({length: n}, () => [0, 0]);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const pq   = exag * Ps[i][j] - num[i][j] / sumQ;
                const mult = 4 * pq * num[i][j];
                dY[i][0] += mult * (Y[i][0] - Y[j][0]);
                dY[i][1] += mult * (Y[i][1] - Y[j][1]);
            }
        }

        // Update with momentum + adaptive gains
        const mom = iter < 20 ? 0.5 : 0.8;
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < 2; k++) {
                const sameSign = (dY[i][k] > 0) === (iY[i][k] > 0);
                gains[i][k] = sameSign ? Math.max(0.01, gains[i][k] * 0.8) : gains[i][k] + 0.2;
                iY[i][k] = mom * iY[i][k] - lr * gains[i][k] * dY[i][k];
                Y[i][k] += iY[i][k];
            }
        }

        // Re-centre every 50 iters
        if (iter % 50 === 0) {
            let cx = 0, cy = 0;
            for (let i = 0; i < n; i++) { cx += Y[i][0]; cy += Y[i][1]; }
            cx /= n; cy /= n;
            for (let i = 0; i < n; i++) { Y[i][0] -= cx; Y[i][1] -= cy; }
        }
    }
    return Y;
}

function computeAndWriteUMAP() {
    const data = cachedLibraryData;
    if (!data) { Max.post('ws_server: UMAP skipped — no library cached\n'); return; }

    const SUFFIXES = { vocals:'_vocals.wav', melody:'_other.wav', bass:'_bass.wav', drums:'_drums.wav' };
    const topKeys  = Object.keys(data);

    // Build a list of filenames per stem — multi-track: multiple files share the same stem type.
    const stemFiles = { vocals: [], melody: [], bass: [], drums: [] };
    for (const k of topKeys) {
        const kl = k.toLowerCase();
        for (const s in SUFFIXES) {
            if (kl.includes(SUFFIXES[s])) { stemFiles[s].push(k); break; }
        }
    }

    // Extract features synchronously (fast) then hand off to child process
    // so t-SNE doesn't block the event loop (keeps WebSocket connections alive).
    const stems = [];
    const stemRanges = {};

    for (const stem of ['vocals','melody','bass','drums']) {
        const filenames = stemFiles[stem];
        if (!filenames.length) continue;

        const ids = [], features = [];
        const acc = {};
        // 'S' included here even though it isn't one of the t-SNE clustering
        // dims below — this accumulator now doubles as the sole source for
        // stem_ranges.json, so every descriptor the TUI's descriptor grid can
        // display needs a real min/max, not just the ones t-SNE clusters on.
        // (S was previously left out entirely, following a now-stale note in
        // CRICKET.md claiming S duplicated C in the library — checked the
        // current analysis_library.json directly and that's no longer true,
        // every slice has independent C/S values, so there's no reason to
        // withhold a range for it.)
        for (const d of ['C','S','E','F','P','H']) acc[d] = { min: Infinity, max: -Infinity };
        acc['T'] = { min: Infinity, max: -Infinity };

        // Aggregate slices from ALL source tracks for this stem type.
        // Without this, only the last alphabetical track gets t-SNE coords.
        for (const filename of filenames) {
            const stemData = data[filename] && data[filename][stem];
            if (!stemData || !stemData.slices) continue;

            // Prefix slice IDs with filename to keep them unique across tracks.
            const trackKey = filename.replace(/[^a-zA-Z0-9]/g, '_');
            const sliceKeys = Object.keys(stemData.slices).filter(k => k.startsWith('slice_')).sort();

            for (const id of sliceKeys) {
                const sd = stemData.slices[id];
                const M1=parseFloat(sd.M1)||0, M2=parseFloat(sd.M2)||0, M3=parseFloat(sd.M3)||0;
                const M4=parseFloat(sd.M4)||0, M5=parseFloat(sd.M5)||0;
                const T = Math.sqrt((M1*M1+M2*M2+M3*M3+M4*M4+M5*M5)/5);
                ids.push(trackKey + '/' + id);
                features.push([
                    parseFloat(sd.C)||0,
                    parseFloat(sd.E)||-60,
                    parseFloat(sd.F)||0,
                    parseFloat(sd.P)||0,
                    parseFloat(sd.H)||0,
                    T
                ]);
                for (const d of ['C','S','E','F','P','H']) {
                    const v = parseFloat(sd[d]);
                    if (isFinite(v)) { if (v < acc[d].min) acc[d].min=v; if (v > acc[d].max) acc[d].max=v; }
                }
                if (T < acc['T'].min) acc['T'].min=T; if (T > acc['T'].max) acc['T'].max=T;
            }
        }

        // Range coverage no longer piggybacks on the t-SNE stability gate
        // below (features.length < 5) — a min/max is meaningful from even a
        // couple of real slices, it just doesn't need to be statistically
        // robust the way a t-SNE embedding does. Previously a stem like bass
        // with only 2 analyzed slices got skipped entirely here and showed
        // as all-grey in the descriptor grid even though its 2 real values
        // were perfectly good range endpoints. Write the range whenever
        // there's at least one real slice; t-SNE coords remain gated below.
        if (ids.length > 0) stemRanges[stem] = acc;

        if (features.length < 5) continue;

        const nIter = features.length > 400 ? 150 : features.length > 200 ? 200 : 250;
        Max.post('ws_server: t-SNE [' + stem + ']: ' + features.length + ' slices from ' + filenames.length + ' track(s) (' + nIter + ' iters)…\n');
        stems.push({ stem, ids, features, nIter });
    }

    // Write stem_ranges.json immediately (no t-SNE needed).
    const rangesPath = path.join(sessionDataDir(), 'stem_ranges.json');
    fs.writeFileSync(rangesPath, JSON.stringify(stemRanges));
    Max.post('ws_server: stem_ranges.json written\n');

    // Spin up child process for t-SNE via stdin/stdout JSON.
    // stdin/stdout bypasses N4M's IPC interception (N4M monkey-patches process.send
    // and ChildProcess message events for its own Max↔Node comms, which corrupts
    // fork() IPC).  Plain stdio is invisible to N4M.
    const child = spawn(process.execPath, [path.join(__dirname, 'tsne_worker.js')]);
    let outputJson = '';
    child.stdin.write(JSON.stringify({ stems }));
    child.stdin.end();

    child.stdout.on('data', chunk => { outputJson += chunk.toString(); });

    child.stdout.on('end', () => {
        try {
            const results = JSON.parse(outputJson);
            const umapResults = {};
            for (const stem of Object.keys(results)) {
                const { coords, ms } = results[stem];
                umapResults[stem] = coords;
                Max.post('ws_server: t-SNE [' + stem + ']: done in ' + ms + 'ms\n');
            }
            const outPath = path.join(sessionDataDir(), 'umap_coords.json');
            fs.writeFileSync(outPath, JSON.stringify(umapResults));
            Max.post('ws_server: umap_coords.json written\n');
            broadcast({ type: 'umapDone' });
            Max.post('ws_server: umapDone broadcast sent (' + clients.size + ' clients)\n');
            Max.outlet('umapDone');
        } catch(e) {
            Max.post('ws_server: t-SNE result parse error — ' + e + '\n');
        }
        buildIndexInProgress = false;
        resetAllPending = false;   // new analysis complete — allow index saves again
        try { fs.unlinkSync(path.join(sessionDataDir(), 'ebys_reset.flag')); } catch(e) {} // clean up sentinel
    });

    child.stderr.on('data', d => {
        Max.post('ws_server: t-SNE stderr — ' + d.toString().trim() + '\n');
    });

    child.on('error', e => {
        Max.post('ws_server: t-SNE spawn error — ' + e + '\n');
        buildIndexInProgress = false;
    });
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
function broadcast(obj) {
    const frame = encodeFrame(JSON.stringify(obj));
    clients.forEach(s => { try { s.write(frame); } catch(e) {} });
}

// ── Slicer outlet 1 — status messages ────────────────────────────────────────
Max.addHandler('desc', (track, C, S, E, F, P, H, T, tC, tE, tF, tP, tH, tT) => {
    if (!state.stems[track]) return;
    // Snapshot the OUTGOING segment before it's overwritten below — this is
    // the one point where "what was just playing" and "what's about to play"
    // are both still distinguishable, since slicer.js always emits desc
    // before seg for a new segment (established ordering — see the loop-
    // branch comment history). :scoreTransition reads prevSegment to score a
    // transition without needing its own separate before/after tracking.
    if (state.stems[track].id && state.stems[track].id !== '--') {
        state.stems[track].prevSegment = {
            id:          state.stems[track].id,
            sourceTrack: state.stems[track].track,
            sliceStart:  state.stems[track].sliceStart,
            sliceEnd:    state.stems[track].sliceEnd,
            descriptors: {
                C: state.stems[track].C, S: state.stems[track].S, E: state.stems[track].E,
                F: state.stems[track].F, P: state.stems[track].P, H: state.stems[track].H,
                T: state.stems[track].T,
                tension_C: state.stems[track].tC, tension_E: state.stems[track].tE,
                tension_F: state.stems[track].tF, tension_P: state.stems[track].tP,
                tension_H: state.stems[track].tH, tension_T: state.stems[track].tT,
            },
        };
    }
    const tension = (v) => (v === undefined || v === null || v === '') ? null : parseFloat(v);
    Object.assign(state.stems[track], {
        C: parseFloat(C)||0, S: parseFloat(S)||0, E: parseFloat(E)||0,
        F: parseFloat(F)||0, P: parseFloat(P)||0,
        H: parseFloat(H)||0, T: parseFloat(T)||0,
        tC: tension(tC), tE: tension(tE), tF: tension(tF),
        tP: tension(tP), tH: tension(tH), tT: tension(tT),
    });
    // 'desc' type lets the TUI compute novelty the instant fresh descriptors arrive
    broadcast({ type: 'desc', name: track, ...state.stems[track] });
});

Max.addHandler('seg', async (track, id, durStr, distStr, startFrac, endFrac) => {
    if (!state.stems[track]) return;
    state.stems[track].id = String(id);
    if (startFrac !== undefined) state.stems[track].sliceStart = parseFloat(startFrac);
    if (endFrac   !== undefined) state.stems[track].sliceEnd   = parseFloat(endFrac);
    broadcast({ type: 'stem', name: track, ...state.stems[track] });

    // Log slice to tipping backend for artist duration tracking
    // handlePlayback (outlet 0) fires before seg (outlet 1), so segDurMs is already set
    // Skip in direct mode — no artist split, no slice tracking needed
    if (state.sessionId && state.sessionDeck !== 'direct' && state.stems[track].track && state.stems[track].segDurMs > 0) {
        try {
            await fetch(`${TIPPING_URL}/slices/log`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    sessionId: state.sessionId,
                    trackName: state.stems[track].track,
                    durationMs: state.stems[track].segDurMs,
                }),
            });
        } catch(e) {
            Max.post('ws_server: slice log error — ' + e.message + '\n');
        }
    }
});

Max.addHandler('track_name', (...args) => {
    state.track = args.join(' ');
    broadcast({ type: 'state', running: state.running,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
    // Pre-populate all stem track fields so the name shows immediately (before playback)
    ['vocals', 'melody', 'bass', 'drums'].forEach(stem => {
        state.stems[stem].track = state.track;
        broadcast({ type: 'stemTrack', name: stem, track: state.track });
    });
});

Max.addHandler('globalBPM', (n) => {
    state.globalBPM = parseFloat(n) || 0;
    broadcast({ type: 'param', key: 'globalBPM', value: n });
    updatePingTimer();  // BPM changed — restart ping interval
});

// slicer.js emits "need_downbeats" from loadbang() every time it loads/reloads,
// and now also from a manual :reloadDownbeats. Re-send downbeats.json chunks
// so trackDownbeats is repopulated. Broadcast to the TUI too — previously
// this only ever posted to the Max console, which is invisible from the TUI,
// so a manual reload had no visible confirmation it did anything at all.
Max.addHandler('need_downbeats', () => {
    try {
        const dbPath = path.join(sessionDataDir(), 'downbeats.json');
        const dbStr  = fs.readFileSync(dbPath, 'utf8');
        const { sid, total } = sendChunked('downbeatchunk', dbStr);
        Max.post('ws_server: downbeats re-sent on request (stream ' + sid + ', ' + total + ' chunks)\n');
        broadcast({ type: 'sys', msg: '↻ downbeats.json re-read from disk (' + total + ' chunk(s) sent to slicer.js)' });
    } catch(e) {
        Max.post('ws_server: need_downbeats — ' + e + '\n');
        broadcast({ type: 'sys', msg: '✗ downbeats reload failed — ' + e.message });
    }
});

// slicer.js emits "need_learnedBias" from loadbang() every reload, and again
// from a manual :reloadBias (e.g. after :trainBias finishes). Same round trip
// as need_downbeats above — real Node fs read, re-sent as biaschunk.
Max.addHandler('need_learnedBias', () => {
    try {
        const lbPath = path.join(sessionDataDir(), 'learned_bias.json');
        const lbStr  = fs.readFileSync(lbPath, 'utf8');
        const { sid, total } = sendChunked('biaschunk', lbStr);
        Max.post('ws_server: learned_bias re-sent on request (stream ' + sid + ', ' + total + ' chunks)\n');
        broadcast({ type: 'sys', msg: '↻ learned_bias.json re-read from disk (' + total + ' chunk(s) sent to slicer.js)' });
    } catch(e) {
        Max.post('ws_server: need_learnedBias — ' + e + '\n');
        broadcast({ type: 'sys', msg: '✗ learned_bias.json not found yet — run :trainBias first' });
    }
});

// slicer.js's loadDownbeats() reports what it actually found (or didn't) via
// outlet(1, "sysMsg", "..."). Generic passthrough to the TUI's log pane —
// see msg.type === 'sys' in app.js.
Max.addHandler('sysMsg', (...parts) => {
    broadcast({ type: 'sys', msg: parts.join(' ') });
});


// slicer.js emits: outlet(1, "playFullFile", track|"all", 0|1) — from an
// explicit :chunkMode, or implicitly whenever :setSegmentBars is used
// (that command always clears it for the affected stem(s)). Drives the TUI's
// [CHUNK MODE ON/OFF] header indicator.
Max.addHandler('playFullFile', (track, v) => {
    broadcast({ type: 'playFullFile', track: String(track), value: parseInt(v) ? 1 : 0 });
});

// slicer.js emits: outlet(1, "setWindow", normalizedType) — after :setWindow
// forwards through buffer_manager.js/slot_router.js to the actual pfft~/gizmo~
// pitch shifter. Broadcasting as a generic 'param' with key 'window' reuses
// the TUI's existing param-handling (see app.js's keyMap: window → envelope),
// so the header's "win:" readout picks this up with no extra wiring needed.
Max.addHandler('setWindow', (type) => {
    broadcast({ type: 'param', key: 'window', value: String(type) });
});

// slicer.js emits: outlet(1, "segmentBars", track, N)
Max.addHandler('segmentBars', (track, n) => {
    const t    = String(track);
    const bars = parseFloat(n) || 8;
    if (state.segBars.hasOwnProperty(t)) state.segBars[t] = bars;
    // TUI listens for type:'segmentBars', not type:'param' — must match exactly.
    broadcast({ type: 'segmentBars', track: t, value: bars });
});

Max.addHandler('stemTrack', (stem, trackName) => {
    if (!state.stems[stem]) return;
    state.stems[stem].track = String(trackName || '');
    broadcast({ type: 'stemTrack', name: String(stem), track: String(trackName || '') });
});

// Emitted by slicer.js's setStemSource() whenever a stem is pinned/unpinned
// to a specific source track (outlet(1, "stemSource", track, name)). "any"
// means unpinned. Stored so the TUI can show a pin indicator per stem, and so
// a reconnecting client picks up the current pin state instead of assuming
// nothing is pinned.
Max.addHandler('stemSource', (stem, name) => {
    if (!state.stems[stem]) return;
    const pinned = String(name || 'any');
    state.stems[stem].pinnedSource = (pinned.toLowerCase() === 'any') ? null : pinned;
    broadcast({ type: 'stemSource', name: String(stem), pinnedSource: state.stems[stem].pinnedSource });
});

Max.addHandler('stemDurMs', (track, ms) => {
    const m = parseFloat(ms) || 0;
    // Store in server state so it survives being spread into future seg broadcasts.
    // Without this, every seg broadcast would clobber the TUI's durMs with 0.
    if (state.stems[track]) state.stems[track].durMs = m;
    broadcast({ type: 'stemDurMs', track: String(track), ms: m });
});

Max.addHandler('slice_ms', (track, ms) => {
    broadcast({ type: 'slice_ms', name: String(track), timeMs: parseFloat(ms) || 0 });
});

Max.addHandler('ready', (n) => {
    broadcast({ type: 'state', running: state.running,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
});

Max.addHandler('stopped', () => {
    state.running = false;
    broadcast({ type: 'state', running: false,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
    // Separate 'stopped' broadcast so the TUI can arm its pause-duration
    // rebase (see app.js's msg.type === 'stopped' handler). The 'state'
    // broadcast above only flips state.running — it doesn't tell the TUI
    // a real quantized freeze just landed.
    broadcast({ type: 'stopped' });
});

// slicer.js fires outlet(1, "resumed") when :start resumes playback from a
// paused/stopped position (as opposed to a fresh start). Previously this
// Max message had no handler at all, so it was silently dropped — the TUI
// never rebased its elapsed-time references by the real pause duration,
// which is what made the on-screen playhead jump after a stop/start cycle
// even though the audio itself resumed correctly.
Max.addHandler('resumed', () => {
    state.running = true;
    broadcast({ type: 'resumed' });
});

// slicer.js's self-rescheduling downbeatPulseTask fires this on every real
// downbeat while playing (see scheduleDownbeatPulse()) — phase-locked to
// the actual music via lastSegment.dispatchedAtMs, not a free-running
// client-side timer. The TUI uses this to reset anything meant to
// represent "the current bar" (the descriptor grid's rolling window) in
// sync with the music instead of an approximate bpm-only guess.
Max.addHandler('downbeat', () => {
    broadcast({ type: 'downbeat', ts: Date.now() });
});

// slicer.js emits "started" after all selectSegment calls in start().
// Lets TUI reset its stopped flag and restart the progress-bar render loop.
Max.addHandler('started', () => {
    state.running = true;
    broadcast({ type: 'started' });
});

// slicer.js fires segmentEnd from next(track) the instant the Max delay expires.
// That is the exact moment karma~ finishes — ground truth for the TUI bar.
Max.addHandler('segmentEnd', (track) => {
    broadcast({ type: 'segmentEnd', name: String(track) });
});

// slicer.js fires segPlayMs (outlet 1) with the actual playback duration:
//   actualPlayMs = totalFrac × durMs × stretchRatio
// This is what karma~ physically plays and what the TUI bar should match.
// Overwrites the coarser snapSegDurMs stored by handlePlayback.
Max.addHandler('segPlayMs', (track, ms) => {
    const m = parseFloat(ms) || 0;
    if (state.stems[track] && m > 0) state.stems[track].segDurMs = m;
    broadcast({ type: 'segPlayMs', name: String(track), ms: m });
});

// slicer.js fires segRetime (outlet 1) from applyGlobalBPMLive() whenever a
// live :setGlobalBPM/:setFallbackBPM change retimes whatever's CURRENTLY
// playing for this stem. Deliberately not folded into state.stems[track]
// here — remainingMs is "time left from now," not a segDurMs the progress-
// bar math can use directly; the TUI has to rebase its own elapsed-since-
// start reference against it to keep the fill continuous instead of
// snapping. Just relay it.
Max.addHandler('segRetime', (track, remainingMs) => {
    const m = parseFloat(remainingMs) || 0;
    if (m > 0) broadcast({ type: 'segRetime', name: String(track), remainingMs: m });
});

// ── Slicer outlet 0 — playback triggers ──────────────────────────────────────
// New format (v2 multi-track): track  slot  startFrac  endFrac  stretchRatio  segDurMs
// After Max routes by stem name, args here are: slot startFrac endFrac stretchRatio segDurMs
function handlePlayback(track, slot, startFrac, stretchRatio, segDurMs) {
    if (!state.stems[track]) return;
    // slot = source track index (int); startFrac = 0–1 position in source buffer
    state.stems[track].pos  = parseFloat(startFrac) || 0;
    state.stems[track].slot = parseInt(slot) || 0;
    // NOTE: deliberately NOT storing segDurMs here anymore (see below) — this
    // is the raw, UNSTRETCHED pre-stretch value (segDurMsForOutlet in
    // slicer.js), not the real wall-clock segment duration. The accurate
    // stretched value arrives moments later via segPlayMs (outlet 1).
    //
    // Set running on first playback from ANY stem — not just vocals.
    // Vocals may have few bar-aligned slices and not fire reliably.
    if (!state.running) {
        state.running = true;
        broadcast({ type: 'state', running: true,
                    track: state.track, bpm: state.bpm,
                    key: state.key, slices: state.slices });
    }
    // Deliberately NOT broadcasting a 'stem' message here. The TUI treats
    // EVERY 'stem' broadcast as ground truth that a brand new segment just
    // started and resets that stem's progress-bar timer unconditionally (see
    // sdj-tui.js's 'stem' handler comment). outlet 0 (here) and outlet 1's
    // "seg" message (handled below, Max.addHandler('seg', ...)) both fire for
    // every single segment, moments apart — broadcasting 'stem' from BOTH
    // meant the TUI reset the timer TWICE per segment: once here, using the
    // rough/unstretched segDurMs above (before it's corrected), and once more
    // a beat later when "seg" arrives with the accurate segPlayMs already
    // applied. Two competing "this just started" signals per segment, one of
    // them carrying transiently-wrong duration data, is exactly the kind of
    // race that can leave the bar showing a stale fill against the real
    // (differently-timed) audio. "seg" is the single, authoritative signal
    // that a new segment started — outlet 0 firing first is just a routing
    // step (buffer_manager.js's compose→play handoff), not a musically
    // meaningful event on its own. pos/slot/segDurMs are still written to
    // state.stems[track] above/via segPlayMs below; the next "seg" broadcast
    // picks up all of it via its own full-state spread.
}
Max.addHandler('vocals', (slot, startFrac, endFrac, stretchRatio, segDurMs) => { handlePlayback('vocals', slot, startFrac, stretchRatio, segDurMs); });
Max.addHandler('melody', (slot, startFrac, endFrac, stretchRatio, segDurMs) => { handlePlayback('melody', slot, startFrac, stretchRatio, segDurMs); });
Max.addHandler('bass',   (slot, startFrac, endFrac, stretchRatio, segDurMs) => { handlePlayback('bass',   slot, startFrac, stretchRatio, segDurMs); });
Max.addHandler('drums',  (slot, startFrac, endFrac, stretchRatio, segDurMs) => { handlePlayback('drums',  slot, startFrac, stretchRatio, segDurMs); });

// ── State / meta ──────────────────────────────────────────────────────────────
Max.addHandler('state', (running) => {
    state.running = (parseInt(running) !== 0);
    broadcast({ type: 'state', running: state.running,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
});

Max.addHandler('meta', (...args) => {
    if (args.length < 3) return;
    const prevBpm = state.bpm;
    state.key   = String(args[args.length - 1]);
    state.bpm   = parseFloat(args[args.length - 2])||0;
    state.track = args.slice(0, args.length - 2).join(' ');
    broadcast({ type: 'state', running: state.running,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
    if (state.bpm !== prevBpm) updatePingTimer();  // BPM changed — restart ping interval
});

Max.addHandler('slices', (v, m, b, d) => {
    state.slices = [parseInt(v)||0, parseInt(m)||0, parseInt(b)||0, parseInt(d)||0];
    broadcast({ type: 'state', running: state.running,
                track: state.track, bpm: state.bpm,
                key: state.key, slices: state.slices });
});

Max.addHandler('param', (key, value) => {
    broadcast({ type: 'param', key, value });
});

// ── Entropy feedback (from slicer.js outlet 1) ───────────────────────────────
// slicer emits: outlet(1, "entropy", e, matchProb, stayProb, dirWeight)
// when setEntropy() is called internally (e.g. auto-temperature drive in future).
Max.addHandler('entropy', (e, mp, sp, dw) => {
    const ev = Math.min(1, Math.max(0, parseFloat(e) || 0));
    state.entropy = ev;
    broadcast({ type: 'param', key: 'entropy', value: ev,
                matchProb:  parseFloat(mp) || 0,
                stayProb:   parseFloat(sp) || 0,
                dirWeight:  parseFloat(dw) || 0 });
    if (link.active) link.broadcastState();
});

// stayProb feedback (slicer emits when individual stem stayProb changes)
Max.addHandler('stayProb', (track, val) => {
    // TUI listens for type:'stayProb', not type:'param' — must match exactly.
    broadcast({ type: 'stayProb', track: String(track), value: parseFloat(val) || 0 });
});

// matchProb feedback — slicer.js now emits outlet(1, "matchProb", stem, value)
// (per-stem, was a single global value before). Broadcast under a per-stem
// key (matchProb_<stem>) so the TUI's :wmdScope switcher can tell them apart.
Max.addHandler('matchProb', (stem, val) => {
    broadcast({ type: 'param', key: 'matchProb_' + stem, value: parseFloat(val) || 0 });
});

// ── LINK protocol ─────────────────────────────────────────────────────────────
//
// Layer 1  — clock sync (implemented in slicer.js bar-grid quantisation)
// Layer 2  — arc visibility: each deck broadcasts entropy + stem state over UDP
//            multicast; remote deck state appears in TUI sidebar
// Missile  — two-key launch: :link arm [e]  then :link fire → all armed decks
//            simultaneously set entropy to the armed value
// Layer 3  — selection sync (avoid/mirror/complement): mode is broadcast with
//            every state packet; slicer.js integration is future work

const LINK_MULTICAST = '239.255.1.1';
const LINK_PORT      = 9999;

const link = {
    active:         false,
    socket:         null,
    decks:          {},          // { deckId: { entropy, stems, mode, lastSeen } }
    token:          null,        // shared session token — decks with same token sync
    deckId:         'deck_' + crypto.randomBytes(3).toString('hex'),
    armed:          new Set(),   // deckIds that have pressed arm

    mode:           'off',       // Layer 3: off | avoid | mirror | complement
    timer:          null,
    cleanTimer:     null,
    broadcastState: () => {},    // overwritten in linkActivate
};

function linkActivate() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    link.token = link.token || crypto.randomBytes(4).toString('hex');

    sock.bind(LINK_PORT, () => {
        try { sock.addMembership(LINK_MULTICAST); } catch(e) {
            Max.post('ws_server: LINK multicast join failed — ' + e.message + '\n');
        }
        sock.setMulticastTTL(4);
        link.socket = sock;
        link.active = true;
        Max.post('ws_server: LINK on — id=' + link.deckId + ' token=' + link.token + '\n');
        broadcast({ type: 'link', event: 'on', deckId: link.deckId, token: link.token });
        link.broadcastState();
    });

    sock.on('message', (buf) => {
        try {
            const msg = JSON.parse(buf.toString());
            if (!msg || msg.token !== link.token) return;
            if (msg.deckId === link.deckId) return;   // own echo

            if (msg.type === 'link_state') {
                link.decks[msg.deckId] = { ...msg, lastSeen: Date.now() };
                // Layer 2: send remote deck arc to TUI
                broadcast({ type: 'linkDeck', deck: msg.deckId,
                            entropy: msg.entropy, stems: msg.stems,
                            mode: msg.mode, ts: msg.ts });
            } else if (msg.type === 'link_missile') {
                handleLinkMissile(msg);
            }
        } catch(e) {}
    });

    sock.on('error', (e) => {
        Max.post('ws_server: LINK socket error — ' + e.message + '\n');
    });

    // Broadcast own state every 2 s (Layer 2 heartbeat)
    link.broadcastState = () => {
        if (!link.active || !link.socket) return;
        const msg = JSON.stringify({
            type:    'link_state',
            token:   link.token,
            deckId:  link.deckId,
            entropy: state.entropy,
            stems:   state.stems,
            mode:    link.mode,
            ts:      Date.now(),
        });
        const buf = Buffer.from(msg);
        link.socket.send(buf, LINK_PORT, LINK_MULTICAST, () => {});
    };
    link.timer      = setInterval(link.broadcastState, 2000);

    // Evict stale decks (no heartbeat for 10 s)
    link.cleanTimer = setInterval(() => {
        const now = Date.now();
        for (const id of Object.keys(link.decks)) {
            if (now - link.decks[id].lastSeen > 10000) {
                delete link.decks[id];
                link.armed.delete(id);
                broadcast({ type: 'linkDeck', deck: id, event: 'disconnected' });
                Max.post('ws_server: LINK deck timed out — ' + id + '\n');
            }
        }
    }, 5000);
}

function linkDeactivate() {
    if (!link.active) return;
    clearInterval(link.timer);
    clearInterval(link.cleanTimer);
    try { link.socket.dropMembership(LINK_MULTICAST); link.socket.close(); } catch(e) {}
    link.socket = null;
    link.active = false;
    link.decks  = {};
    link.armed.clear();
    link.broadcastState = () => {};
    broadcast({ type: 'link', event: 'off' });
    Max.post('ws_server: LINK off\n');
}

function sendLinkMissile(event, syncParam) {
    if (!link.active || !link.socket) return;
    const msg = JSON.stringify({
        type:      'link_missile',
        token:     link.token,
        deckId:    link.deckId,
        event,
        syncParam: syncParam || null,   // atoms array of last touched param
        ts:        Date.now(),
    });
    const buf = Buffer.from(msg);
    link.socket.send(buf, LINK_PORT, LINK_MULTICAST, () => {});
}

function applyMissileParam(param) {
    if (!param || !param.length) return;
    // Re-enter the command through the normal outlet path so all local state
    // is updated correctly (eq_router, spat_fx_router, slicer, etc.)
    Max.outlet(...param);
    broadcast({ type: 'linkMissile', event: 'fire_executed', syncParam: param });
    Max.post('ws_server: LINK missile fired — ' + param.join(' ') + '\n');
}

function handleLinkMissile(msg) {
    if (msg.event === 'arm') {
        link.armed.add(msg.deckId);
        broadcast({ type: 'linkMissile', event: 'arm',
                    deck: msg.deckId, armed: [...link.armed] });
        Max.post('ws_server: LINK arm — ' + msg.deckId + '\n');

    } else if (msg.event === 'abort') {
        link.armed.clear();
        broadcast({ type: 'linkMissile', event: 'abort' });
        Max.post('ws_server: LINK abort\n');

    } else if (msg.event === 'fire') {
        // No arm required — just fire: apply the sender's last touched param immediately
        link.armed.clear();
        applyMissileParam(msg.syncParam);
    }
}

// ── VU metering ───────────────────────────────────────────────────────────────
// Patch sends: meter <stem>_<channel> <level>
//   stem    = vocals | melo | bass | drums | master | live1 | live2
//   channel = FL | FR | RL | RR  (4 spatial channels per stem)
//   level   = 0–1 linear peak amplitude (from peakamp~ 4096)
// We aggregate the 4 channels into one peak per stem and broadcast to TUI.
// "melo" is remapped to "melody" to match TUI vuLevels keys.
const VU_CHANNELS = { FL: true, FR: true, RL: true, RR: true };
const VU_REMAP    = { melo: 'melody' };
const vuAccum     = {};  // { stemName: { FL: level, FR: level, ... } }

Max.addHandler('meter', (...args) => {
    if (args.length < 2) return;  // metro beat tick — discard

    const rawName = String(args[0]);
    const level   = parseFloat(args[1]) || 0;

    // Split "vocals_FL" → stem="vocals", channel="FL"
    const u = rawName.lastIndexOf('_');
    if (u > 0 && VU_CHANNELS[rawName.slice(u + 1)]) {
        let stem    = rawName.slice(0, u);
        stem        = VU_REMAP[stem] || stem;
        const chan  = rawName.slice(u + 1);
        if (!vuAccum[stem]) vuAccum[stem] = {};
        vuAccum[stem][chan] = level;
        // Broadcast all 4 channels so TUI can show per-channel meters
        const acc = vuAccum[stem];
        broadcast({ type: 'vu', name: stem,
            FL: acc.FL || 0, FR: acc.FR || 0,
            RL: acc.RL || 0, RR: acc.RR || 0 });
    } else {
        // No spatial suffix — pass through with name remapping
        const name = VU_REMAP[rawName] || rawName;
        broadcast({ type: 'vu', name, level });
    }
});

// ── LUFS metering ─────────────────────────────────────────────────────────────
// Format: lufs <short> <integrated>
//   short      = short-term loudness in dBFS  (snapshot~ outlet 0 of fluid.loudness~)
//   integrated = integrated loudness in dBFS  (snapshot~ outlet 1 of fluid.loudness~)
// Sampled by metro 100 (10 Hz) — perceptual loudness, frequency-weighted (K-weight).
// Distinct from 'meter' (peakamp~, linear amplitude, per stem).
// TUI uses this for the LUFS / dBFS header readout.
Max.addHandler('lufs', (short, integrated) => {
    broadcast({ type: 'lufs', short: parseFloat(short) || -Infinity, integrated: parseFloat(integrated) || -Infinity });
});

// ── Waveform taps ────────────────────────────────────────────────────────────
// The patch taps each mono-summed source (master + the 4 stems) and emits its
// signed peak pair per frame: `wavePos <name> <+peak>` and `waveNeg <name>
// <|-peak|>`. They arrive as a pair each frame; we cache the +peak and, on the
// matching -peak, broadcast one {type:'wave', name, pos, neg} to the TUI, which
// draws the asymmetric waveform. name = master | vocals | melody | bass | drums.
const _wavePos = {};
Max.addHandler('wavePos', (name, v) => { _wavePos[String(name)] = parseFloat(v) || 0; });
Max.addHandler('waveNeg', (name, v) => {
    const n = String(name);
    broadcast({ type: 'wave', name: n, pos: _wavePos[n] || 0, neg: parseFloat(v) || 0 });
});

// ── Index cache save (from slicer.js outlet 1) ───────────────────────────────
// slicer sends saveIdxChunk messages after each buildIndex; Node writes to disk.
// Format: saveIdxChunk  streamId  chunkIndex  total  data
// resetAllPending blocks saves until a genuine new buildIndex completes.
let saveIdxBuf = null, saveIdxTotal = 0, saveIdxReceived = 0, saveIdxSid = -1;
let resetAllPending = false;

// Recovery for the post-:resetAll wedge: resetAll sets resetAllPending (and
// drops ebys_reset.flag) to block stale index saves until a fresh analysis
// finishes. Normally the TUI's completeAnalysis clears it — but if the analysis
// completes while the TUI is disconnected, it never clears, and the index stays
// permanently un-saveable ("analyzed on disk but 0 tracks"). Any successful
// buildIndex from a NON-EMPTY library is proof the system has real content
// again, so we clear the block here regardless of who saw the analysis finish.
function clearResetPendingIfPopulated() {
    if (!resetAllPending) return;
    try {
        const lib = parseMaxDictJSON(fs.readFileSync(
            path.join(sessionDataDir(), 'analysis_library.json'), 'utf8'));
        if (lib && Object.keys(lib).length > 0) {
            resetAllPending = false;
            try { fs.unlinkSync(path.join(sessionDataDir(), 'ebys_reset.flag')); } catch(e) {}
            Max.post('ws_server: resetAll block cleared — library populated, index saves re-enabled\n');
        }
    } catch(e) {}
}
Max.addHandler('saveIdxChunk', (streamId, i, total, ...dataParts) => {
    const data = dataParts.join(' ');
    const sid  = parseInt(streamId);
    const ti   = parseInt(total), ii = parseInt(i);
    if (!saveIdxBuf || saveIdxSid !== sid) {
        if (saveIdxBuf && saveIdxSid !== sid) {
            Max.post('ws_server: saveIdxChunk stream reset (was ' + saveIdxSid + ', now ' + sid + ') — ' + saveIdxReceived + '/' + saveIdxTotal + ' chunks dropped\n');
        }
        saveIdxBuf      = new Array(ti);
        saveIdxTotal    = ti;
        saveIdxSid      = sid;
        saveIdxReceived = 0;
    }
    if (saveIdxBuf[ii] !== undefined) return; // duplicate chunk — ignore
    saveIdxBuf[ii] = data;
    saveIdxReceived++;
    if (saveIdxReceived === saveIdxTotal) {
        const jsonStr = saveIdxBuf.join('');
        saveIdxBuf = null;
        if (resetAllPending) {
            Max.post('ws_server: ebys_index.json save blocked — resetAll pending (run analysis to rebuild)\n');
            return;
        }
        try {
            fs.writeFileSync(path.join(sessionDataDir(), 'ebys_index.json'), jsonStr);
            Max.post('ws_server: ebys_index.json saved (stream ' + sid + ', ' + jsonStr.length + ' chars)\n');
        } catch(e) {
            Max.post('ws_server: index save failed — ' + e + '\n');
        }
    }
});

Max.addHandler('sourceTrack', (slot, ...nameParts) => {
    // slicer.js outlet(1, "sourceTrack", slot, trackName) — tells TUI which source track
    // is loaded into each slot so it can display track names per stem.
    const name = nameParts.join(' ');
    broadcast({ type: 'sourceTrack', slot: parseInt(slot), name });
});

// slicer.js outlet(1, "lockSource", follower, leader) / outlet(1, "unlockSource", stem|"all")
// — the AUTHORITATIVE lock state, confirmed by slicer.js itself (not just an
// optimistic echo of the command as it was sent). Previously nothing listened
// for these at all, so the TUI never actually knew whether a lock had taken —
// it only showed what was requested, not what was applied. Both the default
// bass→melody lock (announced at :start) and any manual :lockSource/:unlockSource
// now reach the TUI through this single confirmed path.
Max.addHandler('lockSource', (follower, leader) => {
    broadcast({ type: 'param', key: 'sourceLock', follower: String(follower), leader: String(leader) });
});
Max.addHandler('unlockSource', (stem) => {
    broadcast({ type: 'param', key: 'sourceLock', follower: String(stem), leader: null });
});

// Silence unhandled-message log — slicer.js emits this when it needs stem durations
Max.addHandler('need_stemDurs', () => {});

Max.addHandler('index_empty', () => {
    broadcast({ type: 'sys', msg: '⚠ index empty — send :buildIndex before :start' });
});

// stemMS — slicer.js emits this after each selectSegment() with analysis-driven
// pan/width for the chosen slice.  Forward to spat_fx_router via outlet 0, and
// broadcast to TUI so it can show live pan/width per stem.
Max.addHandler('stemMS', (track, pan, width) => {
    const t = String(track);
    const p = parseFloat(pan)   || 0;
    const w = parseFloat(width) || 0;
    // Forward to spat_fx_router — it receives all ws_server outlet 0 messages.
    // Message format: stemMS <track> <pan> <width>
    // spat_fx_router.stemMS(track, pan, width) → applyPan + applyWidth
    Max.outlet('stemMS', t, p, w);
    broadcast({ type: 'param', key: 'stemMS', track: t, pan: p, width: w });
});

// streamUpdated — sent when streamWatcher detects stream.txt changed.
// genre + madmom are already written to disk; FluCoMa is about to start.
Max.addHandler('streamUpdated', () => {
    broadcast({ type: 'streamUpdated' });
});

// analysisDone — sent by analyze_reader when all FluCoMa stems are done.
// Stops the TUI spinner that was started by :analyzeAll.
Max.addHandler('analysisDone', () => {
    state.analysisDone = true;
    broadcast({ type: 'analysisDone' });
});

// umapDone — slicer.js finished writing umap_coords.json; tell TUI to reload.
Max.addHandler('umapDone', () => {
    broadcast({ type: 'umapDone' });
});

// resetMemory: TUI → ws_server → Max patch → slice_writer.js + analyze_reader.js
Max.addHandler('resetMemory', () => {
    // Clear the done-flag too: the library is being wiped, so a later
    // queryAnalysisDone poll (or a reconnect) must NOT report the pre-reset
    // analysis as still complete — that would make the TUI's next :analyzeAll
    // spinner stop instantly at ~0% before the new run actually finishes.
    // The real 'analysisDone' from the fresh run sets it true again.
    state.analysisDone = false;
    Max.outlet('resetMemory');
});

Max.post('ws_server.js loaded\n');
