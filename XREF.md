# XREF.md

Cross-reference between the doc-path conventions used in `docs/` and this repo's actual layout, plus a quick lookup for entry points, ports, and env vars. Written to sit alongside `CLAUDE.md`; read that first for the narrative architecture.

## Doc-path → real-path aliases

`docs/instrument/ARCHITECTURE.md` (and other instrument docs) describe files under placeholder paths that don't exist literally in this repo. Mapping:

| Doc path prefix | Real path |
|---|---|
| `EBYS_INFRA/` (root-level scripts, daemons, JSON/db files) | `src/demucs/` (scripts) + `data/` (JSON, db, logs, stream.txt) |
| `EBYS_INFRA/MAX/` or `MAX/` | `src/max/` |
| `EBYS_INFRA/TUI/` or `TUI/` | `src/tui/` |
| `Tipping_protocol/backend/` (in `docs/ARCHITECTURE.md`) | `src/backend/` (an older copy also sits at `archive/tipping_protocol/backend/` — not live) |

## Directory index

| Path | What's there |
|---|---|
| `src/demucs/` | Python analysis pipeline: `watch_demucs.py` (ingestion daemon), `genre_tagger.py`, `madmom_tagger.py`, `import_library.py`, `add_tension.py`, `add_stereo_features.py`, LoRA/generative scripts (`generate_agent.py`, `cricket_bridge.py`, `watch_lora.py`, `watch_generated.py`, `train_bias.py`, `train_and_score_lora.py`), plus `demucs_env/` and `genenv/` (Python venvs — gitignored). |
| `src/max/` | Live Max/MSP instrument: `ebys-analyze.maxpat` (main patch), `ebys-pitch.maxpat` (formant-preserving pitch shifter subpatch), all Node-for-Max control-logic `.js` files (`ws_server.js`, `slicer.js`, `buffer_manager.js`, `slot_router.js`, `ms_router.js`, `eq_router.js`, `spat_fx_router.js`, `bake_manager.js`, `cricket.js`), `patch_*.py` (scripted patch editors), and ~25 `.bak*` files (candidates for archiving per `docs/instrument/PD_MIGRATION.md`). |
| `src/pd/` | In-progress Pure Data port: `ebys-analyze.pd` + supporting `.pd` files, `src/pd/bridge/*.js` (OSC bridge to the Node control-logic layer, `osc.js` is the dependency-free UDP OSC codec), `CONVERSION_NOTES.md` (what was deliberately dropped in the port), `GUI_PARAMETER_MAPPING.md`. |
| `src/tui/` | Terminal control surface: `sdj-tui.js` (main app, `blessed` + `ws`), `app.js`, `link_server.js` (multi-deck LINK protocol), `session_manager.js`, `cricket-voice.js` (offline Cricket voice-training tool), diagnostics (`test-ollama.js`, `keytest.js`, `keytest2.js`, `tagtest.js`). |
| `src/backend/` | Tipping protocol Express API: `server.js` entry, `routes/{auth,slices,tips,accounts}.js`, `db/{queries.js,schema.sql}`, `split.js` (split equation), `split_viz.js`, `public/tip.html`. Also `event-scraper/` — a separate Go module, unrelated to the Node API. |
| `src/frontend/` | Present but currently empty. |
| `data/` | Runtime state (gitignored): `raw_uploads/`, `stems/`, `recordings/`, `sessions/`, `logs/`, `lora_corpus/`, `generated/`, plus root JSON/db files (`genres.json`, `downbeats.json`, `stream.txt`, `sessions.json`, `current_session.txt`, `instrument_status.json`) and the SQLite `ebys.db`. |
| `docs/` | `README.md` (doc index), `ARCHITECTURE.md` (system-wide: backend/Stripe/DB/radio/infra), `instrument/` (engine internals, roadmaps), `protocol/` (tipping + split equation specs), `business/` (revenue models), `platform/` (product-level overview). |
| `archive/` | Superseded code kept for history, including an older `tipping_protocol/backend/` copy — not the live backend. |

## Entry points

| To run | Command |
|---|---|
| Instrument control surface | `node src/tui/sdj-tui.js` |
| Backend API (dev) | `cd src/backend && npm run dev` |
| Backend API (prod) | `cd src/backend && npm start` |
| Ingestion daemon | Runs via LaunchAgent (`com.ebys.watchdemucs.plist`) after `setup.sh`; manually: `python3 src/demucs/watch_demucs.py` |
| Max patch | Open `src/max/ebys-analyze.maxpat` in Max 8 |
| Pd patch | Open `src/pd/ebys-analyze.pd` in Pure Data ≥ 0.52 |
| Full first-time setup | `bash setup.sh` (repo root) |

## Ports & network protocols

| Port / protocol | Used for |
|---|---|
| WebSocket `:8080` | `ws_server.js` ↔ `sdj-tui.js` — descriptor telemetry, commands, `buildIndex`, pipeline progress |
| HTTP `POST /progress` on `:8080` | `watch_demucs.py` → `ws_server.js` pipeline-stage events |
| Ollama `localhost:11434` `/api/chat` | `cricket.js` and `src/tui` Cricket chat → local LLM |
| UDP OSC (`netreceive~`/`netsend~`) | `src/pd/bridge/*.js` ↔ Pd patches (Max has no equivalent — control logic stays in Node either way) |
| UDP multicast (LAN, no internet) | LINK protocol — multi-deck clock/state sync, `src/tui/link_server.js`, see `docs/instrument/LINK.md` |
| Railway `PORT` (assigned) | `src/backend/server.js` Express listener |

## Key env vars (`src/backend/.env`)

| Variable | Used by |
|---|---|
| `DATABASE_URL` | `db/queries.js` |
| `STRIPE_SECRET_KEY` | `routes/tips.js`, `routes/accounts.js` |
| `STRIPE_WEBHOOK_SECRET` | `routes/tips.js` webhook signature check |
| `JWT_SECRET` | `routes/auth.js` |
| `BASE_URL` | `routes/accounts.js` — Stripe Connect redirect URLs |
| `PORT` | `server.js` — set automatically by Railway |

## Data file lifecycle (instrument side)

| File | Written by | Read by |
|---|---|---|
| `data/stream.txt` | `watch_demucs.py` | `streamWatcher.js` (polls every 1s) |
| `data/genres.json` | `genre_tagger.py` | `ws_server.js`, `sdj-tui.js` |
| `data/downbeats.json` | `madmom_tagger.py` | `ws_server.js` → `slicer.js` |
| `src/max/analysis_library.json` | `slice_writer.js`; amended by `add_tension.py`, `add_stereo_features.py` | `ws_server.js` |
| `src/max/ebys_index.json` | `ws_server.js` (reassembled from `slicer.js`) | `slicer.js` at boot (cached) |
| `data/ebys.db` (SQLite) | `import_library.py`, `add_tension.py` (tension columns only) | Canonical store; primary source once Pd migration completes |
| `src/max/umap_coords.json`, `stem_ranges.json` | `ws_server.js` (t-SNE via `tsne_worker.js`) | `sdj-tui.js` (spatial navigator, bar scaling) |
| `training_log.jsonl` | `ws_server.js` on `:bake` | `convert_bakes.py` → `finetune.sh` (Cricket LoRA) |

## Known doc/code drift

- `docs/instrument/PD_MIGRATION.md` states "zero `.pd` files exist" — `src/pd/` currently has ~20, including a working OSC bridge (`src/pd/bridge/`). Treat `src/pd/CONVERSION_NOTES.md` as the current source of truth over that doc's status claim.
- `docs/instrument/ARCHITECTURE.md`'s object inventory for `src/max/` predates several additions (`eq_router.js`, `spat_fx_router.js`, `band_mask_init.js`, `formant_lifter_init.js`) — `spat_fx_router.js` and `ms_router.js` overlap on width/FX-send ownership, flagged as unreconciled in `PD_MIGRATION.md`.
- `docs/instrument/REAPER_INTEGRATION.md` is superseded by `docs/instrument/VST_PLUGIN_ROADMAP.md` — kept only as historical record.
- `docs/ARCHITECTURE.md` and `docs/instrument/ARCHITECTURE.md` are two separate files with overlapping names — the former is system-wide (backend/Stripe/radio/infra), the latter is instrument-internal only.
