#!/usr/bin/env bash
# run.sh — start every Node process the Pd patch needs, in one command.
#
#   ./run.sh          start everything, stream logs
#   ./run.sh stop     kill anything left over
#   ./run.sh status    show what's listening
#
# WHY THIS EXISTS
# ---------------
# gnumbat-analyze.pd on its own is inert. Five of its objects are [netreceive]
# bridges whose other half is a Node process, and if those processes are not
# running the patch loads cleanly, shows no error, and does nothing at all --
# arrays stay at their default 44100 samples, no stem is ever loaded, and the
# console says nothing about it. That silence is the single most confusing
# failure mode in this project, and it is what this script exists to prevent.
#
# Port map (each bridge owns a pair; see CONVERSION_NOTES.md):
#   9001         streamWatcher   (Node -> Pd only)
#   9002 / 9003  sliceWriter
#   9004 / 9005  slicer
#   9006 / 9007  analyzeReader
#   9008 / 9009  bufferManager
#   9010 / 9011  guiHub          (+ HTTP/WebSocket on 8080, incl. GET /api/library)
#
# WATCH_DEMUCS -- the ingestion daemon (no port; watches data/.../raw_uploads/
# on the filesystem, not a socket). Normally installed as a macOS LaunchAgent
# by setup.sh (com.gnumbat.watchdemucs.plist, "always on" independent of this
# script) -- but that registration can fail (launchctl bootstrap/load both
# refusing with "5: Input/output error" is a known bad state for it to get
# stuck in), and until it's fixed, dropping a file in raw_uploads does
# nothing at all: nothing is watching that folder. Rather than block on
# debugging launchd, this script now launches the exact same script
# (watch_demucs.py) itself, managed the same way as the six Node bridges --
# started, logged, and killed by this script, not by launchd. If the
# LaunchAgent gets fixed later, see the duplicate-instance guard below
# before ever running both at once.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$ROOT/data"
BRIDGE="$ROOT/src/pd/bridge"
LOGS="$DATA/logs"
PIDFILE="$DATA/.run.pids"

mkdir -p "$LOGS"

# Each bridge is a PAIR of ports and the two halves are owned by different
# processes. Pd's [netreceive] objects bind the ODD ports (9001 streamWatcher,
# 9003 sliceWriter, 9005 slicer, 9007 analyzeReader, 9009 bufferManager) plus
# 9010 for guiHub. Node binds only the ones below. Seeing `pd` on 9001-9010 is
# CORRECT and means the patch is wired properly -- an earlier version of this
# check looked at the whole range and refused to start because of it.
NODE_PORTS='8080|9002|9004|9006|9008|9011'

ports_in_use() {
  # Only a stale *Node* process matters here. If one is still holding a port,
  # the new bridge dies at startup and that half of the link is silently gone.
  lsof -nP -iUDP -iTCP -sTCP:LISTEN 2>/dev/null \
    | grep -E ":($NODE_PORTS)\b" || true
}

stop() {
  if [ -f "$PIDFILE" ]; then
    while read -r pid name; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "  stopped $name ($pid)"
      fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  # Belt and braces. The PID file only covers processes THIS script started; a
  # run that was killed with ctrl-C in another terminal, or an earlier version
  # of this script, leaves orphans that still hold the ports. The previous
  # attempt at this used an lsof|xargs|ps pipeline that failed silently and
  # reported "all stopped" while node was still sitting on 8080.
  #
  # pkill -f matches the full command line, so each bridge is named explicitly
  # rather than inferred from whatever happens to hold a port.
  local killed=0
  for script in streamWatcher_bridge slice_writer_bridge slicer_bridge \
                analyze_reader_bridge buffer_manager_bridge gui_hub_bridge src/backend/server; do
    if pkill -f "$script.js" 2>/dev/null; then
      echo "  killed leftover $script"
      killed=1
    fi
  done
  # watch_demucs.py -- same reasoning, but matched on the .py filename since
  # it's not one of the Node bridges above. This only kills instances THIS
  # script's own launch() started (or any other manually-run copy); a copy
  # running as the LaunchAgent daemon is a separate launchd-managed process
  # and needs `launchctl bootout` instead, not pkill.
  if pkill -f "watch_demucs.py" 2>/dev/null; then
    echo "  killed leftover watchDemucs"
    killed=1
  fi
  sleep 0.4

  # Report anything STILL holding a port, rather than claiming success.
  local busy
  busy=$(ports_in_use)
  if [ -n "$busy" ]; then
    echo "! these still hold our ports -- not started by this script:"
    echo "$busy" | sed 's/^/    /'
    echo "  kill them by PID (second column) if they are stale."
  else
    echo "all stopped"
  fi
}

case "${1:-start}" in
  stop)   stop; exit 0 ;;
  status)
    echo "listening:"; ports_in_use
    exit 0 ;;
esac

# ── preflight ─────────────────────────────────────────────────────────────
command -v node >/dev/null || { echo "node not found on PATH"; exit 1; }

# Same interpreter-selection setup.sh uses to RUN the watcher (not the same
# thing as ANALYSIS_PYTHON inside watch_demucs.py itself, which separately
# picks whichever python3.10 actually has madmom+essentia installed to run
# demucs/genre/madmom as subprocesses -- this one only needs the `watchdog`
# package to run the top-level watcher loop). If python3 is missing, warn
# and continue rather than exit 1 -- the six Node bridges are the part this
# script has always guaranteed; the watcher is a later addition and its
# absence shouldn't block audio from working.
WATCHER_PY="$(which python3 2>/dev/null || echo /opt/homebrew/bin/python3)"
if ! command -v "$WATCHER_PY" >/dev/null 2>&1; then
  echo "! python3 not found -- watch_demucs.py will not be started (demucs/genre/madmom won't run on new uploads)"
  WATCHER_PY=""
fi

busy=$(ports_in_use)
if [ -n "$busy" ]; then
  echo "! ports already in use -- Pd will report 'Address already in use'"
  echo "$busy" | sed 's/^/    /'
  echo "  run './run.sh stop' first, or quit the other Pd/node instance."
  exit 1
fi

# stream.txt is what tells the patch which stems to load. Two copies exist and
# only the session one is current; the top-level data/stream.txt is stale and
# points at paths that no longer exist.
STREAM="$DATA/current/stream.txt"
if [ ! -f "$STREAM" ]; then
  echo "! no $STREAM -- nothing will load. Analyse a track first."
else
  missing=0
  while read -r name path; do
    [ -z "${name:-}" ] && continue
    [ -f "$path" ] || { echo "! stream.txt: $name -> missing file $path"; missing=1; }
  done < "$STREAM"
  [ "$missing" -eq 0 ] && echo "stream.txt OK ($(grep -c . "$STREAM") stems)"
fi

# ── start ─────────────────────────────────────────────────────────────────
: > "$PIDFILE"

launch() {
  local name="$1"; shift
  "$@" > "$LOGS/$name.log" 2>&1 &
  local pid=$!
  echo "$pid $name" >> "$PIDFILE"
  sleep 0.3
  if kill -0 "$pid" 2>/dev/null; then
    printf "  %-16s ok   (pid %s)\n" "$name" "$pid"
  else
    printf "  %-16s FAILED -- see %s\n" "$name" "$LOGS/$name.log"
    tail -3 "$LOGS/$name.log" | sed 's/^/      /'
  fi
}

echo "starting bridges:"
launch sliceWriter    node "$BRIDGE/slice_writer_bridge.js"   --data-dir "$DATA" --recv-port 9002 --send-port 9003
launch slicer         node "$BRIDGE/slicer_bridge.js"         --data-dir "$DATA" --recv-port 9004 --send-port 9005
launch analyzeReader  node "$BRIDGE/analyze_reader_bridge.js" --data-dir "$DATA" --recv-port 9006 --send-port 9007
launch bufferManager  node "$BRIDGE/buffer_manager_bridge.js" --data-dir "$DATA" --recv-port 9008 --send-port 9009
launch guiHub         node "$ROOT/src/gui/gui_hub_bridge.js"  --panel-dir "$ROOT/src/gui" --data-dir "$DATA" \
                                                             --http-port 8080 --send-port 9010 --recv-port 9011

# backend -- the Gnumbat backend (src/backend/server.js, :3000): accounts
# (/auth -- the panel's sign-in / register / forgot password and the VST
# plugin's), tips, radio, etc. Run from src/backend so it finds its .env and
# public/. It needs Postgres up with the database in .env's DATABASE_URL;
# without it the server still starts but sign-in answers "database isn't
# running". Skipped if something is already on :3000 (e.g. a copy started
# by hand with `npm start`).
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  backend          already running on :3000 -- not starting a second copy"
else
  launch backend bash -c 'cd "$1" && exec node "$1/server.js"' _ "$ROOT/src/backend"
fi

# streamWatcher LAST, deliberately. It fires its baseline bang ~300ms
# after starting, and that bang runs the whole analysis chain in Pd --
# including "startStem" back out to analyzeReader. Launched first (as it
# was), that reply arrived while analyzeReader was still ~1s from binding
# its socket, so the packet was sent into a port nothing was listening on
# yet. Correct OSC, correct wiring, silently dropped -- and UDP reports
# nothing to either side. Everything it triggers must be up before it is.
launch streamWatcher  node "$BRIDGE/streamWatcher_bridge.js"  --data-dir "$DATA" --send-port 9001

# watch_demucs.py -- last, after streamWatcher is already up, for the same
# reason streamWatcher itself is last relative to the bridges above: it's
# the thing that PRODUCES the stream.txt change streamWatcher reacts to, so
# whatever it triggers should already be listening before it can trigger
# anything (matters most on a machine with existing untouched raw_uploads/
# files -- watch_demucs.py's own startup scan can fire near-immediately).
#
# Duplicate-instance guard: if the LaunchAgent daemon (or a manually-run
# copy in another terminal) is ALREADY watching raw_uploads/, starting a
# second one means two processes racing to claim the same dropped file --
# at best wasted double work, at worst two Demucs runs colliding on the same
# output folder. pgrep here, not the PIDFILE (which only this script's own
# runs), catches that no matter who started it.
if [ -n "$WATCHER_PY" ]; then
  if pgrep -f "watch_demucs.py" >/dev/null 2>&1; then
    echo "  watchDemucs      already running elsewhere (pid $(pgrep -f watch_demucs.py | tr '\n' ' ')) -- not starting a second copy"
  else
    launch watchDemucs "$WATCHER_PY" -u "$ROOT/src/demucs/watch_demucs.py"
  fi
fi

cat <<EOF

  panel   http://localhost:8080/panel.html
  logs    $LOGS/*.log
  stop    ./run.sh stop

Drop an audio file into data/sessions/<session>/raw_uploads/ and, if
watchDemucs started above, demucs -> genre -> madmom -> FluCoMa should run
end to end with no further action -- see each stage in the panel's status
line.

Now open src/pd/gnumbat-analyze.pd and TICK THE DSP BOX -- Pd starts with audio
off, and nothing will be audible until you do.
EOF

trap 'echo; stop; exit 0' INT TERM
echo "streaming logs (ctrl-C to stop everything)"
tail -f "$LOGS"/*.log
