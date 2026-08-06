# GUI parameter mapping — `ebys-analyze.pd`

This maps every user-facing control point that survives in the Pd patch after all the removal passes (EQ, gain, pan, width, pitch/formant, karma~ looping, fx-return, booth/rec/master gain, 4-channel hardware I/O and metering all stripped — see `CONVERSION_NOTES.md` for the full history) to a Pd hook name and a suggested GUI control, for whoever builds the real VST GUI.

Two tiers, and it matters which one each row is in:

- **Live** — the Pd object (or Node/OSC bridge) on the other end actually does something today.
- **Stubbed** — the message shape and routing exist (carried over faithfully from the Max patch), but the receiving object is either still a placeholder pass-through, or the specific command is part of a not-yet-built piece (`buffer_manager.js` / task 32, `analyze_reader.js`'s file-I/O half / task 36 — see `CONVERSION_NOTES.md`). Sending these messages today does nothing audible; the GUI can be wired to them now, but the underlying logic needs to be built before they'll work.

**Status as of 2026-08-02:** `streamWatcher.js`, `slice_writer.js`, and
`slicer.js` are real Node/OSC bridges; `slot_router.js` and
`analyze_reader.js` are real native-Pd rewrites (the latter partially — see
below). `buffer_manager.js` is still a blind stub (task 32). `spat_fx_router.js`
and `eq_router.js` were dropped entirely (their whole subsystem — spatial fx,
EQ, gain, pan — is DAW-only in this patch, see `CONVERSION_NOTES.md`).

## Live controls (working today)

| Control | Pd hook | Type | Suggested GUI | Notes |
|---|---|---|---|---|
| BPM | `receive bpm` (float) | global, shared across all 4 stems | Numeric field or knob, e.g. 40–220 range | Drives `bpm_bar_resize~` for each stem array, snapping buffer length to whole 4/4 bars (44100 Hz and 4/4 assumed — see `bpm_bar_resize~.pd`). Fires on every new value, not just once. |
| Record | `receive record_cmd` | message | Record start/stop button | Feeds `sfrecord~ 2` (stereo file recorder) directly. Confirm exact message shape (`bang`/`1`/`start` vs `stop`) against the original Max patch before wiring — this doc didn't re-derive `sfrecord~`'s expected message from the JSON, just confirmed the connection exists. |

## Live but not yet named (needs one small patch edit before a GUI can reach them)

| Control | Pd hook | Type | Suggested GUI | Notes |
|---|---|---|---|---|
| Stem preview rate | `stem_preview~ <stem>` inlet 0 (×4: vocals/melo/bass/drums) | float, Hz | Small knob per stem, default 0.1 (10s/pass) | Currently only reachable by editing patch cords directly — not exposed via a named `receive`. Say the word and I'll add `receive preview_rate_<stem>` to each instance. |
| Stem preview mute | `stem_preview~ <stem>` inlet 1 (×4) | float 0/1 | Mute toggle per stem | Same as above — needs a named `receive preview_mute_<stem>` added if you want GUI control. Defaults to audible (0) with nothing connected. |

## Track / analysis loading (2026-08-02: fully live now)

Feeds `analyze_reader.pd` + `analyze_reader_stem.pd` (real native-Pd rewrite,
replaced the old `js_analyze_reader_stub.pd` blind pass-through — see
CONVERSION_NOTES.md, "analyze_reader.js: real per-onset descriptor
extraction") plus the new `bridge_analyzeReader.pd` +
`bridge/analyze_reader_bridge.js` (see CONVERSION_NOTES.md, "analyze_reader.js:
the file-I/O/batch half, finished"). Every command below is now live.

| Command | Shape | Suggested GUI | Notes |
|---|---|---|---|
| `readVocals` / `readDrums` / `readBass` / `readMelo` | bang | "Load" button per stem, or fires automatically | Triggers real onset + descriptor extraction, forwards into `bridge_sliceWriter` |
| `set_track_name` | takes a value (track identifier) | Track picker / file browser result | Relayed straight to `bridge_sliceWriter`'s registry check |
| `startStem $1` | float (stem index) | Internal — fired by `[counter 1 4]`'s output via `[prepend startStem]`, not usually sent directly | Resolves + loads that stem's audio (new: via `stem_loader.pd`/`[soundfiler]`), skips if already analyzed |
| `startAnalysis` | bang | "Analyze" button | Parses `stream.txt`, resets the counter, kicks off the batch loop — manual message box added next to the new counter cluster |
| `loadRegistry` | bang | Fired on app start | Sets the counter's starting position from what's already in `analysis_library.json` |
| `resetMemory` | bang | "Clear loaded track" / reset button | Clears the batch/counter state, not just the display |
| `prepareNextTrack` | bang (new) | "Analyze next track" button | Scans htdemucs for the next not-yet-analyzed track, writes a fresh `stream.txt` — not auto-chained after `all_done`, same as the original |

Correction: the 6-stage FluCoMa analysis chain per stem was already fully
automatic in the converted patch (each stage's own completion bang feeds
the next, ending in a `readVocals`/etc. message straight into
`analyze_reader`) — the `bng` objects inline are completion indicators, not
buttons to click. The real gap was that `stem_loader`'s output had been
wired to the wrong point (straight into `stereo_to_mono` instead of the
shared trigger that starts both mono-conversion and the analysis chain
together) — fixed, see CONVERSION_NOTES.md. The loader/counter loop now
drives one stem's entire pipeline automatically: load → mono-convert →
full FluCoMa chain → `readX` → real descriptor extraction → counter
advance.

Also still deferred: real BPM estimation sends a placeholder `bpm=0, conf=0`
instead of the original's comb-filter algorithm (see CONVERSION_NOTES.md for
why — a poor fit for hand-wired Pd patch cords, needs a pdlua/compiled-
external port or a small Node bridge).

## Slicer / training engine (2026-08-02: live now, via a Node/OSC bridge)

Feeds `bridge_slicer.pd` ↔ `bridge/slicer_bridge.js` (real Node bridge,
replaced the old `js_slicer_stub.pd` blind pass-through — see
CONVERSION_NOTES.md, "slicer.js: real segment selection, transport, and
BPM/downbeat timing"). This is the actual "explore layerings and
transitions" engine — segment-based playback logic driven by a
Markov-chain-style segment selector. Every command below is **live** as
long as `slicer_bridge.js` is running alongside Pd (ports 9004/9005);
nothing here needs further Pd-side work.

| Command | Shape | Suggested GUI | What it's for (inferred from name) |
|---|---|---|---|
| `buildIndex` | bang | "Build index" button, fires after a track loads | Builds the slice index for the loaded stems |
| `start` / `stop` | bang | Play/stop transport buttons | Starts/stops the slicer engine |
| `selectSegment` | takes a segment id | Segment picker (list/grid of available segments) | Jump to a specific segment |
| `next vocals` / `next drums` / `next bass` / `next melody` | bang, per stem | Per-stem "next segment" button | Advance one stem independently — this is the core "explore different layerings" control |
| `nextNearest` | bang | "Next similar segment" button | Jump to the nearest-matching segment (uses the weight/match-prob params below) |
| `setSegmentBars` | float | Numeric field or stepper | Segment length in bars |
| `setStayProb` | float 0–1 | Slider | Probability of staying on the current segment vs. jumping |
| `setMatchProb` | float 0–1 | Slider | Probability weighting for similarity-based jumps |
| `setWeight` / `setDirWeight` / `setTrackWeight` | float | Sliders (likely an "advanced" panel) | Segment-selection weighting knobs |
| `setDirPref` | float/int | Toggle or small selector (forward/backward/either) | Directional preference for segment jumps |
| `setQuantize` | float/bool | Toggle | Quantize segment changes to the beat grid |
| `setFallbackBPM` | float | Numeric field | BPM to assume if none detected — note this is a **separate** value from the new `receive bpm` hook above (see caveat below) |
| `setGlobalBPM` | float | — | Also separate from `receive bpm` — see caveat below |
| `setMaxSlices` | float/int | Numeric field | Cap on number of segments |
| `followStem` | takes a stem name | Selector | Locks segment selection to follow one stem's changes |
| `loop` / `unloop` / `unloopAll` | takes a segment id (loop), bang (others) | Loop toggle per segment, "clear all loops" button | Segment looping |
| `reset` | bang | "Reset slicer" button | Resets slicer state |
| `info` | bang | Debug/info panel trigger | Query current slicer state |
| `setStemDurMs` | float, per stem (×4 separate objects in the patch) | Internal, probably not user-facing | Stem duration in ms, likely set automatically after analysis |

**Note:** `bridge_slicer.pd` accepts one message beyond the original stub-era
scope: `selectSegment` was confirmed live/dispatchable via a direct audit of
the real `.maxpat`'s router object (see CONVERSION_NOTES.md, "Link audit").
Every command in the table above maps to a real `DISPATCH` entry in
`slicer_bridge.js`.

**Caveat worth flagging to whoever builds the backend:** the original Max patch already had `setGlobalBPM` and `setFallbackBPM` messages feeding the slicer, separate from the BPM hook I just added (`receive bpm` → `bpm_bar_resize~`). Now that the slicer's real logic IS ported, decide whether these should be unified into one BPM control or kept distinct (fallback BPM implies "used only if detection fails," which is a different concept from "the BPM to resize buffers to") — this decision is still open, only the porting status changed.

## Status / telemetry (Pd → GUI direction)

In the original Max patch these reported out through a shared hub (`gate 1` → `js node.script ws_server.js`, a WebSocket server). That hub does **not exist in the Pd conversion at all** — `node.script`/`ws_server.js` was dropped to a documentation comment early in this conversion (no audio-critical role — see `CONVERSION_NOTES.md`, "New stand-in abstractions"). So every report below is currently a dead end on the Pd side: whatever object used to feed `gate 1` now has nowhere to send. There is no control surface wired into the live Pd instrument today at all (the old `src/tui/` terminal UI drove commands via that same websocket, and lost its path too). Rebuilding this reporting hub (a small Node/OSC bridge, same pattern as `streamWatcher_bridge.js`) is real, unscoped follow-up work if a GUI/dashboard needs these.

| Report | Message shape | Likely GUI use |
|---|---|---|
| `meter <stem>_FL/FR/RL/RR` | — **removed** (see `CONVERSION_NOTES.md`, "4 channel quad meters") | n/a — if you want stereo (L/R) master/stem meters back, say so; would need re-adding as a 2-channel version |
| `spectrum <stem> <band 0-63>` (×5 stems incl. master) | float per band | Spectrum analyzer display, one bar per band |
| `waveNeg master` / `wavePos master` | float | Waveform trace display |
| `lufs` | float | Loudness meter |
| `analysisDone` | bang/status | "Analysis complete" indicator |
| `streamUpdated` | status | Generic "data changed, re-fetch" signal |

## Summary for whoever wires the GUI (updated 2026-08-02)

Live today, no further Pd work needed: **BPM** (resizes buffers to bar boundaries), **Record** (starts/stops `sfrecord~`), the whole **slicer/training engine** table (buildIndex/start/stop/next/loop/weights/filters/etc. — real, via `bridge_slicer.pd` + `slicer_bridge.js`, provided that Node process is running), and `readVocals`/`readDrums`/`readBass`/`readMelo`/`set_track_name` under **track loading** (real, via `analyze_reader.pd`). The **stem preview rate/mute** controls work but need one small patch edit to get named hooks.

Still stubbed / not wired to anything: `startAnalysis`/`startStem`/`loadRegistry`/`resetMemory` (task 36 — the multi-track batch/file-I/O half of track loading), and the entire **status/telemetry** table (no reporting hub exists in Pd at all right now — see above). There is currently no control surface talking to the live Pd instrument in either direction beyond manual message boxes inside the patch itself.
