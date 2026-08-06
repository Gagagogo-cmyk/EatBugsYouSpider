#!/usr/bin/env python3
"""
EBYS — Prep a raw clip corpus for LoRA training

Takes a folder of original audio clips (any format ffmpeg can read — wav,
mp3, aiff, flac, m4a, etc.), not necessarily anything that's been through
EBYS's own ingestion pipeline (Demucs/genre_tagger/madmom), and turns it
into a clean, uniform set of WAV files ready for build_lora_dataset.py:

  - decodes every clip to 44.1kHz stereo WAV via ffmpeg (format-agnostic —
    doesn't matter what the source files are)
  - loudness-normalizes each clip to a consistent target (ffmpeg's
    loudnorm filter) so the LoRA doesn't learn "loud clip = the style"
  - splits anything longer than --max-clip-s into sequential chunks
    instead of throwing away everything past a cutoff — a short trailing
    remainder gets folded into the previous chunk rather than dropped
  - drops anything shorter than --min-clip-s outright (likely junk/silence,
    not a real clip)
  - logs anything ffmpeg/ffprobe can't decode to failed.txt instead of
    crashing partway through a run over thousands of files

Written for a corpus that has NOT been through EBYS's own pipeline —
no ebys.db lookups, no genre/BPM assumptions, works on any folder on disk.
If your clips already went through watch_demucs.py and have entries in
ebys.db, you don't need this script — point build_lora_dataset.py at the
existing stem WAVs directly.

Requires: ffmpeg + ffprobe on PATH (no Python audio libraries needed).

Usage:
  python3 prep_lora_corpus.py --source-dir /path/to/raw/clips \
      --out-dir ./lora_corpus_clean

  # smoke test on the first 20 files before committing to a run over
  # thousands:
  python3 prep_lora_corpus.py --source-dir /path/to/raw/clips \
      --out-dir ./lora_corpus_smoketest --limit 20

  # scan only, no conversion — just see what you're working with:
  python3 prep_lora_corpus.py --source-dir /path/to/raw/clips \
      --out-dir ./lora_corpus_clean --dry-run
"""

import os
import sys
import argparse
import subprocess
import shutil

AUDIO_EXTS = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg", ".wma", ".mp4", ".3gp", ".caf"}


def find_audio_files(source_dir):
    found = []
    for root, _, files in os.walk(source_dir):
        for f in files:
            if os.path.splitext(f)[1].lower() in AUDIO_EXTS:
                found.append(os.path.join(root, f))
    return sorted(found)


def probe_duration(path):
    """ffprobe duration in seconds, or None if the file can't be read."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except (ValueError, subprocess.TimeoutExpired, FileNotFoundError):
        return None


def safe_base_name(index, path):
    stem = os.path.splitext(os.path.basename(path))[0]
    name = f"clip_{index:06d}_{stem}"
    name = "".join(c if c.isalnum() or c in "_-" else "_" for c in name)
    return name[:120]


def plan_chunks(duration, max_clip_s, min_clip_s):
    """Sequential [start, length) windows covering `duration`. A trailing
    remainder shorter than min_clip_s is folded into the previous chunk
    (extending it) instead of being dropped or left as a too-short clip."""
    chunks = []
    start = 0.0
    while start < duration:
        length = min(max_clip_s, duration - start)
        if length >= min_clip_s:
            chunks.append([start, length])
        elif chunks:
            chunks[-1][1] = duration - chunks[-1][0]
        start += max_clip_s
    return chunks


def convert_chunks(path, out_dir, base_name, chunks, sample_rate, target_lufs, failed_log):
    written = []
    multi = len(chunks) > 1
    for idx, (start, length) in enumerate(chunks):
        out_name = f"{base_name}_{idx:03d}.wav" if multi else f"{base_name}.wav"
        out_path = os.path.join(out_dir, out_name)
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-ss", str(start), "-t", str(length), "-i", path,
            "-ar", str(sample_rate), "-ac", "2",
            "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
            out_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            err_lines = result.stderr.strip().splitlines()
            err = err_lines[-1] if err_lines else "unknown error"
            failed_log.write(f"{path}\t(chunk {idx})\t{err}\n")
            continue
        written.append(out_path)
    return written


def duration_histogram(durations):
    buckets = {"<5s": 0, "5-10s": 0, "10-30s": 0, "30-60s": 0, ">60s": 0}
    for d in durations:
        if d < 5:
            buckets["<5s"] += 1
        elif d <= 10:
            buckets["5-10s"] += 1
        elif d <= 30:
            buckets["10-30s"] += 1
        elif d <= 60:
            buckets["30-60s"] += 1
        else:
            buckets[">60s"] += 1
    return buckets


def main():
    ap = argparse.ArgumentParser(description="Normalize + chunk a raw clip corpus for LoRA training")
    ap.add_argument("--source-dir", required=True, help="folder of original clips (searched recursively)")
    ap.add_argument("--out-dir", required=True, help="where to write cleaned WAV files")
    ap.add_argument("--max-clip-s", type=float, default=30.0, help="split anything longer than this into sequential chunks")
    ap.add_argument("--min-clip-s", type=float, default=1.0, help="drop clips (or fold trailing remainders) shorter than this")
    ap.add_argument("--sample-rate", type=int, default=44100)
    ap.add_argument("--target-lufs", type=float, default=-16.0, help="integrated loudness target (LUFS) for ffmpeg's loudnorm filter")
    ap.add_argument("--limit", type=int, default=None, help="only process the first N files found (smoke test before a run over thousands)")
    ap.add_argument("--dry-run", action="store_true", help="scan and report without writing/converting anything")
    args = ap.parse_args()

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        sys.exit("ffmpeg/ffprobe not found on PATH. Install ffmpeg (e.g. `brew install ffmpeg`) before running this.")

    files = find_audio_files(args.source_dir)
    if args.limit:
        files = files[: args.limit]
    if not files:
        sys.exit(f"no audio files found under {args.source_dir} (looked for {sorted(AUDIO_EXTS)})")

    print(f"found {len(files)} candidate file(s) under {args.source_dir}")

    durations = {}
    undecodable = []
    for f in files:
        d = probe_duration(f)
        if d is None:
            undecodable.append(f)
        else:
            durations[f] = d

    if durations:
        hist = duration_histogram(durations.values())
        print(f"duration histogram: {hist}")
        print(f"total audio: {sum(durations.values()) / 3600:.2f} hours across {len(durations)} readable file(s)")
    if undecodable:
        print(f"warning: {len(undecodable)} file(s) ffprobe couldn't read — logged to failed.txt and skipped", file=sys.stderr)

    if args.dry_run:
        print("dry run — no conversion performed")
        return

    os.makedirs(args.out_dir, exist_ok=True)
    failed_path = os.path.join(args.out_dir, "failed.txt")
    total_written = 0
    total_dropped_short = 0

    with open(failed_path, "w") as failed_log:
        for path in undecodable:
            failed_log.write(f"{path}\t(unreadable by ffprobe)\n")

        for i, path in enumerate(files):
            if path not in durations:
                continue
            duration = durations[path]
            if duration < args.min_clip_s:
                total_dropped_short += 1
                continue

            base_name = safe_base_name(i, path)
            chunks = plan_chunks(duration, args.max_clip_s, args.min_clip_s)
            written = convert_chunks(path, args.out_dir, base_name, chunks,
                                      args.sample_rate, args.target_lufs, failed_log)
            total_written += len(written)
            if (i + 1) % 200 == 0:
                print(f"  ...{i + 1}/{len(files)} source files processed, {total_written} clips written so far")

    print(f"done: {total_written} normalized WAV clip(s) written to {args.out_dir}")
    if total_dropped_short:
        print(f"  ({total_dropped_short} file(s) dropped outright — shorter than --min-clip-s={args.min_clip_s}s)")
    print(f"failures logged to {failed_path} (empty file = everything decoded cleanly)")
    print("Next: python3 build_lora_dataset.py --clips-dir " + args.out_dir + " --out-dir ./my_data")


if __name__ == "__main__":
    main()
