#!/usr/bin/env python3
"""
patch_master_tilt.py — make the MASTER joystick X-axis a TILT of the existing
per-stem spatialisation instead of an absolute re-pan that resets it.

Before: `receive masterJoyX` feeds BOTH master pan2s (mj_LR_L, mj_LR_R) inlet 1
with the SAME value → any move re-pans them together, collapsing the per-stem
image (a reset).

After: masterJoyX is split into a tilt pair via two expr objects, one per bus:
    tiltL = clip(x,   0,1)*2-1   → mj_LR_L position
    tiltR = clip(x+1, 0,1)*2-1   → mj_LR_R position
  x = 0  → tiltL=-1 (L-bus stays fully left), tiltR=+1 (R-bus stays fully
           right): the per-channel stereo image is preserved (pass-through).
  x = -1 → both -1: whole field tilts left.  x = +1 → both +1: tilts right.

ms_router.js / spat_fx_router.js already send masterJoyX raw, so no JS change.
Idempotent. Reversible via `git checkout ebys-analyze.maxpat`. Reload the patch.
"""
import json, os, sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ebys-analyze.maxpat')
RCV   = 'obj-rcv_masterJoyX'
LEGS  = [  # (master pan2, tilt-expr id, expr text)
    ('obj-mj_LR_L', 'obj-mtiltL', 'expr min(max($f1,0.),1.)*2.-1.'),
    ('obj-mj_LR_R', 'obj-mtiltR', 'expr min(max($f1+1.,0.),1.)*2.-1.'),
]

def box(bid, text, x, y):
    return {"box": {"id": bid, "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                    "outlettype": [""], "patching_rect": [x, y, 190.0, 22.0], "text": text}}

def main():
    p = json.load(open(PATCH))
    boxes = p['patcher']['boxes']; lines = p['patcher']['lines']
    ids = {b['box']['id'] for b in boxes}
    if RCV not in ids:
        print('ERROR: %s not found' % RCV); sys.exit(1)
    if 'obj-mtiltL' in ids:
        print('master tilt already present — nothing to do.'); return

    y = 3400.0
    for i, (pan, exid, text) in enumerate(LEGS):
        boxes.append(box(exid, text, 2500.0 + i*210, y))
        # drop the direct rcv_masterJoyX -> pan inlet1 line
        kept = []
        removed = False
        for l in lines:
            pl = l['patchline']
            if pl['source'][0] == RCV and pl['destination'][0] == pan and pl['destination'][1] == 1 and not removed:
                removed = True   # skip (delete) this connection
                continue
            kept.append(l)
        lines[:] = kept
        if not removed:
            print('ERROR: %s -> %s inlet1 not found' % (RCV, pan)); sys.exit(1)
        # rcv -> expr -> pan inlet1
        lines.append({"patchline": {"destination": [exid, 0], "source": [RCV, 0]}})
        lines.append({"patchline": {"destination": [pan, 1], "source": [exid, 0]}})

    json.dump(p, open(PATCH, 'w'), indent=1)
    print('Master X-axis is now a tilt (2 expr objects inserted). Reload the Max patch.')

if __name__ == '__main__':
    main()
