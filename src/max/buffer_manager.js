// EBYS — Buffer Manager  v2
//
// Two-level ring buffer architecture for scalable multi-source-track playback.
//
// ── LEVEL 1: Source buffers (src_N_stem) ─────────────────────────────────────
//   2 per stem × 4 stems = 8 buffer~ objects (src_0/1_voc/drm/bss/mel).
//   src.active  = slot currently used for composition (don't overwrite)
//   src.staging = slot available for loading the next source track
//
// ── LEVEL 2: Ring buffers (ring_N_stem) ──────────────────────────────────────
//   2 per stem × 4 stems = 8 small pre-allocated buffer~ objects.
//   fluid.bufcompose~ copies the exact segment from src → ring.staging (~1ms).
//   After compose: ring.active ↔ ring.staging swap; karma~ plays ring.active.
//
// ── Inlet 0 messages ─────────────────────────────────────────────────────────
//   vocals    sourceSlot  startFrac  endFrac  stretchRatio  segDurMs  → play
//   melody    sourceSlot  ...
//   bass      sourceSlot  ...
//   drums     sourceSlot  ...
//   preload   stem  sourceSlot    → speculative disk preload
//   sourceTrack  slotIdx  ...nameParts  → register slot → track name mapping
//   src_done  stemShort  srcSlot   → src buffer~ finished loading from disk
//   ring_done stemShort            → fluid.bufcompose~ finished copy
//   stop                          → close gate, freeze karma~ in place (:stop)
//   resume                        → re-open gate, karma~ "play" from where it froze (:start resume)
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  → buffer~ src_0_voc   "read <path>"
//   1  → buffer~ src_1_voc   "read <path>"
//   2  → buffer~ src_0_drm   "read <path>"
//   3  → buffer~ src_1_drm   "read <path>"
//   4  → buffer~ src_0_bss   "read <path>"
//   5  → buffer~ src_1_bss   "read <path>"
//   6  → buffer~ src_0_mel   "read <path>"
//   7  → buffer~ src_1_mel   "read <path>"
//   8  → fluid.bufcompose~ voc  (source/startframe/numframes/destination/deststartframe/bang)
//   9  → fluid.bufcompose~ drm
//  10  → fluid.bufcompose~ bss
//  11  → fluid.bufcompose~ mel
//  12  → slot_router inlet 0  "vocals ringSlot segDurMs stretchRatio"
//  13  → status / print
//  14  → fluid.bufcompose~ bake voc  (shared — used for both ring→snap and snap→ring)
//  15  → fluid.bufcompose~ bake drm
//  16  → fluid.bufcompose~ bake bss
//  17  → fluid.bufcompose~ bake mel

autowatch = 1;
inlets    = 1;
outlets   = 18;

// ── Configuration ────────────────────────────────────────────────────────────
// Path computed relative to patch — works on any machine.
function getDataDir() {
    var p = patcher.filepath;
    var slash = p.indexOf('/');
    if (slash > 0) p = p.slice(slash);
    p = p.replace(/[^\/]+$/, '');    // strip filename  → .../src/max/
    p = p.replace(/[^\/]+\/$/, ''); // strip max/      → .../src/
    p = p.replace(/[^\/]+\/$/, ''); // strip src/      → .../EBYS/
    return p + 'data/';
}
// Stems live under the ACTIVE session now (data/sessions/<id>/stems/htdemucs).
// buffer_manager was missed in the multi-session migration and still pointed at
// the old global data/stems/htdemucs, so every WAV read failed → no src_done →
// no ring buffers → nothing ever reached karma~ → silence. Go through the
// data/current symlink (repointed to the active session on every login/switch),
// so this one cached path always resolves to the right session — no need to
// re-read current_session.txt here.
var HT_PATH  = getDataDir() + "current/stems/htdemucs";
var SUFFIXES = { voc: "_vocals.wav", drm: "_drums.wav", bss: "_bass.wav", mel: "_other.wav" };
var SHORT    = { vocals: "voc", melody: "mel", bass: "bss", drums: "drm" };
var FULL     = { voc: "vocals", mel: "melody", bss: "bass", drm: "drums" };
var STEMS    = ["voc", "drm", "bss", "mel"];

// Outlets to each src buffer pair per stem
var SRC_OUTLETS  = { voc: [0, 1], drm: [2, 3], bss: [4, 5], mel: [6, 7] };
// Outlet to each fluid.bufcompose~ per stem
var COMP_OUTLET  = { voc: 8, drm: 9, bss: 10, mel: 11 };

// ── Slot → track name map ─────────────────────────────────────────────────────
var slotToTrack = {};

// ── Per-stem state ────────────────────────────────────────────────────────────
function makeSrc() {
    return {
        active:   0,
        staging:  1,
        contents: [-1, -1],
        loading:  false,
        pendingCompose: null
    };
}
function makeRing() {
    return { active: 0, staging: 1 };
}

var src          = { voc: makeSrc(),  mel: makeSrc(),  bss: makeSrc(),  drm: makeSrc()  };
var ring         = { voc: makeRing(), mel: makeRing(), bss: makeRing(), drm: makeRing() };
var composePend  = { voc: null,       mel: null,       bss: null,       drm: null       };

// ── Playback gate ─────────────────────────────────────────────────────────────
// Set to false by stop() so in-flight bufcompose~ copies don't trigger karma~.
// Cleared back to true by any incoming play command.
var playing = false;

// ── Last-routed play params ───────────────────────────────────────────────────
// Updated every time ring_done fires a play command to slot_router.
// Used by bakeRestore so it can re-trigger karma~ with the same timing after restore.
var lastRouted = { voc: null, mel: null, bss: null, drm: null };

// ── Sync barrier ──────────────────────────────────────────────────────────────
// slicer.js tags every stem's play dispatch with a cycleId + groupSize
// (collectSyncGroup() there — leader + full transitive closure of its
// followers). Requesting all of them together doesn't mean they're all
// actually READY to play together: each stem's ring buffer is composed by
// its own independent, asynchronous fluid.bufcompose~, and ring_done only
// fires once THAT stem's copy finishes — not synchronized across stems at
// all today. This is what "locked stems always drift a little" traces back
// to architecturally (see 0.1.28's investigation write-up).
//
// Fix: ring_done() no longer immediately tells slot_router to play. It tells
// it to PREPARE (point karma~ at the right buffer, no stop/seek/play — fully
// inaudible, doesn't touch whatever's still playing) and registers this
// stem's readiness against its cycleId here. Only once every expected member
// of that cycle has reported ready does this file tell slot_router to COMMIT
// all of them — stop + seek 0 + play + start the auto-next timer — in one
// synchronous burst, so they all get the same tiny, fixed propagation delay
// into karma~ instead of each starting whenever ITS OWN compose happened to
// finish.
//
// cycleTracker[cycleId] = { ready: [stemShort,...], total: N, task: Task|null, resolved: bool }
// `resolved` stays true after commit/timeout instead of deleting the entry
// outright — lets a straggler that reports in AFTER the group already
// resolved (timeout case) be recognized as "late" and committed solo on the
// spot, rather than silently stranded with a primed buffer and no play
// trigger. Entries are pruned once they're far enough behind the current
// cycleId to be irrelevant (cycleId is a simple monotonic counter from
// slicer.js — segments last seconds, this barrier resolves in single-digit
// milliseconds to (worst case) COMMIT_TIMEOUT_MS, so a window of 50 cycles
// back is enormous headroom without growing unboundedly over a long session).
var cycleTracker = {};
var COMMIT_TIMEOUT_MS = 250; // generous vs. typical sub-10ms compose time
var CYCLE_PRUNE_WINDOW = 50;

// Per-stem: which cycleId (if any) currently has a buffer PREPARED but NOT
// YET COMMITTED, sitting in ring[sh].staging. The ring.active/staging swap
// itself is deliberately deferred from prepare-time to commit-time (see
// ring_done/commitStem below) — swapping early would mark the new buffer
// "active" (and the old one "free to overwrite") before karma~ had actually
// switched to playing it, which is exactly the kind of write-into-a-buffer-
// still-being-heard hazard this whole split exists to avoid. Tracking
// preparedFor also lets a stem's prepare be safely SUPERSEDED: if a new
// request for the same stem arrives before the old one committed (a fast
// manual :next/:selectSegment during the barrier's brief wait, in practice),
// the old cycle's eventual commit attempt is recognized as stale and skipped
// instead of playing outdated content.
var preparedFor    = { voc: null, mel: null, bss: null, drm: null };
var preparedParams = { voc: null, mel: null, bss: null, drm: null }; // { segDurMs, stretchRatio }

function pruneOldCycles(currentCycleId) {
    for (var idStr in cycleTracker) {
        if (!cycleTracker.hasOwnProperty(idStr)) continue;
        var id = parseInt(idStr);
        if (currentCycleId - id > CYCLE_PRUNE_WINDOW) delete cycleTracker[idStr];
    }
}

// The one moment a stem's audible output actually changes: swaps the ring
// buffer active/staging roles (deferred from prepare time, see above) and
// tells slot_router to actually stop/seek/play. Guards against staleness —
// if this stem's prepare was superseded by a newer one before this fired,
// preparedFor[sh] will have moved on and this quietly no-ops instead of
// playing content that's no longer what was actually requested.
function commitStem(sh, cycleId) {
    if (preparedFor[sh] !== cycleId) {
        post("buffer_manager [" + sh + "]: commit for cycle " + cycleId + " is stale (superseded) — skipping\n");
        return;
    }
    if (!playing) return;
    var params = preparedParams[sh];
    preparedFor[sh]    = null;
    preparedParams[sh] = null;
    var r = ring[sh];
    var ringSlot = r.staging;
    r.active  = ringSlot;
    r.staging = 1 - ringSlot;
    lastRouted[sh] = { ringSlot: ringSlot, segDurMs: params.segDurMs, stretchRatio: params.stretchRatio };
    outlet(12, "commit", FULL[sh]);
    post("buffer_manager [" + sh + "]: COMMIT ring_" + ringSlot + "_" + sh
         + "  " + Math.round(params.segDurMs) + "ms  stretch=" + params.stretchRatio.toFixed(3) + "\n");
}

// Fire commitStem() for every stem that made it into this cycle's ready
// list. Used both for the normal "everyone reported in" path and the
// timeout path (where `ready` may be a subset of `total`).
function releaseCycle(cycleId, reason) {
    var cyc = cycleTracker[cycleId];
    if (!cyc || cyc.resolved) return;
    if (cyc.task) { cyc.task.cancel(); cyc.task = null; }
    cyc.resolved = true;
    if (!playing) {
        post("buffer_manager: cycle " + cycleId + " resolved (" + reason + ") but playback stopped meanwhile — discarding\n");
        return;
    }
    if (cyc.ready.length < cyc.total) {
        post("buffer_manager: cycle " + cycleId + " TIMEOUT — committing " + cyc.ready.length
             + "/" + cyc.total + " ready stems (" + cyc.ready.join(",") + ")\n");
    }
    for (var i = 0; i < cyc.ready.length; i++) commitStem(cyc.ready[i], cycleId);
}

// ── Bake snapshot state ───────────────────────────────────────────────────────
// Saves which ring slot was active at :bake start so restore knows where to put it back.
var bakeActiveSlot    = { voc: 0, mel: 0, bss: 0, drm: 0 };
// Saves the play params (ringSlot, segDurMs, stretchRatio) captured at bakeSnapshot time.
// Replayed to slot_router once all bake_done confirms arrive.
var bakeSnapshotPlay  = { voc: null, mel: null, bss: null, drm: null };

// Tracks which stems are mid-restore (waiting for bufcompose~ done-bang).
// ring state is NOT updated until the copy confirms.
var bakeRestorePending = { voc: false, mel: false, bss: false, drm: false };
var bakeRestoringSlot  = { voc: 0, mel: 0, bss: 0, drm: 0 };

// Shared bake bufcompose~ outlets (used for both directions)
var BAKE_OUTLET = { voc: 14, drm: 15, bss: 16, mel: 17 };

// ── Core helpers ──────────────────────────────────────────────────────────────

function findSrc(sh, sourceSlot) {
    var s = src[sh];
    if (s.contents[0] === sourceSlot) return 0;
    if (s.contents[1] === sourceSlot) return 1;
    return -1;
}

function loadSrc(sh, sourceSlot) {
    var trackName = slotToTrack[sourceSlot];
    if (!trackName) {
        post("buffer_manager: no name for sourceSlot " + sourceSlot + " — send buildIndex first\n");
        return false;
    }
    var s = src[sh];
    var path = HT_PATH + "/" + trackName + "/" + trackName + SUFFIXES[sh];
    s.contents[s.staging] = sourceSlot;
    s.loading = true;
    // "read <path>" with only a filename is NOT the same as "read the whole
    // file in its native channel count" — per Max's own buffer~ docs, a read
    // message with fewer than 3 arguments reads only however many channels
    // the buffer~ CURRENTLY has, and sums any extra channels in the file down
    // to that count. These src_* buffers are declared as plain `buffer~
    // src_0_voc` with no channel argument, which defaults to 1 (mono) — so
    // every stereo htdemucs stem file was being summed to mono on load,
    // before any of the M/S width/pan processing downstream ever saw it.
    // That's the actual cause of "stereo information gets lost in the
    // pipeline" — width could never have had an audible effect, because
    // there was no side-channel content left to widen.
    // Explicit args: start=0, duration=-1 (read the whole file, resizing
    // sample memory to fit), channels=0 (use the channel count from the
    // file's own header — 2, for these stereo stem files) — instead of
    // silently inheriting whatever the buffer~ already happens to have.
    outlet(SRC_OUTLETS[sh][s.staging], "read", path, 0, -1, 0);
    post("buffer_manager [" + sh + "]: loading slot " + sourceSlot
         + " (" + trackName + ") → src_" + s.staging + "_" + sh + "\n");
    return true;
}

function triggerCompose(sh, srcSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    var srcBuf  = new Buffer("src_" + srcSlot + "_" + sh);
    var total   = srcBuf.framecount();
    if (total <= 0) {
        post("buffer_manager [" + sh + "]: src_" + srcSlot + "_" + sh + " is empty\n");
        return;
    }

    var startFrame = Math.round(parseFloat(startFrac) * total);
    var numFrames  = Math.round((parseFloat(endFrac) - parseFloat(startFrac)) * total);
    if (numFrames <= 0) {
        post("buffer_manager [" + sh + "]: zero-length segment, skipping\n");
        return;
    }

    var dstBuf = "ring_" + ring[sh].staging + "_" + sh;
    composePend[sh] = {
        srcSlot:      srcSlot,
        segDurMs:     parseFloat(segDurMs) || 1000,
        stretchRatio: parseFloat(stretchRatio) || 1.0,
        cycleId:      cycleId,
        groupSize:    groupSize || 1
    };

    var co = COMP_OUTLET[sh];
    outlet(co, "source",          "src_" + srcSlot + "_" + sh);
    outlet(co, "startframe",      startFrame);
    outlet(co, "numframes",       numFrames);
    outlet(co, "destination",     dstBuf);
    outlet(co, "deststartframe",  0);
    outlet(co, "bang");

    post("buffer_manager [" + sh + "]: compose src_" + srcSlot + "_" + sh
         + "[" + startFrame + "+" + numFrames + "] → " + dstBuf
         + "  cycle=" + cycleId + "\n");
}

// ── Seamless loop (karma~ jump) ───────────────────────────────────────────────
// When the slicer re-requests the EXACT same segment it just played on a stem
// (same source slot + same start/end frac) — a pure LOOP, not a slice/file
// switch — the normal recompose + karma~ stop/set/seek0/play produces an
// audible click/gap at the seam. Instead we skip the recompose entirely and
// tell slot_router to karma~ `jump` back to the buffer start, which repositions
// click-free via karma~'s internal switch ramp (the "little crossfade").
//
// This is strictly additive: the check is exact equality of the just-played
// segment identity, so ANY change of source or window is NOT a loop and takes
// the untouched normal path. Slice/file switching — the core of the instrument
// — is completely unaffected. Toggle with:  seamlessLoop 0|1.
//
// DEFAULT OFF for now: the jump path returns from handlePlay BEFORE the
// compose → ring_done → sync-barrier registration, so a cycle where some stems
// loop and others switch can stall the barrier, and karma~'s `jump` message
// still needs live confirmation. Off = the play path is exactly the known-good
// one. Enable with `seamlessLoop 1` once verified on the Max console.
var SEAMLESS_LOOP = false;
var lastSeg = { voc: null, mel: null, bss: null, drm: null };  // "srcSlot|startFrac|endFrac" of last COMPOSED segment
function seamlessLoop(v) {
    SEAMLESS_LOOP = (parseInt(v) !== 0);
    post("buffer_manager: seamlessLoop = " + SEAMLESS_LOOP + "\n");
}

// ── Play handler ──────────────────────────────────────────────────────────────
function handlePlay(sh, sourceSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    playing = true;   // re-arm gate; any incoming play command restarts playback
    var s = src[sh];
    var found = findSrc(sh, sourceSlot);

    // Seamless loop: identical consecutive segment on an already-loaded source →
    // karma~ jump instead of recompose + hard re-trigger. Only fires on an exact
    // content repeat; every genuine switch falls through to the normal path below.
    var segId = sourceSlot + "|" + startFrac + "|" + endFrac;
    if (SEAMLESS_LOOP && found !== -1 && !s.loading && segId === lastSeg[sh]) {
        outlet(12, "loopjump", FULL[sh]);
        post("buffer_manager [" + sh + "]: LOOP → seamless jump (recompose skipped)\n");
        return;
    }
    lastSeg[sh] = segId;

    if (found !== -1) {
        // Track already loaded in one of our two src buffers — compose immediately.
        triggerCompose(sh, found, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize);
        return;
    }

    // Track not loaded yet — save what we want to play.
    s.pendingCompose = { sourceSlot: sourceSlot, startFrac: startFrac,
                         endFrac: endFrac, stretchRatio: stretchRatio, segDurMs: segDurMs,
                         cycleId: cycleId, groupSize: groupSize };

    if (s.loading) {
        // A load is already in progress.
        if (s.contents[s.staging] === sourceSlot) {
            // It's loading exactly what we need — wait for src_done.
            post("buffer_manager [" + sh + "]: queuing after active load (slot " + sourceSlot + ")\n");
        } else {
            // Loading the WRONG track. Don't interrupt — wait for src_done, which will
            // see that pendingCompose.sourceSlot doesn't match and re-route to loadSrc.
            // (Calling loadSrc here would corrupt the in-flight read by overwriting
            //  s.contents[staging] before the buffer data arrives.)
            post("buffer_manager [" + sh + "]: load in progress for slot " + s.contents[s.staging]
                 + ", need slot " + sourceSlot + " — will re-route after load completes\n");
        }
    } else {
        // Nothing loading — start now.
        if (!loadSrc(sh, sourceSlot)) {
            post("buffer_manager [" + sh + "]: cannot load slot " + sourceSlot + "\n");
        }
    }
}

// ── Preload handler ───────────────────────────────────────────────────────────
function handlePreload(sh, sourceSlot) {
    var s = src[sh];
    if (findSrc(sh, sourceSlot) !== -1) return;
    if (s.loading) return;
    loadSrc(sh, sourceSlot);
}

// ── Message dispatchers ───────────────────────────────────────────────────────

// cycleId/groupSize (the sync-barrier tag slicer.js mints per dispatch — see
// collectSyncGroup()'s comment there) MUST be forwarded through to
// handlePlay()/triggerCompose() here. These four wrapper functions are what
// Max's first-word message dispatch actually calls for each stem's
// outlet(0, track, ...) message — handlePlay() itself has accepted
// cycleId/groupSize since the sync-barrier work landed, but these wrappers
// were never updated to pass them along, so every compose silently arrived
// with cycleId=undefined/groupSize=undefined. Every stem then collided on
// the same cycleTracker["undefined"] key, resolved (as a false "group of
// one") the instant the FIRST stem's compose finished, and every other
// stem's own ring_done for that cycle found it already resolved and
// self-healed into an immediate solo commit — i.e. the barrier was silently
// a no-op the whole time, every stem committing the moment its own async
// compose happened to finish, exactly the pre-barrier drift this system was
// built to eliminate. Confirmed via console log: every buffer_manager
// PREPARE/COMMIT line read "cycle=undefined".
function vocals(sourceSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    handlePlay("voc", parseInt(sourceSlot), parseFloat(startFrac),
               parseFloat(endFrac), parseFloat(stretchRatio), parseFloat(segDurMs), cycleId, groupSize);
}
function melody(sourceSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    handlePlay("mel", parseInt(sourceSlot), parseFloat(startFrac),
               parseFloat(endFrac), parseFloat(stretchRatio), parseFloat(segDurMs), cycleId, groupSize);
}
function bass(sourceSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    handlePlay("bss", parseInt(sourceSlot), parseFloat(startFrac),
               parseFloat(endFrac), parseFloat(stretchRatio), parseFloat(segDurMs), cycleId, groupSize);
}
function drums(sourceSlot, startFrac, endFrac, stretchRatio, segDurMs, cycleId, groupSize) {
    handlePlay("drm", parseInt(sourceSlot), parseFloat(startFrac),
               parseFloat(endFrac), parseFloat(stretchRatio), parseFloat(segDurMs), cycleId, groupSize);
}

function preload(stem, sourceSlot) {
    var sh = SHORT[String(stem)];
    if (sh) handlePreload(sh, parseInt(sourceSlot));
}

// rescheduleLive <stem> <speedFactor> <remainingMs> — pure passthrough to
// slot_router.js (outlet 12, same outlet routeStem's forward already uses).
// slicer.js's outlet 0 only physically connects to this object, not
// slot_router.js directly, so this hop is required — but unlike every other
// message on this path there's no buffer composition to do here: a live
// tempo change doesn't touch WHAT'S loaded, only how fast the already-loaded
// ring buffer plays, so this skips straight past triggerCompose/ring_done
// and every other piece of this file's normal load pipeline.
function rescheduleLive(stem, speedFactor, remainingMs) {
    outlet(12, "rescheduleLive", stem, speedFactor, remainingMs);
}

// resumeSeek <stem> <frac> — pure passthrough to slot_router.js (outlet 12),
// same pattern as rescheduleLive above. Called by slicer.js's start() right
// after "resume", to explicitly re-seek this stem to the buffer position it
// was actually paused at — see slot_router.js's resumeSeek() for why this
// exists alongside (not instead of) resume()'s own bare "play".
function resumeSeek(stem, frac) {
    outlet(12, "resumeSeek", stem, frac);
}

// ── Stop ──────────────────────────────────────────────────────────────────────
// Called when the TUI sends :stop.  Clears the playback gate so any
// fluid.bufcompose~ copies that complete after this point are discarded
// instead of re-triggering karma~ via outlet 12.
// Also forwards "stop" to slot_router (via outlet 12) so it can send
// the karma~ "stop" message to all four stems.
// setWindow <type> — pure passthrough to slot_router.js (outlet 12), which
// owns all pfft~/gizmo~ DSP messaging (see its own header comment). buffer_manager
// doesn't interpret or store this at all — it's just the wire slicer.js
// already has into slot_router.js's inlet, same as "stop" above.
function setWindow(type) {
    outlet(12, "setWindow", type);
}

function stop() {
    playing = false;
    // Invalidate seamless-loop memory: after a stop, karma~ is no longer
    // playing, so the next play must be a real (re)trigger, not a jump.
    lastSeg = { voc: null, mel: null, bss: null, drm: null };
    outlet(12, "stop");   // → slot_router stop() → karma~ "stop" all stems
    // Cancel every pending sync-barrier Task and drop their tracking state —
    // without this, a cycle that was mid-wait when :stop fired could still
    // time out ~250ms later and fire "commit" for stems that should no
    // longer be playing, restarting audio the user just explicitly stopped.
    for (var idStr in cycleTracker) {
        if (!cycleTracker.hasOwnProperty(idStr)) continue;
        var cyc = cycleTracker[idStr];
        if (cyc.task) cyc.task.cancel();
    }
    cycleTracker = {};
    // Drop any uncommitted prepares too — their staged ring content is now
    // moot, and leaving stale cycleIds around is harmless (next prepare
    // overwrites them) but clearing is cheap and avoids confusion when
    // reading state during debugging.
    STEMS.forEach(function(s) { preparedFor[s] = null; preparedParams[s] = null; });
    post("buffer_manager: stopped (playback gate closed)\n");
}

// ── Resume ────────────────────────────────────────────────────────────────
// Called when slicer.js's start() sends "resume" (a stop→start cycle where
// something was already loaded — not a cold start). Unlike the normal play
// path (handlePlay → triggerCompose → prepare/commit), this does NOT touch
// src/ring state, doesn't recompose anything, and doesn't re-trigger karma~
// from frame 0 — stop() never unloaded or reset any of that, it only froze
// karma~ in place and closed the gate. Resuming just re-opens the gate (so a
// bufcompose~ finishing after this point can reach karma~ again) and tells
// slot_router to send karma~ its bare "play" message, continuing from
// exactly wherever "stop" paused it.
function resume() {
    playing = true;
    outlet(12, "resume");   // → slot_router resume() → karma~ "play" all stems
    post("buffer_manager: resumed (playback gate re-opened, no re-trigger)\n");
}

function sourceTrack() {
    var args = arrayfromargs(arguments);
    if (args.length < 1) return;
    var slotIdx = parseInt(args[0]);
    var name = [];
    for (var i = 1; i < args.length; i++) name.push(String(args[i]));
    slotToTrack[slotIdx] = name.join(" ");
    post("buffer_manager: slot " + slotIdx + " = '" + slotToTrack[slotIdx] + "'\n");
    outlet(13, "registered", slotIdx, slotToTrack[slotIdx]);
}

// Called when a src buffer~ done-bang fires
function src_done(stemShort, srcSlot) {
    var sh = String(stemShort);
    srcSlot = parseInt(srcSlot);
    var s = src[sh];

    if (srcSlot !== s.staging) {
        post("buffer_manager [" + sh + "]: src_done for unexpected slot " + srcSlot + "\n");
        return;
    }

    s.loading = false;
    post("buffer_manager [" + sh + "]: src_" + srcSlot + "_" + sh + " ready (track slot "
         + s.contents[srcSlot] + ")\n");

    // Swap active ↔ staging: the just-loaded buffer becomes active, the old one is free.
    var tmp = s.active; s.active = s.staging; s.staging = tmp;

    var pc = s.pendingCompose;
    if (!pc) return;  // preload only — nothing to play

    // Check if the track we need is now available in either buffer.
    var foundNow = findSrc(sh, pc.sourceSlot);
    if (foundNow !== -1) {
        // Found — compose immediately.
        s.pendingCompose = null;
        triggerCompose(sh, foundNow, pc.startFrac, pc.endFrac, pc.stretchRatio, pc.segDurMs, pc.cycleId, pc.groupSize);
    } else {
        // The load that just finished was for a DIFFERENT track (arrived while we were
        // waiting for a different slot).  Start loading what we actually need now.
        post("buffer_manager [" + sh + "]: wrong track loaded — re-routing to slot " + pc.sourceSlot + "\n");
        loadSrc(sh, pc.sourceSlot);
        // pendingCompose stays set — will resolve on the next src_done.
    }
}

// Called when fluid.bufcompose~ done-bang fires.
//
// This is the PREPARE half of the two-phase sync barrier. The composed
// segment sits in ring[sh].staging — fully rendered, but NOT yet swapped to
// active and NOT yet handed to karma~ to actually play. Sending "prepare" to
// slot_router only calls buffer~'s `set` on karma~, which (per karma~'s own
// design) silently repoints it at a new buffer WITHOUT interrupting whatever
// is currently sounding. The audible switch — stop/seek0/play — only happens
// in commitStem(), once every member of this stem's sync group has reached
// this same point. See buffer_manager 0.1.29 changelog entry for the full
// rationale (this replaces the old code that swapped ring state and played
// immediately, which is what caused the residual lock-sync drift: each
// stem's async compose finished at a slightly different wall-clock moment,
// so "immediately play on your own done-bang" meant stems started a few ms
// apart even though they were composed from the same source instant).
function ring_done(stemShort) {
    var sh = String(stemShort);

    // GUARD: check composePend BEFORE touching anything else.
    // fluid.bufcompose~ can fire a spurious done-bang at patch init or if two bangs
    // race. If we proceed when composePend is null there's nothing to prepare.
    var cp = composePend[sh];
    if (!cp) {
        post("buffer_manager [" + sh + "]: ring_done with no pending compose — ignoring\n");
        return;
    }

    src[sh].active  = cp.srcSlot;
    src[sh].staging = 1 - cp.srcSlot;
    composePend[sh] = null;

    // Gate: if stop() was called while this bufcompose~ was in-flight, discard.
    if (!playing) { return; }

    // ring.active/staging is NOT swapped here — deferred to commitStem() so
    // the buffer this compose just wrote into isn't marked "safe to
    // overwrite" (staging) while it may still be waiting, unplayed, for the
    // rest of its sync group. The composed content lives in ring[sh].staging
    // until commit.
    var preparedRingSlot = ring[sh].staging;
    preparedFor[sh]    = cp.cycleId;
    preparedParams[sh] = { segDurMs: cp.segDurMs, stretchRatio: cp.stretchRatio };

    outlet(12, "prepare", FULL[sh], preparedRingSlot, cp.segDurMs, cp.stretchRatio);
    post("buffer_manager [" + sh + "]: PREPARED ring_" + preparedRingSlot + "_" + sh
         + "  " + Math.round(cp.segDurMs) + "ms"
         + "  stretch=" + cp.stretchRatio.toFixed(3)
         + "  cycle=" + cp.cycleId + "\n");

    // Register this stem as ready for its sync cycle; commit once the whole
    // group (or the 250ms timeout) is reached. A cycleId not yet seen means
    // this is the first stem in the group to finish compose — start the
    // group's commit-timeout timer now.
    var cycleId = cp.cycleId;
    var cyc = cycleTracker[cycleId];
    if (!cyc) {
        cyc = cycleTracker[cycleId] = { ready: [], total: cp.groupSize || 1, resolved: false, task: null };
        cyc.task = new Task(function() { releaseCycle(cycleId, "timeout"); }, this);
        cyc.task.schedule(COMMIT_TIMEOUT_MS);
        pruneOldCycles(cycleId);
    }
    if (cyc.resolved) {
        // This stem's compose finished AFTER its cycle already committed
        // (straggler past the timeout, or a stale cycleId). Self-heal by
        // committing it solo right away rather than leaving it stranded
        // prepared-but-never-played.
        post("buffer_manager [" + sh + "]: late for cycle " + cycleId + " (already resolved) — committing solo\n");
        commitStem(sh, cycleId);
        return;
    }
    if (cyc.ready.indexOf(sh) === -1) cyc.ready.push(sh);
    if (cyc.ready.length >= cyc.total) releaseCycle(cycleId, "all ready");
}

// ── Bake snapshot / restore ───────────────────────────────────────────────────

function bakeCopy(srcName, dstName, sh) {
    var srcBuf  = new Buffer(srcName);
    var nFrames = srcBuf.framecount();
    if (nFrames <= 0) {
        post("buffer_manager bake [" + sh + "]: " + srcName + " is empty — skipping\n");
        return;
    }
    var o = BAKE_OUTLET[sh];
    outlet(o, "source",         srcName);
    outlet(o, "startframe",     0);
    outlet(o, "numframes",      nFrames);
    outlet(o, "destination",    dstName);
    outlet(o, "deststartframe", 0);
    outlet(o, "bang");
}

function bakeSnapshot() {
    STEMS.forEach(function(sh) {
        var activeSlot        = ring[sh].active;
        bakeActiveSlot[sh]    = activeSlot;
        // Freeze the play params at this moment so bakeRestore can replay them.
        bakeSnapshotPlay[sh]  = lastRouted[sh]
            ? { ringSlot: activeSlot, segDurMs: lastRouted[sh].segDurMs, stretchRatio: lastRouted[sh].stretchRatio }
            : null;
        // Snapshot copy doesn't need completion tracking — it doesn't affect ring state.
        bakeCopy("ring_" + activeSlot + "_" + sh, "snap_" + sh, sh);
        post("buffer_manager bakeSnapshot [" + sh + "]: ring_" + activeSlot + "_" + sh
             + " → snap_" + sh
             + (bakeSnapshotPlay[sh] ? "  dur=" + Math.round(bakeSnapshotPlay[sh].segDurMs) + "ms" : "  (no play params yet)")
             + "\n");
    });
    post("buffer_manager: bakeSnapshot fired for all stems\n");
}

function bakeRestore() {
    // Kick off async copies for all 4 stems.
    // ring[sh].active is NOT updated here — it moves in bake_done() once the copy confirms.
    STEMS.forEach(function(sh) {
        var savedSlot          = bakeActiveSlot[sh];
        bakeRestorePending[sh] = true;
        bakeRestoringSlot[sh]  = savedSlot;
        bakeCopy("snap_" + sh, "ring_" + savedSlot + "_" + sh, sh);
        post("buffer_manager bakeRestore [" + sh + "]: snap_" + sh
             + " → ring_" + savedSlot + "_" + sh + "  (pending…)\n");
    });
}

// Called when a bake fluid.bufcompose~ done-bang fires.
// Message from patch: "bake_done voc" / "bake_done drm" / "bake_done bss" / "bake_done mel"
// (wired via: bufcompose~ outlet 0 → prepend bake_done <stem> → buffer_manager inlet 0)
function bake_done(stemShort) {
    var sh = String(stemShort);
    if (!bakeRestorePending[sh]) {
        // This was a snapshot copy completing, not a restore — nothing to do.
        return;
    }
    bakeRestorePending[sh] = false;
    var savedSlot = bakeRestoringSlot[sh];

    // Now safe to flip ring state — the copy is confirmed complete.
    ring[sh].active  = savedSlot;
    ring[sh].staging = 1 - savedSlot;
    post("buffer_manager bake_done [" + sh + "]: restore confirmed"
         + " — ring.active = " + savedSlot + "\n");

    // Check if all 4 stems have confirmed.
    var allDone = STEMS.every(function(s) { return !bakeRestorePending[s]; });
    if (allDone) {
        post("buffer_manager: bakeRestore COMPLETE — all stems restored\n");

        // Re-trigger slot_router with the snapshot play params so karma~ plays
        // the restored ring buffer immediately (not waiting for next segment).
        STEMS.forEach(function(s) {
            var sp = bakeSnapshotPlay[s];
            if (sp) {
                // No barrier coordination needed here — all 4 stems' bake
                // copies are already confirmed complete (allDone check
                // above) before this loop runs, so prepare+commit can fire
                // back-to-back per stem instead of going through
                // cycleTracker.
                outlet(12, "prepare", FULL[s], bakeActiveSlot[s], sp.segDurMs, sp.stretchRatio);
                outlet(12, "commit", FULL[s]);
                post("buffer_manager bakeRestore replay [" + s + "]: ring_"
                     + bakeActiveSlot[s] + "_" + s + "  dur=" + Math.round(sp.segDurMs) + "ms\n");
            } else {
                post("buffer_manager bakeRestore replay [" + s + "]: no snapshot params — skipping\n");
            }
        });

        outlet(13, "bakeRestoreComplete");
    }
}

// Catch-all: silently absorb status messages from slicer.js outlet 1
function anything() {}
