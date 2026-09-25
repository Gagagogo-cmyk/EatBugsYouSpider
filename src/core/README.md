# gnumbat_core (Python reference core)

The library, job worker, analysis, Bake Map and dataset export that every Gnumbat frontend shares.
The plugin (`../plugin`) writes Bakes and queues jobs; this package processes them. **The filesystem is the
source of truth**: the plugin works with no worker running (Bakes just stay CAPTURED until one starts).

Design: `../../docs/platform/CORE_ARCHITECTURE.md`.

## Install and test

```bash
cd src/core
pip install -e ".[test]"        # numpy; jsonschema is optional at runtime (schemas are then not enforced) but the tests need it
python -m pytest -q             # 77 tests, ~20 s, no external tools needed
```

## Use

```bash
python -m gnumbat_core init
python -m gnumbat_core demo -n 40            # 40 synthetic Bakes (labelled test data) to try the UI
python -m gnumbat_core bake take.wav -n "rise-C minor-140 BPM-2 bars" --submit
python -m gnumbat_core worker                # long-running; --once drains the queue and exits
python -m gnumbat_core status | list -t rise | catalog | map --space spectral --method tsne | validate
python -m gnumbat_core dataset create "first" --all
python -m gnumbat_core dataset version ds_...            # freezes a version (refuses test-backend stems unless --allow-test)
python -m gnumbat_core dataset export dv_... ./out       # portable; `dataset verify ./out` re-checks hashes
```

`-l <folder>` picks the library; otherwise `settings.json` -> `library_root`, otherwise `~/Documents/Gnumbat/library`.

## External tools (all optional)

| Need | Used for | Status here |
|---|---|---|
| Demucs | `decompose: demucs` (stems drums/bass/body/vocals; `other` -> `body`) | runner tested against a fake module only |
| Pd + FluCoMa | `analyze.extractor: pd-flucoma` | plumbing tested against a fake `pd`; **never run against real FluCoMa** |
| PyTorch | `torch_dataset.BakeDataset` | written, not run |

Without Demucs, `decompose: auto` analyses the mix only and records that in the Bake history; `decompose: demucs`
fails loudly. `testsplit` is a labelled fake splitter for testing: its Bakes are refused by dataset versions unless
you pass `--allow-test`.

Set `GNUMBAT_DEMUCS_PYTHON` to a separate interpreter if Demucs' torch conflicts with this environment.

## Settings (`settings.json`, kept outside the library so libraries stay portable)

Location: `$GNUMBAT_SETTINGS`, else `$GNUMBAT_HOME/settings.json`, else the per-OS app-data folder
(`~/.config/gnumbat`, `~/Library/Application Support/Gnumbat`, `%APPDATA%\Gnumbat`).

| key | meaning | default |
|---|---|---|
| `library_root` | library folder | `~/Documents/Gnumbat/library` |
| `python` | interpreter the plugin uses to start the worker | `python` |
| `core_path` | folder containing `gnumbat_core/` if not pip-installed | unset |
| `autostart_worker` | plugin launches the worker itself (`GNUMBAT_AUTOSTART=0` overrides) | `true` |
| `ring_seconds` | plugin capture ring length, 10-900 | `120` |
| `decompose_default` | plugin's default for new Bakes: `auto`, `demucs`, `testsplit`, `skip` | `auto` |
| `decomposer` | **object**, worker-side: `{"backend": "demucs", "python": "/path/to/py", "model": "htdemucs", "device": "cpu"}` | unset |
| `ebys_root` | your EBYS repo folder (also env `GNUMBAT_EBYS_ROOT`); enables the hand-off to `raw_uploads/` | unset |
| `handoff_raw_uploads` | write every Bake into the instrument's `raw_uploads/` when `ebys_root` is set | `true` |
| `pd` | **object**, worker-side: `{"path": "/path/to/pd", "patch": "...", "flucoma_path": "...", "timeout_s": 600}` | unset |
| `analysis` | **object**: `{"extractor": "python-ref" \| "pd-flucoma", "config": {}}` | python-ref unless `pd.patch` is set |

## Instrument hand-off

With `ebys_root` set, the plugin also drops each Bake's audio into `<EBYS>/data/sessions/<session>/raw_uploads/`.
Your existing `watch_demucs.py` separates it; this worker's idle scan then attaches those stems to the Bake
(`decompose: instrument`, `other` -> `body`) and re-analyses. `python -m gnumbat_core adopt` runs that scan once by hand.
Design, caveats and what it does *not* do for `train_bias_torch.py`: `docs/platform/CORE_ARCHITECTURE.md` §8.5.

## Notation profiles (optional, user-owned)

Raw notation is always stored exactly as typed. A profile only *derives* tags/fields from it and is never required.
Drop a JSON file in `<library>/notation_profiles/`; it appears in the plugin's notation dialog.

```json
{
  "schema": "gnumbat.notation_profile/0.1", "profile_id": "np_MYPROFILE", "name": "my dash style", "version": 1,
  "split": {"delimiter": "-", "trim": true, "drop_empty": true},
  "rules": [
    {"id": "tempo", "match": "^\\s*(\\d+(?:\\.\\d+)?)\\s*bpm\\s*$", "flags": "i",
     "emit": [{"kind": "field", "name": "tempo", "type": "number", "group": 1}]}
  ],
  "fallback": {"kind": "tag"}
}
```

`profile_id` must match `^np_[a-z0-9_]{1,40}$` (see `schemas/notation_profile.schema.json`); regexes are a portable
ECMAScript subset with search semantics (no lookbehind, no named groups) so Python and C++ agree. Shared test vectors
live in `conformance/`; add a case there whenever you add a construct.

## Layout

`gnumbat_core/` - `library.py` (Bake store), `jobs.py` + `worker.py` (spool queue), `decompose/`, `analysis/`
(`pyref` reference extractor, `pd_flucoma` runner, registry), `embed.py` + `mapproj.py` (feature sets, PCA, t-SNE),
`dataset.py`, `notation.py`, `filters.py`, `schemas/` (JSON Schemas for every file format), `conformance/` is a sibling folder.
