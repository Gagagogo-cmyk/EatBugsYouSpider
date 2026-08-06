#!/usr/bin/env python3
"""
EBYS — Cricket → Generative Agent bridge

Closes the Phase 5 gap flagged in docs/instrument/USER_LORA.md: Cricket
speaks in slicer.js commands (setDirPref, setWeight, setSegmentBars, ...)
which drive REAL slice selection directly inside Max. There is no
equivalent direct path into Stable Audio 3 — a diffusion model doesn't
take "prefer rising energy" as an input, it takes a text prompt and a
duration. This script is that translation layer.

What it does NOT do: give Cricket continuous, sample-accurate control
over generation the way it has over real slice selection. That would need
a custom conditioner trained into the LoRA (AdaLN/cross-attention path,
same as duration/inpainting) — real architecture work, not scriptable
plumbing, still an open item. What THIS script does is coarser but real:
turn Cricket's current direction into (a) a caption fragment steering
what kind of clip gets generated, and (b) a duration heuristic from
segment length — then batch-generate candidates and drop them into the
exact same generate → tag → import → AGENT_MODE pool pipeline
generate_agent.py already feeds. Selection AMONG those candidates, once
imported, already goes through slicer.js's real scoreCandidate() using
Cricket's live weights/dirPref state — that part needed no new code
(see GENERATIVE_LAYER.md's AGENT_MODE section).

Input: a JSON intent file written by cricket.js after every Cricket
response (see that file's writeGenerationIntent()), OR --commands passed
directly for testing without Max/Ollama running at all:

    {
      "timestamp": "...",
      "intent_text": "build up the energy",
      "commands": [["setDirPref", "E", 1], ["setWeight", "E", 3.0], ...]
    }

cricket.js CAN spawn this now — see its `generate <stem>` command — but only
if you've turned that on (ENABLE_GENERATION in cricket.js, off by default).
Cricket deciding on its own to kick off a slow, GPU-bound job is a real cost/
time tradeoff, not something that should be live by default just because the
plumbing exists. When it does fire, it's a detached background process, not
inline with Cricket's response — the LLM call and this script's model load
are two separate concerns kept on separate timelines.

By default (unless --no-auto-pipeline is passed) this script chains the
parts of the pipeline that are safely automatable: generate_agent.py ->
tag_generated.py -> import_library.py, all pure Python/SQLite, no Max
involved. What it CANNOT chain, on purpose, not an oversight: the actual
FluCoMa analysis pass inside Max. analyze_reader.js is a Max object driven
by FluCoMa's buf~ externals — there is no way to compute C/S/E/F/P/H/T
outside the Max patch without silently using different math than what the
taste model was trained on (see GENERATIVE_LAYER.md step 6). So this script
gets a fresh batch all the way to "ready for Max to analyze," prints exactly
that, and stops — the Max analysis pass and the `:setAgentMode <stem>
generate` switch that actually starts using the new material are left as
deliberate human actions.

Usage:
  # from a live intent file written by cricket.js
  python3 cricket_bridge.py --stem melody --seed-from-db ../../data/current/ebys.db \
      --lora-ckpt-path ../../lora_out/lora_step1000.safetensors \
      --invoke-phrase "ebys user style"

  # direct testing, no Max/Ollama/intent file needed
  python3 cricket_bridge.py --stem drums --genre "deep house" --bpm 124 \
      --commands "setDirPref E 1" "setDirWeight 2.0" "setWeight C 3.0" "setSegmentBars 2" \
      --dry-run
"""

import os
import sys
import json
import glob
import argparse
import subprocess

# descriptor letter + sign -> adjective fragment. Matches CRICKET.md's
# descriptor meanings exactly (C/S/E/F/P/H/T), not just the smaller C/E/F/P
# subset cricket.js's current system prompt documents — cricket.js may grow
# to emit the rest over time and this needs no change if it does.
DIRECTION_VOCAB = {
    ("C", "+"): "brighter",
    ("C", "-"): "darker",
    ("S", "+"): "wider spectrum, fuller",
    ("S", "-"): "narrower, more focused",
    ("E", "+"): "more energy, louder",
    ("E", "-"): "quieter, more delicate",
    ("F", "+"): "more textural, noisier",
    ("F", "-"): "more tonal, cleaner",
    ("P", "+"): "higher pitched",
    ("P", "-"): "lower pitched",
    ("H", "+"): "more tonal, in-key",
    ("H", "-"): "more atonal, percussive",
    ("T", "+"): "denser timbre",
    ("T", "-"): "thinner timbre",
}

# Coarse segment-length -> generation-duration heuristic. Cricket's
# setSegmentBars values are 0.5/1/2/4/8/16; there's no reliable BPM tied to
# this axis in the intent itself (BPM comes from --genre/--bpm/--seed-from-db,
# a separate concern), so this is a flat lookup, not a real bar->seconds
# calculation. Deliberately coarse — override with --duration if it matters.
SEGMENT_BARS_TO_DURATION_S = {
    0.5: 4.0, 1: 6.0, 2: 8.0, 4: 12.0, 8: 16.0, 16: 20.0,
}

DIRECTION_THRESHOLD = 0.15   # |dirPref| below this is treated as neutral
MAX_CAPTION_TERMS = 3        # cap adjectives so cfg attention isn't diluted


def load_commands_from_file(path):
    with open(path) as f:
        payload = json.load(f)
    return payload.get("commands", []), payload.get("intent_text", "")


def parse_command_line(line):
    """'setDirPref E 1' -> ['setDirPref', 'E', 1.0] — mirrors cricket.js's
    own atomization (numeric strings become floats) so --commands behaves
    identically to what the intent file would contain."""
    parts = line.strip().split()
    atoms = []
    for p in parts:
        try:
            atoms.append(float(p))
        except ValueError:
            atoms.append(p)
    return atoms


def parse_intent(commands):
    """List of atom-lists -> a structured intent dict. Unknown/unhandled
    commands are ignored, not errors — Cricket's vocabulary is expected to
    grow over time (see CRICKET.md vs. cricket.js's current subset)."""
    intent = {
        "direction": {},       # {letter: dirPref value}
        "dir_weight": 1.0,
        "weights": {},         # {letter: weight value}
        "segment_bars": None,
        "track_weights": {},   # {stem: value}
    }
    for atoms in commands:
        if not atoms:
            continue
        name = str(atoms[0])
        args = atoms[1:]
        if name == "setDirPref" and len(args) >= 2:
            letter, value = str(args[0]).upper(), float(args[1])
            intent["direction"][letter] = value
        elif name == "setDirWeight" and len(args) >= 1:
            intent["dir_weight"] = float(args[0])
        elif name == "setWeight" and len(args) >= 2:
            letter, value = str(args[0]).upper(), float(args[1])
            intent["weights"][letter] = value
        elif name == "setSegmentBars" and len(args) >= 1:
            intent["segment_bars"] = float(args[0])
        elif name == "setTrackWeight" and len(args) >= 2:
            stem, value = str(args[0]).lower(), float(args[1])
            intent["track_weights"][stem] = value
        # setStayProb / setQuantize / setMatchProb / setFallbackBPM /
        # start / stop / selectSegment: about selection behavior or
        # transport, not sonic character — nothing meaningful to translate
        # into a generation caption, deliberately skipped.
    return intent


def direction_to_caption_fragment(intent):
    """Rank descriptors by |dirPref| * weight * dirWeight (how much Cricket
    actually cares about this axis right now), keep the strongest few above
    a neutrality threshold, map each to an adjective phrase."""
    dir_weight = intent["dir_weight"]
    scored = []
    for letter, pref in intent["direction"].items():
        if abs(pref) < 1e-6:
            continue
        weight = intent["weights"].get(letter, 1.0)
        salience = abs(pref) * weight * dir_weight
        if salience < DIRECTION_THRESHOLD:
            continue
        sign = "+" if pref > 0 else "-"
        phrase = DIRECTION_VOCAB.get((letter, sign))
        if phrase:
            scored.append((salience, phrase))

    scored.sort(key=lambda x: -x[0])
    phrases = [p for _, p in scored[:MAX_CAPTION_TERMS]]
    return ", ".join(phrases)


def duration_from_segment_bars(segment_bars, fallback):
    if segment_bars is None:
        return fallback
    return SEGMENT_BARS_TO_DURATION_S.get(segment_bars, fallback)


def dominant_stem(intent, fallback=None):
    """Which stem Cricket most recently pushed via setTrackWeight, if any —
    used only when --stem isn't given explicitly. A track_weight above 1.0
    means 'more of this stem'; the largest such value wins."""
    tw = intent["track_weights"]
    if not tw:
        return fallback
    boosted = {k: v for k, v in tw.items() if v > 1.0}
    if not boosted:
        return fallback
    return max(boosted, key=boosted.get)


def main():
    ap = argparse.ArgumentParser(description="Translate Cricket's current commands into a generate_agent.py call")
    ap.add_argument("--intent-file", default=None,
                     help="path to cricket.js's written intent JSON (default: ../../data/current/cricket_intent.json)")
    ap.add_argument("--commands", nargs="+", default=None,
                     help="direct command strings for testing, e.g. \"setDirPref E 1\" \"setWeight C 3.0\" — bypasses --intent-file")
    ap.add_argument("--stem", default=None, choices=["vocals", "melody", "bass", "drums"],
                     help="which stem to generate for. If omitted, inferred from the strongest setTrackWeight in the intent, if any.")

    ap.add_argument("--genre", default=None)
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--seed-from-db", default=None,
                     help="default: ../../data/current/ebys.db, if it exists and --genre/--bpm weren't given")

    ap.add_argument("--model", default=None, help="passthrough to generate_agent.py --model")
    ap.add_argument("--lora-ckpt-path", action="append", dest="lora_ckpt_path", metavar="PATH")
    ap.add_argument("--lora-strength", type=float, default=None)
    ap.add_argument("--invoke-phrase", default="ebys user style",
                     help="should match build_lora_dataset.py's --caption used during training")

    ap.add_argument("--count", type=int, default=4)
    ap.add_argument("--duration", type=float, default=None,
                     help="override the segment-bars-derived duration heuristic")
    ap.add_argument("--out-dir", default=None)

    ap.add_argument("--generate-agent", default=None,
                     help="path to generate_agent.py (default: sibling of this script)")
    ap.add_argument("--python", default=sys.executable or "python3")
    ap.add_argument("--dry-run", action="store_true",
                     help="print the generate_agent.py command without running it")

    ap.add_argument("--no-auto-pipeline", action="store_true",
                     help="don't chain tag_generated.py + import_library.py after generation")
    ap.add_argument("--genres-path", default=None, help="default: ../../data/current/genres.json")
    ap.add_argument("--downbeats-path", default=None, help="default: ../../data/current/downbeats.json")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    intent_path = args.intent_file or os.path.join(here, "..", "..", "data", "current", "cricket_intent.json")
    default_db_path = os.path.join(here, "..", "..", "data", "current", "ebys.db")
    genres_path = args.genres_path or os.path.join(here, "..", "..", "data", "current", "genres.json")
    downbeats_path = args.downbeats_path or os.path.join(here, "..", "..", "data", "current", "downbeats.json")

    if args.commands:
        raw_commands = [parse_command_line(c) for c in args.commands]
        intent_text = "(from --commands)"
    else:
        if not os.path.exists(intent_path):
            sys.exit(f"no intent file at {intent_path} — pass --commands to test without one, "
                      "or make sure cricket.js has run at least once (see its writeGenerationIntent())")
        raw_commands, intent_text = load_commands_from_file(intent_path)
        if not raw_commands:
            sys.exit(f"{intent_path} has no commands recorded yet")

    intent = parse_intent(raw_commands)
    style_fragment = direction_to_caption_fragment(intent)
    stem = args.stem or dominant_stem(intent)
    if not stem:
        sys.exit("no --stem given and no setTrackWeight in the intent to infer one from — pass --stem explicitly")

    fallback_duration = 12.0
    duration = args.duration if args.duration is not None else duration_from_segment_bars(intent["segment_bars"], fallback_duration)

    print(f"intent: \"{intent_text}\"")
    print(f"parsed direction: {intent['direction']}  weights: {intent['weights']}  dirWeight: {intent['dir_weight']}")
    print(f"stem: {stem}")
    print(f"style fragment: \"{style_fragment}\"" if style_fragment else "style fragment: (none — no direction cleared the salience threshold)")
    print(f"duration: {duration}s (segment_bars={intent['segment_bars']})")

    generate_agent_path = args.generate_agent or os.path.join(here, "generate_agent.py")
    cmd = [args.python, generate_agent_path, "--stem", stem, "--count", str(args.count), "--duration", str(duration)]

    seed_from_db = args.seed_from_db
    if not seed_from_db and not (args.genre and args.bpm) and os.path.exists(default_db_path):
        seed_from_db = default_db_path
        print(f"no --seed-from-db/--genre/--bpm given — defaulting to {default_db_path}")

    if seed_from_db:
        cmd += ["--seed-from-db", seed_from_db]
    elif args.genre and args.bpm:
        cmd += ["--genre", args.genre, "--bpm", str(args.bpm)]
    else:
        sys.exit("either --seed-from-db, or both --genre and --bpm, are required "
                  f"(and no ebys.db found at the default path {default_db_path})")

    if style_fragment:
        cmd += ["--style-fragment", style_fragment]
    if args.invoke_phrase:
        cmd += ["--invoke-phrase", args.invoke_phrase]
    if args.model:
        cmd += ["--model", args.model]
    if args.lora_ckpt_path:
        for p in args.lora_ckpt_path:
            cmd += ["--lora-ckpt-path", p]
    if args.lora_strength is not None:
        cmd += ["--lora-strength", str(args.lora_strength)]
    if args.out_dir:
        cmd += ["--out-dir", args.out_dir]

    resolved_out_dir = os.path.normpath(args.out_dir or os.path.join(here, "..", "..", "data", "generated"))

    print()
    print("generate_agent.py command:")
    print("  " + " ".join(cmd))

    if args.dry_run:
        print("dry run — not executing")
        return

    manifests_before = set(glob.glob(os.path.join(resolved_out_dir, "manifest_*.json")))
    subprocess.run(cmd, check=True)

    if args.no_auto_pipeline:
        print("\n--no-auto-pipeline set — stopping after generation. Next: tag_generated.py, "
              "then import_library.py, then the Max analysis pass, same as generate_agent.py's own reminder.")
        return

    manifests_after = set(glob.glob(os.path.join(resolved_out_dir, "manifest_*.json")))
    new_manifests = sorted(manifests_after - manifests_before)
    if not new_manifests:
        sys.exit(f"generate_agent.py succeeded but no new manifest_*.json appeared in {resolved_out_dir} "
                  "— can't chain tag_generated.py without it. Check generate_agent.py's own output above.")
    manifest_path = new_manifests[-1]

    tag_generated_path = os.path.join(here, "tag_generated.py")
    import_library_path = os.path.join(here, "import_library.py")

    print(f"\nchaining tag_generated.py on {manifest_path} ...")
    subprocess.run([args.python, tag_generated_path,
                     "--manifest", manifest_path,
                     "--genres-path", genres_path,
                     "--downbeats-path", downbeats_path], check=True)

    print("\nchaining import_library.py ...")
    subprocess.run([args.python, import_library_path], check=True)

    print(f"""
batch ready for Max, not yet usable — two things left, both manual on purpose
(see this script's module docstring for why the first one can't be automated):
  1. Run the normal Max analysis pass on the new WAVs in {resolved_out_dir}
     (FluCoMa still has to compute real C/S/E/F/P/H/T — not skippable).
  2. Once that's done: :setAgentMode {stem} generate
     (switching this before analysis finishes will just starve the {stem}
     pool — filterPoolByAgentMode() has nothing to serve yet).
""")


if __name__ == "__main__":
    main()
