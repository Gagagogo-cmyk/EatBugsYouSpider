# EBYS — Max → Pure Data Migration Plan

Status: **not started — zero `.pd` files exist anywhere in the project as of this writing.** Deadline per `CHANGELOG.md` is Aug 8. Worth an honest read of scope before committing to that date, because the patch turned out bigger than `ARCHITECTURE.md` documents.

---

## 1. Reality check

`ARCHITECTURE.md` describes the FluCoMa analysis chain, `karma~` playback, and `pfft~`/`gizmo~` pitch shift. The actual `src/max/` directory has grown well past that since the doc was last updated — there's a 3-band EQ router (`eq_router.js`, biquad chain per stem), a spatialization/FX router with quad joystick panning (`spat_fx_router.js`), per-stem frequency-band masking (`band_mask_init.js`), and — this is the important one — the pitch shifter isn't a single black-box object. `ebys-pitch.maxpat` is a custom formant-preserving phase vocoder, built from raw FFT primitives (`fft~`, `cartopol~`, `poltocar~`, `log~`) with real-cepstrum liftering to separate pitch from formant envelope, per `formant_lifter_init.js`'s own comments.

That last part is actually better news than it sounds: a custom chain built from FFT primitives is more portable than a proprietary object would be, because Pd has equivalent primitives — there's real work in re-wiring it, but not a "no equivalent exists" wall the way there would be for something like Max's `gizmo~` used directly. Confirmed by a quick search: there's no drop-in vanilla-Pd `gizmo~`, but that's not what you're actually using — you built your own from parts Pd also has.

Given none of this has started and the patch is larger than documented, treating Aug 8 as "everything ported" is not realistic. Treating it as "the core proven and working, the rest sequenced after" is.

---

## 2. Tighten first, then port

Before anything gets converted, clean up what's there — porting dead weight wastes the time this deadline doesn't have.

- **Archive the backup pile.** `src/max/` has ~25 `.bak*`/`.pre-*` files sitting alongside the live patch, some over 800KB. Move them into the existing `archive/` folder. They're history, not working state, and they make it harder to see what's actually current.
- **Drop the already-flagged dead objects.** `ARCHITECTURE.md`'s own "Deprecated / Legacy JS Objects" table lists `stretch_player.js`, `track_loader.js`, `asset_id.js`, `bpm_from_tempogram.js`, `stems.js` (a stub), `classifier.js` (legacy) as superseded or unused. Don't port them.
- **Inventory what's left, honestly.** One pass through `ebys-analyze.maxpat` and `ebys-pitch.maxpat` to confirm the actual current object list matches what's below — the patch has been edited by `patch_*.py` scripts many times since `ARCHITECTURE.md` was written, so verify rather than trust the doc.

---

## 3. The orchestration layer doesn't get ported — it moves out

This is the part worth being clear on early, because it changes what "porting" even means here. Max's `node.script` objects (`ws_server.js`, `slicer.js`, `buffer_manager.js`, `slot_router.js`, `ms_router.js`, `cricket.js`, etc.) run *inside* the Max process via Node for Max. Pd has no equivalent — there's no way to run those same JS files inside vanilla Pd.

`ARCHITECTURE.md`'s own migration note already points at the right answer: this logic doesn't get rewritten in Pd's patching language — it moves to run as external processes (Node, same as today, or migrated into the Python side where it makes sense), talking to Pd over OSC/UDP (`netsend~`/`netreceive~`, or an OSC library) instead of living inside the patch. Pd becomes a thinner thing: an audio engine that receives control messages over the network and renders sound — the sequencing brain lives outside it, same as it will for the VST's headless analysis service. This is the same shape both migrations need, which is worth knowing — get the OSC bridge working once, it serves the live instrument and the VST's `libpd` analysis service both.

---

## 4. Priority order

**Tier 1 — must exist by Aug 8. This is what "0.3" should actually mean.**
Core signal path (`karma~`-equivalent variable-speed playback, buffer architecture) + the FluCoMa analysis chain, proven working headless. This is also exactly what Step 4 of the VST plan depends on (`libpd` running FluCoMa correctly) — porting this first serves both roadmaps at once, not just this one.

**Tier 2 — next, not blocking.**
EQ router (3-band biquad per stem) and basic M/S/pan. Mechanical, well-understood DSP math, lower risk than Tier 3.

**Tier 3 — real work, budget real time.**
The formant-preserving pitch shifter (rebuild the FFT/cepstral-lifter chain from Pd's own primitives — confirm what's available in your current Pd external ecosystem before assuming a specific object), spatial joystick quad-panning, per-stem band masking.

**Recommendation:** if Aug 8 arrives and Tier 1 is solid but 2/3 aren't, that's a legitimate place to call 0.3 done and keep going — a working core with EQ/pitch/spatial still on Max for a bit longer beats a rushed, broken full port. Nothing about the VST plan or the hardware conversation depends on Tiers 2/3 being finished on any particular date.

---

## 5. First concrete actions

1. Archive the `.bak*` pile and the already-flagged dead JS objects.
2. Confirm current object inventory in both `.maxpat` files against this doc — don't assume, check.
3. Stand up the OSC bridge (Pd side: `netreceive~`/`netsend~` or an OSC external; external-process side: whatever currently posts to `ws_server.js`) as its own small proof before touching DSP porting.
4. Port Tier 1 (signal path + FluCoMa), validate FluCoMa's Pd externals run correctly — this is the same validation the VST roadmap's Step 4 needs, so it only has to happen once.
