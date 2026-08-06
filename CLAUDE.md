# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

EBYS (Eat Bugs You Spider!) is three things sharing one codebase:

1. **The instrument** — a real-time generative audio collage engine. Separates uploaded tracks into stems (Demucs), analyzes every transient slice (FluCoMa), indexes slices by spectral descriptor, and rebuilds music live, steered by an AI personality ("Cricket") on a local Ollama LLM. Currently running on Max/MSP, mid-migration to Pure Data.
2. **The tipping protocol / backend** — an Express + PostgreSQL service (Railway-hosted) that logs live sessions, runs a transformation-level split equation, and pays DJs/artists via Stripe Connect.
3. **The web radio** — Max audio → BlackHole → Liquidsoap → Icecast, with a listener-facing now-playing + tip page.

Read `XREF.md` first — it maps the doc-path conventions used throughout `docs/` (`EBYS_INFRA/`, `MAX/`, `TUI/`) onto this repo's real directories, which don't share those names.

## Commands

**First-time setup** (macOS only — installs Python venvs, Essentia models, node_modules, and three LaunchAgent daemons):
```bash
bash setup.sh
```

**Run the instrument (dev loop):**
```bash
# 1. Open src/max/ebys-analyze.maxpat in Max 8 (or the Pd equivalent, see below)
# 2. Drop an audio file into data/raw_uploads/  → watch_demucs.py picks it up automatically
# 3. Terminal control surface:
node src/tui/sdj-tui.js
```

**Run the backend:**
```bash
cd src/backend
npm install
npm run dev     # nodemon server.js
npm start       # node server.js (production)
```
Needs `src/backend/.env` (copy from `.env.example` if present) with `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `BASE_URL`.

**Python analysis pipeline** (run manually when needed; `watch_demucs.py` runs these automatically on new uploads):
```bash
cd src/demucs
python3 import_library.py              # sync JSON → ebys.db
python3 import_library.py --status     # row counts
python3 add_tension.py                 # tension_C/E/F/P/H/T fields (all tracks)
python3 add_tension.py "Track Name"    # single track
python3 add_stereo_features.py         # pan/width fields
```
`demucs_env/` (Python 3.14, torch/demucs) and system Python 3.10–3.11 (essentia, madmom) are separate, version-incompatible environments — don't try to unify them.

**No test suite, linter, or CI exists in this repo.** Files named `*test*.js` under `src/tui/` and `src/max/` (e.g. `keytest.js`, `slicer_test.js`) are manual diagnostic scripts run directly with `node`, not an automated suite.

## Architecture

### The pipeline (instrument side)

```
raw_uploads/ → watch_demucs.py (Demucs + genre_tagger.py + madmom_tagger.py)
            → stems on disk + genres.json + downbeats.json + ebys.db
            → stream.txt → streamWatcher.js polls it → FluCoMa analysis in Max
            → analyze_reader.js → slice_writer.js → analysis_library.json
            → add_tension.py, add_stereo_features.py (offline post-processors)
            → ws_server.js builds the slice index (buildIndex, t-SNE via tsne_worker.js)
            → slicer.js selects segments live → buffer_manager.js → slot_router.js → karma~
            → sdj-tui.js (terminal dashboard + Cricket AI chat) over WebSocket :8080
```

Full blow-by-blow, every file, every message format: `docs/instrument/ARCHITECTURE.md` (see its §12 "Who Talks to Whom" for the definitive data-flow map). System-wide view including backend/Stripe/radio: `docs/ARCHITECTURE.md`.

### Why two parallel engines exist (`src/max/` and `src/pd/`)

The instrument is mid-port from Max/MSP to Pure Data (target: DAW-plugin-friendly, no Max license required). Both are live:
- `src/max/*.js` — the original Node-for-Max control logic (`ws_server.js`, `slicer.js`, `buffer_manager.js`, `slot_router.js`, `ms_router.js`, `eq_router.js`, `cricket.js`, etc.), wired inside `ebys-analyze.maxpat`.
- `src/pd/*.pd` + `src/pd/bridge/*.js` — the Pd patches plus a dependency-free OSC bridge (`src/pd/bridge/osc.js`, stdlib `dgram` only) that lets the same control-logic pattern talk to Pd's `netreceive~`/`netsend~` over UDP instead of living inside the host process.
- Pitch/formant shifting, karma~-style looping, EQ, and gain-staging were deliberately **not** ported to the Pd version — see `src/pd/CONVERSION_NOTES.md` for why (those move to a DAW plugin instead).
- `docs/instrument/PD_MIGRATION.md` describes migration priority/tiers but is stale on current status (it claims zero `.pd` files exist; `src/pd/` has ~20). Trust the directory listing and `CONVERSION_NOTES.md` over that doc's "Reality check" section for current state.
- The long-term plugin direction (JUCE VST3/AU wrapping this same analysis/decision core) is `docs/instrument/VST_PLUGIN_ROADMAP.md`.

### Backend (`src/backend/`)

Express app, entry `server.js`, four route modules (`/auth`, `/slices`, `/tips`, `/accounts`) plus `db/queries.js` (Postgres) and `split.js` (the transformation-level split equation — L0–L3 based on `simultaneous_n` and `seg_variance` signals pinged from the live instrument). Stripe webhook route needs `express.raw()` mounted *before* `express.json()` — order matters for signature verification. Full schema, API reference, and env var table: `docs/ARCHITECTURE.md`.

Also present but unrelated to the tipping protocol: `src/backend/event-scraper/` is a standalone Go module (own `go.mod`) for venue/event scraping — not part of the Node backend's request path.

### Data files that matter across the whole pipeline

`analysis_library.json` (raw FluCoMa output), `ebys_index.json` (built slice database, cached), `ebys.db` (SQLite — canonical queryable store, becoming primary as Pd migration proceeds), `downbeats.json`, `genres.json`. All under `data/` in this repo (see `XREF.md` for the doc-path → real-path mapping). Full schema per file: `docs/instrument/ARCHITECTURE.md` §9.

### Generative / LoRA layer

`generate_agent.py`, `cricket_bridge.py`, and the `watch_lora.py`/`watch_generated.py` daemons drive an in-progress generative layer (Stable Audio 3, cloned outside this repo per `docs/instrument/USER_LORA.md`). Training (`:lora train` in the TUI) is always a manual step, never automatic — an hours-long local-GPU job shouldn't start unattended.

### Docs map

`docs/README.md` is the doc index (platform/protocol/instrument/business folders). Start there for anything not covered above; `XREF.md` in this repo root maps the path conventions those docs use onto actual file locations.
