#!/usr/bin/env python3
"""
EBYS — Generative Agent (Stable Audio Open Small wrapper)

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

Requires (NOT yet in demucs_env — install before running):
  pip install diffusers transformers accelerate soundfile

Requires a GPU for anything beyond trivial clip lengths/counts, and requires
accepting Stable Audio Open's license gate on Hugging Face
(https://huggingface.co/stabilityai/stable-audio-open-small) with a logged-in
`huggingface-cli login` token before the model will download.

This script cannot be run inside the sandbox this was written in — no GPU,
no accepted model license, no installed diffusers stack. It's written to be
correct and runnable on your own machine / rented GPU instance.

Usage:
  python3 generate_agent.py --stem vocals --genre "deep house" --bpm 124 \
      --count 8 --duration 12 --out-dir ../../data/generated

  python3 generate_agent.py --stem bass --genre "downtempo" --bpm 90 \
      --count 4 --seed-from-db ../../data/current/ebys.db
"""

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime, timezone

MODEL_ID = "stabilityai/stable-audio-open-small"

STEM_LABEL = {
    "vocals": "vocals, lead voice, no instrumentation",
    "melody": "melodic instrument, lead melody, no drums no vocals",
    "bass":   "bassline, low end, no drums no vocals no lead melody",
    "drums":  "drum groove, percussion only, no melodic instruments no vocals",
}


def build_caption(stem, genre, bpm):
    """Text prompt for the model. Keeps stem isolation explicit in the prompt
    since Stable Audio Open was trained on full mixes, not isolated stems —
    without this, generated 'vocals' will drag in phantom instrumentation."""
    parts = []
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


def load_pipeline():
    try:
        import torch
        from diffusers import StableAudioPipeline
    except ImportError as e:
        sys.exit(
            "Missing dependency: " + str(e) + "\n"
            "Run: pip install diffusers transformers accelerate soundfile torch\n"
            "(and `huggingface-cli login` after accepting the model license at\n"
            " https://huggingface.co/stabilityai/stable-audio-open-small)"
        )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("warning: no CUDA GPU detected — generation will be slow "
              "(minutes per clip rather than seconds). Fine for a smoke test, "
              "not for a real batch run.", file=sys.stderr)
    pipe = StableAudioPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.float16 if device == "cuda" else torch.float32)
    pipe = pipe.to(device)
    return pipe


def generate_clip(pipe, prompt, duration_s, seed=None):
    import torch
    generator = torch.Generator(device=pipe.device).manual_seed(seed) if seed is not None else None
    result = pipe(
        prompt=prompt,
        negative_prompt="low quality, distorted, clipping",
        num_inference_steps=8,          # Stable Audio Open Small's distilled 8-step config
        audio_end_in_s=duration_s,
        num_waveforms_per_prompt=1,
        generator=generator,
    )
    return result.audios[0]  # torch tensor, shape (channels, samples)


def write_wav(audio_tensor, sample_rate, out_path):
    import soundfile as sf
    import numpy as np
    arr = audio_tensor.detach().cpu().numpy()
    if arr.ndim == 2:
        arr = arr.T  # (samples, channels) for soundfile
    sf.write(out_path, arr, sample_rate)


def main():
    ap = argparse.ArgumentParser(description="EBYS generative agent — batch-produce candidate stem clips via Stable Audio Open Small")
    ap.add_argument("--stem", required=True, choices=list(STEM_LABEL.keys()))
    ap.add_argument("--genre", default=None, help="e.g. 'deep house' — omit with --seed-from-db to sweep the catalog's own genres")
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--seed-from-db", default=None, help="path to ebys.db — pulls (genre, bpm) pairs from your own catalog metadata instead of one manual pair")
    ap.add_argument("--count", type=int, default=4, help="clips per (genre, bpm) pair")
    ap.add_argument("--duration", type=float, default=12.0, help="seconds per clip")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--dry-run", action="store_true", help="print what would be generated without loading the model")
    args = ap.parse_args()

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
        caption = build_caption(args.stem, genre, bpm)
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
            })

    print(f"planned {len(jobs)} clip(s) across {len(pairs)} (genre, bpm) pair(s) → {out_dir}")
    for j in jobs:
        print(f"  {j['filename']}  <- \"{j['caption']}\"")

    if args.dry_run:
        print("dry run — nothing generated")
        return

    pipe = load_pipeline()
    sample_rate = pipe.vae.config.sampling_rate if hasattr(pipe, "vae") else 44100

    for j in jobs:
        out_path = os.path.join(out_dir, j["filename"])
        print(f"generating: {j['filename']} ...")
        audio = generate_clip(pipe, j["caption"], args.duration)
        write_wav(audio, sample_rate, out_path)
        j["path"] = out_path
        j["duration_s"] = args.duration
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
