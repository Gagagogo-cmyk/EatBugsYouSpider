import json
from pathlib import Path

import pytest

from gnumbat_core import filters, notation, schema
from gnumbat_core.notation import BUILTIN_PROFILES

CONF = Path(__file__).resolve().parents[1] / "conformance"


def test_filter_conformance_vectors():
    d = json.loads((CONF / "filter_cases.json").read_text())
    for c in d["cases"]:
        got = [v["id"] for v in d["views"] if filters.matches(v, c["query"])]
        assert got == c["expect"], c["name"]


def test_notation_conformance_vectors():
    d = json.loads((CONF / "notation_cases.json").read_text())
    for c in d["cases"]:
        r = notation.parse_notation(c["raw"], d["profiles"][c["profile"]])
        assert r["tags"] == c["tags"] and r["fields"] == c["fields"], c


def test_builtin_and_conformance_profiles_validate():
    pytest.importorskip("jsonschema")
    for p in BUILTIN_PROFILES.values():
        schema.validate("notation_profile", p, strict=True)
    for p in json.loads((CONF / "notation_cases.json").read_text())["profiles"].values():
        schema.validate("notation_profile", p, strict=True)


def test_catalog_discovers_fields_without_assuming_any():
    views = json.loads((CONF / "filter_cases.json").read_text())["views"]
    cat = filters.field_catalog(views)
    assert cat["fields/tempo"]["count"] == 3 and set(cat["fields/tempo"]["types"]) == {"int", "float", "str"}
    assert cat["fields/key"]["values"][0]["value"] == "E minor"
    assert "fields/nonexistent" not in cat
    e = cat["analysis/summary/mix/loudness.db/mean"]
    assert (e["min"], e["max"], e["count"]) == (-20.0, -12.5, 2)
