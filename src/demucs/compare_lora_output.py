#!/usr/bin/env python3
"""
EBYS — Compare LoRA-generated audio against the real training corpus

Phase 4 of USER_LORA.md calls for comparing generated output against the
real corpus in descriptor space, plus checking for memorized/near-duplicate
output. For catalog material that's gone through EBYS's own ingestion
pipeline, that comparison would use the real FluCoMa C/S/E/F/P/H/T values
already in ebys.db. This corpus was NOT ingested that way (see
prep_lora_corpus.py's docstring — it lives outside EBYS's Demucs/FluCoMa
pipeline entirely), so there's nothing in ebys.db to compare against.

This script computes a SEPARATE, lightweight set of descriptors directly
from WAV files with numpy — spectral centroid, spectral flatness, RMS
loudness, and a coarse log-spaced band-energy fingerprint. These are NOT
the same math as FluCoMa's C/S/E/F/P/H/T (analyze_reader.js is explicit
that there's no way to reproduce FluCoMa's exact computation outside Max
— see GENERATIVE_LAYER.md step 6). Do not feed this script's output into
scoreCandidate()/the taste model — it's for comparing a LoRA's generated
output against its own training corpus only, nothing downstream of that.

Two things it reports:

  1. Distribution comparison — for centroid/flatness/rms, how much do the
     generated clips' distributions overlap with the real corpus's
     (histogram overlap coefficient: 1.0 = identical, 0.0 = no overlap).
     Point --real-dir at build_lora_dataset.py's --val-out-dir (held-out,
     never seen during training) for this — that's what tells you whether
     the LoRA generalized the identity, not just memorized the training set.

  2. Near-duplicate flagging — for each generated clip, the closest real
     clip by band-fingerprint distance. Point --real-dir at the actual
     TRAINING data_dir for this pass (not the held-out set) — closeness to
     a specific training clip is the overfitting signal Phase 4 asks about.
     This is a coarse screen (three spectral summary stats, not FluCoMa's
     full descriptor set) — treat flagged pairs as "listen to this," not
     "this is definitely copied."

Run it twice with different --real-dir values for the two purposes above,
or once against whichever matters more right now.

Requires: numpy only (uses stdlib `wave` for I/O, same dependency-light
approach as add_stereo_features.py — no soundfile/librosa).

Usage:
  # generalization check — generated vs. held-out real clips
  python3 compare_lora_output.py --real-dir ./my_data_val \
      --generated-dir ./lora_test_generations --out-report ./eval_val.json

  # memorization check — generated vs. the actual training clips
  python3 compare_lora_output.py --real-dir ./my_data \
      --generated-dir ./lora_test_generations --out-report ./eval_train.json
"""

import os
import sys
import json
import wave
import argparse
import numpy as np


def read_wav_mono(path):
    with wave.open(path, 'rb') as wf:
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sample_width == 2:
        dtype, max_val = np.int16, 32768.0
    elif sample_width == 4:
        dtype, max_val = np.int32, 2147483648.0
    elif sample_width == 1:
        dtype, max_val = np.uint8, 128.0
    else:
        raise ValueError(f"unsupported sample width {sample_width} bytes in {path}")

    arr = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    if sample_width == 1:
        arr = arr - 128.0
    arr = arr / max_val

    if n_channels > 1:
        arr = arr.reshape(-1, n_channels).mean(axis=1)

    return arr, sample_rate


def frame_signal(x, frame_size, hop_size):
    if len(x) < frame_size:
        return np.empty((0, frame_size))
    x = np.ascontiguousarray(x)
    n_frames = 1 + (len(x) - frame_size) // hop_size
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n_frames, frame_size),
        strides=(x.strides[0] * hop_size, x.strides[0]),
    )
    return frames.copy()


def compute_descriptors(path, frame_size=2048, hop_size=1024, n_bands=20):
    """Per-clip scalar descriptors + a fixed-size band-energy fingerprint,
    averaged over frames. See module docstring — independent approximations,
    not FluCoMa's C/S/E/F/P/H/T."""
    x, sr = read_wav_mono(path)
    if len(x) == 0:
        return None

    rms_full = np.sqrt(np.mean(x ** 2)) if len(x) else 0.0
    rms_db = 20 * np.log10(max(rms_full, 1e-9))

    frames = frame_signal(x, frame_size, hop_size)
    if frames.shape[0] == 0:
        padded = np.zeros(frame_size)
        padded[: len(x)] = x
        frames = padded[np.newaxis, :]

    window = np.hanning(frame_size)
    spec = np.abs(np.fft.rfft(frames * window, axis=1))
    freqs = np.fft.rfftfreq(frame_size, d=1.0 / sr)

    mag_sum = spec.sum(axis=1)
    mag_sum_safe = np.where(mag_sum > 0, mag_sum, 1e-12)
    centroid_per_frame = (spec * freqs[np.newaxis, :]).sum(axis=1) / mag_sum_safe
    centroid_hz = float(np.mean(centroid_per_frame))

    spec_safe = np.where(spec > 0, spec, 1e-12)
    geo_mean = np.exp(np.mean(np.log(spec_safe), axis=1))
    arith_mean = np.mean(spec_safe, axis=1)
    flatness_per_frame = geo_mean / np.where(arith_mean > 0, arith_mean, 1e-12)
    flatness = float(np.mean(flatness_per_frame))

    nyquist = sr / 2.0
    band_edges = np.logspace(np.log10(20), np.log10(max(nyquist - 1, 21)), n_bands + 1)
    mean_spec = spec.mean(axis=0)
    band_energy = np.zeros(n_bands)
    for i in range(n_bands):
        lo, hi = band_edges[i], band_edges[i + 1]
        mask = (freqs >= lo) & (freqs < hi)
        band_energy[i] = mean_spec[mask].sum() if mask.any() else 0.0
    total = band_energy.sum()
    if total > 0:
        band_energy = band_energy / total  # normalize to a shape-only fingerprint

    return {
        "path": path,
        "duration_s": len(x) / sr,
        "centroid_hz": centroid_hz,
        "flatness": flatness,
        "rms_db": rms_db,
        "band_fingerprint": band_energy.tolist(),
    }


def scan_dir(d):
    results = []
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith('.wav'):
            continue
        path = os.path.join(d, f)
        try:
            desc = compute_descriptors(path)
        except Exception as e:
            print(f"  warning: failed to analyze {path}: {e}", file=sys.stderr)
            continue
        if desc:
            results.append(desc)
    return results


def histogram_overlap(a, b, n_bins=20):
    """Overlap coefficient between two 1-D distributions on a shared
    binning: sum(min(p_a[i], p_b[i])) over normalized histograms.
    1.0 = identical distributions, 0.0 = no overlap."""
    if not a or not b:
        return None
    combined = np.array(a + b)
    lo, hi = combined.min(), combined.max()
    if lo == hi:
        return 1.0
    bins = np.linspace(lo, hi, n_bins + 1)
    hist_a, _ = np.histogram(a, bins=bins)
    hist_b, _ = np.histogram(b, bins=bins)
    p_a = hist_a / max(hist_a.sum(), 1)
    p_b = hist_b / max(hist_b.sum(), 1)
    return float(np.sum(np.minimum(p_a, p_b)))


def summarize(values):
    arr = np.array(values)
    return {
        "n": len(arr),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
    }


def nearest_neighbor_check(generated, real, flag_percentile=5.0):
    """For each generated clip, the closest real clip by band-fingerprint
    L2 distance. Flags the closest overall pairs as worth a listen — a
    coarse memorization screen, not a rigorous detector."""
    if not generated or not real:
        return []

    real_fp = np.array([r["band_fingerprint"] for r in real])
    matches = []
    for g in generated:
        g_fp = np.array(g["band_fingerprint"])
        dists = np.linalg.norm(real_fp - g_fp[np.newaxis, :], axis=1)
        best_idx = int(np.argmin(dists))
        matches.append({
            "generated": g["path"],
            "closest_real": real[best_idx]["path"],
            "distance": float(dists[best_idx]),
        })

    if not matches:
        return []
    all_distances = [m["distance"] for m in matches]
    threshold = float(np.percentile(all_distances, flag_percentile))
    flagged = [m for m in matches if m["distance"] <= threshold]
    return sorted(flagged, key=lambda m: m["distance"])


def main():
    ap = argparse.ArgumentParser(description="Compare LoRA-generated clips against a real WAV corpus (lightweight, non-FluCoMa descriptors)")
    ap.add_argument("--real-dir", required=True, help="folder of real WAV clips to compare against — held-out val set for the generalization check, or the actual training data_dir for the memorization check (see docstring)")
    ap.add_argument("--generated-dir", required=True, help="folder of WAV clips generated by the LoRA-adapted model")
    ap.add_argument("--out-report", default=None, help="write the full comparison as JSON to this path")
    ap.add_argument("--flag-percentile", type=float, default=5.0, help="flag the closest N%% of generated/real pairs as possible near-duplicates")
    args = ap.parse_args()

    print(f"analyzing real clips in {args.real_dir} ...")
    real = scan_dir(args.real_dir)
    print(f"  {len(real)} clip(s) analyzed")

    print(f"analyzing generated clips in {args.generated_dir} ...")
    generated = scan_dir(args.generated_dir)
    print(f"  {len(generated)} clip(s) analyzed")

    if not real or not generated:
        sys.exit("need at least one successfully analyzed clip in both --real-dir and --generated-dir")

    report = {"real_dir": args.real_dir, "generated_dir": args.generated_dir}

    print("\n=== Distribution comparison (real vs generated) ===")
    for key, label in [("centroid_hz", "spectral centroid (Hz)"),
                        ("flatness", "spectral flatness"),
                        ("rms_db", "loudness (dB RMS)")]:
        real_vals = [r[key] for r in real]
        gen_vals = [g[key] for g in generated]
        overlap = histogram_overlap(real_vals, gen_vals)
        real_summary = summarize(real_vals)
        gen_summary = summarize(gen_vals)
        report[key] = {"real": real_summary, "generated": gen_summary, "overlap": overlap}
        print(f"  {label}:")
        print(f"    real:      mean={real_summary['mean']:.2f}  std={real_summary['std']:.2f}")
        print(f"    generated: mean={gen_summary['mean']:.2f}  std={gen_summary['std']:.2f}")
        print(f"    overlap:   {overlap:.2f}  (1.0 = identical distributions, 0.0 = no overlap)")

    print(f"\n=== Near-duplicate check (closest {args.flag_percentile:.0f}% of generated->real pairs) ===")
    flagged = nearest_neighbor_check(generated, real, flag_percentile=args.flag_percentile)
    report["flagged_near_duplicates"] = flagged
    if flagged:
        for m in flagged[:20]:
            print(f"  {os.path.basename(m['generated'])}  ~=  {os.path.basename(m['closest_real'])}  (dist={m['distance']:.4f})")
        if len(flagged) > 20:
            print(f"  ... and {len(flagged) - 20} more (see --out-report for the full list)")
        print("  Listen to these — closeness here doesn't prove memorization, but it's the shortlist worth checking by ear.")
    else:
        print("  none flagged")

    if args.out_report:
        with open(args.out_report, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nfull report written to {args.out_report}")


if __name__ == "__main__":
    main()
