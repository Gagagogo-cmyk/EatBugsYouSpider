import json
import os
import sys
import time

import pytest

from gnumbat_core import states
from gnumbat_core.jobs import JobQueue
from gnumbat_core.jsonio import read_json
from gnumbat_core.worker import Worker, WorkerLock
from conftest import make_bake
import fakes


def test_priority_then_fifo_and_atomic_claim(lib):
    q = JobQueue(lib)
    a = q.submit("reindex"); b = q.submit("reindex"); c = q.submit("reindex", priority=5)
    assert [q.claim_next()["job_id"] for _ in range(3)] == [c, a, b]
    assert q.claim_next() is None and q.counts()["running"] == 3


def test_requeue_orphans_then_give_up(lib):
    q = JobQueue(lib)
    jid = q.submit("reindex", max_attempts=2)
    q.claim_next()                                        # worker "dies" here
    assert q.requeue_orphans() == [jid] and q.counts()["pending"] == 1
    q.claim_next()
    assert q.requeue_orphans() == [] and q.result(jid)["error"]["code"] == "ORPHANED"


def test_only_one_worker_per_library(lib):
    a, b = WorkerLock(lib.root / "worker.lock"), WorkerLock(lib.root / "worker.lock")
    assert a.acquire() and not b.acquire()
    a.release()
    assert b.acquire()
    b.release()


def test_full_pipeline_with_testsplit_and_heartbeat(lib):
    bid = make_bake(lib, "rise", "rise", dur=3.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "testsplit", "auto_map": False})
    w = Worker(lib, {})
    assert w.run(once=True) == 0
    st = lib.read_state(bid)
    assert st["state"] == states.READY and st["error"] is None and st["progress"] is None
    assert [h["state"] for h in st["history"]] == ["CAPTURED", "DECOMPOSING", "DECOMPOSED", "ANALYZING", "ANALYZED", "READY"]
    dec, an = lib.read_decomposition(bid), lib.read_analysis(bid)
    assert dec["method"]["is_test"] is True and [s["name"] for s in dec["stems"]] == ["bass", "body", "vocals", "drums"]
    assert [s["name"] for s in an["sources"]] == ["mix", "bass", "body", "vocals", "drums"] and an["decomposition_id"] == dec["decomposition_id"]
    assert st["card"]["n_slices"] >= 1 and "loudness.rms_db" in st["card"]["spark"]
    assert not (lib.root / "worker.json").exists()        # removed on clean exit


def test_worker_json_heartbeat_while_running(lib):
    import threading

    w = Worker(lib, {}, poll_s=0.05, heartbeat_s=0.1)
    t = threading.Thread(target=lambda: w.run(idle_exit_s=0.6))
    t.start()
    time.sleep(0.35)
    doc = read_json(lib.root / "worker.json")
    assert doc["pid"] == os.getpid() and "python-ref" in doc["capabilities"]["analyze"] and doc["current_job"] is None
    assert time.time() - doc["heartbeat_unix"] < 1.0
    t.join()


def test_auto_without_any_decomposer_degrades_to_mix_only_and_says_so(lib, monkeypatch):
    """A fresh install has no Demucs. 'auto' must not turn every first Bake into an ERROR: the Bake is analysed
    (mix only), reaches READY, and the history records why there are no stems so Reprocess can fix it later."""
    monkeypatch.delenv("GNUMBAT_DEMUCS_PYTHON", raising=False)
    monkeypatch.setattr("importlib.util.find_spec", lambda name: None)
    bid = make_bake(lib)
    jid = JobQueue(lib).submit("process_bake", {"bake_id": bid, "auto_map": False})
    Worker(lib, {}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.READY and st["current"]["decomposition_id"] is None
    assert JobQueue(lib).result(jid)["status"] == "done"
    assert [s["name"] for s in lib.read_analysis(bid)["sources"]] == ["mix"]
    notes = [h.get("note", "") for h in st["history"]]
    assert any("no stem decomposer configured" in n for n in notes)
    assert lib.bake_view(bid)["stems"] == []


def test_explicit_backend_that_is_missing_still_fails_loudly(lib, monkeypatch):
    """Only 'auto' degrades. Asking for a specific backend that cannot run is an ERROR the user can act on."""
    monkeypatch.delenv("GNUMBAT_DEMUCS_PYTHON", raising=False)
    monkeypatch.setattr("importlib.util.find_spec", lambda name: None)
    bid = make_bake(lib)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "demucs", "auto_map": False})
    Worker(lib, {}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.ERROR and st["error"]["retryable"] and st["error"]["resume_state"] == states.CAPTURED
    # user chooses the test backend instead; the same Bake proceeds from ERROR
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "testsplit", "auto_map": False})
    Worker(lib, {}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.READY and st["current"]["decomposition_id"]


def test_failing_extractor_marks_error_and_keeps_previous_results(lib, monkeypatch):
    bid = make_bake(lib)
    q = JobQueue(lib)
    q.submit("process_bake", {"bake_id": bid, "decompose": "skip", "auto_map": False})
    Worker(lib, {}).run(once=True)
    good = lib.read_state(bid)["current"]["analysis_id"]
    q.submit("process_bake", {"bake_id": bid, "decompose": "skip", "force": "analyze", "auto_map": False,
                              "analyze": {"extractor": "pd-flucoma"}})
    Worker(lib, {"pd": {"path": "/nonexistent/pd"}}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.ERROR and st["error"]["code"] == "PD_NOT_FOUND" and st["error"]["resume_state"] == states.READY
    assert st["current"]["analysis_id"] == good                       # old analysis still current and intact
    assert lib.verify_bake(bid) == []


def test_cancel_marker_stops_a_job(lib):
    bid = make_bake(lib)
    q = JobQueue(lib)
    jid = q.submit("process_bake", {"bake_id": bid, "decompose": "skip", "auto_map": False})
    q.cancel(jid)
    from gnumbat_core.decompose import Cancelled
    from gnumbat_core.analysis.pyref import PyRefExtractor

    w = Worker(lib, {})
    orig = PyRefExtractor.extract_sources

    def check(self, sources, workdir=None, progress=None, cancelled=None):
        assert cancelled()                                             # the worker wired the marker through
        raise Cancelled("cancelled")

    PyRefExtractor.extract_sources = check
    try:
        w.run(once=True)
    finally:
        PyRefExtractor.extract_sources = orig
    assert q.result(jid)["status"] == "cancelled" and lib.read_state(bid)["state"] == states.ERROR
    assert lib.read_state(bid)["error"]["code"] == "CANCELLED"


def test_pd_flucoma_plumbing_against_fake_pd(lib, tmp_path):
    pd = fakes.make_fake_pd(tmp_path / "fakepd")
    bid = make_bake(lib, dur=3.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "testsplit", "auto_map": False,
                                          "analyze": {"extractor": "pd-flucoma"}})
    Worker(lib, {"pd": {"path": str(pd), "patch": str(tmp_path / "x.pd")}}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.READY, st["error"]
    a = lib.read_analysis(bid)
    assert a["extractor"]["name"] == "pd-flucoma" and a["extractor"]["is_reference"] is False
    mix = a["sources"][0]
    assert mix["summary"]["loudness.db"]["dims"][0]["slope"] > 0 and len(mix["summary"]["timbre.mfcc"]["dims"]) == 13
    assert mix["summary"]["harmony.chroma"]["dims"][9]["mean"] > 0.9 and a["suggestions"]["key"] is not None
    assert len(mix["slices"]) >= 2


def test_pd_failure_without_result_is_reported(lib, tmp_path):
    pd = fakes.make_fake_pd(tmp_path / "fakepd", fail=True)
    bid = make_bake(lib, dur=2.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "skip", "auto_map": False, "analyze": {"extractor": "pd-flucoma"}})
    Worker(lib, {"pd": {"path": str(pd)}}).run(once=True)
    st = lib.read_state(bid)
    assert st["error"]["code"] == "PD_NO_RESULT" and "couldn't create" in st["error"]["message"]


def test_demucs_subprocess_stem_map_and_progress(lib, tmp_path, monkeypatch):
    fakes.make_fake_demucs(tmp_path / "site")
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "site"))
    bid = make_bake(lib, dur=3.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "demucs", "auto_map": False})
    Worker(lib, {"decomposer": {"backend": "demucs", "python": sys.executable}}).run(once=True)
    st = lib.read_state(bid)
    assert st["state"] == states.READY, st["error"]
    dec = lib.read_decomposition(bid)
    assert dec["method"]["backend"] == "demucs" and dec["method"]["version"] == "4.0.1-fake" and dec["method"]["is_test"] is False
    assert [s["name"] for s in dec["stems"]] == ["drums", "bass", "body", "vocals"]        # other -> body
    assert dec["stem_map"]["body"] == {"from": ["other"], "op": "copy"}


def test_demucs_failure_surfaces_stderr(lib, tmp_path, monkeypatch):
    fakes.make_fake_demucs(tmp_path / "site", fail=True)
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "site"))
    bid = make_bake(lib, dur=2.0)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "decompose": "demucs", "auto_map": False})
    Worker(lib, {"decomposer": {"backend": "demucs", "python": sys.executable}}).run(once=True)
    e = lib.read_state(bid)["error"]
    assert e["code"] == "DEMUCS_FAILED" and "out of memory" in e["message"] and e["retryable"]


def test_auto_map_is_queued_after_last_bake(lib):
    q = JobQueue(lib)
    for i in range(2):
        q.submit("process_bake", {"bake_id": make_bake(lib, seed=i), "decompose": "skip"})
    Worker(lib, {}).run(once=True)
    done = [read_json(p)["type"] for p in sorted((lib.root / "jobs" / "done").glob("*.json"))]
    assert done.count("process_bake") == 2 and done.count("project_map") == 1


def test_non_object_decomposer_setting_does_not_crash_the_worker(lib, monkeypatch):
    """Older plugin builds wrote settings 'decomposer': 'auto' (a string). The worker must ignore it, not raise."""
    monkeypatch.delenv("GNUMBAT_DEMUCS_PYTHON", raising=False)
    monkeypatch.setattr("importlib.util.find_spec", lambda name: None)
    bid = make_bake(lib)
    JobQueue(lib).submit("process_bake", {"bake_id": bid, "auto_map": False})
    Worker(lib, {"decomposer": "auto"}).run(once=True)
    assert lib.read_state(bid)["state"] == states.READY
