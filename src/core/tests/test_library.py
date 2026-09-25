import json

import pytest

from gnumbat_core import states
from gnumbat_core.library import ConflictError, LibraryError
from gnumbat_core.notation import BUILTIN_PROFILES
from conftest import make_bake


@pytest.mark.parametrize("raw", ["rise", "  weird   spacing\t", "large-spatial-event-darkening", "多語 ✓ ñ", "", "a/b\\c \"quoted\""])
def test_raw_notation_is_preserved_byte_for_byte(lib, raw):
    bid = make_bake(lib, notation=raw)
    assert lib.read_semantic(bid)["raw_notation"] == raw
    assert json.loads((lib.bake_dir(bid) / "semantic.json").read_text(encoding="utf-8"))["raw_notation"] == raw


def test_freeform_default_extracts_nothing_and_dash_profile_is_opt_in(lib):
    a = make_bake(lib, notation="rise-E minor-120 BPM-4 bars-energetic")
    assert lib.read_semantic(a)["tags"] == ["rise-E minor-120 BPM-4 bars-energetic"] and lib.read_semantic(a)["fields"] == {}
    b = make_bake(lib, notation="rise-E minor-120 BPM-4 bars-energetic", profile=BUILTIN_PROFILES["np_musical_dash"])
    s = lib.read_semantic(b)
    assert s["tags"] == ["rise", "E minor", "energetic"]
    assert s["fields"] == {"tempo": 120, "duration_bars": 4, "key": "E minor"}
    assert s["field_origin"]["tempo"] == "parsed" and s["notation_profile"] == {"id": "np_musical_dash", "version": 1}


def test_bake_created_in_captured_state_with_partial_dirs_invisible(lib):
    bid = make_bake(lib)
    assert lib.read_state(bid)["state"] == states.CAPTURED
    (lib.bakes_dir / "bk_01AAAAAAAAAAAAAAAAAAAAAAAA.partial").mkdir()
    assert lib.list_bake_ids() == [bid]


def test_semantic_revisions_conflict_and_history(lib):
    bid = make_bake(lib, notation="rise")
    s1 = lib.read_semantic(bid)
    s2 = lib.update_semantic(bid, expected_rev=1, add_tags=["energetic", "ENERGETIC"], fields={"energy": "high", "tempo": 120})
    assert s2["rev"] == 2 and s2["tags"] == ["rise", "energetic"] and s2["fields"]["energy"] == "high"
    assert s2["field_origin"]["energy"] == "user"
    with pytest.raises(ConflictError):
        lib.update_semantic(bid, expected_rev=1, notes="stale writer")
    assert lib.semantic_at_rev(bid, 1) == s1                     # nothing human-written is ever lost
    s3 = lib.update_semantic(bid, fields={"energy": None}, remove_tags=["Rise"])
    assert "energy" not in s3["fields"] and s3["tags"] == ["energetic"] and s3["raw_notation"] == "rise"


def test_reparse_replaces_only_parsed_state_and_is_explicit(lib):
    bid = make_bake(lib, notation="rise-120 BPM", profile=BUILTIN_PROFILES["np_musical_dash"])
    lib.update_semantic(bid, fields={"mood": "tense"}, add_tags=["mine"])
    lib.update_semantic(bid, raw_notation="fall-90 BPM", reparse=True, profile=BUILTIN_PROFILES["np_musical_dash"])
    s = lib.read_semantic(bid)
    assert s["fields"]["tempo"] == 90 and s["fields"]["mood"] == "tense"   # user field survives
    assert s["tags"] == ["fall"]                                            # reparse replaces tags (documented)


def test_unknown_semantic_fields_survive_updates(lib):
    bid = make_bake(lib)
    p = lib.bake_dir(bid) / "semantic.json"
    d = json.loads(p.read_text()); d["future_field"] = {"x": 1}; p.write_text(json.dumps(d))
    lib.update_semantic(bid, notes="hi")
    assert lib.read_semantic(bid)["future_field"] == {"x": 1}


def test_state_machine_rejects_illegal_transitions(lib):
    bid = make_bake(lib)
    with pytest.raises(states.StateError):
        lib.finish_stage(bid, states.READY)                       # CAPTURED -> READY is not allowed
    lib.begin_stage(bid, states.DECOMPOSING)
    with pytest.raises(states.StateError):
        lib.begin_stage(bid, states.ANALYZING)


def test_error_records_resume_state_and_retry_returns_there(lib):
    bid = make_bake(lib)
    lib.begin_stage(bid, states.DECOMPOSING, "job_x")
    st = lib.fail_stage(bid, "DEMUCS_FAILED", "boom", job_id="job_x")
    assert st["state"] == states.ERROR and st["error"]["from_state"] == states.DECOMPOSING and st["error"]["resume_state"] == states.CAPTURED
    assert lib.retry(bid)["state"] == states.CAPTURED


def test_trash_and_restore(lib):
    bid = make_bake(lib)
    t = lib.trash_bake(bid)
    assert lib.list_bake_ids() == [] and t.exists()
    assert lib.restore_bake(t) == bid and lib.list_bake_ids() == [bid]


def test_not_a_library(tmp_path):
    from gnumbat_core.library import Library

    with pytest.raises(LibraryError):
        Library(tmp_path)
