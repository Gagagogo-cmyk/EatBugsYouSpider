# EBYS — Generative Layer (Roadmap)

Status: **not started**. This document is a plan, not a description of shipped code.

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

## Build order

### Box 1 — A model that can make sound at all
Fine-tune an existing pretrained generative audio model on EBYS's own catalog. Not built from scratch — see [Model choice](#model-choice) below for why. This is a new subsystem, with no connection to `train_bias.py` yet. Output: a component that takes an input and produces a playable clip.

### Box 2 — Feed generated audio back through the existing analysis pipeline
Run generated clips through `analyze_reader.js`, the same descriptor pipeline every real track already goes through (C/S/E/F/P/H/T via FluCoMa). Mostly validation: confirming descriptor computation doesn't care whether the waveform came from a mic or a model.

### Box 3 — Close the loop
Start with the cheap version: generate many candidates, score each with the existing taste model (`scoreCandidate` / `applyLearnedRefusal` in `slicer.js`), keep the best. This reuses code that already exists almost unchanged.

Only after that's proven, consider the harder version: fine-tune the generator itself using the taste score as a training reward — same shape as RLHF, applied to audio instead of text. Bigger engineering lift; not a v1 requirement.

### Box 4 — Per-stem routing (optional, later)
EBYS already treats each stem independently (`seg_voc`, `seg_mel`, `seg_bas`, `seg_drm` are separate in the schema; the mixer just recombines four independent streams). That means source strategy can be chosen per stem — e.g. vocals generated, melody/bass/drums still remixed from the real library. The mixing/playback layer doesn't need to change; it already expects a waveform per stem per slice regardless of origin.

Two real requirements, not blockers:
- Each stem on the generative path needs its own fine-tuned model — one generator can't credibly cover all instrument types.
- Generated audio has to land on the same bar/timing grid the mixer already expects.

Recommended: prove the pipeline on one stem before touching the rest.

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

## Open questions

- Fine-tuning infra: rent cloud GPU time vs. local hardware — not yet decided.
- Per-stem vs. single general model: start with one stem (vocals suggested) as a testbed before committing to Box 4.
- How generated candidates get tagged/logged in the session log for downstream use (scoring history, protocol accounting) — not yet designed.
