"""Demucs as a *subprocess*, exactly the way src/demucs/watch_demucs.py runs it.

Why a subprocess: Demucs's Python (torch, 3.14 in this repo's demucs_env) is
version-incompatible with the analysis Python (essentia/madmom, 3.10–3.11); it needs GPU/MPS
memory that shouldn't live in the worker; and a crash must not take the worker down.

Not run in this repo's CI (Demucs isn't installable there) — tests use a fake ``python``
that mimics its CLI, progress output and file layout.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import Cancelled, DecomposeError, Decomposer

# htdemucs -> Gnumbat conceptual stems. `other` is named `body` here (the instrument's legacy name is `melody`).
STEM_MAP_HTDEMUCS = {"drums": {"from": ["drums"]}, "bass": {"from": ["bass"]}, "body": {"from": ["other"]}, "vocals": {"from": ["vocals"]}}
STEM_MAP_HTDEMUCS_6S = {"drums": {"from": ["drums"]}, "bass": {"from": ["bass"]},
                        "body": {"from": ["other", "guitar", "piano"], "op": "sum"}, "vocals": {"from": ["vocals"]}}
_PCT = re.compile(r"(\d{1,3})%\|")


class DemucsDecomposer(Decomposer):
    name = "demucs"

    def __init__(self, python: str | None = None, model: str = "htdemucs", device: str | None = None,
                 extra_args: list[str] | None = None, timeout_s: float = 3600.0):
        self.python = python or os.environ.get("GNUMBAT_DEMUCS_PYTHON") or sys.executable
        self.model, self.device, self.extra_args, self.timeout_s = model, device, list(extra_args or []), timeout_s
        self._version: str | None = None

    def available(self):
        try:
            r = subprocess.run([self.python, "-c", "import demucs; print(getattr(demucs,'__version__','unknown'))"],
                               capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"cannot run {self.python}: {e}"
        if r.returncode != 0:
            return False, f"`import demucs` failed in {self.python} (set decomposer.python in settings or GNUMBAT_DEMUCS_PYTHON)"
        self._version = r.stdout.strip()
        return True, ""

    def method(self):
        return {"backend": "demucs", "model": self.model, "version": self._version or "unknown", "is_test": False,
                "params": {"device": self.device, "float32": True, "extra_args": self.extra_args}}

    def default_stem_map(self):
        return STEM_MAP_HTDEMUCS_6S if self.model.endswith("_6s") else STEM_MAP_HTDEMUCS

    def separate(self, wav: Path, workdir: Path, progress=None, cancelled=None):
        out = workdir / "out"
        cmd = [self.python, "-m", "demucs", "-n", self.model, "--float32", "-o", str(out)]
        if self.device:
            cmd += ["-d", self.device]
        cmd += self.extra_args + [str(wav)]
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
        tail: list[bytes] = []

        def pump():  # tqdm redraws with \r, so split on both
            buf = b""
            while True:
                ch = proc.stderr.read(1)
                if not ch:
                    break
                if ch in (b"\r", b"\n"):
                    if buf:
                        tail.append(buf)
                        del tail[:-30]
                        m = _PCT.search(buf.decode("utf-8", "replace"))
                        if m and progress:
                            progress(min(int(m.group(1)), 100) / 100.0, "demucs")
                    buf = b""
                else:
                    buf += ch

        t = threading.Thread(target=pump, daemon=True)
        t.start()
        t_end = time.time() + self.timeout_s
        while proc.poll() is None:
            if cancelled and cancelled():
                proc.kill()
                proc.wait()
                raise Cancelled("cancelled")
            if time.time() > t_end:
                proc.kill()
                proc.wait()
                raise DecomposeError("DEMUCS_TIMEOUT", f"demucs exceeded {self.timeout_s}s", retryable=True)
            time.sleep(0.1)
        t.join(timeout=2)
        if proc.returncode != 0:
            msg = b"\n".join(tail[-8:]).decode("utf-8", "replace")
            raise DecomposeError("DEMUCS_FAILED", f"demucs exited {proc.returncode}: {msg}", retryable=True)
        folder = out / self.model / wav.stem
        stems = {p.stem: p for p in folder.glob("*.wav")} if folder.is_dir() else {}
        if not stems:
            raise DecomposeError("DEMUCS_NO_OUTPUT", f"no stems found in {folder}", retryable=True)
        if progress:
            progress(1.0, "demucs done")
        return stems
