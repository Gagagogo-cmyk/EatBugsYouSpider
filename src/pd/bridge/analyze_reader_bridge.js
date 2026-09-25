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
const http = require("http");
const { OscUdpPort } = require("./osc.js");

// ── progress relay to gui_hub_bridge.js's panel ──────────────────────────
// Same mechanism watch_demucs.py already uses for its demucs/genre/madmom
// stages (see that file's post_progress()/WS_SERVER_PROGRESS_URL and
// gui_hub_bridge.js's POST /progress handler) -- this is FluCoMa's leg of
// the same pipeline, which had no path to the panel at all until now. The
// panel's own Gnumbat.on("pipeline",...) already understands the
// {type:'pipelineStage', stage, status, track, percent, msg} shape, so this
// just needs to speak it with stage:"flucoma" -- no new frame type, no
// panel-side plumbing beyond a label lookup. Fire-and-forget: a panel not
// being open is not an error, same as watch_demucs.py's own silent catch.
const PROGRESS_URL = process.env.GNUMBAT_PROGRESS_URL || "http://localhost:8080/progress";
function postProgress(data) {
  try {
    const body = Buffer.from(JSON.stringify(Object.assign({ type: "pipelineStage", stage: "flucoma" }, data)), "utf8");
    const req = http.request(PROGRESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length },
    });
    req.on("error", () => {});
    req.write(body);
    req.end();
  } catch (e) {}
}

// ── pipeline progress file (shared with src/demucs/watch_demucs.py) ───────
// <session>/pipeline/<track>.json holds every stage of a track's analysis --
// watch_demucs.py fills demucs/essentia/madmom, this bridge fills "flucoma" --
// so the Gnumbat plugin (or anything else) can show progress without the GUI
// hub running. Same shape as watch_demucs.py's write_pipeline_stage(); atomic
// write (tmp + rename). Never throws: progress reporting must not break analysis.
const PIPELINE_STAGES = ["demucs", "essentia", "madmom", "flucoma"];
function writePipelineStage(track, status, percent, msg) {
  if (!track) return;
  try {
    const dir = path.join(getDataDir(), "pipeline");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, track + ".json");
    let doc = {};
    try { doc = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { doc = {}; }
    doc.track = doc.track || track;
    doc.session = getSessionId();
    doc.stages = doc.stages || {};
    for (const st of PIPELINE_STAGES) if (!doc.stages[st]) doc.stages[st] = { status: "waiting", percent: 0 };
    const e = doc.stages.flucoma;
    e.status = status;
    e.percent = Math.max(0, Math.min(100, Math.round(status === "done" ? 100 : percent || 0)));
    if (msg) e.msg = msg; else delete e.msg;
    doc.updated_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
    fs.renameSync(tmp, f);
  } catch (e) {
    post("analyze_reader_bridge: pipeline file: " + e.message + "\n");
  }
}
// stems finished (analyzed or skipped-as-already-analyzed) per track, this run
var trackStemsDone = {};

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
const dataDir = args["data-dir"] || process.env.GNUMBAT_DATA_DIR;
const recvPort = parseInt(args["recv-port"] || "9006", 10); // Pd -> here
const sendPort = parseInt(args["send-port"] || "9007", 10); // here -> Pd

if (!dataDir) {
  console.error("analyze_reader_bridge: need --data-dir (or GNUMBAT_DATA_DIR env var)");
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
  // NEW 2026-08-08. The track name used to be derived in Pd by feeding the
  // path through [regexp_stub (/.+)] then [regexp_stub [^/]+$] -- but
  // regexp_stub is a pass-through that does nothing on outlets 1-4, so
  // set_track_name has never received a real name. Max's [regexp] has no
  // vanilla Pd equivalent, and doing it with [list fromsymbol] + an [until]
  // scan is ~20 untested objects. The bridge already holds the path as a
  // JS string, where this is three lines and testable.
  trackName: "/trackNameOut",
};

// "/a/b/htdemucs/MyTrack/MyTrack_vocals.wav" -> "MyTrack"
//
// Strips the directory, then the trailing "_<stem>.<ext>". The LAST underscore
// is the separator, not the first: real track names in this library contain
// underscores themselves (e.g. "ESRGDtb923043@$#%_$sdndn-001_vocals.wav"), so
// splitting on the first one would truncate the name.
function trackNameFromPath(p) {
  const base = String(p).split("/").pop().replace(/\.[^.]*$/, "");
  const cut = base.lastIndexOf("_");
  return cut > 0 ? base.slice(0, cut) : base;
}
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
function sendTrackName(name) {
  osc.send(OUT.trackName, [{ type: "s", value: name }]);
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
// FIX 2026-09-02: kept as-is for loadRegistry()/prepareNextTrack() below --
// both are separate, lower-stakes heuristics (startup progress counter /
// htdemucs auto-discovery) that key off flat per-stem-FILENAME matching.
// They were never the cause of the live blocking bug (see stemAlreadyAnalyzed
// below) and are left untouched here to keep this fix narrow and testable.
var analysisLibraryNested = {}; // full parsed analysis_library.json, kept
                                 // alongside analysisRegistry so
                                 // stemAlreadyAnalyzed() can check the REAL
                                 // shape the file is written in -- see below.
function readRegistryFile() {
  try {
    const raw = fs.readFileSync(getLibraryPath(), "utf8");
    const parsed = JSON.parse(raw);
    analysisRegistry = {};
    for (const k of Object.keys(parsed)) analysisRegistry[k] = { _: 1 };
    analysisLibraryNested = parsed;
    post("analyze_reader_bridge: registry loaded -- " + Object.keys(analysisRegistry).length + " tracks\n");
  } catch (e) {
    analysisRegistry = {};
    analysisLibraryNested = {};
  }
}
// FIX 2026-09-02 (real root cause of "bass and melo won't re-analyze,
// stuck on 'already analyzed'"): this used to be stemAlreadyAnalyzedPath(p),
// which checked analysis_library.json's TOP-LEVEL keys against the stem's
// bare FILENAME (e.g. "TRACK_bass.wav") -- the OLD/Max-era flat convention.
// slice_writer_bridge.js -- the process that actually WRITES this file now
// -- uses a completely different NESTED convention: one top-level key per
// bare TRACK NAME (same string trackNameFromPath(p) computes below, no
// "_bass.wav" suffix), with "vocals"/"drums"/"bass"/"melody" as sub-keys
// under that (see its DICT_STEM_NAME/set_track_name()). Those two shapes
// never legitimately matched -- the only way this check ever returned true
// was a STALE flat-format key sitting in the file from an old run/writer,
// which saveLibrary()'s merge logic can never clean up on its own. That
// stale key made this function report "already analyzed" for bass/melody
// and skip ever asking Pd to really analyze them, even though their real
// (nested) data was missing or incomplete. Checking the real nested shape
// instead fixes it, and also means this check now genuinely reflects
// whether THIS stem has data, not just whether the track name happens to
// appear in the file at all.
function stemAlreadyAnalyzed(p, stemName) {
  if (!p || !stemName) return false;
  readRegistryFile();
  const trackKey = trackNameFromPath(p);
  const track = analysisLibraryNested[trackKey];
  const stemData = track && track[stemName];
  return !!(stemData && typeof stemData === "object" && Object.keys(stemData).length > 0);
}

// ── stream.txt state (verbatim logic from analyze_reader.js's
// readStreamTxt(), including the label-based-grouping bugfix already
// documented in the original source's comments) ─────────────────────────
var allStemPaths = [];
var currentBatch = 0;
var analysisActive = false;
var pendingRestart = false;
var stemsThisRun = 0;
var awaitingStem = false; // guards against duplicate stemDone

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
  if (!awaitingStem) {
    post("analyze_reader_bridge: duplicate stemDone ignored\n");
    return;
  }
  awaitingStem = false;
  stemsThisRun++;
  const totalBatches = Math.ceil(allStemPaths.length / 4) || 1;
  post("analyze_reader_bridge: batch " + currentBatch + " step " + stemsThisRun + "/4 done\n");

  // REAL progress -- see the top-of-file postProgress() comment for why
  // this replaces the TUI's old fake 0->95% timer. doneSoFar is a genuine
  // count of stems actually finished (or skipped-as-already-analyzed, which
  // also routes through here) out of the whole run.
  const doneSoFar = currentBatch * 4 + stemsThisRun;
  const justFinished = STEP_STEMS_MAP[stemsThisRun] || "";
  {
    const finishedPath = allStemPaths[doneSoFar - 1];
    if (finishedPath) {
      const t = trackNameFromPath(finishedPath);
      const n = (trackStemsDone[t] || 0) + 1;
      trackStemsDone[t] = n;
      if (n >= 4) { writePipelineStage(t, "done", 100); delete trackStemsDone[t]; }
      else writePipelineStage(t, "running", n * 25, n + "/4 stems");
    }
  }
  postProgress({
    status: "progress",
    percent: Math.round((doneSoFar / allStemPaths.length) * 100),
    msg: justFinished + " analyzed (" + doneSoFar + "/" + allStemPaths.length + ")",
  });

  if (stemsThisRun >= 4) {
    currentBatch++;
    if (currentBatch < totalBatches) {
      stemsThisRun = 0;
      post("analyze_reader_bridge: -> batch " + currentBatch + "/" + (totalBatches - 1) + "\n");
      setTimeout(() => {
        sendCounterSet(1);
        sendAdvance(); // emits 1 -> startStem(1) for the next batch
      }, 50);
    } else {
      analysisActive = false;
      post("analyze_reader_bridge: all " + allStemPaths.length + " stems done\n");
      sendStatus("all_done");
      if (currentRenderId) {
        // Render batch -- gui_hub_bridge.js's POST /api/render is blocked
        // on this exact signal (see its pendingRenders map).
        postProgress({ stage: "render", status: "done", renderId: currentRenderId, msg: allStemPaths.length + " stem(s) analyzed" });
        currentRenderId = null;
      } else {
        postProgress({ status: "done", msg: allStemPaths.length + " stem(s) analyzed" });
      }
      if (pendingRestart) {
        pendingRestart = false;
        post("analyze_reader_bridge: running queued analysis (stream.txt updated while busy)\n");
        // startAnalysis() now seeds AND bangs the counter itself (see its
        // own comment) -- the extra sendCounterSet(1) that used to sit here
        // was already redundant even before that fix (startAnalysis() has
        // always called it internally too), just harmlessly so since "set"
        // is idempotent. Dropped rather than left in as dead noise.
        setTimeout(startAnalysis, 200);
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
    awaitingStem = true;
    advanceCounter();
    return;
  }
  if (stemAlreadyAnalyzed(p, stemName)) {
    post("analyze_reader_bridge: [batch " + currentBatch + "] " + stemName + " already analyzed -- skipping\n");
    awaitingStem = true;
    advanceCounter();
    return;
  }

  post("analyze_reader_bridge: [batch " + currentBatch + "] startStem " + n + " [" + stemName + "] -> " + p + "\n");
  {
    const t = trackNameFromPath(p);
    const doneForTrack = trackStemsDone[t] || 0;
    writePipelineStage(t, "running", doneForTrack * 25, "reading " + stemName + " (" + doneForTrack + "/4 stems)");
  }
  postProgress({
    status: "progress",
    track: trackNameFromPath(p),
    percent: Math.round((globalIdx / allStemPaths.length) * 100),
    msg: "reading " + stemName,
  });
  awaitingStem = true;
  sendStatus("reading", stemName, p);
  sendTrackName(trackNameFromPath(p));   // before loadStem: slice_writer keys
  sendLoadStem(n, p);                    // its registry on the track name
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
  postProgress({ status: "start", percent: 0, msg: allStemPaths.length + " stem(s) queued" });
  // THE BUG (found 2026-08-19): this used to send ONLY "set 1" -- a silent
  // seed, per Pd's own [counter] semantics (a "set"/float message on the hot
  // inlet updates the held value WITHOUT outputting or triggering anything
  // downstream; only a genuine BANG does that). The only reason startStem(1)
  // ever fired at all was a SEPARATE wire in gnumbat-analyze.pd: bridge_
  // streamWatcher's own bang fans out through [t b b b], and one of those
  // three outlets bangs [counter 1 4] directly -- completely independent of
  // whatever this bridge sends. That side-channel bang races the "set 1"
  // seed (it's a synchronous local Pd bang; "set 1" has to round-trip out
  // over OSC to this process and back), which is exactly what produced the
  // very first "startStem -- unknown step 0" seen live: the direct bang
  // fired and read whatever stale/default value the counter held BEFORE the
  // seed arrived. Worse, that side-channel bang only exists on the genuine
  // streamWatcher-triggered path -- every OTHER way this function gets
  // called (a manual ":startAnalysis" from the panel, the pendingRestart
  // auto-retry below, a future resetMemory-driven restart) sends "set 1"
  // with NO companion bang at all, so the counter sits seeded at 1 forever
  // and startStem() never fires -- exactly the "blocking at flucoma 0%,
  // even after manually starting it" symptom reported live. The very next
  // batch's own advance (below, in advanceCounter()) already does this
  // correctly -- "sendCounterSet(1); sendAdvance(); // emits 1 ->
  // startStem(1) for the next batch" -- this just brings the FIRST batch's
  // kickoff in line with that established, correct pattern instead of
  // relying on the racy side-channel wire.
  sendCounterSet(1); // seed the value...
  sendAdvance();     // ...then actually bang it out -> startStem(1)
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

// startRenderAnalysis -- NEW 2026-09-09, added for the arrangement
// editor's "Render" feature: mixdown overlapping clips per stem-family to
// real audio, then re-analyze as if they were straight stems (see
// gui_hub_bridge.js's POST /api/render for the full design/why -- clips
// can overlap within one stem family in the arrangement editor, unlike
// live playback where only one thing ever sounds per stem, and spectral
// descriptors are not linear in the samples, so only real reanalysis of
// the real mixed audio gives true numbers for an overlap).
//
// Reuses the EXACT SAME batch state machine as startAnalysis()/startStem()
// below (allStemPaths/currentBatch/stemsThisRun/awaitingStem) rather than
// a parallel one, because both ultimately drive the SAME shared Pd-side
// [counter 1 4] object and the SAME 4 buffer~ slots -- running two
// batches concurrently would corrupt both. Consequences worth being
// explicit about:
//   (a) a render request simply refuses to start while a real (or
//       another render) batch is already active, rather than queuing
//       itself like startAnalysis()'s own pendingRestart does -- kept
//       deliberately simple since this is new, unverified surface.
//   (b) a render TEMPORARILY LOADS ITS MIXDOWN INTO THE SAME LIVE
//       PERFORMANCE BUFFERS a real stem would use -- there is no separate
//       offline buffer~ set in the current Pd patch. If the arrangement
//       editor is ever used while stems are actively playing live, this
//       WILL interrupt/replace that audio for the duration of the
//       render. Only Pd-side wiring (a second buffer~ set) can actually
//       fix this; flagged here rather than silently accepted.
//
// Invoked DIRECTLY over UDP from gui_hub_bridge.js's own oscAnalyzeReader
// client, straight to this bridge's recv port -- bypassing Pd's /guiCmd
// relay entirely (unlike startAnalysis/startStem/resetMemory/
// loadRegistry/prepareNextTrack above, which the panel can only reach via
// Pd's own routing). This bridge's DISPATCH table below doesn't care who
// sent a message or how, so no Pd patch change is needed for this new
// command to reach here at all.
//
// Args are (renderId, vocalsPath, drumsPath, bassPath, melodyPath) --
// THIS FILE's own STEP_STEMS_MAP order (1=vocals,2=drums,3=bass,
// 4=melody), which is NOT the same order gui_hub_bridge.js's STEM_KEYS
// constant uses (vocals,melody,bass,drums) -- same trap this file's own
// STEM_ORDER/trackNameFromPath callers already have to mind elsewhere. An
// empty-string path means "nothing to render for this stem" and is
// handled for free by startStem()'s own existing `if (!p)` branch below
// (skip, advance) -- no special-casing needed here.
function startRenderAnalysis(renderId, pVocals, pDrums, pBass, pMelody) {
  if (analysisActive) {
    post("analyze_reader_bridge: renderAnalyze " + renderId + " refused -- analysisActive\n");
    postProgress({ stage: "render", status: "error", renderId, msg: "busy -- a real analysis or another render is already in progress, try again shortly" });
    return;
  }
  readRegistryFile();
  allStemPaths = [pVocals, pDrums, pBass, pMelody].map((p) => p || "");
  currentBatch = 0;
  stemsThisRun = 0;
  analysisActive = true;
  currentRenderId = renderId;
  post("analyze_reader_bridge: renderAnalyze " + renderId + " starting\n");
  postProgress({ stage: "render", status: "start", renderId, msg: "4 stem(s) queued for render analysis" });
  sendCounterSet(1);
  sendAdvance();
}

// ── DISPATCH TABLE ────────────────────────────────────────────────────────
var DISPATCH = {
  startAnalysis: startAnalysis,
  startStem: startStem,
  resetMemory: resetMemory,
  loadRegistry: loadRegistry,
  prepareNextTrack: prepareNextTrack,
  renderAnalyze: startRenderAnalysis, // NEW 2026-09-09
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

module.exports = { trackNameFromPath };
