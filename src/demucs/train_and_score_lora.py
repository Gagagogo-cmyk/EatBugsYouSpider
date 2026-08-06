#!/usr/bin/env python3
"""
EBYS — Train + score + promote one User LoRA checkpoint

Alex: "I want the preparation of the file to be automatic, but the
training that takes hours to be manual. I want to enter a :command for it
to start." This is that command's other half — :lora train (app.js) spawns
this script. It does everything watch_lora.py used to do automatically
AFTER prep/build (which is now the only automatic part — see that script),
just triggered by a human typing the command instead of by a batch+idle
gate: train one LoRA checkpoint from data/lora_corpus/train/, score it
against data/lora_corpus/val/ (up to --max-attempts fresh self-test
batches, since one small sample can be noisy either direction — see the
module docstring history in watch_lora.py for why that retry exists), and
promote it to checkpoints/current.safetensors the moment any attempt
clears --overlap-threshold. If every attempt falls short, the checkpoint
is left in its own run_<timestamp>/ folder, untouched — :gen keeps using
whatever was live before, and `:lora promote <path>` is still there if you
want to override the score by ear.

This script does NOT touch raw/, clean/, or run prep/build — it assumes
data/lora_corpus/train/ and val/ already exist (watch_lora.py keeps them
current automatically as you drop files in raw/). It also does not manage
the shared training lock (LORA_LOCK_PATH) — the caller (app.js's :lora
train handler) acquires/releases that around this process, same as it
already did before this script existed.

Usage:
  python3 train_and_score_lora.py --caption "ebys user style"
  python3 train_and_score_lora.py --steps 1500 --max-attempts 5
"""

import os
import sys
import json
import time
import shutil
import argparse
import subprocess
from pathlib import Path

SRC_DIR = Path(__file__).parent
ROOT_DIR = SRC_DIR.parent.parent
LORA_DIR = ROOT_DIR / "data" / "lora_corpus"

VENV_PY = SRC_DIR / "demucs_env" / "bin" / "python3"        # compare_lora_output.py — stdlib+numpy only
STABLE_AUDIO_3_DIR = Path(os.environ.get("STABLE_AUDIO_3_DIR", str(Path.home() / "stable-audio-3")))
GENERATE_PY = STABLE_AUDIO_3_DIR / ".venv" / "bin" / "python3"  # train_lora.py + generate_agent.py — needs torch
TRAIN_SCRIPT = STABLE_AUDIO_3_DIR / "train_lora.py"
GENERATE_SCRIPT = SRC_DIR / "generate_agent.py"
COMPARE_SCRIPT = SRC_DIR / "compare_lora_output.py"

TORCH_ENV = dict(os.environ, PYTORCH_ENABLE_MPS_FALLBACK="1",
                  PATH="/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", ""))

STATE_PATH = LORA_DIR / ".watch_lora_state.json"  # shared with watch_lora.py/app.js — only read here, for 'caption'


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def run_step(label, argv, env=None):
    log(f"$ {' '.join(str(a) for a in argv)}")
    result = subprocess.run(argv, env=env)
    if result.returncode != 0:
        log(f"✗ {label} exited with code {result.returncode}")
    return result.returncode == 0


def newest_checkpoint(run_dir):
    candidates = sorted(run_dir.rglob("*.safetensors"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def main():
    ap = argparse.ArgumentParser(description="Train one User LoRA checkpoint, score it against val/, promote if it clears the bar")
    ap.add_argument("--data-dir", default=str(LORA_DIR / "train"))
    ap.add_argument("--val-dir", default=str(LORA_DIR / "val"))
    ap.add_argument("--checkpoint-root", default=str(LORA_DIR / "checkpoints"))
    ap.add_argument("--caption", default=None, help="invoke phrase for self-test generation — defaults to whatever build last used (see .watch_lora_state.json), then 'ebys user style'")
    ap.add_argument("--rank", default="16")
    ap.add_argument("--adapter-type", default="dora-rows")
    ap.add_argument("--exclude", default="seconds_total")
    ap.add_argument("--steps", default="1000")
    ap.add_argument("--max-attempts", type=int, default=3, help="independent fresh self-test batches to try before giving up on this checkpoint")
    ap.add_argument("--selftest-count-per-stem", type=int, default=4)
    ap.add_argument("--selftest-duration", default="15")
    ap.add_argument("--overlap-threshold", type=float, default=0.45)
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    val_dir = Path(args.val_dir)
    ckpt_root = Path(args.checkpoint_root)
    selftest_dir = LORA_DIR / "selftest"

    caption = args.caption
    if caption is None:
        caption = read_json(STATE_PATH, {}).get("caption", "ebys user style")

    if not data_dir.is_dir() or not any(data_dir.glob("*.wav")):
        sys.exit(f"no training pairs in {data_dir} — run :lora prep/build first (or drop files in raw/ and let the watcher catch up)")
    if not val_dir.is_dir() or not any(val_dir.glob("*.wav")):
        sys.exit(f"no held-out clips in {val_dir} — build_lora_dataset.py's --val-fraction produced nothing to score against")
    if not TRAIN_SCRIPT.exists():
        sys.exit(f"train_lora.py not found at {TRAIN_SCRIPT} — is STABLE_AUDIO_3_DIR set correctly? (see setup.sh section 4)")

    run_id = time.strftime("%Y%m%d_%H%M%S")
    run_dir = ckpt_root / f"run_{run_id}"
    log(f"=== training candidate {run_id} — {args.steps} steps, rank {args.rank}, {args.adapter_type}, exclude {args.exclude} ===")

    if not run_step("train", [str(GENERATE_PY), str(TRAIN_SCRIPT),
                               "--data_dir", str(data_dir), "--checkpoint_dir", str(run_dir),
                               "--rank", args.rank, "--adapter_type", args.adapter_type,
                               "--exclude", args.exclude, "--steps", args.steps],
                     env=TORCH_ENV):
        sys.exit("training failed — see output above (try running train_lora.py --help to check its actual flags)")

    candidate = newest_checkpoint(run_dir)
    if candidate is None:
        sys.exit(f"train_lora.py exited 0 but no .safetensors found under {run_dir}")
    log(f"checkpoint produced: {candidate}")

    attempt_scores = []
    accepted = False
    avg_overlap = None
    for attempt in range(1, args.max_attempts + 1):
        log(f"scoring attempt {attempt}/{args.max_attempts}...")

        if selftest_dir.exists():
            shutil.rmtree(selftest_dir)
        selftest_dir.mkdir(parents=True, exist_ok=True)
        for stem in ["vocals", "melody", "bass", "drums"]:
            if not run_step(f"self-test generate ({stem}, attempt {attempt})",
                             [str(GENERATE_PY), str(GENERATE_SCRIPT),
                              "--stem", stem, "--lora-ckpt-path", str(candidate),
                              "--invoke-phrase", caption,
                              "--count", str(args.selftest_count_per_stem), "--duration", args.selftest_duration,
                              "--out-dir", str(selftest_dir)],
                             env=TORCH_ENV):
                log(f"  (continuing — self-test generation for {stem} failed, other stems may still give a usable score)")

        report_path = LORA_DIR / f"eval_{run_id}_attempt{attempt}.json"
        if not run_step("compare", [str(VENV_PY), str(COMPARE_SCRIPT),
                                     "--real-dir", str(val_dir), "--generated-dir", str(selftest_dir),
                                     "--out-report", str(report_path), "--flag-percentile", "5.0"]):
            attempt_scores.append(None)
            continue

        report = read_json(report_path, {})
        overlaps = [report[k]["overlap"] for k in ("centroid_hz", "flatness", "rms_db")
                    if k in report and report[k].get("overlap") is not None]
        this_overlap = sum(overlaps) / len(overlaps) if overlaps else None
        flagged_n = len(report.get("flagged_near_duplicates", []))
        attempt_scores.append(this_overlap)
        log(f"  attempt {attempt} result: avg overlap={this_overlap} (of {len(overlaps)} metrics), "
            f"{flagged_n} near-duplicate flag(s) logged for the record (not gating)")

        if this_overlap is not None and this_overlap >= args.overlap_threshold:
            avg_overlap = this_overlap
            accepted = True
            break
        avg_overlap = this_overlap

    if accepted:
        ckpt_root.mkdir(parents=True, exist_ok=True)
        current_ckpt = ckpt_root / "current.safetensors"
        current_invoke = ckpt_root / "current_invoke.txt"
        shutil.copyfile(candidate, current_ckpt)
        current_invoke.write_text(caption)
        log(f"✓ promoted {candidate.name} → current.safetensors (overlap {avg_overlap:.2f} >= {args.overlap_threshold}, "
            f"attempt {len(attempt_scores)}/{args.max_attempts}) — :gen will use it starting next call")
        print(f"PROMOTED {candidate}")
    else:
        log(f"— not promoted after {len(attempt_scores)} attempt(s) (scores: {attempt_scores}, "
            f"need >= {args.overlap_threshold} on at least one) — :gen keeps using whatever was live before. "
            f"Checkpoint kept at {run_dir} — listen and `:lora promote {run_dir}/<file>.safetensors` by hand if you disagree.")
        print(f"NOT_PROMOTED {candidate}")


if __name__ == "__main__":
    main()
