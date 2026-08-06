#!/usr/bin/env python3
"""
EBYS — LoRA pipeline TUI

Interactive front-end over the manual LoRA pipeline described in
docs/instrument/USER_LORA.md (§3, §6). Nothing here changes what the
pipeline does — it wraps the same scripts you'd otherwise call by hand
(prep_lora_corpus.py, build_lora_dataset.py, Stable Audio 3's own
train_lora.py, compare_lora_output.py) in a numbered menu, remembers your
paths/params between runs, and shows you a status dashboard (clip counts
at each stage) before every action. Every step still runs one at a time,
still shows you the exact command before it runs, and still requires you
to confirm — dumping files into lora_corpus/raw does not trigger anything
by itself, and this tool doesn't change that.

Deliberately not a curses full-screen TUI: training and ffmpeg both print
long-running progress to stdout, and a numbered menu lets that stream
straight to the terminal instead of fighting a screen redraw. "TUI" here
means "menu-driven terminal tool," not an ncurses app.

Stdlib only, matching the rest of this pipeline's no-extra-deps stance.

Usage:
  python3 lora_tui.py
  python3 lora_tui.py --root /path/to/data/lora_corpus   # override default root
"""

import os
import sys
import json
import shutil
import argparse
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "data", "lora_corpus"))
AUDIO_EXTS = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg", ".wma", ".mp4", ".3gp", ".caf"}


# ── small helpers ─────────────────────────────────────────────────────────

def prompt(text, default=None):
    suffix = f" [{default}]" if default not in (None, "") else ""
    val = input(f"{text}{suffix}: ").strip()
    return val if val else (default or "")


def prompt_bool(text, default=True):
    d = "Y/n" if default else "y/N"
    val = input(f"{text} [{d}]: ").strip().lower()
    if not val:
        return default
    return val.startswith("y")


def count_files(d, exts=None):
    if not os.path.isdir(d):
        return 0
    n = 0
    for root, _, files in os.walk(d):
        for f in files:
            if exts is None or os.path.splitext(f)[1].lower() in exts:
                n += 1
    return n


def count_pairs(d):
    """wav+txt pairs, as build_lora_dataset.py / train_lora.py expect."""
    if not os.path.isdir(d):
        return 0
    return len([f for f in os.listdir(d) if f.lower().endswith(".wav")])


def latest_mtime_str(d, exts=None):
    if not os.path.isdir(d):
        return None
    newest = None
    for root, _, files in os.walk(d):
        for f in files:
            if exts and os.path.splitext(f)[1].lower() not in exts:
                continue
            p = os.path.join(root, f)
            m = os.path.getmtime(p)
            if newest is None or m > newest:
                newest = m
    if newest is None:
        return None
    import datetime
    return datetime.datetime.fromtimestamp(newest).strftime("%Y-%m-%d %H:%M")


def run_cmd(cmd):
    """Print the exact command, confirm, then run with output streamed live."""
    print("\n  " + " ".join(str(c) for c in cmd) + "\n")
    if not prompt_bool("Run this?", default=True):
        print("skipped.")
        return None
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"\n[!] exited with code {result.returncode}")
    return result.returncode


def load_config(root):
    path = os.path.join(root, ".lora_tui_config.json")
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_config(root, cfg):
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, ".lora_tui_config.json")
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)


# ── status dashboard ─────────────────────────────────────────────────────

def paths_for(root):
    return {
        "raw": os.path.join(root, "raw"),
        "clean": os.path.join(root, "clean"),
        "train": os.path.join(root, "train"),
        "val": os.path.join(root, "val"),
        "generated": os.path.join(root, "generated"),
    }


def print_status(root, cfg):
    p = paths_for(root)
    raw_n = count_files(p["raw"], AUDIO_EXTS)
    clean_n = count_files(p["clean"], {".wav"})
    train_n = count_pairs(p["train"])
    val_n = count_pairs(p["val"])
    gen_n = count_files(p["generated"], {".wav"})
    ckpt_dir = cfg.get("checkpoint_dir")
    ckpt_n = count_files(ckpt_dir, {".safetensors"}) if ckpt_dir else 0
    ckpt_latest = latest_mtime_str(ckpt_dir, {".safetensors"}) if ckpt_dir else None
    ffmpeg_ok = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None

    print("\n" + "=" * 60)
    print(f"EBYS LoRA pipeline — {root}")
    print("=" * 60)
    print(f"  1. raw      {p['raw']}")
    print(f"       {raw_n} source file(s)" + ("" if ffmpeg_ok else "   [!] ffmpeg/ffprobe not on PATH"))
    print(f"  2. clean    {p['clean']}")
    print(f"       {clean_n} normalized clip(s)")
    print(f"  3. train    {p['train']}")
    print(f"       {train_n} wav+caption pair(s)")
    print(f"     val      {p['val']}  (held out, never trained on)")
    print(f"       {val_n} pair(s)")
    print(f"  4. train_lora.py checkpoints  {ckpt_dir or '(not set — see Train menu)'}")
    if ckpt_dir:
        print(f"       {ckpt_n} .safetensors checkpoint(s)" + (f", latest {ckpt_latest}" if ckpt_latest else ""))
    print(f"  5. generated {p['generated']}")
    print(f"       {gen_n} clip(s) to compare against the corpus")
    print("=" * 60)


# ── actions ───────────────────────────────────────────────────────────────

def action_prep(root, cfg):
    p = paths_for(root)
    print("\n-- Prep corpus (raw -> clean: decode, loudness-normalize, chunk) --")
    source = prompt("Source dir (raw clips)", cfg.get("prep_source", p["raw"]))
    out = prompt("Out dir (cleaned WAVs)", cfg.get("prep_out", p["clean"]))
    dry = prompt_bool("Dry run first (scan + duration histogram, no writes)?", default=True)
    max_clip = prompt("Max clip length (s)", cfg.get("max_clip_s", "30"))
    min_clip = prompt("Min clip length (s)", cfg.get("min_clip_s", "1"))
    lufs = prompt("Target loudness (LUFS)", cfg.get("target_lufs", "-16"))
    limit = prompt("Limit to first N files (blank = all)", "")

    base_cmd = [
        sys.executable, os.path.join(HERE, "prep_lora_corpus.py"),
        "--source-dir", source, "--out-dir", out,
        "--max-clip-s", max_clip, "--min-clip-s", min_clip,
        "--target-lufs", lufs,
    ]
    if limit:
        base_cmd += ["--limit", limit]

    if dry:
        run_cmd(base_cmd + ["--dry-run"])
        if not prompt_bool("Looked right — run for real now?", default=True):
            cfg.update(prep_source=source, prep_out=out, max_clip_s=max_clip, min_clip_s=min_clip, target_lufs=lufs)
            return cfg

    run_cmd(base_cmd)
    cfg.update(prep_source=source, prep_out=out, max_clip_s=max_clip, min_clip_s=min_clip, target_lufs=lufs)
    return cfg


def action_build(root, cfg):
    p = paths_for(root)
    print("\n-- Build dataset (clean -> train/val: wav+caption pairs) --")
    clips = prompt("Clips dir (cleaned WAVs)", cfg.get("build_clips", p["clean"]))
    out = prompt("Train data_dir (point train_lora.py here)", cfg.get("build_out", p["train"]))
    val_out = prompt("Val out dir (held out — never point train_lora.py here)", cfg.get("build_val_out", p["val"]))
    val_frac = prompt("Val fraction", cfg.get("val_fraction", "0.05"))
    caption = prompt("Caption / invoke phrase (keep short + generic)", cfg.get("caption", "ebys user style"))
    bpm_tag = prompt_bool("Append detected BPM to caption? (needs librosa, slow)", default=False)
    copy = prompt_bool("Copy files instead of symlink?", default=False)

    cmd = [
        sys.executable, os.path.join(HERE, "build_lora_dataset.py"),
        "--clips-dir", clips, "--out-dir", out, "--val-out-dir", val_out,
        "--val-fraction", val_frac, "--caption", caption,
    ]
    if bpm_tag:
        cmd.append("--bpm-tag")
    if copy:
        cmd.append("--copy")

    run_cmd(cmd)
    cfg.update(build_clips=clips, build_out=out, build_val_out=val_out,
               val_fraction=val_frac, caption=caption)
    return cfg


def action_train(root, cfg):
    p = paths_for(root)
    print("\n-- Train LoRA (Stable Audio 3's own train_lora.py, external repo) --")
    print("   This runs stable-audio-tools' train_lora.py, not a script in this")
    print("   project — flag names beyond the ones USER_LORA.md documents")
    print("   (--rank, --adapter_type, --exclude, --steps) depend on the repo")
    print("   you cloned. Run --help once if you're not sure of the rest.")

    repo = prompt("Path to stable-audio-tools checkout", cfg.get("repo", ""))
    train_script = os.path.join(repo, "train_lora.py") if repo else "train_lora.py"

    if repo and prompt_bool("Show train_lora.py --help first?", default=False):
        run_cmd([sys.executable, train_script, "--help"])

    data_dir = prompt("Training data_dir", cfg.get("build_out", p["train"]))
    ckpt_dir = prompt("Checkpoint output dir", cfg.get("checkpoint_dir", os.path.join(root, "checkpoints")))
    rank = prompt("Rank", cfg.get("rank", "16"))
    adapter = prompt("Adapter type", cfg.get("adapter_type", "dora-rows"))
    exclude = prompt("Exclude (footgun on small datasets)", cfg.get("exclude", "seconds_total"))
    steps = prompt("Steps", cfg.get("steps", "1000"))
    extra = prompt("Any extra flags (model config/ckpt path, etc. — paste as-is)", cfg.get("extra_train_flags", ""))

    cmd = [
        sys.executable, train_script,
        "--data_dir", data_dir,
        "--rank", rank,
        "--adapter_type", adapter,
        "--exclude", exclude,
        "--steps", steps,
        "--checkpoint_dir", ckpt_dir,
    ]
    if extra:
        cmd += extra.split()

    print("\n   Note: --data_dir / --checkpoint_dir are best guesses at the real")
    print("   flag names — check against --help output above before trusting them.")

    run_cmd(cmd)
    cfg.update(repo=repo, checkpoint_dir=ckpt_dir, rank=rank, adapter_type=adapter,
               exclude=exclude, steps=steps, extra_train_flags=extra)
    return cfg


def action_compare(root, cfg):
    p = paths_for(root)
    print("\n-- Compare generated output against the corpus (Phase 4) --")
    print("   Run once against val/ (generalization check) and/or against")
    print("   train/ (memorization / near-duplicate check).")
    generated = prompt("Generated clips dir", cfg.get("generated", p["generated"]))
    mode = prompt("Compare against 'val' (generalization) or 'train' (memorization)", "val")
    real_dir = p["val"] if mode == "val" else p["train"]
    real_dir = prompt("Real-dir to compare against", real_dir)
    out_report = prompt("Write report JSON to", os.path.join(root, f"eval_{mode}.json"))
    pct = prompt("Flag closest N%% as possible near-duplicates", cfg.get("flag_percentile", "5.0"))

    cmd = [
        sys.executable, os.path.join(HERE, "compare_lora_output.py"),
        "--real-dir", real_dir, "--generated-dir", generated,
        "--out-report", out_report, "--flag-percentile", pct,
    ]
    run_cmd(cmd)
    cfg.update(generated=generated, flag_percentile=pct)
    return cfg


# ── main loop ─────────────────────────────────────────────────────────────

MENU = """
  1) Prep corpus         raw/      -> clean/     (normalize, chunk)
  2) Build dataset        clean/    -> train/,val/ (wav+caption pairs)
  3) Train LoRA            train/    -> checkpoints/ (external train_lora.py)
  4) Compare output        generated/ vs train/ or val/ (Phase 4 eval)
  5) Refresh status
  0) Quit
"""


def main():
    ap = argparse.ArgumentParser(description="Interactive menu over the EBYS LoRA pipeline scripts")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="lora_corpus root (default: %(default)s)")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    os.makedirs(root, exist_ok=True)
    cfg = load_config(root)

    while True:
        print_status(root, cfg)
        print(MENU)
        choice = input("> ").strip()

        try:
            if choice == "1":
                cfg = action_prep(root, cfg)
            elif choice == "2":
                cfg = action_build(root, cfg)
            elif choice == "3":
                cfg = action_train(root, cfg)
            elif choice == "4":
                cfg = action_compare(root, cfg)
            elif choice == "5":
                continue
            elif choice == "0":
                save_config(root, cfg)
                print("bye.")
                break
            else:
                print("not a menu option.")
                continue
        except KeyboardInterrupt:
            print("\ninterrupted.")
        except Exception as e:
            print(f"[!] error: {e}")

        save_config(root, cfg)


if __name__ == "__main__":
    main()
