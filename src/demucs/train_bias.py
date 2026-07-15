#!/usr/bin/env python3
"""
EBYS — Learned Bias Trainer

Offline trainer that closes the loop between the human-judgment logs
(:score / :scoreTransition, written by ws_server.js) and slicer.js's live
candidate scoring. Nothing in the real-time engine changes on its own —
this script reads whatever has been logged so far, fits two small linear
models, and writes learned_bias.json. slicer.js loads that file (see
loadLearnedBias() there) and blends its predictions into scoreCandidate()
as an additional term, scaled by the per-stem :setLearnedWeight knob.

Two independent signals, two independent models:

  1. TRANSITION quality — from training_log_transition.jsonl (:scoreTransition).
     Each logged entry has, per stem, a `from` slice's descriptors and a `to`
     slice's descriptors, plus one -1..1 rating for how well that specific cut
     flowed. Feature = the per-descriptor delta (to - from) for C/E/F/P/H/T —
     the same 6 dimensions slicer.js already tracks in lastEndDesc, so the
     runtime side can compute the identical feature at scoring time
     (candidate[d] - endDesc[d]) with no new state needed.

  2. VERTICAL / mix quality — from training_log_vertical.jsonl (:score).
     Each entry rates the whole 4-stem combination at one instant. There's no
     natural per-stem feature here — it's a judgment about how the 4 stems'
     current states sit together — so the feature is the mean and standard
     deviation of each descriptor (C/E/F/P/H/T) ACROSS the 4 stems' current
     values. 12 features total. This is deliberately generic (not
     hand-designed "clash" heuristics) — with real data accumulated, the
     fitted weights themselves will reveal which of mean/std per descriptor
     actually correlates with a good mix, rather than us guessing upfront.

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

DESC_DIMS = ['C', 'E', 'F', 'P', 'H', 'T']
STEM_KEYS = ['vocals', 'melody', 'bass', 'drums']

# Below this many examples, OLS is more likely to be fitting noise than
# signal (6 features + bias = 7 unknowns for transition; 12 + bias = 13 for
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


def transition_feature_names():
    # Both signed delta AND |delta| per dimension — deliberately not assuming
    # upfront whether "did this cut flow well" is a DIRECTIONAL preference
    # (linear in delta, like DIR_PREF) or a SMOOTHNESS preference (small
    # magnitude = good regardless of direction, like MATCH_PROB's diff²).
    # Early testing on synthetic data showed a magnitude-based relationship
    # (rating dropping as |deltaE| grows in EITHER direction) fits terribly
    # with signed-delta-only features — R^2 near zero even though the
    # underlying relationship was strong. Including both lets the fitted
    # weights reveal which kind of relationship actually holds per
    # descriptor, instead of us guessing.
    names = []
    for d in DESC_DIMS:
        names.append('delta' + d)
    for d in DESC_DIMS:
        names.append('absDelta' + d)
    return names


def build_transition_dataset(rows):
    """Each logged :scoreTransition entry can cover 1..4 stems (stemFilter or
    all 4) — every stem present is its own training example, sharing that
    entry's rating. Skips a stem-entry if either side is missing a
    descriptor for any of the 6 dims (partial slice data, e.g. still loading)."""
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
                deltas = [float(to[d]) - float(frm[d]) for d in DESC_DIMS]
            except (KeyError, TypeError, ValueError):
                continue
            X.append(deltas + [abs(v) for v in deltas])
            y.append(rating)
    return np.array(X, dtype=float), np.array(y, dtype=float)


def build_vertical_dataset(rows):
    """Each logged :score entry rates the whole 4-stem combo as ONE example
    (not one per stem, unlike transitions) — the judgment is inherently about
    all 4 together. Feature = mean + std of each descriptor across whichever
    stems have valid descriptors right now (fewer than 4 is fine — a stem can
    be silent/unloaded; mean/std just adapt to however many are present, with
    a floor of 2 so "spread" is still meaningful)."""
    X, y = [], []
    for row in rows:
        rating = row.get('rating')
        stems = row.get('stems') or {}
        if rating is None:
            continue
        per_dim_values = {d: [] for d in DESC_DIMS}
        for stem_key in STEM_KEYS:
            desc = (stems.get(stem_key) or {}).get('descriptors') or {}
            for d in DESC_DIMS:
                v = desc.get(d)
                if v is not None:
                    try:
                        per_dim_values[d].append(float(v))
                    except (TypeError, ValueError):
                        pass
        if any(len(per_dim_values[d]) < 2 for d in DESC_DIMS):
            continue
        feat = []
        for d in DESC_DIMS:
            vals = np.array(per_dim_values[d], dtype=float)
            feat.append(float(np.mean(vals)))
            feat.append(float(np.std(vals)))
        X.append(feat)
        y.append(rating)
    return np.array(X, dtype=float), np.array(y, dtype=float)


def train_section(name, X, y, feature_names, min_samples):
    n = X.shape[0]
    n_params = len(feature_names) + 1  # + bias
    # A flat --min-samples floor isn't enough on its own: the vertical model
    # has 12 features (13 params w/ bias) and the transition model has 12 too
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
              f"(more :score/:scoreTransition judgments) should improve it.")
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
    ap = argparse.ArgumentParser(description='Train EBYS learned-bias models from :score/:scoreTransition logs')
    ap.add_argument('--data-dir', default=None, help='Session data dir containing the training_log_*.jsonl files (default: data/current)')
    ap.add_argument('--out', default=None, help='Output path for learned_bias.json (default: <data-dir>/learned_bias.json)')
    ap.add_argument('--min-samples', type=int, default=DEFAULT_MIN_SAMPLES)
    args = ap.parse_args()

    data_dir = args.data_dir or default_data_dir()
    out_path = args.out or os.path.join(data_dir, 'learned_bias.json')

    trans_path = os.path.join(data_dir, 'training_log_transition.jsonl')
    vert_path = os.path.join(data_dir, 'training_log_vertical.jsonl')

    trans_rows = read_jsonl(trans_path)
    vert_rows = read_jsonl(vert_path)
    print(f"data dir: {data_dir}")
    print(f"transition log: {len(trans_rows)} entries ({trans_path})")
    print(f"vertical log:   {len(vert_rows)} entries ({vert_path})")

    Xt, yt = build_transition_dataset(trans_rows)
    Xv, yv = build_vertical_dataset(vert_rows)

    transition_model = train_section('transition', Xt, yt, transition_feature_names(), args.min_samples)

    vert_feature_names = []
    for d in DESC_DIMS:
        vert_feature_names.append('mean' + d)
        vert_feature_names.append('std' + d)
    vertical_model = train_section('vertical', Xv, yv, vert_feature_names, args.min_samples)

    out = {
        'transition': transition_model,
        'vertical': vertical_model,
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"wrote {out_path}")
    if transition_model is None and vertical_model is None:
        print("Neither model had enough data — learned_bias.json written with both "
              "sections null. slicer.js will treat this as \"no learned bias yet\" "
              "and behave exactly as before. Keep using :score / :scoreTransition "
              "and re-run this script later.")


if __name__ == '__main__':
    main()
