#!/usr/bin/env bash
# status.sh — is the analysis actually working?
#
#   ./status.sh          one snapshot
#   ./status.sh -w       refresh every 2s (no `watch` needed, macOS has none)
#
# Reads the pipeline's own outputs and says which stage last produced
# something. Every number here is a fact on disk, not a claim from a log.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$ROOT/data/current"

# Count rows in a table. Prefers the sqlite3 CLI; falls back to python3,
# which is always present on macOS and in the venvs here. Always returns a
# plain integer so the arithmetic below can never blow up on "?".
db() {
  local n=""
  if command -v sqlite3 >/dev/null 2>&1; then
    n=$(sqlite3 "$D/gnumbat.db" "select count(*) from $1" 2>/dev/null)
  fi
  if [ -z "$n" ] && command -v python3 >/dev/null 2>&1; then
    n=$(python3 -c "
import sqlite3,sys
try: print(sqlite3.connect('$D/gnumbat.db').execute('select count(*) from $1').fetchone()[0])
except Exception: print(0)" 2>/dev/null)
  fi
  case "$n" in (''|*[!0-9]*) echo 0 ;; (*) echo "$n" ;; esac
}
sz() { local n; n=$(wc -c < "$D/$1" 2>/dev/null | tr -d ' '); echo "${n:-0}"; }
mark() { [ "${1:-0}" -gt "${2:-0}" ] 2>/dev/null && echo "ok " || echo "-- "; }

snapshot() {
  local lib idx dbt slc dwn gen
  lib=$(sz analysis_library.json); idx=$(sz gnumbat_index.json)
  dbt=$(db tracks); slc=$(db slices)
  dwn=$(db downbeats); gen=$(db genres)

  echo "── PYTHON SIDE (demucs / madmom / genre tagger) ───────────────"
  printf "  %s stems on disk        %s\n" "$(mark "$(find "$D/stems" -name '*.wav' 2>/dev/null | wc -l | tr -d ' ')" 0)" \
     "$(find "$D/stems" -name '*.wav' 2>/dev/null | wc -l | tr -d ' ') files"
  printf "  %s downbeats            %s rows\n" "$(mark "${dwn:-0}")" "$dwn"
  printf "  %s genres               %s rows\n" "$(mark "${gen:-0}")" "$gen"
  printf "  %s tracks registered    %s rows\n" "$(mark "${dbt:-0}")" "$dbt"
  echo
  echo "── PD / FLUCOMA SIDE (the part that makes slices) ─────────────"
  printf "  %s slices               %s rows   <- THE NUMBER THAT MATTERS\n" "$(mark "${slc:-0}")" "$slc"
  printf "  %s analysis_library     %s bytes  (2 = empty)\n" "$(mark "$lib" 2)" "$lib"
  printf "  %s gnumbat_index           %s bytes  (2 = empty)\n" "$(mark "$idx" 2)" "$idx"
  echo
  echo "── BRIDGES (last log line each) ───────────────────────────────"
  for l in "$ROOT/data/logs"/*.log; do
    [ -f "$l" ] || continue
    printf "  %-16s %s\n" "$(basename "$l" .log)" "$(tail -1 "$l" | cut -c1-58)"
  done
  echo
  # The interpretation, so the numbers do not need decoding every time.
  if [ "${slc:-0}" -gt 0 ]; then
    echo "  => analysis is producing slices. This is working."
  elif [ "${dwn:-0}" -gt 0 ]; then
    echo "  => Python half done, Pd half has produced nothing yet."
    echo "     Check the stem_vocals-0 array: filled means soundfiler ran and"
    echo "     the stall is in FluCoMa; flat means startStem never fired and"
    echo "     the stall is earlier, in the counter/stem_loader loop."
  else
    echo "  => nothing has run. Is watch_demucs.py going, and ./run.sh up?"
  fi
}

if [ "${1:-}" = "-w" ]; then
  while true; do clear; date "+%H:%M:%S"; echo; snapshot; sleep 2; done
else
  snapshot
fi
