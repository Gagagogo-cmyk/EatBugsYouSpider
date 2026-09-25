import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from gnumbat_core.library import Library  # noqa: E402
from gnumbat_core.notation import BUILTIN_PROFILES  # noqa: E402
from gnumbat_core import demo  # noqa: E402


@pytest.fixture()
def lib(tmp_path):
    return Library.init(tmp_path / "lib")


def make_bake(lib, kind="rise", notation="rise", profile=None, seed=0, dur=6.0, sr=demo.SR, **kw):
    rng = np.random.RandomState(seed)
    if kind == "rise":
        x = demo.riser(dur, 100, 3000, rng, sr)
    elif kind == "fall":
        x = demo.riser(dur, 100, 3000, rng, sr, rising=False)
    elif kind == "hits":
        x = demo.hits(dur, kw.pop("bpm", 120), rng, sr)
    elif kind == "drone":
        x = demo.drone(dur, [55, 82.4, 110, 165], rng, sr)
    else:
        x = demo.metallic(dur, rng, sr)
    return lib.create_bake(audio=demo._stereo(x, rng), sample_rate=sr, raw_notation=notation,
                           profile=profile or BUILTIN_PROFILES["np_freeform"], **kw)


@pytest.fixture(scope="session")
def _processed_template(tmp_path_factory):
    """Built once: 12 READY Bakes (3 each of rise/fall/hits/drone) via the real worker + test decomposer."""
    from gnumbat_core.jobs import JobQueue
    from gnumbat_core.worker import Worker

    lib = Library.init(tmp_path_factory.mktemp("template") / "lib")
    q = JobQueue(lib)
    for i, kind in enumerate(["rise", "fall", "hits", "drone"] * 3):
        bid = make_bake(lib, kind, notation=kind, seed=i, dur=4.0)
        q.submit("process_bake", {"bake_id": bid, "decompose": "testsplit", "auto_map": False})
    Worker(lib, {}).run(once=True)
    return lib.root


@pytest.fixture()
def processed_lib(_processed_template, tmp_path):
    import shutil

    dst = tmp_path / "plib"
    shutil.copytree(_processed_template, dst)
    return Library(dst)
