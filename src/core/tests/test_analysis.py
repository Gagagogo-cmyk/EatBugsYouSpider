import sys
import time

import numpy as np
import pytest

from gnumbat_core import demo, wavio
from gnumbat_core.analysis import get_extractor
from gnumbat_core.analysis.pyref import PyRefExtractor
from gnumbat_core.analysis.registry import FEATURES, BUILTIN_FEATURE_SETS
from gnumbat_core.analysis.summarize import estimate_key, stats_1d
from gnumbat_core.decompose import Cancelled, apply_stem_map
from gnumbat_core.decompose.demucs_backend import DemucsDecomposer
from gnumbat_core.decompose.testsplit_backend import TestSplitDecomposer
import fakes


def _wav(tmp_path, x, name="a.wav", sr=demo.SR):
    p = tmp_path / name
    wavio.write_wav(p, x.astype(np.float32), sr)
    return p


def test_registry_is_consistent():
    for fs in BUILTIN_FEATURE_SETS.values():
        assert all(f in FEATURES for f in fs["features"]), fs["feature_set_id"]
    assert all(f["id"].count(".") >= 1 and f["dims"] >= 1 for f in FEATURES.values())


def test_analysis_is_deterministic(tmp_path):
    x = demo.riser(4, 100, 3000, np.random.RandomState(0))
    p = _wav(tmp_path, x)
    a, b = PyRefExtractor().extract_one("mix", p), PyRefExtractor().extract_one("mix", p)
    for k in a.series:
        assert np.array_equal(a.series[k], b.series[k])
    assert a.onsets_s == b.onsets_s and a.scalars == b.scalars


def test_features_capture_the_trajectory_not_just_the_mean(tmp_path):
    rng = np.random.RandomState(1)
    up = PyRefExtractor().extract_one("mix", _wav(tmp_path, demo.riser(6, 100, 3000, rng), "up.wav"))
    dn = PyRefExtractor().extract_one("mix", _wav(tmp_path, demo.riser(6, 100, 3000, rng, rising=False), "dn.wav"))
    s_up = stats_1d(up.series["loudness.rms_db"], up.hop_s)
    s_dn = stats_1d(dn.series["loudness.rms_db"], dn.hop_s)
    assert s_up["slope"] > 3 and s_dn["slope"] < -3                                   # rise vs fall, dB/s
    assert abs(s_up["mean"] - s_dn["mean"]) < 6                                       # ...though their means are similar
    assert s_up["envelope"][-1] > s_up["envelope"][0] + 20 and s_dn["envelope"][-1] < s_dn["envelope"][0] - 20


@pytest.mark.parametrize("bpm", [90, 100, 128])
def test_tempo_suggestion_on_steady_pulse(tmp_path, bpm):
    x = demo.hits(8, bpm, np.random.RandomState(3))
    r = PyRefExtractor().extract_one("mix", _wav(tmp_path, x))
    assert abs(r.scalars["rhythm.tempo_bpm"] - bpm) / bpm < 0.04
    assert len(r.onsets_s) >= 8


def test_no_pulse_no_tempo(tmp_path):
    r = PyRefExtractor().extract_one("mix", _wav(tmp_path, demo.riser(8, 100, 3000, np.random.RandomState(0))))
    assert "rhythm.tempo_bpm" not in r.scalars


def test_pitch_and_key_features(tmp_path):
    sr = demo.SR
    t = np.arange(sr * 3) / sr
    r = PyRefExtractor().extract_one("mix", _wav(tmp_path, 0.3 * np.sin(2 * np.pi * 220.0 * t)))
    s = stats_1d(r.series["pitch.f0_hz"], r.hop_s, r.masks["pitch.f0_hz"])
    assert abs(s["mean"] - 220.0) < 4.0
    chroma = np.mean(r.series["harmony.chroma"], axis=0)
    assert int(np.argmax(chroma)) == 9                                                  # A
    triad = np.zeros(12); triad[[9, 0, 4]] = 1.0                                       # A minor triad
    assert estimate_key(triad + 0.05) == "A minor"


def test_stereo_scalars(tmp_path):
    rng = np.random.RandomState(0)
    n = rng.randn(demo.SR * 2) * 0.1
    left_only = _wav(tmp_path, np.stack([n, 0 * n], 1), "l.wav")
    mono = _wav(tmp_path, np.stack([n, n], 1), "m.wav")
    a, b = PyRefExtractor().extract_one("mix", left_only), PyRefExtractor().extract_one("mix", mono)
    assert a.scalars["stereo.pan"] < -0.99 and abs(b.scalars["stereo.pan"]) < 1e-6 and b.scalars["stereo.width"] < 1e-6


def test_silence_and_tiny_files_do_not_crash(tmp_path):
    for n in (1, 100, 3000, demo.SR):
        r = PyRefExtractor().extract_one("mix", _wav(tmp_path, np.zeros(n), f"z{n}.wav"))
        assert all(np.isfinite(a).all() for a in r.series.values())


def test_testsplit_stems_sum_to_the_input_and_are_flagged(tmp_path, lib):
    from conftest import make_bake
    from gnumbat_core.decompose import run_decomposition

    bid = make_bake(lib, "hits", "x", dur=3.0)
    doc = run_decomposition(lib, bid, TestSplitDecomposer())
    orig, _ = wavio.read_wav(lib.audio_path(bid))
    total = sum(wavio.read_wav(p)[0] for p in lib.stem_paths(bid, doc["decomposition_id"]).values())
    assert np.abs(total - orig).max() < 1e-4 and doc["method"]["is_test"] is True


def test_stem_map_sum_and_missing_native_stem(tmp_path):
    from gnumbat_core.decompose import DecomposeError

    a, b = _wav(tmp_path, np.ones(100) * 0.25, "a.wav"), _wav(tmp_path, np.ones(100) * 0.5, "b.wav")
    out = tmp_path / "out"; out.mkdir()
    stems = apply_stem_map({"other": a, "piano": b}, {"body": {"from": ["other", "piano"], "op": "sum"}}, out)
    assert np.allclose(wavio.read_wav(out / "body.wav")[0], 0.75) and stems[0]["frames"] == 100
    with pytest.raises(DecomposeError) as e:
        apply_stem_map({"other": a}, {"body": {"from": ["other", "guitar"]}}, out)
    assert e.value.code == "STEM_MAP_MISSING" and not e.value.retryable


def test_demucs_reports_progress_and_can_be_cancelled(tmp_path, monkeypatch):
    fakes.make_fake_demucs(tmp_path / "site")
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "site"))
    src = _wav(tmp_path, demo.drone(2, [110], np.random.RandomState(0)), "in.wav")
    d = DemucsDecomposer(python=sys.executable)
    assert d.available() == (True, "")
    seen = []
    (tmp_path / "w").mkdir()
    stems = d.separate(src, tmp_path / "w", progress=lambda f, m: seen.append(round(f, 2)))
    assert set(stems) == {"drums", "bass", "other", "vocals"} and 0.25 in seen and seen[-1] == 1.0
    (tmp_path / "w2").mkdir()
    with pytest.raises(Cancelled):
        d.separate(src, tmp_path / "w2", cancelled=lambda: True)


def test_demucs_unavailable_is_reported():
    ok, why = DemucsDecomposer(python="/nonexistent/python").available()
    assert not ok and "cannot run" in why


def test_unknown_extractor_is_a_nonretryable_error():
    from gnumbat_core.analysis import AnalysisError

    with pytest.raises(AnalysisError) as e:
        get_extractor("clap-embed")
    assert not e.value.retryable
