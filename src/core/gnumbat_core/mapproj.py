"""Bake Map projection: PCA and t-SNE, implemented here (numpy) so results are reproducible
across machines/library versions, warm-startable, and free of heavyweight dependencies.
UMAP / model embeddings plug in through ``METHODS`` without touching the plugin.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from .embed import build_space, load_feature_set
from .jsonio import atomic_write_json, read_json, utc_now
from .schema import validate

MAP_SCHEMA = "gnumbat.map/0.1"
MIN_TSNE_POINTS = 8


def _sq_dists(X: np.ndarray) -> np.ndarray:
    s = np.sum(X * X, axis=1)
    D = s[:, None] + s[None, :] - 2.0 * (X @ X.T)
    np.maximum(D, 0.0, out=D)
    np.fill_diagonal(D, 0.0)
    return D


def pca(X: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    Xc = X - X.mean(axis=0)
    U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
    k = min(k, Vt.shape[0])
    for i in range(k):  # fix SVD sign ambiguity so output is deterministic across LAPACKs
        if Vt[i, np.argmax(np.abs(Vt[i]))] < 0:
            Vt[i] *= -1
    Y = Xc @ Vt[:k].T
    var = (S ** 2) / max(Xc.shape[0] - 1, 1)
    return Y, var[:k] / max(var.sum(), 1e-12)


def _joint_p(X: np.ndarray, perplexity: float) -> np.ndarray:
    n = X.shape[0]
    D = _sq_dists(X)
    P = np.zeros((n, n))
    target = np.log(perplexity)
    for i in range(n):
        d = np.delete(D[i], i)
        beta, lo, hi = 1.0, -np.inf, np.inf
        for _ in range(60):
            e = np.exp(-(d - d.min()) * beta)
            s = e.sum()
            H = np.log(s) + beta * np.sum((d - d.min()) * e) / s
            if abs(H - target) < 1e-5:
                break
            if H > target:
                lo = beta
                beta = beta * 2 if hi == np.inf else (beta + hi) / 2
            else:
                hi = beta
                beta = beta / 2 if lo == -np.inf else (beta + lo) / 2
        P[i, np.arange(n) != i] = e / s
    P = (P + P.T) / (2.0 * n)
    return np.maximum(P, 1e-12)


def tsne(X: np.ndarray, perplexity: float | None = None, n_iter: int = 750, seed: int = 0,
         Y0: np.ndarray | None = None, exaggeration: float = 12.0) -> np.ndarray:
    n = X.shape[0]
    perplexity = float(perplexity or min(30.0, max(2.0, (n - 1) / 3.0)))
    P = _joint_p(X, perplexity)
    warm = Y0 is not None
    if warm:
        Y = np.array(Y0, dtype=np.float64)
        exag, exag_iters, mom0, mom1 = 1.0, 0, 0.8, 0.8
    else:
        Y, _ = pca(X, 2)
        if Y.shape[1] < 2:
            Y = np.hstack([Y, np.zeros((n, 2 - Y.shape[1]))])
        Y = Y / max(np.std(Y[:, 0]), 1e-12) * 1e-4
        exag, exag_iters, mom0, mom1 = exaggeration, 250, 0.5, 0.8
    lr = max(n / max(exag if not warm else 4.0, 1.0) / 4.0, 50.0)
    upd = np.zeros_like(Y)
    gains = np.ones_like(Y)
    for it in range(n_iter):
        s = np.sum(Y * Y, axis=1)
        num = 1.0 / (1.0 + s[:, None] + s[None, :] - 2.0 * (Y @ Y.T))
        np.fill_diagonal(num, 0.0)
        Q = np.maximum(num / num.sum(), 1e-12)
        e = exag if it < exag_iters else 1.0
        PQ = (e * P - Q) * num
        grad = 4.0 * (PQ.sum(axis=1)[:, None] * Y - PQ @ Y)
        gains = np.where(np.sign(grad) != np.sign(upd), gains + 0.2, gains * 0.8)
        np.maximum(gains, 0.01, out=gains)
        mom = mom0 if it < exag_iters else mom1
        upd = mom * upd - lr * gains * grad
        Y = Y + upd
        Y -= Y.mean(axis=0)
    return Y


def trustworthiness(X: np.ndarray, Y: np.ndarray, k: int = 5) -> float | None:
    n = X.shape[0]
    if n <= 2 * k + 1:
        return None
    Dx, Dy = _sq_dists(X), _sq_dists(Y)
    np.fill_diagonal(Dx, np.inf)
    np.fill_diagonal(Dy, np.inf)
    rank_x = np.argsort(np.argsort(Dx, axis=1), axis=1) + 1  # 1 = nearest
    nn_y = np.argsort(Dy, axis=1)[:, :k]
    pen = 0.0
    for i in range(n):
        r = rank_x[i, nn_y[i]]
        pen += float(np.sum(np.maximum(r - k, 0)))
    return float(1.0 - 2.0 / (n * k * (2 * n - 3 * k - 1)) * pen)


def _stable_jitter(bake_id: str, scale: float) -> np.ndarray:
    h = hashlib.sha256(bake_id.encode()).digest()
    return (np.frombuffer(h[:16], dtype=np.uint8).astype(np.float64)[:2] / 255.0 - 0.5) * 2.0 * scale


def map_path(lib, feature_set_id: str) -> Path:
    return lib.derived_dir / "maps" / f"{feature_set_id}.json"


def project_map(lib, feature_set_id: str = "spectral", method: str = "tsne", seed: int = 0, n_iter: int = 750,
                warm_iters: int = 300, perplexity: float | None = None, warm_start: bool = True,
                pca_dims: int = 50) -> dict:
    """Compute and persist ``derived/maps/<feature_set_id>.json``."""
    space = build_space(lib, feature_set_id)
    X, bake_ids, rec = space["X"], space["bake_ids"], space["record"]
    n = len(bake_ids)
    Xr = X
    if X.shape[1] > pca_dims and n > 2:
        Xr, _ = pca(X, min(pca_dims, n - 1))
    used, note, warm_used = method, "", False
    if method == "pca" or n < MIN_TSNE_POINTS:
        used = "pca"
        if method != "pca":
            note = f"only {n} Bakes (< {MIN_TSNE_POINTS}); showing PCA instead of t-SNE"
        if n == 1:
            Y = np.zeros((1, 2))
        else:
            Y, _ = pca(X, 2)
            if Y.shape[1] < 2:
                Y = np.hstack([Y, np.zeros((n, 2 - Y.shape[1]))])
        params = {}
    else:
        used = "tsne"
        Y0 = None
        prev_p = map_path(lib, feature_set_id)
        if warm_start and prev_p.exists():
            try:
                prev = read_json(prev_p)
                if prev["method"]["name"] == "tsne" and prev.get("scale"):
                    old = {p["bake_id"]: np.array([p["x"], p["y"]]) * prev["scale"] for p in prev["points"]}
                    idx_old = [i for i, b in enumerate(bake_ids) if b in old]
                    if len(idx_old) >= 4:
                        Y0 = np.zeros((n, 2))
                        for i in idx_old:
                            Y0[i] = old[bake_ids[i]]
                        jit = float(np.std(Y0[idx_old])) * 0.05
                        for i in range(n):
                            if bake_ids[i] not in old:
                                d = np.sum((Xr[idx_old] - Xr[i]) ** 2, axis=1)
                                Y0[i] = Y0[idx_old[int(np.argmin(d))]] + _stable_jitter(bake_ids[i], jit)
                        warm_used = True
            except Exception:  # noqa: BLE001 — a corrupt previous map just means a cold start
                Y0 = None
        per = float(perplexity or min(30.0, max(2.0, (n - 1) / 3.0)))
        Y = tsne(Xr, per, n_iter=warm_iters if warm_used else n_iter, seed=seed, Y0=Y0)
        params = {"perplexity": per, "n_iter": warm_iters if warm_used else n_iter, "pca_dims": int(Xr.shape[1])}
    Y = Y - Y.mean(axis=0)
    scale = float(np.max(np.abs(Y))) or 1.0
    Yn = Y / scale
    tw = trustworthiness(X, Y, 5)
    label = rec["feature_set"]["feature_set_id"]
    doc = {
        "schema": MAP_SCHEMA, "map_id": "mp_" + rec["embedding_id"][3:], "created_at": utc_now(),
        "space": {"embedding_id": rec["embedding_id"], "feature_set_id": label,
                  "label": load_feature_set(lib, label)["name"]},
        "method": {"name": used, "requested": method, "params": params, "seed": seed, "warm_start": warm_used, **({"note": note} if note else {})},
        "scale": scale,
        "points": [{"bake_id": b, "x": round(float(y[0]), 5), "y": round(float(y[1]), 5)} for b, y in zip(bake_ids, Yn)],
        "quality": {"trustworthiness": None if tw is None else round(tw, 4), "k": 5},
        "excluded": rec["excluded"],
        "disclaimer": f"A {used.upper()} projection of the '{label}' feature space (standardised). "
                      "It shows one feature representation, not musical similarity; distances between clusters are not meaningful.",
    }
    validate("map", doc)
    atomic_write_json(map_path(lib, feature_set_id), doc)
    return doc
