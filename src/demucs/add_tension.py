#!/usr/bin/env python3
"""
add_tension.py — compute tension + density fields for every slice in analysis_library.json

For each stem of each track:
  1. Assign each slice to a bar using downbeats_ms
  2. Average all 6 descriptors per bar  (T = MFCC RMS of M0–M5)
  3. Sliding-window slope across bars
  4. Normalize each descriptor's slopes to [0, 1]
  5. Write tension_C/E/F/P/H/T back to each slice
  6. Density per bar = weighted blend of two normalized (relative-to-this-track)
     signals:
       - E level        — loudness. "Is something happening, loudly."
       - transient rate — number of slices assigned to that bar. Slice
         boundaries are NOT arbitrary chunks — they come from fluid.bufampslice~
         (an amplitude-transient detector, one instance per stem in the Max
         patch), so slice count per bar is a real onset/transient-rate measure,
         not a proxy built from a different quantity. This is deliberately
         NOT spectral-centroid movement: a couple of loud, isolated hits that
         happen to land at different spectral positions would spread the
         centroid just as much as a genuinely busy bar, without actually being
         dense — few, sparse events vs. many, packed-together events is
         exactly what transient count distinguishes and centroid spread can't.
         Bar length is constant within a track (barMs comes from one avgBarMs/
         BPM value for the whole track), so raw slice count is already
         comparable bar-to-bar without converting to a rate.
     Both signals are min-max normalized within-track before blending, so
     "dense" means "relative to this track's own range," not an absolute
     loudness number — mastering loudness varies too much across tracks for
     a fixed threshold to mean the same thing everywhere.
  7. Write density (0–1) and dense (bool, density >= DENSITY_THRESHOLD) back
     to each slice.

  NOTE: DENSITY_E_WEIGHT / DENSITY_TRANSIENT_WEIGHT / DENSITY_THRESHOLD below
  are reasoned starting guesses, not measured/calibrated values — there's no
  listening-based tuning behind them yet. Treat them as parameters to retune
  by ear once this is actually running against real sets.

Usage:
  python3 add_tension.py                    # process all tracks
  python3 add_tension.py "trackname"        # process one track (partial name match)
  python3 add_tension.py --window 6         # change window size (default 4)
"""

import json, math, sys, os, re

def load_max_json(path):
    """Read a JSON file that may have a Max Dict '{}' preamble or trailing garbage."""
    with open(path) as f:
        raw = f.read()
    if raw.startswith('{}') and len(raw) > 2:
        raw = '{"' + raw[2:]
    obj, _ = json.JSONDecoder().raw_decode(raw)
    return obj

_SRC_DIR       = os.path.dirname(os.path.abspath(__file__))
_DATA_ROOT     = os.path.join(_SRC_DIR, '..', '..', 'data')

def _current_session_id():
    """Active session id — mirrors session_manager.js / watch_demucs.py's
    current_session_id(). Reads data/current_session.txt (written by the TUI
    login), falling back to 'default' when it's missing/empty, exactly as the
    rest of the stack does. add_tension.py is a one-shot spawned by the TUI
    after analysis, so resolving once at module load is fine."""
    try:
        with open(os.path.join(_DATA_ROOT, 'current_session.txt')) as f:
            sid = f.read().strip()
        return sid or 'default'
    except Exception:
        return 'default'

_DATA_DIR      = os.path.join(_DATA_ROOT, 'sessions', _current_session_id())
ANALYSIS_PATH  = os.path.join(_DATA_DIR, 'analysis_library.json')
DOWNBEATS_PATH = os.path.join(_DATA_DIR, 'downbeats.json')
WINDOW         = 4   # number of bars in the slope window (half = floor(w/2))

# Stem suffixes to strip when matching analysis track → downbeats track
STEM_SUFFIXES = ['_vocals.wav', '_melody.wav', '_bass.wav', '_drums.wav', '_other.wav',
                 '_vocals',     '_melody',     '_bass',     '_drums',     '_other']

DESCRIPTORS = ['C', 'E', 'F', 'P', 'H', 'T']

# Density blend weights — transient rate (real slice/onset count per bar) gets
# the larger share since it's the more direct "how much is actually happening"
# signal; E (loudness) still matters ("if it's loud AND busy, that's the
# moment") but shouldn't dominate on its own, since loud-but-sparse isn't dense.
# Unvalidated starting guesses — retune by ear. Named here so that's easy.
DENSITY_E_WEIGHT          = 0.45
DENSITY_TRANSIENT_WEIGHT  = 0.55
DENSITY_THRESHOLD         = 0.6   # normalized density >= this → dense = True

# ── helpers ───────────────────────────────────────────────────────────────────

def strip_stem_suffix(name):
    for suf in STEM_SUFFIXES:
        if name.endswith(suf):
            return name[:-len(suf)]
    return name

def slice_T(s):
    """Timbre = RMS of MFCC coefficients M0–M5."""
    vals = [s.get(f'M{i}', 0.0) for i in range(6)]
    return math.sqrt(sum(v * v for v in vals) / len(vals))

def get_descriptor(s, d):
    if d == 'T':
        return slice_T(s)
    return float(s.get(d, 0.0))

def assign_bar(time_ms, downbeats_ms):
    """Return bar index (0-based) for a slice at time_ms."""
    bar = 0
    for i, db in enumerate(downbeats_ms):
        if time_ms >= db:
            bar = i
        else:
            break
    return bar

def sliding_slope(values, w):
    """
    For each position b, slope[b] = values[b+half] - values[b-half].
    Edges are clamped (use nearest available index).
    """
    n    = len(values)
    half = w // 2
    slopes = []
    for b in range(n):
        lo = max(0, b - half)
        hi = min(n - 1, b + half)
        slopes.append(values[hi] - values[lo])
    return slopes

def normalize(slopes):
    """Rescale list to [0, 1]. Returns list of same length."""
    lo, hi = min(slopes), max(slopes)
    span = hi - lo
    if span == 0:
        return [0.0] * len(slopes)
    return [(v - lo) / span for v in slopes]

# ── core ──────────────────────────────────────────────────────────────────────

def process_stem(slices_dict, metadata, downbeats_ms, w):
    """
    slices_dict : { "slice_0001": { time, C, E, F, P, H, M0..M5 }, ... }
    metadata    : { stemDurMs, ... }
    downbeats_ms: [ms, ms, ...]
    w           : window size

    Mutates slices_dict in place — adds tension_C/E/F/P/H/T to each slice.
    time field is normalized 0–1; multiply by stemDurMs to get absolute ms.
    """
    n_bars = len(downbeats_ms)
    if n_bars == 0:
        print('    ⚠  no downbeats — skipping stem')
        return

    dur_ms = float(metadata.get('stemDurMs', 0.0))
    if dur_ms == 0:
        print('    ⚠  stemDurMs missing — skipping stem')
        return

    # 1. Assign each slice to a bar
    slice_keys = sorted(slices_dict.keys())
    bar_of = {}   # slice_key → bar index
    for key in slice_keys:
        s = slices_dict[key]
        time_ms = float(s.get('time', 0.0)) * dur_ms
        bar_of[key] = assign_bar(time_ms, downbeats_ms)

    # 2. Per-bar average for each descriptor. bar_counts (slices assigned to
    #    each bar) doubles as the transient-rate signal for density below —
    #    slice boundaries are real fluid.bufampslice~ onsets, so this is a
    #    genuine event count, not a derived proxy.
    bar_sums   = [{d: 0.0 for d in DESCRIPTORS} for _ in range(n_bars)]
    bar_counts = [0] * n_bars
    for key in slice_keys:
        b = bar_of[key]
        s = slices_dict[key]
        for d in DESCRIPTORS:
            bar_sums[b][d] += get_descriptor(s, d)
        bar_counts[b] += 1

    bar_avgs = []
    for b in range(n_bars):
        cnt = bar_counts[b] if bar_counts[b] > 0 else 1
        bar_avgs.append({d: bar_sums[b][d] / cnt for d in DESCRIPTORS})

    # 3 & 4. Slope + normalize per descriptor
    tension_per_bar = {}
    for d in DESCRIPTORS:
        raw_values = [bar_avgs[b][d] for b in range(n_bars)]
        slopes     = sliding_slope(raw_values, w)
        normed     = normalize(slopes)
        tension_per_bar[d] = normed   # index = bar index

    # 6. Density per bar — E level (loudness) + transient rate (real onset
    #    count within the bar). Both normalized within this track before
    #    blending — see module docstring for why.
    e_level_raw        = [bar_avgs[b]['E'] for b in range(n_bars)]
    transient_rate_raw = [float(bar_counts[b]) for b in range(n_bars)]
    e_level_norm        = normalize(e_level_raw)
    transient_rate_norm = normalize(transient_rate_raw)
    density_per_bar = [
        DENSITY_E_WEIGHT * e_level_norm[b] + DENSITY_TRANSIENT_WEIGHT * transient_rate_norm[b]
        for b in range(n_bars)
    ]

    # 5 & 7. Write tension + density back to each slice
    for key in slice_keys:
        b = bar_of[key]
        s = slices_dict[key]
        for d in DESCRIPTORS:
            s[f'tension_{d}'] = round(tension_per_bar[d][b], 4)
        s['density'] = round(density_per_bar[b], 4)
        s['dense']   = bool(density_per_bar[b] >= DENSITY_THRESHOLD)

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    # Parse args
    filter_name = None
    w = WINDOW
    args = sys.argv[1:]
    for a in args:
        if a.startswith('--window'):
            try:
                w = int(a.split('=')[-1]) if '=' in a else int(args[args.index(a)+1])
            except (IndexError, ValueError):
                pass
        elif not a.startswith('--'):
            filter_name = a.lower()

    lib      = load_max_json(ANALYSIS_PATH)
    beats_db = load_max_json(DOWNBEATS_PATH)

    track_keys = list(lib.keys())
    if filter_name:
        track_keys = [k for k in track_keys if filter_name in k.lower()]
        print(f'Filtering to {len(track_keys)} matching track(s)')

    SHORT = {'vocals': 'vocals', 'melody': 'melo', 'bass': 'bass', 'drums': 'drums'}

    # Group stem keys by base track name so we print one header per track
    from collections import OrderedDict
    groups = OrderedDict()
    for tk in track_keys:
        bn = strip_stem_suffix(tk)
        groups.setdefault(bn, []).append(tk)

    changed = 0
    for base_name, stem_keys in groups.items():
        # Find downbeats entry
        beats_entry = beats_db.get(base_name)
        if beats_entry is None:
            for bk in beats_db:
                if base_name in bk or bk in base_name:
                    beats_entry = beats_db[bk]
                    break
        if beats_entry is None:
            print(f'⚠  no downbeats for "{base_name}" — skipping')
            continue

        downbeats_ms = beats_entry.get('downbeats_ms', [])
        stem_parts = []

        for track_key in stem_keys:
            track_data = lib[track_key]
            for stem_name, stem_data in track_data.items():
                slices_dict = stem_data.get('slices', {})
                metadata    = stem_data.get('metadata', {})
                if not slices_dict:
                    continue
                process_stem(slices_dict, metadata, downbeats_ms, w)
                label = SHORT.get(stem_name, stem_name)
                stem_parts.append(f'[{label}] {len(slices_dict)} slices')
                changed += 1

        if stem_parts:
            hdr = base_name[:28] + ('…' if len(base_name) > 28 else '')
            print(f'{hdr}  ({len(downbeats_ms)} bars, window={w})')
            print('  ' + '  '.join(stem_parts))
            print()

    if changed == 0:
        print('\nNothing processed — check track name filter or downbeats.json coverage.')
        return

    with open(ANALYSIS_PATH, 'w') as f:
        json.dump(lib, f)

    # Persist into the per-session ebys.db. import_library.py is session-aware
    # (resolves data/sessions/<id>/ from current_session.txt exactly as this
    # script does) and open_db() creates the DB + schema on first run, so this
    # works whether or not the DB existed yet — no "run import_library.py first"
    # dead end.
    #
    # We do a FULL import here rather than a tension-only UPDATE: a freshly
    # analyzed track isn't in the DB until an import runs, so a targeted UPDATE
    # would match 0 rows and the tension would never land. The `lib` we just
    # wrote already has tension baked into every slice, so importing it now
    # persists descriptors + tension together in one pass. Genres/downbeats are
    # folded in too so the track's DB row is complete.
    try:
        import import_library as il
        conn = il.open_db()
        n_slices = il.import_library(conn, lib)          # tracks + slices (tension included)
        if os.path.exists(il.GENRES_PATH):
            il.import_genres(conn, il.load_max_json(il.GENRES_PATH))
        if os.path.exists(il.DOWNBEATS_PATH):
            il.import_downbeats(conn, il.load_max_json(il.DOWNBEATS_PATH))
        conn.close()
        session = os.path.basename(os.path.dirname(il.DB_PATH))
        print(f'→ ebys.db synced ({session}/ebys.db — {n_slices} slice rows)')
    except Exception as e:
        print(f'⚠  ebys.db sync failed: {e}')

if __name__ == '__main__':
    main()
