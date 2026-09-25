"""Datasets, immutable DatasetVersions, portable export.

A DatasetVersion *pins* (bake_id, content hash, semantic revision + hash, analysis id) so
training is reproducible even if labels are later edited. A Bake can belong to any number of
Datasets/Versions; the Bake itself records none of this.
"""
from __future__ import annotations

import os
import shutil
from collections import Counter
from pathlib import Path

import numpy as np

from . import ids
from .embed import _value, column_names, load_feature_set
from .filters import apply_filter
from .jsonio import atomic_write_json, canonical_dumps, content_hash, read_json, sha256_file, utc_now
from .schema import validate
from . import states

DATASET_SCHEMA = "gnumbat.dataset/0.1"
DATASET_VERSION_SCHEMA = "gnumbat.dataset_version/0.1"
EXPORT_SCHEMA = "gnumbat.dataset_export/0.1"


class DatasetError(RuntimeError):
    pass


def dataset_dir(lib, dataset_id: str) -> Path:
    d = lib.root / "datasets" / dataset_id
    if not d.is_dir():
        raise DatasetError(f"no such dataset {dataset_id}")
    return d


def create_dataset(lib, name: str, bake_ids: list[str] | None = None, filter_query: dict | None = None,
                   description: str = "") -> str:
    if bake_ids is None and filter_query is None:
        raise DatasetError("give bake_ids and/or a filter")
    ds_id = ids.new_id("dataset")
    now = utc_now()
    doc = {"schema": DATASET_SCHEMA, "dataset_id": ds_id, "name": name, "description": description, "created_at": now,
           "modified_at": now, "membership": {"bake_ids": sorted(bake_ids or []), "filter": filter_query}}
    validate("dataset", doc)
    atomic_write_json(lib.root / "datasets" / ds_id / "dataset.json", doc)
    return ds_id


def resolve_members(lib, ds: dict) -> list[str]:
    mem = ds["membership"]
    out = set(mem.get("bake_ids") or [])
    if mem.get("filter") is not None:
        out |= {v["id"] for v in apply_filter(lib.views(), mem["filter"])}
    return sorted(out)


def create_version(lib, dataset_id: str, notes: str = "", allow_test: bool = False) -> dict:
    ds = read_json(dataset_dir(lib, dataset_id) / "dataset.json")
    members = resolve_members(lib, ds)
    if not members:
        raise DatasetError("dataset has no Bakes")
    problems, items, profiles = [], [], set()
    vocab: Counter = Counter()
    for bid in members:
        try:
            st = lib.read_state(bid)
        except Exception:
            problems.append(f"{bid}: missing")
            continue
        if st["state"] != states.READY:
            problems.append(f"{bid}: state is {st['state']}, not READY")
            continue
        a = lib.read_analysis(bid)
        dec = lib.read_decomposition(bid)
        if dec and dec["method"]["is_test"] and not allow_test:
            problems.append(f"{bid}: decomposed with a test backend ({dec['method']['backend']}); not trainable")
            continue
        sem = lib.read_semantic(bid)
        profiles.add((a["extractor"]["name"], a["extractor"]["config_hash"]))
        items.append({"bake_id": bid, "content_hash": "sha256:" + lib.read_bake(bid)["audio"]["sha256"],
                      "semantic_rev": sem["rev"], "semantic_hash": content_hash(sem), "analysis_id": a["analysis_id"],
                      "decomposition_id": dec["decomposition_id"] if dec else None})
        for t in sem["tags"]:
            vocab[t.lower()] += 1
    if len(profiles) > 1:
        problems.append(f"mixed analysis profiles {sorted(p[0] for p in profiles)}: a DatasetVersion needs exactly one")
    if problems:
        raise DatasetError("cannot version dataset: " + "; ".join(problems))
    profile = {"extractor": next(iter(profiles))[0], "config_hash": next(iter(profiles))[1]}
    items.sort(key=lambda i: i["bake_id"])
    version_hash = content_hash({"dataset_id": dataset_id, "analysis_profile": profile, "items": items})
    vdir = dataset_dir(lib, dataset_id) / "versions"
    for p in vdir.glob("dv_*/dataset_version.json") if vdir.exists() else []:
        ex = read_json(p)
        if ex["version_hash"] == version_hash:
            return ex  # identical pin already exists: versions are immutable and deduplicated
    dv_id = ids.new_id("dataset_version")
    doc = {"schema": DATASET_VERSION_SCHEMA, "dataset_version_id": dv_id, "dataset_id": dataset_id, "created_at": utc_now(),
           "notes": notes, "analysis_profile": profile, "items": items, "vocabulary": dict(sorted(vocab.items())),
           "version_hash": version_hash}
    validate("dataset_version", doc)
    atomic_write_json(vdir / dv_id / "dataset_version.json", doc)
    return doc


def find_version(lib, dataset_version_id: str) -> dict:
    for p in (lib.root / "datasets").glob(f"ds_*/versions/{dataset_version_id}/dataset_version.json"):
        return read_json(p)
    raise DatasetError(f"no such dataset version {dataset_version_id}")


def export_version(lib, dataset_version_id: str, out_dir: Path | str, include_stems: bool = True, link: bool = False) -> Path:
    """Materialise a DatasetVersion as a self-contained, portable folder (no Gnumbat needed to read it)."""
    dv = find_version(lib, dataset_version_id)
    out = Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise DatasetError(f"{out} is not empty")
    tmp = out.with_name(out.name + ".partial")
    shutil.rmtree(tmp, ignore_errors=True)
    (tmp / "bakes").mkdir(parents=True)

    def put(src: Path, dst: Path):
        dst.parent.mkdir(parents=True, exist_ok=True)
        if link:
            try:
                os.link(src, dst)
                return
            except OSError:
                pass
        shutil.copyfile(src, dst)

    try:
        for it in dv["items"]:
            bid, bd = it["bake_id"], tmp / "bakes" / it["bake_id"]
            src = lib.bake_dir(bid)
            put(lib.audio_path(bid), bd / "audio.wav")
            atomic_write_json(bd / "metadata.json", lib.read_bake(bid))
            atomic_write_json(bd / "semantic.json", lib.semantic_at_rev(bid, it["semantic_rev"]))
            an_dir = src / "analyses" / it["analysis_id"]
            put(an_dir / "analysis.json", bd / "analysis.json")
            for npy in (an_dir / "series").glob("*.npy"):
                put(npy, bd / "series" / npy.name)
            if it["decomposition_id"]:
                dec_dir = src / "decompositions" / it["decomposition_id"]
                put(dec_dir / "decomposition.json", bd / "decomposition.json")
                if include_stems:
                    for s in read_json(dec_dir / "decomposition.json")["stems"]:
                        put(dec_dir / s["file"], bd / "stems" / s["file"])
        sums = {}
        for p in sorted(tmp.rglob("*")):
            if p.is_file():
                sums[str(p.relative_to(tmp))] = sha256_file(p)
        atomic_write_json(tmp / "dataset.json", {"schema": EXPORT_SCHEMA, "dataset_version": dv, "created_at": utc_now(),
                                                 "includes_stems": include_stems, "files": sums})
        if out.exists():
            out.rmdir()
        os.replace(tmp, out)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return out


def verify_export(out_dir: Path | str) -> list[str]:
    out = Path(out_dir)
    problems = []
    manifest = read_json(out / "dataset.json")
    for rel, digest in manifest["files"].items():
        p = out / rel
        if not p.exists():
            problems.append(f"missing {rel}")
        elif sha256_file(p) != digest:
            problems.append(f"hash mismatch {rel}")
    for it in manifest["dataset_version"]["items"]:
        bd = out / "bakes" / it["bake_id"]
        try:
            if "sha256:" + sha256_file(bd / "audio.wav") != it["content_hash"]:
                problems.append(f"{it['bake_id']}: audio does not match pinned content_hash")
            if content_hash(read_json(bd / "semantic.json")) != it["semantic_hash"]:
                problems.append(f"{it['bake_id']}: semantic does not match pinned hash")
            if read_json(bd / "analysis.json")["analysis_id"] != it["analysis_id"]:
                problems.append(f"{it['bake_id']}: analysis id mismatch")
        except Exception as e:  # noqa: BLE001
            problems.append(f"{it['bake_id']}: {e}")
    return problems


class ExportedDataset:
    """Read an exported DatasetVersion with numpy + json only (no Gnumbat library needed by trainers)."""

    def __init__(self, out_dir: Path | str):
        self.dir = Path(out_dir)
        self.manifest = read_json(self.dir / "dataset.json")
        self.version = self.manifest["dataset_version"]

    def __len__(self) -> int:
        return len(self.version["items"])

    def example(self, i: int) -> dict:
        it = self.version["items"][i]
        bd = self.dir / "bakes" / it["bake_id"]
        sem = read_json(bd / "semantic.json")
        stems = {p.stem: p for p in sorted((bd / "stems").glob("*.wav"))} if (bd / "stems").exists() else {}
        return {"bake_id": it["bake_id"], "raw_notation": sem["raw_notation"], "tags": sem["tags"], "fields": sem["fields"],
                "audio": bd / "audio.wav", "stems": stems, "analysis_path": bd / "analysis.json"}

    def feature_matrix(self, feature_set: dict) -> tuple[np.ndarray, list[str], list[str]]:
        """Raw (un-standardised) [n, d] matrix + column names + bake ids; NaN where a value is absent."""
        analyses = [read_json(self.dir / "bakes" / it["bake_id"] / "analysis.json") for it in self.version["items"]]
        src = sorted({s["name"] for a in analyses for s in a["sources"]}, key=lambda n: (n != "mix", n))
        cols = column_names(feature_set, src)
        M = np.array([[_value(a, c) for c in cols] for a in analyses], dtype=np.float64)
        return M, cols, [it["bake_id"] for it in self.version["items"]]


def build_associations(lib) -> dict:
    """derived/associations.json: for each Bake, which datasets / models it participates in.
    (The Bake never stores this — it is a reverse index, rebuildable at any time.)"""
    assoc: dict[str, dict] = {}

    def slot(bid):
        return assoc.setdefault(bid, {"datasets": [], "dataset_versions": [], "models": [], "training": {}})

    dv_bakes: dict[str, list[str]] = {}
    for p in sorted((lib.root / "datasets").glob("ds_*/dataset.json")):
        ds = read_json(p)
        for vp in sorted(p.parent.glob("versions/dv_*/dataset_version.json")):
            dv = read_json(vp)
            dv_bakes[dv["dataset_version_id"]] = [i["bake_id"] for i in dv["items"]]
            for it in dv["items"]:
                s = slot(it["bake_id"])
                if ds["name"] not in s["datasets"]:
                    s["datasets"].append(ds["name"])
                s["dataset_versions"].append(dv["dataset_version_id"])
        for bid in resolve_members(lib, ds) if ds["membership"] else []:
            s = slot(bid)
            if ds["name"] not in s["datasets"]:
                s["datasets"].append(ds["name"])
    for p in sorted((lib.root / "models").glob("md_*/model.json")):
        model = read_json(p)
        for vp in sorted(p.parent.glob("versions/mv_*/model_version.json")):
            mv = read_json(vp)
            for bid in dv_bakes.get(mv["dataset_version_id"], []):
                s = slot(bid)
                if model["name"] not in s["models"]:
                    s["models"].append(model["name"])
                state = mv["training"]["state"]
                s["training"][state] = s["training"].get(state, 0) + 1
    doc = {"schema": "gnumbat.associations/0.1", "generated_at": utc_now(), "bakes": assoc}
    atomic_write_json(lib.derived_dir / "associations.json", doc)
    return doc
