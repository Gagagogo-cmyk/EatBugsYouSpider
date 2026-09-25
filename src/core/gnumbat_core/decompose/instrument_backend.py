"""``instrument``: adopt the stems the EBYS instrument's own pipeline already made.

The plugin can hand a Bake's audio to ``<EBYS>/data/sessions/<session>/raw_uploads/`` (see
``bake.json -> handoff``). ``src/demucs/watch_demucs.py`` then separates it with Demucs and leaves

    <session>/stems/htdemucs/<track>/<track>_{vocals,drums,bass,other}.wav

This backend does no separation. It reads those files (``other`` -> ``body``, as with every htdemucs
decomposition) so the Bake gets the *same* stems the instrument uses, and Demucs runs once, not twice.
Stems that are not there yet raise the retryable ``STEMS_NOT_READY``; ``Worker.scan_handoffs`` only
schedules adoption once :func:`stems_ready` is true.
"""
from __future__ import annotations

import time
from pathlib import Path

from . import DecomposeError, Decomposer

NATIVE = ("vocals", "drums", "bass", "other")   # watch_demucs.py leaves these four names on disk
SETTLE_S = 3.0                                  # a stem younger than this may still be being written


def stem_paths(handoff: dict) -> dict[str, Path]:
    d, track = Path(handoff["stems_dir"]), handoff["track"]
    return {n: d / f"{track}_{n}.wav" for n in NATIVE}


def stems_ready(handoff: dict, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    try:
        for p in stem_paths(handoff).values():
            s = p.stat()
            if s.st_size <= 44 or now - s.st_mtime < SETTLE_S:
                return False
    except (OSError, KeyError):
        return False
    return True


class InstrumentStemsDecomposer(Decomposer):
    name = "instrument"
    is_test = False

    def __init__(self, handoff: dict):
        self.handoff = handoff

    def available(self):
        if not self.handoff.get("stems_dir") or not self.handoff.get("track"):
            return False, "this Bake has no instrument hand-off (bake.json -> handoff)"
        return True, ""

    def method(self):
        return {"backend": "instrument", "model": "htdemucs", "version": "via src/demucs/watch_demucs.py", "is_test": False,
                "params": {"session": self.handoff.get("session"), "track": self.handoff.get("track")},
                "note": "Stems produced by the EBYS instrument pipeline; other -> body."}

    def default_stem_map(self):
        return {"drums": {"from": ["drums"]}, "bass": {"from": ["bass"]}, "body": {"from": ["other"]}, "vocals": {"from": ["vocals"]}}

    def separate(self, wav, workdir, progress=None, cancelled=None):
        if not stems_ready(self.handoff):
            raise DecomposeError("STEMS_NOT_READY", f"the instrument pipeline has not finished separating "
                                 f"{self.handoff.get('track')!r} yet (looked in {self.handoff.get('stems_dir')})", retryable=True)
        if progress:
            progress(1.0, "instrument stems")
        return stem_paths(self.handoff)
