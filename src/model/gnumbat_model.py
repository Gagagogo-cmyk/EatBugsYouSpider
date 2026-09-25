#!/usr/bin/env python3
"""
gnumbat_model.py -- words -> FluCoMa descriptor curves.

A small neural network, trained per Gnumbat MODEL, that learns from that model's Bakes how the
words you write ("weird nosy rise #inharmonic #spiral") translate into how the sound moves: the
FluCoMa descriptors of each Demucs stem (vocals / melody / bass / drums) over the Bake's length.

    python3 gnumbat_model.py dataset  [--model md_...] [--all]            # what would be trained on
    python3 gnumbat_model.py train    --model md_... [--all] [--epochs N]  # -> a new model version
    python3 gnumbat_model.py generate --model md_... "weird nosy rise #spiral" [--out curves.json]

Only numpy is needed, so the same file runs on your Mac, on a server, or anywhere else, and the
weights it writes are plain JSON (easy to load from the plugin's C++ later).

DATA (nothing is copied; everything is read where it already lives)
  words   <library>/bakes/<id>/semantic.json   raw_notation (#words = tags) + tags
  weight  <library>/bakes/<id>/semantic.json   fields.votes_up / votes_down   (the "weighted" part)
  model   <library>/bakes/<id>/bake.json       model_id  (+ handoff.session / handoff.track)
          model list: the EBYS hub registry (as cached by the plugin in <library>/hub/models_cache.json)
  sound   <EBYS>/data/sessions/<session>/analysis_library.json
            [<track>][vocals|melody|bass|drums].slices.slice_NNNN = {C,S,P,E,F,H,M0..M5}
          written by the headless Pd patch (FluCoMa) after Demucs.  <track> = "<notation-slug>__<bake_id>".

TARGET  per stem, per descriptor, a curve of T=32 steps across the Bake, built from the slices in
        slice order (slice_0001, slice_0002, ... = the order the Pd slicer wrote them). Hz-valued
        descriptors (C centroid, S spread, P pitch) are learned in octaves (log2 Hz); P below 40 Hz
        (unvoiced) and drums' P (never written) are simply "unknown" and don't count in the loss.
        Every descriptor is z-scored with statistics stored in the version.

NETWORK text -> hashed bag of words / #tags / character trigrams (so "nosy" and "noisy" share
        most of their features and unseen words still land somewhere sensible) -> 2 tanh layers
        -> 8 smooth (cosine) curve coefficients per stem x descriptor -> 32-step curves.
        Loss = masked mean-squared error, each Bake weighted by its votes (and by 0.5 if it is
        inherited from a parent model).
"""
import argparse
import datetime as _dt
import json
import math
import os
import re
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

SCHEMA_VERSION = "gnumbat.model_version/0.1"
STEMS = ["vocals", "melody", "bass", "drums"]
STEM_ALIASES = {"melody": ["melody", "melo"]}
FEATS = ["C", "S", "P", "E", "F", "H", "M0", "M1", "M2", "M3", "M4", "M5"]
FEAT_NAMES = {"C": "spectral centroid (Hz)", "S": "spectral spread (Hz)", "P": "pitch (Hz)",
              "E": "loudness", "F": "spectral flatness", "H": "H", "M0": "mfcc 0", "M1": "mfcc 1",
              "M2": "mfcc 2", "M3": "mfcc 3", "M4": "mfcc 4", "M5": "mfcc 5"}
HZ_FEATS = {"C", "S", "P"}
T = 32          # steps per curve
K = 8           # cosine coefficients per curve (smoothness)
HASH_DIM = 1024
HIDDEN = 96


# ------------------------------------------------------------------------------------ paths / io
def default_library():
    env = os.environ.get("GNUMBAT_LIBRARY")
    if env:
        return Path(env).expanduser()
    return Path.home() / "Documents" / "Gnumbat" / "library"


def default_ebys():
    env = os.environ.get("GNUMBAT_EBYS_ROOT")
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parents[2]      # EBYS/src/model/gnumbat_model.py -> EBYS


def read_json(p, default=None):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json_atomic(p, obj, indent=None):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=p.name + ".", suffix=".part", dir=str(p.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp, p)


def utc_now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ------------------------------------------------------------------------------------ text
TAG_RE = re.compile(r"#([\w\-]+)", re.UNICODE)


def split_notation(text):
    """'weird nosy rise #inharmonic #spiral' -> (['weird','nosy','rise'], ['inharmonic','spiral'])"""
    text = text or ""
    tags = [t.lower() for t in TAG_RE.findall(text)]
    plain = TAG_RE.sub(" ", text)
    words = [w for w in re.split(r"[^\w]+", plain.lower(), flags=re.UNICODE) if w and not w.isdigit()]
    return words, tags


def text_features(words, tags):
    """Hashed, signed bag of features, L2-normalised. Stable across machines (crc32, not hash())."""
    v = np.zeros(HASH_DIM, dtype=np.float64)

    def add(tok, w):
        h = zlib.crc32(tok.encode("utf-8"))
        v[h % HASH_DIM] += w if (h >> 31) & 1 == 0 else -w

    for w in words:
        add("w:" + w, 1.0)
        padded = "<" + w + ">"
        for i in range(len(padded) - 2):
            add("c:" + padded[i:i + 3], 0.35)
    for t in tags:
        add("t:" + t, 2.0)          # an explicit #tag counts more than a loose word
        add("w:" + t, 0.5)          # ...and still relates to the same word written without '#'
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def bake_text(sem):
    words, tags = split_notation(sem.get("raw_notation") or sem.get("notation") or "")
    for t in sem.get("tags") or []:
        t = str(t).lower()
        if t not in tags:
            tags.append(t)
    return words, tags


# ------------------------------------------------------------------------------------ curves
def cosine_basis():
    t = np.arange(T)
    return np.stack([np.cos(math.pi * k * (t + 0.5) / T) for k in range(K)])     # (K, T)


def stem_slices(track_entry, stem):
    for name in STEM_ALIASES.get(stem, [stem]):
        s = (track_entry or {}).get(name)
        if isinstance(s, dict) and isinstance(s.get("slices"), dict) and s["slices"]:
            sl = s["slices"]
            return [sl[k] for k in sorted(sl)]
    return []


def raw_curves(track_entry):
    """(STEMS, FEATS, T) array in the learning domain (log2 Hz for Hz feats), NaN = unknown."""
    out = np.full((len(STEMS), len(FEATS), T), np.nan)
    for si, stem in enumerate(STEMS):
        slices = stem_slices(track_entry, stem)
        n = len(slices)
        if n == 0:
            continue
        for fi, f in enumerate(FEATS):
            vals = np.array([float(s[f]) if isinstance(s.get(f), (int, float)) else np.nan for s in slices])
            if f == "P":
                vals[vals < 40.0] = np.nan
            if f in HZ_FEATS:
                vals = np.where(vals > 0, np.log2(np.maximum(vals, 1e-9)), np.nan)
            for t in range(T):
                a = int(math.floor(t * n / T))
                b = max(a + 1, int(math.floor((t + 1) * n / T)))
                seg = vals[a:b]
                seg = seg[~np.isnan(seg)]
                if seg.size:
                    out[si, fi, t] = seg.mean()
    return out


# ------------------------------------------------------------------------------------ dataset
def load_models(library):
    """The shared model list: the EBYS hub registry (the same list panel.html and the plugin's
    MODEL page show), read from the plugin's cache of it (<library>/hub/models_cache.json).
    Older plugin-only models (<library>/models/*/model.json) are still read if present."""
    models = {}
    cache = read_json(library / "hub" / "models_cache.json", {}) or {}
    for c in cache.get("models") or []:
        if c.get("hash"):
            models[c["hash"]] = {"model_id": c["hash"], "name": c.get("name") or "(untitled)",
                                 "parent_model_id": c.get("parentId"), "from_hub": True,
                                 "latest_version_id": (read_json(library / "models" / c["hash"] / "latest.json", {}) or {}).get("latest_version_id")}
    for mj in (library / "models").glob("*/model.json"):
        m = read_json(mj, {})
        if m.get("model_id"):
            models[m["model_id"]] = m
    return models


def lineage(models, model_id):
    """[model, parent, grandparent, ...]"""
    chain, seen = [], set()
    while model_id and model_id in models and model_id not in seen:
        seen.add(model_id)
        chain.append(model_id)
        model_id = models[model_id].get("parent_model_id")
    return chain


class AnalysisIndex:
    """Reads each session's analysis_library.json once."""

    def __init__(self, ebys):
        self.ebys = ebys
        self.cache = {}

    def session(self, sid):
        if sid not in self.cache:
            self.cache[sid] = read_json(self.ebys / "data" / "sessions" / sid / "analysis_library.json", {}) or {}
        return self.cache[sid]

    def sessions(self):
        d = self.ebys / "data" / "sessions"
        return sorted(p.name for p in d.iterdir() if p.is_dir()) if d.is_dir() else []

    def find(self, bake_id, handoff):
        if isinstance(handoff, dict) and handoff.get("session") and handoff.get("track"):
            entry = self.session(handoff["session"]).get(handoff["track"])
            if entry:
                return handoff["session"], handoff["track"], entry
        suffix = "__" + bake_id
        for sid in self.sessions():
            for track, entry in self.session(sid).items():
                if track.endswith(suffix):
                    return sid, track, entry
        return None, None, None


def vote_weight(sem):
    f = sem.get("fields") or {}
    up = len(f.get("votes_up") or [])
    down = len(f.get("votes_down") or [])
    return max(0.1, 1.0 + 0.5 * (up - down)), up, down


def collect(library, ebys, model_id=None, include_all=False, verbose=False):
    models = load_models(library)
    chain = lineage(models, model_id) if model_id else []
    idx = AnalysisIndex(ebys)
    rows, skipped = [], []
    for bdir in sorted((library / "bakes").glob("bk_*")):
        bake = read_json(bdir / "bake.json", {}) or {}
        sem = read_json(bdir / "semantic.json", {}) or {}
        bid = bake.get("bake_id") or bdir.name
        owner = bake.get("model_id")
        if include_all:
            inherit = 1.0
        elif owner and owner in chain:
            inherit = 1.0 if owner == model_id else 0.5
        else:
            continue
        sid, track, entry = idx.find(bid, bake.get("handoff"))
        if entry is None:
            skipped.append((bid, "no FluCoMa analysis yet (not in any analysis_library.json)"))
            continue
        curves = raw_curves(entry)
        if np.isnan(curves).all():
            skipped.append((bid, "analysis has no slices"))
            continue
        words, tags = bake_text(sem)
        vw, up, down = vote_weight(sem)
        rows.append({"bake_id": bid, "session": sid, "track": track, "words": words, "tags": tags,
                     "weight": vw * inherit, "votes": [up, down], "inherited": inherit < 1.0, "curves": curves})
    return rows, skipped


# ------------------------------------------------------------------------------------ network
class Net:
    def __init__(self, rng, out_dim):
        s1, s2, s3 = 1 / math.sqrt(HASH_DIM), 1 / math.sqrt(HIDDEN), 0.1 / math.sqrt(HIDDEN)
        self.p = {
            "W1": rng.normal(0, s1 * 4, (HASH_DIM, HIDDEN)), "b1": np.zeros(HIDDEN),
            "W2": rng.normal(0, s2, (HIDDEN, HIDDEN)), "b2": np.zeros(HIDDEN),
            "W3": rng.normal(0, s3, (HIDDEN, out_dim)), "b3": np.zeros(out_dim),
        }

    def forward(self, X):
        p = self.p
        h1 = np.tanh(X @ p["W1"] + p["b1"])
        h2 = np.tanh(h1 @ p["W2"] + p["b2"])
        return h1, h2, h2 @ p["W3"] + p["b3"]

    def backward(self, X, h1, h2, dout):
        p = self.p
        g = {"W3": h2.T @ dout, "b3": dout.sum(0)}
        dh2 = dout @ p["W3"].T * (1 - h2 ** 2)
        g["W2"], g["b2"] = h1.T @ dh2, dh2.sum(0)
        dh1 = dh2 @ p["W2"].T * (1 - h1 ** 2)
        g["W1"], g["b1"] = X.T @ dh1, dh1.sum(0)
        return g


def train(rows, epochs=1500, lr=3e-3, weight_decay=1e-4, seed=0, log=print):
    B = cosine_basis()                                         # (K, T)
    Y = np.stack([r["curves"] for r in rows])                  # (N, S, F, T) raw domain
    M = ~np.isnan(Y)
    # per stem x feature z-score
    mean = np.zeros((len(STEMS), len(FEATS)))
    std = np.ones((len(STEMS), len(FEATS)))
    for si in range(len(STEMS)):
        for fi in range(len(FEATS)):
            v = Y[:, si, fi][M[:, si, fi]]
            if v.size:
                mean[si, fi] = v.mean()
                std[si, fi] = max(v.std(), 1e-3)
    Z = np.where(M, (Y - mean[None, :, :, None]) / std[None, :, :, None], 0.0)
    X = np.stack([text_features(r["words"], r["tags"]) for r in rows])
    w = np.array([r["weight"] for r in rows])
    Wm = M * w[:, None, None, None]
    denom = max(Wm.sum(), 1.0)

    rng = np.random.default_rng(seed)
    out_dim = len(STEMS) * len(FEATS) * K
    net = Net(rng, out_dim)
    # start from the (weighted) average curve: unknown words -> the model's average movement
    Bpinv = np.linalg.pinv(B)                                  # (T, K)
    avg = (Z * Wm).sum(0) / np.maximum(Wm.sum(0), 1e-9)        # (S, F, T)
    net.p["b3"] = (avg @ Bpinv).reshape(-1)

    m = {k: np.zeros_like(v) for k, v in net.p.items()}
    v2 = {k: np.zeros_like(v) for k, v in net.p.items()}
    b1, b2, eps = 0.9, 0.999, 1e-8
    losses = []
    for ep in range(1, epochs + 1):
        h1, h2, out = net.forward(X)
        coef = out.reshape(len(rows), len(STEMS), len(FEATS), K)
        pred = coef @ B                                        # (N, S, F, T)
        diff = (pred - Z) * Wm
        loss = float(((pred - Z) ** 2 * Wm).sum() / denom)
        losses.append(loss)
        dpred = 2 * diff / denom
        dcoef = dpred @ B.T                                    # (N, S, F, K)
        g = net.backward(X, h1, h2, dcoef.reshape(len(rows), -1))
        for k in net.p:
            if k.startswith("W"):
                g[k] = g[k] + weight_decay * net.p[k]
            m[k] = b1 * m[k] + (1 - b1) * g[k]
            v2[k] = b2 * v2[k] + (1 - b2) * g[k] ** 2
            mh = m[k] / (1 - b1 ** ep)
            vh = v2[k] / (1 - b2 ** ep)
            net.p[k] -= lr * mh / (np.sqrt(vh) + eps)
        if log and (ep == 1 or ep % max(1, epochs // 10) == 0):
            log(f"  epoch {ep:5d}   loss {loss:.4f}")
    baseline = float(((avg[None] - Z) ** 2 * Wm).sum() / denom)
    return net, mean, std, losses, baseline


def predict(version, weights, text):
    words, tags = split_notation(text)
    x = text_features(words, tags)[None]
    p = {k: np.asarray(v, dtype=np.float64) for k, v in weights.items()}
    h1 = np.tanh(x @ p["W1"] + p["b1"])
    h2 = np.tanh(h1 @ p["W2"] + p["b2"])
    out = h2 @ p["W3"] + p["b3"]
    B = cosine_basis()
    z = out.reshape(len(STEMS), len(FEATS), K) @ B
    mean = np.asarray(version["normalisation"]["mean"])
    std = np.asarray(version["normalisation"]["std"])
    y = z * std[:, :, None] + mean[:, :, None]
    known = np.asarray(version["normalisation"]["known"], dtype=bool)
    res = {}
    for si, stem in enumerate(STEMS):
        d = {}
        for fi, f in enumerate(FEATS):
            if not known[si, fi]:
                continue
            curve = y[si, fi]
            if f in HZ_FEATS:
                curve = np.power(2.0, curve)
            d[f] = [round(float(c), 4) for c in curve]
        if d:
            res[stem] = d
    return {"text": text, "words": words, "tags": tags, "steps": T, "stems": res}


# ------------------------------------------------------------------------------------ commands
def resolve_model(library, model_arg):
    models = load_models(library)
    if model_arg in models:
        return models[model_arg]
    by_name = [m for m in models.values() if m.get("name") == model_arg]
    if not by_name:
        by_name = [m for m in models.values() if m["model_id"].startswith(model_arg)] if len(model_arg) >= 6 else []
    if len(by_name) == 1:
        return by_name[0]
    names = ", ".join(f"{m.get('name')} ({mid})" for mid, m in models.items()) or "none"
    sys.exit(f"no model '{model_arg}' in {library}/models  (available: {names})")


def cmd_dataset(a):
    model = resolve_model(a.library, a.model) if a.model else None
    rows, skipped = collect(a.library, a.ebys, model and model["model_id"], a.all or model is None)
    print(f"{len(rows)} bakes usable" + (f" for model '{model['name']}'" if model else " (all bakes)"))
    for r in rows:
        stems = [STEMS[i] for i in range(len(STEMS)) if not np.isnan(r["curves"][i]).all()]
        print(f"  {r['bake_id']}  w={r['weight']:.2f}  {' '.join(r['words'])}  #{' #'.join(r['tags'])}  [{', '.join(stems)}]")
    for bid, why in skipped:
        print(f"  skip {bid}: {why}")


def cmd_train(a):
    model = resolve_model(a.library, a.model)
    mid = model["model_id"]
    rows, skipped = collect(a.library, a.ebys, mid, a.all)
    for bid, why in skipped:
        print(f"  skip {bid}: {why}")
    if len(rows) < 2:
        sys.exit(f"only {len(rows)} usable bake(s) for '{model['name']}' -- need at least 2 with FluCoMa analysis"
                 + ("" if a.all else " (bakes need bake.json model_id = this model; --all uses every bake)"))
    print(f"training '{model['name']}' on {len(rows)} bakes ...")
    net, mean, std, losses, baseline = train(rows, epochs=a.epochs, seed=a.seed)
    known = np.zeros((len(STEMS), len(FEATS)), dtype=bool)
    for r in rows:
        known |= ~np.isnan(r["curves"]).all(axis=2)
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    vid = f"mv_{stamp}"
    vdir = a.library / "models" / mid / "versions" / vid
    version = {
        "schema": SCHEMA_VERSION, "version_id": vid, "model_id": mid, "model_name": model.get("name"),
        "parent_version_id": model.get("latest_version_id"), "created_at": utc_now(),
        "task": "text -> flucoma descriptor curves",
        "architecture": {"type": "mlp", "input": {"kind": "hashed_bag", "dim": HASH_DIM, "hash": "crc32",
                                                   "tokens": "w:<word> (1.0), c:<char trigram of <word>> (0.35), t:<#tag> (2.0) + w:<tag> (0.5), signed, L2-normalised"},
                         "hidden": [HIDDEN, HIDDEN], "activation": "tanh",
                         "output": {"kind": "cosine_basis", "coefficients": K, "steps": T,
                                    "basis": "cos(pi*k*(t+0.5)/T)", "layout": "stem, feature, coefficient"}},
        "stems": STEMS, "features": FEATS, "feature_names": FEAT_NAMES,
        "hz_features_in_log2": sorted(HZ_FEATS),
        "normalisation": {"mean": mean.round(6).tolist(), "std": std.round(6).tolist(), "known": known.tolist()},
        "training": {"bakes": [{"bake_id": r["bake_id"], "session": r["session"], "track": r["track"],
                                "weight": round(r["weight"], 3), "votes": r["votes"], "inherited": r["inherited"]} for r in rows],
                     "epochs": a.epochs, "seed": a.seed, "final_loss": round(losses[-1], 5),
                     "average_curve_loss": round(baseline, 5), "vote_weighting": "max(0.1, 1 + 0.5*(up-down)); inherited x0.5"},
        "weights_file": "weights.json",
    }
    write_json_atomic(vdir / "weights.json", {k: np.round(v, 6).tolist() for k, v in net.p.items()})
    write_json_atomic(vdir / "version.json", version, indent=2)
    if model.get("from_hub"):
        # hub models live in EBYS's registry; the trained versions stay beside the library
        write_json_atomic(a.library / "models" / mid / "latest.json",
                          {"model_id": mid, "latest_version_id": vid, "updated_at": utc_now()}, indent=2)
    else:
        model = dict(model)
        model.pop("from_hub", None)
        model["latest_version_id"] = vid
        model["modified_at"] = utc_now()
        write_json_atomic(a.library / "models" / mid / "model.json", model, indent=2)
    print(f"saved {vdir}\n  loss {losses[-1]:.4f}  (average-curve baseline {baseline:.4f})")


def cmd_generate(a):
    model = resolve_model(a.library, a.model)
    vid = a.version or model.get("latest_version_id")
    if not vid:
        sys.exit(f"model '{model['name']}' has no trained version yet -- run: train --model {model['model_id']}")
    vdir = a.library / "models" / model["model_id"] / "versions" / vid
    version = read_json(vdir / "version.json")
    weights = read_json(vdir / "weights.json")
    if not version or not weights:
        sys.exit(f"cannot read {vdir}")
    res = predict(version, weights, a.text)
    res["model_id"], res["version_id"] = model["model_id"], vid
    if a.out:
        write_json_atomic(a.out, res, indent=1)
        print(f"wrote {a.out}")
    else:
        spark = " .:-=+*#%@"
        print(f"{model['name']} / {vid}:  words {res['words']}  tags {res['tags']}")
        for stem, feats in res["stems"].items():
            for f in ("C", "E", "F", "P"):
                if f in feats:
                    c = np.array(feats[f]); lo, hi = c.min(), c.max()
                    line = "".join(spark[int((x - lo) / (hi - lo + 1e-12) * (len(spark) - 1))] for x in c)
                    print(f"  {stem:6s} {f}  {line}  {lo:9.2f} .. {hi:9.2f}   {FEAT_NAMES[f]}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--library", type=Path, default=default_library(), help="Gnumbat library folder")
    ap.add_argument("--ebys", type=Path, default=default_ebys(), help="EBYS repo root (data/sessions/...)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dataset"); d.add_argument("--model"); d.add_argument("--all", action="store_true")
    t = sub.add_parser("train"); t.add_argument("--model", required=True); t.add_argument("--all", action="store_true")
    t.add_argument("--epochs", type=int, default=1500); t.add_argument("--seed", type=int, default=0)
    g = sub.add_parser("generate"); g.add_argument("--model", required=True); g.add_argument("text")
    g.add_argument("--version"); g.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    a.library = a.library.expanduser()
    a.ebys = a.ebys.expanduser()
    {"dataset": cmd_dataset, "train": cmd_train, "generate": cmd_generate}[a.cmd](a)


if __name__ == "__main__":
    main()
