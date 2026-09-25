"""Stem decomposition backends (Demucs today; anything that yields stems tomorrow).

A backend produces *native* stems; a ``stem_map`` (stored in decomposition.json) turns them
into Gnumbat's conceptual stems, e.g. htdemucs ``other`` -> ``body``. Every decomposition a
Bake ever had is kept; ``state.json -> current`` says which one is active.
"""
from __future__ import annotations

import shutil
import time
from pathlib import Path

import numpy as np

from .. import wavio
from ..jsonio import atomic_write_json, sha256_file, utc_now
from ..schema import validate

DECOMPOSITION_SCHEMA = "gnumbat.decomposition/0.1"


class DecomposeError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.retryable = code, retryable


class Cancelled(RuntimeError):
    pass


class Decomposer:
    name = "base"
    is_test = False

    def available(self) -> tuple[bool, str]:
        return True, ""

    def method(self) -> dict:
        return {"backend": self.name, "is_test": self.is_test}

    def default_stem_map(self) -> dict:
        raise NotImplementedError

    def separate(self, wav: Path, workdir: Path, progress=None, cancelled=None) -> dict[str, Path]:
        """-> {native_stem_name: wav_path}"""
        raise NotImplementedError


def apply_stem_map(native: dict[str, Path], stem_map: dict, out_dir: Path) -> list[dict]:
    stems = []
    for name, spec in stem_map.items():
        srcs = spec["from"]
        missing = [s for s in srcs if s not in native]
        if missing:
            raise DecomposeError("STEM_MAP_MISSING", f"stem_map needs native stems {missing}; backend produced {sorted(native)}", retryable=False)
        acc, sr = None, None
        for s in srcs:
            x, r = wavio.read_wav(native[s])
            if acc is None:
                acc, sr = x.astype(np.float32), r
            else:
                n = min(acc.shape[0], x.shape[0])
                acc = acc[:n] + x[:n]
        f = out_dir / f"{name}.wav"
        wavio.write_wav(f, acc, sr, "float32")
        stems.append({"name": name, "file": f.name, "sha256": sha256_file(f), "sample_rate": int(sr),
                      "channels": int(acc.shape[1]), "frames": int(acc.shape[0])})
    return stems


def run_decomposition(lib, bake_id: str, decomposer: Decomposer, stem_map: dict | None = None,
                      progress=None, cancelled=None) -> dict:
    """Separate the Bake's original.wav; commit decompositions/<dc_id>/ atomically; return its doc."""
    ok, why = decomposer.available()
    if not ok:
        raise DecomposeError("BACKEND_UNAVAILABLE", why, retryable=True)
    t0 = time.time()
    dc_id, part = lib.new_derived_dir(bake_id, "decompositions")
    work = lib.tmp_dir / f"dec_{dc_id}"
    try:
        work.mkdir(parents=True, exist_ok=True)
        src = lib.audio_path(bake_id)
        native = decomposer.separate(src, work, progress=progress, cancelled=cancelled)
        smap = stem_map or decomposer.default_stem_map()
        stems = apply_stem_map(native, smap, part)
        doc = {
            "schema": DECOMPOSITION_SCHEMA, "decomposition_id": dc_id, "bake_id": bake_id, "created_at": utc_now(),
            "method": decomposer.method(),
            "stem_map": {k: {"from": v["from"], "op": v.get("op", "sum" if len(v["from"]) > 1 else "copy")} for k, v in smap.items()},
            "stems": stems, "source_sha256": lib.read_bake(bake_id)["audio"]["sha256"],
            "timing": {"seconds": round(time.time() - t0, 3)},
        }
        validate("decomposition", doc)
        atomic_write_json(part / "decomposition.json", doc)
        lib.commit_derived_dir(bake_id, "decompositions", dc_id, part)
        return doc
    except BaseException:
        shutil.rmtree(part, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def get_decomposer(name: str, settings: dict | None = None, handoff: dict | None = None) -> Decomposer:
    cfg = (settings or {}).get("decomposer", {})
    if not isinstance(cfg, dict):
        cfg = {}
    if name == "demucs":
        from .demucs_backend import DemucsDecomposer

        return DemucsDecomposer(python=cfg.get("python"), model=cfg.get("model", "htdemucs"),
                                device=cfg.get("device"), extra_args=cfg.get("extra_args", []))
    if name == "instrument":
        from .instrument_backend import InstrumentStemsDecomposer

        if not handoff:
            raise DecomposeError("NO_HANDOFF", "decomposer 'instrument' needs a Bake that was handed to the instrument's raw_uploads/ "
                                 "(bake.json -> handoff). Bake it with the EBYS folder linked in the plugin.", retryable=False)
        return InstrumentStemsDecomposer(handoff)
    if name == "testsplit":
        from .testsplit_backend import TestSplitDecomposer

        return TestSplitDecomposer()
    raise DecomposeError("UNKNOWN_BACKEND", f"unknown decomposer {name!r}", retryable=False)
