"""Durable file-based job queue (the spool directory).

    jobs/pending/<job_id>.json   -> jobs/running/<job_id>.json   (claim = atomic rename)
                                 -> jobs/done|failed/<job_id>.json (result document)
    jobs/cancel/<job_id>         cancel marker, checked by the worker between steps

Producers (plugin, CLI, web) only ever *add* files to pending/. The worker is the only
consumer. Works when the worker starts later than the producer, survives worker crashes
(running/ is requeued at startup), and needs no ports.
"""
from __future__ import annotations

import os
from pathlib import Path

from . import __version__, ids
from .jsonio import atomic_write_json, read_json, utc_now
from .schema import validate

JOB_SCHEMA = "gnumbat.job/0.1"
RESULT_SCHEMA = "gnumbat.job_result/0.1"


class JobQueue:
    def __init__(self, lib):
        self.lib = lib
        self.d = {k: lib.root / "jobs" / k for k in ("pending", "running", "done", "failed", "cancel")}
        for p in self.d.values():
            p.mkdir(parents=True, exist_ok=True)

    def submit(self, type_: str, params: dict | None = None, *, priority: int = 0, max_attempts: int = 2,
               app: str = "gnumbat-core", instance: str | None = None) -> str:
        job_id = ids.new_id("job")
        doc = {"schema": JOB_SCHEMA, "job_id": job_id, "type": type_, "created_at": utc_now(),
               "created_by": {"app": app, "version": __version__, **({"instance": instance} if instance else {})},
               "priority": priority, "params": params or {}, "attempt": 0, "max_attempts": max_attempts}
        validate("job", doc)
        atomic_write_json(self.d["pending"] / f"{job_id}.json", doc)
        return job_id

    def pending(self) -> list[dict]:
        docs = []
        for p in self.d["pending"].glob("job_*.json"):
            try:
                docs.append(read_json(p))
            except Exception:
                continue  # half-visible file from a non-atomic producer: pick it up next poll
        return sorted(docs, key=lambda j: (-j.get("priority", 0), j["job_id"]))

    def claim_next(self) -> dict | None:
        for job in self.pending():
            src = self.d["pending"] / f"{job['job_id']}.json"
            dst = self.d["running"] / f"{job['job_id']}.json"
            try:
                os.rename(src, dst)  # atomic claim; loses cleanly if someone else got it
            except OSError:
                continue
            return job
        return None

    def touch(self, job_id: str) -> None:
        try:
            os.utime(self.d["running"] / f"{job_id}.json")
        except OSError:
            pass

    def finish(self, job: dict, status: str, started_at: str, result: dict | None = None, error: dict | None = None,
               worker_pid: int | None = None) -> None:
        doc = {"schema": RESULT_SCHEMA, "job_id": job["job_id"], "type": job["type"], "status": status,
               "started_at": started_at, "finished_at": utc_now(), "worker": {"pid": worker_pid or os.getpid(), "version": __version__},
               "result": result, "error": error}
        validate("job_result", doc)
        dest = "done" if status in ("done", "cancelled") else "failed"
        atomic_write_json(self.d[dest] / f"{job['job_id']}.json", doc)
        try:
            os.unlink(self.d["running"] / f"{job['job_id']}.json")
        except OSError:
            pass
        try:
            os.unlink(self.d["cancel"] / job["job_id"])
        except OSError:
            pass

    def requeue_orphans(self) -> list[str]:
        """Called by a worker that just took the library lock: anything in running/ is orphaned."""
        out = []
        for p in sorted(self.d["running"].glob("job_*.json")):
            try:
                job = read_json(p)
            except Exception:
                p.unlink(missing_ok=True)
                continue
            job["attempt"] = int(job.get("attempt", 0)) + 1
            if job["attempt"] >= job["max_attempts"]:
                self.finish(job, "failed", utc_now(), error={"code": "ORPHANED", "message": "worker died while running this job", "retryable": False})
            else:
                atomic_write_json(self.d["pending"] / p.name, job)
                p.unlink(missing_ok=True)
                out.append(job["job_id"])
        return out

    def cancel(self, job_id: str) -> None:
        (self.d["cancel"] / job_id).write_text("")

    def is_cancelled(self, job_id: str) -> bool:
        return (self.d["cancel"] / job_id).exists()

    def result(self, job_id: str) -> dict | None:
        for k in ("done", "failed"):
            p = self.d[k] / f"{job_id}.json"
            if p.exists():
                return read_json(p)
        return None

    def counts(self) -> dict:
        return {k: len(list(v.glob("job_*.json"))) for k, v in self.d.items() if k != "cancel"}
