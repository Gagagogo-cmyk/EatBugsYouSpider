#!/usr/bin/env python3
"""
EBYS — Learned Bias Trainer

Offline trainer that closes the loop between the human-judgment logs
(:scoreLyr / :scoreTrs, written by ws_server.js) and slicer.js's live
candidate scoring. Nothing in the real-time engine changes on its own —
this script reads whatever has been logged so far, fits two small linear
models, and writes learned_bias.json. slicer.js loads that file (see
loadLearnedBias() there) and blends its predictions into scoreCandidate()
as an additional term, scaled by the per-stem :setLearnedWeight knob.

Two independent signals, two independent models — named after the same
horizontal/vertical pair the rest of EBYS already uses (the timeline runs
horizontally, stems stack vertically):

  1. HORIZONTAL quality — from training_log_horizontal.jsonl (:scoreTrs).
     Each logged entry has, per stem, a `from` slice's descriptors and a `to`
     slice's descriptors, plus one -1..1 rating for how well that specific cut
     flowed. Feature = the per-descriptor delta (to - from) for C/S/E/F/P/H/T
     (7 level dims) PLUS the same delta treatment applied to tension_C/S/E/F/P/H/T
     (7 tension dims — see TENSION_DIMS below) — 14 dims × 2
     (signed + absolute delta) = 28 features. The 7 level dims are the same
     ones slicer.js already tracks in lastEndDesc, so the runtime side can
     compute the identical feature at scoring time (candidate[d] - endDesc[d])
     with no new state needed.

  2. VERTICAL / mix quality — from training_log_vertical.jsonl (:scoreLyr).
     Each entry rates the whole 4-stem combination at one instant. There's no
     natural per-stem feature here — it's a judgment about how the 4 stems'
     current states sit together — so the feature is the mean and standard
     deviation of each of the same 14 level+tension dims ACROSS the 4 stems'
     current values. 28 features total. This is deliberately generic (not
     hand-designed "clash" heuristics) — with real data accumulated, the
     fitted weights themselves will reveal which of mean/std per dimension
     actually correlates with a good mix, rather than us guessing upfront.

  Neither model's feature count doubled by accident: adding a dimension
  means it needs BOTH the level treatment (if it's a level descriptor) and
  potentially the tension treatment (if add_tension.py computes it) — more
  weights than either alone. See the min-sample gate below: more parameters
  raises the data bar before a fit is trusted, it isn't free.

Both models are fit with ordinary least squares (numpy, no other ML
dependency) since ratings are continuous -1..1, not binary labels.

Usage:
  source ~/ebys-env/bin/activate   (or wherever the demucs_env venv lives)
  cd ~/wherever/EBYS/src/demucs

  python3 train_bias.py                              # uses data/current
  python3 train_bias.py --data-dir ../../data/sessions/default
  python3 train_bias.py --min-samples 15
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone

import numpy as np

DESC_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T']
STEM_KEYS = ['vocals', 'melody', 'bass', 'drums']

# Tension dims — normalized [0,1] per-track slope-of-descriptor-over-bars,
# written by add_tension.py (see that file's docstring for the full
# computation: per-bar average → sliding-window slope → min-max normalize).
# A genuinely different KIND of signal than DESC_DIMS above — trend/momentum
# rather than level — not a redundant copy of the same information.
# All 7, matching DESC_DIMS one-for-one — add_tension.py's own DESCRIPTORS
# list computes tension_S too now (it used to skip S; existing libraries
# need add_tension.py re-run once to backfill tension_S onto already-
# analyzed tracks).
TENSION_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T']

# Below this many examples, OLS is more likely to be fitting noise than
# signal (6 features + bias = 7 unknowns for horizontal; 12 + bias = 13 for
# vertical). This is a floor, not a guarantee of a GOOD fit — just enough to
# not solve a near-singular system. Small-N runs will print an R^2 so it's
# obvious when the fit isn't trustworthy yet even above this floor.
DEFAULT_MIN_SAMPLES = 15


def default_data_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, '..', '..', 'data', 'current'))


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                # Skip a corrupt line rather than aborting the whole run —
                # append-only logs written by a live process can occasionally
                # end up with a partial last line if the process was killed
                # mid-write.
                continue
    return rows


def load_fit_shapes(data_dir):
    """Reads fit_shapes.json (written by the TUI's :setFitShape command) —
    a plain {dim_label: 'quadratic'|'cubic'} map. Missing file or missing
    entry both mean 'linear', the default. Returns a dict of label -> shape
    for every dim explicitly opted up (never contains 'linear' itself — a
    dim with no entry here IS linear). Read once at the START of a run,
    before any feature matrix is built — a shape change only takes effect
    on the next :trainBias, same as any other config the trainer reads once
    and fits against.

    'cubic' is a strict extension of 'quadratic', not a separate branch: a
    dim flagged cubic gets BOTH the sq<label> and cu<label> terms (see
    horizontal_feature_names()/build_*_dataset() below), so the fit can
    represent any real cubic shape rather than being forced through the
    origin-symmetric x^3-only curve a cubic term alone would give."""
    path_ = os.path.join(data_dir, 'fit_shapes.json')
    if not os.path.exists(path_):
        return {}
    try:
        with open(path_) as f:
            shapes = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    return {label: shape for label, shape in shapes.items() if shape in ('quadratic', 'cubic')}


def fit_ols(X, y):
    """Ordinary least squares via numpy's lstsq, with a bias column appended.
    Returns (weights: list[float] matching input feature order, bias: float,
    r2: float)."""
    n = X.shape[0]
    X_aug = np.hstack([X, np.ones((n, 1))])
    coeffs, _residuals, _rank, _sv = np.linalg.lstsq(X_aug, y, rcond=None)
    weights, bias = coeffs[:-1], coeffs[-1]

    y_pred = X_aug @ coeffs
    ss_res = float(np.sum((y - y_pred) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-9 else 0.0

    return weights.tolist(), float(bias), r2


def all_dims_with_keys():
    """Every scalar feature source used by both models, as (short_label,
    lookup_key) pairs. Level descriptors (DESC_DIMS) are looked up by their
    bare letter in a logged descriptors{} blob. Tension descriptors
    (TENSION_DIMS) are looked up via 'tension_<letter>' (matching how
    ws_server.js logs them) and given a short label prefixed 'Tn' so they
    don't collide with T (timbre) in printed weight names — e.g. tension_C's
    short label is 'TnC', not 'TC'."""
    pairs = [(d, d) for d in DESC_DIMS]
    pairs += [('Tn' + d, 'tension_' + d) for d in TENSION_DIMS]
    return pairs


def horizontal_feature_names(dim_shapes=None):
    # Both signed delta AND |delta| per dimension — deliberately not assuming
    # upfront whether "did this cut flow well" is a DIRECTIONAL preference
    # (linear in delta, like DIR_PREF) or a SMOOTHNESS preference (small
    # magnitude = good regardless of direction, like MATCH_PROB's diff²).
    # Early testing on synthetic data showed a magnitude-based relationship
    # (rating dropping as |deltaE| grows in EITHER direction) fits terribly
    # with signed-delta-only features — R^2 near zero even though the
    # underlying relationship was strong. Including both lets the fitted
    # weights reveal which kind of relationship actually holds per
    # descriptor, instead of us guessing. Same treatment applied uniformly to
    # tension dims below — no separate feature type invented for them, even
    # though they're a different KIND of signal (trend, not level): keeping
    # every dim's feature construction identical is simpler to reason about
    # than a bespoke design per dim.
    dim_shapes = dim_shapes or {}
    names = []
    for label, _ in all_dims_with_keys():
        names.append('delta' + label)
    for label, _ in all_dims_with_keys():
        names.append('absDelta' + label)
    # Quadratic opt-in (:setFitShape) — one extra term per dim someone
    # deliberately flipped to 'quadratic' (or 'cubic', which includes this
    # term too — see load_fit_shapes()) after looking at the bake graph.
    # sq<label> = delta*delta, which is exactly absDelta squared — squaring
    # already discards the sign, so there's no separate "signed square" to
    # also offer here the way delta/absDelta both exist above.
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) in ('quadratic', 'cubic'):
            names.append('sq' + label)
    # Cubic opt-in — one more term still, only for dims flagged all the way
    # up to 'cubic'. cu<label> = delta**3 — unlike sq, this one keeps its
    # sign (a cubic is an odd-ish extra term, needed for curves that aren't
    # symmetric around delta=0, e.g. "a positive push helps a lot but a
    # negative one only hurts a little").
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) == 'cubic':
            names.append('cu' + label)
    return names


def build_horizontal_dataset(rows, dim_shapes=None):
    """Each logged :scoreTrs entry can cover 1..4 stems (stemFilter or
    all 4) — every stem present is its own training example, sharing that
    entry's rating. Skips a stem-entry if either side is missing ANY of the
    now-14 lookup keys (7 level + 7 tension) — logs written before add_tension.py
    started computing tension_S won't have that key at all, so old entries
    are correctly excluded rather than silently padded with fabricated
    zeros. Re-run add_tension.py (to backfill tension_S) and
    :scoreLyr/:scoreTrs to accumulate usable examples."""
    dim_shapes = dim_shapes or {}
    dims = all_dims_with_keys()
    X, y = [], []
    for row in rows:
        rating = row.get('rating')
        stems = row.get('stems') or {}
        if rating is None:
            continue
        for stem_key, pair in stems.items():
            frm = (pair or {}).get('from', {}).get('descriptors') or {}
            to = (pair or {}).get('to', {}).get('descriptors') or {}
            if not frm or not to:
                continue
            try:
                deltas = [float(to[key]) - float(frm[key]) for _, key in dims]
            except (KeyError, TypeError, ValueError):
                continue
            abs_deltas = [abs(v) for v in deltas]
            sq_terms = [d * d for (label, _), d in zip(dims, deltas)
                        if dim_shapes.get(label) in ('quadratic', 'cubic')]
            cu_terms = [d * d * d for (label, _), d in zip(dims, deltas)
                        if dim_shapes.get(label) == 'cubic']
            X.append(deltas + abs_deltas + sq_terms + cu_terms)
            y.append(rating)
    return np.array(X, dtype=float), np.array(y, dtype=float)


def build_vertical_dataset(rows, dim_shapes=None):
    """Each logged :scoreLyr entry rates the whole 4-stem combo as ONE example
    (not one per stem, unlike horizontal) — the judgment is inherently about
    all 4 together. Feature = mean + std of each level/tension dim across
    whichever stems have valid values right now (fewer than 4 is fine — a
    stem can be silent/unloaded; mean/std just adapt to however many are
    present, with a floor of 2 so "spread" is still meaningful). Quadratic
    opt-in (:setFitShape) adds meanX-squared per flagged dim — lets the fit
    curve, e.g. "medium is good, both extremes are bad", instead of forcing
    a straight line through a shape that visibly isn't one. Cubic opt-in
    adds meanX-cubed on top of that, for dims where even "medium is good"
    isn't symmetric."""
    dim_shapes = dim_shapes or {}
    dims = all_dims_with_keys()
    X, y = [], []
    for row in rows:
        rating = row.get('rating')
        stems = row.get('stems') or {}
        if rating is None:
            continue
        per_dim_values = {label: [] for label, _ in dims}
        for stem_key in STEM_KEYS:
            desc = (stems.get(stem_key) or {}).get('descriptors') or {}
            for label, key in dims:
                v = desc.get(key)
                if v is not None:
                    try:
                        per_dim_values[label].append(float(v))
                    except (TypeError, ValueError):
                        pass
        if any(len(per_dim_values[label]) < 2 for label, _ in dims):
            continue
        feat = []
        means = {}
        for label, _ in dims:
            vals = np.array(per_dim_values[label], dtype=float)
            m = float(np.mean(vals))
            means[label] = m
            feat.append(m)
            feat.append(float(np.std(vals)))
        for label, _ in dims:
            if dim_shapes.get(label) in ('quadratic', 'cubic'):
                feat.append(means[label] * means[label])
        for label, _ in dims:
            if dim_shapes.get(label) == 'cubic':
                feat.append(means[label] ** 3)
        X.append(feat)
        y.append(rating)
    return np.array(X, dtype=float), np.array(y, dtype=float)


def train_section(name, X, y, feature_names, min_samples):
    n = X.shape[0]
    n_params = len(feature_names) + 1  # + bias
    # A flat --min-samples floor isn't enough on its own: the vertical model
    # has 12 features (13 params w/ bias) and the horizontal model has 12 too
    # — at n close to n_params, OLS can fit almost ANY data near-perfectly
    # (a high R^2 that means nothing, not a real relationship). Require some
    # comfortable multiple of the parameter count on top of whatever floor
    # was passed in, so a technically-"enough" sample count that's still too
    # close to saturating the model gets skipped instead of silently
    # producing a misleadingly confident-looking fit.
    required = max(min_samples, 3 * n_params)
    if n < required:
        print(f"[{name}] {n} sample(s) — need at least {required} "
              f"(3x the {n_params} model parameters, or --min-samples="
              f"{min_samples}, whichever is larger) to fit safely — skipping")
        return None
    weights, bias, r2 = fit_ols(X, y)
    print(f"[{name}] fit on {n} samples — R^2={r2:.3f}")
    for fname, w in zip(feature_names, weights):
        print(f"    {fname:>8}: {w:+.4f}")
    print(f"    {'bias':>8}: {bias:+.4f}")
    if r2 < 0.1:
        print(f"[{name}] warning: R^2 is very low — this model won't predict "
              f"much better than guessing the average rating yet. More data "
              f"(more :scoreLyr/:scoreTrs judgments) should improve it.")
    elif n < 5 * n_params:
        print(f"[{name}] note: R^2 looks OK but n={n} is still not far past "
              f"the {required}-sample floor — treat this fit as provisional "
              f"until more data comes in.")
    return {
        'weights': dict(zip(feature_names, weights)),
        'bias': bias,
        'n_samples': n,
        'r2': r2,
        'trained_at': datetime.now(timezone.utc).isoformat(),
    }


def main():
    ap = argparse.ArgumentParser(description='Train EBYS learned-bias models from :scoreLyr/:scoreTrs logs')
    ap.add_argument('--data-dir', default=None, help='Session data dir containing the training_log_*.jsonl files (default: data/current)')
    ap.add_argument('--out', default=None, help='Output path for learned_bias.json (default: <data-dir>/learned_bias.json)')
    ap.add_argument('--min-samples', type=int, default=DEFAULT_MIN_SAMPLES)
    args = ap.parse_args()

    data_dir = args.data_dir or default_data_dir()
    out_path = args.out or os.path.join(data_dir, 'learned_bias.json')

    horiz_path = os.path.join(data_dir, 'training_log_horizontal.jsonl')
    vert_path = os.path.join(data_dir, 'training_log_vertical.jsonl')

    horiz_rows = read_jsonl(horiz_path)
    vert_rows = read_jsonl(vert_path)
    print(f"data dir: {data_dir}")
    print(f"horizontal log: {len(horiz_rows)} entries ({horiz_path})")
    print(f"vertical log:   {len(vert_rows)} entries ({vert_path})")

    dim_shapes = load_fit_shapes(data_dir)
    if dim_shapes:
        quad_or_up = sorted(l for l, s in dim_shapes.items() if s in ('quadratic', 'cubic'))
        cubic_only = sorted(l for l, s in dim_shapes.items() if s == 'cubic')
        print(f"non-linear dims (from fit_shapes.json): {', '.join(sorted(dim_shapes))} "
              f"— quadratic term added for: {', '.join(quad_or_up) or 'none'}; "
              f"cubic term added for: {', '.join(cubic_only) or 'none'} "
              f"— each adds one more weight per model, raising the 3x-parameters floor below")

    Xh, yh = build_horizontal_dataset(horiz_rows, dim_shapes)
    Xv, yv = build_vertical_dataset(vert_rows, dim_shapes)

    horizontal_model = train_section('horizontal', Xh, yh, horizontal_feature_names(dim_shapes), args.min_samples)

    vert_feature_names = []
    for label, _ in all_dims_with_keys():
        vert_feature_names.append('mean' + label)
        vert_feature_names.append('std' + label)
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) in ('quadratic', 'cubic'):
            vert_feature_names.append('sqMean' + label)
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) == 'cubic':
            vert_feature_names.append('cuMean' + label)
    vertical_model = train_section('vertical', Xv, yv, vert_feature_names, args.min_samples)

    out = {
        'horizontal': horizontal_model,
        'vertical': vertical_model,
        # Replaces the old 'quadratic_dims' array — slicer.js now reads this
        # single {label: shape} map instead (see loadLearnedBias() there),
        # since a dim can now be quadratic OR cubic, not just "quadratic or
        # not". dim_shapes is already exactly this shape (it's what
        # load_fit_shapes() returned above), so no reshaping needed.
        'dim_shapes': dim_shapes,
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"wrote {out_path}")
    if horizontal_model is None and vertical_model is None:
        print("Neither model had enough data — learned_bias.json written with both "
              "sections null. slicer.js will treat this as \"no learned bias yet\" "
              "and behave exactly as before. Keep using :scoreLyr / :scoreTrs "
              "and re-run this script later.")


if __name__ == '__main__':
    main()
