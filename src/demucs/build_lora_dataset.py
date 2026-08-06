#!/usr/bin/env python3
"""
EBYS — Build a Stable Audio 3 LoRA training folder from cleaned clips

Takes the WAV output of prep_lora_corpus.py (or any flat folder of WAVs)
and writes the audio+caption pairs Stable Audio 3's train_lora.py /
pre_encode_dataset.py actually expect:

    my_data/
      clip_000000.wav
      clip_000000.txt   <- caption
      clip_000001.wav
      clip_000001.txt
      ...

This corpus has NOT been through EBYS's own genre_tagger.py/madmom_tagger.py
(no ebys.db entries to pull genre/BPM from — see prep_lora_corpus.py's
docstring). So captions here are a single consistent trigger phrase across
the whole dataset by default, not a per-clip genre/BPM string the way
generate_agent.py builds captions for the real catalog. This matches
Stable Audio 3's own guidance: captions are how you INVOKE a LoRA at
inference time, not how sonic identity gets learned — that comes from the
audio itself. Keep the phrase short and consistent, and reuse the exact
same phrase later in generate_agent.py's prompts once the LoRA is trained
(--lora-ckpt-path + this phrase).

A held-out validation split is written to a SEPARATE directory
(--val-out-dir) that train_lora.py should never be pointed at — keep it
around for the descriptor-space comparison in Phase 4 of USER_LORA.md
(generate with the LoRA, run through EBYS's own FluCoMa analysis, compare
against real corpus including the held-out clips).

By default clips are symlinked (not copied) into --out-dir/--val-out-dir —
fast, no duplicate disk usage for thousands of files. Use --copy if you
need real files there (e.g. copying to another machine).

Requires: nothing beyond the Python standard library, unless --bpm-tag is
used (needs librosa — pip install librosa; slow over thousands of clips,
off by default).

Usage:
  python3 build_lora_dataset.py --clips-dir ./lora_corpus_clean \
      --out-dir ./my_data --val-out-dir ./my_data_val \
      --caption "ebys user style"
"""

import os
import sys
import argparse
import random
import shutil


def find_wavs(clips_dir):
    return sorted(
        os.path.join(clips_dir, f)
        for f in os.listdir(clips_dir)
        if f.lower().endswith(".wav")
    )


def detect_bpm(path):
    try:
        import librosa
    except ImportError:
        sys.exit(
            "librosa not installed — required for --bpm-tag.\n"
            "Run: pip install librosa\n"
            "Or drop --bpm-tag to use a caption with no per-clip BPM."
        )
    y, sr = librosa.load(path, sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # librosa can return a 0-d/1-element array depending on version
    return float(tempo if not hasattr(tempo, "__len__") else tempo[0])


def place_file(src_path, dst_path, copy):
    if copy:
        shutil.copy2(src_path, dst_path)
    else:
        if os.path.lexists(dst_path):
            os.remove(dst_path)
        os.symlink(os.path.abspath(src_path), dst_path)


def main():
    ap = argparse.ArgumentParser(description="Build a Stable Audio 3 LoRA data_dir (wav+txt pairs) from cleaned clips")
    ap.add_argument("--clips-dir", required=True, help="folder of WAV clips (e.g. prep_lora_corpus.py's --out-dir)")
    ap.add_argument("--out-dir", required=True, help="training data_dir to write (pass to train_lora.py / pre_encode_dataset.py)")
    ap.add_argument("--val-out-dir", default=None, help="if set, hold out --val-fraction of clips here instead of --out-dir, for post-training comparison — never point train_lora.py at this folder")
    ap.add_argument("--val-fraction", type=float, default=0.05, help="fraction of clips held out for --val-out-dir")
    ap.add_argument("--caption", default="ebys user style", help="caption written into every .txt file — this is the LoRA's invoke phrase (see docstring)")
    ap.add_argument("--bpm-tag", action="store_true", help="append a detected BPM to each clip's caption (needs librosa; slow over thousands of clips)")
    ap.add_argument("--limit", type=int, default=None, help="only use the first N clips found (smoke test)")
    ap.add_argument("--seed", type=int, default=0, help="random seed for the train/val split")
    ap.add_argument("--copy", action="store_true", help="copy audio files instead of symlinking (symlink is the default)")
    ap.add_argument("--dry-run", action="store_true", help="report counts without writing anything")
    args = ap.parse_args()

    wavs = find_wavs(args.clips_dir)
    if args.limit:
        wavs = wavs[: args.limit]
    if not wavs:
        sys.exit(f"no .wav files found in {args.clips_dir}")

    random.seed(args.seed)
    shuffled = wavs[:]
    random.shuffle(shuffled)
    n_val = int(len(shuffled) * args.val_fraction) if args.val_out_dir else 0
    val_set = set(shuffled[:n_val])

    print(f"found {len(wavs)} clip(s) in {args.clips_dir}")
    if args.val_out_dir:
        print(f"holding out {n_val} clip(s) ({args.val_fraction:.0%}) -> {args.val_out_dir}")
    print(f"caption: \"{args.caption}\"" + (" + detected BPM" if args.bpm_tag else ""))

    if args.dry_run:
        print("dry run — nothing written")
        return

    os.makedirs(args.out_dir, exist_ok=True)
    if args.val_out_dir:
        os.makedirs(args.val_out_dir, exist_ok=True)

    n_train = n_val_written = 0
    for i, src_path in enumerate(wavs):
        is_val = src_path in val_set
        target_dir = args.val_out_dir if is_val else args.out_dir
        base_name = f"clip_{i:06d}"
        dst_wav = os.path.join(target_dir, base_name + ".wav")
        dst_txt = os.path.join(target_dir, base_name + ".txt")

        place_file(src_path, dst_wav, args.copy)

        caption = args.caption
        if args.bpm_tag:
            bpm = detect_bpm(src_path)
            caption = f"{caption}, {bpm:.0f} BPM"
        with open(dst_txt, "w") as f:
            f.write(caption)

        if is_val:
            n_val_written += 1
        else:
            n_train += 1
        if (i + 1) % 500 == 0:
            print(f"  ...{i + 1}/{len(wavs)} written")

    print(f"done: {n_train} training pair(s) -> {args.out_dir}")
    if args.val_out_dir:
        print(f"      {n_val_written} held-out pair(s) -> {args.val_out_dir}")
    print("Next (optional, speeds up repeated training runs):")
    print("  pre_encode_dataset.py --data_dir " + args.out_dir + " --output_path ./latents_out")
    print("Then:")
    print("  train_lora.py --model medium-base --data_dir " + args.out_dir +
          " --rank 16 --adapter_type dora-rows --steps 1000 --exclude seconds_total")


if __name__ == "__main__":
    main()
