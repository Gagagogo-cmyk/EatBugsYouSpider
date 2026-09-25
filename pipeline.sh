#!/usr/bin/env bash
# pipeline.sh -- the whole Gnumbat analysis pipeline, headless, started at login.
#
#   ./pipeline.sh install     install + start the LaunchAgent (runs at every login from now on)
#   ./pipeline.sh uninstall   stop it and remove the LaunchAgent
#   ./pipeline.sh restart     restart everything (after a git pull, a patch edit, ...)
#   ./pipeline.sh stop        stop everything until the next login (or `restart`)
#   ./pipeline.sh status      what's running
#   ./pipeline.sh run         run in this terminal instead (what the LaunchAgent calls; ctrl-C stops)
#
# WHAT IT STARTS, IN ORDER
#   1. Pure Data, headless (-nogui -nosound), with the analysis patch open and DSP on.
#      Started FIRST so its [netreceive] ports (9001/9003/9005/9007/9009/9010) are already
#      bound when the Node bridges start talking to it -- otherwise streamWatcher's first bang
#      goes into a port nobody is listening on (UDP drops it silently).
#   2. ./run.sh -- the six Node bridges + watch_demucs.py, exactly as before. watch_demucs.py
#      is what runs Demucs, then Essentia (genre_tagger.py) and madmom (madmom_tagger.py) on
#      each new file in raw_uploads/, so those two have no daemon of their own: they start
#      when a Bake arrives.
#   Then it watches: if Pd dies it is restarted; if run.sh dies the whole job exits and
#   launchd starts it again 30 s later.
#
# Logs: data/logs/pd.log, data/logs/pipeline.log, and run.sh's own data/logs/*.log.
# Override the Pd binary with PD_BIN=/path/to/pd, the patch with PD_PATCH=/path/to/patch.pd.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/data/logs"
LABEL="com.gnumbat.pipeline"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
mkdir -p "$LOGS"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# ── find Pd ──────────────────────────────────────────────────────────────────
find_pd() {
  if [ -n "${PD_BIN:-}" ] && [ -x "$PD_BIN" ]; then echo "$PD_BIN"; return; fi
  # newest Pd.app first (Pd-0.55-2.app sorts after Pd-0.54-1.app)
  local app
  while IFS= read -r app; do
    [ -x "$app/Contents/Resources/bin/pd" ] && { echo "$app/Contents/Resources/bin/pd"; return; }
  done < <(ls -d /Applications/Pd*.app "$HOME"/Applications/Pd*.app 2>/dev/null | sort -r)
  command -v pd 2>/dev/null && return
  for p in /opt/homebrew/bin/pd /usr/local/bin/pd; do [ -x "$p" ] && { echo "$p"; return; }; done
}

find_patch() {
  if [ -n "${PD_PATCH:-}" ] && [ -f "$PD_PATCH" ]; then echo "$PD_PATCH"; return; fi
  for p in "$ROOT/src/pd/gnumbat-analyze.pd" "$ROOT/src/pd/ebys-analyze.pd"; do
    [ -f "$p" ] && { echo "$p"; return; }
  done
}

pd_port_owner() { lsof -nP -iUDP:9007 2>/dev/null | awk 'NR>1 {print $1" (pid "$2")"; exit}'; }

start_pd() {
  local pd patch
  pd="$(find_pd)"; patch="$(find_patch)"
  if [ -z "$pd" ]; then log "! Pure Data not found (install Pd from puredata.info into /Applications, or set PD_BIN)"; return 1; fi
  if [ -z "$patch" ]; then log "! analysis patch not found in src/pd/ (set PD_PATCH)"; return 1; fi
  local owner; owner="$(pd_port_owner)"
  if [ -n "$owner" ]; then
    log "  Pd: port 9007 already held by $owner -- a Pd with the patch is already open, not starting a second one"
    PD_PID=""
    return 0
  fi
  "$pd" -nogui -nosound -nomidi -stderr \
        -path "$ROOT/src/FluidCorpusManipulation" -path "$ROOT/src/pd" -path "$ROOT/src/pd/lib" \
        -open "$patch" -send "pd dsp 1" \
        >> "$LOGS/pd.log" 2>&1 &
  PD_PID=$!
  sleep 2
  if kill -0 "$PD_PID" 2>/dev/null; then
    log "  Pd headless ok (pid $PD_PID)  $pd  $(basename "$patch")"
  else
    log "! Pd exited at startup -- last lines of data/logs/pd.log:"
    tail -5 "$LOGS/pd.log" | sed 's/^/      /'
    PD_PID=""
    return 1
  fi
}

# ── the long-running job ─────────────────────────────────────────────────────
run() {
  PD_PID=""; RUN_PID=""
  cleanup() {
    log "stopping"
    bash "$ROOT/run.sh" stop >/dev/null 2>&1          # bridges + watch_demucs (by name, reliable)
    [ -n "$RUN_PID" ] && { pkill -P "$RUN_PID" 2>/dev/null; kill "$RUN_PID" 2>/dev/null; }
    [ -n "$PD_PID" ] && kill "$PD_PID" 2>/dev/null
    exit 0
  }
  trap cleanup INT TERM

  log "Gnumbat pipeline starting in $ROOT"
  # leftovers from a previous run (crash, logout without clean stop) would hold the ports
  bash "$ROOT/run.sh" stop >/dev/null 2>&1
  start_pd || log "  continuing without Pd: Demucs / Essentia / madmom still run, FluCoMa won't"

  # run.sh ends by tail -f'ing data/logs/*.log; keep only its startup report (up to "streaming
  # logs") -- piping the tail itself into a .log in that same folder would feed back into itself.
  bash "$ROOT/run.sh" > >(quiet=""; while IFS= read -r line; do
                             [ -z "$quiet" ] && echo "$line"
                             case "$line" in *"streaming logs"*) quiet=1 ;; esac
                           done) 2>&1 &
  RUN_PID=$!
  log "  run.sh (bridges + watch_demucs) pid $RUN_PID"

  local pd_restarts=0
  while true; do
    sleep 5 & wait $!
    if ! kill -0 "$RUN_PID" 2>/dev/null; then
      log "! run.sh exited -- see data/logs/pipeline.log; launchd will restart the pipeline"
      [ -n "$PD_PID" ] && kill "$PD_PID" 2>/dev/null
      exit 1
    fi
    if [ -n "$PD_PID" ] && ! kill -0 "$PD_PID" 2>/dev/null; then
      pd_restarts=$((pd_restarts + 1))
      log "! Pd died (restart #$pd_restarts)"
      [ "$pd_restarts" -gt 20 ] && { log "! Pd keeps dying -- giving up on it; check data/logs/pd.log"; PD_PID=""; continue; }
      start_pd || true
    fi
  done
}

# ── LaunchAgent ──────────────────────────────────────────────────────────────
install_agent() {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/pipeline.sh</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>  <string>$ROOT</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key>  <integer>30</integer>
  <key>ProcessType</key>       <string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key> <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>   <string>$LOGS/pipeline.log</string>
  <key>StandardErrorPath</key> <string>$LOGS/pipeline.log</string>
</dict>
</plist>
EOF
  # the older watch_demucs-only agent would race this one for raw_uploads/ -- turn it off
  if [ -f "$HOME/Library/LaunchAgents/com.gnumbat.watchdemucs.plist" ]; then
    launchctl bootout "$DOMAIN/com.gnumbat.watchdemucs" 2>/dev/null
    mv "$HOME/Library/LaunchAgents/com.gnumbat.watchdemucs.plist" "$HOME/Library/LaunchAgents/com.gnumbat.watchdemucs.plist.disabled"
    echo "  disabled the old com.gnumbat.watchdemucs agent (this one runs watch_demucs.py now)"
  fi
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
  if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load "$PLIST"; then
    echo "  installed $PLIST -- starts now and at every login"
    echo "  logs: $LOGS/pipeline.log  $LOGS/pd.log"
  else
    echo "! launchctl refused the agent. Try: launchctl bootout $DOMAIN/$LABEL; ./pipeline.sh install"
  fi
}

case "${1:-status}" in
  run)       run ;;
  install)   install_agent ;;
  uninstall) launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
             rm -f "$PLIST"; bash "$ROOT/run.sh" stop; echo "  removed $LABEL" ;;
  restart)   launchctl kickstart -k "$DOMAIN/$LABEL" && echo "  restarted" ;;
  stop)      launchctl kill TERM "$DOMAIN/$LABEL" && echo "  stopped (starts again at next login, or ./pipeline.sh restart)" ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "agent: $(launchctl print "$DOMAIN/$LABEL" | awk -F'= ' '/^\tstate/ {print $2; exit}')  ($LABEL)"
    else
      echo "agent: not installed (./pipeline.sh install)"
    fi
    printf 'pd:            %s\n' "$(pgrep -fl 'pd -nogui' | head -1 || true)"
    printf 'watch_demucs:  %s\n' "$(pgrep -f watch_demucs.py | tr '\n' ' ')"
    bash "$ROOT/run.sh" status ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
