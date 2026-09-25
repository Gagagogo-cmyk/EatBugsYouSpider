# Gnumbat Sustainability

How the econo skin keeps Gnumbat's carbon footprint low, and how the header
indicator reports it honestly instead of just showing a flattering number.

---

## Two budgets, not one

Every off-the-shelf carbon calculator — websitecarbon.com's badge, the
Green Web Foundation's CO2.js library, the Ecograder-style tools — measures
the same thing: bytes transferred to a visitor's browser, multiplied by
grid carbon intensity, discounted if the host runs on renewables. That's
the *front-end* budget, and it's real, and Gnumbat's site is already close to
best-in-class on it — the current `site-mockups/gnumbat-website.html` mockup
ships no webfonts, no images, no framework, and comes out to roughly
0.003–0.01g CO2e per visit under the same model those tools use (measured
directly off the mockup while building this — see the indicator code
below). For comparison, a typical modern webpage the Green Web Foundation
surveys runs closer to 0.5–1g per visit. The chrome is already doing the
right thing almost by accident, because "terminal aesthetic, no hero
image, no font CDN" and "low carbon" happen to want the same site.

None of those tools see the *second* budget: Demucs stem separation,
FluCoMa slice analysis, and the local Ollama LLM driving Cricket. That's
compute, not transfer, and for a site whose entire premise is "running on
AI models," it is very likely the larger of the two numbers by a wide
margin — an audio-separation model and a local LLM doing continuous
inference cost real, measurable watts that have nothing to do with how
light the webpage is. A header badge that only reports front-end weight
would be accurate and also misleading, in the specific way that makes
people distrust sustainability claims once they think about it for five
seconds.

The recommendation below is to report both, separately, rather than
blend them into one number — see "The header indicator" section.

---

## The 3-tone palette: what it actually buys you

Restricting the chrome to white / grey / black helps in two different
ways that are worth keeping distinct, because only one of them is a real
carbon lever.

The first is honest signaling and interaction design: a visitor can look
at the page and immediately read "this thing is not spending your battery
on a hero video." That's real, but it's a UX/trust effect, not a
measured emissions reduction — CSS colour values cost nothing to transfer
or render regardless of the palette.

The second is the one that actually moves bytes: a bounded palette is what
makes *raster* images compress well. A 3-value or even a 16–32 value
image can live in an indexed PNG palette where every pixel costs a
fraction of a byte instead of 3 (RGB) or 4 (RGBA); a 24-bit photograph
can't. The site's chrome is already vector/CSS with no raster assets, so
this lever has nothing to act on there — the place it matters is poster
art, covered next.

Current gap: the mockup's `--rec` red (`#e2483d`) on the live-stream dot
is a fourth colour outside the 3-tone constraint. It's a functional status
signal, not decoration — flag when something is actually live — so I left
it alone rather than unilaterally stripping it while prototyping. Worth a
deliberate call: keep it as the one functional exception, or find a
grey/black/white way to signal "live" (a different dot size, a blink
rate, an outline) if the constraint should be truly absolute. Either way,
it's a two-line CSS change once decided.

---

## Posterization: two tiers, not one

The site chrome doesn't need this — it has no photographic assets. Where
it applies is the poster wall, where DJs will eventually upload real
artwork (currently placeholder `<div>`s in the mockup; the upload path
doesn't exist yet). `tools/posterize.py` implements two tiers, and testing
it during this session surfaced a real tradeoff worth knowing before you
wire it in:

**`--tier chrome`** — hard-quantizes to exactly the site's 3 tones, no
dithering by default. Only useful if a raster asset ever needs to live
inside the chrome itself (an icon, a favicon). Tested against a synthetic
300×200 gradient: 70% smaller than the JPEG source *without* dithering.
*With* Floyd–Steinberg dithering turned on, it came out 67% **larger**
than the source — dithering a smooth image down to 3 flat levels injects
exactly the kind of high-frequency noise that defeats PNG's compression.
The script defaults to no dithering for this tier for that reason; a
`--dither-chrome` flag exists if a specific asset needs it for legibility.

**`--tier poster`** (the one you actually want for DJ art) — an adaptive
palette capped at a configurable level count (default 24), Floyd–Steinberg
dithered so gradients still read as gradients. This is the "less
aggressive than the rest of the site" approach you described: it keeps
enough of the source's colour and gradient information to preserve style,
while an indexed PNG with ≤32 colours still compresses dramatically better
than the truecolour photo or screenshot a DJ is likely to submit raw. On
the same test gradient it came out 57% smaller than the source at 16
levels — real photographic poster art with more structure and less pure
gradient will likely compress even further, since posters (typography,
flat colour fields, high-contrast graphics) hit palette-based compression
harder than smooth photographic gradients do.

Run it once per upload — the same pattern as `watch_demucs.py` picking up
`data/raw_uploads/` — not per page view. Wire it into wherever the poster
upload handler eventually lands; it doesn't depend on anything else in the
pipeline, just Pillow.

---

## The fancy-skin split as a carbon lever, not just a feature

"Users can build their own fancy skin, the base model stays econo" is
already the right shape for reducing footprint, independent of what any
individual skin looks like: if the econo skin is the default and loads for
every visitor, and a fancy skin is an explicit, separate bundle (extra
CSS, webfonts, imagery, animation) that only loads for someone who opts
in, then the carbon cost of prettiness is paid only by the people who want
it, never by default traffic. Concretely, that means the fancy-skin CSS
and any assets it needs should not be in the base HTML's `<head>` at all —
loaded via a separate stylesheet/script only after a user picks a skin,
ideally saved to `localStorage` so the choice persists without a server
round-trip. This also gets you something adjacent to the "decentralized"
goal you mentioned: a skin is just a CSS/JS bundle, so people can author
and share their own without needing to touch the base site or its hosting
at all.

---

## Decentralization vs. carbon: they're not the same axis

Worth being explicit about this because it's easy to assume "decentralized
hosting" and "low carbon" pull the same direction — they usually don't.
IPFS-style content-addressed / pinning-network hosting typically costs
*more* energy than a single well-run server, because content gets
replicated across every pinning node rather than served once from
optimized infrastructure; the redundancy that gives you censorship
resistance and no-single-owner is bought with duplicated compute and
storage, not saved by it.

If "decentralized" for Gnumbat is really about *ownership and
self-hostability* — anyone can clone the repo and run their own instance,
no platform can revoke access — that's already substantially served by the
AGPL-3.0 license visible right in the mockup's rack header and by the fact
that the whole stack (Max/Pd, the Express backend, the static site) is
plain, forkable code with no vendor lock-in. That gets you the meaningful
part of "decentralized" without the IPFS energy tax. If literal
multi-location redundancy matters too (uptime, resilience), a handful of
green-hosted mirrors gets closer to that goal per watt than a broad P2P
network does.

**Scoped exception, added once the per-region carnet was decided (see
`NETWORK.md`, "Within one instance: the regional carnet"):** a single
region's own event data, replicated only among nodes actually interested
in that one region — Montréal community members mirroring Montréal's own
carnet — is a bounded version of the same duplication cost, not an
exemption from it. It's small (one city's worth of text metadata, not
audio, see `NETWORK.md`) and it's the *opposite* shape of the case argued
against above: a handful of interested mirrors for one region, not every
node worldwide holding everyone's data. Doesn't change the recommendation
against a network-wide mesh — carves out the one-region-at-a-time case as
an accepted cost instead.

---

## Hosting and infra

The backend runs on Railway today. Two concrete, low-effort levers:

Whether Railway's underlying infrastructure counts as "green hosting"
changes the Gnumbat-controlled half of the front-end carbon number (see
`scripts/check-green-hosting.js`, below) — worth checking once and
revisiting only when the hosting provider changes, not on a schedule.

Static-first delivery matters more than which host serves it: the radio/
tip listener page is already essentially static HTML + CSS + a WebSocket
feed rather than server-rendered per request, which is the cheap-compute
shape to keep as the site gets built out — resist the urge to add
server-side rendering for pages that don't need per-request personalization.

One radio-specific lever worth naming even though it's outside "the
website" proper: stream bitrate. Every listener-hour is continuous
transfer for as long as they're tuned in, unlike a page load's one-time
cost, so a lower Icecast/Liquidsoap bitrate is a carbon lever that scales
with actual listening time rather than pageviews — worth weighing against
the audio quality bar you want for the instrument.

---

## The AI-compute honesty layer

This is the part no off-the-shelf badge can do for you, and it's the part
that actually matters most given what Gnumbat is. `carbon-config.js` has a
placeholder, `INSTRUMENT_GCO2_PER_LISTENER_HOUR`, deliberately left `null`
rather than guessed — showing a made-up number would be worse than
showing none. To fill it in for real:

Run a live session (Demucs separating a track, Ollama generating, the
full instrument loop active) while sampling power draw — on macOS,
`sudo powermetrics --samplers cpu_power,gpu_power -i 1000` gives watts for
CPU and GPU over time; on a machine with an Nvidia GPU, `nvidia-smi --query-gpu=power.draw --format=csv -l 1` does the same for the GPU
specifically. Integrate watts over the session duration to get watt-hours,
convert to kWh, multiply by the grid carbon intensity for wherever the
machine physically runs (494 gCO2/kWh is the SWDv4 global average used
elsewhere in this doc; your actual local grid intensity, especially if
it's mostly hydro/nuclear like a lot of Canadian grids, is probably lower
and worth looking up specifically rather than defaulting to the global
number). Divide by however many "listener-hours" that session served to
get a per-listener-hour figure.

This is explicitly a manual, occasional measurement — same spirit as
`:lora train` being a manual step in the TUI per `CLAUDE.md`, never
something the running server tries to estimate live. Re-measure when the
model, hardware, or pipeline changes meaningfully; don't try to make it
real-time.

---

## The header indicator

Built and wired into the mockup this session:

`src/frontend/eco/carbon.js` — a small, dependency-free module that
measures real transferred bytes for the current page load via the
Performance API (`performance.getEntriesByType('resource')` +
the navigation entry), then runs the same Sustainable Web Design v4
formula that powers websitecarbon.com's badge and the official
`@tgwf/co2` npm package. The constants are copied verbatim from
`@tgwf/co2` v0.19.0's source rather than imported, because that package's
browser entry point drags in ~420KB of per-country/per-year electricity
grid datasets that a single global-average estimate doesn't need — an
irony worth avoiding on a page whose whole point is minimizing what it
ships. If a real bundler gets added to the frontend later, swapping in
the actual npm package (with tree-shaking) is a one-line change; the math
is identical either way.

`src/frontend/eco/carbon-config.js` — the two constants that shouldn't be
computed at runtime: `GREEN_HOSTING` (a fact about the hosting provider,
checked once via `scripts/check-green-hosting.js`, not re-checked per
visitor) and `INSTRUMENT_GCO2_PER_LISTENER_HOUR` (the measured figure from
the section above, `null` until it's actually measured).

`src/backend/scripts/check-green-hosting.js` — the one place any of this
makes a live third-party network call, and it's a script you run by hand
or in CI on deploy, never from the running site. It uses the real
`@tgwf/co2/hosting` check against the Green Web Foundation's Greencheck
API and tells you what to paste into `carbon-config.js`.

For the header itself: it currently renders `[eco: ~0.0Xg CO₂/visit]` in
the topbar, next to the existing nav placeholder, inlined into
`gnumbat-website.html` (matching that file's single-file-mockup convention —
the "real" version to actually wire in is the module above). Given
`docs/platform/WEBSITE.md` already establishes "the temperature indicator
sits near the player" as the site's pattern for live, climate-linked
readouts, it's worth considering moving the eco figure to sit next to that
temperature/entropy indicator instead of (or in addition to) the header —
same visual language, same idea (a live number about the physical world
the instrument runs inside), and it would put the front-end number and the
instrument-compute number in one place once the latter is measured. The
current build puts it in the header because that's what you asked for
outright; moving or duplicating it is a small change either way.

Display text should stay two numbers, not one blended figure, once
`INSTRUMENT_GCO2_PER_LISTENER_HOUR` is filled in — e.g. `[front-end:
~0.01g/visit · engine: ~Xg/listening-hr]` — rather than summing them into
a single mystery total. A blended number is *less* transparent than two
labeled ones, even though it looks tidier.

---

## What's built / what's next

**Built this session:** `src/frontend/eco/carbon.js` (the estimator),
`src/frontend/eco/carbon-config.js` (deploy-time constants),
`src/backend/scripts/check-green-hosting.js` (one-time green-hosting
check), `tools/posterize.py` (two-tier poster quantization, tested), and
the header indicator wired into `site-mockups/gnumbat-website.html`.

**Next:** run `check-green-hosting.js` against the real domain and fill in
`GREEN_HOSTING`; decide on the `--rec` red accent question above; measure
real instrument power draw and fill in
`INSTRUMENT_GCO2_PER_LISTENER_HOUR`; wire `posterize.py` into the poster
upload path once it exists; decide whether the eco indicator moves to sit
with the temperature indicator per `WEBSITE.md`'s existing convention.
