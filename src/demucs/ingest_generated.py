#!/usr/bin/env python3
"""
EBYS — Ingest Generated Clips

This is the "raw upload" entry point for generate_agent.py's output — the
generative-pipeline counterpart to watch_demucs.py, which is (and stays)
the raw-upload entry point for YOUR OWN mixes only.

Why a separate file instead of teaching watch_demucs.py a second mode:

  Human pipeline:      raw_uploads/ → ffmpeg → Demucs stem separation →
                        genre_tagger.py / madmom_tagger.py (real audio,
                        real detection) → stems/htdemucs/<track>/ →
                        Max/FluCoMa analysis → import_library.py → ebys.db
                        → (separately, on demand) finetune_generative.py
                        trains Stable Audio Open Small on these stems.

  Generative pipeline:  generate_agent.py (Stable Audio Open Small) →
                        data/generated/<batch>/manifest_*.json → THIS
                        SCRIPT copies the already-isolated clips straight
                        into stems/htdemucs/<track>/ (no ffmpeg, no Demucs
                        — there is nothing to separate, the model already
                        generated one isolated stem per file) →
                        tag_generated.py (fabricated genre/BPM from the
                        generation prompt, not detected) → same
                        stems/htdemucs/ tree → same Max/FluCoMa analysis →
                        same import_library.py → same ebys.db.

Both pipelines converge on stems/htdemucs/ and ebys.db because that's
where the SAME downstream analysis system (Max/FluCoMa descriptors,
slicer.js candidate scoring) legitimately treats every isolated stem the
same way, generated or not. What must NOT converge is training data:
import_library.py stamps every track row's `source` column ('human' vs
'generated') from the GEN__ name prefix (see source_for_name() there),
and finetune_generative.py's SQL query hard-filters on
`WHERE t.source = 'human'`. That column, not this script, is the actual
guarantee the two pipelines stay separate — this script's job is narrower:
get generated clips into the shared analysis tree without ever routing
them through raw_uploads/ or Demucs, and leave an explicit audit trail
(generated_manifest.json, per session) of exactly what was ingested and
when, on top of the DB column.

Usage:
  python3 ingest_generated.py --manifest ../../data/generated/manifest_20260723T202004.json
  python3 ingest_generated.py --manifest ../../data/generated/manifest_....json --session default
  python3 ingest_generated.py --manifest ../../data/generated/manifest_....json --dry-run
"""

import os
import sys
import json
import shutil
import argparse
import subprocess
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

SRC_DIR   = Path(__file__).parent          # EBYS/src/demucs/
ROOT_DIR  = SRC_DIR.parent.parent          # EBYS/ (repo root)
DATA_ROOT = ROOT_DIR / "data"

WS_SERVER_PROGRESS_URL = "http://localhost:8080/progress"


def post_progress(data):
    """Best-effort notify to ws_server.js, mirrors watch_demucs.py's helper
    of the same name — same event shapes, so the TUI doesn't need to know
    which pipeline produced a 'stemsReady' event."""
    try:
        body = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(
            WS_SERVER_PROGRESS_URL, data=body,
            headers={'Content-Type': 'application/json'}, method='POST'
        )
        urllib.request.urlopen(req, timeout=1)
    except Exception:
        pass


def current_session_id() -> str:
    p = DATA_ROOT / "current_session.txt"
    try:
        sid = p.read_text().strip()
        return sid or "default"
    except Exception:
        return "default"


def session_data_dir(session_override=None) -> Path:
    sid = session_override or current_session_id()
    d = DATA_ROOT / "sessions" / sid
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_manifest(path):
    with open(path) as f:
        manifest = json.load(f)
    if not isinstance(manifest, list):
        sys.exit(f"{path} does not look like a generate_agent.py manifest (expected a JSON list)")
    return manifest


def resolve_source_wav(job, manifest_path):
    """Prefer the absolute path recorded in the manifest itself; fall back
    to <manifest's own folder>/<filename> in case the batch got moved."""
    candidates = []
    if job.get("path"):
        candidates.append(Path(job["path"]))
    candidates.append(Path(manifest_path).parent / job["filename"])
    for c in candidates:
        if c.exists():
            return c
    return None


# Mirrors watch_demucs.py's STEM_ORDER exactly — stream.txt's format is a
# contract with the Max patch, not something either pipeline gets to
# reinterpret on its own.
STEM_ORDER = [('vocals', 'vocals'), ('drums', 'drums'), ('bass', 'bass'), ('other', 'melody')]


def regenerate_stream_txt(data_dir: Path, stems_dir: Path):
    ht_root = stems_dir / "htdemucs"
    all_lines = []
    if ht_root.exists():
        for track_folder in sorted(ht_root.iterdir()):
            if not track_folder.is_dir():
                continue
            track_base = track_folder.name
            for demucs_stem, label in STEM_ORDER:
                exact = track_folder / f"{track_base}_{demucs_stem}.wav"
                matches = list(track_folder.glob(f"*_{demucs_stem}.wav"))
                stem_file = exact if exact.exists() else (matches[0] if matches else None)
                if stem_file:
                    all_lines.append(f"{label} {stem_file}")
    if all_lines:
        (data_dir / "stream.txt").write_text('\n'.join(all_lines) + '\n')
    return len(all_lines)


def update_generated_manifest_log(data_dir: Path, jobs, manifest_path):
    """Explicit, human-readable audit trail: which track names in this
    session came from generate_agent.py, from which batch manifest, and
    when they were ingested. The DB `source` column is the mechanism that
    actually keeps training data clean; this file is so a person looking at
    a session folder doesn't have to open ebys.db to answer 'wait, which of
    these tracks did I record and which did the model make?'"""
    log_path = data_dir / "generated_manifest.json"
    try:
        log = json.load(open(log_path)) if log_path.exists() else {}
    except Exception:
        log = {}
    now = datetime.now(timezone.utc).isoformat()
    for j in jobs:
        log[j["track_name"]] = {
            "stem": j["stem"],
            "genre": j.get("genre"),
            "bpm": j.get("bpm"),
            "filename": j["filename"],
            "generated_at": j.get("generated_at"),
            "ingested_at": now,
            "source_manifest": str(manifest_path),
        }
    with open(log_path, "w") as f:
        json.dump(log, f, indent=2)
    return log_path


def main():
    ap = argparse.ArgumentParser(
        description="Ingest generate_agent.py output into a session's stems/htdemucs/ "
                    "tree, tag it, and import it into ebys.db — WITHOUT going through "
                    "raw_uploads/ or Demucs, and WITHOUT it ever counting as training data."
    )
    ap.add_argument("--manifest", required=True, help="path to a generate_agent.py manifest_*.json")
    ap.add_argument("--session", default=None, help="target session id (default: current_session.txt, same as everything else)")
    ap.add_argument("--bars", type=int, default=32, help="passthrough to tag_generated.py — see that script for why generated clips get a fabricated grid instead of detected downbeats")
    ap.add_argument("--dry-run", action="store_true", help="print what would be copied/tagged without touching any files")
    args = ap.parse_args()

    manifest_path = Path(args.manifest).resolve()
    if not manifest_path.exists():
        sys.exit(f"manifest not found: {manifest_path}")

    jobs = load_manifest(manifest_path)
    if not jobs:
        sys.exit(f"{manifest_path} has no entries — nothing to ingest")

    data_dir = session_data_dir(args.session)
    stems_dir = data_dir / "stems"
    ht_root = stems_dir / "htdemucs"

    print(f"session: {current_session_id() if not args.session else args.session}  ({data_dir})")
    print(f"manifest: {manifest_path}  ({len(jobs)} clip(s))")

    # present_jobs — jobs whose dest_path is confirmed to actually exist on
    # disk by the end of this run (already there, or copied below). This is
    # the list update_generated_manifest_log() gets, NOT the raw `jobs` list
    # from the manifest.
    #
    # BUG (found + fixed here): update_generated_manifest_log() used to be
    # called with `jobs` — every entry in the manifest, unconditionally —
    # even ones whose source wav was never found (the WARNING branch just
    # below, `continue`d without ever reaching to_copy). That wrote a
    # track_name into generated_manifest.json's audit trail for a clip that
    # was never actually copied into stems/htdemucs/, so the TUI's Gen tab
    # (refreshGenEntries()/genPlay() in app.js) would list it as available
    # and then fail with "audio file missing on disk" the moment someone
    # tried to preview it — exactly the "gen tracks ingested but I can't
    # listen to them" symptom. Now the log only ever gets jobs that are
    # actually present on disk once this function returns.
    present_jobs = []
    to_copy = []
    skipped = 0
    for j in jobs:
        track_name = j["track_name"]
        dest_dir = ht_root / track_name
        dest_path = dest_dir / j["filename"]
        if dest_path.exists():
            skipped += 1
            present_jobs.append(j)
            continue
        src_path = resolve_source_wav(j, manifest_path)
        if src_path is None:
            print(f"  WARNING: source wav for {track_name} not found (looked for "
                  f"{j.get('path')} and {manifest_path.parent / j['filename']}) — skipping, "
                  f"NOT added to generated_manifest.json")
            continue
        to_copy.append((j, src_path, dest_path))
        present_jobs.append(j)

    print(f"  {len(to_copy)} clip(s) to ingest, {skipped} already present — skipping those")

    if args.dry_run:
        for j, src, dest in to_copy:
            print(f"  [dry-run] {src} -> {dest}")
        print("dry run — nothing copied, no tagging, no import")
        return

    for j, src_path, dest_path in to_copy:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest_path)
        print(f"  copied {src_path.name} -> {dest_path}")

    if not to_copy:
        print("nothing new to ingest — still refreshing stream.txt / running import in case a prior run was interrupted before those steps")

    if not present_jobs:
        print("nothing on disk to log/tag/import — every job in this manifest was already present or had a missing source wav")
        return

    # Tag: fabricate genres.json / downbeats.json entries from the
    # generation conditioning (see tag_generated.py's own docstring for why
    # this is the ground truth for synthesized audio, not something to
    # re-detect with Essentia/madmom).
    tag_script = SRC_DIR / "tag_generated.py"
    genres_path = data_dir / "genres.json"
    downbeats_path = data_dir / "downbeats.json"
    r = subprocess.run([
        sys.executable, str(tag_script),
        "--manifest", str(manifest_path),
        "--genres-path", str(genres_path),
        "--downbeats-path", str(downbeats_path),
        "--bars", str(args.bars),
    ], capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.returncode != 0:
        print(f"tag_generated.py FAILED (code {r.returncode}):\n{r.stderr.strip()}")
        sys.exit(1)

    # Audit trail, separate from the DB column. present_jobs, not jobs — see
    # this function's own comment above for why: only clips actually sitting
    # on disk belong in the log the Gen tab reads from.
    log_path = update_generated_manifest_log(data_dir, present_jobs, manifest_path)
    print(f"  -> {log_path}")

    # stream.txt so Max can find the new buffers without a restart.
    n_lines = regenerate_stream_txt(data_dir, stems_dir)
    print(f"stream.txt refreshed — {n_lines} stem line(s)")

    # Import genres/downbeats into ebys.db now; slices come later once Max's
    # FluCoMa buf~ has actually analyzed these files — that part can't be
    # faked (same limitation tag_generated.py documents).
    import_script = SRC_DIR / "import_library.py"
    r = subprocess.run([sys.executable, str(import_script)], capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.returncode != 0:
        print(f"import_library.py FAILED (code {r.returncode}):\n{r.stderr.strip()}")
        sys.exit(1)

    for j, _, _ in to_copy:
        post_progress({'type': 'stemsReady', 'track': j["track_name"]})

    print(f"\n{len(to_copy)} generated track(s) ingested into session "
          f"'{current_session_id() if not args.session else args.session}'.")
    print("Next: open Max and run the FluCoMa analysis pass on these tracks "
          "like any newly added track (genre/BPM are already tagged; slice "
          "descriptors C/S/E/F/P/H/T still need the real analysis). They will "
          "NOT be used by finetune_generative.py — import_library.py stamped "
          "them source='generated', and that script only trains on source='human'.")


if __name__ == "__main__":
    main()
