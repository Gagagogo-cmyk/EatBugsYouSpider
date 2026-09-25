# Gnumbat plugin (JUCE 8: VST3 + Standalone)

One interface into the shared core. The plugin is a **transparent pass-through** that keeps a rolling capture ring;
it writes Bakes into the library folder and queues jobs. It never does heavy work itself; the Python worker
(`../core`) does stems, analysis and the Bake Map. If no worker is running the Bake Bank still works.

## Licence: decide before you ship

JUCE 8 is **AGPLv3 or commercial**. Building this for yourself is fine. Distributing binaries to others requires
either releasing the plugin under AGPLv3 or buying a JUCE commercial licence. The JUCE splash screen is not
suppressed in this project. Nothing here has been checked against your JUCE licence tier.

## Build

```bash
cd src/plugin
cmake -S . -B build -DGNUMBAT_JUCE_DIR=/path/to/JUCE   # or omit it: JUCE 8.0.15 is fetched
cmake --build build -j
ctest --test-dir build --output-on-failure              # plugin, capture, core (conformance vs ../core/conformance)
```

Products land in `build/GnumbatPlugin_artefacts/<config>/{VST3,Standalone}`. Linux needs the usual JUCE
dependencies (ALSA, X11, freetype, fontconfig, GL). Only **Linux (VST3 + Standalone) has been built**; macOS,
Windows and AU are untried. Tests need a display: `xvfb-run -a ctest ...` on a headless box.

Other targets: `gnumbat_capture_tests` has no JUCE dependency, so build it with `-fsanitize=thread` to stress the ring.
`gnumbat_plugin_tests --snapshot <dir> <library>` renders PNGs of the UI, and `tests/run_interop.py` checks that
Bakes written by C++ validate against the Python schemas and are processed by the Python worker.

## Use

1. Put the plugin on a track or bus. It shows host name, tempo, position and input meters.
2. Pick a mode: **RANGE** (IN/OUT markers; type bar|beat or SET IN/OUT at the playhead), **LAST BARS**, **LOOP**
   (host loop points), **LAST SEC**. A plugin cannot render the timeline, so **play the range through once**
   (or bounce offline). The coverage bar shows how much of the range was actually heard; several passes and loop wraps
   assemble correctly.
3. **BAKE**: the audio is copied out of the ring at that moment, then a notation card opens. Type anything or nothing;
   it is stored exactly as typed. A vocabulary profile (optional) only derives tags/fields for filtering.
4. The Bake is written on a background thread, then the worker (auto-started unless disabled) makes stems, analysis and
   the map -- Demucs, madmom (downbeat/meter/BPM) and Essentia (genre) each run as their own external tool, wrapping the
   scripts in `../demucs/` rather than reimplementing them (optional: only if a `madmom`/`essentia` interpreter is
   configured in settings.json). No separate worker-status widget: select the Bake being processed and its PIPELINE
   panel shows demucs/flucoma/madmom/essentia each as their own live percentage. madmom/essentia results are always
   just suggestions -- marked with a `~`, never written over a tempo/key the DAW or you already gave, and genre in
   particular is never auto-filled: it's 100% a field you set yourself. (`[Brackets]` mean something else in this UI:
   which of a set of options -- e.g. the BANK/MAP tabs -- is currently selected.)
5. **EBYS**: Gnumbat lives inside the EBYS repo (`<EBYS>/src/plugin`), so it is linked to it de facto -- no folder to
   choose, nothing to unlink. Every Bake's audio is written to the instrument's active session's `raw_uploads/` so its
   existing Demucs + FluCoMa pipeline processes it too; the Bank shows `EBYS...` until its stems are adopted. The
   notation card's stem choice `auto (EBYS instrument)` does this; picking `demucs`/`testsplit` or unchecking stems
   does not. (`GNUMBAT_EBYS_ROOT` or `settings.ebys_root` override the compiled-in repo path, e.g. for a dev build.)
6. **IMPORT** (the bordered square next to BAKE) or drop audio files anywhere on the window to Bake existing audio
   (that is the whole workflow of the Standalone).
7. **BANK**: search, filter chips and a builder for any field in the library, sort, multi-select, context menu
   (tag, group, field, dataset, select related, reprocess, reveal, delete with undo). **MAP**: pick a feature space and
   method, COMPUTE, zoom/pan, hover, click, drag a rectangle to select, colour by tag. The footer states which feature
   space the projection shows and that it is not a musical similarity measure.
8. Dragging a Bake out of the Bank hands the host its WAV file (hosts that support external file drops).

Settings, notation profiles and worker options: see `../core/README.md`. Environment overrides: `GNUMBAT_LIBRARY`,
`GNUMBAT_SETTINGS`, `GNUMBAT_HOME`, `GNUMBAT_AUTOSTART=0`.

## Realtime rules (kept by the code, checked by tests where possible)

The audio thread only copies into a pre-allocated ring and updates atomics: no allocation, locks, logging or I/O.
`prepareToPlay` rebuilds the ring only if sample rate, channel count or ring length changed. Dialogs are drawn
inside the plugin window (no OS windows). Plugin state stores UI/session choices only, never Bake data.

## Known limits

- The hand-off has only been tested against a simulated watcher: the real `watch_demucs.py`, Demucs and Max/Pd have not run on it.
- Never loaded in a real DAW; only a fake playhead was used. Hosts differ on `PositionInfo`, chooser dialogs, external drags.
- Loop-edge accuracy assumes constant tempo between the loop points.
- Windows worker launch and quoting are untested. POSIX quoting is unit-tested.
- The ring's seqlock validation uses `atomic_thread_fence`, which ThreadSanitizer does not model, so a clean TSan run
  is weaker evidence than it looks; review `CaptureBuffer.cpp` by hand before trusting it in a shipped product.
