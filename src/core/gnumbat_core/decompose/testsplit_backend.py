"""``testsplit``: a *test/CI stand-in*, NOT Demucs.

Complementary four-band FFT split (bass < 200 Hz, body 200–2000, vocals 2000–6000, drums
> 6000). The stems sum back to the input exactly, which makes the pipeline testable end to
end without ML dependencies. Its decomposition record says ``is_test: true``; never train on it.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import wavio
from . import Decomposer

EDGES = (200.0, 2000.0, 6000.0)


class TestSplitDecomposer(Decomposer):
    __test__ = False  # not a pytest class
    name = "testsplit"
    is_test = True

    def method(self):
        return {"backend": "testsplit", "model": "fft-4band", "version": "1", "is_test": True,
                "note": "Test stand-in (band split). Not Demucs. Do not train on it.", "params": {"edges_hz": list(EDGES)}}

    def default_stem_map(self):
        return {"bass": {"from": ["bass"]}, "body": {"from": ["body"]}, "vocals": {"from": ["vocals"]}, "drums": {"from": ["drums"]}}

    def separate(self, wav: Path, workdir: Path, progress=None, cancelled=None):
        x, sr = wavio.read_wav(wav)
        n = x.shape[0]
        X = np.fft.rfft(x.astype(np.float64), axis=0)
        f = np.fft.rfftfreq(n, 1.0 / sr)
        masks = {"bass": f < EDGES[0], "body": (f >= EDGES[0]) & (f < EDGES[1]),
                 "vocals": (f >= EDGES[1]) & (f < EDGES[2]), "drums": f >= EDGES[2]}
        out = {}
        for name, m in masks.items():
            y = np.fft.irfft(X * m[:, None], n=n, axis=0).astype(np.float32)
            p = workdir / f"{name}.wav"
            wavio.write_wav(p, y, sr, "float32")
            out[name] = p
        if progress:
            progress(1.0, "testsplit")
        return out
