# openDAW timeline/arrangement view — reference copy

Source: [github.com/andremichelle/openDAW](https://github.com/andremichelle/openDAW),
commit `4a9f183f63dfc7ad049b5f24eca6081205a7c61b` (2026-08-29). License:
**AGPL-3.0-or-later** (repo root) — individual packages like `lib-jsx` are
marked LGPL-3.0-or-later, but the app package that owns this UI
(`@opendaw/app-studio`) inherits the stronger AGPL-3 terms from the project
as a whole. Treat everything here as AGPL-3.

These are the timeline/arrangement-view files under
`packages/app/studio/src/ui/timeline/` worth keeping around as reference —
out of ~240 files in that directory, this is the subset that actually
carries the arrangement-view *behavior* rather than piano-roll/automation
editing, which Gnumbat has no equivalent of yet:

| File | What it is |
|---|---|
| `timeline/Timeline.tsx` | Top-level component that composes axis + tracks + range slider |
| `timeline/TimeAxis.tsx` / `.sass` | Canvas ruler (bars/beats), draggable playhead, follow-scroll on scrub |
| `timeline/WheelScaling.ts` | Cross-device wheel-delta calibration + zoom-to-cursor |
| `timeline/Snapping.ts` | Grid quantizing (Bar/1-2/.../1-128/Smart/Off) + drag-safe rounding |
| `timeline/TimelineRangeSlider.tsx` / `.sass` | Two-handle zoom/pan minimap |
| `timeline/TimelineHeader.tsx` / `.sass` | Header row (snap selector, zoom buttons) that wraps the above |
| `timeline/tracks/audio-unit/TracksManager.ts` | Owns the list of track lanes, add/remove/reorder |
| `timeline/tracks/audio-unit/Track.tsx` / `.sass` | One track lane: header + region area |
| `timeline/tracks/audio-unit/regions/RegionsArea.tsx` / `.sass` | Renders region/clip blocks inside a lane |
| `timeline/tracks/audio-unit/regions/RegionRenderer.ts` | Low-level region drawing (waveform-in-region, loop tiling) |
| `timeline/tracks/audio-unit/regions/RegionMoveModifier.ts` | Drag-to-move a region, with the snapping + collision logic |
| `timeline/tracks/audio-unit/regions/RegionLane.tsx` / `.sass` | The horizontal strip a region lives in |

## Why this isn't a drop-in

This code runs on openDAW's own stack, not a mainstream framework:
`@opendaw/lib-jsx` (a custom JSX-to-DOM renderer), `@opendaw/lib-box`
(a reactive box-graph data model), `@opendaw/lib-std` (their own
`Option`/`Nullable`/`Notifier` utility layer), and `@opendaw/lib-dsp`'s
`ppqn` musical-time type. None of that exists outside openDAW's monorepo.
Copying these files into another project means either vendoring that whole
runtime or — what's actually useful — reading the *algorithms* and
reimplementing them in your own idiom. That's what
`docs/instrument/mockups/arrangement-view.html` in this repo does: it
ports four pieces of logic (wheel-zoom calibration, grid snapping and its
drag-safe rounding, the canvas-ruler-plus-playhead pattern, and the
two-handle range-slider minimap) into plain JS/SVG matching
`src/gui/panel.html`'s existing style, with Gnumbat's `downbeats.json` bpm/meter
standing in for openDAW's ppqn signature track. See that file's own header
comment for the line-by-line mapping back to the files above.

## License note

AGPL-3.0 is copyleft, and the network-use clause (§13) is broader than
plain GPL — it applies to a program *offered as a service over a network*,
not just software that's distributed. Gnumbat's live-performance instrument
and TUI aren't a network service in that sense, but the planned VST plugin
GUI is a shipped binary, and the tipping-protocol backend is definitely a
network service. If any adapted openDAW code (not just the
algorithm-level ports in `arrangement-view.html`, but a closer derivative)
ends up in something you distribute or run as a service, get real legal
advice before deciding how much of this repo needs to become AGPL-3
itself — this note is informational, not legal advice, and Gnumbat doesn't
currently declare a license of its own (no `LICENSE` file), which is worth
resolving either way before this goes further.
