#!/usr/bin/env python3
"""
patch_eq_spectrum.py — add a live, per-band spectrum analyzer for the TUI's
braille EQ display (see sdj-tui's ":eqLow/:eqMid/:eqHigh" 3-band EQ — this is
a separate, purely-visual multi-band analyzer, not another EQ control).

── Why this exists ───────────────────────────────────────────────────────────
User: "the spectrum analyzer is post everything. every change in eq, filter,
gain etc should be seen in the spectrum analyzer." So each tap point below is
deliberately the SAME node the existing VU meters already tap — i.e. already
proven to sit after that stem's full chain (biquad~ low/mid/high EQ, trim,
gain, fader, width, pan/joystick, fx-return):
    stems  → obj-jpsum_{FL,FR,RL,RR}_<stem>   (traced: post EQ/trim/gain/
             fader/width/pan/fxreturn — the exact node feeding pre_<stem>_<ch>
             → prepend meter <stem>_<ch>)
    master → obj-34 / obj-40 / obj-167 / obj-168 (*~1, post `receive
             master_gain` — traced: these feed obj-jpk_{FL,FR,RL,RR} → prepend
             meter master_<ch>). NOTE: obj-wave_mono (used by the existing
             patch_spectrum.py spectroscope~) taps obj-mj_final_* instead,
             which is BEFORE master_gain — deliberately not reused here since
             it would miss master-gain changes.

── Signal chain added, per source (4 stems + master = 5) ────────────────────
    (4ch post-everything) → +~ → +~ → *~0.5    (mono downmix — see
                                                 MONO_DOWNMIX_SCALE's own
                                                 comment for why 0.5, not the
                                                 0.25 patch_waveform_tap.py
                                                 uses for its wave_mono chain)
        → biquad~ <band 0 coefs>      → peakamp~ 60 → prepend spectrum <name> 0      →┐
        → biquad~ <band 1 coefs>      → peakamp~ 60 → prepend spectrum <name> 1      →┤
        ...                                                                            ├→ gate 1 → ws_server.js
        → biquad~ <band N_BANDS-1>    → peakamp~ 60 → prepend spectrum <name> N-1     →┘
    N_BANDS = 64 by default (see BAND_LO/BAND_HI/N_BANDS below) — was 8, then
    16, then 32 (which briefly caused audible glitching — see that
    constant's own comment for the full history), now 64 per an explicit
    request accepting that same CPU/glitch risk doubled.

Each biquad~ is a fixed (non-adjustable) constant-peak-gain bandpass filter —
the standard RBJ Audio EQ Cookbook BPF, same cookbook family and same Max
biquad~ coefficient ORDER (a0 a1 a2 b1 b2 inlets ← [b0/a0,b1/a0,b2/a0,a1/a0,
a2/a0] cookbook symbols) already verified working in eq_router.js's low/mid/
high EQ chain — reused here instead of an unfamiliar filterbank object
(fffb~) so the argument convention is one we've already confirmed correct in
this exact patch. Coefficients are computed once, below, and baked into each
biquad~'s creation arguments (no `receive` — these bands are fixed analysis
points, not user-controllable).

peakamp~ 60 auto-reports every 60ms with no bang needed, same idiom as the VU
meters (peakamp~ 100) and waveform taps (peakamp~ 40) elsewhere in this patch.
Each band reports independently and asynchronously — exactly like the 4
per-stem VU channels already do — so `spectrum <name> <band> <level>` arrives
as N_BANDS separate messages per source rather than one batched list;
ws_server.js accumulates them the same way it already accumulates
FL/FR/RL/RR into one {FL,FR,RL,RR} object for `meter`.

── Message format (→ ws_server.js → TUI) ────────────────────────────────────
    spectrum <name> <bandIndex 0..N_BANDS-1> <level 0-1 linear>
    name = vocals | melody | bass | drums | master
    bandIndex ↔ BAND_FREQS below, low → high

Regenerate-safe: if a previous run's analyzer is already present (detected via
the obj-spec_mono_master marker), every obj-spec_*-prefixed box and every line
touching one is removed first, then the full filterbank is rebuilt fresh at
whatever N_BANDS/BAND_LO/BAND_HI/BAND_Q are currently set below — so changing
the band count is just editing N_BANDS and re-running, not a manual
git-checkout-then-reapply dance. Everything else in the patch (including any
other uncommitted work sitting in ebys-analyze.maxpat) is untouched — the
removal filter only matches the obj-spec_ id prefix this script itself always
uses, never anything else in the file. Reload the Max patch after running.

Usage:  python3 patch_eq_spectrum.py
"""
import json, math, os, sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ebys-analyze.maxpat')
GATE  = 'obj-7013'   # gate 1 → ws_server (same funnel every other analysis tap uses)
SR    = 44100.0

# 64 bands, log-spaced 40Hz-16kHz. History: 8 → 32 ("make the eq with more
# bands") — 32 meant 160 biquad~ + 160 peakamp~ running continuously across
# the 5 sources (32 bands x 5), on top of everything else already in this
# patch (demucs stems, spatial panning, EQ, FX, LUFS, waveform taps). User
# reported audible glitching/stuttering after that change; a structural diff
# of the patch confirmed the real mix/EQ/pan/fader/output chain was untouched
# (every new connection only reads from existing signal points, never writes
# into them), so this was real-time CPU load, not a wiring bug. Dropped to 16
# (80 filters) to fix it, then later brought back to 32 (160 filters) once
# the chunkiness complaint outweighed that risk again.
#
# Now at 64 (320 filters total across all 5 sources) — user: "make it 64 and
# make it cover the whole length of the window lines" — explicitly accepting
# the CPU/glitch risk this exact count already carried a documented history
# of causing, after being warned about it. If stuttering returns, the fix is
# fewer bands (drop back to 32, or 16 if that's still too much), not more —
# this script is regenerate-safe (see its own module docstring), so that's a
# one-line N_BANDS edit + re-run, not a bigger job. Q stays at 3 (kept each
# band reasonably distinct even packed tighter than the original 8) —
# generated rather than hand-listed so band count/range is still a one-line
# change if it needs tuning again either direction.
BAND_LO, BAND_HI, N_BANDS = 40.0, 16000.0, 64
BAND_FREQS = [round(BAND_LO * (BAND_HI / BAND_LO) ** (i / (N_BANDS - 1))) for i in range(N_BANDS)]
BAND_Q     = 3.0

# Post-everything 4-channel tap points, one set per source. Stems mirror the
# VU meters' own per-stem sum nodes; master mirrors the VU meters' own
# post-master_gain per-channel nodes (see header comment for why NOT
# obj-mj_final_* / obj-wave_mono).
# Mono-downmix scale for the 4-channel sum feeding the filterbank. Was 0.25
# (a straight quarter-average, same as patch_waveform_tap.py's wave_mono) —
# user: "the master never hits the -10 line while the vu meter shows its
# level at -5... its a problem." Root cause: the VU meter shows each
# channel's OWN peak individually (no averaging), but the spectrum's mono
# downmix summed all 4 channels and divided by 4 regardless of how many of
# them actually carry signal. Real content is rarely spread evenly across
# all 4 (joystick panning concentrates it in 1-2 channels at a time via
# pan2's crossfade) — e.g. plain stereo content with FL=FR=X and RL=RR=0
# downmixed to (X+X+0+0)*0.25 = 0.5X, a full ~6dB UNDER-read versus X, which
# matches the gap reported. 0.5 fixes that exact (very common) 2-active-
# channel case exactly; a genuinely single-channel-only signal (hard-panned
# to one corner) still under-reads by the same ~6dB, and true 4-channel
# diffuse content now over-reads by ~6dB instead — no fixed divisor gets
# every channel-activity pattern exactly right without a per-channel
# filterbank (4x the biquad~/peakamp~ count, which is exactly the CPU load
# that caused the earlier glitching — see N_BANDS' own comment), so this is
# the closest single-number fix to "matches the vu meter" for the common
# case without reintroducing that problem.
MONO_DOWNMIX_SCALE = 0.5

SOURCES = {
    'vocals': ['obj-jpsum_FL_vocals', 'obj-jpsum_FR_vocals', 'obj-jpsum_RL_vocals', 'obj-jpsum_RR_vocals'],
    'melody': ['obj-jpsum_FL_melody', 'obj-jpsum_FR_melody', 'obj-jpsum_RL_melody', 'obj-jpsum_RR_melody'],
    'bass':   ['obj-jpsum_FL_bass',   'obj-jpsum_FR_bass',   'obj-jpsum_RL_bass',   'obj-jpsum_RR_bass'],
    'drums':  ['obj-jpsum_FL_drums',  'obj-jpsum_FR_drums',  'obj-jpsum_RL_drums',  'obj-jpsum_RR_drums'],
    'master': ['obj-34', 'obj-40', 'obj-167', 'obj-168'],
}


def bpf_coefs(fc, Q):
    """RBJ Audio EQ Cookbook — BPF, constant 0 dB peak gain. Returns the Max
    biquad~ creation-argument order (a0 a1 a2 b1 b2 inlets), same convention
    as eq_router.js's lowShelf/highShelf/peak() helpers."""
    w0 = 2 * math.pi * fc / SR
    cw, sw = math.cos(w0), math.sin(w0)
    al = sw / (2 * Q)
    b0, b1, b2 = al, 0.0, -al
    a0, a1, a2 = 1 + al, -2 * cw, 1 - al
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]


def box(bid, text, ninlet, noutlet, otype, x, y, w=110.0):
    return {"box": {"id": bid, "maxclass": "newobj", "numinlets": ninlet,
                    "numoutlets": noutlet, "outlettype": otype,
                    "patching_rect": [x, y, w, 22.0], "text": text}}


def comment(bid, text, x, y, w=460.0):
    return {"box": {"id": bid, "maxclass": "comment", "numinlets": 1, "numoutlets": 0,
                    "patching_rect": [x, y, w, 20.0], "text": text}}


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


def main():
    with open(PATCH) as f:
        p = json.load(f)
    boxes = p['patcher']['boxes']
    lines = p['patcher']['lines']
    ids = {b['box']['id'] for b in boxes}

    marker = 'obj-spec_mono_master'
    if marker in ids:
        # Regenerate, don't skip — see this script's own module docstring.
        # Strip every obj-spec_-prefixed box and every line touching one
        # (as source OR destination — the mono-downmix taps have an
        # obj-spec_ box as their line's destination even though the SOURCE
        # end is a pre-existing tap point like obj-jpsum_FL_vocals, so
        # matching only "source" would leave those dangling), then fall
        # through to the normal build path below with whatever
        # N_BANDS/BAND_LO/BAND_HI/BAND_Q are set right now. Nothing outside
        # the obj-spec_ prefix is touched, so any other uncommitted work in
        # this same patch file survives untouched.
        before_b, before_l = len(boxes), len(lines)
        boxes[:] = [b for b in boxes if not b['box']['id'].startswith('obj-spec_')]
        lines[:] = [
            ln for ln in lines
            if not ln['patchline']['source'][0].startswith('obj-spec_')
            and not ln['patchline']['destination'][0].startswith('obj-spec_')
        ]
        ids = {b['box']['id'] for b in boxes}
        print('Removed existing EQ spectrum analyzer: %d objects, %d connections — rebuilding at N_BANDS=%d.'
              % (before_b - len(boxes), before_l - len(lines), N_BANDS))
    for name, srcs in SOURCES.items():
        for s in srcs:
            if s not in ids:
                print('ERROR: tap point %s (source for %s) not found — patch layout '
                      'has changed since this script was written. Aborting, nothing '
                      'written.' % (s, name))
                sys.exit(1)

    new_boxes, new_lines = [], []
    # Existing patch content occupies roughly x:[84, 7286] y:[52, 3834] (checked
    # against the live file before picking this spot — first attempt at
    # x0=4400/y0=200 landed mid-canvas, right on top of other objects, which is
    # exactly the "chaos" this reworked placement avoids). Starting a clean
    # 500px below the lowest existing object, at the same left margin the rest
    # of the patch already uses, keeps this whole section visually separate
    # and scrollable-to on its own instead of interleaved with anything else.
    x0, y0 = 100.0, 4350.0
    col_dx, row_dy = 700.0, 46.0    # tightened from 50 back when band rows/source went 8 → 32; still
                                    # leaves a clean 2px gap between one band's row and the next at 64
                                    # label (comment boxes are 20px tall, biquad~/peakamp~/prepend 22px)

    new_boxes.append(comment('obj-spec_hdr',
                              '========================  EQ SPECTRUM ANALYZER  ========================',
                              x0, y0 - 90.0, 3600.0))
    new_boxes.append(comment('obj-spec_hdr2',
                              'post-everything, fixed %d-band bandpass filterbank per source (see patch_eq_spectrum.py) — one column per source below'
                              % N_BANDS, x0, y0 - 60.0, 3600.0))

    names = list(SOURCES.keys())
    for ni, name in enumerate(names):
        srcs = SOURCES[name]
        cx = x0 + ni * col_dx
        cy = y0

        new_boxes.append(comment('obj-spec_col_lbl_%s' % name, '── %s ──' % name.upper(),
                                  cx, cy - 24.0, col_dx - 40.0))

        # ── mono downmix — same 4-object shape as patch_waveform_tap.py's wave_mono ──
        sum1 = 'obj-spec_sum1_%s' % name
        sum2 = 'obj-spec_sum2_%s' % name
        summ = 'obj-spec_sum_%s'  % name
        mono = 'obj-spec_mono_%s' % name
        new_boxes += [
            box(sum1, '+~', 2, 1, ['signal'], cx,       cy),
            box(sum2, '+~', 2, 1, ['signal'], cx + 130, cy),
            box(summ, '+~', 2, 1, ['signal'], cx,       cy + row_dy),
            box(mono, '*~ %s' % MONO_DOWNMIX_SCALE, 2, 1, ['signal'], cx,  cy + row_dy * 2),
        ]
        new_lines += [
            line(srcs[0], 0, sum1, 0), line(srcs[1], 0, sum1, 1),
            line(srcs[2], 0, sum2, 0), line(srcs[3], 0, sum2, 1),
            line(sum1, 0, summ, 0), line(sum2, 0, summ, 1),
            line(summ, 0, mono, 0),
        ]

        # ── N_BANDS-band fixed bandpass filterbank, each band self-reporting to ws_server ──
        # row_dy=50 per band leaves room for a small "band N — NNNN Hz" label
        # directly above each biquad~ (see lbl below) — without it, 8 rows of
        # near-identical "biquad~ 0.0xxxxx ..." text are indistinguishable at
        # a glance, which was the other half of "so i can understand what's what".
        for bi, fc in enumerate(BAND_FREQS):
            coefs = bpf_coefs(fc, BAND_Q)
            bp  = 'obj-spec_bp_%s_%d'  % (name, bi)
            pk  = 'obj-spec_pk_%s_%d'  % (name, bi)
            pre = 'obj-spec_pre_%s_%d' % (name, bi)
            lbl = 'obj-spec_lbl_%s_%d' % (name, bi)
            by  = cy + row_dy * (3 + bi)
            new_boxes += [
                comment(lbl, 'band %d — %d Hz' % (bi, fc), cx, by - 22.0, 200.0),
                box(bp, 'biquad~ %.6f %.6f %.6f %.6f %.6f' % tuple(coefs),
                    2, 1, ['signal'], cx, by, w=220.0),
                box(pk, 'peakamp~ 60', 2, 1, ['float'], cx + 230, by),
                box(pre, 'prepend spectrum %s %d' % (name, bi), 1, 1, [''], cx + 350, by, w=140.0),
            ]
            new_lines += [
                line(mono, 0, bp, 0),
                line(bp, 0, pk, 0),
                line(pk, 0, pre, 0),
                line(pre, 0, GATE, 1),
            ]

    boxes.extend(new_boxes)
    lines.extend(new_lines)
    with open(PATCH, 'w') as f:
        json.dump(p, f, indent=1)
    print('Added EQ spectrum analyzer: %d objects, %d connections (%d sources x %d bands).'
          % (len(new_boxes), len(new_lines), len(names), len(BAND_FREQS)))
    print('Reload the Max patch to activate. `git checkout %s` to revert.' % os.path.basename(PATCH))


if __name__ == '__main__':
    main()
