import json
import threading

import numpy as np
import pytest

from gnumbat_core import ids, jsonio, wavio


def test_ulid_is_sortable_and_monotonic():
    a = [ids.new_id("bake") for _ in range(500)]
    assert a == sorted(a) and len(set(a)) == 500
    assert all(ids.is_id(x, "bake") for x in a)
    assert not ids.is_id(a[0], "job")
    assert abs(ids.ulid_time_ms(a[0]) - __import__("time").time() * 1000) < 5000


def test_ulid_fixed_time_encoding():
    assert ids.ulid(now_ms=0)[:10] == "0000000000"


def test_atomic_write_never_exposes_torn_json(tmp_path):
    p = tmp_path / "x.json"
    jsonio.atomic_write_json(p, {"n": 0})
    stop = threading.Event()
    bad = []

    def reader():
        while not stop.is_set():
            try:
                json.loads(p.read_text())
            except Exception as e:  # noqa: BLE001
                bad.append(e)

    t = threading.Thread(target=reader)
    t.start()
    for i in range(300):
        jsonio.atomic_write_json(p, {"n": i, "pad": "x" * 5000})
    stop.set()
    t.join()
    assert not bad


def test_canonical_hash_is_key_order_independent():
    assert jsonio.content_hash({"a": 1, "b": [1, 2]}) == jsonio.content_hash({"b": [1, 2], "a": 1})
    with pytest.raises(ValueError):
        jsonio.canonical_dumps({"a": float("nan")})


@pytest.mark.parametrize("sub,tol", [("float32", 0.0), ("pcm24", 2e-7), ("pcm16", 4e-5)])
def test_wav_roundtrip(tmp_path, sub, tol):
    x = (np.random.RandomState(0).randn(4000, 2) * 0.2).astype(np.float32)
    p = tmp_path / "a.wav"
    wavio.write_wav(p, x, 48000, sub)
    y, sr = wavio.read_wav(p)
    assert sr == 48000 and y.shape == x.shape and np.abs(x - y).max() <= tol
    assert wavio.wav_info(p)[:3] == (48000, 2, 4000)
