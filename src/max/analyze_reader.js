// EBYS — Offline Analyzer Reader  v3
//
// Reads FluCoMa buf~ output buffers and writes slices + metadata to slice_writer.js.
// Call AFTER the FluCoMa buf~ objects have finished processing.
//
// ── Inlet messages ────────────────────────────────────────────────────────────
//   readVocals / readMelo / readBass / readDrum
//   set_track_name <name>   — call before readX (patch wires this from regexp)
//   setHopSize <n>          — default 512
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  →  slice_writer.js  (set_X_time/C/E/F/P, write_X, set_meta_X_*, write_meta_X)
//   1  →  status strings

autowatch = 1;
inlets    = 1;
outlets   = 9;  // 0=slice_writer, 1=status, 2=counter advance (bang), 3=nDone display, 4=counter set,
                // 5=buffer~ stem_vocals, 6=buffer~ stem_drums, 7=buffer~ stem_bass, 8=buffer~ stem_melo

var HOP_SIZE         = 512;
var SAMPLE_RATE      = 44100;
var currentTrackName = "";
var skipCurrentTrack = false;

// ── Stream.txt path store ─────────────────────────────────────────────────────
// stream.txt is a flat list: 4 lines per track (vocals, drums, bass, melody).
// Max counter cycles 1→4 per track; currentBatch tracks which group of 4 we're on.
// allStemPaths[currentBatch*4 + (n-1)] gives the path for counter step n.
var stemPaths      = { 1: "", 2: "", 3: "", 4: "" };  // first batch (backward compat)
var allStemPaths   = [];      // flat array of all paths from stream.txt
var currentBatch   = 0;       // which track (0-based) we're currently analyzing
var analysisActive  = false;  // true while an analysis run is in progress
var pendingRestart  = false;  // stream.txt changed while busy — re-run when done
var stemsThisRun    = 0;      // stems completed in the current batch

// advanceCounter — single exit point for advancing the counter.
// Each batch of 4 = one track. When a batch finishes, moves to the next.
function advanceCounter() {
    stemsThisRun++;
    var totalBatches = Math.ceil(allStemPaths.length / 4) || 1;
    post("analyze_reader: batch " + currentBatch + " step " + stemsThisRun + "/4 done\n");

    if (stemsThisRun >= 4) {
        // Batch complete — do NOT fire outlet(2,"bang") here.
        // The counter wraps at 4→1 which would re-trigger startStem(1) synchronously,
        // causing infinite recursive skipping. The Task handles the transition instead.
        currentBatch++;
        if (currentBatch < totalBatches) {
            stemsThisRun = 0;
            post("analyze_reader: → batch " + currentBatch + "/" + (totalBatches-1) + "\n");
            var t = new Task(function() {
                outlet(4, "set", 0);   // reset counter to 0 silently
                outlet(2, "bang");     // 0 → 1 → fires startStem(1) for next batch
            }, this);
            t.schedule(50);
        } else {
            analysisActive = false;
            post("analyze_reader: ✓ all " + allStemPaths.length + " stems done\n");
            outlet(1, "all_done");
            // If stream.txt changed while we were busy, re-run now
            if (pendingRestart) {
                pendingRestart = false;
                post("analyze_reader: running queued analysis (stream.txt updated while busy)\n");
                var t = new Task(function() { startAnalysis(); outlet(4, "set", 0); }, this);
                t.schedule(200);
            }
        }
    } else {
        // Normal step advance (steps 1→2→3) — safe to fire synchronously.
        outlet(2, "bang");
    }
}

function readStreamTxt() {
    analysisActive = true;
    stemsThisRun   = 0;
    currentBatch   = 0;
    allStemPaths   = [];

    var STREAM_PATH = streamPath();
    var f = new File(STREAM_PATH, "read", "TEXT");
    if (!f || !f.isopen) {
        post("analyze_reader: ERROR — stream.txt not found at " + STREAM_PATH + "\n");
        analysisActive = false;
        return;
    }
    post("analyze_reader: reading " + STREAM_PATH + "\n");

    // BUG (found + fixed here): this used to just push every line's PATH
    // into one flat array and later slice it into batches of 4 by pure
    // POSITION (globalIdx = currentBatch*4 + (n-1), see startStem() below),
    // completely ignoring the "label" token each line actually starts with.
    // That's correct only as long as EVERY track contributes exactly 4
    // lines in the fixed order vocals/drums/bass/melody — true for a real
    // Demucs track, but false for anything ingest_generated.py's
    // regenerate_stream_txt() writes: a generated clip only ever has ONE
    // stem file on disk (generate_agent.py produces a single isolated
    // stem), so it contributes exactly ONE line, not four. The moment a
    // partial-stem track's line(s) landed anywhere but a batch boundary,
    // every following line's assumed stem type silently shifted by however
    // many slots were missing — e.g. a lone "drums /path/to/GEN__drums_..
    // ..._drums.wav" line landing at position 4 (5th overall) got read as
    // step n=1 of the NEXT batch, i.e. treated as "vocals": loaded into the
    // vocals FluCoMa chain, analyzed there, and written to
    // analysis_library.json as a fabricated "..._vocals.wav" entry — while
    // the track's real drums content never got a "..._drums.wav" entry at
    // all. Net effect: buildIndex() in slicer.js could never find this
    // generated track under its OWN stem type, so :setAgentMode <stem>
    // generate had nothing to actually surface for it — the "gen tracks
    // never load in the playback engine" symptom.
    //
    // Fix: group lines by the track folder each path actually lives in
    // (not by raw line position), and place each line into the canonical
    // vocals/drums/bass/melody slot named by ITS OWN label — not by
    // whichever position it happened to land on in the flat file. Tracks
    // with fewer than 4 stems just leave the other slots blank, which
    // startStem()'s existing `if (!path) { advanceCounter(); return; }`
    // guard already skips cleanly — no change needed there. This keeps the
    // external Max [counter 1 4] object's fixed mod-4 stepping valid (every
    // batch is still exactly 4 slots wide once flattened back out below),
    // it just no longer trusts position to mean anything about content.
    var LABEL_SLOT  = { vocals: 0, drums: 1, bass: 2, melody: 3 };
    var trackOrder  = [];   // track-folder keys, in first-seen order
    var trackSlots  = {};   // trackFolder -> [vocalsPath, drumsPath, bassPath, melodyPath]

    while (true) {
        var line = f.readline();
        if (line === null || line === undefined) break;
        line = line.replace(/[\r\n]+$/, "");
        if (line === "") continue;
        var space = line.indexOf(" ");
        if (space <= 0) continue;   // no label — can't tell which slot this is, skip
        var label = line.slice(0, space).trim();
        var path  = line.slice(space + 1).trim();
        if (!path) continue;
        if (!LABEL_SLOT.hasOwnProperty(label)) {
            post("analyze_reader: stream.txt — unknown stem label '" + label + "' — skipping line\n");
            continue;
        }
        var slash     = path.lastIndexOf('/');
        var trackKey  = (slash >= 0) ? path.slice(0, slash) : path;  // this stem's own parent folder
        if (!trackSlots.hasOwnProperty(trackKey)) {
            trackSlots[trackKey] = ["", "", "", ""];
            trackOrder.push(trackKey);
        }
        trackSlots[trackKey][LABEL_SLOT[label]] = path;
    }
    f.close();

    for (var ti = 0; ti < trackOrder.length; ti++) {
        var slots = trackSlots[trackOrder[ti]];
        for (var s = 0; s < 4; s++) allStemPaths.push(slots[s]);
    }

    // Back-compat: populate stemPaths[1..4] from first batch
    for (var i = 0; i < 4; i++) stemPaths[i+1] = allStemPaths[i] || "";

    var nTracks = Math.ceil(allStemPaths.length / 4);
    post("analyze_reader: " + trackOrder.length + " track(s), " + allStemPaths.length + " stem-slot(s) loaded — " + nTracks + " batch(es)\n");

    if (allStemPaths.length === 0) {
        post("analyze_reader: ERROR — stream.txt empty or unreadable\n");
        analysisActive = false;
    }
}

var STEP_STEMS_MAP    = { 1: "vocals", 2: "drums", 3: "bass", 4: "melody" };
var STEP_OUTLETS_MAP  = { 1: 5,       2: 6,       3: 7,     4: 8        };

// startStem(n) — called by "startStem $1" wired to counter outlet 0.
// n = 1-4 (position in current batch). Global index = currentBatch*4 + (n-1).
function startStem(n) {
    n = parseInt(n);

    if (!analysisActive) {
        post("analyze_reader: startStem " + n + " ignored — no active run\n");
        return;
    }

    var stemName  = STEP_STEMS_MAP[n];
    var outIdx    = STEP_OUTLETS_MAP[n];
    var globalIdx = currentBatch * 4 + (n - 1);
    var path      = allStemPaths[globalIdx] || "";

    if (!stemName) { post("analyze_reader: startStem — unknown step " + n + "\n"); return; }

    if (!path) {
        post("analyze_reader: startStem " + n + " — no path at index " + globalIdx + "\n");
        advanceCounter();
        return;
    }

    // Exact-filename check — "439_vocals.wav" != "DREPTO_vocals.wav"
    if (stemAlreadyAnalyzedPath(path)) {
        post("analyze_reader: [batch " + currentBatch + "] " + stemName + " already analyzed — skipping\n");
        advanceCounter();
        return;
    }

    var slash = path.lastIndexOf('/');
    currentTrackName = (slash >= 0) ? path.slice(slash + 1) : path;
    outlet(0, "set_track_name", currentTrackName);

    post("analyze_reader: [batch " + currentBatch + "] startStem " + n + " [" + stemName + "] -> " + path + "\n");
    // Explicit "clear" before "read" — forces Max's buffer~ to treat this as
    // a genuinely fresh load even when the exact same file was already
    // loaded earlier in this Max session (e.g. re-running analysis via
    // :resetMemory, which reuses existing stem files instead of regenerating
    // them like :resetAll does). Cheap and safe: "clear" just zeroes the
    // buffer, "read" immediately repopulates it from disk.
    outlet(outIdx, "clear");
    outlet(outIdx, "read", path);
}

// getPatcherDir — POSIX folder of the patch file, volume prefix stripped.
function getPatcherDir() {
    var fp = patcher.filepath || "";
    var slash = fp.indexOf('/');
    if (slash > 0) fp = fp.slice(slash);
    fp = fp.replace(/[^\/\\]+$/, '');
    if (fp.length > 0 && fp[fp.length-1] !== '/') fp += '/';
    return fp;
}

// ── Persistent library (same JSON file as slice_writer) ───────────────────────
function getLibraryPath() {
    return getDataDir() + "analysis_library.json";
}
var analysisRegistry = {};

var CHUNK = 10000;

function readRegistryFile() {
    // Reads track keys from the native 'dict analysisLib' object (loaded by loadbang).
    // Bypasses JS File I/O — Max's dict read is more reliable for absolute paths.
    // Only populates analysisRegistry keys (track filenames); values are dummy {_:1}.
    try {
        var d = new Dict("analysisLib");
        var keys = d.getkeys();
        analysisRegistry = {};
        if (keys) {
            for (var i = 0; i < keys.length; i++) {
                analysisRegistry[String(keys[i])] = { "_": 1 };
            }
        }
        post("analyze_reader: registry loaded — " + Object.keys(analysisRegistry).length + " tracks\n");
    } catch(e) {
        post("analyze_reader: dict read failed — " + e + "\n");
        analysisRegistry = {};
    }
}

function loadRegistry() {
    // Called once at patch load. Fires outlet 3 to set counter start position.
    readRegistryFile();

    var counterStart = 1;
    var nDone = 0;

    // Check registry for each stem in gate order (1=vocals, 2=drums, 3=bass, 4=other/melody).
    // Avoids reading stream.txt via File, which truncates at UTF-8 multi-byte chars in paths.
    var STEM_ORDER = ["_vocals.wav", "_drums.wav", "_bass.wav", "_other.wav"];
    var regKeys = Object.keys(analysisRegistry);
    for (var i = 0; i < STEM_ORDER.length; i++) {
        var suffix = STEM_ORDER[i];
        var found = false;
        for (var j = 0; j < regKeys.length; j++) {
            if (regKeys[j].toLowerCase().indexOf(suffix) !== -1) { found = true; break; }
        }
        if (found) { nDone++; counterStart = nDone + 1; }
        else break;
    }

    if (nDone >= STEM_ORDER.length) {
        post("analyze_reader: ✓ analysis done — all 4 stems already analyzed\n");
        outlet(1, "all_done");
    }

    // outlet 3: nDone (last analyzed line). Patch adds +1 for display/obj-41 chain.
    outlet(3, nDone);
    // outlet 4: directly set counter to nDone+1 without triggering output.
    // "set N" on counter inlet 0 sets the current count silently.
    outlet(4, "set", nDone + 1);
    outlet(1, "library", nDone, "stems_done", "counter_set_to", (nDone + 1));
    post("analyze_reader: " + nDone + " stems done → counter set to " + (nDone + 1) + "\n");
}

// ── Multi-track sequential analysis ──────────────────────────────────────────
// prepareNextTrack — scans htdemucs for a track that isn't fully in the library.
// If found: writes stream.txt for it and returns true (caller should restart loop).
// If all done: returns false.
// Compute data/ dir relative to this patch — works on any machine.
function getDataRoot() {
    var p = patcher.filepath;
    var slash = p.indexOf('/');
    if (slash > 0) p = p.slice(slash);
    p = p.replace(/[^\/]+$/, '');    // strip filename  → .../src/max/
    p = p.replace(/[^\/]+\/$/, ''); // strip max/      → .../src/
    p = p.replace(/[^\/]+\/$/, ''); // strip src/      → .../EBYS/
    return p + 'data/';
}

// getSessionId — reads data/current_session.txt (written by the TUI's
// session_manager.js / sdj-tui.js login screen), falling back to "default"
// if the pointer file is missing/empty. Read fresh every call — Max keeps
// running across TUI session switches, so this can't be cached at load.
function getSessionId() {
    var f = new File(getDataRoot() + "current_session.txt", "read", "TEXT");
    if (!f || !f.isopen) return "default";
    var id = f.readline();
    f.close();
    id = (id || "").replace(/^\s+|\s+$/g, "");
    return id || "default";
}

// getDataDir — the active session's data dir, data/sessions/<id>/.
function getDataDir() {
    return getDataRoot() + "sessions/" + getSessionId() + "/";
}

// htPath()/streamPath() — resolved fresh on every call (NOT cached in a
// module-level var like the old HT_PATH/STREAM_PATH were) so a mid-run
// :switchSession is picked up on the next prepareNextTrack()/readStreamTxt()
// call instead of requiring the patch to be reloaded.
function htPath()     { return getDataDir() + "stems/htdemucs"; }
function streamPath() { return getDataDir() + "stream.txt"; }
var NEXT_SUFFIXES = ['_vocals.wav', '_drums.wav', '_bass.wav', '_other.wav'];
var NEXT_LABELS   = ['vocals',     'drums',      'bass',      'melody'    ];

function prepareNextTrack() {
    readRegistryFile();
    var regKeys = Object.keys(analysisRegistry);

    var HT_PATH = htPath();
    var htFolder = new Folder(HT_PATH);
    if (!htFolder || htFolder.end) {
        post("prepareNextTrack: cannot open " + HT_PATH + "\n");
        return false;
    }

    var nextLines = null;

    while (!htFolder.end && nextLines === null) {
        var trackFolder = htFolder.filename;
        htFolder.next();

        var trackPath = HT_PATH + "/" + trackFolder;
        var lines     = [];
        var anyNew    = false;

        for (var i = 0; i < NEXT_SUFFIXES.length; i++) {
            var suffix = NEXT_SUFFIXES[i];
            var label  = NEXT_LABELS[i];

            // Find a file in this folder that ends with the expected suffix
            var sf = new Folder(trackPath);
            var foundPath = null;
            while (!sf.end) {
                var fname = sf.filename;
                if (fname.length >= suffix.length &&
                    fname.slice(-suffix.length).toLowerCase() === suffix) {
                    foundPath = trackPath + "/" + fname;
                }
                sf.next();
            }
            sf.close();

            if (!foundPath) continue;

            var justName = foundPath.slice(foundPath.lastIndexOf('/') + 1);
            var isNew = !analysisRegistry.hasOwnProperty(justName);
            if (isNew) anyNew = true;
            lines.push(label + " " + foundPath);
        }

        if (anyNew && lines.length > 0) nextLines = lines;
    }
    htFolder.close();

    if (!nextLines) {
        post("prepareNextTrack: all tracks already analyzed\n");
        return false;
    }

    // Write stream.txt for the next track
    var STREAM_PATH = streamPath();
    var f = new File(STREAM_PATH, "write", "TEXT");
    if (!f || !f.isopen) {
        post("prepareNextTrack: cannot write " + STREAM_PATH + "\n");
        return false;
    }
    for (var i = 0; i < nextLines.length; i++) f.writeline(nextLines[i]);
    f.close();

    post("prepareNextTrack: stream.txt written — " + nextLines.length + " stems\n");
    return true;
}

// resetMemory — clears the in-memory registry and resets counter to 1
//
// BUG (found + fixed here): this never touched analysisActive/pendingRestart/
// stemsThisRun/currentBatch/allStemPaths — the run-state guard startAnalysis()
// uses to avoid double-starting. If ANY prior run ever got stuck mid-way
// (crashed, hung, or was interrupted by a patch reload before advanceCounter()
// reached the completion branch that resets analysisActive to false — see its
// comment), analysisActive stayed permanently true. Every future
// startAnalysis() call — from :analyzeAll, from the stemsReady→startAnalysis
// relay, from anywhere — would then just silently hit the "already running,
// queuing re-run" branch and return, forever, since nothing was actually
// running to ever finish and consume the queued restart. :resetAll and
// :resetMemory both call this function specifically to get back to a clean
// slate, so a stuck run surviving a reset defeated the entire point of
// resetting — this is the "why isn't FluCoMa starting anymore" symptom.
function resetMemory() {
    analysisRegistry = {};
    analysisActive   = false;
    pendingRestart   = false;
    stemsThisRun     = 0;
    currentBatch     = 0;
    allStemPaths     = [];
    // Re-run loadRegistry with empty registry → reports 0 done, sets counter to 1
    loadRegistry();
    post("analyze_reader: memory cleared (run-state guard also reset)\n");
}

function setHopSize(n) {
    HOP_SIZE = parseInt(n);
    post("analyze_reader: hopSize = " + HOP_SIZE + "\n");
}

// startAnalysis — single entry point for triggering a full analysis run.
// Can be called from:
//   - Max patch via [prepend startAnalysis] → this js object
//   - filewatch bang → [prepend startAnalysis] → this js object  (automatic)
//   - WebSocket command from TUI (:analyzeAll)
// startAnalysis — reads stream.txt + resets counter to 0.
// The trigger's outlet 0 then bangs the counter → 1 → startStem(1).
// Wire: filewatch → [t b b b b] outlet3 → [startAnalysis] → js analyze_reader
//       [t b b b b] outlet0 still bangs [counter 1 4] as before.
function startAnalysis() {
    if (analysisActive) {
        post("analyze_reader: startAnalysis — already running, queuing re-run\n");
        pendingRestart = true;
        return;
    }
    post("analyze_reader: startAnalysis triggered\n");
    readStreamTxt();
    if (allStemPaths.length === 0) {
        post("analyze_reader: startAnalysis — no stems found, aborting\n");
        return;
    }
    // Reset counter to 0 silently — the trigger's outlet 0 will bang it to 1 next.
    outlet(4, "set", 0);
}

// Called from Max patch (prepend set_track_name → this object).
// Checks library first — if already analyzed, sets skipCurrentTrack = true
// and does nothing else. If new, initializes slice_writer for fresh analysis.
function set_track_name() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    currentTrackName = parts.join("_");

    // Re-read from disk so tracks analyzed earlier this session are caught.
    // Uses readRegistryFile() — NOT loadRegistry() — to avoid firing outlet 3
    // which would reset the counter and cause an infinite loop.
    readRegistryFile();

    var exists = analysisRegistry.hasOwnProperty(currentTrackName)
                 && Object.keys(analysisRegistry[currentTrackName]).length > 0;

    skipCurrentTrack = exists;

    if (exists) {
        // Do NOT fire outlet 2 here — firing 0 or 1 would pass through gate 1 1
        // → counter inlet 0 → counter resets → infinite synchronous loop → crash.
        // readX handles counter advancement via outlet(2, "bang") after FluCoMa runs.
        post("analyze_reader: '" + currentTrackName + "' already in library — skipping\n");
        outlet(1, "skip", currentTrackName);
    } else {
        outlet(0, "set_track_name", currentTrackName);
        post("analyze_reader: '" + currentTrackName + "' new — analyzing\n");
    }
}

// ── Stem config ───────────────────────────────────────────────────────────────
// Descriptor letter codes (display):
//   M = Centroid (Hz)        C field internally
//   E = Loudness (LUFS)      E field
//   F = Flatness (dB, ≤0)    F field  — FluCoMa reports flatness in decibels
//                                       (10·log10 of the 0–1 ratio), so values
//                                       are ≤0: very negative = tonal, ~0 = noisy
//   P = Pitch (Hz)           P field
//   H = Chroma (dominant)    H field  — peak bin of chroma vector
//   T = Timbre (MFCC)        M0–M5 fields  — 6 MFCC coefficients
var STEMS = {
    vocals: {
        src:    "stem_vocals.mono",
        onsets: "stem_vocals.slices",
        shape:  "stem_vocals_spectral.features",
        loud:   "stem_vocals_loud.features",
        pitch:  "stem_vocals_pitch.features",
        chroma: "stem_vocals_chroma.features",
        mfcc:   "stem_vocals_mfcc.features",
        tMsg: "set_vocals_time", cMsg: "set_vocals_C", eMsg: "set_vocals_E",
        fMsg: "set_vocals_F",   pMsg: "set_vocals_P", wMsg: "write_vocals",
        hMsg: "set_vocals_H",   sMsg: "set_vocals_S",
        m0Msg: "set_vocals_M0", m1Msg: "set_vocals_M1", m2Msg: "set_vocals_M2",
        m3Msg: "set_vocals_M3", m4Msg: "set_vocals_M4", m5Msg: "set_vocals_M5",
        bpmMsg: "set_meta_vocals_bpm", confMsg: "set_meta_vocals_conf",
        durMsMsg: "set_meta_vocals_durMs", metaMsg: "write_meta_vocals"
    },
    melody: {
        src:    "stem_melo.mono",
        onsets: "stem_melo.slices",
        shape:  "stem_melo_spectral.features",
        loud:   "stem_melo_loud.features",
        pitch:  "stem_melo_pitch.features",
        chroma: "stem_melo_chroma.features",
        mfcc:   "stem_melo_mfcc.features",
        tMsg: "set_melo_time", cMsg: "set_melo_C", eMsg: "set_melo_E",
        fMsg: "set_melo_F",   pMsg: "set_melo_P", wMsg: "write_melo",
        hMsg: "set_melo_H",   sMsg: "set_melo_S",
        m0Msg: "set_melo_M0", m1Msg: "set_melo_M1", m2Msg: "set_melo_M2",
        m3Msg: "set_melo_M3", m4Msg: "set_melo_M4", m5Msg: "set_melo_M5",
        bpmMsg: "set_meta_melo_bpm", confMsg: "set_meta_melo_conf",
        durMsMsg: "set_meta_melo_durMs", metaMsg: "write_meta_melo"
    },
    bass: {
        src:    "stem_bass.mono",
        onsets: "stem_bass.slices",
        shape:  "stem_bass_spectral.features",
        loud:   "stem_bass_loud.features",
        pitch:  "stem_bass_pitch.features",
        chroma: "stem_bass_chroma.features",
        mfcc:   "stem_bass_mfcc.features",
        tMsg: "set_bass_time", cMsg: "set_bass_C", eMsg: "set_bass_E",
        fMsg: "set_bass_F",   pMsg: "set_bass_P", wMsg: "write_bass",
        hMsg: "set_bass_H",   sMsg: "set_bass_S",
        m0Msg: "set_bass_M0", m1Msg: "set_bass_M1", m2Msg: "set_bass_M2",
        m3Msg: "set_bass_M3", m4Msg: "set_bass_M4", m5Msg: "set_bass_M5",
        bpmMsg: "set_meta_bass_bpm", confMsg: "set_meta_bass_conf",
        durMsMsg: "set_meta_bass_durMs", metaMsg: "write_meta_bass"
    },
    drums: {
        src:    "stem_drums.mono",
        onsets: "stem_drums.slices",
        shape:  "stem_drums_spectral.features",
        loud:   "stem_drums_loud.features",
        pitch:  "stem_drums_pitch.features",
        chroma: "stem_drums_chroma.features",
        mfcc:   "stem_drums_mfcc.features",
        tMsg: "set_drum_time", cMsg: "set_drum_C", eMsg: "set_drum_E",
        fMsg: "set_drum_F",   pMsg: null,          wMsg: "write_drum",
        hMsg: "set_drum_H",   sMsg: "set_drum_S",
        m0Msg: "set_drum_M0", m1Msg: "set_drum_M1", m2Msg: "set_drum_M2",
        m3Msg: "set_drum_M3", m4Msg: "set_drum_M4", m5Msg: "set_drum_M5",
        bpmMsg: "set_meta_drum_bpm", confMsg: "set_meta_drum_conf",
        durMsMsg: "set_meta_drum_durMs", metaMsg: "write_meta_drum"
    }
};

// ── BPM estimation — comb-filter scoring ─────────────────────────────────────
// Tests every integer BPM from 60–200 against the observed inter-onset intervals.
// For each candidate, scores how many IOIs land on the beat grid (including
// subdivisions ×0.25, ×0.5, ×1, ×2, ×3, ×4). Picks the winner, refines with
// a ±2 BPM sub-integer sweep, then reports confidence as inlier fraction.
// Much more accurate than median IOI for complex or syncopated material.
function estimateBPM(onsetBuf, nOnsets, totalSamples) {
    if (nOnsets < 4) return { bpm: 0, confidence: 0 };

    // Collect IOIs in seconds, accepting anything in 0.1s–4.0s range
    var iois = [];
    var prev = onsetBuf.peek(1, 0) / SAMPLE_RATE;  // peek() channel arg is 1-based
    for (var i = 1; i < nOnsets; i++) {
        var curr = onsetBuf.peek(1, i) / SAMPLE_RATE;
        var ioi  = curr - prev;
        if (ioi >= 0.1 && ioi <= 4.0) iois.push(ioi);
        prev = curr;
    }
    if (iois.length < 3) return { bpm: 0, confidence: 0 };

    // Grid multiples to check: subdivisions and bar multiples
    var MULTS = [0.25, 0.333, 0.5, 0.667, 1.0, 1.5, 2.0, 3.0, 4.0];
    var TOL   = 0.07;  // ±7% tolerance

    function scoreCandidate(bpmTest) {
        var period = 60.0 / bpmTest;
        var score  = 0;
        for (var j = 0; j < iois.length; j++) {
            var ioi = iois[j];
            for (var m = 0; m < MULTS.length; m++) {
                var target = period * MULTS[m];
                var diff   = Math.abs(ioi - target) / target;
                if (diff < TOL) {
                    // Integer multiples score higher; closer matches score higher
                    var intBonus = (MULTS[m] === Math.round(MULTS[m])) ? 1.0 : 0.6;
                    score += intBonus * (1.0 - diff / TOL);
                    break;
                }
            }
        }
        return score;
    }

    // Coarse sweep 60–200 BPM in 1 BPM steps
    var bestBPM = 120, bestScore = -1;
    for (var bpmTest = 60; bpmTest <= 200; bpmTest++) {
        var sc = scoreCandidate(bpmTest);
        if (sc > bestScore) { bestScore = sc; bestBPM = bpmTest; }
    }

    // Fine sweep ±2 BPM in 0.1 steps around the winner
    for (var fine = bestBPM - 2; fine <= bestBPM + 2; fine += 0.1) {
        fine = Math.round(fine * 10) / 10;
        var sc = scoreCandidate(fine);
        if (sc > bestScore) { bestScore = sc; bestBPM = fine; }
    }

    // Confidence: fraction of IOIs that land on the winning grid
    var period  = 60.0 / bestBPM;
    var inliers = 0;
    for (var j = 0; j < iois.length; j++) {
        var ioi = iois[j];
        for (var m = 0; m < MULTS.length; m++) {
            var target = period * MULTS[m];
            if (Math.abs(ioi - target) / target < TOL) { inliers++; break; }
        }
    }
    var confidence = inliers / iois.length;

    // Round to nearest 0.5 BPM for clean display
    bestBPM = Math.round(bestBPM * 2) / 2;

    return { bpm: bestBPM, confidence: confidence };
}

// ── Main read functions ───────────────────────────────────────────────────────
function readVocals() { readStem("vocals"); }
function readMelo()   { readStem("melody"); }
function readBass()   { readStem("bass");   }
function readDrum()    { readStem("drums");  }
function readDrums()   { readStem("drums");  }

// Load existing library on startup so already-analyzed tracks are recognized immediately.
// Deferred by one tick so Max has fully registered all outlets before we call outlet().
// loadRegistry is triggered by the dict's right outlet (via patch) after analysisLib finishes
// loading. The 2000ms fallback here fires only if that wiring somehow doesn't trigger it.
var _initTask = new Task(loadRegistry, this);
_initTask.schedule(2000);

// ── Chroma helpers ────────────────────────────────────────────────────────────
// fluid.bufchroma~ outputs 12 channels (one per pitch class) × nFrames frames.
// H = normalised peak chroma bin value (0.0–1.0): which pitch class dominates.
//
// NOTE: Max's JS Buffer.peek() takes a 1-BASED channel argument — confirmed
// via https://docs.cycling74.com/legacy/max8/vignettes/jsbuffer: "Return an
// array with count samples from channel (1-based counting) starting at
// frame (zero-based counting)." This was the root cause of the C==S and
// M0==M1 duplicate-descriptor bug found earlier: every peek() call in this
// file used a 0-based channel index, so "channel 0" silently aliased to
// real channel 1's data (identical to an explicit "channel 1" request),
// and every higher index ended up reading one real channel too early —
// e.g. what was assumed to be "flatness" (index 5) was actually reading
// "rolloff" (the true 5th channel), and the real LAST channel of every
// multi-channel feature buffer (crest, MFCC coeff 12, chroma pitch-class
// 12) was never read at all. Loop below now runs pc = 1..12 (1-based) and
// stores (pc - 1) as the reported pitch-class index so H's external 0–1
// normalisation is unaffected.
function chromaPeak(chromaBuf, descFrame) {
    var peak = 0;
    var peakVal = -1;
    for (var pc = 1; pc <= 12; pc++) {
        var v = chromaBuf.peek(pc, descFrame);
        if (v > peakVal) { peakVal = v; peak = pc - 1; }
    }
    // Normalise bin index to 0–1 range
    return peak / 11.0;
}

// STEM_SUFFIXES maps stem name → the file suffix used as the registry key.
// melody uses "_other.wav" because htdemucs names that stem "other".
var STEM_SUFFIXES = {
    vocals: "_vocals.wav",
    drums:  "_drums.wav",
    bass:   "_bass.wav",
    melody: "_other.wav"
};

function stemAlreadyAnalyzed(name) {
    // Legacy suffix check — kept for readStem() fallback path only.
    var suffix = STEM_SUFFIXES[name];
    if (!suffix) return false;
    readRegistryFile();
    var regKeys = Object.keys(analysisRegistry);
    for (var j = 0; j < regKeys.length; j++) {
        if (regKeys[j].toLowerCase().indexOf(suffix) !== -1) return true;
    }
    return false;
}

// stemAlreadyAnalyzedPath — checks the exact filename against the registry.
// Correct for multi-track: "439iSMT_vocals.wav" ≠ "DREPTO_vocals.wav".
function stemAlreadyAnalyzedPath(path) {
    if (!path) return false;
    var fname = path.slice(path.lastIndexOf('/') + 1);
    readRegistryFile();
    return analysisRegistry.hasOwnProperty(fname);
}

// Derive the correct full filename for a stem — guards against set_track_name()
// being called with a stale wrong-suffix path (e.g. "_drums.wav" for the bass step).
// Strategy: if currentTrackName already ends with the right suffix, return it;
// otherwise replace any known stem suffix in currentTrackName with the target suffix.
function deriveTrackName(name) {
    var suffix = STEM_SUFFIXES[name];
    if (!suffix) return currentTrackName;
    if (currentTrackName.toLowerCase().indexOf(suffix) !== -1) return currentTrackName;
    var ALL = ["_vocals.wav", "_drums.wav", "_bass.wav", "_other.wav"];
    for (var k = 0; k < ALL.length; k++) {
        var idx = currentTrackName.toLowerCase().indexOf(ALL[k]);
        if (idx !== -1) return currentTrackName.slice(0, idx) + suffix;
    }
    return currentTrackName;  // fallback: couldn't derive, use as-is
}

function readStem(name) {
    // NOTE: skip detection is handled upstream in startStem() via exact filename check.
    // Do NOT check stemAlreadyAnalyzed(name) here — suffix matching falsely skips stems
    // from a second track because they share suffixes with the first track's registry entries.

    // Always derive and enforce the correct track name for this stem before any writes.
    // Does not rely on set_track_name() timing from the patch — derives it here directly.
    // This guarantees slice_writer always gets the right key regardless of race conditions.
    var correctName = deriveTrackName(name);
    if (correctName && correctName !== "") {
        if (correctName !== currentTrackName) {
            post("analyze_reader [" + name + "]: correcting track name: "
                 + currentTrackName + " → " + correctName + "\n");
        }
        currentTrackName = correctName;
        outlet(0, "set_track_name", currentTrackName);  // always enforce — no condition
        post("analyze_reader [" + name + "]: track → " + currentTrackName + "\n");
    }

    var s = STEMS[name];
    if (!s) { post("analyze_reader: unknown stem '" + name + "'\n"); return; }

    var srcBuf, onsetBuf, shapeBuf, loudBuf, pitchBuf, chromaBuf, mfccBuf;
    try {
        srcBuf   = new Buffer(s.src);
        onsetBuf = new Buffer(s.onsets);
        shapeBuf = new Buffer(s.shape);
        loudBuf  = new Buffer(s.loud);
        pitchBuf = new Buffer(s.pitch);
    } catch(e) {
        post("analyze_reader [" + name + "]: buffer access failed — " + e + "\n");
        outlet(1, "error", name, "buffer_access");
        advanceCounter();
        return;
    }

    // Chroma and MFCC are optional — fail gracefully if not yet in patch
    var hasChroma = false;
    var hasMfcc   = false;
    try { chromaBuf = new Buffer(s.chroma); hasChroma = (chromaBuf.framecount() > 0); } catch(e) {}
    try { mfccBuf   = new Buffer(s.mfcc);   hasMfcc   = (mfccBuf.framecount()   > 0); } catch(e) {}

    var totalSamples = srcBuf.framecount();
    var nOnsets      = onsetBuf.framecount();
    // FluCoMa feature buffers return channel count from framecount() via JS.
    // Calculate expected descriptor frames from source length instead.
    var nDescFrames  = Math.max(1, Math.ceil(totalSamples / HOP_SIZE));

    post("analyze_reader [" + name + "]: "
         + nOnsets + " onsets  "
         + (totalSamples / SAMPLE_RATE).toFixed(1) + "s  "
         + nDescFrames + " desc frames\n");
    outlet(1, "reading", name, nOnsets);

    if (nOnsets <= 0) {
        post("analyze_reader [" + name + "]: no onsets — skipping\n");
        outlet(1, "done", name, 0);
        advanceCounter();
        return;
    }

    // ── Write slices ─────────────────────────────────────────────────────────
    var written = 0;
    for (var i = 0; i < nOnsets; i++) {
        var onsetSample = onsetBuf.peek(1, i);  // peek() channel arg is 1-based
        if (onsetSample < 0 || onsetSample >= totalSamples) continue;

        var fraction  = onsetSample / totalSamples;
        var descFrame = Math.min(Math.floor(onsetSample / HOP_SIZE), nDescFrames - 1);

        // Channel args below are 1-based (Max JS Buffer.peek() convention —
        // see the note above chromaPeak()). shapeBuf's real channel order is
        // [centroid, spread, skewness, kurtosis, rolloff, flatness, crest] =
        // channels 1-7; flatness is channel 6, not 5.
        var C    = shapeBuf.peek(1, descFrame);  // spectral centroid (Hz)
        var S    = shapeBuf.peek(2, descFrame);  // spectral spread (Hz)
        var F    = shapeBuf.peek(6, descFrame);  // spectral flatness
        var E    = loudBuf.peek(1, descFrame);   // loudness (LUFS)
        var P    = pitchBuf.peek(1, descFrame);  // pitch (Hz)
        var conf = pitchBuf.peek(2, descFrame);  // pitch confidence

        if (conf < 0.5) P = 0;

        // H = normalised dominant chroma bin (0–1); 0 if buffer not ready
        var H = hasChroma ? chromaPeak(chromaBuf, descFrame) : 0;

        // M0–M5 = first 6 MFCC coefficients (real channels 1-6); 0 if buffer not ready
        var M0 = 0, M1 = 0, M2 = 0, M3 = 0, M4 = 0, M5 = 0;
        if (hasMfcc) {
            M0 = mfccBuf.peek(1, descFrame);
            M1 = mfccBuf.peek(2, descFrame);
            M2 = mfccBuf.peek(3, descFrame);
            M3 = mfccBuf.peek(4, descFrame);
            M4 = mfccBuf.peek(5, descFrame);
            M5 = mfccBuf.peek(6, descFrame);
        }

        outlet(0, s.tMsg, fraction);
        outlet(0, s.cMsg, C);
        outlet(0, s.sMsg, S);
        outlet(0, s.eMsg, E);
        outlet(0, s.fMsg, F);
        if (s.pMsg) outlet(0, s.pMsg, P);
        outlet(0, s.hMsg, H);
        outlet(0, s.m0Msg, M0);
        outlet(0, s.m1Msg, M1);
        outlet(0, s.m2Msg, M2);
        outlet(0, s.m3Msg, M3);
        outlet(0, s.m4Msg, M4);
        outlet(0, s.m5Msg, M5);
        outlet(0, s.wMsg);
        written++;
    }

    // ── Write metadata ────────────────────────────────────────────────────────
    // 1. BPM from onset intervals
    var tempo = estimateBPM(onsetBuf, nOnsets, totalSamples);
    outlet(0, s.bpmMsg,  tempo.bpm);
    outlet(0, s.confMsg, tempo.confidence);

    // 2. Stem duration in ms (stored so slicer can read it on fresh open)
    outlet(0, s.durMsMsg, (totalSamples / SAMPLE_RATE) * 1000.0);

    // 3. Commit metadata (also runs key detection from accumulated pitches)
    outlet(0, s.metaMsg);

    post("analyze_reader [" + name + "]: done — "
         + written + " slices  BPM=" + tempo.bpm.toFixed(1)
         + "  conf=" + tempo.confidence.toFixed(2)
         + "  track=" + currentTrackName + "\n");
    outlet(1, "done", name, written);
    advanceCounter();
}
