"""Fake external tools so the subprocess plumbing (Demucs, Pd) is testable without them."""
import os
import stat
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def make_fake_demucs(dirpath: Path, fail: bool = False) -> Path:
    """A package `demucs` (importable via PYTHONPATH) whose CLI mimics `python -m demucs -n M --float32 -o OUT file`:
    htdemucs layout OUT/M/<track>/{drums,bass,other,vocals}.wav and tqdm-style \\r progress on stderr."""
    pkg = dirpath / "demucs"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("__version__ = '4.0.1-fake'\n")
    (pkg / "__main__.py").write_text(textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {str(ROOT)!r})
        import numpy as np
        from pathlib import Path
        from gnumbat_core import wavio
        args = sys.argv[1:]
        if {fail!r}:
            sys.stderr.write("RuntimeError: CUDA out of memory (fake)\\n"); sys.exit(1)
        model = args[args.index("-n") + 1]; out = Path(args[args.index("-o") + 1]); src = Path(args[-1])
        x, sr = wavio.read_wav(src)
        # like real demucs: output is 44.1 kHz stereo (no resampling in the fake, sr passes through)
        d = out / model / src.stem; d.mkdir(parents=True)
        n = x.shape[0]; X = np.fft.rfft(x, axis=0); f = np.fft.rfftfreq(n, 1.0 / sr)
        bands = {{"bass": f < 200, "other": (f >= 200) & (f < 3000), "vocals": (f >= 3000) & (f < 8000), "drums": f >= 8000}}
        for i, (name, m) in enumerate(bands.items()):
            sys.stderr.write("\\r %d%%|####| fake" % (25 * (i + 1))); sys.stderr.flush(); time.sleep(0.05)
            wavio.write_wav(d / (name + ".wav"), np.fft.irfft(X * m[:, None], n=n, axis=0).astype(np.float32), sr, "float32")
        sys.stderr.write("\\n")
    """))
    return dirpath


def make_fake_pd(path: Path, fail: bool = False) -> Path:
    """An executable that parses `-send "gnumbat-job run <job.txt>"` and writes the text-file contract."""
    path.write_text("#!" + sys.executable + "\n" + textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(ROOT)!r})
        from pathlib import Path
        import numpy as np
        from gnumbat_core import wavio
        args = sys.argv[1:]
        assert "-batch" in args and "-nogui" in args and "-open" in args
        if {fail!r}:
            print("error: fluid.bufspectralshape: couldn't create"); sys.exit(0)
        msg = args[args.index("-send") + 1].split()
        assert msg[:2] == ["gnumbat-job", "run"]
        job = Path(msg[2])
        hop = 512
        for line in job.read_text().splitlines():
            kind, name, wav, prefix = line.split()
            assert kind == "stem" and " " not in wav
            x, sr = wavio.read_wav(wav)
            n = x.shape[0]; frames = max(1, n // hop)
            t = np.arange(frames)
            def w(buf, ch, arr): Path(prefix + f".{{buf}}-{{ch}}.txt").write_text("\\n".join(repr(float(v)) for v in arr) + "\\n")
            for ch in range(7): w("spectral", ch, 1000 + 100 * ch + 50 * np.sin(t / 20.0))
            w("loudness", 0, -40 + 30 * t / frames); w("loudness", 1, -30 + 0 * t)
            w("pitch", 0, 220 + 0 * t); w("pitch", 1, 0.9 + 0 * t)
            for ch in range(12): w("chroma", ch, (1.0 if ch == 9 else 0.05) + 0 * t)
            for ch in range(13): w("mfcc", ch, np.cos(t / (10 + ch)))
            Path(prefix + ".slices.txt").write_text("\\n".join(str(v) for v in range(sr // 2, n, sr // 2)) + "\\n")
            Path(prefix + ".meta.txt").write_text(f"samplerate {{sr}}\\nhop {{hop}}\\nwindow 1024\\nframes {{frames}}\\n")
            Path(prefix + ".done").write_text("1")
        (job.parent / "job.done").write_text("1")
    """))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path
