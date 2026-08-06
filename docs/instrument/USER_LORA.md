# EBYS — User LoRA (Sonic Identity Layer)

> This document designs the User LoRA — the layer that adapts a general open-source audio generator toward one user's sonic identity. It does not touch Cricket (behavior layer) or the taste model (critic layer), which are covered in `CRICKET.md` and `GENERATIVE_LAYER.md`. It updates the model choice made in `GENERATIVE_LAYER.md`: that doc was written against Stable Audio Open (1.0/Small), before Stable Audio 3 shipped with first-party LoRA tooling in May 2026. The generation → analyze → score → filter loop already scaffolded in `GENERATIVE_LAYER.md` (`generate_agent.py`, `tag_generated.py`, `slicer.js` `AGENT_MODE`) doesn't need to change — only the base model and the training entry point do.

---

## 1. Base model selection

Three architectural families are relevant: diffusion transformers over continuous audio latents (Stable Audio 3, Stable Audio Open), codec-transformer LMs over discrete audio tokens (MusicGen/AudioCraft), and hybrid LM+diffusion planners (ACE-Step). EnCodec and DAC aren't generators themselves — they're the tokenizers *inside* codec-transformer models like MusicGen, relevant to dataset format (§2), not to this comparison directly.

| Model | LoRA training | Personal identity learning | Non-text conditioning | Descriptor-control integration | Weights/code openness | Audio quality | License |
|---|---|---|---|---|---|---|---|
| **Stable Audio 3** (medium-base) | First-party (`train_lora.py`, DoRA/LoRA/LoRA-XS family) | Strong — LoRA touches the full DiT backbone, not just a text adapter | Yes today: duration (Fourier features + AdaLN), inpainting mask + reference audio. No raw descriptor-vector input yet, but the architecture already has a non-text conditioning path to extend | Best fit — AdaLN/cross-attention conditioning slots are the natural place to later inject FluCoMa descriptors as a custom conditioner | Open weights + training code (Stability AI Community License) | High — current generation, purpose-built for long-form on consumer hardware | Free commercial use under $1M annual org revenue; enterprise license above that |
| Stable Audio Open (1.0/Small) | Third-party only (diffusers-based, unofficial) | Moderate — same DiT family as Stable Audio 3 but no maintained first-party LoRA path | Duration only; Small tops out at 11s | Weak — no official conditioning extension points documented | Open weights + code | Good, but superseded by Stable Audio 3 | Same Community License family |
| **ACE-Step 1.5** | First-party, explicitly built for "a few songs → personal style" | Strong for style/timbre; LM planner stage adds structure (song blueprint) the pure diffusion models don't have | Prompt + metadata + lyrics-conditioned; less clean separation of "text" vs "control" than Stable Audio 3 | Weaker — the LM-planner-then-DiT hybrid is less transparent to hook a custom conditioner into | Open weights + code | Competitive with commercial models per published benchmarks; runs under 4GB VRAM | Open — check current repo terms before shipping commercially |
| MusicGen / AudioCraft (Meta) | Community scripts exist (`musicgen-dreamboothing`, LoRA on text encoder) | Genre/style adapters demonstrated; full timbral identity less proven | Weak — text/melody conditioning only, discrete token stream | Weak — would require retraining the tokenizer's downstream LM head | Code MIT; **pretrained weights CC BY-NC 4.0** | Good | **Non-commercial only** — already ruled out in `GENERATIVE_LAYER.md` since EBYS takes tips |
| Other diffusion audio (AudioLDM2, Riffusion, etc.) | Ad hoc, no maintained LoRA tooling for personalization | Weak — mostly trained for text-to-sound-effect or short loops | Text only | Weak | Mixed | Below current SOTA for music | Mixed |

**Recommendation: Stable Audio 3 (medium-base), with ACE-Step 1.5 as a standby if VRAM is the binding constraint.**

Reasons specific to EBYS: it's the only option with a maintained, first-party LoRA trainer that applies to the actual generative backbone (not just a text adapter), which is what "learn the sonic identity from audio examples, not judgment" requires. It already carries non-text conditioning (duration, inpainting) through the same AdaLN/cross-attention path that a future descriptor-vector conditioner would need — this is the cleanest on-ramp for eventually piping FluCoMa descriptors in directly, which is the stated long-term goal. Its autoencoder (SAME, 4096× downsampling) is built for long-form generation on consumer hardware, unlike Stable Audio Open Small's 11-second ceiling. And its licensing is the same shape already accepted in `GENERATIVE_LAYER.md`: free commercial use under $1M org revenue, which fits a tip-funded project. MusicGen stays ruled out for the same reason it was ruled out before — non-commercial weights conflict with a project that takes tips.

ACE-Step 1.5 is worth running in parallel as a second data point, not a replacement: its "few songs in, style out" design is closer to EBYS's actual use case out of the box, and under-4GB VRAM makes it viable on much cheaper hardware. Its weaker fit is the conditioning architecture — the LM-planner-then-DiT hybrid makes it harder to reason about *where* to inject a future descriptor conditioner compared to Stable Audio 3's more legible AdaLN/cross-attention stack.

---

## 2. Dataset format

**What the LoRA actually learns from:** during training, each (audio, conditioning) pair is run through the frozen base model's own denoising objective. The loss measures how well the model predicts the noise/velocity needed to reconstruct that specific audio, given that conditioning. Only the LoRA's low-rank matrices update — everything else (the DiT backbone, the SAME autoencoder, the frozen T5Gemma text encoder) stays fixed. So the LoRA learns *how this user's audio sits in the frozen model's latent space* — timbre, mix density, harmonic/rhythmic tendencies, arrangement character — as a small deformation of the base model's existing generative range. It does not learn anything from a caption's wording beyond activating pathways the frozen text encoder already understands. Captions are a switch, not a teacher.

| Format | What it contributes | Verdict for User LoRA |
|---|---|---|
| Raw audio only | Everything sonic identity actually comes from | Necessary but insufficient in practice — Stable Audio 3's training loop still expects a caption field per clip, even if minimal |
| Audio + captions | Lets you invoke the style with a short, consistent phrase at inference | Recommended, kept deliberately thin — see below |
| Audio + genre labels | A coarse invoke-phrase source (EBYS already has `genre_tagger.py` output for this) | Useful as caption material, not as a primary signal |
| Audio + descriptor vectors (FluCoMa C/S/E/F/P/H/T) | Not consumed by Stable Audio 3's current conditioner at all | Retain in the manifest as metadata for curation and for a future custom conditioner — not wired into today's training loop |
| Audio tokens (EnCodec/DAC) | Required input format for codec-transformer models (MusicGen-family) | **Not needed for Stable Audio 3** — SAME encodes to continuous latents, not discrete tokens. Only relevant if a MusicGen-family path is revisited later |
| Audio + descriptors + metadata | Best long-term shape: audio for identity, thin captions for invocation, descriptors + BPM/key/genre stored alongside for curation, evaluation (§4 in the roadmap), and future conditioning work | **Recommended dataset shape** |

Practical caption strategy: keep captions short, functional, and consistent — instrumentation and tempo/feel, not stylistic adjectives ("driving techno, four-on-the-floor, 128bpm" rather than "dark hypnotic masterpiece"). Stylistically loaded captions risk teaching the model to associate the *identity* with specific words rather than letting it emerge from the audio itself, and they fragment a small dataset across many distinct caption embeddings. EBYS already has the caption ingredients (`genres.json`, `downbeats.json` BPM) from the existing pipeline — reuse the same caption-building approach `GENERATIVE_LAYER.md` already specified for `finetune_generative.py`.

---

## 3. Corpus preparation

```
Original tracks
   │
   ▼
segmentation (bar-aligned, via existing downbeats.json / madmom)
   │
   ▼
loudness normalization (consistent LUFS target across the corpus)
   │
   ▼
descriptor extraction (existing FluCoMa chain — unchanged)
   │
   ▼
manifest assembly: audio path + caption + descriptor/metadata sidecar
   │
   ▼
training dataset (Stable Audio 3 train_lora.py data_dir format)
```

Nothing here requires new infrastructure — every stage left of "manifest assembly" is a pipeline EBYS already runs (`watch_demucs.py` → `madmom_tagger.py` → `genre_tagger.py` → FluCoMa via `analyze_reader.js`/`slice_writer.js`). The only new component is a script that reads `ebys.db` and writes Stable Audio 3's expected manifest format, which is the same shape `finetune_generative.py` was already building for the old plan — just retargeted.

**How many hours of audio:** Stable Audio 3's own quick-start puts the *technical minimum* at 20–50 clips. That's enough to get a LoRA that trains without erroring, not enough to reliably capture a personal identity distinct from the base model's prior. For an individual user's back catalog, a practical target is on the order of **1–3 hours of source audio**, segmented into several hundred clips. Because LoRA only trains a small number of low-rank parameters (not the full model), returns diminish well before "hundreds of hours" — this isn't a from-scratch training regime. If the catalog is smaller than that, it's still worth trying (LoRA degrades gracefully), but expect the base model's prior to dominate more.

**Full tracks vs. slices:** use musically coherent segments, not arbitrary crops. EBYS already has the exact tool needed for this — `downbeats.json` — so segment on bar boundaries the same way `slicer.js` snaps playback starts, rather than fixed-duration windows that can cut mid-phrase. Mid-phrase cuts teach the model that incoherent transitions are normal, which actively works against "preserve musical identity." Vary segment length within the model's supported duration range (Stable Audio 3 conditions explicitly on duration, so mixing lengths is not a problem the way it might be for a fixed-context model) rather than standardizing on one clip length — this gives the LoRA more of the corpus's actual structural variety to learn from.

**Avoiding overfitting:**
- Keep rank low (8–16) and step count modest (the official quick-start defaults to 1000 steps) — a LoRA with too much capacity relative to a small personal dataset will memorize specific clips rather than generalize a style.
- Cap the number of clips drawn from any single source track so one track can't dominate the gradient signal.
- Hold out a small validation subset (untrained-on clips) purely for listening comparisons in Phase 4 of the roadmap.
- Use `dora-rows` (the default adapter) — the docs note it's the "paper-correct" magnitude-decomposition variant and tends to generalize better than plain LoRA on small datasets.
- Exclude the `seconds_total` conditioner from LoRA (`--exclude seconds_total`) — this is a documented Stable Audio 3 footgun on small datasets: without excluding it, the duration conditioner can get "hijacked" and start encoding dataset-specific shortcuts instead of just duration.
- Checkpoint at intervals and listen, rather than training to a fixed step count blind — stop at the first sign of memorized artifacts or collapse toward a narrow subset of timbres.

**Preserving musical identity:** the identity lives in the audio, not the caption, so protect that path — don't over-caption with stylistic language that could let the model shortcut to "generic techno" instead of "this user's techno." Keep the corpus's actual sonic range represented (don't only submit the most polished tracks; the goal is the whole identity, including rougher or more experimental material if that's part of the user's world).

---

## 4. LoRA mechanics

**Where adapters are inserted:** into every `Linear` and `Conv1d` layer matched by the include/exclude filters, inside the diffusion transformer backbone (attention projections like `self_attn.to_qkv`, MLP layers, timestep embedding) and, separately, inside the *trainable* parts of the conditioner stack (e.g. the `seconds_total` embedder). The frozen T5Gemma text encoder and the SAME autoencoder are outside this — they're never modified, LoRA or otherwise.

**Which layers are modified:** controllable via `--include`/`--exclude` substring or bracket-range filters against each module's fully-qualified name (e.g. `transformer.layers[0-11]` for only the first 12 blocks, or `--include transformer.layers` to skip the conditioner entirely). This is a real design knob for EBYS: restricting LoRA to later transformer layers biases the adapter toward fine sonic detail while leaving early layers (closer to global structure) untouched, or vice versa — worth experimenting with once a baseline LoRA exists.

**What parameters are trained:** only the LoRA (or DoRA/BoRA) low-rank matrices — for standard LoRA, an `A` matrix (rank × fan_in) and `B` matrix (fan_out × rank) per adapted layer, initialized so the adapter starts as a no-op (`B` = zeros). For the default `dora-rows` adapter, an additional per-output-neuron magnitude vector is trained alongside the same low-rank pair.

**What remains frozen:** the entire base diffusion transformer's original weights, the SAME autoencoder (encoder and decoder), and the T5Gemma text encoder. Nothing about the base generator's general capability is touched — only a small additive deformation is layered on top, which is exactly the separation the project's conceptual design calls for (LoRA modifies the generator's *output character*, never learns taste or judgment).

**Typical rank/alpha:** rank 16 is the documented default and a reasonable starting point; alpha defaults to equal rank (giving a 1.0 effective scale). Lower rank (8, or LoRA-XS at effectively rank² trainable parameters per layer) trades expressiveness for a smaller, more generalizable adapter — worth trying on a corpus in the 1–3 hour range where overfitting risk is real.

**Expected training size/time:** checkpoints save as `.safetensors` in the 50–200MB range regardless of corpus size (checkpoint size is a function of rank and included layers, not dataset size). VRAM: roughly 6.5GB for the medium model at standard precision, down to ~5.5GB with `bf16` + LoRA-XS; the small model needs roughly 2.5GB/2GB under the same conditions — all fit on a single consumer GPU. Wall-clock time isn't published by Stability AI as a fixed number and depends heavily on GPU and batch size; treat the documented 1000-step default as the benchmark to run once on whatever hardware is actually used, and calibrate from there, the same "verify on real hardware before trusting an estimate" posture `GENERATIVE_LAYER.md` already takes with the older plan.

---

## 5. Tools

| Tool | Fit for EBYS |
|---|---|
| **Stable Audio 3's own repo** (`train_lora.py`, built on `stable-audio-tools`) | **Primary recommendation.** Purpose-built for exactly this task — audio-native, first-party, actively maintained, ships with a Gradio inference UI that already supports per-LoRA strength/interval/layer controls (useful later for blending a User LoRA against generation-time constraints from Cricket or the taste model) |
| **Underfit** (dada-bots, referenced directly from Stability AI's own LoRA docs) | Third-party orchestration layer for managing multiple LoRA training runs with a dashboard — worth adopting once past the first successful LoRA, not needed for the first one |
| **Hugging Face PEFT + Diffusers** | Generic, well-documented `LoraConfig` machinery, but audio-specific training examples are thin compared to image/video — would mean writing a custom training loop against Stable Audio 3's own model classes. More portable across models in principle, more DIY work in practice. Skip unless the first-party trainer proves insufficient |
| **AudioCraft / Dora trainer + community MusicGen LoRA scripts** | Only relevant if the MusicGen path is revisited; blocked today by the non-commercial weight license already flagged in `GENERATIVE_LAYER.md` |
| **ACE-Step's own repo** | Has its own built-in LoRA training tools, explicitly designed for "few songs → personal style." Worth running as a parallel/comparison track given the low VRAM floor, even with Stable Audio 3 as primary |

**Recommended stack:** Stable Audio 3 medium-base + its native `train_lora.py` (`dora-rows`, rank 16, `--exclude seconds_total`) as the core trainer; a CUDA GPU (rented, since EBYS's existing `demucs_env`/analysis pipeline already runs on the user's own machine and a training GPU is a separate, occasional cost as `GENERATIVE_LAYER.md` already anticipated); `safetensors` for checkpoint interchange; and the existing EBYS Python pipeline (`ebys.db`, `genres.json`, `downbeats.json`) repurposed to emit Stable Audio 3's manifest format, reusing the shape already sketched in `finetune_generative.py` rather than building a new ingestion path.

---

## 6. Complete implementation roadmap

**Phase 1 — Prepare corpus.** Segment the catalog into bar-aligned clips using existing `downbeats.json`, normalize loudness to a consistent target, confirm every clip already has FluCoMa descriptors (existing pipeline), write a manifest script (`build_lora_manifest.py`, sibling to `finetune_generative.py`) that pulls audio path + thin caption (genre + BPM, reusing `genre_tagger.py`/`madmom_tagger.py` output) + descriptor sidecar from `ebys.db`. Cap clips per source track. Hold out a validation subset.

**Phase 2 — Choose base model.** Pull Stable Audio 3 medium-base weights, accept the Community License, confirm VRAM headroom on the target GPU (fall back to `bf16` + LoRA-XS, or to the small variant, or to ACE-Step 1.5 if still constrained). This replaces the "download Stable Audio Open" step in `GENERATIVE_LAYER.md`'s old build order.

**Phase 3 — Train first User LoRA.** Run `train_lora.py` with `--rank 16 --adapter_type dora-rows --exclude seconds_total --steps 1000` as the starting configuration. Checkpoint at intervals; listen before committing to the full step count.

**Phase 4 — Evaluate against corpus identity.** Two checks, both buildable from infrastructure EBYS already has: blind listening comparison against real catalog material, and a descriptor-space comparison — run generated clips back through the existing `analyze_reader.js`/FluCoMa chain (same as any new track) and compare the resulting C/S/E/F/P/H/T/tension distributions against the real corpus's distributions. A LoRA that's actually captured the identity should produce generated clips whose descriptor spread overlaps the real corpus; a collapsed or overfit LoRA will show a narrow spike (near-duplicate outputs) or a wide mismatch (identity not captured). Also explicitly check for near-verbatim reproduction of training clips — a known LoRA overfitting failure mode.

**Phase 5 — Integrate with Cricket.** This is the honest gap: Stable Audio 3 doesn't accept descriptor vectors as a native conditioning input today, so Cricket's structured control signal (`energy↑, density↑, brightness↑, spectral movement↑`) can't yet steer generation directly and continuously the way it steers slice selection in `slicer.js`. The near-term bridge is two-step — Cricket's structured signal maps to (a) generation parameters the model *does* accept (duration, caption/prompt construction, batch size) and (b) post-generation selection among a batch of candidates, scored by descriptor match against Cricket's target direction, reusing the same distance-scoring logic `slicer.js` already has for real slices. True continuous descriptor-conditioned generation — Cricket directly steering the diffusion process, not just picking from a batch afterward — is a real Phase 7 stretch goal: it needs a custom conditioner trained into (or alongside) the LoRA, hooked into the same AdaLN/cross-attention path duration and inpainting already use. Worth planning for, not assuming as delivered here.

**Phase 6 — Connect to Taste Model / Taste Filter.** Reuse the loop already scaffolded in `GENERATIVE_LAYER.md` almost unchanged: generate with the LoRA-adapted Stable Audio 3 → analyze via the existing FluCoMa pipeline (same offline import step any new track goes through, not an inline shortcut) → score via `train_bias.py` → filter via `scoreCandidate`/`applyLearnedRefusal` → accepted candidates land in the archive/corpus, rejected ones don't. The only change from the existing plan is which model produced the candidate in the first place.

---

## Summary of what changed from the existing plan

`GENERATIVE_LAYER.md` chose Stable Audio Open for its open weights and commercial-friendly license, with a diffusers-based fine-tune as the (not-yet-built) training path. Stable Audio 3, released after that doc was written, keeps the same license shape while adding a first-party, audio-native LoRA trainer — closing the exact gap `GENERATIVE_LAYER.md` flagged as "needs the diffusers reference training loop wired in (API moves too fast to hardcode here)." The recommendation here is to retarget `finetune_generative.py` at Stable Audio 3's `train_lora.py` rather than continuing to build a custom diffusers loop, and to keep everything downstream of the generator (analysis, taste scoring, filtering, archive) exactly as already designed.
