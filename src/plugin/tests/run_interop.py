#!/usr/bin/env python3
"""C++ <-> Python interop test.

    1. the C++ side creates a library (Bakes, notation, queued jobs) — once through the core API and once through
       the plugin's capture path (processor -> ring -> prepareCapture -> createBake)
    2. the Python reference worker processes it (stems with the test backend, analysis, map)
    3. `gnumbat validate` checks every file against the JSON Schemas
    4. the C++ side reads everything back (state READY, stems, analysis, map, raw notation byte-for-byte)

    run_interop.py --core-tests <exe> --plugin-tests <exe> [--python python3]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORE_PKG = HERE.parent.parent / "core"


def run(cmd, **kw):
    print("  $", " ".join(map(str, cmd)))
    r = subprocess.run(list(map(str, cmd)), text=True, capture_output=True, **kw)
    if r.stdout.strip():
        print("    " + r.stdout.strip().replace("\n", "\n    "))
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        sys.exit(f"FAILED (exit {r.returncode}): {' '.join(map(str, cmd))}")
    return r


def fake_watch_demucs(ebys: Path) -> int:
    """Play the instrument's watcher: for each file in raw_uploads/ leave what src/demucs/watch_demucs.py leaves,
    <session>/stems/htdemucs/<track>/<track>_{vocals,drums,bass,other}.wav (here from a band split, NOT Demucs)."""
    sys.path.insert(0, str(CORE_PKG))
    from gnumbat_core import wavio
    from gnumbat_core.decompose.testsplit_backend import TestSplitDecomposer

    n = 0
    for wav in sorted((ebys / "data" / "sessions").glob("*/raw_uploads/*.wav")):
        session = wav.parent.parent
        track = wav.stem
        out = session / "stems" / "htdemucs" / track
        out.mkdir(parents=True, exist_ok=True)
        work = session / "temp" / track
        work.mkdir(parents=True, exist_ok=True)
        native = TestSplitDecomposer().separate(wav, work)            # also proves Python can read the plugin's WAV
        for src, dst in (("vocals", "vocals"), ("drums", "drums"), ("bass", "bass"), ("body", "other")):
            x, sr = wavio.read_wav(native[src])
            f = out / f"{track}_{dst}.wav"
            wavio.write_wav(f, x, sr, "float32")
            os.utime(f, (time.time() - 60, time.time() - 60))
        n += 1
    return n


def handoff_stage(a, env, tmp):
    print("\n== EBYS hand-off (plugin -> raw_uploads -> simulated watcher -> worker adopts stems)")
    lib, ebys = tmp / "lib_handoff", tmp / "EBYS"
    run([a.core_tests, "--interop-handoff-write", lib, ebys], env=env)
    py = [a.python, "-m", "gnumbat_core", "-l", lib]
    run(py + ["worker", "--once"], env=env, cwd=CORE_PKG)                     # analyses the mix; stems are not there yet
    st = run(py + ["list"], env=env, cwd=CORE_PKG).stdout
    assert st.count("READY") >= 3, st
    n = fake_watch_demucs(ebys)
    assert n == 3, f"expected 3 files in raw_uploads, found {n}"
    run(py + ["worker", "--once"], env=env, cwd=CORE_PKG)                     # its idle scan adopts the stems
    run(py + ["validate"], env=env, cwd=CORE_PKG)
    run([a.core_tests, "--interop-handoff-verify", lib], env=env)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--core-tests", required=True)
    ap.add_argument("--plugin-tests", required=True)
    ap.add_argument("--python", default=sys.executable)
    a = ap.parse_args()

    env = dict(os.environ, PYTHONPATH=str(CORE_PKG) + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("GNUMBAT_LIBRARY", None)
    tmp = Path(tempfile.mkdtemp(prefix="gnumbat_interop_"))
    env["GNUMBAT_HOME"] = str(tmp / "home")
    env["GNUMBAT_SETTINGS"] = str(tmp / "settings.json")      # empty: nothing configured, like a fresh machine
    env["GNUMBAT_AUTOSTART"] = "0"
    try:
        for name, exe, w, v in (("core API", a.core_tests, "--interop-write", "--interop-verify"),
                                ("plugin capture path", a.plugin_tests, "--interop-write", "--interop-verify")):
            print(f"\n== {name}")
            lib = tmp / f"lib_{name.split()[0]}"
            run([exe, w, lib], env=env)
            py = [a.python, "-m", "gnumbat_core", "-l", lib]
            run(py + ["worker", "--once"], env=env, cwd=CORE_PKG)
            run(py + ["validate"], env=env, cwd=CORE_PKG)
            run([exe, v, lib], env=env)
        handoff_stage(a, env, tmp)
        print("\ninterop: OK")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
