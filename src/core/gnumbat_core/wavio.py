"""Minimal, dependency-free WAV reader/writer (numpy only).

Reads PCM 8/16/24/32, IEEE float 32/64 and WAVE_FORMAT_EXTENSIBLE; writes float32 / PCM16 /
PCM24. The library stores captured audio as 32-bit float so the file is exactly what the
host produced (no dither, no clipping). Data is returned as float32 ``[frames, channels]``.
"""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

_PCM, _FLOAT, _EXT = 1, 3, 0xFFFE


class WavError(ValueError):
    pass


def _parse_header(f):
    riff = f.read(12)
    if len(riff) < 12 or riff[:4] not in (b"RIFF", b"RF64") or riff[8:12] != b"WAVE":
        raise WavError("not a RIFF/WAVE file")
    fmt = None
    data_off = data_len = None
    while True:
        hdr = f.read(8)
        if len(hdr) < 8:
            break
        cid, size = hdr[:4], struct.unpack("<I", hdr[4:])[0]
        if cid == b"fmt ":
            body = f.read(size)
            tag, ch, sr, _br, _ba, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == _EXT and size >= 26:
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            data_off = f.tell()
            data_len = size
            break
        else:
            f.seek(size + (size & 1), 1)
            continue
        if size & 1:
            f.seek(1, 1)
    if fmt is None or data_off is None:
        raise WavError("missing fmt or data chunk")
    return fmt, data_off, data_len


def wav_info(path):
    """(sample_rate, channels, frames, bits, is_float) without reading samples."""
    with open(path, "rb") as f:
        (tag, ch, sr, bits), off, length = _parse_header(f)
        return sr, ch, length // (ch * (bits // 8)), bits, tag == _FLOAT


def read_wav(path):
    """-> (float32 array [frames, channels], sample_rate)."""
    with open(path, "rb") as f:
        (tag, ch, sr, bits), off, length = _parse_header(f)
        f.seek(off)
        raw = f.read(length)
    nbytes = bits // 8
    n = len(raw) // (nbytes * ch)
    raw = raw[: n * nbytes * ch]
    if tag == _FLOAT and bits == 32:
        x = np.frombuffer(raw, "<f4").astype(np.float32)
    elif tag == _FLOAT and bits == 64:
        x = np.frombuffer(raw, "<f8").astype(np.float32)
    elif tag == _PCM and bits == 16:
        x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768.0
    elif tag == _PCM and bits == 24:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v & 0x800000, v - 0x1000000, v)
        x = v.astype(np.float32) / 8388608.0
    elif tag == _PCM and bits == 32:
        x = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648.0
    elif tag == _PCM and bits == 8:
        x = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise WavError(f"unsupported WAV format tag={tag} bits={bits}")
    return x.reshape(n, ch), sr


def write_wav(path, data, sample_rate, subtype="float32"):
    """Write ``data`` ([frames] or [frames, channels], float) to ``path`` (not atomic; callers
    that need atomicity write to a temp name and rename)."""
    a = np.asarray(data, dtype=np.float32)
    if a.ndim == 1:
        a = a[:, None]
    n, ch = a.shape
    if subtype == "float32":
        tag, bits, body = _FLOAT, 32, a.astype("<f4").tobytes()
    elif subtype == "pcm16":
        tag, bits = _PCM, 16
        body = (np.clip(a, -1, 1) * 32767.0).round().astype("<i2").tobytes()
    elif subtype == "pcm24":
        tag, bits = _PCM, 24
        v = (np.clip(a, -1, 1) * 8388607.0).round().astype(np.int32)
        b = np.empty((v.size, 3), np.uint8)
        vf = v.reshape(-1)
        b[:, 0], b[:, 1], b[:, 2] = vf & 255, (vf >> 8) & 255, (vf >> 16) & 255
        body = b.tobytes()
    else:
        raise WavError(f"unknown subtype {subtype}")
    ba = ch * bits // 8
    fmt = struct.pack("<HHIIHH", tag, ch, int(sample_rate), int(sample_rate) * ba, ba, bits)
    chunks = b"fmt " + struct.pack("<I", 16) + fmt
    if tag == _FLOAT:
        chunks += b"fact" + struct.pack("<II", 4, n)
    chunks += b"data" + struct.pack("<I", len(body)) + body + (b"\0" if len(body) & 1 else b"")
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks)


def to_mono(x):
    return x.mean(axis=1) if x.ndim == 2 and x.shape[1] > 1 else x.reshape(-1)


def peaks(x, bins=192):
    """[[min,max]...] per bin of the mono mix — the waveform thumbnail stored in bake.json."""
    m = to_mono(x)
    if m.size == 0:
        return [[0.0, 0.0]] * bins
    edges = np.linspace(0, m.size, bins + 1).astype(int)
    out = []
    for i in range(bins):
        seg = m[edges[i] : max(edges[i + 1], edges[i] + 1)]
        out.append([round(float(seg.min()), 4), round(float(seg.max()), 4)])
    return out
