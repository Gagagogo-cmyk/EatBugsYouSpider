#!/usr/bin/env python3
"""
EBYS — Generative Agent (Stable Audio 3 + User LoRA)

Offline batch generator. This does NOT run inside the real-time engine —
Max's FluCoMa buf~ analysis is what actually computes C/S/E/F/P/H/T, and
that only runs inside the Max patch. So this script's job is narrower and
more honest than "generate on demand": produce a batch of candidate clips
now, write them to disk using the same naming convention real stems use,
then let them go through the EXISTING import + Max analysis pipeline like
any newly added track. Once analyzed, slicer.js's AGENT_MODE switch (see
setAgentMode() there) can pick them the same way it picks real slices —
same scoreCandidate()/applyLearnedRefusal(), no special-cased code path.

Generated source tracks are named with a "GEN__" prefix so slicer.js can
tell them apart from real catalog material by sourceTrack name alone —
no schema change needed anywhere in the existing index/build pipeline.

Retargeted from the original Stable Audio Open Small integration to
Stable Audio 3 (see docs/instrument/USER_LORA.md) — this is the base
model a trained User LoRA (train_lora.py, in Stability's own repo) loads
onto. If you haven't trained a LoRA yet, this script still works as a
plain base-model generator; --lora-ckpt-path is optional.

Requires (this is a SEPARATE package from the old stable-audio-tools
integration — not pip-installable under a confirmed PyPI name at time of
writing):
  1. Clone https://github.com/Stability-AI/stable-audio-3
  2. Inside that clone: `uv sync` (base install is enough for inference;
     `--extra lora` is only needed for TRAINING a LoRA, not for loading
     one at inference time)
  3. Run this script from inside that repo's environment, e.g.:
       uv run python /path/to/EBYS/src/demucs/generate_agent.py --stem drums ...
     (or activate .venv and run python3 directly — either works, the
     point is stable_audio_3 has to be importable)
  4. medium/medium-base additionally need Flash Attention 2 — see the
     repo's README for a prebuilt-wheel install matching your CUDA/
     PyTorch/Python versions.

License gate — accept the Stability AI Community License on Hugging Face
BEFORE downloading, then `hf auth login`:
  post-trained (medium, small-music, small-sfx):
    https://huggingface.co/collections/stabilityai/stable-audio-3
  base checkpoints for LoRA (medium-base, small-music-base, small-sfx-base)
  and the SAME autoencoders live in the separate "Extra Models" collection:
    https://huggingface.co/collections/stabilityai/stable-audio-3-extra
Free for commercial use under $1M annual org revenue (Community License);
enterprise license required above that. Visiting the collection page
while logged in and submitting the gated-access form is required even if
you're already logged in — login alone does not grant access.

IMPORTANT — vocals: Stable Audio 3 (all current variants) generates
instrumental music and sound effects only. It does not generate singing,
lyrics, or voice — this is a stated design limitation, not a quality gap
that better prompting fixes. --stem vocals will still run, but treat its
output as texture/atmosphere at best, never as sung material. This is a
harder limitation than the previous Stable Audio Open Small integration
had (which could at least attempt vocal-adjacent material poorly);
Stable Audio 3's training data was filtered toward instrumental-only
content specifically.

Model tiers (medium/medium-base need a CUDA GPU + Flash Attention 2;
small-music/small-music-base/small-sfx/small-sfx-base run on CPU, slower):
  medium              — best quality, post-trained, use for plain (no-LoRA) generation
  medium-base         — un-post-trained checkpoint; train_lora.py's default target,
                         so LOAD YOUR TRAINED LORA ONTO THIS ONE, not "medium"
                         (the LoRA's delta was learned relative to this exact checkpoint)
  small-music         — CPU-capable, post-trained, music-focused
  small-music-base    — CPU-capable base checkpoint, pair with a LoRA trained on it
  small-sfx / -base   — sound-effect focused, not music — included for completeness,
                         not the right choice for EBYS's stems

Usage:
  # plain generation, no LoRA, seeded from the real catalog's genre/BPM
  python3 generate_agent.py --stem bass --seed-from-db ../../data/current/ebys.db \
      --count 4 --duration 12

  # with a trained User LoRA — note --model switches to the -base tier automatically
  # unless you override it
  python3 generate_agent.py --stem drums --genre "deep house" --bpm 124 \
      --lora-ckpt-path ../../lora_out/lora_step1000.safetensors \
      --invoke-phrase "ebys user style" --count 4 --duration 12

  # Cricket bridge calls this script with --style-fragment already built —
  # see cricket_bridge.py, you shouldn't normally need to type this by hand:
  python3 generate_agent.py --stem melody --seed-from-db ../../data/current/ebys.db \
      --style-fragment "brighter, more energy, driving" \
      --lora-ckpt-path ../../lora_out/lora_step1000.safetensors --count 4 --dry-run
"""

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime, timezone

# MODEL_PROFILES — one entry per Stable Audio 3 model id accepted by
# StableAudioModel.from_pretrained(). steps/cfg_scale defaults follow the
# repo's own inference.md guidance: post-trained checkpoints want
# steps=8/cfg_scale=1.0; "-base" checkpoints (what train_lora.py trains
# against, and what a LoRA should be loaded onto at inference) want
# steps=50/cfg_scale=7.0 instead — those parameters have NO effect on
# post-trained checkpoints per the same doc, so don't reuse one tier's
# recipe on the other.
#
# prompt_prefix: models trained on the AudioSparx dataset (every current
# Stable Audio 3 tier except the old "Open"/"Open Small" generation) are
# documented to prepend "TrackType: Music, VocalType: Instrumental" for
# music generation. Applied automatically for the music tiers below;
# left empty for the sfx tiers, which aren't music-prompted the same way.
MODEL_PROFILES = {
    "medium": {
        "requires_gpu": True, "max_duration_s": 380.0,
        "steps": 8, "cfg_scale": 1.0,
        "prompt_prefix": "TrackType: Music, VocalType: Instrumental",
        "note": "post-trained — best default quality, use without a LoRA",
    },
    "medium-base": {
        "requires_gpu": True, "max_duration_s": 380.0,
        "steps": 50, "cfg_scale": 7.0,
        "prompt_prefix": "TrackType: Music, VocalType: Instrumental",
        "note": "un-post-trained — train_lora.py's default target, load your LoRA here",
    },
    "small-music": {
        "requires_gpu": False, "max_duration_s": 120.0,
        "steps": 8, "cfg_scale": 1.0,
        "prompt_prefix": "TrackType: Music, VocalType: Instrumental",
        "note": "CPU-capable, post-trained, music-focused",
    },
    "small-music-base": {
        "requires_gpu": False, "max_duration_s": 120.0,
        "steps": 50, "cfg_scale": 7.0,
        "prompt_prefix": "TrackType: Music, VocalType: Instrumental",
        "note": "CPU-capable base checkpoint, pair with a LoRA trained on it",
    },
    "small-sfx": {
        "requires_gpu": False, "max_duration_s": 120.0,
        "steps": 8, "cfg_scale": 1.0,
        "prompt_prefix": "",
        "note": "sound-effect focused — not the right choice for EBYS stems",
    },
    "small-sfx-base": {
        "requires_gpu": False, "max_duration_s": 120.0,
        "steps": 50, "cfg_scale": 7.0,
        "prompt_prefix": "",
        "note": "sound-effect focused base checkpoint",
    },
}

STEM_LABEL = {
    "vocals": "vocals, lead voice, no instrumentation",
    "melody": "melodic instrument, lead melody, no drums no vocals",
    "bass":   "bassline, low end, no drums no vocals no lead melody",
    "drums":  "drum groove, percussion only, no melodic instruments no vocals",
}


def build_caption(stem, genre, bpm, invoke_phrase=None, style_fragment=None, prompt_prefix=None):
    """Text prompt for the model. Order: model's own required prefix (if any),
    LoRA invoke phrase, Cricket-derived style fragment, genre, stem isolation
    hint, BPM. Keeps stem isolation explicit since the base model is trained
    on full mixes/sound design content, not isolated stems — without this,
    generated 'vocals' will drag in phantom instrumentation, same reasoning
    as the original Stable Audio Open Small integration."""
    parts = []
    if prompt_prefix:
        parts.append(prompt_prefix)
    if invoke_phrase:
        parts.append(invoke_phrase)
    if style_fragment:
        parts.append(style_fragment)
    if genre:
        parts.append(genre)
    parts.append(STEM_LABEL.get(stem, stem))
    if bpm:
        parts.append(f"{int(bpm)} BPM")
    return ", ".join(parts)


def genres_and_bpm_from_db(db_path, genre_filter=None):
    """Pull (genre, bpm) pairs straight from EBYS's own already-computed
    Essentia/madmom metadata (genres / tracks tables — see import_library.py)
    instead of asking the caller to hand-specify every combination."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT t.name AS track_name, t.bpm AS bpm, g.genre AS genre
        FROM tracks t
        JOIN genres g ON g.track_id = t.id AND g.rank = 0
        WHERE t.bpm > 0
    """).fetchall()
    conn.close()
    pairs = []
    for r in rows:
        if genre_filter and genre_filter.lower() not in (r["genre"] or "").lower():
            continue
        pairs.append((r["genre"], r["bpm"]))
    return pairs


def resolve_model_id(args):
    """Pick the model tier. If the caller didn't pass --model explicitly,
    auto-select medium-base when a LoRA is being loaded (since that's what
    train_lora.py trains against by default) or medium otherwise. If they
    DID pass --model explicitly alongside a LoRA on a non-'-base' tier,
    warn rather than silently override — their checkpoint may genuinely be
    trained against a post-trained tier if they changed train_lora.py's
    own --model flag, this script can't know that for certain."""
    if args.model is not None:
        if args.lora_ckpt_path and not args.model.endswith("-base"):
            print(
                f"warning: loading a LoRA onto '{args.model}', which is a post-trained "
                "tier, not a '-base' one. train_lora.py's default target is the -base "
                "checkpoint family — if your LoRA was trained with defaults, its delta "
                "won't be calibrated against this checkpoint's weights. Pass "
                f"--model {args.model}-base unless you specifically trained against "
                "a post-trained tier.", file=sys.stderr,
            )
        return args.model
    if args.lora_ckpt_path:
        print("no --model given and a LoRA was provided — defaulting to 'medium-base' "
              "(train_lora.py's default training target). Override with --model if "
              "your LoRA was trained differently.", file=sys.stderr)
        return "medium-base"
    return "medium"


def load_model(model_id, lora_paths, lora_strength, lora_index, device_arg, model_half):
    try:
        from stable_audio_3 import StableAudioModel
    except ImportError as e:
        sys.exit(
            "Missing dependency: " + str(e) + "\n"
            "stable_audio_3 isn't importable in this environment. Clone "
            "https://github.com/Stability-AI/stable-audio-3, run `uv sync` inside "
            "it, and run this script from within that environment (see this "
            "script's module docstring for the exact steps).\n"
            "(and `hf auth login` after accepting the model license — see the "
            "license gate section in the docstring; small/medium and their "
            "-base variants are gated separately, accepting one doesn't grant "
            "the others)"
        )

    profile = MODEL_PROFILES[model_id]
    if not profile["requires_gpu"]:
        print(f"note: '{model_id}' can run on CPU, but generation will be slow "
              "(seconds to minutes per clip depending on duration/steps).", file=sys.stderr)

    print(f"loading model '{model_id}' ...")
    model = StableAudioModel.from_pretrained(model_id, device=device_arg, model_half=model_half)

    if lora_paths:
        print(f"loading LoRA(s): {lora_paths}")
        model.load_lora(lora_paths)
        if lora_strength is not None:
            model.set_lora_strength(lora_strength, lora_index=lora_index)

    return model


def generate_clip(model, prompt, negative_prompt, duration_s, max_duration_s,
                   steps, cfg_scale, seed, chunked_decode):
    duration_s = min(duration_s, max_duration_s)
    audio = model.generate(
        prompt=prompt,
        negative_prompt=negative_prompt,
        duration=duration_s,
        steps=steps,
        cfg_scale=cfg_scale,
        seed=seed,
        batch_size=1,
        chunked_decode=chunked_decode,
    )
    # (batch, channels, samples) -> (channels, samples), matches the repo's
    # own cli.py: torchaudio.save(path, audio[i].cpu(), sample_rate)
    return audio[0]


def write_wav(audio_tensor, sample_rate, out_path):
    import torch
    import torchaudio
    # The repo's own CLI saves model.generate()'s output directly with no
    # extra normalization. Adding a defensive clamp only (not a peak
    # normalize, which would change relative loudness across a batch) in
    # case a diffusion step nudges a sample slightly outside [-1, 1] —
    # torchaudio.save on some backends will clip/wrap ugly rather than error.
    arr = audio_tensor.detach().to("cpu").float().clamp(-1.0, 1.0)
    torchaudio.save(out_path, arr, sample_rate)


def main():
    ap = argparse.ArgumentParser(description="EBYS generative agent — batch-produce candidate stem clips via Stable Audio 3 (+ optional User LoRA)")
    ap.add_argument("--stem", required=True, choices=list(STEM_LABEL.keys()))
    ap.add_argument("--genre", default=None, help="e.g. 'deep house' — omit with --seed-from-db to sweep the catalog's own genres")
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--seed-from-db", default=None, help="path to ebys.db — pulls (genre, bpm) pairs from your own catalog metadata instead of one manual pair")
    ap.add_argument("--count", type=int, default=4, help="clips per (genre, bpm) pair")
    ap.add_argument("--duration", type=float, default=12.0, help="seconds per clip")
    ap.add_argument("--out-dir", default=None)

    ap.add_argument("--model", choices=list(MODEL_PROFILES.keys()), default=None,
                     help="model tier (see module docstring). Default: medium-base if "
                          "--lora-ckpt-path is set, else medium.")
    ap.add_argument("--device", default=None, help="cuda / mps / cpu — auto-detected if omitted")
    ap.add_argument("--no-half", action="store_true", help="disable half-precision (fp16) on CUDA")
    ap.add_argument("--steps", type=int, default=None, help="denoising steps — overrides the --model profile's default")
    ap.add_argument("--cfg-scale", type=float, default=None, help="classifier-free guidance scale — overrides the --model profile's default")
    ap.add_argument("--seed", type=int, default=-1, help="random seed, -1 = random (default)")
    ap.add_argument("--negative-prompt", default=None, help="qualities to steer away from, e.g. 'poor quality, distorted'")
    ap.add_argument("--chunked-decode", choices=["auto", "on", "off"], default="auto",
                     help="autoencoder decode strategy — 'auto' uses the model's own default")

    ap.add_argument("--lora-ckpt-path", action="append", dest="lora_ckpt_path", metavar="PATH",
                     help="path to a trained User LoRA .safetensors checkpoint. Repeat to stack multiple.")
    ap.add_argument("--lora-strength", type=float, default=None, help="LoRA strength (applied to all loaded LoRAs unless --lora-index is set)")
    ap.add_argument("--lora-index", type=int, default=None, help="target a specific LoRA by index when setting --lora-strength")
    ap.add_argument("--invoke-phrase", default=None, help="LoRA invoke phrase — should match build_lora_dataset.py's --caption used during training")
    ap.add_argument("--style-fragment", default=None, help="extra free-text descriptive words prepended into the caption — this is what cricket_bridge.py passes in")

    ap.add_argument("--dry-run", action="store_true", help="print what would be generated without loading the model")
    args = ap.parse_args()

    model_id = resolve_model_id(args)
    profile = MODEL_PROFILES[model_id]
    steps = args.steps if args.steps is not None else profile["steps"]
    cfg_scale = args.cfg_scale if args.cfg_scale is not None else profile["cfg_scale"]
    chunked_decode = {"auto": None, "on": True, "off": False}[args.chunked_decode]

    if args.stem == "vocals":
        print("warning: Stable Audio 3 does not generate singing/lyrics/voice at all "
              "(instrumental-only training data) — --stem vocals output will not be "
              "sung material. See this script's module docstring.", file=sys.stderr)

    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = args.out_dir or os.path.join(here, "..", "..", "data", "generated")
    out_dir = os.path.normpath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    if args.seed_from_db:
        pairs = genres_and_bpm_from_db(args.seed_from_db, genre_filter=args.genre)
        if not pairs:
            sys.exit(f"no (genre, bpm) pairs found in {args.seed_from_db} matching filter {args.genre!r}")
    else:
        if not args.genre or not args.bpm:
            sys.exit("either --seed-from-db, or both --genre and --bpm, are required")
        pairs = [(args.genre, args.bpm)]

    manifest = []
    jobs = []
    for genre, bpm in pairs:
        caption = build_caption(args.stem, genre, bpm,
                                 invoke_phrase=args.invoke_phrase,
                                 style_fragment=args.style_fragment,
                                 prompt_prefix=profile["prompt_prefix"])
        for i in range(args.count):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            track_name = f"GEN__{args.stem}_{stamp}_{i}"
            filename = f"{track_name}_{args.stem if args.stem != 'melody' else 'other'}.wav"
            jobs.append({
                "track_name": track_name,
                "filename": filename,
                "stem": args.stem,
                "genre": genre,
                "bpm": bpm,
                "caption": caption,
                "lora": args.lora_ckpt_path or [],
                "invoke_phrase": args.invoke_phrase,
                "style_fragment": args.style_fragment,
            })

    print(f"planned {len(jobs)} clip(s) across {len(pairs)} (genre, bpm) pair(s) → {out_dir}")
    print(f"  model={model_id}  steps={steps}  cfg_scale={cfg_scale}"
          f"  (profile defaults: steps={profile['steps']} cfg_scale={profile['cfg_scale']})")
    if args.lora_ckpt_path:
        print(f"  lora={args.lora_ckpt_path}  strength={args.lora_strength}")
    for j in jobs:
        print(f"  {j['filename']}  <- \"{j['caption']}\"")

    if args.dry_run:
        print("dry run — nothing generated")
        return

    model = load_model(model_id, args.lora_ckpt_path, args.lora_strength, args.lora_index,
                        args.device, model_half=not args.no_half)
    sample_rate = model.model.sample_rate

    for j in jobs:
        out_path = os.path.join(out_dir, j["filename"])
        print(f"generating: {j['filename']} ...")
        audio = generate_clip(model, j["caption"], args.negative_prompt, args.duration,
                               max_duration_s=profile["max_duration_s"],
                               steps=steps, cfg_scale=cfg_scale,
                               seed=args.seed, chunked_decode=chunked_decode)
        write_wav(audio, sample_rate, out_path)
        j["path"] = out_path
        j["duration_s"] = min(args.duration, profile["max_duration_s"])
        j["model"] = model_id
        j["steps"] = steps
        j["cfg_scale"] = cfg_scale
        j["generated_at"] = datetime.now(timezone.utc).isoformat()
        manifest.append(j)
        print(f"  -> wrote {out_path}")

    manifest_path = os.path.join(out_dir, f"manifest_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote {manifest_path}")
    print("Next: run tag_generated.py on this manifest to write genres.json/"
          "downbeats.json entries, then run the normal import + Max analysis "
          "pass so these clips enter the library index like any other track.")


if __name__ == "__main__":
    main()
