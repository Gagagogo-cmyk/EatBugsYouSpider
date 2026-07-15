#!/usr/bin/env python3
"""
patch_master_trim.py — insert a fixed -30 dB headroom trim on the master output.

The master bus (post master_gain) was hitting dac~ 1 2 ~30 dB too hot and
clipping. This inserts a fixed `*~ 0.0316` (10^(-30/20)) on both L and R,
IN SERIES, right before the dac feed — independent of the user's master_gain,
so the operating point is sane and master_gain still works on top.

Chain before:  obj-21070 (*~ ×master_gain) -> obj-159 -> dac~ 1 2  (L)
               obj-21071 (*~ ×master_gain) -> obj-160 -> dac~ 1 2  (R)
Chain after:   obj-21070 -> trimL (*~ 0.0316) -> obj-159 -> dac
               obj-21071 -> trimR (*~ 0.0316) -> obj-160 -> dac

Idempotent (skips if trim already present). Reversible: git checkout the patch.
Reload the Max patch after running. Tweak TRIM below to taste (0.0316 = -30 dB,
0.0562 = -25 dB, 0.1 = -20 dB).
"""
import json, os, sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ebys-analyze.maxpat')
TRIM  = 0.0126            # -30 dB
# (master *~ , downstream feed) for L and R
LEGS  = [('obj-21070', 'obj-159', 'obj-wave_trimL'),
         ('obj-21071', 'obj-160', 'obj-wave_trimR')]

def box(bid, x, y):
    return {"box": {"id": bid, "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
                    "outlettype": ["signal"], "patching_rect": [x, y, 74.0, 22.0],
                    "text": "*~ %s" % TRIM}}

def main():
    p = json.load(open(PATCH))
    boxes = p['patcher']['boxes']
    lines = p['patcher']['lines']
    ids = {b['box']['id'] for b in boxes}
    if 'obj-wave_trimL' in ids:
        print('master trim already present — nothing to do.'); return

    y = 3300.0
    for i, (src, dst, trim) in enumerate(LEGS):
        if src not in ids or dst not in ids:
            print('ERROR: expected node %s/%s not found — aborting.' % (src, dst)); sys.exit(1)
        boxes.append(box(trim, 2500.0 + i * 90, y))
        # re-point the existing src->dst line so it comes from the trim instead
        redirected = False
        for l in lines:
            pl = l['patchline']
            if pl['source'][0] == src and pl['destination'][0] == dst:
                pl['source'] = [trim, 0]
                redirected = True
                break
        if not redirected:
            print('ERROR: could not find %s -> %s connection.' % (src, dst)); sys.exit(1)
        # feed the trim from the master *~
        lines.append({"patchline": {"destination": [trim, 0], "source": [src, 0]}})

    json.dump(p, open(PATCH, 'w'), indent=1)
    print('Inserted -30 dB master trim (L+R). Reload the Max patch.')
    print('Revert: git checkout %s' % os.path.basename(PATCH))

if __name__ == '__main__':
    main()
