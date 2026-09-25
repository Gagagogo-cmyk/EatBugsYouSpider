"""Turn per-frame feature series + onset times into an analysis document (shared by every extractor)."""
from __future__ import annotations

import numpy as np

from .registry import FEATURES

ENVELOPE_POINTS = 8
# Krumhansl-Schmuckler key profiles (same family the live instrument uses in slice_writer.js)
_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _r(v, nd=6):
    v = float(np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0))
    return round(v, nd)


def stats_1d(x: np.ndarray, hop_s: float, mask: np.ndarray | None = None, n_env: int = ENVELOPE_POINTS) -> dict:
    x = np.nan_to_num(np.asarray(x, dtype=np.float64))
    idx = np.arange(x.size)
    sel = idx if mask is None else idx[np.asarray(mask, dtype=bool)]
    if sel.size == 0:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0, "slope": 0.0, "envelope": [0.0] * n_env}
    v = x[sel]
    t = sel * hop_s
    slope = 0.0
    if v.size >= 2 and np.ptp(t) > 0:
        slope = float(np.polyfit(t, v, 1)[0])
    mean = float(v.mean())
    env = []
    for seg in np.array_split(np.arange(x.size), n_env):
        m = np.intersect1d(seg, sel) if mask is not None else seg
        env.append(_r(x[m].mean()) if m.size else _r(mean))
    return {"mean": _r(mean), "std": _r(v.std()), "min": _r(v.min()), "max": _r(v.max()), "slope": _r(slope), "envelope": env}


def summarize_series(series: dict[str, np.ndarray], hop_s: float, masks: dict[str, np.ndarray] | None = None) -> dict:
    out = {}
    for fid, arr in series.items():
        arr = np.asarray(arr, dtype=np.float64)
        if arr.ndim == 1:
            arr = arr[:, None]
        mask = (masks or {}).get(fid)
        out[fid] = {"unit": FEATURES.get(fid, {}).get("unit", ""),
                    "dims": [stats_1d(arr[:, d], hop_s, mask) for d in range(arr.shape[1])]}
    return out


def make_slices(series: dict[str, np.ndarray], onsets_s: list[float], hop_s: float, n_frames: int, duration_s: float,
                min_len_s: float = 0.05) -> list[dict]:
    bounds = [0.0] + [t for t in sorted(onsets_s) if 0 < t < duration_s] + [duration_s]
    merged = [bounds[0]]
    for t in bounds[1:-1]:
        if t - merged[-1] >= min_len_s:
            merged.append(t)
    merged.append(duration_s)
    if len(merged) >= 3 and merged[-1] - merged[-2] < min_len_s:
        merged.pop(-2)
    slices = []
    for i in range(len(merged) - 1):
        t0, t1 = merged[i], merged[i + 1]
        f0 = min(int(t0 / hop_s), max(n_frames - 1, 0))
        f1 = max(int(np.ceil(t1 / hop_s)), f0 + 1)
        f1 = min(f1, max(n_frames, 1))
        edge = max(1, int(round((f1 - f0) * 0.15)))
        feats, fs, fe = {}, {}, {}
        for fid, arr in series.items():
            a = np.asarray(arr, dtype=np.float64)
            if a.ndim == 1:
                a = a[:, None]
            seg = a[f0:f1] if f1 > f0 else a[f0:f0 + 1]
            if seg.size == 0:
                seg = np.zeros((1, a.shape[1]))
            m = seg.mean(axis=0)
            feats[fid] = _r(m[0]) if a.shape[1] == 1 else [_r(v) for v in m]
            if a.shape[1] == 1:
                fs[fid] = _r(seg[:edge].mean())
                fe[fid] = _r(seg[-edge:].mean())
        slices.append({"i": i, "t0": _r(t0), "t1": _r(t1), "features": feats, "features_start": fs, "features_end": fe})
    return slices


def estimate_key(chroma_mean: np.ndarray) -> str | None:
    c = np.asarray(chroma_mean, dtype=np.float64)
    if c.size != 12 or c.sum() < 1e-6 or np.std(c) < 1e-9:
        return None
    best, best_r = None, -2.0
    for k in range(12):
        for prof, mode in ((_KS_MAJOR, "major"), (_KS_MINOR, "minor")):
            r = np.corrcoef(c, np.roll(prof, k))[0, 1]
            if r > best_r:
                best, best_r = f"{_NOTES[k]} {mode}", r
    return best


def make_card(analysis: dict) -> dict:
    mix = next((s for s in analysis["sources"] if s["name"] == "mix"), analysis["sources"][0])
    sug = analysis.get("suggestions") or {}
    spark = {}
    for fid in ("loudness.db", "loudness.rms_db", "spectral.centroid"):
        if fid in mix["summary"]:
            spark[fid] = mix["summary"][fid]["dims"][0]["envelope"]
    return {"n_slices": len(mix["slices"]), "tempo_estimate": sug.get("tempo_bpm"), "key_estimate": sug.get("key"),
            "meter_estimate": sug.get("meter"), "genre_suggestion": sug.get("genre"), "genre_confidence": sug.get("genre_confidence"),
            "spark": spark, "stems": [s["name"] for s in analysis["sources"] if s["name"] != "mix"]}
