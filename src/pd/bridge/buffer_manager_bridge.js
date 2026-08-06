#!/usr/bin/env node
// buffer_manager_bridge.js — pure file-system/session-lookup half of the
// original Max `js buffer_manager.js` object (see src/max/buffer_manager.js
// for the real, un-scoped-down source this was ported from).
//
// buffer_manager.js does two very different kinds of work: (a) live
// buffer~/array manipulation -- triggering src_N_stem loads, running
// fluid.bufcompose~ ring/bake copies, tracking the two-level ring-buffer
// state machine and the multi-stem sync barrier -- and (b) plain
// file-system/session bookkeeping -- remembering which library "slot"
// index maps to which track name (sourceTrack registrations), and turning
// that + the session's htdemucs folder layout into a concrete file path.
// (a) has to stay native Pd, same "touches live buffer~/array data" rule
// used to split analyze_reader.js and slice_writer.js. (b) has zero live
// buffer access and is exactly the kind of thing every other bridge in
// this project already handles -- so it lives here instead, and native Pd
// (buffer_manager.pd / buffer_manager_stem.pd) asks this process to
// resolve a path instead of doing HT_PATH/SUFFIXES string-building itself.
//
// Platform glue, same conventions as every other bridge in this project:
//   patcher.filepath              -> --data-dir, same session-aware
//                                    getSessionId()/getDataDir() convention
//                                    as every other bridge (all resolve to
//                                    the identical session folder).
//   Max's js auto-dispatch        -> explicit DISPATCH table.
//   outlet(N, ...)                -> one OSC address per outlet, matching
//                                    every other bridge's pattern (see OUT).
//
// Run:
//   node buffer_manager_bridge.js --data-dir /path/to/EBYS/data \
//     --recv-port 9008 --send-port 9009
const fs = require("fs");
const path = require("path");
const { OscUdpPort } = require("./osc.js");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dataDir = args["data-dir"] || process.env.EBYS_DATA_DIR;
const recvPort = parseInt(args["recv-port"] || "9008", 10); // Pd -> here
const sendPort = parseInt(args["send-port"] || "9009", 10); // here -> Pd

if (!dataDir) {
  console.error("buffer_manager_bridge: need --data-dir (or EBYS_DATA_DIR env var)");
  process.exit(1);
}

function post(msg) {
  console.log(msg.replace(/\n$/, ""));
}

// ── data dir resolution (session-aware, re-read every call, same
// reasoning/convention as every other bridge) ────────────────────────────
function getSessionId() {
  try {
    const id = fs.readFileSync(path.join(dataDir, "current_session.txt"), "utf8").trim();
    return id || "default";
  } catch (e) {
    return "default";
  }
}
function getDataDir() {
  return path.join(dataDir, "sessions", getSessionId());
}
function htPath() {
  return path.join(getDataDir(), "stems", "htdemucs");
}

// Same short-name -> filename-suffix map as buffer_manager.js's own SUFFIXES.
const SUFFIXES = { voc: "_vocals.wav", drm: "_drums.wav", bss: "_bass.wav", mel: "_other.wav" };

// ── OSC transport ─────────────────────────────────────────────────────
const OUT = {
  status: "/bufMgrStatusOut",
  gotPath: "/bufMgrGotPathOut",
};
let osc;
function sendStatus(...parts) {
  osc.send(
    OUT.status,
    parts.map((p) => (typeof p === "number" ? { type: "f", value: p } : { type: "s", value: String(p) }))
  );
}
function sendGotPath(sh, sourceSlot, filePath) {
  osc.send(OUT.gotPath, [
    { type: "s", value: String(sh) },
    { type: "f", value: sourceSlot },
    { type: "s", value: filePath },
  ]);
}

// ── slot -> track name map (mirrors buffer_manager.js's slotToTrack) ────
var slotToTrack = {};

// sourceTrack <slotIdx> <name...> — registers a library slot's track name.
// Forwarded here by buffer_manager.pd whenever it sees this message arrive
// from bridge_slicer (slicer_bridge.js is the original source of these --
// see its own buildIndex()/loadIndexFromDisk() outlet(1,"sourceTrack",...)
// calls). Kept as a separate registry here rather than round-tripping to
// slicer_bridge.js, since this bridge is the one that actually needs it
// (path construction), same "each bridge owns what it needs" pattern as
// slice_writer_bridge.js owning analysis_library.json.
function sourceTrack() {
  const a = Array.prototype.slice.call(arguments);
  if (a.length < 1) return;
  const slotIdx = parseInt(a[0]);
  const name = a.slice(1).map(String).join(" ");
  slotToTrack[slotIdx] = name;
  post("buffer_manager_bridge: slot " + slotIdx + " = '" + name + "'\n");
  sendStatus("registered", slotIdx, name);
}

// resolvePath <sh> <sourceSlot> — asks for the on-disk path of a given
// stem short-name (voc/drm/bss/mel) at a given library slot. Replies with
// gotPath so native Pd (buffer_manager_stem.pd) can feed it straight into
// a soundfiler read, same pattern as stem_loader.pd. This is the direct
// port of buffer_manager.js's loadSrc() path-building — everything in
// that function EXCEPT the actual `outlet(..., "read", path, ...)` send
// (which stays native Pd, since it's a live buffer~/array write).
function resolvePath(sh, sourceSlot) {
  sh = String(sh);
  sourceSlot = parseInt(sourceSlot);
  const trackName = slotToTrack[sourceSlot];
  const suffix = SUFFIXES[sh];
  if (!suffix) {
    post("buffer_manager_bridge: resolvePath -- unknown stem short-name '" + sh + "'\n");
    return;
  }
  if (!trackName) {
    post("buffer_manager_bridge: no name for sourceSlot " + sourceSlot + " -- send buildIndex first\n");
    sendStatus("error", "resolvePath", "no_name", sh, sourceSlot);
    return;
  }
  const filePath = path.join(htPath(), trackName, trackName + suffix);
  post("buffer_manager_bridge: resolved " + sh + " slot " + sourceSlot + " (" + trackName + ") -> " + filePath + "\n");
  sendGotPath(sh, sourceSlot, filePath);
}

function resetMemory() {
  slotToTrack = {};
  post("buffer_manager_bridge: slot registry cleared\n");
  sendStatus("cleared");
}

// ── DISPATCH TABLE ────────────────────────────────────────────────────────
var DISPATCH = {
  sourceTrack: sourceTrack,
  resolvePath: resolvePath,
  resetMemory: resetMemory,
};

osc = new OscUdpPort({
  sendPort,
  listenPort: recvPort,
  onMessage: (msg) => {
    const fn = DISPATCH[msg.address];
    if (!fn) {
      post("buffer_manager_bridge: no handler for '" + msg.address + "'\n");
      return;
    }
    try {
      fn.apply(null, msg.args);
    } catch (e) {
      post("buffer_manager_bridge: handler for '" + msg.address + "' threw -- " + e + "\n");
    }
  },
});

console.log(
  `buffer_manager_bridge: data-dir=${dataDir}  listening on ${recvPort} (from Pd)  sending to ${sendPort} (to Pd)`
);
