# Gnumbat model: words -> FluCoMa descriptor curves

`gnumbat_model.py` trains one small neural network per Gnumbat MODEL. It learns how the words you
write on a Bake ("weird nosy rise #inharmonic #spiral") map to the way the sound moves. The sound is
read from the FluCoMa descriptors of each Demucs stem, over the Bake's length.

Requires only Python 3 + numpy. The same file runs locally or on a server.

```
cd EBYS/src/model
python3 gnumbat_model.py dataset  --model idm            # which bakes are usable, with weights
python3 gnumbat_model.py train    --model idm            # -> library/models/<id>/versions/mv_<time>/
python3 gnumbat_model.py generate --model idm "weird nosy rise #spiral"            # sparkline preview
python3 gnumbat_model.py generate --model idm "weird nosy rise #spiral" --out curves.json
```

- **Training data:** Bakes whose `bake.json` has `model_id` equal to this model get weight 1.
  Bakes from parent models are inherited at weight 0.5. Use `--all` to train on every Bake.
  A Bake is only usable once the EBYS chain has run (raw_uploads → Demucs → headless Pd/FluCoMa)
  and its track `<slug>__<bake_id>` appears in `data/sessions/<session>/analysis_library.json`.
- **Weighting:** each Bake counts `max(0.1, 1 + 0.5 × (up-votes − down-votes))`.
- **Target:** for vocals / melody / bass / drums, the descriptors C, S, P, E, F, H and M0–M5, each
  as a 32-step curve in slice order. Hz values are learned in octaves, and unvoiced pitch is ignored.
- **Output:** `version.json` (architecture, normalisation, training set, loss) and `weights.json`
  (plain JSON matrices, loadable from C++). `model.json` → `latest_version_id` is updated.

Paths default to `~/Documents/Gnumbat/library` and the EBYS repo that contains this file.
Override them with `--library` / `--ebys` or `GNUMBAT_LIBRARY` / `GNUMBAT_EBYS_ROOT`.
