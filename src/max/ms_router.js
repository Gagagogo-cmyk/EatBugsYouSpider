// EBYS — MS Router  v1
//
// *** NOT LIVE — DO NOT EDIT EXPECTING IT TO AFFECT PLAYBACK ***
// Discovered 2026-07-09: the js object in ebys-analyze.maxpat is typed
// "js spat_fx_router.js" — that's the argument Max actually uses to load a
// script, regardless of a stray saved_object_attributes.filename on the same
// box that happened to say "ms_router.js". This file has never been the one
// running live; every joystick/tilt fix from this session was applied here
// first and only actually took effect once it was ported into
// spat_fx_router.js (which has the real, currently-loaded logic — see its
// header). Kept around for its comments/history, not as something to sync
// forward from here on. If real-time behavior needs to change, edit
// spat_fx_router.js.
//
// ── Role ──────────────────────────────────────────────────────────────────────
// ms_router.js owns all stereo and FX routing parameters.
// It receives commands from ws_server.js (via TUI) and forwards them to the
// appropriate Max `receive` objects in the patch.
//
// ── Commands (inlet 0) ────────────────────────────────────────────────────────
//   width    <stem> <0–1>    — M/S stereo width per stem (0=mono, 1=full wide)
//   joystick <stem> <x> <y> — 2D quad pan  x=-1(L)..+1(R)  y=-1(rear)..+1(front)
//   fxSend   <0–1>           — send level from master mix to dac~ 3 4
//   fxReturn <0–1>           — return level from adc~ 3 4 to main mix
//
// Stems: vocals | melody | bass | drums | all
//
// ── Outlets ───────────────────────────────────────────────────────────────────
//   0  → named receive objects (via Max `send` messaging)
//        send width_vocals <v>
//        send joyX_vocals <v>    send joyY_vocals <v>
//        send fxsend1 <v>        send fxreturn1 <v>
//   1  → status to ws_server (for TUI feedback)
//        param key value
// ──────────────────────────────────────────────────────────────────────────────

autowatch = 1;
inlets    = 1;
outlets   = 2;

var TRACKS = ['vocals', 'melody', 'bass', 'drums'];

// Current state (for info / recall)
// joy/masterJoy default to y:1 (full front) — stereo front pair only, not
// spread across all four speakers — per default-behavior request; x stays 0
// (centered L/R). Only affects the boot default; any real :joystick /
// :masterJoystick command overrides it same as before.
var state = {
    width:       { vocals: 0.5, melody: 0.5, bass: 0.5, drums: 0.5 },
    joy:         { vocals: {x:0, y:1}, melody: {x:0, y:1},
                   bass:   {x:0, y:1}, drums:  {x:0, y:1} },
    masterJoy:   { x: 0, y: 1 },
    fxSend:      { vocals: 0, melody: 0, bass: 0, drums: 0 },
    fxReturn:    0,
    masterGain:  0.3,    // ≈ -10 dB default; raise via :master
};

// Analysis mode: when true, stemMS messages from slicer drive width automatically.
// Set to false via :analysisMode off to allow fully manual TUI control.
var analysisDriven = true;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// quadPanGains is kept for masterPan only (rotates the full 4ch mix front↔rear)
function quadPanGains(angleDeg) {
    var rad    = ((angleDeg % 360) + 360) % 360 * Math.PI / 180;
    var gFront = Math.sqrt((Math.cos(rad) + 1) / 2);
    var gRear  = Math.sqrt(1 - gFront * gFront);
    return { panFL: gFront, panRL: gRear, panFR: gFront, panRR: gRear };
}

function sendToMax(name, value) {
    // Use Max's `send` mechanism: outlet a message that will be caught by `receive <name>`
    // In Max JS, you can't call send() directly, but you CAN use outlet + a patch-level
    // route/send. Instead we use a simpler approach: output "send <name> <value>" on outlet 0
    // and the patch uses [route send] → [prepend <name>] → [send <name>].
    //
    // Simpler: we connect ms_router outlet 0 to individual `receive` objects via Max wiring.
    // Each param gets its own outlet, but that would need many outlets.
    //
    // Best approach for Max JS: use the `send` function if available, or output a tagged message.
    // We output: name value  — the patch routes on first word via route objects wired to receives.
    outlet(0, name, value);
}

function applyWidth(stem, w) {
    w = clamp(parseFloat(w) || 0, 0, 1);
    state.width[stem] = w;
    // User-facing 0..1 → DSP side-channel multiplier 0..2: 0 = mono (side
    // silenced), 0.5 = 1.0 (unity — normal stereo width), 1 = 2.0 (doubled).
    // Was sending the raw w, i.e. only half the intended side level, so :width
    // felt weak/dead. Match spat_fx_router.js and the *~ width_<stem> convention.
    var sideMult = w * 2;
    sendToMax('width_' + stem, sideMult);
    outlet(1, 'param', 'width_' + stem, w);
    post('ms_router: width[' + stem + '] = ' + w.toFixed(3) + '  (side×' + sideMult.toFixed(2) + ')\n');
}

function applyJoystick(stem, x, y) {
    x = clamp(parseFloat(x) || 0, -1, 1);
    y = clamp(parseFloat(y) || 0, -1, 1);
    state.joy[stem] = { x: x, y: y };
    // Same tilt-not-absolute-repan fix as masterJoystick, applied per stem.
    // jp_LR_L_<stem>/jp_LR_R_<stem> used to both read the same joyX_<stem>
    // (shared value) — at center that sent both pan2s to 0.5, splitting the
    // L-bus and R-bus content 50/50 EACH, collapsing every stem to mono at
    // center regardless of upstream content. The patch was already rewired
    // (jp_LR_L_<stem>/jp_LR_R_<stem> inlet1 now read joyTiltL_<stem>/
    // joyTiltR_<stem> via new send/receive pairs + extended route args) but
    // this function was never updated to actually send those names — so
    // every stem's L/R pan stage has been frozen at its pan2 default (0.5,
    // center) ever since, which also explains why the master mix sounded
    // centered regardless of masterJoystick position: master's L/R buses
    // are the sum of all 4 stems' panned output, so if every stem going in
    // is stuck at center (near-mono), master tilt has nothing to redistribute.
    // joyX_<stem>'s old receive (rcv_joyX_<stem>) is now orphaned in the
    // patch (feeds nothing) — no longer sent.
    //
    // RANGE FIX: pan2's position inlet is documented (Cycling'74) as -1..+1,
    // not 0..1 — confirmed by the exact fault pattern reported: x=+1 (both
    // tilts=1, a valid hard-right extreme in EITHER convention) sounded
    // correct, but x=0 and x=-1 (tilts of 0, intended as "stay home left")
    // landed at true pan2 CENTER instead of hard-left, since 0 is the
    // midpoint of -1..1, not an extreme — biasing everything right and
    // undershooting hard-left. Rescale the 0..1 shape (kept as-is — it's the
    // right SHAPE, piecewise-flat-then-ramping — just the wrong RANGE) into
    // -1..1 via *2-1. joyY_<stem> gets the same fix: it's already -1..1
    // native, so no (y+1)/2 rescale is needed at all — send it straight through.
    // CORRECTION: the comment above is wrong about the patch. There is NO
    // receive joyTiltL_<stem>/joyTiltR_<stem> anywhere — the pan2s (jp_LR_L_<stem>
    // / jp_LR_R_<stem>) read `receive joyX_<stem>` (verified). So sending the
    // tilt names was a dead message and every stem's L/R pan sat frozen (stuck
    // panned left). pan2 position IS native -1..+1 (0 = center), and the stems
    // are mono, so send the raw x/y straight to joyX_<stem>/joyY_<stem>.
    sendToMax('joyX_' + stem, x);
    sendToMax('joyY_' + stem, y);
    outlet(1, 'param', 'joyX_' + stem, x);
    outlet(1, 'param', 'joyY_' + stem, y);
    post('ms_router: joystick[' + stem + '] x=' + x.toFixed(2) + ' y=' + y.toFixed(2) + '\n');
}

// ── Command handlers ──────────────────────────────────────────────────────────

function width(stem, value) {
    if (!stem) return;
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state.width.hasOwnProperty(targets[i])) applyWidth(targets[i], value);
    }
}

// joystick <stem> <x> <y>
//   x: -1 (full left) to +1 (full right)
//   y: -1 (full rear) to +1 (full front)
//   stem: vocals | drums | bass | melody | all
function joystick(stem, x, y) {
    if (!stem) return;
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state.joy.hasOwnProperty(targets[i])) applyJoystick(targets[i], x, y);
    }
}

// fxSend <stem> <0–1>  — per-stem send level to FX bus
// fxSend all <0–1>    — set all stems at once
// In Max: each stem's send goes to a *~ that feeds the FX bus (dac~ 3 4)
// so each stem can be independently sent to the reverb/delay/etc.
function fxSend(stem, value) {
    // Back-compat: if only one argument, treat as global (set all)
    if (value === undefined) { value = stem; stem = 'all'; }
    var v = clamp(parseFloat(value) || 0, 0, 1);
    var targets = String(stem) === 'all' ? TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state.fxSend.hasOwnProperty(t)) continue;
        state.fxSend[t] = v;
        sendToMax('fxsend_' + t, v);
        outlet(1, 'param', 'fxSend_' + t, v);
        post('ms_router: fxSend[' + t + '] = ' + v.toFixed(3) + '\n');
    }
}

// :fxStereo 0 | 1  (or off | on)
// 0 = mono  — same mono sum on dac~ 3+4, return from adc~ 3 only (default, for mono pedals)
// 1 = stereo — master L/R on dac~ 3/4 separately, return from adc~ 3 (L) and adc~ 4 (R)
function fxStereo(val) {
    var v = (String(val) === '1' || String(val).toLowerCase() === 'on') ? 1 : 0;
    sendToMax('fxstereo', v);
    outlet(1, 'param', 'fxStereo', v);
    post('ms_router: fxStereo = ' + (v ? 'stereo' : 'mono') + '\n');
}

function fxReturn(value) {
    var v = clamp(parseFloat(value) || 0, 0, 1);
    state.fxReturn = v;
    sendToMax('fxreturn1', v);
    outlet(1, 'param', 'fxReturn', v);
    post('ms_router: fxReturn = ' + v.toFixed(3) + '\n');
}

// ── masterJoystick ────────────────────────────────────────────────────────────
// masterJoystick <x> <y>  — 2D position for the entire 4ch mix
//   x: -1 (full left) to +1 (full right)
//   y: -1 (full rear) to +1 (full front)
// Uses the same pan2 joystick chain as per-stem, applied to the summed buses:
//   left-content  = FL + RL bus
//   right-content = FR + RR bus
function masterJoystick(x, y) {
    x = clamp(parseFloat(x) || 0, -1, 1);
    y = clamp(parseFloat(y) || 0, -1, 1);
    state.masterJoy = { x: x, y: y };
    // L/R is a TILT on top of whatever's already there, not an absolute
    // re-pan. mj_LR_L and mj_LR_R used to both read the same masterJoyX —
    // at center that sent both pan2s to their own 0.5, splitting the L-bus
    // and R-bus content 50/50 EACH, so the two summed outputs came out
    // identical (mono) at center regardless of any pan already applied
    // upstream per-stem. Now each pan2 gets its own value: at x=0, tiltL
    // keeps the L-bus fully left and tiltR keeps the R-bus fully right
    // (pass-through, existing stereo image preserved); moving the joystick
    // bleeds one bus toward the other side instead of re-deriving an
    // absolute center. (mj_LR_L/mj_LR_R now read masterTiltL/masterTiltR —
    // see the new route args + receive objects added in ebys-analyze.maxpat.)
    //
    // RANGE FIX: confirmed via Cycling'74 docs that pan2's position inlet is
    // -1..+1, not 0..1. Sending 0 for "stay home left" was actually landing
    // on pan2's CENTER (0 is the midpoint of -1..1), not its left extreme —
    // matched exactly by the reported symptom: x=+1 (tilt=1, a valid
    // hard-right extreme in either convention) sounded right, but x=0 and
    // x=-1 (tilt=0, meant as hard-left) both landed near-center instead,
    // biasing the whole default position right and undershooting hard-left.
    // Keep the same piecewise shape (it's correct — flat at the home value,
    // then ramping), just rescale its 0..1 output into -1..1 via *2-1.
    // masterJoyY is native -1..1 already — the old (y+1)/2 rescale had the
    // same bug (y=-1 landed at pan2-center instead of hard-rear); send y
    // straight through now.
    // Y (front/rear) tilt-vs-absolute distinction is NOT changed here — same
    // underlying "shared value" issue likely applies to the FL/FR pan2
    // stages, scoped out of this pass pending a confirmed read of that
    // 4-way FL_L/FL_R/FR_L/FR_R naming.
    // CORRECTION: mj_LR_L / mj_LR_R read `receive masterJoyX` (verified) and
    // there is NO receive masterTiltL/R in the patch — so masterTiltL/R was a
    // dead message and master L/R panning never worked. pan2 is native -1..+1
    // (0 = center); send raw x/y to masterJoyX/masterJoyY.
    sendToMax('masterJoyX', x);
    sendToMax('masterJoyY', y);
    outlet(1, 'param', 'masterJoyX', x);
    outlet(1, 'param', 'masterJoyY', y);
    post('ms_router: masterJoystick x=' + x.toFixed(2) + ' y=' + y.toFixed(2) + '\n');
}

// ── setMasterGain ─────────────────────────────────────────────────────────────
// setMasterGain <0–1>  — master output fader
// 0 = silence, 1 = full. Drives master_gain receive in the patch.
function setMasterGain(value) {
    var v = clamp(parseFloat(value) || 0, 0, 1);
    state.masterGain = v;
    sendToMax('master_gain', v);
    outlet(1, 'param', 'masterGain', v);
    post('ms_router: masterGain = ' + v.toFixed(3) + '\n');
}

function info() {
    post('ms_router state:\n');
    for (var i = 0; i < TRACKS.length; i++) {
        var t = TRACKS[i];
        post('  ' + t + ': width=' + state.width[t].toFixed(2)
             + '  joy x=' + state.joy[t].x.toFixed(2)
             + ' y=' + state.joy[t].y.toFixed(2) + '\n');
    }
    post('  fxSend: vocals=' + state.fxSend.vocals.toFixed(2)
         + ' melody=' + state.fxSend.melody.toFixed(2)
         + ' bass='   + state.fxSend.bass.toFixed(2)
         + ' drums='  + state.fxSend.drums.toFixed(2) + '\n');
    post('  fxReturn=' + state.fxReturn.toFixed(2)
         + '  masterGain=' + state.masterGain.toFixed(2) + '\n');
}

// ── Analysis-driven M/S ───────────────────────────────────────────────────────
// Called by ws_server when slicer.js emits stemMS after each slice selection.
// Only fires when analysisMode = true (default).
// TUI :analysisMode off  → manual control  (width/pan commands still work either way)
// TUI :analysisMode on   → restore automatic analysis-driven M/S
//
// NOTE: stemMS only drives WIDTH. Joystick position is always manual.
function stemMS(track, panVal, widthVal) {
    if (!analysisDriven) return;
    var t = String(track);
    if (!state.width.hasOwnProperty(t)) {
        post('ms_router: stemMS — unknown track "' + t + '"\n');
        return;
    }
    applyWidth(t, widthVal);
}

// :analysisMode on | off | 1 | 0
// on  = slicer drives pan/width per slice automatically (default)
// off = manual control via :width / :pan TUI commands only
function analysisMode(val) {
    var v = String(val).toLowerCase();
    analysisDriven = (v === 'on' || v === '1' || v === 'true');
    post('ms_router: analysisDriven = ' + analysisDriven + '\n');
    outlet(1, 'param', 'analysisMode', analysisDriven ? 1 : 0);
}

// Catch-all: suppress "can't handle message" warnings for commands that belong
// to other JS objects (buffer_manager, slot_router, etc.) — ms_router is wired
// in parallel to ws_server outlet 0 so it sees every TUI command.
function anything() {}

// Push initial state to Max when the patch first loads.
function loadbang() { resend(); }

// Re-apply all spatial state whenever ws_server signals ready (on every patch
// load and node.script restart). loadbang() only fires on a full patch load and
// NOT on an `autowatch` hot-reload of this file, so without this a hot reload
// would leave joyX_<stem>/masterJoyX unset and the pan stuck.
function ws_ready() {
    post('ms_router: ws_ready — re-applying spatial state\n');
    resend();
}

// Re-push all current state to Max (e.g., after autowatch reload)
function resend() {
    for (var i = 0; i < TRACKS.length; i++) {
        var t = TRACKS[i];
        applyWidth(t, state.width[t]);
        applyJoystick(t, state.joy[t].x, state.joy[t].y);
    }
    for (var i = 0; i < TRACKS.length; i++) {
        fxSend(TRACKS[i], state.fxSend[TRACKS[i]]);
    }
    fxReturn(state.fxReturn);
    setMasterGain(state.masterGain);
    masterJoystick(state.masterJoy.x, state.masterJoy.y);
    post('ms_router: resent all params\n');
}
