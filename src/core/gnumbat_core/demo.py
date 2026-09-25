"""Synthetic *test fixtures*: deterministic little signals (risers, falls, drones, hit patterns,
metallic clouds) used to populate a demo/test library. They exist only to exercise the pipeline
and screenshots — they are not Gnumbat output and Gnumbat itself never synthesises sound."""
from __future__ import annotations

import numpy as np

from .library import Library
from .notation import BUILTIN_PROFILES

SR = 22050


def _t(dur, sr=SR):
    return np.arange(int(dur * sr)) / float(sr)


def riser(dur, f0, f1, rng, sr=SR, rising=True):
    t = _t(dur, sr)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / sr
    tone = sum(np.sin(ph * k + rng.uniform(0, 6.28)) / k for k in (1, 2, 3))
    noise = rng.randn(t.size) * (t / dur) ** 2
    env = (t / dur) ** 1.5
    x = (tone * 0.3 + noise * 0.15) * env
    return x if rising else x[::-1]


def drone(dur, freqs, rng, sr=SR):
    t = _t(dur, sr)
    x = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * (1 + 0.3 * np.sin(2 * np.pi * rng.uniform(0.1, 0.5) * t)) for f in freqs)
    return 0.25 * x / len(freqs)


def hits(dur, bpm, rng, sr=SR, density=1.0):
    n = int(dur * sr)
    x = np.zeros(n)
    step = 60.0 / bpm / 2 / density
    for k in range(int(dur / step)):
        i = int(k * step * sr)
        L = min(int(0.12 * sr), n - i)
        if L <= 0:
            break
        tt = np.arange(L) / sr
        if k % 4 == 0:
            body = np.sin(2 * np.pi * (50 + 90 * np.exp(-tt * 40)) * tt) * np.exp(-tt * 18)
        else:
            body = rng.randn(L) * np.exp(-tt * 55) * 0.5
        x[i:i + L] += body
    return 0.6 * x


def metallic(dur, rng, sr=SR, growth=True):
    n = int(dur * sr)
    x = np.zeros(n)
    base = rng.uniform(300, 700)
    partials = base * np.array([1, 2.76, 5.4, 8.93, 11.34])
    k = 0
    t_now = 0.0
    while t_now < dur - 0.05:
        i = int(t_now * sr)
        L = min(int(0.25 * sr), n - i)
        tt = np.arange(L) / sr
        x[i:i + L] += sum(np.sin(2 * np.pi * p * tt) for p in partials) * np.exp(-tt * 25) * 0.08
        gap = 0.5 * (1 - 0.85 * t_now / dur) if growth else 0.3
        t_now += max(gap, 0.04)
        k += 1
    return x


def _stereo(x, rng):
    pan = rng.uniform(-0.4, 0.4)
    return np.stack([x * (1 - max(pan, 0)), x * (1 + min(pan, 0))], axis=1).astype(np.float32)


CATEGORIES = [
    ("rise", "dash"), ("fall", "dash"), ("drone", "dash"), ("hits", "dash"), ("metal", "free"),
]


def generate_demo(lib: Library, n: int = 40, seed: int = 0, sr: int = SR, submit: bool = False) -> list[str]:
    rng = np.random.RandomState(seed)
    out = []
    keys = ["C", "D", "E", "F", "G", "A", "B"]
    for i in range(n):
        kind, mode = CATEGORIES[i % len(CATEGORIES)]
        dur = float(rng.choice([4.0, 6.0, 8.0]))
        bpm = int(rng.choice([90, 100, 110, 120, 128, 140]))
        key = f"{rng.choice(keys)} {rng.choice(['major', 'minor'])}"
        bars = max(1, int(round(dur * bpm / 60.0 / 4)))
        if kind == "rise":
            x = riser(dur, rng.uniform(80, 200), rng.uniform(1500, 4000), rng, sr)
            notation = rng.choice([f"rise-{key}-{bpm} BPM-{bars} bars-energetic", "rise", f"rise-{key}-{bpm} BPM-{bars} bars"])
            groups = ["risers"]
        elif kind == "fall":
            x = riser(dur, rng.uniform(80, 200), rng.uniform(1500, 4000), rng, sr, rising=False)
            notation = f"fall-{key}-{bpm} BPM-{bars} bars-darkening"
            groups = ["falls"]
        elif kind == "drone":
            f0 = float(rng.choice([55, 65.4, 82.4, 98]))
            x = drone(dur, [f0, f0 * 1.5, f0 * 2.01, f0 * 3], rng, sr)
            notation = rng.choice([f"drone-{key}-pad", "sustained low drone", f"drone-{key}"])
            groups = ["beds"]
        elif kind == "hits":
            x = hits(dur, bpm, rng, sr, density=float(rng.choice([1.0, 2.0])))
            notation = f"drums-{bpm} BPM-{bars} bars-punchy"
            groups = ["rhythm"]
        else:
            x = metallic(dur, rng, sr)
            notation = "metallic-density-increase"
            groups = ["events"]
        prof = BUILTIN_PROFILES["np_musical_dash"] if (mode == "dash" and "-" in str(notation) and kind != "metal") else BUILTIN_PROFILES["np_freeform"]
        cap = {"host": {"name": "Demo fixture"}, "session": "demo", "tempo_bpm": float(bpm), "time_signature": [4, 4],
               "coverage": 1.0, "complete": True, "offline": True}
        bid = lib.create_bake(audio=_stereo(x, rng), sample_rate=sr, raw_notation=str(notation), profile=prof,
                              capture=cap, groups=groups, submit=submit)
        out.append(bid)
    return out
