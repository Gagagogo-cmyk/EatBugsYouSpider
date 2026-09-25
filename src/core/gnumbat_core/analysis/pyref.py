"""``python-ref`` extractor: a numpy-only *reference* implementation of the analysis contract.

Purpose: (1) keep everything downstream (embeddings, maps, datasets, UI) testable and usable
without Pd/FluCoMa installed; (2) document what each feature id means. It is NOT numerically
identical to FluCoMa (different windowing/definitions — see registry ``provided_by``), and
analyses from the two extractors are never mixed in one DatasetVersion.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .. import wavio
from .summarize import estimate_key

EXTRACTOR_NAME = "python-ref"
EXTRACTOR_VERSION = "0.1.0"
DEFAULT_CONFIG = {
    "frame_size": 2048, "hop_size": 512, "n_mels": 40, "n_mfcc": 13, "fmin": 30.0, "fmax": 8000.0,
    "rolloff_pct": 0.95, "pitch_fmin": 60.0, "pitch_fmax": 1000.0, "pitch_conf_min": 0.4,
    "onset_min_gap_s": 0.06, "onset_sensitivity": 1.0, "batch_frames": 1024,
}


@dataclass
class SourceResult:
    name: str
    sample_rate: int
    duration_s: float
    hop_s: float
    series: dict[str, np.ndarray]
    onsets_s: list[float]
    scalars: dict[str, float] = field(default_factory=dict)
    masks: dict[str, np.ndarray] = field(default_factory=dict)


def _mel_matrix(sr, n_fft, n_mels, fmin, fmax):
    fmax = min(fmax, sr / 2.0)
    mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)
    imel = lambda m: 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    pts = imel(np.linspace(mel(fmin), mel(fmax), n_mels + 2))
    freqs = np.linspace(0, sr / 2.0, n_fft // 2 + 1)
    fb = np.zeros((n_mels, freqs.size))
    for i in range(n_mels):
        lo, ce, hi = pts[i], pts[i + 1], pts[i + 2]
        up = (freqs - lo) / max(ce - lo, 1e-9)
        dn = (hi - freqs) / max(hi - ce, 1e-9)
        fb[i] = np.maximum(0.0, np.minimum(up, dn))
    return fb


def _dct_matrix(n_in, n_out):
    k = np.arange(n_out)[:, None]
    n = np.arange(n_in)[None, :]
    m = np.cos(math.pi / n_in * (n + 0.5) * k) * math.sqrt(2.0 / n_in)
    m[0] *= 1.0 / math.sqrt(2.0)
    return m


def _pick_onsets(env: np.ndarray, hop_s: float, min_gap_s: float, sens: float) -> list[float]:
    if env.size < 3 or env.max() <= 1e-9:
        return []
    e = np.convolve(env, np.ones(3) / 3.0, mode="same")
    med = np.median(e)
    mad = np.median(np.abs(e - med)) + 1e-12
    thr = max(med + sens * 3.0 * mad, 0.12 * e.max())
    gap = max(1, int(round(min_gap_s / hop_s)))
    peaks = []
    for i in range(1, e.size - 1):
        if e[i] > thr and e[i] >= e[i - 1] and e[i] > e[i + 1]:
            lo, hi = max(0, i - gap), min(e.size, i + gap + 1)
            if e[i] >= e[lo:hi].max():
                if not peaks or (i - peaks[-1]) >= gap:
                    peaks.append(i)
    return [round(i * hop_s, 6) for i in peaks]


def _tempo(env: np.ndarray, hop_s: float, min_strength: float = 0.25):
    """Onset-envelope autocorrelation tempo, with slow trends removed and a log-Gaussian prior
    around 120 BPM to resolve octave ambiguity. Returns (None, None) when there is no clear pulse."""
    if env.size < int(2.0 / hop_s) or env.max() <= 1e-9:
        return None, None
    w = max(3, int(0.5 / hop_s))
    trend = np.convolve(env, np.ones(w) / w, mode="same")
    x = np.maximum(env - trend, 0.0)
    x = x - x.mean()
    if np.abs(x).max() <= 1e-9:
        return None, None
    ac = np.correlate(x, x, mode="full")[x.size - 1:]
    ac = ac / (ac[0] + 1e-12)
    lo, hi = max(2, int(60.0 / 200.0 / hop_s)), min(int(60.0 / 55.0 / hop_s), ac.size - 2)
    best, best_score = None, 0.0
    for lag in range(lo, hi):
        if ac[lag] > ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0:
            bpm = 60.0 / (lag * hop_s)
            score = ac[lag] * float(np.exp(-0.5 * (np.log2(bpm / 120.0)) ** 2))
            if score > best_score:
                best, best_score = lag, score
    if best is None or ac[best] < min_strength:
        return None, None
    return round(60.0 / (best * hop_s), 3), round(float(ac[best]), 6)


class PyRefExtractor:
    name = EXTRACTOR_NAME
    version = EXTRACTOR_VERSION
    is_reference = True

    def __init__(self, config: dict | None = None):
        self.config = {**DEFAULT_CONFIG, **(config or {})}

    def extract_sources(self, sources: dict[str, Path], workdir: Path | None = None, progress=None,
                        cancelled=None) -> dict[str, SourceResult]:
        out = {}
        for i, (name, path) in enumerate(sources.items()):
            if cancelled and cancelled():
                raise RuntimeError("cancelled")
            out[name] = self.extract_one(name, path)
            if progress:
                progress((i + 1) / len(sources), f"analysed {name}")
        return out

    # ------------------------------------------------------------------
    def extract_one(self, name: str, path: Path) -> SourceResult:
        c = self.config
        x2, sr = wavio.read_wav(path)
        n_total = x2.shape[0]
        mono = wavio.to_mono(x2).astype(np.float64)
        N, H = int(c["frame_size"]), int(c["hop_size"])
        hop_s = H / float(sr)
        n_frames = max(1, int(math.ceil(max(n_total - N, 0) / H)) + 1)
        padded = np.zeros(N + (n_frames - 1) * H)
        padded[:n_total] = mono[: padded.size]
        win = np.hanning(N)
        freqs = np.fft.rfftfreq(N, 1.0 / sr)
        mel_fb = _mel_matrix(sr, N, c["n_mels"], c["fmin"], c["fmax"])
        dct = _dct_matrix(c["n_mels"], c["n_mfcc"])
        # chroma bin -> pitch class (C=0), 55 Hz..5 kHz
        valid = (freqs >= 55.0) & (freqs <= 5000.0)
        pc = np.zeros(freqs.size, dtype=int)
        pc[valid] = np.round(12.0 * np.log2(freqs[valid] / 440.0) + 69.0).astype(int) % 12
        lag_lo, lag_hi = int(sr / c["pitch_fmax"]), min(int(sr / c["pitch_fmin"]), N // 2)

        keys = ["loudness.rms_db", "spectral.centroid", "spectral.spread", "spectral.skewness", "spectral.kurtosis",
                "spectral.rolloff", "spectral.flatness", "spectral.crest", "spectral.flux", "temporal.zcr",
                "pitch.f0_hz", "pitch.confidence"]
        cols = {k: np.zeros(n_frames) for k in keys}
        chroma = np.zeros((n_frames, 12))
        mfcc = np.zeros((n_frames, c["n_mfcc"]))
        prev_mag = None
        B = int(c["batch_frames"])
        for b0 in range(0, n_frames, B):
            b1 = min(n_frames, b0 + B)
            idx = (np.arange(b0, b1)[:, None] * H) + np.arange(N)[None, :]
            frames = padded[idx]
            rms = np.sqrt(np.mean(frames ** 2, axis=1))
            cols["loudness.rms_db"][b0:b1] = 20.0 * np.log10(np.maximum(rms, 1e-6))
            cols["temporal.zcr"][b0:b1] = np.mean(np.abs(np.diff(np.signbit(frames).astype(np.int8), axis=1)), axis=1)
            spec = np.fft.rfft(frames * win, axis=1)
            mag = np.abs(spec)
            pw = mag ** 2
            tot = mag.sum(axis=1, keepdims=True)
            p = mag / np.maximum(tot, 1e-12)
            cen = p @ freqs
            var = p @ (freqs ** 2) - cen ** 2
            spr = np.sqrt(np.maximum(var, 0.0))
            z = (freqs[None, :] - cen[:, None]) / np.maximum(spr[:, None], 1e-9)
            cols["spectral.centroid"][b0:b1] = cen
            cols["spectral.spread"][b0:b1] = spr
            cols["spectral.skewness"][b0:b1] = np.sum(p * z ** 3, axis=1)
            cols["spectral.kurtosis"][b0:b1] = np.sum(p * z ** 4, axis=1)
            cum = np.cumsum(p, axis=1)
            cols["spectral.rolloff"][b0:b1] = freqs[np.minimum((cum < c["rolloff_pct"]).sum(axis=1), freqs.size - 1)]
            cols["spectral.flatness"][b0:b1] = np.exp(np.mean(np.log(pw + 1e-12), axis=1)) / (np.mean(pw, axis=1) + 1e-12)
            cols["spectral.crest"][b0:b1] = mag.max(axis=1) / (mag.mean(axis=1) + 1e-12)
            pm = np.vstack([prev_mag[None, :], mag[:-1]]) if prev_mag is not None else np.vstack([mag[:1], mag[:-1]])
            cols["spectral.flux"][b0:b1] = np.sqrt(np.sum(np.maximum(mag - pm, 0.0) ** 2, axis=1))
            prev_mag = mag[-1]
            cw = np.zeros((b1 - b0, 12))
            for k in range(12):
                cw[:, k] = pw[:, valid & (pc == k)].sum(axis=1)
            chroma[b0:b1] = cw / np.maximum(cw.sum(axis=1, keepdims=True), 1e-12)
            mel = np.log(pw @ mel_fb.T + 1e-10)
            mfcc[b0:b1] = mel @ dct.T
            ac = np.fft.irfft(pw, n=N, axis=1)
            r0 = ac[:, 0] + 1e-12
            seg = ac[:, lag_lo:lag_hi]
            if seg.shape[1] > 0:
                li = np.argmax(seg, axis=1)
                conf = seg[np.arange(seg.shape[0]), li] / r0
                cols["pitch.confidence"][b0:b1] = np.clip(conf, -1, 1)
                cols["pitch.f0_hz"][b0:b1] = sr / (lag_lo + li)
        voiced = (cols["pitch.confidence"] >= c["pitch_conf_min"]) & (cols["loudness.rms_db"] > -60.0)
        cols["pitch.f0_hz"] = np.where(voiced, cols["pitch.f0_hz"], 0.0)

        series = {k: cols[k] for k in keys}
        series["harmony.chroma"] = chroma
        series["timbre.mfcc"] = mfcc
        masks = {"pitch.f0_hz": voiced, "pitch.confidence": voiced}
        duration_s = n_total / float(sr)
        onsets = _pick_onsets(cols["spectral.flux"], hop_s, c["onset_min_gap_s"], c["onset_sensitivity"])
        bpm, strength = _tempo(cols["spectral.flux"], hop_s) if len(onsets) >= 4 else (None, None)  # a pulse needs events
        ioi = np.diff([0.0] + onsets) if len(onsets) >= 2 else np.array([])
        scalars = {"rhythm.onset_rate": round(len(onsets) / max(duration_s, 1e-9), 6),
                   "rhythm.ioi_mean": round(float(ioi.mean()), 6) if ioi.size else 0.0,
                   "rhythm.ioi_std": round(float(ioi.std()), 6) if ioi.size else 0.0}
        if bpm is not None:
            scalars["rhythm.tempo_bpm"], scalars["rhythm.tempo_strength"] = bpm, strength
        if x2.shape[1] == 2:
            L, R = x2[:, 0].astype(np.float64), x2[:, 1].astype(np.float64)
            pl, pr = float(np.sum(L ** 2)), float(np.sum(R ** 2))
            scalars["stereo.pan"] = round((pr - pl) / (pr + pl + 1e-12), 6)
            m, s = (L + R) / 2.0, (L - R) / 2.0
            scalars["stereo.width"] = round(float(np.sqrt(np.sum(s ** 2) / (np.sum(m ** 2) + 1e-12))), 6)
        return SourceResult(name, int(sr), duration_s, hop_s, series, onsets, scalars, masks)
