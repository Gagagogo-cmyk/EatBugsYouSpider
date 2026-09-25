"""Bake pipeline state machine.

TRAINING/TRAINED are deliberately *not* here: a Bake may belong to many models, so training
status is derived per (bake, model_version) from dataset/model membership (see
docs/platform/CORE_ARCHITECTURE.md §5.3).
"""
from __future__ import annotations

CAPTURED = "CAPTURED"
DECOMPOSING = "DECOMPOSING"
DECOMPOSED = "DECOMPOSED"
ANALYZING = "ANALYZING"
ANALYZED = "ANALYZED"
READY = "READY"
ERROR = "ERROR"

ALL_STATES = (CAPTURED, DECOMPOSING, DECOMPOSED, ANALYZING, ANALYZED, READY, ERROR)
TRANSIENT = frozenset({DECOMPOSING, ANALYZING})
STABLE = frozenset({CAPTURED, DECOMPOSED, ANALYZED, READY})

TRANSITIONS = {
    CAPTURED: {DECOMPOSING, ANALYZING, ERROR},  # CAPTURED->ANALYZING: decomposition skipped
    DECOMPOSING: {DECOMPOSED, ERROR},
    DECOMPOSED: {ANALYZING, DECOMPOSING, ERROR},
    ANALYZING: {ANALYZED, ERROR},
    ANALYZED: {READY, ANALYZING, ERROR},
    READY: {DECOMPOSING, ANALYZING, ERROR},  # re-run a stage under a new backend/config
    ERROR: set(STABLE),  # retry resumes at error.resume_state
}


class StateError(RuntimeError):
    pass


def check_transition(old: str, new: str) -> None:
    if new not in TRANSITIONS.get(old, ()):  # type: ignore[arg-type]
        raise StateError(f"illegal Bake transition {old} -> {new}")
