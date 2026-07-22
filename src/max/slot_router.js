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
//   setFormant vocals 1.0         → reset (formants untouched)
//   setFormantSemitones melody 3  → shift melody's formants 3 semitones,
//                                    independent of whatever pitchShift is set
//   setShiftBand melody 200 2000  → restrict BOTH pitch and formant shift on
//                                    melody to 200-2000Hz; everything outside
//                                    passes through unshifted. Clears any
//                                    independent pitch/formant band below.
//   setPitchBand melody 80 400    → pitch-only band override (formant keeps
//                                    using the shared band, or its own override)
//   setFormantBand melody 2000 8000 → formant-only band override
//   clearPitchBand / clearFormantBand melody → drop that effect's override,
//                                    back to the shared band
//   clearShiftBand melody         → full reset: shared band back to full
//                                    range, both overrides cleared
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
//  25  → pfft~/gizmo~#2 vocals    formant ratio (independent of pitch — see setFormant)
//  26  → pfft~/gizmo~#2 melody    formant ratio
//  27  → pfft~/gizmo~#2 bass      formant ratio
//  28  → pfft~/gizmo~#2 drums     formant ratio
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
outlets   = 29;

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
// 25-28 → pfft~ ebys-pitch.maxpat's THIRD inlet per stem ("in 3" inside that
// subpatch) — the independent formant ratio for the cepstral-envelope warp
// (see ebys-pitch.maxpat's cartopol~/log~/fft~/.../poltocar~ chain). Kept as
// its own outlet block, fully separate from PITCH_OUT, so pitch and formant
// can move independently — same relationship ReaPitch's Pitch/Formant
// sliders have to each other.
var FORMANT_OUT = { vocals: 25, melody: 26, bass: 27, drums: 28 };

// Per-stem pitch ratio for gizmo~ — independent of tempo.
// 1.0 = no shift. 2^(n/12) for n semitones.
var stemPitch = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };

// Per-stem formant ratio for the SECOND gizmo~ inside ebys-pitch.maxpat (the
// one that resamples the smoothed spectral envelope rather than the
// flattened excitation). 1.0 = envelope passes through unshifted — combined
// with a nonzero stemPitch this is exactly the "formant-preserved" pitch
// shift (ReaPitch's formant slider at 0). Anything else deliberately moves
// the formants on top of/instead of the pitch shift.
var stemFormant = { vocals: 1.0, melody: 1.0, bass: 1.0, drums: 1.0 };

// ── Frequency-band gating for pitch/formant shift ────────────────────────────
// Restricts setPitch/setFormant above to a specific Hz range instead of the
// whole spectrum — e.g. pitch-shift only 200-2000Hz, leave the rest of the
// stem untouched. Unlike PITCH_OUT/FORMANT_OUT (numbered outlets), the masks
// this drives are NOT patch cords: each stem's copy of ebys-pitch.maxpat
// declares its OWN pair of named buffer~s ("ebys_pitch_mask_<stemshort>",
// "ebys_formant_mask_<stemshort>" — distinct per stem via pfft~'s "args
// <stemshort>", see ebys-analyze.maxpat's 4 pfft~ boxes and that subpatch's
// own header comments on obj-28/obj-29/obj-30/obj-31), and this js object
// pokes directly into them via Max's js Buffer API — same mechanism
// formant_lifter_init.js/band_mask_init.js use at load time, just triggered
// on demand here instead of once at boot.
//
// Inside ebys-pitch.maxpat, the mask value (0..1) per bin crossfades the
// stem's shifted spectrum against its untouched original: 1 = shift applies
// (in-band), 0 = pass through unshifted (out-of-band). Pitch and formant
// each read their OWN mask, so band-limiting one doesn't band-limit the
// other — see the SHARED vs OVERRIDE model just below.
//
// sample rate / FFT size match the codebase-wide convention (see
// analyze_reader.js, bpm_from_tempogram.js, eq_router.js's own "var SR =
// 44100") and ebys-pitch.maxpat's "pfft~ ... 1024 4" / "fft~ 512 512" sizing.
var MASK_SAMPLE_RATE = 44100;
var MASK_FFT_SIZE     = 1024;
var MASK_BINS         = MASK_FFT_SIZE / 2;   // fftin~ half-spectrum — see ebys-pitch.maxpat
var MASK_TAPER_BINS   = 3;   // ~130Hz linear taper at each edge — avoids hard-edge ringing
// full range = "no band restriction", the default and what a plain
// :pitchShift/:formantShift (no band commands ever issued) should still do.
var MASK_FULL_RANGE = { lo: 0, hi: MASK_SAMPLE_RATE / 2 };

// SHARED band per stem (set by :setShiftBand) — used by BOTH pitch and
// formant UNLESS that effect has its own override (below). Defaults to
// full range so existing :pitchShift/:formantShift behavior (whole
// spectrum) is unchanged for anyone who never touches band commands.
var sharedBand = {
    vocals: { lo: MASK_FULL_RANGE.lo, hi: MASK_FULL_RANGE.hi },
    melody: { lo: MASK_FULL_RANGE.lo, hi: MASK_FULL_RANGE.hi },
    bass:   { lo: MASK_FULL_RANGE.lo, hi: MASK_FULL_RANGE.hi },
    drums:  { lo: MASK_FULL_RANGE.lo, hi: MASK_FULL_RANGE.hi },
};
// Per-effect overrides — null means "use sharedBand". Set independently by
// :setPitchBand/:setFormantBand, cleared by :clearPitchBand/:clearFormantBand.
var pitchBandOverride   = { vocals: null, melody: null, bass: null, drums: null };
var formantBandOverride = { vocals: null, melody: null, bass: null, drums: null };

function hzToBin(hz) {
    var bin = Math.round(hz / (MASK_SAMPLE_RATE / MASK_FFT_SIZE));
    return Math.max(0, Math.min(MASK_BINS - 1, bin));
}

// Writes a tapered 0/1 gate into a named buffer~ — 1.0 for bins inside
// [loHz,hiHz], linearly tapered over MASK_TAPER_BINS at each edge, 0.0
// outside. Called with the full range this naturally comes out all-1.0
// (every bin index falls inside [loBin,hiBin], so the taper branches never
// trigger) — no special-casing needed for "band off".
function writeBandMask(bufferName, loHz, hiHz) {
    loHz = Math.max(0, parseFloat(loHz) || 0);
    hiHz = Math.max(loHz, parseFloat(hiHz) || 0);
    var loBin = hzToBin(loHz);
    var hiBin = hzToBin(hiHz);

    var b = new Buffer(bufferName);
    if (!b) {
        post("slot_router: writeBandMask — buffer '" + bufferName + "' not found (is this stem's ebys-pitch.maxpat instance loaded yet?)\n");
        return;
    }
    for (var i = 0; i < MASK_BINS; i++) {
        var w;
        if (i < loBin - MASK_TAPER_BINS || i > hiBin + MASK_TAPER_BINS) {
            w = 0.0;
        } else if (i < loBin) {
            w = (i - (loBin - MASK_TAPER_BINS)) / MASK_TAPER_BINS;
        } else if (i > hiBin) {
            w = ((hiBin + MASK_TAPER_BINS) - i) / MASK_TAPER_BINS;
        } else {
            w = 1.0;
        }
        b.poke(1, i + 1, Math.max(0, Math.min(1, w)));
    }
    b.send("dirty");
}

function effectivePitchBand(stem)   { return pitchBandOverride[stem]   || sharedBand[stem]; }
function effectiveFormantBand(stem) { return formantBandOverride[stem] || sharedBand[stem]; }

function pushPitchMask(stem) {
    var b = effectivePitchBand(stem);
    writeBandMask("ebys_pitch_mask_" + STEM_SHORT[stem], b.lo, b.hi);
}
function pushFormantMask(stem) {
    var b = effectiveFormantBand(stem);
    writeBandMask("ebys_formant_mask_" + STEM_SHORT[stem], b.lo, b.hi);
}

function bandTargets(stem) {
    return (String(stem) === "all") ? ["vocals", "melody", "bass", "drums"] : [String(stem)];
}

// setShiftBand <stem|all> <loHz> <hiHz> — sets the SHARED band (the default
// both pitch and formant use) and clears any independent per-effect
// overrides on the affected stem(s) — i.e. this is the "go back to one
// band for everything" call, not just an update to the fallback.
function setShiftBand(stem, loHz, hiHz) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) { post("slot_router: setShiftBand — unknown stem '" + t + "'\n"); continue; }
        sharedBand[t] = { lo: parseFloat(loHz) || 0, hi: parseFloat(hiHz) || 0 };
        pitchBandOverride[t]   = null;
        formantBandOverride[t] = null;
        pushPitchMask(t);
        pushFormantMask(t);
        post("slot_router: shiftBand[" + t + "] = " + sharedBand[t].lo.toFixed(1) + "-" + sharedBand[t].hi.toFixed(1) + "Hz (shared, pitch+formant)\n");
    }
}

// setPitchBand <stem|all> <loHz> <hiHz> — independent override, pitch only.
// Formant keeps using whatever it's already using (shared, or its own override).
function setPitchBand(stem, loHz, hiHz) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) { post("slot_router: setPitchBand — unknown stem '" + t + "'\n"); continue; }
        pitchBandOverride[t] = { lo: parseFloat(loHz) || 0, hi: parseFloat(hiHz) || 0 };
        pushPitchMask(t);
        post("slot_router: pitchBand[" + t + "] = " + pitchBandOverride[t].lo.toFixed(1) + "-" + pitchBandOverride[t].hi.toFixed(1) + "Hz (independent override)\n");
    }
}

// setFormantBand <stem|all> <loHz> <hiHz> — independent override, formant only.
function setFormantBand(stem, loHz, hiHz) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) { post("slot_router: setFormantBand — unknown stem '" + t + "'\n"); continue; }
        formantBandOverride[t] = { lo: parseFloat(loHz) || 0, hi: parseFloat(hiHz) || 0 };
        pushFormantMask(t);
        post("slot_router: formantBand[" + t + "] = " + formantBandOverride[t].lo.toFixed(1) + "-" + formantBandOverride[t].hi.toFixed(1) + "Hz (independent override)\n");
    }
}

// clearPitchBand/clearFormantBand <stem|all> — revert that one effect back
// to the shared band. clearShiftBand <stem|all> — full reset: shared band
// back to full-range AND both overrides cleared.
function clearPitchBand(stem) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) continue;
        pitchBandOverride[t] = null;
        pushPitchMask(t);
        post("slot_router: pitchBand[" + t + "] cleared — back to shared\n");
    }
}
function clearFormantBand(stem) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) continue;
        formantBandOverride[t] = null;
        pushFormantMask(t);
        post("slot_router: formantBand[" + t + "] cleared — back to shared\n");
    }
}
function clearShiftBand(stem) {
    var targets = bandTargets(stem);
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!sharedBand.hasOwnProperty(t)) continue;
        sharedBand[t] = { lo: MASK_FULL_RANGE.lo, hi: MASK_FULL_RANGE.hi };
        pitchBandOverride[t]   = null;
        formantBandOverride[t] = null;
        pushPitchMask(t);
        pushFormantMask(t);
        post("slot_router: shiftBand[" + t + "] reset to full range\n");
    }
}

// Per-stem stash of the params from the most recent uncommitted prepare().
// Cleared once commit() consumes it. A later prepare() for the same stem
// simply overwrites this — its own "set" has already silently repointed
// karma~ again, so there's nothing to undo.
var pendingPlay = { vocals: null, melody: null, bass: null, drums: null };

// Enable karma~'s built-in position/state report on all four stems, at boot
// and again on every autowatch reload (karma~ itself defaults this to a
// 50ms cadence already — this just tightens it a bit for the exact-resume
// feature in slicer.js, which reads these reports directly via 4 new patch
// cords into its own inlets 1-4, bypassing this object entirely since it
// has no return path back up to slicer.js). karma~'s data outlet (its
// second/right outlet) must be wired to slicer.js for any of this to reach
// anywhere — see slicer.js's own "Real-time karma~ position feed" comment.
//
// Called from loadbang() below, NOT run immediately at top level (as an
// IIFE, the way this used to be written) — outlet() calls made from code
// that executes during the script's initial top-level evaluation can fire
// before Max has finished wiring this box's outlets into the patcher,
// which is exactly the "bad outlet index 0/3/6/9" Max console errors this
// used to throw on every load/autowatch-recompile. Moving the same calls
// into a loadbang() function defers them until Max's own "the file (or, for
// a subpatch, this instance of it) is loaded" event — the same fix this
// file's own band_mask_init.js/formant_lifter_init.js companions already
// use for their init-on-load work.
function enableKarmaPositionReports() {
    for (var k = 0; k < 4; k++) {
        outlet(k * 3, "report", 20);
    }
}

function loadbang() {
    enableKarmaPositionReports();
}

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
    outlet(FORMANT_OUT[stem], stemFormant[stem]);  // ditto for the formant-warp gizmo~
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
        // Same float-atom guarantee prepare()/rescheduleLive() use for karma~'s
        // speed inlet: whole-number ratios (e.g. exactly 2.0 at +12 semitones)
        // have no fractional part, so Max JS's outlet() sends them as an INT
        // atom instead of a float. gizmo~'s ratio inlet — like karma~'s speed
        // inlet — needs a float atom or the message is silently a no-op, which
        // is exactly why round semitone values (12, -12, 0, 24...) were the
        // ones that appeared "broken" while others may have worked.
        outlet(PITCH_OUT[t], ratio + 1e-9);
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

// ── Per-stem formant control ─────────────────────────────────────────────────
// Sends a SEPARATE ratio to the second gizmo~ inside ebys-pitch.maxpat — the
// one that resamples the smoothed spectral envelope (formants), not the
// flattened excitation (pitch). Fully independent of setPitch/pitchShift
// above, same as ReaPitch's Pitch and Formant sliders don't move together.
//
// ratio 1.0 (default) = envelope passes through unshifted. Combined with a
// pitch shift elsewhere on the same stem, that's the classic "formant
// preserved" pitch shift — the vocal/instrument doesn't chipmunk/deepen at
// large shifts because the resonant body shape isn't being stretched along
// with the harmonic spacing. Anything else intentionally moves the formants
// on top of (or instead of) whatever pitch shift is set.
function setFormant(stem, ratio) {
    ratio = parseFloat(ratio);
    if (isNaN(ratio) || ratio <= 0) {
        post("slot_router: setFormant — invalid ratio " + ratio + "\n"); return;
    }
    var targets = (String(stem) === "all")
        ? ["vocals", "melody", "bass", "drums"]
        : [String(stem)];

    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!stemFormant.hasOwnProperty(t)) {
            post("slot_router: setFormant — unknown stem '" + t + "'\n"); continue;
        }
        stemFormant[t] = ratio;
        // Same int-vs-float atom guard as setPitch() above — see its comment.
        outlet(FORMANT_OUT[t], ratio + 1e-9);
        post("slot_router: formant[" + t + "] = " + ratio.toFixed(4)
             + "  (" + (Math.log(ratio) / Math.log(2) * 12).toFixed(2) + " st)\n");
    }
}

function setFormantSemitones(stem, n) {
    n = parseFloat(n);
    if (isNaN(n)) { post("slot_router: setFormantSemitones — invalid value\n"); return; }
    setFormant(stem, Math.pow(2, n / 12.0));
}

// formantShift — TUI command :formantShift <stem> <semitones>
// Alias for setFormantSemitones, named to match the TUI command directly —
// same pairing pitchShift() has with setPitchSemitones() above.
function formantShift(stem, semitones) {
    setFormantSemitones(stem, semitones);
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

// resumeSeek <stem> <frac 0..1> — explicit position correction, sent by
// slicer.js's start() right after resume()'s bare "play" for this stem.
// Belt-and-suspenders: karma~'s "stop"/"play" are supposed to pause and
// resume in place with no seek needed — that's the whole reasoning in
// resume()'s own comment above, and both the JS message chain and the patch
// wiring into karma~'s inlet 0 check out exactly as designed. In practice,
// though, real :stop→:start testing still showed each stem audibly jumping
// back to 0:00 of the file on resume. Rather than keep trusting karma~'s
// internal pause-state memory (undocumented/unverifiable from outside the
// external), explicitly re-seek to the wall-clock-computed resume position
// using the same "jump <frac>" message loopjump() already uses successfully
// elsewhere in this patch (there, jumping to buffer start 0; here, wherever
// :stop actually caught this stem). karma~'s jump is meant to reposition a
// CURRENTLY PLAYING instance without a seam, so this only ever fires after
// resume()'s "play" has already restarted it, never before.
function resumeSeek(stem, frac) {
    var base = STEM_BASE[stem];
    if (base === undefined) { post("slot_router: resumeSeek — unknown stem '" + stem + "'\n"); return; }
    frac = parseFloat(frac);
    if (isNaN(frac)) { post("slot_router: resumeSeek [" + stem + "] — invalid frac\n"); return; }
    frac = Math.max(0, Math.min(1, frac));
    outlet(base + 0, "jump", frac);
    post("slot_router [" + stem + "]: resumeSeek → jump " + frac.toFixed(4) + "\n");
}
