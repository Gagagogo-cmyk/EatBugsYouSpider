// EBYS — EQ Router  v1
//
// ── Role ──────────────────────────────────────────────────────────────────────
// eq_router.js owns all per-stem EQ and trim parameters.
// It receives commands from ws_server.js (via TUI) and computes biquad filter
// coefficients on the fly, sending them to the appropriate biquad~ objects in
// the patch via receive objects.
//
// ── Signal chain position ────────────────────────────────────────────────────
//   pfft~/gizmo~ → *~(trim) → biquad~(low) → biquad~(mid) → biquad~(high)
//                                                               → *~0.7 → *~(fader) → FX tap → M/S → pan
//
// ── EQ Bands ─────────────────────────────────────────────────────────────────
//   Low      — low shelf,  fc=80 Hz,        Q=0.7,        range -96..+24 dB  (kill = -96 dB)
//   Mid      — bell/peak,  fc=200–8000 Hz,  Q=0.1–10,     range -96..+24 dB  (sweepable center,
//                                            default 0.7   adjustable width — see eqMidQ)
//   High     — high shelf, fc=10000 Hz,     Q=0.7,        range -96..+24 dB
//   Trim     — pre-EQ input gain, range ±12 dB (0 dB default = 1.0 linear)
//   Fader    — post-EQ channel level, 0–1 linear (doubles as mute gate)
//
// ── Commands (inlet 0) ────────────────────────────────────────────────────────
//   eqLow     <stem> <dB>   — low shelf gain  (-96 to +24 dB; -96 = kill)
//   eqMid     <stem> <dB>   — mid bell gain   (-96 to +24 dB; -96 = kill)
//   eqMidFreq <stem> <hz>   — mid bell center frequency (200–8000 Hz)
//   eqMidQ    <stem> <Q>    — mid bell width/"pointiness" (0.1–10; low = wide/gentle bell,
//                             high = narrow/pointy bell; default 0.7)
//   eqHigh    <stem> <dB>   — high shelf gain (-96 to +24 dB; -96 = kill)
//   trim      <stem> <dB>   — pre-EQ input gain (-12 to +12 dB)
//
//   Stems: vocals | melody | bass | drums | all
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  → biquad~ coefficients and trim gain via patch receive objects
//   1  → status to ws_server (for TUI feedback)
// ──────────────────────────────────────────────────────────────────────────────

autowatch = 1;
inlets    = 1;
outlets   = 2;

var TRACKS       = ['vocals', 'melody', 'bass', 'drums'];
var LIVE_TRACKS  = ['live1', 'live2'];
var ALL_TRACKS   = TRACKS.concat(LIVE_TRACKS);
var SR           = 44100;   // sample rate — update if you use a different rate

// EQ band defaults — low and high shelves are fixed frequency; mid is parametric
var EQ_BANDS = {
    low:  { type: 'lowshelf',  fc: 80,    Q: 0.7 },
    mid:  { type: 'peak',      fc: 1000,  Q: 0.7 },   // fc overridden per stem via eqMidFreq
    high: { type: 'highshelf', fc: 10000, Q: 0.7 },
};

// Mid frequency range: 200 Hz – 8000 Hz
var MID_FC_MIN = 200;
var MID_FC_MAX = 8000;

// Mid Q range: 0.1 (wide, gentle "shelf-like" bump) – 10 (narrow, surgical/
// "pointy" bell) — standard parametric-EQ Q span. Default 0.7 matches the
// fixed value every band used before this was made adjustable, so nothing
// changes tonally until a stem's Q is actually touched.
var MID_Q_MIN = 0.1;
var MID_Q_MAX = 10;

// Current state per stem:
//   low/mid/high = gain dB  |  midFreq = mid bell center Hz  |  midQ = mid bell
//   Q (width/"pointiness" — see eqMidQ)  |  trim = input gain dB
//   atten  = linear pre-chain attenuator (0–1) → receive stemAtten_<stem> in patch
//   fader  = post-EQ level (0–1 linear, also used as mute gate)  |  mute = 0|1
// fader default raised 0.3 → 0.7 (was ~21% of unity through the chain's fixed
// ×0.7 stage; now ~49%) — the old default read as generally "weak." Safe to
// raise because the master bus now has a hard clip~ -1..1 safety net right
// before every dac~ output (main/booth/rec — see ebys-analyze.maxpat), so
// even if all 4 stems' peaks happened to align, the output is guaranteed
// bounded rather than wrapping/digital-overing. Left short of 1.0 so normal
// mixing still has some headroom before the clipper is doing constant work
// (which would sound like audible distortion rather than just being loud).
var state = {
    vocals: { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
    melody: { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
    bass:   { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
    drums:  { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
    live1:  { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
    live2:  { low: 0, mid: 0, midFreq: 1000, midQ: 0.7, high: 0, trim: 0, mute: 0, fader: 0.7, atten: 0.3 },
};

// ── Biquad coefficient math ───────────────────────────────────────────────────
// All formulas from Audio EQ Cookbook (Robert Bristow-Johnson).
//
// Max biquad~ takes coefficients in the order  a0 a1 a2 b1 b2  (inlets 1..5),
// with the difference equation
//     y[n] = a0·x[n] + a1·x[n-1] + a2·x[n-2] − b1·y[n-1] − b2·y[n-2]
// i.e. Max's a's are the FEEDFORWARD (numerator) terms and Max's b's are the
// FEEDBACK (denominator) terms — the OPPOSITE naming to the cookbook, where b*
// is numerator and a* is denominator. So the correct list to send biquad~ is
//     [ b0/a0 , b1/a0 , b2/a0 , a1/a0 , a2/a0 ]   (cookbook symbols)
// Getting this order wrong puts the input-gain term into a feedback slot: the
// filter then acts like a broadband gain and can go unstable (NaN). Each
// function below returns exactly that Max-ready order.

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function lowShelf(fc, gainDB, Q) {
    var A  = Math.pow(10, gainDB / 40);
    var w0 = 2 * Math.PI * fc / SR;
    var cw = Math.cos(w0);
    var sw = Math.sin(w0);
    var al = sw / (2 * Q);

    var b0 =  A * ((A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * al);
    var b1 =  2 * A * ((A - 1) - (A + 1) * cw);
    var b2 =  A * ((A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * al);
    var a0 =       (A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * al;
    var a1 = -2 * ((A - 1) + (A + 1) * cw);
    var a2 =       (A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * al;

    return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0];  // Max biquad~ order: a0 a1 a2 b1 b2
}

function highShelf(fc, gainDB, Q) {
    var A  = Math.pow(10, gainDB / 40);
    var w0 = 2 * Math.PI * fc / SR;
    var cw = Math.cos(w0);
    var sw = Math.sin(w0);
    var al = sw / (2 * Q);

    var b0 =  A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * al);
    var b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    var b2 =  A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * al);
    var a0 =       (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * al;
    var a1 =  2 * ((A - 1) - (A + 1) * cw);
    var a2 =       (A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * al;

    return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0];  // Max biquad~ order: a0 a1 a2 b1 b2
}

function peak(fc, gainDB, Q) {
    var A  = Math.pow(10, gainDB / 40);
    var w0 = 2 * Math.PI * fc / SR;
    var cw = Math.cos(w0);
    var al = Math.sin(w0) / (2 * Q);

    var b0 =  1 + al * A;
    var b1 = -2 * cw;
    var b2 =  1 - al * A;
    var a0 =  1 + al / A;
    var a1 = -2 * cw;
    var a2 =  1 - al / A;

    return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0];  // Max biquad~ order: a0 a1 a2 b1 b2
}

// fcOverride/qOverride are optional — used for the mid band to pass its
// per-stem parametric frequency and Q (low/high shelves stay fixed at
// EQ_BANDS' own Q — only the mid bell's width is user-adjustable, see
// eqMidQ below).
function computeCoefs(band, gainDB, fcOverride, qOverride) {
    var b  = EQ_BANDS[band];
    var fc = fcOverride || b.fc;
    var Q  = qOverride || b.Q;
    if (b.type === 'lowshelf')  return lowShelf(fc,  gainDB, Q);
    if (b.type === 'highshelf') return highShelf(fc, gainDB, Q);
    return peak(fc, gainDB, Q);
}

// ── Send helpers ──────────────────────────────────────────────────────────────

function sendCoefs(stem, band, gainDB) {
    // For mid band, pass the per-stem parametric frequency and Q
    var fcOverride = (band === 'mid') ? state[stem].midFreq : undefined;
    var qOverride  = (band === 'mid') ? state[stem].midQ    : undefined;
    var coefs = computeCoefs(band, gainDB, fcOverride, qOverride);
    // Output: eq_<band>_coef_<stem>  a1 a2 b0 b1 b2
    // The patch routes this to the matching biquad~ via receive+prepend chain.
    outlet(0, 'eq_' + band + '_coef_' + stem,
           coefs[0], coefs[1], coefs[2], coefs[3], coefs[4]);
    outlet(1, 'param', 'eq' + band[0].toUpperCase() + band.slice(1) + '_' + stem, gainDB);
}

function sendTrim(stem, gainDB) {
    var linear = Math.pow(10, gainDB / 20);
    outlet(0, 'trim_' + stem, linear);
    outlet(1, 'param', 'trim_' + stem, gainDB);
}

// ── Command handlers ──────────────────────────────────────────────────────────

function applyEQ(stem, band, db) {
    db = clamp(parseFloat(db) || 0, -96, 24);
    state[stem][band] = db;
    sendCoefs(stem, band, db);
    post('eq_router: eq' + band + '[' + stem + '] = ' + db.toFixed(1) + ' dB\n');
}

function eqLow(stem, db) {
    if (!stem) return;
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state[targets[i]]) applyEQ(targets[i], 'low', db);
    }
}

function eqMid(stem, db) {
    if (!stem) return;
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state[targets[i]]) applyEQ(targets[i], 'mid', db);
    }
}

function eqHigh(stem, db) {
    if (!stem) return;
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state[targets[i]]) applyEQ(targets[i], 'high', db);
    }
}

// ── eqMidFreq — parametric mid center frequency ───────────────────────────────
// eqMidFreq <stem> <hz>   — set mid bell center frequency (200–8000 Hz)
// Recomputes mid biquad coefficients at the new frequency with current gain.
function eqMidFreq(stem, hz) {
    if (!stem) return;
    var fc = clamp(parseFloat(hz) || 1000, MID_FC_MIN, MID_FC_MAX);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state[t]) continue;
        state[t].midFreq = fc;
        sendCoefs(t, 'mid', state[t].mid);   // recompute with new freq, same gain
        outlet(1, 'param', 'eqMidFreq_' + t, fc);
        post('eq_router: midFreq[' + t + '] = ' + fc.toFixed(0) + ' Hz\n');
    }
}

// ── eqMidQ — parametric mid bell width ────────────────────────────────────────
// eqMidQ <stem> <Q>   — set mid bell Q/"pointiness" (0.1–10)
// Recomputes mid biquad coefficients at the new Q with current gain and freq.
// Higher Q = narrower, more surgical bell; lower Q = wider, gentler bell.
function eqMidQ(stem, q) {
    if (!stem) return;
    var Q = clamp(parseFloat(q) || MID_Q_MIN, MID_Q_MIN, MID_Q_MAX);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state[t]) continue;
        state[t].midQ = Q;
        sendCoefs(t, 'mid', state[t].mid);   // recompute with new Q, same gain+freq
        outlet(1, 'param', 'eqMidQ_' + t, Q);
        post('eq_router: midQ[' + t + '] = ' + Q.toFixed(2) + '\n');
    }
}

function trim(stem, db) {
    if (!stem) return;
    db = clamp(parseFloat(db) || 0, -12, 12);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state[targets[i]]) {
            state[targets[i]].trim = db;
            sendTrim(targets[i], db);
            post('eq_router: trim[' + targets[i] + '] = ' + db.toFixed(1) + ' dB\n');
        }
    }
}

// ── Solo state ────────────────────────────────────────────────────────────────
// Tracks which stems are currently soloed (independent of mute state).
var soloState = { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 };

// Reapply fader routing for all tracks given current solo + mute states.
// If any stem is soloed, only soloed stems are audible.
// If no stem is soloed, individual mute states govern.
function applyMuteAndSolo() {
    var anySolo = false;
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        if (soloState[ALL_TRACKS[i]]) { anySolo = true; break; }
    }
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        var t = ALL_TRACKS[i];
        if (!state[t]) continue;
        var silenced = anySolo ? !soloState[t] : !!state[t].mute;
        var effective = silenced ? 0 : state[t].fader;
        outlet(0, 'fader_' + t, effective);
    }
}

// ── setStemSolo ───────────────────────────────────────────────────────────────
// setStemSolo <stem> <0|1>  — solo (1=solo on, 0=solo off).
// Solo is additive: multiple stems can be soloed simultaneously.
// Un-soloing the last soloed stem restores each stem's individual mute state.
function setStemSolo(stem, val) {
    if (!stem) return;
    var v = (parseInt(val) === 1 || String(val) === 'on') ? 1 : 0;
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!(t in soloState)) continue;
        soloState[t] = v;
        outlet(1, 'param', 'solo_' + t, v);
        post('eq_router: solo[' + t + '] = ' + v + '\n');
    }
    applyMuteAndSolo();
}

// ── setStemMute ───────────────────────────────────────────────────────────────
// setStemMute <stem> <0|1>  — mute (0=unmute, 1=mute). Gates the fader to 0.
// Also works for live1 / live2 channels.
function setStemMute(stem, val) {
    if (!stem) return;
    var v = (val == 1 || String(val) === 'on') ? 1 : 0;
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state[t]) continue;
        state[t].mute = v;
        outlet(1, 'param', 'mute_' + t, v);
        post('eq_router: mute[' + t + '] = ' + (v ? 'MUTED' : 'unmuted') + '\n');
    }
    applyMuteAndSolo();
}

// ── setFader ──────────────────────────────────────────────────────────────────
// setFader <stem> <0–1>  — post-EQ channel fader (independent of gain/mute)
// Also works for live1 / live2 channels.
function setFader(stem, val) {
    if (!stem) return;
    var v = clamp(parseFloat(val) || 0, 0, 1);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state[t]) continue;
        state[t].fader = v;
        outlet(0, 'fader_' + t, v);
        outlet(1, 'param', 'fader_' + t, v);
        post('eq_router: fader[' + t + '] = ' + v.toFixed(3) + '\n');
    }
}

function info() {
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        var t = ALL_TRACKS[i];
        var s = state[t];
        post('eq_router: ' + t + ' — trim=' + s.trim.toFixed(1)
             + ' low=' + s.low.toFixed(1)
             + ' mid=' + s.mid.toFixed(1) + 'dB@' + s.midFreq.toFixed(0) + 'Hz' + ' Q=' + s.midQ.toFixed(2)
             + ' high=' + s.high.toFixed(1) + ' dB'
             + '  fader=' + s.fader.toFixed(2)
             + (s.mute ? '  [MUTED]' : '')
             + (soloState[t] ? '  [SOLO]' : '') + '\n');
    }
}

// ── setAtten ──────────────────────────────────────────────────────────────────
// setAtten <stem|all> <0–1>  — linear pre-chain attenuator
// In Max patch: connect [receive stemAtten_<stem>] to the *~ attenuator per stem.
function setAtten(stem, val) {
    if (!stem) return;
    var v = clamp(parseFloat(val) || 0, 0, 1);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state[t]) continue;
        state[t].atten = v;
        outlet(0, 'stemAtten_' + t, v);
        outlet(1, 'param', 'stemAtten_' + t, v);
        post('eq_router: atten[' + t + '] = ' + v.toFixed(4) + '\n');
    }
}

// Re-push all state to Max (e.g. after autowatch reload)
function resend() {
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        var t = ALL_TRACKS[i];
        outlet(0, 'stemAtten_' + t, state[t].atten);
        sendTrim(t, state[t].trim);
        sendCoefs(t, 'low',  state[t].low);
        sendCoefs(t, 'mid',  state[t].mid);   // uses state[t].midFreq internally
        sendCoefs(t, 'high', state[t].high);
    }
    applyMuteAndSolo();
    post('eq_router: resent all params\n');
}

function loadbang() { resend(); }

// Catch-all: suppress warnings for commands owned by other JS objects
function anything() {}
