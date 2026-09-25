import numpy as np
import pytest

from gnumbat_core import embed, mapproj
from gnumbat_core.jobs import JobQueue
from gnumbat_core.worker import Worker
from conftest import make_bake


def _purity(X, labels, k=2):  # 3 Bakes per class => 2 same-class neighbours exist, so 1.0 is the max at k=2
    d = ((X[:, None] - X[None]) ** 2).sum(-1)
    np.fill_diagonal(d, np.inf)
    nn = np.argsort(d, axis=1)[:, :k]
    return float(np.mean([np.mean([labels[j] == labels[i] for j in nn[i]]) for i in range(len(labels))]))


def test_space_is_standardised_and_self_describing(processed_lib):
    sp = embed.build_space(processed_lib, "loudness")
    X, rec = sp["X"], sp["record"]
    assert X.shape == (12, rec["dim"]) and np.allclose(X.mean(0), 0, atol=1e-9)
    assert all(c.startswith("mix/") for c in rec["columns"])
    assert rec["analysis_profile"]["extractor"] == "python-ref" and rec["feature_set"]["feature_set_id"] == "loudness"
    assert (processed_lib.derived_dir / "embeddings" / rec["embedding_id"] / "vectors.npy").exists()


def test_feature_sets_are_selectable_views_of_the_same_bakes(processed_lib):
    dims = {fs: embed.build_space(processed_lib, fs)["record"]["dim"] for fs in ("all", "spectral", "timbre", "rhythm", "pitch", "loudness")}
    assert len(set(dims.values())) > 3 and dims["all"] > dims["spectral"] > 0
    stems = embed.build_space(processed_lib, "all")["record"]["columns"]
    assert any(c.startswith("drums/") for c in stems) and any(c.startswith("body/") for c in stems)   # stems participate in 'all'


def test_embedding_separates_rises_from_falls_and_drones(processed_lib):
    sp = embed.build_space(processed_lib, "loudness")
    labels = [processed_lib.read_semantic(b)["raw_notation"] for b in sp["bake_ids"]]
    assert _purity(sp["X"], labels) >= 0.8


def test_map_is_deterministic_and_normalised(processed_lib):
    a = mapproj.project_map(processed_lib, "spectral", warm_start=False)
    b = mapproj.project_map(processed_lib, "spectral", warm_start=False)
    assert a["points"] == b["points"] and a["method"]["name"] == "tsne"
    xs = [abs(p["x"]) for p in a["points"]] + [abs(p["y"]) for p in a["points"]]
    assert max(xs) == pytest.approx(1.0, abs=1e-4)
    assert a["quality"]["trustworthiness"] > 0.7 and "not musical similarity" in a["disclaimer"]


def test_map_clusters_like_bakes(processed_lib):
    m = mapproj.project_map(processed_lib, "loudness", warm_start=False)
    pts = np.array([[p["x"], p["y"]] for p in m["points"]])
    labels = [processed_lib.read_semantic(p["bake_id"])["raw_notation"] for p in m["points"]]
    assert _purity(pts, labels) >= 0.7


def test_small_libraries_fall_back_to_pca_and_say_so(lib):
    q = JobQueue(lib)
    for i in range(5):
        q.submit("process_bake", {"bake_id": make_bake(lib, "rise" if i % 2 else "hits", seed=i, dur=3.0), "decompose": "skip", "auto_map": False})
    Worker(lib, {}).run(once=True)
    m = mapproj.project_map(lib, "spectral")
    assert m["method"]["name"] == "pca" and m["method"]["requested"] == "tsne" and "PCA" in m["method"]["note"]
    assert len(m["points"]) == 5


def test_single_bake_map_does_not_crash(lib):
    JobQueue(lib).submit("process_bake", {"bake_id": make_bake(lib, dur=3.0), "decompose": "skip", "auto_map": False})
    Worker(lib, {}).run(once=True)
    m = mapproj.project_map(lib, "spectral")
    assert len(m["points"]) == 1 and m["points"][0]["x"] == 0.0


def test_warm_start_keeps_the_map_stable_when_a_bake_is_added(processed_lib):
    lib = processed_lib
    before = mapproj.project_map(lib, "spectral", warm_start=False)
    JobQueue(lib).submit("process_bake", {"bake_id": make_bake(lib, "rise", seed=99, dur=4.0), "decompose": "testsplit", "auto_map": False})
    Worker(lib, {}).run(once=True)
    after = mapproj.project_map(lib, "spectral", warm_start=True)
    assert after["method"]["warm_start"] is True and len(after["points"]) == 13
    old = {p["bake_id"]: np.array([p["x"], p["y"]]) for p in before["points"]}
    new = {p["bake_id"]: np.array([p["x"], p["y"]]) for p in after["points"]}
    disp = np.array([np.linalg.norm(old[b] - new[b]) for b in old])
    # a cold restart of t-SNE is an arbitrary rotation/reflection; the warm start must not scramble the layout
    cold = mapproj.project_map(lib, "spectral", warm_start=False)
    cold_pts = {p["bake_id"]: np.array([p["x"], p["y"]]) for p in cold["points"]}
    cold_disp = np.array([np.linalg.norm(old[b] - cold_pts[b]) for b in old])
    assert np.median(disp) < 0.5 * np.median(cold_disp) or np.median(disp) < 0.15


def test_mixed_extractors_are_not_silently_blended(processed_lib):
    lib = processed_lib
    bid = make_bake(lib, "rise", seed=50, dur=3.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "skip", "auto_map": False,
                                          "analyze": {"extractor": "python-ref", "config": {"n_mels": 30}}})   # different config hash
    Worker(lib, {}).run(once=True)
    sp = embed.build_space(lib, "spectral")
    assert bid not in sp["bake_ids"] and any(e["bake_id"] == bid and "different analysis profile" in e["reason"] for e in sp["record"]["excluded"])


def test_trustworthiness_metric_behaves():
    rng = np.random.RandomState(0)
    X = rng.randn(40, 6)
    assert mapproj.trustworthiness(X, X[:, :2] * 0 + rng.randn(40, 2), 5) < mapproj.trustworthiness(X, X, 5)
    assert mapproj.trustworthiness(X[:8], X[:8], 5) is None
