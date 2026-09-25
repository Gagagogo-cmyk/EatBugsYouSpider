"""Feature registry: features are *data*, not columns.

Adding a descriptor = one row here + an extractor that emits it. No schema migration, no
change to Bake/analysis/embedding code. Ids are namespaced ("spectral.centroid"); the same
id may be produced by different extractors with different *definitions* (see ``provided_by``
and ``note``) — analyses therefore always record which extractor made them, and a
DatasetVersion refuses to mix extractors.
"""
from __future__ import annotations

REGISTRY_VERSION = "0.1"


def _f(fid, dims, unit, family, description, kind="series", provided_by=("python-ref", "pd-flucoma"), note=""):
    return {"id": fid, "dims": dims, "unit": unit, "family": list(family), "description": description,
            "kind": kind, "provided_by": list(provided_by), "note": note}


FEATURES = {f["id"]: f for f in [
    _f("loudness.rms_db", 1, "dBFS", ["loudness"], "Frame RMS in dBFS.", provided_by=["python-ref"],
       note="Plain RMS, NOT K-weighted; not comparable to loudness.db."),
    _f("loudness.db", 1, "dB", ["loudness"], "FluCoMa loudness (fluid.bufloudness).", provided_by=["pd-flucoma"]),
    _f("loudness.truepeak_db", 1, "dBTP", ["loudness"], "FluCoMa true peak.", provided_by=["pd-flucoma"]),
    _f("spectral.centroid", 1, "Hz", ["spectral"], "Spectral centroid (brightness)."),
    _f("spectral.spread", 1, "Hz", ["spectral"], "Spectral spread."),
    _f("spectral.skewness", 1, "", ["spectral"], "Spectral skewness."),
    _f("spectral.kurtosis", 1, "", ["spectral"], "Spectral kurtosis."),
    _f("spectral.rolloff", 1, "Hz", ["spectral"], "Frequency below which 95% of spectral mass lies."),
    _f("spectral.flatness", 1, "", ["spectral"], "Noisiness (geometric/arithmetic mean of power)."),
    _f("spectral.crest", 1, "", ["spectral"], "Spectral peakiness."),
    _f("spectral.flux", 1, "", ["spectral", "rhythm"], "Half-wave-rectified spectral change (onset strength).",
       provided_by=["python-ref"]),
    _f("temporal.zcr", 1, "", ["spectral"], "Zero-crossing rate per frame.", provided_by=["python-ref"]),
    _f("pitch.f0_hz", 1, "Hz", ["pitch"], "Fundamental frequency (voiced frames)."),
    _f("pitch.confidence", 1, "", ["pitch"], "Pitch confidence."),
    _f("harmony.chroma", 12, "", ["pitch"], "12-bin chroma, C..B, sums to 1."),
    _f("timbre.mfcc", 13, "", ["timbre"], "MFCC 0..12."),
    _f("rhythm.onset_rate", 1, "1/s", ["rhythm"], "Onsets per second.", kind="scalar"),
    _f("rhythm.ioi_mean", 1, "s", ["rhythm"], "Mean inter-onset interval.", kind="scalar"),
    _f("rhythm.ioi_std", 1, "s", ["rhythm"], "Std of inter-onset interval.", kind="scalar"),
    _f("rhythm.tempo_bpm", 1, "BPM", ["rhythm"], "Onset-autocorrelation tempo estimate.", kind="scalar", provided_by=["python-ref"]),
    _f("rhythm.tempo_strength", 1, "", ["rhythm"], "Strength of that estimate (0..1).", kind="scalar", provided_by=["python-ref"]),
    _f("stereo.pan", 1, "", ["stereo"], "(R-L)/(R+L) power balance.", kind="scalar", provided_by=["python-ref"]),
    _f("stereo.width", 1, "", ["stereo"], "rms(S)/rms(M).", kind="scalar", provided_by=["python-ref"]),
]}

# Legacy single-letter descriptors of the live instrument (docs/instrument/TECH_STACK.md) -> registry ids.
# `S` is deliberately absent: its definition isn't documented in this repo.
LEGACY_ALIASES = {"C": "spectral.centroid", "E": "loudness.db", "F": "spectral.flatness", "P": "pitch.f0_hz",
                  "H": "harmony.chroma", "T": "timbre.mfcc", **{f"M{i}": f"timbre.mfcc#{i}" for i in range(6)}}


def _fs(fid, name, description, features, stats, sources="all"):
    return {"schema": "gnumbat.feature_set/0.1", "feature_set_id": fid, "name": name, "description": description,
            "features": features, "stats": stats, "sources": sources, "builtin": True, "version": 1}


_ALL = [f for f in FEATURES]
BUILTIN_FEATURE_SETS = {s["feature_set_id"]: s for s in [
    _fs("all", "All Features", "Every registered feature, all sources.", _ALL, ["mean", "std", "slope"]),
    _fs("spectral", "Spectral", "Brightness/noisiness of the mix and their trajectory.",
        [f for f in _ALL if f.startswith("spectral.") and f != "spectral.flux"], ["mean", "std", "slope", "envelope"], ["mix"]),
    _fs("timbre", "Timbre", "MFCC statistics of the mix.", ["timbre.mfcc"], ["mean", "std"], ["mix"]),
    _fs("rhythm", "Rhythm", "Onset density and regularity.",
        ["rhythm.onset_rate", "rhythm.ioi_mean", "rhythm.ioi_std", "rhythm.tempo_bpm", "rhythm.tempo_strength", "spectral.flux"],
        ["mean", "std"], ["mix"]),
    _fs("pitch", "Pitch", "F0 and chroma of the mix.", ["pitch.f0_hz", "pitch.confidence", "harmony.chroma"], ["mean", "std"], ["mix"]),
    _fs("loudness", "Loudness / Energy", "Level and its trajectory (captures rises and falls).",
        ["loudness.rms_db", "loudness.db"], ["mean", "std", "slope", "envelope"], ["mix"]),
]}


def feature_dims(fid: str) -> int:
    return FEATURES[fid]["dims"]
