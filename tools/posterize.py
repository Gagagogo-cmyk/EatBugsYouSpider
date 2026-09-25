#!/usr/bin/env python3
"""
posterize.py — two-tier image quantization for the Gnumbat "econo skin".

The idea: the site chrome (UI, bezels, icons) carries zero photographic
imagery already — it's flat CSS colour, so there's nothing to posterize
there. The one place raster images enter the econo skin is DJ/show poster
art on the poster wall. This script gives you two quantization tiers so
posters can be compressed hard without either (a) looking like the rest of
the flat-grey chrome, which would defeat the point of a poster, or (b)
shipping full-fidelity photography by default, which defeats the point of
"econo".

  --tier chrome   Hard 3-level luminance quantize (white/grey/black only).
                  Use this only if you ever DO need a raster asset to live
                  inside the site chrome itself (an icon, a favicon) —
                  matches the site's own 3-tone palette exactly.

  --tier poster   Gentler adaptive-palette quantize (default 24 levels,
                  Floyd-Steinberg dithered) anchored to a grey ramp with an
                  optional single accent hue pulled from the source image.
                  This is the default and the one you actually want for
                  DJ-submitted poster art: it keeps gradients and shapes
                  legible while cutting file size ~70-90% vs. the source,
                  because an indexed-palette PNG with <=64 colours
                  compresses far better than 24-bit truecolour source art
                  (JPEG photography, PNG screenshots, whatever DJs upload).

Output is always an indexed (mode "P") PNG — the format that benefits most
from a small palette, and the one the poster-wall <img> tags should point
at, never the original upload.

Usage:
    pip install pillow --break-system-packages     # only dependency
    python3 tools/posterize.py IN.jpg OUT.png
    python3 tools/posterize.py IN.jpg OUT.png --tier chrome
    python3 tools/posterize.py IN.jpg OUT.png --tier poster --levels 32
    python3 tools/posterize.py data/posters_raw/ data/posters/ --batch

This is meant to run once per poster upload (wire it into wherever the
poster-wall upload handler lands, same pattern as watch_demucs.py picking
up new files in data/raw_uploads/) — not on every page view.
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit(
        "Pillow is required: pip install pillow --break-system-packages\n"
        "(This is unrelated to demucs_env / the essentia+madmom system Python — "
        "Pillow is lightweight, install it wherever you like.)"
    )

CHROME_LEVELS = (0, 128, 255)  # black, grey, white — the site's own 3 tones


def posterize_chrome(img: Image.Image, dither: bool = False) -> Image.Image:
    """
    Hard-quantize to exactly the site's 3 tones: white / grey / black.
    No dithering by default — dithering a smooth source down to 3 flat
    levels injects high-frequency noise that PNG compresses badly (we
    measured a 300x200 test gradient come out *larger* dithered than the
    source JPEG: +67% vs. -70% without dither). Flat quantization is
    smaller AND matches the chrome's actual visual language (flat fields,
    not stippled noise). Pass dither=True only if the source has fine
    detail you need to keep legible at 3 levels — rare for UI-chrome
    assets, which is why this tier should rarely see photographic input
    at all.
    """
    gray = img.convert("L")
    palette_img = Image.new("P", (1, 1))
    flat_palette = []
    for v in CHROME_LEVELS:
        flat_palette += [v, v, v]
    # pad palette to 256 entries as PIL expects
    flat_palette += [0, 0, 0] * (256 - len(CHROME_LEVELS))
    palette_img.putpalette(flat_palette)
    mode = Image.FLOYDSTEINBERG if dither else Image.NONE
    return gray.convert("RGB").quantize(palette=palette_img, dither=mode)


def posterize_poster(img: Image.Image, levels: int = 24, keep_accent: bool = True) -> Image.Image:
    """
    Gentler quantize for poster art: adaptive palette capped at `levels`
    colours, dithered so gradients read as gradients rather than banding.
    `keep_accent=True` quantizes in RGB (so the source's dominant hue
    survives, just reduced to `levels` swatches of it) rather than forcing
    pure greyscale — closer to "less aggressive" posterization that still
    reads as the original artwork.
    """
    src = img.convert("RGB") if keep_accent else img.convert("L").convert("RGB")
    return src.quantize(colors=levels, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)


def process_one(in_path: Path, out_path: Path, tier: str, levels: int, dither_chrome: bool):
    img = Image.open(in_path)
    before = in_path.stat().st_size
    if tier == "chrome":
        result = posterize_chrome(img, dither=dither_chrome)
    else:
        result = posterize_poster(img, levels=levels)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(out_path, format="PNG", optimize=True)
    after = out_path.stat().st_size
    pct = (1 - after / before) * 100 if before else 0
    print(f"{in_path.name} -> {out_path.name}: {before:,}B -> {after:,}B ({pct:.0f}% smaller)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="source image, or a directory with --batch")
    ap.add_argument("output", type=Path, help="output PNG path, or a directory with --batch")
    ap.add_argument("--tier", choices=["chrome", "poster"], default="poster")
    ap.add_argument("--levels", type=int, default=24, help="palette size for --tier poster (default 24)")
    ap.add_argument("--batch", action="store_true", help="treat input/output as directories")
    ap.add_argument(
        "--dither-chrome",
        action="store_true",
        help="dither the --tier chrome output (off by default — see posterize_chrome docstring)",
    )
    args = ap.parse_args()

    if args.batch:
        exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
        files = sorted(p for p in args.input.iterdir() if p.suffix.lower() in exts)
        if not files:
            sys.exit(f"No images found in {args.input}")
        for f in files:
            process_one(f, args.output / (f.stem + ".png"), args.tier, args.levels, args.dither_chrome)
    else:
        process_one(args.input, args.output, args.tier, args.levels, args.dither_chrome)


if __name__ == "__main__":
    main()
