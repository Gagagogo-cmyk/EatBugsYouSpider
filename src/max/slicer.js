// EBYS — Slicer  v2
//
// ── Role ──────────────────────────────────────────────────────────────────────
// Slicer.js is the sequencing brain of EBYS.  It owns all scheduling and
// musical decision-making: which segment plays next, when it fires, how long
// it runs, and whether the transport is running at all.
//
// Responsibilities:
//   - Index: parses the descriptor dict to build a slice database per stem
//   - Segment selection: picks musically coherent segments (bar-aligned,
//     consecutive slices, weighted by descriptor similarity)
//   - Transport: start / stop / next — drives the looping playback clock
//   - BPM-aware timing: computes stretchRatio = srcBPM / globalBPM so the
//     audio engine can slow/speed karma~ without slicer knowing about audio
//   - Loop / stay logic: STAY_PROB and explicit loop locks for performance control
//
// Slicer does NOT touch audio objects or DSP parameters directly.
// It emits play triggers on outlet 0 that buffer_manager.js consumes.
// ──────────────────────────────────────────────────────────────────────────────
//
// Changes from v1:
//   - selectSegment() replaces selectRandom() — groups consecutive slices
//     into musically meaningful segments (SEGMENT_BARS bars long).
//   - Bar-aligned starts: when QUANTIZE_BARS is on (default), the chosen
//     start slice is snapped to the nearest bar boundary so segments always
//     begin on beat 1.  This is the single biggest factor for sounding good.
//   - next(track) carries the track name, so each stem loops independently
//     and all four fire simultaneously on start().
//   - Probabilistic stay/change: STAY_PROB (0–1) controls how likely a track
//     is to replay the same segment instead of jumping to a new one.
//     0 = always random,  1 = never move.  Default 0.
//
// ── Inlet messages ────────────────────────────────────────────────────────────
//   buildIndex              — read dict, rebuild index
//   start                   — fire all 4 stems simultaneously
//   stop                    — halt
//   next <track>            — re-select segment for that track only
//                             Max patch sends: "next vocals", "next melody", etc.
//   dumpDescriptors [track] — outlet 2 descriptor stream
//   selectRange <track> Clo Chi Elo Ehi Flo Fhi Plo Phi
//   setSegmentBars N        — bars per segment (default 4)
//   setQuantize 0|1         — snap starts to bar grid (default 1 = on)
//   setStayProb 0-1         — probability of staying on same position (default 0)
//   setFallbackBPM N        — BPM when detection returned 0 (default 120)
//   setTrackWeight t N      — future cross-track bias
//   info                    — print state summary
//   reset                   — clear index, stop
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  playback trigger  → list: track  startFrac  endFrac  stretchRatio
//        track        = "vocals" | "melody" | "bass" | "drums"
//        startFrac    = 0–1 fraction of buffer length
//                       multiply by buffer samps to get karma~ seek position
//        endFrac      = 0–1 fraction; segment ends here
//        stretchRatio = srcBPM / globalBPM  (1.0 when no global BPM override)
//   1  status / metadata — first word is the tag:
//        ready N                                        — index ready, N total slices
//        slices Nv Nm Nb Nd                             — per-stem slice counts (vocals melody bass drums)
//        track_name name                                — cleaned source track name
//        need_stemDurs                                  — ask Max to resend setStemDurMs for all stems
//        desc track C S E F P H T tC tE tF tP tH tT    — current slice descriptors + tensions
//        slice_ms track ms                              — absolute playback position in ms
//        stemTrack track name                           — source file name for this stem
//        seg track id dur bars startFrac endFrac        — segment summary (human-readable)
//        stopped                                        — transport halted via stop()
//        reset                                          — index cleared via reset()
//        index_empty                                    — start() called with no index built
//        empty_pool track                               — selectSegment() found zero candidates
//        loop track bars locked                         — stem locked to looping segment
//        unloop track | "all"                           — loop released
//        globalBPM N                                    — global BPM override active
//        segmentBars track N                            — segment length updated
//        stayProb track N                               — stay probability updated
//        quantize 0|1                                   — bar-snap on/off
//   2  descriptor dump (from dumpDescriptors)
//        → list: track  id  n  C  P  E  F  startTime  dur
//   3  query result count (from selectRange)  → int: N matching slices

autowatch = 1;
// 0 = commands (unchanged). 1-4 = raw karma~ data-outlet feeds for
// vocals/melody/bass/drums respectively — see the "Real-time karma~
// position feed" block below and list() for what arrives here. Requires 4
// new patch cords (karma~ ring_0_voc/mel/bss/drm's second/right outlet →
// this object's inlets 1/2/3/4) — these do NOT exist yet in the saved
// .maxpat as of this change and must be wired by hand in the Max GUI; the
// resume-position logic falls back to its previous wall-clock estimate
// whenever no live reading has arrived for a stem, so this is purely additive.
inlets    = 5;
outlets   = 4;   // 0=playback trigger, 1=status/metadata, 2=descriptor dump, 3=selectRange result

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
var TRACKS                 = ["vocals", "melody", "bass", "drums"];
var LAST_SLICE_DEFAULT_DUR = 0.005; // fraction — fallback dur for the last slice (~0.5% of buffer)

// ── MUSICAL PARAMETERS ────────────────────────────────────────────────────────
// Per-track segment bars and stay probability
// Commands: setSegmentBars N  (all tracks)  or  setSegmentBars vocals N  (one track)
//           setStayProb P     (all tracks)  or  setStayProb drums P      (one track)
var SEGMENT_BARS  = { vocals: 32, melody: 32, bass: 32, drums: 32 };
var QUANTIZE_BARS = true;   // snap start to bar grid  (setQuantize 0|1)
// QUANTIZE_STOP — when true (default), :stop doesn't freeze playback the
// instant it's received: it waits for the next downbeat (see stop()'s own
// comment + msUntilNextDownbeat()) so the eventual :start always lands back
// on a clean beat instead of wherever the raw command happened to arrive.
// Toggle via `quantizeStop 0|1`.
var QUANTIZE_STOP = true;
// SEAM_DEBUG — log per loop-cycle: intended timer period vs measured wall-clock
// period, and the drift. drift≈0 → timer is fine, the skip is loop-point/zero-
// crossing alignment; drift large → the re-trigger timer/stretch is mistimed.
// Toggle off (or via `seamDebug 0`) once diagnosed.
var SEAM_DEBUG = true;
// Default 1.0 (always continue forward in the same source file at the end of
// a segment) rather than probabilistically jumping to a new random source
// track/point — for composed (not loop-assembled) music, a stem should just
// keep playing through the file it's on, the way the original recording
// continues. :setStayProb <p> (all) or :setStayProb <stem> <p> (one) lowers
// this back down per stem if some generative shuffling between source tracks
// is wanted after all.
var STAY_PROB     = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };

// ── PLAY FULL FILE (default) ─────────────────────────────────────────────────
// When PLAY_FULL_FILE[track] = true (the default), selectSegment() ignores
// SEGMENT_BARS as a stopping point and instead accumulates every remaining
// slice of the chosen source track — i.e. the whole file, uninterrupted, not
// a short bar-chunk of it. When that segment finishes, the existing
// STAY_PROB=1.0 continuation logic in selectSegment() (search forward from
// where playback ended, wrap to the start of the same track if nothing's
// left) naturally loops the SAME file from its beginning again — so by
// default a stem just plays its current file over and over, start to end,
// forever, and never switches to a different source track or a different
// position within it on its own. The user is the only thing that changes
// that, either by:
//   - a state-changing command: :setSegmentBars <stem> <bars> (switches that
//     stem to bar-chunked slicing, clearing PLAY_FULL_FILE for it — see
//     setSegmentBars()), :setStemSource (pins a specific different file), or
//   - a manual, one-shot trigger: :skip <stem> forces an immediate move to a
//     newly-selected file for that stem without changing any persistent mode.
// :chunkMode <stem|all> <0|1> toggles this directly (1=chunked, 0=whole-file;
// see chunkMode() below — this replaced the old setPlayFullFile command).
//
// DEFAULT is true (whole file, looped) — per explicit request the out-of-the-
// box behaviour is that each stem plays its entire source file start-to-end and
// loops it, never dropping a tail that doesn't fit a bar window. The user opts
// INTO bar-chunked slicing by running :setSegmentBars <stem|all> <bars>, which
// is the single state-changing command that clears PLAY_FULL_FILE for the
// affected stem(s) (see setSegmentBars() below). Nothing at boot/loadbang
// re-runs setSegmentBars, so this default stands until the user changes it.
var PLAY_FULL_FILE = { vocals: true, melody: true, bass: true, drums: true };

// chunkMode <0|1>          → all tracks
// chunkMode <stem> <0|1>   → one track
// Replaces the old setPlayFullFile <stem|all> <on|off> — same PLAY_FULL_FILE
// state underneath, just inverted polarity to match how the two modes are
// actually talked about: chunkMode 1 = bar-chunked slicing (whatever bar
// count :setSegmentBars last set — this doesn't touch SEGMENT_BARS itself,
// only whether it's used), chunkMode 0 = whole-file playback, the default.
// Still emits the same outlet(1,"playFullFile",...) message downstream —
// ws_server.js and the TUI's [CHUNK MODE ON/OFF] header indicator (state.playFullFile)
// don't need to know this command was ever renamed.
// Regression fix: chunkMode() only ever flipped the PLAY_FULL_FILE flag and
// relied on whatever retrigger timer was already scheduled under the OLD mode
// to pick it up — fine for chunked->chunked bar-count changes (next bar is
// always close), but a real problem for full-file mode, where that timer can
// be scheduled minutes away (the whole rest of the file). From the outside
// that reads as ":chunkMode 1 doesn't do anything" — it silently updated
// state, it just wouldn't be AUDIBLE until the current full-file playthrough
// happened to end on its own. Now forces an immediate re-selection for every
// affected, unlocked track (same forceNextOne() used by :skip/:forceNext —
// clears any loop/trigger state first, then selectSegment() picks fresh under
// the just-updated flag), so the mode switch is heard right away in both
// directions. Locked followers are skipped here exactly like forceNext() does
// — advancing a follower directly would fork it off its leader's cycle.
// setWindow hann|hamming|blackman|triangle|rect — changes the FFT window
// used by the pitch shifter (fftin~/fftout~ inside ebys-pitch.maxpat, feeding
// gizmo~), NOT karma~ (plain varispeed tape player, no windowing concept) and
// NOT the FluCoMa descriptor-analysis chain (hardcodes Hann internally, no
// override attribute). This was a documented-but-nonfunctional stub before —
// no handler existed anywhere in slicer.js or ws_server.js.
//
// Forwarded through buffer_manager.js (outlet(1,...) is already wired there —
// same path playback commands take) to slot_router.js, the only JS object
// that talks to pfft~/gizmo~ directly, which broadcasts it via Max
// send/receive into all four stems' independent pfft~ copies at once.
var WINDOW_ALIASES = {
    hann: 'hanning', hanning: 'hanning',
    rect: 'square',  rectangular: 'square', square: 'square',
    triangle: 'triangle',
    hamming: 'hamming',
    blackman: 'blackman'
};
function setWindow(type) {
    var norm = WINDOW_ALIASES[String(type).toLowerCase()];
    if (!norm) {
        post("EBYS Slicer: setWindow — unknown window type '" + type
             + "' (use hann, hamming, blackman, triangle, or rect)\n");
        outlet(1, "sysMsg", "✗ setWindow — unknown type '" + type + "'");
        return;
    }
    outlet(1, "setWindow", norm);
    outlet(1, "sysMsg", "✓ pitch-shift window → " + norm);
    post("EBYS Slicer: setWindow = " + norm + "\n");
}

function chunkMode(trackOrOnOff, onOff) {
    if (onOff === undefined) {
        var chunkOn = (String(trackOrOnOff) === '1');
        var v = !chunkOn;   // PLAY_FULL_FILE — inverted from chunkMode's own sense
        for (var t = 0; t < TRACKS.length; t++) PLAY_FULL_FILE[TRACKS[t]] = v;
        post("EBYS Slicer: chunkMode (all) = " + (chunkOn ? 1 : 0) + "\n");
        outlet(1, "playFullFile", "all", v ? 1 : 0);
        if (running) {
            for (var t2 = 0; t2 < TRACKS.length; t2++) {
                if (!sourceLock[TRACKS[t2]]) forceNextOne(TRACKS[t2]);
            }
        }
    } else {
        var track = trackOrOnOff;
        if (!PLAY_FULL_FILE.hasOwnProperty(track)) {
            post("EBYS Slicer: chunkMode — unknown stem '" + track + "'\n");
            return;
        }
        var chunkOn2 = (String(onOff) === '1');
        var v2 = !chunkOn2;
        PLAY_FULL_FILE[track] = v2;
        post("EBYS Slicer: chunkMode[" + track + "] = " + (chunkOn2 ? 1 : 0) + "\n");
        outlet(1, "playFullFile", track, v2 ? 1 : 0);
        if (running && !sourceLock[track]) forceNextOne(track);
    }
}

// ── LIVE DESCRIPTOR TICKER (full-file mode only) ─────────────────────────────
// In chunked mode, outlet(1,"desc",...) naturally updates every time a new
// segment is actually selected — every bar (or whatever setSegmentBars is),
// so the TUI's descriptor readout already tracks real content as it plays.
// In PLAY_FULL_FILE mode that's exactly the problem: selectSegment() only
// fires ONCE per full loop-through (the whole file IS the one segment), so
// desc gets sent once at the start and then just sits there, frozen, for
// however long the file takes to play — even though the actual audio is
// continuously moving through completely different material the whole time.
//
// Fix: while a stem is in full-file mode, tick every LIVE_DESC_TICK_MS and
// synthesize what selectSegment() would have sent if it had fired right now
// — extrapolate the current real playback position from the same
// dispatchedAtMs/sliceMs/stretchR bookkeeping lastSegment[track] already
// carries (identical math to returnToBase()'s anchor extrapolation, just
// without the wall-clock-since-anchor part — here we only need "now", not
// "then + elapsed"), find whichever already-analyzed slice the playhead is
// currently inside, and re-emit desc/stemMS/slice_ms from THAT slice. Chunked
// stems are skipped entirely here — they already get real updates from
// selectSegment() itself, and re-ticking them too would just be redundant
// noise racing the real thing.
var LIVE_DESC_TICK_MS = 20;

// Plain self-rescheduling Task — same idiom streamWatcher.js's poll() and
// buffer_manager.js's cycle-timeout Task already use elsewhere in this
// codebase. Max tears down a js object's outstanding Tasks when autowatch
// reloads it (streamWatcher.js's own poll loop relies on exactly this — it
// has run this way, across every autowatch reload during dev, without ever
// piling up duplicate pollers), so no extra reload-generation bookkeeping is
// needed here either.
function tickLiveDesc() {
    for (var t = 0; t < TRACKS.length; t++) {
        var track = TRACKS[t];
        if (!running || !PLAY_FULL_FILE[track]) continue;
        var seg = lastSegment[track];
        if (!seg || !(seg.durMs > 0)) continue;

        var stretchR         = seg.stretchR || 1;
        var elapsedContentMs = (Date.now() - seg.dispatchedAtMs) / stretchR;
        var posMs            = (seg.sliceMs + elapsedContentMs) % seg.durMs;
        if (posMs < 0) posMs += seg.durMs;
        var posFrac = posMs / seg.durMs;

        // Current slice under the playhead: the same source track's slice
        // with the largest .time that's still <= posFrac.
        var arr = byTrack[track];
        var cur = null;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].sourceTrack === seg.sourceTrack && arr[i].time <= posFrac) {
                if (!cur || arr[i].time > cur.time) cur = arr[i];
            }
        }
        if (!cur) continue;

        outlet(1, "desc", track, cur.C, cur.S, cur.E, cur.F, cur.P, cur.H, cur.T,
               cur.tension_C, cur.tension_E, cur.tension_F,
               cur.tension_P, cur.tension_H, cur.tension_T);
        outlet(1, "stemMS", track, cur.pan, cur.width);
        outlet(1, "slice_ms", track, Math.round(posMs));
    }

    liveDescTask.schedule(LIVE_DESC_TICK_MS);
}

var liveDescTask = new Task(tickLiveDesc, this);
liveDescTask.schedule(LIVE_DESC_TICK_MS);

// skip <stem>  — one-shot manual advance to a NEWLY-selected source file for
// this stem, without changing PLAY_FULL_FILE or STAY_PROB persistently. The
// STAY branch in selectSegment() only continues on the same track when
// lastSourceTrack[track] is already set — nulling it just for this call
// forces a genuinely fresh pick (scored, or random if no active descriptor
// criteria) exactly like a track hitting the pool for the very first time.
function skip(track) {
    if (!running) { post("EBYS Slicer: skip — not running\n"); return; }
    if (TRACKS.indexOf(track) === -1) { post("EBYS Slicer: skip — unknown stem '" + track + "'\n"); return; }
    if (sourceLock[track]) {
        post("EBYS Slicer: skip — [" + track + "] is source-locked to '" + sourceLock[track]
             + "' — skip its leader instead, or unlockSource it first\n");
        return;
    }
    var prevTrack = lastSourceTrack[track];
    lastSourceTrack[track] = null;
    selectSegment(track);
    post("EBYS Slicer: skip [" + track + "] " + (prevTrack || "(none)") + " -> "
         + (lastSourceTrack[track] || "(none)") + "\n");
}

// returnToBase <stem|all> — jump back to wherever the original mix (the
// last genuine PLAY_FULL_FILE line — see baseAnchor's comment above) would
// genuinely be RIGHT NOW, in real time, and resume full-file playback from
// there. Deliberately NOT "resume from wherever you left off before the
// detour" — that would silently erase however much real time was spent
// detouring, and the whole point here is that the original keeps running
// underneath, untouched, the entire time. This is the manual "snap back to
// the foundation track" move — the DJ decides when and how long to detour
// (:setSegmentBars, :skip, scored jumps, whatever), and this is what gets
// back to base afterward, however long that took.
function returnToBase(stemOrAll) {
    var targets = (!stemOrAll || String(stemOrAll) === 'all') ? TRACKS.slice() : [String(stemOrAll)];
    for (var ti = 0; ti < targets.length; ti++) {
        var track  = targets[ti];
        var anchor = baseAnchor[track];
        if (TRACKS.indexOf(track) === -1) {
            post("EBYS Slicer: returnToBase — unknown stem '" + track + "'\n");
            continue;
        }
        if (!anchor) {
            post("EBYS Slicer: returnToBase [" + track + "] — no base set yet "
                 + "(play at least one full-file segment first)\n");
            outlet(1, "sysMsg", "✗ returnToBase [" + track + "] — no base set yet");
            continue;
        }
        // Find this source track's real measured duration from any slice on
        // it — the anchor only stores the source track NAME, not its own
        // stemDurMs, since that's a per-slice field, not a per-anchor one.
        var arr   = byTrack[track] || [];
        var durMs = 0;
        for (var ai = 0; ai < arr.length; ai++) {
            if (arr[ai].sourceTrack === anchor.sourceTrack && (arr[ai].stemDurMs || 0) > 0) {
                durMs = arr[ai].stemDurMs;
                break;
            }
        }
        if (durMs <= 0) {
            post("EBYS Slicer: returnToBase [" + track + "] — can't resolve stemDurMs for '"
                 + anchor.sourceTrack + "' (index may have changed since the anchor was set)\n");
            outlet(1, "sysMsg", "✗ returnToBase [" + track + "] — lost stemDurMs for '" + anchor.sourceTrack + "'");
            continue;
        }
        // Extrapolate: base position = where it was anchored + every real ms
        // that's elapsed since, wrapped to the file's own length (a long
        // enough detour may mean the untouched original has already looped
        // one or more times in the background).
        var elapsedMs = Date.now() - anchor.wallClockMs;
        var posMs     = (anchor.fileTimeMs + elapsedMs) % durMs;
        if (posMs < 0) posMs += durMs;
        var posFrac   = posMs / durMs;

        PLAY_FULL_FILE[track] = true;
        outlet(1, "playFullFile", track, 1);
        // Seed STAY-continuation's own anchor so selectSegment()'s existing
        // "advance to the first slice at/after lastEndFrac" logic does the
        // actual work — same mechanism every ordinary full-file loop already
        // uses, just pre-loaded with the extrapolated position instead of
        // wherever the last dispatched segment happened to end.
        lastSourceTrack[track] = anchor.sourceTrack;
        lastEndFrac[track]     = posFrac;
        post("EBYS Slicer: returnToBase [" + track + "] — resuming '" + anchor.sourceTrack
             + "' at " + posFrac.toFixed(4) + " (" + (posMs / 1000).toFixed(1)
             + "s, " + (elapsedMs / 1000).toFixed(1) + "s after the detour started)\n");
        outlet(1, "sysMsg", "↩ returnToBase [" + track + "]: '" + anchor.sourceTrack
               + "' @ " + (posMs / 1000).toFixed(1) + "s");
        selectSegment(track);
    }
}

// ── TRIGGER PAD MODE ──────────────────────────────────────────────────────────
// When TRIGGER_MODE[track] = true, next() does NOT auto-select the next segment.
// Instead it pauses and emits "triggerReady track 1" on outlet 1.
// The TUI shows a ● pad indicator; the user fires trigger() (via :trigger or C-1..4)
// to probabilistically select and play the next slice.
// setTriggerMode track 0  — back to continuous (auto-play)
// trigger track           — manually fire the paused stem
var TRIGGER_MODE  = { vocals: false, melody: false, bass: false, drums: false };
var triggerReady  = { vocals: false, melody: false, bass: false, drums: false };

// ── SOURCE TRACK SELECTION WEIGHTS ───────────────────────────────────────────
// When the slice pool spans multiple source tracks, each track is scored by:
//   SRC_BPM_WEIGHT:      how closely its BPM matches globalBPM  (squared ratio)
//   SRC_COHESION_WEIGHT: fraction of OTHER stems currently on that track
//   SRC_KEY_WEIGHT:      how harmonically compatible its key is with whatever
//                        the other stems are currently playing (Camelot wheel)
// All three weights sum to 1.0.  High cohesion ≈ all stems gravitate to one
// track. Hard pin via :setStemSource overrides these weights entirely for
// that stem — key compatibility only matters when the engine is choosing
// between multiple eligible tracks on its own.
// Tune via :setSrcWeights <bpm_w> <cohesion_w> <key_w>  (values are renormalised;
// key_w defaults to 0 if omitted, preserving old 2-arg behavior exactly).
var SRC_BPM_WEIGHT      = 0.25;
var SRC_COHESION_WEIGHT = 0.55;
var SRC_KEY_WEIGHT      = 0.20;

// ── SOURCE TRACK FILTER ───────────────────────────────────────────────────────
// Pin individual stems (or all) to a specific source track.
// :setStemSource drums "Sweet Home Alabama"  — drums only picks from that track
// :setStemSource all "Come As You Are"        — all stems locked to that track
// :setStemSource drums clear                  — remove pin (free selection)
// Partial, case-insensitive match against sourceTrack names.
var stemSourceFilter = { vocals: null, melody: null, bass: null, drums: null };
var FALLBACK_BPM  = 120;    // used when BPM detection returned 0
var GLOBAL_BPM    = 120;    // stretch target BPM; 0 = use each track's analyzed BPM
var BAR_SNAP_MS       = 30;  // ms tolerance for "close enough to a bar boundary"
var MAX_SLICES_PER_STEM = 200; // auto-overridden by buildIndex (trackCount × 200); set via :setMaxSlices N; 0 = unlimited

// Timing is driven by play~'s done bang in the Max patch.
// play~ fires done bang when it reaches endFrac → next() → selectSegment() → new segment.
// BPM controls how many slices to select (segment length), not transition timing.

// ── STEM DURATIONS (ms) ───────────────────────────────────────────────────────
// Set from Max via:  setStemDurMs vocals 187420
// info~ stem_vocals → [* 1000] → prepend setStemDurMs vocals → js slicer.js
// Without these, slice.time fractions can't be compared to barMs (ms).
var stemDurMs = { vocals: 0, melody: 0, bass: 0, drums: 0 };

// ── SLOT MAP ──────────────────────────────────────────────────────────────────
// Maps source track name → slot index (0-based, alphabetical).
// Populated by buildIndex(); used to embed slot in outlet 0 messages.
// track_loader.js uses the same alphabetical sort, so slot 0 here = slot 0 there.
var slotMap = {};  // { "439 ISMT": 0, "DREPTO CE3o": 1, … }

function setStemDurMs(track, ms) {
    if (stemDurMs.hasOwnProperty(track)) {
        var newMs = parseFloat(ms);
        if (newMs <= 0) return;  // ignore empty-buffer reports (0ms on patch open)
        stemDurMs[track] = newMs;
        post("EBYS Slicer: stemDurMs[" + track + "] = "
             + (stemDurMs[track] / 1000).toFixed(2) + "s\n");
        outlet(1, "stemDurMs", track, stemDurMs[track]);
    }
}

// ── LIBRARY CHUNK ACCUMULATOR ─────────────────────────────────────────────────
// ws_server.js sends the 1+ MB analysis_library.json in 2 KB chunks to bypass
// Max's 32 767-byte JsFile limit and N4M's setDict size ceiling.
// Format: libchunk  streamId  chunkIndex  total  data
var cachedLibrary    = null;   // parsed library object, set once all chunks arrive
var libChunkBuf      = null;   // Array(total) of string chunks
var libChunkTotal    = 0;
var libChunkReceived = 0;
var libChunkSid      = -1;     // current stream id

function libchunk() {
    // Max splits symbol atoms on spaces, so a JSON chunk containing spaces arrives
    // as multiple atoms.  args[0]=streamId, args[1]=i, args[2]=total, args[3+]=data.
    var args = arrayfromargs(arguments);
    var sid  = parseInt(args[0]);
    var i    = parseInt(args[1]);
    var t    = parseInt(args[2]);
    var data = args.slice(3).join(' ');

    if (!libChunkBuf || libChunkSid !== sid) {
        if (libChunkBuf) {
            post("EBYS Slicer: libchunk stream reset (was " + libChunkSid
                 + ", now " + sid + ") — " + libChunkReceived + "/" + libChunkTotal + " chunks dropped\n");
        }
        libChunkBuf      = new Array(t);
        libChunkTotal    = t;
        libChunkSid      = sid;
        libChunkReceived = 0;
    }
    if (libChunkBuf[i] !== undefined) return; // duplicate chunk — ignore
    libChunkBuf[i] = data;
    libChunkReceived++;
    if (libChunkReceived === t) {
        var assembled = libChunkBuf.join('');
        libChunkBuf = null;
        try {
            cachedLibrary = JSON.parse(assembled);
            post("EBYS Slicer: library cached via chunks (stream " + sid
                 + ", " + assembled.length + " chars, " + t + " chunks)\n");
            // If buildIndex arrived before chunks finished, run it now.
            if (buildIndexPending) buildIndex();
        } catch(e) {
            post("EBYS Slicer: chunk assembly parse failed — " + e + "\n");
            post("EBYS Slicer: assembled[0..100] = " + assembled.substring(0, 100) + "\n");
            cachedLibrary = null;
        }
    }
}

// ── GENRE STATE ───────────────────────────────────────────────────────────────
// trackGenres[trackName] = ["Electronic---Techno", "Electronic---House", ...]
// Populated from genres.json via genrechunk messages from ws_server.js.
// genreFilter: substring match against genre strings (case-insensitive). null = no filter.
var trackGenres      = {};
var genreFilter      = null;   // e.g. "Techno", "House", "Jazz"
// keyFilter: exact or partial match against slice.key (case-insensitive). null = no filter.
// Key values come from the track metadata (e.g. "Am", "C#", "G").
var keyFilter        = null;   // e.g. "Am", "C", "G#m"

var genreChunkBuf      = null;
var genreChunkTotal    = 0;
var genreChunkReceived = 0;
var genreChunkSid      = -1;

function genrechunk() {
    var args = arrayfromargs(arguments);
    var sid  = parseInt(args[0]);
    var i    = parseInt(args[1]);
    var t    = parseInt(args[2]);
    var data = args.slice(3).join(' ');

    if (!genreChunkBuf || genreChunkSid !== sid) {
        if (genreChunkBuf) {
            post("EBYS Slicer: genrechunk stream reset (was " + genreChunkSid
                 + ", now " + sid + ") — " + genreChunkReceived + "/" + genreChunkTotal + " chunks dropped\n");
        }
        genreChunkBuf      = new Array(t);
        genreChunkTotal    = t;
        genreChunkSid      = sid;
        genreChunkReceived = 0;
    }
    if (genreChunkBuf[i] !== undefined) return; // duplicate
    genreChunkBuf[i] = data;
    genreChunkReceived++;
    if (genreChunkReceived === t) {
        var assembled = genreChunkBuf.join('');
        genreChunkBuf = null;
        try {
            var gdata = JSON.parse(assembled);
            trackGenres = {};
            for (var trackName in gdata) {
                var entry = gdata[trackName];
                if (entry && entry.genres && entry.genres.length) {
                    // Store top-5 genre strings for this track
                    trackGenres[trackName] = entry.genres.slice(0, 5).map(function(g) {
                        return g.genre;
                    });
                }
            }
            post("EBYS Slicer: genres loaded — "
                 + Object.keys(trackGenres).length + " tracks\n");
        } catch(e) {
            post("EBYS Slicer: genre chunk parse failed — " + e + "\n");
        }
    }
}

// ── DOWNBEATS CHUNK ACCUMULATOR ──────────────────────────────────────────────
// downbeats.json is sent by ws_server.js (Node) before the cached index so
// loadDownbeats() finds the data already available when it runs.
var downbeatsRaw       = null;   // parsed JSON object once all chunks arrive
var dbChunkBuf         = null;
var dbChunkTotal       = 0;
var dbChunkReceived    = 0;
var dbChunkSid         = -1;

function downbeatchunk() {
    var args = arrayfromargs(arguments);
    var sid  = parseInt(args[0]);
    var i    = parseInt(args[1]);
    var t    = parseInt(args[2]);
    var data = args.slice(3).join(' ');
    if (!dbChunkBuf || dbChunkSid !== sid) {
        if (dbChunkBuf) {
            post("EBYS Slicer: downbeatchunk stream reset (was " + dbChunkSid
                 + ", now " + sid + ") — " + dbChunkReceived + "/" + dbChunkTotal + " chunks dropped\n");
        }
        dbChunkBuf      = new Array(t);
        dbChunkTotal    = t;
        dbChunkSid      = sid;
        dbChunkReceived = 0;
    }
    if (dbChunkBuf[i] !== undefined) return; // duplicate
    dbChunkBuf[i] = data;
    dbChunkReceived++;
    if (dbChunkReceived === t) {
        var assembled = dbChunkBuf.join('');
        dbChunkBuf = null;
        try {
            downbeatsRaw = JSON.parse(assembled);
            post("EBYS Slicer: downbeats received — "
                 + Object.keys(downbeatsRaw).length + " track(s)\n");
            // If the index is already built, apply downbeats now.
            if (idx.length > 0) loadDownbeats();
        } catch(e) {
            post("EBYS Slicer: downbeats chunk parse failed — " + e + "\n");
        }
    }
}

// ── INDEX STATE ───────────────────────────────────────────────────────────────
var idx          = [];
var byTrack      = {};
var meta         = {};
var ranges       = {};

// ── DOWNBEAT STATE ────────────────────────────────────────────────────────────
// Populated by loadDownbeats() from downbeats.json (sent by ws_server).
// trackDownbeats[sourceTrackName] = { meter, bpm, avgBarMs, downbeats_ms: [...], confidence }
// Keyed by source track name so multi-track sessions get correct data per track.
// When confidence < DOWNBEAT_MIN_CONF the BPM grid is used instead.
var trackDownbeats        = {};
var DOWNBEAT_MIN_CONF     = 0.3;  // below this, fall back to BPM grid (lowered from 0.4 to accept classical/rubato pieces)
var trackWeights = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };
var lastIdx         = { vocals: 0,    melody: 0,    bass: 0,    drums: 0    };
var lastEndFrac     = { vocals: -1,   melody: -1,   bass: -1,   drums: -1   }; // fraction where last segment ended
var lastSourceTrack = { vocals: null, melody: null, bass: null, drums: null }; // source track of last segment
var lastSegment     = { vocals: null, melody: null, bass: null, drums: null }; // full spec of last emitted segment — see pushSyncedSegment()

// ── BASE ANCHOR ───────────────────────────────────────────────────────────────
// baseAnchor[track] = { sourceTrack, fileTimeMs, wallClockMs } — a running,
// silent bookmark of "where the original mix would be right now" if it had
// just played straight through, untouched, this whole time. Updated every
// time selectSegment() dispatches a genuine PLAY_FULL_FILE segment (see the
// full-file totalFrac override below) — NOT touched by any manual detour
// (:setSegmentBars, :skip, scored jumps, etc.), so it keeps silently ticking
// forward in real time underneath whatever the DJ is actually doing on top.
// returnToBase() extrapolates from this anchor (fileTimeMs + real ms elapsed
// since wallClockMs, wrapped to the file's own length) to jump back to
// wherever the original would genuinely be by now — not back to wherever
// playback happened to be at the moment of the detour, which would silently
// lose however much real time was spent detouring.
var baseAnchor = { vocals: null, melody: null, bass: null, drums: null };

// ── SOURCE LOCK ────────────────────────────────────────────────────────────────
// sourceLock[follower] = leaderStem  — follower always draws from leader's current source track.
// Works in addition to stemSourceFilter; stemSourceFilter takes priority if set.
//
// DEFAULT: vocals, bass, AND drums are all locked to melody out of the box —
// equivalent to running :lockSource melody vocals drums bass at startup.
// Composed music (as opposed to loops assembled from unrelated stems) only
// works if every stem comes from the exact same take as the melody it was
// written against — a mismatched set is what makes a remix sound wrong.
// This default re-applies on every autowatch reload / patch load since JS
// module state resets then; :unlockSource <stem> releases a lock for that
// session same as any manual lock, and :lockSource <leader> <stem...>
// re-locks one or more followers to a different leader if wanted.
var sourceLock = { vocals: 'melody', melody: null, bass: 'melody', drums: 'melody' };
// syncFollowers[leader] = [follower, ...]  — reverse index of sourceLock, kept in
// sync by lockSource()/unlockSource(). Used by selectSegment() to push the exact
// same time window (slot/startFrac/endFrac/stretchRatio/segDurMs) to every
// follower the instant the leader picks a new segment, so locked stems don't
// just share a source track — they play the identical moment of it, together.
// Must mirror sourceLock's default above (melody → [vocals, bass, drums]).
var syncFollowers = { vocals: [], melody: ['vocals', 'bass', 'drums'], bass: [], drums: [] };

// ── SYNC BARRIER (cycle ids) ──────────────────────────────────────────────────
// Every time a leader (or a solo/unlocked stem) dispatches a new segment, every
// member of its sync group — leader plus the FULL transitive closure of its
// followers, e.g. melody→bass→drums chains, not just direct followers — gets
// tagged with the same cycleId + groupSize on their outlet(0,...) dispatch.
// buffer_manager.js uses that tag to hold each stem's actual "start playing"
// moment (not the request, the real audible start, which only happens once
// that stem's own async ring-buffer compose finishes) until every member of
// the group has reached the same point, then releases all of them together —
// see buffer_manager.js's cycleTracker/commitCycle for the other half of this.
// A monotonic counter is enough: each cycle only needs to be unique among
// cycles that could plausibly still be in flight at once (compose latency is
// milliseconds; segments last seconds), it doesn't need to be globally
// meaningful or ever reset.
var syncCycleCounter = 0;

// Leader's full transitive sync group (itself + every direct AND chained
// follower), for barrier purposes. A plain syncFollowers[leader] lookup only
// gives DIRECT followers — wrong for a chain like melody→bass→drums, where
// drums is a follower of bass, not of melody directly, but still needs to be
// held by the same barrier since pushSyncedSegment() recurses down to it as
// part of the very same cycle.
function collectSyncGroup(leader) {
    var group = [leader];
    var queue = [leader];
    while (queue.length > 0) {
        var cur  = queue.shift();
        var subs = syncFollowers[cur] || [];
        for (var i = 0; i < subs.length; i++) {
            if (group.indexOf(subs[i]) === -1) {
                group.push(subs[i]);
                queue.push(subs[i]);
            }
        }
    }
    return group;
}

// ── PER-STEM LOOP STATE ───────────────────────────────────────────────────────
// loopState[track] = { bars: N, startIdx: i, startTime: fraction, endTime: fraction }
// When set, next() replays the same segment instead of selecting a new one.
var loopState  = { vocals: null, melody: null, bass: null, drums: null };
var loopCycles = { vocals: 0,    melody: 0,    bass: 0,    drums: 0    }; // unique id per loop cycle

// ── PLAYBACK STATE ────────────────────────────────────────────────────────────
var running   = false;
// True once start() has actually fired real segments at least once. Lets
// start() tell a genuine cold start (nothing loaded yet — must selectSegment
// for every stem) apart from a resume after :stop (segments already loaded,
// karma~ just paused in place — must NOT reselect, see start()'s own comment).
// Cleared by reset() so a post-reset :start correctly cold-starts again.
var everStarted = false;
var lastSlice = null;

// Per-stem wall-clock time remaining on the auto-advance countdown at the
// moment :stop froze it — null when nothing was pending (or already
// consumed). See stop()/start()'s resume branch for how this is used to
// genuinely pause/resume the countdown instead of letting it keep counting
// through the stopped period. Also the hold time stop() reschedules the
// Max `delay` object to while paused — long enough that it can never fire
// before a real resume re-arms it with the true remaining time.
var pausedRemainingMs = { vocals: null, melody: null, bass: null, drums: null };
var PAUSED_DELAY_HOLD_MS = 24 * 60 * 60 * 1000;

// Per-stem buffer position (0..1 fraction) at the exact moment :stop froze
// it — null when nothing was playing. Belt-and-suspenders alongside
// karma~'s own "stop"/"play" pause memory: in practice, real testing showed
// :stop→:start still audibly restarting each stem at 0:00 of the file
// despite every message firing exactly as the "play" resume path was
// designed to (confirmed via Max console + patch-wiring inspection — see
// start()'s resume branch). Rather than keep trusting karma~'s internal
// pause-state retention, explicitly re-seek to this computed fraction via
// the same "jump <frac>" message loopjump() already uses successfully
// elsewhere in this file (there, jumping to 0; here, wherever :stop
// actually caught this stem) — see resumeSeek() calls in start().
var pausedPosFrac = { vocals: null, melody: null, bass: null, drums: null };

// ── Real-time karma~ position feed (inlets 1-4) ──────────────────────────────
// karma~'s own data outlet (its second/right outlet, Max-typed "list") emits
// a recurring report — by default every ~50ms, whenever DSP is on — of
// [position(float 0..1), playFlag(int), recordFlag(int), loopStartMs(float),
//  loopEndMs(float), windowSizeMs(float), stateFlag(int 0=stop 1=play
//  2=record 3=overdub 4=append 5=initial)]. Wired directly into this
// object's inlets 1-4 (one per stem — see inlets comment above) rather than
// through slot_router.js, which is a one-way pipe down to karma~ with no
// return path back up. This gives performStopNow() (see stop()) a REAL,
// DSP-measured position to seek back to on resume instead of only ever
// estimating one from wall-clock elapsed time.
var KARMA_INLET_STEM   = { 1: 'vocals', 2: 'melody', 3: 'bass', 4: 'drums' };
var karmaPos            = { vocals: null, melody: null, bass: null, drums: null }; // last reported 0..1 position
var karmaState          = { vocals: null, melody: null, bass: null, drums: null }; // last reported state flag
var karmaPosAtMs        = { vocals: null, melody: null, bass: null, drums: null }; // Date.now() this reading arrived
var KARMA_POS_MAX_AGE_MS = 250; // ignore a reading older than this — treat as stale, fall back to the wall-clock estimate

// Max js convention: an incoming message whose first atom is a number (no
// leading symbol/tag) — exactly karma~'s data-outlet shape above — invokes
// a function literally named list(), with the special `inlet` global set to
// whichever inlet it arrived on. Inlet 0 never reaches here since every
// command sent to it is tagged with a leading word (matched to its own
// same-named function instead).
function list() {
    var stem = KARMA_INLET_STEM[inlet];
    if (!stem) return; // shouldn't happen — only inlets 1-4 carry raw karma~ lists
    var a = arrayfromargs(arguments);
    if (a.length < 7) return;
    karmaPos[stem]     = parseFloat(a[0]);
    karmaState[stem]   = parseInt(a[6]);
    karmaPosAtMs[stem] = Date.now();
}

// ── TRANSITION MATCHING ───────────────────────────────────────────────────────
// MATCH_PROB[track] — 0 = ignore transition, 1 = strict match, PER STEM.
//   How tightly the START of the next slice must match the END of the current one.
//   Applies equally to all descriptors within a stem. setMatchProb vocals 0.8 →
//   vocals' descriptors match at 80%; other stems keep their own value.
//   Was a single global scalar (still "collapsed" across descriptors — that
//   part is unchanged, redundant with setWeight) until per-stem scoring was
//   added — see setMatchProb()/:wmdScope in the TUI.
var MATCH_PROB = { vocals: 0.9, melody: 0.9, bass: 0.9, drums: 0.9 };

// DIR_PREF[track][d] — -1 = prefer decreasing, 0 = neutral, +1 = prefer increasing
//   Biases selection toward slices that evolve in a given direction, PER STEM.
//   setDirPref vocals E 1  → prefer slices where vocals' energy is rising
function defaultDirPref() { return { C: 0.0, S: 0.0, E: 0.0, F: 0.0, P: 0.0, H: 0.0, T: 0.0, D: 0.0 }; }
var DIR_PREF = {
    vocals: defaultDirPref(), melody: defaultDirPref(),
    bass:   defaultDirPref(), drums:  defaultDirPref()
};
var DIR_WEIGHT = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };  // per-stem scale for direction influence

// End-descriptor memory per track — updated after each slice fires.
// Stores the END values of the last played slice so the next selection
// can match against them.
var lastEndDesc = { vocals: null, melody: null, bass: null, drums: null };

// ── LEARNED BIAS (train_bias.py) ──────────────────────────────────────────────
// Closes the loop from human judgments (:score / :scoreTransition, logged by
// ws_server.js to training_log_vertical.jsonl / training_log_transition.jsonl)
// back into live candidate scoring — see train_bias.py's header comment for
// the full design rationale. Two independent linear models, fit offline:
//   TRANSITION_BIAS — predicts "will this cut flow well" from the candidate's
//     descriptor deltas vs. what's currently playing (same 6 dims already
//     used by MATCH_PROB/DIR_PREF above).
//   VERTICAL_BIAS   — predicts "does this combination of all 4 stems' current
//     states sit together" from the mean/std of each descriptor ACROSS the
//     4 stems, including the candidate's own descriptors for whichever stem
//     is being scored right now.
// Both null until learned_bias.json exists AND has enough data — see
// loadLearnedBias(). Every function below is written to no-op cleanly when
// either is null, so nothing changes for anyone who hasn't trained a model
// yet; :score/:scoreTransition logging happens regardless.
var TRANSITION_BIAS = null;  // { weights: {deltaC,...,absDeltaC,...}, bias, n_samples, r2 } | null
var VERTICAL_BIAS   = null;  // { weights: {meanC,stdC,...}, bias, n_samples, r2 } | null
// FIT_SHAPES[label] = 'quadratic' | 'cubic' for any dim :setFitShape flipped
// up from the default 'linear' — read from learned_bias.json's own
// dim_shapes field (see loadLearnedBias()), so this always stays in sync
// with whatever train_bias.py actually fit, with no separate config file
// read here. 'cubic' implies 'quadratic' too (see train_bias.py's
// load_fit_shapes() docstring) — a dim flagged cubic gets BOTH the sq<label>
// and cu<label> terms below, not cu<label> alone.
var FIT_SHAPES = {};

// Per-stem dial on how much each learned model influences scoreCandidate(),
// same 0-5 convention as DIR_WEIGHT. 0 = ignore that model entirely even if
// loaded (useful for A/B'ing whether it's actually helping).
var LEARNED_TRANS_WEIGHT = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };
var LEARNED_VERT_WEIGHT  = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };

// Per-stem source: 'remix' (default — pick only real catalog material) or
// 'generate' (pick only generated candidates). Generated source tracks are
// identified purely by naming convention — generate_agent.py names them
// with a "GEN__" prefix before they go through the normal import + Max
// analysis pipeline, so they land in `arr` exactly like any real track,
// just distinguishable by sourceTrack name. No schema/index changes needed
// for this — see filterPoolByAgentMode() below, called right before
// applyLearnedRefusal()/scoreCandidate() at both selection sites. Neither
// of those functions, nor next() itself, needs to know this switch exists.
var AGENT_MODE = { vocals: 'remix', melody: 'remix', bass: 'remix', drums: 'remix' };
var GENERATED_PREFIX = 'GEN__';

// Predicted quality below this (on the same -1..1 scale as :score/
// :scoreTransition ratings) gets a candidate HARD-EXCLUDED from the pool
// entirely, not just penalized — see applyLearnedRefusal(). Soft
// favoring/penalizing for everything above this threshold happens inside
// scoreCandidate() itself, same mechanism as MATCH_PROB/DIR_PREF.
var LEARNED_REFUSE_THRESHOLD = -0.5;

// ── LEARNED BIAS CHUNK ACCUMULATOR ───────────────────────────────────────────
// Same reasoning as the downbeats chunk accumulator above (see its comment):
// a direct `new File(getDataDir() + ...)` read from inside Max's JS engine is
// an untested path in this file — getDataDir()'s patcher.filepath-derived
// string has only ever been exercised via ws_server's Node-side fs reads, and
// File.isopen failing returns silently with no post() at all. So
// learned_bias.json is read by ws_server.js (real Node fs) and streamed over
// the same battle-tested sendChunked()/outlet(1,"need_...") round trip already
// proven for downbeats.json, rather than trusting a second untested read path
// for a second file.
var learnedBiasRaw    = null;   // parsed JSON object once all chunks arrive
var lbChunkBuf        = null;
var lbChunkTotal      = 0;
var lbChunkReceived   = 0;
var lbChunkSid        = -1;

function biaschunk() {
    var args = arrayfromargs(arguments);
    var sid  = parseInt(args[0]);
    var i    = parseInt(args[1]);
    var t    = parseInt(args[2]);
    var data = args.slice(3).join(' ');
    if (!lbChunkBuf || lbChunkSid !== sid) {
        if (lbChunkBuf) {
            post("EBYS Slicer: biaschunk stream reset (was " + lbChunkSid
                 + ", now " + sid + ") — " + lbChunkReceived + "/" + lbChunkTotal + " chunks dropped\n");
        }
        lbChunkBuf      = new Array(t);
        lbChunkTotal    = t;
        lbChunkReceived = 0;
        lbChunkSid      = sid;
    }
    lbChunkBuf[i] = data;
    lbChunkReceived++;
    if (lbChunkReceived >= lbChunkTotal) {
        var assembled = lbChunkBuf.join('');
        lbChunkBuf = null;
        try {
            learnedBiasRaw = JSON.parse(assembled);
            post("EBYS Slicer: learned_bias.json received ("
                 + lbChunkTotal + " chunk(s))\n");
            loadLearnedBias();
        } catch (e) {
            post("EBYS Slicer: biaschunk — JSON parse error: " + e.message + "\n");
        }
    }
}

function loadLearnedBias() {
    TRANSITION_BIAS = null;
    VERTICAL_BIAS   = null;
    FIT_SHAPES      = {};
    try {
        // Prefer data received via biaschunk from ws_server (Node resolves
        // paths — proven). Falls back to a direct file read only if chunks
        // haven't arrived yet, same fallback shape as loadDownbeats().
        var data = learnedBiasRaw;
        if (!data) {
            var f = new File(getDataDir() + "learned_bias.json", "read", "TEXT");
            if (!f.isopen) {
                post("EBYS Slicer: loadLearnedBias — could not open " + getDataDir()
                     + "learned_bias.json (no learnedBiasRaw cached yet either) — "
                     + "run train_bias.py after accumulating :score/:scoreTransition data\n");
                return;
            }
            var raw = "";
            while (!f.eof) raw += f.readline();
            f.close();
            data = JSON.parse(raw);
        }
        if (data.transition) {
            TRANSITION_BIAS = data.transition;
            post("EBYS Slicer: learned TRANSITION bias loaded (n=" + data.transition.n_samples
                 + ", R2=" + data.transition.r2.toFixed(3) + ")\n");
        }
        if (data.vertical) {
            VERTICAL_BIAS = data.vertical;
            post("EBYS Slicer: learned VERTICAL bias loaded (n=" + data.vertical.n_samples
                 + ", R2=" + data.vertical.r2.toFixed(3) + ")\n");
        }
        if (!data.transition && !data.vertical) {
            post("EBYS Slicer: learned_bias.json present but both models are still "
                 + "null (not enough :score/:scoreTransition data yet)\n");
        }
        // dim_shapes — which labels train_bias.py fit extra sq/cu (or
        // sqMean/cuMean) terms for, per :setFitShape. Straight passthrough
        // of the {label: 'quadratic'|'cubic'} map train_bias.py wrote (see
        // its load_fit_shapes()/main()) so predictTransitionQuality/
        // predictVerticalQuality can check it with a plain property read,
        // same style as the weight dicts themselves. Old field name was
        // quadratic_dims (an array) — this replaces it, not just renames it,
        // since a dim can now be one of two non-linear shapes, not a
        // yes/no flag.
        FIT_SHAPES = data.dim_shapes || {};
        var shapedLabels = [];
        for (var lbl in FIT_SHAPES) shapedLabels.push(lbl + ':' + FIT_SHAPES[lbl]);
        if (shapedLabels.length > 0) {
            post("EBYS Slicer: fit shapes loaded: " + shapedLabels.join(', ') + "\n");
        }
    } catch (e) {
        post("EBYS Slicer: loadLearnedBias — error reading learned_bias.json: " + e.message + "\n");
    }
}

// reloadBias — Max message from ws_server.js after :trainBias finishes (mirrors
// reloadDownbeats' role for downbeats.json). Requests a fresh Node-side fs
// read + re-send from ws_server rather than re-parsing a stale cached blob —
// same reasoning as reloadDownbeats(). Also safe to call by hand.
function reloadBias() {
    learnedBiasRaw = null;
    outlet(1, "need_learnedBias");
    post("EBYS Slicer: reloadBias — requested fresh learned_bias.json from ws_server\n");
}

// setLearnedWeight <stem|all> <transition|vertical> <0-5>
function setLearnedWeight(stem, kind, val) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    var v = clamp(parseFloat(val), 0.0, 5.0);
    var table = (String(kind) === 'vertical') ? LEARNED_VERT_WEIGHT
              : (String(kind) === 'transition') ? LEARNED_TRANS_WEIGHT : null;
    if (!table) {
        post("EBYS Slicer: setLearnedWeight — kind must be 'transition' or 'vertical', got '" + kind + "'\n");
        return;
    }
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!table.hasOwnProperty(t)) continue;
        table[t] = v;
        post("EBYS Slicer: learnedWeight[" + kind + "][" + t + "] = " + v + "\n");
        outlet(1, "param", "learnedWeight_" + kind + "_" + t, v);
    }
}

// setAgentMode <stem|all> <remix|generate>
// Pure candidate-sourcing switch — does not touch scoreCandidate(),
// applyLearnedRefusal(), or next()'s playback/sync logic at all. A
// generated candidate that makes it through the pool filter below is, by
// this point, just another arr[] entry with real computed descriptors from
// the normal analysis pipeline — indistinguishable to the scoring code from
// a real slice.
function setAgentMode(stem, mode) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    var m = String(mode);
    if (m !== 'remix' && m !== 'generate') {
        post("EBYS Slicer: setAgentMode — mode must be 'remix' or 'generate', got '" + m + "'\n");
        return;
    }
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!AGENT_MODE.hasOwnProperty(t)) continue;
        AGENT_MODE[t] = m;
        post("EBYS Slicer: agentMode[" + t + "] = " + m + "\n");
        outlet(1, "param", "agentMode_" + t, m);
    }
}

// filterPoolByAgentMode — narrows an index-into-arr pool down to only the
// sourceTrack population matching this stem's current AGENT_MODE, BEFORE
// applyLearnedRefusal()/scoreCandidate() ever see it. If the filter would
// empty the pool (e.g. mode is 'generate' but no generated clips have been
// imported yet for this stem), falls back to the unfiltered pool rather
// than silently stalling playback — same fail-open pattern
// applyLearnedRefusal() already uses for its own empty-result case.
function filterPoolByAgentMode(pool, arr, track) {
    var mode = AGENT_MODE[track] || 'remix';
    var wantGenerated = (mode === 'generate');
    var kept = [];
    for (var i = 0; i < pool.length; i++) {
        var src = (arr[pool[i]] && arr[pool[i]].sourceTrack) || '';
        var isGenerated = src.indexOf(GENERATED_PREFIX) === 0;
        if (isGenerated === wantGenerated) kept.push(pool[i]);
    }
    if (kept.length === 0) {
        post("EBYS Slicer: [" + track + "] agentMode='" + mode + "' has no matching "
             + "candidates in the pool right now — falling back to the unfiltered pool\n");
        return pool;
    }
    return kept;
}

// LEARNED_DIMS — mirrors train_bias.py's all_dims_with_keys() exactly: 7
// level descriptors (own key) + 6 tension descriptors (looked up via
// 'tension_<letter>', short-labeled 'Tn<letter>' so weight names like
// 'deltaTnC' don't collide with T=timbre). Both prediction functions below
// must build features identically to how train_bias.py built them when it
// wrote learned_bias.json's weight names — this list is the single source
// of truth for that shape on the runtime side.
var LEARNED_LEVEL_DIMS   = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];
var LEARNED_TENSION_DIMS = ['C', 'E', 'F', 'P', 'H', 'T'];
function learnedDims() {
    var out = [];
    for (var i = 0; i < LEARNED_LEVEL_DIMS.length; i++) {
        out.push({ label: LEARNED_LEVEL_DIMS[i], key: LEARNED_LEVEL_DIMS[i] });
    }
    for (var i = 0; i < LEARNED_TENSION_DIMS.length; i++) {
        out.push({ label: 'Tn' + LEARNED_TENSION_DIMS[i], key: 'tension_' + LEARNED_TENSION_DIMS[i] });
    }
    return out;
}

// predictTransitionQuality — `candidate[key]` is the candidate's own
// (start-of-slice) value, `endDesc[key]` is what's currently playing —
// identical pairing to the transition-match term in scoreCandidate() below,
// and to how train_bias.py computed deltas from the logged from/to pairs.
// Returns null (rather than treating a missing dim as 0) if EITHER side is
// missing ANY of the 13 keys — a partial read (e.g. tension not populated
// yet for an older library) should skip prediction, not silently score
// against a fabricated zero.
function predictTransitionQuality(candidate, endDesc) {
    if (!TRANSITION_BIAS || !endDesc) return null;
    var dims = learnedDims();
    for (var i = 0; i < dims.length; i++) {
        var key = dims[i].key;
        if (candidate[key] === undefined || candidate[key] === null) return null;
        if (endDesc[key]   === undefined || endDesc[key]   === null) return null;
    }
    var w = TRANSITION_BIAS.weights || {};
    var sum = TRANSITION_BIAS.bias || 0;
    for (var i = 0; i < dims.length; i++) {
        var label = dims[i].label, key = dims[i].key;
        var delta = candidate[key] - endDesc[key];
        sum += (w['delta' + label] || 0) * delta;
        sum += (w['absDelta' + label] || 0) * Math.abs(delta);
        // Quadratic/cubic opt-in (:setFitShape) — sq<label> = delta*delta,
        // cu<label> = delta*delta*delta, matching train_bias.py's
        // build_transition_dataset() exactly. Only present in `w` (and only
        // added to `sum`) for dims someone deliberately flipped up from
        // linear; everything else is untouched by this. Cubic implies
        // quadratic (see FIT_SHAPES' own comment) — both terms fire together.
        var shape = FIT_SHAPES[label];
        if (shape === 'quadratic' || shape === 'cubic') {
            sum += (w['sq' + label] || 0) * (delta * delta);
        }
        if (shape === 'cubic') {
            sum += (w['cu' + label] || 0) * (delta * delta * delta);
        }
    }
    return Math.max(-1, Math.min(1, sum));
}

// predictVerticalQuality — hypothetical "if this candidate were picked for
// `track`, combined with whatever's CURRENTLY playing on the other 3 stems
// (lastEndDesc), would this 4-way combination read as a good mix?" Mirrors
// train_bias.py's mean/std-across-stems feature exactly, substituting the
// candidate in for `track`'s own slot instead of its last-played descriptors
// (which is what a real :score would have captured had this candidate
// already been playing). Returns null if fewer than 2 stems have any value
// for a given dim yet (mirrors the trainer's own floor for a meaningful std).
function predictVerticalQuality(candidate, track) {
    if (!VERTICAL_BIAS) return null;
    var dims = learnedDims();
    var valsByLabel = {};
    for (var i = 0; i < dims.length; i++) valsByLabel[dims[i].label] = [];
    for (var t = 0; t < TRACKS.length; t++) {
        var tr   = TRACKS[t];
        var desc = (tr === track) ? candidate : lastEndDesc[tr];
        if (!desc) continue;
        for (var i = 0; i < dims.length; i++) {
            var key = dims[i].key, label = dims[i].label;
            if (desc[key] !== undefined && desc[key] !== null) valsByLabel[label].push(desc[key]);
        }
    }
    for (var i = 0; i < dims.length; i++) {
        if (valsByLabel[dims[i].label].length < 2) return null;
    }
    var w = VERTICAL_BIAS.weights || {};
    var sum = VERTICAL_BIAS.bias || 0;
    for (var i = 0; i < dims.length; i++) {
        var label = dims[i].label;
        var vals = valsByLabel[label];
        var mean = 0;
        for (var j = 0; j < vals.length; j++) mean += vals[j];
        mean /= vals.length;
        var variance = 0;
        for (var j = 0; j < vals.length; j++) variance += (vals[j] - mean) * (vals[j] - mean);
        variance /= vals.length;
        var std = Math.sqrt(variance);
        sum += (w['mean' + label] || 0) * mean;
        sum += (w['std'  + label] || 0) * std;
        // Quadratic/cubic opt-in — sqMean<label> = mean*mean, cuMean<label> =
        // mean*mean*mean, matching train_bias.py's build_vertical_dataset()
        // exactly.
        var shape = FIT_SHAPES[label];
        if (shape === 'quadratic' || shape === 'cubic') {
            sum += (w['sqMean' + label] || 0) * (mean * mean);
        }
        if (shape === 'cubic') {
            sum += (w['cuMean' + label] || 0) * (mean * mean * mean);
        }
    }
    return Math.max(-1, Math.min(1, sum));
}

// applyLearnedRefusal — hard-exclude candidates the learned models predict as
// clearly bad (below LEARNED_REFUSE_THRESHOLD) from `pool` before scoring
// picks the best of what's left. Never empties the pool: if refusing
// everything would leave nothing to choose from, falls back to the
// unfiltered pool rather than block selection entirely.
function applyLearnedRefusal(pool, arr, track, endDesc) {
    var ltw = LEARNED_TRANS_WEIGHT[track]; if (ltw === undefined) ltw = 1.0;
    var lvw = LEARNED_VERT_WEIGHT[track];  if (lvw === undefined) lvw = 1.0;
    if ((!TRANSITION_BIAS || ltw <= 0) && (!VERTICAL_BIAS || lvw <= 0)) return pool;
    var kept = [];
    for (var i = 0; i < pool.length; i++) {
        var cand = arr[pool[i]];
        var tq = (TRANSITION_BIAS && ltw > 0) ? predictTransitionQuality(cand, endDesc) : null;
        var vq = (VERTICAL_BIAS   && lvw > 0) ? predictVerticalQuality(cand, track)     : null;
        var refused = (tq !== null && tq < LEARNED_REFUSE_THRESHOLD) ||
                      (vq !== null && vq < LEARNED_REFUSE_THRESHOLD);
        if (!refused) kept.push(pool[i]);
    }
    return kept.length > 0 ? kept : pool;
}

// ── FOLLOW STEM ───────────────────────────────────────────────────────────────
// Per-dimension now, not whole-stem: each of a stem's 7 descriptors can
// independently read its own end-descriptors, or a weighted blend of the
// SAME dimension from other stems. See followStem() below for the full
// command grammar.
// FOLLOW_STEM[track][dim] = [ {stem: "melody", weight: 0.8}, {stem: "bass", weight: 0.2} ]
//                        or null = that dimension reads its own descriptors
var FOLLOW_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T'];
function emptyFollowMap() {
    var m = {};
    for (var i = 0; i < FOLLOW_DIMS.length; i++) m[FOLLOW_DIMS[i]] = null;
    return m;
}
var FOLLOW_STEM = { vocals: emptyFollowMap(), melody: emptyFollowMap(), bass: emptyFollowMap(), drums: emptyFollowMap() };

function getBlendedEndDesc(track) {
    var own      = lastEndDesc[track] || {};
    var followMap = FOLLOW_STEM[track];
    var result   = {};
    for (var i = 0; i < FOLLOW_DIMS.length; i++) {
        var dim     = FOLLOW_DIMS[i];
        var follows = followMap && followMap[dim];
        if (!follows || follows.length === 0) {
            result[dim] = own[dim];
            continue;
        }
        var v = 0;
        for (var j = 0; j < follows.length; j++) {
            var src = lastEndDesc[follows[j].stem];
            if (!src) continue;
            v += (src[dim] || 0) * follows[j].weight;
        }
        result[dim] = v;
    }
    return result;
}

// ── UTILITY ───────────────────────────────────────────────────────────────────
function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = "0" + s;
    return s;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Returns the clean source track name for a stem (strips stem suffix from filename).
// Future multi-track: meta[stem].track_name will differ per stem.
function cleanTrackName(stem) {
    var raw = (meta[stem] && meta[stem].track_name) ? String(meta[stem].track_name) : "";
    return raw.replace(/_(vocals|melody|bass|drums|other|melo)(\.\w+)?$/i, "").trim();
}

// ── BUILD INDEX ───────────────────────────────────────────────────────────────
// Read library directly from JSON file — bypasses Max.setDict / Dict API entirely.
// Max Dict JSON export prepends `{}` as a preamble (byte 1 is `}` where valid JSON
// needs `"`).  Fix: replace the leading `{}` with `{"` before parsing.

function readLibraryJSON() {
    // Primary path: ws_server.js delivered the JSON in chunks before buildIndex arrived.
    if (cachedLibrary) return cachedLibrary;
    // If chunks haven't arrived yet, log and bail — buildIndex will be retried by the user.
    post("EBYS Slicer: no cached library — send buildIndex after patch is fully loaded\n");
    return null;
}

// Thin shim so the rest of buildIndex can use .get() / .getkeys()
// without touching the Dict API at all.
// Primitives (numbers, strings, booleans) are returned as-is so that
// parseFloat(metaDict.get("BPM")) etc. work unchanged.
function wrapObj(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== "object") return obj;  // pass primitives through directly
    return {
        get:     function(k) { return wrapObj(obj[k]); },
        getkeys: function()  { return Object.keys(obj); }
    };
}

var buildIndexPending = false;  // true while waiting for chunks to finish

function buildIndex() {
    // If chunks are still in flight, defer until the last libchunk arrives.
    if (libChunkBuf !== null) {
        post("EBYS Slicer: chunks still arriving (" + libChunkReceived + "/" + libChunkTotal + ", stream " + libChunkSid + ") — deferring buildIndex\n");
        buildIndexPending = true;
        return;
    }

    buildIndexPending = false;
    idx     = [];
    byTrack = {};
    meta    = {};
    ranges  = {};
    slotMap = {};

    var lib = readLibraryJSON();
    if (!lib) {
        post("EBYS Slicer: analysis library is empty — run analysis first\n");
        return;
    }
    var d = wrapObj(lib);

    var topKeys = d.getkeys();
    if (!topKeys || !topKeys.length) {
        post("EBYS Slicer: analysis library is empty — run analysis first\n");
        return;
    }

    // ── 1. Map every library filename to its stem type and source track name ──────
    // Filenames look like "DREPTO CE3o_vocals.wav" or "439iSMT_other.wav".
    // Canonical stem type keys are: vocals / melody / bass / drums.
    var SUFFIX_TO_STEM = {};
    SUFFIX_TO_STEM["_vocals.wav"] = "vocals";
    SUFFIX_TO_STEM["_drums.wav"]  = "drums";
    SUFFIX_TO_STEM["_bass.wav"]   = "bass";
    SUFFIX_TO_STEM["_other.wav"]  = "melody";
    SUFFIX_TO_STEM["_melo.wav"]   = "melody";

    // Inner dict key → canonical stem type (library stores "melo" instead of "melody" sometimes)
    var INNER_TO_STEM = {};
    INNER_TO_STEM["vocals"] = "vocals";
    INNER_TO_STEM["melody"] = "melody";
    INNER_TO_STEM["melo"]   = "melody";
    INNER_TO_STEM["bass"]   = "bass";
    INNER_TO_STEM["drums"]  = "drums";

    // trackStemFiles[sourceName][stemType] = library top-level key (filename)
    var trackStemFiles = {};

    for (var ki = 0; ki < topKeys.length; ki++) {
        var key = String(topKeys[ki]);
        var kl  = key.toLowerCase();
        for (var suf in SUFFIX_TO_STEM) {
            var idx_suf = kl.lastIndexOf(suf);
            if (idx_suf !== -1) {
                var stemType   = SUFFIX_TO_STEM[suf];
                var sourceName = key.substring(0, idx_suf).replace(/[_\-]+$/, "").trim();
                if (!trackStemFiles[sourceName]) trackStemFiles[sourceName] = {};
                trackStemFiles[sourceName][stemType] = key;
                break;
            }
        }
    }

    // ── 2. Sort source tracks alphabetically → assign slot numbers ───────────────
    var sourceNames = [];
    for (var tn in trackStemFiles) sourceNames.push(tn);
    sourceNames.sort();

    for (var si = 0; si < sourceNames.length; si++) {
        slotMap[sourceNames[si]] = si;
    }
    // Auto-scale slice cap: 200 slices per source track (overrides manual setMaxSlices)
    if (sourceNames.length > 0) {
        MAX_SLICES_PER_STEM = sourceNames.length * 200;
        post("EBYS Slicer: maxSlices auto-set to " + MAX_SLICES_PER_STEM
             + " (" + sourceNames.length + " tracks × 200)\n");
    }
    post("EBYS Slicer: " + sourceNames.length + " source track(s): "
         + sourceNames.map(function(n, i){ return i + "=" + n; }).join(", ") + "\n");

    // Initialise per-stem arrays
    for (var t = 0; t < TRACKS.length; t++) {
        byTrack[TRACKS[t]] = [];
        meta[TRACKS[t]]    = { key: "", track_name: "" };
    }

    // ── 3. Load slices from every source track / stem combination ────────────────
    for (var ti = 0; ti < sourceNames.length; ti++) {
        var sourceName = sourceNames[ti];
        var slot       = slotMap[sourceName];
        var files      = trackStemFiles[sourceName];

        for (var t = 0; t < TRACKS.length; t++) {
            var track    = TRACKS[t];
            var filename = files[track];
            if (!filename) continue;  // this source track has no analysis for this stem

            var fileDict = d.get(filename);
            if (!fileDict || typeof fileDict.get !== "function") continue;

            // Inner dict key might be "melody", "melo", "vocals", etc.
            var stemDict = null;
            var tryKeys  = [track, "melo", "melody", "vocals", "drums", "bass"];
            for (var tk = 0; tk < tryKeys.length; tk++) {
                var candidate = fileDict.get(tryKeys[tk]);
                if (candidate && typeof candidate.get === "function") {
                    if (INNER_TO_STEM[tryKeys[tk]] === track || tryKeys[tk] === track) {
                        stemDict = candidate; break;
                    }
                }
            }
            // Fallback: try any key whose canonical name matches the track
            if (!stemDict) {
                var innerKeys = fileDict.getkeys ? fileDict.getkeys() : [];
                for (var ik = 0; ik < innerKeys.length; ik++) {
                    var ik_str = String(innerKeys[ik]);
                    if (INNER_TO_STEM[ik_str] === track) {
                        stemDict = fileDict.get(ik_str);
                        if (stemDict && typeof stemDict.get === "function") break;
                        stemDict = null;
                    }
                }
            }
            if (!stemDict) continue;

            var metaDict = stemDict.get("metadata");
            // BPM and BPM_confidence are NOT read — FluCoMa per-stem BPM is unreliable
            // (octave doubling on non-percussive stems). Madmom full-mix BPM is used instead
            // via trackDownbeats[slice.sourceTrack].bpm in stretchRatioForSlice() and
            // effectiveBPMForSource(). FluCoMa BPM is not stored anywhere.
            var mkey = metaDict ? String(metaDict.get("key")        || "")          : "";
            var tname= metaDict ? String(metaDict.get("track_name") || "")          : "";
            var durMs= metaDict ? (parseFloat(metaDict.get("stemDurMs"))      || 0) : 0;

            // meta stores key and track_name only — no BPM.
            meta[track] = { key: mkey, track_name: tname };
            if (durMs > 0) stemDurMs[track] = durMs;

            var slicesDict = stemDict.get("slices");
            if (!slicesDict || typeof slicesDict.getkeys !== "function") continue;

            var sliceKeys = slicesDict.getkeys();
            sliceKeys.sort();

            // Temporary array for slices belonging to this source-track/stem pair.
            // dur, end-descriptors, and T are computed within this sub-array so they
            // stay coherent (no cross-track neighbour calculations).
            var sub = [];

            for (var sk = 0; sk < sliceKeys.length; sk++) {
                var id = sliceKeys[sk];
                if (String(id).indexOf("slice_") !== 0) continue;
                var n  = parseInt(String(id).replace("slice_", "")) || 0;

                var sd = slicesDict.get(id);
                if (!sd || typeof sd.get !== "function") continue;

                var tval = function(k) {
                    var v = sd.get(k);
                    return (v === null || v === undefined || v === "") ? null : parseFloat(v);
                };
                var slice = {
                    track      : track,
                    sourceTrack: sourceName,
                    slot       : slot,
                    stemDurMs  : durMs,
                    id: id, n: n,
                    time: parseFloat(sd.get("time")) || 0,
                    C   : parseFloat(sd.get("C"))    || 0,
                    S   : parseFloat(sd.get("S"))    || 0,
                    P   : parseFloat(sd.get("P"))    || 0,
                    E   : parseFloat(sd.get("E"))    || -60,
                    F   : parseFloat(sd.get("F"))    || 0,
                    H   : parseFloat(sd.get("H"))    || 0,
                    M0  : parseFloat(sd.get("M0"))   || 0,
                    M1  : parseFloat(sd.get("M1"))   || 0,
                    M2  : parseFloat(sd.get("M2"))   || 0,
                    M3  : parseFloat(sd.get("M3"))   || 0,
                    M4  : parseFloat(sd.get("M4"))   || 0,
                    M5  : parseFloat(sd.get("M5"))   || 0,
                    // D — density, written by add_tension.py (loudness + transient-rate blend).
                    // 0 when the library predates add_tension.py's density pass.
                    D    : (tval("density") !== null ? tval("density") : 0),
                    dense: !!sd.get("dense"),
                    tension_C: tval("tension_C"), tension_E: tval("tension_E"), tension_F: tval("tension_F"),
                    tension_P: tval("tension_P"), tension_H: tval("tension_H"), tension_T: tval("tension_T"),
                    // Analysis-driven M/S — written by add_stereo_features.py
                    // pan: -1..+1 from original mix L-R balance at slice time
                    // width: 0..1 from stem M/S ratio, normalized within stem
                    pan  : (tval("pan")   !== null ? tval("pan")   : 0),
                    width: (tval("width") !== null ? tval("width") : 0.5),
                    key: mkey, dur: LAST_SLICE_DEFAULT_DUR,
                    genres: trackGenres[sourceName] || []
                };
                sub.push(slice);
            }

            // ── Per-source-track post-processing ──────────────────────────────────
            // Infer dur from successive start times WITHIN this source track
            for (var i = 0; i < sub.length - 1; i++) {
                sub[i].dur = sub[i + 1].time - sub[i].time;
            }

            // ── Downbeat-aligned slice splitting ────────────────────────────────
            // selectSegment()'s STAY-continuation resumes each new segment by
            // searching for the first analyzed slice AT OR AFTER wherever the
            // previous segment's bar-exact stop point landed (that stop point
            // is necessarily bar-exact, not slice-exact, since locked stems'
            // sync barrier requires every stem to stop at the identical
            // wall-clock instant regardless of each one's own independent
            // slice grid). Transient-detected slice boundaries are essentially
            // never exactly on the bar grid, so that stop point almost always
            // falls INSIDE some slice rather than exactly on one of its
            // boundaries — the "at or after" search then has to skip forward
            // to the next available slice, silently losing whatever audio sat
            // between the true stop point and that slice's own start. Fixed
            // at the source instead of patched at search time: split any
            // slice that a real measured downbeat falls inside, so a slice
            // boundary always exists exactly on the beat grid this source
            // track's own segments actually get cut on. "At or after" then
            // always resolves to an exact "at" match here, for every bar
            // boundary this track has confident downbeat data for.
            // Split pieces copy every descriptor field from their parent
            // slice (there's no real analysis data at a synthetic cut point)
            // and are tagged `synthetic: true` so they stay identifiable.
            // Only tracks with confident madmom downbeat data (the same
            // DOWNBEAT_MIN_CONF gate getBarMs/isNearDownbeat already use) get
            // split; everything else is unaffected — the BPM-grid fallback
            // has no measured downbeat positions to split on.
            var dbInfo = trackDownbeats[sourceName];
            if (dbInfo && dbInfo.confidence >= DOWNBEAT_MIN_CONF
                && dbInfo.downbeats_ms && dbInfo.downbeats_ms.length && durMs > 0
                && sub.length > 0) {
                var splitAt = [];
                for (var dbi = 0; dbi < dbInfo.downbeats_ms.length; dbi++) {
                    var dbFrac = dbInfo.downbeats_ms[dbi] / durMs;
                    if (dbFrac > 0 && dbFrac < 1) splitAt.push(dbFrac);
                }
                splitAt.sort(function(a, b) { return a - b; });
                var splitCount = 0;

                // Leading gap: downbeats before the very first transient-
                // detected slice (e.g. a quiet intro with no detected
                // transient) previously had no slice at all covering them —
                // build one per downbeat, chained up to sub[0]'s own start,
                // so anything that walks a downbeat list forward (like
                // nextDownbeatFrac in selectSegment()) never lands on a
                // timestamp with nothing backing it.
                var leading = [];
                var origFirst = sub[0]; // snapshot BEFORE the loop — sub[0] itself
                                         // shifts forward with every splice below, so
                                         // re-reading sub[0] inside the loop would copy
                                         // fields from the previously-inserted lead
                                         // slice instead of the true original first one
                while (splitAt.length > 0 && splitAt[0] < origFirst.time - 1e-9) {
                    leading.push(splitAt.shift());
                }
                for (var li = 0; li < leading.length; li++) {
                    var lead = {};
                    for (var kk in origFirst) { if (origFirst.hasOwnProperty(kk)) lead[kk] = origFirst[kk]; }
                    lead.time      = leading[li];
                    lead.dur       = (li + 1 < leading.length ? leading[li + 1] : origFirst.time) - leading[li];
                    lead.id        = origFirst.id + '_dbLead' + (li + 1);
                    lead.synthetic = true;
                    sub.splice(li, 0, lead);
                }

                var si2 = 0;
                while (si2 < sub.length && splitAt.length > 0) {
                    var slc = sub[si2];
                    var slcEnd = slc.time + slc.dur;
                    if (splitAt[0] <= slc.time + 1e-9) {
                        // Downbeat at/before this slice's own start — already
                        // a boundary here (either a natural slice edge or one
                        // of the leading slices just inserted above). Nothing
                        // to split; drop it.
                        splitAt.shift();
                        continue;
                    }
                    if (splitAt[0] >= slcEnd - 1e-9) {
                        // Doesn't fall within THIS slice — move on and
                        // re-check the same downbeat against the next one.
                        si2++;
                        continue;
                    }
                    // Falls strictly inside — split slc at this downbeat.
                    var cut = splitAt.shift();
                    var second = {};
                    for (var kk in slc) { if (slc.hasOwnProperty(kk)) second[kk] = slc[kk]; }
                    second.time      = cut;
                    second.dur       = slcEnd - cut;
                    second.id        = slc.id + '_db' + (++splitCount);
                    second.synthetic = true;
                    slc.dur = cut - slc.time;
                    sub.splice(si2 + 1, 0, second);
                    // Re-check the remaining downbeats against the new tail
                    // piece too, in case more than one landed in slc's span.
                    si2++;
                }

                // Trailing gap: downbeats past the last transient-detected
                // slice's own coverage (e.g. a sustained/quiet outro with no
                // detected transient) — same problem, same fix, at the other
                // end of the file. Whatever's left in splitAt at this point
                // is, by the loop's own exit condition, past every slice's
                // end, so it's safe to just chain them onto the tail.
                if (splitAt.length > 0) {
                    var lastSlc = sub[sub.length - 1];
                    lastSlc.dur = splitAt[0] - lastSlc.time;
                    for (var ti = 0; ti < splitAt.length; ti++) {
                        var trail = {};
                        for (var kk in lastSlc) { if (lastSlc.hasOwnProperty(kk)) trail[kk] = lastSlc[kk]; }
                        trail.time      = splitAt[ti];
                        trail.dur       = (ti + 1 < splitAt.length ? splitAt[ti + 1] : 1.0) - splitAt[ti];
                        trail.id        = lastSlc.id + '_dbTail' + (ti + 1);
                        trail.synthetic = true;
                        sub.push(trail);
                    }
                }
            }

            // remainingMs — audio (ms) left in this source track from this slice's
            // start to the end of the buffer. selectSegment() uses this to avoid
            // picking a start point that can't actually satisfy SEGMENT_BARS — a
            // segment starting near the end of a track's tape has nowhere to go
            // and gets silently truncated short regardless of the bar setting.
            for (var i = 0; i < sub.length; i++) {
                sub[i].remainingMs = (1 - sub[i].time) * durMs;
            }

            // Compute T and end-descriptors within this source track
            for (var i = 0; i < sub.length; i++) {
                var m1=sub[i].M1, m2=sub[i].M2, m3=sub[i].M3, m4=sub[i].M4, m5=sub[i].M5;
                sub[i].T = Math.sqrt((m1*m1 + m2*m2 + m3*m3 + m4*m4 + m5*m5) / 5.0);
            }
            for (var i = 0; i < sub.length - 1; i++) {
                sub[i].endC = sub[i+1].C;  sub[i].deltaC = sub[i+1].C - sub[i].C;
                sub[i].endS = sub[i+1].S;  sub[i].deltaS = sub[i+1].S - sub[i].S;
                sub[i].endE = sub[i+1].E;  sub[i].deltaE = sub[i+1].E - sub[i].E;
                sub[i].endF = sub[i+1].F;  sub[i].deltaF = sub[i+1].F - sub[i].F;
                sub[i].endP = sub[i+1].P;  sub[i].deltaP = sub[i+1].P - sub[i].P;
                sub[i].endH = sub[i+1].H;  sub[i].deltaH = sub[i+1].H - sub[i].H;
                sub[i].endT = sub[i+1].T;  sub[i].deltaT = sub[i+1].T - sub[i].T;
                sub[i].endD = sub[i+1].D;  sub[i].deltaD = sub[i+1].D - sub[i].D;
            }
            if (sub.length > 0) {
                var last = sub[sub.length - 1];
                last.endC=last.C; last.endS=last.S; last.endE=last.E; last.endF=last.F;
                last.endP=last.P; last.endH=last.H; last.endT=last.T; last.endD=last.D;
                last.deltaC=0; last.deltaS=0; last.deltaE=0; last.deltaF=0;
                last.deltaP=0; last.deltaH=0; last.deltaT=0; last.deltaD=0;
            }

            // Append to global byTrack array for this stem (slices from all source tracks)
            for (var i = 0; i < sub.length; i++) {
                byTrack[track].push(sub[i]);
                idx.push(sub[i]);
            }

            post("EBYS Slicer [" + track + "/" + sourceName + " slot=" + slot + "]: "
                 + sub.length + " slices  BPM=" + effectiveBPMForSource(sourceName).toFixed(1)
                 + "  stemDurMs=" + (durMs/1000).toFixed(2) + "s\n");
        }
    }

    // ── 4. Cap slice counts, compute ranges ──────────────────────────────────────
    for (var t = 0; t < TRACKS.length; t++) {
        var track = TRACKS[t];
        var arr   = byTrack[track];

        if (MAX_SLICES_PER_STEM > 0 && arr.length > MAX_SLICES_PER_STEM) {
            // Downbeat-split slices (added above, tagged `synthetic: true`)
            // exist specifically so a real slice boundary lands on every
            // measured downbeat — plain evenly-spaced index sampling below
            // has no awareness of that and would happily discard them along
            // with everything else, silently undoing the whole point of
            // splitting. Keep every synthetic slice unconditionally and only
            // downsample from the rest to fill whatever budget remains. If
            // synthetic slices alone somehow exceed MAX_SLICES_PER_STEM
            // (a very long/fast track with more downbeats than the cap),
            // the cap goes soft rather than dropping downbeat alignment —
            // an edge case, but alignment correctness matters more here
            // than exact adherence to an auto-scaled slice budget.
            var synthetic = [], natural = [];
            for (var ai = 0; ai < arr.length; ai++) {
                (arr[ai].synthetic ? synthetic : natural).push(arr[ai]);
            }
            var naturalBudget = Math.max(0, MAX_SLICES_PER_STEM - synthetic.length);
            var sampled;
            if (naturalBudget >= natural.length) {
                sampled = arr; // nothing to trim once synthetic slices are set aside
            } else {
                var step = natural.length / naturalBudget;
                var pickedNatural = [];
                for (var si = 0; si < naturalBudget; si++) pickedNatural.push(natural[Math.round(si * step)]);
                // Merge back in time order — both sub-lists are already
                // time-ordered, so this restores the original interleaving.
                sampled = pickedNatural.concat(synthetic).sort(function(a, b) { return a.time - b.time; });
            }
            // Recompute .dur for the downsampled array. .dur was set above as
            // "gap to the very next slice in the FULL, pre-downsample array"
            // (sub[i].dur = sub[i+1].time - sub[i].time). After downsampling,
            // consecutive elements of `sampled` are `step` apart, not 1 apart —
            // the old .dur is stale and far too small. selectSegment()'s
            // accumulation loop (totalFrac += arr[i].dur, once per slice until
            // targetMs is covered) sums these per-slice values, so with the
            // stale small numbers it exhausts the whole same-source-track run
            // roughly `step`× sooner than the real audio would allow — this is
            // the direct cause of segments coming out shorter than
            // SEGMENT_BARS even when the source file clearly has more tape
            // left. Recompute against the new neighbor so .dur means what the
            // accumulation loop assumes it means.
            for (var si = 0; si < sampled.length; si++) {
                if (si + 1 < sampled.length && sampled[si + 1].sourceTrack === sampled[si].sourceTrack) {
                    sampled[si].dur = sampled[si + 1].time - sampled[si].time;
                } else {
                    // Last sampled slice of this source track's run — same
                    // fallback the un-downsampled path uses for a true last slice.
                    sampled[si].dur = LAST_SLICE_DEFAULT_DUR;
                }
            }
            byTrack[track] = arr = sampled;
        }

        if (arr.length === 0) { ranges[track] = {}; continue; }

        var rC={min:Infinity,max:-Infinity}, rS={min:Infinity,max:-Infinity};
        var rP={min:Infinity,max:-Infinity};
        var rE={min:Infinity,max:-Infinity}, rF={min:Infinity,max:-Infinity};
        var rH={min:Infinity,max:-Infinity}, rT={min:Infinity,max:-Infinity};
        var rD={min:Infinity,max:-Infinity};
        var rDur={min:Infinity,max:-Infinity};
        for (var i = 0; i < arr.length; i++) {
            var s = arr[i];
            if (s.C<rC.min)rC.min=s.C; if(s.C>rC.max)rC.max=s.C;
            if (s.S<rS.min)rS.min=s.S; if(s.S>rS.max)rS.max=s.S;
            if (s.P<rP.min)rP.min=s.P; if(s.P>rP.max)rP.max=s.P;
            if (s.E<rE.min)rE.min=s.E; if(s.E>rE.max)rE.max=s.E;
            if (s.F<rF.min)rF.min=s.F; if(s.F>rF.max)rF.max=s.F;
            if (s.H<rH.min)rH.min=s.H; if(s.H>rH.max)rH.max=s.H;
            if (s.T<rT.min)rT.min=s.T; if(s.T>rT.max)rT.max=s.T;
            if (s.D<rD.min)rD.min=s.D; if(s.D>rD.max)rD.max=s.D;
            if (s.dur<rDur.min)rDur.min=s.dur; if(s.dur>rDur.max)rDur.max=s.dur;
        }
        ranges[track] = { C:rC, S:rS, P:rP, E:rE, F:rF, H:rH, T:rT, D:rD, dur:rDur };

        if (rC.max > rC.min) norm.C = Math.max(norm.C, rC.max - rC.min);
        if (rS.max > rS.min) norm.S = Math.max(norm.S, rS.max - rS.min);
        if (rE.max > rE.min) norm.E = Math.max(norm.E, rE.max - rE.min);
        if (rF.max > rF.min) norm.F = Math.max(norm.F, rF.max - rF.min);
        if (rP.max > rP.min) norm.P = Math.max(norm.P, rP.max - rP.min);
        if (rH.max > rH.min) norm.H = Math.max(norm.H, rH.max - rH.min);
        if (rT.max > rT.min) norm.T = Math.max(norm.T, rT.max - rT.min);
        if (rD.max > rD.min) norm.D = Math.max(norm.D, rD.max - rD.min);
    }

    post("EBYS Slicer: index ready — " + idx.length + " total slices\n");
    outlet(1, "ready", idx.length);
    var nV = byTrack.vocals ? byTrack.vocals.length : 0;
    var nM = byTrack.melody ? byTrack.melody.length : 0;
    var nB = byTrack.bass   ? byTrack.bass.length   : 0;
    var nD = byTrack.drums  ? byTrack.drums.length  : 0;
    outlet(1, "slices", nV, nM, nB, nD);
    post("EBYS Slicer: slices — vocals=" + nV + " melody=" + nM + " bass=" + nB + " drums=" + nD + "\n");
    // Emit source track names and their slots
    for (var si = 0; si < sourceNames.length; si++) {
        outlet(1, "sourceTrack", si, sourceNames[si]);
        post("EBYS Slicer: sourceTrack " + si + " = " + sourceNames[si] + "\n");
    }
    // Ask Max to resend stem durations — stemDurMs resets on every autowatch reload
    outlet(1, "need_stemDurs");
    // Load downbeat data from allin1_tagger.py output (if present)
    loadDownbeats();
    // Load any learned-bias model fit so far by train_bias.py (if present)
    loadLearnedBias();
    // Persist index to JSON so it survives patch reloads
    saveIndex();
    // UMAP/t-SNE is handled by ws_server.js (Node) after index load — no call needed here.
}

// ── INDEX PERSISTENCE — delegated to ws_server.js (Node) ─────────────────────
// Max's File API cannot reliably open files by absolute path. All index I/O
// goes through ws_server.js which uses Node's fs module (no restrictions).
//
// SAVE: after buildIndex(), slicer sends JSON in 2 KB chunks via
//   outlet(1, "saveIdxChunk", i, total, data)
//   ws_server accumulates and writes ebys_index.json to MAX/.
//
// LOAD: ws_server reads ebys_index.json on startup and sends it to slicer
//   via idxchunk messages before the TUI connects — index is ready immediately.
//   buildIndex (triggered by TUI) overwrites this with fresh data.

var saveIdxStreamId = 0;  // increments with each saveIndex() call

function saveIndex() {
    var payload = { meta: meta, byTrack: byTrack, ranges: ranges };
    var jsonStr = JSON.stringify(payload);
    var CHUNK   = 2048;
    var total   = Math.ceil(jsonStr.length / CHUNK);
    var sid     = ++saveIdxStreamId;
    for (var i = 0; i < total; i++) {
        outlet(1, "saveIdxChunk", sid, i, total, jsonStr.substring(i * CHUNK, (i + 1) * CHUNK));
    }
    post("EBYS Slicer: index sent to ws_server (stream " + sid + ", " + total + " chunks, " + jsonStr.length + " chars)\n");
}

var idxChunkBuf      = null;
var idxChunkTotal    = 0;
var idxChunkReceived = 0;
var idxChunkSid      = -1;

function idxchunk() {
    var args = arrayfromargs(arguments);
    var sid  = parseInt(args[0]);
    var i    = parseInt(args[1]);
    var t    = parseInt(args[2]);
    var data = args.slice(3).join(' ');
    if (!idxChunkBuf || idxChunkSid !== sid) {
        if (idxChunkBuf) {
            post("EBYS Slicer: idxchunk stream reset (was " + idxChunkSid
                 + ", now " + sid + ") — " + idxChunkReceived + "/" + idxChunkTotal + " chunks dropped\n");
        }
        idxChunkBuf      = new Array(t);
        idxChunkTotal    = t;
        idxChunkSid      = sid;
        idxChunkReceived = 0;
    }
    if (idxChunkBuf[i] !== undefined) return; // duplicate
    idxChunkBuf[i] = data;
    idxChunkReceived++;
    if (idxChunkReceived !== t) return;

    var assembled = idxChunkBuf.join('');
    idxChunkBuf = null;
    try {
        var payload = JSON.parse(assembled);
        meta    = payload.meta    || {};
        ranges  = payload.ranges  || {};
        byTrack = payload.byTrack || {};
        idx = [];
        for (var tr = 0; tr < TRACKS.length; tr++) {
            var arr = byTrack[TRACKS[tr]] || [];
            for (var j = 0; j < arr.length; j++) idx.push(arr[j]);
        }
        for (var tr = 0; tr < TRACKS.length; tr++) {
            var r = ranges[TRACKS[tr]];
            if (!r) continue;
            if (r.C && r.C.max > r.C.min) norm.C = Math.max(norm.C, r.C.max - r.C.min);
            if (r.S && r.S.max > r.S.min) norm.S = Math.max(norm.S, r.S.max - r.S.min);
            if (r.E && r.E.max > r.E.min) norm.E = Math.max(norm.E, r.E.max - r.E.min);
            if (r.F && r.F.max > r.F.min) norm.F = Math.max(norm.F, r.F.max - r.F.min);
            if (r.P && r.P.max > r.P.min) norm.P = Math.max(norm.P, r.P.max - r.P.min);
            if (r.H && r.H.max > r.H.min) norm.H = Math.max(norm.H, r.H.max - r.H.min);
            if (r.T && r.T.max > r.T.min) norm.T = Math.max(norm.T, r.T.max - r.T.min);
            if (r.D && r.D.max > r.D.min) norm.D = Math.max(norm.D, r.D.max - r.D.min);
        }
        post("EBYS Slicer: loaded " + idx.length + " slices from cached index\n");
        loadDownbeats();
        loadLearnedBias();
        outlet(1, "ready", idx.length);
        var rawName   = (meta["vocals"] && meta["vocals"].track_name) ? meta["vocals"].track_name : "";
        var trackName = rawName.replace(/_(vocals|melody|bass|drums|melo)(\.\w+)?$/i, "").trim();
        if (trackName) outlet(1, "track_name", trackName);
        outlet(1, "need_stemDurs");
    } catch(e) {
        post("EBYS Slicer: cached index parse failed — " + e + "\n");
    }
}

// ── CANDIDATE SCORING ────────────────────────────────────────────────────────
// Lower score = better candidate.
//
// Two independent criteria:
//   1. TRANSITION MATCH — how closely does candidate.start match current.end?
//      Weighted by MATCH_PROB per descriptor (0=ignore, 1=strict).
//   2. DIRECTION PREFERENCE — does the candidate evolve the way Cricket wants?
//      Weighted by DIR_PREF per descriptor (-1=down, 0=neutral, +1=up).
//
// When both MATCH_PROB and DIR_PREF are all zero the score is always 0
// and the caller falls back to random / descriptor distance as before.

// track selects which stem's MATCH_PROB/DIR_PREF/DIR_WEIGHT to score against —
// every caller already has track in scope (selectSegment/loop/nextNearest),
// so this stays a single extra argument rather than a global lookup.
function scoreCandidate(candidate, endDesc, track) {
    var mp = MATCH_PROB[track];
    var dp = DIR_PREF[track];
    var dw = DIR_WEIGHT[track];
    if (mp === undefined) mp = 0;
    if (!dp) dp = defaultDirPref();
    if (dw === undefined) dw = 1.0;

    var score = 0;
    var dims  = ['C', 'S', 'E', 'F', 'P', 'H', 'T', 'D'];
    for (var i = 0; i < dims.length; i++) {
        var d = dims[i];

        // 1. Transition match
        if (mp > 0 && endDesc) {
            var val = (d === 'T') ? (candidate.T || 0) : candidate[d];
            var ref = (d === 'T') ? (endDesc.T  || 0) : endDesc[d];
            var diff = (val - ref) / (norm[d] || 1);
            score += mp * diff * diff;
        }

        // 2. Direction preference
        // delta > 0 means this slice is evolving upward in descriptor d.
        // DIR_PREF[d] = 1 → want rising → reward high delta → subtract from score.
        if (dp[d] !== 0) {
            var delta = (candidate['delta' + d] || 0) / (norm[d] || 1);
            score -= dp[d] * delta * dw;
        }
    }

    // 3. Learned bias (train_bias.py, from :score/:scoreTransition history) —
    // both predict on a -1..1 "how good" scale like MATCH_PROB/DIR_PREF's
    // inputs, so subtracting (higher predicted quality → lower/better score)
    // matches the same convention as the direction-preference term above.
    // No-ops cleanly if a model hasn't been trained yet (TRANSITION_BIAS/
    // VERTICAL_BIAS null) or its weight is dialed to 0 for this stem.
    var ltw = LEARNED_TRANS_WEIGHT[track]; if (ltw === undefined) ltw = 1.0;
    var lvw = LEARNED_VERT_WEIGHT[track];  if (lvw === undefined) lvw = 1.0;
    if (TRANSITION_BIAS && ltw > 0) {
        var tq = predictTransitionQuality(candidate, endDesc);
        if (tq !== null) score -= tq * ltw;
    }
    if (VERTICAL_BIAS && lvw > 0) {
        var vq = predictVerticalQuality(candidate, track);
        if (vq !== null) score -= vq * lvw;
    }

    return score;
}

function hasActiveCriteria(track) {
    var mp  = MATCH_PROB[track] || 0;
    var dp  = DIR_PREF[track] || defaultDirPref();
    var ltw = LEARNED_TRANS_WEIGHT[track]; if (ltw === undefined) ltw = 1.0;
    var lvw = LEARNED_VERT_WEIGHT[track];  if (lvw === undefined) lvw = 1.0;
    return (mp > 0 ||
            dp.C !== 0 || dp.S !== 0 || dp.E !== 0 || dp.F !== 0 || dp.P !== 0 ||
            dp.H !== 0 || dp.T !== 0 || dp.D !== 0 ||
            (TRANSITION_BIAS && ltw > 0) ||
            (VERTICAL_BIAS   && lvw > 0));
}

// ── DOWNBEAT HELPERS ──────────────────────────────────────────────────────────

// loadDownbeats — reads ../downbeats.json and populates trackDownbeats for all stems.
// Called at the end of buildIndex() and loadIndex(), and via "reloadDownbeats" message.
function getPatcherDir() {
    var fp = patcher.filepath || "";
    var slash = fp.indexOf('/');
    if (slash > 0) fp = fp.slice(slash);
    fp = fp.replace(/[^\/\\]+$/, '');
    if (fp.length > 0 && fp[fp.length-1] !== '/') fp += '/';
    return fp;
}

// Returns the data/ directory (EBYS/data/) relative to the patch location.
// Patch lives at EBYS/src/max/ → strip max/ → strip src/ → append data/
function getDataDir() {
    var p = getPatcherDir();         // .../EBYS/src/max/
    p = p.replace(/[^\/]+\/$/, ''); // strip max/ → .../EBYS/src/
    p = p.replace(/[^\/]+\/$/, ''); // strip src/ → .../EBYS/
    // Session-scoped via the data/current symlink — the downbeats.json fallback
    // read here would otherwise hit the old global data/ (files now live under
    // data/sessions/<id>/). The primary downbeats path is the ws_server chunk
    // stream, which is already session-aware; this just keeps the fallback right.
    return p + 'data/current/';
}

function loadDownbeats() {
    trackDownbeats = {};
    try {
        // Use data received via downbeatchunk from ws_server (preferred — Node resolves paths).
        // Falls back to direct file read if chunks haven't arrived yet.
        var db = downbeatsRaw;
        if (!db) {
            var f = new File(getDataDir() + "downbeats.json", "read", "TEXT");
            if (!f.isopen) {
                post("EBYS Slicer: loadDownbeats — could not open " + getDataDir()
                     + "downbeats.json (no downbeatsRaw cached yet either) — no downbeat data available\n");
                return;
            }
            var raw = "";
            while (!f.eof) raw += f.readline();
            f.close();
            db = JSON.parse(raw);
        }

        // Collect unique source track names from the loaded slices.
        var sourceTrackNames = [];
        var seen = {};
        for (var t = 0; t < TRACKS.length; t++) {
            var arr = byTrack[TRACKS[t]] || [];
            for (var j = 0; j < arr.length; j++) {
                var sn = arr[j].sourceTrack;
                if (sn && !seen[sn]) { seen[sn] = true; sourceTrackNames.push(sn); }
            }
        }

        if (sourceTrackNames.length === 0) {
            post("EBYS Slicer: loadDownbeats — no source tracks in index yet\n");
            outlet(1, "sysMsg", "✗ downbeats: no source tracks in index yet — run :buildIndex first");
            return;
        }

        // For each source track, look up its entry in downbeats.json.
        var loaded = 0;
        for (var si = 0; si < sourceTrackNames.length; si++) {
            var name  = sourceTrackNames[si];
            var entry = db[name];
            if (!entry) {
                // Case-insensitive fallback
                var nl = name.toLowerCase();
                for (var k in db) {
                    if (k.toLowerCase() === nl) { entry = db[k]; break; }
                }
            }
            if (!entry) {
                post("EBYS Slicer: loadDownbeats — no entry for '" + name + "'\n");
                continue;
            }
            trackDownbeats[name] = entry;
            loaded++;
            var beatCount = entry.downbeats_ms ? entry.downbeats_ms.length : 0;
            post("EBYS Slicer: downbeats loaded — track='" + name
                 + "'  meter=" + entry.meter
                 + "  bpm=" + entry.bpm
                 + "  downbeats=" + beatCount
                 + "  conf=" + entry.confidence + "\n");
            // Mirror to the TUI (via ws_server's generic 'sys' broadcast — see
            // its sysMsg handler) so a manual :reloadDownbeats has visible
            // proof it actually found real data, not just a Max-console line
            // nobody's watching.
            outlet(1, "sysMsg", "✓ downbeats: '" + name + "' conf="
                   + entry.confidence.toFixed(3) + " (" + beatCount + " beats)");
        }

        if (loaded === 0) {
            post("EBYS Slicer: loadDownbeats — no matching entries in downbeats.json\n");
            outlet(1, "sysMsg", "✗ downbeats: no matching entries found — check downbeats.json / re-run madmom_tagger.py");
        } else {
            outlet(1, "sysMsg", "downbeats reloaded: " + loaded + "/" + sourceTrackNames.length + " track(s)");
        }

    } catch(e) {
        post("EBYS Slicer: loadDownbeats error — " + e + "\n");
        outlet(1, "sysMsg", "✗ downbeats reload failed — " + e);
    }
}


// getDbForSource — returns the downbeat entry for a source track name.
// For named tracks, returns null if not found (caller must handle gracefully).
// Passing no sourceTrack (undefined/null) is allowed for single-track sessions
// and returns the first available entry — never cross-contaminates named tracks.
function getDbForSource(sourceTrack) {
    if (sourceTrack) {
        if (trackDownbeats[sourceTrack]) return trackDownbeats[sourceTrack];
        post("EBYS Slicer: WARNING — no downbeat data for '" + sourceTrack
             + "' — BPM grid fallback (run madmom_tagger.py)\n");
        return null;
    }
    // No sourceTrack specified — single-track context, return whatever is available.
    for (var k in trackDownbeats) return trackDownbeats[k];
    return null;
}

// getBarMs — average bar duration in ms for this source track.
// Uses madmom avgBarMs when confidence is high enough; falls back to BPM grid.
// sourceTrack is optional — omit for non-slice contexts (uses first available entry).
function getBarMs(track, bpm, sourceTrack) {
    var db = getDbForSource(sourceTrack);
    if (db && db.confidence >= DOWNBEAT_MIN_CONF && db.avgBarMs > 0) {
        return db.avgBarMs;
    }
    // BPM fallback — assume 4/4 (or use meter if stored)
    var meter = (db && db.meter > 0) ? db.meter : 4;
    return (60000.0 / bpm) * meter;
}

// isNearDownbeat — true if posMs is within toleranceMs of any stored downbeat.
// sourceTrack is optional — pass slice.sourceTrack for per-track accuracy.
// toleranceMs is optional — defaults to BAR_SNAP_MS; selectSegment() widens it
// in steps rather than abandoning alignment outright when too few slices qualify.
// Falls back to posMs % barMs < toleranceMs when no confident downbeats available.
function isNearDownbeat(posMs, track, barMs, sourceTrack, toleranceMs) {
    var tol = (toleranceMs > 0) ? toleranceMs : BAR_SNAP_MS;
    var db = getDbForSource(sourceTrack);
    if (db && db.confidence >= DOWNBEAT_MIN_CONF && db.downbeats_ms && db.downbeats_ms.length > 1) {
        var beats = db.downbeats_ms;
        for (var i = 0; i < beats.length; i++) {
            if (Math.abs(posMs - beats[i]) <= tol) return true;
        }
        return false;
    }
    // BPM grid fallback
    var offset = posMs % barMs;
    return offset < tol || (barMs - offset) < tol;
}

// nextDownbeatFrac — walks forward exactly `bars` REAL measured downbeats from
// fromMs on sourceTrack's own downbeat timeline and returns the resulting
// fraction of the file, or null if this track has no confident downbeat data
// or there aren't `bars` more downbeats left from fromMs.
//
// Why this exists: buildIndex() splits a slice at every measured downbeat for
// confident-downbeat tracks specifically so a real slice boundary exists at
// every downbeat. But the segment-length math elsewhere (SEGMENT_BARS × bar
// length at GLOBAL_BPM, using a single averaged srcBpm for the stretch ratio)
// assumes the source plays at a perfectly constant tempo. Real recordings
// never do — madmom's BPM is an average, not the literal spacing of every
// bar — so walking forward mathematically from that average almost never
// lands on the exact real downbeat timestamp N bars later; it lands a little
// before or after it. Landing "a little after" is where the audible skip
// came from: STAY's forward search then jumps to the next real slice
// boundary past that point, silently dropping the content in between, while
// the progress bar (driven by the same math-derived duration) has no idea
// any of that happened. Reading the REAL downbeat timestamp instead — rather
// than assuming one — guarantees the returned frac IS an existing slice
// boundary, by construction, every time.
function nextDownbeatFrac(sourceTrack, fromMs, bars, durMs) {
    var db = getDbForSource(sourceTrack);
    if (!db || db.confidence < DOWNBEAT_MIN_CONF
        || !db.downbeats_ms || db.downbeats_ms.length < 2 || durMs <= 0 || bars <= 0) {
        return null;
    }
    var beats = db.downbeats_ms;
    // Find the downbeat at/just after fromMs. Small epsilon absorbs float
    // rounding from the frac↔ms round trip (startSlice.time was itself
    // derived from a downbeat ms value divided by durMs on a prior cycle).
    var startI = -1;
    for (var i = 0; i < beats.length; i++) {
        if (beats[i] >= fromMs - 2) { startI = i; break; }
    }
    if (startI < 0) return null; // fromMs is past the last known downbeat
    var targetI = startI + bars;
    if (targetI >= beats.length) return null; // not enough downbeats left from here
    return beats[targetI] / durMs;
}

// hasSliceBoundaryAt — verifies a slice with this exact .time actually exists
// in `arr` for `sourceTrack`, before selectSegment() trusts a nextDownbeatFrac()
// result as a STAY-continuation anchor. buildIndex() is now written to
// guarantee this (leading/trailing gap-filling added alongside the in-span
// split), so in normal operation this should always find a match — this is
// a defense-in-depth backstop, not the primary fix, for anything buildIndex()
// didn't anticipate (a stale/partially-reloaded index, a future edge case,
// etc.). Trusting an unverified timestamp here is exactly the class of bug
// this whole feature exists to close, so it isn't skipped just because the
// common case is expected to always pass.
function hasSliceBoundaryAt(arr, sourceTrack, frac, durMs) {
    var tol = durMs > 0 ? (2 / durMs) : 1e-6; // ~2ms tolerance
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].sourceTrack === sourceTrack && Math.abs(arr[i].time - frac) < tol) {
            return true;
        }
    }
    return false;
}

// ── SEGMENT SELECTION ─────────────────────────────────────────────────────────
//
// How bar-alignment works (madmom mode):
//   When downbeats.json has a confident entry, isNearDownbeat() checks proximity
//   to actual detected downbeat timestamps — works for any meter, any tempo,
//   any phase offset, and electroacoustic music with drifting tempo.
//
// Fallback (BPM grid):
//   bar_ms = 60000 / BPM * meter  — assumes bar1 = t0, fixed grid.
//   Used when confidence < DOWNBEAT_MIN_CONF or no downbeats.json present.
//
// Why this matters musically:
//   Random cuts that begin mid-bar sound like edits; cuts on beat 1 of a bar
//   feel intentional and maintain the rhythmic pulse across all 4 stems.
//
function selectSegment(track) {
    var arr = (track && byTrack[track]) ? byTrack[track] : null;
    if (!arr || arr.length === 0) {
        outlet(1, "empty_pool", track || "?");
        return;
    }

    // Effective BPM for this track — use first slice's sourceTrack for madmom BPM.
    // This is a best-effort value for pool building; barMs is recomputed per-startSlice
    // after selection so the actual segment duration is always correct.
    var firstSrc = arr.length > 0 ? arr[0].sourceTrack : null;
    var bpm      = effectiveBPMForSource(firstSrc);
    var barMs    = getBarMs(track, bpm, firstSrc);
    var targetMs = barMs * SEGMENT_BARS[track];

    // Convert fractions to ms using known stem duration.
    // With multi-track, each slice carries its own stemDurMs from the library.
    // The global stemDurMs[track] is used as a fallback only.
    // Pool building uses per-slice stemDurMs so bar-alignment works across different
    // source tracks that may have different durations.
    var hasDur = false;
    for (var i = 0; i < arr.length; i++) {
        if ((arr[i].stemDurMs || 0) > 0) { hasDur = true; break; }
    }
    if (!hasDur && stemDurMs[track] > 0) hasDur = true;

    // fileStartTime — earliest .time seen for each sourceTrack in this pool.
    // Used by full-file mode below to recognize "this candidate IS the start
    // of its file" (as opposed to some arbitrary point mid-file or near its
    // end). Needed because PLAY_FULL_FILE bypasses hasEnoughRemaining's normal
    // tape-remaining check entirely (there's no fixed target to fall short
    // of) — but that also means, unfiltered, a "fresh" (non-STAY) pick could
    // land on a slice one tick from the end of some file, immediately produce
    // a near-zero-length segment, retrigger selection, land near the end of
    // another file, etc. That churn is exactly the "looping so much, stuck on
    // one slice" symptom reported after full-file-by-default shipped.
    var fileStartTime = {};
    for (var i = 0; i < arr.length; i++) {
        var st = arr[i].sourceTrack;
        if (fileStartTime[st] === undefined || arr[i].time < fileStartTime[st]) {
            fileStartTime[st] = arr[i].time;
        }
    }

    // hasEnoughRemaining — does this candidate have enough tape left in ITS OWN
    // source track to actually satisfy SEGMENT_BARS[track]? Picking a start
    // point near the end of a source track's buffer, then trying to accumulate
    // N bars of segment from there, is exactly what was truncating segments
    // short regardless of setSegmentBars — the loop that accumulates duration
    // (below) just runs out of same-source-track slices and stops early.
    // Checked here, at candidate-selection time, so a bad start point is never
    // chosen in the first place. remainingMs is undefined on old cached index
    // entries (predating this field) — don't block selection on missing data.
    function hasEnoughRemaining(candidate) {
        // In full-file mode there's no fixed SEGMENT_BARS target to satisfy,
        // so the usual remaining-tape check doesn't apply — but a FRESH pick
        // still needs to land exactly at the start of its source track,
        // otherwise "play the whole file" actually plays whatever fraction
        // was left from a random mid-file point, which is often short. Only
        // the earliest slice of a source track passes here; STAY-continuation
        // (which walks forward from the current position, and wraps to this
        // same start-of-file slice once it reaches the end) is unaffected —
        // it never consults this filter.
        if (PLAY_FULL_FILE[track]) {
            return candidate.time <= fileStartTime[candidate.sourceTrack] + 1e-9;
        }
        if (candidate.remainingMs === undefined) return true;
        var candBpm    = effectiveBPMForSource(candidate.sourceTrack);
        var candBarMs  = getBarMs(track, candBpm, candidate.sourceTrack);
        var candTarget = candBarMs * SEGMENT_BARS[track];
        return candidate.remainingMs >= candTarget;
    }

    // Build candidate pool (bar-aligned or full).
    // Tightened alignment: instead of dropping the downbeat requirement outright
    // when too few candidates qualify at BAR_SNAP_MS, widen the tolerance in
    // steps (still genuinely bar-aligned, just less strict about exact ms) and
    // only fall through to a fully unaligned pool as an absolute last resort —
    // logged, so an off-grid start is never silent.
    var pool = null;
    if (QUANTIZE_BARS && hasDur) {
        var buildAlignedPool = function(toleranceMs, requireRemaining) {
            var out = [];
            for (var i = 0; i < arr.length; i++) {
                if (!sliceMatchesGenre(arr[i])) continue;
                if (!sliceMatchesKey(arr[i])) continue;
                if (requireRemaining && !hasEnoughRemaining(arr[i])) continue;
                var sliceDurMs = arr[i].stemDurMs || stemDurMs[track] || 0;
                if (sliceDurMs <= 0) { out.push(i); continue; }
                var posMs = arr[i].time * sliceDurMs;
                if (isNearDownbeat(posMs, track, barMs, arr[i].sourceTrack, toleranceMs)) out.push(i);
            }
            return out;
        };
        var aligned = buildAlignedPool(BAR_SNAP_MS, true);
        var RELAX_STEPS = [2, 4, 8]; // successive ×BAR_SNAP_MS widenings
        for (var ri = 0; aligned.length < 1 && ri < RELAX_STEPS.length; ri++) {
            aligned = buildAlignedPool(BAR_SNAP_MS * RELAX_STEPS[ri], true);
            if (aligned.length >= 1) {
                post("EBYS Slicer [" + track + "]: downbeat tolerance widened to "
                     + (BAR_SNAP_MS * RELAX_STEPS[ri]) + "ms — " + aligned.length + " candidate(s)\n");
            }
        }
        // Still nothing with enough remaining tape at any tolerance — SEGMENT_BARS
        // may just be larger than any available slice can satisfy. Drop the
        // remaining-duration requirement (segment will run short) but log it,
        // rather than silently starting off-grid AND short with no explanation.
        if (aligned.length < 1) {
            aligned = buildAlignedPool(BAR_SNAP_MS * RELAX_STEPS[RELAX_STEPS.length - 1], false);
            if (aligned.length >= 1) {
                post("EBYS Slicer [" + track + "]: no slice has enough remaining audio for "
                     + SEGMENT_BARS[track] + " bars — segment will run shorter than requested\n");
            }
        }
        if (aligned.length >= 1) pool = aligned;
    }
    if (!pool) {
        pool = [];
        for (var i = 0; i < arr.length; i++) {
            if (sliceMatchesGenre(arr[i]) && sliceMatchesKey(arr[i]) && hasEnoughRemaining(arr[i])) pool.push(i);
        }
        if (pool.length === 0) {
            for (var i = 0; i < arr.length; i++) {
                if (sliceMatchesGenre(arr[i]) && sliceMatchesKey(arr[i])) pool.push(i);
            }
            if (pool.length > 0) {
                post("EBYS Slicer [" + track + "]: no slice has enough remaining audio for "
                     + SEGMENT_BARS[track] + " bars — segment will run shorter than requested\n");
            }
        }
        // If combined filter returns nothing, fall back to all slices
        if (pool.length === 0) {
            for (var i = 0; i < arr.length; i++) pool.push(i);
            post("EBYS Slicer [" + track + "]: genre/key filter matched 0 slices — ignoring filter\n");
        }
        if (QUANTIZE_BARS && hasDur) {
            post("EBYS Slicer [" + track + "]: no downbeat-aligned slice found even at widest tolerance — starting off-grid\n");
        }
    }

    // ── Source track selection ────────────────────────────────────────────────
    // Hard pin: stemSourceFilter overrides everything (set via :setStemSource).
    // Probabilistic: when pool spans multiple source tracks, weight each track
    //   by BPM match and cross-stem cohesion, then sample once.
    //   BPM fitness  = (min/max BPM ratio)²    → 1 when exact match
    //   Cohesion     = fraction of other stems currently on that track
    // At startup (all null) cohesion is 0 for all tracks → BPM is the tiebreaker.
    // As stems settle, cohesion pulls remaining stems toward the majority track.
    if (stemSourceFilter[track]) {
        var sf     = stemSourceFilter[track].toLowerCase();
        var pinned = [];
        for (var pi = 0; pi < pool.length; pi++) {
            if (arr[pool[pi]].sourceTrack.toLowerCase().indexOf(sf) !== -1) pinned.push(pool[pi]);
        }
        if (pinned.length >= 1) {
            pool = pinned;
        } else {
            post("EBYS Slicer [" + track + "]: stemSource filter '" + stemSourceFilter[track]
                 + "' matched 0 slices — ignoring pin\n");
        }
    } else if (sourceLock[track]) {
        // Source lock: follow the same source track as the leader stem.
        var lockLeader = sourceLock[track];
        var lockSrc    = lastSourceTrack[lockLeader];
        if (lockSrc) {
            var locked = [];
            for (var pi = 0; pi < pool.length; pi++) {
                if (arr[pool[pi]].sourceTrack === lockSrc) locked.push(pool[pi]);
            }
            if (locked.length >= 1) {
                pool = locked;
            } else {
                post("EBYS Slicer [" + track + "]: sourceLock → '" + lockSrc + "' matched 0 slices — ignoring\n");
            }
        }
    } else {
        // Build per-source-track groups from the current pool.
        var srcGroups  = {};
        for (var pi = 0; pi < pool.length; pi++) {
            var pst = arr[pool[pi]].sourceTrack || '';
            if (!srcGroups[pst]) srcGroups[pst] = [];
            srcGroups[pst].push(pool[pi]);
        }
        var srcTracks = [];
        for (var sk in srcGroups) { if (srcGroups.hasOwnProperty(sk)) srcTracks.push(sk); }

        if (srcTracks.length > 1) {
            var tgtBpm     = GLOBAL_BPM || 120;
            var scoreTotal = 0;
            var tScores    = [];
            for (var ti = 0; ti < srcTracks.length; ti++) {
                var tn     = srcTracks[ti];
                var tnBpm  = effectiveBPMForSource(tn) || tgtBpm;
                // BPM fitness [0–1]: peaks at 1 when tempos match exactly.
                var bpmR   = Math.min(tnBpm, tgtBpm) / Math.max(tnBpm, tgtBpm);
                var bpmFit = bpmR * bpmR;
                // Cohesion: fraction of other stems already on this track [0–1].
                var cohCnt = 0;
                for (var si = 0; si < TRACKS.length; si++) {
                    if (TRACKS[si] !== track && lastSourceTrack[TRACKS[si]] === tn) cohCnt++;
                }
                var cohFit = cohCnt / Math.max(1, TRACKS.length - 1);
                // Key fitness: average Camelot-wheel compatibility between this
                // candidate track's key and whatever the OTHER stems are
                // currently playing (mirrors the cohesion loop above, just for
                // harmonic compatibility instead of exact track match). No
                // other stems playing yet → neutral 0.5, same as an unknown key.
                var tnKey    = trackKey(tn);
                var keySum   = 0, keyCnt = 0;
                for (var ski = 0; ski < TRACKS.length; ski++) {
                    if (TRACKS[ski] === track) continue;
                    var otherKey = trackKey(lastSourceTrack[TRACKS[ski]]);
                    if (otherKey) { keySum += keyCompatibility(tnKey, otherKey); keyCnt++; }
                }
                var keyFit = keyCnt > 0 ? (keySum / keyCnt) : 0.5;
                var score  = SRC_BPM_WEIGHT * bpmFit + SRC_COHESION_WEIGHT * cohFit + SRC_KEY_WEIGHT * keyFit;
                tScores.push(score);
                scoreTotal += score;
            }
            // Weighted random pick.  If all scores are 0 (everything null at start),
            // scoreTotal==0 → uniform fallback.
            var chosen = srcTracks[Math.floor(Math.random() * srcTracks.length)];
            if (scoreTotal > 0) {
                var rv  = Math.random() * scoreTotal;
                var cum = 0;
                for (var ti = 0; ti < srcTracks.length; ti++) {
                    cum += tScores[ti];
                    if (rv <= cum) { chosen = srcTracks[ti]; break; }
                }
            }
            pool = srcGroups[chosen];
        }
    }

    // Stay-or-move decision
    var startIdx;
    if (STAY_PROB[track] > 0 && Math.random() < STAY_PROB[track]
        && lastSourceTrack[track] !== null && lastEndFrac[track] >= 0) {
        // Stay on the same source track — advance to the first slice that
        // starts AT or AFTER where the last segment ended (forward progression).
        // If we've run off the end of the track, wrap back to the beginning.
        //
        // This search stays ">=" rather than "===" for source tracks without
        // confident downbeat data (BPM-grid fallback — buildIndex()'s
        // downbeat-split only runs where real measured downbeats exist to
        // split on), where a bar-exact stop point genuinely can land between
        // two slices with no exact boundary to match. For a track WITH
        // confident downbeat data, buildIndex() splits a slice at every
        // measured downbeat specifically so this always resolves to an exact
        // "at" match — see the "Downbeat-aligned slice splitting" comment
        // there. ">=" is kept here as the search condition either way since
        // it's a strict superset: an exact match satisfies it too.
        //
        // Search the FULL `arr` here, not `pool` — pool was already filtered
        // by hasEnoughRemaining (does a candidate have a full SEGMENT_BARS of
        // tape left from that point?), which is the right check for picking a
        // fresh NEW starting point, but wrong for continuing one: it excludes
        // every slice in the tail of a track (anything with less than a full
        // segment left), so as playback approached the end of a source track
        // there were eventually NO pool candidates left on that track at all —
        // both passes below found nothing, and the final fallback
        // (`pool[random]`) jumped to a random slice, possibly on a totally
        // different source track. That's exactly what made tracks "switch
        // randomly" before reaching their actual end instead of playing a
        // natural shorter last segment. hasEnoughRemaining still protects
        // fresh selection (the `pool`-based branches below); staying should
        // only ever be blocked by genuinely running out of the track itself.
        var stayTrack = lastSourceTrack[track];
        var afterFrac = lastEndFrac[track];
        var best = -1;
        // First pass: slices on the same track that come after the current position
        for (var ci = 0; ci < arr.length; ci++) {
            if (arr[ci].sourceTrack === stayTrack && arr[ci].time >= afterFrac) {
                if (best < 0 || arr[ci].time < arr[best].time) best = ci;
            }
        }
        // Second pass (wrap): any slice on the same track. Reaching here means
        // the forward search found nothing at/after afterFrac — i.e. this stem
        // just played through to the literal end of stayTrack's available
        // audio. There is no third option for a finite file: either repeat it
        // (wrap to its own start, what happens below) or switch to different
        // material (the random pool-fallback below, only reachable if
        // stayTrack has NO slices left in `arr` at all — see its own comment).
        // Logged explicitly so a reported "jump" can be told apart from the
        // (much rarer, genuinely broken) fallback case below just by reading
        // the console — this wrap is an inherent, expected discontinuity from
        // hitting the end of a finite track, not a bug to fix here.
        if (best < 0) {
            for (var ci = 0; ci < arr.length; ci++) {
                if (arr[ci].sourceTrack === stayTrack) {
                    if (best < 0 || arr[ci].time < arr[best].time) best = ci;
                }
            }
            if (best >= 0) {
                post("EBYS Slicer [" + track + "]: STAY reached end of '" + stayTrack
                     + "' — wrapping to its own start (" + arr[best].time.toFixed(3) + ")\n");
            }
        }
        // best still -1 here only means stayTrack has ZERO slices anywhere in
        // `arr` anymore (e.g. removed from the library / filtered out by a
        // buildIndex re-run since this stem last picked it) — genuinely
        // nothing left to continue onto, so this is the one case that
        // legitimately falls through to a fresh pool pick, which CAN land on
        // a different source track. Distinct from the wrap above and worth
        // flagging loudly if it ever fires, since with the default
        // STAY_PROB=1 it's the only way this stem's own STAY logic can jump
        // to unrelated content instead of just repeating stayTrack.
        if (best < 0) {
            post("EBYS Slicer [" + track + "]: STAY — '" + stayTrack
                 + "' has no slices left in the index at all, falling back to a fresh pick from the pool\n");
        }
        startIdx = best >= 0 ? best : pool[Math.floor(Math.random() * pool.length)];
    } else if (hasActiveCriteria(track)) {
        // Score every candidate — pick the one with the lowest combined score.
        var endDesc     = getBlendedEndDesc(track);
        var agentPool   = filterPoolByAgentMode(pool, arr, track);
        var scoredPool  = applyLearnedRefusal(agentPool, arr, track, endDesc);
        var bestScore   = Infinity;
        startIdx = scoredPool[0];
        for (var pi = 0; pi < scoredPool.length; pi++) {
            var sc = scoreCandidate(arr[scoredPool[pi]], endDesc, track);
            if (sc < bestScore) { bestScore = sc; startIdx = scoredPool[pi]; }
        }
    } else {
        startIdx = pool[Math.floor(Math.random() * pool.length)];
    }
    lastIdx[track]         = startIdx;
    lastSourceTrack[track] = arr[startIdx].sourceTrack;

    var startSlice = arr[startIdx];

    // Recompute barMs using the chosen startSlice's source track — critical for
    // multi-track sessions where source tracks have different BPMs/downbeats.
    // The pool-building barMs above may be from a different source track.
    var srcBpm  = effectiveBPMForSource(startSlice.sourceTrack);
    barMs       = getBarMs(track, srcBpm, startSlice.sourceTrack);
    // Full-file mode: no bar-grid target to stop at — Infinity means the
    // accumulation loop below never exits early, it only ever stops when it
    // genuinely runs out of same-source-track slices (end of the file). That
    // also makes reachedTarget always false for these segments, which
    // correctly routes delay scheduling through the "use the real content
    // duration" branch below (see its comment) instead of the bar-grid one —
    // exactly right here, since the real content IS the whole file, not an
    // approximation of a fixed-bar target.
    targetMs    = PLAY_FULL_FILE[track] ? Infinity : (barMs * SEGMENT_BARS[track]);

    // Use this slice's own stemDurMs for accumulation (multi-track: different tracks
    // can have different durations; each slice knows which track it's from).
    var durMs = startSlice.stemDurMs || stemDurMs[track] || 0;

    // Accumulate consecutive slices until targetMs covered.
    // CRITICAL: only include slices from the SAME source track as startSlice.
    // This ensures each segment is a coherent excerpt from one recording,
    // not a cross-track splice mid-segment.
    var totalFrac = 0;
    var i = startIdx;
    var reachedTarget = false; // did accumulation cover the full SEGMENT_BARS target,
                                // or did it run out of same-source-track tape first
                                // (a genuine short tail segment)?
    if (durMs > 0) {
        while (i < arr.length
               && arr[i].sourceTrack === startSlice.sourceTrack
               && (totalFrac * durMs) < targetMs) {
            totalFrac += arr[i].dur;
            i++;
        }
        reachedTarget = (totalFrac * durMs) >= targetMs;
        // Ensure minimum 1 bar
        if ((totalFrac * durMs) < barMs) totalFrac = barMs / durMs;
    } else if (PLAY_FULL_FILE[track]) {
        // No stem duration known, but full-file mode doesn't need one — just
        // consume every remaining same-source-track slice, same stopping
        // condition as the durMs>0 branch above minus the ms-based target.
        while (i < arr.length && arr[i].sourceTrack === startSlice.sourceTrack) {
            totalFrac += arr[i].dur;
            i++;
        }
    } else {
        // No stem duration known — use SEGMENT_BARS * 8 slices as proxy
        // so setSegmentBars still has an effect even before stemDurMs is set
        var fallbackCount = Math.max(4, Math.round(SEGMENT_BARS[track] * 8));
        var count = 0;
        while (i < arr.length
               && arr[i].sourceTrack === startSlice.sourceTrack
               && count < fallbackCount) {
            totalFrac += arr[i].dur;
            i++;
            count++;
        }
    }

    // Full-file mode always consumes every remaining slice of the source
    // track — both loops above only ever stop when the source track changes,
    // never on a partial target — so the TRUE endpoint here is always exactly
    // the end of the file (fraction 1.0), regardless of what the summed
    // per-slice .dur values add up to. That sum is only ever as accurate as
    // the LAST slice's .dur, which is a fixed placeholder
    // (LAST_SLICE_DEFAULT_DUR — see buildIndex()'s per-source-track
    // post-processing, which never recomputes a real remaining length for
    // whichever slice ends up last) rather than a measured value. Overriding
    // with the exact fractional distance to 1.0 is the full-file equivalent
    // of the real-downbeat-anchor correction bar-target segments get below:
    // swap an approximation for the real, already-known value the moment one
    // is available. This is what makes the scheduled delay (segDurMs below)
    // actually match the composed ring buffer's real length, so the "next"
    // retrigger fires exactly when the file's audio ends instead of a hair
    // early — which is what was chopping the last beat before the loop
    // wrapped back to the start.
    if (PLAY_FULL_FILE[track]) {
        totalFrac = Math.max(0, 1.0 - startSlice.time);
        // Bookmark "the original mix, playing straight through" at exactly
        // this real moment. See baseAnchor's own comment (top of file) —
        // this is the ONLY place it's ever written, so a manual detour
        // (:setSegmentBars, :skip, a scored jump while criteria are active)
        // never touches it. returnToBase() reads it later to compute where
        // this untouched line would genuinely be by then.
        if (durMs > 0) {
            baseAnchor[track] = {
                sourceTrack: startSlice.sourceTrack,
                fileTimeMs:  startSlice.time * durMs,
                wallClockMs: Date.now()
            };
        }
    }

    // Emit — both values are 0-1 fractions of buffer length.
    // outlet 0: track  start_frac  end_frac
    // In Max:  start_frac * buf_ms → prepend start → play~
    //          (end_frac - start_frac) * buf_ms → delay
    var endFrac = Math.min(startSlice.time + totalFrac, 1.0);
    lastEndFrac[track] = endFrac;
    lastSlice = { track: track, time: startSlice.time, dur: totalFrac };

    // Store end-descriptors so next selection can match against them.
    // Tension has no start/end variant (add_tension.py writes one value per
    // slice, not per boundary) — stored under its own plain key so
    // predictTransitionQuality() can read it the same way it reads C/S/E/F/P/H/T.
    lastEndDesc[track] = {
        C: startSlice.endC, S: startSlice.endS, E: startSlice.endE,
        F: startSlice.endF, P: startSlice.endP,
        H: startSlice.endH, T: startSlice.endT,
        tension_C: startSlice.tension_C, tension_E: startSlice.tension_E,
        tension_F: startSlice.tension_F, tension_P: startSlice.tension_P,
        tension_H: startSlice.tension_H, tension_T: startSlice.tension_T
    };

    // Compute actual duration in ms for delay timing in Max (sent on outlet 0)
    var segDurMs;
    if (durMs > 0) {
        segDurMs = totalFrac * durMs;
    } else {
        // stemDurMs unknown — estimate from madmom BPM for this source track
        var bpmEst = effectiveBPMForSource(startSlice.sourceTrack);
        segDurMs = (60000.0 / bpmEst) * 4.0 * SEGMENT_BARS[track];
    }
    // Emit absolute time position in ms (for TUI timer anchor via slice_ms on outlet 1)
    var sliceMs = (durMs > 0) ? Math.round(startSlice.time * durMs) : 0;

    // Actual playback duration = content duration × stretch factor.
    // karma~ plays contentDurMs of audio at speed 1/stretchRatio, so elapsed wall time is:
    //   contentDurMs × stretchRatio = (SEGMENT_BARS × barMs_at_srcBPM) × (srcBPM/targetBPM)
    //                               = SEGMENT_BARS × barMs_at_targetBPM
    // This is identical for all source tracks → stems always fire together regardless of srcBPM.
    // Sent to slot_router via outlet 0 and to TUI via outlet 1 "segPlayMs".
    var stretchR = stretchRatioForSlice(startSlice);
    // Anti-drift: snap to exact bar grid at globalBPM rather than floating-point
    // segDurMs × stretchR.  segDurMs × stretchR can accumulate ±0.5 ms rounding error
    // per cycle; over 100 cycles that is ±50 ms of drift between stems.
    // SEGMENT_BARS × snapBarMs is always exact at the playback tempo.
    var snapBpm      = GLOBAL_BPM > 0 ? GLOBAL_BPM : FALLBACK_BPM;
    var snapBarMs    = (60000.0 / snapBpm) * 4.0;
    var actualPlayMs;
    if (reachedTarget) {
        // Full segment — bar-grid-exact duration (anti-drift, as before).
        actualPlayMs = Math.round(SEGMENT_BARS[track] * snapBarMs);
        if (actualPlayMs <= 0) actualPlayMs = Math.round(snapBarMs * 8); // defensive fallback
    } else {
        // Short tail — ran out of tape on this source track before reaching
        // SEGMENT_BARS. The ring buffer that gets composed for playback only
        // ever holds the REAL accumulated content (totalFrac × durMs, via
        // buffer_manager's numFrames = (endFrac-startFrac) × total) — it does
        // NOT know about the bar-grid target above. If we still scheduled the
        // full bar-grid delay here, karma~ would finish playing this short
        // buffer and then sit there for the remainder of the window with
        // nothing new queued — and since nothing in this system ever sends
        // karma~ an explicit "loop 0", its own default internal looping takes
        // over and it repeats that short leftover content until the delay
        // finally expires. That is the "stuck on one slice, loops over and
        // over" symptom. Scheduling the delay to match the REAL content
        // duration instead means the next segment gets requested right when
        // this one actually runs out, so there's nothing left to loop.
        //
        // totalFrac × durMs is CONTENT-domain duration — real elapsed time
        // only if played at the source's own native tempo. karma~ actually
        // plays it at speedFactor = 1/stretchR, so real WALL-CLOCK duration
        // is content × stretchR (same conversion the big comment above this
        // block already spells out for the full-segment case). Forgetting
        // this factor here was itself a bug: whenever a short-tail segment's
        // source BPM differed from the playback target, the delay came out
        // wrong in one direction or the other — too long relative to a
        // sped-up buffer (silence for the remainder, since karma~ now has
        // @loop 0 and just sits there instead of looping) or too short
        // relative to a slowed-down one (content truncated early). Both read
        // as "weak"/"cut"/"silence even though the file has audio."
        actualPlayMs = Math.round(totalFrac * durMs * (stretchR || 1));
        if (actualPlayMs <= 0) actualPlayMs = Math.round(snapBarMs); // defensive floor: 1 bar
    }

    // outlet 0: track  slot  startFrac  endFrac  stretchRatio  segDurMs
    //   slot_router computes delayMs = segDurMs × stretchRatio — THIS is what
    //   actually schedules the next `next <track>` bang, i.e. it is the real
    //   segment duration, not segPlayMs (which only ever went to the TUI).
    //   Sending the raw content duration (totalFrac × durMs) here let ±0.5ms
    //   float rounding compound every cycle — over 100 cycles that's ±50ms of
    //   drift between stems, which is exactly why "8 bars" segments visibly
    //   changed at different times even with identical SEGMENT_BARS: every
    //   stem's *nominal* target was the same, but the *scheduled* delay never
    //   was. actualPlayMs above already computes the bar-grid-exact duration —
    //   it just wasn't fed back into the value that drives real playback. Send
    //   its pre-stretch equivalent instead so delayMs === actualPlayMs exactly,
    //   every cycle, for every stem, WHEN the full SEGMENT_BARS target was
    //   actually reached (reachedTarget). karma~ doesn't self-stop at endFrac
    //   (the next routeStem() call explicitly stops+reseeks it), so decoupling
    //   the scheduled delay from the literal slice-boundary content length is
    //   only safe in that case. For short tail segments (reachedTarget false)
    //   actualPlayMs above already falls back to the real content duration —
    //   see the comment at its computation for why that matters.
    var segDurMsForOutlet = actualPlayMs / (stretchR || 1);

    // Correct the STAY-continuation anchor to where playback actually stops,
    // not where the composed buffer happens to end. When reachedTarget is
    // true, the accumulation loop above almost always OVERSHOT the bar-exact
    // target — it keeps whole analyzed slices until their summed duration
    // crosses SEGMENT_BARS, and slice boundaries are transient-detected, not
    // bar-quantized, so they essentially never land exactly on the target.
    // The ring buffer gets composed with that overshot content (endFrac,
    // above — left untouched, composing a little extra is harmless), but
    // only segDurMsForOutlet worth of it is actually played before the next
    // scheduled commit stops and re-seeks karma~ — the overshoot tail is
    // composed but never heard, so the next STAY continuation must not
    // resume from endFrac (past that unheard tail) — it must resume from
    // wherever real playback actually stopped.
    //
    // First choice: read the REAL measured downbeat N bars ahead of
    // startSlice (nextDownbeatFrac). This is exact by construction, since
    // buildIndex() split a slice boundary at every one of these downbeats —
    // landing here always lands on a real slice edge, zero gap either way.
    // Recompute actualPlayMs/segDurMsForOutlet from that REAL content span
    // too (not the assumed-constant-tempo math below), so the scheduled
    // "next" delay matches what's really being played instead of an average.
    //
    // Fallback (no confident downbeat data, or fewer than SEGMENT_BARS
    // downbeats remain on this track from here): the previous bar-exact-MATH
    // anchor, computed by assuming the source plays at a perfectly constant
    // tempo. This was the old fix and it reduced — but didn't eliminate —
    // the skip: real tracks are never perfectly constant-tempo, so this
    // math-derived point almost never coincides with an actual slice
    // boundary, and STAY's forward search then jumps to the next real one a
    // little further along, silently dropping whatever's in between. That
    // residual mismatch is the "close but a few ms/sec skip, every segment"
    // bug — fixed for downbeat-confident tracks by the real-downbeat lookup
    // above; this remains the best available anchor for tracks without one.
    if (reachedTarget && durMs > 0) {
        var realStopFrac = nextDownbeatFrac(startSlice.sourceTrack,
                                             startSlice.time * durMs,
                                             SEGMENT_BARS[track], durMs);
        // Don't trust a downbeat timestamp that isn't actually backed by a
        // real slice in the index — buildIndex() is written to guarantee
        // this now (see its leading/trailing gap-filling), but verifying
        // here means a mismatch fails safe into the old approximate anchor
        // instead of silently pointing STAY at a boundary that doesn't exist.
        if (realStopFrac !== null && !hasSliceBoundaryAt(arr, startSlice.sourceTrack, realStopFrac, durMs)) {
            post("EBYS Slicer [" + track + "]: nextDownbeatFrac returned " + realStopFrac.toFixed(4)
                 + " for '" + startSlice.sourceTrack + "' but no slice exists there — falling back to bar-math anchor\n");
            realStopFrac = null;
        }
        if (realStopFrac !== null) {
            var realContentMs = Math.max(1, (realStopFrac - startSlice.time) * durMs);
            actualPlayMs        = Math.round(realContentMs * (stretchR || 1));
            segDurMsForOutlet   = actualPlayMs / (stretchR || 1);
            lastEndFrac[track]  = realStopFrac;
            // The accumulation loop above stops as soon as it crosses the
            // MATH-estimated targetMs, which can occasionally undershoot the
            // REAL N-bar point if this section's real tempo runs a touch
            // slower than the single averaged srcBpm estimate. If so, the
            // composed ring buffer would be too short to cover what we just
            // decided will actually play — extend endFrac (the compose
            // range) to match. Composing extra is harmless; composing too
            // little means silence/stall at the tail instead of a skip.
            if (realStopFrac > endFrac) endFrac = realStopFrac;
        } else {
            var trueStopFrac = startSlice.time + (segDurMsForOutlet / durMs);
            lastEndFrac[track] = Math.max(startSlice.time, Math.min(trueStopFrac, endFrac));
        }
    }

    // Sync barrier tag — see collectSyncGroup()'s comment above. `track` here
    // is always either a solo/unlocked stem or a group leader (locked
    // followers never reach selectSegment() directly — next()'s dispatch
    // routes them to pushSyncedSegment() instead), so this is always the
    // right place to mint a fresh cycle for whatever group `track` heads.
    var syncGroup = collectSyncGroup(track);
    var cycleId   = ++syncCycleCounter;
    outlet(0, track, startSlice.slot || 0, startSlice.time, endFrac,
           stretchR, Math.round(segDurMsForOutlet), cycleId, syncGroup.length);

    // Speculative preload: guess the next source track and tell buffer_manager
    // to start disk loading now — so the track is ready when the next segment fires.
    // buffer_manager ignores this if the track is already loaded.
    if (arr.length > 0) {
        var nextArr  = byTrack[track];
        var nextIdx  = Math.floor(Math.random() * nextArr.length);
        var nextSlot = (nextArr[nextIdx] && nextArr[nextIdx].slot !== undefined)
                       ? nextArr[nextIdx].slot : 0;
        outlet(0, "preload", track, nextSlot);

        // Locked followers (e.g. vocals/bass → melody) never run their own
        // selectSegment() while locked — next() short-circuits them straight
        // to pushSyncedSegment() (see below), so this preload guess is the
        // ONLY speculative-load hint they ever get; without it a follower's
        // buffer_manager only starts loading a new source track the instant
        // pushSyncedSegment() actually asks for it, with zero lead time.
        // That cold-start load latency is what let a locked stem keep
        // audibly playing its OLD source track — while the TUI, whose
        // descriptor display doesn't wait on the audio buffer at all,
        // already showed the new one. Priming the same guessed nextSlot for
        // every follower here gives them the same head start the leader
        // itself gets.
        var flw = syncFollowers[track];
        if (flw && flw.length > 0) {
            for (var fli = 0; fli < flw.length; fli++) outlet(0, "preload", flw[fli], nextSlot);
        }
    }

    outlet(1, "desc",      track, startSlice.C, startSlice.S, startSlice.E, startSlice.F, startSlice.P, startSlice.H, startSlice.T,
           startSlice.tension_C, startSlice.tension_E, startSlice.tension_F,
           startSlice.tension_P, startSlice.tension_H, startSlice.tension_T);
    // Analysis-driven M/S: emit pan and width for this slice so spat_fx_router can apply them.
    // stemMS <track> <pan> <width> — received by ws_server → forwarded to spat_fx_router.
    outlet(1, "stemMS", track, startSlice.pan, startSlice.width);
    outlet(1, "slice_ms",  track, sliceMs);
    // Emit per-slice stemDurMs so the TUI bracket width is always correct for the
    // current source track.  In multi-track sessions each source track has a different
    // duration; the module-level stemDurMs is only updated on load, so it may be stale.
    if (durMs > 0) outlet(1, "stemDurMs", track, durMs);
    outlet(1, "stemTrack", track, startSlice.sourceTrack);
    // Actual playback duration for TUI progress bar: content × stretch factor.
    // segDurMs = totalFrac * durMs (real content, not bar-snapped).
    // × stretchRatio = srcBPM/globalBPM → gives what karma~ physically plays.
    // TUI uses this to fill the bar in sync with the audio.
    outlet(1, "segPlayMs", track, actualPlayMs);
    outlet(1, "seg",
           track,
           startSlice.sourceTrack + ":" + startSlice.id,
           hasDur ? (Math.round(segDurMs) + "ms") : (totalFrac.toFixed(3) + " frac"),
           "(" + (segDurMs / ((60000.0 / effectiveBPMForSource(startSlice.sourceTrack)) * 4.0)).toFixed(1) + " bars)",
           startSlice.time, endFrac);

    // Remember exactly what got played so a locked follower (now, or one
    // locked a moment from now via lockSource()) can be pushed the identical
    // time window instead of independently reselecting.
    lastSegment[track] = {
        slot: startSlice.slot || 0, sourceTrack: startSlice.sourceTrack,
        time: startSlice.time, endFrac: endFrac,
        stretchR: stretchR, segDurMsForOutlet: segDurMsForOutlet,
        actualPlayMs: actualPlayMs, durMs: durMs, sliceMs: sliceMs,
        // srcBpm + dispatchedAtMs exist purely for applyGlobalBPMLive() — it
        // needs to know, at any later moment, "how much wall-clock time has
        // this segment actually been playing" and "what source BPM was the
        // current stretchR computed against" so it can retime the still-
        // playing karma~ instance and its pending auto-next timer without
        // touching WHAT is playing, only how fast.
        srcBpm: resolveSrcBpm(startSlice.sourceTrack), dispatchedAtMs: Date.now(),
        // cycleId lets next()'s sourceLock self-pull branch tell "has my
        // leader already pushed me this exact segment" from "am I stale" —
        // see that branch's comment for why this matters.
        cycleId: cycleId
    };

    // Push this exact segment to every stem locked to this one — same slot
    // (slotMap is shared across stems, so slot N always means the same source
    // track regardless of which stem plays it), same start/end fraction, same
    // stretch, same delay. This is what makes locked stems play literally the
    // same moment of the same track together, not just draw from it independently.
    var followers = syncFollowers[track];
    if (followers && followers.length > 0) {
        for (var fi = 0; fi < followers.length; fi++) pushSyncedSegment(track, followers[fi], cycleId, syncGroup.length);
    }
}

// Find the follower's own slice closest in time to `timeFrac` on `sourceTrack` —
// used only to grab realistic descriptor/pan/width values for display; playback
// timing itself always comes from the leader's segment, not this lookup.
function findNearestSlice(followerTrack, sourceTrack, timeFrac) {
    var farr = byTrack[followerTrack];
    if (!farr || farr.length === 0) return null;
    var best = null, bestDist = Infinity;
    for (var i = 0; i < farr.length; i++) {
        if (farr[i].sourceTrack !== sourceTrack) continue;
        var d = Math.abs(farr[i].time - timeFrac);
        if (d < bestDist) { bestDist = d; best = farr[i]; }
    }
    return best;
}

// Push the leader's last-played segment (time window, slot, stretch, delay)
// directly to `follower`, bypassing selectSegment()'s own candidate pool for
// this cycle entirely. Descriptor/pan/width display values are pulled from the
// follower's own nearest slice on that source track when available (its audio
// content genuinely differs from the leader's — only the timing is shared).
function pushSyncedSegment(leader, follower, cycleId, groupSize) {
    var seg = lastSegment[leader];
    if (!seg || !running) {
        post("EBYS Slicer: pushSyncedSegment(" + leader + "→" + follower + ") skipped — "
             + (!running ? "engine not running" : "leader has no segment yet") + "\n");
        return;
    }
    post("EBYS Slicer: pushSyncedSegment [" + follower + "] ← [" + leader + "]  "
         + seg.sourceTrack + " @ " + seg.time.toFixed(3) + "→" + seg.endFrac.toFixed(3)
         + "  slot=" + seg.slot + "  " + Math.round(seg.segDurMsForOutlet) + "ms\n");

    var nearest = findNearestSlice(follower, seg.sourceTrack, seg.time);
    var descSrc = nearest || {}; // fall back to leader's own values below if missing

    // seg.time/seg.endFrac are FRACTIONS (0..1) of the LEADER's own source file
    // for this sourceTrack — buffer_manager.js turns them into absolute frame
    // numbers via `Math.round(startFrac * total)`, where `total` is that
    // stem's OWN file's frame count. Forwarding the leader's raw fraction
    // straight to the follower silently assumes the leader's file and the
    // follower's file for the same nominal sourceTrack (song) have IDENTICAL
    // total length — true only if the stem-separation export produced
    // perfectly sample-matched files for every stem of that song. Any real
    // mismatch (even a few hundred ms of head/tail padding difference, which
    // separation tools do sometimes introduce per-stem) means "the same
    // fraction" lands at a genuinely different absolute time in the two
    // files — the two stems would start audibly apart despite being locked
    // to the same source, same BPM, same segment. This is exactly the
    // "locked stems feel a little off" symptom reported, and is NOT a
    // stretch/tempo bug (stretchR is forwarded unchanged below, so playback
    // *speed* was always identical) — it's a start-*position* bug.
    // Fix: convert the leader's fraction to an absolute ms position using
    // the LEADER's own file duration, then re-derive the fraction the
    // FOLLOWER needs using the FOLLOWER's own file duration for that same
    // sourceTrack — so both stems crop the same real-world moment instead of
    // the same fraction of two potentially different-length files.
    var leaderDurMs   = seg.durMs || 0;
    var followerDurMs = (nearest && nearest.stemDurMs) || stemDurMs[follower] || leaderDurMs;
    var syncStartFrac = seg.time;
    var syncEndFrac   = seg.endFrac;
    if (leaderDurMs > 0 && followerDurMs > 0 && Math.abs(followerDurMs - leaderDurMs) > 0.5) {
        var startMs = seg.time    * leaderDurMs;
        var endMs   = seg.endFrac * leaderDurMs;
        syncStartFrac = startMs / followerDurMs;
        syncEndFrac   = endMs   / followerDurMs;
        post("EBYS Slicer: pushSyncedSegment [" + follower + "] durMs mismatch vs leader ["
             + leader + "] (" + Math.round(followerDurMs) + "ms vs " + Math.round(leaderDurMs)
             + "ms) — corrected frac " + seg.time.toFixed(4) + "→" + syncStartFrac.toFixed(4) + "\n");
    }

    lastSourceTrack[follower] = seg.sourceTrack;
    // NOTE: lastEndFrac[follower] intentionally does NOT reuse syncEndFrac
    // above. syncEndFrac is derived from seg.endFrac, which is the RAW
    // (possibly overshot) buffer-compose range — correct for framing the
    // ring buffer, wrong as a STAY-continuation anchor (same reason
    // covered in the big comment above lastEndFrac[track]'s own
    // reachedTarget correction in selectSegment()). lastEndFrac[leader] has
    // already been corrected to the real stop point by the time this runs
    // (selectSegment() sets it before building lastSegment/calling this),
    // so re-derive the follower's own fraction from THAT value the same way
    // syncStartFrac/syncEndFrac were derived above — otherwise a follower
    // that's later unlocked would seed its own continuation from the same
    // overshoot point the leader used to have, reintroducing the skip one
    // hop downstream of the actual fix.
    var contEndFrac = lastEndFrac[leader];
    if (leaderDurMs > 0 && followerDurMs > 0 && Math.abs(followerDurMs - leaderDurMs) > 0.5) {
        contEndFrac = (contEndFrac * leaderDurMs) / followerDurMs;
    }
    lastEndFrac[follower]     = contEndFrac;
    if (nearest) lastIdx[follower] = byTrack[follower].indexOf(nearest);

    // cycleId/groupSize: if this push somehow happened outside a tagged cycle
    // (defensive — every real call site tags one), fall back to a solo
    // barrier of one so this stem still commits on its own instead of
    // silently waiting forever for a group that was never defined.
    var pushCycleId   = cycleId   !== undefined ? cycleId   : ++syncCycleCounter;
    var pushGroupSize = groupSize !== undefined ? groupSize : 1;
    outlet(0, follower, seg.slot, syncStartFrac, syncEndFrac, seg.stretchR,
           Math.round(seg.segDurMsForOutlet), pushCycleId, pushGroupSize);

    outlet(1, "desc", follower,
           descSrc.C || 0, descSrc.S || 0, descSrc.E || 0, descSrc.F || 0, descSrc.P || 0, descSrc.H || 0, descSrc.T || 0,
           descSrc.tension_C || 0, descSrc.tension_E || 0, descSrc.tension_F || 0,
           descSrc.tension_P || 0, descSrc.tension_H || 0, descSrc.tension_T || 0);
    outlet(1, "stemMS", follower, descSrc.pan || 0, descSrc.width || 0.5);
    outlet(1, "slice_ms", follower, seg.sliceMs);
    if (followerDurMs > 0) outlet(1, "stemDurMs", follower, followerDurMs);
    outlet(1, "stemTrack", follower, seg.sourceTrack);
    outlet(1, "segPlayMs", follower, seg.actualPlayMs);
    // The id field (arg 2) is what the TUI diffs against to detect "this is a
    // genuinely new segment" (msg.id !== state.stems[name].id) and reset the
    // progress bar's start time. It must change on EVERY push and must be a
    // plain value — no display markup mixed in here, that belongs in the
    // "(N bars)" slot (arg 4) same as the normal selectSegment() path. Using a
    // static "sync" fallback when no nearest slice was found meant repeated
    // pushes to a follower with no matching slice for that source track never
    // looked "new" to the TUI — the bar would sit frozen on the old segment
    // while the audio had already moved on, which is exactly the desync
    // reported. Falling back to the leader's time position keeps it unique
    // per push even with no slice match.
    var followerIdTag = nearest ? nearest.id : ("sync@" + syncStartFrac.toFixed(4));
    outlet(1, "seg",
           follower,
           seg.sourceTrack + ":" + followerIdTag,
           Math.round(seg.segDurMsForOutlet) + "ms",
           "(" + SEGMENT_BARS[leader] + " bars, locked→" + leader + ")",
           syncStartFrac, syncEndFrac);

    // Record what this follower is now playing so it can itself act as a leader —
    // e.g. drums→bass→melody chains (bass locked to drums, melody locked to bass)
    // stay in sync all the way down, not just one hop from the root leader.
    // Must store THIS follower's own corrected time/endFrac/durMs, not the
    // original leader's raw values — otherwise a sub-follower two hops down
    // the chain would inherit the same fraction-vs-different-file-length bug
    // this function just fixed, via a seg object that lies about which file
    // duration its own fraction was computed against.
    lastSegment[follower] = {
        slot: seg.slot, sourceTrack: seg.sourceTrack,
        time: syncStartFrac, endFrac: syncEndFrac,
        stretchR: seg.stretchR, segDurMsForOutlet: seg.segDurMsForOutlet,
        actualPlayMs: seg.actualPlayMs, durMs: followerDurMs, sliceMs: seg.sliceMs,
        // Same sourceTrack as the leader → same srcBpm, no need to re-resolve.
        // dispatchedAtMs is its own fresh timestamp (this push happens in the
        // same tick as the leader's own dispatch, so they start together).
        srcBpm: seg.srcBpm, dispatchedAtMs: Date.now(),
        // cycleId identifies which push this follower is now caught up to —
        // see next()'s sourceLock self-pull branch, which compares this
        // against the leader's own current cycleId to decide whether a pull
        // is genuinely needed or would just be a redundant duplicate.
        cycleId: pushCycleId
    };
    var subFollowers = syncFollowers[follower];
    if (subFollowers && subFollowers.length > 0) {
        // Same cycleId/groupSize propagate down the chain — a melody→bass→drums
        // lock is still ONE barrier group, not two nested ones.
        for (var sfi = 0; sfi < subFollowers.length; sfi++) {
            pushSyncedSegment(follower, subFollowers[sfi], pushCycleId, pushGroupSize);
        }
    }
}

// ── TRANSPORT ─────────────────────────────────────────────────────────────────

function start() {
    if (idx.length === 0) { outlet(1, "index_empty"); return; }
    if (running) {
        // A quantized :stop (see stop()/QUANTIZE_STOP) hasn't actually frozen
        // anything yet — running is still true until it fires. Treat a
        // :start that arrives during that window as "changed my mind, keep
        // playing" instead of a no-op duplicate-start.
        if (stopQuantizeTask) {
            stopQuantizeTask.cancel();
            stopQuantizeTask = null;
            outlet(1, "sysMsg", "→ pending quantized stop cancelled — still playing");
            post("EBYS Slicer: :start received while a quantized :stop was pending — cancelled, still running\n");
            return;
        }
        post("EBYS Slicer: already running — ignoring duplicate start\n");
        return;
    }

    // Resume from a prior :stop, not a cold start — buffer_manager.stop()/
    // slot_router.stop() already froze every karma~ exactly where it was
    // (karma~'s "stop" pauses in place, it doesn't reset position), so the
    // paused layering is still sitting there untouched. Calling
    // selectSegment() below would discard that and pick 4 brand-new
    // candidates instead — exactly the "stop/start reloads the system" bug
    // this fixes. Re-arm the scheduler and tell the audio engine to
    // literally keep playing from where it paused; nothing gets reselected,
    // recomposed, or re-triggered from frame 0.
    //
    // This is also what makes :score/:scoreTransition trustworthy across a
    // pause: while running is false, next()/loop() no-op and karma~ itself
    // is frozen, so the state a rating command reads while paused is
    // guaranteed to still be the exact layering that was actually heard —
    // not whatever's already moved on by the time the command is typed.
    //
    // Each stem's auto-advance timer (the Max `delay` object slot_router
    // schedules on commit) does NOT pause itself just because karma~ did —
    // stop() below freezes it (rescheduled far out) the moment :stop fires,
    // and here on resume it's re-armed with the actual remaining time via
    // the same rescheduleLive() mechanism applyGlobalBPMLive() already uses
    // for live tempo changes. Without this, the countdown either fires
    // silently while stopped (no-op via next()'s own `if (!running) return`,
    // but then never fires again post-resume — the stem stops auto-advancing)
    // or, worse, fires moments after resume because the paused duration ate
    // into a countdown that was still ticking — an audible stop/set/seek0/play
    // re-trigger that sounds exactly like the resumed segment restarting from
    // the beginning.
    if (everStarted) {
        running = true;
        var resumeNow = Date.now();
        outlet(0, "resume");   // → buffer_manager.resume() → slot_router.resume() → karma~ "play"
        for (var rt = 0; rt < TRACKS.length; rt++) {
            var rtrack    = TRACKS[rt];
            var remaining = pausedRemainingMs[rtrack];
            pausedRemainingMs[rtrack] = null;
            var posFrac   = pausedPosFrac[rtrack];
            pausedPosFrac[rtrack] = null;
            var rseg      = lastSegment[rtrack];
            var rstretchR = (rseg && rseg.stretchR) || 1.0;
            // Explicit re-seek — see pausedPosFrac's own comment for why
            // this fires right after "resume"'s bare "play" instead of
            // trusting karma~'s pause/play alone to land back on the exact
            // sample this stem was stopped at. performStopNow() only ever
            // sets posFrac when its own confidence guard passed, so this is
            // never the bogus near-end-of-file value that guard exists to
            // prevent.
            if (posFrac !== null && posFrac !== undefined) {
                outlet(0, "resumeSeek", rtrack, posFrac);
            }
            if (remaining !== null && remaining !== undefined && remaining > 0) {
                outlet(0, "rescheduleLive", rtrack, 1.0 / rstretchR, Math.round(remaining));
                if (rseg) rseg.segDurMsForOutlet = rstretchR > 0 ? remaining / rstretchR : remaining;
            }
            // Rebase dispatchedAtMs to THIS resume instant unconditionally —
            // even when `remaining` above was null (performStopNow's
            // confidence guard didn't trust its own estimate that time).
            // This used to only happen inside the `remaining > 0` branch:
            // whenever one stop/resume cycle produced an untrustworthy
            // estimate, dispatchedAtMs stayed stale, which made the NEXT
            // cycle's elapsed-time math measure against an even older
            // anchor — compounding until the estimate pinned itself at the
            // very end of the file and resumeSeek jumped that stem into
            // silence. Always resetting the anchor here, regardless of
            // confidence, stops that from ever compounding past one bad
            // cycle. Same reasoning as applyGlobalBPMLive's own rebase.
            if (rseg) rseg.dispatchedAtMs = resumeNow;
        }
        outlet(1, "resumed");
        post("EBYS Slicer: resumed — continuing from stopped position\n");
        scheduleDownbeatPulse();
        return;
    }

    running     = true;
    everStarted = true;
    // Re-emit sourceTrack slot registrations before firing selectSegment.
    // buffer_manager.js clears slotToTrack on every autowatch reload, so
    // re-sending here ensures it always has current mappings at start time.
    // slotMap is the module-level { name → slot } dict built by buildIndex.
    var slotNames = Object.keys(slotMap).sort(function(a, b) {
        return slotMap[a] - slotMap[b];
    });
    for (var si = 0; si < slotNames.length; si++) {
        outlet(1, "sourceTrack", slotMap[slotNames[si]], slotNames[si]);
    }
    // Broadcast current params so TUI is always in sync regardless of autowatch reload order.
    for (var t = 0; t < TRACKS.length; t++) {
        outlet(1, "segmentBars",  TRACKS[t], SEGMENT_BARS[TRACKS[t]]);
        outlet(1, "stayProb",     TRACKS[t], STAY_PROB[TRACKS[t]]);
        // So the TUI's [CHUNK MODE ON/OFF] indicator (and any other client
        // that just (re)connected) reflects reality at start time too, not
        // just after the next explicit :chunkMode/:setSegmentBars —
        // same reasoning as segmentBars/stayProb/lockSource above.
        outlet(1, "playFullFile", TRACKS[t], PLAY_FULL_FILE[TRACKS[t]] ? 1 : 0);
    }
    // Announce current source locks (including the bass→melody default) so
    // the TUI shows accurate lock state at start — loadbang can't do this
    // itself since node.script/ws_server isn't guaranteed ready yet at
    // patch-load time (same reason sourceTrack/segmentBars/stayProb above
    // are re-sent here rather than only at loadbang).
    for (var lk = 0; lk < TRACKS.length; lk++) {
        if (sourceLock[TRACKS[lk]]) outlet(1, "lockSource", TRACKS[lk], sourceLock[TRACKS[lk]]);
    }
    // Fire all 4 stems simultaneously — they then loop independently via "next <track>",
    // except locked followers: skip them here and let their leader's own
    // selectSegment() (elsewhere in this same loop) push their first segment via
    // pushSyncedSegment(), so a follower never independently picks its own start
    // point even on the very first bar.
    for (var t = 0; t < TRACKS.length; t++) {
        if (!sourceLock[TRACKS[t]]) selectSegment(TRACKS[t]);
    }
    post("EBYS Slicer: started — bars=" + JSON.stringify(SEGMENT_BARS)
         + "  quantize=" + QUANTIZE_BARS
         + "  stay=" + JSON.stringify(STAY_PROB) + "\n");
    outlet(1, "started");
    scheduleDownbeatPulse();
}

// stopQuantizeTask — the pending Task scheduled by a quantized stop() to
// actually freeze playback at the next downbeat. null when no quantized
// stop is currently pending.
var stopQuantizeTask = null;

// downbeatPulseTask — self-rescheduling Task that fires outlet(1,"downbeat")
// on every real downbeat while playing, so the TUI can reset anything meant
// to represent "this bar" (currently: the descriptor grid's rolling window)
// exactly in phase with the music instead of guessing from a client-side
// bpm-only timer. Armed on every transition into "actually playing" (fresh
// start, resume, and after any live tempo change since that shifts the
// downbeat grid) and disarmed on stop/reset — see scheduleDownbeatPulse().
var downbeatPulseTask = null;
function scheduleDownbeatPulse() {
    if (downbeatPulseTask) { downbeatPulseTask.cancel(); downbeatPulseTask = null; }
    if (!running) return;
    var delayMs = msUntilNextDownbeat();
    if (!(delayMs > 0)) return; // no tempo/anchor yet — nothing to phase-lock to
    downbeatPulseTask = new Task(function() {
        downbeatPulseTask = null;
        outlet(1, "downbeat");
        scheduleDownbeatPulse(); // re-arm for the next one
    }, this);
    downbeatPulseTask.schedule(delayMs);
}

function stop() {
    if (!running) return; // already stopped, or a quantized stop is already pending

    if (!QUANTIZE_STOP) {
        performStopNow();
        return;
    }

    // Quantized: don't freeze immediately — schedule the real freeze for
    // the next downbeat (see msUntilNextDownbeat()) so the eventual :start
    // always lands back on a clean beat, same idea as QUANTIZE_BARS but for
    // the STOP edge instead of segment selection. running stays true until
    // the scheduled Task actually fires — see start()'s own handling of a
    // :start arriving during this window.
    var delayMs = msUntilNextDownbeat();
    if (delayMs <= 0) {
        // No tempo/anchor known yet (e.g. nothing has really played) —
        // nothing meaningful to quantize against, freeze immediately.
        performStopNow();
        return;
    }
    if (stopQuantizeTask) stopQuantizeTask.cancel();
    stopQuantizeTask = new Task(performStopNow, this);
    stopQuantizeTask.schedule(delayMs);
    outlet(1, "sysMsg", "○ stop queued — freezing at next downbeat (" + Math.round(delayMs) + "ms)");
    post("EBYS Slicer: :stop received — quantized, freezing in " + Math.round(delayMs) + "ms at next downbeat\n");
}

// msUntilNextDownbeat — real-time ms remaining until the next downbeat,
// computed from the effective (target) BPM and whichever currently-playing
// stem's lastSegment.dispatchedAtMs is available as a beat-grid anchor.
// Every stem is stretched to the SAME effective BPM (that's the whole
// stretchR mechanism — see slot_router.js/applyGlobalBPMLive), so even
// though each stem's underlying source material may differ, they all share
// one real-time bar grid; any one of them is a valid anchor. This assumes
// that segment's own start (dispatchedAtMs) itself landed on a real
// downbeat, which is exactly what QUANTIZE_BARS (on by default) already
// guarantees for normal segment selection — see selectSegment()'s own
// downbeat-alignment logic.
function msUntilNextDownbeat() {
    var effBPM = effectiveBPM();
    if (!(effBPM > 0)) return 0;
    var barMs = (60000.0 / effBPM) * 4.0; // 4/4 assumed — matches SEGMENT_BARS' own beat math elsewhere
    var anchorMs = null;
    for (var i = 0; i < TRACKS.length; i++) {
        var seg = lastSegment[TRACKS[i]];
        if (seg && seg.dispatchedAtMs) { anchorMs = seg.dispatchedAtMs; break; }
    }
    if (anchorMs === null) return 0;
    var now       = Date.now();
    var sinceAnchor = now - anchorMs;
    var intoBar   = ((sinceAnchor % barMs) + barMs) % barMs; // guard against a negative modulo
    var remaining = barMs - intoBar;
    // Already basically on the downbeat — round up a full bar so a
    // "quantized" stop is never indistinguishable from an immediate one.
    if (remaining < 30) remaining += barMs;
    return remaining;
}

// performStopNow — the actual freeze, previously the entire body of stop().
// Called either immediately (QUANTIZE_STOP off, or no tempo/anchor to
// quantize against) or by stopQuantizeTask at the next downbeat.
function performStopNow() {
    stopQuantizeTask = null;
    if (downbeatPulseTask) { downbeatPulseTask.cancel(); downbeatPulseTask = null; }
    running = false;

    // Freeze each stem's pending auto-advance countdown before anything else.
    // Max's `delay` object counts real wall-clock time regardless of karma~'s
    // own paused state, so left alone it either fires during the pause
    // (harmless no-op, but the stem then never auto-advances again once
    // resumed) or fires moments after resume because the pause ate into its
    // remaining time — an audible restart. Compute how much wall time was
    // actually left, stash it for start()'s resume branch, and disarm the
    // live countdown by rescheduling it far out (rescheduleLive's existing
    // set-time-then-bang mechanism, same one applyGlobalBPMLive() uses for
    // tempo changes).
    var stopNow = Date.now();
    for (var t = 0; t < TRACKS.length; t++) {
        var track = TRACKS[t];
        var seg   = lastSegment[track];
        pausedRemainingMs[track] = null;
        pausedPosFrac[track]     = null;
        if (!seg || !seg.dispatchedAtMs || !seg.segDurMsForOutlet) continue;
        var stretchR       = seg.stretchR || 1.0;
        var totalWallMs    = seg.segDurMsForOutlet * stretchR;
        var elapsedWallMs  = Math.max(0, Math.min(totalWallMs, stopNow - seg.dispatchedAtMs));
        var remainingWallMs = totalWallMs - elapsedWallMs;
        if (remainingWallMs > 0) {
            pausedRemainingMs[track] = remainingWallMs;
            outlet(0, "rescheduleLive", track, 1.0 / stretchR, PAUSED_DELAY_HOLD_MS);
        }
        // Buffer position (0..1) this stem was actually paused at — see
        // pausedPosFrac's own comment above for why this is sent explicitly
        // on resume instead of trusting karma~ to remember it unprompted.
        // Prefer karma~'s OWN reported position (karmaPos[track], fed live
        // from its data outlet — see the "Real-time karma~ position feed"
        // block near the top of this file) when a recent-enough reading is
        // available: it's ground truth from the DSP object itself, immune
        // to the wall-clock estimate's failure mode below.
        var segStartFrac = (typeof seg.time === 'number') ? seg.time : 0;
        var segEndFrac   = (typeof seg.endFrac === 'number') ? seg.endFrac : 1;
        var freshKarmaPos = karmaPos[track] !== null && karmaPos[track] !== undefined
            && karmaPosAtMs[track] !== null && (stopNow - karmaPosAtMs[track]) <= KARMA_POS_MAX_AGE_MS;
        if (freshKarmaPos) {
            pausedPosFrac[track] = Math.max(0, Math.min(1, karmaPos[track]));
        } else if (remainingWallMs > 0) {
            // Wall-clock estimate — only trustworthy in this branch, i.e.
            // when the bookkeeping agrees this segment still had real time
            // left. remainingWallMs<=0 means our own tracking thinks this
            // segment should already be over — trusting that would clamp
            // progressFrac to 1.0 and jump this stem to the very end of the
            // buffer (silence), not somewhere still audible. Skip the
            // explicit reseek entirely in that case (below) and fall back
            // to karma~'s own pause memory for this one cycle instead.
            var progressFrac = totalWallMs > 0 ? Math.max(0, Math.min(1, elapsedWallMs / totalWallMs)) : 0;
            pausedPosFrac[track] = Math.max(0, Math.min(1, segStartFrac + (segEndFrac - segStartFrac) * progressFrac));
        } else {
            post("EBYS Slicer: [" + track + "] stop — wall-clock position estimate untrustworthy (no fresh karma~ reading either), skipping explicit reseek this cycle\n");
        }
    }

    // Explicitly forward to buffer_manager (→ slot_router → karma~ "stop")
    // rather than relying solely on the Max patch's own routing of the raw
    // :stop command to also reach buffer_manager.js directly — this keeps
    // the pause guaranteed from slicer.js's own code path, not an assumption
    // about patch wiring. Idempotent if the patch also wires it directly.
    outlet(0, "stop");
    outlet(1, "stopped");
}

// Called by play~'s done bang: "next vocals" / "next melody" / etc.
function next(track) {
    if (!running) return;
    // Emit segmentEnd BEFORE selecting the next segment.
    // This fires at the exact moment the Max delay expires = karma~ just finished playing.
    // The TUI uses it as ground truth for when the audio actually ended — the WebSocket
    // arrival time is the precise end signal, and the bar snaps to 100% on receipt.
    if (track) {
        outlet(1, "segmentEnd", track);
    } else {
        for (var se = 0; se < TRACKS.length; se++) outlet(1, "segmentEnd", TRACKS[se]);
    }
    if (track) {
        // If this stem is looping, replay the locked position
        // Trigger mode: pause instead of auto-selecting — wait for manual fire
        if (TRIGGER_MODE[track] && !loopState[track]) {
            triggerReady[track] = true;
            outlet(1, "triggerReady", track, 1);
            post("EBYS Slicer: [" + track + "] trigger mode — waiting for pad fire\n");
            return;
        }
        if (loopState[track]) {
            var lp = loopState[track];
            var loopSliceRef = byTrack[track] && byTrack[track][lp.startIdx];
            var lpDurMs   = (loopSliceRef && loopSliceRef.stemDurMs) || stemDurMs[track] || 0;
            var lpSlot    = (loopSliceRef && loopSliceRef.slot) || 0;
            var loopSegMs  = lpDurMs > 0 ? Math.round((lp.endTime - lp.startTime) * lpDurMs) : 4000;
            var loopStretchR = stretchRatioForSlice(loopSliceRef || {});
            var loopSyncGroup = collectSyncGroup(track);
            var loopCycleId   = ++syncCycleCounter;
            outlet(0, track, lpSlot, lp.startTime, lp.endTime, loopStretchR, loopSegMs, loopCycleId, loopSyncGroup.length);
            // Emit desc so TUI gets fresh descriptor values for this loop cycle
            var loopSlice = byTrack[track] && byTrack[track][lp.startIdx];
            if (loopSlice) {
                outlet(1, "desc", track, loopSlice.C, loopSlice.S, loopSlice.E, loopSlice.F,
                       loopSlice.P, loopSlice.H, loopSlice.T,
                       loopSlice.tension_C, loopSlice.tension_E, loopSlice.tension_F,
                       loopSlice.tension_P, loopSlice.tension_H, loopSlice.tension_T);
                outlet(1, "stemMS", track, loopSlice.pan, loopSlice.width);
            }
            // Tell TUI the actual playback duration (content × stretch) so progress bar animates
            var actualLoopMs = loopSegMs > 0 ? Math.round(loopSegMs * loopStretchR) : loopSegMs;
            outlet(1, "segPlayMs", track, actualLoopMs);
            // ── SEAM DRIFT PROBE ──────────────────────────────────────────────
            // lastSegment[track] still holds the PREVIOUS cycle's dispatch time
            // here (it's rebuilt below), so Date.now()-dispatchedAtMs is the
            // real wall-clock period the re-trigger timer just produced. Compare
            // to the intended actualLoopMs: positive drift = timer fired LATE
            // (silent gap before re-seek); negative = timer fired EARLY (audio
            // cut off). Near-zero drift means the timer is accurate and the skip
            // is a loop-point/zero-crossing alignment issue instead.
            if (SEAM_DEBUG) {
                var _prevDisp = (lastSegment[track] && lastSegment[track].dispatchedAtMs) || 0;
                var _measured = _prevDisp ? (Date.now() - _prevDisp) : 0;
                post("EBYS Seam[" + track + "]: win " + lp.startTime.toFixed(4) + "→"
                     + lp.endTime.toFixed(4) + " content=" + loopSegMs + "ms stretch="
                     + loopStretchR.toFixed(3) + " intended=" + actualLoopMs + "ms measured="
                     + _measured + "ms drift=" + (_measured - actualLoopMs) + "ms\n");
            }
            loopCycles[track]++;
            outlet(1, "seg", track, "loop" + loopCycles[track], lp.bars + "bars", "(looping)");
            // Keep lastSegment[track] fresh even while looping, and push the
            // identical loop window to any locked followers. Without this, a
            // leader that enters loop mode silently stalls its followers —
            // their own next() just keeps posting "waiting for leader"
            // forever, because lastSegment[track] would otherwise still hold
            // whatever was selected right before looping started and never
            // update again.
            lastSegment[track] = {
                slot: lpSlot, sourceTrack: (loopSliceRef && loopSliceRef.sourceTrack) || null,
                time: lp.startTime, endFrac: lp.endTime,
                stretchR: loopStretchR, segDurMsForOutlet: loopSegMs,
                actualPlayMs: actualLoopMs, durMs: lpDurMs,
                sliceMs: lpDurMs > 0 ? Math.round(lp.startTime * lpDurMs) : 0,
                srcBpm: resolveSrcBpm(loopSliceRef && loopSliceRef.sourceTrack), dispatchedAtMs: Date.now(),
                cycleId: loopCycleId
            };
            var loopFollowers = syncFollowers[track];
            if (loopFollowers && loopFollowers.length > 0) {
                for (var lfi = 0; lfi < loopFollowers.length; lfi++) {
                    pushSyncedSegment(track, loopFollowers[lfi], loopCycleId, loopSyncGroup.length);
                }
            }
        } else if (sourceLock[track] && lastSegment[sourceLock[track]]) {
            // Locked follower: this stem's own independent auto-next delay
            // just expired. Every regular cycle, the LEADER's own next()/
            // selectSegment() already pushes this follower a fresh segment
            // through the normal barrier-synced path (selectSegment()'s
            // followers loop, or next()'s loop/sourceLock-pull branches) —
            // and thanks to the sync barrier, that push starts this
            // follower's own delay at the exact same tick as the leader's,
            // with the same duration, so in steady state the two delays
            // expire together too. That used to make this branch fire EVERY
            // cycle as an unconditional extra pushSyncedSegment() call,
            // racing the leader's own already-in-flight push for the same
            // stem — buffer_manager.js only holds one pending compose per
            // stem, so the second call could stomp the first's bookkeeping
            // before its done-bang arrived, get registered against a solo
            // (groupSize=1) cycle instead of the real barrier group, and
            // commit immediately — independent of, and often before, the
            // rest of the locked group's actual barrier-coordinated commit.
            // That's what produced audible early jumps despite everything
            // being on the same source track with the same segmentBars.
            //
            // Fix: only pull if this follower's own lastSegment isn't
            // already tagged with the leader's current cycleId — i.e. only
            // when the leader genuinely hasn't reached it yet (right after a
            // fresh :lockSource, a leader source change, or this follower
            // having been mid-loop/mid-trigger a moment ago). If the cycleId
            // already matches, the leader's own push already covered this
            // cycle and pulling again would just be the redundant duplicate
            // described above.
            var leaderSeg = lastSegment[sourceLock[track]];
            var mySeg     = lastSegment[track];
            if (mySeg && mySeg.cycleId === leaderSeg.cycleId) {
                post("EBYS Slicer: [" + track + "] own timer fired but already synced to leader's cycle "
                     + leaderSeg.cycleId + " — skipping redundant self-pull\n");
            } else {
                // Solo barrier (group of one) — by the time this fires the
                // leader's own segment has already committed and is already
                // playing; there's nothing else to wait on here, this stem
                // should just catch up as soon as its own compose finishes.
                pushSyncedSegment(sourceLock[track], track, ++syncCycleCounter, 1);
            }
        } else {
            selectSegment(track);
        }
    } else {
        // No track given — fire all 4. Same guard as applyNow()/start(): skip
        // locked followers directly, the leader's own reselection already
        // pushes them a synced segment via selectSegment()'s follower loop.
        for (var t = 0; t < TRACKS.length; t++) {
            if (!sourceLock[TRACKS[t]]) selectSegment(TRACKS[t]);
        }
    }
}

// forceNext <stem|all>  — manual "skip to next slice now" command. This is
// what the TUI's ":next <stem>" (and bare ":next") actually calls —
// ws_server.js renames the user's "next" atom to "forceNext" before it
// reaches here specifically so it can never collide with next() above,
// which every stem's own auto-advance delay timer also calls whenever a
// segment naturally finishes playing.
//
// Deliberately a SEPARATE function rather than reusing next(track): once a
// message lands on this inlet as "<verb> <stem>" there's no way to tell
// whether it came from a delay timer expiring or from a user typing a
// command — both look identical to Max. That distinction matters because
// next()'s locked-follower branch (the Q2 self-pull guard, see above)
// intentionally SKIPS re-pulling a follower that's already synced to its
// leader's current cycleId, to avoid a redundant duplicate dispatch racing
// the leader's own barrier-coordinated push. That guard is correct for the
// automatic case, but wrong here — a user explicitly asking "give bass its
// next slice now" should always get a genuinely new pick, not a silent
// no-op just because bass happened to already be caught up.
//
// For a locked follower specifically, forceNext also can't just call
// selectSegment(follower) directly: a follower always plays whatever window
// pushSyncedSegment() copies from its LEADER's own seg.time/endFrac (see
// pushSyncedSegment — findNearestSlice()/nearest is cosmetic-only, never
// used for the actual audio range), so giving the follower its own
// independently-picked slice would instantly desync it from the group it's
// deliberately locked to. Advancing the LEADER instead is the musically
// correct "next slice" for a locked follower — selectSegment()'s own
// followers loop then pushes that same new window to every locked
// follower, this one included, keeping the lock intact.
function forceNext(stemOrAll) {
    if (!running) {
        post("EBYS Slicer: forceNext — not running\n");
        return;
    }
    var arg = stemOrAll ? String(stemOrAll) : 'all';
    if (arg === 'all') {
        for (var t = 0; t < TRACKS.length; t++) {
            if (!sourceLock[TRACKS[t]]) forceNextOne(TRACKS[t]);
        }
        post("EBYS Slicer: forceNext all\n");
        return;
    }
    if (!TRACKS.includes(arg)) {
        post("EBYS Slicer: forceNext — unknown stem '" + arg + "'\n");
        return;
    }
    var target = sourceLock[arg] || arg; // locked follower -> advance its leader instead
    forceNextOne(target);
    post("EBYS Slicer: forceNext [" + arg + "]"
         + (target !== arg ? " — locked to '" + target + "', advancing leader instead\n" : "\n"));
}

// Shared "make this specific (unlocked/leader) stem pick something new right
// now" step used by forceNext() above. Clears any loop/trigger state first —
// same as lockSourcePair() does when a fresh lock is set — so the forced
// pick isn't immediately overridden the next time this stem's own next()
// fires (which checks TRIGGER_MODE and loopState BEFORE ever reaching plain
// selection).
function forceNextOne(track) {
    if (loopState[track]) {
        loopState[track] = null;
        outlet(1, "unloop", track);
    }
    if (TRIGGER_MODE[track]) {
        TRIGGER_MODE[track] = false;
        triggerReady[track] = false;
        outlet(1, "triggerMode", track, 0);
    }
    selectSegment(track);
}

// loop <track> <bars>  — lock stem to current or next segment of N bars
function loop(track, bars) {
    if (sourceLock[track]) {
        // Looping a locked follower would pick its start/end straight from
        // its own full byTrack array — ignoring the lock's source-track
        // restriction entirely, so it could land on a completely different
        // source track than the leader, not just a different moment of the
        // right one. next()'s dispatch also checks loopState BEFORE
        // sourceLock, so a loop set here would silently take over and the
        // stem would stop following its leader at all. Refuse instead of
        // quietly breaking the lock — unlock first if looping is really
        // what's wanted.
        post("EBYS Slicer: loop — [" + track + "] is source-locked to '"
             + sourceLock[track] + "' — unlockSource it first if you want to loop it independently\n");
        return;
    }
    var arr = byTrack[track];
    if (!arr || arr.length === 0) {
        post("EBYS Slicer: loop — no slices for " + track + "\n");
        return;
    }
    // Bug fix: was `|| SEGMENT_BARS` (the whole per-track object, not a
    // number) whenever no bars argument was given — `barMs * {object}` is
    // NaN, so `targetMs` was NaN, the accumulation loop's `< targetMs` check
    // was always false (nothing is less than NaN), and the "ensure minimum 1
    // bar" fallback below silently kicked in every time — a bare `:loop
    // <stem>` with no bars arg always produced a 1-bar loop instead of the
    // stem's actual SEGMENT_BARS length.
    bars = parseFloat(bars) || SEGMENT_BARS[track];

    // Use first available slice's sourceTrack for madmom BPM — best effort for loop()
    // since we don't have a chosen slice yet. Recompute after startSlice is picked if needed.
    var firstSrc = arr.length > 0 ? arr[0].sourceTrack : null;
    var bpm      = effectiveBPMForSource(firstSrc);
    var barMs    = getBarMs(track, bpm, firstSrc);
    var targetMs = barMs * bars;
    var durMs    = stemDurMs[track] || 0;

    // Select a fresh segment as the loop anchor (same logic as selectSegment)
    var pool = [];
    for (var pi = 0; pi < arr.length; pi++) pool.push(pi);
    var startIdx = hasActiveCriteria(track)
        ? (function() {
            var agentPool  = filterPoolByAgentMode(pool, arr, track);
            var scoredPool = applyLearnedRefusal(agentPool, arr, track, lastEndDesc[track]);
            var best = scoredPool[0], bestSc = Infinity;
            for (var pi = 0; pi < scoredPool.length; pi++) {
                var sc = scoreCandidate(arr[scoredPool[pi]], lastEndDesc[track], track);
                if (sc < bestSc) { bestSc = sc; best = scoredPool[pi]; }
            }
            return best;
          })()
        : pool[Math.floor(Math.random() * pool.length)];
    var startSlice = arr[startIdx];

    var totalFrac = 0, i = startIdx;
    if (durMs > 0) {
        while (i < arr.length && (totalFrac * durMs) < targetMs) {
            totalFrac += arr[i].dur; i++;
        }
        if ((totalFrac * durMs) < barMs) totalFrac = barMs / durMs;
    } else {
        var count = 0;
        while (i < arr.length && count < Math.max(4, Math.round(SEGMENT_BARS * 8))) { totalFrac += arr[i].dur; i++; count++; }
    }

    var endTime = Math.min(startSlice.time + totalFrac, 1.0);
    loopState[track] = { bars: bars, startIdx: startIdx,
                         startTime: startSlice.time, endTime: endTime };

    post("EBYS Slicer: loop " + track + " @" + bars + " bars"
         + "  [" + startSlice.time.toFixed(3) + " → " + endTime.toFixed(3) + "]\n");
    outlet(1, "loop", track, bars, "locked");
}

// unloop <track>  — release stem back to normal selection
function unloop(track) {
    if (loopState.hasOwnProperty(track)) {
        loopState[track] = null;
        post("EBYS Slicer: unloop " + track + "\n");
        outlet(1, "unloop", track);
    }
}

// Remove `follower` from whichever syncFollowers[*] list currently holds it —
// called before re-adding it elsewhere so a stem is never listed under two
// leaders at once (which previously left a stale entry any time a follower
// was re-locked to a *different* leader — one visible symptom of "lockSource
// doesn't work": the old leader kept pushing segments to it too).
function removeFromSyncFollowers(follower) {
    var leaders = Object.keys(syncFollowers);
    for (var i = 0; i < leaders.length; i++) {
        var list = syncFollowers[leaders[i]];
        var idx  = list.indexOf(follower);
        if (idx !== -1) list.splice(idx, 1);
    }
}

// lockSource <leader> <follower> [follower2] [follower3] ...
// Follower(s) always select from the same source track as leader. Accepts one
// or more followers in a single call so ":lockSource melody vocals drums bass"
// locks all three to melody at once — previously this silently locked only
// the FIRST follower (vocals) and dropped the rest, because the old
// lockSource(leader, follower) only ever read its first two formal
// parameters; Max still passed every atom through, the extra ones just went
// nowhere. That's exactly what produced "the tracks are not the same and
// they aren't synchronized" — drums and bass never actually got locked.
function lockSource() {
    var args = arrayfromargs(arguments);
    var leader = args[0];
    var followers = args.slice(1);
    if (followers.length === 0) {
        post("EBYS Slicer: lockSource — need at least one follower\n");
        return;
    }
    for (var fi = 0; fi < followers.length; fi++) {
        lockSourcePair(leader, followers[fi]);
    }
}

// Single leader→follower lock, called once per follower by lockSource() above.
function lockSourcePair(leader, follower) {
    if (!TRACKS.includes(leader) || !TRACKS.includes(follower)) {
        post("EBYS Slicer: lockSource — unknown stem '" + leader + "' or '" + follower + "'\n");
        return;
    }
    if (leader === follower) {
        post("EBYS Slicer: lockSource — leader and follower can't both be '" + leader + "'\n");
        return;
    }
    // Cycle guard: walk the leader chain — if `follower` is already an ancestor
    // of `leader` (directly or transitively), locking would create a loop where
    // each side keeps re-triggering the other's selectSegment().
    var chainNode = leader;
    var seen      = {};
    while (sourceLock[chainNode]) {
        if (seen[chainNode]) break; // already-broken chain elsewhere — don't loop forever here
        seen[chainNode] = true;
        chainNode = sourceLock[chainNode];
        if (chainNode === follower) {
            post("EBYS Slicer: lockSource — would create a cycle (" + follower + " → … → " + leader + " → " + follower + ") — ignored\n");
            return;
        }
    }
    removeFromSyncFollowers(follower);
    sourceLock[follower] = leader;
    syncFollowers[leader].push(follower);
    // Release any independent state on the follower that would otherwise
    // outrank the new lock — next()'s dispatch checks TRIGGER_MODE and
    // loopState BEFORE sourceLock, so a follower left mid-loop or mid-trigger-
    // pause from before this lock would keep waiting on its own forever and
    // the brand new lock would never actually take hold. This is a state-only
    // clear, not a retrigger — the follower's current audio isn't touched.
    if (loopState[follower]) {
        loopState[follower] = null;
        post("EBYS Slicer: lockSource — cleared [" + follower + "]'s independent loop to honor the new lock\n");
        outlet(1, "unloop", follower);
    }
    if (TRIGGER_MODE[follower]) {
        TRIGGER_MODE[follower] = false;
        triggerReady[follower] = false;
        post("EBYS Slicer: lockSource — cleared [" + follower + "]'s trigger mode to honor the new lock\n");
        outlet(1, "triggerMode", follower, 0);
        outlet(1, "triggerReady", follower, 0);
    }
    post("EBYS Slicer: sourceLock[" + follower + "] → " + leader + "  (takes effect at [" + follower + "]'s next slice)\n");
    outlet(1, "lockSource", follower, leader);
    // Deliberately NOT snapping the follower onto the leader's current
    // segment here — per explicit request, entering a command shouldn't cut
    // off whatever's already playing. The follower keeps playing its current
    // slice to the end; the lock actually takes hold at the follower's own
    // next natural slice boundary (see next()'s sourceLock dispatch branch,
    // which pulls in the leader's current segment at that point instead of
    // picking independently).
}

// unlockSource <stem | "all">  — release source lock
function unlockSource(stem) {
    if (String(stem) === 'all') {
        var tks = Object.keys(sourceLock);
        for (var i = 0; i < tks.length; i++) sourceLock[tks[i]] = null;
        var lks = Object.keys(syncFollowers);
        for (var i = 0; i < lks.length; i++) syncFollowers[lks[i]] = [];
        post("EBYS Slicer: all source locks released\n");
        outlet(1, "unlockSource", "all");
    } else if (sourceLock.hasOwnProperty(stem)) {
        sourceLock[stem] = null;
        removeFromSyncFollowers(stem);
        post("EBYS Slicer: sourceLock[" + stem + "] cleared\n");
        outlet(1, "unlockSource", stem);
    }
}

// unloopAll  — release all stems
function unloopAll() {
    var tracks = Object.keys(loopState);
    for (var i = 0; i < tracks.length; i++) loopState[tracks[i]] = null;
    post("EBYS Slicer: all loops released\n");
    outlet(1, "unloop", "all");
}

// ── TRIGGER PAD COMMANDS ──────────────────────────────────────────────────────

// trigger [track]
//   Fire the paused stem immediately — probabilistic slice selection fires now.
//   If no track given, fires all paused stems.
function trigger(track) {
    if (!running) return;
    if (track && TRACKS.indexOf(track) !== -1) {
        if (!triggerReady[track]) {
            post("EBYS Slicer: trigger [" + track + "] — stem not paused (triggerReady=false)\n");
            return;
        }
        triggerReady[track] = false;
        outlet(1, "triggerReady", track, 0);
        selectSegment(track);
    } else {
        // Fire all paused stems
        for (var t = 0; t < TRACKS.length; t++) {
            if (triggerReady[TRACKS[t]]) {
                triggerReady[TRACKS[t]] = false;
                outlet(1, "triggerReady", TRACKS[t], 0);
                selectSegment(TRACKS[t]);
            }
        }
    }
}

// setTriggerMode track 0|1
//   0 = back to continuous auto-play
//   1 = stem pauses at each slice boundary; waits for manual trigger() call
//   When disabling, any stem that was paused (triggerReady) resumes immediately.
function setTriggerMode(track, onOff) {
    var on = (parseInt(onOff) !== 0);
    // Trigger mode takes priority over sourceLock in next()'s dispatch (it's
    // checked first), so enabling it on a locked follower would silently pause
    // it forever instead of following its leader, and the disable-resume path
    // below independently reselects the same way applyNow()/loop() did before
    // their fix — same guard needed here on both sides.
    if (track === 'all') {
        for (var t = 0; t < TRACKS.length; t++) {
            var tr = TRACKS[t];
            if (on && sourceLock[tr]) {
                post("EBYS Slicer: setTriggerMode — skipping [" + tr + "] (source-locked to '"
                     + sourceLock[tr] + "') — unlockSource it first if you want to trigger-pad it independently\n");
                continue;
            }
            TRIGGER_MODE[tr] = on;
            if (!on && triggerReady[tr]) {
                triggerReady[tr] = false;
                outlet(1, "triggerReady", tr, 0);
                if (running && !sourceLock[tr]) selectSegment(tr);
            }
        }
        outlet(1, "triggerMode", "all", on ? 1 : 0);
    } else if (TRIGGER_MODE.hasOwnProperty(track)) {
        if (on && sourceLock[track]) {
            post("EBYS Slicer: setTriggerMode — [" + track + "] is source-locked to '"
                 + sourceLock[track] + "' — unlockSource it first if you want to trigger-pad it independently\n");
            return;
        }
        TRIGGER_MODE[track] = on;
        if (!on && triggerReady[track]) {
            triggerReady[track] = false;
            outlet(1, "triggerReady", track, 0);
            if (running && !sourceLock[track]) selectSegment(track);
        }
        outlet(1, "triggerMode", track, on ? 1 : 0);
    } else {
        post("EBYS Slicer: setTriggerMode — unknown stem '" + track + "'\n");
        return;
    }
    post("EBYS Slicer: triggerMode[" + track + "] = " + on + "\n");
}

// ── NEAREST-NEIGHBOUR SELECTION ───────────────────────────────────────────────
//
// In Max, replace [msg "next melody"] with this chain:
//
//   outlet 1 of js slicer.js outputs after each slice:
//     "desc melody C E F P"   ← current slice descriptors
//
//   Store C E F P in four [f] boxes.
//   When delay fires → instead of "next melody", send:
//     "nextNearest melody C E F P"
//   to js slicer.js inlet.
//
// Weights control how much each descriptor matters in the distance formula,
// PER STEM. Send "setWeight vocals C 1.0" etc. to tune one stem from Max, or
// "setWeight all C 1.0" to set every stem the same way.
//
function defaultWeights() { return { C: 1.0, S: 0.8, E: 2.0, F: 0.5, P: 1.5, H: 1.0, T: 1.5 }; }
var WEIGHTS = {
    vocals: defaultWeights(), melody: defaultWeights(),
    bass:   defaultWeights(), drums:  defaultWeights()
};
// E weighted highest: energy continuity is most audible.
// P second: pitch continuity holds harmonic coherence.
// T second: timbre (MFCC RMS) fingerprints instrument character well.
// C: brightness continuity.
// S: spectral spread — how wide the energy band is. Slightly below C.
// H: chroma (harmonic colour) — same weight as C.
// F lowest: flatness/noisiness matters less.

// setWeight <stem|all> <dim> <val> — per-stem descriptor weight.
function setWeight(stem, dim, val) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!WEIGHTS[t] || !WEIGHTS[t].hasOwnProperty(dim)) continue;
        WEIGHTS[t][dim] = parseFloat(val);
        post("EBYS Slicer: weight[" + t + "][" + dim + "] = " + WEIGHTS[t][dim] + "\n");
        outlet(1, "param", "weight" + dim + "_" + t, WEIGHTS[t][dim]);
    }
}

// Normalisation ranges — updated at buildIndex time.
// Keeps C (0–22000 Hz) and P (0–4000 Hz) on the same scale as E (-60–0).
// H is already 0–1; T (MFCC RMS) varies ~0–200 depending on material.
// D (density) is already 0–1 from add_tension.py's within-track normalization.
var norm = { C: 1, S: 1, E: 1, F: 1, P: 1, H: 1, T: 1, D: 1 };

// track selects which stem's WEIGHTS to score against — its only caller
// (nextNearest) already has track in scope.
function normalisedDist(a, b, track) {
    var w = WEIGHTS[track] || defaultWeights();
    var dC = (a.C - b.C) / (norm.C || 1);
    var dS = ((a.S || 0) - (b.S || 0)) / (norm.S || 1);
    var dE = (a.E - b.E) / (norm.E || 1);
    var dF = (a.F - b.F) / (norm.F || 1);
    var dP = (a.P - b.P) / (norm.P || 1);
    var dH = (a.H - b.H) / (norm.H || 1);
    var dT = ((a.T || 0) - (b.T || 0)) / (norm.T || 1);
    return w.C * dC*dC
         + w.S * dS*dS
         + w.E * dE*dE
         + w.F * dF*dF
         + w.P * dP*dP
         + w.H * dH*dH
         + w.T * dT*dT;
}

// Max sends: nextNearest melody <C> <E> <F> <P>
function nextNearest(track, C, E, F, P) {
    if (!running) return;
    var arr = byTrack[track];
    if (!arr || arr.length === 0) { selectSegment(track); return; }

    var ref = { C: parseFloat(C), E: parseFloat(E),
                F: parseFloat(F), P: parseFloat(P) };

    // Find slice with smallest descriptor distance to ref.
    // Skip the slice that just played (lastIdx) to avoid looping the same cut.
    // No pool array here (unlike selectSegment/loop) — this is already a
    // full linear scan, so the learned-refusal check is inlined as one more
    // `continue` alongside the lastIdx skip rather than going through
    // applyLearnedRefusal(), which expects an index array to filter.
    var endDesc = getBlendedEndDesc(track);
    var ltw = LEARNED_TRANS_WEIGHT[track]; if (ltw === undefined) ltw = 1.0;
    var lvw = LEARNED_VERT_WEIGHT[track];  if (lvw === undefined) lvw = 1.0;
    var bestIdx = -1, bestDist = Infinity;
    for (var i = 0; i < arr.length; i++) {
        if (i === lastIdx[track]) continue;
        if (TRANSITION_BIAS && ltw > 0) {
            var tq = predictTransitionQuality(arr[i], endDesc);
            if (tq !== null && tq < LEARNED_REFUSE_THRESHOLD) continue;
        }
        if (VERTICAL_BIAS && lvw > 0) {
            var vq = predictVerticalQuality(arr[i], track);
            if (vq !== null && vq < LEARNED_REFUSE_THRESHOLD) continue;
        }
        var d = normalisedDist(arr[i], ref, track) + scoreCandidate(arr[i], endDesc, track);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    // Refusing everything would leave bestIdx at -1 with real candidates
    // still available — same "don't block selection" guarantee as
    // applyLearnedRefusal(), just done here via a second, unfiltered pass
    // instead of falling straight to the lastIdx repeat below (which is
    // meant for the genuinely-only-one-slice-exists case).
    if (bestIdx < 0) {
        for (var i2 = 0; i2 < arr.length; i2++) {
            if (i2 === lastIdx[track]) continue;
            var d2 = normalisedDist(arr[i2], ref, track) + scoreCandidate(arr[i2], endDesc, track);
            if (d2 < bestDist) { bestDist = d2; bestIdx = i2; }
        }
    }
    if (bestIdx < 0) bestIdx = lastIdx[track]; // fallback: repeat if only 1 slice

    lastIdx[track] = bestIdx;

    // Same duration accumulation as selectSegment
    var durMs    = stemDurMs[track] || 0;
    var hasDur   = durMs > 0;
    var bpm      = effectiveBPMForSource(arr[bestIdx] && arr[bestIdx].sourceTrack);
    var barMs    = getBarMs(track, bpm, arr[bestIdx] && arr[bestIdx].sourceTrack);
    var targetMs = barMs * SEGMENT_BARS[track];

    var totalFrac = 0, i = bestIdx;
    if (hasDur) {
        while (i < arr.length && (totalFrac * durMs) < targetMs) {
            totalFrac += arr[i].dur; i++;
        }
        if ((totalFrac * durMs) < barMs) totalFrac = barMs / durMs;
    } else {
        var count = 0;
        var fallbackCount = Math.max(4, Math.round(SEGMENT_BARS[track] * 8));
        while (i < arr.length && count < fallbackCount) {
            totalFrac += arr[i].dur; i++; count++;
        }
    }

    var s      = arr[bestIdx];
    var endFrac = Math.min(s.time + totalFrac, 1.0);
    lastSlice   = { track: track, time: s.time, dur: totalFrac };

    lastEndDesc[track] = {
        C: s.endC, S: s.endS, E: s.endE, F: s.endF, P: s.endP, H: s.endH, T: s.endT,
        tension_C: s.tension_C, tension_E: s.tension_E, tension_F: s.tension_F,
        tension_P: s.tension_P, tension_H: s.tension_H, tension_T: s.tension_T
    };

    var sliceMs = hasDur ? Math.round(s.time * durMs) : 0;

    outlet(0, track, sliceMs, Math.round(totalFrac * durMs), stretchRatioFor(track));
    outlet(1, "desc",      track, s.C, s.S, s.E, s.F, s.P, s.H, s.T,
           s.tension_C, s.tension_E, s.tension_F,
           s.tension_P, s.tension_H, s.tension_T);
    outlet(1, "slice_ms",  track, sliceMs);
    outlet(1, "stemTrack", track, cleanTrackName(track));
    outlet(1, "seg", track, s.id,
           hasDur ? (Math.round(totalFrac * durMs) + "ms") : (totalFrac.toFixed(3) + " frac"),
           "dist=" + bestDist.toFixed(2),
           s.time, endFrac);
}

// ── PARAMETER SETTERS ─────────────────────────────────────────────────────────

function setSegmentBars(trackOrN, n) {
    // setSegmentBars 4           → all tracks
    // setSegmentBars vocals 2    → vocals only
    // Explicitly setting a bar count is a real state-changing command, so it
    // also switches the affected stem(s) OUT of PLAY_FULL_FILE (the default)
    // and into bar-chunked slicing — otherwise the new SEGMENT_BARS value
    // would just sit there unused, since full-file mode ignores it entirely.
    //
    // Deliberately does NOT reselect/retrigger anything currently playing —
    // this only updates state. Whatever's already sounding keeps playing
    // uninterrupted; the new bar count takes effect the next time each
    // affected stem naturally reaches its own slice boundary (next()'s
    // normal dispatch reads the updated SEGMENT_BARS at that point). Per
    // explicit request: entering a command shouldn't cut off what's playing
    // — only pitch/BPM changes affect already-sounding audio directly.
    if (n === undefined) {
        // single-arg form: apply to all
        var val = parseFloat(trackOrN);
        if (val > 0 && val <= 64) {
            for (var t = 0; t < TRACKS.length; t++) {
                SEGMENT_BARS[TRACKS[t]] = val;
                PLAY_FULL_FILE[TRACKS[t]] = false;
            }
            post("EBYS Slicer: segmentBars (all) = " + val + "  (playFullFile disabled, takes effect next slice)\n");
            outlet(1, "segmentBars", "all", val);
            outlet(1, "playFullFile", "all", 0);
        }
    } else {
        var track = trackOrN;
        var val   = parseFloat(n);
        if (SEGMENT_BARS.hasOwnProperty(track) && val > 0 && val <= 64) {
            SEGMENT_BARS[track] = val;
            PLAY_FULL_FILE[track] = false;
            post("EBYS Slicer: segmentBars[" + track + "] = " + val + "  (playFullFile disabled, takes effect next slice)\n");
            outlet(1, "segmentBars", track, val);
            outlet(1, "playFullFile", track, 0);
        }
    }
}

function seamDebug(v) {
    SEAM_DEBUG = (parseInt(v) !== 0);
    post("EBYS Slicer: seamDebug = " + SEAM_DEBUG + "\n");
}

function setQuantize(v) {
    QUANTIZE_BARS = (parseInt(v) !== 0);
    post("EBYS Slicer: quantize = " + QUANTIZE_BARS + " (takes effect next slice)\n");
    outlet(1, "quantize", QUANTIZE_BARS ? 1 : 0);
    // No applyNow() — state-only change, per explicit request commands don't
    // cut off currently-playing audio. Applies the next time each stem
    // naturally reselects.
}

// setQuantizeStop 0|1 — toggles whether :stop freezes immediately or waits
// for the next downbeat (see stop()/msUntilNextDownbeat()). Turning it off
// while a quantized stop is already pending lets that pending one finish on
// schedule rather than yanking it — only affects the NEXT :stop.
function setQuantizeStop(v) {
    QUANTIZE_STOP = (parseInt(v) !== 0);
    post("EBYS Slicer: quantizeStop = " + QUANTIZE_STOP + " (takes effect next :stop)\n");
    outlet(1, "quantizeStop", QUANTIZE_STOP ? 1 : 0);
}

// reloadDownbeats — hot-reload ../downbeats.json without re-running buildIndex.
// Send this message from Max after running allin1_tagger.py on a track that's
// already loaded (so you don't have to re-analyse in FluCoMa just to pick up
// the new downbeat data).
//
// loadDownbeats() prefers `downbeatsRaw` (the cached blob assembled from
// ws_server's downbeatchunk stream) over reading the file directly — see its
// own comment. That's fine right after boot, but once downbeatsRaw is set it
// is NEVER refreshed on its own: ws_server only sends that stream when asked.
// This used to just call loadDownbeats() again, which re-applied the SAME
// stale downbeatsRaw every time — a silent no-op against disk. An earlier
// attempt at fixing this cleared downbeatsRaw and fell through to
// loadDownbeats()'s OTHER path — a direct `new File(...)` read from inside
// Max's JS engine — but that path is unproven: getDataDir() is used nowhere
// else in this file, so its patcher.filepath-derived path string had never
// actually been exercised, and File.isopen failing returns silently with no
// post() at all. Both risks are avoidable: ws_server.js already has a
// battle-tested handler for exactly this — `need_downbeats` — which
// loadbang() itself calls every time this very file autowatch-reloads (see
// its comment: "repopulated even after an autowatch-triggered reload that
// wiped downbeatsRaw"). It does a real Node fs.readFileSync of the CURRENT
// downbeats.json and re-sends it via the same sendChunked('downbeatchunk')
// path already proven at boot — which lands back here via downbeatchunk()'s
// own existing "if (idx.length > 0) loadDownbeats()" call. Reuse that
// instead of a second, untested read path.
function reloadDownbeats() {
    outlet(1, "need_downbeats");
    post("EBYS Slicer: reloadDownbeats — requested fresh downbeats.json from ws_server\n");
}

// loadbang — called automatically by Max every time this JS file loads or
// reloads (autowatch). Requests ws_server to resend downbeats.json so
// trackDownbeats is repopulated even after an autowatch-triggered reload
// that wiped downbeatsRaw.
function loadbang() {
    outlet(1, "need_downbeats");
    outlet(1, "need_learnedBias");
    // Note: globalBPM is not emitted here because node.script isn't ready yet at loadbang time.
    // The TUI receives it via the param broadcast when slicer emits it from setGlobalBPM().
}

// Catch-all: ws_server fans EVERY command to every JS object in parallel
// (slicer, eq_router, spat_fx_router, buffer_manager), plus the slicer route's
// unmatched outlet dumps here too. Commands owned by the other routers (eqHigh,
// width, joystick, fader, …) therefore land on slicer with no matching function
// and used to spam "js: no function <cmd> [slicer.js]" for every single param
// move. This no-op absorbs anything slicer doesn't handle. Real slicer commands
// still dispatch by name — Max only calls anything() when no named function
// matches — so this changes nothing except silencing the false-alarm errors.
function anything() {}

function setStayProb(trackOrV, v) {
    // setStayProb 0.5          → all tracks
    // setStayProb drums 0.8   → drums only
    if (v === undefined) {
        var val = clamp(parseFloat(trackOrV), 0.0, 1.0);
        for (var t = 0; t < TRACKS.length; t++) STAY_PROB[TRACKS[t]] = val;
        post("EBYS Slicer: stayProb (all) = " + val + "\n");
        outlet(1, "stayProb", "all", val);
    } else {
        var track = trackOrV;
        var val   = clamp(parseFloat(v), 0.0, 1.0);
        if (STAY_PROB.hasOwnProperty(track)) {
            STAY_PROB[track] = val;
            post("EBYS Slicer: stayProb[" + track + "] = " + val + "\n");
            outlet(1, "stayProb", track, val);
        }
    }
}

// setStemSource <stem|all> <partial track name | clear>
// Pins a stem to only select slices from a specific source track.
// Track name is a partial, case-insensitive match.
// :setStemSource all "Come As You Are"  → all stems locked to Nirvana
// :setStemSource drums clear            → drums free again
function setStemSource() {
    var args    = arrayfromargs(arguments);
    var stem    = String(args[0] || '');
    var nameParts = args.slice(1);
    var name    = (nameParts.length && String(nameParts[0]).toLowerCase() !== 'clear')
                  ? nameParts.join(' ') : null;
    var targets = (stem === 'all') ? TRACKS : [stem];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (stemSourceFilter.hasOwnProperty(t)) {
            stemSourceFilter[t] = name;
            post("EBYS Slicer: stemSource[" + t + "] = " + (name || "any") + "\n");
            outlet(1, "stemSource", t, name || "any");
            // selectSegment()'s pool-building checks stemSourceFilter before
            // sourceLock — so a pin set here on a locked follower is stored
            // but has no effect until it's unlocked. Say so, rather than
            // leaving it a silent no-op.
            if (sourceLock[t]) {
                post("EBYS Slicer: stemSource[" + t + "] — [" + t + "] is source-locked to '"
                     + sourceLock[t] + "', this pin has no effect until it's unlocked\n");
            }
        }
    }
    // No applyNow() — state-only change, per explicit request commands don't
    // cut off currently-playing audio. The pin takes effect the next time
    // each affected stem naturally reselects.
}

// setSrcWeights <bpm_weight> <cohesion_weight>
// Tune the probabilistic source-track selection at runtime.
// Values are renormalised so they always sum to 1.0.
// :setSrcWeights 0.5 0.5   → equal BPM and cohesion importance
// :setSrcWeights 0 1       → pure cohesion (all stems lock to majority track)
// :setSrcWeights 1 0       → pure BPM match (ignore what other stems are doing)
// setSrcWeights <bpm_w> <cohesion_w> [key_w]  — key_w optional, defaults to 0
// so old 2-arg calls behave exactly as before (no harmonic weighting).
function setSrcWeights(bw, cw, kw) {
    bw = parseFloat(bw);
    cw = parseFloat(cw);
    kw = (kw === undefined) ? 0 : parseFloat(kw);
    if (isNaN(bw) || isNaN(cw) || isNaN(kw) || (bw + cw + kw) <= 0) {
        post("EBYS Slicer: setSrcWeights — invalid values\n"); return;
    }
    var sum = bw + cw + kw;
    SRC_BPM_WEIGHT      = bw / sum;
    SRC_COHESION_WEIGHT = cw / sum;
    SRC_KEY_WEIGHT       = kw / sum;
    post("EBYS Slicer: srcWeights bpm=" + SRC_BPM_WEIGHT.toFixed(2)
         + " cohesion=" + SRC_COHESION_WEIGHT.toFixed(2)
         + " key=" + SRC_KEY_WEIGHT.toFixed(2) + "\n");
    outlet(1, "srcWeights", SRC_BPM_WEIGHT, SRC_COHESION_WEIGHT, SRC_KEY_WEIGHT);
}

function setMaxSlices(n) {
    n = parseInt(n);
    MAX_SLICES_PER_STEM = (n > 0) ? n : 0;
    post("EBYS Slicer: maxSlices = " + (MAX_SLICES_PER_STEM || "unlimited") + "\n");
}

// BPM is the one deliberate exception to "commands don't retrigger currently-
// playing audio" (see setSegmentBars/setQuantize/setStemSource/lockSource
// above) — per explicit request, pitch and BPM changes affect the audio
// directly. What "directly" means was wrong until now, though: this used to
// call applyNow(), which RESELECTS brand new segments — a reroll to
// different content, playing from a fresh random/scored pick. A BPM control
// described as "a fader that speeds up or slows down the tempo" should never
// change WHAT's playing, only HOW FAST the thing already playing plays —
// exactly like a turntable/CDJ pitch fader. applyGlobalBPMLive() (below) is
// the real live-retime mechanism; applyNow() is no longer called from here.
function setFallbackBPM(n) {
    n = parseFloat(n);
    if (n > 40 && n < 280) {
        FALLBACK_BPM = n;
        post("EBYS Slicer: fallbackBPM = " + FALLBACK_BPM + "\n");
        applyGlobalBPMLive();
    }
}

// setGlobalBPM N  — force ALL stems to use N BPM, ignoring analysis
// setGlobalBPM 0  — clear override, resume using analyzed BPM
// BPM is a deliberate exception to the no-retrigger rule (see comment on
// setFallbackBPM above) — but "not retriggering" means retiming currently
// playing audio live, not rerolling to a new segment. See
// applyGlobalBPMLive() below.
function setGlobalBPM(n) {
    n = parseFloat(n);
    if (n === 0) {
        GLOBAL_BPM = 0;
        post("EBYS Slicer: globalBPM cleared — using analyzed BPM\n");
        // This outlet call was missing on the clear path — only the "set an
        // override" branch below sent it. ws_server.js's Max.addHandler
        // ('globalBPM', ...) is the ONLY thing that updates its own
        // state.globalBPM mirror, so clearing here left that mirror stuck at
        // the old override value even though GLOBAL_BPM was genuinely back
        // to 0 internally. The TUI's own optimistic client-side update (on
        // sending the command) masked this within the same session, but the
        // stale server-side value leaked into anything that reads
        // state.globalBPM independently of that one client — new TUI
        // connections' initial state dump, and updatePingTimer()'s BPM-based
        // ping interval — both of which would keep acting like the override
        // was still active after a clear.
        outlet(1, "globalBPM", GLOBAL_BPM);
        applyGlobalBPMLive();
    } else if (n > 40 && n < 280) {
        GLOBAL_BPM = n;
        // Was "+ SEGMENT_BARS" — string-concatenating a plain object prints
        // "[object Object]" instead of its contents (cosmetic only, but
        // useless for exactly the kind of debugging this session needed).
        post("EBYS Slicer: globalBPM = " + GLOBAL_BPM + " — applying live, segBars=" + JSON.stringify(SEGMENT_BARS) + "\n");
        outlet(1, "globalBPM", GLOBAL_BPM);
        applyGlobalBPMLive();
    } else {
        post("EBYS Slicer: setGlobalBPM rejected value: " + n + "\n");
    }
}

// Per-track live tempo retiming — the actual "BPM is a live fader" mechanism.
// Called by setGlobalBPM/setFallbackBPM instead of applyNow(): applyNow()
// reselects brand new segments (a reroll — cuts to different content), which
// is NOT what a tempo fader should do. A tempo fader should only change HOW
// FAST whatever's already playing plays, continuously — same content, same
// position in it, just sped up or slowed down. Future segment picks already
// automatically use the new BPM (GLOBAL_BPM/FALLBACK_BPM are read fresh by
// stretchRatioForSlice() every time a new segment is chosen), so nothing
// needs to change there — this function's only job is retiming what's
// ALREADY playing right now.
//
// For each of the 4 stems (regardless of lock status — a lock only affects
// which CONTENT a stem draws from; every stem's karma~ still needs to speed
// up/slow down together, in the same instant, for the mix to stay in time):
//   1. Work out how much of the current segment's native-tempo CONTENT has
//      already been consumed, from the wall-clock time elapsed since it was
//      dispatched and the OLD stretch ratio it was dispatched with — since
//      wallMs = contentMs × stretchR (see routeStem's delayMs comment in
//      slot_router.js), elapsedContentMs = elapsedWallMs / stretchR_old.
//   2. Recompute the stretch ratio against the NEW target BPM using the
//      segment's own srcBpm (stamped into lastSegment at dispatch time, or
//      copied straight across for locked followers — same sourceTrack, same
//      srcBpm as their leader).
//   3. Convert the REMAINING content into a new wall-clock duration at the
//      NEW stretch ratio — that's how much time the pending auto-next timer
//      should now have left before this segment naturally ends.
//   4. Push both the new karma~ speed (immediate, audible — karma~'s speed
//      inlet is live-controllable the same way gizmo~'s pitch ratio already
//      was) and the recalculated remaining delay (cancels and reschedules
//      the pending "next <track>" auto-trigger so segment boundaries still
//      land on the right content instead of being cut short or left
//      hanging) to slot_router.js via one outlet(0, "rescheduleLive", ...)
//      message per stem.
function applyGlobalBPMLive() {
    if (!running) {
        post("EBYS Slicer: applyGlobalBPMLive — skipped, not running\n");
        return;
    }
    var target = GLOBAL_BPM > 0 ? GLOBAL_BPM : FALLBACK_BPM;
    if (target <= 0) {
        post("EBYS Slicer: applyGlobalBPMLive — skipped, no valid target BPM\n");
        return;
    }
    var now = Date.now();
    for (var t = 0; t < TRACKS.length; t++) {
        var track = TRACKS[t];
        var seg = lastSegment[track];
        // Nothing playing yet, or no BPM known for this segment's source —
        // leave it alone (same "no stretch" fallback stretchRatioForSlice
        // uses when srcBpm can't be resolved).
        if (!seg || !seg.srcBpm || !seg.dispatchedAtMs) {
            post("EBYS Slicer: [" + track + "] applyGlobalBPMLive — skipped, "
                 + (!seg ? "no lastSegment yet" : (!seg.srcBpm ? "srcBpm missing" : "dispatchedAtMs missing"))
                 + "\n");
            continue;
        }

        var oldStretchR = seg.stretchR || 1.0;
        var newStretchR = seg.srcBpm / target;
        if (Math.abs(newStretchR - oldStretchR) < 1e-6) {
            post("EBYS Slicer: [" + track + "] applyGlobalBPMLive — skipped, already at target"
                 + "  srcBpm=" + seg.srcBpm + "  target=" + target
                 + "  stretchR=" + oldStretchR.toFixed(3) + "\n");
            continue;
        }

        var elapsedWallMs      = Math.max(0, now - seg.dispatchedAtMs);
        var contentTotalMs     = seg.segDurMsForOutlet || 0;
        var elapsedContentMs   = oldStretchR > 0 ? elapsedWallMs / oldStretchR : 0;
        var remainingContentMs = Math.max(0, contentTotalMs - elapsedContentMs);
        // This segment's basically over already — let the natural next()
        // fire on its own rather than scheduling a ~0ms or negative delay.
        if (remainingContentMs <= 0) {
            post("EBYS Slicer: [" + track + "] applyGlobalBPMLive — skipped, segment nearly over"
                 + "  elapsed=" + Math.round(elapsedWallMs) + "ms  total=" + Math.round(contentTotalMs) + "ms\n");
            continue;
        }

        var remainingWallMsNew = remainingContentMs * newStretchR;
        var newSpeedFactor     = 1.0 / newStretchR;

        outlet(0, "rescheduleLive", track, newSpeedFactor, Math.round(remainingWallMsNew));

        // Tell the TUI too — outlet(0) above only reaches the audio engine
        // (slot_router.js's karma~ retime). The progress bar's fill is
        // elapsed-since-segment-start / segDurMs, where segDurMs was
        // captured once via the "seg"/"segPlayMs" messages at segment start
        // under the OLD stretch ratio. Without this, a live tempo change
        // retimes the actual audio but leaves the bar animating against the
        // stale duration — it drifts out of sync with what's actually
        // playing until the next segment starts fresh: finishes early and
        // sits pinned at 100% if tempo just dropped, or undershoots and
        // jumps abruptly at the real end if tempo just rose.
        outlet(1, "segRetime", track, Math.round(remainingWallMsNew));

        // Rebase lastSegment so a second live BPM tweak before this segment
        // ends computes correctly from THIS moment, not the original dispatch.
        seg.stretchR          = newStretchR;
        seg.segDurMsForOutlet = remainingContentMs;
        seg.dispatchedAtMs    = now;

        post("EBYS Slicer: [" + track + "] LIVE retime — stretch " + oldStretchR.toFixed(3)
             + "→" + newStretchR.toFixed(3) + "  remaining=" + Math.round(remainingWallMsNew) + "ms\n");
    }
    // A live tempo change shifts where the downbeat grid actually falls —
    // re-arm the pulse against the new bar length rather than letting it
    // fire at the stale old-tempo timing.
    scheduleDownbeatPulse();
}

// Internal helper — BPM resolution without a specific source track context.
// Falls back to FALLBACK_BPM since meta[track].BPM (FluCoMa) is no longer stored.
// Prefer effectiveBPMForSource(sourceTrack) whenever a slice or sourceTrack is available.
function effectiveBPM(track) {
    if (GLOBAL_BPM > 0) return GLOBAL_BPM;
    return FALLBACK_BPM;
}

// Per-source-track BPM — uses madmom BPM when available (more reliable than FluCoMa).
// Used for barMs calculations in selectSegment so multi-track sessions get correct
// bar durations even when source tracks have different tempos.
function effectiveBPMForSource(sourceTrack) {
    if (GLOBAL_BPM > 0) return GLOBAL_BPM;
    var db = sourceTrack && trackDownbeats[sourceTrack];
    if (db && db.bpm > 40 && db.bpm < 280) return db.bpm;
    return FALLBACK_BPM;
}

// ── HARMONIC (KEY) COMPATIBILITY — Camelot wheel ─────────────────────────────
// Standard DJ harmonic-mixing theory, not learned/tuned — this is a solved,
// deterministic problem (circle of fifths under a different name), so it's
// hardcoded rather than treated as something to calibrate from feedback.
// Each key maps to a wheel position 1–12 plus A (minor) / B (major). Two keys
// mix cleanly when they land on the same code, adjacent numbers with the same
// letter (one step around the circle of fifths), or the same number with the
// other letter (relative major/minor). Essentia's KeyExtractor writes
// "<Note> major"/"<Note> minor" into downbeats.json (see madmom_tagger.py);
// both sharp and flat spellings are mapped since Essentia's note naming isn't
// guaranteed to match a listener's preferred enharmonic spelling.
var CAMELOT_MAJOR = {
    'c':8, 'g':9, 'd':10, 'a':11, 'e':12, 'b':1,
    'f#':2, 'gb':2, 'c#':3, 'db':3, 'g#':4, 'ab':4,
    'd#':5, 'eb':5, 'a#':6, 'bb':6, 'f':7
};
var CAMELOT_MINOR = {
    'a':8, 'e':9, 'b':10, 'f#':11, 'gb':11, 'c#':12, 'db':12,
    'g#':1, 'ab':1, 'd#':2, 'eb':2, 'a#':3, 'bb':3,
    'f':4, 'c':5, 'g':6, 'd':7
};

// Parses "C major" / "A minor" / "F# minor" etc. into { num: 1-12, letter: 'A'|'B' }.
// Returns null for unparseable/unknown keys (e.g. "?" — extraction failed) so
// callers can treat "unknown" as neutral rather than a hard mismatch.
function keyToCamelot(keyStr) {
    if (!keyStr || keyStr === '?') return null;
    var parts = String(keyStr).trim().toLowerCase().split(/\s+/);
    if (parts.length < 2) return null;
    var note  = parts[0];
    var scale = parts[1];
    var table = scale.indexOf('min') === 0 ? CAMELOT_MINOR : CAMELOT_MAJOR;
    var num   = table[note];
    if (!num) return null;
    return { num: num, letter: (table === CAMELOT_MAJOR ? 'B' : 'A') };
}

// Compatibility score 0–1 between two key strings. 1.0 = same code or relative
// major/minor. ~0.83 = one step around the circle of fifths (classic
// "compatible" DJ mix). Falls off from there. Unknown/unparseable keys return
// a neutral 0.5 rather than penalizing — better to be uninformative than to
// treat a failed key extraction as a hard clash.
function keyCompatibility(keyStrA, keyStrB) {
    var a = keyToCamelot(keyStrA);
    var b = keyToCamelot(keyStrB);
    if (!a || !b) return 0.5;
    if (a.num === b.num && a.letter === b.letter) return 1.0;      // identical key
    if (a.num === b.num && a.letter !== b.letter) return 1.0;      // relative major/minor
    var diff = Math.abs(a.num - b.num);
    diff = Math.min(diff, 12 - diff); // circular distance around the wheel
    if (diff === 1 && a.letter === b.letter) return 0.83;          // adjacent fifth
    if (diff === 2 && a.letter === b.letter) return 0.55;          // "energy boost" move
    if (diff === 1 && a.letter !== b.letter) return 0.4;           // adjacent + mode change
    return Math.max(0, 0.35 - diff * 0.03);                        // increasingly dissonant
}

// Key of a source track, or null if unknown/not yet loaded.
function trackKey(sourceTrack) {
    var db = sourceTrack && trackDownbeats[sourceTrack];
    return (db && db.key && db.key !== '?') ? db.key : null;
}

// Stretch ratio for fluid.bufstretch~ @timeratio
// = analyzedBPM / targetBPM  (>1 = stretch longer/slower, <1 = compress/faster)
// Returns 1.0 when no global BPM override is active (no stretching needed).
// Legacy — only called by nextNearest() which is unused.
// Uses FALLBACK_BPM since FluCoMa BPM is no longer stored.
// Any active code path should use stretchRatioForSlice(slice) instead.
function stretchRatioFor(track) {
    if (GLOBAL_BPM <= 0) return 1.0;
    return FALLBACK_BPM / GLOBAL_BPM;
}

// Per-slice version: uses madmom BPM for the slice's source track.
// FluCoMa per-stem BPM is never used here — it is unreliable (often detects
// octave-doubled tempo on non-percussive stems, e.g. 161 BPM for a 120 BPM track).
// madmom analyzes the full mix and is the canonical BPM source.
// bpmFromName — extracts an embedded BPM hint from a track name.
// Matches patterns like "95bpm", "120 BPM", "128BPM".
// Returns 0 when nothing is found.
function bpmFromName(name) {
    if (!name) return 0;
    var m = String(name).match(/(\d+)\s*bpm/i);
    var n = m ? parseInt(m[1]) : 0;
    return (n > 40 && n < 280) ? n : 0;
}

// Resolve a slice's source BPM the same way stretchRatioForSlice does —
// pulled out on its own so the live-BPM-fader path (applyGlobalBPMLive())
// can know a currently-playing segment's srcBpm without duplicating this
// lookup order (name hint first, then madmom downbeats). Returns 0 when
// nothing is found, same as bpmFromName().
function resolveSrcBpm(sourceTrack) {
    var srcBpm = bpmFromName(sourceTrack);
    if (!srcBpm) {
        var db = sourceTrack && trackDownbeats[sourceTrack];
        srcBpm = (db && db.bpm > 40 && db.bpm < 280) ? db.bpm : 0;
    }
    return srcBpm;
}

function stretchRatioForSlice(slice) {
    // Stretch target: explicit setGlobalBPM override, or FALLBACK_BPM (default 120).
    // Stretch target: user's setGlobalBPM override, or FALLBACK_BPM (default 120).
    var target = GLOBAL_BPM > 0 ? GLOBAL_BPM : FALLBACK_BPM;
    if (target <= 0) return 1.0;

    // Prefer BPM hint embedded in the track name (explicit user intent, e.g. "95bpm").
    // Fall back to madmom's analyzed BPM when no name hint exists.
    var srcBpm = resolveSrcBpm(slice.sourceTrack);

    if (!srcBpm) {
        post("EBYS Slicer: WARNING — no BPM for '" + slice.sourceTrack
             + "' — no stretch. Re-run madmom_tagger.py.\n");
        return 1.0;
    }
    return srcBpm / target;
}

// Apply a parameter change immediately — restart all running stems now
function applyNow() {
    if (!running) { post("EBYS: not running — send :buildIndex then :start\n"); return; }
    if (idx.length === 0) { post("EBYS: index empty — send :buildIndex then :start\n"); return; }
    // Skip locked followers (vocals/bass locked to melody by default) here.
    // selectSegment() on a locked stem still picks the correct FILE — the
    // sourceLock branch filters its candidate pool to the leader's current
    // source track — but it then independently chooses its OWN time position
    // within that file (via STAY-continuation/scoring/random), not the
    // leader's exact window. Only pushSyncedSegment() guarantees the same
    // moment for both. Calling selectSegment() on a locked follower here was
    // exactly what could snap it onto an unrelated passage of the right file
    // — same track, wrong moment — which reads as "stretched"/"muddy"/
    // "doesn't fit" even though it's nominally playing the correct source.
    // Reselecting the (unlocked) leader below already pushes a synced segment
    // to every one of its followers automatically (see the end of
    // selectSegment()), so simply not touching followers directly here is
    // enough — mirrors the same guard start() already uses.
    for (var t = 0; t < TRACKS.length; t++) {
        if (!sourceLock[TRACKS[t]]) selectSegment(TRACKS[t]);
    }
}

// ── GENRE FILTER ─────────────────────────────────────────────────────────────
// setGenreFilter Techno    — only play slices from tracks tagged with "Techno"
// setGenreFilter House     — case-insensitive substring match against genre strings
// clearGenreFilter         — remove filter, play from all tracks
// listGenres               — print available genres to Max console
function setGenreFilter() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    genreFilter = parts.join(" ").trim() || null;
    if (genreFilter) {
        post("EBYS Slicer: genre filter = '" + genreFilter + "'\n");
        outlet(1, "genreFilter", genreFilter);
    } else {
        post("EBYS Slicer: genre filter cleared\n");
        outlet(1, "genreFilter", "none");
    }
}

function clearGenreFilter() {
    genreFilter = null;
    post("EBYS Slicer: genre filter cleared\n");
    outlet(1, "genreFilter", "none");
}

function listGenres() {
    var seen = {};
    for (var trackName in trackGenres) {
        var gs = trackGenres[trackName];
        post("  " + trackName + ":\n");
        for (var gi = 0; gi < gs.length; gi++) {
            var g = gs[gi];
            if (!seen[g]) { seen[g] = 0; }
            seen[g]++;
            post("    " + (gi+1) + ". " + g + "\n");
        }
    }
    var allGenres = Object.keys(seen).sort();
    post("EBYS Slicer: unique genres — " + allGenres.join(", ") + "\n");
    outlet(1, "genres", allGenres.join(","));
}

// ── DESCRIPTOR DUMP ───────────────────────────────────────────────────────────
function dumpDescriptors(trackFilter) {
    var pool = (trackFilter && byTrack[trackFilter]) ? byTrack[trackFilter] : idx;
    for (var i = 0; i < pool.length; i++) {
        var s = pool[i];
        outlet(2, s.track, s.id, s.n,
               s.C.toFixed(2), s.P.toFixed(2),
               s.E.toFixed(2), s.F.toFixed(2),
               s.time.toFixed(2), s.dur.toFixed(2));
    }
    outlet(1, "dump_done", pool.length);
}

// ── RANGE QUERY ───────────────────────────────────────────────────────────────
function sliceMatchesGenre(s) {
    if (!genreFilter) return true;
    var gf = genreFilter.toLowerCase();
    var gs = s.genres || [];
    for (var gi = 0; gi < gs.length; gi++) {
        if (gs[gi].toLowerCase().indexOf(gf) !== -1) return true;
    }
    return false;
}

function sliceMatchesKey(s) {
    if (!keyFilter) return true;
    var kf = keyFilter.toLowerCase();
    var sk = (s.key || "").toLowerCase();
    return sk.indexOf(kf) !== -1;
}

// setKeyFilter Am   — only select slices from tracks in A minor
// setKeyFilter C    — match any key starting with C (C, C#, Cm, C#m …)
// setKeyFilter ""   — clear filter
function setKeyFilter() {
    var args = [];
    for (var i = 0; i < arguments.length; i++) args.push(String(arguments[i]));
    keyFilter = args.join(" ").trim() || null;
    if (keyFilter) {
        post("EBYS Slicer: key filter = '" + keyFilter + "'\n");
        outlet(1, "keyFilter", keyFilter);
    } else {
        post("EBYS Slicer: key filter cleared\n");
        outlet(1, "keyFilter", "none");
    }
}

function clearKeyFilter() {
    keyFilter = null;
    outlet(1, "keyFilter", "none");
}

function queryRange(trackFilter, Clo, Chi, Elo, Ehi, Flo, Fhi, Plo, Phi) {
    var pool = (trackFilter && byTrack[trackFilter]) ? byTrack[trackFilter] : idx;
    var result = [];
    for (var i = 0; i < pool.length; i++) {
        var s = pool[i];
        if (s.C < Clo || s.C > Chi) continue;
        if (s.E < Elo || s.E > Ehi) continue;
        if (s.F < Flo || s.F > Fhi) continue;
        if (s.P < Plo || s.P > Phi) continue;
        if (!sliceMatchesGenre(s)) continue;
        result.push(s);
    }
    return result;
}

function selectRange() {
    var args = [];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    var trackFilter = (typeof args[0] === "string") ? args.shift() : null;
    var Clo = (args[0] !== undefined) ? parseFloat(args[0]) : -Infinity;
    var Chi = (args[1] !== undefined) ? parseFloat(args[1]) :  Infinity;
    var Elo = (args[2] !== undefined) ? parseFloat(args[2]) : -Infinity;
    var Ehi = (args[3] !== undefined) ? parseFloat(args[3]) :  Infinity;
    var Flo = (args[4] !== undefined) ? parseFloat(args[4]) : -Infinity;
    var Fhi = (args[5] !== undefined) ? parseFloat(args[5]) :  Infinity;
    var Plo = (args[6] !== undefined) ? parseFloat(args[6]) : -Infinity;
    var Phi = (args[7] !== undefined) ? parseFloat(args[7]) :  Infinity;
    var pool = queryRange(trackFilter, Clo, Chi, Elo, Ehi, Flo, Fhi, Plo, Phi);
    outlet(3, pool.length);
    if (pool.length === 0) { outlet(1, "empty_range"); return; }
    var s = pool[Math.floor(Math.random() * pool.length)];
    lastSlice = s;
    outlet(0, s.track, s.time, s.dur, stretchRatioForSlice(s));
    outlet(1, "playing", s.track, s.id, s.E.toFixed(1), s.C.toFixed(0));
}

// ── TRACK WEIGHT ──────────────────────────────────────────────────────────────
// setMatchProb 0.8  — global transition tightness (0=loose, 1=strict)
//   Applies to all descriptors equally. Per-descriptor variant removed (redundant with setWeight).
// setMatchProb <stem|all> <val> — per-stem transition-match strictness.
function setMatchProb(stem, val) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    var v = clamp(parseFloat(val), 0.0, 1.0);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!MATCH_PROB.hasOwnProperty(t)) continue;
        MATCH_PROB[t] = v;
        post("EBYS Slicer: matchProb[" + t + "] = " + v + "\n");
        outlet(1, "matchProb", t, v);
    }
}

// setDirPref <stem|all> E 1   — prefer slices where that stem's energy is rising
// setDirPref <stem|all> E -1  — prefer slices where it's falling
// setDirPref <stem|all> E 0   — neutral (default)
function setDirPref(stem, dim, val) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    var v = clamp(parseFloat(val), -1.0, 1.0);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!DIR_PREF[t] || !DIR_PREF[t].hasOwnProperty(dim)) continue;
        DIR_PREF[t][dim] = v;
        post("EBYS Slicer: dirPref[" + t + "][" + dim + "] = " + v + "\n");
        outlet(1, "param", "dir" + dim + "_" + t, v);
    }
}

// setDirWeight <stem|all> 1.5 — amplify/reduce that stem's direction bias (default 1.0)
function setDirWeight(stem, val) {
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    var v = clamp(parseFloat(val), 0.0, 5.0);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!DIR_WEIGHT.hasOwnProperty(t)) continue;
        DIR_WEIGHT[t] = v;
        post("EBYS Slicer: dirWeight[" + t + "] = " + v + "\n");
        outlet(1, "param", "dirWeight_" + t, v);
    }
}

// ── ENTROPY MACRO ─────────────────────────────────────────────────────────────
// setEntropy <0–1>  — ORDER (0) to CHAOS (1)
//   Single fader that simultaneously drives:
//     MATCH_PROB  : 1→0   (order=strict matching, chaos=loose)
//     STAY_PROB   : 0.8→0 (order=tends to stay on track, chaos=always jumps)
//     DIR_WEIGHT  : 0→3.0 (order=no direction forcing, chaos=strong direction)
//
//   Curves are intentionally non-linear:
//     matchProb uses (1-e)^2  so looseness accelerates toward the chaos end
//     stayProb  uses (1-e)*0.8
//     dirWeight uses e*3.0
//
function setEntropy(val) {
    var e = clamp(parseFloat(val), 0.0, 1.0);
    // Compute each sub-parameter
    var mp = Math.pow(1 - e, 2);       // 1.0 → 0.0, curved
    var sp = (1 - e) * 0.8;            // 0.8 → 0.0
    var dw = e * 3.0;                  // 0.0 → 3.0

    // Applies to every stem uniformly — entropy is a single whole-instrument
    // fader, unlike :setMatchProb/:setDirWeight which now also take a
    // <stem|all> target for tuning one stem independently.
    for (var i = 0; i < TRACKS.length; i++) {
        STAY_PROB[TRACKS[i]]  = sp;
        MATCH_PROB[TRACKS[i]] = mp;
        DIR_WEIGHT[TRACKS[i]] = dw;
    }

    post("EBYS Slicer: entropy=" + e.toFixed(2)
         + " → matchProb=" + mp.toFixed(3)
         + " stayProb=" + sp.toFixed(3)
         + " dirWeight=" + dw.toFixed(3) + "\n");

    outlet(1, "entropy", e, mp, sp, dw);
}

function setTrackWeight(track, w) {
    if (trackWeights.hasOwnProperty(track)) {
        trackWeights[track] = clamp(parseFloat(w), 0.0, 1.0);
        post("EBYS Slicer: weight[" + track + "] = " + trackWeights[track] + "\n");
    }
}

// ── FOLLOW STEM COMMAND ───────────────────────────────────────────────────────
// Per-dimension: a stem's descriptors don't all have to follow the same
// source anymore — e.g. vocals' P can chase melody while every other
// dimension keeps reading vocals' own descriptors.
//   followStem vocals self
//     → reset EVERY dimension of vocals back to its own descriptors
//   followStem vocals P self
//     → reset just vocals' P back to its own descriptor
//   followStem vocals P melody 1.0
//     → vocals' P reads melody's P (100%)
//   followStem vocals P melody 0.8 bass 0.2
//     → vocals' P reads an 80/20 blend of melody's P and bass' P
//   followStem vocals all melody 0.8 bass 0.2
//     → apply that same blend to every dimension at once (the old
//       whole-stem behavior, as a convenience)
// Weights are normalised to sum to 1.0 per dimension.
function followStem(track) {
    if (!FOLLOW_STEM.hasOwnProperty(track)) {
        post("EBYS Slicer: followStem — unknown stem '" + track + "'\n");
        return;
    }
    if (arguments.length < 2) {
        post("EBYS Slicer: followStem — missing arguments\n");
        return;
    }
    var second = String(arguments[1]);

    // followStem <stem> self  → reset every dimension
    if (second === "self" && arguments.length === 2) {
        FOLLOW_STEM[track] = emptyFollowMap();
        post("EBYS Slicer: followStem[" + track + "] = self (all dimensions)\n");
        return;
    }

    var targetDims;
    if (second === "all") {
        targetDims = FOLLOW_DIMS;
    } else if (FOLLOW_DIMS.indexOf(second) !== -1) {
        targetDims = [second];
    } else {
        post("EBYS Slicer: followStem — unknown dimension '" + second
             + "' (expected one of " + FOLLOW_DIMS.join(",") + ", or 'all'/'self')\n");
        return;
    }

    // followStem <stem> <dim|all> self  → reset just those dimension(s)
    if (arguments.length === 3 && String(arguments[2]) === "self") {
        for (var di = 0; di < targetDims.length; di++) FOLLOW_STEM[track][targetDims[di]] = null;
        post("EBYS Slicer: followStem[" + track + "][" + targetDims.join(",") + "] = self\n");
        return;
    }

    var pairs = [];
    var totalWeight = 0;
    for (var i = 2; i < arguments.length - 1; i += 2) {
        var s = String(arguments[i]);
        var w = parseFloat(arguments[i + 1]);
        if (!FOLLOW_STEM.hasOwnProperty(s)) {
            post("EBYS Slicer: followStem — unknown target stem '" + s + "'\n");
            return;
        }
        if (isNaN(w) || w < 0) {
            post("EBYS Slicer: followStem — invalid weight '" + arguments[i + 1] + "'\n");
            return;
        }
        pairs.push({ stem: s, weight: w });
        totalWeight += w;
    }
    if (pairs.length === 0) { post("EBYS Slicer: followStem — no valid target/weight pairs\n"); return; }
    // Normalise weights to sum to 1.0
    if (totalWeight > 0) {
        for (var j = 0; j < pairs.length; j++) pairs[j].weight /= totalWeight;
    }
    for (var dj = 0; dj < targetDims.length; dj++) {
        // Clone per dimension so a later per-dim self-reset can't mutate a
        // shared array reference out from under the other dimensions.
        FOLLOW_STEM[track][targetDims[dj]] = pairs.map(function(p) { return { stem: p.stem, weight: p.weight }; });
    }
    var msg = "EBYS Slicer: followStem[" + track + "][" + targetDims.join(",") + "] =";
    for (var j2 = 0; j2 < pairs.length; j2++) msg += " " + pairs[j2].stem + "×" + pairs[j2].weight.toFixed(2);
    post(msg + "\n");
}

// ── INSPECTOR ─────────────────────────────────────────────────────────────────
function info() {
    post("── EBYS Slicer v2 ──\n");
    post("  segmentBars : vocals=" + SEGMENT_BARS.vocals + " melody=" + SEGMENT_BARS.melody + " bass=" + SEGMENT_BARS.bass + " drums=" + SEGMENT_BARS.drums + "\n");
    post("  quantize    : " + QUANTIZE_BARS + "\n");
    post("  stayProb    : vocals=" + STAY_PROB.vocals + " melody=" + STAY_PROB.melody + " bass=" + STAY_PROB.bass + " drums=" + STAY_PROB.drums + "\n");
    post("  fallbackBPM : " + FALLBACK_BPM + "\n");
    post("  globalBPM   : " + (GLOBAL_BPM > 0 ? GLOBAL_BPM + " (OVERRIDE ACTIVE)" : "off") + "\n");
    var dbKeys = Object.keys(trackDownbeats);
    if (dbKeys.length > 0) {
        for (var di = 0; di < dbKeys.length; di++) {
            var db = trackDownbeats[dbKeys[di]];
            post("  downbeats   : track='" + dbKeys[di] + "'  meter=" + db.meter + "  bpm=" + db.bpm
                 + "  avgBarMs=" + db.avgBarMs
                 + "  n=" + (db.downbeats_ms ? db.downbeats_ms.length : 0)
                 + "  conf=" + db.confidence
                 + (db.confidence < DOWNBEAT_MIN_CONF ? " (BELOW THRESHOLD → BPM grid)" : "") + "\n");
        }
    } else {
        post("  downbeats   : none (run allin1_tagger.py then send reloadDownbeats)\n");
    }
    post("  matchProb   : voc=" + MATCH_PROB.vocals + " mel=" + MATCH_PROB.melody
                       + " bas=" + MATCH_PROB.bass + " drm=" + MATCH_PROB.drums + " (per-stem)\n");
    var followStr = "";
    for (var t = 0; t < TRACKS.length; t++) {
        var fmap = FOLLOW_STEM[TRACKS[t]];
        if (!fmap) continue;
        for (var fd = 0; fd < FOLLOW_DIMS.length; fd++) {
            var dim = FOLLOW_DIMS[fd];
            var f   = fmap[dim];
            if (!f) continue;
            var parts = [];
            for (var j = 0; j < f.length; j++) parts.push(f[j].stem + "×" + f[j].weight.toFixed(2));
            followStr += TRACKS[t] + "." + dim + "→[" + parts.join(", ") + "] ";
        }
    }
    post("  followStem  : " + (followStr || "all self") + "\n");
    for (var t2 = 0; t2 < TRACKS.length; t2++) {
        var tk = TRACKS[t2];
        post("  dirPref[" + tk + "] : C=" + DIR_PREF[tk].C + " E=" + DIR_PREF[tk].E
                           + " F=" + DIR_PREF[tk].F + " P=" + DIR_PREF[tk].P
                           + " weight=" + DIR_WEIGHT[tk] + "\n");
    }
    post("  total slices: " + idx.length + "\n");
    for (var t = 0; t < TRACKS.length; t++) {
        var track = TRACKS[t];
        var arr   = byTrack[track] || [];
        var r     = ranges[track]  || {};
        var firstSrc = arr.length > 0 ? arr[0].sourceTrack : null;
        var bpm   = effectiveBPMForSource(firstSrc);
        var barMs = getBarMs(track, bpm, firstSrc);
        post("  " + track + ": " + arr.length + " slices"
             + "  BPM=" + bpm.toFixed(1)
             + "  key=" + (meta[track] ? meta[track].key : "?") + "\n");
        if (r.E) {
            post("    seg≈" + (barMs * SEGMENT_BARS).toFixed(0) + "ms"
                 + "  (" + SEGMENT_BARS + " bars)"
                 + "  E=[" + r.E.min.toFixed(1) + "," + r.E.max.toFixed(1) + "]\n");
        }
    }
    post("  running  : " + running + "\n");
    post("  lastSlice: " + (lastSlice
         ? lastSlice.track + " @" + lastSlice.time.toFixed(0) + "ms"
         : "none") + "\n");
}

// ── Stubs for messages sent by ws_server.js that slicer doesn't handle ────────
// ws_server sends these after startup; suppress "no function" warnings.
function ws_ready()  {}   // patch ready signal — not needed in slicer
function umapDone()  {}   // t-SNE/UMAP finished — slicer doesn't need to act
function stemMS()    {}   // emitted by slicer on outlet 1; routed back via patch — ignore

// ── RESET ─────────────────────────────────────────────────────────────────────
function reset() {
    running     = false;
    everStarted = false;   // next :start after a reset must cold-start, not "resume" stale state
    if (stopQuantizeTask) { stopQuantizeTask.cancel(); stopQuantizeTask = null; }
    if (downbeatPulseTask) { downbeatPulseTask.cancel(); downbeatPulseTask = null; }
    idx        = [];
    byTrack    = {};
    meta       = {};
    ranges     = {};
    lastSlice       = null;
    lastIdx         = { vocals: 0,    melody: 0,    bass: 0,    drums: 0    };
    lastEndFrac     = { vocals: -1,   melody: -1,   bass: -1,   drums: -1   };
    lastSourceTrack = { vocals: null, melody: null, bass: null, drums: null };
    lastSegment     = { vocals: null, melody: null, bass: null, drums: null };
    FOLLOW_STEM = { vocals: emptyFollowMap(), melody: emptyFollowMap(), bass: emptyFollowMap(), drums: emptyFollowMap() };
    pausedRemainingMs = { vocals: null, melody: null, bass: null, drums: null };
    pausedPosFrac     = { vocals: null, melody: null, bass: null, drums: null };
    karmaPos          = { vocals: null, melody: null, bass: null, drums: null };
    karmaState        = { vocals: null, melody: null, bass: null, drums: null };
    karmaPosAtMs      = { vocals: null, melody: null, bass: null, drums: null };
    outlet(1, "reset");
    post("EBYS Slicer: reset\n");
}
