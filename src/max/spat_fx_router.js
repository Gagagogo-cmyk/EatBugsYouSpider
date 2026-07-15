// EBYS — Spatialization Router  v1
//
// ── Role ──────────────────────────────────────────────────────────────────────
// spat_fx_router.js owns all stereo and FX routing parameters.
// It receives commands from ws_server.js (via TUI) and forwards them to the
// appropriate Max `receive` objects in the patch.
//
// ── Commands (inlet 0) ────────────────────────────────────────────────────────
//   width    <stem> <0–1>    — M/S stereo width per stem
//                               0 = mono, 0.5 = original stereo (default, untouched),
//                               1 = wider than the original stereo field
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

// *** THIS is the file Max actually loads (the object box in ebys-analyze.maxpat
// is literally typed "js spat_fx_router.js" — that argument is what the js
// object uses to load its script; a stray saved_object_attributes.filename
// on the same box pointed at "ms_router.js", but per Max's own docs the box's
// typed argument is authoritative, not that attribute. ms_router.js — which
// received essentially all of this session's joystick/tilt debugging — was
// never actually live. Its fixes are merged in here instead, onto the fuller
// feature set (live1/live2, fxSwitch, boothGain/recGain, per-stem fxReturn)
// this file already had. Treat ms_router.js as reference/historical from now
// on, not a file that needs to stay in sync. ***

// Defaults changed to a genuine "straight passthrough" baseline (see
// applyJoystick/masterJoystick/applyWidth below for what each value actually
// means at the DSP): x=0 + the tiltL/R split means hard-left/hard-right with
// no cross-bleed; y=1 means full front pair, matching a plain stereo output;
// width=0.5 means the M/S side channel is unscaled — the original stereo
// image, untouched (see applyWidth's 0..1 -> 0..2 remap). Previously width
// defaulted to 0 (full mono collapse under the OLD 0=mono/1=original mapping)
// and was never even pushed to Max at patch load (no loadbang() existed in
// this file at all) — on top of the mono-buffer read bug fixed separately,
// stereo had no chance of surviving to the output before now.
var state = {
    width:       { vocals: 0.5, melody: 0.5, bass: 0.5, drums: 0.5, live1: 0.5, live2: 0.5 },
    joy:         { vocals: {x:0, y:1}, melody: {x:0, y:1},
                   bass:   {x:0, y:1}, drums:  {x:0, y:1},
                   live1:  {x:0, y:1}, live2:  {x:0, y:1} },
    masterJoy:   { x: 0, y: 1 },
    fxSend:      { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
    fxReturn:    { vocals: 0, melody: 0, bass: 0, drums: 0, live1: 0, live2: 0 },
    fxSwitch:    { 1: 0, 2: 0 },   // 0=stem, 1=live
    // Per-stem FX-send mono switch. 0=stereo (default, both dac~ outlets carry
    // the real post-width L/R), 1=mono (both outlets carry the identical L+R
    // sum, so a mono pedal patched into just the left output of that stem's
    // hardware send/return pair gets the full mix, nothing missing). Only the
    // 4 stems have FX-send taps at all — live1/live2 don't route through this.
    monoSend:    { vocals: 0, melody: 0, bass: 0, drums: 0 },
    masterGain:  1.0,
    boothGain:   0.7,             // booth monitor level (0–1)
    recGain:     1.0,             // recording output level (0–1)
};

// Analysis mode now defaults OFF: width should stay at its manual value (1.0
// = untouched original stereo) unless the user explicitly runs a :width
// command, not get silently redriven by per-slice analysis data every time a
// new segment fires. :analysisMode on restores the old automatic behavior
// for whoever wants it.
var analysisDriven = false;

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
    // User-facing 0..1 remapped to the DSP's actual 0..2 M/S side-channel
    // multiplier: 0 -> 0 (mono, side silenced), 0.5 -> 1.0 (unity — the
    // side channel passes through completely unscaled, i.e. the original
    // stereo file exactly as recorded), 1 -> 2.0 (side doubled — wider than
    // the original field). Plain linear map, w*2, since 0.5 needing to land
    // on 1.0 pins the scale exactly. The *~ width_<stem> multiplier in the
    // patch has no clamp of its own, so a >1.0 multiplier genuinely widens
    // rather than being silently capped — safe to send since the master bus
    // now has a hard clip~ safety net (see CHANGELOG 0.1.14) regardless of
    // how wide any stem gets pushed.
    var sideMult = w * 2;
    sendToMax('width_' + stem, sideMult);
    outlet(1, 'param', 'width_' + stem, w);
    post('spat_fx_router: width[' + stem + '] = ' + w.toFixed(3)
         + '  (side×' + sideMult.toFixed(2) + ')\n');
}

// Live channels (live1/live2) only ever got the OLD joyX_/joyY_ receive
// pair in the patch — no joyTiltL_live*/joyTiltR_live* wiring exists for
// them (confirmed via the patch's own receive-object list), so they can't
// use the tiltL/R split below. Still fix the range bug for them though:
// pan2 is confirmed -1..1 native (0=center), not 0..1, so the old (x+1)/2
// rescale was wrong here too — send raw x/y straight through instead.
// NOTE: the joyTiltL/R split below was coded here but the matching
// `receive joyTiltL_<stem>` / router entries were NEVER added to the patch —
// only `receive joyX_<stem>`/`joyY_<stem>` exist. So marking stems as tilt sent
// the X-axis pan into the void (joyY still worked), which is why every stem was
// stuck panned left. The stems are MONO (.mono buffers), so simple joyX/joyY
// panning is exactly right anyway. Empty = every stem uses the joyX/joyY branch
// the patch actually wires. (Re-enable per stem only if joyTiltL/R receives get
// added to the patch.)
var TILT_STEMS = {};

function applyJoystick(stem, x, y) {
    x = clamp(parseFloat(x) || 0, -1, 1);
    y = clamp(parseFloat(y) || 0, -1, 1);
    state.joy[stem] = { x: x, y: y };
    if (TILT_STEMS[stem]) {
        // jp_LR_L_<stem>/jp_LR_R_<stem> each get their OWN value now
        // (joyTiltL_<stem>/joyTiltR_<stem>) instead of both reading one
        // shared joyX_<stem> — that old shared-value wiring sent both
        // pan2s to the same position, splitting L-bus and R-bus content
        // 50/50 EACH and collapsing every stem toward mono regardless of
        // upstream content. Confirmed via Cycling'74 docs and direct
        // message-box A/B testing this session that pan2's position inlet
        // is -1 (hard left) to +1 (hard right), 0 = center — NOT 0..1 as
        // this file assumed before. Keep the piecewise tilt SHAPE (flat at
        // the home value, ramping toward the far extreme as the stem
        // moves away from center — correct, avoids collapsing to mono at
        // rest) but rescale its 0..1 output into -1..1 via *2-1 so x=0
        // actually lands at hard-left/hard-right (pass-through) instead of
        // pan2's true center.
        var tiltL = clamp(x, 0, 1) * 2 - 1;
        var tiltR = clamp(x + 1, 0, 1) * 2 - 1;
        sendToMax('joyTiltL_' + stem, tiltL);
        sendToMax('joyTiltR_' + stem, tiltR);
        sendToMax('joyY_' + stem, y); // already -1..1 native, no rescale
    } else {
        sendToMax('joyX_' + stem, x);
        sendToMax('joyY_' + stem, y);
    }
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

// monoSend <stem> on|off|1|0 — collapse that stem's FX-send dac~ pair to a
// shared mono sum (for mono pedals) or leave it as real post-width stereo
// (default). Only exists for the 4 stems (vocals/melody/bass/drums) — the
// FX-send taps this switches were built in 0.1.23; live1/live2 never had
// FX-send taps to begin with.
function applyMonoSend(stem, onOff) {
    var v = (parseInt(onOff) === 1 || String(onOff).toLowerCase() === 'on') ? 1 : 0;
    state.monoSend[stem] = v;
    sendToMax('monoSend_' + stem, v);
    outlet(1, 'param', 'monoSend_' + stem, v);
    post('spat_fx_router: monoSend[' + stem + '] = ' + (v ? 'mono' : 'stereo') + '\n');
}

function monoSend(stem, value) {
    if (!stem) return;
    var targets = (String(stem) === 'all') ? TRACKS : [String(stem)];
    for (var i = 0; i < targets.length; i++) {
        if (state.monoSend.hasOwnProperty(targets[i])) applyMonoSend(targets[i], value);
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
    // The master pan2 chain reads `masterJoyX`/`masterJoyY` — verified: receive
    // masterJoyX → mj_LR_L / mj_LR_R (the master L/R pan2s), and there is NO
    // receive masterTiltL/R in the patch. The old code sent masterTiltL/R (dead
    // messages), so master X-axis panning never worked. pan2 position is native
    // -1..+1 (0 = center), so send raw x/y straight through.
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
             + '  fxReturn=' + state.fxReturn[t].toFixed(2)
             + (state.monoSend.hasOwnProperty(t) ? '  monoSend=' + (state.monoSend[t] ? 'mono' : 'stereo') : '')
             + '\n');
    }
    post('  fxSwitch: ch1=' + state.fxSwitch[1] + ' (live1↔vocals)'
         + '  ch2=' + state.fxSwitch[2] + ' (live2↔drums)\n');
    post('  masterGain=' + state.masterGain.toFixed(2) + '\n');
    post('  boothGain=' + state.boothGain.toFixed(2)
         + '  recGain=' + state.recGain.toFixed(2) + '\n');
}

// Push initial state to Max when the patch first loads. This function never
// existed in this file before — meaning none of state's defaults (width,
// joy, fxSend/Return, gains, etc.) were ever actually sent to Max at patch
// open; every receive object just sat at whatever its own box default (or
// nothing) was until the first matching command happened to touch it.
function loadbang() { resend(); }

// ws_ready — ws_server broadcasts this out its outlet (which fans to this
// object) every time it starts listening, i.e. on every patch load AND every
// node.script restart. loadbang() only fires on a full patch load, and Max's
// `autowatch` reload of THIS file does NOT re-run loadbang — so after a hot
// reload the pan/width/gain state was never re-pushed and receives like
// joyX_<stem> sat empty (pan stuck). Re-applying on ws_ready makes the router
// self-heal on any reload without needing a full patcher restart.
function ws_ready() {
    post('spat_fx_router: ws_ready — re-applying spatial state\n');
    resend();
}

// ── Analysis-driven M/S ───────────────────────────────────────────────────────
// Called by ws_server when slicer.js emits stemMS after each slice selection.
// Only fires when analysisMode = true (opt-in — see default above).
// TUI :analysisMode off  → manual control only (default; width/pan commands still work either way)
// TUI :analysisMode on   → slicer drives width automatically from the original mix's own analysis
//
// NOTE: stemMS only drives WIDTH. Joystick position is always manual.
// NOT reconciled with the 0.5=original width remap below: widthVal here
// comes straight from add_stereo_features.py's own 0..1 "stem M/S ratio,
// normalized within stem" measurement, which predates and doesn't know about
// the 0=mono/0.5=original/1=wider convention applyWidth() now expects. Fine
// while analysisDriven defaults off (opt-in only), but if :analysisMode on
// ever gets real use again this mapping needs revisiting — flagging rather
// than guessing at a fix without a real example of what the analysis values
// look like in practice.
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
// on  = slicer drives width per slice automatically from the original mix's analysis
// off = manual control via :width / :joystick TUI commands only (default)
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
    for (var j = 0; j < TRACKS.length; j++) {
        applyMonoSend(TRACKS[j], state.monoSend[TRACKS[j]]);
    }
    fxSwitch(1, state.fxSwitch[1]);
    fxSwitch(2, state.fxSwitch[2]);
    setMasterGain(state.masterGain);
    masterJoystick(state.masterJoy.x, state.masterJoy.y);
    boothGain(state.boothGain);
    recGain(state.recGain);
    post('spat_fx_router: resent all params\n');
}
