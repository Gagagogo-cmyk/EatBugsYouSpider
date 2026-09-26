#!/usr/bin/env node
// gui_hub_bridge.js — the control-surface hub for the Pd instrument.
//
// WHAT THIS REPLACES
// ------------------
// In the Max patch, everything that reported outward went through one shared
// hub: `gate 1` -> `js node.script ws_server.js`, a WebSocket server that the
// terminal UI (src/tui/sdj-tui.js) connected to on :8080. The Pd conversion
// dropped `node.script`/`ws_server.js` to a documentation comment early on —
// it had no audio-critical role — and with it went the only path a control
// surface had into or out of the instrument. GUI_PARAMETER_MAPPING.md's
// "Status / telemetry" table has been a list of dead ends ever since, and the
// TUI has had nothing to talk to.
//
// This is that hub, rebuilt as a standalone process instead of living inside
// the host. It is the same architecture as the five existing bridges
// (streamWatcher/sliceWriter/slicer/analyzeReader/bufferManager) — Node on one
// side, OSC/UDP to Pd on the other, no npm dependencies — with one addition:
// it also speaks HTTP and WebSocket, so a browser (or a JUCE WebView) can be
// the surface.
//
//     browser / JUCE WebView
//            |  WebSocket (JSON)     :8080
//            v
//     gui_hub_bridge.js  <---- this file
//            |  OSC/UDP
//            |    out :9010  ->  [netreceive -u -b 9010] in bridge_guiHub.pd
//            |    in  :9011  <-  [netsend -u -b] in bridge_guiHub.pd
//            v
//     gnumbat-analyze.pd
//
// WHY IT RELAYS RATHER THAN DISPATCHES
// ------------------------------------
// This hub deliberately does NOT reimplement the slicer's ~54-command dispatch
// table. A command arrives as {target, sel, args}; the hub validates the
// target and the selector against the whitelist below, then hands it to Pd as
// `/guiCmd <target> <sel> <args...>`. bridge_guiHub.pd routes on <target> and
// spits the rest out as an ordinary Pd list — which plugs straight into
// bridge_slicer.pd's existing inlet, exactly as a message box would. So
// slicer_bridge.js's DISPATCH stays the single source of truth for what the
// slicer can do, and adding a command there needs no change here beyond a
// whitelist entry.
//
// The whitelist is not security theatre — it is the thing that turns a typo in
// the GUI into a hub-side error with a name attached, instead of a silent
// "no handler" three processes away.
//
// PORTS
// -----
// 9010/9011 are free: 9001 is streamWatcher, 9002/9003 sliceWriter, 9004/9005
// slicer, 9006/9007 analyzeReader, 9008/9009 bufferManager. 8080 is the HTTP/
// WebSocket port, matching the port the old ws_server.js used, so anything
// that ever pointed at it (the TUI) still can.
//
// RUN
// ---
//   node src/gui/gui_hub_bridge.js --panel-dir src/gui --data-dir data \
//        --http-port 8080 --send-port 9010 --recv-port 9011
//
// then open http://localhost:8080/panel.html
//
// NOT YET EXERCISED AGAINST A LIVE PD INSTANCE — same caveat as the rest of
// the conversion work. The OSC framing is covered by test_osc_roundtrip.js;
// the Pd half is code review only.
//
// GET /api/library — real tracks for the panel's library list
// --------------------------------------------------------------------------
// Added so the panel can show actual analyzed tracks instead of the six
// hardcoded demo rows panel.html shipped with (see that file's LIB comment —
// "fake track names, fake genres... plausible-looking but entirely
// fictional"). This is a plain read of the same two files
// import_library.py already parses (analysis_library.json, genres.json),
// grouped the same way (strip_suffix / STEM_SUFFIXES) and shaped to match
// LIB's own {f,g,b,k} rows so panel.html only has to swap the array, not
// its rendering. Deliberately NOT sqlite (gnumbat.db) — reading the two source
// JSON files directly keeps this hub dependency-free like every other
// bridge in the project, and matches the session-dir resolution convention
// (--data-dir / current_session.txt / sessions/<id>/) that
// analyze_reader_bridge.js already uses, copied verbatim below.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OscUdpPort } = require("../pd/bridge/osc.js");

// MODEL BROWSER -- src/network/artifacts/ is the source of truth for
// everything panel.html's #modelSelectView shows/edits (lineage, votes,
// PickleScan, training state, creators/editors, network availability).
// This hub is a thin adapter: every mutation below goes straight through
// models.js/registry.js/lineage.js/votes.js (which persist to
// data/network/...) and then broadcasts the recomputed list to every
// connected panel, so MODELS lives here (and on disk), never only in one
// browser tab's localStorage. See docs/platform/ARTIFACT_NETWORK.md.
const modelsApi = require("../network/artifacts/models");
const modelsRegistry = require("../network/artifacts/registry");
const modelsLineage = require("../network/artifacts/lineage");
const modelsVotes = require("../network/artifacts/votes");
const { NETWORK_DIR: MODELS_NETWORK_DIR } = require("../network/artifacts/identity");

// Ops the plugin already sent (opId -> reply), persisted so a replay after a hub restart is still
// recognised. Only the most recent 500 are kept -- a queued op is replayed within minutes/days,
// never after hundreds of newer ones.
const APPLIED_OPS_FILE = path.join(MODELS_NETWORK_DIR, "plugin_applied_ops.json");
const appliedModelOps = new Map();
try {
  for (const [k, v] of JSON.parse(fs.readFileSync(APPLIED_OPS_FILE, "utf8"))) appliedModelOps.set(k, v);
} catch (e) { /* first run / unreadable: start empty */ }
function rememberModelOp(opId, reply) {
  appliedModelOps.set(opId, reply);
  while (appliedModelOps.size > 500) appliedModelOps.delete(appliedModelOps.keys().next().value);
  try {
    fs.mkdirSync(MODELS_NETWORK_DIR, { recursive: true });
    const tmp = APPLIED_OPS_FILE + ".part";
    fs.writeFileSync(tmp, JSON.stringify([...appliedModelOps]));
    fs.renameSync(tmp, APPLIED_OPS_FILE);
  } catch (e) { post("could not save " + APPLIED_OPS_FILE + ": " + e.message); }
}

// ── ARGS ──────────────────────────────────────────────────────────────────
// Same hand-rolled --flag parsing as every other bridge in this project.
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1];
}
const httpPort = parseInt(args["http-port"] || "8080", 10);
const sendPort = parseInt(args["send-port"] || "9010", 10); // here -> Pd
const recvPort = parseInt(args["recv-port"] || "9011", 10); // Pd  -> here
// FIX 2026-09-02 ("I want the resetAll to really resetAll"): sliceWriter
// and bufferManager are separate Node processes with their own OSC-over-UDP
// listeners (see run.sh) that performResetAll() below now talks to DIRECTLY
// -- Node-to-Node, no Pd patch involved at all. Defaults match run.sh's
// real ports; overridable in case a bridge is ever launched on another one.
const sliceWriterPort = parseInt(args["slicewriter-port"] || "9002", 10);
const bufferManagerPort = parseInt(args["buffermanager-port"] || "9008", 10);
// analyzeReaderPort -- NEW 2026-09-09, "Render" feature (see POST /api/render
// below). Sends DIRECT to analyze_reader_bridge.js's own recv port,
// bypassing Pd's /guiCmd relay entirely -- see startRenderAnalysis()'s own
// comment in analyze_reader_bridge.js for why that's safe and requires no
// Pd patch change.
const analyzeReaderPort = parseInt(args["analyzereader-port"] || "9006", 10);
const panelDir = path.resolve(args["panel-dir"] || __dirname);
const verbose = args.verbose === "true" || args.verbose === "1";

// --data-dir is optional, unlike the other bridges' (they exit without it) —
// this hub still works with it missing, just without /api/library. Defaults
// to the repo's own data/ dir (two levels up from src/gui/), which is right
// every time this is launched the way run.sh launches it.
const dataDir = args["data-dir"] || process.env.GNUMBAT_DATA_DIR ||
  path.resolve(__dirname, "..", "..", "data");

// Same defaults src/tui/app.js's CONFIG used — Cricket is the same local
// Ollama model talked to the same way, just proxied from here instead of
// from the TUI process.
const ollamaHost  = args["ollama-host"]  || "localhost";
const ollamaPort  = parseInt(args["ollama-port"] || "11434", 10);
const ollamaModel = args["ollama-model"] || "llama3.1:latest";

// EDIT INTERFACE -- a separate, OPTIONAL model just for Cricket-as-
// coding-agent (edit_agent.js). The console/OMSC Cricket above is a
// fast conversational role; driving apply_patch reliably (emitting a
// tool call instead of narrating "done", committing to a write instead
// of re-reading forever) is a much more mechanical task that a general
// chat model like the llama3.1 default above is not well suited for --
// confirmed in practice (see edit_agent.js's own header and the git log
// around this line for the debugging story). Defaults to ollamaModel,
// so nothing changes unless this is set. Same GNUMBAT_DATA_DIR-style env
// var fallback as dataDir above, so a coding-focused model (e.g. after
// `ollama pull qwen2.5-coder:7b`) can be pointed at without editing
// run.sh or retyping the launch command by hand:
//   GNUMBAT_EDIT_OLLAMA_MODEL=qwen2.5-coder:7b ./run.sh
const editOllamaModel = args["edit-ollama-model"] || process.env.GNUMBAT_EDIT_OLLAMA_MODEL || ollamaModel;
// UPDATE -- user: "ollama timed out" on a multi-file edit request. edit_agent.js
// now defaults its own per-call Ollama timeout to 5 minutes (was a flat 2 minutes,
// too short once a request needs read_file on a large file like base.html) --
// same override pattern as editOllamaModel above, for slower hardware still.
const editOllamaTimeoutMs = parseInt(args["edit-ollama-timeout-ms"] || process.env.GNUMBAT_EDIT_OLLAMA_TIMEOUT_MS || "300000", 10);

// EDIT INTERFACE -- repo root Cricket's local coding-agent tools are
// scoped to (see edit_agent.js). Defaults to two levels up from this file
// (src/gui/../.. = the repo root), which is right every time this hub is
// launched the way run.sh launches it; overridable so a test harness can
// point it at a scratch repo instead of this live one.
const repoRoot = path.resolve(args["repo-root"] || path.join(__dirname, "..", ".."));
const { createEditAgent } = require("./edit_agent.js");
const editAgent = createEditAgent({
  repoRoot,
  ollamaHost,
  ollamaPort,
  ollamaModel: editOllamaModel,
  ollamaTimeoutMs: editOllamaTimeoutMs,
  broadcast,
  post,
});

function post(s) {
  process.stdout.write("gui_hub: " + s + "\n");
}

// ── COMMAND WHITELIST ─────────────────────────────────────────────────────
// Every selector below is transcribed from GUI_PARAMETER_MAPPING.md's "live"
// rows and cross-checked against the DISPATCH table of the bridge that will
// actually receive it. A selector NOT in these lists is rejected here with a
// named error rather than being forwarded — see the note above.
//
// `target` maps 1:1 onto an outlet of bridge_guiHub.pd, which maps onto the
// inlet of an existing bridge abstraction in gnumbat-analyze.pd.
const COMMANDS = {
  // -> bridge_slicer.pd inlet 0 -> slicer_bridge.js DISPATCH
  // The sequencing brain: transport, segment selection, weighting. All live.
  slicer: new Set([
    "buildIndex", "start", "stop", "next", "forceNext", "selectSegment",
    "nextNearest", "loop", "unloop", "unloopAll", "skip", "skipLayer",
    "startTransition", "skipTransitionStart", "skipTransitionEnd",
    "lockSource", "unlockSource", "trigger", "setTriggerMode",
    "setPlaybackMode", "setSegmentBars", "setStayProb", "setMatchProb",
    "setWeight", "setDirPref", "setDirWeight", "setTrackWeight",
    "setLearnedWeight", "setSrcWeights", "setEntropy", "setQuantize",
    "setQuantizeStop", "setMaxSlices", "setFallbackBPM", "setGlobalBPM",
    "setStemSource", "setStemDurMs", "setGenreFilter", "clearGenreFilter",
    "listGenres", "setKeyFilter", "clearKeyFilter", "selectRange",
    "dumpDescriptors", "followStem", "setAgentMode", "setWindow",
    "returnToBase", "applyNow", "reloadDownbeats", "reloadBias",
    "seamDebug", "info", "reset",
    // "resetAll" is NOT a slicer_bridge.js DISPATCH verb -- it never reaches
    // Pd at all. Whitelisted under this target only so a bare ":resetAll"
    // typed in the console (gnumbat-live.js's sendRawCommand defaults an
    // unrecognized first word to target "slicer", same as every other bare
    // verb in the reference table) routes somewhere instead of bouncing off
    // as "unknown target". handleCommand() below intercepts it before the
    // OSC forward and runs performResetAll() instead. See that function's
    // own comment for what it does and, just as importantly, what it can't
    // reach.
    "resetAll",
  ]),

  // -> bridge_analyzeReader.pd -> analyze_reader_bridge.js
  // The file-I/O and batch half of track loading: scan htdemucs, write
  // stream.txt, drive the [counter 1 4] loop. Live as of 2026-08-02.
  analyze: new Set([
    "startAnalysis", "startStem", "resetMemory", "loadRegistry",
    "prepareNextTrack",
  ]),

  // -> analyze_reader.pd  (NOT the bridge — a different object)
  //
  // Worth being explicit about, because the names are nearly identical and
  // GUI_PARAMETER_MAPPING.md lists both under one "track loading" heading:
  // analyze_reader.pd is the native-Pd rewrite that does the actual per-onset
  // descriptor extraction, and it owns [route readVocals readMelo readBass
  // readDrums set_track_name]. bridge_analyzeReader.pd is the Node bridge next
  // to it that owns the batch/file-I/O commands above. Sending readVocals to
  // the bridge reaches nothing at all. This split is why they are two targets.
  reader: new Set([
    "readVocals", "readMelo", "readBass", "readDrums", "set_track_name",
  ]),

  // -> plain [send] objects inside gnumbat-analyze.pd. No bridge in between:
  // these are the two hooks GUI_PARAMETER_MAPPING.md lists as live natively.
  //   bpm        -> bpm_bar_resize~ (snaps buffer length to whole 4/4 bars)
  //   record_cmd -> sfrecord~ 2
  // preview_rate_* / preview_mute_* are the named receives this work adds to
  // the four stem_preview~ instances (the mapping doc's "live but not yet
  // named" tier).
  patch: new Set([
    "bpm", "record_cmd",
    "preview_rate_vocals", "preview_rate_melo",
    "preview_rate_bass", "preview_rate_drums",
    "preview_mute_vocals", "preview_mute_melo",
    "preview_mute_bass", "preview_mute_drums",
  ]),

  // -> handled entirely in this hub (see performBake*/performScore* below) —
  // never forwarded to Pd, same pattern as slicer.resetAll above. Ported
  // from src/max/ws_server.js's :bake/:scoreLyr/:scoreTrs (dropped to a doc
  // comment early in the Pd conversion, see this file's own header) using
  // the descriptor/context state this hub now mirrors from bridge_slicer's
  // own telemetry (see trainState / updateTrainingState below) instead of
  // Max inlet handlers. cricket_cmds/user_corrections/final_cmds/tag/
  // audioFile have no panel.html source yet -- written empty/null, see
  // performBakeEnd's own comment.
  bake: new Set([
    "start", "end", "abort", "scoreLyr", "scoreTrs",
  ]),

  // -> handled entirely in this hub (see handleModelsCommand, below) --
  // never forwarded to Pd, same reasoning as bake/resetAll above: this
  // hub (backed by src/network/artifacts/) IS the destination, not a
  // relay to bridge_guiHub.pd. Covers panel.html's whole #modelSelectView:
  // list/card reads, newSeed/branch/hybridize/rename/delete/setBakes/
  // touchEdit mutations, and vote/setIntegrate/replant for the
  // lineage/succession/voting layer.
  models: new Set([
    "list", "card", "newSeed", "branch", "hybridize", "rename", "delete",
    "setBakes", "touchEdit", "vote", "setIntegrate", "replant",
  ]),
};

// ── TELEMETRY: PD -> BROWSER ──────────────────────────────────────────────
// Addresses Pd sends on, and how each becomes a JSON frame for the panel.
// Keeping the shaping here (rather than in the panel) means the JUCE build
// can reuse the same frames verbatim over a native binding.
//
// The arg layouts match what bridge_guiHub.pd / stem_telemetry~.pd actually
// emit — see those files. Anything not listed is logged once and dropped, so
// a new report added on the Pd side is visible rather than silent.
const TELEMETRY = {
  // meter <stem> <peakL> <peakR> <rmsL> <rmsR>  — linear 0..1
  meter: (a) => ({ t: "meter", stem: a[0], peak: [a[1], a[2]], rms: [a[3], a[4]] }),

  // spectrum <stem> <64 linear magnitudes>
  // Sent linear, converted to dB in the panel: Pd vanilla has no log~, and
  // doing it in JS keeps the patch to arithmetic that fits in patch cords.
  spectrum: (a) => ({ t: "spectrum", stem: a[0], bands: a.slice(1) }),

  // rmsdb <stem> <value>  — unweighted RMS in dB, NOT LUFS.
  // Named honestly on purpose: stem_telemetry~ measures env~ -> dbtorms with
  // no K-weighting and no gating, so calling it "lufs" anywhere in this chain
  // would invite someone to trust it for a mastering decision. See that
  // abstraction's own "NOT LUFS" comment for what adding the real thing takes.
  rmsdb: (a) => ({ t: "rmsdb", stem: a[0], db: a[1] }),

  // position <stem> <frac 0..1>  — REAL playback position, added 2026-08-20.
  // Comes straight from a [line] ramp inside stem_timestretch~.pd, restarted
  // at 0 the instant "play" actually fires there and run over the segment's
  // real computed duration — genuine Pd-side elapsed playback time, not a
  // browser-side guess. Fixes the gap the "status play" doc block below used
  // to describe: "the engine emits a segment once and does not stream
  // position" (see gnumbat-live.js's own comment on what used this excuse to
  // justify pure interpolation, and stem_timestretch~.pd's "POSITION FEED"
  // comment for exactly how this value is produced). Arrives at ~20ms grain
  // (Pd's own [line] update rate) while a segment is actually playing.
  position: (a) => ({ t: "position", stem: a[0], frac: a[1] }),

  // status <key> [value...]
  //
  // This is the pass-through for everything the panel needs that is NOT
  // measured from audio. The waveform display is the case that matters: it is
  // not a live scope, it is the stem's whole file drawn once from analysis,
  // with an armed-segment bracket and a playhead over it. Those two overlays
  // move with segment selection, not with the signal — so they come from
  // bridge_slicer's own outlets, not from a meter. (The playhead's actual
  // position now ALSO comes from the "position" telemetry above, layered on
  // top of the "play" trigger's start/end/ratio this frame still provides —
  // see that key's own comment for what changed.)
  //
  //   status play  <track> <slot> <startFrac> <endFrac> <ratio> <segDurMs> ...
  //        — bridge_slicer outlet 0, tagged `play` on the Pd side because that
  //          outlet's playback-trigger form has no leading tag of its own.
  //   status desc|seg|ready|slices|sysMsg ...
  //        — bridge_slicer outlet 1, which already tags itself.
  //   status analysisDone | streamUpdated
  //        — the two patch-level reports from GUI_PARAMETER_MAPPING.md.
  status: (a) => ({ t: "status", key: a[0], args: a.slice(1) }),
};
const unknownAddrSeen = new Set();

// ── TRAINING STATE: descriptor/context cache fed by Pd's own telemetry ────
// Ported from src/max/ws_server.js's `state.stems`/`state` -- that file was
// dropped to a doc comment early in the Pd conversion (see this file's own
// header) and its :bake/:scoreLyr/:scoreTrs handlers went with it. This is
// the minimal state needed to reconstruct their real snapshots from what
// bridge_slicer.pd ALREADY broadcasts through TELEMETRY.status above (desc/
// seg/stemTrack/stemMS/globalBPM/segmentBars -- all already flow through
// unchanged, since that shape is a generic `key, ...args` pass-through) --
// NOT from any new Pd wiring. Confirmed by reading slicer_bridge.js's own
// outlet(1, ...) calls directly rather than assuming.
//
// Fields the original ws_server.js `state` had that are NOT reconstructed
// here, because nothing currently broadcasts them from Pd to this hub --
// flagged rather than silently defaulted to something that looks real:
//   - key (musical key)             -- never broadcast anywhere in this chain
//   - state.ms.* mixer bus (boothGain/recGain/masterJoy, and the
//     vocals/melody/bass/drums entries beyond per-stem pan/width already
//     covered by stemMS) -- no Pd telemetry source found
//   - per-stem `slot`               -- lives only inside
//     buffer_manager_bridge.js's own slotToTrack map, a separate process
//     with no shared state with this hub today
//   - section intensity (computeIntensity() in the original) -- review-only
//     field, not a train_bias.py feature; not ported
// Adding real values for these means new Pd-side broadcasts (or a small
// cross-bridge read), not a hub-only change -- flagged in the handoff so it
// isn't mistaken for "already wired."
const STEM_KEYS = ["vocals", "melody", "bass", "drums"];
function emptyStemState() {
  return {
    C: 0, S: 0, E: 0, F: 0, P: 0, H: 0, T: 0, D: 0,
    tC: 0, tS: 0, tE: 0, tF: 0, tP: 0, tH: 0, tT: 0,
    track: "", id: "--", sliceStart: undefined, sliceEnd: undefined,
    pan: 0, width: 0, segBars: null,
    prevSegment: null,
  };
}
const trainState = {
  track: "no track loaded",
  globalBPM: 0,
  stems: {
    vocals: emptyStemState(), melody: emptyStemState(),
    bass: emptyStemState(), drums: emptyStemState(),
  },
  // bakeFrames -- combined 4-stem C/S/E/F/P/H/T/D snapshots captured while a
  // ":bake start" bracket is open (see "desc" handling in updateTrainingState
  // below and performBakeStart/performScoreLyr further down). Top-level, not
  // per-stem: each entry is one time-aligned moment across all 4 stems, which
  // is what performScoreLyr's new "samples" field is built from.
  bakeFrames: [],
};

// updateTrainingState -- called on every OSC packet from Pd, whether or not
// TELEMETRY has a browser-facing shape for it (unlike the browser relay,
// this one only cares about the handful of addresses below). `desc` and
// `stemMS`/`stemTrack`/`globalBPM`/`segmentBars` all arrive tagged as
// `status <key> <args...>` (bridge_slicer's own outlet 1) -- so this reads
// the SAME `status` address the browser relay already does, just also
// mirrors it into trainState. decodeMessage() in osc.js already returns
// plain values (not {type,value} pairs -- that shape is encodeArgs' OUTGOING
// format only), so args below are used as-is, same as every TELEMETRY shape
// function above already does.
function updateTrainingState(address, args) {
  if (address !== "status") return;
  const list = args || [];
  const key = list[0];
  const a = list.slice(1);
  if (key === "desc") {
    const [stem, C, S, E, F, P, H, T, tC, tS, tE, tF, tP, tH, tT, D] = a;
    const st = trainState.stems[stem];
    if (!st) return;
    // Snapshot the OUTGOING descriptors before they're overwritten -- same
    // ordering guarantee ws_server.js relied on (desc always precedes seg
    // for a new segment) -- see performScoreTrs below, which reads this as
    // the "from" side of a transition.
    if (st.id && st.id !== "--") {
      st.prevSegment = {
        id: st.id, sourceTrack: st.track,
        sliceStart: st.sliceStart, sliceEnd: st.sliceEnd,
        descriptors: {
          C: st.C, S: st.S, E: st.E, F: st.F, P: st.P, H: st.H, T: st.T,
          tension_C: st.tC, tension_S: st.tS, tension_E: st.tE, tension_F: st.tF,
          tension_P: st.tP, tension_H: st.tH, tension_T: st.tT,
        },
      };
    }
    Object.assign(st, {
      C: +C || 0, S: +S || 0, E: +E || 0, F: +F || 0, P: +P || 0, H: +H || 0, T: +T || 0, D: +D || 0,
      tC: +tC || 0, tS: +tS || 0, tE: +tE || 0, tF: +tF || 0, tP: +tP || 0, tH: +tH || 0, tT: +tT || 0,
    });
    // Vertical training capture: while a ":bake start" bracket is open,
    // append one combined 4-stem C/S/E/F/P/H/T/D snapshot per genuinely NEW
    // moment. tickLiveDesc() (slicer_bridge.js) fires every 20ms but reports
    // whichever slice is currently under the playhead, so most ticks repeat
    // the same slice's values verbatim -- dedup by comparing against the
    // last captured frame (cheap/correct here: small, flat, all-numeric
    // objects) so bakeFrames doesn't fill with thousands of near-duplicate
    // rows. bakeSessionId is declared with `let` further down in this same
    // module scope; that's fine here since updateTrainingState is only ever
    // CALLED after the whole module has finished loading (by which point the
    // `let` has been initialized), even though its declaration appears later
    // in the file's source order.
    if (bakeSessionId) {
      const snap = {};
      for (const s of STEM_KEYS) {
        const t = trainState.stems[s];
        snap[s] = { C: t.C, S: t.S, E: t.E, F: t.F, P: t.P, H: t.H, T: t.T, D: t.D };
      }
      const last = trainState.bakeFrames[trainState.bakeFrames.length - 1];
      if (!last || JSON.stringify(last) !== JSON.stringify(snap)) {
        trainState.bakeFrames.push(snap);
      }
    }
  } else if (key === "seg") {
    // Two incompatible shapes reach this address from slicer_bridge.js --
    // the normal per-segment form (track, id, dur/frac, dist, time, endFrac)
    // and a loop/transition-handoff form (track, "loop3"/"transition1",
    // "<n>bars", "(...)") with no numeric id/fraction fields at all. Only
    // update sliceStart/sliceEnd/id from the normal form (args[3]/[4]
    // numeric, matching time/endFrac's position after stem+id+dur+dist) --
    // the handoff form just means "keep whatever the last real segment
    // said," matching how the original state.stems[track].id/.sliceStart
    // only ever moved forward on a genuine new segment too.
    const [stem, id, , , time, endFrac] = a;
    const st = trainState.stems[stem];
    if (!st) return;
    if (typeof time === "number" && typeof endFrac === "number") {
      st.sliceStart = time;
      st.sliceEnd = endFrac;
    }
    if (id !== undefined) {
      const idStr = String(id);
      st.id = idStr.includes(":") ? idStr.split(":").pop() : idStr;
    }
  } else if (key === "stemTrack") {
    const [stem, name] = a;
    if (trainState.stems[stem]) trainState.stems[stem].track = String(name || "");
  } else if (key === "stemMS") {
    const [stem, pan, width] = a;
    const st = trainState.stems[stem];
    if (st) { st.pan = +pan || 0; st.width = +width || 0; }
  } else if (key === "globalBPM") {
    trainState.globalBPM = +a[0] || 0;
  } else if (key === "segmentBars") {
    const [stemOrAll, n] = a;
    if (stemOrAll === "all") {
      STEM_KEYS.forEach((s) => { trainState.stems[s].segBars = +n || null; });
    } else if (trainState.stems[stemOrAll]) {
      trainState.stems[stemOrAll].segBars = +n || null;
    }
  }
}

// ── SONG STRUCTURE: :tag lookups, ported read-only from ws_server.js ──────
// (saveSongStructure()/the :tag write path itself is NOT ported -- nothing
// in this hub's whitelist writes song_structure.json yet, so this only
// reads whatever the TUI/old system already wrote there, same file path.)
function songStructurePath() {
  return path.join(getSessionDir(), "song_structure.json");
}
function loadSongStructure() {
  try {
    return JSON.parse(fs.readFileSync(songStructurePath(), "utf8"));
  } catch (e) {
    return {};
  }
}
function findSection(structure, sourceTrack, frac) {
  const entry = structure[sourceTrack];
  if (!entry || !entry.sections || frac == null) return null;
  for (const sec of entry.sections) {
    if (frac >= sec.startFrac && frac < sec.endFrac) return sec;
  }
  return null;
}

// ── BAKE / SCORE: real training-log writers ────────────────────────────────
// Faithful port of src/max/ws_server.js's :bake / :scoreLyr / :scoreTrs
// handlers, deliberately scoped down (see this session's own handoff
// notes): the bracket-accumulation fields app.js used to build up between
// ":bake start" and ":bake end" (cricket_cmds, user_corrections, final_cmds,
// attempts, tag, audioFile) have no panel.html equivalent yet -- this panel
// has no Cricket-chat-driven bake sequence UI -- so they're written as
// empty/null, same JSON shape as before, ready for a future pass to
// populate for real instead of needing a schema change later.
// pendingRenders -- one entry per in-flight POST /api/render request,
// resolved/rejected from the /progress handler below when
// analyze_reader_bridge.js's startRenderAnalysis() batch finishes (or
// times out). See POST /api/render for the full flow.
const pendingRenders = new Map(); // renderId -> {resolve, reject, timer}

let bakeSessionId = null;
let bakeIntent = null;

function performBakeStart(intent) {
  bakeSessionId = "bake_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  bakeIntent = intent || "";
  trainState.bakeFrames = [];
  post("bake: bracket open (" + bakeSessionId + ") -- " + bakeIntent);
  broadcast({ t: "status", key: "sys", args: ["bake: bracket open -- " + bakeIntent] });
}

function performBakeEnd() {
  if (!bakeSessionId) {
    broadcast({ t: "status", key: "sys", args: ["bake: no open bracket -- send bake/start first"] });
    return;
  }
  const snapshot = {
    timestamp: new Date().toISOString(),
    bakeSessionId,
    intent: bakeIntent || "",
    cricket_cmds: [],
    user_corrections: [],
    final_cmds: [],
    attempts: null,
    tag: null,
    audioFile: null,
    track: trainState.track,
    bpm: trainState.globalBPM,
    stems: JSON.parse(JSON.stringify(trainState.stems)),
  };
  try {
    fs.appendFileSync(path.join(getSessionDir(), "training_log.jsonl"), JSON.stringify(snapshot) + "\n");
    post("bake: baked (" + bakeSessionId + ")");
    broadcast({ t: "status", key: "sys", args: ["baked"] });
  } catch (e) {
    post("bake: FAILED to write training_log.jsonl -- " + e.message);
    broadcast({ t: "error", of: { target: "bake", sel: "end" }, msg: e.message });
  }
  bakeSessionId = null; bakeIntent = null;
}

function performBakeAbort() {
  post("bake: aborted (" + (bakeSessionId || "no bracket") + ") -- nothing stored");
  broadcast({ t: "status", key: "sys", args: ["bake aborted -- nothing stored"] });
  bakeSessionId = null; bakeIntent = null;
}

function performScoreLyr(rating, overallSection) {
  const score = Math.max(-1, Math.min(1, parseFloat(rating)));
  if (isNaN(score)) {
    broadcast({ t: "status", key: "sys", args: ["usage: scoreLyr <-1..1> [overallSection]"] });
    return;
  }
  const structure = loadSongStructure();
  const snapshot = {
    timestamp: new Date().toISOString(),
    type: "vertical",
    rating: score,
    overallSection: overallSection || null,
    bakeSessionId, bakeAttempt: null, bakeIntent,
    track: trainState.track,
    bpm: trainState.globalBPM,
    globalBPM: trainState.globalBPM,
    key: null,
    stems: Object.fromEntries(STEM_KEYS.map((s) => {
      const st = trainState.stems[s];
      const mid = (st.sliceStart !== undefined && st.sliceEnd !== undefined) ? (st.sliceStart + st.sliceEnd) / 2 : null;
      const sec = (st.track && mid !== null) ? findSection(structure, st.track, mid) : null;
      return [s, {
        sourceTrack: st.track,
        slot: null,
        descriptors: {
          C: st.C, S: st.S, E: st.E, F: st.F, P: st.P, H: st.H, T: st.T,
          tension_C: st.tC, tension_S: st.tS, tension_E: st.tE, tension_F: st.tF,
          tension_P: st.tP, tension_H: st.tH, tension_T: st.tT,
        },
        segmentBars: st.segBars,
        pan: st.pan, width: st.width,
        section: sec ? sec.tag : null,
        sectionIntensity: null,
      }];
    })),
    master: { joy: null, boothGain: null, recGain: null },
    // samples -- what build_vertical_dataset() (train_bias_torch.py) actually
    // trains on now: every distinct combined 4-stem C/S/E/F/P/H/T/D moment
    // captured during the open bake bracket (see bakeFrames capture in the
    // "desc" handler above), each becoming its own training example under
    // this one `rating`. Falls back to a single current-instant snapshot
    // when no bracket was open (or it captured nothing) so :scoreLyr never
    // silently logs zero examples.
    samples: trainState.bakeFrames.length
      ? trainState.bakeFrames.slice()
      : [Object.fromEntries(STEM_KEYS.map((s) => {
          const t = trainState.stems[s];
          return [s, { C: t.C, S: t.S, E: t.E, F: t.F, P: t.P, H: t.H, T: t.T, D: t.D }];
        }))],
  };
  try {
    fs.appendFileSync(path.join(getSessionDir(), "training_log_vertical.jsonl"), JSON.stringify(snapshot) + "\n");
    post("bake: scored " + score.toFixed(2) + " (vertical)");
    broadcast({ t: "status", key: "sys", args: ["scored " + score.toFixed(2) + " -- layered combo logged"] });
  } catch (e) {
    post("bake: FAILED to write training_log_vertical.jsonl -- " + e.message);
    broadcast({ t: "error", of: { target: "bake", sel: "scoreLyr" }, msg: e.message });
  }
}

function performScoreTrs(rating, stemFilter) {
  const score = Math.max(-1, Math.min(1, parseFloat(rating)));
  if (isNaN(score)) {
    broadcast({ t: "status", key: "sys", args: ["usage: scoreTrs <-1..1> [stem]"] });
    return;
  }
  if (stemFilter && !trainState.stems[stemFilter]) {
    broadcast({ t: "status", key: "sys", args: ["usage: scoreTrs <-1..1> [stem] -- unknown stem '" + stemFilter + "'"] });
    return;
  }
  const stemKeys = stemFilter ? [stemFilter] : STEM_KEYS;
  const structure = loadSongStructure();
  const stemsOut = {};
  let any = false;
  for (const s of stemKeys) {
    const st = trainState.stems[s];
    if (!st || !st.prevSegment) continue;
    any = true;
    const fromMid = (st.prevSegment.sliceStart + st.prevSegment.sliceEnd) / 2;
    const toMid = (st.sliceStart !== undefined && st.sliceEnd !== undefined) ? (st.sliceStart + st.sliceEnd) / 2 : null;
    const fromSec = findSection(structure, st.prevSegment.sourceTrack, fromMid);
    const toSec = (st.track && toMid !== null) ? findSection(structure, st.track, toMid) : null;
    stemsOut[s] = {
      from: { sourceTrack: st.prevSegment.sourceTrack, id: st.prevSegment.id, descriptors: st.prevSegment.descriptors, section: fromSec ? fromSec.tag : null },
      to: {
        sourceTrack: st.track, id: st.id,
        descriptors: {
          C: st.C, S: st.S, E: st.E, F: st.F, P: st.P, H: st.H, T: st.T,
          tension_C: st.tC, tension_S: st.tS, tension_E: st.tE, tension_F: st.tF,
          tension_P: st.tP, tension_H: st.tH, tension_T: st.tT,
        },
        section: toSec ? toSec.tag : null,
      },
    };
  }
  if (!any) {
    broadcast({ t: "status", key: "sys", args: ["scoreTrs -- no transition recorded yet" + (stemFilter ? " for " + stemFilter : "")] });
    return;
  }
  const snapshot = {
    timestamp: new Date().toISOString(),
    type: "horizontal_transition",
    rating: score,
    bakeSessionId, bakeAttempt: null, bakeIntent,
    stems: stemsOut,
  };
  try {
    fs.appendFileSync(path.join(getSessionDir(), "training_log_horizontal.jsonl"), JSON.stringify(snapshot) + "\n");
    post("bake: transition scored " + score.toFixed(2));
    broadcast({ t: "status", key: "sys", args: ["transition scored " + score.toFixed(2) + " -- logged"] });
  } catch (e) {
    post("bake: FAILED to write training_log_horizontal.jsonl -- " + e.message);
    broadcast({ t: "error", of: { target: "bake", sel: "scoreTrs" }, msg: e.message });
  }
}


// ── WEBSOCKET (RFC 6455, minimal server) ──────────────────────────────────
// Hand-rolled for the same reason osc.js is: this project's bridges install
// nothing. Scope is deliberately the subset a local control surface needs —
// text frames, close, ping/pong, and fragmented-message reassembly. No
// permessage-deflate, no binary frames.
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const clients = new Set();

function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

// Builds one unfragmented frame. Server->client frames are never masked.
function wsFrame(payload, opcode = 0x1) {
  const data = Buffer.from(payload, "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // High 32 bits stay zero — a telemetry frame will never reach 4GB.
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, data]);
}

function attachWebSocket(socket, onText) {
  let buf = Buffer.alloc(0);
  // Continuation state, for a message split across frames.
  let fragOpcode = 0;
  let fragParts = [];

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);

    // Loop because one TCP read can carry several frames.
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;

      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        // Ignore the high word, as above.
        len = buf.readUInt32BE(off + 4);
        off += 8;
      }

      let mask = null;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.slice(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) return; // frame not fully arrived yet

      const payload = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.slice(off + len);

      if (opcode === 0x8) {            // close
        socket.end(wsFrame("", 0x8));
        return;
      } else if (opcode === 0x9) {     // ping -> pong
        socket.write(wsFrame(payload.toString("utf8"), 0xa));
        continue;
      } else if (opcode === 0xa) {     // pong, nothing to do
        continue;
      }

      if (opcode === 0x0) {            // continuation
        fragParts.push(payload);
        if (!fin) continue;
        const whole = Buffer.concat(fragParts);
        fragParts = [];
        if (fragOpcode === 0x1) onText(whole.toString("utf8"));
        fragOpcode = 0;
        continue;
      }

      if (!fin) {                      // first frame of a fragmented message
        fragOpcode = opcode;
        fragParts = [payload];
        continue;
      }

      if (opcode === 0x1) onText(payload.toString("utf8"));
      // binary frames (0x2) are not part of this protocol; dropped.
    }
  });
}

function broadcast(obj) {
  if (clients.size === 0) return;
  const frame = wsFrame(JSON.stringify(obj));
  for (const c of clients) {
    // Never let one wedged socket stall the telemetry path.
    if (c.writable) c.write(frame);
  }
}

// ── ROOMS / PRESENCE ──────────────────────────────────────────────────────
// Every model has a room (keyed by the model's id). A panel says which one it
// is in with {t:"roomJoin", room}; the hub keeps socket -> room and pushes
// {t:"roomPresence", counts:{room:n}} to every panel whenever a count
// changes, so each panel can show "N listening". A panel's room disappears
// with its socket. In-memory only -- this is presence, not a ledger.
const socketRoom = new Map();
function roomCounts() {
  const counts = {};
  for (const room of socketRoom.values()) counts[room] = (counts[room] || 0) + 1;
  return counts;
}
function broadcastPresence() { broadcast({ t: "roomPresence", counts: roomCounts() }); }
function setSocketRoom(socket, room) {
  const next = typeof room === "string" && room ? room.slice(0, 200) : null;
  const prev = socketRoom.get(socket) || null;
  if (next === prev) return;
  if (next) socketRoom.set(socket, next); else socketRoom.delete(socket);
  broadcastPresence();
}

// ── OSC: HUB -> PD ────────────────────────────────────────────────────────
// One address for every command. bridge_guiHub.pd routes on the first arg.
// Numbers go as OSC floats, everything else as strings — same encodeArgs
// convention as slicer_bridge.js, so the Pd side sees the atom types it
// already expects.
function encodeArgs(list) {
  return list.map((v) =>
    typeof v === "number" && isFinite(v)
      ? { type: "f", value: v }
      : { type: "s", value: String(v) }
  );
}

let osc = null;
// Send-only OSC clients straight to sliceWriter/bufferManager -- see
// performResetAll() and their creation in start() below.
let oscSliceWriter = null;
let oscBufferManager = null;
let oscAnalyzeReader = null; // NEW 2026-09-09 -- see analyzeReaderPort above

function handleCommand(msg, replyTo) {
  const target = msg.target;
  const sel = msg.sel;
  const rest = Array.isArray(msg.args) ? msg.args : [];

  const allowed = COMMANDS[target];
  if (!allowed) {
    const e = "unknown target '" + target + "' (expected one of: " +
      Object.keys(COMMANDS).join(", ") + ")";
    post("REJECT " + e);
    if (replyTo) replyTo({ t: "error", of: msg, msg: e });
    return;
  }
  if (!allowed.has(sel)) {
    // The common cause of this is a selector that exists in slicer.js but was
    // never added to the whitelist — say so, rather than implying it is
    // invalid outright.
    const e = "selector '" + sel + "' is not whitelisted for target '" +
      target + "'. If it is a real command, add it to COMMANDS." + target +
      " in gui_hub_bridge.js.";
    post("REJECT " + e);
    if (replyTo) replyTo({ t: "error", of: msg, msg: e });
    return;
  }

  // resetAll is whitelisted under "slicer" (see that Set's own comment) but
  // handled entirely here -- there is nothing on the Pd side for it to
  // reach, so it never falls through to the generic OSC forward below.
  if (target === "slicer" && sel === "resetAll") {
    // performResetAll() broadcasts its own {t:'status', key:'resetAllResult',
    // ...} once the wipe is done, with per-step ok/fail detail -- no separate
    // ack needed here.
    performResetAll();
    return;
  }

  // bake is handled entirely here, same reasoning as resetAll above -- there
  // is nothing on the Pd side for :bake/:scoreLyr/:scoreTrs to reach, this
  // hub IS the destination (see trainState/performBake*/performScore* above).
  if (target === "bake") {
    if (sel === "start") performBakeStart(rest[0]);
    else if (sel === "end") performBakeEnd();
    else if (sel === "abort") performBakeAbort();
    else if (sel === "scoreLyr") performScoreLyr(rest[0], rest[1]);
    else if (sel === "scoreTrs") performScoreTrs(rest[0], rest[1]);
    return;
  }

  if (target === "models") {
    handleModelsCommand(sel, rest, replyTo);
    return;
  }

  osc.send("/guiCmd", encodeArgs([target, sel, ...rest]));
  if (verbose) post("-> pd  " + target + " " + sel + " " + rest.join(" "));
}

// ── MODELS: panel.html's #modelSelectView, backed by
// src/network/artifacts/ ──────────────────────────────────────────────────
// Every selector is a thin call into models.js/registry.js/lineage.js,
// followed by broadcasting the recomputed list to every connected panel
// (broadcastModels()) so two open tabs, or a reload, never drift out of
// sync with each other or with what's actually on disk in
// data/network/registry/. Mutating selectors also reply directly to the
// requesting socket with the single affected card/result, so that panel
// can reconcile its own optimistic local update immediately rather than
// waiting on the broadcast round-trip.
function broadcastModels() {
  broadcast({ t: "models", models: modelsApi.listCards() });
}

function handleModelsCommand(sel, args, replyTo) {
  const ok = (data) => { if (replyTo) replyTo({ t: "modelsResult", sel, ok: true, data }); };
  const fail = (err) => {
    post("models." + sel + " failed: " + err.message);
    if (replyTo) replyTo({ t: "modelsResult", sel, ok: false, error: err.message });
  };

  try {
    if (sel === "list") { ok(modelsApi.listCards()); return; }

    if (sel === "card") {
      ok(modelsRegistry.modelCard(args[0]));
      return;
    }

    if (sel === "newSeed") {
      const [name, creatorName] = args;
      modelsApi.createModel({ name, creator: creatorName })
        .then((card) => { ok(card); broadcastModels(); })
        .catch(fail);
      return;
    }

    if (sel === "branch") {
      const [parentId, name, creatorName] = args;
      modelsApi.createModel({ name, parentId, creator: creatorName })
        .then((card) => { ok(card); broadcastModels(); })
        .catch(fail);
      return;
    }

    if (sel === "hybridize") {
      const [parentId, parentId2, name] = args;
      modelsApi.createModel({ name, parentId, parentId2 })
        .then((card) => { ok(card); broadcastModels(); })
        .catch(fail);
      return;
    }

    if (sel === "rename") {
      const [hash, name, editorName] = args;
      ok(modelsApi.renameModel(hash, name, { editorName }));
      broadcastModels();
      return;
    }

    if (sel === "delete") {
      ok(modelsApi.deleteModel(args[0]));
      broadcastModels();
      return;
    }

    if (sel === "setBakes") {
      const [hash, bakes, editorName] = args;
      ok(modelsApi.setBakes(hash, bakes, { editorName }));
      broadcastModels();
      return;
    }

    if (sel === "touchEdit") {
      const [hash, editorName] = args;
      ok(modelsApi.touchEdit(hash, { editorName }));
      broadcastModels();
      return;
    }

    if (sel === "vote") {
      // direction is 'up' | 'down' | 0 (0 retracts an existing vote --
      // see votes.js's castVote() for why 0 is a real, meaningful value
      // here rather than a no-op).
      const [hash, direction, voterId, voterKind] = args;
      const value = direction === "up" ? 1 : direction === "down" ? -1 : 0;
      ok(modelsApi.castVote(hash, voterId, value, voterKind));
      broadcastModels();
      return;
    }

    if (sel === "setIntegrate") {
      const [hash, enabled] = args;
      modelsRegistry.setIntegrateFollowingBranches(hash, !!enabled);
      // Composed modelCard(), not the raw registry entry -- matches the
      // shape every other mutating selector here returns (rename/setBakes/
      // touchEdit via models.js, vote via castVote+card elsewhere), so a
      // caller never has to special-case this one selector's reply.
      ok(modelsRegistry.modelCard(hash));
      broadcastModels();
      return;
    }

    if (sel === "replant") {
      const [hash, reason, actor] = args;
      ok(modelsLineage.replant(hash, { reason, actor }));
      broadcastModels();
      return;
    }

    if (sel === "setReleaseState") {
      // The consumer-app gate (spec: DEVELOPMENT/TRAINING/TESTING/READY/
      // RELEASED/EVOLVING -- docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md).
      // A curator action only -- never automatic, never triggered by votes
      // or training completing on their own. Composed modelCard() reply,
      // same convention as every other mutating selector above.
      const [hash, releaseState] = args;
      modelsRegistry.setReleaseState(hash, releaseState);
      ok(modelsRegistry.modelCard(hash));
      broadcastModels();
      return;
    }

    if (sel === "addBake") {
      // A Bake made in the Gnumbat plugin while this model was current. Appended to the same
      // per-model bakes list panel.html's own bake brackets live in (deduped by id), so both
      // windows count it. Shape mirrors panel.html's own bake rows; source marks where it came from.
      const [hash, bake, editorName] = args;
      const entry = modelsRegistry.get(hash);
      if (!entry) throw new Error("unknown model " + hash);
      const b = bake || {};
      if (!b.id) throw new Error("addBake needs a bake id");
      const bakes = (entry.bakes || []).filter((x) => x && x.id !== b.id);
      bakes.push({
        id: String(b.id), parentId: null, d: "--", n: String(b.n || b.id), score: 0,
        bars: Number(b.bars) || 0,
        tracks: { vcl: ["auto"], mel: ["auto"], bas: ["auto"], drm: ["auto"] },
        source: "gnumbat-plugin", createdAt: b.createdAt || new Date().toISOString()
      });
      ok(modelsApi.setBakes(hash, bakes, { editorName }));
      broadcastModels();
      return;
    }

    fail(new Error("unhandled models selector: " + sel));
  } catch (err) {
    fail(err);
  }
}

// ── RESET: wipe the active session back to zero for another run ──────────
// Faithful continuation of the Max-era :resetAll (src/max/ws_server.js, same
// handler name, same atoms[0]==='resetAll' entry point conceptually) with
// one deliberate difference the user asked for explicitly: the original
// comment reads "Keeps source audio (mp4/wav in data/) and stem audio
// (data/stems/). Run the analysis pipeline again after this to rebuild from
// scratch." This version wipes the demucs stem output AND raw_uploads too --
// the point here is a genuine clean slate before another end-to-end run
// (fresh upload through fresh analysis), not a re-analysis of stems that are
// already sitting on disk.
//
// FIX 2026-09-02 ("I want the resetAll to really resetAll"): this used to
// be unable to reach slice_writer_bridge.js or buffer_manager_bridge.js --
// each keeps its own in-memory library/index state, and bridge_guiHub.pd's
// [route slicer analyze reader patch] only ever had those four targets, so
// there was no path from this hub to either one. Wiping the files below
// while either process was still alive with stale in-memory state risked it
// re-saving that state right back on its own next periodic write
// (sliceWriter's log line "saved N chars to library" fires on more than
// just buildIndex). Fixed by giving this hub two more OSC clients
// (oscSliceWriter, oscBufferManager -- see start(), above) that talk
// straight to those processes' own recv ports over UDP, Node-to-Node, with
// no Pd patch involved -- so this now sends a real resetMemory to all four
// live processes (analyze, slicer, sliceWriter, bufferManager), not two.
// A full restart (`./run.sh stop && ./run.sh`) is still the only way to
// also reset streamWatcher and guiHub's own in-memory state, but neither of
// those holds analysis data, so it's no longer needed for a clean slate.
function performResetAll() {
  const sessionDir = getSessionDir();
  // Every helper below now returns true/false and the caught error (if any)
  // instead of swallowing it silently -- the previous version's empty catch
  // blocks meant a permission error or a wrong path would look IDENTICAL to
  // a real success in every log line, which is exactly the failure mode
  // reported: "it's in the system but not actually resetting." Now every
  // path gets its own explicit ok/fail line, both in the server log (post)
  // and in the {t:'status', key:'resetAllResult', ...} frame broadcast to
  // the panel, so a failure is visible in the console instead of assumed.
  const results = [];
  const record = (label, p, fn) => {
    try {
      fn();
      results.push({ label, path: p, ok: true });
    } catch (e) {
      results.push({ label, path: p, ok: false, err: e.code || e.message });
    }
  };
  const wipeJson = (label, p) => record(label, p, () => fs.writeFileSync(p, "{}", "utf8"));
  const wipeText = (label, p) => record(label, p, () => fs.writeFileSync(p, "", "utf8"));
  const del = (label, p) => record(label, p, () => {
    try { fs.unlinkSync(p); } catch (e) { if (e.code !== "ENOENT") throw e; } // already gone counts as ok
  });
  const emptyDir = (label, p) => record(label, p, () => {
    fs.rmSync(p, { recursive: true, force: true });
    fs.mkdirSync(p, { recursive: true });
  });

  // ── analysis / index / library ──────────────────────────────────────────
  wipeJson("analysis_library.json", path.join(sessionDir, "analysis_library.json"));
  wipeJson("genres.json", path.join(sessionDir, "genres.json"));
  wipeJson("downbeats.json", path.join(sessionDir, "downbeats.json"));
  wipeText("stream.txt", path.join(sessionDir, "stream.txt"));
  del("gnumbat.db", path.join(sessionDir, "gnumbat.db"));
  del("slicer_index.json", path.join(sessionDir, "slicer_index.json"));
  // gnumbat_index.json is the legacy Max-era index file (see
  // session_manager.js's LEGACY_MAX_FILES / app.js's own reset flow, which
  // already deletes it). It's not written by the current Pd bridges
  // (slicer_bridge.js persists slicer_index.json instead), but a stale
  // one can still be sitting on disk from an earlier Max-era session and
  // was silently surviving every "Reset All" -- add it here so a reset is
  // actually a clean slate regardless of which era wrote it.
  del("gnumbat_index.json", path.join(sessionDir, "gnumbat_index.json"));

  // ── demucs stem output + raw uploads -- NOT wiped by the old resetAll;
  // the user asked for these explicitly, for a true back-to-zero reset ─────
  emptyDir("stems/htdemucs/", path.join(sessionDir, "stems", "htdemucs"));
  emptyDir("raw_uploads/", path.join(sessionDir, "raw_uploads"));
  // FIX 2026-09-02: frame_analysis/ (the raw per-array soundfiler exports
  // in frame_analysis/raw/, plus the combined <track>_frames.json files
  // export_frame_descriptors.py writes) is derived, track-specific analysis
  // output, same category as the stems/analysis_library.json above -- it
  // needs to be wiped for the same "clean slate before another end-to-end
  // run" reason, or old tracks' exports just sit there next to new ones.
  emptyDir("frame_analysis/", path.join(sessionDir, "frame_analysis"));

  const failed = results.filter((r) => !r.ok);
  post("resetAll: session '" + getSessionId() + "' (" + sessionDir + ")");
  for (const r of results) {
    post("resetAll:   " + (r.ok ? "OK  " : "FAIL") + "  " + r.label + (r.ok ? "" : "  -- " + r.err));
  }
  if (failed.length) {
    post("resetAll: " + failed.length + " of " + results.length + " step(s) FAILED -- see above");
  }

  // Live clear of all four analysis/playback bridges -- see this function's
  // own header comment (the 2026-09-02 fix) for how sliceWriter/bufferManager
  // are now reached too, below.
  if (osc) {
    osc.send("/guiCmd", encodeArgs(["analyze", "resetMemory"]));
    osc.send("/guiCmd", encodeArgs(["slicer", "reset"]));
  }
  // FIX 2026-09-02 -- the two bridges the old comment said this "cannot
  // reach": direct UDP, bare selector (osc.js's encodeMessage() adds the
  // leading "/" and both bridges' DISPATCH tables dispatch on the bare
  // name -- see slice_writer_bridge.js / buffer_manager_bridge.js).
  if (oscSliceWriter) oscSliceWriter.send("resetMemory", []);
  if (oscBufferManager) oscBufferManager.send("resetMemory", []);

  broadcast({
    t: "status",
    key: "resetAllResult",
    args: [getSessionId(), results.length - failed.length, failed.length,
      ...failed.map((r) => r.label + ":" + r.err)],
  });
}

// ── CRICKET (chat) ───────────────────────────────────────────────────────
// Same mechanism src/tui/app.js used: a local Ollama model, given a system
// prompt built from docs/instrument/CRICKET.md (+ src/tui/voice.md and
// src/tui/rules.md, the same two style files, read from their one real
// location rather than duplicated here), talking free-form and occasionally
// answering with Gnumbat command lines mixed into its prose.
//
// WHAT MOVED HERE VS WHAT STAYED IN THE BROWSER
// This hub does the same job ws_server.js never did — the Ollama call, the
// system prompt, and conversation history all lived in app.js (the TUI
// process) before, not in ws_server.js. So Cricket herself moves to
// whichever process is now "the client" — and that is the browser, not this
// hub, by the same logic gui_hub_bridge.js is a relay for everything else
// (see the file header). This hub's ONLY job is: take the user's text, call
// Ollama with the right persona and history, split the reply into prose vs.
// recognized command lines (identical isCommand()/COMMANDS_ALL logic to
// app.js's), and hand BOTH back unevaluated. It does deliberately NOT decide
// what a command line means — app.js's own callCricket() callback special-
// cased showState/showCommands as TUI-local and forwarded everything else
// to sendToMax(); gnumbat-live.js now does that exact same split client-side
// (see its CHAT section). Forwarded commands still go through this hub's
// own handleCommand()/COMMANDS whitelist above like any other, so a command
// Cricket's knowledge base still mentions but that never got ported to Pd
// (the whole dropped audio-FX/EQ/pitch subsystem, tipping, training-log)
// comes back as a clean REJECT instead of vanishing silently.
const CRICKET_MD_PATH = path.join(__dirname, "..", "..", "docs", "instrument", "CRICKET.md");
const VOICE_MD_PATH   = path.join(__dirname, "..", "tui", "voice.md");
const RULES_MD_PATH   = path.join(__dirname, "..", "tui", "rules.md");

function readOptional(p) {
  try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; }
}
let cricketDocs = readOptional(CRICKET_MD_PATH) || "(CRICKET.md not found)";
cricketDocs = cricketDocs.replace(
  /1\. \*\*Output ONLY commands\*\*[^\n]*/,
  "1. **Mix commands and conversation freely** — commands go one per line with no extra text on the same line, prose goes in normal sentences. You can do both in the same response."
);
const voiceNote = readOptional(VOICE_MD_PATH).trim();
const rulesNote = readOptional(RULES_MD_PATH).trim();

const CRICKET_SYSTEM = `You are Cricket, the control interface for Gnumbat — a generative audio collage engine that separates songs into stems (vocals, melody, bass, drums), analyzes every transient slice, and plays them back in real time using spectral descriptors.

Gnumbat stands for "Gnumbat."

Default behavior: when the user gives a musical instruction, respond with engine commands only — one per line, no explanation.
When the user asks a question or starts a conversation, answer clearly and concisely.
You can mix commands and conversation in the same response when it makes sense.
Never invent command names. Only use the exact commands listed in the knowledge base. If a user asks to do something the engine cannot do (like loading a track), say so in plain text — do not make up a command for it.
Never repeat or quote the [current state] block back in your response. It is for your internal context only.
When the user asks to see the state, or when you bring the conversation back to Gnumbat, emit: showState
When the user asks what commands are available, asks for a list of commands, or asks how to control Gnumbat, emit: showCommands
Never emit showCommands when the user asks what a specific command or parameter DOES — that is a conversational question, answer it in plain language.
When a conversation goes off-topic, follow it — don't redirect immediately. Let it go for several exchanges. Only bring it back to Gnumbat naturally if there's an opening, never by force.
Do not use terms of endearment like "mon ami", "friend", "buddy", "mate" or similar. Be warm but don't name the relationship.

When explaining what a command or concept does:
- Use a concrete analogy or metaphor to anchor the idea before going technical.
- Show how values interact with each other — don't explain a parameter in isolation if it only makes sense alongside another.
- Give a short concrete example (what you'd type and what it would do to the sound).
- Keep it tight — one analogy, one example, done. No bullet-point dumps, no restating the same thing twice.
- Write like someone who knows the system deeply and enjoys explaining it, not like a manual.
${rulesNote ? `\n--- RULES (follow these exactly) ---\n${rulesNote}\n` : ""}${voiceNote ? `\n--- VOICE (mirror this writing style in conversation) ---\n${voiceNote}\n` : ""}
--- Gnumbat KNOWLEDGE BASE ---
${cricketDocs}`;

// Cricket's own vocabulary — every command name she is allowed to emit,
// copied verbatim from src/tui/app.js's COMMANDS Set (not this hub's own
// OSC whitelist above, which is narrower — see the note above on why a
// recognized-but-unroutable command is expected, not a bug). Kept as one
// literal list rather than derived from COMMANDS, because Cricket's
// vocabulary is bigger than what has a live receiver right now, on purpose.
const COMMANDS_ALL = new Set([
  "start", "stop", "applyNow", "next", "selectSegment", "loop", "unloop", "unloopAll",
  "lockSource", "unlockSource", "buildIndex", "loadIndex", "saveIndex", "reloadDownbeats",
  "analyzeAll", "tagBeats", "info", "reset", "setSegmentBars", "setStayProb", "setSrcWeights",
  "setQuantize", "setMaxSlices", "setWindow", "chunkMode", "skip", "returnToBase",
  "setFallbackBPM", "setGlobalBPM", "setWeight", "setMatchProb", "setDirPref", "setDirWeight",
  "setTrackWeight", "followStem", "wmdScope", "setEntropy", "setGenreFilter", "clearGenreFilter",
  "setKeyFilter", "clearKeyFilter", "listGenres", "setStemSource", "dumpDescriptors",
  "selectRange", "nextNearest", "fader", "mute", "solo", "trim", "master", "eqLow", "eqMid",
  "eqMidFreq", "eqMidQ", "eqHigh", "width", "joystick", "masterJoystick", "pan", "analysisMode",
  "monoSend", "fx", "fxSwitch", "boothGain", "recGain", "record", "pitchShift", "formantShift",
  "setShiftBand", "setPitchBand", "setFormantBand", "clearPitchBand", "clearFormantBand",
  "clearShiftBand", "triggerMode", "trigger", "tipOpen", "tipClose", "sessionOpen",
  "sessionClose", "scoreLyr", "scoreTrs", "tag", "listSections", "trainBias", "reloadBias",
  "setLearnedWeight", "setAgentMode", "setFitShape", "showBakeGraph", "listGraphs", "graphs",
  /* "fakeBakes" REMOVED (2026-08-20) — user: "remove the fake bakes too."
     This command's own doc line ("synthetic bake data, for demoing
     graphs") wrote fabricated bake rows into real data; dropping it from
     the vocabulary blocks that entry point at the dispatch gate
     (isCricketCommand()) below. "removeFakeBakes" stays available so any
     synthetic:true rows an earlier :fakeBakes call already wrote can
     still be purged. */
  "removeFakeBakes", "graphNext", "graphPrev", "setGenre", "showState",
  "showCommands", "chat", "language", "nextTrack", "prevTrack", "setMMT", "resetPeaks",
]);
function isCricketCommand(line) {
  return COMMANDS_ALL.has(line.trim().split(/\s+/)[0]);
}

// Same split app.js's processReply() did: a line is a command if its first
// word is in COMMANDS_ALL; a line can carry more than one command run
// together (the lookahead split on command-name boundaries), anything left
// over is prose. Returns {prose, commands} instead of calling back per
// command — see the file-header note on why that decision moved to the
// browser.
function splitCricketReply(reply) {
  const cleaned = reply.replace(/\[current state\][\s\S]*?(?=\n\n|\n[^\s]|$)/i, "").trim();
  const cmdPattern = new RegExp("(?=\\b(" + [...COMMANDS_ALL].join("|") + ")\\b)", "g");
  const lines = cleaned.split("\n").flatMap((line) => {
    if (isCricketCommand(line) && line.trim().split(cmdPattern).filter(Boolean).length > 1) {
      return line.trim().split(cmdPattern).filter(Boolean).map((s) => s.trim());
    }
    return [line];
  });
  const prose = [];
  const commands = [];
  lines.forEach((line) => {
    if (isCricketCommand(line)) commands.push(line.trim());
    else prose.push(line);
  });
  return { prose: prose.join("\n").trim(), commands };
}

// One shared conversation — Cricket was always a single running
// conversation in the TUI (one process, one chatHistory), and that
// assumption carries over rather than forking a history per browser tab.
// Two panels open at once talk to the same Cricket and see the same
// replies (both get the broadcast below), which matches "one instrument,
// one operator" better than silently forking her memory per tab.
const chatHistory = [{ role: "system", content: CRICKET_SYSTEM }];
const CHAT_HISTORY_CAP = 41; // 1 system + 20 user/assistant pairs, same cap as app.js
let cricketThinking = false;

function callCricket(text) {
  return new Promise((resolve, reject) => {
    chatHistory.push({ role: "user", content: text });
    // Safety-net trim only — app.js also ran a summarize-instead-of-discard
    // pass (maybeSummarizeMemory) before this hard cap. Not ported: it needs
    // its own Ollama round trip and this hub has no per-session persistence
    // to make that worthwhile yet. Old turns are dropped outright here
    // instead of condensed, which is the one real behavior gap versus the
    // TUI — worth revisiting if long conversations start losing context
    // that matters.
    if (chatHistory.length > CHAT_HISTORY_CAP) {
      chatHistory.splice(1, chatHistory.length - CHAT_HISTORY_CAP);
    }

    const body = JSON.stringify({ model: ollamaModel, messages: chatHistory, stream: false });
    const req = http.request({
      hostname: ollamaHost,
      port: ollamaPort,
      path: "/api/chat",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const reply = json.message && json.message.content;
          if (!reply) { reject(new Error("no response — check --ollama-model (" + ollamaModel + ")")); return; }
          chatHistory.push({ role: "assistant", content: reply });
          resolve(reply);
        } catch (e) {
          reject(new Error("parse error: " + e.message));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("ollama timed out — model may be overloaded")); });
    req.on("error", () => { reject(new Error("ollama unreachable — is it running? (" + ollamaHost + ":" + ollamaPort + ")")); });
    req.write(body);
    req.end();
  });
}

function handleChat(text, replyTo) {
  if (cricketThinking) {
    replyTo({ t: "chatError", msg: "still thinking about the last one — one at a time" });
    return;
  }
  cricketThinking = true;
  broadcast({ t: "chatThinking" });
  callCricket(text)
    .then((reply) => {
      cricketThinking = false;
      broadcast(Object.assign({ t: "chatReply" }, splitCricketReply(reply)));
    })
    .catch((e) => {
      cricketThinking = false;
      broadcast({ t: "chatError", msg: e.message });
    });
}

// ── CRICKET (ambient + private DM) ────────────────────────────────────────
// handleChat()/callCricket()/chatHistory above are untouched -- they still
// serve the OGTM instrument console exactly as before (bare {t:"chat"},
// synchronous Ollama call, reply broadcast to every connected panel, one
// shared chatHistory -- "one instrument, one operator", per that block's
// own comment). Everything below is new and serves a different surface:
// OMSC's public social room. Three browser-originated shapes now share
// the WebSocket dispatch's "chat" branch (see the dispatch itself, further
// down this file) --
//   {t:"chat", text}                                -- OGTM console (unchanged)
//   {t:"chat", text, room:"public", who}             -- OMSC public room message,
//                                                        observe-only: stored for
//                                                        the periodic ambient check
//                                                        below, never itself
//                                                        triggers Ollama
//   {t:"chat", text, private:true, target:"cricket"} -- OMSC ":msg cricket ..." /
//                                                        an open Cricket DM,
//                                                        synchronous like the
//                                                        console, but replied to
//                                                        ONLY the sending socket
// This is the fix for "every public message invokes Ollama": a plain OMSC
// room message no longer reaches callCricket() at all. Cricket only speaks
// in the public room when checkCricketAmbient() below, on its own timer,
// decides she has something to say.

// AMBIENT_RECENT -- a short rolling window of recent OMSC public-room lines
// (NOT chatHistory -- see the note on spec item 5 in the task this was
// built against: ambient observation must not pollute the real, private
// Cricket conversation chatHistory/callCricket() already maintain). Capped
// hard rather than grown -- dumping the whole room history into every
// ambient prompt would balloon both the request and what Cricket is
// implicitly asked to react to.
const AMBIENT_CONTEXT_MAX = 12;
let ambientRecent = []; // [{who, text}]
let ambientActivitySinceCheck = false;
let cricketAmbientTimer = null; // set in start() -- see its own comment there

function observePublicChat(who, text) {
  ambientRecent.push({ who: who || "anon", text });
  if (ambientRecent.length > AMBIENT_CONTEXT_MAX) ambientRecent.shift();
  ambientActivitySinceCheck = true;
}

// handleCricketDM -- same shape as handleChat() above (same cricketThinking
// gate, same callCricket()/chatHistory -- a Cricket DM is still "the user
// explicitly talking to Cricket", so it uses the real conversation engine
// normally, per spec item 5), but replies ONLY to the requesting socket
// instead of broadcast(). private:true on every reply frame is what tells
// the browser side (see gnumbat-live.js's chatThinking/chatReply/chatError
// listeners, and panel.html's new private-flagged ones) that this is a DM
// reply and not the OGTM console's.
function handleCricketDM(text, replyTo) {
  if (cricketThinking) {
    replyTo({ t: "chatError", private: true, msg: "still thinking about the last one — one at a time" });
    return;
  }
  cricketThinking = true;
  replyTo({ t: "chatThinking", private: true });
  callCricket(text)
    .then((reply) => {
      cricketThinking = false;
      replyTo(Object.assign({ t: "chatReply", private: true }, splitCricketReply(reply)));
    })
    .catch((e) => {
      cricketThinking = false;
      replyTo({ t: "chatError", private: true, msg: e.message });
    });
}

// AMBIENT_SYSTEM -- additive to CRICKET_SYSTEM (not a replacement for it --
// CRICKET_SYSTEM itself stays exactly as declared above), same persona/
// voice/rules/knowledge base, plus instructions specific to unprompted
// observation of a room instead of answering a direct message. Spec item 6
// asked specifically for an occasional-fun-fact-about-computer-viruses-plus-
// a-friendly-cybersecurity-reminder flavor of contribution (fitting, for a
// project called "Gnumbat") -- named here as one thing Cricket
// might reach for, not the only thing, and NO_REPLY stays the overwhelming
// default so she doesn't talk over an active human conversation.
const AMBIENT_SYSTEM = `${CRICKET_SYSTEM}

--- AMBIENT MODE ---
You are passively observing the Gnumbat public chat room -- a room of people talking to each other, not to you. You'll be shown a short window of the most recent public messages.
Most check-ins should end with you saying nothing at all. If you don't have anything genuinely pertinent to add right now, respond with EXACTLY:
NO_REPLY
and nothing else -- no punctuation, no quotes, no extra words on that line or any other.
Only break silence when something in the recent messages genuinely calls for a reply, or -- occasionally, not every time -- to share a short, true, fun fact about computer viruses or malware history, paired with a friendly, non-preachy cybersecurity reminder. Don't force this every check-in; silence (NO_REPLY) should still be the common outcome.
When you do speak, write ONE short public chat message in your normal voice, as yourself -- no name prefix, the room already shows who's speaking. Never repeat a fact or line you or someone else already said recently in the window you were shown.
Keep personal or sensitive information off Gnumbat -- don't post anything you wouldn't want made public, and don't invent or repeat anyone's private details.
This is a social room, not the instrument console -- never emit engine commands here, even if a command name would otherwise apply.`;

// callCricketAmbient -- deliberately NOT callCricket(): callCricket() reads
// and appends to the module-level chatHistory, which is exactly the
// pollution spec item 5 warns against for ambient/public observation. This
// is a plain one-off Ollama call with its own throwaway messages array,
// nothing persisted after the response comes back. Small, intentional
// duplication of callCricket()'s HTTP-call plumbing rather than reshaping
// callCricket() itself to take an optional history -- the task this was
// built against was explicit: do not rewrite callCricket().
function callCricketAmbient(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: ollamaModel, messages, stream: false });
    const req = http.request({
      hostname: ollamaHost,
      port: ollamaPort,
      path: "/api/chat",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const reply = json.message && json.message.content;
          if (!reply) { reject(new Error("no response — check --ollama-model (" + ollamaModel + ")")); return; }
          resolve(reply);
        } catch (e) {
          reject(new Error("parse error: " + e.message));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("ollama timed out — model may be overloaded")); });
    req.on("error", () => { reject(new Error("ollama unreachable — is it running? (" + ollamaHost + ":" + ollamaPort + ")")); });
    req.write(body);
    req.end();
  });
}

// checkCricketAmbient -- the periodic mechanism itself (spec: "separate
// from the normal public-message path", "if there's already a suitable
// timer/heartbeat, reuse it, otherwise implement a simple periodic check" --
// nothing pre-existing in this hub fires on a plain interval independent of
// OSC/telemetry traffic, so this is a new, simple setInterval, started from
// start() below). Skips out quietly (no broadcast, no error to anyone) when:
// there's an Ollama call already in flight (shares cricketThinking with
// handleChat()/handleCricketDM() -- this is still one local model, one
// request at a time), or nothing new has been said in the room since the
// last check (an empty/idle room shouldn't get commented into).
const AMBIENT_CHECK_INTERVAL_MS = 90000;
function checkCricketAmbient() {
  if (cricketThinking) return;
  if (!ambientActivitySinceCheck || ambientRecent.length === 0) return;
  ambientActivitySinceCheck = false;

  const transcript = ambientRecent.map((m) => m.who + ": " + m.text).join("\n");
  const messages = [
    { role: "system", content: AMBIENT_SYSTEM },
    { role: "user", content: "Recent public chat in the room:\n" + transcript },
  ];
  cricketThinking = true;
  callCricketAmbient(messages)
    .then((reply) => {
      cricketThinking = false;
      const text = (reply || "").trim();
      // Suppressed completely -- spec: "the hub must suppress NO_REPLY
      // completely -- it must NOT appear in public chat." No frame sent
      // at all, same as "nothing pertinent" being genuinely silent.
      if (!text || text === "NO_REPLY") return;
      broadcast({ t: "cricketAmbient", text });
    })
    .catch((e) => {
      cricketThinking = false;
      post("ambient cricket check failed: " + e.message);
    });
}

// CHIRP -- user: "make the cricketbot chirp at a certain interval of time,
// maybe once every 15mins?" Every panel gets a plain "Chirp!" from
// cricketbot every GNUMBAT_CHIRP_MINUTES (default 15; 0 turns it off). A
// fixed line, no model call. Sent the same way as her ambient remarks.
const CHIRP_MINUTES = process.env.GNUMBAT_CHIRP_MINUTES !== undefined ? Number(process.env.GNUMBAT_CHIRP_MINUTES) : 15;
if (CHIRP_MINUTES > 0) {
  setInterval(() => { broadcast({ t: "cricketAmbient", text: "Chirp!" }); }, CHIRP_MINUTES * 60 * 1000).unref();
}

// ── LIBRARY: real tracks for the panel's library list ────────────────────
// Session-dir resolution copied verbatim from analyze_reader_bridge.js
// (search that file for this same comment) rather than re-derived, so the
// two bridges can never disagree about which session is "current."
function getSessionId() {
  try {
    const id = fs.readFileSync(path.join(dataDir, "current_session.txt"), "utf8").trim();
    return id || "default";
  } catch (e) {
    return "default";
  }
}
function getSessionDir() {
  return path.join(dataDir, "sessions", getSessionId());
}

// Same suffix list as import_library.py's STEM_SUFFIXES — analysis_library.json
// keys are filenames like "MyTrack_vocals.wav", and the LAST matching suffix
// (not the first underscore) is the separator, since real track names in
// this library contain underscores of their own.
const STEM_SUFFIXES = [
  "_vocals.wav", "_melody.wav", "_bass.wav", "_drums.wav", "_other.wav",
  "_vocals", "_melody", "_bass", "_drums", "_other",
];
function stripStemSuffix(name) {
  for (const s of STEM_SUFFIXES) {
    if (name.endsWith(s)) return name.slice(0, -s.length);
  }
  return name;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

// Groups analysis_library.json's per-file entries back into one row per
// track — TWO passes, same shape as import_library.py's import_library():
// pass 1 collects every stem belonging to a base track name into one
// object (groups.get(base) == {vocals, melody, bass, drums}), pass 2 walks
// THAT in a fixed vocals->melody->bass->drums order to pick BPM/key from
// the first stem that has them. Doing it in one pass over Object.keys(lib)
// instead would make the "first stem wins" precedence depend on whatever
// order the JSON happened to list files in (usually vocals/drums/bass/other
// per watch_demucs.py's write order) rather than the intended priority —
// wrong whenever a track's vocals stem has no BPM confidence but its drums
// stem does, which is common. Shaped as {f,g,b,k} to match panel.html's LIB
// rows exactly, so the panel only swaps the array.
function buildLibrary() {
  const sessionDir = getSessionDir();
  const lib = readJsonSafe(path.join(sessionDir, "analysis_library.json")) || {};
  const genresDb = readJsonSafe(path.join(sessionDir, "genres.json")) || {};

  const groups = new Map(); // base name -> { vocals?, melody?, bass?, drums? }
  for (const fileKey of Object.keys(lib)) {
    const base = stripStemSuffix(fileKey);
    if (!groups.has(base)) groups.set(base, {});
    const fileData = lib[fileKey] || {};
    for (const stemName of ["vocals", "melody", "bass", "drums"]) {
      if (fileData[stemName]) groups.get(base)[stemName] = fileData[stemName];
    }
  }

  const tracks = [];
  for (const [base, stems] of groups) {
    let bpm = 0, key = "unknown";
    for (const stemName of ["vocals", "melody", "bass", "drums"]) {
      const meta = stems[stemName] && stems[stemName].metadata;
      if (!meta) continue;
      const b = Number(meta.BPM || 0);
      if (b > 0) { bpm = b; key = String(meta.key || "unknown"); break; }
    }
    const g = genresDb[base];
    const top = g && Array.isArray(g.genres) && g.genres[0];
    const genre = top ? (typeof top === "string" ? top : top.genre) || "unknown" : "unknown";
    tracks.push({ f: base, g: genre, b: bpm > 0 ? bpm.toFixed(1) : "0.0", k: key });
  }
  return tracks.sort((a, b) => a.f.localeCompare(b.f));
}

// buildNowPlaying — FIXED 2026-08-19 (the whole per-stem info block was a
// literal hardcoded mockup — user, with a screenshot showing real slice
// counts from buildIndex next to a "Bb minor"/"Experimental"/"4/4 120bpm"
// readout that never changes: "the infos of the gui panel arent connected.
// they are still placeholders"). Confirmed against panel.html's own source:
// `const TRACK = 'ESRGDtb923043@$#%_$sdndn-001'` and
// `${s.live ? 'Bb minor' : '--'}` / `${s.live ? 'Experimental' : '--'}` /
// `${s.live ? '4/4 120bpm' : '--'}` are literal template strings with no
// data binding at all -- `live`/`slices`/`seed` all come from a hardcoded
// `const STEMS = [...]` array, never touched again after the one-time
// `document.getElementById('bands').innerHTML = STEMS.map(...)` at load.
//
// Unlike buildLibrary() above (one row per track, for the browsable
// library list), this is shaped for that per-stem band panel: each of
// vocals/melody/bass/drums can in principle be sourced from a DIFFERENT
// track (see lcksrc: in the panel -- a stem can be locked to another
// track's material), so key/slice-count/genre/beats are all read
// independently per stem slot, keyed off whichever source track
// stream.txt says is actually loaded there right now -- the same file
// streamWatcher_bridge.js watches to know what to load into Pd at all
// (see run.sh's own comment on why streamWatcher launches last).
// readStreamSlots — parses stream.txt (streamWatcher_bridge.js's own
// "<stemType> <filePath>" per-line format, one line per currently-loaded
// stem) into { stemType: { track, filePath } }. Pulled out of
// buildNowPlaying() below (2026-08-20) so buildWaveform() can reuse the
// EXACT same track-name derivation instead of re-deriving it separately
// and risking a name that disagrees on some edge case — AND so it can get
// at the raw `filePath` buildNowPlaying() used to throw away (it only ever
// needed the derived track name, not the file the stem is actually loaded
// from) — see buildWaveform()'s own comment for why that path is now the
// point of this helper existing at all.
function readStreamSlots(sessionDir) {
  let streamLines = [];
  try {
    streamLines = fs.readFileSync(path.join(sessionDir, "stream.txt"), "utf8").split("\n");
  } catch (e) {
    // no stream.txt yet -- nothing loaded, every slot stays empty below
  }
  // track = source track base name, derived from the loaded file's own
  // basename exactly the way analyze_reader_bridge.js's trackNameFromPath()
  // does (strip extension, then everything after the LAST underscore) --
  // that function is what actually produced the track_name library entries
  // this data is keyed by, so deriving it any other way here risks a name
  // that doesn't match.
  const slot = {};
  for (const line of streamLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.indexOf(" ");
    if (sp === -1) continue;
    const stemType = trimmed.slice(0, sp).trim();
    const filePath = trimmed.slice(sp + 1).trim();
    const base = path.basename(filePath).replace(/\.[^.]*$/, "");
    const cut = base.lastIndexOf("_");
    slot[stemType] = { track: cut > 0 ? base.slice(0, cut) : base, filePath: filePath };
  }
  return slot;
}

// ── RENDER: arrangement mixdown -> real reanalysis ──────────────────────
// NEW 2026-09-09. Design (from the session that added this): the
// arrangement editor lets clips overlap within one stem family (e.g. a
// bunch of layered drum takes) -- unlike live playback, which only ever
// has ONE thing sounding per stem at a time. Spectral descriptors
// (centroid, MFCCs, ...) are not linear in the samples, so the only way
// to get TRUE descriptors for an overlapping region is to actually render
// the mix and re-measure it -- not average/pick-a-winner between the
// clips' existing descriptor rows. See POST /api/render below for the
// full request flow (mixdown -> temp WAV -> real FluCoMa reanalysis via
// analyze_reader_bridge.js's new renderAnalyze -> training_log_vertical,
// via the EXISTING :scoreLyr path -- nothing new written there).

// writeWavFloat -- minimal RIFF/WAVE writer, IEEE float32 PCM (audioFormat
// 3), the write-side mirror of readWavPcm/sampleReader above (which
// already read this exact format back). Only ever used for a render
// mixdown, which is deleted the moment analysis finishes (see
// POST /api/render's cleanup) -- no need for 16-bit quantization/
// dithering, so this just writes the float mixdown buffer straight out.
function writeWavFloat(filePath, sampleRate, numChannels, channelData) {
  const frameCount = channelData[0] ? channelData[0].length : 0;
  const bytesPerSample = 4;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // 3 = IEEE float
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bytesPerSample * 8, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let f = 0; f < frameCount; f++) {
    for (let ch = 0; ch < numChannels; ch++) {
      buf.writeFloatLE(channelData[ch][f] || 0, off);
      off += 4;
    }
  }
  fs.writeFileSync(filePath, buf);
}

// renderStemMixdown -- collapse every included lane sharing one stemType
// into a single real audio buffer. Reads the ORIGINAL source stem file
// (same file readStreamSlots()/buildWaveform() resolve per stemType),
// resamples each clip by its own `rate` (plain linear interpolation --
// good enough for analysis, not a mastering-grade resampler), applies the
// clip's + lane's volume, and SUMS overlapping clips sample-for-sample.
//
// Mixdown rule (explicit user decision, 2026-09-09): sum with headroom,
// then normalize -- i.e. only ever scale DOWN, and only if the sum
// actually exceeds full scale, so relative loudness between overlapping
// layers is preserved and clipping never pollutes the descriptors, but a
// mixdown that never got close to full scale is left at its natural
// level (no upward boost).
//
// Mute/solo: if ANY lane in lanesForStem is soloed, only soloed lanes are
// included; otherwise every non-muted lane is included -- matches what
// would actually be audible on real playback of this stem family.
//
// Returns null (caller skips this stem entirely) if there is nothing to
// render -- an all-silent/empty stem should never be shipped into the
// real analysis pipeline.
function renderStemMixdown(stemType, lanesForStem, sourceFilePath) {
  let wav;
  try {
    wav = readWavPcm(sourceFilePath);
  } catch (e) {
    throw new Error("renderStemMixdown(" + stemType + "): cannot read source " + sourceFilePath + " -- " + e.message);
  }
  const src = sampleReader(wav);
  const sampleRate = src.sampleRate;
  const numChannels = src.numChannels;

  const anySoloed = lanesForStem.some((l) => l.soloed);
  const included = lanesForStem.filter((l) => (anySoloed ? l.soloed : !l.muted));

  let outFrames = 0;
  for (const lane of included) {
    for (const clip of (lane.clips || [])) {
      if (clip.muted) continue;
      const rate = clip.rate || 1;
      const durMs = (clip.srcEnd - clip.srcStart) / rate;
      const endFrame = Math.round((clip.arrStart + durMs) / 1000 * sampleRate);
      if (endFrame > outFrames) outFrames = endFrame;
    }
  }
  if (outFrames <= 0) return null;

  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(new Float32Array(outFrames));

  for (const lane of included) {
    const laneVolume = (typeof lane.volume === "number") ? lane.volume : 1;
    for (const clip of (lane.clips || [])) {
      if (clip.muted) continue;
      const rate = clip.rate || 1;
      const clipVolume = (typeof clip.volume === "number") ? clip.volume : 1;
      const gain = laneVolume * clipVolume;
      const srcStartFrame = clip.srcStart / 1000 * sampleRate;
      const outStartFrame = Math.round(clip.arrStart / 1000 * sampleRate);
      const clipOutFrames = Math.round(((clip.srcEnd - clip.srcStart) / rate) / 1000 * sampleRate);
      for (let i = 0; i < clipOutFrames; i++) {
        const srcPos = srcStartFrame + i * rate;
        const f0 = Math.floor(srcPos), frac = srcPos - f0;
        const outFrame = outStartFrame + i;
        if (outFrame < 0 || outFrame >= outFrames) continue;
        for (let ch = 0; ch < numChannels; ch++) {
          const s0 = src.at(f0, ch), s1 = src.at(f0 + 1, ch);
          channelData[ch][outFrame] += (s0 + (s1 - s0) * frac) * gain;
        }
      }
    }
  }

  let peak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = channelData[ch];
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 1) {
    const scale = 1 / peak;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = channelData[ch];
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }
  }

  return { sampleRate, numChannels, channelData };
}

// buildVerticalSamples -- merge 4 freshly-reanalyzed stems' slice arrays
// (each already sorted by time ascending, same shape buildSlices()
// returns) into the exact `samples` shape performScoreLyr() already
// writes to training_log_vertical.jsonl from LIVE bakeFrames: one
// {vocals:{...},melody:{...},bass:{...},drums:{...}} snapshot per
// distinct onset time across all 4 stems, each stem's snapshot holding
// whichever slice was most recently active at that time (nearest
// preceding onset -- same convention export_frame_descriptors.py's own
// slice-assignment note describes).
//
// T (tension) and D (density) are NOT present in analysis_library.json's
// raw FluCoMa slice rows as of this writing (only C/S/P/E/F/H/M0-5 are --
// confirmed by reading a real stored entry) -- they currently only exist
// on the LIVE telemetry stream, and reading the current uncommitted
// analyze_reader_stem.pd/analyze_reader_bridge.js changes suggests that
// may be actively in flux. Defaulted to 0 here (same default
// emptyStemState() already uses) rather than guessed at -- revisit once
// the tension work lands and it's clear whether T/D get persisted per
// slice or stay live-only.
function buildVerticalSamples(stemSlices) {
  const FIELDS = ["C", "S", "E", "F", "P", "H", "T", "D"];
  const allTimes = new Set();
  for (const s of STEM_KEYS) (stemSlices[s] || []).forEach((row) => allTimes.add(row.time));
  const times = Array.from(allTimes).sort((a, b) => a - b);
  const idx = {};
  STEM_KEYS.forEach((s) => { idx[s] = 0; });
  const samples = [];
  for (const t of times) {
    const snap = {};
    for (const s of STEM_KEYS) {
      const rows = stemSlices[s] || [];
      while (idx[s] + 1 < rows.length && rows[idx[s] + 1].time <= t) idx[s]++;
      const row = rows[idx[s]];
      const out = {};
      for (const f of FIELDS) out[f] = (row && typeof row[f] === "number") ? row[f] : 0;
      snap[s] = out;
    }
    samples.push(snap);
  }
  return samples;
}

function buildNowPlaying() {
  const sessionDir = getSessionDir();
  const streamSlots = readStreamSlots(sessionDir);
  const slot = {};
  for (const stemType of Object.keys(streamSlots)) slot[stemType] = streamSlots[stemType].track;
  // fileName -- the arrangement view's clip header (panel.html, "add the
  // file name.(format)") wants the REAL loaded filename with its
  // extension. `track` above is deliberately not that: it's
  // readStreamSlots()'s extension-stripped, underscore-truncated library
  // key (see that function's own comment), used to look analysis data up
  // by. filePath is the one thing on the slot that still has the genuine
  // basename+extension, so pull it separately here rather than guessing
  // or reusing `track` as a filename it was never meant to be.
  const fileNames = {};
  for (const stemType of Object.keys(streamSlots)) {
    const fp = streamSlots[stemType].filePath;
    fileNames[stemType] = fp ? path.basename(fp) : null;
  }

  const lib = readJsonSafe(path.join(sessionDir, "analysis_library.json")) || {};
  const genresDb = readJsonSafe(path.join(sessionDir, "genres.json")) || {};
  const downbeatsDb = readJsonSafe(path.join(sessionDir, "downbeats.json")) || {};

  const stems = {};
  for (const stemType of ["vocals", "melody", "bass", "drums"]) {
    const track = slot[stemType] || null;
    const trackData = track ? lib[track] : null;
    const stemData = trackData && trackData[stemType];
    const meta = stemData && stemData.metadata;
    let slices = 0;
    if (stemData && stemData.slices && typeof stemData.slices === "object") {
      slices = Object.keys(stemData.slices).length;
    }

    let genreName = null, genrePct = null;
    const g = track && genresDb[track];
    const top = g && Array.isArray(g.genres) && g.genres[0];
    if (top) {
      const raw = (typeof top === "string" ? top : top.genre) || "";
      // essentia genre labels are "Category---Subgenre" -- the panel only
      // ever showed the subgenre half ("Experimental", not
      // "Electronic---Experimental"), so match that here.
      genreName = raw.indexOf("---") !== -1 ? raw.slice(raw.indexOf("---") + 3) : raw || null;
      genrePct = typeof top === "object" ? Math.round(Number(top.confidence || 0) * 100) : null;
    }

    const db = track && downbeatsDb[track];
    stems[stemType] = {
      track: track,
      fileName: fileNames[stemType] || null,
      key: meta && meta.key ? String(meta.key) : null,
      slices: slices,
      genre: genreName,
      genrePct: genrePct,
      meter: db && db.meter ? Number(db.meter) : null,
      bpm: db && db.bpm ? Number(db.bpm) : null,
      beatsPct: db && typeof db.confidence === "number" ? Math.round(db.confidence * 100) : null,
    };
  }
  return { stems: stems };
}

// ── WAVEFORM (2026-08-20) ───────────────────────────────────────────────────
// user: "the waveforms are not possible since there is very few information
// in vocals and bass files" — confirmed against panel.html's own source: the
// per-stem waveform SVG (drawWave(), called with `s.seed`) was NEVER real
// audio. `signal(seed, n)` synthesizes noise from a hardcoded per-row seed
// (97/710/1323/1936, literal constants in the mockup's `const STEMS = [...]`
// array — same file, same array, as the "infos of the gui panel arent
// connected" placeholders buildNowPlaying() above already fixed on
// 2026-08-19). live:false on vocals/bass in that same array is ALSO just a
// hardcoded mock flag, not a measurement — which is exactly why vocals/bass
// looked emptier than melody/drums: nothing about the shape or the on/off
// state was ever connected to how much real content those stems actually
// have. This section decodes the REAL stem WAV file stream.txt says is
// loaded and reduces it to the same {min,max,rms} per column the fake
// signal() path already produced, so drawWave() can draw the true shape —
// see panel.html's own updated drawWave() comment for the client half.

// readWavPcm — minimal RIFF/WAVE parser, just enough to get PCM samples out
// (no metadata chunks, no compression beyond linear PCM / IEEE float). Every
// demucs/FluCoMa stem in this project is one of those two, but this still
// throws rather than guesses on anything else, since a silently-wrong
// waveform is worse than a stem showing no waveform at all.
function readWavPcm(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let fmt = null, dataOffset = -1, dataLength = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", off, off + 4);
    const chunkSize = buf.readUInt32LE(off + 4);
    const bodyStart = off + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(bodyStart),
        numChannels: buf.readUInt16LE(bodyStart + 2),
        sampleRate: buf.readUInt32LE(bodyStart + 4),
        bitsPerSample: buf.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === "data") {
      dataOffset = bodyStart;
      dataLength = Math.min(chunkSize, buf.length - bodyStart); // tolerate a truncated/streamed-while-writing file
    }
    off = bodyStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (!fmt) throw new Error("no fmt chunk");
  if (dataOffset < 0) throw new Error("no data chunk");
  if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) {
    throw new Error("unsupported audioFormat " + fmt.audioFormat + " (only PCM/IEEE-float)");
  }
  return { buf, fmt, dataOffset, dataLength };
}

// sampleReader — returns a function(frameIndex, channel) -> float in [-1,1],
// covering the bit depths demucs/soundfile actually write (16/24/32-bit
// PCM, 32-bit float). Bounds-checked so a truncated data chunk yields 0
// past its end rather than reading into whatever memory follows the buffer.
function sampleReader(wav) {
  const { buf, fmt, dataOffset, dataLength } = wav;
  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameBytes = bytesPerSample * fmt.numChannels;
  const frameCount = frameBytes > 0 ? Math.floor(dataLength / frameBytes) : 0;
  function at(frame, ch) {
    const p = dataOffset + frame * frameBytes + ch * bytesPerSample;
    if (p + bytesPerSample > dataOffset + dataLength) return 0;
    if (fmt.audioFormat === 3 && fmt.bitsPerSample === 32) return buf.readFloatLE(p);
    if (fmt.bitsPerSample === 16) return buf.readInt16LE(p) / 32768;
    if (fmt.bitsPerSample === 24) {
      let v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
      if (v & 0x800000) v -= 0x1000000; // sign-extend 24-bit
      return v / 8388608;
    }
    if (fmt.bitsPerSample === 32) return buf.readInt32LE(p) / 2147483648;
    return 0; // unsupported depth — caller sees an all-zero (flat) reduction, not a crash
  }
  return { at, frameCount, numChannels: fmt.numChannels, sampleRate: fmt.sampleRate };
}

// buildWaveform — real per-column min/max/rms for one stem's currently-loaded
// file, the same reduction shape panel.html's old signal()-based drawWave()
// already expected (see that function's own updated comment): mix to mono,
// walk `cols` equal-width windows across the whole file, track true min/max
// (not mirrored — a real waveform's halves differ) and RMS per window.
function buildWaveform(stemType, cols) {
  const sessionDir = getSessionDir();
  const slots = readStreamSlots(sessionDir);
  const entry = slots[stemType];
  if (!entry || !entry.filePath) return { ok: false, reason: "not loaded" };

  let wav;
  try {
    wav = readWavPcm(entry.filePath);
  } catch (e) {
    return { ok: false, reason: "read failed: " + e.message };
  }
  const { at, frameCount, numChannels, sampleRate } = sampleReader(wav);
  if (frameCount <= 0) return { ok: false, reason: "empty file" };

  cols = Math.max(1, Math.min(4096, cols | 0 || 900));
  const per = frameCount / cols;
  const min = new Array(cols), max = new Array(cols), rms = new Array(cols);
  const invCh = 1 / numChannels;
  for (let c = 0; c < cols; c++) {
    const start = Math.floor(c * per), end = Math.max(start + 1, Math.floor((c + 1) * per));
    let mn = 1, mx = -1, sq = 0, n = 0;
    for (let f = start; f < end && f < frameCount; f++) {
      let v = 0;
      for (let ch = 0; ch < numChannels; ch++) v += at(f, ch);
      v *= invCh; // mono mixdown
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sq += v * v;
      n++;
    }
    if (n === 0) { mn = 0; mx = 0; }
    min[c] = Number(mn.toFixed(4));
    max[c] = Number(mx.toFixed(4));
    rms[c] = Number((n ? Math.sqrt(sq / n) : 0).toFixed(4));
  }
  return {
    ok: true,
    track: entry.track,
    cols: cols,
    durationSec: frameCount / sampleRate,
    min: min, max: max, rms: rms,
  };
}


// buildSlices — real per-slice onset times (ms), for whichever track is
// currently loaded in a given stem slot, straight out of
// analysis_library.json's own FluCoMa slice data. Reuses readStreamSlots()
// (for "which track is actually loaded here right now") and
// stripStemSuffix() (for matching analysis_library.json's own keying,
// whether that's per-file like "MyTrack_vocals.wav" or already grouped by
// track — see stripStemSuffix()'s own comment) the exact same way
// buildWaveform()/buildLibrary() already do, rather than re-deriving either
// piece of logic a third time. Feeds the arrangement view's click-to-slice
// (panel.html's sliceRegionAt()) so a manual cut can snap to a real
// detected onset instead of only ever landing on an arbitrary pixel.
function buildSlices(stemType) {
  const sessionDir = getSessionDir();
  const streamSlots = readStreamSlots(sessionDir);
  const wanted = streamSlots[stemType] && streamSlots[stemType].track;
  if (!wanted) return { ok: true, track: null, onsetsMs: [], descriptors: [] };
  const lib = readJsonSafe(path.join(sessionDir, "analysis_library.json")) || {};
  let stemData = null;
  for (const fileKey of Object.keys(lib)) {
    if (stripStemSuffix(fileKey) !== wanted) continue;
    const fileData = lib[fileKey] || {};
    if (fileData[stemType]) { stemData = fileData[stemType]; break; }
  }
  if (!stemData || !stemData.slices) return { ok: true, track: wanted, onsetsMs: [], descriptors: [] };
  const slices = stemData.slices;
  const times = Object.keys(slices)
    .map((key) => slices[key] && slices[key].time)
    .filter((t) => typeof t === "number" && isFinite(t));
  times.sort((a, b) => a - b);
  // descriptors -- the arrangement view's export feature ("export its
  // descriptors" for a bracketed loop range) needs more than just onset
  // times: the full real FluCoMa spectral descriptor set analysis_library.json
  // already recorded per slice (C/S/E/F/H/M0..M5), converted to the same
  // ms timebase onsetsMs above uses so the two line up. onsetsMs is left
  // untouched for whatever already reads it (sliceClipAt's own onset-snap).
  const descriptorKeys = ["C", "S", "P", "E", "F", "H", "M0", "M1", "M2", "M3", "M4", "M5"];
  const descriptors = Object.keys(slices)
    .map((key) => slices[key])
    .filter((s) => s && typeof s.time === "number" && isFinite(s.time))
    .map((s) => {
      const entry = { time: Math.round(s.time * 1000) };
      for (const k of descriptorKeys) if (typeof s[k] === "number" && isFinite(s[k])) entry[k] = s[k];
      return entry;
    })
    .sort((a, b) => a.time - b.time);
  return { ok: true, track: wanted, onsetsMs: times.map((t) => Math.round(t * 1000)), descriptors };
}

// ── HTTP: serve the panel ─────────────────────────────────────────────────
// Static, localhost, read-only, and confined to panelDir — the path is
// resolved and then checked to still be inside panelDir, so a request for
// ../../.env cannot escape.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/panel.html";

  // POST /progress — watch_demucs.py's pipeline-stage relay (demucs / genre
  // (essentia) / madmom stages, stemsReady, fileDetected — see that file's
  // WS_SERVER_PROGRESS_URL and post_progress()). This is a leftover piece of
  // the old ws_server.js contract this hub never picked up: watch_demucs.py
  // still POSTs here on every stage change, and until now nothing on :8080
  // answered a POST at all — the request fell into the static-file branch
  // below, 404'd (there is no file named "progress"), and watch_demucs.py's
  // own post_progress() swallows that on purpose ("except: pass  # TUI not
  // connected — silent"). So every demucs/genre/madmom progress update was
  // being generated for real and then discarded with no error on either
  // end — not fake data, just an unwired pipe. Broadcast as {t:'pipeline',
  // ...data} so gnumbat-live.js's Gnumbat.on('pipeline', ...) can render it the
  // same way every other telemetry frame already is.
  if (req.method === "POST" && rel === "/progress") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad json" }));
        return;
      }
      if (verbose) post("progress <- " + JSON.stringify(data));
      // Render completion -- analyze_reader_bridge.js's startRenderAnalysis()
      // posts stage:"render" here (done or error) when a /api/render batch
      // finishes; resolve/reject the matching pending request below. See
      // pendingRenders' own comment above and POST /api/render below.
      if (data && data.stage === "render" && data.renderId && pendingRenders.has(data.renderId)) {
        const pending = pendingRenders.get(data.renderId);
        if (data.status === "done") {
          clearTimeout(pending.timer);
          pendingRenders.delete(data.renderId);
          pending.resolve();
        } else if (data.status === "error") {
          clearTimeout(pending.timer);
          pendingRenders.delete(data.renderId);
          pending.reject(new Error(data.msg || "render analysis failed"));
        }
      }
      broadcast(Object.assign({ t: "pipeline" }, data));
      res.writeHead(204).end();
    });
    return;
  }

  // Computed fresh per request, not cached — a track finishing analysis
  // mid-session (or a session switch) should show up on the panel's next
  // fetch without restarting this process, same as every other bridge here
  // re-reads its JSON on demand rather than caching it.
  // ── /api/models: the same model list panel.html's #modelSelectView shows, over plain HTTP,
  // for the Gnumbat plugin's MODEL page (which can't hold a WebSocket open from a plugin).
  //   GET  /api/models?voter=<id>   -> {rev, models:[card + myVote]}; ETag/If-None-Match -> 304
  //   POST /api/models  {sel, args, opId}  -> runs the exact same handleModelsCommand() the
  //        panel's WebSocket uses (so every panel gets the broadcast), replies {ok, data|error}.
  //        opId makes a replay harmless: the plugin queues changes made while this hub was off
  //        and resends them when it's back; an op already applied returns its first result.
  if (rel === "/api/models" && req.method === "GET") {
    const voter = new URLSearchParams(req.url.split("?")[1] || "").get("voter") || "";
    let cards;
    try {
      cards = modelsApi.listCards().map((c) => Object.assign({}, c, { myVote: voter ? modelsVotes.voteOf(c.hash, voter) : 0 }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
      return;
    }
    const body = JSON.stringify({ models: cards });
    const etag = '"' + crypto.createHash("sha1").update(body).digest("hex") + '"';
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }).end(); return; }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", etag });
    res.end(JSON.stringify({ rev: etag.slice(1, -1), models: cards }));
    return;
  }
  if (rel === "/api/models" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let op;
      try { op = JSON.parse(body); } catch (e) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "bad json" }));
        return;
      }
      const send = (reply) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
      const applied = op.opId ? appliedModelOps.get(op.opId) : null;
      if (applied) { send(applied); return; }
      const PLUGIN_SELS = ["newSeed", "branch", "vote", "rename", "addBake", "touchEdit", "list", "card"];
      if (!PLUGIN_SELS.includes(op.sel)) { send({ ok: false, error: "selector not allowed over HTTP: " + op.sel }); return; }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; send({ ok: false, error: "timeout" }); } }, 15000);
      handleModelsCommand(op.sel, Array.isArray(op.args) ? op.args : [], (reply) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const out = { ok: !!reply.ok, data: reply.data, error: reply.error };
        if (op.opId && out.ok) rememberModelOp(op.opId, out);
        send(out);
      });
    });
    return;
  }

  if (rel === "/api/library") {
    let body;
    try {
      body = JSON.stringify(buildLibrary());
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }

  // GET /api/nowPlaying — real per-stem key/slice-count/genre/beats for
  // whatever is currently loaded per stream.txt, see buildNowPlaying()'s
  // own comment for why this exists as a separate endpoint from
  // /api/library. Same no-cache/fresh-per-request reasoning as above.
  if (rel === "/api/nowPlaying") {
    let body;
    try {
      body = JSON.stringify(buildNowPlaying());
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }

  // GET /api/waveform?stem=<vocals|melody|bass|drums>&cols=<n> — real
  // min/max/rms per column, decoded straight from whatever WAV stream.txt
  // says is loaded in that slot right now. See buildWaveform()'s own
  // comment for what this replaces (a fully synthetic waveform) and why.
  // Reads and reduces the whole file on every request rather than caching —
  // same "fresh, not fast" call every other /api/* route here already
  // makes — but unlike those this one decodes real audio, so it is the one
  // route in this file actually worth profiling if a session's tracks get
  // long enough for it to show up.
  if (rel === "/api/waveform") {
    const qs = new URLSearchParams((req.url.split("?")[1] || ""));
    const stemType = qs.get("stem") || "";
    const cols = parseInt(qs.get("cols") || "900", 10);
    if (["vocals", "melody", "bass", "drums"].indexOf(stemType) === -1) {
      res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: false, reason: "stem must be one of vocals/melody/bass/drums" }));
      return;
    }
    let body;
    try {
      body = JSON.stringify(buildWaveform(stemType, cols));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: e.message }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }

  
  // GET /api/slices?stem=<vocals|melody|bass|drums> — real per-slice onset
  // times (ms) for whichever track stream.txt says is loaded in that stem
  // slot right now, straight out of analysis_library.json's own FluCoMa
  // slice data (buildSlices() below) — added alongside /api/upload for the
  // panel's arrangement view (user: "add the slice option... click"), which
  // snaps a manual cut to the nearest real onset when one's close enough
  // rather than only ever cutting at an arbitrary pixel. Same fresh-per-
  // request, no-cache shape as every other /api/* route here.
  if (rel === "/api/slices") {
    const qs = new URLSearchParams((req.url.split("?")[1] || ""));
    const stemType = qs.get("stem") || "";
    if (["vocals", "melody", "bass", "drums"].indexOf(stemType) === -1) {
      res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: false, reason: "stem must be one of vocals/melody/bass/drums" }));
      return;
    }
    let body;
    try {
      body = JSON.stringify(buildSlices(stemType));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: e.message }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }

  // POST /api/render — arrangement editor "Render": mixdown each of the 4
  // stem families (collapsing whatever lanes/clips share that stemIndex,
  // overlaps included) to real audio, re-analyze each mixdown with the
  // SAME real FluCoMa pipeline a straight uploaded stem gets, throw the
  // mixdown audio away, and open a bake bracket from the result so the
  // EXISTING, unmodified :scoreLyr <rating> command writes it into
  // training_log_vertical.jsonl exactly like a live-performance bake does.
  // This is the "propose (stage-1 stem analysis) -> user rearranges ->
  // render (stage-2 bake analysis) -> score -> repeat" loop described when
  // this feature was designed (2026-09-09 session).
  //
  // Body: { lanes: [{stemIndex, clips:[{srcStart,srcEnd,arrStart,rate,
  // volume,muted}], muted, soloed, volume}], intent?: string }
  //
  // KNOWN CAVEATS, deliberately not papered over:
  //  - The actual OSC round trip to Pd (renderAnalyze -> loadStemOut ->
  //    stemDone) depends on the SAME bridge/transport fixes this session's
  //    working tree already has uncommitted (osc.js's IPv4->IPv6 fix,
  //    analyze_reader_bridge.js's counter/already-analyzed fixes) -- this
  //    route has not been run end to end against a live Pd instance.
  //  - A render TEMPORARILY LOADS ITS MIXDOWN INTO THE SAME LIVE
  //    PERFORMANCE BUFFERS a real stem would use (see
  //    startRenderAnalysis()'s own comment in analyze_reader_bridge.js) --
  //    using Render while stems are actively playing live will interrupt
  //    that audio for the duration of the render.
  //  - T/D (tension/density) are defaulted to 0 in the resulting samples --
  //    see buildVerticalSamples()'s own comment.
  if (req.method === "POST" && rel === "/api/render") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: "bad json" }));
        return;
      }
      const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
      const sessionDir = getSessionDir();
      const slots = readStreamSlots(sessionDir);
      const renderId = "render" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const renderDir = path.join(sessionDir, "render_tmp");
      try { fs.mkdirSync(renderDir, { recursive: true }); } catch (e) {}

      const stemPaths = {};
      let mixdownError = null;
      for (const stemType of STEM_KEYS) {
        const lanesForStem = lanes.filter((l) => STEM_KEYS[l.stemIndex] === stemType);
        const slot = slots[stemType];
        if (!lanesForStem.length || !slot || !slot.filePath) { stemPaths[stemType] = null; continue; }
        try {
          const mix = renderStemMixdown(stemType, lanesForStem, slot.filePath);
          if (!mix) { stemPaths[stemType] = null; continue; }
          const outPath = path.join(renderDir, renderId + "_" + stemType + ".wav");
          writeWavFloat(outPath, mix.sampleRate, mix.numChannels, mix.channelData);
          stemPaths[stemType] = outPath;
        } catch (e) {
          mixdownError = e.message;
          break;
        }
      }
      if (mixdownError) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: mixdownError }));
        return;
      }
      if (!stemPaths.vocals && !stemPaths.melody && !stemPaths.bass && !stemPaths.drums) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: "nothing to render -- no unmuted clips in any stem" }));
        return;
      }
      if (!oscAnalyzeReader) {
        res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: "analyzeReader OSC client not started" }));
        return;
      }

      const cleanupTempFiles = () => {
        for (const s of STEM_KEYS) {
          if (stemPaths[s]) { try { fs.unlinkSync(stemPaths[s]); } catch (e) {} }
        }
      };

      const RENDER_TIMEOUT_MS = 90000; // generous -- real Pd round-trip latency unverified, see this route's header comment
      const donePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRenders.delete(renderId);
          reject(new Error("render analysis timed out after " + RENDER_TIMEOUT_MS + "ms -- is the Pd patch open with DSP on, and are the bridges (run.sh) up?"));
        }, RENDER_TIMEOUT_MS);
        pendingRenders.set(renderId, { resolve, reject, timer });
      });

      // Order is analyze_reader_bridge.js's OWN STEP_STEMS_MAP order
      // (1=vocals,2=drums,3=bass,4=melody) -- NOT this file's STEM_KEYS
      // order (vocals,melody,bass,drums). See startRenderAnalysis()'s own
      // comment in that file.
      oscAnalyzeReader.send("renderAnalyze", encodeArgs([
        renderId,
        stemPaths.vocals || "",
        stemPaths.drums || "",
        stemPaths.bass || "",
        stemPaths.melody || "",
      ]));

      donePromise.then(() => {
        let lib;
        try {
          lib = JSON.parse(fs.readFileSync(path.join(sessionDir, "analysis_library.json"), "utf8"));
        } catch (e) {
          lib = {};
        }
        const track = lib[renderId] || {};
        const stemSlices = {};
        for (const s of STEM_KEYS) {
          stemSlices[s] = (track[s] && track[s].slices)
            ? Object.values(track[s].slices).slice().sort((a, b) => a.time - b.time)
            : [];
        }
        const samples = buildVerticalSamples(stemSlices);

        // Cleanup -- this mixdown was only ever for analysis, never meant
        // to be kept. forgetTrack goes DIRECT to slice_writer_bridge.js
        // (bypasses Pd entirely, same channel performResetAll() already
        // uses for its own resetMemory sends) so the temp entry never
        // lingers in analysis_library.json.
        if (oscSliceWriter) oscSliceWriter.send("forgetTrack", [{ type: "s", value: renderId }]);
        cleanupTempFiles();

        // Open a bake bracket from REAL re-analysis instead of live
        // telemetry -- reuses performBakeStart()'s own bracket/ID
        // convention so the existing, unmodified :scoreLyr <rating>
        // command is what actually writes training_log_vertical.jsonl.
        bakeSessionId = "bake" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        bakeIntent = payload.intent || "arrangement render";
        trainState.bakeFrames = samples;

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, renderId, bakeSessionId, sampleCount: samples.length }));
      }).catch((err) => {
        cleanupTempFiles();
        res.writeHead(504, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: err.message }));
      });
    });
    return;
  }

  // POST /api/upload?name=<original filename> — writes the request body
  // straight into this session's raw_uploads/, the same folder
  // watch_demucs.py already watches for new audio (see that file's own
  // header comment) — dropping a file here is genuinely the same as
  // copying it into raw_uploads/ by hand, just reachable from the panel's
  // new arrangement-view drop zone/upload button (user: "uploading a track
  // in the view would load the track into rawupload, triggering the
  // analysis"). No multipart parsing needed — the panel POSTs the File
  // object directly as the raw body (this project has no npm dependencies,
  // see this file's own header comment, so no multipart library either).
  if (req.method === "POST" && rel === "/api/upload") {
    const qs = new URLSearchParams((req.url.split("?")[1] || ""));
    const rawName = qs.get("name") || "upload";
    const ext = path.extname(rawName).toLowerCase();
    const UPLOAD_AUDIO_EXTS = new Set([".wav", ".mp4", ".m4a", ".mp3", ".flac", ".aif", ".aiff", ".3gp"]);
    if (!UPLOAD_AUDIO_EXTS.has(ext)) {
      res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: false, reason: "unsupported file type " + (ext || "(none)") }));
      return;
    }
    let safeName = path.basename(rawName).replace(/[^A-Za-z0-9 ._-]/g, "_");
    if (!safeName || safeName === ext) safeName = "upload" + ext;
    const sessionDir = getSessionDir();
    const uploadsDir = path.join(sessionDir, "raw_uploads");
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: e.message }));
      return;
    }
    let dest = path.join(uploadsDir, safeName);
    if (fs.existsSync(dest)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const baseNoExt = safeName.slice(0, safeName.length - ext.length);
      dest = path.join(uploadsDir, `${baseNoExt}_${stamp}${ext}`);
    }
    const MAX_UPLOAD_BYTES = 300 * 1024 * 1024; // 300MB — generous for a stem-separation source file, not unlimited
    const chunks = [];
    let total = 0, aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        aborted = true;
        res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: "file too large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        fs.writeFileSync(dest, Buffer.concat(chunks));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: e.message }));
        return;
      }
      if (verbose) post("upload -> raw_uploads/" + path.basename(dest) + " (" + total + " bytes)");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        .end(JSON.stringify({ ok: true, filename: path.basename(dest) }));
    });
    req.on("error", (e) => {
      if (aborted) return;
      aborted = true;
      try { res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, reason: e.message })); } catch (_) {}
    });
    return;
  }

const full = path.resolve(panelDir, "." + rel);
  if (!full.startsWith(panelDir + path.sep) && full !== panelDir) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found: " + rel);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(full)] || "application/octet-stream",
      "cache-control": "no-store", // the panel is edited live; never cache it
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
  );
  socket.setNoDelay(true); // control surface: latency matters more than packing
  clients.add(socket);
  /* DIAGNOSTIC — user found this: something with no relation to any file
     in this repo (searched the whole tree, no match) is opening a
     WebSocket to this same server and sending {"type":"hello","runId":
     "..."} then {"type":"command","text":"buildIndex"} — a shape
     gnumbat-link.js has never used (it always sends {t:"cmd",...}), and a
     command name pulled straight from Gnumbat's own vocabulary, so whatever
     it is knows about this project specifically. It is being counted as
     "the panel" here, which is misleading — it may not be the actual
     browser tab at all. Origin/User-Agent tell apart a real browser tab
     (Origin: http://localhost:8080, a real browser User-Agent) from a
     browser EXTENSION's background connection (Origin: chrome-extension:
     //<id> or moz-extension://<id>) from a bare script (no Origin
     header at all, Node's ws/WebSocket clients don't send one by
     default). That distinction is the fastest way to actually identify
     what's sending this, instead of guessing further. */
  post("panel connected (" + clients.size + " total) -- origin="
    + (req.headers.origin || "(none)") + " ua=" + (req.headers["user-agent"] || "(none)"));

  const reply = (obj) => {
    if (socket.writable) socket.write(wsFrame(JSON.stringify(obj)));
  };

  // Push the current model list the instant a panel connects, rather
  // than waiting for it to ask -- same "don't make the client fetch
  // what the server already knows to send" idea as every other
  // telemetry frame this hub pushes unprompted (meter/spectrum/status).
  try { reply({ t: "models", models: modelsApi.listCards() }); } catch (err) { post("initial models push failed: " + err.message); }
  reply({ t: "roomPresence", counts: roomCounts() });
  // Same idea for the branches network + edit-mode dirty flag: the panel
  // relays the branch list into the Branches-network modal, and a panel
  // that reloads mid-edit (edit_agent.js's reloadUI) needs to learn right
  // away whether there are uncommitted edits.
  try { reply(editAgent.branchesFrame()); reply(editAgent.editStateFrame()); } catch (err) { post("initial branches push failed: " + err.message); }

  attachWebSocket(socket, (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      post("bad JSON from panel: " + e.message);
      return;
    }
    if (msg.t === "cmd") handleCommand(msg, reply);
    else if (msg.t === "chat" && typeof msg.text === "string" && msg.text.trim()) {
      // Three shapes share this branch now -- see the CRICKET (ambient +
      // private DM) section's own header comment, above, for the full
      // rundown of why each looks the way it does.
      const chatText = msg.text.trim();
      if (msg.private === true && msg.target === "cricket") handleCricketDM(chatText, reply);
      else if (msg.room === "public") observePublicChat(typeof msg.who === "string" ? msg.who : null, chatText);
      else handleChat(chatText, reply);
    }
    else if (msg.t === "editChat" && typeof msg.text === "string" && msg.text.trim()) {
      // EDIT INTERFACE -- see edit_agent.js's own header comment for the
      // full design. A separate top-level frame type, not a `chat`
      // variant, because this is a structurally different conversation:
      // multi-step tool use against the repo, not one Ollama round trip.
      // After the request finishes (reply or error) re-report the dirty flag
      // so the panel's ^R commit chip knows there is something to commit.
      editAgent.handleEditChat(msg.text.trim(), (obj) => {
        reply(obj);
        if (obj && (obj.t === "editReply" || obj.t === "editError")) {
          try { reply(editAgent.editStateFrame()); } catch (err) { post("editState failed: " + err.message); }
        }
      });
    }
    // EDIT-MODE COMMITS -- see edit_agent.js's "EDIT-MODE COMMITS" comment.
    // editBegin: the panel just entered edit mode (or reloaded while in it).
    else if (msg.t === "editBegin") {
      try { reply(editAgent.editBegin()); } catch (err) { reply({ t: "editError", msg: "edit baseline failed: " + err.message }); }
      try { reply(editAgent.agentFrame()); } catch (err) {}   // tasks / discussions / token ring (edit_agent.js "AGENTS")
    }
    // editCommit: ^R + a branch name. Broadcast the new branch list to every
    // panel (the Branches network modal is fed from it), reply to the
    // sender with the outcome.
    else if (msg.t === "editCommit") {
      try {
        const made = editAgent.commitBranch(msg.name);
        reply({ t: "editCommitResult", ok: true, branch: made });
        broadcast(editAgent.branchesFrame());
        reply(editAgent.editStateFrame());
      } catch (err) {
        reply({ t: "editCommitResult", ok: false, error: err.message });
      }
    }
    else if (msg.t === "roomJoin") setSocketRoom(socket, msg.room);
    // branchEnter: Enter on the network page (^N). Swap the working files to
    // that branch's snapshot, tell every panel, and have them all reload onto
    // it (the same 'reloadUI' frame edit mode already uses).
    else if (msg.t === "branchEnter") {
      try {
        const b = editAgent.enterBranch(msg.id);
        reply({ t: "branchEnterResult", ok: true, branch: b });
        if (!b.already) { broadcast(editAgent.branchesFrame()); broadcast({ t: "reloadUI" }); }
      } catch (err) {
        reply({ t: "branchEnterResult", ok: false, error: err.message });
      }
    }
    else if (msg.t === "branchesList") {
      try { reply(editAgent.branchesFrame()); } catch (err) { post("branchesList failed: " + err.message); }
    }
    else if (msg.t === "ping") reply({ t: "pong", at: Date.now() });
    /* DIAGNOSTIC — user reported "unknown frame type 'undefined' from
       panel" twice, right at connect, on a clean ./run.sh start (no
       lingering old process this time, so not just a stale-tab
       reconnect). Audited every client-side send path (Gnumbat.send/
       .slicer/.analyze/.patch/.chat, plus the raw WebSocket frame
       parser in attachWebSocket() above) and found nothing in the
       current panel.html/gnumbat-live.js/gnumbat-link.js that can construct a
       message without a `t` — every one of them hardcodes it. Logging
       msg.t alone can't tell us more since msg.t IS undefined; logging
       the raw text (capped, since a bad frame's actual size/shape is
       unknown) shows what actually arrived so this can be root-caused
       instead of guessed at next time it happens. */
    else post("unknown frame type '" + msg.t + "' from panel -- raw: " + text.slice(0, 300));
  });

  const drop = () => {
    clients.delete(socket);
    setSocketRoom(socket, null);
    post("panel disconnected (" + clients.size + " left)");
  };
  socket.on("close", drop);
  socket.on("error", drop);

  // Tell the panel what it is allowed to send, so it can grey out anything
  // this build of the hub does not support instead of failing at click time.
  reply({
    t: "hello",
    commands: Object.fromEntries(
      Object.entries(COMMANDS).map(([k, v]) => [k, [...v]])
    ),
  });
});

// ── PD -> HUB ─────────────────────────────────────────────────────────────
function start() {
  osc = new OscUdpPort({
    sendPort,
    listenPort: recvPort,
    onMessage: (m) => {
      updateTrainingState(m.address, m.args);
      const shape = TELEMETRY[m.address];
      if (!shape) {
        // Once per address, not once per packet — telemetry arrives at ~20Hz
        // and an unknown one would otherwise bury the log.
        if (!unknownAddrSeen.has(m.address)) {
          unknownAddrSeen.add(m.address);
          post("no telemetry shape for '" + m.address + "' (first occurrence; " +
               "add it to TELEMETRY if it is real)");
        }
        return;
      }
      broadcast(shape(m.args));
    },
  });

  // Direct Node-to-Node OSC clients (send-only -- no listenPort passed, so
  // no bind/EADDRINUSE risk) straight to sliceWriter's and bufferManager's
  // own recv ports, bypassing bridge_guiHub.pd entirely -- that Pd patch's
  // [route slicer analyze reader patch] only ever had those four targets,
  // sliceWriter/bufferManager were never among them (see performResetAll()
  // below). Talking to them directly over UDP is simpler than adding two
  // more route branches and two more netsend objects to that patch.
  oscSliceWriter = new OscUdpPort({ sendPort: sliceWriterPort });
  oscBufferManager = new OscUdpPort({ sendPort: bufferManagerPort });
  oscAnalyzeReader = new OscUdpPort({ sendPort: analyzeReaderPort }); // NEW 2026-09-09

  // Ambient Cricket check -- the "periodic mechanism, separate from the
  // normal public-message path" spec item 2 asked for. Started here (not
  // at module load) for the same reason osc/the HTTP server are bound
  // here and not above: test_osc_roundtrip.js requires this file without
  // calling start(), and a live interval ticking during a test run (or a
  // second `require` on a machine where the hub is already running) is
  // exactly the kind of leftover timer that note above start() already
  // warns against for sockets/servers.
  cricketAmbientTimer = setInterval(checkCricketAmbient, AMBIENT_CHECK_INTERVAL_MS);

  server.listen(httpPort, "127.0.0.1", () => {
    post("serving " + panelDir + " on http://localhost:" + httpPort + "/panel.html");
    post("osc out -> 127.0.0.1:" + sendPort + "   osc in <- :" + recvPort);
    post("library -> " + path.join(dataDir, "sessions", getSessionId(), "analysis_library.json") +
         "  (session '" + getSessionId() + "', via GET /api/library)");
    post("waiting for Pd (bridge_guiHub.pd) and a panel to connect");
  });

  process.on("SIGINT", () => {
    post("shutting down");
    for (const c of clients) c.end(wsFrame("", 0x8));
    osc.close();
    if (oscSliceWriter) oscSliceWriter.close();
    if (oscBufferManager) oscBufferManager.close();
    if (oscAnalyzeReader) oscAnalyzeReader.close();
    if (cricketAmbientTimer) clearInterval(cricketAmbientTimer);
    server.close(() => process.exit(0));
  });
}

// Only bind sockets when run as a program. test_osc_roundtrip.js requires this
// file for its COMMANDS/TELEMETRY/wsFrame exports, and a test run must not
// leave a UDP listener and an HTTP server behind — nor fail outright on a
// machine where the hub is already running and the ports are taken.
if (require.main === module) start();

module.exports = { COMMANDS, TELEMETRY, wsFrame, wsAccept, start, buildLibrary, buildNowPlaying };
