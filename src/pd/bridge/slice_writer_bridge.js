#!/usr/bin/env node
// slice_writer_bridge.js — Node.js replacement for the Max `js
// slice_writer.js` object, talking to Pd over OSC/UDP instead of Max's
// inline outlet() calls / Dict object. Logic is a faithful, line-for-line
// port of the original (same bug fixes already baked into the source
// preserved verbatim, see the comments on saveLibrary()/loadLibrary()
// below) -- only the platform glue changed:
//
//   - `File` (Max's built-in file I/O)         -> Node's `fs` module.
//   - `patcher.filepath`                       -> --data-dir / EBYS_DATA_DIR,
//     same convention as streamWatcher_bridge.js.
//   - `Task`/`.schedule(ms)`                   -> `setTimeout`.
//   - `post(...)`                              -> `console.log(...)`.
//   - `outlet(N, ...)` (multi-outlet js object) -> a small dispatch table
//     keyed by outlet number, each sending a distinct single-segment OSC
//     message (see OUTLET_ADDR below).
//   - Max's js auto-dispatch-by-message-name (sending "set_vocals_time 0.4"
//     to inlet 0 auto-calls set_vocals_time(0.4)) has no Node equivalent,
//     so it's reimplemented explicitly as the DISPATCH table at the bottom
//     of this file -- same approach already documented as the plan in
//     CONVERSION_NOTES.md and used by every other bridge in this project.
//
// outlet(0, "replace"/"clear", ...) in the original fed a Max `dict
// analysisLib` object (used by analyze_reader.js's readRegistryFile() via
// `new Dict("analysisLib")`, and by slicer.js to traverse "f::a::b::c"
// paths). Pd has no dict equivalent, so this bridge does NOT forward
// those messages over OSC to Pd -- there is nothing on the Pd side that
// could meaningfully consume a "replace" message. Instead this bridge is
// simply the single source of truth for analysis_library.json (exactly
// like the original `library` JS variable + saveLibrary()/loadLibrary()
// already were) -- when analyze_reader.js gets its own bridge (see
// CONVERSION_NOTES.md "Remaining bridge work"), it should read the SAME
// analysis_library.json file directly instead of trying to reach into a
// dict that no longer exists.
//
// Run:
//   node slice_writer_bridge.js --data-dir /path/to/EBYS/data \
//     --recv-port 9002 --send-port 9003
// (--recv-port must match bridge_sliceWriter.pd's [netsend] "connect"
//  message target; --send-port must match its [netreceive] port)
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
const recvPort = parseInt(args["recv-port"] || "9002", 10); // Pd -> here
const sendPort = parseInt(args["send-port"] || "9003", 10); // here -> Pd

if (!dataDir) {
  console.error("slice_writer_bridge: need --data-dir (or EBYS_DATA_DIR env var)");
  process.exit(1);
}

function post(msg) {
  console.log(msg.replace(/\n$/, ""));
}

// ── data dir resolution (session-aware, re-read every call -- same
// reasoning as every other file in this project: the TUI can switch
// sessions while this process keeps running) ────────────────────────────
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
function getLibraryPath() {
  const p = path.join(getDataDir(), "analysis_library.json");
  post("EBYS SliceWriter: library path = " + p + "\n");
  return p;
}

// ── OSC transport ─────────────────────────────────────────────────────
// outbound (bridge -> Pd) addresses, single-segment, matching the
// existing streamWatcherBang convention.
const OUT = {
  totalSlices: "totalSlices", // was outlet(1, n)
  lastSliceId: "lastSliceId", // was outlet(2, "voc:slice_0001")
  trackExistsResult: "trackExistsResult", // was outlet(3, 0|1)
};
// `osc` is assigned once, near the bottom of this file, after DISPATCH
// (below) is fully built -- these three helpers are only ever called from
// inside a message handler or the startup loadLibrary() task (scheduled
// 2s out), both of which run well after that assignment, so referencing
// the not-yet-assigned `let osc` here is safe (same pattern as a normal
// hoisted function declaration closing over a module-level variable).
let osc;
function sendTotalSlices(n) {
  osc.send(OUT.totalSlices, [{ type: "f", value: n }]);
}
function sendLastSliceId(id) {
  osc.send(OUT.lastSliceId, [{ type: "s", value: id }]);
}
function sendTrackExistsResult(v) {
  osc.send(OUT.trackExistsResult, [{ type: "f", value: v }]);
}

// ── GLOBAL CONFIG (verbatim from slice_writer.js) ────────────────────────
var BPM_MIN_CONFIDENCE = 0.0;
var track_name = "";
var skipIfExists = false;

function set_bpm_gate(v) {
  BPM_MIN_CONFIDENCE = parseFloat(v);
  post(
    "EBYS: BPM gate -> " +
      BPM_MIN_CONFIDENCE +
      (BPM_MIN_CONFIDENCE === 0.0 ? " (disabled)" : "") +
      "\n"
  );
}

// ── PERSISTENT LIBRARY (verbatim logic from slice_writer.js) ─────────────
var library = {};
var forgottenTracks = {};

function wr(key, value) {
  if (track_name !== "") {
    library[track_name][key] = value;
  }
}

function flatToNested(flat) {
  var result = {};
  for (var k in flat) {
    var parts = k.split("::");
    var obj = result;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== "object" || obj[parts[i]] === null) {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = flat[k];
  }
  return result;
}

function nestedToFlat(obj, prefix, out) {
  for (var k in obj) {
    var p = prefix ? prefix + "::" + k : k;
    if (typeof obj[k] === "object" && obj[k] !== null) {
      nestedToFlat(obj[k], p, out);
    } else {
      out[p] = obj[k];
    }
  }
}

// resetMemory — clears in-memory library, overwrites JSON file with {}.
function resetMemory() {
  library = {};
  forgottenTracks = {};
  try {
    fs.writeFileSync(getLibraryPath(), "{}", "utf8");
  } catch (e) {}
  post("EBYS SliceWriter: memory cleared -- library wiped\n");
}

// saveLibrary — writes `library` to analysis_library.json.
//
// BUG (already found + fixed in the original, preserved here verbatim):
// this used to trust `library` completely and overwrite the WHOLE file
// with just its contents -- not a merge, not an append. Now: read
// whatever's currently on disk first, and keep any track key `library`
// has no opinion on (i.e. wasn't intentionally removed via forgetTrack()
// this process -- see forgottenTracks) -- this can now only ever ADD or
// UPDATE a track, never silently drop one it simply doesn't know about.
function saveLibrary() {
  try {
    var nested = {};
    for (var tn in library) {
      nested[tn] = flatToNested(library[tn]);
    }
    try {
      var existingRaw = fs.readFileSync(getLibraryPath(), "utf8");
      var existing = JSON.parse(existingRaw);
      for (var etn in existing) {
        if (!nested.hasOwnProperty(etn) && !forgottenTracks.hasOwnProperty(etn)) {
          nested[etn] = existing[etn];
        }
      }
    } catch (mergeErr) {
      post("EBYS SliceWriter: save merge-read skipped -- " + mergeErr + "\n");
    }
    var str = JSON.stringify(nested);
    fs.mkdirSync(path.dirname(getLibraryPath()), { recursive: true });
    fs.writeFileSync(getLibraryPath(), str, "utf8");
    post("EBYS SliceWriter: saved " + str.length + " chars to library\n");
  } catch (e) {
    post("EBYS SliceWriter: save failed -- " + e + "\n");
  }
}

function loadLibrary() {
  try {
    var raw;
    try {
      raw = fs.readFileSync(getLibraryPath(), "utf8");
    } catch (e) {
      post("EBYS SliceWriter: no library file found -- starting fresh\n");
      return;
    }
    var parsed = JSON.parse(raw);
    library = {};
    var trackCount = 0,
      sliceCount = 0;
    for (var tn in parsed) {
      library[tn] = {};
      nestedToFlat(parsed[tn], "", library[tn]);
      for (var key in library[tn]) {
        if (key.indexOf("::time") !== -1) sliceCount++;
      }
      trackCount++;
    }
    post("EBYS SliceWriter: restored " + trackCount + " tracks, " + sliceCount + " slices from library\n");
    sendTotalSlices(sliceCount);
  } catch (e) {
    post("EBYS SliceWriter: library load failed -- " + e + "\n");
  }
}

function trackExists() {
  var name = Array.prototype.slice.call(arguments).map(String).join("_");
  var exists = library.hasOwnProperty(name) && Object.keys(library[name]).length > 0;
  post("EBYS SliceWriter: trackExists('" + name + "') = " + (exists ? 1 : 0) + "\n");
  sendTrackExistsResult(exists ? 1 : 0);
}

function forgetTrack() {
  var name = Array.prototype.slice.call(arguments).map(String).join("_");
  if (library.hasOwnProperty(name)) {
    delete library[name];
    forgottenTracks[name] = true;
    saveLibrary();
    post("EBYS SliceWriter: removed '" + name + "' from library\n");
  } else {
    post("EBYS SliceWriter: forgetTrack -- '" + name + "' not found\n");
  }
}

function set_track_name() {
  track_name = Array.prototype.slice.call(arguments).map(String).join("_");
  skipIfExists =
    track_name !== "" && library.hasOwnProperty(track_name) && Object.keys(library[track_name]).length > 0;
  if (!skipIfExists && track_name !== "") library[track_name] = {};
  post(
    "EBYS: track='" +
      track_name +
      "' " +
      (skipIfExists ? "EXISTS -- skipping writes" : "NEW -- analyzing") +
      "\n"
  );
  sendTrackExistsResult(skipIfExists ? 1 : 0); // -> sel 0 1 in patch: 0=reset+analyze, 1=skip
}

// ── KEY DETECTION (Krumhansl-Schmuckler 1982) -- verbatim from original ──
var KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
var KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
var KS_PENT_MINOR = [7.0, 1.5, 1.5, 5.0, 1.5, 4.5, 1.5, 6.0, 1.5, 1.5, 4.0, 1.5];
var KS_PENT_MAJOR = [7.0, 1.5, 4.5, 1.5, 5.0, 1.5, 1.5, 6.0, 1.5, 4.0, 1.5, 1.5];
var SCALE_LABELS = [" major", " minor", " pent.minor", " pent.major"];
var SCALE_PROFILES = [KS_MAJOR, KS_MINOR, KS_PENT_MINOR, KS_PENT_MAJOR];
var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function pearson(x, y) {
  var n = 12,
    sx = 0,
    sy = 0,
    i;
  for (i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  var mx = sx / n,
    my = sy / n;
  var num = 0,
    dx2 = 0,
    dy2 = 0;
  for (i = 0; i < n; i++) {
    var dx = x[i] - mx,
      dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  var denom = Math.sqrt(dx2 * dy2);
  return denom < 1e-9 ? 0.0 : num / denom;
}

function detectKey(pitches) {
  if (pitches.length < 3) return "unknown";
  var hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var totalWeight = 0;
  for (var i = 0; i < pitches.length; i++) {
    var hz = pitches[i][0];
    var lufs = pitches[i][1];
    if (hz < 40.0 || lufs < -40.0) continue;
    var weight = lufs + 80.0;
    if (weight <= 0) continue;
    var midi = 69 + 12 * (Math.log(hz / 440.0) / Math.log(2));
    var pc = ((Math.round(midi) % 12) + 12) % 12;
    hist[pc] += weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return "unknown";

  var rootScore = new Array(12);
  var rootKey = new Array(12);
  var best = { score: -Infinity, key: "unknown", root: 0 };
  for (var root = 0; root < 12; root++) {
    var rotHist = [];
    for (var j = 0; j < 12; j++) rotHist.push(hist[(j + root) % 12]);
    var topS = -Infinity,
      topL = 0;
    for (var p = 0; p < SCALE_PROFILES.length; p++) {
      var s = pearson(rotHist, SCALE_PROFILES[p]);
      if (s > topS) {
        topS = s;
        topL = p;
      }
    }
    rootScore[root] = topS;
    rootKey[root] = NOTE_NAMES[root] + SCALE_LABELS[topL];
    if (topS > best.score) {
      best.score = topS;
      best.key = rootKey[root];
      best.root = root;
    }
  }

  var maxPc = 0;
  for (var k = 1; k < 12; k++) if (hist[k] > hist[maxPc]) maxPc = k;
  if (best.root !== maxPc && best.score - rootScore[maxPc] < 0.08) {
    return rootKey[maxPc];
  }
  return best.key;
}

function topPcs(pitches) {
  var hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var i = 0; i < pitches.length; i++) {
    var hz = pitches[i][0],
      lufs = pitches[i][1];
    if (hz < 40.0 || lufs < -40.0) continue;
    var w = lufs + 80.0;
    if (w <= 0) continue;
    var pc = ((Math.round(69 + 12 * (Math.log(hz / 440.0) / Math.log(2))) % 12) + 12) % 12;
    hist[pc] += w;
  }
  var out = [];
  for (var t = 0; t < 3; t++) {
    var mv = -1,
      mi = 0;
    for (var p = 0; p < 12; p++)
      if (hist[p] > mv) {
        mv = hist[p];
        mi = p;
      }
    if (mv <= 0) break;
    out.push(NOTE_NAMES[mi] + "=" + Math.round(mv));
    hist[mi] = -1;
  }
  return out.join(",");
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = "0" + s;
  return s;
}

// ── Per-stem state, data-driven (same field set as the original's 4
// hand-duplicated blocks -- drums has no P, matching STEM_CFG below) ─────
var STEM_CFG = {
  vocals: { hasP: true, prefix: "voc" },
  melo: { hasP: true, prefix: "melo" },
  bass: { hasP: true, prefix: "bass" },
  drum: { hasP: false, prefix: "drum" },
};
var FIELDS = ["time", "C", "S", "P", "E", "F", "H", "M0", "M1", "M2", "M3", "M4", "M5"];

var state = {};
var counters = { vocals: 0, melo: 0, bass: 0, drum: 0 };
var pitches = { vocals: [], melo: [], bass: [] }; // drums excluded, no P
var meta = {}; // meta[stem] = {bpm, conf, durMs}

for (var stemName in STEM_CFG) {
  state[stemName] = {};
  for (var fi = 0; fi < FIELDS.length; fi++) state[stemName][FIELDS[fi]] = 0.0;
  meta[stemName] = { bpm: 0.0, conf: 0.0, durMs: 0.0 };
}

function totalSlices() {
  return counters.vocals + counters.melo + counters.bass + counters.drum;
}

// dictKeyName — the "melody"/"bass"/"vocals"/"drums" prefix used in
// wr()'s "<track>::slices::..." keys. Matches the original's literal
// string choices exactly (drum -> "drums", melo -> "melody").
var DICT_STEM_NAME = { vocals: "vocals", melo: "melody", bass: "bass", drum: "drums" };

function writeStem(stemName) {
  if (skipIfExists) return;
  var cfg = STEM_CFG[stemName];
  counters[stemName]++;
  var id = "slice_" + pad(counters[stemName], 4);
  var base = DICT_STEM_NAME[stemName] + "::slices::" + id + "::";
  var s = state[stemName];
  wr(base + "time", s.time);
  wr(base + "C", s.C);
  wr(base + "S", s.S);
  if (cfg.hasP) wr(base + "P", s.P);
  wr(base + "E", s.E);
  wr(base + "F", s.F);
  wr(base + "H", s.H);
  wr(base + "M0", s.M0);
  wr(base + "M1", s.M1);
  wr(base + "M2", s.M2);
  wr(base + "M3", s.M3);
  wr(base + "M4", s.M4);
  wr(base + "M5", s.M5);
  if (cfg.hasP && s.P > 40.0) pitches[stemName].push([s.P, s.E]);
  sendTotalSlices(totalSlices());
  sendLastSliceId(cfg.prefix + ":" + id);
}

function writeMetaStem(stemName) {
  if (skipIfExists) return;
  var dn = DICT_STEM_NAME[stemName];
  var m = meta[stemName];
  wr(dn + "::metadata::track_name", track_name);
  wr(dn + "::metadata::stemDurMs", m.durMs);
  wr(dn + "::metadata::BPM_confidence", m.conf);
  if (m.conf >= BPM_MIN_CONFIDENCE) {
    wr(dn + "::metadata::BPM", m.bpm);
    post("EBYS " + cfg3(stemName) + " BPM=" + m.bpm.toFixed(1) + "  conf=" + m.conf.toFixed(3) + "\n");
  } else {
    wr(dn + "::metadata::BPM", 0.0);
    post(
      "EBYS " +
        cfg3(stemName) +
        " BPM=0 (gated -- conf=" +
        m.conf.toFixed(3) +
        " < " +
        BPM_MIN_CONFIDENCE +
        ")\n"
    );
  }
  if (STEM_CFG[stemName].hasP) {
    var key = detectKey(pitches[stemName]);
    wr(dn + "::metadata::key", key);
    var top = topPcs(pitches[stemName]);
    post("EBYS " + cfg3(stemName) + " key=" + key + "  top:" + top + "  n=" + pitches[stemName].length + "\n");
  }
  saveLibrary();
}
function cfg3(stemName) {
  return { vocals: "voc ", melo: "melo", bass: "bass", drum: "drum" }[stemName];
}

function reset() {
  counters.vocals = 0;
  counters.melo = 0;
  counters.bass = 0;
  counters.drum = 0;
  skipIfExists = false;
  pitches.vocals = [];
  pitches.melo = [];
  pitches.bass = [];
  post("EBYS: counters + pitch buffers reset\n");
  sendTotalSlices(0);
}
function resetStem(stemName) {
  counters[stemName] = 0;
  if (pitches[stemName]) pitches[stemName] = [];
  post("EBYS: " + stemName + " counter reset\n");
}

// ── DISPATCH TABLE ────────────────────────────────────────────────────
// Reimplements Max's js auto-dispatch-by-message-name explicitly. Every
// inlet message the original slice_writer.js handled is listed here,
// generated for the 3 P-bearing stems (vocals/melo/bass) plus the
// P-less drum stem, exactly matching the original's per-stem function
// names (set_vocals_time, set_meta_melo_bpm, write_drum, etc).
var DISPATCH = {
  set_bpm_gate: set_bpm_gate,
  set_track_name: set_track_name,
  trackExists: trackExists,
  forgetTrack: forgetTrack,
  reset: reset,
  // resetMemory existed as a real function (wipes analysis_library.json,
  // see its own comment above) but was never reachable from Pd -- nothing
  // was in DISPATCH for it. Added so dict_stub.pd's "clear" message (the
  // real equivalent of the old Max `dict analysisLib`'s "clear", which
  // genuinely wiped the shared registry) has something real to trigger --
  // see CONVERSION_NOTES.md "dict_stub: coded for real".
  resetMemory: resetMemory,
  reset_vocals: function () {
    resetStem("vocals");
  },
  reset_melo: function () {
    resetStem("melo");
  },
  reset_bass: function () {
    resetStem("bass");
  },
  reset_drum: function () {
    resetStem("drum");
  },
};

var STEM_MSG_PREFIX = { vocals: "vocals", melo: "melo", bass: "bass", drum: "drum" };
for (var sn in STEM_CFG) {
  (function (stemName, msgPrefix, cfg) {
    for (var fi = 0; fi < FIELDS.length; fi++) {
      var field = FIELDS[fi];
      if (field === "P" && !cfg.hasP) continue; // drums: no set_drum_P
      DISPATCH["set_" + msgPrefix + "_" + field] = (function (f) {
        return function (v) {
          state[stemName][f] = parseFloat(v);
        };
      })(field);
    }
    DISPATCH["write_" + msgPrefix] = function () {
      writeStem(stemName);
    };
    DISPATCH["set_meta_" + msgPrefix + "_bpm"] = function (v) {
      meta[stemName].bpm = parseFloat(v);
    };
    DISPATCH["set_meta_" + msgPrefix + "_conf"] = function (v) {
      meta[stemName].conf = parseFloat(v);
    };
    DISPATCH["set_meta_" + msgPrefix + "_durMs"] = function (v) {
      meta[stemName].durMs = parseFloat(v);
    };
    DISPATCH["write_meta_" + msgPrefix] = function () {
      writeMetaStem(stemName);
    };
  })(sn, STEM_MSG_PREFIX[sn], STEM_CFG[sn]);
}

// Now that DISPATCH is fully populated, open the real OSC socket: sends
// to Pd's [netreceive] on `sendPort`, listens for Pd's [netsend] on
// `recvPort`. Assigning here (not at the top of the file) is what makes
// the `let osc` forward-reference above safe.
osc = new OscUdpPort({
  sendPort,
  listenPort: recvPort,
  onMessage: (msg) => {
    var fn = DISPATCH[msg.address];
    if (!fn) {
      post("slice_writer_bridge: no handler for '" + msg.address + "'\n");
      return;
    }
    try {
      fn.apply(null, msg.args);
    } catch (e) {
      post("slice_writer_bridge: handler for '" + msg.address + "' threw -- " + e + "\n");
    }
  },
});

// ── STARTUP ────────────────────────────────────────────────────────────
// Same 2000ms deferred load as the original (mirrors analyze_reader.js's
// own startup task, kept for parity even though Node has no "wait for
// outlets to register" reason to justify it -- harmless, keeps behavior
// timing-equivalent in case anything downstream depends on the delay).
console.log(
  `slice_writer_bridge: data-dir=${dataDir}  listening on ${recvPort} (from Pd)  sending to ${sendPort} (to Pd)`
);
setTimeout(loadLibrary, 2000);
