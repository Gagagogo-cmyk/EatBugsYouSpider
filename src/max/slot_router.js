// EBYS — Slot Router  v4
//
// ── Role ──────────────────────────────────────────────────────────────────────
// Slot Router is the audio engine parameter hub of EBYS.  It owns all DSP
// settings: it is the only JS object that sends messages to karma~ or pfft~.
//
// Responsibilities:
//   - Tempo axis: translates stretchRatio → karma~ speed factor (right inlet),
//     so playback is faster/slower without slicer.js knowing about audio objects
//   - Buffer switching: tells each karma~ which ring buffer to play and seeks it
//   - Delay timing: computes the stretched segment duration so the next segment
//     fires at the right moment
//   - Pitch axis: translates semitone offsets → frequency ratios and sends them
//     to pfft~/gizmo~ per stem, fully independent of tempo
//
// Slot Router does NOT make musical decisions.  It receives ready-to-play
// commands from buffer_manager.js and real-time parameter changes from
// ws_server.js (via the route object).  All sequencing logic lives in slicer.js.
// ──────────────────────────────────────────────────────────────────────────────
//
// Receives play commands from buffer_manager.js and drives karma~ + pfft~/gizmo~.
//
// Two independent axes:
//   TEMPO  — karma~ speed inlet (right) = 1/stretchRatio
//              pitch follows as a tape side-effect (slower → lower)
//   PITCH  — pfft~/gizmo~ pitch ratio per stem, fully independent of duration
//              setPitch melody 1.5   → raise melody ~8 semitones, no timing change
//
// Input format (from buffer_manager outlet 12), two-phase sync barrier:
//   prepare  <stem>  ringSlot  segDurMs  stretchRatio   — inaudible: repoints
//            karma~'s buffer via "set" only, does NOT stop/seek/play, does
//            NOT touch speed. Whatever is currently playing keeps playing
//            untouched. Stashes the params for the matching commit.
//   commit   <stem>                                     — audible: fires
//            stop/set/speed/seek0-play using the params stashed by the last
//            prepare for that stem. This is the only moment a stem's output
//            actually changes.
// buffer_manager pairs every prepare with a commit once the whole sync
// group (or a 250ms timeout) has finished preparing, so locked stems that
// share a source all start on the exact same scheduler tick instead of each
// starting as soon as its own async compose happened to finish.
//
// Commands:
//   setPitch vocals 1.0           → reset (no shift)
//   setPitch melody 1.5           → raise melody by ~8 semitones
//   setPitchSemitones melody 3    → raise melody 3 semitones (2^(3/12))
//   setPitch all 1.0              → reset all stems
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  → karma~ vocals   inlet 0   "set ring_N_voc"
//   1  → karma~ vocals   inlet 0   seek 0 (via t b b f → play)
//   2  → delay  vocals             segDurMs
//   3  → karma~ melody  inlet 0   "set ring_N_mel"
//   4  → karma~ melody  inlet 0   seek 0
//   5  → delay  melody            segDurMs
//   6  → karma~ bass    inlet 0   "set ring_N_bss"
//   7  → karma~ bass    inlet 0   seek 0
//   8  → delay  bass              segDurMs
//   9  → karma~ drums   inlet 0   "set ring_N_drm"
//  10  → karma~ drums   inlet 0   seek 0
//  11  → delay  drums             segDurMs
//  12  → karma~ vocals  inlet 1   speed factor (1/stretchRatio, tape tempo)
//  13  → karma~ melody  inlet 1   speed factor
//  14  → karma~ bass    inlet 1   speed factor
//  15  → karma~ drums   inlet 1   speed factor
//  16  → pfft~/gizmo~ vocals      pitch ratio (independent of duration)
//  17  → pfft~/gizmo~ melody      pitch ratio
//  18  → pfft~/gizmo~ bass        pitch ratio
//  19  → pfft~/gizmo~ drums       pitch ratio
//  20  → delay  vocals  inlet 0   bang (cancel + restart with whatever segDurMs
//                                        was just sent to outlet 2 — see rescheduleLive)
//  21  → delay  melody  inlet 0   bang
//  22  → delay  bass    inlet 0   bang
//  23  → delay  drums   inlet 0   bang
//
// rescheduleLive <stem> <speedFactor> <remainingMs>  — live tempo change for
// whatever's CURRENTLY PLAYING (called from slicer.js's applyGlobalBPMLive(),
// itself triggered by :setGlobalBPM / :setFallbackBPM). Unlike routeStem()
// above, this never touches karma~'s buffer/stop/set/seek — it only pushes a
// new speed to the already-playing karma~ (immediate, audible, tape-style —
// same mechanism setPitch already uses for gizmo~) and reschedules the
// pending auto-next delay object to fire after <remainingMs> instead of
// whatever was left of the old (now-wrong) countdown. Max's `delay` object
// semantics make this simple: sending a new value to its right inlet updates
// the time it'll use on its NEXT bang without touching a countdown already in
// flight; banging its left inlet immediately after CANCELS any pending
// countdown and restarts fresh with that new time — exactly "reschedule the
// remaining time" in two messages.

autowatch = 1;
inlets    = 1;
outlets   = 25;

var STEM_SHORT = { vocals: "voc", melody: "mel", bass: "bss", drums: "drm" };
var STEM_BASE  = { vocals: 0,     melody: 3,     bass: 6,     drums: 9     };
var SPEED_OUT  = { vocals: 12,    melody: 13,    bass: 14,    drums: 15    };
var PITCH_OUT  = { vocals: 16,    melody: 17,    bass: 18,    drums: 19    };
var BANG_OUT   = { vocals: 20,    melody: 21,    bass: 22,    drums: 23    };
// 24 → send ebys_pitchWindow — reaches all four pfft~ instances at once (see
// setWindow() below; each stem loads its own independent copy of
// ebys-pitch.maxpat, so a single patch cord can't hit all four — send/receive
// broadcasts by name into every copy simultaneously instead).
var PITCH_WINDOW_OUT = 24;
var pitchWindowType  = 'hanning';

// Per-stem pitch ratio for gizmo~ — independent of tempo.
// 1.0 = no shift. 2^(n/12) for n semitones.
var stemPitch = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };

// Per-stem stash of the params from the most recent uncommitted prepare().
// Cleared once commit() consumes it. A later prepare() for the same stem
// simply overwrites this — its own "set" has already silently repointed
// karma~ again, so there's nothing to undo.
var pendingPlay = { vocals: null, melody: null, bass: null, drums: null };

function prepare(stem, ringSlot, segDurMs, stretchRatio) {
    var sh   = STEM_SHORT[stem];
    var base = STEM_BASE[stem];
    if (sh === undefined) { post("slot_router: prepare — unknown stem '" + stem + "'\n"); return; }

    stretchRatio = parseFloat(stretchRatio) || 1.0;

    // Tempo: karma~ plays at 1/stretchRatio speed → pitch follows (tape-style)
    // Actual playback duration = segDurMs * stretchRatio → delay must match
    var speedFactor = 1.0 / stretchRatio;
    var delayMs     = Math.round(parseFloat(segDurMs) * stretchRatio) || 1000;
    var bufName     = "ring_" + parseInt(ringSlot) + "_" + sh;

    // karma~ right inlet requires a Max float atom, not int.
    // In Max JS, any number with no fractional part (e.g. 1.0) is sent as int.
    // Add a negligible epsilon to guarantee a fractional part → float atom.
    // The 1e-9 difference in speed is completely inaudible (~0.00000009% pitch shift).
    var speedFloat = speedFactor + 1e-9;

    pendingPlay[stem] = { speedFloat: speedFloat, delayMs: delayMs, bufName: bufName, stretchRatio: stretchRatio };

    // The ONLY thing prepare() actually sends to audio objects: karma~'s
    // "set" message repoints it at a new buffer WITHOUT interrupting
    // whatever is currently playing (per karma~'s documented behavior — it
    // only takes effect on the buffer's next explicit seek/play). No stop,
    // no speed change, no seek here — sending speed now would immediately
    // retime whatever's still audibly playing from the PREVIOUS segment
    // (karma~'s speed inlet applies live, which is exactly what
    // rescheduleLive relies on elsewhere), which would be an audible glitch
    // before this segment's sync group has even finished committing.
    outlet(base + 0, "set", bufName);

    post("slot_router [" + stem + "]: PREPARED " + bufName + "\n");
}

// The only moment a stem's output actually changes: consumes the params
// stashed by the last prepare() for this stem and fires the full
// stop/set/speed/seek0-play sequence — same behavior the old one-shot
// routeStem() had, just split so it can be deferred until the rest of this
// stem's sync group is also ready.
function commit(stem) {
    var sh   = STEM_SHORT[stem];
    var base = STEM_BASE[stem];
    if (sh === undefined) { post("slot_router: commit — unknown stem '" + stem + "'\n"); return; }

    var pp = pendingPlay[stem];
    if (!pp) { post("slot_router: commit [" + stem + "] — no pending prepare, ignoring\n"); return; }
    pendingPlay[stem] = null;

    outlet(PITCH_OUT[stem], stemPitch[stem]);      // ensure gizmo~ always has a valid ratio
    outlet(SPEED_OUT[stem], pp.speedFloat);        // karma~ speed inlet (float)
    // Stop BEFORE (re-)switching buffer — ensures stop, set, seek, and play
    // all fire in the same scheduler tick, with correct ordering guaranteed.
    // Re-sending "set" here is redundant with prepare()'s own set (nothing
    // else can have repointed this stem's karma~ in between) but kept for
    // safety/parity with the original one-shot routeStem() ordering.
    outlet(base + 0, "stop");                      // stop karma~ before buffer switch
    outlet(base + 0, "set", pp.bufName);           // switch karma~ buffer
    outlet(base + 2, pp.delayMs);                  // delay time (stretched)
    outlet(base + 1, 0);                           // seek 0 → play

    if (pp.stretchRatio !== 1.0) {
        post("slot_router [" + stem + "]: speed=" + (1.0 / pp.stretchRatio).toFixed(3)
             + "  stretch=" + pp.stretchRatio.toFixed(3)
             + "  delay=" + pp.delayMs + "ms\n");
    }
}

// loopjump <stem> — seamless loop re-trigger. buffer_manager calls this instead
// of prepare/commit when the slicer asks for the EXACT same segment again (a
// pure loop, not a switch). karma~ is still playing the same ring buffer, so a
// `jump` to the buffer start repositions the playhead click-free via karma~'s
// internal switch ramp — no stop, no buffer set, no seek0/play, so no seam
// click. The buffer and speed are unchanged, so nothing else needs to fire.
// (Switching slices/files still goes through prepare()/commit() untouched.)
function loopjump(stem) {
    var base = STEM_BASE[stem];
    if (base === undefined) { post("slot_router: loopjump — unknown stem '" + stem + "'\n"); return; }
    // karma~ `jump <pos 0..1>` → click-free reposition to the buffer start.
    outlet(base + 0, "jump", 0.);
}

// rescheduleLive <stem> <speedFactor> <remainingMs> — see the header comment
// above outlets 20-23. This is the live tempo-fader path: retimes whatever's
// currently playing without stopping/reseeking/switching its buffer.
function rescheduleLive(stem, speedFactor, remainingMs) {
    var base = STEM_BASE[stem];
    if (base === undefined) { post("slot_router: rescheduleLive — unknown stem '" + stem + "'\n"); return; }

    speedFactor = parseFloat(speedFactor);
    remainingMs = Math.round(parseFloat(remainingMs));
    if (isNaN(speedFactor) || speedFactor <= 0) {
        post("slot_router: rescheduleLive [" + stem + "] — invalid speedFactor\n"); return;
    }

    // Same float-atom guarantee routeStem() uses — karma~'s speed inlet
    // needs a float, not an int, or Max sends 1 instead of 1.000000001 and
    // the message reads as an integer atom.
    var speedFloat = speedFactor + 1e-9;
    outlet(SPEED_OUT[stem], speedFloat);   // live speed change — audible immediately, tape-style

    if (!isNaN(remainingMs) && remainingMs > 0) {
        outlet(base + 2, remainingMs);     // set the delay object's time for its next bang
        outlet(BANG_OUT[stem], "bang");    // ...and bang it now: cancels whatever was pending, restarts with this time
    }

    post("slot_router [" + stem + "]: LIVE speed=" + speedFactor.toFixed(3)
         + "  remaining=" + remainingMs + "ms\n");
}

// ── Per-stem pitch control ────────────────────────────────────────────────────
// Sends pitch ratio directly to the gizmo~ inside each stem's pfft~.
// Pitch is independent of playback speed — only affects frequency content.

function setPitch(stem, ratio) {
    ratio = parseFloat(ratio);
    if (isNaN(ratio) || ratio <= 0) {
        post("slot_router: setPitch — invalid ratio " + ratio + "\n"); return;
    }
    var targets = (String(stem) === "all")
        ? ["vocals", "melody", "bass", "drums"]
        : [String(stem)];

    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!stemPitch.hasOwnProperty(t)) {
            post("slot_router: setPitch — unknown stem '" + t + "'\n"); continue;
        }
        stemPitch[t] = ratio;
        outlet(PITCH_OUT[t], ratio);
        post("slot_router: pitch[" + t + "] = " + ratio.toFixed(4)
             + "  (" + (Math.log(ratio) / Math.log(2) * 12).toFixed(2) + " st)\n");
    }
}

function setPitchSemitones(stem, n) {
    n = parseFloat(n);
    if (isNaN(n)) { post("slot_router: setPitchSemitones — invalid value\n"); return; }
    setPitch(stem, Math.pow(2, n / 12.0));
}

// pitchShift — TUI command :pitchShift <stem> <semitones>
// Alias for setPitchSemitones, named to match the TUI command directly.
function pitchShift(stem, semitones) {
    setPitchSemitones(stem, semitones);
}

// setWindow <type> — changes the FFT analysis/synthesis window used by the
// pitch shifter (fftin~/fftout~ inside ebys-pitch.maxpat, feeding gizmo~).
// type must already be one of fftin~/fftout~'s own @window values — slicer.js
// normalizes aliases (hann→hanning, rect→square) before this ever runs, so no
// validation here.
//
// This has nothing to do with karma~ (plain varispeed tape playback, no
// windowing at all) or the FluCoMa descriptor-analysis chain (hardcodes
// Hann internally, no override). It's specifically the pitch-independent
// pfft~/gizmo~ shifter's own STFT window — the one place in the whole signal
// chain where a window-type choice is actually meaningful and controllable.
//
// Broadcast via Max send/receive ("ebys_pitchWindow"), not a direct patch
// cord: there are four separate pfft~ instances (one per stem), each loading
// its own independent copy of ebys-pitch.maxpat — send/receive is the
// standard way to reach into every copy at once instead of wiring four
// separate cords.
function setWindow(type) {
    outlet(PITCH_WINDOW_OUT, "window", type);
    pitchWindowType = type;
    post("slot_router: pitch window (fftin~/fftout~) = " + type + "\n");
}

// ── Stop ──────────────────────────────────────────────────────────────────────
// Called when buffer_manager forwards "stop" via outlet 12.
// Sends the karma~ "stop" message to all four stems via their inlet 0 outlets.
// Also cancels each delay so the next "next <stem>" doesn't fire after stop.
function stop() {
    outlet(0,  "stop");   // karma~ vocals  inlet 0
    outlet(3,  "stop");   // karma~ melody  inlet 0
    outlet(6,  "stop");   // karma~ bass    inlet 0
    outlet(9,  "stop");   // karma~ drums   inlet 0
    // Drop any uncommitted prepares — buffer_manager's own stop() already
    // cancels their cycle Tasks, but clear the mirror here too so a stray
    // commit() call (there shouldn't be one, but stray Max messages happen)
    // can't resurrect a pre-stop segment.
    pendingPlay.vocals = null;
    pendingPlay.melody = null;
    pendingPlay.bass   = null;
    pendingPlay.drums  = null;
    // Delays may still fire but slicer.js ignores them when running=false.
    post("slot_router: stopped all karma~ objects\n");
}

// ── Resume ────────────────────────────────────────────────────────────────
// Called when buffer_manager forwards "resume" via outlet 12. Deliberately
// the bare opposite of stop() above: no "set", no "seek 0", nothing that
// would re-trigger a buffer from its own start. karma~'s "stop" (above)
// pauses playback in place rather than resetting position — that's the
// whole point of using karma~ here instead of play~ — so all this needs to
// send is "play" and each stem picks up exactly where it paused.
function resume() {
    outlet(0, "play");   // karma~ vocals  inlet 0
    outlet(3, "play");   // karma~ melody  inlet 0
    outlet(6, "play");   // karma~ bass    inlet 0
    outlet(9, "play");   // karma~ drums   inlet 0
    post("slot_router: resumed all karma~ objects from stopped position\n");
}
