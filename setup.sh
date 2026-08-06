#!/usr/bin/env bash
# =============================================================================
# EBYS — First-Time Setup
# Run once after cloning: bash setup.sh
# =============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMUCS_SRC="$REPO_DIR/src/demucs"
DATA_DIR="$REPO_DIR/data"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       EBYS — First-Time Setup        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Repo: $REPO_DIR"
echo ""

# ── 1. Runtime directories ────────────────────────────────────────────────────
echo "▸ Creating runtime directories..."
mkdir -p \
  "$DATA_DIR/stems" \
  "$DATA_DIR/raw_uploads" \
  "$DATA_DIR/temp" \
  "$DATA_DIR/logs" \
  "$DATA_DIR/recordings"
echo "  ✓ data/ directories ready"

# ── 2. Python virtual environment (Demucs) ───────────────────────────────────
VENV="$DEMUCS_SRC/demucs_env"
if [ -d "$VENV" ]; then
  echo "▸ demucs_env already exists — skipping"
else
  echo "▸ Creating demucs_env (Python 3.x)..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --upgrade pip --quiet
  "$VENV/bin/pip" install demucs watchdog --quiet
  echo "  ✓ demucs_env created"
fi

# ── 3. Essentia models ────────────────────────────────────────────────────────
MODELS_DIR="$DEMUCS_SRC/essentia_models"
if [ -d "$MODELS_DIR" ] && [ "$(ls -A "$MODELS_DIR" 2>/dev/null)" ]; then
  echo "▸ essentia_models already present — skipping"
else
  echo "▸ Downloading Essentia genre models (~120 MB)..."
  mkdir -p "$MODELS_DIR"
  curl -L -o "$MODELS_DIR/discogs-effnet-bs64-1.pb" \
    "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
  curl -L -o "$MODELS_DIR/genre_discogs400-discogs-effnet-1.pb" \
    "https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb"
  curl -L -o "$MODELS_DIR/genre_discogs400_labels.json" \
    "https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json"
  echo "  ✓ models downloaded"
fi

# ── 4. Generative agent environment (Stable Audio 3) ─────────────────────────
# Lives OUTSIDE this repo on purpose: it's Stability AI's own project (own
# git history, own uv-managed venv, own release cycle) — not EBYS code, not
# vendored, not gitignored-in-place. See docs/instrument/USER_LORA.md for the
# full reasoning. generate_agent.py / cricket_bridge.py just need a path to
# its venv's python3; src/tui/app.js reads the same STABLE_AUDIO_3_DIR
# convention (or its default) so the TUI's Gen screen agrees with wherever
# this script puts it. Override the env var before running setup.sh if you
# want it somewhere other than the default.
#
# Superseded here: the old stable-audio-tools/genenv install (Stable Audio
# Open Small). generate_agent.py no longer imports stable_audio_tools —
# genenv is not created or touched by this script anymore. If you still have
# one on disk from a previous setup.sh run, it's inert and safe to delete.
STABLE_AUDIO_3_DIR="${STABLE_AUDIO_3_DIR:-$HOME/stable-audio-3}"

if ! command -v uv >/dev/null 2>&1; then
  echo "▸ Installing uv (Stable Audio 3's package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

if [ -d "$STABLE_AUDIO_3_DIR" ]; then
  echo "▸ stable-audio-3 already cloned at $STABLE_AUDIO_3_DIR — syncing deps"
  (cd "$STABLE_AUDIO_3_DIR" && uv sync --extra ui --quiet)
else
  echo "▸ Cloning Stable Audio 3 to $STABLE_AUDIO_3_DIR..."
  git clone --quiet https://github.com/Stability-AI/stable-audio-3 "$STABLE_AUDIO_3_DIR"
  (cd "$STABLE_AUDIO_3_DIR" && uv sync --extra ui --quiet)
fi
echo "  ✓ stable-audio-3 environment ready"
echo "  (medium/medium-base also need Flash Attention 2 + CUDA — not installed"
echo "   here, see docs/instrument/USER_LORA.md; this sets up the CPU-capable"
echo "   small-music/small-music-base tiers only)"

echo "▸ Checking Hugging Face authentication..."
HF_WHOAMI="$(cd "$STABLE_AUDIO_3_DIR" && uv run hf auth whoami 2>/dev/null || true)"
if [ -n "$HF_WHOAMI" ]; then
  echo "  ✓ already logged in as $HF_WHOAMI"
  echo "▸ Pre-downloading Stable Audio 3 small-music weights (one-time, ~2.3 GB)..."
  if (cd "$STABLE_AUDIO_3_DIR" && uv run python3 - << 'PYEOF'
from stable_audio_3 import StableAudioModel
StableAudioModel.from_pretrained("small-music", device="cpu")
print("  ok")
PYEOF
  )
  then
    echo "  ✓ model weights cached"
  else
    echo "  ⚠  download/access failed — have you agreed to the license at"
    echo "     https://huggingface.co/collections/stabilityai/stable-audio-3 yet?"
    echo "     (logging in and accepting the license are two separate steps)"
  fi
else
  echo ""
  echo "  ⚠  Not logged into Hugging Face — the generative layer needs a"
  echo "     one-time manual step before it can download its model:"
  echo "       1. Visit https://huggingface.co/collections/stabilityai/stable-audio-3"
  echo "          and agree to the license (one-time, per HF account). If you'll"
  echo "          load a trained User LoRA later, also accept the license at"
  echo "          https://huggingface.co/collections/stabilityai/stable-audio-3-extra"
  echo "          (the '-base' checkpoints a LoRA loads onto live there separately)."
  echo "       2. Get a token: https://huggingface.co/settings/tokens"
  echo "       3. Run: (cd $STABLE_AUDIO_3_DIR && uv run hf auth login)"
  echo "     Then re-run setup.sh to finish downloading the generative model."
  echo "     (Everything else in this setup continues normally without it.)"
  echo ""
fi

# ── 5. Node dependencies ──────────────────────────────────────────────────────
echo "▸ Installing Node dependencies..."
if [ -f "$REPO_DIR/src/max/package.json" ]; then
  (cd "$REPO_DIR/src/max" && npm install --silent)
  echo "  ✓ src/max"
fi
if [ -f "$REPO_DIR/src/tui/package.json" ]; then
  (cd "$REPO_DIR/src/tui" && npm install --silent)
  echo "  ✓ src/tui"
fi
if [ -f "$REPO_DIR/src/backend/package.json" ]; then
  (cd "$REPO_DIR/src/backend" && npm install --silent)
  echo "  ✓ src/backend"
fi

# ── 6. LaunchAgent (watch_demucs daemon) ────────────────────────────────────
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS/com.ebys.watchdemucs.plist"

# Use system Python3 to RUN the watcher — it only needs `watchdog`, not the
# full demucs stack. The watcher spawns demucs_env/python3 as a subprocess.
WATCHER_PY="$(which python3 2>/dev/null || echo /opt/homebrew/bin/python3)"

# Ensure watchdog is installed in whichever Python will run the watcher
echo "▸ Ensuring watchdog is installed for watcher Python ($WATCHER_PY)..."
"$WATCHER_PY" -m pip install watchdog --quiet --break-system-packages 2>/dev/null || \
  "$WATCHER_PY" -m pip install watchdog --quiet
echo "  ✓ watchdog ready"

SCRIPT="$DEMUCS_SRC/watch_demucs.py"
LOG="$DATA_DIR/logs/watchdemucs.log"

mkdir -p "$LAUNCH_AGENTS"

echo "▸ Generating LaunchAgent plist..."
cat > "$PLIST_DEST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ebys.watchdemucs</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>exec $WATCHER_PY -u $SCRIPT</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOG</string>

    <key>StandardErrorPath</key>
    <string>$LOG</string>

    <key>WorkingDirectory</key>
    <string>$DEMUCS_SRC</string>
</dict>
</plist>
PLIST

echo "  ✓ plist written to $PLIST_DEST"

# Unload any running instance (works on both old and new macOS)
launchctl bootout "gui/$(id -u)/com.ebys.watchdemucs" 2>/dev/null || \
  launchctl unload "$PLIST_DEST" 2>/dev/null || true

sleep 1  # let the old process die

# Load the new plist
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || \
  launchctl load "$PLIST_DEST"
echo "  ✓ LaunchAgent loaded (daemon will auto-start on login)"

# ── 7. LaunchAgent (watch_generated daemon) ───────────────────────────────────
# Same watcher-daemon pattern as step 6, one folder further downstream:
# watch_demucs watches raw_uploads/ (your own mixes); this watches
# data/generated/ (generate_agent.py's own output folder) for new
# manifest_*.json files and runs ingest_generated.py on each as it lands.
# Reuses $WATCHER_PY from step 6 — watchdog is already installed for it there,
# and this script has no other dependency beyond the stdlib.
GEN_PLIST_DEST="$LAUNCH_AGENTS/com.ebys.watchgenerated.plist"
GEN_SCRIPT="$DEMUCS_SRC/watch_generated.py"
GEN_LOG="$DATA_DIR/logs/watchgenerated.log"

echo "▸ Generating watch_generated LaunchAgent plist..."
cat > "$GEN_PLIST_DEST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ebys.watchgenerated</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>exec $WATCHER_PY -u $GEN_SCRIPT</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$GEN_LOG</string>

    <key>StandardErrorPath</key>
    <string>$GEN_LOG</string>

    <key>WorkingDirectory</key>
    <string>$DEMUCS_SRC</string>
</dict>
</plist>
PLIST

echo "  ✓ plist written to $GEN_PLIST_DEST"

launchctl bootout "gui/$(id -u)/com.ebys.watchgenerated" 2>/dev/null || \
  launchctl unload "$GEN_PLIST_DEST" 2>/dev/null || true

sleep 1

launchctl bootstrap "gui/$(id -u)" "$GEN_PLIST_DEST" 2>/dev/null || \
  launchctl load "$GEN_PLIST_DEST"
echo "  ✓ LaunchAgent loaded (daemon will auto-start on login)"

# ── 8. LaunchAgent (watch_lora daemon) ─────────────────────────────────────────
# Third watcher-daemon, same pattern as steps 6/7 — see docs/instrument/
# USER_LORA.md and watch_lora.py's own docstring for the full design. Unlike
# the other two, this one polls instead of reacting to filesystem events, and
# it ONLY handles prep/build (normalize + train/val split) — it never trains
# anything. Training is deliberately a manual step (:lora train in the TUI),
# since it's an hours-long local-GPU job that shouldn't start without someone
# choosing the moment. No watchdog dependency of its own — stdlib only,
# reuses $WATCHER_PY from step 6 purely for consistency.
LORA_PLIST_DEST="$LAUNCH_AGENTS/com.ebys.watchlora.plist"
LORA_SCRIPT="$DEMUCS_SRC/watch_lora.py"
LORA_LOG="$DATA_DIR/logs/watchlora.log"

echo "▸ Generating watch_lora LaunchAgent plist..."
cat > "$LORA_PLIST_DEST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ebys.watchlora</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>exec $WATCHER_PY -u $LORA_SCRIPT</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LORA_LOG</string>

    <key>StandardErrorPath</key>
    <string>$LORA_LOG</string>

    <key>WorkingDirectory</key>
    <string>$DEMUCS_SRC</string>
</dict>
</plist>
PLIST

echo "  ✓ plist written to $LORA_PLIST_DEST"

launchctl bootout "gui/$(id -u)/com.ebys.watchlora" 2>/dev/null || \
  launchctl unload "$LORA_PLIST_DEST" 2>/dev/null || true

sleep 1

launchctl bootstrap "gui/$(id -u)" "$LORA_PLIST_DEST" 2>/dev/null || \
  launchctl load "$LORA_PLIST_DEST"
echo "  ✓ LaunchAgent loaded (daemon will auto-start on login)"

# ── 9. Backend .env reminder ──────────────────────────────────────────────────
if [ ! -f "$REPO_DIR/src/backend/.env" ]; then
  echo ""
  echo "⚠  No .env found in src/backend/"
  echo "   Copy .env.example and fill in your credentials:"
  echo "   cp src/backend/.env.example src/backend/.env"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║           Setup complete ✓           ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Open src/max/ebys-analyze.maxpat in Max 8"
echo "  2. Drop an audio file into data/raw_uploads/"
echo "  3. Watch the TUI:  node src/tui/sdj-tui.js"
echo "  4. (optional) Drop tracks into data/lora_corpus/raw/ to grow a personal"
echo "     LoRA — watch_lora.py automatically preps them into train/val, but"
echo "     training itself is manual: run :lora train in the TUI when you're"
echo "     ready to spend the GPU time. :lora status shows where things stand."
echo "     See docs/instrument/USER_LORA.md."
echo ""
