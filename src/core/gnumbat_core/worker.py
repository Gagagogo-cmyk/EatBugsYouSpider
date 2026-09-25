"""The Gnumbat worker: one process per library, consuming the job spool.

Never runs inside a DAW. Expensive work (Demucs, Pd/FluCoMa, t-SNE, training) lives here so
the plugin's audio and UI threads never wait on it.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

from . import __version__, states
from .analysis import AnalysisError, get_extractor, run_analysis
from .analysis.external_tags import EssentiaGenreTagger, MadmomTagger
from .analysis.summarize import make_card
from .decompose import Cancelled, DecomposeError, get_decomposer, run_decomposition
from .jobs import JobQueue
from .jsonio import atomic_write_json, utc_now
from .library import Library
from .schema import validate


class WorkerLock:
    """Exclusive advisory lock so exactly one worker serves a library, however many plugin
    instances try to launch one."""

    def __init__(self, path: Path):
        self.path = path
        self.fh = None

    def acquire(self) -> bool:
        self.fh = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.fh.seek(0)
            self.fh.truncate()
            self.fh.write(str(os.getpid()))
            self.fh.flush()
            return True
        except OSError:
            self.fh.close()
            self.fh = None
            return False

    def release(self) -> None:
        if self.fh:
            try:
                self.fh.close()
            finally:
                self.fh = None


class Worker:
    def __init__(self, lib: Library, settings: dict | None = None, poll_s: float = 0.4, heartbeat_s: float = 2.0):
        self.lib, self.settings = lib, settings or {}
        self.q = JobQueue(lib)
        self.poll_s, self.heartbeat_s = poll_s, heartbeat_s
        self.started_at = utc_now()
        self.current: dict | None = None
        self._last_beat = 0.0
        self.lock = WorkerLock(lib.root / "worker.lock")
        self._caps: dict | None = None
        self.scan_s = 5.0
        self._last_scan = 0.0
        self._handoff_settled: set[str] = set()     # Bakes with nothing (more) to adopt; bake.json is immutable so this is safe
        self._handoff_tries: dict[str, int] = {}    # adoption jobs queued per Bake: never loop forever if one does not stick

    # ------------------------------------------------------------------ instrument hand-off
    def _scan_due(self, force: bool = False) -> bool:
        now = time.time()
        if force or now - self._last_scan >= self.scan_s:
            self._last_scan = now
            return True
        return False

    def scan_handoffs(self) -> int:
        """Bakes the plugin handed to the instrument's raw_uploads/: once watch_demucs.py has left its four stems,
        queue one process_bake that adopts them (decompose='instrument') and re-analyses with stems. Returns jobs queued."""
        from .decompose.instrument_backend import stems_ready

        queued = 0
        busy = {j["params"].get("bake_id") for j in self.q.pending()}
        for bid in self.lib.list_bake_ids():
            if bid in self._handoff_settled:
                continue
            try:
                h = self.lib.read_bake(bid).get("handoff")
                if not h or h.get("status") != "written":
                    self._handoff_settled.add(bid)
                    continue
                st = self.lib.read_state(bid)
                if st["state"] != states.READY or bid in busy:
                    continue                                     # still processing (or ERROR: the user decides)
                if st["current"]["decomposition_id"] and self.lib.read_decomposition(bid)["method"]["backend"] == "instrument":
                    self._handoff_settled.add(bid)
                    continue
                if not stems_ready(h):
                    continue
                self._handoff_tries[bid] = self._handoff_tries.get(bid, 0) + 1
                if self._handoff_tries[bid] > 2:
                    self._handoff_settled.add(bid)
                    continue
                self.q.submit("process_bake", {"bake_id": bid, "decompose": "instrument", "force": "all", "auto_map": True},
                              app="gnumbat-worker")
                busy.add(bid)
                queued += 1
            except Exception:  # noqa: BLE001 - one broken Bake must not stop the scan
                continue
        return queued

    # ------------------------------------------------------------------ capabilities / heartbeat
    def capabilities(self) -> dict:
        if self._caps is None:
            dec = ["testsplit"]
            try:
                if get_decomposer("demucs", self.settings).available()[0]:
                    dec.insert(0, "demucs")
            except Exception:
                pass
            ana = ["python-ref"]
            pd = (self.settings.get("pd") or {}).get("path") or os.environ.get("GNUMBAT_PD") or shutil.which("pd")
            if pd:
                ana.append("pd-flucoma")
            tag = []
            try:
                if MadmomTagger(self.settings.get("madmom")).available()[0]:
                    tag.append("madmom")
            except Exception:
                pass
            try:
                if EssentiaGenreTagger(self.settings.get("essentia")).available()[0]:
                    tag.append("essentia")
            except Exception:
                pass
            self._caps = {"decompose": dec, "analyze": ana, "tag": tag, "project": ["tsne", "pca"]}
        return self._caps

    def beat(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_beat < self.heartbeat_s:
            return
        self._last_beat = now
        doc = {"schema": "gnumbat.worker_status/0.1", "pid": os.getpid(), "version": __version__, "started_at": self.started_at,
               "heartbeat_at": utc_now(), "heartbeat_unix": now, "library_id": self.lib.library_id,
               "capabilities": self.capabilities(),
               "current_job": {"job_id": self.current["job_id"], "type": self.current["type"]} if self.current else None}
        atomic_write_json(self.lib.root / "worker.json", doc)

    # ------------------------------------------------------------------ main loop
    def run(self, once: bool = False, idle_exit_s: float | None = None, max_jobs: int | None = None) -> int:
        if not self.lock.acquire():
            print("another worker already serves this library", file=sys.stderr)
            return 2
        done = 0
        try:
            self.lib._install_builtins()  # libraries created by the plugin lack the Python-side feature sets
            self.q.requeue_orphans()
            self.beat(force=True)
            idle_since = time.time()
            while True:
                self.beat()
                job = self.q.claim_next()
                if job is None and self._scan_due(force=once) and self.scan_handoffs():
                    continue                                     # adoption was queued: pick it up now
                if job is None:
                    if once:
                        break
                    if idle_exit_s is not None and time.time() - idle_since > idle_exit_s:
                        break
                    time.sleep(self.poll_s)
                    continue
                self.run_job(job)
                done += 1
                idle_since = time.time()
                if max_jobs and done >= max_jobs:
                    break
        finally:
            try:
                (self.lib.root / "worker.json").unlink()
            except OSError:
                pass
            self.lock.release()
        return 0

    def run_job(self, job: dict) -> None:
        self.current = job
        self.beat(force=True)
        started = utc_now()
        cancelled = lambda: self.q.is_cancelled(job["job_id"])  # noqa: E731
        try:
            handler = getattr(self, f"job_{job['type']}", None)
            if handler is None:
                raise _Failure("NOT_IMPLEMENTED", f"job type {job['type']!r} is not implemented in this worker", False)
            result = handler(job["params"], job, cancelled)
            self.q.finish(job, "done", started, result=result or {})
        except Cancelled:
            self._mark_bake_failed(job, "CANCELLED", "cancelled by user", True)
            self.q.finish(job, "cancelled", started, error={"code": "CANCELLED", "message": "cancelled", "retryable": True})
        except (DecomposeError, AnalysisError, _Failure) as e:
            self._mark_bake_failed(job, e.code, str(e), e.retryable)
            self.q.finish(job, "failed", started, error={"code": e.code, "message": str(e)[:2000], "retryable": e.retryable})
        except Exception as e:  # noqa: BLE001
            if type(e).__name__ == "PdError":
                self._mark_bake_failed(job, e.code, str(e), e.retryable)
                self.q.finish(job, "failed", started, error={"code": e.code, "message": str(e)[:2000], "retryable": e.retryable})
            else:
                msg = f"{type(e).__name__}: {e}"
                self._mark_bake_failed(job, "INTERNAL", msg, True)
                self.q.finish(job, "failed", started, error={"code": "INTERNAL", "message": (msg + "\n" + traceback.format_exc()[-1500:])[:2000], "retryable": True})
        finally:
            self.current = None
            self.beat(force=True)

    def _mark_bake_failed(self, job: dict, code: str, message: str, retryable: bool) -> None:
        bid = job["params"].get("bake_id")
        if bid and job["type"] in ("process_bake", "decompose_bake", "analyze_bake"):
            try:
                self.lib.fail_stage(bid, code, message, retryable=retryable, job_id=job["job_id"])
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------ job handlers
    def _progress_cb(self, bake_id: str, lo: float, hi: float, job: dict, tool: str | None = None):
        """``tool``, when given, is also recorded as that tool's own independent 0..1 fraction
        (``state.json``'s ``progress.tools.<tool>``) alongside the composite ``lo..hi``-scaled
        stage fraction -- so e.g. "demucs" and "madmom"/"essentia"/"flucoma" (run at different
        points in one process_bake job) can each show their own percentage in the UI at once."""
        last = [0.0]

        def cb(frac: float, msg: str = "") -> None:
            self.beat()
            self.q.touch(job["job_id"])
            now = time.time()
            if now - last[0] > 0.4 or frac >= 1.0:  # throttle state.json rewrites
                last[0] = now
                self.lib.update_progress(bake_id, lo + (hi - lo) * frac, msg, tool=tool, tool_fraction=frac)

        return cb

    def _resolve_decomposer(self, spec, bake_id=None):
        name = spec.get("backend") if isinstance(spec, dict) else spec
        if name == "instrument":
            h = self.lib.read_bake(bake_id).get("handoff") if bake_id else None
            return get_decomposer("instrument", self.settings, handoff=h)
        if name in (None, "auto"):
            cfg = self.settings.get("decomposer")
            name = cfg.get("backend") if isinstance(cfg, dict) else None
            if not name and (os.environ.get("GNUMBAT_DEMUCS_PYTHON") or importlib.util.find_spec("demucs")):
                name = "demucs"
        if not name:
            raise DecomposeError("NO_DECOMPOSER", "No decomposition backend configured. Set decomposer.backend/python in "
                                 "settings.json (or GNUMBAT_DEMUCS_PYTHON), or submit with decompose='skip'.", retryable=True)
        return get_decomposer(name, self.settings)

    def _resolve_extractor(self, spec):
        spec = spec if isinstance(spec, dict) else {}
        name = spec.get("extractor") or (self.settings.get("analysis") or {}).get("extractor")
        if not name:
            name = "pd-flucoma" if (self.settings.get("pd") or {}).get("patch") else "python-ref"
        cfg = spec.get("config") or (self.settings.get("analysis") or {}).get("config") or {}
        return get_extractor(name, cfg, self.settings)

    def _resolve_taggers(self, spec):
        """madmom (downbeat/meter/BPM) + essentia (genre) run in *addition* to whichever extractor
        was resolved above, not instead of it -- unlike decompose/analyze there's no exclusive
        choice here, both run whenever they're configured (settings.json) and importable, same
        optionality as pd-flucoma. `analyze.tags: {"madmom": false}` in a job's params opts a
        single Bake out (e.g. a re-run that only needs stems re-analysed); ``tag.enabled: false``
        under a tool's own settings block turns it off machine-wide."""
        spec = (spec.get("tags") if isinstance(spec, dict) else None) or {}
        out: dict = {}
        if spec.get("madmom", True):
            cfg = self.settings.get("madmom") or {}
            if cfg.get("enabled", True):
                t = MadmomTagger(cfg)
                if t.available()[0]:
                    out["madmom"] = t
        if spec.get("essentia", True):
            cfg = self.settings.get("essentia") or {}
            if cfg.get("enabled", True):
                t = EssentiaGenreTagger(cfg)
                if t.available()[0]:
                    out["essentia"] = t
        return out

    def _stage_decompose(self, bid, params, job, cancelled):
        dec = self._resolve_decomposer(params.get("decompose", "auto"), bid)
        self.lib.begin_stage(bid, states.DECOMPOSING, job["job_id"], dec.name)
        doc = run_decomposition(self.lib, bid, dec, progress=self._progress_cb(bid, 0.0, 1.0, job, tool=dec.name), cancelled=cancelled)
        self.lib.finish_stage(bid, states.DECOMPOSED, decomposition_id=doc["decomposition_id"], job_id=job["job_id"])
        return doc

    def _stage_analyze(self, bid, params, job, cancelled, use_dec=True):
        ext = self._resolve_extractor(params.get("analyze"))
        taggers = self._resolve_taggers(params.get("analyze"))
        self.lib.begin_stage(bid, states.ANALYZING, job["job_id"], ext.name)
        # the main extractor and the two taggers each get their own named 0..1 progress (and their
        # own band of the composite "analyzing" fraction) so the UI can show demucs/flucoma/madmom/
        # essentia as four independent percentages, not one blended number.
        n_tags = len(taggers)
        bands = [(0.0, 1.0 if n_tags == 0 else 0.5)]
        if n_tags:
            step = 0.5 / n_tags
            bands += [(0.5 + i * step, 0.5 + (i + 1) * step) for i in range(n_tags)]
        ext_lo, ext_hi = bands[0]
        tag_progress = {name: self._progress_cb(bid, lo, hi, job, tool=name)
                        for name, (lo, hi) in zip(taggers.keys(), bands[1:])}
        doc = run_analysis(self.lib, bid, ext, progress=self._progress_cb(bid, ext_lo, ext_hi, job, tool=ext.name),
                           cancelled=cancelled, use_decomposition=use_dec, taggers=taggers, tag_progress=tag_progress)
        self.lib.finish_stage(bid, states.ANALYZED, analysis_id=doc["analysis_id"], card=make_card(doc), job_id=job["job_id"])
        return doc

    def _stage_ready(self, bid, job, note=None):
        problems = self.lib.verify_bake(bid)
        if problems:
            raise _Failure("VALIDATION_FAILED", "; ".join(problems), False)
        self.lib.finish_stage(bid, states.READY, job_id=job["job_id"], note=note)

    def job_process_bake(self, params, job, cancelled):
        bid = params["bake_id"]
        st = self.lib.read_state(bid)
        if st["state"] == states.ERROR:
            self.lib.retry(bid)
            st = self.lib.read_state(bid)
        force = params.get("force") or ""
        skip_dec = params.get("decompose") in ("skip", "handoff")
        handed_off = params.get("decompose") == "handoff"
        auto_skipped = False
        if not skip_dec and st["state"] == states.CAPTURED and params.get("decompose") in (None, "auto"):
            # "auto" must not turn a fresh install (no Demucs yet) into a wall of ERROR Bakes: degrade to a mix-only
            # analysis and say so. An explicitly requested backend that is missing still fails loudly.
            try:
                self._resolve_decomposer("auto")
            except DecomposeError as e:
                if e.code != "NO_DECOMPOSER":
                    raise
                skip_dec = auto_skipped = True
        state = st["state"]
        ran = []
        if state == states.CAPTURED and not skip_dec or (force in ("decompose", "all") and state in (states.READY, states.DECOMPOSED, states.ANALYZED)):
            self._stage_decompose(bid, params, job, cancelled); ran.append("decompose")
            state = states.DECOMPOSED
        if state in (states.CAPTURED, states.DECOMPOSED) or (force in ("analyze", "all") and state in (states.READY, states.ANALYZED)):
            self._stage_analyze(bid, params, job, cancelled, use_dec=not skip_dec); ran.append("analyze")
            state = states.ANALYZED
        if state == states.ANALYZED:
            note = None
            if auto_skipped:
                note = "no stem decomposer configured: analysed the mix only (Reprocess after installing one)"
            elif handed_off:
                note = ("audio handed to the instrument's raw_uploads/; analysed the mix only for now. "
                        "Its Demucs stems attach automatically when watch_demucs.py finishes")
            self._stage_ready(bid, job, note)
            ran.append("ready")
        if params.get("auto_map", True) and not any(j["type"] == "process_bake" for j in self.q.pending()):
            self._maybe_queue_map()
        return {"bake_id": bid, "ran": ran, "state": self.lib.read_state(bid)["state"]}

    def job_decompose_bake(self, params, job, cancelled):
        doc = self._stage_decompose(params["bake_id"], params, job, cancelled)
        return {"decomposition_id": doc["decomposition_id"]}

    def job_analyze_bake(self, params, job, cancelled):
        bid = params["bake_id"]
        st = self.lib.read_state(bid)
        if st["state"] == states.ERROR:
            self.lib.retry(bid)
        doc = self._stage_analyze(bid, params, job, cancelled)
        self._stage_ready(bid, job)
        return {"analysis_id": doc["analysis_id"]}

    def _maybe_queue_map(self):
        if any(j["type"] == "project_map" for j in self.q.pending()):
            return
        self.q.submit("project_map", {"feature_set_id": "spectral", "method": "tsne"}, app="gnumbat-worker")

    def job_project_map(self, params, job, cancelled):
        from .mapproj import project_map

        doc = project_map(self.lib, params.get("feature_set_id", "spectral"), params.get("method", "tsne"),
                          seed=int(params.get("seed", 0)), warm_start=bool(params.get("warm_start", True)))
        return {"map_id": doc["map_id"], "n_points": len(doc["points"]), "method": doc["method"]["name"]}

    def job_reindex(self, params, job, cancelled):
        from .dataset import build_associations

        return {"bakes": len(build_associations(self.lib)["bakes"])}

    def job_build_dataset_version(self, params, job, cancelled):
        from .dataset import create_version

        dv = create_version(self.lib, params["dataset_id"], params.get("notes", ""), bool(params.get("allow_test", False)))
        return {"dataset_version_id": dv["dataset_version_id"]}


class _Failure(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.retryable = code, retryable
