import json

import pytest

from gnumbat_core import ids, schema
from gnumbat_core.jsonio import utc_now
from conftest import make_bake

jsonschema = pytest.importorskip("jsonschema")


def test_every_schema_is_valid_draft_2020_12():
    from jsonschema import Draft202012Validator

    for k in schema.kinds():
        Draft202012Validator.check_schema(schema.load_schema(k))
    assert {"bake", "state", "semantic", "analysis", "decomposition", "job", "filter", "arrangement", "remix_command",
            "dataset_version", "model_version", "map", "embedding", "notation_profile"} <= set(schema.kinds())


def test_documents_written_by_the_library_validate(processed_lib):
    lib = processed_lib
    bid = lib.list_bake_ids()[0]
    schema.validate("bake", lib.read_bake(bid), strict=True)
    schema.validate("state", lib.read_state(bid), strict=True)
    schema.validate("semantic", lib.read_semantic(bid), strict=True)
    schema.validate("decomposition", lib.read_decomposition(bid), strict=True)
    schema.validate("analysis", lib.read_analysis(bid), strict=True)
    assert lib.verify_bake(bid) == []


def test_filter_schema_accepts_and_rejects():
    ok = {"and": [{"field": "notation", "op": "contains", "value": "rise"}, {"not": {"text": "x"}}]}
    schema.validate("filter", ok, strict=True)
    for bad in ({"field": "x", "op": "regex", "value": "."}, {"and": "nope"}, {"field": "x"}):
        with pytest.raises(schema.SchemaError):
            schema.validate("filter", bad, strict=True)


def _cmd(ops):
    return {"schema": "gnumbat.remix_command/0.1", "command_id": ids.new_id("command"), "issued_at": utc_now(),
            "source": {"kind": "llm", "name": "cricket"}, "ops": ops}


def test_remix_command_is_strict():
    good = _cmd([{"op": "ramp", "param": "slice_density", "to": 0.8, "over_beats": 8},
                 {"op": "set", "param": "stem_probability", "scope": "stem:body", "value": 0.7},
                 {"op": "query", "text": "aggressive melodic rise"}, {"op": "trigger", "action": "transition"}])
    schema.validate("remix_command", good, strict=True)
    for bad_op in ({"op": "render_audio", "param": "x", "value": 1},                       # unknown op
                   {"op": "set", "param": "x", "value": 1, "shell": "rm -rf /"},           # unknown key
                   {"op": "set", "param": "Bad Param", "value": 1},                         # param naming
                   {"op": "query", "text": "x" * 501},                                      # bounded free text
                   {"op": "trigger", "action": "synthesize"},                               # action enum
                   {"op": "macro", "macro": "energy", "value": 2}):                         # range
        with pytest.raises(schema.SchemaError):
            schema.validate("remix_command", _cmd([bad_op]), strict=True)


def _arr(transform_op="reverse"):
    return {"schema": "gnumbat.arrangement/0.1", "arrangement_id": ids.new_id("arrangement"), "created_at": utc_now(),
            "engine_version": "0", "seed": 1, "corpus_hash": "sha256:" + "0" * 64, "sample_rate": 44100, "length_s": 4.0,
            "placements": [{"placement_id": ids.new_id("placement"), "t_on": 0.0, "duration": 1.0,
                            "source": {"bake_id": ids.new_id("bake"), "decomposition_id": None, "stem": "body", "start_s": 0.0, "end_s": 1.0},
                            "transforms": [{"op": transform_op}]}]}


def test_arrangement_provenance_and_transform_whitelist_are_schema_enforced():
    schema.validate("arrangement", _arr("reverse"), strict=True)
    with pytest.raises(schema.SchemaError):          # nothing outside the whitelist can be expressed
        schema.validate("arrangement", _arr("oscillator"), strict=True)
    a = _arr()
    del a["placements"][0]["source"]
    with pytest.raises(schema.SchemaError):          # a placement without a corpus source is not an arrangement
        schema.validate("arrangement", a, strict=True)
