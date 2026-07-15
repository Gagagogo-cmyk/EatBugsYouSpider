#!/usr/bin/env python3
"""
compute_waveforms.py — precompute per-stem peak envelopes for the TUI.

For every separated track in the active session's stems/htdemucs/<track>/ dir,
reads each stem WAV and reduces it to a small peak envelope (one amplitude per
position bucket, normalised 0..100). The TUI draws these as the per-stem
waveform behind the slice window — grey overall, white on the playing slice.

Output: data/sessions/<id>/waveforms.json
    { "<track>": { "vocals":[...N], "melody":[...N], "bass":[...N], "drums":[...N] } }

demucs stem files are named <track>_<vocals|drums|bass|other>.wav; "other" maps
to melody, matching the rest of the stack. Session-aware exactly like
add_tension.py / import_library.py.

Usage:  python3 compute_waveforms.py            # all tracks in the active session
        python3 compute_waveforms.py <track>    # one track (exact folder name)
"""

import json, os, sys, wave
import numpy as np

N_BUCKETS = 400  # envelope resolution (TUI downsamples further to the bar width)
# Stems whose RMS is below this (~ -60 dBFS) are treated as silent and render as
# a flat line. RMS (not peak) is the silence test because a stem can be dead
# silent apart from a stray transient/click — that has a real peak but ~0 RMS.
# Without this, a near-silent stem (e.g. vocals on an instrumental) gets its
# noise floor normalised up to full scale and shows a bogus full waveform.
SILENCE_RMS = 1e-3

_SRC_DIR   = os.path.dirname(os.path.abspath(__file__))
_DATA_ROOT = os.path.join(_SRC_DIR, '..', '..', 'data')

def _current_session_id():
    try:
        with open(os.path.join(_DATA_ROOT, 'current_session.txt')) as f:
            return f.read().strip() or 'default'
    except Exception:
        return 'default'

_DATA_DIR    = os.path.join(_DATA_ROOT, 'sessions', _current_session_id())
HTDEMUCS     = os.path.join(_DATA_DIR, 'stems', 'htdemucs')
OUT_PATH     = os.path.join(_DATA_DIR, 'waveforms.json')
DEMUCS_STEMS = {'vocals': 'vocals', 'drums': 'drums', 'bass': 'bass', 'melody': 'other'}

def read_mono(path):
    """Return a mono float32 array in [-1,1] for an int16/int24/int32/float32 WAV."""
    w = wave.open(path, 'rb')
    ch, sw, n = w.getnchannels(), w.getsampwidth(), w.getnframes()
    raw = w.readframes(n); w.close()
    if sw == 2:
        a = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif sw == 4:
        # demucs commonly writes float32; fall back to int32 if it looks integral
        f = np.frombuffer(raw, dtype='<f4')
        a = f if np.nanmax(np.abs(f)) <= 4.0 else np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    elif sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        a = ((b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)) << 8 >> 8).astype(np.float32) / 8388608.0
    else:
        raise ValueError('unsupported sample width %d' % sw)
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a

def raw_envelope(path):
    """Return (peak-per-bucket float array, absolute peak, rms) — NOT normalised.
    Normalisation is done per-TRACK in main() against the loudest stem, so a
    quiet/silent stem stays proportionally small instead of being blown up to
    full scale by its own noise floor."""
    a = read_mono(path)
    if a.size == 0:
        return np.zeros(N_BUCKETS, dtype=np.float32), 0.0, 0.0
    rms = float(np.sqrt(np.mean(a.astype(np.float64) ** 2)))
    a = np.abs(a)
    buckets = np.array_split(a, N_BUCKETS)
    env = np.array([b.max() if b.size else 0.0 for b in buckets], dtype=np.float32)
    return env, float(env.max()), rms

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if not os.path.isdir(HTDEMUCS):
        print('no stems dir: ' + HTDEMUCS); return
    out = {}
    if os.path.exists(OUT_PATH):
        try: out = json.load(open(OUT_PATH))
        except Exception: out = {}
    tracks = [only] if only else sorted(os.listdir(HTDEMUCS))
    for track in tracks:
        tdir = os.path.join(HTDEMUCS, track)
        if not os.path.isdir(tdir):
            continue
        raw = {}   # name -> (env array, absolute peak, rms)
        for name, dem in DEMUCS_STEMS.items():
            wavp = os.path.join(tdir, '%s_%s.wav' % (track, dem))
            if os.path.exists(wavp):
                try:
                    raw[name] = raw_envelope(wavp)
                except Exception as e:
                    print('  ! %s/%s: %s' % (track, name, e))
        if raw:
            # Shared reference: the loudest stem in this track. All stems are
            # scaled to it, so relative levels are preserved and a silent stem
            # stays flat instead of being normalised up to full scale. Stems
            # below the RMS silence gate render as a flat line outright.
            track_max = max(peak for (_, peak, _) in raw.values())
            stems = {}
            for name, (env, peak, rms) in raw.items():
                if track_max <= 0 or rms < SILENCE_RMS:
                    stems[name] = [0] * N_BUCKETS
                else:
                    norm = env / track_max
                    stems[name] = [int(round(min(1.0, float(v)) * 100)) for v in norm]
            out[track] = stems
            silent = [n for n, (_, _, r) in raw.items() if r < SILENCE_RMS]
            print('%s: %s%s' % (track, ', '.join(stems.keys()),
                                ('  (silent: %s)' % ', '.join(silent)) if silent else ''))
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f)
    print('wrote %s (%d tracks)' % (OUT_PATH, len(out)))

if __name__ == '__main__':
    main()
