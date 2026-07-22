#!/usr/bin/env python3
"""
EBYS — Tag Generated Clips

Takes a manifest.json written by generate_agent.py and merges entries into
genres.json / downbeats.json in the exact format import_library.py already
expects (see import_genres() / import_downbeats() there) — so generated
clips flow through the SAME import step as real tracks, no branching logic
needed in import_library.py itself.

Genre/BPM are taken directly from the generation conditioning (what we
asked the model for), not re-detected — that's the ground truth for a
synthesized clip; there's no reason to re-run Essentia/madmom on audio
whose genre and tempo we dictated ourselves.

Confidence is fixed at 1.0 for the generated genre tag (single tag, not a
ranked list like Essentia produces) since there's no classifier uncertainty
to report — we told the model what to make.

Usage:
  python3 tag_generated.py --manifest ../../data/generated/manifest_....json \
      --genres-path ../../data/current/genres.json \
      --downbeats-path ../../data/current/downbeats.json

  Then, as normal:
  python3 import_library.py --data-dir ../../data/current
"""

import os
import json
import argparse


def load_max_json(path):
    """Mirrors import_library.py's load_max_json — same '{}' preamble quirk."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        raw = f.read()
    if not raw.strip():
        return {}
    if raw.startswith("{}") and len(raw) > 2:
        raw = '{"' + raw[2:]
    obj, _ = json.JSONDecoder().raw_decode(raw)
    return obj


def main():
    ap = argparse.ArgumentParser(description="Tag generate_agent.py output into genres.json/downbeats.json")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--genres-path", required=True)
    ap.add_argument("--downbeats-path", required=True)
    ap.add_argument("--bars", type=int, default=32, help="how many downbeats to fabricate per generated clip (a straight grid at the requested BPM — generated clips have no real performed downbeats to detect)")
    args = ap.parse_args()

    with open(args.manifest) as f:
        manifest = json.load(f)

    genres_db = load_max_json(args.genres_path)
    beats_db = load_max_json(args.downbeats_path)

    for job in manifest:
        track_name = job["track_name"]
        genre = job.get("genre") or "unknown"
        bpm = float(job.get("bpm") or 0)

        genres_db[track_name] = {
            "genres": [{"genre": genre, "confidence": 1.0}]
        }

        if bpm > 0:
            beat_period_ms = 60000.0 / bpm
            bar_ms = beat_period_ms * 4  # assumes 4/4 — matches import_library.py's meter default
            downbeats_ms = [round(i * bar_ms, 2) for i in range(args.bars)]
        else:
            downbeats_ms = []

        beats_db[track_name] = {
            "downbeats_ms": downbeats_ms,
            "bpm": bpm,
            "meter": 4,
        }

    with open(args.genres_path, "w") as f:
        json.dump(genres_db, f, indent=2)
    with open(args.downbeats_path, "w") as f:
        json.dump(beats_db, f, indent=2)

    print(f"tagged {len(manifest)} generated track(s)")
    print(f"  -> {args.genres_path}")
    print(f"  -> {args.downbeats_path}")
    print("Next: run the normal Max analysis pass on these WAVs (FluCoMa "
          "buf~ still has to compute C/S/E/F/P/H/T — that part can't be "
          "skipped or faked, unlike genre/BPM), then import_library.py.")


if __name__ == "__main__":
    main()
