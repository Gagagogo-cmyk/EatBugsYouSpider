"""Analysis: extractor interface, assembly of analysis.json, and the run_analysis orchestration."""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from .. import ids
from ..jsonio import atomic_write_json, content_hash, sha256_file, utc_now
from ..schema import validate
from .registry import REGISTRY_VERSION
from .summarize import estimate_key, make_card, make_slices, summarize_series

ANALYSIS_SCHEMA = "gnumbat.analysis/0.1"
ANALYSIS_VERSION = "0.1"


class AnalysisError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.retryable = code, retryable


def get_extractor(name: str, config: dict | None = None, settings: dict | None = None):
    if name == "python-ref":
        from .pyref import PyRefExtractor

        return PyRefExtractor(config)
    if name == "pd-flucoma":
        from .pd_flucoma import PdFlucomaExtractor

        return PdFlucomaExtractor(config, settings or {})
    raise AnalysisError("UNKNOWN_EXTRACTOR", f"unknown extractor {name!r}", retryable=False)


def assemble(analysis_id: str, bake_id: str, decomposition_id: str | None, extractor, results: dict,
             out_dir: Path, source_hashes: dict[str, str], seconds: float, tags: dict | None = None) -> dict:
    """Build analysis.json (+ series/*.npy) from extractor SourceResults into ``out_dir``.

    ``tags`` (optional) is the raw output of the external taggers (``analysis/external_tags.py``):
    ``{"madmom": {...}, "essentia": {...}}``. It is written verbatim under ``doc["tags"]`` *and*
    folded into ``suggestions`` -- madmom's DBN tempo/meter/key supersede the extractor's own
    autocorrelation-based estimate when present (it's the better estimate), and essentia's top
    genre becomes ``suggestions.genre``. None of this ever touches a Bake's authoritative fields:
    ``suggestions`` only ever feeds ``card.tempo_estimate`` / ``key_estimate`` / ``genre_suggestion``,
    which the UI shows as approximate -- genre in particular is never auto-applied anywhere."""
    (out_dir / "series").mkdir(parents=True, exist_ok=True)
    sources = []
    for name, r in results.items():
        n_frames = max((np.asarray(a).shape[0] for a in r.series.values()), default=0)
        columns, mats = [], []
        for fid, arr in r.series.items():
            a = np.asarray(arr, dtype=np.float32)
            if a.ndim == 1:
                a = a[:, None]
            for d in range(a.shape[1]):
                columns.append({"feature": fid, "dim": d})
            mats.append(a)
        rel = f"series/{name}.npy"
        np.save(out_dir / rel, np.concatenate(mats, axis=1).astype(np.float32))
        src = {
            "name": name, "sample_rate": r.sample_rate, "duration_s": round(r.duration_s, 6),
            "frame_series": {"hop_s": r.hop_s, "n_frames": int(n_frames), "file": rel, "dtype": "float32", "columns": columns},
            "slices": make_slices(r.series, r.onsets_s, r.hop_s, n_frames, r.duration_s),
            "summary": summarize_series(r.series, r.hop_s, r.masks),
            "scalars": {k: float(v) for k, v in r.scalars.items()},
        }
        if name in source_hashes:
            src["audio_sha256"] = source_hashes[name]
        sources.append(src)
    mix = next((s for s in sources if s["name"] == "mix"), sources[0])
    suggestions = {"tempo_bpm": mix["scalars"].get("rhythm.tempo_bpm"), "tempo_strength": mix["scalars"].get("rhythm.tempo_strength"), "key": None}
    if "harmony.chroma" in mix["summary"]:
        suggestions["key"] = estimate_key(np.array([d["mean"] for d in mix["summary"]["harmony.chroma"]["dims"]]))
    madmom_tag = (tags or {}).get("madmom") or {}
    if isinstance(madmom_tag, dict) and madmom_tag.get("bpm"):
        suggestions["tempo_bpm"] = madmom_tag["bpm"]
        suggestions["tempo_strength"] = madmom_tag.get("confidence")
        suggestions["meter"] = madmom_tag.get("meter")
        if madmom_tag.get("key"):
            suggestions["key"] = madmom_tag["key"]
    essentia_tag = (tags or {}).get("essentia") or {}
    if isinstance(essentia_tag, dict) and essentia_tag.get("genres"):
        top = essentia_tag["genres"][0]
        suggestions["genre"] = top.get("genre")
        suggestions["genre_confidence"] = top.get("confidence")
    doc = {
        "schema": ANALYSIS_SCHEMA, "analysis_version": ANALYSIS_VERSION, "analysis_id": analysis_id, "bake_id": bake_id,
        "decomposition_id": decomposition_id, "created_at": utc_now(),
        "extractor": {"name": extractor.name, "version": extractor.version, "config": extractor.config,
                      "config_hash": content_hash({"name": extractor.name, "version": extractor.version, "config": extractor.config}),
                      "is_reference": bool(getattr(extractor, "is_reference", False))},
        "feature_registry_version": REGISTRY_VERSION, "sample_rate": next(iter(results.values())).sample_rate,
        "sources": sources, "suggestions": suggestions, "tags": tags or {}, "timing": {"seconds": round(seconds, 3)},
    }
    validate("analysis", doc)
    atomic_write_json(out_dir / "analysis.json", doc)
    return doc


def run_analysis(lib, bake_id: str, extractor, progress=None, cancelled=None, use_decomposition: bool = True,
                 taggers: dict | None = None, tag_progress: dict | None = None) -> dict:
    """Analyse the mix and (if present) every stem of the current decomposition. Commits a new
    analyses/<an_id>/ atomically and returns its analysis.json. Never touches state.json.

    ``taggers`` (optional): ``{"madmom": MadmomTagger(...), "essentia": EssentiaGenreTagger(...)}``
    (``worker._resolve_taggers`` builds this from settings/capabilities). Each runs against the
    *mix* only -- same rationale as ``genre_tagger.py``'s own docstring: isolated stems lack the
    context these models were trained on. A tagger that raises is recorded as a tag-level error and
    does not fail the Bake; analysis from the main extractor always still commits."""
    t0 = time.time()
    dec = lib.read_decomposition(bake_id) if use_decomposition else None
    sources = {"mix": lib.audio_path(bake_id)}
    hashes = {"mix": lib.read_bake(bake_id)["audio"]["sha256"]}
    if dec:
        for s, p in lib.stem_paths(bake_id).items():
            sources[s] = p
        hashes.update({s["name"]: s["sha256"] for s in dec["stems"]})
    an_id, part = lib.new_derived_dir(bake_id, "analyses")
    try:
        results = extractor.extract_sources(sources, workdir=lib.tmp_dir, progress=progress, cancelled=cancelled)
        tags: dict = {}
        for name, tagger in (taggers or {}).items():
            cb = (tag_progress or {}).get(name)
            try:
                tags[name] = tagger.run(sources["mix"], lib.tmp_dir, progress=cb, cancelled=cancelled)
            except Exception as e:  # noqa: BLE001 - a tagger failing must not sink the whole analysis
                tags[name] = {"error": f"{type(e).__name__}: {e}"}
            finally:
                if cb:
                    cb(1.0, "done")
        doc = assemble(an_id, bake_id, dec["decomposition_id"] if dec else None, extractor, results, part, hashes,
                       time.time() - t0, tags=tags)
        lib.commit_derived_dir(bake_id, "analyses", an_id, part)
        return doc
    except BaseException:
        import shutil

        shutil.rmtree(part, ignore_errors=True)
        raise
