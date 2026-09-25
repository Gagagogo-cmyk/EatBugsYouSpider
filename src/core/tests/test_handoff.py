"""Plugin -> EBYS raw_uploads/ -> watch_demucs.py stems -> adopted back into the Bake.

The instrument's own pipeline is simulated by writing the files watch_demucs.py leaves behind:
    <session>/stems/htdemucs/<track>/<track>_{vocals,drums,bass,other}.wav
"""
import os
import time

import numpy as np

from gnumbat_core import states, wavio
from gnumbat_core.jobs import JobQueue
from gnumbat_core.jsonio import atomic_write_json, read_json, utc_now
from gnumbat_core.worker import Worker
from conftest import make_bake


def handed_off_bake(lib, tmp_path, **kw):
    bid = make_bake(lib, dur=3.0, **kw)
    track = f"loop__{bid}"
    sess = tmp_path / "EBYS" / "data" / "sessions" / "default"
    p = lib.bake_dir(bid) / "bake.json"
    doc = read_json(p)
    doc["handoff"] = {"status": "written", "target": "ebys_raw_uploads", "session": "default", "track": track,
                      "file": str(sess / "raw_uploads" / f"{track}.wav"), "stems_dir": str(sess / "stems" / "htdemucs" / track),
                      "written_at": utc_now()}
    atomic_write_json(p, doc)
    return bid, track, sess / "stems" / "htdemucs" / track


def leave_stems(folder, track, names=("vocals", "drums", "bass", "other"), age_s=30.0, sr=44100):
    folder.mkdir(parents=True, exist_ok=True)
    t = np.arange(sr * 3) / sr
    for i, n in enumerate(names):
        x = (0.2 * np.sin(2 * np.pi * (110 * (i + 1)) * t)).astype(np.float32)
        f = folder / f"{track}_{n}.wav"
        wavio.write_wav(f, np.stack([x, x], 1), sr, "float32")
        os.utime(f, (time.time() - age_s, time.time() - age_s))


def process_handed_off(lib, bid):
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "handoff", "auto_map": False})
    Worker(lib, {}).run(once=True)


def test_handoff_bake_is_usable_immediately_then_gets_the_instruments_stems(lib, tmp_path):
    bid, track, folder = handed_off_bake(lib, tmp_path)
    process_handed_off(lib, bid)
    st = lib.read_state(bid)
    assert st["state"] == states.READY
    assert any("handed to the instrument" in h.get("note", "") for h in st["history"])
    v = lib.bake_view(bid)
    assert v["handoff"] == "waiting" and v["stems"] == []
    assert [s["name"] for s in lib.read_analysis(bid)["sources"]] == ["mix"]

    leave_stems(folder, track)                                        # watch_demucs.py finished
    Worker(lib, {}).run(once=True)                                    # its idle scan queues the adoption
    st = lib.read_state(bid)
    assert st["state"] == states.READY and st["error"] is None
    dec = lib.read_decomposition(bid)
    assert dec["method"]["backend"] == "instrument" and dec["method"]["is_test"] is False
    assert [s["name"] for s in dec["stems"]] == ["drums", "bass", "body", "vocals"]          # other -> body
    assert dec["stem_map"]["body"]["from"] == ["other"]
    assert [s["name"] for s in lib.read_analysis(bid)["sources"]] == ["mix", "drums", "bass", "body", "vocals"]
    v = lib.bake_view(bid)
    assert v["handoff"] == "adopted" and v["stems"] == ["drums", "bass", "body", "vocals"]
    assert lib.verify_bake(bid) == []


def test_adoption_happens_once(lib, tmp_path):
    bid, track, folder = handed_off_bake(lib, tmp_path)
    process_handed_off(lib, bid)
    leave_stems(folder, track)
    Worker(lib, {}).run(once=True)
    n_done = len(list((lib.root / "jobs" / "done").glob("*.json")))
    Worker(lib, {}).run(once=True)
    Worker(lib, {}).run(once=True)
    assert len(list((lib.root / "jobs" / "done").glob("*.json"))) == n_done
    assert len(list((lib.root / "bakes" / bid / "decompositions").iterdir())) == 1


def test_stems_still_being_written_or_incomplete_are_not_adopted(lib, tmp_path):
    bid, track, folder = handed_off_bake(lib, tmp_path)
    process_handed_off(lib, bid)
    leave_stems(folder, track, names=("vocals", "drums", "bass"))              # 'other' not there yet
    Worker(lib, {}).run(once=True)
    assert lib.bake_view(bid)["handoff"] == "waiting"
    leave_stems(folder, track, age_s=0.0)                                       # all four, but brand new
    Worker(lib, {}).run(once=True)
    assert lib.bake_view(bid)["handoff"] == "waiting" and lib.read_state(bid)["state"] == states.READY


def test_worker_started_later_still_adopts(lib, tmp_path):
    """The stems can finish while no worker is running; a fresh worker picks them up on start."""
    bid, track, folder = handed_off_bake(lib, tmp_path)
    process_handed_off(lib, bid)
    leave_stems(folder, track)
    w = Worker(lib, {})
    assert w.run(once=True) == 0
    assert lib.bake_view(bid)["handoff"] == "adopted"


def test_explicit_instrument_backend_without_handoff_fails_loudly(lib):
    bid = make_bake(lib)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "instrument", "auto_map": False})
    Worker(lib, {}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.ERROR and st["error"]["code"] == "NO_HANDOFF"


def test_failed_handoff_is_visible_and_never_scanned(lib, tmp_path):
    bid = make_bake(lib)
    p = lib.bake_dir(bid) / "bake.json"
    doc = read_json(p)
    doc["handoff"] = {"status": "failed", "error": "EBYS folder not found"}
    atomic_write_json(p, doc)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "skip", "auto_map": False})
    Worker(lib, {}).run(once=True)
    assert lib.bake_view(bid)["handoff"] == "failed"
    assert lib.verify_bake(bid) == []
