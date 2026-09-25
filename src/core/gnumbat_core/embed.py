"""Embedding spaces over Bakes.

A *space* = (feature set, analysis profile, set of Bakes) -> standardised vectors. Everything
about how the picture was made is recorded (`embedding.json`) so a Bake Map never has to
pretend it shows "musical similarity" — it shows one feature representation.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import numpy as np

from .analysis.registry import BUILTIN_FEATURE_SETS, FEATURES, feature_dims
from .jsonio import atomic_write_json, content_hash, read_json, sha256_bytes, canonical_dumps, utc_now
from .schema import validate

EMBEDDING_SCHEMA = "gnumbat.embedding/0.1"
ENV_POINTS = 8


class EmbedError(RuntimeError):
    pass


def load_feature_set(lib, feature_set_id: str) -> dict:
    p = lib.root / "feature_sets" / f"{feature_set_id}.json"
    if p.exists():
        fs = read_json(p)
    elif feature_set_id in BUILTIN_FEATURE_SETS:
        fs = BUILTIN_FEATURE_SETS[feature_set_id]
    else:
        raise EmbedError(f"unknown feature set {feature_set_id!r}")
    validate("feature_set", fs)
    return fs


def column_names(fs: dict, source_names: list[str]) -> list[str]:
    sources = source_names if fs["sources"] == "all" else [s for s in fs["sources"]]
    cols = []
    for src in sources:
        for fid in fs["features"]:
            if fid not in FEATURES:
                continue
            if FEATURES[fid]["kind"] == "scalar":
                cols.append(f"{src}/{fid}/value")
                continue
            for d in range(feature_dims(fid)):
                for st in fs["stats"]:
                    if st == "envelope":
                        cols += [f"{src}/{fid}#{d}/env{k}" for k in range(ENV_POINTS)]
                    else:
                        cols.append(f"{src}/{fid}#{d}/{st}")
    return cols


def _value(analysis: dict, col: str) -> float:
    src, fid_d, stat = col.split("/")
    s = next((x for x in analysis["sources"] if x["name"] == src), None)
    if s is None:
        return np.nan
    if stat == "value":
        v = (s.get("scalars") or {}).get(fid_d)
        return float(v) if v is not None else np.nan
    fid, d = fid_d.split("#")
    e = s["summary"].get(fid)
    if not e or int(d) >= len(e["dims"]):
        return np.nan
    dim = e["dims"][int(d)]
    if stat.startswith("env"):
        return float(dim["envelope"][int(stat[3:])])
    return float(dim[stat])


def build_space(lib, feature_set_id: str, bake_ids: list[str] | None = None, persist: bool = True) -> dict:
    """-> {"record": embedding.json doc, "X": standardised [n, d] float64, "bake_ids": [...]}"""
    fs = load_feature_set(lib, feature_set_id)
    excluded, usable = [], []
    for bid in (bake_ids if bake_ids is not None else lib.list_bake_ids()):
        try:
            st = lib.read_state(bid)
            a = lib.read_analysis(bid) if st["current"]["analysis_id"] else None
        except Exception as e:  # noqa: BLE001
            excluded.append({"bake_id": bid, "reason": f"unreadable: {e}"})
            continue
        if a is None:
            excluded.append({"bake_id": bid, "reason": "no analysis yet"})
        else:
            usable.append((bid, a))
    if not usable:
        raise EmbedError("no analysed Bakes")
    prof_of = lambda a: (a["extractor"]["name"], a["extractor"]["config_hash"])
    majority = sorted(Counter(prof_of(a) for _, a in usable).items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    keep = []
    for bid, a in usable:
        if prof_of(a) == majority:
            keep.append((bid, a))
        else:
            excluded.append({"bake_id": bid, "reason": f"different analysis profile ({a['extractor']['name']})"})
    keep.sort(key=lambda t: t[0])
    src_names = sorted({s["name"] for _, a in keep for s in a["sources"]}, key=lambda n: (n != "mix", n))
    cols = column_names(fs, src_names)
    M = np.array([[_value(a, c) for c in cols] for _, a in keep], dtype=np.float64)
    all_nan = np.all(np.isnan(M), axis=0)
    M, cols = M[:, ~all_nan], [c for c, drop in zip(cols, all_nan) if not drop]
    if M.shape[1] == 0:
        raise EmbedError(f"feature set {feature_set_id!r} has no data in these analyses")
    col_mean = np.nanmean(M, axis=0)
    inds = np.where(np.isnan(M))
    M[inds] = np.take(col_mean, inds[1])
    mean = M.mean(axis=0)
    std = M.std(axis=0)
    varying = std > 1e-9
    if not varying.any():  # e.g. one Bake, or identical Bakes: keep a zero-variance space rather than fail
        varying[:] = True
    X = (M[:, varying] - mean[varying]) / np.where(std[varying] > 1e-9, std[varying], 1.0)
    cols = [c for c, v in zip(cols, varying) if v]
    mean, std = mean[varying], np.where(std[varying] > 1e-9, std[varying], 1.0)
    bake_ids_out = [b for b, _ in keep]
    emb_id = "em_" + sha256_bytes(canonical_dumps({
        "fs": fs, "profile": list(majority), "items": [(b, a["analysis_id"]) for b, a in keep]}).encode())[:20]
    record = {
        "schema": EMBEDDING_SCHEMA, "embedding_id": emb_id, "kind": "feature_summary", "created_at": utc_now(),
        "feature_set": {"feature_set_id": fs["feature_set_id"], "version": fs["version"]}, "model_version_id": None,
        "analysis_profile": {"extractor": majority[0], "config_hash": majority[1]},
        "bake_ids": bake_ids_out, "dim": int(X.shape[1]), "columns": cols,
        "normalization": {"mean": [float(v) for v in mean], "std": [float(v) for v in std]},
        "files": {"vectors": "vectors.npy"}, "excluded": excluded,
    }
    validate("embedding", record)
    if persist:
        d = lib.derived_dir / "embeddings" / emb_id
        d.mkdir(parents=True, exist_ok=True)
        np.save(d / "vectors.npy", X.astype(np.float32))
        atomic_write_json(d / "embedding.json", record)
    return {"record": record, "X": X, "bake_ids": bake_ids_out}
