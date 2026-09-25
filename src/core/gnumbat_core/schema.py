"""Schema loading/validation. ``jsonschema`` is optional at runtime (required by the tests):
without it, ``validate`` is a no-op unless ``strict=True``.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

SCHEMA_DIR = Path(__file__).parent / "schemas"


class SchemaError(ValueError):
    pass


@lru_cache(maxsize=None)
def load_schema(kind: str) -> dict:
    with open(SCHEMA_DIR / f"{kind}.schema.json", "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=None)
def _validator(kind: str):
    from jsonschema import Draft202012Validator  # type: ignore

    return Draft202012Validator(load_schema(kind), format_checker=None)


def validate(kind: str, doc, strict: bool = False) -> None:
    try:
        v = _validator(kind)
    except ImportError:
        if strict:
            raise
        return
    errors = sorted(v.iter_errors(doc), key=lambda e: list(e.absolute_path))
    if errors:
        msgs = [f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in errors[:8]]
        raise SchemaError(f"{kind} document invalid: " + "; ".join(msgs))


def kinds():
    return sorted(p.name[: -len(".schema.json")] for p in SCHEMA_DIR.glob("*.schema.json"))
