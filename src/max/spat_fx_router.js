// EBYS — Spatialization Router  v1
//
// ── Role ──────────────────────────────────────────────────────────────────────
// spat_fx_router.js owns all stereo and FX routing parameters.
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

var TRACKS       = ['vocals', 'melody', 'bass', 'drums'];
var LIVE_TRACKS  = ['live1', 'live2'];
var ALL_TRACKS   = TRACKS.concat(LIVE_TRACKS);

// Current state (for info / recall)
var state = {
    width:       { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
    joy:         { vocals: {x:0, y:0}, melody: {x:0, y:0},
                   bass:   {x:0, y:0}, drums:  {x:0, y:0},
                   live1:  {x:0, y:0}, live2:  {x:0, y:0} },
    masterJoy:   { x: 0, y: 0 },
    fxSend:      { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
    fxReturn:    { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
    fxSwitch:    { 1: 0, 2: 0 },   // 0=stem, 1=live
    masterGain:  1.0,
    boothGain:   0.7,             // booth monitor level (0–1)
    recGain:     1.0,             // recording output level (0–1)
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
    sendToMax('width_' + stem, w);
    outlet(1, 'param', 'width_' + stem, w);
    post('spat_fx_router: width[' + stem + '] = ' + w.toFixed(3) + '\n');
}

function applyJoystick(stem, x, y) {
    x = clamp(parseFloat(x) || 0, -1, 1);
    y = clamp(parseFloat(y) || 0, -1, 1);
    state.joy[stem] = { x: x, y: y };
    sendToMax('joyX_' + stem, x);
    sendToMax('joyY_' + stem, y);
    outlet(1, 'param', 'joyX_' + stem, x);
    outlet(1, 'param', 'joyY_' + stem, y);
    post('spat_fx_router: joystick[' + stem + '] x=' + x.toFixed(2) + ' y=' + y.toFixed(2) + '\n');
}

// ── Command handlers ──────────────────────────────────────────────────────────

function width(stem, value) {
    if (!stem) return;
    var targets = (String(stem) === 'all') ? ALL_TRACKS : [String(stem)];
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
    var targets = (String(stem) === 'all') ? ALL_TRACKS : [String(stem)];
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
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state.fxSend.hasOwnProperty(t)) continue;
        state.fxSend[t] = v;
        sendToMax('fxsend_' + t, v);
        outlet(1, 'param', 'fxSend_' + t, v);
        post('spat_fx_router: fxSend[' + t + '] = ' + v.toFixed(3) + '\n');
    }
}

// :fxStereo 0 | 1  (or off | on)
// 0 = mono  — same mono sum on dac~ 3+4, return from adc~ 3 only (default, for mono pedals)
// 1 = stereo — master L/R on dac~ 3/4 separately, return from adc~ 3 (L) and adc~ 4 (R)
function fxStereo(val) {
    var v = (String(val) === '1' || String(val).toLowerCase() === 'on') ? 1 : 0;
    sendToMax('fxstereo', v);
    outlet(1, 'param', 'fxStereo', v);
    post('spat_fx_router: fxStereo = ' + (v ? 'stereo' : 'mono') + '\n');
}

// fxReturn <stem> <0–1>  — return level from adc~ hardware insert back into stem path
// Works for stems and live channels. 'all' sets all tracks.
function fxReturn(stem, value) {
    if (value === undefined) { value = stem; stem = 'all'; }
    var v = clamp(parseFloat(value) || 0, 0, 1);
    var targets = String(stem) === 'all' ? ALL_TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!state.fxReturn.hasOwnProperty(t)) continue;
        state.fxReturn[t] = v;
        sendToMax('fxreturn_' + t, v);
        outlet(1, 'param', 'fxReturn_' + t, v);
        post('spat_fx_router: fxReturn[' + t + '] = ' + v.toFixed(3) + '\n');
    }
}

// fxSwitch <1|2> <0|1>
// 0 = stem uses hardware FX channel (default: 1=vocals use ch7/8, 2=drums use ch9/10)
// 1 = live input uses hardware FX channel (live1 uses ch7/8, live2 uses ch9/10)
function fxSwitch(channel, val) {
    var ch = parseInt(channel);
    if (ch !== 1 && ch !== 2) { post('spat_fx_router: fxSwitch channel must be 1 or 2\n'); return; }
    var v = (parseInt(val) === 1 || String(val) === 'on') ? 1 : 0;
    state.fxSwitch[ch] = v;
    sendToMax('fxSwitch' + ch, v);
    outlet(1, 'param', 'fxSwitch' + ch, v);
    post('spat_fx_router: fxSwitch' + ch + ' = ' + (v ? 'live' : 'stem') + '\n');
}

// boothGain <0–1>  — independent monitor level for dac~ 15 16
function boothGain(value) {
    var v = clamp(parseFloat(value) || 0, 0, 1);
    state.boothGain = v;
    sendToMax('booth_gain', v);
    outlet(1, 'param', 'boothGain', v);
    post('spat_fx_router: boothGain = ' + v.toFixed(3) + '\n');
}

// recGain <0–1>  — recording output level for dac~ 17 18
function recGain(value) {
    var v = clamp(parseFloat(value) || 0, 0, 1);
    state.recGain = v;
    sendToMax('rec_gain', v);
    outlet(1, 'param', 'recGain', v);
    post('spat_fx_router: recGain = ' + v.toFixed(3) + '\n');
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
    sendToMax('masterJoyX', x);
    sendToMax('masterJoyY', y);
    outlet(1, 'param', 'masterJoyX', x);
    outlet(1, 'param', 'masterJoyY', y);
    post('spat_fx_router: masterJoystick x=' + x.toFixed(2) + ' y=' + y.toFixed(2) + '\n');
}

// ── setMasterGain ─────────────────────────────────────────────────────────────
// setMasterGain <0–1>  — master output fader
// 0 = silence, 1 = full. Drives master_gain receive in the patch.
function setMasterGain(value) {
    var v = clamp(parseFloat(value) || 0, 0, 1);
    state.masterGain = v;
    sendToMax('master_gain', v);
    outlet(1, 'param', 'masterGain', v);
    post('spat_fx_router: masterGain = ' + v.toFixed(3) + '\n');
}

function info() {
    post('spat_fx_router state:\n');
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        var t = ALL_TRACKS[i];
        post('  ' + t + ': width=' + state.width[t].toFixed(2)
             + '  joy x=' + state.joy[t].x.toFixed(2)
             + ' y=' + state.joy[t].y.toFixed(2)
             + '  fxSend=' + state.fxSend[t].toFixed(2)
             + '  fxReturn=' + state.fxReturn[t].toFixed(2) + '\n');
    }
    post('  fxSwitch: ch1=' + state.fxSwitch[1] + ' (live1↔vocals)'
         + '  ch2=' + state.fxSwitch[2] + ' (live2↔drums)\n');
    post('  masterGain=' + state.masterGain.toFixed(2) + '\n');
    post('  boothGain=' + state.boothGain.toFixed(2)
         + '  recGain=' + state.recGain.toFixed(2) + '\n');
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
        post('spat_fx_router: stemMS — unknown track "' + t + '"\n');
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
    post('spat_fx_router: analysisDriven = ' + analysisDriven + '\n');
    outlet(1, 'param', 'analysisMode', analysisDriven ? 1 : 0);
}

// Catch-all: suppress "can't handle message" warnings for commands that belong
// to other JS objects (buffer_manager, slot_router, etc.) — spat_fx_router is wired
// in parallel to ws_server outlet 0 so it sees every TUI command.
function anything() {}

// Re-push all current state to Max (e.g., after autowatch reload)
function resend() {
    for (var i = 0; i < ALL_TRACKS.length; i++) {
        var t = ALL_TRACKS[i];
        applyWidth(t, state.width[t]);
        applyJoystick(t, state.joy[t].x, state.joy[t].y);
        fxSend(t, state.fxSend[t]);
        fxReturn(t, state.fxReturn[t]);
    }
    fxSwitch(1, state.fxSwitch[1]);
    fxSwitch(2, state.fxSwitch[2]);
    setMasterGain(state.masterGain);
    masterJoystick(state.masterJoy.x, state.masterJoy.y);
    boothGain(state.boothGain);
    recGain(state.recGain);
    post('spat_fx_router: resent all params\n');
}
