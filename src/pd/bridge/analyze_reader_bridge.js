#!/usr/bin/env node
// analyze_reader_bridge.js — Node.js replacement for the file-I/O/batch
// half of the Max `js analyze_reader.js` object (the piece that was left
// deferred when analyze_reader.pd/analyze_reader_stem.pd were built --
// see CONVERSION_NOTES.md, "analyze_reader.js: real per-onset descriptor
// extraction", "Deferred" bullet list).
//
// analyze_reader.js's own 9-outlet contract split cleanly in two, per the
// "Architecture split" decision already recorded in CONVERSION_NOTES.md:
//   - outlet 0 (writes into slice_writer.js) and the per-onset descriptor
//     math constantly peek() live buffer~ (array) data -> stayed native Pd
//     (analyze_reader.pd + analyze_reader_stem.pd, already built).
//   - outlets 1-4 (status / counter-advance / nDone / counter-set) and
//     5-8 (which file to load into which stem buffer next) are pure
//     file-I/O + counting -- stream.txt parsing, htdemucs folder
//     scanning, registry lookups -- zero buffer~ access. That's this file.
//
// Platform glue, same conventions as every other bridge in this project:
//   `File`/`Folder`               -> Node's `fs`.
//   `patcher.filepath`            -> --data-dir, same session-aware
//                                    getSessionId()/getDataDir() convention
//                                    as slice_writer_bridge.js/slicer_bridge.js
//                                    (all three bridges resolve to the
//                                    identical session folder).
//   `Task`/`.schedule(ms)`        -> `setTimeout`.
//   `new Dict("analysisLib")`     -> reads analysis_library.json directly
//                                    via `fs` (the dict this used to query
//                                    doesn't exist in Pd -- same fix
//                                    already applied for dict_stub.pd/
//                                    bridge_sliceWriter's own registry
//                                    check, see CONVERSION_NOTES.md "Link
//                                    audit").
//   Max's js auto-dispatch        -> explicit DISPATCH table.
//   outlet(N, ...)                -> one OSC address per outlet number,
//                                    matching slicer_bridge.js's pattern
//                                    (see OUT below).
//
// The actual buffer~-touching steps this bridge used to do directly in
// Max (outlets 5-8: "clear" + "read <path>" straight into a buffer~) are
// now two hops: this bridge resolves WHICH path goes into WHICH stem
// (loadStemOut), and stem_loader.pd (new, native Pd, uses [soundfiler] --
// see its own header comment for why that's needed at all) does the
// actual load and then bangs the matching pd stereo_to_mono.<stem>
// subpatch, which previously had a dangling, unfed inlet.
//
// Run:
//   node analyze_reader_bridge.js --data-dir /path/to/EBYS/data \
//     --recv-port 9006 --send-port 9007
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
const recvPort = parseInt(args["recv-port"] || "9006", 10); // Pd -> here
const sendPort = parseInt(args["send-port"] || "9007", 10); // here -> Pd

if (!dataDir) {
  console.error("analyze_reader_bridge: need --data-dir (or EBYS_DATA_DIR env var)");
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
function getLibraryPath() {
  return path.join(getDataDir(), "analysis_library.json");
}
function htPath() {
  return path.join(getDataDir(), "stems", "htdemucs");
}
function streamPath() {
  return path.join(getDataDir(), "stream.txt");
}

// ── OSC transport ─────────────────────────────────────────────────────
const OUT = {
  status: "/statusOut", // was outlet(1, ...)
  advance: "/advanceOut", // was outlet(2, "bang")
  nDone: "/nDoneOut", // was outlet(3, n)
  counterSet: "/counterSetOut", // was outlet(4, "set", n)
  loadStem: "/loadStemOut", // was outlet(5..8, "clear"/"read", path) -- consolidated
};
let osc;
function sendStatus(...parts) {
  osc.send(
    OUT.status,
    parts.map((p) => (typeof p === "number" ? { type: "f", value: p } : { type: "s", value: String(p) }))
  );
}
function sendAdvance() {
  osc.send(OUT.advance, []);
}
function sendNDone(n) {
  osc.send(OUT.nDone, [{ type: "f", value: n }]);
}
function sendCounterSet(n) {
  osc.send(OUT.counterSet, [{ type: "f", value: n }]);
}
function sendLoadStem(stemIndex, filePath) {
  osc.send(OUT.loadStem, [
    { type: "f", value: stemIndex },
    { type: "s", value: filePath },
  ]);
}

// ── registry (reads analysis_library.json directly -- replaces
// Max's `new Dict("analysisLib").getkeys()`; see header comment) ────────
var analysisRegistry = {};
function readRegistryFile() {
  try {
    const raw = fs.readFileSync(getLibraryPath(), "utf8");
    const parsed = JSON.parse(raw);
    analysisRegistry = {};
    for (const k of Object.keys(parsed)) analysisRegistry[k] = { _: 1 };
    post("analyze_reader_bridge: registry loaded -- " + Object.keys(analysisRegistry).length + " tracks\n");
  } catch (e) {
    analysisRegistry = {};
  }
}
function stemAlreadyAnalyzedPath(p) {
  if (!p) return false;
  const fname = p.slice(p.lastIndexOf("/") + 1);
  readRegistryFile();
  return analysisRegistry.hasOwnProperty(fname);
}

// ── stream.txt state (verbatim logic from analyze_reader.js's
// readStreamTxt(), including the label-based-grouping bugfix already
// documented in the original source's comments) ─────────────────────────
var allStemPaths = [];
var currentBatch = 0;
var analysisActive = false;
var pendingRestart = false;
var stemsThisRun = 0;

var LABEL_SLOT = { vocals: 0, drums: 1, bass: 2, melody: 3 };
var STEP_STEMS_MAP = { 1: "vocals", 2: "drums", 3: "bass", 4: "melody" };
var NEXT_SUFFIXES = ["_vocals.wav", "_drums.wav", "_bass.wav", "_other.wav"];
var NEXT_LABELS = ["vocals", "drums", "bass", "melody"];
var STEM_ORDER = ["_vocals.wav", "_drums.wav", "_bass.wav", "_other.wav"];

function readStreamTxt() {
  analysisActive = true;
  stemsThisRun = 0;
  currentBatch = 0;
  allStemPaths = [];

  const STREAM_PATH = streamPath();
  let raw;
  try {
    raw = fs.readFileSync(STREAM_PATH, "utf8");
  } catch (e) {
    post("analyze_reader_bridge: ERROR -- stream.txt not found at " + STREAM_PATH + "\n");
    analysisActive = false;
    return;
  }
  post("analyze_reader_bridge: reading " + STREAM_PATH + "\n");

  const trackOrder = [];
  const trackSlots = {};
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space <= 0) continue;
    const label = line.slice(0, space).trim();
    const p = line.slice(space + 1).trim();
    if (!p) continue;
    if (!LABEL_SLOT.hasOwnProperty(label)) {
      post("analyze_reader_bridge: stream.txt -- unknown stem label '" + label + "' -- skipping line\n");
      continue;
    }
    const slash = p.lastIndexOf("/");
    const trackKey = slash >= 0 ? p.slice(0, slash) : p;
    if (!trackSlots.hasOwnProperty(trackKey)) {
      trackSlots[trackKey] = ["", "", "", ""];
      trackOrder.push(trackKey);
    }
    trackSlots[trackKey][LABEL_SLOT[label]] = p;
  }

  for (const tk of trackOrder) {
    const slots = trackSlots[tk];
    for (let s = 0; s < 4; s++) allStemPaths.push(slots[s]);
  }

  const nTracks = Math.ceil(allStemPaths.length / 4);
  post(
    "analyze_reader_bridge: " +
      trackOrder.length +
      " track(s), " +
      allStemPaths.length +
      " stem-slot(s) loaded -- " +
      nTracks +
      " batch(es)\n"
  );

  if (allStemPaths.length === 0) {
    post("analyze_reader_bridge: ERROR -- stream.txt empty or unreadable\n");
    analysisActive = false;
  }
}

// advanceCounter — single exit point for advancing the counter, ported
// from analyze_reader.js almost verbatim (Task+50ms -> setTimeout+50ms).
function advanceCounter() {
  stemsThisRun++;
  const totalBatches = Math.ceil(allStemPaths.length / 4) || 1;
  post("analyze_reader_bridge: batch " + currentBatch + " step " + stemsThisRun + "/4 done\n");

  if (stemsThisRun >= 4) {
    currentBatch++;
    if (currentBatch < totalBatches) {
      stemsThisRun = 0;
      post("analyze_reader_bridge: -> batch " + currentBatch + "/" + (totalBatches - 1) + "\n");
      setTimeout(() => {
        sendCounterSet(0);
        sendAdvance(); // 0 -> 1 -> startStem(1) for the next batch
      }, 50);
    } else {
      analysisActive = false;
      post("analyze_reader_bridge: all " + allStemPaths.length + " stems done\n");
      sendStatus("all_done");
      if (pendingRestart) {
        pendingRestart = false;
        post("analyze_reader_bridge: running queued analysis (stream.txt updated while busy)\n");
        setTimeout(() => {
          startAnalysis();
          sendCounterSet(0);
        }, 200);
      }
    }
  } else {
    sendAdvance();
  }
}

// startStem(n) — called by "startStem $1" (wired from the existing
// [counter 1 4] object's output, via [prepend startStem]).
function startStem(n) {
  n = parseInt(n);
  if (!analysisActive) {
    post("analyze_reader_bridge: startStem " + n + " ignored -- no active run\n");
    return;
  }
  const stemName = STEP_STEMS_MAP[n];
  const globalIdx = currentBatch * 4 + (n - 1);
  const p = allStemPaths[globalIdx] || "";

  if (!stemName) {
    post("analyze_reader_bridge: startStem -- unknown step " + n + "\n");
    return;
  }
  if (!p) {
    post("analyze_reader_bridge: startStem " + n + " -- no path at index " + globalIdx + "\n");
    advanceCounter();
    return;
  }
  if (stemAlreadyAnalyzedPath(p)) {
    post("analyze_reader_bridge: [batch " + currentBatch + "] " + stemName + " already analyzed -- skipping\n");
    advanceCounter();
    return;
  }

  post("analyze_reader_bridge: [batch " + currentBatch + "] startStem " + n + " [" + stemName + "] -> " + p + "\n");
  sendStatus("reading", stemName, p);
  sendLoadStem(n, p);
  // Note: unlike the original (which advanced the counter itself right
  // after readStem() finished, synchronously, in the same Max event),
  // the counter advance here waits for a real "stemDone" message from Pd
  // -- see the DISPATCH entry below -- since the actual per-onset
  // analysis now runs asynchronously inside analyze_reader.pd/
  // analyze_reader_stem.pd on the Pd side, not in this process.
}

function loadRegistry() {
  readRegistryFile();
  let counterStart = 1;
  let nDone = 0;
  const regKeys = Object.keys(analysisRegistry);
  for (let i = 0; i < STEM_ORDER.length; i++) {
    const suffix = STEM_ORDER[i];
    const found = regKeys.some((k) => k.toLowerCase().indexOf(suffix) !== -1);
    if (found) {
      nDone++;
      counterStart = nDone + 1;
    } else break;
  }
  if (nDone >= STEM_ORDER.length) {
    post("analyze_reader_bridge: all 4 stems already analyzed\n");
    sendStatus("all_done");
  }
  sendNDone(nDone);
  sendCounterSet(nDone + 1);
  sendStatus("library", nDone, "stems_done", "counter_set_to", nDone + 1);
  post("analyze_reader_bridge: " + nDone + " stems done -> counter set to " + (nDone + 1) + "\n");
}

function resetMemory() {
  analysisRegistry = {};
  analysisActive = false;
  pendingRestart = false;
  stemsThisRun = 0;
  currentBatch = 0;
  allStemPaths = [];
  loadRegistry();
  post("analyze_reader_bridge: memory cleared (run-state guard also reset)\n");
}

function startAnalysis() {
  if (analysisActive) {
    post("analyze_reader_bridge: startAnalysis -- already running, queuing re-run\n");
    pendingRestart = true;
    return;
  }
  post("analyze_reader_bridge: startAnalysis triggered\n");
  readStreamTxt();
  if (allStemPaths.length === 0) {
    post("analyze_reader_bridge: startAnalysis -- no stems found, aborting\n");
    return;
  }
  sendCounterSet(0); // Pd bangs the counter 0 -> 1 -> "startStem 1" next
}

// prepareNextTrack — scans htdemucs for a track not fully in the library;
// if found, writes stream.txt for it. Ported from analyze_reader.js.
// Not auto-chained after all_done (the original had no automatic caller
// either -- see CONVERSION_NOTES.md); exposed here as an explicit
// "prepareNextTrack" command for whoever wants htdemucs auto-discovery
// instead of hand-populating stream.txt per track.
function prepareNextTrack() {
  readRegistryFile();
  const HT_PATH = htPath();
  let trackFolders;
  try {
    trackFolders = fs.readdirSync(HT_PATH, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {
    post("analyze_reader_bridge: prepareNextTrack -- cannot open " + HT_PATH + "\n");
    sendStatus("error", "prepareNextTrack", "htdemucs_not_found");
    return false;
  }

  for (const trackFolder of trackFolders) {
    const trackPath = path.join(HT_PATH, trackFolder);
    let filesInFolder;
    try {
      filesInFolder = fs.readdirSync(trackPath);
    } catch (e) {
      continue;
    }
    const lines = [];
    let anyNew = false;
    for (let i = 0; i < NEXT_SUFFIXES.length; i++) {
      const suffix = NEXT_SUFFIXES[i];
      const label = NEXT_LABELS[i];
      const found = filesInFolder.find((fn) => fn.toLowerCase().endsWith(suffix));
      if (!found) continue;
      const isNew = !analysisRegistry.hasOwnProperty(found);
      if (isNew) anyNew = true;
      lines.push(label + " " + path.join(trackPath, found));
    }
    if (anyNew && lines.length > 0) {
      try {
        fs.writeFileSync(streamPath(), lines.join("\n") + "\n", "utf8");
      } catch (e) {
        post("analyze_reader_bridge: prepareNextTrack -- cannot write stream.txt: " + e + "\n");
        return false;
      }
      post("analyze_reader_bridge: prepareNextTrack -- stream.txt written, " + lines.length + " stems (" + trackFolder + ")\n");
      sendStatus("preparedTrack", trackFolder, lines.length);
      return true;
    }
  }
  post("analyze_reader_bridge: prepareNextTrack -- all tracks already analyzed\n");
  sendStatus("allTracksAnalyzed");
  return false;
}

// ── DISPATCH TABLE ────────────────────────────────────────────────────────
var DISPATCH = {
  startAnalysis: startAnalysis,
  startStem: startStem,
  resetMemory: resetMemory,
  loadRegistry: loadRegistry,
  prepareNextTrack: prepareNextTrack,
  // Fired by analyze_reader.pd's new outlet 1 (see CONVERSION_NOTES.md)
  // after a stem's descriptor extraction genuinely finishes on the Pd
  // side -- this is what drives the real counter-advance now, instead of
  // the original's synchronous same-event advance inside readStem().
  stemDone: function () {
    advanceCounter();
  },
};

osc = new OscUdpPort({
  sendPort,
  listenPort: recvPort,
  onMessage: (msg) => {
    const fn = DISPATCH[msg.address];
    if (!fn) {
      post("analyze_reader_bridge: no handler for '" + msg.address + "'\n");
      return;
    }
    try {
      fn.apply(null, msg.args);
    } catch (e) {
      post("analyze_reader_bridge: handler for '" + msg.address + "' threw -- " + e + "\n");
    }
  },
});

console.log(
  `analyze_reader_bridge: data-dir=${dataDir}  listening on ${recvPort} (from Pd)  sending to ${sendPort} (to Pd)`
);
// Same 2s-deferred loadRegistry-on-start convention as the original
// (_initTask.schedule(2000)) and as slicer_bridge.js's startup.
setTimeout(loadRegistry, 2000);
