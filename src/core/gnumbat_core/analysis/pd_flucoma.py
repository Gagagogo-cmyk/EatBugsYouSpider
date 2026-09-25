"""``pd-flucoma`` extractor: runs the existing FluCoMa analysis chain in headless Pd.

STATUS: the Python side (job files, subprocess, parsing) is implemented and tested against a
fake ``pd``. **The Pd side is unverified against real FluCoMa externals** — that is the
Phase 0a spike in docs/platform/CORE_ARCHITECTURE.md. This module defines the contract the
Pd driver patch (src/pd/gnumbat_bake_analyze.pd) must satisfy.

One-shot batch run per job (stateless, crash-isolated, no ports):

    pd -nogui -batch -noprefs -nosound -stderr [-path <flucoma>] -path <patchdir> \
       -open gnumbat_bake_analyze.pd -send "gnumbat-job run <job_dir>/job.txt"

Pd has no JSON, so the contract is plain text.

job.txt      one line per source:   stem <name> <input.wav> <out_prefix>
             (paths never contain spaces: the worker uses a scratch dir it controls)
Pd writes, per source, for out_prefix P:
  P.meta.txt              "samplerate <int>" / "hop <int>" / "window <int>" / "frames <int>"
  P.<buf>-<ch>.txt        one float per line, one file per FluCoMa output channel:
                            spectral 0..6  centroid spread skewness kurtosis rolloff flatness crest
                            loudness 0..1  loudness truepeak
                            pitch    0..1  pitch confidence
                            chroma   0..11
                            mfcc     0..12
  P.slices.txt            onset positions in SAMPLES, one per line (fluid.bufampslice indices; may be empty)
  P.done                  written last
and finally <job_dir>/job.done, then `pd quit`.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from .pyref import SourceResult

EXTRACTOR_NAME = "pd-flucoma"
CONTRACT_VERSION = "gnumbat-pd-job/1"

BUFFERS = {  # buffer -> [(feature id, channel)]
    "spectral": [("spectral.centroid", 0), ("spectral.spread", 1), ("spectral.skewness", 2), ("spectral.kurtosis", 3),
                 ("spectral.rolloff", 4), ("spectral.flatness", 5), ("spectral.crest", 6)],
    "loudness": [("loudness.db", 0), ("loudness.truepeak_db", 1)],
    "pitch": [("pitch.f0_hz", 0), ("pitch.confidence", 1)],
}
MULTI = {"chroma": ("harmony.chroma", 12), "mfcc": ("timbre.mfcc", 13)}


class PdError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.retryable = code, retryable


def _load_col(path: Path) -> np.ndarray:
    a = np.loadtxt(path, dtype=np.float64, ndmin=1)
    return a.reshape(-1)


class PdFlucomaExtractor:
    name = EXTRACTOR_NAME
    version = "0.1.0"
    is_reference = False

    def __init__(self, config: dict | None = None, settings: dict | None = None):
        pd = (settings or {}).get("pd", {})
        # machine facts (paths) are NOT part of `config`, so they don't change the analysis config hash
        self.pd_path = pd.get("path") or os.environ.get("GNUMBAT_PD") or shutil.which("pd") or "pd"
        self.patch = pd.get("patch") or os.environ.get("GNUMBAT_PD_PATCH") or str(
            Path(__file__).resolve().parents[3] / "pd" / "gnumbat_bake_analyze.pd")
        self.flucoma_path = pd.get("flucoma_path") or os.environ.get("GNUMBAT_FLUCOMA_PATH")
        self.timeout_s = float(pd.get("timeout_s", 900))
        self.config = {"contract": CONTRACT_VERSION, "hop_size": 512, "window_size": 1024, **(config or {})}

    def command(self, job_txt: Path) -> list[str]:
        cmd = [self.pd_path, "-nogui", "-batch", "-noprefs", "-nosound", "-stderr"]
        if self.flucoma_path:
            cmd += ["-path", self.flucoma_path]
        cmd += ["-path", str(Path(self.patch).parent), "-open", self.patch, "-send", f"gnumbat-job run {job_txt}"]
        return cmd

    def extract_sources(self, sources: dict[str, Path], workdir: Path | None = None, progress=None,
                        cancelled=None) -> dict[str, SourceResult]:
        base = tempfile.mkdtemp(prefix="gnumbat_pd_")
        if " " in base:
            raise PdError("PD_PATH_HAS_SPACE", f"scratch dir {base} contains a space; set TMPDIR", retryable=False)
        job = Path(base)
        try:
            (job / "in").mkdir()
            (job / "out").mkdir()
            lines = []
            for name, src in sources.items():
                dst = job / "in" / f"{name}.wav"
                try:
                    os.symlink(Path(src).resolve(), dst)
                except OSError:
                    shutil.copyfile(src, dst)
                lines.append(f"stem {name} {dst} {job / 'out' / name}")
            (job / "job.txt").write_text("\n".join(lines) + "\n")
            cmd = self.command(job / "job.txt")
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            except OSError as e:
                raise PdError("PD_NOT_FOUND", f"cannot run {self.pd_path}: {e}", retryable=True)
            t_end = time.time() + self.timeout_s
            while proc.poll() is None:
                if cancelled and cancelled():
                    proc.kill(); proc.wait()
                    raise RuntimeError("cancelled")
                if time.time() > t_end:
                    proc.kill(); proc.wait()
                    raise PdError("PD_TIMEOUT", f"pd exceeded {self.timeout_s}s")
                if progress:
                    done = sum(1 for n in sources if (job / "out" / f"{n}.done").exists())
                    progress(done / max(len(sources), 1), "pd/flucoma")
                time.sleep(0.2)
            out = proc.stdout.read() if proc.stdout else ""
            if not (job / "job.done").exists():
                raise PdError("PD_NO_RESULT", f"pd exited {proc.returncode} without job.done. Last output: {out[-800:]}")
            return {n: self._parse(n, job / "out" / n) for n in sources}
        finally:
            shutil.rmtree(base, ignore_errors=True)

    # ------------------------------------------------------------------
    def _parse(self, name: str, prefix: Path) -> SourceResult:
        P = str(prefix)
        if not Path(P + ".done").exists():
            raise PdError("PD_SOURCE_INCOMPLETE", f"no output for source {name}")
        meta = {}
        for ln in Path(P + ".meta.txt").read_text().splitlines():
            k, _, v = ln.partition(" ")
            meta[k] = float(v)
        sr, hop = int(meta["samplerate"]), int(meta["hop"])
        series: dict[str, np.ndarray] = {}
        for buf, cols in BUFFERS.items():
            for fid, ch in cols:
                series[fid] = _load_col(Path(f"{P}.{buf}-{ch}.txt"))
        for buf, (fid, n) in MULTI.items():
            series[fid] = np.stack([_load_col(Path(f"{P}.{buf}-{c}.txt")) for c in range(n)], axis=1)
        n_frames = min(a.shape[0] for a in series.values())
        series = {k: v[:n_frames] for k, v in series.items()}
        sl = Path(P + ".slices.txt")
        onsets = sorted(float(v) / sr for v in _load_col(sl)) if sl.exists() and sl.stat().st_size else []
        frames_dur = float(meta.get("frames_duration_samples", 0)) or None
        duration = (frames_dur / sr) if frames_dur else (n_frames * hop / sr)
        conf = series["pitch.confidence"]
        voiced = conf >= 0.4
        series["pitch.f0_hz"] = np.where(voiced, series["pitch.f0_hz"], 0.0)
        ioi = np.diff([0.0] + onsets) if len(onsets) >= 2 else np.array([])
        scalars = {"rhythm.onset_rate": round(len(onsets) / max(duration, 1e-9), 6),
                   "rhythm.ioi_mean": round(float(ioi.mean()), 6) if ioi.size else 0.0,
                   "rhythm.ioi_std": round(float(ioi.std()), 6) if ioi.size else 0.0}
        return SourceResult(name, sr, duration, hop / float(sr), series, onsets, scalars,
                            {"pitch.f0_hz": voiced, "pitch.confidence": voiced})
