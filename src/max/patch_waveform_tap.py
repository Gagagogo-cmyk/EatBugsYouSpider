#!/usr/bin/env python3
"""
patch_waveform_tap.py — add a master-output waveform tap to ebys-analyze.maxpat.

Taps the four master channels (obj-mj_final_FL/FR/RL/RR), sums them to a mono
signal, and extracts the per-frame signed peak pair:

    mono = (FL + FR + RL + RR) * 0.25
    +peak : maximum~ 0.  -> peakamp~ 40 -> prepend wavePos master
    -peak : minimum~ 0.  -> peakamp~ 40 -> prepend waveNeg master

Both prepend outputs feed the existing gate (obj-7013) that funnels messages to
the ws_server node.script, which relays {type:'wave', name:'master', pos, neg}
to the TUI. `peakamp~ 40` reports every 40ms (~25Hz) — a waveform needs a much
faster refresh than the VU meters' slow interval.

Idempotent: re-running does nothing if the tap is already present.
Reversible: `git checkout ebys-analyze.maxpat` undoes it. Reload the Max patch
after running so the new DSP takes effect.

Usage:  python3 patch_waveform_tap.py
"""

import json, os, sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ebys-analyze.maxpat')
GATE  = 'obj-7013'                       # gate 1 → ws_server
SRC   = ['obj-mj_final_FL', 'obj-mj_final_FR', 'obj-mj_final_RL', 'obj-mj_final_RR']

def box(bid, text, ninlet, noutlet, otype, x, y, w=110.0):
    return {"box": {"id": bid, "maxclass": "newobj", "numinlets": ninlet,
                    "numoutlets": noutlet, "outlettype": otype,
                    "patching_rect": [x, y, w, 22.0], "text": text}}

def line(src, so, dst, di):
    return {"patchline": {"destination": [dst, di], "source": [src, so]}}

def main():
    with open(PATCH) as f:
        p = json.load(f)
    boxes = p['patcher']['boxes']
    lines = p['patcher']['lines']
    ids   = {b['box']['id'] for b in boxes}

    for s in SRC:
        if s not in ids:
            print('ERROR: master channel node %s not found — aborting.' % s); sys.exit(1)
    if 'obj-wave_mono' in ids:
        print('Waveform tap already present — nothing to do.'); return

    x0, y0 = 2360.0, 3120.0
    dy = 34.0
    new_boxes = [
        box('obj-wave_sum1', '+~',          2, 1, ['signal'], x0,        y0),
        box('obj-wave_sum2', '+~',          2, 1, ['signal'], x0+130,    y0),
        box('obj-wave_sum',  '+~',          2, 1, ['signal'], x0,        y0+dy),
        box('obj-wave_mono', '*~ 0.25',     2, 1, ['signal'], x0,        y0+dy*2),
        box('obj-wave_max',  'maximum~ 0.', 2, 1, ['signal'], x0,        y0+dy*3),
        box('obj-wave_min',  'minimum~ 0.', 2, 1, ['signal'], x0+130,    y0+dy*3),
        box('obj-wave_pk_pos', 'peakamp~ 40', 2, 1, ['float'], x0,     y0+dy*4),
        box('obj-wave_pk_neg', 'peakamp~ 40', 2, 1, ['float'], x0+130, y0+dy*4),
        box('obj-wave_pre_pos', 'prepend wavePos master', 1, 1, [''], x0,     y0+dy*5, 150.0),
        box('obj-wave_pre_neg', 'prepend waveNeg master', 1, 1, [''], x0+160, y0+dy*5, 150.0),
    ]
    new_lines = [
        line(SRC[0], 0, 'obj-wave_sum1', 0),
        line(SRC[1], 0, 'obj-wave_sum1', 1),
        line(SRC[2], 0, 'obj-wave_sum2', 0),
        line(SRC[3], 0, 'obj-wave_sum2', 1),
        line('obj-wave_sum1', 0, 'obj-wave_sum', 0),
        line('obj-wave_sum2', 0, 'obj-wave_sum', 1),
        line('obj-wave_sum',  0, 'obj-wave_mono', 0),
        line('obj-wave_mono', 0, 'obj-wave_max', 0),
        line('obj-wave_mono', 0, 'obj-wave_min', 0),
        line('obj-wave_max', 0, 'obj-wave_pk_pos', 0),
        line('obj-wave_min', 0, 'obj-wave_pk_neg', 0),
        line('obj-wave_pk_pos', 0, 'obj-wave_pre_pos', 0),
        line('obj-wave_pk_neg', 0, 'obj-wave_pre_neg', 0),
        line('obj-wave_pre_pos', 0, GATE, 1),
        line('obj-wave_pre_neg', 0, GATE, 1),
    ]

    boxes.extend(new_boxes)
    lines.extend(new_lines)
    with open(PATCH, 'w') as f:
        json.dump(p, f, indent=1)
    print('Added master waveform tap: %d objects, %d connections.' % (len(new_boxes), len(new_lines)))
    print('Reload the Max patch to activate. `git checkout %s` to revert.' % os.path.basename(PATCH))

if __name__ == '__main__':
    main()
