"""User-defined notation profiles.

Gnumbat never hard-codes a musical ontology. ``raw_notation`` is stored verbatim; a
*profile* (user data, opt-in) may additionally derive tags and structured fields from it.
The default is ``FREEFORM``: the whole string is a single phrase-tag, nothing is extracted.

Regex dialect: portable ECMAScript subset (no lookbehind, no named groups, flag ``i`` only),
applied with *search* semantics, so the identical profile behaves the same in Python
(``re``) and C++ (``std::regex``). Parity is checked by ``conformance/notation_cases.json``.
"""
from __future__ import annotations

import re
from typing import Any

FREEFORM = {
    "schema": "gnumbat.notation_profile/0.1",
    "profile_id": "np_freeform",
    "name": "freeform",
    "version": 1,
    "description": "Whole notation is one phrase-tag. Nothing is extracted.",
    "split": None,
    "rules": [],
    "fallback": {"kind": "tag"},
}

MUSICAL_DASH = {
    "schema": "gnumbat.notation_profile/0.1",
    "profile_id": "np_musical_dash",
    "name": "musical-dash",
    "version": 1,
    "description": "Example only: dash-separated 'tag-key-bpm-bars-tag' notation. Off unless a user selects it.",
    "split": {"delimiter": "-", "trim": True, "drop_empty": True},
    "rules": [
        {"id": "tempo", "match": r"^\s*(\d+(?:\.\d+)?)\s*bpm\s*$", "flags": "i",
         "emit": [{"kind": "field", "name": "tempo", "type": "number", "group": 1}]},
        {"id": "bars", "match": r"^\s*(\d+)\s*bars?\s*$", "flags": "i",
         "emit": [{"kind": "field", "name": "duration_bars", "type": "integer", "group": 1}]},
        {"id": "key", "match": r"^\s*([A-Ga-g][#b]?)\s+(major|minor|maj|min)\s*$", "flags": "i",
         "emit": [{"kind": "field", "name": "key", "type": "string", "template": "{1} {2}"},
                  {"kind": "tag", "template": "{1} {2}"}]},
    ],
    "fallback": {"kind": "tag"},
}

BUILTIN_PROFILES = {"np_freeform": FREEFORM, "np_musical_dash": MUSICAL_DASH}


def _split(raw: str, split: dict | None) -> list[str]:
    if not split:
        return [raw.strip()] if raw.strip() else []
    parts = raw.split(split["delimiter"])
    if split.get("trim", True):
        parts = [p.strip() for p in parts]
    if split.get("drop_empty", True):
        parts = [p for p in parts if p != ""]
    return parts


def _render(emit: dict, groups: list[str]) -> str:
    if "template" in emit:
        out = emit["template"]
        for i in range(len(groups) - 1, -1, -1):  # replace {10} before {1}
            out = out.replace("{%d}" % i, groups[i] or "")
        return out
    return groups[emit.get("group", 0)] if emit.get("group", 0) < len(groups) else ""


def _coerce(text: str, typ: str) -> Any:
    if typ in ("number", "integer"):
        v = float(text)
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("non-finite number")  # not representable in JSON: treated as 'no field'
        if typ == "integer":
            return int(v)
        return int(v) if v.is_integer() else v
    return text


def parse_notation(raw: str, profile: dict | None = None) -> dict:
    """-> {"tags": [...], "fields": {...}, "field_origin": {...}}. Pure function of (raw, profile)."""
    profile = profile or FREEFORM
    tags: list[str] = []
    fields: dict = {}
    for seg in _split(raw, profile.get("split")):
        matched = False
        for rule in profile.get("rules", []):
            flags = re.IGNORECASE if rule.get("flags") == "i" else 0
            m = re.search(rule["match"], seg, flags)
            if not m:
                continue
            matched = True
            groups = [m.group(0)] + [g if g is not None else "" for g in m.groups()]
            for em in rule["emit"]:
                _apply(em, groups, tags, fields)
            break
        if not matched:
            _apply(profile.get("fallback", {"kind": "tag"}), [seg], tags, fields)
    seen, dedup = set(), []
    for t in tags:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            dedup.append(t)
    return {"tags": dedup, "fields": fields, "field_origin": {k: "parsed" for k in fields}}


def _apply(em: dict, groups: list[str], tags: list, fields: dict) -> None:
    kind = em["kind"]
    if kind == "ignore":
        return
    text = _render(em, groups)
    if kind == "tag":
        if text.strip():
            tags.append(text.strip())
    elif kind == "field":
        try:
            fields[em["name"]] = _coerce(text, em["type"])
        except ValueError:
            pass  # a value that doesn't parse as the declared type is simply not a field
