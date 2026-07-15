# EBYS Patch I/O Reference

Complete input/output map for `ebys-analyze.maxpat` and its JS objects.

---

## Hardware I/O

### Inputs (adc~)

| Channel | Object | Role |
|---------|--------|------|
| 1 | `live1_adc_xlr` | Live 1 — XLR mic/line |
| 2 | `live1_adc_jack` | Live 1 — TS/TRS instrument |
| 3 | `live2_adc_xlr` | Live 2 — XLR mic/line |
| 4 | `live2_adc_jack` | Live 2 — TS/TRS instrument |
| 7–8 | `adc~ 7 8` | FX Return 1 (hardware insert return for live1/vocals) |
| 9–10 | `adc~ 9 10` | FX Return 2 (hardware insert return for live2/drums) |
| 11–12 | `adc~ 11 12` | FX Return 3 (reserved) |
| 13–14 | `adc~ 13 14` | FX Return 4 (reserved) |

Live 1 and Live 2 inputs are summed before entering the signal chain (`live1_merge: +~`). Both XLR and jack are combined, allowing dual-source input per live channel.

### Outputs (dac~)

| Channels | Object | Role |
|----------|--------|------|
| 1–2 | `dac~ 1 2` | Stereo monitor / headphones (FL+RL → L, FR+RR → R, post master) |
| 3 | `dac~ 3` | Spatial FL (front-left) |
| 4 | `dac~ 4` | Spatial FR (front-right) |
| 5 | `dac~ 5` | Spatial RL (rear-left) |
| 6 | `dac~ 6` | Spatial RR (rear-right) |
| 7–8 | `dac~ 7 8` | FX Send 1 (vocals or live1, switchable via `:fxSwitch 1`) |
| 9–10 | `dac~ 9 10` | FX Send 2 (drums or live2, switchable via `:fxSwitch 2`) |
| 11–12 | `dac~ 11 12` | FX Send 3 (reserved) |
| 13–14 | `dac~ 13 14` | FX Send 4 (reserved) |
| 15–16 | `booth_dac` | Booth monitor (post-master tap, level: `booth_gain`) |
| 17–18 | `rec_dac` | Recording output (post-master tap, level: `rec_gain`) |

---

## Signal Chains

### Stem channels (vocals / drums / bass / melody)

```
karma~ ring_0_{stem}  ← slot_router
    └── pfft~ ebys-pitch.maxpat 1024 4   ← slot_router (pitch semitones)
        └── *~  (gain_gate)              ← receive gain_{stem}
            └── biquad~ (low EQ)         ← receive eq_low_coef_{stem}
                └── biquad~ (mid EQ)     ← receive eq_mid_coef_{stem}
                    └── biquad~ (high EQ)← receive eq_high_coef_{stem}
                        └── *~ (fader)   ← receive fader_{stem}
                            ├── delay~ 512 → haas L/R → pan2 chain → jpsum_{bus}_{stem}
                            └── *~ (fxsend_gate) ← receive fxsend_{stem}
                                └── selector~ (fxSwitch) → dac~ 7 8 or 9 10
```

### Live channels (live1 / live2)

```
adc~ 1 + adc~ 2  →  +~ (live1_merge)
                       └── *~ 1 (live1_gain_gate)    ← receive gain_live1
                           └── *~ (live1_trim)        ← receive trim_live1
                               └── biquad~ (low)      ← receive eq_low_coef_live1
                                   └── biquad~ (mid)  ← receive eq_mid_coef_live1
                                       └── biquad~ (high) ← receive eq_high_coef_live1
                                           └── *~ 1 (live1_fader) ← receive fader_live1
                                               ├── delay~ 512 → haas L/R → pan2 chain → jpsum_{bus}_live1
                                               └── *~ (fxsend_gate) ← receive fxsend_live1
                                                   └── selector~ → dac~ 7 8

adc~ 3 + adc~ 4  →  same chain for live2 → jpsum_{bus}_live2 → dac~ 9 10 (FX)
```

### FX Return chain

```
adc~ 7 8  →  gate~ 2 (fxret_gate1) → *~ (fxreturn level)
                 ├── live1_fxret_gL/R  (when fxSwitch 1 = 1)
                 └── obj-fxret_gL/R_vocals (when fxSwitch 1 = 0)

adc~ 9 10  →  gate~ 2 (fxret_gate2) → *~ (fxreturn level)
                 ├── live2_fxret_gL/R  (when fxSwitch 2 = 1)
                 └── obj-fxret_gL/R_drums (when fxSwitch 2 = 0)
```

### Spatial sum and master chain

```
jpsum_FL_{stem} ─┐
jpsum_FR_{stem} ─┤→ jpsum2_{bus}_{pair} → jpfinal_{bus}
jpsum_RL_{stem} ─┤                              │
jpsum_RR_{stem} ─┘                              ├── masterJoy pan2 chain → mj_final_{bus}
                                                 │       ↓
jpsum_{bus}_live1 ─┐→ jpfinal_live_{bus}         └── dac~ 3/4/5/6 (spatial out)
jpsum_{bus}_live2 ─┘                                  │
                                                       ├── sum FL+RL → L  ─→ *~ master_gain → dac~ 1 2
                                                       └── sum FR+RR → R  ─┘
                                                              ↓
                                          post-master tap: obj-21070 (L) / obj-21071 (R)
                                              ├── *~ booth_gain → dac~ 15 16
                                              ├── *~ rec_gain   → dac~ 17 18
                                              └── sfrecord~ 2   (recording)
```

---

## JS Objects

### `slicer.js` (obj-551)

**Inlets:** 1 (commands from ws_server outlet 0 via route chain)  
**Outlets:**
- `0` — playback commands to karma~ / slot_router
- `1` — status messages → ws_server inlet 0

**Key outlet-1 messages:**
| Message | Args | Meaning |
|---------|------|---------|
| `ready` | count | index built, slice count |
| `slices` | nV nM nB nD | per-stem slice counts |
| `seg` | track id bars source | segment selected |
| `desc` | track C S E F P H T … | descriptor values for current slice |
| `stemMS` | track pan width | M/S values for spat_fx_router |
| `stemTrack` | track sourceTrack | which source track is playing |
| `stemDurMs` | track ms | stem duration in ms |
| `stayProb` | track|all val | stay probability updated |
| `entropy` | e mp sp dw | entropy macro changed (e, matchProb, stayProb, dirWeight) |
| `loop` | track bars | loop locked |
| `unloop` | track | loop released |
| `stopped` | — | playback stopped |
| `empty_pool` | track | no slices available for track |

### `eq_router.js` (obj-22000)

**Inlets:** 1 (from ws_server outlet 0)  
**Outlets:**
- `0` — biquad coefficients and gain values via named receive objects
- `1` — param feedback → ws_server inlet 0

**Receive names driven by outlet 0:**
`eq_low_coef_{stem}`, `eq_mid_coef_{stem}`, `eq_high_coef_{stem}`, `trim_{stem}`, `gain_{stem}`, `fader_{stem}`  
(stems: vocals, drums, bass, melody, live1, live2)

### `spat_fx_router.js` (obj-20100)

**Inlets:** 1 (from ws_server outlet 0)  
**Outlets:**
- `0` — spatial and FX values via named receive objects
- `1` — param feedback → ws_server inlet 0

**Receive names driven by outlet 0:**
`width_{stem}`, `joyX_{stem}`, `joyY_{stem}`, `fxsend_{stem}`, `fxreturn_{stem}`, `fxSwitch1`, `fxSwitch2`, `master_gain`, `masterJoyX`, `masterJoyY`, `booth_gain`, `rec_gain`

### `ws_server.js` (obj-4030)

**Inlets:**
- `0` — Max messages: gate output (meter values, analysisDone), slicer outlet-1 messages, script start/stop

**Outlets:**
- `0` — TUI commands forwarded to spat_fx_router, eq_router, buffer_manager, slicer route chain
- `1` — debug print (`print ws`)

**WebSocket → Max flow:** TUI client sends `:command args` → ws_server parses → dispatches to appropriate JS object or Max route.

### `buffer_manager.js` (obj-9961)

**Inlets:** 1 (from ws_server outlet 0)  
Manages `buffer~` loading, karma~ playback, stem slot assignment.

### `slot_router.js` (obj-9982)

Routes stem audio from karma~ ring buffers to pfft~ pitch-shift processors.  
**Outlets 0–11:** karma~ load/play triggers  
**Outlets 12–15:** karma~ ring buffer references (vocals/drums/bass/melody)  
**Outlets 16–19:** pfft~ pitch semitone values

### `slicer.js` commands (inlet 0, sent from ws_server)

| Command | Args | Effect |
|---------|------|--------|
| `buildIndex` | — | build slice index from analysis_library.json |
| `start` | — | begin playback |
| `stop` | — | stop playback |
| `setSegmentBars` | stem bars | set segment length in bars |
| `setStayProb` | stem\|all 0–1 | probability of staying on same track |
| `setMatchProb` | 0–1 | global descriptor match strictness |
| `setDirWeight` | 0–5 | tension-field direction influence |
| `setEntropy` | 0–1 | macro: drives matchProb + stayProb + dirWeight simultaneously |
| `followStem` | stem target w [target2 w2…] | read another stem's descriptors for transitions |
| `followStem` | stem self | reset to reading own descriptors |
| `loop` | stem bars | lock stem into a loop |
| `unloop` | stem | release loop |
| `setTrackWeight` | track 0–1 | bias track selection probability |

---

## TUI Command Reference

All commands are prefixed with `:` in the TUI. Stems: `vocals` `drums` `bass` `melody` `live1` `live2` `all`.

### Session

| Command | Args | Effect |
|---------|------|--------|
| `:sessionOpen` | djId venue mode [deck] | open session, start logging |
| `:sessionClose` | — | close session |
| `:buildIndex` | — | (re)build slice index |
| `:record start [name]` | — | start recording to dac~ 17 18 |
| `:record stop` | — | stop recording |
| `:analysisMode` | on \| off | analysis-driven M/S width (on by default) |

### Playback / mix

| Command | Args | Effect |
|---------|------|--------|
| `:pitchShift` | stem semitones | real-time pitch shift via pfft~ |
| `:width` | stem 0–1 | M/S stereo width |
| `:joystick` | stem x y | 2D spatial position (−1 to +1 each axis) |
| `:masterJoystick` | x y | rotate entire 4ch mix |
| `:master gain` | 0–1 | master output level |
| `:boothGain` | 0–1 | booth monitor level |
| `:recGain` | 0–1 | recording output level |

### EQ / dynamics

| Command | Args | Effect |
|---------|------|--------|
| `:trim` | stem dB | input gain before EQ (−12 to +12 dB) |
| `:eqLow` | stem dB | low shelf (−96 = kill, 0 = flat, +12 = max boost) |
| `:eqMid` | stem dB | mid bell gain |
| `:eqHigh` | stem dB | high shelf gain |
| `:fader` | stem 0–1 | post-EQ channel fader |

### FX routing

| Command | Args | Effect |
|---------|------|--------|
| `:fx` | stem 0–1 | FX send + return level (linked) |
| `:fxSwitch` | 1\|2  0\|1 | 0=stem uses FX channel, 1=live input uses FX channel |

### AI engine

| Command | Args | Effect |
|---------|------|--------|
| `:entropy` | 0–1 | ORDER↔CHAOS macro — drives matchProb/stayProb/dirWeight simultaneously |
| `:followStem` | stem target w [target2 w2…] | blend another stem's end descriptors when choosing next slice |
| `:followStem` | stem self | reset stem to reading its own descriptors |

### Track mode (hardware shift layer)

One column of 7 descriptor knobs on the hardware controller. Mode selects which stem those knobs target:

One column of 7 descriptor knobs. Mode selects which stem and range those knobs target:

One column of 7 descriptor knobs. Page selects global vs per-stem; subpage selects lo vs hi range:

- **1a** (default): knobs → all stems, low range
- **1b**: knobs → all stems, high range
- **2a**: knobs → selected stem only, low range
- **2b**: knobs → selected stem only, high range

Sticky per-stem state, broadcast to all WebSocket clients on change. The TUI bypasses mode entirely and sends descriptor/follow commands directly.

| Command | Args | Effect |
|---------|------|--------|
| `:mode` | stem | cycle `1a` → `1b` → `2a` → `2b` → `1a` |
| `:mode` | stem a\|b | subpage only — keeps current page |
| `:mode` | stem 1\|2 | set page — keeps current subpage (defaults to `a`) |
| `:mode` | stem 1\|2 a\|b | set page + subpage explicitly |

Hardware convention: `all` is the default stem when no stem button is held. Bridge sends `:mode all 1 a/b` when no stem is selected; `:mode drums 2 a/b` when a stem is held.

### LINK (multi-deck sync)

| Command | Args | Effect |
|---------|------|--------|
| `:link on` | — | activate LINK — join/create session on local network |
| `:link off` | — | deactivate LINK |
| `:link status` | — | show connected decks, entropy, sync mode, armed state |
| `:link mode` | avoid\|mirror\|complement\|off | set Layer 3 selection sync mode |
| `:link arm` | — | arm missile switch |
| `:link fire` | — | broadcast last-touched parameter to all armed decks |
| `:link abort` | — | cancel armed state |
| `:link token` | hex | join an existing session by token (share token between decks) |

**Missile switch:** flipping the switch sends whatever parameter was last touched (fader, eq, joystick, entropy, etc.) to all decks simultaneously. The parameter is captured at fire-time, not arm-time.

---

## VU Meter Protocol

Meter values flow as float messages from `peakamp~ 4096` objects through the patch and out over WebSocket as JSON:

```
peakamp~ 4096 → prepend meter {name} → gate 1 (obj-7013) → ws_server → broadcast
```

WebSocket message format:
```json
{ "type": "meter", "name": "vocals_FL", "value": 0.312 }
```

### Meter names

| Name | Source | Description |
|------|--------|-------------|
| `master_FL` `master_FR` `master_RL` `master_RR` | obj-jpk_FL/FR/RL/RR | Full mix post-master-joystick pan (stems + live) |
| `vocals_FL` `vocals_FR` `vocals_RL` `vocals_RR` | pkamp_vocals_{bus} | Per-bus vocals level |
| `drums_FL` `drums_FR` `drums_RL` `drums_RR` | pkamp_drums_{bus} | Per-bus drums level |
| `bass_FL` `bass_FR` `bass_RL` `bass_RR` | pkamp_bass_{bus} | Per-bus bass level |
| `melo_FL` `melo_FR` `melo_RL` `melo_RR` | pkamp_melody_{bus} | Per-bus melody level |
| `live1_FL` `live1_FR` `live1_RL` `live1_RR` | pkamp_live1_{bus} | Per-bus live1 level |
| `live2_FL` `live2_FR` `live2_RL` `live2_RR` | pkamp_live2_{bus} | Per-bus live2 level |

Per-stem taps (`vocals_*`, `drums_*`, `bass_*`, `melo_*`, `live1_*`, `live2_*`) are **post-fader, post-pan** at the per-stem `jpsum_{bus}_{stem}` bus — before the stems are summed together.

Master taps (`master_FL/FR/RL/RR`) are **post-master-joystick** at `mj_final_{bus}` — the full mix (all stems + live) after the global 2D pan rotation.

The gate `obj-7013` is open only when ws_server signals `ws_ready`. Meter messages are suppressed until a WebSocket client is connected.

---

## Named Receive/Send Objects

All parameters are controlled by named `receive` objects in the patch. The corresponding `send` objects are driven by JS objects.

### Per-stem parameters (stems: vocals, drums, bass, melody, live1, live2)

| Name | Driven by | Effect |
|------|-----------|--------|
| `gain_{stem}` | eq_router | pre-EQ channel gain (0–1), respects mute |
| `trim_{stem}` | eq_router | input trim (linear, converted from dB) |
| `eq_low_coef_{stem}` | eq_router | biquad~ low shelf coefficients (5 values) |
| `eq_mid_coef_{stem}` | eq_router | biquad~ mid bell coefficients (5 values) |
| `eq_high_coef_{stem}` | eq_router | biquad~ high shelf coefficients (5 values) |
| `fader_{stem}` | eq_router | post-EQ fader (0–1) |
| `fxsend_{stem}` | spat_fx_router | FX send level (0–1) |
| `fxreturn_{stem}` | spat_fx_router | FX return mix level (0–1) |
| `width_{stem}` | spat_fx_router | M/S stereo width (0–1) |
| `joyX_{stem}` | spat_fx_router | joystick X (−1 to +1, L/R) |
| `joyY_{stem}` | spat_fx_router | joystick Y (−1 to +1, front/rear) |

### Global parameters

| Name | Driven by | Effect |
|------|-----------|--------|
| `master_gain` | spat_fx_router | master output fader (0–1) |
| `masterJoyX` | spat_fx_router | master 2D pan X |
| `masterJoyY` | spat_fx_router | master 2D pan Y |
| `booth_gain` | spat_fx_router | booth monitor level (0–1) |
| `rec_gain` | spat_fx_router | recording output level (0–1) |
| `fxSwitch1` | spat_fx_router | FX ch1: 0=vocals, 1=live1 |
| `fxSwitch2` | spat_fx_router | FX ch2: 0=drums, 1=live2 |
| `record_cmd` | ws_server | recording control (start/stop) |
