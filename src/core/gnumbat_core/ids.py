"""Typed, time-sortable, coordinator-free identifiers (ULID with a type prefix).

Local-first and eventually peer-to-peer: two machines must be able to mint ids without
talking to each other, and directory listings should sort by creation time.
"""
from __future__ import annotations

import os
import re
import threading
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

PREFIXES = {
    "bake": "bk",
    "decomposition": "dc",
    "analysis": "an",
    "dataset": "ds",
    "dataset_version": "dv",
    "model": "md",
    "model_version": "mv",
    "remix": "rm",
    "arrangement": "arr",
    "job": "job",
    "command": "cmd",
    "placement": "pl",
    "notation_profile": "np",
}

_ULID_RE = r"[0-9A-HJKMNP-TV-Z]{26}"
_lock = threading.Lock()
_last_ms = -1
_last_rand = 0


def _encode(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(out))


def ulid(now_ms: int | None = None) -> str:
    """26-char ULID. Monotonic within one process even inside the same millisecond."""
    global _last_ms, _last_rand
    if now_ms is not None:  # explicit time (tests/imports): no monotonic bookkeeping
        return _encode(int(now_ms), 10) + _encode(int.from_bytes(os.urandom(10), "big"), 16)
    with _lock:
        ms = int(time.time() * 1000)
        if ms <= _last_ms:
            ms = _last_ms
            _last_rand += 1
            if _last_rand >= 1 << 80:  # practically unreachable
                ms += 1
                _last_rand = int.from_bytes(os.urandom(10), "big")
        else:
            _last_rand = int.from_bytes(os.urandom(10), "big")
        _last_ms = ms
        return _encode(ms, 10) + _encode(_last_rand, 16)


def new_id(kind: str) -> str:
    return f"{PREFIXES[kind]}_{ulid()}"


def is_id(value: str, kind: str) -> bool:
    return bool(re.fullmatch(rf"{PREFIXES[kind]}_{_ULID_RE}", value or ""))


def ulid_time_ms(value: str) -> int:
    """Creation time (ms since epoch) encoded in an id or bare ULID."""
    body = value.split("_", 1)[-1]
    n = 0
    for ch in body[:10]:
        n = n * 32 + _CROCKFORD.index(ch)
    return n
