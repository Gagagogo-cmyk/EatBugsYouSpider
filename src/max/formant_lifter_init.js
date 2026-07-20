// formant_lifter_init.js — fills the "ebys_formant_lifter" buffer~ with a
// real-cepstrum lifter window, used by the formant-preserving pitch shifter
// in ebys-pitch.maxpat (see that file's cartopol~/log~/fft~/.../poltocar~
// chain for the full picture).
//
// ── What a "lifter" is here ───────────────────────────────────────────────
// ebys-pitch.maxpat computes the real cepstrum of each frame's log-magnitude
// spectrum (an FFT taken across the BIN axis itself, not time). Low
// quefrency bins of that cepstrum carry the slowly-varying spectral
// envelope (formants); high quefrency bins carry the fast-varying harmonic
// fine structure (pitch). "Liftering" = zeroing out the high-quefrency bins
// before transforming back, which leaves only a smoothed version of the
// log-magnitude spectrum: the envelope, with the pitch-periodic ripple
// removed. That's exactly the E(f) the patch divides out of the original
// spectrum (to flatten it before pitch-shifting) and re-imposes afterward
// (optionally frequency-warped by formantRatio) — the mechanism that lets
// pitch and formant move independently instead of both scaling together
// the way a plain gizmo~ shift does.
//
// This script just builds the 0/1 (tapered) window that does the zeroing:
// 1.0 for low quefrency (keep — envelope), tapering to 0.0 beyond CUTOFF
// (discard — pitch ripple).
//
// ── Mirroring ─────────────────────────────────────────────────────────────
// A real-valued signal's FFT is conjugate-symmetric, so quefrency bin k and
// bin (FFT_SIZE - k) must get the identical lifter weight — otherwise the
// smoothed envelope comes back asymmetric and colors the sound. Distance is
// measured from whichever edge of the buffer is closer (min(i, N-i)).
//
// ── When this runs ────────────────────────────────────────────────────────
// Triggered by loadbang inside ebys-pitch.maxpat, once per stem's pfft~
// instance (4 instances load a copy of this same subpatch — same pattern
// slot_router.js's setWindow() comment describes for send/receive). All 4
// copies write into the SAME buffer~ name, so this runs up to 4x at boot;
// each run just rewrites identical values, which is harmless.
//
// ── Tuning ────────────────────────────────────────────────────────────────
// CUTOFF is chosen well below any stem's pitch-period quefrency (i.e. below
// where a fundamental's harmonic comb would show up in the cepstrum) and
// well above formant-scale spectral detail, so it separates the two without
// needing per-stem/per-note tuning. TAPER softens the cutoff edge — a hard
// rectangular lifter rings/smears the envelope; a short linear ramp is the
// standard cheap fix without needing a full raised-cosine lifter window.
//
// NOT independently verified against a running Max instance — sanity-check
// with :formantShift <stem> 0 (should sound identical to plain :pitchShift
// at the same semitones) before trusting deliberate formant shifts.

autowatch = 1;
inlets    = 1;
outlets   = 0;

// FFT_SIZE here is the CEPSTRUM length, not the outer pfft~'s 1024 FFT size.
// fftin~ only sends the non-redundant half-spectrum of a real signal (see
// fftin~'s own docs: "output frame is only half the size of the parent
// pfft~ object's FFT size"), so the log-magnitude vector this lifter
// multiplies against — and therefore the buffer~/fft~/ifft~ sizes in
// ebys-pitch.maxpat — is 1024/2 = 512, matching "buffer~ ebys_formant_lifter
// 512" and "fft~ 512 512" / "ifft~ 512 512" in that file. Update all three
// together if the outer pfft~'s FFT size ever changes.
var FFT_SIZE = 512;
var CUTOFF   = 40;
var TAPER    = 8;

function fillLifter() {
    var b = new Buffer("ebys_formant_lifter");
    if (!b) {
        post("formant_lifter_init: buffer 'ebys_formant_lifter' not found — is buffer~ ebys_formant_lifter " + FFT_SIZE + " declared in ebys-pitch.maxpat?\n");
        return;
    }
    for (var i = 0; i < FFT_SIZE; i++) {
        var q = Math.min(i, FFT_SIZE - i);   // quefrency distance from nearest edge (mirrored)
        var w;
        if (q < CUTOFF - TAPER) {
            w = 1.0;
        } else if (q < CUTOFF) {
            w = (CUTOFF - q) / TAPER;        // linear taper 1.0 -> 0.0
        } else {
            w = 0.0;
        }
        b.poke(1, i + 1, w);   // channel 1, 1-indexed sample position (buffer~ convention)
    }
    b.send("dirty");
    post("formant_lifter_init: filled ebys_formant_lifter (" + FFT_SIZE + " samples, cutoff=" + CUTOFF + ", taper=" + TAPER + ")\n");
}

function loadbang() {
    fillLifter();
}
