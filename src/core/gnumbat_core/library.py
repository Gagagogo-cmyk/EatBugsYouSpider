"""The Library: a directory of Bakes (plus datasets, models, derived caches, a job spool).

Single-writer file ownership keeps this safe without locks:

    bake.json                 written once at creation, never modified
    audio/, decompositions/,
    analyses/                 written once each, by the worker, then immutable
    state.json                creator writes CAPTURED; afterwards only the worker
    semantic.json             clients (revisioned; ``rev`` = optimistic concurrency)

All writes are atomic replaces (see jsonio), so readers never see torn files.
"""
from __future__ import annotations

import getpass
import os
import shutil
import time
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from . import LIBRARY_SCHEMA, __version__, ids, states, wavio
from .jsonio import (append_jsonl, atomic_write_json, canonical_dumps, content_hash, read_json, read_jsonl,
                     sha256_file, utc_now)
from .notation import BUILTIN_PROFILES, FREEFORM, parse_notation
from .schema import validate

BAKE_SCHEMA = "gnumbat.bake/0.1"
STATE_SCHEMA = "gnumbat.bake_state/0.1"
SEMANTIC_SCHEMA = "gnumbat.semantic/0.1"
HISTORY_CAP = 64


class LibraryError(RuntimeError):
    pass


class ConflictError(LibraryError):
    """semantic.json changed since ``expected_rev`` — reload and retry."""


class Library:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self._view_cache: dict[str, tuple[tuple, dict]] = {}
        if not (self.root / "library.json").exists():
            raise LibraryError(f"{self.root} is not a Gnumbat library (run `gnumbat init`)")

    # ------------------------------------------------------------------ setup
    @classmethod
    def init(cls, root: Path | str) -> "Library":
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        manifest = root / "library.json"
        if not manifest.exists():
            atomic_write_json(manifest, {"schema": LIBRARY_SCHEMA, "library_id": ids.ulid(), "created_at": utc_now(),
                                         "gnumbat_version": __version__})
        for d in ("bakes", "notation_profiles", "feature_sets", "datasets", "models", "derived",
                  "jobs/pending", "jobs/running", "jobs/done", "jobs/failed", "jobs/cancel", "tmp", ".trash"):
            (root / d).mkdir(parents=True, exist_ok=True)
        lib = cls(root)
        lib._install_builtins()
        return lib

    def _install_builtins(self) -> None:
        from .analysis.registry import BUILTIN_FEATURE_SETS

        for pid, prof in BUILTIN_PROFILES.items():
            p = self.root / "notation_profiles" / f"{pid}.json"
            if not p.exists():
                atomic_write_json(p, prof)
        for fs in BUILTIN_FEATURE_SETS.values():
            p = self.root / "feature_sets" / f"{fs['feature_set_id']}.json"
            if not p.exists():
                atomic_write_json(p, fs)

    @property
    def library_id(self) -> str:
        return read_json(self.root / "library.json")["library_id"]

    # ------------------------------------------------------------------ paths
    @property
    def bakes_dir(self) -> Path:
        return self.root / "bakes"

    @property
    def derived_dir(self) -> Path:
        return self.root / "derived"

    @property
    def tmp_dir(self) -> Path:
        return self.root / "tmp"

    def bake_dir(self, bake_id: str) -> Path:
        d = self.bakes_dir / bake_id
        if not d.is_dir():
            raise LibraryError(f"no such Bake: {bake_id}")
        return d

    def list_bake_ids(self) -> list[str]:
        if not self.bakes_dir.exists():
            return []
        return sorted(p.name for p in self.bakes_dir.iterdir()
                      if p.is_dir() and ids.is_id(p.name, "bake"))  # .partial dirs never match

    # ------------------------------------------------------------------ profiles
    def get_profile(self, profile_id: str | None) -> dict:
        if not profile_id:
            return FREEFORM
        p = self.root / "notation_profiles" / f"{profile_id}.json"
        if p.exists():
            return read_json(p)
        if profile_id in BUILTIN_PROFILES:
            return BUILTIN_PROFILES[profile_id]
        raise LibraryError(f"unknown notation profile {profile_id}")

    def save_profile(self, profile: dict) -> None:
        validate("notation_profile", profile)
        atomic_write_json(self.root / "notation_profiles" / f"{profile['profile_id']}.json", profile)

    # ------------------------------------------------------------------ creation
    def create_bake(self, *, audio: np.ndarray | None = None, sample_rate: int | None = None,
                    source_wav: Path | str | None = None, raw_notation: str = "",
                    profile: dict | None = None, origin_kind: str = "capture",
                    capture: dict | None = None, import_info: dict | None = None,
                    tags: Iterable[str] = (), fields: dict | None = None, groups: Iterable[str] = (),
                    app: tuple[str, str] = ("gnumbat-core", __version__), submit: bool = False,
                    process_params: dict | None = None, created_by: str | None = None) -> str:
        """Create a Bake in state CAPTURED. Exactly one of ``audio``(+sample_rate) / ``source_wav``.

        ``raw_notation`` is stored verbatim. If a ``profile`` is given, tags/fields are derived
        from it; otherwise the freeform profile applies (whole string = one phrase-tag).
        """
        if (audio is None) == (source_wav is None):
            raise LibraryError("pass exactly one of audio / source_wav")
        if source_wav is not None:
            audio, sample_rate = wavio.read_wav(source_wav)
            if import_info is None:
                import_info = {"original_name": Path(source_wav).name, "source_path": str(source_wav)}
            origin_kind = "import" if origin_kind == "capture" and capture is None else origin_kind
        audio = np.asarray(audio, dtype=np.float32)
        if audio.ndim == 1:
            audio = audio[:, None]
        if not sample_rate or audio.shape[0] < 1:
            raise LibraryError("empty audio")

        bake_id = ids.new_id("bake")
        tmp = self.bakes_dir / f"{bake_id}.partial"
        try:
            (tmp / "audio").mkdir(parents=True)
            wav_path = tmp / "audio" / "original.wav"
            wavio.write_wav(wav_path, audio, sample_rate, "float32")
            now = utc_now()
            # the real OS account that made this Bake -- distinct from `app` above (that's the
            # software, e.g. "gnumbat-core"), useful once a library is shared or opened on
            # someone else's machine (see README.md: a library is portable between machines).
            manifest = {
                "schema": BAKE_SCHEMA, "bake_id": bake_id, "created_at": now,
                "created_by": created_by if created_by is not None else getpass.getuser(),
                "origin": {"kind": origin_kind, "app": {"name": app[0], "version": app[1]}},
                "audio": {"file": "audio/original.wav", "sha256": sha256_file(wav_path), "sample_rate": int(sample_rate),
                          "channels": int(audio.shape[1]), "frames": int(audio.shape[0]),
                          "duration_s": round(audio.shape[0] / float(sample_rate), 6), "sample_format": "float32"},
                "preview": {"peaks": wavio.peaks(audio)},
            }
            if capture:
                manifest["capture"] = capture
            if import_info:
                manifest["import"] = import_info
            profile = profile or FREEFORM
            derived = parse_notation(raw_notation, profile)
            all_tags = list(dict.fromkeys(list(derived["tags"]) + [t for t in tags if t]))
            all_fields = dict(derived["fields"])
            origin = dict(derived["field_origin"])
            for k, v in (fields or {}).items():
                all_fields[k] = v
                origin[k] = "user"
            semantic = {
                "schema": SEMANTIC_SCHEMA, "bake_id": bake_id, "rev": 1, "raw_notation": raw_notation,
                "notation_profile": {"id": profile["profile_id"], "version": profile["version"]},
                "tags": all_tags, "fields": all_fields, "field_origin": origin, "groups": list(groups),
                "prompt": None, "ratings": {}, "notes": "", "updated_at": now, "updated_by": app[0],
            }
            state = {
                "schema": STATE_SCHEMA, "bake_id": bake_id, "state": states.CAPTURED, "rev": 1, "updated_at": now,
                "current": {"decomposition_id": None, "analysis_id": None},
                "history": [{"state": states.CAPTURED, "at": now}], "error": None, "progress": None, "card": {},
                "stale": {"analysis": False},
            }
            validate("bake", manifest)
            validate("semantic", semantic)
            validate("state", state)
            atomic_write_json(tmp / "bake.json", manifest)
            atomic_write_json(tmp / "semantic.json", semantic)
            atomic_write_json(tmp / "state.json", state)
            os.replace(tmp, self.bakes_dir / bake_id)  # directory rename: the Bake appears atomically
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        if submit:
            from .jobs import JobQueue

            JobQueue(self).submit("process_bake", {"bake_id": bake_id, **(process_params or {})})
        return bake_id

    # ------------------------------------------------------------------ reads
    def read_bake(self, bake_id: str) -> dict:
        return read_json(self.bake_dir(bake_id) / "bake.json")

    def read_state(self, bake_id: str) -> dict:
        return read_json(self.bake_dir(bake_id) / "state.json")

    def read_semantic(self, bake_id: str) -> dict:
        return read_json(self.bake_dir(bake_id) / "semantic.json")

    def read_analysis(self, bake_id: str, analysis_id: str | None = None) -> dict | None:
        analysis_id = analysis_id or self.read_state(bake_id)["current"]["analysis_id"]
        if not analysis_id:
            return None
        return read_json(self.bake_dir(bake_id) / "analyses" / analysis_id / "analysis.json")

    def read_decomposition(self, bake_id: str, decomposition_id: str | None = None) -> dict | None:
        decomposition_id = decomposition_id or self.read_state(bake_id)["current"]["decomposition_id"]
        if not decomposition_id:
            return None
        return read_json(self.bake_dir(bake_id) / "decompositions" / decomposition_id / "decomposition.json")

    def audio_path(self, bake_id: str) -> Path:
        return self.bake_dir(bake_id) / self.read_bake(bake_id)["audio"]["file"]

    def stem_paths(self, bake_id: str, decomposition_id: str | None = None) -> dict[str, Path]:
        d = self.read_decomposition(bake_id, decomposition_id)
        if not d:
            return {}
        base = self.bake_dir(bake_id) / "decompositions" / d["decomposition_id"]
        return {s["name"]: base / s["file"] for s in d["stems"]}

    # ------------------------------------------------------------------ state machine (worker-side)
    def _write_state(self, bake_id: str, st: dict) -> dict:
        st["rev"] = int(st["rev"]) + 1
        st["updated_at"] = utc_now()
        validate("state", st)
        atomic_write_json(self.bake_dir(bake_id) / "state.json", st)
        return st

    def begin_stage(self, bake_id: str, transient: str, job_id: str | None = None, note: str | None = None) -> dict:
        assert transient in states.TRANSIENT
        st = self.read_state(bake_id)
        states.check_transition(st["state"], transient)
        st["stage_from"] = st["state"] if st["state"] in states.STABLE else st.get("stage_from", states.CAPTURED)
        st["state"] = transient
        st["error"] = None
        # `tools` (per-tool 0..1 fractions: demucs / pd-flucoma / madmom / essentia / ...) survives
        # the CAPTURED->DECOMPOSING->DECOMPOSED->ANALYZING walk of one process_bake job, so a UI
        # watching this Bake can show every tool that has run *this job* at once -- e.g. demucs
        # sitting at 100% while flucoma/madmom/essentia climb during the ANALYZING stage that
        # follows it -- not just whichever single stage happens to be active right now.
        st["progress"] = {"stage": transient.lower(), "fraction": 0.0, "message": "", "tools": dict((st.get("progress") or {}).get("tools") or {})}
        self._push_history(st, transient, job_id, note)
        return self._write_state(bake_id, st)

    def update_progress(self, bake_id: str, fraction: float, message: str = "", *, tool: str | None = None,
                        tool_fraction: float | None = None) -> None:
        """``tool`` (e.g. "demucs", "pd-flucoma", "madmom", "essentia") records that one named
        tool's own 0..1 progress alongside the stage's overall ``fraction`` -- see ``begin_stage``."""
        st = self.read_state(bake_id)
        if st["state"] not in states.TRANSIENT:
            return
        prog = st.get("progress") or {}
        tools = dict(prog.get("tools") or {})
        if tool is not None:
            tools[tool] = float(min(1.0, max(0.0, tool_fraction if tool_fraction is not None else fraction)))
        st["progress"] = {"stage": st["state"].lower(), "fraction": float(min(1.0, max(0.0, fraction))), "message": message, "tools": tools}
        self._write_state(bake_id, st)

    def finish_stage(self, bake_id: str, new_state: str, *, decomposition_id: str | None = None,
                     analysis_id: str | None = None, card: dict | None = None, job_id: str | None = None,
                     note: str | None = None) -> dict:
        st = self.read_state(bake_id)
        states.check_transition(st["state"], new_state)
        st["state"] = new_state
        st["progress"] = None
        if decomposition_id is not None:
            st["current"]["decomposition_id"] = decomposition_id
            st["stale"]["analysis"] = st["current"]["analysis_id"] is not None  # new stems => old analysis is stale
        if analysis_id is not None:
            st["current"]["analysis_id"] = analysis_id
            st["stale"]["analysis"] = False
        if card is not None:
            st["card"] = card
        self._push_history(st, new_state, job_id, note)
        return self._write_state(bake_id, st)

    def fail_stage(self, bake_id: str, code: str, message: str, *, retryable: bool = True,
                   job_id: str | None = None) -> dict:
        st = self.read_state(bake_id)
        from_state = st["state"]
        resume = st.get("stage_from", states.CAPTURED) if from_state in states.TRANSIENT else (
            from_state if from_state in states.STABLE else states.CAPTURED)
        if from_state == states.ERROR:
            return st
        states.check_transition(from_state, states.ERROR)
        st["state"] = states.ERROR
        st["progress"] = None
        st["error"] = {"from_state": from_state, "resume_state": resume, "code": code, "message": message[:2000],
                       "retryable": bool(retryable), "at": utc_now()}
        if job_id:
            st["error"]["job_id"] = job_id
        self._push_history(st, states.ERROR, job_id, code)
        return self._write_state(bake_id, st)

    def retry(self, bake_id: str) -> dict:
        st = self.read_state(bake_id)
        if st["state"] != states.ERROR:
            raise states.StateError("Bake is not in ERROR")
        target = st["error"]["resume_state"]
        states.check_transition(states.ERROR, target)
        st["state"] = target
        st["error"] = None
        self._push_history(st, target, None, "retry")
        return self._write_state(bake_id, st)

    @staticmethod
    def _push_history(st: dict, state: str, job_id: str | None, note: str | None) -> None:
        h = {"state": state, "at": utc_now()}
        if job_id:
            h["job_id"] = job_id
        if note:
            h["note"] = note
        st["history"].append(h)
        del st["history"][:-HISTORY_CAP]

    # ------------------------------------------------------------------ derived artefacts (worker-side)
    def new_derived_dir(self, bake_id: str, kind: str) -> tuple[str, Path]:
        """Allocate an id + a hidden partial dir; caller fills it then calls commit_derived_dir."""
        prefix = {"decompositions": "decomposition", "analyses": "analysis"}[kind]
        did = ids.new_id(prefix)
        part = self.bake_dir(bake_id) / kind / f".{did}.partial"
        part.mkdir(parents=True)
        return did, part

    def commit_derived_dir(self, bake_id: str, kind: str, did: str, part: Path) -> Path:
        final = self.bake_dir(bake_id) / kind / did
        os.replace(part, final)
        return final

    # ------------------------------------------------------------------ semantic (client-side)
    def update_semantic(self, bake_id: str, *, expected_rev: int | None = None, updated_by: str = "gnumbat-core",
                        raw_notation: str | None = None, reparse: bool = False, profile: dict | None = None,
                        tags: list | None = None, add_tags: Iterable[str] = (), remove_tags: Iterable[str] = (),
                        fields: dict | None = None, groups: list | None = None, add_groups: Iterable[str] = (),
                        remove_groups: Iterable[str] = (), notes: str | None = None, prompt: str | None = None,
                        ratings: dict | None = None) -> dict:
        path = self.bake_dir(bake_id) / "semantic.json"
        cur = read_json(path)
        if expected_rev is not None and cur["rev"] != expected_rev:
            raise ConflictError(f"semantic rev is {cur['rev']}, expected {expected_rev}")
        new = dict(cur)  # preserves unknown fields
        new["tags"] = list(cur["tags"])
        new["fields"] = dict(cur["fields"])
        new["field_origin"] = dict(cur.get("field_origin", {}))
        new["groups"] = list(cur.get("groups", []))
        new["ratings"] = dict(cur.get("ratings", {}))

        if profile is not None:
            new["notation_profile"] = {"id": profile["profile_id"], "version": profile["version"]}
        if raw_notation is not None:
            new["raw_notation"] = raw_notation
        if reparse:
            prof = profile or self.get_profile((cur.get("notation_profile") or {}).get("id"))
            d = parse_notation(new["raw_notation"], prof)
            new["tags"] = list(d["tags"])
            keep = {k: v for k, v in new["fields"].items() if new["field_origin"].get(k) != "parsed"}
            keep_o = {k: v for k, v in new["field_origin"].items() if v != "parsed"}
            keep.update(d["fields"])
            keep_o.update(d["field_origin"])
            new["fields"], new["field_origin"] = keep, keep_o
        if tags is not None:
            new["tags"] = list(dict.fromkeys(t for t in tags if t))
        for t in add_tags:
            if t and t.lower() not in {x.lower() for x in new["tags"]}:
                new["tags"].append(t)
        rm = {t.lower() for t in remove_tags}
        if rm:
            new["tags"] = [t for t in new["tags"] if t.lower() not in rm]
        for k, v in (fields or {}).items():
            if v is None:
                new["fields"].pop(k, None)
                new["field_origin"].pop(k, None)
            else:
                new["fields"][k] = v
                new["field_origin"][k] = "user"
        if groups is not None:
            new["groups"] = list(dict.fromkeys(groups))
        for g in add_groups:
            if g not in new["groups"]:
                new["groups"].append(g)
        new["groups"] = [g for g in new["groups"] if g not in set(remove_groups)]
        if notes is not None:
            new["notes"] = notes
        if prompt is not None:
            new["prompt"] = prompt
        for k, v in (ratings or {}).items():
            if v is None:
                new["ratings"].pop(k, None)
            else:
                new["ratings"][k] = v
        new["rev"] = cur["rev"] + 1
        new["updated_at"] = utc_now()
        new["updated_by"] = updated_by
        validate("semantic", new)
        latest = read_json(path)  # narrow the read-modify-write window; a mismatch = someone else wrote
        if latest["rev"] != cur["rev"]:
            raise ConflictError(f"semantic changed concurrently (rev {latest['rev']})")
        append_jsonl(self.bake_dir(bake_id) / "semantic.history.jsonl", cur)
        atomic_write_json(path, new)
        return new

    def semantic_at_rev(self, bake_id: str, rev: int) -> dict:
        cur = self.read_semantic(bake_id)
        if cur["rev"] == rev:
            return cur
        for old in read_jsonl(self.bake_dir(bake_id) / "semantic.history.jsonl"):
            if old["rev"] == rev:
                return old
        raise LibraryError(f"{bake_id}: semantic rev {rev} not found")

    # ------------------------------------------------------------------ trash
    def trash_bake(self, bake_id: str) -> Path:
        src = self.bake_dir(bake_id)
        dst = self.root / ".trash" / f"{bake_id}__{int(time.time())}"
        dst.parent.mkdir(exist_ok=True)
        os.replace(src, dst)
        self._view_cache.pop(bake_id, None)
        return dst

    def restore_bake(self, trashed: Path | str) -> str:
        trashed = Path(trashed)
        bake_id = trashed.name.split("__")[0]
        os.replace(trashed, self.bakes_dir / bake_id)
        return bake_id

    def bakes_pinned_by_datasets(self) -> dict[str, list[str]]:
        pinned: dict[str, list[str]] = {}
        for p in (self.root / "datasets").glob("ds_*/versions/dv_*/dataset_version.json"):
            dv = read_json(p)
            for it in dv["items"]:
                pinned.setdefault(it["bake_id"], []).append(dv["dataset_version_id"])
        return pinned

    # ------------------------------------------------------------------ views / queries
    def associations(self) -> dict:
        p = self.derived_dir / "associations.json"
        if p.exists():
            try:
                return read_json(p).get("bakes", {})
            except Exception:
                return {}
        return {}

    def bake_view(self, bake_id: str, assoc: dict | None = None) -> dict:
        d = self.bake_dir(bake_id)
        sig = tuple((d / f).stat().st_mtime_ns for f in ("bake.json", "state.json", "semantic.json"))
        cached = self._view_cache.get(bake_id)
        if cached and cached[0] == sig:
            view = dict(cached[1])
        else:
            bake, st, sem = read_json(d / "bake.json"), read_json(d / "state.json"), read_json(d / "semantic.json")
            view = {
                "id": bake_id, "notation": sem["raw_notation"], "tags": sem["tags"], "fields": sem["fields"],
                "groups": sem.get("groups", []), "ratings": sem.get("ratings", {}), "state": st["state"],
                "created_at": bake["created_at"], "creator": bake.get("created_by", ""),
                "updated_at": sem["updated_at"], "duration_s": bake["audio"]["duration_s"],
                "origin": bake["origin"]["kind"], "capture": bake.get("capture", {}),
                "stems": [], "analysis": {}, "rev": sem["rev"],
            }
            if st["state"] in states.TRANSIENT and st.get("progress"):
                view["progress"] = st["progress"]["fraction"]
            if st["state"] == states.ERROR and st.get("error"):
                view["error"] = f"{st['error']['code']}: {st['error']['message']}"
            if st["current"]["decomposition_id"]:
                try:
                    dec = self.read_decomposition(bake_id)
                    view["stems"] = [s["name"] for s in dec["stems"]]
                    adopted = dec["method"]["backend"] == "instrument"
                except Exception:
                    adopted = False
            else:
                adopted = False
            if bake.get("handoff"):
                h = bake["handoff"]
                view["handoff"] = "failed" if h.get("status") != "written" else ("adopted" if adopted else "waiting")
            if st["current"]["analysis_id"]:
                try:
                    view["analysis"] = _analysis_view(self.read_analysis(bake_id))
                except Exception:
                    pass
            self._view_cache[bake_id] = (sig, dict(view))
        a = (assoc if assoc is not None else self.associations()).get(bake_id, {})
        view["models"] = a.get("models", [])
        view["datasets"] = a.get("datasets", [])
        view["training"] = a.get("training", {})
        return view

    def views(self) -> list[dict]:
        assoc = self.associations()
        out = []
        for bid in self.list_bake_ids():
            try:
                out.append(self.bake_view(bid, assoc))
            except Exception:  # a half-written/corrupt Bake must not break browsing
                continue
        return out

    def query(self, filter_query: dict | None = None) -> list[dict]:
        from .filters import apply_filter

        return apply_filter(self.views(), filter_query)

    # ------------------------------------------------------------------ verification
    def verify_bake(self, bake_id: str) -> list[str]:
        problems: list[str] = []
        d = self.bake_dir(bake_id)
        try:
            bake = read_json(d / "bake.json")
            validate("bake", bake)
            if sha256_file(d / bake["audio"]["file"]) != bake["audio"]["sha256"]:
                problems.append("original.wav hash mismatch")
            validate("semantic", read_json(d / "semantic.json"))
            st = read_json(d / "state.json")
            validate("state", st)
            if st["current"]["decomposition_id"]:
                dc = self.read_decomposition(bake_id)
                validate("decomposition", dc)
                for s in dc["stems"]:
                    f = d / "decompositions" / dc["decomposition_id"] / s["file"]
                    if not f.exists() or sha256_file(f) != s["sha256"]:
                        problems.append(f"stem {s['name']} missing or hash mismatch")
            if st["current"]["analysis_id"]:
                validate("analysis", self.read_analysis(bake_id))
        except Exception as e:  # noqa: BLE001
            problems.append(f"{type(e).__name__}: {e}")
        return problems


def _analysis_view(a: dict) -> dict:
    """Flat, filter-friendly projection of an analysis: mix-source scalar summaries only."""
    mix = next((s for s in a["sources"] if s["name"] == "mix"), a["sources"][0])
    summary: dict[str, dict] = {"mix": {}}
    for fid, entry in mix["summary"].items():
        dims = entry["dims"]
        for k, dim in enumerate(dims):
            key = fid if len(dims) == 1 else f"{fid}#{k}"
            summary["mix"][key] = {s: dim[s] for s in ("mean", "std", "min", "max", "slope")}
    for fid, v in (mix.get("scalars") or {}).items():
        summary["mix"][fid] = {"mean": v}
    sug = a.get("suggestions") or {}
    return {"analysis_id": a["analysis_id"], "extractor": a["extractor"]["name"],
            "n_slices": len(mix["slices"]), "tempo_bpm": sug.get("tempo_bpm"), "key": sug.get("key"),
            "meter": sug.get("meter"), "genre_suggestion": sug.get("genre"), "genre_confidence": sug.get("genre_confidence"),
            "summary": summary}
