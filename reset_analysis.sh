#!/usr/bin/env bash
# reset_analysis.sh — wipe the derived analysis so a track can be re-analysed
# from scratch, WITHOUT destroying anything you trained.
#
#   ./reset_analysis.sh              show what would be cleared, change nothing
#   ./reset_analysis.sh --yes        do it
#   ./reset_analysis.sh --yes --all  also wipe the taste model and training logs
#
# WHY THIS EXISTS
# ---------------
# "resetMemory" in the patch is much narrower than its name suggests. There are
# really two of them and neither does what you'd expect:
#
#   analyze_reader's  -- clears in-memory run state only, then RELOADS the
#                        registry from disk. Nothing on disk changes.
#   slice_writer's    -- writes "{}" over analysis_library.json. One file.
#
# Meanwhile a full analysis run also writes gnumbat_index.json, downbeats.json,
# genres.json, waveforms.json, stem_ranges.json, umap_coords.json and four
# tables in gnumbat.db. Clearing only the library leaves all of those stale and
# pointing at slices that no longer exist -- which looks like a reset that
# "didn't work", because most of the state survived.
#
# THE LINE THIS SCRIPT DRAWS
# --------------------------
# DERIVED (cleared): everything recomputable by re-running analysis on the
#   audio. Losing it costs you CPU time and nothing else.
# TRAINED (kept):    learned_bias.json, bake_states.json and the training_log
#   files. These are the taste model -- the accumulated result of you scoring
#   takes over weeks. They are NOT recomputable, there is no backup, and
#   re-analysing a track has no reason to touch them. --all overrides this,
#   deliberately awkwardly.
#
# Stems and raw uploads are never touched by either mode.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$ROOT/data/current"

APPLY=0; ALL=0
for a in "$@"; do
  case "$a" in
    --yes) APPLY=1 ;;
    --all) ALL=1 ;;
    *) echo "unknown option: $a"; exit 1 ;;
  esac
done

[ -d "$D" ] || { echo "no $D -- is data/current still a symlink to sessions/default?"; exit 1; }

# Derived analysis: JSON files reset to an empty container of the right shape.
# Emptying rather than deleting matters -- several readers do fs.readFileSync
# and throw on a missing file, where "{}" parses fine and reads as "no data".
declare -a EMPTY_OBJ=(
  analysis_library.json   # the slice registry (slice_writer's resetMemory target)
  gnumbat_index.json         # built slice index, cached by ws_server/slicer
  downbeats.json          # madmom beat grid per track
  genres.json             # genre_tagger output
  waveforms.json          # cached display waveforms
  stem_ranges.json        # per-stem min/max used for plotting
  umap_coords.json        # t-SNE/UMAP projection for the descriptor map
  fit_shapes.json
  generated_manifest.json
)
declare -a TRAINED=(
  learned_bias.json bake_states.json
  training_log.jsonl training_log_horizontal.jsonl training_log_vertical.jsonl
)
# Tables holding derived analysis. `tracks` is included because a half-cleared
# tracks table is what makes re-analysis skip a track it thinks it already did.
declare -a DB_TABLES=(slices downbeats genres tracks)

say() { printf "  %-30s %s\n" "$1" "$2"; }

echo
echo "DERIVED -- will be cleared:"
for f in "${EMPTY_OBJ[@]}"; do
  [ -f "$D/$f" ] && say "$f" "$(wc -c < "$D/$f" | tr -d ' ') bytes" || say "$f" "(absent)"
done
if [ -f "$D/gnumbat.db" ]; then
  for t in "${DB_TABLES[@]}"; do
    n=$(sqlite3 "$D/gnumbat.db" "select count(*) from $t" 2>/dev/null || echo "?")
    say "gnumbat.db: $t" "$n rows"
  done
fi

echo
if [ "$ALL" -eq 1 ]; then
  echo "TRAINED -- will ALSO be cleared (--all):"
else
  echo "TRAINED -- kept (pass --all to wipe these too):"
fi
for f in "${TRAINED[@]}"; do
  [ -f "$D/$f" ] && say "$f" "$(wc -c < "$D/$f" | tr -d ' ') bytes"
done

echo
if [ "$APPLY" -eq 0 ]; then
  echo "Dry run. Nothing changed. Re-run with --yes to apply."
  exit 0
fi

# A dated backup, because this is destructive and the alternative is regret.
BK="$ROOT/data/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
for f in "${EMPTY_OBJ[@]}" "${TRAINED[@]}" gnumbat.db; do
  [ -f "$D/$f" ] && cp "$D/$f" "$BK/" 2>/dev/null || true
done
echo "backup -> $BK"

for f in "${EMPTY_OBJ[@]}"; do
  [ -f "$D/$f" ] || continue
  case "$f" in
    *.jsonl) : > "$D/$f" ;;
    *)       printf '{}' > "$D/$f" ;;
  esac
done

if [ -f "$D/gnumbat.db" ]; then
  for t in "${DB_TABLES[@]}"; do
    sqlite3 "$D/gnumbat.db" "delete from $t;" 2>/dev/null || true
  done
  sqlite3 "$D/gnumbat.db" "vacuum;" 2>/dev/null || true
fi

if [ "$ALL" -eq 1 ]; then
  for f in "${TRAINED[@]}"; do
    [ -f "$D/$f" ] || continue
    case "$f" in *.jsonl) : > "$D/$f" ;; *) printf '{}' > "$D/$f" ;; esac
  done
  echo "taste model and training logs wiped"
fi

echo "done. Stems and raw_uploads untouched."
echo
echo "Restart the Node bridges (./run.sh) before re-analysing -- several of them"
echo "hold the old library in memory and would write it straight back."
