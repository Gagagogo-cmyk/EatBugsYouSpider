# Gnumbat Core — Bakes, Training, Remixing: Architecture

Status: **design + first prototype.** Sections marked **[built]** exist in `src/core/` (Python reference core) or `src/plugin/` (JUCE shell). Everything else is design. §13 says exactly what was verified and what was not.

Read this after `CLAUDE.md`/`XREF.md`. It **extends** `docs/instrument/VST_PLUGIN_ROADMAP.md` (which it agrees with on the big decisions: JUCE plugin is a thin host, non-real-time work happens in a background service, FluCoMa runs in Pd) and **changes** it in four places listed in §14 — those need your call.

---

## 1. Analysis of the concept

### 1.1 What Gnumbat is, stated so it can be enforced

> The model's output space is *references into a corpus*, never waveforms.

That single type decision does more than any policy. The engine's product is an **Arrangement**: a list of placements `(bake, stem, source range) + a whitelisted transform chain + a time on a grid`. Audio is a *deterministic function* of `(Arrangement, Corpus)` computed by a dumb player. There is no code path by which a neural net can emit samples, because nothing downstream accepts samples from it. Consequences worth designing around:

- **Provenance invariant.** Every output sample is traceable to `(bake_id, stem, source_frame)` plus a transform chain. The player can therefore be tested bit-exactly: identity transforms must reproduce source samples exactly.
- **The model must never depend on Bake IDs.** No ID embeddings, no memorized identities. It scores *features and text*, so a model trained on your Bakes can drive remixing over a different corpus (a new DJ set, a radio archive) as long as that corpus was analysed with the same analysis profile. This is what makes "trained model" and "corpus" separable, and what makes a shareable model meaningful.
- **Training ≠ generation, structurally.** What is trained is (a) a text/tag ↔ audio-feature association (retrieval), (b) a transition/compatibility scorer over pairs of slices (the existing `train_bias_torch.py` taste model is already exactly this), (c) later, a policy that maps control state → next slice. All three read feature vectors and emit scores or indices.

### 1.2 What a Bake is

A Bake is the **unit of both corpus and supervision**: `(audio, stems, analysis, human semantics)`. The same abstraction covers a 4-bar DAW bounce and an imported 6-minute track (a long Bake, "Bake from file"). Slices are sub-units *derived by analysis inside* a Bake — they are not Bakes. This unification is what lets the same core serve the DAW plugin, the web tool, the DJ deck and the radio.

### 1.3 The ML problem, honestly

A user will produce tens to hundreds of Bakes, not millions. That dictates the model, not the other way round:

- **Small models on analysis features** (MLP heads, metric learning, kNN with a learned metric) — not raw-audio networks trained from scratch. Pretrained *frozen* audio encoders may later be plugged in as additional **feature extractors** (they are analysis, not generation) — the extractor registry (§5.4) has a slot for that.
- **Text side:** tags are user-defined, so the vocabulary must be **learned from the user's own Bakes** (per-token embeddings trained from scratch; optional frozen sentence-encoder prior for phrases). A tag used once cannot be learned — the tooling must show vocabulary statistics (frequency per tag) so the user sees that.
- **Hold out by Bake, never by slice** (slices of one Bake leak into each other), and always report a keyword-search baseline. If "rise" → retrieval doesn't beat `notation contains rise`, the model isn't earning its keep. Do this *early* (§13, Phase 0b).

### 1.4 Names that already exist in this repo (collisions)

| New term | Existing meaning | Resolution proposed here |
|---|---|---|
| **Bake** | `:bake` in the live instrument = a *recorded sequence of slice selections* (`bake_snapshots` table, `docs/instrument/BAKE.md`) used to weight the Cricket/slicer. No audio is stored. | New Bake is the canonical noun. The old one is a **Performance Bake** (path through the index). It can later be *imported* as a Bake by rendering the path. Nothing in `src/max` is renamed. |
| **body** | Existing stem label is `melody` (Demucs `other`), hard-wired in `gnumbat.db` (`CHECK(stem IN ('vocals','melody','bass','drums'))`). | Stem names are **data** in the new core (`stem_map` in each decomposition record). `other → body` is a mapping, not a schema constant. Legacy `melody` stays untouched in the instrument. |
| **Descriptors** `C S E F P H T M0–M5` | Hard-coded columns in `gnumbat.db`/`analysis_library.json`. Adding one means a schema migration. | New core uses a **feature registry** (§5.4): features are rows of data with ids like `spectral.centroid`. Legacy letters are aliases. |
| **Generative layer** | `GENERATIVE_LAYER.md`/`USER_LORA.md` plan Stable Audio LoRA generation. | Contradicts the principle in §1.1. See §14. |

---

## 2. Core abstractions

```
Library ──contains──▶ Bake ──has──▶ Stem*(via Decomposition)   [raw material]
                       │      ├──▶ Analysis*(via Extractor)     [features, slices]
                       │      └──▶ Semantic (Notation, Tags…)   [human meaning]
                       │
Corpus   = a selection of Bakes/stems + their slice index (what the engine may draw from)
Dataset  = named, mutable set of Bakes + labelling intent
  └─ DatasetVersion = IMMUTABLE pin: (bake_id, semantic_rev, analysis_id, hashes)…   [training input]
Model    = named lineage
  └─ ModelVersion  = IMMUTABLE trained artifact, pinned to one DatasetVersion + analysis profile + recipe + seed
Embedding = a vector space (and vectors) over bakes/slices/tags/prompts
Slice     = (bake, stem, [t0,t1)) + a feature row
Command   = strict structured message from LLM/UI/hardware to the Remix engine
Arrangement = time-ordered Placements of Slices + transforms   (the engine's only output)
Remix     = a run: (ModelVersion, Corpus snapshot, engine version, seed, Command log) → Arrangement
```

Deliberate separations (each is a bug source if merged):

| Concern | Lives in | Written by | Why separate |
|---|---|---|---|
| Raw material (audio, stems) | `audio/`, `decompositions/` | capture / worker | Immutable, large, content-hashed |
| Analysis (features, slices) | `analyses/` | worker | Regenerable under new configs; many per Bake |
| Human semantics (notation, tags, ratings) | `semantic.json` (+history) | any client | Irreplaceable — must never be overwritten by a machine |
| Dataset/model membership | `datasets/`, `models/` | training system | A Bake must not know which models used it |
| Derived caches (index, embeddings, maps) | `derived/` | worker | Deletable and rebuildable |

**Corpus vs Dataset.** A Dataset is for *training* and is labelled; a Corpus is for *retrieval at remix time* and needn't be. Often the same Bakes, but a model trained on Dataset D may remix over Corpus C ⊄ D.

---

## 3. System architecture

```
┌─────────────────────────────── FRONTENDS (thin) ───────────────────────────────┐
│ JUCE VST3/AU     Standalone      Web tool        DJ deck          Radio server │
│ (capture, bank,  (JUCE, same     (browser,       (embedded/desk-  (headless    │
│  map, drag-out)   code)          WASM+HTTP)      top + hardware)   player CLI)  │
└──────┬───────────────┬───────────────┬────────────────┬───────────────┬────────┘
       │               │               │                │               │
┌──────▼───────────────▼───────────────▼────────────────▼───────────────▼────────┐
│ L1  GNUMBAT CORE LIBRARIES — implementations of the contracts                    │
│   C++ (juce_core-only): capture ring, library reader/writer, filters, notation,  │
│                         job submitter, map view-model      [built: src/plugin/core]
│   Python (reference):   library, state machine, jobs, worker, analysis, datasets,│
│                         embeddings, map projection, training  [built: src/core]  │
│   later: player (C++), remix controller (Python→ONNX), TS/WASM view layer        │
└──────────────────────────────────────┬──────────────────────────────────────────┘
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│ L0  CONTRACTS — language-neutral, versioned, tested for conformance              │
│   JSON Schemas · library file layout · job protocol · filter query grammar ·     │
│   notation-profile grammar · RemixCommand · Arrangement · conformance vectors    │
│                                                        [built: src/core/schemas] │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ files on disk (source of truth) + spool jobs
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│ SERVICES (separate OS processes, supervised, restartable)                        │
│  Worker (Python 3.10–3.11): job runner ── Demucs subprocess (own venv)           │
│                                         ├─ Pd batch subprocess (FluCoMa)         │
│                                         ├─ python-ref extractor (fallback)       │
│                                         ├─ embeddings / t-SNE / (UMAP)           │
│                                         └─ PyTorch training (manual jobs only)   │
│  Ollama (Cricket) — LLM controller for live remix (later)                        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Which language for what

| Component | Language | Reason |
|---|---|---|
| Plugin shell, capture, bank/map UI, drag-out | **C++ / JUCE 8** | Only realistic way to ship VST3/AU/Standalone from one codebase. JUCE is AGPLv3-or-commercial → compatible with this repo's AGPL-3.0 (verify the licence tier before shipping binaries). |
| Capture ring buffer, ID gen, filter evaluator, notation parser, library reader | **C++ (juce_core + std only)** | Must run in the plugin, standalone, DJ deck and radio without Python present. |
| Contracts | **JSON Schema** | Every language can validate/generate from it. |
| Worker, dataset builder, analysis glue, embeddings, maps, training | **Python** | Demucs, PyTorch, numpy/sklearn live here. |
| FluCoMa analysis | **Pd + FluCoMa externals** (existing) | Existing descriptors; per `VST_PLUGIN_ROADMAP.md` it "genuinely has to run inside PD". |
| Model inference (small) | **ONNX** (+ plain-JSON weights for tiny MLPs) | See §7.3. |
| Real-time player (future) | **C++** (JUCE-independent) | Same binary logic in DJ deck, radio, plugin render, WASM. |
| Remix controller / policy (future) | **Python → ONNX**, non-RT | Runs 1–2 bars *ahead* of the player; never in an audio callback. |
| Web tool (future) | **TS + WASM (C++ core subset) + HTTP to a worker** | Same contracts; conformance vectors keep it honest. |

**Never in the audio thread:** Demucs, Pd, Python, PyTorch, ONNX, disk I/O, allocation, locks, logging.

---

## 4. Communication between components

### 4.1 The rule: the filesystem is the source of truth; the worker is a helper

The plugin can browse, filter, edit notation, delete and **capture Bakes with no worker running**, because a library is just directories of files the plugin can read. The worker only *derives* things (stems, analysis, maps). If the worker dies, nothing is lost and nothing is blocked — Bakes simply sit in `CAPTURED`.

```
plugin ──writes──▶ bakes/bk_X/{bake.json,state.json,semantic.json,audio/original.wav}
plugin ──writes──▶ jobs/pending/job_Y.json            (durable spool queue)
worker ──claims──▶ jobs/running/job_Y.json            (atomic rename = the lock)
worker ──writes──▶ bakes/bk_X/{decompositions/…,analyses/…,state.json}
worker ──writes──▶ jobs/done/job_Y.json | jobs/failed/…
worker ──beats───▶ worker.json  (pid, version, capabilities, heartbeat every 2 s)
plugin ──polls───▶ state.json mtimes, worker.json   (UI timer, 4 Hz)
```

**IPC options evaluated (plugin ↔ worker):**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Spool directory + heartbeat file** | Crash-safe, resumable, works if worker starts later, N plugin instances + CLI + web all share it, trivially debuggable, no ports/firewall/AV prompts, no protocol versioning problem | Poll latency (≤250 ms, irrelevant for minute-scale jobs); no streaming progress | **Chosen (v0)** — progress is in `state.json`/job file |
| Local HTTP (+SSE) | Streaming progress, remote worker for the web/radio | Port management, auth token on loopback, firewall prompts (macOS), plugin must handle connection lifecycle | **Add later** as a *control plane on top of* the same queue (web tool, remote worker) |
| stdin/stdout to child process | Simple | One plugin instance owns the child; dies with the DAW; multiple instances fight | No |
| OSC/UDP | Already used for Pd bridge | Lossy, no delivery guarantees, no discovery | Only for Pd |
| Shared memory | Fast | Pointless for minute-scale jobs; fragile | No |

Supervision: the plugin checks `worker.json`; if the heartbeat is stale (> 6 s) it may launch the configured worker command (`settings.json → worker.command`). The worker takes an exclusive lock on `worker.lock`, so N instances launching it at once yield exactly one worker.

### 4.2 Job protocol

`jobs/{pending,running,done,failed}/<job_id>.json`, `job_id` = ULID (time-ordered → FIFO by name). Claiming = `rename(pending→running)` (atomic on POSIX; `MoveFileEx` on Windows). A job file is never edited in place; it is *moved* and, on completion, a result document is written to `done/`. Jobs are **idempotent** and write to temp dirs that are renamed into place. On start the worker requeues `running/` entries whose lease is stale. Cancel = `jobs/cancel/<job_id>` marker checked between steps.

Job types (v0.1): `process_bake` (decompose→analyze→finalize), `decompose_bake`, `analyze_bake`, `project_map`, `reindex`, `build_dataset_version`. Later: `train_model` (**manual only** — an hours-long local-GPU job must never start unattended; same rule as `:lora train`), `export_model`, `remix_render`.

### 4.3 Demucs

`Worker → subprocess → <demucs python> -m demucs -n htdemucs -o <tmp> original.wav`, exactly the way `watch_demucs.py` already does it (own venv, tqdm progress parsed from stderr). Reasons to keep it a subprocess: it is version-incompatible with the analysis Python (`demucs_env` is 3.14; essentia/madmom need 3.10–3.11), it needs GPU/MPS memory that shouldn't live in the worker's address space, and a crash must not take the worker down.

Output stems are normalised through a **`stem_map`** stored in the decomposition record: `htdemucs` yields `drums, bass, other, vocals`; the map yields `drums, bass, body, vocals` (`body := other`). With `htdemucs_6s`, `body := sum(other, guitar, piano)`. The backend can change; the Bake keeps *every* decomposition it ever had, and says which is current.

### 4.4 Pd + FluCoMa — options and choice

| Option | Pros | Cons |
|---|---|---|
| **A. One-shot `pd -nogui -batch` per job**, text job file in, arrays written to text files, `done` marker, exit | Stateless; crash-isolated; no ports; the extractor is a pure function of files; easy to test with a fake `pd` | Pd + FluCoMa startup cost per job (≈ seconds; irrelevant vs Demucs) |
| B. Persistent Pd daemon, jobs over OSC (`netreceive`) | No startup cost; same pattern as `src/pd/bridge` | State leakage between jobs; lifecycle/health handling; OSC loss |
| C. libpd embedded in the worker | Programmatic control, no OSC | libpd is a process-wide singleton, not thread-safe; loading FluCoMa externals via libpd's path is fiddly; a Pd crash kills the worker |
| D. libpd inside the plugin | "No install" | Second Pd inside every DAW instance; RT/thread hazards; FluCoMa binaries in a plugin bundle; **rejected** |
| E. Re-implement descriptors in Python | No Pd | Different numbers from the instrument's index; loses the existing corpus compatibility. Kept **only** as the `python-ref` fallback/test extractor. |

**Choice: A now, B later behind the same interface.** The worker's `Extractor` interface is `extract(job_dir) → analysis.json`; A and B are two implementations. The Pd patch speaks a **text-only contract** (Pd has no JSON): worker writes `job.txt` (`stem <name> <wav> <out_prefix>` lines), Pd runs the existing `stem_analyze` chain per stem, `[array write]`s each `FluCoMa` output array to `<out_prefix>.<buffer>-<channel>.txt`, writes `DONE`. The worker parses those into `analysis.json`. **Unverified:** whether FluCoMa Pd externals run correctly under `-batch` — the roadmap's own "validate first" item, and `stem_analyze.pd` itself notes an unconfirmed `fluid.bufstats` outlet. That spike is Phase 0a (§13). Until it passes, the `python-ref` extractor keeps everything else unblocked, and analyses are **never mixed** across extractors inside one DatasetVersion (§5.6).

### 4.5 PyTorch

The training system never touches the plugin or the worker's queue internals. Its input is a **DatasetVersion directory** (§5.6): plain files (`.wav`, `.json`, `.npy`) it reads through a `BakeDataset` (`torch.utils.data.Dataset`) — no SQLite, no Gnumbat imports required beyond a 100-line loader. Output is a **ModelVersion directory** (§7). Training is launched by a human (`gnumbat train …` / a UI button that submits a `train_model` job) — never automatically.

---

## 5. Data model

### 5.1 Library layout **[built]**

Everything is plain files; zip the folder and it is portable. `derived/` and `tmp/` can be deleted at any time.

```
<library>/
  library.json                    schema, library_id, created_at
  bakes/
    bk_<ULID>/
      bake.json                   IMMUTABLE manifest: identity, capture provenance, audio hash, preview peaks
      state.json                  pipeline state machine (worker-owned after CAPTURED)
      semantic.json               human meaning (client-owned, revisioned)
      semantic.history.jsonl      append-only previous revisions
      audio/original.wav          32-bit float, exactly what the host produced
      decompositions/dc_<ULID>/   decomposition.json + drums.wav bass.wav body.wav vocals.wav
      analyses/an_<ULID>/         analysis.json (+ series/<source>.npy dense frames)
  notation_profiles/*.json        user-defined parsers (opt-in, versioned)
  feature_sets/*.json             named feature selections (drive "Map Source")
  datasets/ds_<ULID>/dataset.json
                     versions/dv_<ULID>/dataset_version.json  (+ export/ portable materialisation)
  models/md_<ULID>/model.json
                   versions/mv_<ULID>/{model_version.json, weights/…}
  derived/  associations.json  maps/<feature_set>.json                 (rebuildable cache)
            (an index.sqlite and per-Bake embeddings/ are designed but NOT built: the plugin's
             background scanner keeps an in-memory incremental cache, which is enough at hundreds of Bakes)
  jobs/{pending,running,done,failed,cancel}/   worker.json  worker.lock
  tmp/   .trash/
```

This refines your sketch (`bake_0001/{audio.wav, stems/, analysis.json, metadata.json}`) in three ways: (1) **several decompositions and several analyses per Bake**, so changing backend or config leaves old Bakes interpretable; (2) **`metadata.json` is split into `bake.json` (immutable facts), `semantic.json` (human) and `state.json` (machine)** so that no writer can clobber another's data; (3) dataset/model membership is stored *outside* the Bake.

### 5.2 IDs and hashes

- Entity ids are **ULIDs with a type prefix** (`bk_`, `dc_`, `an_`, `ds_`, `dv_`, `md_`, `mv_`, `em_`, `mp_`, `job_`, `rm_`, `arr_`): time-sortable, generated locally with no coordinator (needed for local-first and later P2P), collision-free across machines.
- **Content identity is separate**: `sha256:<hex>` of `original.wav` in `bake.json`. It is what a DatasetVersion pins, what dedupes imports, and what the artifact network's manifest (`src/network/artifacts`) already uses.
- Display numbers (`#0007`) are a per-library view concern, never identity.

### 5.3 Bake state — `state.json` **[built]**

`CAPTURED → DECOMPOSING → DECOMPOSED → ANALYZING → ANALYZED → READY`, plus `ERROR` (records `from_state`, so retry resumes). `CAPTURED → ANALYZING` is legal when decomposition is skipped (a Bake that is already a single stem). `READY → DECOMPOSING/ANALYZING` re-runs a stage under a new backend/config without losing the old results.

**Deviation from your list:** `TRAINING` and `TRAINED` are **not Bake states.** A Bake can be in five models at once; a single-valued state can't express that and would couple a Bake to one model. Training status is *derived* per `(bake, model_version)` from DatasetVersion/ModelVersion membership and displayed as an aggregate (`trained in 2 · training in 1`). The Bank still shows it; it just isn't stored on the Bake.

### 5.4 Analysis schema, versioned and extensible **[built]**

`analysis.json` (`gnumbat.analysis/0.1`):

- `extractor`: `{name, version, config, config_hash}` — `pd-flucoma`, `python-ref`, later `clap-embed`, …
- `sources[]`: one for `mix` and one per stem. Each has `frame_series` (dense, hop, → `.npy` sidecar with column names), `slices[]` (onset-derived, feature dict per slice — compatible with the instrument's slice concept), and `summary` per feature dimension: `mean, std, min, max, slope, envelope[8]`. The 8-point envelope matters: *"rise"* is a **trajectory**, and means/stds erase direction.
- Features are **registry rows**, not columns: `{id:"spectral.centroid", dims:1, unit:"Hz", family:["spectral"], provided_by:[…]}`. Adding a feature = adding a row + an extractor that emits it. Nothing else changes. Legacy aliases (`C`→`spectral.centroid`, `E`→loudness, `F`→flatness, `P`→pitch, `T`/`M0–M5`→mfcc) live in the registry.
- `feature_sets/*.json` name a selection of feature ids (+ stats) — this is what the **Map Source** selector lists (`All`, `Spectral`, `Timbre`, `Rhythm`, `Pitch`, user-defined, and `Model embedding` once a model exists).
- Suggested metadata the analysis can infer (tempo, key) is stored **inside the analysis as suggestions** and never written into `semantic.json`.

### 5.5 Semantics and user-defined notation **[built]**

`semantic.json` keeps `raw_notation` **byte-for-byte**. Everything else is optional and user-shaped:

```json
{
  "schema": "gnumbat.semantic/0.1", "bake_id": "bk_…", "rev": 3,
  "raw_notation": "rise-E minor-120 BPM-4 bars-energetic",
  "notation_profile": {"id": "np_musical_dash", "version": 1},
  "tags": ["rise", "E minor", "energetic"],
  "fields": {"tempo": 120, "duration_bars": 4, "key": "E minor"},
  "field_origin": {"tempo": "parsed", "duration_bars": "parsed", "key": "parsed"},
  "groups": ["risers"], "prompt": null, "ratings": {}, "notes": ""
}
```

A **NotationProfile** is user data (a declarative segment splitter + regex rules, portable ECMAScript-subset regex), *not* code and *not* built in. The example dash-format is shipped only as `notation_profiles/musical_dash.json`, off by default. A user with `metallic-density-increase` uses the default **freeform** profile (the whole string is one phrase-tag; nothing is extracted) or writes their own. Editing is revisioned (`rev`, optimistic concurrency, old revisions appended to `semantic.history.jsonl`) because human labels are the one thing that cannot be regenerated.

### 5.6 Datasets, versions, models **[built: dataset/dataset-version; model records are metadata only]**

- **Dataset** `{dataset_id, name, description, membership: {bake_ids | filter query}, created_at}` — mutable, working.
- **DatasetVersion** `{dataset_version_id, dataset_id, created_at, analysis_profile: {extractor, config_hash}, items:[{bake_id, content_hash, semantic_rev, semantic_hash, analysis_id, decomposition_id}], vocabulary: {tag: count}, notes}` — **immutable**, validated on creation: all items must share **one** analysis profile; all must be `READY`. `export` materialises it as a self-contained portable folder (`dataset.json` + `bakes/<bake>/…`) ready for `BakeDataset`.
- A Bake belongs to any number of Datasets; a Dataset has any number of Versions; each ModelVersion pins exactly one DatasetVersion. The reverse index (`derived/associations.json`) is what the Bank's "model associations" column reads.

### 5.7 Filters — extensible by construction **[built, both languages]**

A filter is a JSON expression tree over a **flat "bake view" document** (`notation, tags, fields/*, groups, state, created_at, duration_s, capture/*, analysis/*, models, datasets`):

```json
{"and": [
  {"field": "notation",       "op": "contains", "value": "rise"},
  {"field": "fields/tempo",   "op": "between",  "value": [110, 130]},
  {"field": "fields/key",     "op": "eq",       "value": "E minor"},
  {"field": "analysis/summary/loudness.db/mean", "op": "gte", "value": -14},
  {"field": "models",         "op": "has",      "value": "Model_A"}
]}
```

A missing field never matches (except `op: exists, value: false`), so a user whose Bakes have no `tempo` is unaffected by a tempo filter. The UI builds its field pickers by **scanning the library** (field catalog with inferred types and ranges) — nothing assumes `tempo` exists. Python and C++ evaluators are checked against the same `conformance/filter_cases.json`.

### 5.8 Versioning matrix

| Thing | Where the version lives | Compatibility rule |
|---|---|---|
| Every JSON document | `schema: "gnumbat.<kind>/<major>.<minor>"` | Same major = readable; unknown fields **preserved** on rewrite |
| Analysis | `extractor.{name,version,config_hash}`, feature-registry version | Old analyses stay valid; a DatasetVersion pins one profile |
| Decomposition | `method.{backend,model,version,stem_map}` | Many per Bake; `state.current` picks one |
| Notation | `notation_profile.{id,version}` in `semantic.json` | Re-parse is explicit, never silent |
| Dataset | `dataset_version_id` + hashes | Immutable |
| Model | `architecture`, `recipe_hash`, `dataset_version_id`, `analysis_profile`, `seed` | Immutable; fine-tune = new version with `parent` |
| Remix engine | `engine_version` + seed + command log in the Remix record | Replayable |

---

## 6. Bake lifecycle

```
  [DAW plays through plugin]                        (plugin, message thread + writer pool)
      │  rolling capture ring (audio thread, wait-free)
      ▼
  range chosen ── coverage complete? ── notation dialog (async) ──▶ writer thread:
      bakes/bk_X.partial/ ← original.wav, bake.json, semantic.json, state.json=CAPTURED
      rename → bakes/bk_X ;  spool  jobs/pending/job_Y (process_bake)
      │
      ▼                                        (worker)
  CAPTURED ─▶ DECOMPOSING ─▶ DECOMPOSED ─▶ ANALYZING ─▶ ANALYZED ─▶ READY
                 │ (demucs)                    │ (pd-flucoma | python-ref)     │ validate + summaries
                 └────────────── any failure ─▶ ERROR{from_state, code, retryable}
      ▼
  READY ─▶ appears in Bank, Map, filters ─▶ may join Datasets ─▶ DatasetVersion ─▶ ModelVersion
```

Crash safety: bake dirs are created as `.partial` and renamed when complete; the scanner ignores `.partial`; the worker requeues stale `running` jobs; every stage writes into a temp dir and renames; `state.json` is replaced atomically so a reader never sees a torn file.

---

## 7. Model lifecycle and format

### 7.1 Lifecycle

`Dataset (draft) → DatasetVersion (frozen) → TrainingRun (recipe + seed, manual) → ModelVersion (immutable, hashed) → Export (ONNX) → Publish (artifact-network manifest, `parent` = previous ModelVersion) → Load (any runtime)`.
Model metadata required by your list — id, creator, created/modified, dataset + version, analysis version, architecture, training state, #Bakes, #iterations — is in `model.json`/`model_version.json` (schemas in `src/core/gnumbat_core/schemas/`).

### 7.2 What "the model" is in v1

Three small heads over **feature vectors**, all input-ID-free: (1) a tag/text encoder → shared latent; (2) a feature encoder → same latent (contrastive: matching notation ↔ matching Bake); (3) a pair scorer over (end-of-slice-A, start-of-slice-B) features — the existing `learned_bias.json` MLP generalised. Inference = a few small matmuls. The retrieval index (latent vectors of the corpus) is *derived* at load time from the corpus, not stored in the model.

### 7.3 Serialization / portability

| Format | Runs in | Verdict |
|---|---|---|
| **ONNX** | onnxruntime (C++, Python, JS/WASM), `tract` (Rust/WASM) | **Interchange format** for anything beyond a toy. Restrict export to a small op set (Gemm, Relu/Gelu, LayerNorm, Softmax, Normalize) so every runtime handles it. |
| **safetensors + `model.json`** | Anything that can read a tensor file | Canonical *weights* + metadata store (safe, mmap-able, no pickle — matters for the artifact network's quarantine which already runs PickleScan on `.pt`). |
| **Plain-JSON MLP** (`hidden_w/hidden_b/…`, as `learned_bias.json` today) | Node, browser, C++ with 100 lines | Kept for the tiny pair scorer so DJ deck / radio need **no ML runtime at all**. |
| TorchScript / libtorch | C++ | **Not** in a plugin: size, static-init and thread hazards inside a DAW process. |
| Core ML | Apple only | Optional export target later. |

Rule: **inference runs in the worker/engine process, not inside the DAW plugin**, until a model is proven small enough to justify an in-plugin runtime. Model directory = `model_version.json` + `weights/model.safetensors` + optional `model.onnx` + `vocab.json`; its hash-and-sign manifest reuses `src/network/artifacts` (`type: "model"`, `parent` lineage).

---

## 8. The JUCE plugin **[built: shell, capture, bank, map; see §13 for what is verified]**

### 8.1 What a plugin can and cannot do (this shapes the UX)

A VST3/AU **cannot read the host timeline, cannot seek transport, cannot "render a selection".** It sees only the audio the host streams *through its own bus* and, per block, a `PositionInfo` (transport time in samples, tempo, time signature, playing/recording/looping, loop points if the host provides them). So "select a time range and bake it" is implemented as **capture-by-playing-through, addressed by timeline position**:

1. The plugin (on the master, a bus or a track) passes audio through **bit-exact** and keeps a **rolling capture ring** (default 90 s stereo float) plus a **segment table** mapping ring positions to *timeline sample positions*.
2. The user defines a range. Four modes, as built: **RANGE** (IN/OUT markers, typed as bar|beat or set from the playhead, with nudge buttons), **LAST BARS** (rolling grab of the last n bars), **LOOP** (the host's loop points, when the host provides them), **LAST SEC** (rolling grab by seconds). Hosts that report no playhead fall back to the plugin's own sample counter as the timeline.
3. The user plays the range once (or loops it, or **bounces offline** — `isNonRealtime()` makes it faster than real time). Coverage is tracked per timeline sample, so multiple passes, loop wraps and partial takes assemble correctly; the strip shows a coverage bar.
4. `BAKE` materialises the range from the ring — never touching the audio thread — and hands it to the Bake writer.

Alternatives, all supported by the same Bake writer: **drop a WAV** onto the plugin ("Bake from file" — also the entire workflow of the standalone app), and (research) **ARA2**, which is the only route to reading a clip's source audio directly, at the price of host support being partial.

### 8.2 Threads and rules

| Thread | Does | Never does |
|---|---|---|
| Audio | `CaptureBuffer::push` (relaxed-atomic copy into pre-allocated ring, segment-table update under a seqlock), reads `PositionInfo`, publishes host info via atomics | allocate, lock, log, touch files, call the worker |
| Message/UI | painting, `AppModel` (filter/sort/selection/map state, reads a snapshot published by the scanner), in-window notation dialog | file scans, WAV writes, any blocking wait |
| Reader/writer pool | ring snapshot → WAV write, bake-dir assembly, library scans, JSON parsing | touch UI objects (results posted back with `callAsync`) |
| Worker (other process) | Demucs, Pd, embeddings, t-SNE, training | — |

The ring reader is lock-free and validates after copying (`head_after − range_start ≤ capacity`); if the range was overwritten mid-copy it retries or reports `overrun`. Ring elements are relaxed `std::atomic<float>`, which compiles to plain loads/stores on x86/ARM but keeps the concurrent read/write formally race-free.

### 8.3 Classes

```
src/plugin/core        (juce_core + juce_cryptography only; no GUI: reusable by standalone / DJ deck / radio)
  CaptureBuffer   RT-safe ring + segment table (no JUCE at all)
  Ids, JsonIo     typed ULIDs; atomic writes, sha256, JSON helpers
  NotationProfile, FilterQuery     C++ twins of the Python modules, checked by shared conformance vectors
  Library         create/read/scan Bakes, semantic revisions, trash/restore, datasets, associations, WAV writer
  Jobs            JobSubmitter (spool files), WorkerStatus (worker.json), launchWorker
  Settings, MapData
src/plugin/plugin      (juce_gui_*, juce_audio_utils)
  PluginProcessor  pass-through + capture + transport snapshot + state (gnumbat.plugin_state/0.1)
  PluginEditor     header, tabs, BAKE flow (copy audio at click -> notation card -> background write), import, library chooser
  ui/AppModel      background library scanner, filter/sort/selection, actions (edit, trash+undo, reprocess, datasets, map)
  ui/CapturePanel, ui/NotationCard, ui/FilterBar, ui/BankView, ui/InspectorView, ui/MapView
  ui/UiHost        in-window dialogs (never OS windows: they misbehave in several hosts); ui/Theme  terminal look
```

Plugin state (`getStateInformation`): library path override, filter, map source, selection, in/out marks, session label — **never Bake data** (that lives in the library, not the DAW project). Host detection: `juce::PluginHostType` + track name via `updateTrackProperties` where the host supplies it; both are stamped into `bake.json → capture`.

### 8.4 Temporary files

`tmp/` inside the library (same volume → `rename` is atomic), `.partial` directories, orphans older than 24 h swept at startup, free-space check before writing, no writes to the system temp directory.

### 8.5 Hand-off to the instrument's own pipeline (raw_uploads)

**Decision (yours, mid-build):** a Bake's render is also written into the EBYS instrument's `raw_uploads/`, so the *existing* Demucs and FluCoMa pipeline processes it instead of a second, parallel one.

```
plugin BAKE --> library/bakes/bk_ID/            (Bank, notation, map: works with no instrument running)
            \-> <EBYS>/data/sessions/<session>/raw_uploads/<slug>__bk_ID.wav
                     |  watch_demucs.py (existing, unchanged): waits 2 s, Demucs, genre + downbeats, stream.txt
                     v
                 <session>/stems/htdemucs/<track>/<track>_{vocals,drums,bass,other}.wav
                     |  Max / Pd streamWatcher -> FluCoMa -> analysis_library.json, gnumbat.db   (existing)
                     v
                 worker: `instrument` decomposer ADOPTS those stems into the Bake (other -> body), re-analyses
```

Facts checked against the repo, which shape the implementation:

- **The session moves.** `raw_uploads/` is per session; the session is whatever `data/current_session.txt` says *now* (empty = `default`). It is resolved at every BAKE and recorded in `bake.json -> handoff`. If you switch session before Demucs finishes, the watcher may process it in the other session and adoption will not find the stems (they stay "waiting").
- **Atomic drop.** The watcher only handles *created* files, skips dot-files, and sleeps 2 s. A rename *inside* the folder would be a `moved` event and be missed, so the plugin writes to `<session>/handoff_tmp/` (same disk, not watched) and renames the finished file in.
- **Track name = file name.** `<slug of notation>__<bake id>`; the Bake id is recoverable, the notation itself is untouched.
- **Nothing is lost on failure.** No EBYS folder, wrong folder, or a write error: the Bake is saved, `handoff.status = "failed"` with the reason, the plugin says so, and the worker processes it the normal way.
- **Explicit choices opt out.** The hand-off happens for `auto` (and `instrument`). Choosing `demucs`, `testsplit` or unchecking stems means "do not feed the instrument".
- **Immediately usable.** The worker analyses the mix right away (`decompose: handoff`), so the Bake is READY in the Bank at once; the Bank shows `EBYS...` until the stems are adopted. Adoption is triggered by the worker's idle scan (every ~5 s, only when all four stems exist and are older than 3 s); a worker started later picks them up too.
- **Settings:** `ebys_root` (or env `GNUMBAT_EBYS_ROOT`) and `handoff_raw_uploads` (default true). The header button `LINK EBYS...` sets them.

**What this does NOT do: feed the PyTorch model directly.** `src/demucs/train_bias_torch.py` does not read analysis output. It fits a small MLP on the training logs written when you score results live (`:scoreLyr`, `:scoreTrs`) and writes `learned_bias.json`, which `slicer.js` reads; it refuses to train below a minimum sample count. A Bake therefore reaches that model *indirectly*: raw_uploads, stems, FluCoMa slices, slicer picks that you score, then training. Making Baked material feed a model more directly is a separate, deliberate design (the planned Gnumbat model trained from frozen dataset versions, phase 9).

**Also unchanged by this:** FluCoMa's results stay in `analysis_library.json` / `gnumbat.db`; the new core still computes its own per-Bake features (Python reference extractor) for the Bank and Map. Importing the instrument's FluCoMa output into Bakes is the next glue step. Because every Bake now enters the instrument's corpus, `stream.txt` is rewritten and the live slicer sees new material: intended, but worth knowing.

Status: the plugin side, the manifest, the adoption logic and a C++ -> simulated-watcher -> Python-worker round trip are tested. **The real `watch_demucs.py`, real Demucs, and Max/Pd have not been run against it.** Float32 WAV input to Demucs is untested.

---

## 9. The Bake Map

Computed by the **worker** (`project_map` job), drawn by the plugin. The plugin never runs t-SNE.

- **Embedding space first, projection second.** A `feature_set` (e.g. `spectral`) + stats + sources define a vector per Bake; vectors are standardised (z-score, parameters stored in the embedding record so new Bakes project consistently), reduced by PCA to ≤ 50 dims, then projected. The record `{space, method, params, seed, points[], quality{trustworthiness}}` says *what the picture shows*; the UI prints that under the map so it never claims to depict "musical similarity".
- **Stability.** A living map must not jump when a Bake is added: warm-start from previous coordinates, fixed seed, fewer iterations for incremental updates.
- **Small N.** t-SNE needs perplexity < N/3; below ~8 Bakes the worker falls back to PCA and says so.
- **Replaceable.** `method` is a registry: `tsne` (sklearn when present, else built-in numpy), `pca` now; `umap` and "model embedding" plug in later with no UI change.
- **Interaction (plugin):** zoom (wheel), pan (drag), hover tooltip (notation + tags), click / shift-click / rubber-band multi-select, colour-by (tag, state, field, group), dim non-matching points when the Bank filter is active, cluster halos (k-means/DBSCAN done in worker, later).

---

## 10. The remix engine and the LLM control layer (design)

### 10.1 Separation

```
Training system                       Remix engine
  import · Bake · decompose            load ModelVersion + Corpus snapshot
  analyse · dataset · embed            query · select · slice · recombine
  visualise · train · version          time · transform · Arrangement · play
```
They share **only** the contracts: Corpus/Slice/Feature/Embedding/Model/Arrangement.

### 10.2 Engine internals

```
Controller (Python→ONNX, non-RT, 1–2 bars lookahead)     Player (C++, RT-safe, JUCE-independent)
  state: ControlState (parameters, §10.3)                   lock-free queue of Placements
  target: query → embedding-space target                    mmap'd stems, prefetch by lookahead
  candidates: kNN(target, continuity from previous slice)   scheduler on sample clock / LINK clock
  score: model pair-scorer + constraints (grid, key…)       transforms: gain, fade, crossfade, reverse,
  sample: temperature / exploration bonus                     time-stretch, pitch-shift (stem-preserving)
  emit: Placement{slice, t_on, len, transforms, xfade}      offline mode = same code, faster than RT
```
The Arrangement is the *only* interface between them. That is what makes the same engine a DAW clip generator (offline render → drag out), a DJ instrument, and a radio (headless player process feeding Liquidsoap/Icecast in place of Max→BlackHole).

**Corpus size reality check:** 500 Bakes × 4 stems × 30 s × 44.1 kHz stereo float32 ≈ 21 GB — too large to hold in RAM. The lookahead makes streaming from SSD feasible (the next placements are known ahead of time and are prefetched); store 16/24-bit for the corpus if needed.

**Transform whitelist** (each flagged `preserves_provenance`): trim, gain, fade, crossfade, reverse, repeat/stutter, time-stretch, pitch-shift, EQ/filter, pan. Anything that adds energy not present in the source (oscillators, noise, neural vocoders) is not in the registry and cannot appear in an Arrangement (schema-enforced: `transform.op` is an enum).

### 10.3 Parameters — two tiers

**Primitives** (fixed engine contract, each with id, range, unit, smoothing, scope `global | stem:<name>`): `slice_density`, `slice_length_min/max`, `stem_probability[stem]`, `repetition_prob` (existing `setStayProb` analogue), `transition_prob`, `temporal_displacement`, `crossfade_ms`, `quantize_grid`/`quantize_strength`, `feature_similarity_weight`, `semantic_similarity_weight`, `randomness` (temperature), `model_influence`, `exploration`.
**Macros** (user/model-defined, versioned, editable): `energy`, `density`, `rise`… each a mapping onto primitives plus optional descriptor targets. Because vocabulary is user-defined, macros are *data*, not code; the LLM may use primitives or macros; the schema validates against whichever registry is loaded.

### 10.4 LLM as controller (strict boundary)

```
user text ─▶ LLM (Ollama/Cricket) ─▶ RemixCommand JSON ─▶ validator ─▶ ControlState ─▶ Controller ─▶ Arrangement ─▶ Player
                                          ▲ schema + registry-derived enum/range clamp, unknown keys rejected
```
- The prompt for the LLM is **generated from the parameter registry**, so it can't drift from what the engine accepts.
- Commands are **targets with ramp times** (`{op:"ramp", param:"density", to:0.8, over_beats:8}`) — the engine never blocks on the LLM; LLM latency of seconds is fine because the engine interpolates and, with no LLM, simply keeps the last state.
- `{op:"query", text:"aggressive melodic rise"}` resolves through the ModelVersion into an embedding-space target; **the text never reaches the audio path.**
- Determinism: a Remix record = `(ModelVersion, Corpus snapshot hash, engine_version, seed, command log)` → replayable bit-for-bit. Every command is logged with timestamp and validation result.
- Cricket becomes *one implementation* of the LLM-controller interface; existing `:set*` commands map onto primitives.

---

## 11. One core, five frontends

| Frontend | Uses | Adds |
|---|---|---|
| **JUCE VST3/AU** | C++ core, spool queue, drag-out | capture, Bank, Map; later a "generate arrangement → render clips → drag into DAW" panel over the same Player in offline mode |
| **Standalone** | Same JUCE code, audio-input or file source | dataset building, training control, experiments, live |
| **Web** | Same schemas; C++ view-model to WASM or a TS port validated by conformance vectors; worker behind the HTTP control plane | in-browser training runs via a server worker; models are the same ONNX/safetensors files |
| **DJ deck** | Player + Controller as a headless process; hardware → `RemixCommand` (knob = `set`/`ramp`) | LINK clock sync (`docs/instrument/LINK.md`) |
| **Radio** | Headless Controller+Player, no LLM required (or a scheduled command script) | Icecast/Liquidsoap output |

Nothing above reimplements a data structure; each is a different *driver* of the same records.

---

## 12. Technical risks and bottlenecks (ranked)

1. **Hosts cannot render an arbitrary time selection.** Capture-by-playing is a UX cost (mitigated by loop capture, offline bounce, rolling "last N bars", drop-a-WAV; ARA2 is the research path).
2. **FluCoMa-in-Pd headless is unproven** and not testable in CI here (no FluCoMa binaries available to this build environment). Isolated behind `Extractor`; `python-ref` unblocks everything; spike is Phase 0a.
3. **Distribution of Python + Torch + Demucs** with a plugin: multi-GB, two incompatible envs already, macOS notarization of bundled runtimes, GPU/MPS variability. Keep the worker a separately installed daemon until Phase 7-of-roadmap "packaging"; the plugin only needs a command string.
4. **Data scarcity / overfitting**; user vocabularies that are un-learnable (one-off tags). Small models, hold-out-by-Bake, keyword baseline, vocabulary stats in the UI.
5. **Demucs on short, dense, processed DAW material** produces artefacts, and analysis inherits them. Keep original + all decompositions; extract features from `mix` *and* stems; allow `decompose: skip`.
6. **t-SNE is not a metric.** Non-deterministic, perplexity-sensitive, misleading at small N. Seeded, warm-started, PCA fallback, trustworthiness score shown, labelled with its feature space.
7. **Real-time engine** dropouts and memory (§10.2 arithmetic); solved by lookahead prefetch and a JUCE-free player with an offline mode that is bit-exact-testable.
8. **Plugin/host compatibility**: hosts without position info, bypass (no `processBlock`), sample-rate/buffer changes, multiple instances, AU vs VST3 differences. Needs `pluginval` and a host matrix (REAPER, Ableton, Logic, FL, Bitwig).
9. **Concurrent writers on one library** (N instances + worker + CLI): solved by single-writer file ownership, atomic replace and optimistic `rev` — not by locks. Network drives unsupported.
10. **Naming/product coherence** with the existing `:bake`, `melody`, and the generative layer (§14).
11. **Licensing**: JUCE (AGPLv3/commercial), Demucs (MIT), FluCoMa and Pd externals (check per-binary), Rubber Band if used for stretch (GPL). User audio is copyrighted material → models/features may be shared; **audio never enters the artifact network** (same stance as `docs/decentralize.md`).

---

## 13. Roadmap (dependency-ordered) and status

I moved *ML premise validation* and *contracts* ahead of UI polish, and put the deterministic offline player before the LLM and the real-time engine.

| Phase | Deliverable | Exit test | Status |
|---|---|---|---|
| **0 Contracts** | JSON Schemas, layout, state machine, job protocol, filter/notation grammar, conformance vectors | Schemas validate golden docs; both languages pass the vectors | **built**, Python tests pass |
| **0a Spike: FluCoMa headless** | `pd -nogui -batch` on one stem, arrays out | Numbers match the Max/Pd instrument on the same file | **not done** — needs Pd + FluCoMa externals (not available in the build environment); Pd batch plumbing tested with a vanilla stub only |
| **0b Spike: premise test** | 30+ real Bakes via CLI; does text→retrieval beat keyword search? | Metric above baseline on held-out Bakes | **not done** — needs your real Bakes |
| **1 Plugin shell** | VST3/AU/Standalone, pass-through, dark UI | Loads; audio bit-exact | **built**, Linux VST3 + Standalone compile and link; pass-through bit-exactness is unit-tested; **never loaded in a real DAW**, never built on macOS/Windows |
| **2 Capture** | Ring + coverage + range + write | Stress test (writer thread vs readers, TSan) exact | **built and tested** |
| **3 Metadata/storage** | Library, semantic revisions, notation profiles | Python + C++ conformance | **built and tested** |
| **4b Instrument hand-off** | Plugin writes to `raw_uploads/`; worker adopts the instrument's stems | C++ -> simulated watcher -> worker round trip | **built and tested with a simulated watcher** (§8.5); real watch_demucs.py / Demucs / Max not run |
| **4 Demucs** | Backend + progress + stem_map | Real stems for a 30 s Bake | **built, not run against real Demucs** (not installable here): subprocess runner tested against a fake `demucs` module; a labelled `testsplit` backend stands in. `decompose: auto` with no decomposer installed **degrades to a mix-only analysis** and records why in the Bake history; an explicitly requested backend that is missing is still an ERROR (see §14.6) |
| **5 Analysis** | `python-ref` extractor; Pd runner plumbing | Deterministic analysis of synthetic Bakes; Pd runner vs fake `pd` | **built and tested** (python-ref); pd-flucoma runner untested against real FluCoMa |
| **6 Bank + filtering** | Bank UI, filter builder, inspector | Filter conformance; UI snapshot review | **built**; headless UI tests (filter, sort, multi-select, edit, trash+undo, datasets, map hit-testing, BAKE through the real dialog) and Xvfb snapshots reviewed; not exercised in a DAW |
| **7 Embeddings + Map** | feature sets, standardise/PCA/t-SNE, warm start | Determinism, stability, small-N fallback | **built and tested** |
| **8 Portable dataset** | DatasetVersion + export + `BakeDataset` | Round-trip; hash verification | **built and tested** (torch wrapper written, not run: torch absent) |
| **9 Training prototype** | Contrastive text↔feature + pair scorer, manual job | Beats baseline (0b) | not built |
| **10 Model loading/inference** | ONNX export + runtime | Identical outputs across runtimes | not built |
| **11 Offline Player + Arrangement** | Bit-exact identity render | Provenance test | schema only |
| **12 Controller + LLM layer** | RemixCommand validation, registry-generated prompt | Replay determinism | schema only |
| **13 Real-time** | Lookahead scheduler, streaming | Xrun-free soak | not built |
| **14 Frontends** | Standalone/Web/DJ/Radio | — | not built |

---

## 14. Decisions that need your call

1. **Generative layer.** `GENERATIVE_LAYER.md`/`USER_LORA.md` and `docs/instrument/VST_PLUGIN_ROADMAP.md` §2 ("True generative audio … designed in detail, code written") describe waveform generation. Your new principle forbids it. This design assumes the generative layer is **out of Gnumbat Core** (a separate, optional, clearly-labelled experiment or retired). Nothing in the repo was changed.
2. **`Bake` naming.** Proposed: new Bake is canonical; existing `:bake` becomes "Performance Bake". Alternative: rename the new one.
3. **`body` vs `melody`.** Proposed: only the new core says `body` (mapping `other→body`); the instrument keeps `melody`.
4. **Where the library lives by default** (`~/Documents/Gnumbat/library` here; you may prefer `data/`).
5. **JUCE licence tier** for shipped binaries (AGPLv3 vs commercial).
6. **`auto` decomposition degrades instead of failing.** On a fresh machine with no Demucs, every first Bake would otherwise land in ERROR. As built, `decompose: auto` with no backend analyses the mix only, reaches READY, and writes "no stem decomposer configured: analysed the mix only (Reprocess after installing one)" into the Bake history (visible in the Inspector). Asking for `demucs` explicitly and not having it is still a loud ERROR. This reverses the stricter "error, never silently skip" rule of the first draft; say if you prefer that back.
7. **Hand-off to `raw_uploads/` is on by default once an EBYS folder is linked.** Every Bake then also enters the instrument's corpus (and rewrites `stream.txt`). Say if you want it opt-in per Bake instead of a global switch. See §8.5 for what it does and does not do for the PyTorch model.
