import json
import shutil

import numpy as np
import pytest

from gnumbat_core import dataset as D
from gnumbat_core import ids, wavio
from gnumbat_core.analysis.registry import BUILTIN_FEATURE_SETS
from gnumbat_core.jobs import JobQueue
from gnumbat_core.jsonio import atomic_write_json, read_json, utc_now
from gnumbat_core.worker import Worker
from conftest import make_bake


def test_version_requires_ready_bakes_one_profile_and_no_test_stems(processed_lib):
    lib = processed_lib
    ids_ = lib.list_bake_ids()
    ds = D.create_dataset(lib, "risers", bake_ids=ids_)
    with pytest.raises(D.DatasetError, match="test backend"):
        D.create_version(lib, ds)                                     # processed with testsplit
    dv = D.create_version(lib, ds, allow_test=True)
    assert len(dv["items"]) == 12 and dv["analysis_profile"]["extractor"] == "python-ref"
    fresh = make_bake(lib)
    ds2 = D.create_dataset(lib, "half-baked", bake_ids=[fresh])
    with pytest.raises(D.DatasetError, match="not READY"):
        D.create_version(lib, ds2)


def test_identical_pin_is_deduplicated_and_versions_are_immutable_snapshots(processed_lib):
    lib = processed_lib
    ds = D.create_dataset(lib, "d", bake_ids=lib.list_bake_ids()[:4])
    v1 = D.create_version(lib, ds, allow_test=True)
    assert D.create_version(lib, ds, allow_test=True)["dataset_version_id"] == v1["dataset_version_id"]
    bid = v1["items"][0]["bake_id"]
    lib.update_semantic(bid, add_tags=["relabelled"])                      # the human edits a label afterwards
    v2 = D.create_version(lib, ds, allow_test=True)
    assert v2["dataset_version_id"] != v1["dataset_version_id"]
    assert D.find_version(lib, v1["dataset_version_id"]) == v1            # v1 is untouched
    assert v1["items"][0]["semantic_rev"] == 1 and v2["items"][0]["semantic_rev"] == 2


def test_export_is_portable_verifiable_and_pins_old_labels(processed_lib, tmp_path):
    lib = processed_lib
    ds = D.create_dataset(lib, "d", bake_ids=lib.list_bake_ids()[:3])
    v1 = D.create_version(lib, ds, allow_test=True)
    bid = v1["items"][0]["bake_id"]
    lib.update_semantic(bid, raw_notation="changed later", add_tags=["later"])
    out = D.export_version(lib, v1["dataset_version_id"], tmp_path / "export")
    assert D.verify_export(out) == []
    b = out / "bakes" / bid
    assert {p.name for p in b.iterdir()} == {"audio.wav", "stems", "analysis.json", "metadata.json", "semantic.json", "decomposition.json", "series"}
    assert sorted(p.name for p in (b / "stems").iterdir()) == ["bass.wav", "body.wav", "drums.wav", "vocals.wav"]
    assert read_json(b / "semantic.json")["raw_notation"] != "changed later"   # the pinned revision, not the current one
    shutil.rmtree  # (export is a plain folder: copy it anywhere)
    moved = tmp_path / "elsewhere" / "ds"; shutil.copytree(out, moved)
    assert D.verify_export(moved) == []
    with pytest.raises(D.DatasetError):
        D.export_version(lib, v1["dataset_version_id"], moved)             # refuses to write into a non-empty folder


def test_export_detects_tampering(processed_lib, tmp_path):
    lib = processed_lib
    v = D.create_version(lib, D.create_dataset(lib, "d", bake_ids=lib.list_bake_ids()[:2]), allow_test=True)
    out = D.export_version(lib, v["dataset_version_id"], tmp_path / "e")
    wav = next((out / "bakes").glob("*/audio.wav"))
    x, sr = wavio.read_wav(wav)
    wavio.write_wav(wav, x * 0.5, sr)
    problems = D.verify_export(out)
    assert any("hash mismatch" in p for p in problems) and any("does not match pinned content_hash" in p for p in problems)


def test_exported_dataset_reads_with_numpy_and_json_only(processed_lib, tmp_path):
    lib = processed_lib
    v = D.create_version(lib, D.create_dataset(lib, "d", bake_ids=lib.list_bake_ids()), allow_test=True)
    ex = D.ExportedDataset(D.export_version(lib, v["dataset_version_id"], tmp_path / "e"))
    assert len(ex) == 12
    e = ex.example(0)
    assert e["audio"].exists() and set(e["stems"]) == {"bass", "body", "drums", "vocals"} and e["tags"]
    M, cols, bakes = ex.feature_matrix(BUILTIN_FEATURE_SETS["loudness"])
    assert M.shape == (12, len(cols)) and len(bakes) == 12 and np.isfinite(M).any()
    assert ex.version["vocabulary"] == {"drone": 3, "fall": 3, "hits": 3, "rise": 3}


def test_mixed_analysis_profiles_are_rejected(processed_lib):
    lib = processed_lib
    bid = make_bake(lib, seed=77, dur=3.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "testsplit", "auto_map": False,
                                          "analyze": {"extractor": "python-ref", "config": {"n_mels": 30}}})
    Worker(lib, {}).run(once=True)
    ds = D.create_dataset(lib, "mixed", bake_ids=lib.list_bake_ids())
    with pytest.raises(D.DatasetError, match="mixed analysis profiles|exactly one"):
        D.create_version(lib, ds, allow_test=True)


def test_filter_defined_dataset_and_bake_belongs_to_many_datasets_and_models(processed_lib):
    lib = processed_lib
    ds_a = D.create_dataset(lib, "Rises", filter_query={"field": "tags", "op": "has", "value": "rise"})
    ds_b = D.create_dataset(lib, "Everything", filter_query={"and": []})
    va = D.create_version(lib, ds_a, allow_test=True)
    vb = D.create_version(lib, ds_b, allow_test=True)
    assert len(va["items"]) == 3 and len(vb["items"]) == 12
    for name, dv in (("Model_A", va), ("Model_B", vb)):
        md = ids.new_id("model")
        atomic_write_json(lib.root / "models" / md / "model.json", {"schema": "gnumbat.model/0.1", "model_id": md, "name": name, "created_at": utc_now(), "modified_at": utc_now()})
        mv = ids.new_id("model_version")
        atomic_write_json(lib.root / "models" / md / "versions" / mv / "model_version.json", {
            "schema": "gnumbat.model_version/0.1", "model_version_id": mv, "model_id": md, "created_at": utc_now(),
            "dataset_version_id": dv["dataset_version_id"], "analysis_profile": dv["analysis_profile"],
            "architecture": {"name": "stub"}, "recipe_hash": "sha256:" + "0" * 64, "seed": 0, "n_bakes": len(dv["items"]),
            "training": {"state": "TRAINED" if name == "Model_A" else "TRAINING", "iterations": 10}})
    D.build_associations(lib)
    rise = next(v for v in lib.views() if "rise" in v["tags"])
    drone = next(v for v in lib.views() if "drone" in v["tags"])
    assert sorted(rise["models"]) == ["Model_A", "Model_B"] and sorted(rise["datasets"]) == ["Everything", "Rises"]
    assert rise["training"] == {"TRAINED": 1, "TRAINING": 1}
    assert drone["models"] == ["Model_B"]                                      # a Bake is not tied to one model
    hits = lib.query({"field": "models", "op": "has", "value": "Model_A"})
    assert len(hits) == 3
    # ...and the Bake files themselves never mention any of this
    assert "Model_A" not in (lib.bake_dir(rise["id"]) / "state.json").read_text()
