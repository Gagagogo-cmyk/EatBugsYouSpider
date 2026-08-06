# EBYS — REAPER Integration Roadmap

**Superseded by `VST_PLUGIN_ROADMAP.md`.** This doc was scoped around a REAPER-only ReaScript extension; the decision since then is a real VST3/AU plugin for portability across DAWs. Kept here as historical record — read `VST_PLUGIN_ROADMAP.md` instead.

Status: **plan, nothing built yet**. Scoped for a solo developer, targeting REAPER specifically (not a generic VST3/AU), with the Max/PD instrument kept running as the live rig throughout — nothing here retires the current prototype until this proves itself out.

---

## 1. Vision recap

Drop EBYS on a track holding a mix. It splits the mix into 4 stems on 4 new tracks and mutes the original. It generates alternative versions of each stem, driven by what it's learned; the user auditions and scores generations in a training tab (a DAW-native version of the TUI), and the system trains on those scores. The same loop repeats at transitions between song sections: generate a transition, score it, train, move to the next section. During a live set, the user can switch between scored "dimensions" — different generations of the same material — semi-randomly, as a performance gesture.

---

## 2. Why REAPER-specific changes the shape of this plan

A generic VST3/AU plugin can't create tracks or mute other tracks in the host — that's outside the standard plugin API. REAPER's own scripting layer (ReaScript) can: it has direct API access to create tracks, route audio, and mute/unmute programmatically. That single fact changes the architecture significantly — it means large parts of this don't need to be a compiled C++/JUCE plugin at all.

**Core architectural bet:** build this as a REAPER extension (ReaScript + a custom GUI panel), not a hosted instrument plugin. Three native REAPER pieces do almost everything the earlier JUCE-plugin conversation assumed would need custom DSP code:

- **ReaScript** (Lua for the control logic and API calls — Python has the same API but weaker UI support, so Lua is the better fit here) creates tracks, mutes the original, sets up routing, and runs the sequencing loop that decides which slice/segment plays next. This directly replaces the job `ws_server.js` + `slicer.js` currently do as a scheduler — except EBYS's decisions happen once per bar or per segment (not per-sample), which is well within what a ReaScript `defer()` loop can handle. Nothing here needs sample-accurate real-time code.
- **REAPER's native item engine** (its built-in time-stretch/pitch-shift per audio item) replaces `karma~` (variable-speed playback) and `pfft~`/`gizmo~` (pitch shift). Instead of building a custom sample player, the plan is to place, trim, and re-pitch media items on REAPER's own timeline under script control — reusing an audio engine that already exists and is already fast, instead of rebuilding `buffer_manager.js`/`slot_router.js` from scratch in C++.
- **ReaImGui** (a maintained ReaScript binding for Dear ImGui) builds a dockable panel inside REAPER — this is the direct replacement for the terminal TUI and the "training tab."

The trade-off, stated plainly: this locks the instrument to REAPER and gives up the sample-level control a hand-built JUCE engine would offer. In exchange, it turns "build a real-time audio engine in C++" — the single biggest risk item from the JUCE conversation — into "drive an engine REAPER already ships," which is a far smaller and more solo-dev-realistic scope. If REAPER's native stretch/pitch quality or the `defer()` loop's timing precision turns out to be insufficient (see Phase 1), that's the point where a JSFX or JUCE fallback gets reconsidered — not before.

---

## 3. What already exists and doesn't need to be rebuilt

Worth being explicit about this, because the honest scope of "new work" here is smaller than the vision might suggest:

| Piece of the vision | Already built | Where |
|---|---|---|
| Stem separation on ingest | Yes — `watch_demucs.py` + Demucs | `EBYS_INFRA/watch_demucs.py` |
| "Alternative versions of a stem" (remix mode) | Yes — real-time descriptor-driven resequencing | `slicer.js` `selectSegment()` |
| "Alternative versions" (true generation, not remix) | Scaffolded, not yet run — needs a GPU + accepted model license | `GENERATIVE_LAYER.md`, `USER_LORA.md` |
| Taste model / scoring a candidate | Built, working | `train_bias.py`, `scoreCandidate`/`applyLearnedRefusal` in `slicer.js` |
| Score → train loop | Built, working, DB-backed | `BAKE.md` (`bake_snapshots` table in `ebys.db`) |
| Remix vs. generate vs. blend switch (the "dimension switching" primitive) | Built | `AGENT_MODE` / `:setAgentMode` in `slicer.js` |
| Canonical, queryable data store | Already the migration target | `ebys.db` (SQLite) — PD migration is moving everything here anyway |

What's genuinely missing: a REAPER-side host for any of this, a batch-render-and-score UI (today's bake loop scores a live parameter path, not a set of discrete rendered candidates), song-section/transition awareness, and the "live dimension switching during a set" UI wired to REAPER controls.

---

## 4. Sequencing against the current roadmap

Per `CHANGELOG.md`, EBYS is mid-migration: **0.3 (Max/MSP → Pure Data) has a deadline of Aug 8**, with **1.0** (stable enough to perform with) as the next milestone after that. This plan should not compete with that migration for attention.

**Phase 0 — finish the PD migration first.** In progress already, has a real deadline nine days out as of this writing. Don't start REAPER work until this lands, or at minimum until `ebys.db` is confirmed as the sole source of truth (it's already the design target per `ARCHITECTURE.md` §11). Every later phase here depends on the data layer being settled, not mid-migration.

---

## 5. Phased plan

### Phase 1 — Feasibility spike (kill-early checkpoint)

Before committing real time, validate the three riskiest assumptions with throwaway scripts:

1. Can a ReaScript create tracks, route a multi-out source to them, and mute the original reliably via the API? (This is well-documented REAPER API territory — low risk, but confirm on your actual REAPER version before building on it.)
2. Can a `defer()`-loop sequencer place/trim/re-pitch media items on a bar-boundary schedule with timing tight enough to feel musical — port the simplest possible version of `selectSegment()`'s logic against one test track and listen for it dropping frames or drifting.
3. Can ReaImGui host a dockable panel showing live values pulled from `ebys.db`, proving the training-tab concept is viable as a REAPER panel and not just a terminal app.

If any of these fail, this is the point to reconsider the architecture (JSFX for the playback core, or fall back to the earlier JUCE-plugin path) — before Phase 2 onward is built on top of them.

### Phase 2 — Ingest: split, route, mute

Wire the existing `watch_demucs.py`/Demucs pipeline to run when EBYS is invoked on a track: extract the track's audio, run it through the existing Python backend (subprocess call from ReaScript, same shape as the Max/PD version's daemon), then use the ReaScript API to create 4 new tracks, route the resulting stems there, and mute the original. This is the literal "split into 4 channels, mute the original" feature, and it's the first end-to-end proof the REAPER integration works at all.

### Phase 3 — Port the sequencing/playback core

The largest single phase. Reimplement what `buffer_manager.js` + `slot_router.js` + `slicer.js` do today as a ReaScript sequencer driving REAPER media items instead of `karma~`/`pfft~`. Read directly from `ebys.db`/`ebys_index.json` (already the PD-migration target, so no new data format needed). Tempo axis = REAPER item playrate; pitch axis = REAPER's item pitch-shift, independent of rate exactly like `pfft~`/`gizmo~` are today. M/S width, pan, and FX send/return (`ms_router.js`'s job) map onto REAPER's native track routing and pan law, or a small JSFX if REAPER's stock tools don't cover something specific.

### Phase 4 — Training tab (ReaImGui)

Port the TUI's live display (descriptors, BPM, tension arrows, genre) into a dockable ReaImGui panel reading `ebys.db`. Port the existing bake loop (`:bakeloop`, `:bake start/end/abort`, `bake_snapshots` table) as-is — it's already DB-backed and already does "score a moment, weight future selection toward it."

Add what doesn't exist yet: a **batch-render-and-score mode**. Today's bake loop scores a live parameter path; the vision described here also wants discrete candidate renders (full alternate takes of a stem or a transition) that the user can audition side-by-side and accept/reject. That's new UI and a render-N-candidates orchestration step, not new ML — it can log into the same JSONL/`bake_snapshots` shape the existing training infrastructure already consumes.

### Phase 5 — Generative layer (finish what's already scaffolded)

This phase is mostly "execute `GENERATIVE_LAYER.md`/`USER_LORA.md`, which are already designed and partly code-complete" rather than new design work: get GPU access, accept the Stable Audio 3 license, run the LoRA fine-tune on the catalog, verify via the descriptor-distribution check `USER_LORA.md` already specifies. Then surface `AGENT_MODE` (`remix`/`generate`/`blend`) as toggles in the Phase 4 panel instead of TUI commands.

### Phase 6 — Section/transition awareness

Don't build automatic song-structure detection for v1 — that's real, unproven algorithmic work and the highest-risk new component in this whole plan. Instead, use REAPER's native regions/markers: the user marks section boundaries by ear (a feature REAPER already has), and "generate a transition" becomes a bar-aligned crossfade/regeneration pass scoped to the audio around a marked boundary, using the same generate → score → bake loop as everything else. This turns a hard ML problem into a UI feature reusing existing REAPER functionality — revisit automatic detection later only if manual marking proves to be a real workflow bottleneck.

### Phase 7 — Live "dimension switching" performance mode

Mostly wiring, not new capability: expose `AGENT_MODE` switching and `next()`/variant-selection (already built) as REAPER actions, which means they're natively MIDI/OSC-mappable to a controller for live use — REAPER actions get this for free once they exist as script commands.

### Phase 8 — v1: one track, start to finish

Drop EBYS on a track → split/mute → generate alternatives → score/train → mark and generate a transition → score/train → perform with live switching between scored variants. This is the integration milestone, not a new phase of work — it's Phases 2–7 proven to work together on a real track.

---

## 6. What stays true throughout

The Max/PD instrument keeps being the live rig for as long as this takes — this plan doesn't touch it, and 0.3/1.0 on that roadmap proceed independently. REAPER work starts once the data layer (`ebys.db`) is settled post-migration, and the two systems can share that data layer without conflict, since both are designed to read from it.
