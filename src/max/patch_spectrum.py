#!/usr/bin/env python3
"""
patch_spectrum.py — add a live spectrum analyzer on the master output so EQ
changes can be VERIFIED visually (not just by ear).

Taps the existing master mono-sum (obj-wave_mono, created by patch_waveform_tap.py)
into a `spectroscope~` UI object. spectroscope~ shows the master's frequency
content in real time — boost the highs and you see the top of the display light
up; cut the lows and the bottom drops out. Solo a stem to inspect that stem's EQ
in isolation.

Placed at the top-right of the patch canvas. Idempotent (skips if already
present). Reversible: `git checkout ebys-analyze.maxpat`. Reload the patch after
running.

Note: spectroscope~ defaults to a scrolling sonogram (frequency up the Y axis,
time scrolling left). If you prefer a magnitude-vs-frequency CURVE, open the
object's inspector and set Display Mode to "Spectrum". Both modes show the EQ
effect clearly.
"""
import json, os, sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ebys-analyze.maxpat')
SRC   = 'obj-wave_mono'          # master mono sum (signal) — from patch_waveform_tap.py
SCOPE = 'obj-eq_spectrum'        # our new spectroscope~
LABEL = 'obj-eq_spectrum_lbl'


def main():
    p = json.load(open(PATCH))
    boxes = p['patcher']['boxes']
    lines = p['patcher']['lines']
    ids = {b['box']['id'] for b in boxes}

    if SCOPE in ids:
        print('spectrum analyzer already present — nothing to do.')
        return
    if SRC not in ids:
        print('ERROR: %s not found — run patch_waveform_tap.py first (need the '
              'master mono sum to tap).' % SRC)
        sys.exit(1)

    x, y = 1500.0, 60.0
    # spectroscope~ UI object. @range sets the dB window; @scale log gives a
    # musically-useful log frequency axis.
    boxes.append({"box": {
        "id": SCOPE,
        "maxclass": "spectroscope~",
        "numinlets": 1,
        "numoutlets": 0,
        "patching_rect": [x, y, 460.0, 240.0],
        "range": [-72.0, 0.0],
        "scale": "log",
    }})
    boxes.append({"box": {
        "id": LABEL,
        "maxclass": "comment",
        "numinlets": 1,
        "numoutlets": 1,
        "patching_rect": [x, y - 22.0, 460.0, 20.0],
        "text": "MASTER SPECTRUM  —  verify EQ here (solo a stem to isolate it)",
    }})
    # master mono sum → spectroscope~
    lines.append({"patchline": {"source": [SRC, 0], "destination": [SCOPE, 0]}})

    json.dump(p, open(PATCH, 'w'), indent=1)
    print('Added master spectrum analyzer (spectroscope~ tapping %s). '
          'Reload the Max patch.' % SRC)


if __name__ == '__main__':
    main()
