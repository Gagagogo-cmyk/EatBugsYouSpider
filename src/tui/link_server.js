// EBYS LINK Server  v1
//
// ── What this is ─────────────────────────────────────────────────────────────
// A standalone Node.js process that runs alongside sdj-tui.js on the same
// machine. It bridges two EBYS units over a direct ethernet or WiFi connection
// using plain UDP packets.
//
// You never need to touch this file for normal use. Start it with:
//   node link_server.js --unit A          (this unit = A, peer = B)
//   node link_server.js --unit B          (this unit = B, peer = A)
//
// If your peer's mDNS hostname isn't exactly "unitA.local"/"unitB.local" (see
// below), override it directly instead of renaming the Mac:
//   node link_server.js --unit A --peer-host somethingElse.local
//
// ── Network topology ─────────────────────────────────────────────────────────
//   Unit A: unitA.local   →→→  UDP 9000  →→→  Unit B: unitB.local
//   Unit B: unitB.local   →→→  UDP 9000  →→→  Unit A: unitA.local
//
//   Both units listen on the same port 9000 for incoming peer packets.
//   Peers are found by mDNS/Bonjour hostname (<name>.local), NOT a hardcoded
//   IP — this works over Wi-Fi or a direct ethernet cable exactly the same
//   way, and keeps working even if DHCP hands out a new IP mid-session. Each
//   Mac's own "Local Hostname" needs to be set to unitA / unitB respectively:
//   System Settings → General → Sharing → (i) next to Local hostname → Edit.
//
// ── Local IPC (link_server ↔ sdj-tui.js) ────────────────────────────────────
//   sdj-tui.js  →  link_server   : UDP 127.0.0.1:9001   (TOUCH / MISSILE / etc.)
//   link_server →  sdj-tui.js    : UDP 127.0.0.1:9002   (incoming peer params)
//
// ── Packet format (peer wire protocol) ───────────────────────────────────────
//   EBYS1 <unitId> SET  <key> <value>
//   EBYS1 <unitId> DUMP <key=value> <key=value> ...
//   EBYS1 <unitId> PING
//   EBYS1 <unitId> PONG
//
//   Examples:
//     EBYS1 A SET tempo 128.50
//     EBYS1 A SET weight_vocals_C 0.80
//     EBYS1 A DUMP tempo=128.5 entropy=0.6 weight_vocals_C=0.8 dir_vocals_C=1.0
//     EBYS1 A PING
//
// ── IPC message format (local, sdj-tui.js → link_server) ────────────────────
//   TOUCH <key> <value>      — user moved a parameter (tracks last-touched)
//   MISSILE                  — missile switch tapped (send last param to peer)
//   MISSILE_HOLD             — missile switch held 2s (send full state dump)
//   MISSILE_SCOPE <scope>    — set what MISSILE_HOLD sends (all|weights|dirs|single)
//   MISSILE_KEY <key>        — narrow MISSILE to a specific key (single descriptor mode)
//   LINK_ON                  — enable forwarding incoming peer params to TUI
//   LINK_OFF                 — disable forwarding (units drift freely)
//   PING                     — send a ping to peer
//
// ── Missile switch scopes (for MISSILE_HOLD) ─────────────────────────────────
//   all              → full state dump (tempo + entropy + all weights + all dirs)
//   weights <stem>   → all 7 descriptor weights for one stem
//   dirs <stem>      → all 7 descriptor dirs for one stem
//   single <key>     → one specific key (e.g. weight_vocals_C)
//   last             → same as tap: just the last touched param
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const dgram  = require('dgram');
const dns    = require('dns');
const process = require('process');

// ── Config ────────────────────────────────────────────────────────────────────

// Peer identified by mDNS/Bonjour hostname, not a hardcoded static IP — see
// resolvePeer()'s own comment for why this is what actually lets the same
// code work over either Wi-Fi or a direct ethernet cable. Each unit's Mac
// needs its own Local Hostname (System Settings → General → Sharing) set to
// exactly this name so it answers to <name>.local on the network.
const UNIT_HOSTNAMES = { A: 'unitA.local', B: 'unitB.local' };
const PEER_PORT = 9000;   // UDP port for peer comms
const IPC_IN    = 9001;   // sdj-tui.js → link_server (commands)
const IPC_OUT   = 9002;   // link_server → sdj-tui.js (incoming params)
const PROTOCOL  = 'EBYS1';
// How often to re-resolve the peer's hostname to an IP. Not a one-time
// lookup at startup — DHCP can hand either unit a new address mid-session
// (rejoining Wi-Fi, router lease renewal, etc.), and re-resolving on a timer
// is what makes that transparent instead of silently talking to a stale IP.
const PEER_RESOLVE_INTERVAL = 5000;

// ── Parse args ────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    let unit = 'A';
    let peerHost = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--unit'      && args[i+1]) unit     = args[++i].toUpperCase();
        if (args[i] === '--peer-host' && args[i+1]) peerHost = args[++i];
    }
    if (!UNIT_HOSTNAMES[unit] && !peerHost) {
        console.error(`[LINK] Unknown unit "${unit}". Use --unit A or --unit B (or pass --peer-host <name>.local directly)`);
        process.exit(1);
    }
    const peer = unit === 'A' ? 'B' : 'A';
    return { unit, peerHostname: peerHost || UNIT_HOSTNAMES[peer] };
}

const { unit, peerHostname } = parseArgs();
console.log(`[LINK] Unit ${unit} — peer hostname "${peerHostname}" (resolving...)`);

// Resolved peer IP, refreshed by resolvePeer() below. Starts null —
// sendToPeer() just no-ops (see its own guard) until the first successful
// resolution lands, instead of crashing on a missing address.
let peerIp = null;

// ── mDNS/Bonjour peer resolution ─────────────────────────────────────────────
// dns.lookup() on a "<name>.local" hostname delegates to the OS's own mDNS
// resolver — Bonjour/mDNSResponder on macOS, avahi on Linux if installed —
// no extra package needed. That's what makes this work identically whether
// the two units are on the same Wi-Fi network or joined by a direct
// ethernet cable: mDNS discovery happens over whatever link-local broadcast
// domain the two machines currently share, and dns.lookup() doesn't need to
// know or care which physical medium that is. Whatever dynamic IP DHCP (or
// link-local self-assignment on a cableonly connection, see the file-level
// comment on that) handed the peer, <name>.local always resolves to it.
function resolvePeer() {
    dns.lookup(peerHostname, { family: 4 }, (err, address) => {
        if (err) {
            if (peerIp === null) {
                console.log(`[LINK] Waiting for "${peerHostname}" to appear on the network... (${err.code})`);
            }
            return; // keep the last known-good peerIp (if any) on a transient miss
        }
        if (address !== peerIp) {
            console.log(`[LINK] Peer "${peerHostname}" → ${address}` + (peerIp ? ` (was ${peerIp})` : ''));
            peerIp = address;
        }
    });
}
resolvePeer();
setInterval(resolvePeer, PEER_RESOLVE_INTERVAL);

// ── State ─────────────────────────────────────────────────────────────────────

// Last parameter the user touched (for missile switch tap)
let lastTouched = null;   // { key, value }

// Running copy of all parameters we know about (for full dump)
const state = {};

// Missile scope: what MISSILE_HOLD sends
let missileScope = 'all';   // 'all' | 'weights <stem>' | 'dirs <stem>' | 'single <key>' | 'last'
let missileKey   = null;    // used when missileScope = 'single'
let missileStem  = null;    // used when missileScope = 'weights' or 'dirs'

// Whether to forward incoming peer params to the TUI
let linkEnabled = true;

// Peer connection status
let peerAlive     = false;
let lastPingSent  = 0;
let lastPongRecv  = 0;

// ── Sockets ───────────────────────────────────────────────────────────────────

// Peer socket: sends and receives on port 9000
const peerSock = dgram.createSocket('udp4');

// IPC input socket: receives commands from sdj-tui.js on port 9001
const ipcIn = dgram.createSocket('udp4');

// IPC output socket: sends incoming peer params to sdj-tui.js on port 9002
const ipcOut = dgram.createSocket('udp4');

// ── Send helpers ──────────────────────────────────────────────────────────────

function sendToPeer(msg) {
    if (!peerIp) return; // no peer resolved yet — see resolvePeer()'s own comment
    const buf = Buffer.from(msg + '\n');
    peerSock.send(buf, 0, buf.length, PEER_PORT, peerIp, (err) => {
        if (err) console.error('[LINK] peer send error:', err.message);
    });
}

function sendToTui(msg) {
    const buf = Buffer.from(msg + '\n');
    ipcOut.send(buf, 0, buf.length, IPC_OUT, '127.0.0.1', (err) => {
        if (err) console.error('[LINK] TUI send error:', err.message);
    });
}

// ── Wire packet builders ──────────────────────────────────────────────────────

function packetSet(key, value) {
    return `${PROTOCOL} ${unit} SET ${key} ${value}`;
}

function packetDump(kvObj) {
    const pairs = Object.keys(kvObj)
        .map(k => `${k}=${kvObj[k]}`)
        .join(' ');
    return `${PROTOCOL} ${unit} DUMP ${pairs}`;
}

function packetPing() { return `${PROTOCOL} ${unit} PING`; }
function packetPong() { return `${PROTOCOL} ${unit} PONG`; }

// ── State helpers ─────────────────────────────────────────────────────────────

const DESCRIPTORS = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];
const STEMS       = ['vocals', 'melody', 'bass', 'drums'];

function weightsForStem(stem) {
    const out = {};
    DESCRIPTORS.forEach(d => {
        const k = `weight_${stem}_${d}`;
        if (state[k] !== undefined) out[k] = state[k];
    });
    return out;
}

function dirsForStem(stem) {
    const out = {};
    DESCRIPTORS.forEach(d => {
        const k = `dir_${stem}_${d}`;
        if (state[k] !== undefined) out[k] = state[k];
    });
    return out;
}

function fullDump() {
    // Return a filtered subset of state: tempo, entropy, all weights, all dirs
    const out = {};
    const GLOBAL_KEYS = ['tempo', 'entropy', 'matchProb'];
    GLOBAL_KEYS.forEach(k => { if (state[k] !== undefined) out[k] = state[k]; });
    STEMS.forEach(stem => {
        Object.assign(out, weightsForStem(stem));
        Object.assign(out, dirsForStem(stem));
    });
    return out;
}

// ── Missile switch logic ──────────────────────────────────────────────────────

function fireMissile() {
    // Tap: send last touched parameter
    if (!lastTouched) {
        console.log('[LINK] Missile fired — nothing touched yet, skip');
        return;
    }
    const pkt = packetSet(lastTouched.key, lastTouched.value);
    sendToPeer(pkt);
    console.log(`[LINK] MISSILE → ${pkt}`);
}

function fireMissileHold() {
    // Hold: send a larger payload based on current scope
    let dump = {};

    if (missileScope === 'all' || missileScope === 'last') {
        if (missileScope === 'last' && lastTouched) {
            dump[lastTouched.key] = lastTouched.value;
        } else {
            dump = fullDump();
        }
    } else if (missileScope === 'weights' && missileStem) {
        dump = weightsForStem(missileStem);
    } else if (missileScope === 'dirs' && missileStem) {
        dump = dirsForStem(missileStem);
    } else if (missileScope === 'single' && missileKey) {
        if (state[missileKey] !== undefined) dump[missileKey] = state[missileKey];
    }

    if (Object.keys(dump).length === 0) {
        console.log('[LINK] MISSILE_HOLD — nothing to send for scope:', missileScope);
        return;
    }

    const pkt = packetDump(dump);
    sendToPeer(pkt);
    console.log(`[LINK] MISSILE_HOLD (${missileScope}) → ${Object.keys(dump).length} params`);
}

// ── Parse incoming peer packets ───────────────────────────────────────────────

function handlePeerPacket(msg, rinfo) {
    const line = msg.toString().trim();
    const parts = line.split(' ');

    // Validate header
    if (parts[0] !== PROTOCOL) return;
    const senderId = parts[1];
    const type     = parts[2];

    // Ignore our own packets (loop protection)
    if (senderId === unit) return;

    if (type === 'PING') {
        sendToPeer(packetPong());
        console.log(`[LINK] PING from ${senderId} → PONG`);
        return;
    }

    if (type === 'PONG') {
        peerAlive   = true;
        lastPongRecv = Date.now();
        console.log(`[LINK] PONG from ${senderId} — peer alive`);
        return;
    }

    if (!linkEnabled) return;   // ignore data packets when link is off

    if (type === 'SET') {
        // EBYS1 B SET tempo 128.5
        const key   = parts[3];
        const value = parts[4];
        if (!key || value === undefined) return;
        applyIncoming(key, value);
        return;
    }

    if (type === 'DUMP') {
        // EBYS1 B DUMP tempo=128.5 entropy=0.6 weight_vocals_C=0.8
        for (let i = 3; i < parts.length; i++) {
            const eq  = parts[i].indexOf('=');
            if (eq < 0) continue;
            const key   = parts[i].slice(0, eq);
            const value = parts[i].slice(eq + 1);
            applyIncoming(key, value);
        }
        return;
    }

    console.log(`[LINK] Unknown packet type "${type}" from ${senderId}`);
}

function applyIncoming(key, value) {
    // Forward to sdj-tui.js so it applies the param locally
    const msg = `SET ${key} ${value}`;
    sendToTui(msg);
    console.log(`[LINK] ← ${key} ${value}`);
}

// ── Parse IPC commands from sdj-tui.js ───────────────────────────────────────

function handleIpcCommand(msg) {
    const line  = msg.toString().trim();
    const parts = line.split(' ');
    const cmd   = parts[0];

    if (cmd === 'TOUCH') {
        // TOUCH weight_vocals_C 0.80
        const key   = parts[1];
        const value = parts[2];
        if (!key || value === undefined) return;
        lastTouched  = { key, value };
        state[key]   = value;
        return;
    }

    if (cmd === 'MISSILE') {
        fireMissile();
        return;
    }

    if (cmd === 'MISSILE_HOLD') {
        fireMissileHold();
        return;
    }

    if (cmd === 'MISSILE_SCOPE') {
        // MISSILE_SCOPE all
        // MISSILE_SCOPE weights vocals
        // MISSILE_SCOPE dirs bass
        // MISSILE_SCOPE single weight_vocals_C
        missileScope = parts[1] || 'all';
        missileStem  = parts[2] || null;
        missileKey   = parts[2] || null;   // for 'single', key is second arg
        console.log(`[LINK] Missile scope: ${missileScope} ${missileStem || ''}`);
        return;
    }

    if (cmd === 'LINK_ON') {
        linkEnabled = true;
        console.log('[LINK] Link enabled — incoming params will apply');
        return;
    }

    if (cmd === 'LINK_OFF') {
        linkEnabled = false;
        console.log('[LINK] Link disabled — units drifting freely');
        return;
    }

    if (cmd === 'PING') {
        sendToPeer(packetPing());
        lastPingSent = Date.now();
        console.log(`[LINK] PING → ${peerIp}`);
        return;
    }

    console.log(`[LINK] Unknown IPC command: ${cmd}`);
}

// ── Keepalive ping ────────────────────────────────────────────────────────────

const PING_INTERVAL  = 5000;    // ping peer every 5s
const PEER_TIMEOUT   = 15000;   // consider peer dead after 15s without PONG

setInterval(() => {
    sendToPeer(packetPing());
    lastPingSent = Date.now();

    if (peerAlive && (Date.now() - lastPongRecv) > PEER_TIMEOUT) {
        peerAlive = false;
        console.log('[LINK] Peer timed out');
        sendToTui('PEER_OFFLINE');
    }
}, PING_INTERVAL);

// ── Bind sockets ──────────────────────────────────────────────────────────────

peerSock.on('message', handlePeerPacket);
peerSock.on('error',   (err) => console.error('[LINK] peer socket error:', err.message));
peerSock.bind(PEER_PORT, () => {
    console.log(`[LINK] Listening for peer on port ${PEER_PORT}`);
});

ipcIn.on('message', handleIpcCommand);
ipcIn.on('error',   (err) => console.error('[LINK] IPC socket error:', err.message));
ipcIn.bind(IPC_IN, () => {
    console.log(`[LINK] Listening for TUI commands on port ${IPC_IN}`);
});

// ipcOut doesn't need to bind — it only sends
ipcOut.bind(0, () => {
    console.log(`[LINK] IPC output ready (→ TUI port ${IPC_OUT})`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT',  () => { console.log('\n[LINK] Shutting down'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[LINK] Shutting down'); process.exit(0); });

console.log(`[LINK] EBYS LINK ready — Unit ${unit} — peer hostname "${peerHostname}" (IP resolves async, see above)`);
