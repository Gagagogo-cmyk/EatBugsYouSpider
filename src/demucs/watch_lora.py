#!/usr/bin/env python3
"""
EBYS — Watch LoRA raw/ and keep clean/train/val automatically in sync

Alex: "I want the preparation of the file to be automatic, but the
training that takes hours to be manual. I want to enter a :command for it
to start." This script is only the first half of that split — it watches
data/lora_corpus/raw/ and automatically re-runs prep (normalize/chunk) and
build (train/val split) whenever new files show up and settle down. It
does NOT train anything, ever. Training is :lora train (app.js), which
spawns train_and_score_lora.py — a human decision, on purpose, because
that step is hours long on this machine's own local GPU (Stable Audio 3
cloned to ~/stable-audio-3, MPS on Apple Silicon — see setup.sh section 4)
and shouldn't start without someone choosing the moment.

Why prep/build get to be fully automatic when training doesn't: they're
cheap (seconds to a couple minutes even over a large corpus, plain ffmpeg
+ file copying, no GPU) and idempotent — reprocessing the whole raw/ folder
on every batch just means train/val always reflect exactly what's
currently in raw/, with nothing to "undo" if it runs more often than
strictly necessary. Training a fresh LoRA is neither cheap nor
idempotent-feeling from the outside (it visibly changes what :gen sounds
like), which is the actual reason it stays gated behind a typed command
instead of a folder watch.

Trigger: not on every single file (that would mean re-running ffmpeg over
the whole corpus on every drop) — instead, once the set of "stable" files
in raw/ (mtime older than FILE_STABLE_S, so a file still mid-copy is never
counted) stops changing for DEBOUNCE_S, prep+build run once against
whatever's there. A shared lock file (LORA_LOCK_PATH) keeps this from
racing a manual :lora prep/build/train happening at the same moment.

Usage:
  python3 watch_lora.py
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path

SRC_DIR = Path(__file__).parent                       # EBYS/src/demucs/
ROOT_DIR = SRC_DIR.parent.parent                       # EBYS/
LORA_DIR = ROOT_DIR / "data" / "lora_corpus"
RAW_DIR = LORA_DIR / "raw"
CLEAN_DIR = LORA_DIR / "clean"
TRAIN_DIR = LORA_DIR / "train"
VAL_DIR = LORA_DIR / "val"
STATE_PATH = LORA_DIR / ".watch_lora_state.json"        # shared with app.js — only 'caption' + 'last_processed_count' here
LOCK_PATH = LORA_DIR / ".training.lock"                 # shared with app.js's :lora prep/build/train — same schema

VENV_PY = SRC_DIR / "demucs_env" / "bin" / "python3"     # prep/build — stdlib+ffmpeg only, no torch needed
PREP_SCRIPT = SRC_DIR / "prep_lora_corpus.py"
BUILD_SCRIPT = SRC_DIR / "build_lora_dataset.py"

AUDIO_EXTS = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg", ".wma", ".mp4", ".3gp", ".caf"}
FFMPEG_ENV = dict(os.environ, PATH="/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", ""))

POLL_INTERVAL_S = 30
FILE_STABLE_S = 5          # ignore files still mid-copy (mtime younger than this)
DEBOUNCE_S = 30             # wait this long with no NEW stable files before running prep+build
LOCK_STALE_S = 6 * 60 * 60   # a lock this old is assumed abandoned, not a real still-running job

CAPTION = "ebys user style"  # only used as the DEFAULT if nothing's been set yet — see updateLoraState()/state['caption']


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def count_stable_raw_files():
    if not RAW_DIR.is_dir():
        return 0
    now = time.time()
    n = 0
    for root, _, files in os.walk(RAW_DIR):
        for f in files:
            if os.path.splitext(f)[1].lower() not in AUDIO_EXTS:
                continue
            full = os.path.join(root, f)
            try:
                if now - os.path.getmtime(full) >= FILE_STABLE_S:
                    n += 1
            except OSError:
                pass
    return n


def read_lock():
    lock = read_json(LOCK_PATH, None)
    if lock is None:
        return None
    if time.time() * 1000 - lock.get("started", 0) > LOCK_STALE_S * 1000:
        return None
    return lock


def acquire_lock():
    write_json(LOCK_PATH, {"pid": os.getpid(), "source": "watch_lora", "started": int(time.time() * 1000)})


def release_lock():
    try:
        LOCK_PATH.unlink()
    except OSError:
        pass


def run_step(label, argv, env=None):
    log(f"$ {' '.join(str(a) for a in argv)}")
    result = subprocess.run(argv, env=env)
    if result.returncode != 0:
        log(f"✗ {label} exited with code {result.returncode}")
    return result.returncode == 0


def run_prep_and_build(stable_count):
    state = read_json(STATE_PATH, {})
    caption = state.get("caption", CAPTION)
    log(f"=== corpus changed ({stable_count} stable file(s) in raw/) — running prep + build (caption: \"{caption}\") ===")
    acquire_lock()
    try:
        if not run_step("prep", [str(VENV_PY), str(PREP_SCRIPT),
                                  "--source-dir", str(RAW_DIR), "--out-dir", str(CLEAN_DIR)],
                         env=FFMPEG_ENV):
            log("✗ prep failed — leaving train/val as they were")
            return
        if not run_step("build", [str(VENV_PY), str(BUILD_SCRIPT),
                                   "--clips-dir", str(CLEAN_DIR), "--out-dir", str(TRAIN_DIR),
                                   "--val-out-dir", str(VAL_DIR), "--caption", caption]):
            log("✗ build failed — leaving train/val as they were")
            return
        state["last_processed_count"] = stable_count
        state["caption"] = caption
        write_json(STATE_PATH, state)
        n_pairs = len([f for f in os.listdir(TRAIN_DIR) if f.lower().endswith(".wav")]) if TRAIN_DIR.is_dir() else 0
        log(f"✓ corpus ready — {n_pairs} training pair(s) in {TRAIN_DIR}. Run :lora train when you want to train.")
    finally:
        release_lock()


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    log(f"watching {RAW_DIR} — auto-runs prep+build {DEBOUNCE_S}s after new files stop arriving "
        f"(poll every {POLL_INTERVAL_S}s). Training is never automatic here — use :lora train.")

    last_seen_count = None
    last_seen_change_time = None

    while True:
        time.sleep(POLL_INTERVAL_S)

        current = count_stable_raw_files()
        if current != last_seen_count:
            last_seen_count = current
            last_seen_change_time = time.time()

        if last_seen_change_time is None:
            continue
        settled = (time.time() - last_seen_change_time) >= DEBOUNCE_S

        state = read_json(STATE_PATH, {})
        already_processed = current == state.get("last_processed_count", -1)
        if not settled or already_processed:
            continue

        if read_lock() is not None:
            continue  # a manual :lora prep/build/train is already using the corpus — try again next poll

        run_prep_and_build(current)


if __name__ == "__main__":
    main()
