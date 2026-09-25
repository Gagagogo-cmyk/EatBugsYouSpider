# GUI parameter mapping — `gnumbat-analyze.pd`

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

## Live controls — CORRECTION (2026-08-08): neither of these was ever live

This table claimed BPM and Record worked today. Both claims are wrong, and
they were found the only way they could be — by building a GUI that tried to
send them. `grep '#X obj' src/pd/*.pd`:

- **`bpm_bar_resize~.pd`, `stem_preview~.pd` and `sfrecord~` are instantiated
  in zero patches.** They exist as files. Nothing creates one. There is no
  `[receive bpm]` and no `[receive record_cmd]` anywhere in `gnumbat-analyze.pd`
  — so a `bpm` message has no receiver, and the buffers are never resized to
  bar boundaries by anything.
- `peakamp~.pd` was in the same state until `stem_telemetry~.pd` (2026-08-08)
  became its first caller.

The likely history is that these were written as the Max objects' Pd
equivalents during a removal pass and never wired in, and the doc recorded the
abstraction's existence as if it were a live connection. Worth treating as a
general caution about the rest of this file: "the abstraction exists" and "the
patch instantiates it" were not distinguished carefully enough anywhere here.

The GUI hub sends both commands anyway (`patch bpm <f>`, `patch record_cmd
start|stop`), because the dynamic-send path delivers to a receive name and
costs nothing while the receiver is missing. **Wiring them up is one object
each**: an `[r bpm]` into a `bpm_bar_resize~` per stem array, and an
`[r record_cmd]` into an `[sfrecord~ 2]`. Until then, both buttons in the
panel are no-ops that log locally and change nothing.

| Control | Pd hook | Status | Notes |
|---|---|---|---|
| BPM | `receive bpm` (float) | **hook does not exist** | `bpm_bar_resize~` never instantiated. Panel sends it; nothing receives it. |
| Record | `receive record_cmd` | **hook does not exist** | No `sfrecord~` in any patch. The message shape (`start`/`stop` vs `bang`/`1`) was never re-derived from the Max patch either — still open when the receiver is added. |

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

## Status / telemetry (Pd → GUI direction) — BUILT 2026-08-08

This section used to say the reporting hub did not exist and that every row
below was a dead end. That is no longer true. `bridge_guiHub.pd` +
`src/gui/gui_hub_bridge.js` rebuild it, and `stem_telemetry~.pd` supplies the
measurements the conversion had stripped.

| Report | Message shape | Status |
|---|---|---|
| `meter <stem> <peakL> <peakR> <rmsL> <rmsR>` | linear 0..1 | **built.** Replaces the removed 4-channel quad meters with a 2-channel version. Every stem in this patch is mono, so L and R currently carry the same number — see `stem_telemetry~.pd`'s note. |
| `spectrum <stem> <64 floats>` (×5 incl. master) | linear magnitude | **built.** Hann-windowed 128-point `rfft~`, 64 bins. Sent linear; the dB conversion happens in `gnumbat-live.js` because Pd vanilla has no `log~`. |
| `rmsdb <stem> <f>` | dB | **built, renamed.** Was `lufs`. It is unweighted RMS with no gating — calling it LUFS invited someone to trust it for mastering. Real BS.1770 needs K-weighting biquads; see `stem_telemetry~.pd`. |
| `waveNeg` / `wavePos master` | — | **dropped as a wrong shape.** The panel's waveform is the stem's whole file drawn from analysis with a segment bracket and playhead over it — it moves with segment *selection*, not with the signal. It is fed by `status play` below instead. |
| `status play <stem> <slot> <startFrac> <endFrac> <ratio> <segDurMs> ...` | list | **built.** `bridge_slicer` outlet 0, tee'd (not moved) into the hub. |
| `status desc\|seg\|ready\|slices\|sysMsg ...` | list | **built.** `bridge_slicer` outlet 1, same tee. |
| `analysisDone` / `streamUpdated` | status | **path built, no sender.** The hub relays them; nothing in the patch emits them yet. |

The playhead is interpolated in the panel from `segDurMs`, not measured:
`stem_timestretch~` has no live position outlet (`karma~` did — see
`slicer_bridge.js` SIMPLIFICATION 2), so there is nothing to stream. It will
drift if the engine reschedules silently.

## Summary for whoever wires the GUI (updated 2026-08-02)

Live today, no further Pd work needed: **BPM** (resizes buffers to bar boundaries), **Record** (starts/stops `sfrecord~`), the whole **slicer/training engine** table (buildIndex/start/stop/next/loop/weights/filters/etc. — real, via `bridge_slicer.pd` + `slicer_bridge.js`, provided that Node process is running), and `readVocals`/`readDrums`/`readBass`/`readMelo`/`set_track_name` under **track loading** (real, via `analyze_reader.pd`). The **stem preview rate/mute** controls work but need one small patch edit to get named hooks.

Still stubbed / not wired to anything: `startAnalysis`/`startStem`/`loadRegistry`/`resetMemory` (task 36 — the multi-track batch/file-I/O half of track loading), and the entire **status/telemetry** table (no reporting hub exists in Pd at all right now — see above). There is currently no control surface talking to the live Pd instrument in either direction beyond manual message boxes inside the patch itself.
