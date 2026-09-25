#!/usr/bin/env python3
"""
Gnumbat — Learned Bias Trainer (PyTorch)

Replaces train_bias.py (numpy OLS, removed 2026-09-01 — user: "delete the
numpy system. i want pytorch"). Same job, same input files, same output
consumer (slicer.js's predictHorizontalQuality()/predictVerticalQuality()),
same feature engineering — every function down to build_horizontal_dataset()/
build_vertical_dataset() below is a direct copy from the deleted file,
unchanged, specifically so the features a live descriptor combination gets
turned into are identical to what this trainer saw. Only the fitting
mechanism changed: a small ReLU MLP (2 -> N -> 1 layer network) trained by
gradient descent, instead of one direct OLS solve.

WHY THIS EXISTS: OLS can only ever add up independent per-feature
contributions — it structurally cannot represent "this dimension only
matters when combined with that one" (e.g. bass energy dropping AND vocal
centroid climbing together = a real rise; either alone doesn't mean much).
A hidden layer with a non-linear activation can learn that kind of
interaction. The tradeoff: it needs meaningfully more data to trust (see
REQUIRED_SAMPLE_MULTIPLIER below) and its weights aren't individually
readable the way OLS's were — see the worked comparison this session ran
(6-sample toy: no benefit, net degenerated to the same linear fit OLS found;
200-sample toy with a real interaction: OLS held-out R^2 = -0.14, net
R^2 = 0.78). Below that data threshold this script intentionally refuses to
write a model, exactly like the file it replaces did.

Usage:
  source ~/gnumbat-env/bin/activate   (or wherever the demucs_env venv lives)
  pip install torch                (one-time — not previously a project dependency)
  cd ~/wherever/EBYS/src/demucs

  python3 train_bias_torch.py                              # uses data/current
  python3 train_bias_torch.py --data-dir ../../data/sessions/default
  python3 train_bias_torch.py --hidden-dim 12 --epochs 800
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone

import numpy as np
import torch
import torch.nn as nn

DESC_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T']
STEM_KEYS = ['vocals', 'melody', 'bass', 'drums']
TENSION_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T']

# Vertical model's raw feature set (2026-09-01 redesign): 7 live
# descriptors + density (D), no tension. Tension stays a live-telemetry /
# momentum-graph-only quantity — it is not an ML input for :scoreLyr's
# model any more. Kept separate from DESC_DIMS/TENSION_DIMS/
# all_dims_with_keys(), which are unchanged and used by the horizontal
# path only. Mirrors slicer_bridge.js's VERTICAL_RAW_DIMS — keep both lists
# identical.
VERTICAL_RAW_DIMS = ['C', 'S', 'E', 'F', 'P', 'H', 'T', 'D']

# A hidden-layer model has far more parameters than OLS did for the same
# feature count (hidden_dim * (n_features + 2) + 1, vs n_features + 1) — see
# REQUIRED_SAMPLE_MULTIPLIER below, which is deliberately stricter than the
# 3x floor train_bias.py used, since a network this size overfits more
# readily than a straight line does.
DEFAULT_MIN_SAMPLES = 15
DEFAULT_HIDDEN_DIM = 8
REQUIRED_SAMPLE_MULTIPLIER = 5
DEFAULT_EPOCHS = 600
VAL_FRACTION = 0.2
MIN_VAL_SAMPLES = 8  # below this, a held-out split isn't meaningful — train on everything instead


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
                continue
    return rows


def load_fit_shapes(data_dir):
    """Unchanged from train_bias.py — reads fit_shapes.json (:setFitShape).
    Kept for continuity even though a hidden layer learns curvature and
    cross-dimension interactions on its own: a dim someone already flagged
    quadratic/cubic still gets that explicit extra feature too, since it
    costs the network nothing to have it and removes one thing to
    re-litigate when comparing fits across the two trainers."""
    path_ = os.path.join(data_dir, 'fit_shapes.json')
    if not os.path.exists(path_):
        return {}
    try:
        with open(path_) as f:
            shapes = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    return {label: shape for label, shape in shapes.items() if shape in ('quadratic', 'cubic')}


def all_dims_with_keys():
    pairs = [(d, d) for d in DESC_DIMS]
    pairs += [('Tn' + d, 'tension_' + d) for d in TENSION_DIMS]
    return pairs


def horizontal_feature_names(dim_shapes=None):
    dim_shapes = dim_shapes or {}
    names = []
    for label, _ in all_dims_with_keys():
        names.append('delta' + label)
    for label, _ in all_dims_with_keys():
        names.append('absDelta' + label)
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) in ('quadratic', 'cubic'):
            names.append('sq' + label)
    for label, _ in all_dims_with_keys():
        if dim_shapes.get(label) == 'cubic':
            names.append('cu' + label)
    return names


def build_horizontal_dataset(rows, dim_shapes=None):
    """Unchanged from train_bias.py — see that file's history for the full
    rationale (each :scoreTrs entry can cover 1..4 stems, each present stem
    is its own training example sharing that entry's rating)."""
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
    """2026-09-01 redesign: every :scoreLyr entry now carries a `samples`
    list — one combined 4-stem C/S/E/F/P/H/T/D snapshot per genuinely-new
    moment captured throughout the baked segment (bracket-open -> score
    time), captured by gui_hub_bridge.js and already deduped there against
    tickLiveDesc()'s repeated-slice ticks. Each sample dict becomes its own
    training example (feature = mean+std of each VERTICAL_RAW_DIMS dim
    across whichever of the 4 stems have it, floor of 2 so std is
    meaningful), all sharing that JSONL row's single `rating` — so one
    :scoreLyr call now contributes many rows to X, not one. Rows with no
    `samples` field (old-format data, e.g. from before this redesign)
    contribute 0 examples rather than falling back to the old
    stems/descriptors shape or crashing."""
    dim_shapes = dim_shapes or {}
    X, y = [], []
    for row in rows:
        rating = row.get('rating')
        samples = row.get('samples')
        if rating is None or not samples:
            continue
        for sample in samples:
            per_dim_values = {dim: [] for dim in VERTICAL_RAW_DIMS}
            for stem_key in STEM_KEYS:
                desc = sample.get(stem_key) or {}
                for dim in VERTICAL_RAW_DIMS:
                    v = desc.get(dim)
                    if v is not None:
                        try:
                            per_dim_values[dim].append(float(v))
                        except (TypeError, ValueError):
                            pass
            if any(len(per_dim_values[dim]) < 2 for dim in VERTICAL_RAW_DIMS):
                continue
            feat = []
            means = {}
            for dim in VERTICAL_RAW_DIMS:
                vals = np.array(per_dim_values[dim], dtype=float)
                m = float(np.mean(vals))
                means[dim] = m
                feat.append(m)
                feat.append(float(np.std(vals)))
            for dim in VERTICAL_RAW_DIMS:
                if dim_shapes.get(dim) in ('quadratic', 'cubic'):
                    feat.append(means[dim] * means[dim])
            for dim in VERTICAL_RAW_DIMS:
                if dim_shapes.get(dim) == 'cubic':
                    feat.append(means[dim] ** 3)
            X.append(feat)
            y.append(rating)
    return np.array(X, dtype=float), np.array(y, dtype=float)


class TinyMLP(nn.Module):
    """2-layer network: n_features -> hidden_dim (ReLU) -> 1. This is
    exactly the shape worked through in this session's example, just sized
    to the real feature count instead of a 2-feature toy."""
    def __init__(self, n_features, hidden_dim):
        super().__init__()
        self.hidden = nn.Linear(n_features, hidden_dim)
        self.relu = nn.ReLU()
        self.output = nn.Linear(hidden_dim, 1)

    def forward(self, x):
        return self.output(self.relu(self.hidden(x)))


def train_section(name, X, y, feature_names, min_samples, hidden_dim, epochs):
    n = X.shape[0]
    n_params = hidden_dim * (len(feature_names) + 2) + 1
    required = max(min_samples, REQUIRED_SAMPLE_MULTIPLIER * n_params)
    if n < required:
        print(f"[{name}] {n} sample(s) — need at least {required} "
              f"({REQUIRED_SAMPLE_MULTIPLIER}x the {n_params} model parameters at "
              f"hidden_dim={hidden_dim}, or --min-samples={min_samples}, whichever "
              f"is larger) to fit safely — skipping. Lower --hidden-dim to fit "
              f"sooner with less data, at the cost of representing fewer "
              f"interactions.")
        return None

    Xt = torch.tensor(X, dtype=torch.float32)
    yt = torch.tensor(y, dtype=torch.float32).unsqueeze(1)

    # Held-out split — only when there's enough to make it meaningful.
    # Below MIN_VAL_SAMPLES, train on everything and say so plainly rather
    # than report an R^2 computed on 2 or 3 points, which is noise dressed
    # up as a number.
    n_val = int(n * VAL_FRACTION)
    has_val = n_val >= MIN_VAL_SAMPLES
    if has_val:
        rng = np.random.default_rng(0)
        idx = rng.permutation(n)
        val_idx, train_idx = idx[:n_val], idx[n_val:]
        Xt_train, yt_train = Xt[train_idx], yt[train_idx]
        Xt_val, yt_val = Xt[val_idx], yt[val_idx]
    else:
        Xt_train, yt_train = Xt, yt
        Xt_val, yt_val = None, None

    torch.manual_seed(0)
    net = TinyMLP(len(feature_names), hidden_dim)
    opt = torch.optim.Adam(net.parameters(), lr=0.01, weight_decay=1e-4)
    loss_fn = nn.MSELoss()

    for epoch in range(epochs):
        opt.zero_grad()
        loss = loss_fn(net(Xt_train), yt_train)
        loss.backward()
        opt.step()

    with torch.no_grad():
        if has_val:
            pred = net(Xt_val).squeeze(1).numpy()
            actual = yt_val.squeeze(1).numpy()
            r2_note = "held-out"
        else:
            pred = net(Xt_train).squeeze(1).numpy()
            actual = yt_train.squeeze(1).numpy()
            r2_note = "in-sample (too little data for a held-out check)"
        ss_res = float(np.sum((actual - pred) ** 2))
        ss_tot = float(np.sum((actual - actual.mean()) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-9 else 0.0

    print(f"[{name}] fit on {len(Xt_train)} samples (hidden_dim={hidden_dim}, "
          f"{epochs} epochs) — {r2_note} R^2={r2:.3f}")
    if r2 < 0.1:
        print(f"[{name}] warning: R^2 is very low — this model won't predict "
              f"much better than guessing the average rating yet. More data "
              f"(more :scoreLyr/:scoreTrs judgments) should improve it.")
    elif not has_val:
        print(f"[{name}] note: no held-out check was possible yet (need "
              f"{MIN_VAL_SAMPLES} more samples set aside) — treat this R^2 as "
              f"optimistic until there's enough data for a real check.")

    hidden_w = net.hidden.weight.detach().numpy().tolist()   # hidden_dim x n_features
    hidden_b = net.hidden.bias.detach().numpy().tolist()     # hidden_dim
    output_w = net.output.weight.detach().numpy().flatten().tolist()  # hidden_dim
    output_b = float(net.output.bias.detach().numpy()[0])

    return {
        'feature_names': feature_names,
        'hidden_dim': hidden_dim,
        'hidden_w': hidden_w,
        'hidden_b': hidden_b,
        'output_w': output_w,
        'output_b': output_b,
        'n_samples': n,
        'r2': r2,
        'r2_kind': 'held_out' if has_val else 'in_sample',
        'trained_at': datetime.now(timezone.utc).isoformat(),
    }


def main():
    ap = argparse.ArgumentParser(description='Train Gnumbat learned-bias models (PyTorch MLP) from :scoreLyr/:scoreTrs logs')
    ap.add_argument('--data-dir', default=None, help='Session data dir containing the training_log_*.jsonl files (default: data/current)')
    ap.add_argument('--out', default=None, help='Output path for learned_bias.json (default: <data-dir>/learned_bias.json)')
    ap.add_argument('--min-samples', type=int, default=DEFAULT_MIN_SAMPLES)
    ap.add_argument('--hidden-dim', type=int, default=DEFAULT_HIDDEN_DIM,
                     help='hidden units per model — more can represent more interactions, but raises the sample floor (see REQUIRED_SAMPLE_MULTIPLIER)')
    ap.add_argument('--epochs', type=int, default=DEFAULT_EPOCHS)
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
              f"cubic term added for: {', '.join(cubic_only) or 'none'}")

    Xh, yh = build_horizontal_dataset(horiz_rows, dim_shapes)
    Xv, yv = build_vertical_dataset(vert_rows, dim_shapes)

    horizontal_model = train_section('horizontal', Xh, yh, horizontal_feature_names(dim_shapes),
                                      args.min_samples, args.hidden_dim, args.epochs)

    vert_feature_names = []
    for dim in VERTICAL_RAW_DIMS:
        vert_feature_names.append('mean' + dim)
        vert_feature_names.append('std' + dim)
    for dim in VERTICAL_RAW_DIMS:
        if dim_shapes.get(dim) in ('quadratic', 'cubic'):
            vert_feature_names.append('sqMean' + dim)
    for dim in VERTICAL_RAW_DIMS:
        if dim_shapes.get(dim) == 'cubic':
            vert_feature_names.append('cuMean' + dim)
    vertical_model = train_section('vertical', Xv, yv, vert_feature_names,
                                    args.min_samples, args.hidden_dim, args.epochs)

    out = {
        'model_kind': 'mlp',  # slicer_bridge.js's loadLearnedBias() branches on this —
                               # absent/old files (OLS's flat {weights,bias}) are treated
                               # as "no model yet" rather than crashing on a shape mismatch.
        'horizontal': horizontal_model,
        'vertical': vertical_model,
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
