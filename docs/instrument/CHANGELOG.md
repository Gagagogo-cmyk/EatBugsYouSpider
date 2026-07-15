# EBYS Changelog

EBYS — Eat Bugs You Spider
Generative audio collage engine. Separates songs into stems, analyzes every transient slice, and plays them back in real time using spectral descriptors.

---

## 0.1.18 — 2026-07-10

### Multi-session support (login screen + per-session data isolation)

- **New: session picker / login screen.** `node sdj-tui.js` now launches a blessed-based login screen first — list existing sessions, create new ones (name + optional password), unlock password-protected ones, delete a session from the list (data is kept on disk, only the registry entry is removed). Once a session is chosen it hands off to the real TUI (moved to `src/tui/app.js`) via `require('./app.js')`, which re-derives every data path from the chosen session. Sessions can be open (no password) or password-protected (Node's built-in `crypto.scryptSync` with a random per-session salt — no plaintext storage, no extra dependencies).
- **New: `:switchSession` / `:logout` TUI command.** Destroys the running TUI's blessed screen (restoring the terminal) and respawns `sdj-tui.js` fresh in the same terminal, landing back on the login screen — avoids trying to hot-swap the dozens of paths/DBs/caches derived from the active session in-process, which would have been a much larger source of subtle bugs than a clean respawn.
- **New: `src/tui/session_manager.js`.** Owns the session registry (`data/sessions.json`), the active-session pointer (`data/current_session.txt`, a single line read by every layer below), and one-time migration of a pre-session install's existing data into `data/sessions/default/` (including three files `ws_server.js` had always written to `src/max/` instead of `data/` — `ebys_index.json`, `stem_ranges.json`, `umap_coords.json` — folding a long-standing path leak into the same migration).
- **Every layer now resolves its data directory from the active session:**
  - `src/tui/app.js` (the TUI) — analysis library, genre/beats DBs, stems dir, stream.txt, umap/ranges caches, and `:resetAll`'s wipe target all scope to `data/sessions/<id>/`, resolved once at process start (a fresh process per login/switch, so this is safe to cache).
  - `src/max/ws_server.js` — same set of paths, but resolved **fresh on every read/write** (`sessionDataDir()`), not cached, since this is a long-running process spawned once by Max's `node.script` that outlives any single TUI session.
  - `src/max/analyze_reader.js`, `slice_writer.js`, `streamWatcher.js` — Max `js`-object equivalent: a new `getSessionId()` reads `data/current_session.txt` via Max's own `File` API (no Node `fs` available in this scripting context) and layers `sessions/<id>/` onto the existing patch-relative data-dir resolution. `streamWatcher.js` additionally resets its change-detection baseline when it notices the session id itself changed, so a same-content-by-coincidence stream.txt across two sessions still triggers a bang.
  - `src/demucs/watch_demucs.py` — `raw_uploads/` stays a single **global** drop-zone (watchdog needs one stable folder to watch, and it's a reasonable model: whichever session is active when a file is picked up gets it); stems/temp output now resolves to `data/sessions/<id>/`, re-read at the start of every `process_file()` call so a session switch mid-run redirects the *next* file without restarting the watcher. `genre_tagger.py`/`madmom_tagger.py` didn't need code changes for their own I/O (both already take `--htdemucs-root`/`--out` as CLI args, which their callers now pass session-scoped) but their `find_original_mix()` fallback search paths were recalculated — they walk a fixed number of `..` levels up from the stems folder to find `raw_uploads/`/`temp/`, which shifted by one level now that stems live one directory deeper (`data/sessions/<id>/stems/...` vs. the old `data/stems/...`).
- **Known limitation:** switching sessions in the TUI does not currently force Max to flush its in-memory registries (`dict analysisLib`, the loaded slicer state) — those are only populated at patch load / loadbang. All *disk* reads and writes correctly follow the newly active session immediately, but for Max's live in-memory state to fully catch up to a switched session, restart the Max patch (or run `:resetMemory` then re-run analysis) after `:switchSession`. A live in-Max reload-on-switch signal is a reasonable follow-up but wasn't built in this pass.

## 0.1.17 — 2026-07-10

### FluCoMa descriptor pipeline fixes

- **Root cause of duplicated descriptors (C==S, M0==M1 in every slice) — Max's JS `Buffer.peek()` takes a 1-based channel argument, not 0-based.** `analyze_reader.js` read every FluCoMa feature buffer (spectral shape, MFCC, chroma, pitch, loudness, onsets) with 0-based channel indices. Channel `0` silently aliased to the real channel 1, so "channel 0" and "channel 1" requests returned identical data, and every higher index read one real channel early (e.g. what was assumed to be flatness was actually rolloff) — the true last channel of each buffer (crest, MFCC coeff 12, chroma pitch-class 12) was never read at all. Fixed every `peek()` call file-wide to use 1-based channel indices.
- **`stemsReady` dead trigger** — `ws_server.js` sent `Max.outlet('stemsReady')` after Demucs/madmom finished, but nothing in the Max patch or codebase was named `stemsReady`; FluCoMa analysis never auto-started for fresh uploads. Rewired to reuse the working `startAnalysis` trigger.
- **`streamWatcher.js` swallowed the trigger on Max restart** — its first poll after every patch load silently adopted whatever was already in `stream.txt` as a "baseline" without banging, so any track processed while Max was closed (or during a restart to pick up other fixes) never triggered FluCoMa. Now bangs on the first read too; safe, since `analyze_reader.js` already fast-skips already-analyzed stems.
- **`:analyzeAll` dead-ended at `slicer.js`** — the WS command reused the same `startAnalysis` string but had no route into `analyze_reader.js`, only into `slicer.js`'s reject path (`no function startAnalysis [slicer.js]`). Added a dedicated `route startAnalysis` wire straight into `analyze_reader.js` — first attempt wired `route`'s matched outlet directly into `analyze_reader.js`, but `route` strips the matched selector and outputs a bare bang when there are no extra arguments, which `analyze_reader.js` has no handler for (`no function bang [analyze_reader.js]`). Fixed by inserting a `prepend startAnalysis` box in between (same pattern already used for `resetMemory` elsewhere in the patch) to reconstruct the message before it reaches `analyze_reader.js`.
- **Vocals-only stereo-source bug** — `fluid.bufspectralshape~` for the vocals stem sourced from the raw (stereo) `stem_vocals` buffer instead of `stem_vocals.mono` like every other stem, doubling its feature buffer to 14 channels. Fixed to match.
- **`resetMemory()` didn't clear the run-state guard** — a stuck analysis run left `analysisActive` permanently `true`, silently blocking all future analysis starts even after a reset. Now resets the guard too.
- **`clear` before every `read`** — `analyze_reader.js`'s `startStem()` now sends `clear` to each stem's buffer before `read`, so re-analyzing the same on-disk file (e.g. via `:resetMemory`, which reuses existing stems unlike `:resetAll`) is guaranteed to be treated as a genuinely fresh load.
- **`analysisDone` lost on TUI reconnect ("stuck at 95%" even after a fully successful analysis)** — if `ws_server.js` restarts or the TUI reconnects around the same time a real analysis finishes, the one-shot `analysisDone` broadcast fires into a socket that either isn't open yet or has already been replaced, and is lost forever — the TUI spinner then just sits until its 5-minute safety timeout, even though the backend genuinely completed (confirmed: all 4 stems analyzed, index built, in the same session). `ws_server.js` already pre-sets `state.analysisDone` from disk on startup but never told a (re)connecting client. Added a side-effect-free `analysisAlreadyDone` notice sent only on connect when `state.analysisDone` is already true, which stops a spinner that's actively waiting without re-triggering `add_tension.py`/`buildIndex` — deliberately kept separate from the real `analysisDone` message, which was intentionally suppressed on reconnect in the past to avoid a double-buildIndex bug.

## 0.1.16 — 2026-07-09

### Stereo audio signal path overhaul

- **`buffer_manager.js` mono-load bug** — stems were being loaded into karma~ as mono, silently discarding one channel before any width/pan processing could act on it. Fixed the load call to pull both channels; added a `clip~` safety net downstream and corrected fader defaults.
- **`spat_fx_router.js` was never live (major discovery)** — the spatial/FX router module existed but was never actually wired into the signal path, so every width/pan/FX command from the TUI was a no-op all along. Wired it in; added sane pass-through defaults for width and pan so audio is unaffected until a command changes them.
- **Width remap** — width parameter renormalized so `0.5` = the source's original recorded stereo width, instead of an arbitrary internal scale.
- **karma~ mono channel-count bug (the single biggest bug of the session)** — karma~ objects were configured for mono channel count, collapsing stereo content throughout playback regardless of upstream fixes. Corrected channel count end to end.
- **Real M/S stereo** — replaced the old Haas-delay stereo-widening trick with true mid/side encode-widen-decode, giving artifact-free width control.
- **FX sends now stereo + post-width** — sends had been tapped mono and pre-width; moved the tap point to stereo, after the width stage, so the FX return matches what's actually being heard.
- **`monoSend` feature** — new option to force a mono downmix specifically for the FX send path, independent of the main stereo output.

## 0.1.15 — 2026-07-09

### Lock-sync / sync-barrier work

- **Locked-follower desync (multiple rounds)** — `applyNow`, `setSegmentBars`, and `next()` were each able to advance a locked follower stem independently of its leader, drifting the two out of sync. Closed each path one at a time as they were found; `lockSource` was fixed to correctly cascade to *all* followers, not just the first.
- **Absolute-time fraction mismatch** — leader and follower were computing their shared position fraction against different absolute-time bases, causing a subtle drift that only showed up over long sessions. Fixed the fraction math to share one clock; added a width-master alias and removed dead code left over from earlier lock-sync attempts.
- **Progress-bar freeze under drift** — investigating the drift above surfaced a case where the progress bar could freeze entirely; added a watchdog that detects a stalled bar and force-refreshes it.
- **Two-phase prepare/commit sync barrier (architectural centerpiece)** — replaced the ad-hoc "just fire both" advance logic with a proper two-phase barrier: all locked stems prepare their next segment first, then commit together on the same tick. This is the actual fix underneath all the desync symptoms above.
- **STAY overshoot gap + self-pull duplicate dispatch** — two bugs found while hardening the barrier: STAY continuation could leave a small time gap at a segment boundary, and a locked stem could end up pulling from itself and double-dispatching identical audio. Both fixed.
- **Barrier was silently a no-op** — a stale `cycleId` guard meant the two-phase barrier above was being skipped entirely without any error. Fixed the guard; also added a last-touched-stem whitelist so barrier commits only affect stems that actually need it.

## 0.1.14 — 2026-07-09

### Slicing / segment-selection correctness

- **Stay-continuation and short-tail fixes + speculative preload** — the original STAY logic could pick a bad continuation point when a segment tail was very short; added short-tail handling and speculative preloading of the likely-next slice to hide load latency.
- **Short-tail delay wrong time domain** — a follow-up fix: the short-tail delay timer had been computed in the wrong time domain (audio-content fraction instead of wall-clock ms), causing mistimed advances.
- **`PLAY_FULL_FILE` default + `:skip` command** — added a default mode that plays full source files rather than always slicing, plus a manual `:skip` command; a fresh pick in full-file mode now correctly starts at file start rather than mid-file.
- **Commands no longer cut off audio** — TUI commands were interrupting in-flight audio; fixed so commands apply cleanly at the next natural boundary instead of hard-cutting.
- **STAY end-of-file wrap** — added diagnostic logging distinguishing normal forward continuation, wrap-to-start-of-track, and the rare fully-lost-track fallback.
- **"At or after" permanent-skip bug (root cause + fix)** — STAY's search for the next slice used "start time at or after `lastEndFrac`," which let it silently skip forward past unindexed audio whenever `lastEndFrac` didn't land exactly on a real slice boundary — introduced when segment end-points were anchored to bar-exact math instead of actual consumed-slice length. Fixed at the source: `buildIndex()` now splits any slice that a measured downbeat falls inside, guaranteeing a real slice boundary exists on every downbeat, so "at or after" always resolves to an exact match. Also fixed `MAX_SLICES_PER_STEM` capping to preserve these new downbeat-synthesized slices instead of discarding them under the count cap.

## 0.1.13 — 2026-07-09

### Tempo control

- **`setGlobalBPM 0` not broadcasting** — clearing the global BPM override wasn't notified to the TUI, leaving stale tempo state displayed.
- **Live tempo retime instead of reroll** — changing tempo mid-playback used to reroll to a new segment; `applyGlobalBPMLive()` now retimes karma~'s speed in place, preserving the current segment.
- **Progress bar tempo drift** — the retime above changed playback speed but never told the TUI, so the progress bar kept counting at the old rate. Added a `segRetime` message and a client-side affine rebase that keeps the bar's fill percentage continuous through the exact instant of a live tempo change, with no visual jump.

## 0.1.12 — 2026-07-09

### New feature: forceNext

- Added `forceNext(stemOrAll)` — a manual "skip to next slice now" command, decoupled from the automatic per-stem advance timer. Locked follower stems redirect the force to their leader (cascading through the normal followers path) instead of pulling themselves, which would otherwise no-op or re-dispatch identical audio. `ws_server.js` renames the TUI's `next [stem]` command to `forceNext` on the way to Max to avoid colliding with the internal auto-advance message of the same name.

## 0.1.11 — 2026-07-09

### TUI layout & connection-reliability polish

- **`:score` / `:rate` command** and spatial-widget column added to the TUI layout.
- **Session defaults** tightened; progress bar restart bug fixed (bar could fail to reset on a fresh track load).
- **WS reconnect-error spam** — rate-limited: first connection failure logs immediately, further repeats collapse to at most once per 15s.
- **Header/icon layout** — record dot, `[TIP]`, and `[LINK]` indicators moved and restyled (symbols replaced with `[REC ON/OFF]` / `[TIP ON/OFF]` / `[LINK ON/OFF]` text, then `[REC]` reverted to a small colored dot next to the connection label); record dot sized down. Lock-source tag moved from the VU sidebar to under each stem's progress-bar timestamp, with a fixed-width slot so it aligns across all four stem rows regardless of lock state.
- **Full-width header/progress-bar regression (introduced and fixed same session)** — an attempted fix mistakenly narrowed the header and progress-bar rows to the VU-sidebar-aware content width; a screenshot showed the resulting dead gap. Root-caused to `statusBox`/`playBox` actually being declared full-terminal-width with the VU sidebar sitting below them, not beside — reverted to full `screen.width`.
- **Descriptor row adaptive width-fitting** — range-bar width and inter-field gaps now compute from available terminal width so the row never wraps to a second line; tail items (lock tag, bars/stay, sid, genre, track) are appended in priority order only if they fit.
- **Descriptor row tail-item alignment** — the lock-tag slot is now always reserved (blank-padded when unlocked) so `bars:`/`stay:`/sid/genre start at the same column on every stem row.

---

## 0.1.8 — 2026-07-02

### Repository restructure — portable, cloneable package

#### Folder layout
- `EBYS_INFRA/` split into `src/` with explicit subfolders: `max/` (Max JS + .maxpat), `demucs/` (Python pipeline), `tui/` (Cricket TUI)
- `Tipping_protocol/backend/` → `src/backend/`; `Tipping_protocol/frontend/` → `src/frontend/`
- All runtime data (stems, raw_uploads, temp, logs, recordings) moved to `data/` at repo root — fully gitignored
- `.bak` files moved to `src/max/archive/`

#### Path portability
- **Python** — all hardcoded `/Users/alexandregagne/Documents/EBYS/EBYS_INFRA/` paths replaced with `Path(__file__).parent`-based relative paths across `watch_demucs.py`, `scan_stems.py`, `send_to_max.py`, `import_library.py`
- **Max JS** — `getDataDir()` helper added to `streamWatcher.js`, `analyze_reader.js`, `track_loader.js`, `buffer_manager.js`, `clear_stems.js`; computes data path from `patcher.filepath` (strips `src/max/` → `src/` → repo root → `data/`). Works on any machine regardless of username or clone location
- **`slicer.js`** — `getInfraDir()` renamed `getDataDir()`, updated to navigate two levels up from `src/max/` to repo root then into `data/`; `downbeats.json` read path updated
- **`import_library.py`** — `analysis_library.json` path updated to `src/max/analysis_library.json`; `ebys.db`, `genres.json`, `downbeats.json` updated to `data/`
- **`cricket-voice.js`** — hardcoded Modelfile path in user-facing hint replaced with `path.join(__dirname, 'Modelfile')`

#### `setup.sh` (new)
- First-time install script: creates `data/` subdirs, creates `src/demucs/demucs_env/` Python venv, installs Demucs + watchdog, downloads Essentia genre models, runs `npm install` in `src/max/`, `src/tui/`, `src/backend/`, generates `com.ebys.watchdemucs.plist` with the current user's actual paths, installs it to `~/Library/LaunchAgents/` and loads the daemon
- Any contributor clones the repo, runs `bash setup.sh`, opens the patch — no manual path editing required

#### `.gitignore`
- Updated to cover new structure: `data/` (all runtime dirs), `src/demucs/demucs_env/`, `src/demucs/essentia_models/`, `src/max/` generated JSON files

#### Docs
- `docs/` reorganized into `docs/instrument/`, `docs/platform/`, `docs/protocol/`, `docs/business/`
- `docs/ARCHITECTURE.md` written — full system overview (instrument, backend, database, tipping protocol, split equation, Stripe, LINK, web radio, infrastructure, domain registrar, env vars, API reference)
- `docs/instrument/ARCHITECTURE.md` rewritten — instrument-only (Max/MSP + JS objects, FluCoMa pipeline, playback engine)
- All root `.md` files stubbed with redirect notices pointing to `docs/`

---

## 0.1.7 — 2026-06-23

### M/S Stereo + FX Send/Return Architecture

#### Max patch — master bus restructure (`ebys-analyze.maxpat`)
- **Single master bus** — removed per-stem `dac~ 1 2` (obj-712, 742, 772, 802). All four stems now sum into one stereo master via `+~` trees (obj-21000–21005). One `dac~ 1 2` (obj-21032) is the only speaker output.
- **FX send (pre-M/S, mono)** — mono sum of four `*~ 0.7` pre-M/S outputs (obj-21050–21052) feeds `*~ 0` send gain (obj-21053), controlled by `receive fxsend1` (obj-21054). Output on `dac~ 3 4` (obj-21055) → physical pedal input.
- **FX return** — `adc~ 3` (obj-21060) is the mono hardware return. `*~ 0` return gain (obj-21061) controlled by `receive fxreturn1` (obj-21062).
- **Dry/wet crossfade (insert model)** — `!- 1` (obj-21072) computes `(1 − fxSend)` applied to master L/R dry gains (obj-21070, 21071). At 100% send, dry is muted — only the pedal return is heard. This is the insert model, not the parallel/studio model.
- **Mono/stereo switchable pedal path** — `selector~ 2 1` objects (obj-21082, 21083) switch `dac~ 3/4` between: mono sum (fxStereo=0) or master L/R post-M/S (fxStereo=1). Return side: `selector~ 2 1` (obj-21092) selects between `adc~ 3` (mono) and `adc~ 4` (stereo R). `adc~ 3` always feeds L directly; the selector only controls R.
- **`receive fxstereo` + `+ 1`** — `receive fxstereo` (obj-21085) → `+ 1` (obj-21086) converts boolean 0/1 to 1/2 (selector~ is 1-indexed). `send fxstereo` (obj-21087) driven from route outlet 14.
- **Route extended** — obj-20101 `route` text extended with `fxstereo` as selector 15 (outlet 14).

#### Max patch — M/S label fix
- **6 mislabelled receive objects corrected** — drums column had melody labels and vice versa:
  - `receive width_melody` → `receive width_drums` (x≈829)
  - `receive panL_melody` → `receive panL_drums` (x≈698)
  - `receive panR_melody` → `receive panR_drums` (x≈829)
  - `receive width_drums` → `receive width_melody` (x≈1917)
  - `receive panL_drums` → `receive panL_melody` (x≈1783)
  - `receive panR_drums` → `receive panR_melody` (x≈1917)

#### New file: `ms_router.js`
- Routes TUI M/S and FX commands to Max `receive` objects via outlet 0 → route obj-20101 → send objects.
- **`width <stem> <0–1>`** — M/S stereo width per stem (0=mono, 1=full wide). Sends `width_<stem>` to patch.
- **`pan <stem> <-1–+1>`** — equal-power pan law (`L=cos((pan+1)π/4)`, `R=sin((pan+1)π/4)`). Sends `panL_<stem>` and `panR_<stem>`.
- **`fxSend <0–1>`** — send level; also drives `(1−fxSend)` dry crossfade in patch.
- **`fxReturn <0–1>`** — return level from hardware pedal.
- **`fxStereo 0|1`** — mono/stereo pedal chain switch. Sends `fxstereo` → patch selector~ objects.
- **`stemMS <track> <pan> <width>`** — called by slicer.js per-slice when `analysisDriven=true`; automatically updates pan/width from audio analysis.
- **`analysisMode on|off`** — toggles `analysisDriven`. Off = fully manual `:width` / `:pan` control.
- **`resend`** — re-pushes all current state to Max (useful after autowatch reload).
- **`anything()`** — catch-all suppresses "can't handle message" warnings (ms_router sees all ws_server outlet 0 messages in parallel).

#### `ws_server.js` — new M/S and FX command handlers
- `state.ms` object added: `{ width: {vocals,melody,bass,drums}, pan: {vocals,melody,bass,drums}, fxSend, fxReturn }`.
- New TUI commands: `:width <stem> <0–1>`, `:pan <stem> <-1–+1>`, `:fxSend <0–1>`, `:fxReturn <0–1>`, `:fxStereo 0|1`, `:analysisMode on|off`.
- `Max.addHandler('stemMS', ...)` — receives `stemMS track pan width` from slicer outlet 1; forwards to ms_router and broadcasts `{ type:'param', key:'stemMS', track, pan, width }` to TUI.

#### `slicer.js` — per-slice pan/width emission
- `buildIndex()` now reads `pan` and `width` from each slice dict (written by `add_stereo_features.py`). Defaults: `pan=0`, `width=0.5`.
- `selectSegment()` emits `outlet(1, "stemMS", track, startSlice.pan, startSlice.width)` after picking a start slice, in both the normal and loop paths.

#### New file: `add_stereo_features.py`
- Offline post-processor. Reads `analysis_library.json`, computes per-slice `pan` and `width` from audio, writes them back.
- **WIDTH** from stem M/S ratio: `rms_S / rms_M` per slice window, min-max normalized to `[0.05, 0.90]` within each stem. Demucs stems are near-mono (raw width 0.025–0.341); normalization preserves relative variation.
- **PAN** from original mix L-R energy balance: `(pwr_R − pwr_L) / (pwr_R + pwr_L)` at the same time window, scaled by `PAN_SCALE=0.6`. Follows the producer's stereo intent, not the near-mono stem signal.
- Falls back to stem for pan if original mix file not found. `--stems-only` flag forces stem-based pan.
- Usage: `python3 add_stereo_features.py` (all tracks) or `python3 add_stereo_features.py "DREPTO"` (filter).

#### Signal chain (complete)
```
karma~ → pfft~ → *~0.7 ──┬── mono sum → *~ fxSend → selector~ → dac~ 3 4 → pedal
                           │          (stereo alt: master L/R post-M/S → selector~)
               Haas→M/S→pan            adc~ 3 (L, direct) + selector~(adc~3|adc~4) → R
                           ↓
                  +~ sum (4 stems) → master L/R → *~(1−fxSend) [dry crossfade]
                                                     ↓
                                    +~ ← *~ fxReturn [FX return L/R]
                                                     ↓
                                                 dac~ 1 2
```

---

## 0.1.6 — 2026-06-23

### Meter flood fix (gate pattern)
- **Root cause confirmed** — "Node script not ready can't handle message meter" is fired by Max's C++ runtime before any JavaScript executes. `peakamp~ 4096` auto-fires at ~10.8 Hz per stem (~54 msg/s total) immediately on patch load; Node.js takes 1–3 s to init. No JS-side handler can prevent this.
- **Fix: patch-side gate** — added `gate 1` (obj-7013) in `ebys-analyze.maxpat` between the 5 prepend objects (obj-7008–7012) and node.script (obj-4030). Gate defaults closed (0). On patch load all meter messages are silently blocked.
- **Gate-open signal** — node.script outlet 0 → `sel ws_ready` (obj-7014) → bang on match → message `1` (obj-7015) → gate inlet 0. The `ws_ready` outlet call already existed in `ws_server.js` `server.listen` callback; no JS changes needed.
- **Dead handlers removed** — `ws_server.js`: removed no-op early `meter` handler (couldn't prevent C++ errors) and a duplicate `meter` handler silently overwritten by the active one.
- **3 missed direct wires caught** — initial gate edit only re-routed the 5 new prepend objects (obj-7008–7012). A pre-existing `prepend meter` (obj-5008), `prepend analysisDone` (obj-6002), and `prepend streamUpdated` (obj-9922) were still wired directly to node.script and causing the continued flood. All three now route through the same gate. Total: 8 message sources gated, 5 control-only sources (script start/stop/state, slicer.js outlet 1) left direct.

---

## 0.1.5 — 2026-06-22

### Defaults
- **`DEFAULTS.md` created** — documents all factory defaults with commands and notes
- **`STAY_PROB`** changed from `0.0` → `0.5` (coin-flip stay/move per stem)
- **`MATCH_PROB`** changed from `0.0` → `0.9` for all descriptors (strong spectral continuity: always picks the nearest neighbor, but never the same slice — variety comes from STAY_PROB moving between source tracks, not from randomizing the match)
- **`MAX_SLICES_PER_STEM`** changed from `0` (unlimited) → `200` (performance cap for large libraries)

### VU meters
- **`meter` flood fix** — Max was sending `meter` messages from a beat-detection metro before ws_server's Node script was ready; no handler existed so Max logged "can't handle message meter" thousands of times. Added a `meter` handler that silently discards 0-arg beat ticks and broadcasts 2-arg VU data (`meter <name> <level>`) as `{type:'vu'}` WebSocket messages
- **Per-stem VU bars** — new 12-char bar appended to the right of each stem's progress bar line. Green (below -12 dB), yellow (-12 to -3 dB), red (above -3 dB). Driven by `peakamp~` in Max via `meter <stem> <0–1>`. `barW` reduced by `VU_W + 1` (13 chars) to keep total width constant
- **Master VU bar** — `out: ████████████` shown in the EBYS header line, driven by `meter master <0–1>`
- **Max wiring done** — `ebys-analyze.maxpat`: 10 new objects (obj-7001–7005 peakamp~, obj-7008–7012 prepend). Taps: `*~0.7` outlet per stem (post-volume) and `+~` final sum outlet (master). 10 patchlines: audio→peakamp~, peakamp~→prepend, prepend→node.script.
- **`metro` + `loadbang` removed** — first wiring attempt incorrectly used `loadbang → metro 50 → peakamp~ inlet 1`. `peakamp~` has only one inlet (audio signal); inlet 1 does not accept message-rate bangs. Also, the metro started at patch open before `node.script` booted, causing the "Node script not ready can't handle message meter" flood. Both wiring error and flood fixed by removing metro/loadbang: `peakamp~ 4096` auto-outputs peak amplitude every 4096 samples (~93 ms) with no external trigger needed.
- **VU dot style** — `vuBar()` changed from `█/░` blocks to `●/○` dots (filled/empty circles). Color zones unchanged: green (0–-12 dB), yellow (-12–-3 dB), red (above -3 dB).

### Multi-track display + progress fixes
- **Track name fix** — `outlet(1, "stemTrack", track, cleanTrackName(track))` was passing the STEM TYPE ("vocals") to `cleanTrackName`, which reads `meta["vocals"].track_name` — the last track loaded during `buildIndex` (alphabetically last = DREPTO CE3o always). Fixed to `startSlice.sourceTrack` which is the name of the actually playing source track
- **Slice ID collision fix** — slice IDs from the analysis library are per-track integers (0, 1, 2…). Two different source tracks can both have slice id "0", making the TUI's new-slice check (`msg.id !== state.stems[name].id`) fail when switching tracks → `stemSliceStartTime` never resets → progress bar frozen at 0. Fixed by prefixing with source track: `startSlice.sourceTrack + ":" + startSlice.id`
- **`segDurMs` threading** — `ws_server.js` `melody/bass/drums` handlers were only capturing `(slot, startFrac)`, silently dropping `segDurMs`. TUI was recomputing from BPM, which gives wrong values when `state.beats.bpm` is stale or inaccurate. Now all 4 stem handlers capture the full 5-arg signature and store `segDurMs` in state. TUI `sliceBar()` uses `s.segDurMs` directly (BPM formula as fallback only)

### Max / slicer.js — stuck-loop fixes
- **`STAY_PROB` advance fix** — when STAY_PROB triggered, `startIdx` was reset to `lastIdx[track]` (exact same slice), causing infinite repetition. Fixed: now finds the earliest slice on the same source track whose `time >= lastEndFrac`. Falls back to any slice on that track if none found after. New tracking vars: `lastEndFrac` (end fraction of previous segment) and `lastSourceTrack` (source track name). Both reset in `reset()`
- **`MATCH_PROB` stays `0.9`** — high match picks the spectrally nearest neighbor but never the exact same slice. Variety comes from STAY_PROB (50% chance to move source track each cycle), not from lowering match strength.

### Max / slicer.js
- **`sourceNames is not defined` fix** — `start()` was iterating a local variable that only existed inside `buildIndex()`. Fixed by iterating `slotMap` (module-level `{ trackName → slot }` dict), sorted by slot value
- **Unequal segment duration fix (accumulated overshoot)** — `snapSegDurMs` was rounding the *accumulated* slice duration to the nearest bar, causing overshoot when a single long slice (e.g. 15 s bass) made the segment snap to 8 bars (16 000 ms) instead of the target 4 bars (8 000 ms). Fixed by using `SEGMENT_BARS[track] * barMs` exactly as the timer value
- **Unequal segment duration fix (cross-track BPM)** — when different stems chose source tracks with different analyzed BPMs, per-track `barMs` gave different `snapSegDurMs` values and stems fired out of sync. Timer now always uses `GLOBAL_BPM` (or `FALLBACK_BPM` when no override) so all four stems always fire at the same interval: `SEGMENT_BARS × (60 000 / globalBPM × 4)`. `stretchRatio` continues to compensate for per-track BPM inside karma~

### Max / slot_router.js
- **`karma~: doesn't understand "int"` fix** — `1.0 / 1.0 = 1` in JS has no fractional part; Max sends it as an int atom, which karma~'s speed inlet rejects. Fixed by adding `1e-9` epsilon (`speedFloat = speedFactor + 1e-9`) to guarantee a fractional part → float atom. The ~0.00000009% pitch difference is inaudible
- **Pitch ratio sent on every play command** — previously `stemPitch[stem]` was only sent on explicit `:pitchShift`. Now `outlet(PITCH_OUT[stem], stemPitch[stem])` fires on every `routeStem()` call so gizmo~ always has a valid ratio (default 1.0 = pass-through) even before any pitch command is issued
- **`stop()` handler** — sends `"stop"` to all four karma~ inlet 0 outlets (0, 3, 6, 9) when `:stop` is received. Called by `buffer_manager.js` forwarding `outlet(12, "stop")` via the existing wire

### Max / buffer_manager.js
- **Cross-track load race condition fix** — when slicer switched source tracks, `handlePlay` was calling `loadSrc` even while another track was already loading into the staging buffer. This corrupted `s.contents[staging]` before the previous `fluid.bufcompose~` completed, leaving the stem silent or stuck. Fixed: `handlePlay` always writes `pendingCompose` first; only calls `loadSrc` when `s.loading === false`. When a load completes, `src_done` uses `findSrc` to check both buffers — if the wrong track arrived (different source track than `pendingCompose.sourceSlot`), it immediately calls `loadSrc` for the correct track and leaves `pendingCompose` set until the right buffer is ready.
- **`playing` gate** — new module-level flag (default `false`). Set to `true` at the top of `handlePlay()`. Checked in `ring_done` before `outlet(12, ...)` — in-flight `fluid.bufcompose~` copies that complete after `:stop` are now discarded instead of restarting karma~
- **`stop()` handler** — sets `playing = false` and forwards `outlet(12, "stop")` to slot_router so karma~ objects are halted immediately

### Max / ebys-pitch.maxpat
- **FFT imaginary path fix (silence through pitch shifter)** — the two imaginary signal wires were entirely missing from the pfft~ subpatch. Added: `fftin~ outlet 1 → gizmo~ inlet 1` and `gizmo~ outlet 1 → fftout~ inlet 1`. Without the imaginary component, FFT reconstruction is impossible and gizmo~ outputs silence regardless of pitch ratio

### TUI / sdj-tui.js
- **Version bump** — title and header updated to `EBYS 0.1.5`
- **Progress bar coordinate-system fix** — bars were filling only in the last seconds of each slice because `s.pos` (karma~ ring buffer 0→1) was being compared against `sliceStart/sliceEnd` (fractions of the *full stem buffer*) — different coordinate systems. Rewrote `sliceBar()` to use wall-clock elapsed time (`Date.now() - stemSliceStartTime[name]`) instead. Progress is now accurate for the full 8 000 ms window
- **`stemSliceStartTime` tracking** — records `Date.now()` whenever a new slice id arrives on a stem; `sliceBar()` reads this to compute elapsed time
- **Progress bar bracket width fix** — bracket width was based on the actual audio length in the ring buffer (e.g. 15 s for bass) not the timer duration (8 s). Fixed by using `segDurMs / stemDurMs` so all four brackets are the same width
- **`playbackStopped` flag** — set `true` on `:stop`, cleared on `:start`. `sliceBar()` reads this flag and suppresses the wall-clock timer, freezing the cursor at position 0 instead of continuing to animate after audio stops

---

## 0.1.4 — 2026-06-19

### Max / slicer.js
- **`buffer_manager.js` fix** — wrong `filename` field in maxpat was silently invoking `track_loader.js` instead; corrected
- **Phantom `src_done` fix** — removed 3 wrong patch cords that were triggering spurious `src_done` callbacks
- **`fluid.bufcompose~` attribute fix** — `destframe` → `deststartframe` (correct attribute name)
- **`dict: cannot read dictionary: -1` fix** — removed loadbang → dict cord that fired before the dict was populated

### Time-stretching (karma~ speed wiring)
- **`stretchRatio` fix in `buffer_manager.js`** — `composePend` was silently discarding `stretchRatio`; now stored and passed through `ring_done` → `slot_router.js` as 4th argument
- **`slot_router.js` v4** — added dedicated speed outlets (12–15) wired to karma~'s right inlet (speed factor = `1/stretchRatio`); pitch follows speed tape-style
- Delay timer corrected: `delayMs = segDurMs × stretchRatio` so the next segment fires at the right moment regardless of stretch amount

### Per-stem pitch shifting (pfft~/gizmo~)
- **`ebys-pitch.maxpat`** — new pfft~ subpatch: `fftin~ 1 square` → `gizmo~` → `fftout~ 1 hamming`; `in 2` receives pitch ratio from outside, routes to gizmo~'s frequency-shift inlet; duration unchanged
- **`ebys-analyze.maxpat`** — 4× pfft~ objects (one per stem) inserted between karma~ and the mixer; slot_router outlets 16–19 wired to each pfft~ inlet 1
- **`slot_router.js` v4** — added pitch outlets (16–19) and `pitchShift / setPitchSemitones / setPitch` functions; per-stem `stemPitch` state; `setPitch all` resets all stems
- **`ws_server.js`** — intercepts `:pitchShift <stem> <semitones>` before buildIndex check; calls `Max.outlet('pitchShift', stem, semitones)`; route object outlet 22 → `prepend pitchShift` (obj-4068) → slot_router inlet 0
- TUI command: `:pitchShift melody 3` raises melody 3 semitones; `:pitchShift all 0` resets

### Code clarity
- **`slicer.js`** — added `── Role ──` header block: sequencing brain, musical decision-making, no direct DSP access
- **`slot_router.js`** — added `── Role ──` header block: audio engine parameter hub, sole owner of karma~/pfft~ messages

### Infrastructure
- **32KB JS read limit bypass** — `analysis_library.json` (~1MB) now read by `ws_server.js` (Node.js) and delivered to `slicer.js` in 2KB chunks over Max's message bus; works around Max's hard JS file read cap
- **Genre filtering** — `genres.json` delivered to slicer via the same chunked mechanism; every slice is tagged with its track's genres
- Genre filter commands: `setGenreFilter <genre>`, `clearGenreFilter`, `listGenres`

### Cricket / Training
- **`:bake` training system** — captures intent + Cricket's commands + user corrections + live descriptor state to `training_log.jsonl`
- **`convert_bakes.py`** — converts bake log to MLX fine-tuning JSONL format
- **`finetune.sh`** — one-command LoRA fine-tune on Apple Silicon via `mlx-lm`
- `mlx-lm` installed in `~/ebys-mlx-env`

### Documentation
- **`ARCHITECTURE.md`** — full pipeline documented: Analysis (Demucs → Essentia → madmom → FluCoMa → JSON) and Playback (ws_server.js → chunks → slicer.js → buffer_manager.js → karma~ → pfft~/gizmo~)
- **`PLAYBACK.md`** — updated to reflect two-axis audio engine (tempo via karma~ speed, pitch via pfft~/gizmo~) and slot_router.js role separation

---

## 0.1.3 — 2026-06-18

### TUI
- **Novelty sparkline** — per-stem `▁▂▃▄▅▆▇█` weather map showing descriptor novelty over the last 12 slices
- Sparkline updates on every slice change (event-driven, no timer)
- Global autoscale across all 4 stems with `NOVELTY_GLOBAL_MIN = 0.05` floor — prevents outlier-poisoned rescaling
- `desc` message type separated from `stem` in ws_server.js so TUI can compute novelty with fresh descriptors
- Loop cycles emit `desc` before `seg` in slicer.js — sparkline now fires for loop repetitions
- Sparkline floor uses `▁` (LOWER ONE EIGHTH BLOCK) — bottom-anchored, single-width, guaranteed across terminal fonts
- Language list column layout: equal-distribution algorithm (floor/ceil per column, max diff = 1 entry)
- Language list LRM anchor restored for RTL scripts (Arabic, Hebrew) with +8 col gap to absorb CJK width discrepancies
- `loopCycles` counter in slicer.js — each loop repetition gets a unique id (`loop1`, `loop2`, …) so TUI detects id change on every cycle
- rangeBar fallback when `rng.max === rng.min`: cursor now shows at left (position 0) instead of center
- Progress bar shows slice zone `────[████░░░]────` with elapsed/remaining within zone
- **Slice zone now pixel-accurate** — slicer.js sends real `startFrac`/`endFrac` with every `seg` message; TUI uses them directly instead of estimating from BPM/bars
- Master header track name combines all stem track names with grey ` · ` separator
- Compact 2-space layout between descriptor fields
- **MMT direction arrows** — `↑` `─` `↓` displayed between each descriptor letter and its range bar (e.g. `M↑ ━━●━━`), driven by `tension_C/E/F/P/H/T` values; `·` when no tension data available
- Space separates arrow from range bar to prevent `─` merging with `━` characters

### ws_server.js
- `desc` handler broadcasts `type:'desc'` instead of `type:'stem'` — TUI uses this to know when fresh descriptors are available
- `desc` handler now accepts and stores `tC/tE/tF/tP/tH/tT` (tension values, 0–1) from slicer
- `seg` handler now parses and stores `sliceStart`/`sliceEnd` fracs broadcast with every stem message
- `slice_ms` handler added
- `index_empty` handler added — broadcasts warning to TUI when `:start` is sent before `buildIndex`

### slicer.js
- `loopCycles` per-stem counter — loop `seg` id is now `loop1`, `loop2`, … (unique per cycle)
- Loop branch emits `desc` with loop segment's descriptor values before `seg` — enables meaningful novelty in loop mode
- All three `desc` outlets now include `tension_C/E/F/P/H/T` fields from the slice object
- All three `seg` outlets now append `startFrac` and `endFrac` so TUI can draw an accurate zone bar
- `buildIndex` now reads `tension_C/E/F/P/H/T` from each slice dict into the in-memory slice objects

### add_tension.py
- Replaces `add_mmt.py` (deleted) — now the single source of truth for momentum computation
- All TUI paths (FluCoMa-done hook and `:setMMT` command) updated to call `add_tension.py`
- Writes `tension_*` fields (not `mmt_*`) — stale `mmt_*` fields stripped from `analysis_library.json`
- `_other.wav` / `_other` added to `STEM_SUFFIXES` so Demucs melody stem groups correctly
- Output condensed: one header line + one stem summary line per track, blank line between tracks

---

## 0.1.2 — 2026-06-16

### TUI
- Renamed `win:` to `env:` in header — the slice fade shape is an envelope, not an FFT window
- Moved MMT window display to sit right after `env:` in header line
- Genre header now shows full `Parent · Sub` format (e.g. `Electronic · Techno` instead of just `Techno`)
- `:setMMT <bars>` command — sets momentum window size, reruns `add_tension.py`, sends `buildIndex` on completion
- `MMT window: N bars` displayed in header

### Analysis
- `add_tension.py` — new script that computes per-bar momentum for all 6 descriptors (C, E, F, P, H, T) and writes `tension_C/E/F/P/H/T` back to every slice in `analysis_library.json`
- Momentum algorithm: group slices by bar → average descriptor per bar → sliding window slope → normalize 0–1 → write back
- `MOMENTUM.md` — documentation for the tension script
- `tension_E` near 1.0 = energy building (drop incoming). Near 0.0 = releasing. 0.5 = stable.
- T descriptor computed on the fly as RMS of MFCC coefficients M0–M5

---

## 0.1.1 — 2026

### TUI
- Per-stem track name display — shows which file each stem is currently playing from (20-char truncation with `…`)
- Weighted genre label in header — genre reflects which stem dominates by energy × track weight
- Track browser — `:nextTrack` / `:prevTrack` cycles through all tracks in bank showing BPM, key, genre, confidence
- `:reloadDownbeats` now updates TUI locally before forwarding to Max
- Key detection displayed in header — pulled from `downbeats.json` via Essentia KeyExtractor
- match/dir parameter lines aligned with bar column
- `fmtM` fixed to 4-char output, matching `fmtDir` alignment
- Slice id moved to end of descriptor line
- `setTrackWeight` intercepted to update per-stem weight in TUI state
- `[object Object]` genre display bug fixed — now correctly extracts `.genres[0].genre`

### Max / slicer.js
- `stemTrack` message handler added to `ws_server.js` — was silently dropped before
- `track_name` handler pre-populates all stem track fields immediately on track load
- `cleanTrackName()` helper strips stem suffix from track name before display
- `outlet(1, "stemTrack", ...)` added in `selectSegment()` and `nextNearest()`

### Analysis
- Essentia KeyExtractor wired into analysis pipeline — writes `key` field to `downbeats.json`
- Key shows in TUI header; `?` when unavailable

---

## 0.1.0 — 2026 (initial working build)

### Engine
- Max/MSP patch — 4-stem playback (vocals, melody, bass, drums) via `fluid.bufcompose~` + `fluid.bufresampler~`
- `analyze_reader.js` — reads Essentia analysis JSON, skips already-analyzed tracks, emits "all analyzed" on completion
- `slice_writer.js` — writes slice data to `analysis_library.json` with M0–M5 MFCC fields
- `slicer.js` — real-time slice selection engine using descriptor distance scoring (C, E, F, P, H, T + MFCC)
- Bar-snap quantization using madmom downbeats — slices lock to bar boundaries when confidence ≥ 0.4
- Stretch ratio wired through outlet 0 for time-stretching playback
- `ws_server.js` — WebSocket bridge between Max and TUI (RFC 6455, no external deps)

### Analysis pipeline
- `genre_tagger.py` — Essentia-based genre classification, writes `genres.json`
- `madmom_tagger.py` — downbeat detection via madmom DBNDownBeatTracker, writes `downbeats.json`
- `fluid.bufmfcc~` added to `ebys-analyze.maxpat` — computes M0–M5 per slice
- `fluid.buftempogram~` added for BPM estimation
- Improved BPM estimation in `analyze_reader.js`

### TUI (sdj-tui.js)
- 4-stem progression bars with real-time position tracking
- Descriptor display per stem: M, E, F, P, H, T
- Slice timestamp display
- Status header: track, BPM, key, LUFS, dBFS, genre, beats confidence bar, quant mode
- match/dir parameter display
- Language selector — 40+ languages, localized agent name and chirp
- Cricket AI agent — Ollama-backed, reads CRICKET.md as knowledge base, mixes commands and conversation
- `:resetMemory` — two-step confirmation to wipe all analysis JSON
- `:tagBeats` — runs madmom tagger from TUI
- `:commands` toggle, `:chat` toggle, `:language` toggle
- Counter advancement fixed — completion-based, not delay loop
- Meter console flooding fixed — delayed metro 100 startup
- `dictwrap` errors in `buildIndex` fixed
- Bass/melody buffer read messages fixed (obj-245, obj-247)

### Infrastructure
- `analysis_library.json` — consolidated single dict replacing per-track dict files
- Nested JSON format fixed — correct structure for Max `dict` objects
- Clean slate command — wipes analysis JSON and resets counter

---

## Roadmap

- **0.2** — momentum wired into slice selection (`:setArc`, `:setMMT` bias)
- **0.3** — Pure Data migration (Max/MSP → PD, deadline Aug 8)
- **1.0** — stable enough to perform with, documented, demo recording
