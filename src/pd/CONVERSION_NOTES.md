# Max → Pd conversion notes

`ebys-analyze.maxpat` was converted to `ebys-analyze.pd` with a script
(structural, not hand-retyped), so every box and connection carried over with
matching wiring. Nothing in `src/max/` was touched — both `.maxpat` files are
untouched originals.

This file has gone through two rounds: an initial structural conversion, then
a second pass fixing real bugs found by actually opening the file in Pd
(0.52.1) — the console log of "couldn't create" / "connection failed"
errors was extremely useful for that, since a lot of Max/Pd differences only
show up at load time, not from just reading the file format spec.

## Pitch/formant shifting and karma~ looping are deliberately NOT in the Pd version

Both subsystems were stripped out of `ebys-analyze.pd` on request — pitch/
formant shift is handled by a separate DAW plugin, and playback/looping
happens in the DAW too, not via Pd. Both still exist untouched in
`ebys-analyze.maxpat` / `ebys-pitch.maxpat` — these removals are Pd-only.

Removed:
- the 4 `pfft~ ebys-pitch.maxpat ...` instances (voc/drm/bss/mel — the pitch/
  formant shifter, which loaded `ebys-pitch.maxpat` as its FFT subpatch)
- the 8 command-router objects that only fed pitch/formant commands into
  `slot_router.js`: `pitchShift`, `formantShift`, `setShiftBand`,
  `setPitchBand`, `setFormantBand`, `clearPitchBand`, `clearFormantBand`,
  `clearShiftBand`
- `send ebys_pitchWindow` (only had a receiver inside the now-removed pitch
  subpatch)
- the 4 `karma~ ring_0_<stem>` loopers themselves

`ebys-pitch.pd`, `gizmo_stub~.pd`, and `karma_stub~.pd` (all previously
generated as part of this conversion) are no longer used and have been
removed from `src/pd/`.

## EQ and gain-staging are also NOT in the Pd version

Same reasoning, third subsystem: mixing (trim/gain/fader) and the 3-band EQ
per stem are handled in the DAW now too. Removed 150 objects total, found by
tracing every `receive trim_*/gain_*/fader_*/eq_*_coef_*/fxsend_*` object
forward through the signal chain (programmatically, not hand-picked) until
it left `*~`/`biquad~`/`unpack` territory:

- `eq_router.js` and its 37-way `route` (the command hub — took
  `trim_<stem>`, `gain_<stem>`, `fader_<stem>`, `eq_low/mid/high_coef_<stem>`
  commands for vocals/drums/bass/melody/live1/live2)
- the ~84 `send`/`receive` glue objects those commands broadcast through
- per stem: the trim `*~`, the 3-band EQ (`biquad~` low/mid/high, each fed
  by an `unpack` of its coefficient list), any fixed makeup-gain `*~`, the
  gain `*~`, and the fader `*~` (live1/live2 also have mute/fx-send gate
  `*~` stages)

Left in place at the time, now simply unfed: the shared mix bus downstream of
the fader stage (`delay~`/`+~` summing, `pan2`, meters, `dac~`/`sfrecord~`
output) — that infrastructure wasn't named as EQ or gain specifically, so it
stayed, same as the karma~ removal left the offline slicing engine in place.
(The `delay~`/`pan2` part of this bus was subsequently removed too — see
"Panning and stereo width are also NOT in the Pd version" below.)

`js_eq_router_stub.pd` (previously generated for `eq_router.js`) is no
longer used and has been removed from `src/pd/`.

Left in place on purpose: the command-routing infrastructure around karma~
(`buildIndex`, `start`, `stop`, `selectSegment`, etc., and `slot_router.js`
itself) and the upstream control objects that used to feed karma~ (`peek~`,
`getattr`, the `play`/`stop` messages) — these also serve the offline
slicing/export engine (`slicer.js`, `slice_writer.js`), which still runs and
still produces the per-segment audio files, just without Pd doing any live
looped playback of them. The gain/EQ/output chain that used to sit right
after karma~ and the pitch shifter is simply unfed now — no audio reaches it
from that branch, which matches "playback comes from the DAW."

## Panning and stereo width are also NOT in the Pd version

Fourth subsystem removed for the same reason: 2D joystick panning and
Haas-delay stereo width are also handled in the DAW now. Removed 235 objects
total, found the same way as the EQ+gains pass — tracing every
`receive width_*/joyX_*/joyY_*/masterJoyX/masterJoyY` object forward through
`*~`/`+~`/`pan2`/`delay~`/`expr` territory:

- per stem (vocals/drums/bass/melody/live1/live2): the width `receive` →
  `delay~ 512` Haas pair → width-mix `*~` stage, and the joyX/joyY `receive`
  pair → `pan2` LR → `pan2` FB joystick quad-pan chain
- the four-way stem-sum buses (`jpsum_*` → `jpsum2_*` → `jpfinal_FL/FR/RL/RR`)
- the master 2D pan stage (`masterJoyX`/`masterJoyY` → `mj_*` → `mj_final_*`)
  that used to sum the four stem buses down to a final stereo/quad output
- the mono-sum taps that fed the spectrum-analyzer and waveform-display
  filterbanks (`spec_sum_*`, `wave_sum*`) — those displays are now simply
  unfed, since their only signal source was the panned/width-processed sum

Left in place, same rule as before: `spat_fx_router.js` and its 38-way
`route` (shared with unrelated commands — `fxsend`/`fxreturn`/`fxSwitch`/
`booth_gain`/`rec_gain` still use it), the fx-send path (fader → gate →
`selector~` → `dac~ 7 8`, confirmed structurally separate from the pan/width
branch by the same forward-walk), and the 320-filter spectrum-analyzer
`biquad~` bank itself (it's just unfed now, not removed).

`js_spat_fx_router_stub.pd` is still used (the router itself stays), so
nothing to delete there.

Also removed, on follow-up: the 6 `live.gain~` master/monitor output faders
(`live.gain~[1]`-`[5]`, feeding `dac~ 1`-`dac~ 6`). These are manual UI trims,
not DAW-automation glue, so the forward-walk above didn't catch them — but
their only signal input was the pan/width summing bus just removed, leaving
them silently unfed. Removed them too, and deleted the now-unused
`live_gain_stub~.pd` from `src/pd/`.

## Fx-return path, booth/rec monitor gain, and master_gain are also NOT in the Pd version

The patch is meant to be analysis/training only -- buffers get loaded to
explore layerings and transitions, not to act as a playback device. Real
playback and mixing (including this last stretch of "extra functionality":
EQ, gain, pan, width, pitch, formant) happen in the DAW; the eventual VST
would only play back so the user can train it. This round removed the
remaining pieces:

- `booth_gain`/`rec_gain` (booth monitor and recording-bus level control)
  and their receive/send glue
- `master_gain` receive/send glue and its multiplier (missed by the earlier
  EQ+gain pass because it's broadcast through `spat_fx_router.js`'s route,
  not `eq_router.js`'s)
- the fx-return path: `receive fxreturn_<stem>`/`fxreturn_live1`/
  `fxreturn_live2`, the `*~` gain-apply stages on each return, `gate~ 2`
  gating, `selector~ 2 1` (picks direct vs. fx-return signal), and the
  `fxSwitch1`/`fxSwitch2` toggle glue (`expr $i1+1` converts the toggle into
  a selector index)

Left in place, unfed: `spat_fx_router.js` and its route (still needed for
whatever's left that uses it), and the `dac~`/`adc~` hardware I/O objects
themselves (7/8, 9/10, 11-14, 15/16, 17/18) -- same "leave the physical I/O
layer alone" rule as every prior pass.

Bugfix folded into this pass: the 6 Haas-delay `delay~ 512 7` objects for
the width effect were missed by the earlier pan/width removal -- their input
was already cut, but the dead `delay~` objects themselves were still sitting
in the file. Removed now.

## Real bugs found by opening the file in Pd, now fixed

- **`biquad~` coefficient wiring.** Confirmed against Pd's own biquad~ help
  patch: Pd's `biquad~` has only 2 inlets (signal + a single 5-float
  coefficient *list*), not 6 separate inlets like Max's. Also, the
  coefficient order differs: Max is `a0 a1 a2 b1 b2`, Pd is
  `fb1 fb2 ff1 ff2 ff3` = `b1 b2 a0 a1 a2`.
  - 320 `biquad~` instances have coefficients baked in as literal creation
    arguments — those 5 numbers were reordered in place.
  - 18 instances get coefficients dynamically via an `unpack` feeding 5
    separate inlets — for these, a reordering `[pack f f f f f]` was spliced
    in between the existing `unpack` and `biquad~`, feeding the correctly-
    ordered list into `biquad~`'s single coefficient inlet.
- **`t`/`trigger` "i" type.** Max's trigger accepts `i` (int) as an outlet
  type; Pd's doesn't — only `f` (float covers both). 16 instances of `t b i`
  became `t b f`.
- **`unjoin N`** → real translation to `unpack` with N `f` tokens (not a
  stub — Pd's `unpack` does exactly what `unjoin` did here).
- **`loadmess A B C ...`** → Pd has no single equivalent object; each
  instance became a real `[loadbang] → [msg A B C ...]` pair (2 Pd boxes for
  1 Max box), which does the same thing without needing an extra library.
- **`live_gain_stub~`** was itself failing to load in the first round (my
  bug, not yours) — it used an iemgui slider (`hsl`) with a parameter format
  that Pd rejected. Replaced with a plain no-slider passthrough.

## New stand-in abstractions (objects with no Pd equivalent, discovered from the error log)

| Max object | Count | Stand-in | What it actually does |
|---|---|---|---|
| `peek~` | 8 | `peek_stub.pd` | No-op, always outputs 0. Max's `peek~` combines signal-rate buffer read+write in one object; Pd splits these into separate `tabread4~`/`tabwrite~`. Reimplement with those for the specific read or write this needs. |
| `zl.group` | 8 | `zl_group_stub.pd` | Passes each inlet straight to the matching outlet — does not actually batch/group list items. |
| `uzi N` | 8 | `uzi_stub.pd` | Built from Pd's `[until]`: repeat-bangs and gives a running counter. The "done" bang (Max's 2nd outlet) isn't implemented. |
| `round` | 8 | `round_stub.pd` | `+ 0.5` then `int` — nearest-integer rounding. Max's custom rounding-quantum (2nd inlet) isn't implemented. |
| `getattr ... @listen 0` | 8 | `getattr_stub.pd` | Always reports 0. Pd has no general attribute-query concept; for buffer sample count specifically, use `[soundfiler]` instead. |
| `dict.pack ...` | 4 | `dictpack_stub.pd` | Packs the 8 inlet values into a plain list via `[pack]`, not a real keyed dictionary (Pd has no dict type here). |
| `regexp ...` | 2 | `regexp_stub.pd` | Passes input through on outlet 0 only; no real regex matching. Pd 0.52+'s `[textfind]` family is the closest built-in if you need this working. |

## Objects with no Pd equivalent — replaced with stand-in abstractions (from the first pass)

| Max object | Count | Stand-in | What it actually does |
|---|---|---|---|
| `peakamp~` | 350 | `peakamp~.pd` | `abs~ → rpole~ → snapshot~` decaying peak follower. Similar in spirit to Max's peak-hold meter, not identical (no settable report interval). |
| `live.gain~` | 6 | `live_gain_stub~.pd` | Ableton Live's UI gain fader — now a plain unity-gain passthrough (see fix above). Metering/clip outlets are stubbed as no-ops. |
| `jsui` | 24 | `cnv` panel | Custom-drawn visualizer canvases — display-only, no DSP role. Placeholder panel with a label naming the original `.js` file; redraw logic not ported. |
| `dict.view` | 4 | `print` | Dictionary inspector UI — placeholder `print` object so wiring into it doesn't error. |
| `multislider` | 16 | `t l l` | No vanilla Pd multislider. Placeholder just fans the incoming list to both outlets; rebuild the UI with an `array`/`vsl` bank if you need the visual. |
| `node.script`, `spectroscope~` | 1 each | comment | Node-for-Max scripting object and the spectrum-analyzer display — both dropped to a documentation comment (no audio-critical role). |

## Requires the ELSE library (install via Deken in Pd)

These object names exist in Pd only through the **ELSE** library, not vanilla Pd:
`pak`, `counter`, `maximum~`, `minimum~`, `selector~`. Install ELSE (Pd menu:
Help → Find externals → search "else") before opening the patch, or these show as
broken objects.

## Requires FluCoMa (also via Deken)

All `fluid.*` objects (`fluid.bufmfcc~`, `fluid.bufpitch~`, `fluid.bufchroma~`,
`fluid.bufloudness~`, `fluid.bufstats~`, `fluid.bufampslice~`,
`fluid.bufspectralshape~`, `fluid.bufcompose~`, `fluid.buf2list`, `fluid.bufselect~`,
`fluid.loudness~`) carried over unchanged — FluCoMa ships the same object names and
`@attribute` syntax for both Max and Pd. Install the FluCoMa Pd package via Deken.
This is almost certainly why they showed as "couldn't create" in your log —
that's expected until FluCoMa is installed, not a bug in the file.

Note: `fluid.bufpitch~` (pitch *detection/analysis*, used for feature
extraction) was kept — it's unrelated to the pitch-*shifting* that was removed.

## `js` control-logic objects — logic NOT ported (needs manual work)

Eight `js` objects run real routing/control logic that only exists as JavaScript;
Pd has no JS runtime, so these could not be translated automatically. Each got a
placeholder abstraction (`js_<name>_stub.pd`) with the **same inlet/outlet count**
as the original so the surrounding patch still wires up, but it only fans inlet 0
through to every outlet — it does not reproduce the real behavior:

- `js_streamWatcher_stub.pd` (streamWatcher.js)
- `js_analyze_reader_stub.pd` (analyze_reader.js)
- `js_slice_writer_stub.pd` (slice_writer.js)
- `js_slicer_stub.pd` (slicer.js)
- `js_buffer_manager_stub.pd` (buffer_manager.js)
- `js_slot_router_stub.pd` (slot_router.js) — 29 outlets, this is the main command router
- `js_spat_fx_router_stub.pd` (spat_fx_router.js)
- `js_eq_router_stub.pd` (eq_router.js)

These are genuinely large control programs (slicer.js alone is 264KB); porting their
logic into Pd message/route/expr chains (or wrapping them with an external like
`[pyext]`) is a separate, substantial task, not something safe to fake.

## Structural notes

- `buffer~` → Pd `array` (`#X array NAME SIZE float 0`). Where the same buffer name
  was declared more than once in the Max file (12 cases, all intentional aliasing to
  one shared buffer), only the first declaration became a real array; later ones
  became a comment pointing at it — Pd doesn't allow redeclaring an array name.
  Note: querying a Max `buffer~`'s size/report via bang (float/bang outlets) has
  no Pd equivalent for a plain array declaration (`#X array` has no inlets/outlets
  in the patch-cord sense) — any message/comment boxes that used to probe a
  buffer~'s duration for on-screen display will show as failed connections and
  are effectively cosmetic dead ends now. Not fixed in this pass.
- `index~ NAME` → `tabread4~ NAME` (closest Pd equivalent: audio-rate table read
  from a signal index). Pd's version is interpolating; Max's `index~` is not — minor
  behavioral difference, shouldn't be audible for this use.
- Subpatch `in N` / `out N` proxies → Pd `inlet`/`outlet` (Pd infers the inlet index
  from left-to-right position rather than a numeric argument, boxes were kept in the
  same relative order so this should line up).
- `#1`/`#2` Max argument substitution → Pd `$1`/`$2`.
- The 12 `p "..."` subpatches in the main patch became real Pd subpatches
  (`#N canvas ... #X restore ... pd name;`), same as in Max.

## Known gap: master-level spectrum/waveform display is currently unfed

Side effect of the pan/width removal, discovered while scoping this pass:
the MASTER (combined-mix) spectrum analyzer and waveform display taps
(`spec_sum_master`, `spec_mono_master`, `stereo_sum_L/R`, `wave_sum`,
`wave_mono`, `wave_trimL/R`) summed their signal from the 2D pan bus, which
is now gone -- so those two specific displays are currently silent. Per-stem
spectrum/waveform analysis (vocals/drums/bass/melody individually) is
unaffected; only the combined-mix versions are dark. Since the patch is
meant to stay analysis-focused, this is worth re-patching (sum the 4 raw
stem signals directly instead of through the removed pan bus) if you want
the master view back -- say so and I'll wire it up.

## Known remaining gap (not fixed this pass)

Buffer-size/duration query UI (`message → cnv` and `array → text` connection
failures in your log) — these are cosmetic probes into buffer~ state for
on-screen display, not audio-critical, and were left as-is. If you want
buffer duration displayed somewhere, that needs a small custom Pd patch using
`[soundfiler]` to query array size, wired to the display widget.

## New: `stem_preview~.pd` -- a minimal buffer-scrub preview player, added to fill the "Known gap" above

Follow-up to "Known gap: master-level spectrum/waveform display is currently
unfed" above. On request, the gap is now closed -- for ALL six of the
mono-mix taps that lost their signal source in the pan/width removal, not
just the master ones. `obj-spec_mono_bass`/`obj-spec_mono_drums`/
`obj-spec_mono_master`/`obj-spec_mono_melody`/`obj-spec_mono_vocals`/
`obj-wave_mono` were taken back out of `PAN_WIDTH_EXCLUDE_IDS` in
`convert_maxpat.py` so `convert_canvas()` reconstructs them again (with their
correct downstream wiring to the per-stem/master 64-band spectrum-analyzer
filterbanks and the waveform display intact -- that part of the patch was
never touched). Their old upstream connections (from `obj-spec_sum_*`/
`obj-wave_sum*`, still excluded) are simply dropped, same as every other
exclusion pass in this file.

What feeds them now is genuinely new -- it never existed in the Max patch.
The user confirmed they want a small always-slow buffer-scrub preview,
**not** a real playback engine, just enough that the analyzer/waveform
widgets have *some* live signal while exploring a loaded buffer during
training (this patch stays analysis/training-only; real playback, EQ, gain,
pan, and mixing are all still the DAW's job, same rule as every other
subsystem removed above):

- `stem_preview~.pd` (new abstraction, `src/pd/stem_preview~.pd`): creation
  arg `$1` = array name. Inlet 0 (optional, float) = scan rate in Hz,
  default 0.1 -- one full pass over the buffer every ~10s, deliberately slow
  since this is for glancing at layerings/transitions, not fast scrubbing.
  Inlet 1 (optional, float 0/1) = mute (1 = silent, default 0 = audible).
  Outlet 0 = mono signal. Internally: `loadbang` fires a `[array size $1]`
  bang-query once at load time, whose result sets the (cold) right-inlet
  scalar of a `*~` fed on its left inlet by a slow `phasor~` ramp (0..1) --
  scaling that ramp up to a 0..arraylength sample-index ramp, read by
  `tabread4~ $1`, then gated by the mute inlet (via `expr 1 - $f1` feeding a
  final `*~`) before `outlet~`.
- `add_stem_preview_subsystem()` in `convert_maxpat.py` instantiates 4 of
  these -- `stem_preview~ stem_vocals`, `stem_preview~ stem_melo`,
  `stem_preview~ stem_bass`, `stem_preview~ stem_drums` (the exact array
  names the converter emits for the 4 main stem buffers, `obj-100`/`obj-200`/
  `obj-300`/`obj-400` in the source) -- and wires each one's output straight
  into its matching re-included `obj-spec_mono_<stem>` inlet 0. A small
  `+~`/`+~`/`+~` -> `*~ 0.25` mono-sum stage combines all 4 preview outputs
  and feeds that into both `obj-spec_mono_master` and `obj-wave_mono` inlet
  0. This only runs for the main `ebys-analyze` conversion, never for
  `ebys-pitch` subpatches. Uses the `Canvas.id_to_index` registry (already
  populated by every `canvas.add(line, box_id=...)` call in `convert_canvas`)
  to find the already-emitted Pd index of each `obj-spec_mono_*`/
  `obj-wave_mono` box -- no changes were needed to `convert_canvas` itself
  for this.

Net result: 4 new `stem_preview~` instances, 4 new mixer-glue objects
(3x `+~` + 1x `*~ 0.25`), and 10 new `#X connect` lines in
`ebys-analyze.pd` (4 stem taps -> per-stem spec_mono, 4 into the sum chain,
2 out of the sum chain into spec_mono_master and wave_mono).

Caveat, same as everywhere else in this document: there's no real Pd binary
in this environment to open the file in, so `stem_preview~.pd`'s internal
wiring (in particular whether `[array size $1]` and the float-into-cold-
signal-inlet trick on `*~` behave exactly as expected on your Pd 0.52.1)
is verified only by the static structural checker (`validate_pd.py`), not
by actually running it. Worth a quick look/listen after opening.

## New: BPM-driven bar-snap buffer resize (`bpm_bar_resize~.pd`)

User request: "the buffer still needs to resize the audio according to the
bpm" -- real Pd logic, not just a metadata display. New (never existed in
the Max patch) abstraction `bpm_bar_resize~.pd` (creation arg `$1` = array
name), instantiated once per main stem buffer (`stem_vocals`, `stem_melo`,
`stem_bass`, `stem_drums`), all driven from a single shared `receive bpm`
so one `; bpm <value>` message (or anything sending to the `bpm` receive
name) snaps all 4 stem arrays to whole-bar length at once.

- Hardcoded assumptions, both baked into the `[expr]` inside the
  abstraction as literal numbers (not queried dynamically -- no real Pd
  binary here to verify a live `samplerate~` query against, so kept
  simple/low-risk per instruction): 4 beats/bar (4/4 time only) and
  44100 Hz sample rate. Edit the two `44100` / `4` literals in
  `bpm_bar_resize~.pd`'s `[expr]` box directly if either ever changes.
- Flow on receiving a bpm float: `[moses 0.001]` guards against <= 0
  (divide-by-zero) -> `[t f b]` fires a bang first (queries the array's
  CURRENT length via `[array size $1]`) then the bpm float second, both
  landing on `[pack f f]` in the correct order (bang-derived length into
  the cold/right inlet first, bpm into the hot/left inlet last, so `pack`
  is guaranteed to fire exactly once per bpm message with a correctly
  paired `[bpm current_length]` list -- deliberately used `pack`'s
  documented hot/cold inlet semantics here instead of relying on `expr`'s
  multi-inlet behavior, which is less certain) -> `[unpack f f]` splits
  the list back into two floats feeding `[expr]`'s two inlets
  (`$f1`=bpm, `$f2`=current_length) -> `[expr]` computes
  `bar_samples = 44100 * 60 / bpm * 4` then
  `new_length = max(round(current_length / bar_samples), 1) * bar_samples`
  -> a semicolon-routed message box sends `; $1 resize <new_length>`
  straight to the array (`$1` unescaped = array name, substituted once at
  abstraction-load time; the runtime resize-value placeholder is written
  as `\$1` in the source so it survives that substitution and becomes the
  message box's own normal runtime `$1` substitution instead).
- `add_bpm_bar_resize_subsystem()` in `convert_maxpat.py` (same
  `canvas.id_to_index`/`canvas.add`/`canvas.next_index` pattern as
  `add_stem_preview_subsystem()`) adds 1 `receive bpm` object + 4
  `bpm_bar_resize~ <arrayname>` instances, positioned below the
  `stem_preview~` row, and only runs for the main `ebys-analyze`
  conversion (mirrors `add_stem_preview_subsystem`).

Caveat: Pd's `[expr]` recomputes on ANY inlet receiving a value (all
inlets are "hot", unlike most Pd objects) -- so the very first bpm message
of a session can trigger one harmless extra recompute using a not-yet-set
internal value (the classic Pd `unpack`-into-`expr` idiom quirk) before the
second, correct recompute immediately follows and produces the final,
correct resize. End state is always correct; there may be one transient
spurious resize message on the very first bpm float only. There is no real
Pd binary in this sandbox to confirm this empirically, nor to confirm the
`$1`/`\$1` dollar-escaping in the message box compiles/behaves exactly as
described above -- **please open `bpm_bar_resize~.pd` in real Pd and check**:
(1) the message box displays as `; <arrayname> resize $1` after
instantiation (not `; <arrayname> resize <arrayname>` or literal `\$1`),
and (2) sending a bpm float actually resizes the array with no console
errors, ideally on both a fresh patch load and a repeated/changed bpm value.

## Stereo collapse: all hardware I/O reduced to `dac~ 1 2` only

User request: "make this 2 channels, stereo. remove anything related to
4 channels." `dac~ 1 2` (`obj-21032`, the final stereo output) is the ONLY
`dac~`/`adc~` object left in the patch now. New
`STEREO_COLLAPSE_EXCLUDE_IDS` set in `convert_maxpat.py` (unioned into
`EXCLUDE_IDS`, same pattern as `PAN_WIDTH_EXCLUDE_IDS` /
`FX_RETURN_MASTER_GAIN_EXCLUDE_IDS`) removes:

- 4CH SPATIAL OUT: `dac~ 3`/`4`/`5`/`6` (`obj-230060`..`obj-230063`,
  FL/FR/RL/RR)
- the 4 fx-send/return hardware I/O pairs: `dac~`/`adc~ 7 8`, `9 10`,
  `11 12`, `13 14` (`obj-230029`/`obj-230030`, `obj-230035`/`obj-230036`,
  `obj-230041`/`obj-230042`, `obj-230047`/`obj-230048`)
- booth monitor out `dac~ 15 16` (`booth_dac`) and rec bus out
  `dac~ 17 18` (`rec_dac`)
- the 4 live-input `adc~` objects (`live1_adc_xlr`=`adc~ 1`,
  `live1_adc_jack`=`adc~ 2`, `live2_adc_xlr`=`adc~ 3`,
  `live2_adc_jack`=`adc~ 4`) plus `live1_merge`/`live2_merge` (the `+~`
  objects summing each live pair) -- traced forward in the source JSON
  programmatically and confirmed `live1_merge` only feeds
  `live1_gain_gate` and `live2_merge` only feeds `live2_gain_gate`, both
  already dead ends inside `EQ_GAIN_EXCLUDE_IDS` from the earlier EQ/gain
  removal pass, so nothing else depended on them.

Stale `== 4CH SPATIAL OUT ==` / `== FX SEND ==` / `== FX RETURN ==` /
`== BOOTH OUT ==` / `== REC OUT ==` comment/text boxes are left in place
(harmless leftover documentation, same precedent as every earlier removal
pass in this file).

## Layout de-overlap pass (new `deoverlap.py`, cosmetic only)

User request: "clean up the patch. make sure nothing are placed on top of
each other." New standalone script `deoverlap.py`, run once against the
final `ebys-analyze.pd` after the changes above. It tracks canvas scope
nesting the same way `validate_pd.py` does (root `#N canvas` never closed
by a restore; every subsequent `#N canvas` opens a scope closed by the
next balancing `#X restore`), collects every box with real screen
coordinates in each of the 13 scopes (root + 12 nested subpatches; arrays
and connects have no `(x, y)` in this sense and are skipped), estimates
each box's bounding rect (comments use their declared `f <width>`
attribute with an estimated wrapped-line height; other box types get a
rough text-length-based width and fixed single-line height), and for any
scope with at least one overlapping pair, rewrites ALL of that scope's box
coordinates via a greedy row-packing layout (boxes sorted by original
`(y, x)`, placed left-to-right, wrapping to a new row once a row would
exceed a generous max width, with the new row's y advanced by the actual
tallest box in the row just completed plus padding -- this guarantees zero
overlaps by construction rather than just "hopefully enough spacing").

Result: 9 of the 13 scopes had at least one overlap (1071 overlapping
pairs total, mostly in the densely-packed spectrum-analyzer/mixer
subpatches), all repacked; a full re-scan afterward confirms 0 overlapping
pairs remain in any of the 13 scopes. This is purely cosmetic -- only the
numeric x/y tokens on affected `#X obj`/`#X msg`/`#X text`/`#X floatatom`/
`#X restore` lines were rewritten in place; box order, box count, and every
`#X connect` line (which reference box ORDER, not position) are byte-for-
byte identical before and after (verified: identical
`obj`/`msg`/`text`/`array`/`connect`/`restore`/`floatatom`/`N_canvas`
counts from `validate_pd.py`, identical line count, and a line-by-line
diff confirming the only per-line changes are the x/y coordinate tokens).
No functional change whatsoever.

## `peek~`/`uzi`/`round`/`zl.group` now use the real cyclone library, not blind stubs

Follow-up: "can't you code the replacement for the stubs?" Four of the
seven small Max-object stubs turned out to have real, behavior-matching
implementations already available in the **cyclone** library (a community
port of Max's classic object set, install via Pd's Help -> Find externals
/ Deken, search "cyclone"; requires Pd 0.55+, does NOT work in
Pd-Extended/Purr Data/Pd-L2ork). Switched the converter to emit these
directly instead of the old pass-through stubs:

- `peek~ <buffer>` -> `cyclone/peek~ <buffer>`
- `uzi <n>` -> `cyclone/uzi <n>`
- `round` -> `cyclone/round`
- `zl.group` -> `cyclone/zl group` (cyclone implements the whole `zl`
  family as one `[zl]` object taking the mode as its first creation arg --
  Max's dotted `zl.group` shorthand doesn't resolve in cyclone, so `group`
  is inserted explicitly)

All four are emitted with the `cyclone/` folder prefix so they resolve
correctly without requiring a global `-lib cyclone` startup declaration.
`peek_stub.pd`, `uzi_stub.pd`, `round_stub.pd`, and `zl_group_stub.pd` are
no longer used and have been removed from `src/pd/`.

**The remaining 3 stubs stay as blind pass-throughs** -- no drop-in
replacement exists for these:
- `regexp` -- no Pd or cyclone regex object exists at all (Max's version
  postdates cyclone's target object set). Usual Pd workaround: `[shell]`
  piping to `grep`/`sed`, or hand-rolled parsing.
- `getattr` / `dict.pack` -- Pd has no attribute system or dictionary data
  type. Closest options: cyclone's `coll` (associative index/symbol ->
  data store), or a small `pdlua` wrapper around a Lua table.

## `streamWatcher.js` now runs for real, over an OSC/Node bridge (proof of concept)

Follow-up: "can't pd use js?" No -- Pd has no embedded JavaScript engine
the way Max's `js` object does. But the original patch already treats
`ws_server.js` as an external process (Max's `node.script` spawns real
Node.js and talks to it over IPC, not the inline `js` engine) -- so the
same pattern works for the other `.js` control-logic files: keep them as
real, unmodified-in-spirit Node scripts, and have Pd talk to them over a
local socket instead of trying to embed JS inside Pd.

Built and tested end-to-end as a proof of concept for the smallest file,
`streamWatcher.js` (115 lines, 1 outlet, polls `stream.txt` every 1s and
bangs on change):

- **`pd_build/bridge/osc.js`** -- a small, dependency-free OSC 1.0
  encoder/decoder over UDP (Node's built-in `dgram`, no `npm install`
  needed). Round-trip tested.
- **`pd_build/bridge/streamWatcher_bridge.js`** -- standalone Node
  replacement for the original streamWatcher.js. Same logic (including
  the "first read also bangs" bugfix already documented in the original
  file's comments), with Max-only APIs swapped for Node equivalents:
  `patcher.filepath` -> explicit `--data-dir` arg (a standalone process
  has no patch to ask), `File` -> `fs`, `Task`/`.schedule()` ->
  `setTimeout`, `post()` -> `console.log()`, `outlet(0, "bang")` -> an OSC
  UDP message. Tested against the real `EBYS/data/` directory --
  correctly reads the current session, detects the baseline stream.txt,
  and sends the OSC message.
- **`src/pd/bridge_streamWatcher.pd`** -- replaces `js_streamWatcher_stub.pd`
  in `ebys-analyze.pd`. `[netreceive -u -b 9001]` -> `[oscparse]` ->
  `[route streamWatcherBang]` -> bang, matching the original outlet
  exactly. Verified against Pd's actual `x_net.c`/`x_misc.c` source (not
  guessed): `netreceive` needs `-b` for raw/binary mode to feed
  `oscparse`; `oscparse` splits multi-segment OSC addresses on `/` into
  separate leading list atoms, which is why the bridge deliberately uses
  a single-segment address (`streamWatcherBang`, no internal slash) --
  avoids needing nested `[route]` stages. `netreceive`'s port (9001) must
  match the bridge script's `--send-port`.

**To run it:** start the bridge alongside Pd --
`node bridge/streamWatcher_bridge.js --data-dir /path/to/EBYS/data --send-port 9001`.
No dependencies to install (`osc.js` is self-contained).

**The other 7 `.js` files are still blind stubs.** Same pattern would work
for all of them, but they're much bigger (slicer.js alone is 264KB) and
most use Max-specific APIs beyond what streamWatcher.js needed (buffer~
access, dict/Global objects, more complex Task scheduling) -- porting
each is real, scoped work, not a mechanical repeat of this one. Given the
message-flow tracing already done for `GUI_PARAMETER_MAPPING.md`, the
natural next candidates by size/complexity are `spat_fx_router.js` (2
outlets, still small) and `analyze_reader.js`/`slice_writer.js` (moderate,
and closest to the "load buffers for training" core workflow) before the
two large ones (`slot_router.js`, `buffer_manager.js`) and the very large
`slicer.js`.

## Layout pass 3: mimic the original Max placement instead of a grid

Follow-up: "too hard to understand, can you mimic the placement of the max
patch?" The two `deoverlap.py` passes above solved overlap by sorting
every box into a fresh grid, which fixes collisions but throws away the
Max patch's original spatial groupings (related objects that were near
each other in Max ended up scattered across an arbitrary grid instead).

New script `layout_preserve.py` takes the opposite approach: start from
each box's ORIGINAL Max-derived (x, y) (i.e. regenerate straight from
`convert_maxpat.py`, before any grid repack), and only nudge boxes that
are ACTUALLY overlapping, by the minimum distance needed to separate them
plus a comfortable margin (24px) -- an iterative local "push apart" pass
(pairwise separation along whichever axis has the smaller overlap depth),
not a global re-sort. Boxes that never overlap anything don't move at all,
so the visual structure/proximity from the original Max layout is
preserved almost everywhere; only genuinely colliding spots get adjusted.

Two things made this need several iterations to fully converge (root scope
has 1783 boxes): (1) a spatial-hash broad phase (400px grid cells) so each
pass only tests nearby pairs instead of all ~1.6M possible pairs, and (2)
a "break exact duplicates" pre-pass -- dozens of boxes (mostly the
"duplicate buffer~" comment boxes, which inherit their original object's
exact coordinates) started at the EXACT same (x, y) as 2-4 other boxes,
which made pairwise pushing converge very slowly from a perfectly
symmetric starting point; nudging those apart by a few px up front broke
the symmetry and let separation converge normally. Went from 7124
overlapping pairs down to 0 over several script runs (each run is fully
resumable -- it just re-reads whatever the file currently looks like and
keeps separating). This superseded the two `deoverlap.py` runs above --
`ebys-analyze.pd` now reflects `layout_preserve.py`'s output, not
`deoverlap.py`'s. `deoverlap.py` is left in the repo in case a full grid
re-layout is ever wanted again instead.

## Layout pass 2: more breathing room (superseded by pass 3 above)

Follow-up: "now its only one big pile of code stacked above each other,
give it more space to breathe." `deoverlap.py`'s gaps were only 20px
column/20px row -- enough to guarantee zero overlaps, but boxes still sat
almost edge-to-edge. Bumped to 90px column / 80px row gaps (`MAX_ROW_WIDTH`
also widened, 2200 -> 2600px, so rows don't wrap as aggressively), and the
pass now repacks EVERY scope unconditionally rather than only the ones with
a detected overlap -- previously, scopes with no overlap kept their
original (often just as cramped) Max coordinates, so spacing was
inconsistent across the file. Still purely cosmetic: same box order, box
count, and `#X connect` lines untouched, only x/y tokens rewritten.

## Also removed: 28 FL/FR/RL/RR quad peak meters

Follow-up to the stereo collapse: the earlier pass only removed the
`dac~`/`adc~` hardware I/O; it missed a separate quad-metering subsystem --
28 `peakamp~ 100` -> `prepend meter <name>_FL/FR/RL/RR` pairs (master +
vocals/drums/bass/melody/live1/live2), reporting levels out to
`ws_server.js` over websocket for an external status display. Explicitly
4-channel by name and purpose, so removed per "remove anything related to 4
channels." Most were already unfed (their `peakamp~` source was the
quad-pan bus removed in the pan/width pass) but the objects themselves were
still in the file. The shared reporting hub (`gate 1` -> `ws_server.js`)
is untouched -- it also carries the 320-band spectrum reports, waveform
pos/neg, lufs, and status messages, none of which are 4-channel-specific.
Re-ran `deoverlap.py` again after this removal.

## Panel "zone box" removal

Follow-up to the layout cleanup: 25 Max `panel` objects (`pnl_fxsend`,
`pnl_pan2`, `pnl_sums`, `pnl_master`, `pnl_stereo`, `pnl_4ch`, etc.) were
being translated into Pd `cnv` GUI boxes. In Max, `panel` is a purely
cosmetic background/section-divider rectangle (1 inlet, 0 outlets, never
wired into any real signal or message chain) — but Pd's `cnv` renders as an
*opaque filled rectangle*, so these were sitting on top of and hiding
whatever real objects happened to fall underneath their bounds. Dropped
entirely (`gui_line()` now returns `None` for `maxclass == "panel"`, which
`Canvas.add()` already handles cleanly — no box, no index consumed, any
stray connection to one is silently skipped same as every other exclusion
in this file). Re-ran `deoverlap.py` afterward since removing 25 boxes
shifted what's left. `jsui` placeholder boxes (the smaller labeled ones,
`jsui_<filename>`) are a different thing — actual widget placeholders, not
layout dividers — and were left as-is.

## Array cleanup, regrouping, and a real converter gap (2026-07-31)

A manual edit session in Pd accidentally deleted 44 of the 56 named arrays
(raw stem buffers, `.slices`, mfcc/pitch/loud/chroma/spectral feature
arrays, and the `src_0/1_*`/`ring_0/1_*`/`snap_*` double-buffer streaming
set), while every object that reads/writes them by name (`fluid.buf*~`,
`info~`) stayed in the patch. All 44 were restored, then all 56 arrays
(including 12 that were still buried inside `feature_lookup` and
`stereo_to_mono.*` subpatches) were pulled into one place: a 14-category ×
4-stem grid positioned below the "TUI COMMANDS" header. Pd arrays are
referenced globally by name regardless of which canvas declares them, so
this had zero effect on any `@source`/`@features`/`@indices` wiring.

Separately, a real converter gap was found and confirmed against the Max
source directly (not guessed): the loading section's `reset 1` → `1` →
`5` message-box chain (`5` sets the stem-count `counter`'s upper limit) had
two message boxes (`1` and `reset 1`) missing from the live file entirely.
They aren't in `convert_maxpat.py`'s exclusion list, and a fresh from-scratch
reconversion of the untouched `.maxpat` does include them — so the drop
happened during a later manual edit pass, not in the converter. Both boxes
were restored with Max-faithful wiring.

The `t l l` boxes feeding `pd feature_lookup` (the chroma/spectral 12-value
lookup, see the `multislider` row in the table above) turned out to be
correctly wired all along — verified against Max, where the matching
`multislider` objects also had nothing upstream/downstream of them either
(they're driven by direct mouse interaction in Max, not further patch
logic). Since `t l l` has no actual slider UI, it was pure dead weight with
no way to see or set values. The whole `feature_lookup`/multislider lookup
cluster (all 8 instances: 4 chroma + 4 spectral) has since been deleted from
the patch at the user's request — the chroma/spectral **arrays** themselves
are untouched and still get written by `fluid.bufchroma~`/
`fluid.bufspectralshape~`, only the interactive lookup/display UI is gone.

## spat_fx_router.js dropped; karma~ replaced with a real time-stretch (2026-08-01)

Two more removals/replacements per explicit request, continuing the "analysis/
training only, no live mixing" philosophy now that spatialization is DAW-
controlled too:

**spat_fx_router.js dropped.** The blind stub `js_spat_fx_router_stub.pd` was
deleted from `src/pd/`. Tracing the Max source confirmed it was already an
orphan even before this: `obj-20100` (`js spat_fx_router.js`) is fed only by
the shared `ws_server.js` hub (which stays, it also carries spectrum/lufs/
status reporting) and feeds only `obj-20101`, a 37-way `route` whose ~35
targets (`width_*`, `joyX_*/joyY_*`, `fxsend_*`, `fxreturn_*`, `master_gain`,
`booth_gain`, `rec_gain`, etc.) were *already* dead-ended by the earlier
pan/width and fx-return/master-gain exclusion passes. So `obj-20100` and
`obj-20101` were added to a new `SPAT_FX_ROUTER_EXCLUDE_IDS` set in
`convert_maxpat.py` (same pattern as `PAN_WIDTH_EXCLUDE_IDS` etc.) so a future
reconversion won't regenerate the stub. `src/max/ebys-analyze.maxpat` is
untouched, as always — this is a Pd-side-only removal.

**karma~ replaced with `stem_timestretch~`.** The user deleted the old
karma~-based training-playback object and asked for a real, pitch-independent,
ratio-controlled replacement (not just a rate-scrub) so tracks can be
BPM-aligned during training preview. Vendored unmodified from William Brent's
`timeStretch_tilde` repo (pure vanilla Pd, phase-vocoder, GPL-3.0, no compiled
external needed):
- `src/pd/timeStretch~.pd` — the 16-voice phase-vocoder engine
- `src/pd/lib/timestretch-reader-abs.pd` — its windowed-table-reader
  dependency

`src/pd/stem_timestretch~.pd` is a new wrapper (not vendored, written for
this patch) exposing a simple `ratio <f>` / `play` / `stop` interface around
one voice of `timeStretch~`, keyed to a given array name (creation arg).
`ratio` sets the stretch factor (1 = normal, 2 = double speed/half duration,
0.5 = half speed/double duration); `play` always starts from the beginning
at the current ratio (no smooth mid-playback ratio change — re-send `play`
to restart at a new ratio); `stop` stops it.

Four instances were wired into `ebys-analyze.pd` under a new "TRAINING
PLAYBACK PREVIEW" section (one per stem: vocals/melody/bass/drums), each
`floatatom → "ratio $1" → stem_timestretch~ stem_<name> → *~ 0.4`, summed
into the patch's one remaining `dac~ 1 2`. This is explicitly *preview/
training* audio only, same as everything else in this patch — final
playback and mixing still happen in the DAW.

## Remaining bridge work

`streamWatcher.js` and `slice_writer.js` now have real Node/OSC bridges
(`bridge/streamWatcher_bridge.js` + `bridge_streamWatcher.pd`,
`bridge/slice_writer_bridge.js` + `bridge_sliceWriter.pd`, both wired into
`convert_maxpat.py`'s `JS_BRIDGE_REPLACEMENTS`). `spat_fx_router.js` no
longer needs one (dropped above). Remaining: `analyze_reader.js`,
`slot_router.js`, `buffer_manager.js`, `slicer.js`, and `ws_server.js` (the
shared reporting hub, lower priority — write-only telemetry, not control
logic the patch depends on).

**Architecture split (decided 2026-08-01):** not every remaining `.js` file
can become a pure Node/OSC bridge the way `streamWatcher.js`/
`slice_writer.js` did. Those two are pure file-I/O + message-routing/math —
zero dependency on Max's `Buffer` object. `analyze_reader.js` and
`buffer_manager.js`, by contrast, constantly `peek()`/`framecount()` live
`buffer~` (array) sample data that only exists inside Max/Pd's own process —
a standalone Node script has no way to reach into that memory. Per explicit
decision, the buffer-touching logic in those two (and the buffer-touching
half of `slicer.js`) will be reimplemented as real vanilla-Pd patches
(`tabread`/`array size`/`soundfiler`) instead of bridged out to Node, since
Pd already owns this data in-process and a bridge would just add pointless
request/reply round-trip latency for something Pd can do natively. The
pure-routing/file-I/O parts of those same files can still become Node
bridges. `slot_router.js` looks like pure message-routing (one stray
`Buffer` reference to double check) and is next up; `slicer.js` (264KB,
~50 message handlers, the core slicing/training engine) is last since it's
by far the largest and mixes both categories.

### `slice_writer.js` → `bridge_sliceWriter` (2026-08-01)

Ported faithfully to `bridge/slice_writer_bridge.js` (Node): same Krumhansl-
Schmuckler key detection, same merge-safe `saveLibrary()` (reads existing
`analysis_library.json` first, only ever adds/updates a track, matching the
already-documented bugfix in the original source), same per-stem slice/meta
write functions, same `trackExists`/`forgetTrack`/`reset*` commands. Smoke-
tested end to end (fake OSC client standing in for Pd): `set_track_name` →
slice writes → `write_meta_vocals` → correct nested JSON on disk,
`trackExists` correctly returns 1 for the just-written track and 0 for an
unseen one.

Max's js auto-dispatch-by-message-name (sending `write_vocals` to inlet 0
auto-calls `write_vocals()`) is reimplemented as an explicit `DISPATCH`
table keyed by message selector, built programmatically from a `STEM_CFG`
table (vocals/melo/bass have a `P` pitch field, drums doesn't) rather than
hand-duplicating ~80 near-identical per-stem functions.

`bridge_sliceWriter.pd`'s inlet accepts the exact same messages the Max
object's inlet 0 did (nothing upstream needed to change). It forwards them
to the bridge using `[pd packOSC]` — a small subpatch that treats the
message's own selector as the OSC address and the rest as OSC args, then
`[list prepend send] → [list trim] → [netsend -u -b]` to actually transmit.
This pattern is not homegrown: it's the documented vanilla-Pd OSC-send idiom
(verified against `danomatika/BangYourHead`'s `mrpeach-to-vanilla-osc.pd`,
the reference example linked from Pd's own forum for "how do I send OSC
without mrpeach"). Replies come back via the same
`[netreceive -u -b]→[oscparse]→[route]` pattern `bridge_streamWatcher.pd`
already established.

Only 3 of the original's 4 outlets are reproduced (total slice count, last
slice ID, trackExists/skip flag). Outlet 0 (`replace`/`clear` messages) fed
a Max `dict analysisLib` object with no Pd equivalent — dropped, since the
bridge is already the single source of truth for `analysis_library.json`
(same as the original `library` JS variable was) and nothing on the Pd side
could meaningfully consume a raw `replace` message anyway. The
`ebys-analyze.pd` connection from the old stub's outlet 0 into `dict
analysisLib` was removed accordingly (that `dict` object itself is left in
place, untouched, still fed by the native `read`/`clear`/`export` message
wires — those are unrelated to this change and out of scope here).

## Training playback wired to a real slot_router; dead karma~ scaffolding removed (2026-08-01)

Two related changes, both requested together: connect the TRAINING PLAYBACK
PREVIEW section (added 2026-07-31, see above) to the rest of the patch
instead of only manual floatatom entry, and clean out a section of visibly
dead objects left over from the karma~ removal.

**Why `slot_router.js` couldn't be ported as-is.** Read the file in full:
its original 29 outlets are *entirely* karma~ playback control and pfft~/
gizmo~ pitch/formant control — nothing else. Both are already gone from
this Pd conversion (karma~ deleted and replaced by `stem_timestretch~`;
pitch/formant deliberately excluded per the standing "DAW handles mixing/
pitch/formant" rule — see the `EXCLUDE_IDS` comment in `convert_maxpat.py`).
So a faithful full port would have 29 outlets, all but a handful targeting
things that don't exist in this patch. Instead, `slot_router.pd` (+ its
`slot_router_stem.pd` per-stem helper, instantiated 4x) is a real,
deliberately scoped-down native-Pd rewrite — no Node bridge needed here
either, it's pure message routing/arithmetic, same category as
`slice_writer.js` turned out to be, just without any file I/O:

- `prepare <stem> <ringSlot> <segDurMs> <stretchRatio>` — stashes the
  segment duration and stretch ratio for that stem. `ringSlot` is parsed
  but intentionally unused for now — the ring-buffer double-buffering
  (`buffer_manager.js` composing the current slice into `ring_0/1_<stem>`)
  isn't wired up yet (that's the still-pending native-Pd rewrite task for
  `buffer_manager.js`), so for now this always plays the stem's raw full
  buffer via `stem_timestretch~ stem_<name>`, not a specific slice.
- `commit <stem>` — sends `ratio <stretchRatio>` then `play` to that stem's
  `stem_timestretch~` instance, and starts its `[delay]` object (auto-
  advance timer) at `segDurMs * stretchRatio` (the actual stretched
  playback duration) — same multiply the original `prepare()` did.
- `stop` — sends `stop` to all 4 `stem_timestretch~` instances and cancels
  all 4 pending delays.
- `resume` — deliberately implemented as identical to `commit` (replays the
  segment from the top, restarts its delay). karma~ could truly pause and
  resume in place, which is what the original `resume()` relied on (bare
  `"play"`, no reseek); `stem_timestretch~` has no pause state and always
  restarts a segment from 0 (see its own doc comment), so a real in-place
  resume isn't possible with this replacement — flagged clearly in
  `slot_router_stem.pd`'s own comments as a real behavior difference, not
  an oversight.

The auto-advance chain (`[delay]` → `next <stem>` → `js_slicer_stub`) was
already live and correct — untouched, just re-pointed at the new
`slot_router`'s outlets instead of the old stub's.

**Dead objects removed.** Tracing the "SLOT ROUTER" section's connection
graph turned up 16 objects that were pure leftovers from the karma~ removal
and did nothing: per stem (vocals/melody/bass/drums), a `[t b b f]` plus
`msg play` and `msg 0` (fed by the stub's old outlets, but with nowhere to
go — karma~'s inlet 0 that used to receive them is gone), and a fully
orphaned `msg stop` (zero connections in or out, confirmed via the
connection graph, not just visually). Confirmed via the graph — not
guessed — before deleting: every one of these 16 objects had either no
outgoing connection at all, or its only outgoing connection targeted
another now-dead object in this same set. Removed and the file's box
indices renumbered accordingly (a scope-tracked Python pass, same
technique used for the earlier array extraction — verified via
`validate_pd.py` afterward: 0 structural errors, object/message counts
match exactly `-16` objects `+1` new doc comment, and a full cross-check
that `slot_router`/the 4 `stem_timestretch~` instances/the 4 surviving
`[delay]` objects all landed at the expected new indices post-renumber).

`convert_maxpat.py` gained a new `NATIVE_PD_REPLACEMENTS` dict (parallel to
`JS_BRIDGE_REPLACEMENTS`, same "js `<file>` → real object" substitution,
just for files that turned out not to need a Node process at all) with
`"slot_router.js": "slot_router"`, so a future reconversion won't
regenerate the blind stub (now deleted). Known rough edge: if the Max
source's `slot_router.js` object is ever reconverted from scratch, it still
has 29 outlets' worth of connections in the `.maxpat`, but the real
`slot_router.pd` only has 16 — connects 16-28 in a from-scratch reconversion
would reference outlets that don't exist on the replacement. Not an issue
today (those connections' targets are all in `EXCLUDE_IDS` already, so they
won't be emitted either), but worth knowing about if this project ever
needs a ground-up reconversion pass again.

## FluCoMa multichannel array layout bug fix (2026-08-01)

Found while starting `analyze_reader.js`'s native-Pd rewrite (its whole job is
reading these arrays back), confirmed against FluCoMa's own docs
(flucoma-pd's QuickStart.md) before touching anything: FluCoMa's Pd objects
are multichannel, and the convention for a multichannel array is `name-0`,
`name-1`, ... `name-(N-1)` (one array per channel, 0-indexed) — NOT a single
array holding all channels. The conversion had been declaring a single plain
array per feature buffer (`stem_vocals_spectral.features`, etc.) the whole
time. This predates this session's work — not something introduced here —
but it meant `fluid.bufspectralshape~`/`fluid.bufchroma~`/`fluid.bufmfcc~`/
`fluid.bufpitch~`/`fluid.bufloudness~` had nowhere correctly-shaped to write
their actual multichannel output, i.e. the whole descriptor-extraction
pipeline had no correct destination even before `analyze_reader.js` tried to
read anything back.

Fixed by replacing the single array declaration with the correct number of
per-channel arrays for each of the 5 multichannel feature types, ×4 stems
(20 groups → 144 individual arrays, net +124 arrays: spectral shape = 7
channels [centroid, spread, skewness, kurtosis, rolloff, flatness, crest],
loudness = 2 [loudness, true peak], pitch = 2 [pitch, confidence], chroma =
12 [pitch classes], MFCC = 13 [`@numcoeffs 13`]). The `fluid.buf*~` objects'
own `@features`/`@source` arguments were NOT changed — per FluCoMa's
convention those stay as the base name; the object itself looks for/writes
the `-0..-(N-1)` arrays automatically. Made the new arrays headless (no
graph display) rather than keeping the earlier "make everything visible"
grid treatment for these specific 144 -- individually graphing 144 single-
channel views wasn't going to be useful, and would have made an already
large patch region much larger. If specific channels are worth visualizing,
they're easy to add back individually (`#X array NAME-K SIZE float FLAG` in
its own `#N canvas ... (subpatch) 0; ... #X restore X Y graph;` wrapper,
same pattern used elsewhere in this file).

Verified via a scope-tracked rewrite (delete 20 single-array root boxes,
insert 144 headless replacements, renumber every downstream `#X connect`
reference by the net index shift) -- `validate_pd.py` reports 0 structural
errors afterward, and array count is exactly 56 (previous total) - 20 + 144
= 180.

**Not yet fixed, same suspected bug:** `fluid.bufstats~`'s own `@stats
stem_<x>_loud.stats` output arrays are also still single un-suffixed
declarations. Not touched in this pass because nothing currently reads
`.stats` (not `analyze_reader.js`, not `slice_writer.js`/its bridge) --
flagging here so it isn't forgotten once something does need to read stats
back.

## analyze_reader.js: real per-onset descriptor extraction (2026-08-01)

`js_analyze_reader_stub` replaced with `analyze_reader.pd` + `analyze_reader_stem.pd`
(instantiated 4x: vocals/melo/bass/drums). This is the piece that actually
makes the (now-fixed) FluCoMa arrays useful: for a given stem, read every
onset position out of `stem_<x>.slices`, and for each one read the
corresponding descriptor values (spectral shape, loudness, pitch, chroma,
MFCC) out of the correct per-channel array, then send the exact same
`set_X_*`/`write_X` message vocabulary `bridge_sliceWriter` already accepts
-- wired with a direct patch cord (not OSC), matching how the original Max
patch wired `analyze_reader.js`'s outlet 0 straight into `slice_writer.js`'s
inlet.

**Real vanilla-Pd iteration**, since Pd has no for-loop: `[until]` fed the
onset count on its left inlet fires that many bangs, each one driving an
`[f]`/`[+ 1]` pair that produces the loop index 0..N-1 (the standard,
Pd-doc-verified idiom for this -- checked against Pd's own
`2.control.examples/24.loops.pd`, not guessed). Each iteration: `tabread`
the onset sample position, clamp it into range, compute the descriptor
frame index, `tabread` every needed channel (C/S/F/E/P/confidence/12 chroma
channels/6 MFCC coefficients), fold the 12 chroma channels down to a
dominant-bin index via an 11-stage pairwise `expr`-based compare chain (a
legitimate fixed unroll, not a loop substitute -- chroma is always exactly
12 channels), then emit the full message set. A 25-way `[trigger]` fans the
descriptor frame index out to all the per-channel reads with the fire order
deliberately controlled (Pd triggers fire right-to-left) so the chroma fold
chain sees its channels in the correct 0→11 order and `write_$2` fires
strictly after every field has actually been sent -- verified by tracing
the generated file's actual outlet→target mapping, not assumed from the
source.

**What's real vs. deferred:**
- Real: onset positions, spectral shape (centroid/spread/flatness), loudness,
  pitch (with the same confidence gate the original used), all 12 chroma
  channels folded into a dominant pitch-class index, all 6 MFCC coefficients
  used downstream, segment duration. These feed straight into
  `bridge_sliceWriter`'s already-real key-detection logic (accumulates pitch
  values per `write_X` call, same as before).
- Deferred: BPM estimation sends a placeholder `bpm=0, conf=0` instead of the
  original's comb-filter algorithm (141 candidate BPMs × 9 grid multipliers
  × every onset interval, then a fine sweep) -- a nested numerical search
  that's a poor fit for hand-wired Pd patch cords (fragile, essentially
  unverifiable without live testing). Real BPM needs either a pdlua/compiled-
  external port or moving just that computation to a Node bridge (bulk-read
  the onset array once, do the math in JS, send `bpm`/`conf` back). Flagged
  as follow-up work, not attempted here.
- Deferred: the multi-track batch/counter automation (`startAnalysis`,
  `startStem <n>`, `resetMemory`, `loadRegistry`, and the `stream.txt`
  parsing/htdemucs-folder-scanning that feeds it) -- this is the file-I/O
  half of the original `analyze_reader.js`, portable to a Node bridge the
  same way `slice_writer.js` was (no buffer access needed for that part).
  Not built yet. What DOES work right now: the patch's existing manual
  `readVocals`/`readMelo`/`readBass`/`readDrums` message boxes (already
  present, previously wired to the blind stub) now trigger real analysis
  for that one stem, and `set_track_name <name>` (sent by whatever upstream
  wiring already constructs it) is relayed straight through to
  `bridge_sliceWriter`, reusing its already-real "skip if already analyzed"
  registry check instead of re-implementing that logic in Pd.

`convert_maxpat.py`'s `NATIVE_PD_REPLACEMENTS` gained
`"analyze_reader.js": "analyze_reader"` so a future reconversion won't
regenerate the (now-deleted) blind stub.

## `slicer.js`: real segment selection, transport, and BPM/downbeat timing

`js_slicer_stub.pd` → real `bridge_slicer` (2026-08-01). `slicer.js` is
EBYS's sequencing brain — segment selection, BPM/downbeat-aware timing,
transport (start/stop/next/loop), learned-bias scoring, genre/key filters,
sync groups. Its own header comment says it plainly: "Slicer does NOT touch
audio objects or DSP parameters directly. It emits play triggers on outlet 0
that buffer_manager.js consumes." No live buffer~/array access anywhere in
it — unlike `slot_router.js`/`analyze_reader.js` (both rewritten as native
Pd because they DO touch live audio state), this is a Node/OSC bridge, same
architecture as `slice_writer.js`.

- `bridge/slicer_bridge.js` (Node process) is a near-verbatim port — the
  actual musical decision-making (segment selection, scoring, BPM math,
  downbeat alignment, Camelot-wheel key compatibility, the learned-bias
  linear models) is copied essentially unchanged, function by function.
  Only the platform glue changed: `outlet(N,...)` → OSC send,
  `arrayfromargs(arguments)` → a one-line polyfill (`arguments` itself is
  a normal JS feature, not a Max API), `Task`/`.schedule()`/`.cancel()` →
  a small class wrapping `setTimeout`, `File`/`patcher.filepath` → `fs` +
  the same session-aware `getDataDir()` convention `slice_writer_bridge.js`
  uses (both bridges resolve to the identical session folder), Max's
  auto-dispatch-by-message-name → an explicit ~54-entry `DISPATCH` table.
- `bridge_slicer.pd` is the Pd-side glue, structurally identical to
  `bridge_sliceWriter.pd` (same `[pd packOSC]` → `[netsend -u -b]` inbound
  path, `[netreceive -u -b]` → `[oscparse]` → `[route ...]` outbound path),
  on ports 9004 (Pd→bridge)/9005 (bridge→Pd) — distinct from
  `bridge_sliceWriter`'s 9002/9003 and `bridge_streamWatcher`'s 9001 so all
  three can run at once. 1 inlet (down from the original's 5 — inlets 1-4
  carried karma~'s live position feed, and per the original's own comment
  those patch cords "do NOT exist yet in the saved .maxpat... must be wired
  by hand," i.e. were never actually connected to anything), 4 outlets
  matching the original's outlet contract exactly (0=playback trigger,
  1=status/metadata, 2=descriptor dump, 3=query result count).
- Outbound messages use one OSC address per outlet number rather than a
  distinct address per tag (slicer has ~80 different `outlet(1,...)` tag
  words — spelling each out individually the way `bridge_sliceWriter`'s 3
  fixed messages did wasn't practical). Each OSC message carries the whole
  original argument list (tag word first); `[route /slicerOut0 ...
  /slicerOut3]` on the Pd side hands back an ordinary tagged Pd list, so
  downstream `route` objects in the main patch see identical messages to
  before.

Simplifications, beyond the platform glue (also documented at the top of
`slicer_bridge.js` itself):

- **Chunked transfer removed.** The original split `analysis_library.json`/
  `downbeats.json`/`genres.json`/`learned_bias.json`/the saved index into
  ~2KB pieces sent as repeated `outlet()` messages, purely to work around
  Max's 32767-byte JsFile limit and N4M's `setDict` size ceiling. Node has
  neither limit — `libchunk()`/`genrechunk()`/`downbeatchunk()`/
  `biaschunk()`/`idxchunk()` are gone; the bridge reads/writes each file
  directly via `fs` (a new `loadGenres()` and `loadIndexFromDisk()` cover
  what `genrechunk()`/`idxchunk()` used to populate from a chunk stream).
- **karma~ live-position feed removed.** karma~ doesn't exist in this Pd
  conversion (`stem_timestretch~` replaces it, with no equivalent live
  position feed) — `list()`/`karmaPos`/`karmaState`/`karmaPosAtMs` are gone,
  and `performStopNow()`'s pause-position estimate always uses the
  wall-clock-based branch the original only used as a fallback.
- **`pausedPosFrac`/"resumeSeek" is computed but currently inert
  downstream.** `slot_router_stem.pd`'s resume == commit (`stem_timestretch~`
  can't seek mid-buffer, so resume always restarts the current segment from
  its top — a documented, deliberate difference from karma~ noted in that
  file's own header). Left in place rather than stripped so wiring up real
  seek support later, if `stem_timestretch~` ever gains it, is a small
  change instead of a re-add.

`convert_maxpat.py`'s `JS_BRIDGE_REPLACEMENTS` gained
`"slicer.js": "bridge_slicer"` so a future reconversion won't regenerate the
(now-deleted) blind stub.

## Link audit: cross-checking the real .maxpat connection graph

Per request, I parsed `ebys-analyze.maxpat`'s actual JSON (not memory/assumption)
to get the complete, real inbound/outbound patchline list for every `js`
control-logic object, plus every `dict`/`send`/`receive` hub in the file, and
checked each against what's actually wired in the Pd conversion. Findings:

**`dict analysisLib` (the example you gave).** Its only 5 real connections in
Max: `js slice_writer.js` outlet 0 writes into it; a `read
analysis_library.json` message and an `export analysis_library.json` message
load/save it to disk; a `clear` message empties it; and its own output feeds
a `loadRegistry` message box, which in turn feeds `js analyze_reader.js`'s
inlet. So its ONLY real job is: be a shared, live, in-memory mirror of
`analysis_library.json` that other objects can query. Pd has no `dict`
equivalent at all — not "unported," structurally absent from the language —
so this can't be reconnected with a patch cord the way you'd expect. What
actually preserves the *function* it served: `analysis_library.json` on disk
is already the single source of truth (`bridge_sliceWriter`/
`slice_writer_bridge.js` read and write it directly), and the one real
consumer downstream of the dict — analyze_reader's "is this track already
analyzed, should I skip it" check via `loadRegistry` — is exactly what
`bridge_sliceWriter`'s own `set_track_name()` already does today (see the
"`analyze_reader.js`" section above), just reached via `set_track_name`
instead of a `loadRegistry` round-trip through a dict. So the link isn't
missing so much as re-routed to the one place that actually needs it. The
`loadRegistry` message *itself* (a stand-alone command, separate from
`set_track_name`) is still unhandled in Pd — that's part of task 36 (the
`analyze_reader.js` file-I/O/batch half), not fixable without building that.

**`js slicer.js`: found and fixed a real gap.** The `[route ...]` object
feeding slicer's inlet in the live patch (`obj-4041`) explicitly routes a
`selectSegment` message alongside `buildIndex`/`start`/`stop`/etc — meaning
the real patch does send bare `selectSegment <track>` commands, not just the
documented convenience wrappers. My bridge's `DISPATCH` table hadn't included
it (I'd assumed it was an internal-only helper). Added — the ported function
itself was already there and correct, it just wasn't reachable as a message.

**`js analyze_reader.js`: confirmed, not new.** Outlet 0 (→ slice_writer,
done) is the only outbound connection currently reproduced in Pd. Every
other outlet (`read <file>.wav` for each stem, direct `buffer~ stem_X`
writes, a `sel all_done` signal, a mono-conversion trigger) is exactly the
file-I/O/multi-track-batch half already scoped as task 36 — confirmed via
the real patchlines, not just re-asserted from memory.

**`js buffer_manager.js` / `js slot_router.js`: confirmed, not new.**
buffer_manager's entire connection graph (14 inbound `*_done` signals, 8
outbound `buffer~`/`fluid.bufcompose~` targets, feeds into slot_router) is
real and substantial, but buffer_manager.js itself is still an unbuilt stub
(task 32) — none of it is wireable yet. slot_router's Max-side wiring is
~90% karma~/pfft~/pitch/formant, all correctly and deliberately dropped;
the one live remainder (4× `[delay 1000]`) was already wired correctly in
the earlier slot_router build.

**EQ/gain/joystick send↔receive pairs (74 pairs) and the `dict.pack`
descriptor packer:** confirmed still 100% inside the EQ/gain/mixing and
pitch/formant subsystems already excluded from this conversion — no action
needed, correctly out of scope.

Net result: one real fix applied (`selectSegment` now dispatchable), one
apparent gap explained as an architectural necessity with its function
already preserved elsewhere (`dict analysisLib`), and everything else
confirmed to be either correctly out of scope or already-known deferred
work (tasks 32/36) rather than a new missing link.

## Feature arrays made visible; broken `dict analysisLib` swapped for a stub (2026-08-02)

Two follow-up fixes, both from the user actually looking at the patch and its
Max original side by side.

**The 144 per-channel feature arrays are now visible.** The "FluCoMa
multichannel array layout bug fix" pass above (2026-08-01) deliberately made
the new mfcc/pitch/chroma/spectral/loud arrays headless ("individually
graphing 144 single-channel views wasn't going to be useful"). The user
wanted to actually see them, and separately asked why they weren't visible
next to the working `.slices`/`loud.stats` arrays — traced to exactly that
decision, not a bug. Each of the 144 was rewrapped from a bare
`#X array NAME SIZE float FLAG;` line into the proper
`#N canvas ... #X array ... #X coords ... #X restore X Y graph;` structure
(same pattern the pre-existing 36 visible arrays already used). Zero connect
renumbering needed — a bare array line and a wrapped graph block both consume
exactly 1 box index in the parent canvas, so the total box count and every
downstream `#X connect` reference stayed identical. `validate_pd.py`
confirmed: array count still 180, connect count still 379, restore count
184 (+144 from the newly-wrapped canvases), 0 structural errors.

Separately, the user asked why the Max patch shows one red `buffer~` box per
feature (e.g. `stem_vocals_mfcc.features`) while Pd needed several arrays for
the same thing. Confirmed by re-reading both files directly: Max's `buffer~`
is natively multichannel — `fluid.bufmfcc~ ... @numcoeffs 13` writes all 13
coefficients into channels of one buffer object — while Pd's `array`/graph
object is strictly single-channel, so each channel needs its own array. The
counts aren't arbitrary: pitch=2, loudness=2, spectral=7, chroma=12, mfcc=13
per stem (2+2+7+12+13=36 ×4 stems=144), matching exactly what's built.

**`dict analysisLib` swapped for `dict_stub.pd`.** The literal Max `dict`
object was still sitting in `ebys-analyze.pd`, left over from before
`bridge_sliceWriter` superseded its connection to `slice_writer.js` — Pd has
no `dict` object at all, so this would throw a "couldn't create" error on
load. Traced its exact 4 real connections in the file (read/clear/export
message boxes in, a bang out to the `loadRegistry` message box) and replaced
it 1:1 with `dict_stub.pd` (new, follows the same convention as
`getattr_stub.pd`/`dictpack_stub.pd`: absorbs the read/clear/export messages
as harmless no-ops — the file I/O they used to trigger already happens in
`bridge_sliceWriter`/`slice_writer_bridge.js` directly — and passes a bang
out so `loadRegistry` still fires downstream). Function was already preserved
elsewhere (see "Link audit" above); this fixes the literal broken placeholder
object itself. Zero renumbering needed (same inlet/outlet shape). Validated:
connect count unchanged at 379, 0 structural errors.

## Array layout re-spaced (2026-08-02)

Follow-up: "make more space in the pd patch for the arrays because now they
are piled up." Making the 144 arrays visible (previous section) packed them
into the same tight grid the FluCoMa fix had used for the (originally
invisible) per-channel arrays — only 2-4px gaps between boxes in the 4-per-
row sub-grids for mfcc/pitch/chroma/spectral/loud.features, since spacing
had been sized for headless boxes nobody was going to look at closely.
Technically non-overlapping (confirmed: 0 overlapping pairs even before this
pass) but visually cramped.

Regenerated all 180 array restore positions with a Python pass (same "only
rewrite the numeric x/y tokens on `#X restore`/row-label `#X text` lines,
box order/count/connects untouched" technique as every earlier layout pass
in this file): stem columns widened from 210px to 380px apart, per-cell gaps
widened from ~2-4px to 40-45px for the small 38×24 descriptor boxes and to
60-80px for the large 160×60 raw/mono/slices/src/ring/snap boxes, and a 90px
gap added between each feature-type row group (was a fixed 130px band
regardless of how many sub-rows a feature actually needed, which is what let
the 4-row mfcc/chroma blocks encroach on their own row's allotted space).
One stray leftover `comment` text box that would have landed inside the new,
taller layout was nudged below the whole section.

Verified: a full pairwise bounding-box scan of all 180 array boxes (using
each box's actual declared width/height from its `#X coords` line) confirms
0 overlapping pairs after the change; `validate_pd.py` reports identical
counts to before (`array` 180, `connect` 379, `restore` 184, `N_canvas` 185),
0 structural errors. `src/max/ebys-analyze.maxpat` /
`ebys-pitch.maxpat` confirmed byte-identical (mtime + size) throughout.

**Applied twice.** The first pass landed on disk, was confirmed via
`validate_pd.py`, then a re-check moments later found it gone -- the file
had reverted to the pre-fix coordinates, `msg` count had dropped 98→94 and
`text` 62→49 (the "OFFLINE ANALYSIS" header block also moved and picked up
new `info~ stem_X`/`prepend vocals`/`prepend setStemDurMs` wiring not
present a moment before), most likely a resave from a live Pd session on
top of the just-written file. Re-ran the same spacing script against the
file's new (shifted) line numbers -- same 14 row-groups, same 180 blocks,
confirmed identical before rewriting -- and this time verified the result
landed via two independent read paths (not just the one that reported
success the first time) before considering it done. `connect` count was 379
both before and after this whole back-and-forth, so nothing was structurally
lost from whatever changed the `msg`/`text` counts. Worth knowing: if
`ebys-analyze.pd` is open in Pd while edits are being made to it externally,
saving from Pd will silently overwrite those edits.

## analyze_reader.js: the file-I/O/batch half, finished (2026-08-02)

The piece flagged as "Deferred" in the "analyze_reader.js: real per-onset
descriptor extraction" section above -- `startAnalysis`/`startStem`/
`resetMemory`/`loadRegistry` and the `stream.txt` parsing/htdemucs-folder-
scanning behind them -- is now built, per the user's request to "finish the
analyze reader implementation" and give it "more outputs so I can correctly
connect the counter system." Same architecture split as before: this is
pure file-I/O + counting (no `buffer~`/array access), so it became a Node
bridge, same pattern as `slice_writer.js`.

**Two real gaps found and fixed along the way, not just the deferred
piece itself:**

1. **Audio loading was never actually implemented.** The `read <path>.wav`
   message boxes carried over from Max (wired to nothing that works) relied
   on Max's `buffer~` understanding a "read" message natively. Pd's `array`
   does not -- there is no vanilla-Pd way to load a soundfile into an array
   except `[soundfiler]`. New `stem_loader.pd` (creation arg = array name)
   builds `read -resize <path> <arrayname>` and sends it to `[soundfiler]`,
   then converts soundfiler's "frames read" float reply into a bang.
2. **The 4 `pd stereo_to_mono.<stem>` subpatches' inlets were dangling**
   (flagged earlier this session, unresolved at the time -- see the "Known
   gap" notes from the reanalysis pass). `stem_loader.pd`'s output bang is
   wired directly into the matching `stereo_to_mono` instance's inlet, so a
   successful load now automatically kicks off mono conversion, closing
   that gap as a side effect.

**`bridge/analyze_reader_bridge.js`** (Node) -- ported from `analyze_reader.js`
verbatim where the logic doesn't touch a buffer: `readStreamTxt()` (including
the label-based track-grouping bugfix already documented in the original
source's own comments -- a generated single-stem clip no longer silently
shifts every following line's assumed stem type), `startAnalysis`,
`startStem(n)` (path resolution + exact-filename skip check against
`analysis_library.json`), `resetMemory`, `loadRegistry`, and
`prepareNextTrack` (htdemucs folder scan for the next not-yet-analyzed
track, writes a fresh `stream.txt` -- exposed as an explicit command since,
same as the original, nothing calls it automatically). The registry check
(`new Dict("analysisLib").getkeys()` in the original) reads
`analysis_library.json` directly via `fs` instead -- same fix already
applied for `dict_stub.pd`/`bridge_sliceWriter`'s own registry check, since
the dict this used to query doesn't exist in Pd. `advanceCounter()` is
ported closely, with one real architectural difference: the original
advanced its counter synchronously, in-process, right after `readStem()`
finished; here the actual per-onset analysis runs asynchronously inside
`analyze_reader.pd`/`analyze_reader_stem.pd` on the Pd side, so this bridge
waits for an explicit `stemDone` message instead (see below) before
advancing. Smoke-tested end to end with a disposable OSC client: `startAnalysis`
→ correct batch/stem-count parsing from a fake `stream.txt` → `startStem 1`
→ correct path + `loadStemOut` → 4× `stemDone` → correct step-by-step
`advanceOut` firing → `all_done` on the 4th.

**`analyze_reader_stem.pd` / `analyze_reader.pd` gained a new outlet.**
`analyze_reader_stem.pd`'s outlet 1 (new) bangs right after its
`write_meta_$2` message fires -- the real "this stem's descriptors are
fully written" signal, tapped directly off the existing completion point
rather than inferred. `analyze_reader.pd`'s outlet 1 (new) fans all 4 stem
instances' outlet 1 together. This is what drives the counter now (see
"stemDone" above) -- appending both as new trailing boxes meant zero
renumbering of either file's existing connects.

**`bridge_analyzeReader.pd`** -- Pd-side OSC glue, same
`[pd packOSC]`/`[netsend -u -b]` inbound and
`[netreceive -u -b]`→`[oscparse]`→`[route]` outbound pattern as the other
three bridges, on ports 9006 (Pd→bridge)/9007 (bridge→Pd). 8 outlets,
matching the original js object's outlet numbering 1-8 (outlet 0 stays
exactly as it already was -- analyze_reader.pd's own direct patch cord to
`bridge_sliceWriter`, untouched):
outlet 1 = status (tag + args), outlet 2 = counter advance (bang), outlet 3
= nDone (float), outlet 4 = counter set (pre-formatted as a 2-atom `set N`
list, ready to feed a counter's left inlet directly), outlets 5-8 = the
file path to load for vocals/drums/bass/melody respectively. The
`/loadStemOut` OSC message carries `[stemIndex, path]` as one message;
`[route 1 2 3 4]` inside the abstraction fans it out to the 4 real outlets
by matching on the leading float and passing the remainder (the path)
through -- one object instead of 4 separate addresses.

**Wired into `ebys-analyze.pd`.** The `[counter 1 4]` object already
sitting in the LOADING section (this session found it pre-existing, not
previously connected to anything real) now drives the whole loop: its
output → `[prepend startStem]` → `bridge_analyzeReader`'s inlet;
`bridge_analyzeReader`'s outlet 2 (advance) and outlet 4 (counter set) both
feed back into the counter's own inlet 0 (bang to advance, "set N" to
reset -- same dual-use-of-one-inlet the original Max counter used, per its
own comment "'set N' on counter inlet 0 sets the current count silently").
Outlets 5-8 feed 4 new `stem_loader` instances (`stem_loader stem_vocals`
etc.), whose output bangs feed the corresponding `pd stereo_to_mono.<stem>`
instance (closing the dangling-inlet gap above).
`analyze_reader.pd`'s new outlet 1 feeds a `[msg stemDone]` → back into
`bridge_analyzeReader`'s inlet, closing the loop. Four manual message boxes
(`startAnalysis`, `loadRegistry`, `resetMemory`, `prepareNextTrack`) were
added next to the new cluster so the whole thing is triggerable by hand
without needing a control surface -- same convention as the many other
manual test message boxes already scattered through this patch. All new
boxes were appended at the end of the root canvas's box list and all new
connects reference those + the pre-existing counter/analyze_reader/
stereo_to_mono boxes by their real (scope-tracked, not guessed) indices --
zero renumbering of anything pre-existing. Validated: `obj` 210→216 (+6),
`msg` 93→98 (+5), `text` 49→50 (+1), `connect` 377→395 (+18), 0 structural
errors, `src/max/*.maxpat` confirmed byte-identical throughout.

**Correction (2026-08-02, caught by the user asking "how does the analysis
itself start, if the arrays don't output anything -- in the Max patch the
buffers bang the next buffer when each one's analysis gets done"):** the
line above was wrong. It is NOT manual. Traced the real wiring (scope-
tracked box indices, not guessed) and confirmed the user's description
exactly: each stem has its own fully automatic cascade, carried over
verbatim from Max --
`fluid.bufampslice~` -> (bng indicator) -> `fluid.bufspectralshape~` ->
`fluid.bufloudness~` -> `fluid.bufpitch~` -> `fluid.bufchroma~` ->
`fluid.bufmfcc~` -> a `readVocals`/`readMelo`/`readBass`/`readDrums`
message box -> straight into `analyze_reader`'s inlet. Every one of those
`bng` objects sitting inline is a visual completion indicator that ALSO
passes the bang to the next stage, not a button the user has to click --
confirmed identically wired for all 4 stems. The 6-stage chain was never
the gap.

**The real gap, found by tracing what feeds the FIRST stage:** each stem
has one shared `[t b]` trigger object with zero inbound connections (this
is the exact dangling-trigger gap flagged earlier this session) that fans
out to BOTH `pd stereo_to_mono.<stem>` AND `fluid.bufampslice~` in
parallel -- i.e. this one bang is meant to be what starts the ENTIRE
per-stem pipeline, mono-conversion and analysis-chain together. The
stem_loader wiring added above was connected to the WRONG point: straight
into `stereo_to_mono.<stem>`'s inlet instead of into this shared trigger.
That meant mono conversion would run, but the analysis chain (and
therefore `readVocals`/etc., and therefore the new `stemDone` signal, and
therefore the counter) would never fire. Fixed: `stem_loader`'s 4 outputs
now feed the shared `[t b]` triggers (root indices 34/88/96/103 for
vocals/drums/bass/melo) instead of the `stereo_to_mono` restores directly
-- since that trigger already fans out to both, mono-conversion still
happens exactly as before, and the analysis chain now actually starts too.
4 connect lines changed, nothing else -- `connect`/`obj`/`msg` counts
unchanged, 0 structural errors, `src/max/*.maxpat` confirmed untouched.

**One pre-existing characteristic worth knowing about, not introduced by
this session and not changed:** since the shared trigger bangs
`stereo_to_mono` and `fluid.bufampslice~` from the same outlet in parallel
(not sequentially), and `bufampslice~`'s `@source` is the `.mono` buffer
that `stereo_to_mono` is the one writing to, there's a theoretical
ordering dependency between the two branches of that fan-out. This wiring
was carried over as-is from the original Max patch (not authored this
session), so it's flagged here for awareness rather than treated as a new
bug -- worth a real listen/inspect in Pd to confirm `bufampslice~` is
reading fully-converted mono audio and not a stale/partial buffer on the
very first run.

**What's still genuinely deferred:** the counter/loader loop now drives
the entire per-stem pipeline automatically end to end (load -> mono
convert -> full FluCoMa chain -> `readX` -> real descriptor extraction ->
`stemDone` -> counter advance). What's NOT yet handled is the ring-buffer/
double-buffering composition across MULTIPLE stems loaded at once
(`buffer_manager.js`, task 32, still an unbuilt stub) -- not needed for
one-stem-at-a-time sequential analysis, only for whatever cross-stem
buffer composition `buffer_manager.js` was originally responsible for.
Outlet 1 (status) and outlet 3 (nDone) on `bridge_analyzeReader.pd` are
left unconnected in the main patch -- available to wire into whatever
display the user wants, deliberately not guessed at.

## `dict_stub`: coded for real (2026-08-02)

Follow-up to "reanalyze the patch and code the dict stub for real, cause
now its a placeholder." Pd still has no `dict`/dictionary object -- that
hasn't changed and can't (structurally absent from the language, see the
original dict_stub writeup above). What changed: the 3 real messages it
used to receive (`read <path>`, `clear`, `export <path>`) were being
silently absorbed as no-ops. They now trigger real actions on the actual
owner of the data, traced and wired concretely rather than left symbolic.

Real gap found while tracing the current wiring (scope-tracked box
indices, not guessed): `resetMemory()` already existed as a real function
in `slice_writer_bridge.js` -- wipes `analysis_library.json`, exactly what
the old Max dict's "clear" message did -- but it was never in that file's
`DISPATCH` table, so nothing could ever reach it from Pd. Added
`resetMemory: resetMemory` to `slice_writer_bridge.js`'s DISPATCH.
Smoke-tested: sending `resetMemory` over OSC to a bridge pointed at a
fixture library correctly overwrote it with `{}`.

`dict_stub.pd` rebuilt with a real `[route clear]` split instead of a flat
bang-passthrough:
- **outlet 0 ("clear" only)** now emits a real `resetMemory` message.
  Wired in the main patch to both `bridge_sliceWriter` (genuinely wipes
  the JSON file, via the DISPATCH entry just added) and
  `bridge_analyzeReader` (clears its own in-memory batch/counter/registry
  cache too -- same "clear everything" scope the original dict's "clear"
  had, just now spanning two processes instead of one in-Max dict).
- **outlet 1 (anything else -- `read`/`export`/future messages)** stays a
  bang, but is now wired to the real `loadRegistry` message box that
  already feeds `bridge_analyzeReader` (added this session for the
  counter work) instead of dead-ending at `analyze_reader.pd`, which has
  no `loadRegistry` handler and never did. `loadRegistry` reads
  `analysis_library.json` for real and sets the batch counter's start
  position from what's actually been analyzed -- a genuine "the registry
  is current" signal, not a symbolic one.

Deliberately NOT built: a live in-Pd mirror of the registry (e.g. via
cyclone's `coll`, floated as an option in this doc's "Requires the ELSE
library" section a while back). Two bridges (`bridge_sliceWriter`,
`bridge_analyzeReader`) already read `analysis_library.json` directly on
their own triggers -- a third, Pd-side copy would just be a second source
of truth that could drift from the file, which is exactly the failure mode
`saveLibrary()`'s merge-safe read-before-write logic already exists to
avoid on the write side. Forwarding to the real owners instead of building
a parallel copy keeps there being exactly one writer.

The old `read /path/to/analysis_library.json` / `clear` / `export
analysis_library.json` message boxes feeding `dict_stub`'s inlet are
untouched -- same 3 real messages as before, now landing somewhere real.
Validated: `connect` 395 -> 398 (+3, nothing else changed -- same box
count, same everything else), 0 structural errors, `src/max/*.maxpat`
confirmed byte-identical throughout.

## `dict_stub` renamed `registry_router`; `read`/`export` collapsed into `refresh` (2026-08-02)

Follow-up to "so the dict stub is also irrelevant?" -- the object itself
wasn't (something has to route "clear" one way and everything else
another way, which is real work), but 2 of its 3 upstream trigger
messages had become functionally identical dead weight: `read <path>` and
`export <path>` both ended up wired to the same action (a registry
refresh), and neither ever actually used its own path argument --
`loadRegistry()` always reads from a hardcoded, session-resolved path,
so whatever text was typed into either message box was cosmetic.

Traced what actually feeds those two message boxes before touching
anything (not guessed): the `read <path>` box is fired once automatically
by a `loadbang` at patch start -- the real "sync the counter on load"
moment. The `export <path>` box turned out NOT to be a redundant lone
button as first assumed -- it's the second half of a real, existing
`wipe memory` message box's sequence: `wipe memory` -> `[t b b]` -> (Pd
fires right-to-left) `clear` first, `export` second. That's a genuinely
sensible pairing once `export` means "refresh": wipe the file, then
immediately re-sync the counter to reflect the now-empty registry. So
collapsing both into one `refresh` action wasn't just cleanup, it's the
actually-correct behavior for the `wipe memory` button, which needed
exactly this.

Renamed both message boxes' text to `refresh` in place (dropped the
decorative path argument from each -- same 2 real triggers, no new boxes,
no deleted boxes, zero renumbering). Renamed the object itself
`dict_stub` -> `registry_router` (there's no dict-like behavior left to
name it after) and rebuilt it as `registry_router.pd`, replacing
`dict_stub.pd` (deleted, fully superseded): `[route clear refresh]`
instead of a bang-catches-everything reject path, with a genuine
`unrecognized message` print for anything that isn't one of the two real
actions -- more honest than silently treating any stray message as a
refresh. Same 2 outlets, same downstream wiring (outlet 0 -> `resetMemory`
into `bridge_sliceWriter` + `bridge_analyzeReader`, outlet 1 -> bang into
the `loadRegistry` trigger) -- nothing external needed to change.

One theoretical race worth flagging, same spirit as the
`stereo_to_mono`/`bufampslice~` parallel-trigger note above, not fixed
here: `wipe memory`'s `clear` and `refresh` both fire within the same
synchronous Pd bang chain, but land on two separate Node processes
(`bridge_sliceWriter` and `bridge_analyzeReader`) over independent UDP
sends. In practice `resetMemory()`'s file write is synchronous and
essentially instantaneous on localhost, so `refresh`'s read landing before
the wipe completes is very unlikely -- but it's two independent processes
coordinated only by Pd's send order, not by any actual acknowledgment,
so it's not impossible either.

Validated: `obj`/`msg`/`text`/`connect`/etc. counts on `ebys-analyze.pd`
completely unchanged (only message-box *text* was edited, no boxes
added/removed), 0 structural errors, `registry_router.pd` itself 0
errors, `src/max/*.maxpat` confirmed byte-identical throughout.

**Follow-up, same session:** user caught one more piece of dead wiring --
`registry_router`'s outlet 1 was ALSO still connected to the original
Max-era `loadRegistry` message box that feeds straight into
`analyze_reader.pd`. Checked `analyze_reader.pd`'s own `route` object:
it only matches `readVocals`/`readMelo`/`readBass`/`readDrums`/
`set_track_name` -- `loadRegistry` falls to its unconnected reject outlet
and goes nowhere. Leftover from before `bridge_analyzeReader` existed
(the real `loadRegistry` handler now lives there, reached via the
OTHER connection out of `registry_router`'s outlet 1, added earlier this
session). Removed the one dead `#X connect` line -- no boxes touched,
`connect` count 398 -> 397, everything else unchanged, 0 structural
errors, Max source confirmed untouched.

## Array section rebuilt as a single vertical column (2026-08-02)

Follow-up to "organize the arrays better, not side to side, put them one
below each other." The 4-stem-column grid (asked for and built earlier
this session) turned out to be the wrong shape once the 144 previously-
headless arrays became visible on top of it -- text sat above whole grids
instead of next to the one array it actually named. Clarified with the
user which parts to keep: multi-channel *channels* (mfcc's 13, chroma's
12, etc.) should stay side by side as a strip -- that grouping is genuinely
useful, comparing a feature's channels against each other. Everything else
(which stem, which feature category) should stack one per row, not sit in
a grid.

Rebuilt on that basis: 14 categories x 4 stems = 56 rows (not 180 -- one
row per stem-per-category, not one row per individual array), each row
carrying its own label (the real base array name, e.g.
`stem_vocals_mfcc.features`, not just the generic category name) directly
to the left of that row's box(es). Single-channel categories (raw stem,
mono, slices, loud.stats, src_0/1, ring_0/1, snap) get one wider box per
row (220x60). Multi-channel categories (mfcc=13, chroma=12, pitch=2,
spectral=7, loud.features=2) get their real channel count laid out as a
horizontal strip of small boxes (80x50, 15px gaps) within that single row
-- channels stay columns, stems and categories don't.

Mechanically: same box-index-preserving technique as every layout pass
this session -- rewrote each of the 180 blocks' `#X coords` (pixel
width/height only) and `#X restore` (x/y) lines in place, repositioned the
14 category header texts to sit directly above their own 4 rows instead of
above a whole grid, appended 56 NEW label text boxes (one per stem-per-
category) at the end of the root box list -- safe to append anywhere since
plain comment/text boxes carry zero connections, so this cannot disturb
any existing `#X connect` reference. Added explicit `f 290` wrap width to
all 56 new labels so array names display on one line without wrapping into
the box area next to them. The 4 old stem-column header texts
(VOCALS/MELODY/BASS/DRUMS) no longer mean anything as column headers now
that stems are rows -- repositioned into a small compact note near the top
instead of deleted (same "leave harmless leftovers rather than risk a
deletion pass" rule as everywhere else in this file); every row's own
label already states which stem it is, so nothing is lost.

Verified: a fresh pairwise bounding-box scan of all 180 array boxes (real
declared width/height, not estimated) confirms 0 overlapping pairs.
`validate_pd.py`: `text` 50 -> 106 (+56, exactly the new labels), every
other count (`obj`/`msg`/`array`/`connect`/`restore`/`N_canvas`) unchanged,
0 structural errors. `src/max/*.maxpat` confirmed byte-identical
throughout. Section is much taller now (roughly -1004 to 5166 in y) --
expected and accepted tradeoff for "one array/row-group per row, fully
readable" over compactness.

## Array vertical layout reverted, then reapplied (2026-08-02)

The single-vertical-column array rebuild described above got clobbered:
`ebys-analyze.pd` was open in Pd locally, and a save from inside Pd
overwrote the file back to an earlier disk state (the wide 4-column grid
from before the rebuild). `registry_router` and the whole analyze_reader
batch/counter cluster (bridge_analyzeReader, stem_loader x4, the
counter wiring) survived intact — only the array section's layout was
lost, confirmed by `validate_pd.py` (`text` back down to 51, `restore`
coordinates back to the old 380px-column grid) while `obj`/`msg`/`connect`
counts matched the post-registry_router state exactly.

Reapplied the same 56-row layout (14 categories x 4 stems, one row each,
channels as a left-to-right strip within the row: 80x50 boxes/15px gaps
for multichannel, 220x60 for single-channel) via the same in-place
technique as before: `#X coords`/`#X restore` numeric fields rewritten in
place for all 180 arrays (zero box-count change, zero renumbering), the
old 18 category/column-header text labels repositioned into an out-of-way
archive stack (x=9400) rather than deleted, and 56 fresh per-row labels
(real array base names, e.g. `stem_vocals_mfcc.features`) appended at the
very end of the root box list. `validate_pd.py`: `text` 51 -> 107 (+56),
every other count unchanged, 0 structural errors. `src/max/*.maxpat`
confirmed byte-identical (same mtime/size as every prior check).

**This will happen again if the patch is open in Pd when I edit the file
on disk.** Close the patch (or don't save) while I'm working, or let me
know right before you save so I can re-verify after.

## Array vertical layout undone, reverted to 4-column grid (2026-08-02)

Reverted the 56-row single-column rebuild above at your request. Array
section is back to the original wide 4-column grid (VOCALS/MELODY/BASS/
DRUMS columns, category labels down the left margin) — same
`#X coords`/`#X restore` values it had before any of today's layout work.
`validate_pd.py`: counts back to `obj` 216 / `msg` 98 / `text` 51 /
`array` 180 / `connect` 397 / `restore` 184, 0 structural errors,
byte-for-byte match against the pre-rebuild grid on a spot check.
`src/max/*.maxpat` unchanged throughout.

## `select need_stemDurs` — what it is (2026-08-02)

Traced this on request. It's the response half of a request/response loop
between `bridge_slicer.pd`/`slicer_bridge.js` and the native buffer data,
needed because the slicer bridge is a pure Node/file-I/O process with no
direct access to live `array`/`buffer~` data (same architecture rule as
`analyze_reader`'s split).

Flow: `bridge_slicer` (box 182) outlet 1 emits `need_stemDurs` when the
JS-side slicer logic needs to know a stem's duration -> `select
need_stemDurs` (box 226) traps it -> fans out through `t b b b b` (box
227, fires right-to-left) -> one bang per stem into 4 `info~` objects
already in the patch (`info~ src_0_voc/drm/bss/mel`), which report on the
corresponding buffer -> each report's relevant outlet feeds `prepend
<stem>` then `prepend setStemDurMs`, building the message `setStemDurMs
<stem> <value>` -> back into `bridge_slicer` inlet 0.

It's needed and already fully wired — nothing to fix. It's the only way
`setStemDurMs` (listed as a live slicer command in
`GUI_PARAMETER_MAPPING.md`) ever gets a real value instead of staying at
whatever default the bridge starts with.

## `info~` isn't a real object — fixed the duration-reporting instances (2026-08-02)

While tracing `need_stemDurs` further (user asked what actually triggers the
`array size`-equivalent query), found that `info~` doesn't exist anywhere in
Pd vanilla, cyclone, or ELSE — confirmed against cyclone's full object list,
ELSE's full 595-object list, and Pd vanilla's own source (`x_array.c`). Every
`info~ <name>` in this patch would fail with "couldn't create" in real Pd.

Fixed the 8 instances that report a stem's duration into the
`prepend <stem>` / `prepend setStemDurMs` chain (4 already wired into
`need_stemDurs` via `src_0_<stem>`, plus 4 more at root level querying
`stem_<name>` directly that turned out to be completely unwired — dead,
but still needed fixing since they'd throw the same instantiation error).
Replaced with vanilla `[array size <name>]` (confirmed via Pd's own source:
bang on inlet 0 outputs the array's length in samples). Since `array size`
gives raw sample count, not ms, added a shared samples->ms conversion
(`[loadbang] -> [samplerate~] -> [t f f f f]` feeding the right inlet of a
per-stem `[/ ][* 1000]` pair) instead of hardcoding a sample rate.
`validate_pd.py`: `obj` 216 -> 227 (+11 conversion objects), `connect` 397
-> 411, 0 structural errors. `src/max/*.maxpat` unchanged.

**Not yet fixed — flagged for a decision:** 4 more `info~ stem_<name>`
instances remain, nested one each inside the `stereo_to_mono.<stem>`
subpatches. These use an outlet (8) that assumed Max's real multi-outlet
`info~`, feeding a `sel 1` gate that appears to check "is this buffer
already mono, skip the downmix" before running `fluid.bufcompose~`. Pd's
`array` has no channel-count concept the same way — `stem_vocals` etc. are
declared as a single non-suffixed array (unlike the FluCoMa feature arrays,
which are split `-0`/`-1`/etc. per channel), so this check doesn't have a
direct Pd equivalent without first deciding how (or whether) genuinely
stereo stem loading is represented at all in this conversion. Left as-is
rather than guess.

## True stereo: stem_<name> split into -0/-1 channel pairs (2026-08-02)

Went with the recommended fix from the stereo-handling question above.
`stem_vocals`/`stem_melo`/`stem_bass`/`stem_drums` are now real 2-channel
array pairs (`stem_vocals-0`/`stem_vocals-1`, etc.) matching the same
`-0`/`-1`/... convention every FluCoMa multichannel feature array already
used in this patch -- `.mono` and `.slices` stay single-array (they're
already channel-reduced derivatives, not raw stereo). No FluCoMa `@source`/
`@destination` arguments anywhere else in the patch needed to change --
they already reference the basename only, and FluCoMa's Pd port resolves
that to its `-0`/`-1`/... array group automatically (confirmed against the
existing working multichannel `@features` calls).

Three follow-on changes:
- `stem_loader.pd`: `[list append \$1]` -> `[list append \$1-0 \$1-1]`, so
  the `[soundfiler]` read message now carries two array names and loads a
  real channel into each, instead of collapsing to one array (the same
  "stereo gets summed to mono on load" bug `buffer_manager.js`'s own
  comments already flagged on the Max side -- this was the Pd-side version
  of it, now fixed on both).
- The 4 `stereo_to_mono.<stem>` subpatches lost their runtime "is this
  buffer already mono" check (the broken `info~` + `sel 1` + a
  `fluid.bufselect~` shortcut path). That check made sense in Max where a
  buffer~'s channel count is only known at runtime; in Pd, declaring
  `stem_<name>-0`/`-1` makes it exactly 2 channels at patch-design time,
  so the check no longer has anything to decide -- always runs the real
  2-pass downmix (`startchan 0 bang`, `startchan 1 bang` into
  `fluid.bufcompose~ @numchans 1`).
- Array section: `stem_vocals`/etc. renamed to `-0` in place (zero
  renumbering), 4 new `-1` arrays appended and positioned next to their
  sibling in the existing "raw stem" row.

`validate_pd.py`: 0 structural errors throughout each step.
`src/max/*.maxpat` unchanged (confirmed after every edit).

## buffer_manager: native-Pd rewrite of `js buffer_manager.js` (2026-08-02)

`js_buffer_manager_stub` (an 18-outlet passthrough placeholder, same idea as
every other `js`-stub in this project) is replaced by `buffer_manager` --
renamed in place at its existing box index in `ebys-analyze.pd` (zero
renumbering) so every pre-existing connection at outlets 8-12/14-17 (the 4
ring `fluid.bufcompose~`, 4 bake `fluid.bufcompose~`, and `slot_router`) and
every inbound connection (from `bridge_slicer` and the 16 `prepend
src_done/ring_done/bake_done <stem> ...` boxes) stayed valid without
modification.

Same split used for every other `js` file in this conversion: anything that
touches live `buffer~`/array data directly stays native Pd; anything that's
pure file-lookup/session bookkeeping becomes a Node/OSC bridge.

**Native Pd side** (4 new files):
- `buffer_manager_stem.pd` -- one per-stem state machine (instantiated 4x,
  creation arg = short stem name `voc`/`drm`/`bss`/`mel`), the direct port of
  `buffer_manager.js`'s per-stem logic: `findSrc`/`loadSrc` (two-slot
  double-buffer source loading, `$0`-scoped state via `[value]`, with a
  private 2-cell `[array set/get \$0-srcSlotContents]` replacing the
  original's `slotToTrack`-style lookup -- see "info~ isn't real" below for
  why `array size`/`array set`/`array get` ended up doing a lot of the
  state-tracking work here), `triggerCompose` (frame-accurate
  `fluid.bufcompose~` ring-copy, computed from `[array size]` + the
  requested start/end fractions), `src_done`/`ring_done` (source-load and
  ring-copy completion handlers), `cycleRelease` (the commit step -- see
  sync barrier below), and `bakeSnapshot`/`bakeRestore`/`bake_done`.
  7 outlets: resolvePath, soundfiler (both channels in one read, matching
  the true-stereo fix above), ring compose, bake compose, slot_router,
  cycle-register, cycle-ready.
- `cycle_slot.pd` -- the sync-barrier building block (kept, per your
  answer to keep it rather than simplify to independent per-stem commits).
  A fixed pool of instances, each `$0`-scoped, implementing
  `buffer_manager.js`'s `cycleTracker`: `register <cid> <total>` claims a
  free pool slot (or passes through to the next slot in the chain if
  busy); `ready <cid> <stem>` is broadcast to the whole pool and only acts
  on whichever slot is tracking that `cid`; releases once `ready` count
  reaches `total` (`all_ready`) or after 250ms (`timeout`, matching the
  original's `COMMIT_TIMEOUT_MS`) -- either way frees the slot for reuse.
  4 instances are chained in `buffer_manager.pd` (one per concurrent cycle
  the sync group could need).
- `buffer_manager.pd` -- the top-level 18-outlet dispatcher: instantiates
  the 4 `buffer_manager_stem`s, the 4 `cycle_slot`s, and
  `bridge_bufferManager`; routes inbound messages by stem name and by verb
  (`sourceTrack`/`resetMemory` go straight to the bridge; `src_done`/
  `ring_done`/`bake_done`/`play`/`preload`/`stop`/`resume`/`bakeSnapshot`/
  `bakeRestore` route by stem into the matching `buffer_manager_stem`);
  retags each stem's bare `slot_router`-bound messages with that stem's
  *full* name before merging onto the single shared outlet 12 (confirmed
  by reading `slot_router.pd` itself -- its protocol is `prepare/commit/
  stop/resume <fullStemName> <rest>`, not the short names used everywhere
  else in `buffer_manager`); retags `cycle_slot`'s release broadcast with
  `cycleRelease` before fanning it to all 4 stems; retags
  `bridge_bufferManager`'s `gotPath` replies by short stem name before
  forwarding into the matching stem.

  Outlets 0-3 (previously unwired "src read" slots 0-7 in the old stub)
  are repurposed as one soundfiler-forward per stem (4, not 8 -- the
  true-stereo fix already reads both channels in a single `soundfiler`
  call per stem, so the original's apparent 2-per-stem split isn't
  needed here). Outlets 4-7 stay declared but unconnected, purely to keep
  the total outlet count at 18 so 8-17's numbering doesn't shift.

**Bridge side** (2 new files, ports `9008`/`9009`):
- `bridge_bufferManager.pd` -- same `packOSC`/`netsend`/`netreceive`/
  `oscparse`/`route` idiom as every other bridge in this project.
- `bridge/buffer_manager_bridge.js` -- owns the `slotToTrack` registry and
  `HT_PATH`/`SUFFIXES` htdemucs path construction (everything in the
  original's `loadSrc()` except the actual buffer read, which stays
  native). Smoke-tested against a fixture directory.

**A note on message protocol for `play`/`preload`/`stop`/`resume`/
`bakeSnapshot`/`bakeRestore`:** unlike `src_done`/`ring_done`/`bake_done`
(whose `"<verb> <stem> ..."` shape is confirmed by the `prepend` boxes
already wired into the old stub in `ebys-analyze.pd`), nothing currently
calls these six -- there was no existing wiring to confirm their shape
against. `buffer_manager.pd`'s dispatcher assumes the same `"<verb> <stem>
<args...>"` convention for consistency; whatever GUI/bridge component ends
up triggering playback will need to match it (or `buffer_manager.pd`'s
top-level `route` needs a small adjustment if it doesn't).

**Documented simplifications vs. the Max original** (none silent):
- No `seamlessLoop`/karma~-jump path -- there's no karma~ in this
  conversion (`slot_router.pd` drives `stem_timestretch~` instead), so the
  entire interleaving/hazard-avoidance machinery around it doesn't apply.
- No `rescheduleLive`/`resumeSeek`/`setWindow` -- `slot_router.pd` itself
  already dropped the ~25 outlets these fed (pfft~/gizmo~ pitch-formant
  and karma~ playback control, removed earlier in this conversion), so
  there's no downstream consumer for them anymore.
- `ring_done`'s defensive `src[sh].active = cp.srcSlot` re-assignment
  (redundant here -- it existed to guard against a seamless-loop
  interleaving hazard that doesn't exist without karma~).
- `preload`'s "already cached in the other slot" fast-path check was
  simplified to just "not currently loading" (preload is a performance
  hint, not a correctness path, so the cheaper check is enough).
- `srcDone`/`play`'s race handling: a `PLAY` request for a track that's
  still mid-load is handled by re-checking the requested slot against
  what actually finished loading (`$0-loadingSlot` vs `$0-pendSlot`) once
  the load completes, rather than a queue -- a second `PLAY` for a
  *different* track arriving mid-load simply overwrites the pending
  request (last-request-wins), matching a live-preview UI's expected
  behavior. `cycle_slot`'s multi-registrant path (several stems all
  calling `register` for the same `cid`) is exercised by design but, like
  everything else in this build, wasn't verified against a live Pd
  instance -- worth a real smoke test given how much of the sync barrier
  depends on trigger/broadcast ordering.

`validate_pd.py`: 0 structural errors across `buffer_manager.pd`,
`buffer_manager_stem.pd`, `cycle_slot.pd`, `bridge_bufferManager.pd`, and
`ebys-analyze.pd` after the rename (box/connect counts unchanged by the
rename itself, as expected for a content-only edit).
`src/max/*.maxpat` unchanged (confirmed after every edit, throughout).

## Removed the 4 dead `array size stem_vocals/melo/bass/drums` boxes (2026-08-02)

These were 4 of the 12 broken `info~` instances found earlier (see "info~
isn't a real object" above) -- swapped to `array size` just to stop
"couldn't create" errors, but never wired to anything (confirmed zero
connections either direction). Per your call, deleted outright rather than
left as inert placeholders. Since they had no connections, this was a
clean removal: dropped the 4 `#X obj` lines and remapped every root-level
box index above each deleted one (and every `#X connect` referencing
those indices) down accordingly. `obj` count: 211 -> 207, everything else
unchanged. `validate_pd.py`: 0 structural errors. `src/max/*.maxpat`
unchanged.

## Layer / transition scoring modes (2026-08-02)

Added two playback modes for the training-preview delay/next-segment
mechanism, on request: **layer mode** (freeze a stem on one segment,
looping identically until you decide to move on) and **transition mode**
(alternate between two locked segments — a start and an end — so a
transition can be auditioned on repeat, with independent control over
each side).

Almost all of this reused existing machinery in `slicer_bridge.js` rather
than needing new playback logic: `loopState`/`next()`'s delay-driven
replay already gave exact-same-segment looping (that's what layer mode
*is*), and `loop(track, bars)`/`skip(track)`/`TRIGGER_MODE` already
existed as dispatchable commands. What was actually missing was (a) a
second, alternating flavor of the same lock-and-replay mechanism for
transition mode, and (b) Pd-side buttons to drive it.

**`slicer_bridge.js` changes:**
- Extracted `loop()`'s segment-selection logic (agent-mode-filtered pool,
  scored pick if criteria are active, random otherwise, accumulate slices
  until `bars` worth of material is covered) into a new
  `pickLoopWindow(track, bars)` helper, so it can be reused for both sides
  of a transition without duplicating it. `loop()` itself is now a thin
  wrapper: pick a window, store it in `loopState`, clear any
  `transitionState`.
- New `transitionState = { vocals: null, melody: null, bass: null, drums:
  null }`, each either `null` or `{ segA, segB, phase: 'A'|'B', bars }`.
  Mutually exclusive with `loopState` by construction — entering one mode
  clears the other.
- `next(track)` gained a `transitionState` branch (checked before
  `loopState`, mirroring its structure almost exactly): dispatches
  whichever of `segA`/`segB` matches the current `phase`, then flips
  `phase` for the next delay cycle — giving A, B, A, B, ... on the
  existing auto-advance timer, each side sample-identical to its last
  play until explicitly re-picked.
- New commands (all added to `DISPATCH`, same "Pd sends the exact command
  name" convention every other command already uses):
  - `setPlaybackMode <stem> layer|transition` — the per-stem mode toggle.
    Switching modes always picks a fresh segment (or pair) for whichever
    mode is now active.
  - `skipLayer <stem|all>` — layer mode's skip: re-anchor to a freshly
    picked segment, keep looping it. Works whether or not the stem was
    already looping.
  - `skipTransitionStart <stem|all>` / `skipTransitionEnd <stem|all>` —
    transition mode's two independent skips: re-pick just `segA` or just
    `segB`, leaving the other side untouched. No-ops (with a console post)
    on any stem that isn't currently in transition mode.
  - All four follow the existing `forceNext`/`returnToBase` "stemOrAll"
    convention (bare or `'all'` = every unlocked stem).
- `unloop()` now also clears `transitionState`, and `forceNextOne()` now
  also clears it before forcing a fresh pick — both previously only knew
  about `loopState`.
- Source-locked followers refuse layer/transition mode with the same
  reasoning `loop()` already used (would ignore the lock's source-track
  restriction) — unlock first if you want to loop/transition-score a
  locked stem independently.

**`ebys-analyze.pd` changes:** 23 new message boxes in a new "LAYER /
TRANSITION SCORING MODES" section next to the existing training-playback
delay/`next <stem>` boxes — click-to-fire, same as the existing `next
bass` etc. boxes (Pd message boxes are directly clickable in run mode, no
`bng` needed). Per stem (vocals/melody/bass/drums): a `setPlaybackMode
<stem> layer` and `...transition` pair, a `skipLayer <stem>`, a
`skipTransitionStart <stem>`, and a `skipTransitionEnd <stem>` — plus one
`all` variant of each of the three skip commands. All wired straight into
`bridge_slicer`'s existing inlet 0 (same box, same pattern as the
pre-existing `next <stem>` message boxes) — confirmed via
`bridge_slicer.pd`'s own `[pd packOSC]`, which treats any message's
selector as the OSC address generically, no whitelist, so no bridge-side
change was needed for the new command names to reach `slicer_bridge.js`.

`node -c slicer_bridge.js`: syntax OK. `validate_pd.py`: 0 structural
errors. `src/max/*.maxpat` unchanged. Not exercised against a live Pd
instance — same caveat as the rest of this session's work — worth a real
smoke test, especially the phase-alternation in `next()`'s new branch.

## $-substitution bug found and fixed across cycle_slot.pd and buffer_manager_stem.pd (2026-08-03)

While fixing the slot_router integration gap (see below), a bug in how
`buffer_manager_stem.pd` was originally generated came to light: it used
`\$1`/`\$0` (backslash-escaped) throughout, on the theory that escaping
"protects" a dollar-sign for later/runtime substitution. That theory is
wrong. Pd's backslash is a **generic literal-character escape** (same
mechanism used to escape space/comma/semicolon) — confirmed against Pd's
own documentation. An escaped `\$1` is a literal, inert, never-substituted
two-character string `$1`, in both message boxes and object boxes.

The two real substitution mechanisms are separate and neither one wants
escaping:
- **Object box** creation arguments (`$1`, `$0`, bare/unescaped) substitute
  from the abstraction's own creation arguments/instance counter, once, at
  load/instantiation time.
- **Message box** `$1` (bare/unescaped) substitutes from the box's own
  *incoming* runtime message — never from the enclosing abstraction's
  creation args. A message box has no way to reach creation args at all,
  escaped or not; the standard workaround is to resolve the value in an
  object box first (`[symbol foo_$1]`, `[list prepend $1]`, etc.) and feed
  that into the message construction at runtime.

This was silently broken in two places:

- **`cycle_slot.pd`**: 13 `[value \$0-cid]`/`\$0-total`/`\$0-ready` object
  boxes used escaped `\$0`. Since escaping makes it literal, every pooled
  `cycle_slot` instance was actually creating/reading the same three
  globally-shared `value` stores (literally named `$0-cid` etc., not
  instance-scoped) instead of isolated per-instance state — defeating the
  entire point of the sync-barrier pool. Fixed by removing the backslash
  (`\$0-cid` → `$0-cid`) on all 13 occurrences.
- **`buffer_manager_stem.pd`**: 26 message boxes used escaped `\$1` inside
  message boxes to try to embed the stem's own name (e.g.
  `destination ring_0_\$1`), which can never work in a message box
  regardless of escaping. All 126 `value`/`array set`/`array get` object
  boxes elsewhere in the same file also used escaped `\$0`, which is the
  same cycle_slot.pd bug — silently broken per-instance state throughout.

## buffer_manager_stem.pd rewritten (2026-08-03)

The original generator script (`gen_stem.py`/`state.py`) was lost between
sessions, so per your call, it was rewritten from scratch as a new
generator (`fix_buffer_manager_stem.py`) that parses the existing
(buggy) file into a box/connect graph and programmatically rebuilds it,
rather than hand-patching 26+126 individual lines. Net changes:

- All `\$1` message-box constructions (source/destination/prepare/ready)
  replaced with the correct object-box pattern: `[symbol <suffix>_$1]`
  (bare, resolves at creation time) → `[list prepend <verb>]`, preserving
  identical upstream/downstream wiring.
- All 126 `\$0`-escaped `value`/`array set`/`array get` object boxes fixed
  to bare `$0` (same fix as cycle_slot.pd).
- The RINGDONE handler's "prepare" dispatch (formerly ~31 boxes, boxes
  277–307 in the old numbering) had a second, independent bug beyond the
  $-escaping: it built `[pack f f]` from the committed stretch/segment
  values but then fed that into a message box whose text never referenced
  the packed values at all — so `segDurMs`/`stretchRatio` were silently
  **dropped**, never actually sent onward. It also fired the resulting
  (broken) "prepare ring_X_$1" message **twice** per RINGDONE event
  (duplicate branches for both `ring_0` and `ring_1`, wired to the same
  outlet). This whole region was rebuilt as ~11 boxes with corrected
  sequencing (cold values set before the hot trigger fires) that sends a
  single, correct `prepare <ringIndex 0|1> <segDurMs> <stretchRatio>`
  message — matching `slot_router_stem.pd`'s existing `unpack f f f`
  exactly (it already documents "ringSlot is intentionally
  ignored/dead-ended", so no symbol/buffer-name payload is needed there,
  just the float).
- Net box count: 397 → 399 (the RINGDONE simplification removed ~20 more
  boxes than the per-bug object-box replacements added).
- Structurally validated (`validate_pd.py`): 0 errors, all connect indices
  in range, no duplicate/dangling connects.

`slot_router_stem.pd` was re-audited against the corrected message shape:
no changes needed — its `unpack f f f` already matches what
`buffer_manager_stem.pd` now actually sends. (A suspected missing
"start the delay countdown" wire was investigated and found to be a
mis-read on my part, not a real bug — outlet0 already fans out to both the
`play` message and the delay-start outlet; reverted that speculative
edit.)

`ebys-analyze.pd`'s 4 `stem_timestretch~` instances (lines ~1311–1317)
were retargeted from stale `stem_vocals`/`stem_melo`/`stem_bass`/
`stem_drums` (arrays that stopped existing once the raw stems were split
into true stereo `-0`/`-1` pairs) to the correct current mono arrays:
`stem_vocals.mono`, `stem_melo.mono`, `stem_bass.mono`, `stem_drums.mono`
— matching `slot_router_stem.pd`'s own documented current behavior
("always plays the stem's raw full buffer", not yet a ring-buffer
segment — the ring double-buffer compose pipeline in
`buffer_manager_stem.pd` is now internally correct and fires proper
`prepare` messages, but wiring an actual ring-buffer segment into
playback would additionally require `stem_timestretch~`/`timeStretch~` to
accept a dynamic per-play array name instead of the current fixed
creation-arg array. `timeStretch~`'s real "play" message protocol *does*
support a dynamic per-call table name — `[voice, tablename, samplerate,
duration, gain, transpo, onsetDur, release%]` — so that upgrade is
possible later, just not done in this pass since the current wrapper
(`stem_timestretch~.pd`) was built around a fixed array-per-instance and
changing that is a separate, bigger piece of work).

Not exercised against a live Pd instance — same caveat as the rest of
this project. Worth a real smoke test, especially: cycle_slot.pd's
sync-barrier isolation (previously silently broken, likely never
exercised correctly before), and the RINGDONE→prepare→slot_router chain
end-to-end.

## Suggested next steps

1. Install ELSE and FluCoMa via Deken — this alone should clear the large
   majority of remaining "couldn't create" messages from your log.
2. Re-open `ebys-analyze.pd` and paste any NEW error output — I don't have a
   Pd binary available in this environment to test against directly, so this
   fix pass was done from your log plus Pd's published object reference, not
   verified end-to-end. Some things may need another round. The
   `buffer_manager` rewrite above is the largest untested piece in this
   project -- its per-stem state machine, sync barrier, and top-level
   dispatcher were all built and structurally validated without a live Pd
   instance, so it's the first place to look if something misbehaves.
3. Start the bridges alongside Pd (5 total now): `analyze_reader_bridge.js`
   (9006/9007), `slice_writer_bridge.js`, `slicer_bridge.js` (9004/9005),
   `stream_watcher` (9001), and `buffer_manager_bridge.js` (9008/9009,
   `node bridge/buffer_manager_bridge.js --data-dir /path/to/EBYS/data`).
   With `buffer_manager` now built, every subsystem flagged as a stub
   earlier in this document is either done or intentionally dropped.
