# EBYS — Generative Layer (Roadmap)

Status: **scaffolding built, not yet run**. The integration code (generation script, fine-tune script, tagging script, the remix/generate switch in `slicer.js`, the `:setAgentMode` command) exists and is syntax-checked. Nothing has actually been executed — no model downloaded, no fine-tune run, no clip generated — because that needs a GPU and an accepted Hugging Face license this environment doesn't have. See [Implementation status](#implementation-status) for exactly what's real vs. what still needs to happen on your own hardware.

---

## Vision

Today, EBYS selects and layers slices of *existing* recordings — it never creates a sound that wasn't captured by a mic or DAW at some point. The generative layer is the next step: a model that can synthesize new audio directly, filtered through the same taste model EBYS already uses to judge real slices.

Two systems working together, not one:

| Piece | Job | Status |
|---|---|---|
| Taste model (`train_bias.py`) | Score a candidate — real or generated — against learned preference | Built, working |
| Generator | Produce a candidate that didn't exist before | Not built |

The taste model can only **filter** what the generator is capable of producing. It cannot teach the generator new sounds — it narrows down *where* in the generator's range to land. Capability comes from the generator; taste comes from the filter.

---

## Why not just remix?

Stem separation + reassembly (what EBYS does today) is bounded by what already exists in the library — it can select, layer, time-stretch, and blend, but it can never produce a sound, timbre, or combination that no source recording ever contained. It's also always coherent, since every output sample was really recorded by something.

A generative model removes that ceiling — it can synthesize points that were never captured by anything, including timbres and combinations that sit "between" existing material. That's the only thing it buys you that remixing can't. Whether it's worth the cost below depends on whether that specific capability — sound that never existed in any recording — is actually part of the vision, versus "the best possible arrangement of the existing catalog."

---

## Build order — with Stable Audio Open

1. **Get the base model.** Download Stable Audio Open's pretrained weights and code (Hugging Face / Stability AI).
2. **Prepare the catalog as training data.** Stable Audio Open is text-conditioned — each fine-tuning clip needs a caption alongside the audio. EBYS already has this: Essentia genre tags (`genres.json` / `genres` table, per track) and madmom tempo/BPM (`downbeats.json` / `tracks.bpm`), both computed at import time already. Build captions from existing genre + BPM metadata rather than tagging the catalog again from scratch.
3. **Fine-tune.** Continue training Stable Audio Open's weights on the captioned catalog (rented GPU realistically). Shifts the model's learned "shape" toward EBYS's own material without erasing its original training.
4. **Generate.** Prompt the fine-tuned model, conditioned on genre + target BPM. It starts from random noise and runs its learned denoising steps, producing a compressed latent — not audio yet, an internal representation.
5. **Resynthesize.** Stable Audio Open's bundled decoder converts that latent into actual raw waveform samples — a real, playable clip. Ships with the model; no separate component to build.
6. **Analyze.** Run the clip through `analyze_reader.js`, the same descriptor pipeline every real track already goes through (C/S/E/F/P/H/T via FluCoMa). No special case for generated audio — **but note `analyze_reader.js` is a Max object driven by FluCoMa's `buf~` externals, not a standalone script.** There's no way to compute these descriptors outside the Max patch without silently using different math than what the taste model was trained on. In practice this means: generated clips go through the same offline import step any new track does (see step 9a below), not an instant inline analysis at generation time.
7. **Score.** Feed those descriptors into the existing taste model — `train_bias.py`'s learned weights, via the scoring functions already in `slicer.js`.
8. **Filter.** Keep candidates that score well (`scoreCandidate` / `applyLearnedRefusal`), discard or regenerate the rest. Closes the loop using code that already exists, almost unchanged.
9. **(Later) Per-stem.** Repeat 1–8 with a separately fine-tuned Stable Audio Open instance per stem to generate — vocals first, as a testbed — feeding output into the mixer alongside stems still coming from the real library. EBYS already treats each stem independently (`seg_voc`, `seg_mel`, `seg_bas`, `seg_drm` are separate in the schema), so the mixer doesn't need to change; it already expects a waveform per stem per slice regardless of origin. Two real requirements: each generative stem needs its own fine-tuned model, and output has to land on the same bar/timing grid the mixer expects — condition generation on the session's target BPM (madmom data) and/or time-align the resynthesized clip afterward, same problem real slices already solve.
10. **(Later, harder) Train-time guidance.** Instead of filtering after generation, use the taste score as a training signal to keep fine-tuning Stable Audio Open itself, so it drifts toward what scores well over time — same shape as RLHF, applied to audio. Bigger lift; not a v1 requirement.

---

## Model choice

| Model | Open weights | Commercial license | Verdict |
|---|---|---|---|
| **Stable Audio Open** | Yes | Yes — Stability AI Community License, commercial use permitted under a revenue threshold | **Chosen** |
| MusicGen / AudioCraft (Meta) | Yes | Code is MIT; pretrained *weights* are CC BY-NC 4.0 — non-commercial only | Rejected for this project — EBYS generates revenue via tips, so Meta's pretrained weights can't legally be used or fine-tuned into a shipped product. The MIT-licensed code could still be used to train a model from scratch on EBYS's own data, avoiding the restriction — but that's a from-scratch cost, not a fine-tune. |
| Suno | No (closed, proprietary) | N/A | Not usable as infrastructure — reference point for output quality only |

Stable Audio Open is diffusion-based: trained by learning to reverse a noising process, so generation means starting from random noise and running the learned denoising steps until they resolve into something inside the learned "shape" of the training data. Architecture is public; fine-tuning tooling exists.

**Caveat on "from scratch":** building the denoising architecture and training it with no pretrained starting point is not realistic for an individual or small team — training data at the scale needed (hundreds of thousands to millions of hours of audio) and compute (large GPU clusters, weeks of training) put it in industrial-research territory. Fine-tuning Stable Audio Open's existing weights on EBYS's catalog is the actual achievable path.

---

## Known limits (be honest about these going in)

- **Local vs. song-level structure.** Training on short slices/bars teaches local coherence (a good couple of bars, a good transition) but not song-level architecture (verse/chorus/bridge, long-range arc) unless the model also sees full-length sequences, or a hierarchical structure-planning layer is added on top. EBYS's catalog is already broken into stems/slices — if position-within-original-track isn't preserved during fine-tuning, expect locally-fine but structurally aimless output.
- **Genre bleed.** Fine-tuning on new material (e.g. rock) without deliberate tagging/separation from what the base model already knows can blend styles rather than cleanly add a new one. Tag genre/style explicitly during fine-tuning if clean separation matters.
- **The taste model doesn't add capability.** It filters candidates the generator can already produce. If the generator can't make something, no amount of scoring makes it appear.

---

## Implementation status

Real, syntax-checked code exists for the pieces that don't require a GPU or model weights to write correctly. None of it has been run.

| File | Job | Runnable here? |
|---|---|---|
| `src/demucs/generate_agent.py` | Loads Stable Audio Open Small, generates a batch of candidate clips per (stem, genre, BPM), can pull genre/BPM pairs straight from `ebys.db` via `--seed-from-db`. Names output `GEN__<stem>_<timestamp>_<n>_<suffix>.wav`. | No — needs `pip install diffusers transformers accelerate soundfile`, a GPU, and an accepted license at huggingface.co/stabilityai/stable-audio-open-small. Written to be correct on your own machine. |
| `src/demucs/tag_generated.py` | Takes `generate_agent.py`'s manifest, writes matching `genres.json`/`downbeats.json` entries using the *known* generation conditioning (no re-running Essentia/madmom — the genre/BPM asked for is already ground truth). | Yes — pure JSON manipulation, no model needed. |
| `src/demucs/finetune_generative.py` | Builds an (audio, caption) manifest from `ebys.db` using the same caption format as `generate_agent.py`, loads the base model, sets up the training loop. | Manifest-building and `--dry-run`: yes. Actual training: no — needs GPU + the diffusers reference training loop wired in (flagged directly in the script; API moves too fast across diffusers versions to hardcode the loss function here). |
| `src/max/slicer.js` — `AGENT_MODE`, `setAgentMode()`, `filterPoolByAgentMode()` | Per-stem switch between real catalog material, `GEN__`-prefixed generated material, or `'blend'` (both pooled together, no source filtering at all). Filters the candidate pool *before* `applyLearnedRefusal()`/`scoreCandidate()` run — neither of those, nor `next()`, needed any changes for any of the three modes. In `'blend'`, a generated candidate has no separate accept/reject gate before it can be picked — the same live scoring and hard-exclusion that vet every real slice are the only filter it gets. | Yes — this is live Node code in the real engine, verified with `node --check`. Defaults every stem to `'remix'`, so behavior for anyone not using this feature is unchanged. |
| `src/demucs/ingest_generated.py` | Copies a batch's clips into `stems/htdemucs/`, runs `tag_generated.py`, refreshes `stream.txt`, runs `import_library.py`. The whole "get a manifest's clips as far as Python can take them" step, in one call. Idempotent — re-running on an already-ingested manifest just skips existing files and re-refreshes `stream.txt`/the DB import. | Yes — pure orchestration, no model needed. |
| `src/demucs/watch_generated.py` | Watches `data/generated/` (where `generate_agent.py` already writes) for new `manifest_*.json` files and runs `ingest_generated.py` on each as it lands, one at a time via a serial queue — the automatic counterpart to running step 4 below by hand. Doesn't touch Demucs (nothing to separate) or FluCoMa (still Max-only). Runnable as a `launchctl` daemon, same shape as `watch_demucs`'s — see `setup.sh` step 7. | Yes — pure orchestration + `watchdog`, no model needed. |
| `:setAgentMode <stem\|all> <remix\|generate\|blend>` (`src/tui/app.js`) | TUI command, passthrough to `slicer.js` exactly like `:setLearnedWeight`. `blend` pools real and generated candidates together instead of switching exclusively between them. | Yes. |

**The actual missing piece is entirely outside this codebase:** a machine with a GPU, Stable Audio Open's license accepted, and the time to run a real fine-tune. Everything on this side of that boundary is wired and ready.

## Path to a first real test

1. On a GPU machine: `pip install diffusers transformers accelerate soundfile torch`, accept the Stable Audio Open Small license on Hugging Face, `huggingface-cli login`.
2. `python3 generate_agent.py --stem vocals --seed-from-db /path/to/ebys.db --count 4 --dry-run` — sanity-check the planned captions before spending GPU time.
3. Drop `--dry-run`, generate a small batch.
4. Either run `python3 ingest_generated.py --manifest data/generated/manifest_....json` by hand, or leave `watch_generated.py` running (via `setup.sh`'s LaunchAgent, or `demucs_env/bin/python3 watch_generated.py` directly) and let it pick the new manifest up on its own — same result either way, since the watcher just calls the same script.
5. Run the normal Max analysis pass on the new WAVs (FluCoMa still has to compute real descriptors — not skippable, watched or not).
6. `:setAgentMode vocals generate` (or `blend`, to pool it with real material instead of switching to it exclusively) in the TUI, and confirm the vocals stem starts drawing from the generated pool.

## Open questions

- Fine-tuning infra: rent cloud GPU time vs. local hardware — not yet decided.
- Per-stem vs. single general model: start with one stem (vocals suggested) as a testbed before committing to Box 4.
- Real-time/live generation, in the sense of a diffusion pass reacting mid-bar to a Cricket command, is still a separate, harder problem this doc doesn't solve — inference takes real wall-clock time no matter how few steps, slice lookup doesn't. What `watch_generated.py` + `'blend'` mode do solve is the more useful version of "live": generation runs continuously in the background, ahead of need, topping up a pool that `'blend'` mixes straight into live playback — so playback never repeats and never runs dry, without any single generation call needing to be causal or unbounded in length.
