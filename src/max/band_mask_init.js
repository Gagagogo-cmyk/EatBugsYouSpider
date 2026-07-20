// band_mask_init.js — per-stem companion to ebys-pitch.maxpat's frequency-band
// gating. Each of the 4 pfft~ instances loads its OWN copy of ebys-pitch.maxpat
// with a distinct "args <stemshort>" (see ebys-analyze.maxpat's 4 pfft~ boxes:
// "pfft~ ebys-pitch.maxpat 1024 4 args voc/mel/bss/drm"), which substitutes
// "#1" everywhere inside that subpatch — including this object's own creation
// argument ("js band_mask_init.js #1"), so jsarguments[1] here is that same
// stem suffix. That's how "ebys_pitch_mask_#1"/"ebys_formant_mask_#1" resolve
// to 4 DISTINCT buffer~ names (ebys_pitch_mask_voc, _mel, _bss, _drm, and
// likewise for formant) instead of one shared/broadcast buffer the way
// ebys_pitchWindow and ebys_formant_lifter are (those are intentionally
// IDENTICAL across all 4 stems; these masks are the opposite — each stem's
// frequency band is independent, set via :setShiftBand/:setPitchBand/
// :setFormantBand in slot_router.js).
//
// All this script does is make sure both buffers exist with sane content
// (every bin passed, i.e. "no band restriction") the instant the patch
// loads — BEFORE any :setShiftBand/etc. command has ever run. Without this,
// buffer~ defaults its content to all zeros, which would mean "shift
// disabled everywhere" by default and silently break existing :pitchShift/
// :formantShift behavior (full-spectrum shift) for anyone who never touches
// the new band commands. slot_router.js overwrites these same buffers with
// real content the moment a band command comes in; this is purely the
// pre-first-command fallback.

autowatch = 1;
inlets    = 1;
outlets   = 0;

var MASK_BINS = 512;   // must match ebys-pitch.maxpat's buffer~/fft~ sizing
                        // comments (fftin~ half-spectrum of a 1024-pt FFT)
var stem = jsarguments[1];

function fillFullPass(bufferName) {
    var b = new Buffer(bufferName);
    if (!b) {
        post("band_mask_init: buffer '" + bufferName + "' not found — is it declared in ebys-pitch.maxpat?\n");
        return;
    }
    for (var i = 0; i < MASK_BINS; i++) {
        b.poke(1, i + 1, 1.0);   // 1.0 = "shift applies here" everywhere, i.e. no band restriction
    }
    b.send("dirty");
}

function loadbang() {
    if (!stem) {
        post("band_mask_init: no stem suffix passed via jsarguments — check ebys-analyze.maxpat's \"args <stem>\" on this pfft~ instance\n");
        return;
    }
    fillFullPass("ebys_pitch_mask_" + stem);
    fillFullPass("ebys_formant_mask_" + stem);
    post("band_mask_init [" + stem + "]: pitch/formant masks initialized full-pass (" + MASK_BINS + " bins)\n");
}
