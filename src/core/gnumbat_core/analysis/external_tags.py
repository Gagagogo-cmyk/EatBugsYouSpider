"""External CLI-tool tagging: madmom downbeat/meter/tempo (+ opportunistic key) and Essentia
genre classification.

These wrap the standalone scripts the instrument side already uses (``../../demucs/madmom_tagger.py``,
``../../demucs/genre_tagger.py``) rather than reimplementing them -- "the existing pipeline". Neither
tool's Python is compatible with gnumbat_core's own interpreter, or with Demucs's (see
``decompose/demucs_backend.py``'s docstring: madmom/essentia want Python 3.10-3.11, Demucs's env
here is 3.14), so each runs as its own subprocess against a *configurable* interpreter --
optional, exactly like ``pd-flucoma``: if no interpreter is configured or the import fails,
tagging is silently skipped and ``Worker.capabilities()`` simply won't list it.

Configuration (``settings.json``, same shape as ``decomposer``/``pd``):
    {"madmom":   {"python": "/path/to/py3.11", "script": "...", "timeout_s": 300},
     "essentia": {"python": "/path/to/py3.11", "models": "...", "top": 5, "timeout_s": 300}}
or the environment variables GNUMBAT_MADMOM_PYTHON / GNUMBAT_MADMOM_SCRIPT /
GNUMBAT_ESSENTIA_PYTHON / GNUMBAT_ESSENTIA_SCRIPT / GNUMBAT_ESSENTIA_MODELS.

IMPORTANT: neither tagger ever decides a Bake's *authoritative* tempo/key/genre. They only ever
populate ``analysis.json``'s ``tags`` (raw) and ``suggestions`` (used for ``card.tempo_estimate`` /
``card.key_estimate`` / ``card.genre_suggestion``) -- never ``semantic.json``'s ``fields``. Genre in
particular is a pure suggestion forever: the registry has no ``genre`` feature and nothing in this
module writes one; if a ``genre`` field is ever added to a notation profile, it stays 100% user-set.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path


def _repo_src_dir() -> Path:
    # .../src/core/gnumbat_core/analysis/external_tags.py -> parents[3] == .../src
    return Path(__file__).resolve().parents[3]


class ExternalToolError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.retryable = code, retryable


class _ScriptTagger:
    """Shared plumbing: run one of src/demucs/*.py as a subprocess against a scratch --out file,
    streaming its stderr for coarse (marker-based, not percentage) progress -- these scripts were
    written as one-shot CLI tools with no progress protocol of their own."""

    script_name = ""
    env_python = ""
    env_script = ""
    settings_key = ""

    def __init__(self, config: dict | None = None):
        cfg = config or {}
        self.python = cfg.get("python") or os.environ.get(self.env_python)
        self.script = Path(cfg.get("script") or os.environ.get(self.env_script) or (_repo_src_dir() / "demucs" / self.script_name))
        self.timeout_s = float(cfg.get("timeout_s", 300))
        self._checked: tuple[bool, str] | None = None

    def available(self) -> tuple[bool, str]:
        if self._checked is None:
            self._checked = self._check()
        return self._checked

    def _check(self) -> tuple[bool, str]:
        if not self.python:
            return False, f"no {self.settings_key}.python configured (settings.json, or {self.env_python})"
        if not self.script.exists():
            return False, f"script not found: {self.script} (set {self.settings_key}.script or {self.env_script})"
        return self._probe()

    def _probe(self) -> tuple[bool, str]:
        raise NotImplementedError

    def _import_probe(self, module: str) -> tuple[bool, str]:
        try:
            r = subprocess.run([str(self.python), "-c", f"import {module}; print(getattr({module},'__version__','?'))"],
                               capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"cannot run {self.python}: {e}"
        if r.returncode != 0:
            return False, (f"`import {module}` failed in {self.python} "
                           f"(set {self.settings_key}.python in settings or {self.env_python})")
        return True, ""

    def _run_script(self, args: list[str], progress=None, cancelled=None, phase_markers: tuple = ()) -> None:
        cmd = [str(self.python), str(self.script), *args]
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, env=env)
        except OSError as e:
            raise ExternalToolError("TOOL_NOT_FOUND", f"cannot run {self.python} {self.script}: {e}", retryable=True)
        tail: list[str] = []
        frac = [0.0]

        def pump():
            try:
                for line in proc.stderr:  # type: ignore[union-attr]
                    tail.append(line)
                    del tail[:-40]
                    for marker, bump in phase_markers:
                        if marker in line and bump > frac[0]:
                            frac[0] = bump
                            if progress:
                                progress(bump, self.settings_key)
            except (ValueError, OSError):
                pass  # pipe closed under us at process exit -- nothing left to read

        t = threading.Thread(target=pump, daemon=True)
        t.start()
        if progress:
            progress(0.0, self.settings_key)
        t_end = time.time() + self.timeout_s
        while proc.poll() is None:
            if cancelled and cancelled():
                proc.kill(); proc.wait()
                raise ExternalToolError("CANCELLED", "cancelled", retryable=True)
            if time.time() > t_end:
                proc.kill(); proc.wait()
                raise ExternalToolError("TOOL_TIMEOUT", f"{self.settings_key} exceeded {self.timeout_s}s", retryable=True)
            time.sleep(0.1)
        t.join(timeout=2)
        if proc.returncode != 0:
            raise ExternalToolError("TOOL_FAILED", f"{self.script.name} exited {proc.returncode}: {''.join(tail[-8:])[-800:]}")
        if progress:
            progress(1.0, self.settings_key)


class MadmomTagger(_ScriptTagger):
    """Downbeat/meter/BPM via madmom's DBN downbeat tracker, plus an opportunistic essentia key
    (madmom_tagger.py tries it itself and quietly skips if essentia isn't importable there)."""

    script_name = "madmom_tagger.py"
    env_python = "GNUMBAT_MADMOM_PYTHON"
    env_script = "GNUMBAT_MADMOM_SCRIPT"
    settings_key = "madmom"

    def _probe(self) -> tuple[bool, str]:
        return self._import_probe("madmom")

    def run(self, mix_wav: Path, workdir: Path, progress=None, cancelled=None) -> dict | None:
        scratch = Path(tempfile.mkdtemp(prefix="gnumbat_madmom_", dir=str(workdir)))
        try:
            out = scratch / "downbeats.json"
            self._run_script([str(mix_wav), "--out", str(out)], progress=progress, cancelled=cancelled,
                             phase_markers=(("RNNDownBeatProcessor", 0.3), ("KeyExtractor", 0.8)))
            data = json.loads(out.read_text())
            info = next(iter(data.values()), None)
            if not info:
                return None
            key = info.get("key")
            return {"meter": info.get("meter"), "bpm": info.get("bpm"), "confidence": info.get("confidence"),
                    "beat_count": info.get("beat_count"),
                    # a Bake's downbeat grid is a tag (a handful of numbers), not a per-frame
                    # registry series -- trimmed so analysis.json doesn't carry an unbounded array
                    "downbeats_ms": (info.get("downbeats_ms") or [])[:64],
                    "key": key if key not in (None, "?") else None}
        finally:
            shutil.rmtree(scratch, ignore_errors=True)


class EssentiaGenreTagger(_ScriptTagger):
    """Genre classification via Essentia + Discogs-EffNet. Suggestion only -- see module docstring."""

    script_name = "genre_tagger.py"
    env_python = "GNUMBAT_ESSENTIA_PYTHON"
    env_script = "GNUMBAT_ESSENTIA_SCRIPT"
    settings_key = "essentia"

    def __init__(self, config: dict | None = None):
        super().__init__(config)
        cfg = config or {}
        self.models = Path(cfg.get("models") or os.environ.get("GNUMBAT_ESSENTIA_MODELS") or (self.script.parent / "essentia_models"))
        self.top = int(cfg.get("top", 5))

    def _probe(self) -> tuple[bool, str]:
        ok, why = self._import_probe("essentia")
        if not ok:
            return ok, why
        pb_embed = self.models / "discogs-effnet-bs64-1.pb"
        pb_genre = self.models / "genre_discogs400-discogs-effnet-1.pb"
        if not (pb_embed.exists() and pb_genre.exists()):
            return False, f"genre model files not found in {self.models} (see extract_labels.py)"
        return True, ""

    def run(self, mix_wav: Path, workdir: Path, progress=None, cancelled=None) -> dict | None:
        scratch = Path(tempfile.mkdtemp(prefix="gnumbat_essentia_", dir=str(workdir)))
        try:
            out = scratch / "genres.json"
            self._run_script([str(mix_wav), "--out", str(out), "--models", str(self.models), "--top", str(self.top)],
                             progress=progress, cancelled=cancelled,
                             phase_markers=(("Loading models", 0.2), ("→", 0.6)))  # "→" == the script's own "→ trackname" line
            data = json.loads(out.read_text())
            info = next(iter(data.values()), None)
            genres = (info or {}).get("genres") or []
            return {"genres": genres} if genres else None
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
