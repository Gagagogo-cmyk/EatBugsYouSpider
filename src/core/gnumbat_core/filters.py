"""Filter query evaluation over a flat 'bake view' document.

Semantics (identical in the C++ evaluator; see conformance/filter_cases.json):
  * Paths are '/'-separated ("fields/tempo"). A missing path never matches, except
    {"op":"exists","value":false}. `not` inverts the result of its operand.
  * String comparison is case-insensitive (ASCII guaranteed). Numbers compare numerically.
    Ordered comparison (lt/gt/between) works on numbers, or on two strings (ordinal).
  * A list-valued field matches `eq/has/in/contains/prefix` if ANY element does.
  * `text` splits on whitespace; every token must occur (case-insensitive substring) in the
    haystack: id + notation + tags + groups + every string/number field value.
  * `and: []` is true; `or: []` is false.
"""
from __future__ import annotations

from typing import Any


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _resolve(view: dict, path: str):
    cur: Any = view
    for seg in path.split("/"):
        if isinstance(cur, dict) and seg in cur:
            cur = cur[seg]
        else:
            return False, None
    return True, cur


def _eq_scalar(a: Any, b: Any) -> bool:
    if _is_num(a) and _is_num(b):
        return float(a) == float(b)
    if isinstance(a, str) and isinstance(b, str):
        return a.lower() == b.lower()
    if isinstance(a, bool) and isinstance(b, bool):
        return a == b
    return False


def _eq(field: Any, value: Any) -> bool:
    if isinstance(field, list):
        return any(_eq_scalar(e, value) for e in field)
    return _eq_scalar(field, value)


def _cmp(a: Any, b: Any):
    """-1/0/1 for comparable pairs, None otherwise."""
    if _is_num(a) and _is_num(b):
        a, b = float(a), float(b)
    elif isinstance(a, str) and isinstance(b, str):
        pass
    else:
        return None
    return (a > b) - (a < b)


def _leaf(view: dict, node: dict) -> bool:
    exists, field = _resolve(view, node["field"])
    op = node["op"]
    value = node.get("value")
    if op == "exists":
        want = True if value is None else bool(value)
        return exists == want
    if not exists or field is None:
        return False
    if op == "eq":
        return _eq(field, value)
    if op == "ne":
        return not _eq(field, value)
    if op in ("lt", "lte", "gt", "gte"):
        if isinstance(field, list):
            return False
        c = _cmp(field, value)
        if c is None:
            return False
        return {"lt": c < 0, "lte": c <= 0, "gt": c > 0, "gte": c >= 0}[op]
    if op == "between":
        if not (isinstance(value, list) and len(value) == 2) or isinstance(field, list):
            return False
        lo, hi = _cmp(field, value[0]), _cmp(field, value[1])
        return lo is not None and hi is not None and lo >= 0 and hi <= 0
    if op == "in":
        if not isinstance(value, list):
            return False
        items = field if isinstance(field, list) else [field]
        return any(_eq_scalar(e, v) for e in items for v in value)
    if op == "has":
        return _eq(field, value)
    if op == "contains":
        if not isinstance(value, str):
            return False
        items = field if isinstance(field, list) else [field]
        return any(isinstance(e, str) and value.lower() in e.lower() for e in items)
    if op == "prefix":
        if not isinstance(value, str):
            return False
        items = field if isinstance(field, list) else [field]
        return any(isinstance(e, str) and e.lower().startswith(value.lower()) for e in items)
    raise ValueError(f"unknown op {op!r}")


def haystack(view: dict) -> str:
    parts = [str(view.get("id", "")), str(view.get("notation", ""))]
    parts += [str(t) for t in view.get("tags", []) or []]
    parts += [str(g) for g in view.get("groups", []) or []]
    def add(x: Any) -> None:
        if isinstance(x, str):
            parts.append(x)
        elif _is_num(x) and float(x).is_integer():  # only integral numbers: float formatting differs across languages
            parts.append(str(int(x)))

    for v in (view.get("fields") or {}).values():
        for x in v if isinstance(v, list) else [v]:
            add(x)
    return "\n".join(parts).lower()


def matches(view: dict, query: dict | None) -> bool:
    if not query:
        return True
    if "and" in query:
        return all(matches(view, q) for q in query["and"])
    if "or" in query:
        return any(matches(view, q) for q in query["or"])
    if "not" in query:
        return not matches(view, query["not"])
    if "text" in query:
        hay = haystack(view)
        return all(tok in hay for tok in query["text"].lower().split())
    return _leaf(view, query)


def apply_filter(views: list[dict], query: dict | None) -> list[dict]:
    return [v for v in views if matches(v, query)]


def field_catalog(views: list[dict], max_depth: int = 6, sample_values: int = 8) -> dict:
    """Discover which fields exist in this library (the filter UI builds its pickers from this;
    nothing assumes any particular field is present)."""
    cat: dict[str, dict] = {}

    def visit(prefix: str, node: Any, depth: int) -> None:
        if isinstance(node, dict) and depth < max_depth:
            for k, v in node.items():
                visit(f"{prefix}/{k}" if prefix else k, v, depth + 1)
            return
        e = cat.setdefault(prefix, {"types": set(), "count": 0, "min": None, "max": None, "values": {}})
        e["count"] += 1
        items = node if isinstance(node, list) else [node]
        e["types"].add("list" if isinstance(node, list) else type(node).__name__)
        for it in items:
            if _is_num(it):
                f = float(it)
                e["min"] = f if e["min"] is None else min(e["min"], f)
                e["max"] = f if e["max"] is None else max(e["max"], f)
            elif isinstance(it, str) and len(e["values"]) < 200:
                e["values"][it] = e["values"].get(it, 0) + 1

    for v in views:
        visit("", v, 0)
    out = {}
    for path, e in cat.items():
        top = sorted(e["values"].items(), key=lambda kv: (-kv[1], kv[0]))[:sample_values]
        out[path] = {"types": sorted(e["types"]), "count": e["count"], "min": e["min"], "max": e["max"],
                     "values": [{"value": k, "count": c} for k, c in top]}
    return out
