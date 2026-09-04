# event-scraper

A Montreal music-events crawler with two ways of getting data out of a venue's
website: a fast, hand-written path for venues someone has already looked at,
and a slower, LLM-driven path (local Ollama model) that can figure out an
arbitrary venue site on its own. Both paths land in the same `Event` struct
and the same output files, so the rest of the system (the web frontend, the
JSON API) never needs to know which one produced a given event.

## The two scraping paths

### 1. Hardcoded venues (`venues.go`, `parsers.go`, `scraper.go`)

This is the original approach: for each known venue, a human has looked at
its HTML and written a Colly collector + CSS/XPath selectors (or, for a few
venues with a JSON/AJAX backend, a small API client) that pulls out event
name, date, price, ticket link, etc. It's fast (a plain HTTP request, no
LLM, no browser) and precise, but it only works for venues someone has
specifically coded, and it would otherwise silently break the moment that
venue redesigns its site -- see "Self-healing hardcoded venues" below for how
that's handled now.

`allVenues` in `venues.go` is the registry of these venues (key → `Venue`,
which carries the venue's address, event-page URL, allowed domains, CSS
selector, and lat/lng for the map) -- currently the original 17 (Casa del
Popolo, Quai des Brumes, Club Soda, MTelus, and so on). It was briefly
emptied out during development to test the discovery path from a cold start;
`venues_backup.txt` still has the original details for reference.

### 2. Ollama-driven discovery (`discover*.go`, `ollama.go`, `render.go`)

This is the "smart" path, for a venue nobody has written a parser for yet.
Instead of a hardcoded selector, a local Ollama model (default
`llama3.1:8b`) acts as the decision-maker, and Colly (or headless Chrome —
see below) does the actual fetching. The loop, one page at a time:

1. **Fetch** the current page and build a `PageSnapshot` — title, headings,
   nav links, other links, a curated list of likely ticket/buy links
   (`EventLinks`), and a plain-text rendering of the visible content
   (`discover_snapshot.go`).
2. **Navigate**: hand the snapshot to the Navigator prompt
   (`discover_navigator.go`), which decides `NAVIGATE` (follow one of the
   links actually present on the page — it's never allowed to invent a URL),
   `EXTRACT` (this page has the events), or `STOP` (dead end).
3. On `EXTRACT`, hand the snapshot to the Extractor prompt
   (`discover_extractor.go`), which pulls out structured events, matching
   each one's `ticket_url` against the real `EventLinks` found on the page
   rather than inventing one or reusing a button label like "Buy Tickets".
   Anything that doesn't match a real link on the page gets dropped rather
   than shipped.

Every page visited is cached by URL for the run, so if the Navigator ever
loops back to a page it's already seen, the code extracts from that page's
actual cached content instead of guessing.

**Plain fetch vs. rendered fetch.** Most independent venue sites are still
server-rendered HTML, so `discoverVenueAuto` (`discover.go`) always tries a
plain HTTP fetch (via Colly) first — no browser, fast. Only if that comes
back with zero events does it automatically retry the *entire* discovery
with headless Chrome (`render.go`, via chromedp), which actually executes
JavaScript and is what sites like Evenko/Ticketmaster-backed venues need.
Whichever attempt actually finds events is what gets remembered — nobody
adding a venue needs to know or guess in advance whether its site is
JavaScript-heavy. The rendered path also handles cookie-consent banners
automatically (tries an "X"/close-icon first, then "Accept"-style buttons,
covering OneTrust/Didomi/Cookiebot plus generic English/French text
matches) since an unhandled banner blocks the real page content from ever
loading.

## The self-healing "hardcode" model

Running discovery from scratch (Navigator/Extractor loop, possibly a
headless-Chrome retry) takes anywhere from several seconds to a few minutes.
You don't want to pay that cost on every scheduled scrape, so a successful
discovery run "promotes" the venue: it saves the exact page where `EXTRACT`
fired into `discovered_venues.json` (`discovered_venues.go`), tagged with
whether rendering was needed. Every future scheduled scrape (`-conc` /
`-serve`) goes straight to that cached URL — no Navigator loop, no
re-deciding — and only falls back to a full re-discovery if that cached URL
stops working (`scrapeDiscoveredVenueFast`'s `ok` return distinguishes a
hard failure, which triggers re-discovery, from a legitimately-empty result,
which doesn't). This is the same idea as the hardcoded venues in
`venues.go`, just discovered automatically instead of hand-written, and able
to repair itself if the site changes.

**Hardcoded venues get the same safety net.** In `runConcurrent` (`main.go`),
if a hardcoded venue's scrape comes back with 0 events — the page couldn't
be fetched, or it fetched fine but the CSS selector matched nothing, e.g.
because the site got redesigned — that's treated as a possible break, and a
full Ollama discovery run kicks off automatically, starting from that
venue's own `Link`. It keeps the *same* venue key and name
(`VenueKeyOverride`/`VenueNameOverride` on `DiscoverConfig`) so it stays the
same venue — same map pin, same `?venue=` filter link — rather than
appearing as a separate new one. A successful fallback promotes the venue
into `discovered_venues.json` just like any other discovery, so every
subsequent scrape skips the now-broken selector entirely and goes straight
through the fast, self-healing discovered-venue path instead.

## Website integration (`server.go`, `frontend/base.html`)

The `-serve` web server (`net/http`, port `:6969`) renders
`frontend/base.html` from the in-memory `cachedEvents`/`cachedMarkers`/
`cachedVenueList`, rebuilt after every `-conc`/`-serve` scrape cycle. The
sidebar's venue filter list and the map's markers are driven by this cache
rather than being hardcoded in the HTML, so a newly promoted venue (whether
it graduated from a broken hardcoded selector, or came in through the form
below) shows up without editing the template. Map pins are the one exception
— they need a known lat/lng, which only the hand-entered `venues.go` entries
have, so a purely-discovered venue appears in the events list and the
sidebar filter but without a pin on the map.

The sidebar also has an **"Add a venue"** form: a visitor pastes in any
venue's URL and submits it. The handler (`handleAddVenue`) does minimal
validation (must parse as a real `http(s)://` URL) and immediately kicks off
a full Ollama discovery run in the background (`runVenueSubmission`, via
`go`) rather than holding the request open for the minutes discovery can
take — the visitor gets redirected straight back with a "we're on it"
notice. On success the venue is promoted into `discovered_venues.json` (so
it's self-healing from day one, same as everything else) and merged
directly into the live cache (`mergeNewVenueIntoCache`) so it appears
without waiting for the next scheduled `-conc` cycle. There's currently no
rate limiting or private-network blocking on this endpoint — it accepts any
`http(s)://` URL from any visitor — worth revisiting before this is exposed
publicly at scale.

## Output files

- **`all_events.json`** — the persistent, cumulative record of every venue's
  events, one entry per venue key. This is never wholesale overwritten:
  every successful scrape (a single `-discover` test or a full `-conc` /
  `-serve` run) only updates the venue(s) it actually touched, leaving every
  other venue's entry exactly as it was. On every save, every event across
  the whole store is re-checked against its own date and dropped once it's
  passed — so an event stays listed until the show is actually done,
  regardless of whether that venue gets rescraped in the meantime.
- **`discovered_venues.json`** — the registry of Ollama-discovered venues:
  key, name, start URL, cached events URL, whether rendering is needed, and
  timestamps. This is the "hardcode" record described above.
- In-memory `cachedEvents` (`server.go`) — what the web server actually
  serves. Rebuilt by `saveAllEvents` after each `-conc`/`-serve` scrape
  cycle; not written to disk (the disk record is `all_events.json`).

## Running it

```
go build .

# One-off: run discovery against a single venue and see what it finds.
# Auto-detects plain-HTTP vs. headless-Chrome rendering; on success, saves
# the venue into discovered_venues.json so future -conc/-serve runs pick it
# up automatically.
./event-scraper -discover https://example-venue.com

# Force headless-Chrome rendering (skip the fast-path attempt) -- useful
# once you already know a site needs it.
./event-scraper -discover https://example-venue.com -render

# Same, with a visible (non-headless) browser window, for debugging what
# the page actually shows.
./event-scraper -discover https://example-venue.com -render -headed

# Verbose logging of every Navigator/Extractor decision.
./event-scraper -discover https://example-venue.com -v

# Scrape every hardcoded venue (venues.go) plus every promoted/discovered
# venue (discovered_venues.json) once, then exit.
./event-scraper -conc

# Same, but stay running: scrape immediately, then again every hour, and
# serve the results over HTTP on :6969 (the frontend in frontend/base.html).
./event-scraper -serve
```

Other flags: `-model` (Ollama model, default `llama3.1:8b`), `-ollama-host`
(default `http://localhost:11434`), `-ollama-timeout` (per-call timeout,
default 5m — first call after Ollama starts can be slow while the model
loads), `-max-steps` (how many pages the Navigator may visit before giving
up, default 8).

## Known limitations

- **Date ranges** ("25 août au 6 septembre 2026", for a multi-week theatre
  run) are parsed by `parseDateRange` (`event_util.go`) into a start and end
  date. `IsToday`/`IsTomorrow`/`IsThisWeek` are computed from whether
  `[ParsedDate, ParsedEndDate]` overlaps today/tomorrow/this week (so a
  still-running show correctly shows as "today" every day it's actually on,
  not just its first day), and `AlreadyHappened` is based on the *end* of
  the range. `IsThisWeekend` is an approximation for ranges (checks the
  start/end dates and, if it's on today, today itself, rather than a full
  interval-overlap check) and can occasionally miss a range that spans the
  weekend without starting or ending on it. Only the French "X au Y" phrasing
  is recognized; other range phrasings (English "to", an en dash, etc.)
  still fall through to a parse failure and are kept fail-open.
- **The Navigator can pick a plausible-but-wrong link** (e.g. a group-sales
  page instead of the main events listing) since it's an 8B model reasoning
  from link text alone, with no memory of pages it saw further back. The
  loop/cache guard means a wrong turn doesn't corrupt the result if it
  eventually backtracks to a page it's already seen, but it can still cost
  an extra step or two before landing on the right page.
- **Discovery is slow relative to the hardcoded path** — a Navigator/
  Extractor loop plus a possible headless-Chrome retry is seconds to a few
  minutes, versus milliseconds for a hardcoded CSS-selector scrape. That
  cost is only paid once per venue (at promotion time) and on the rare
  occasions a cached URL breaks, not on every scheduled scrape.
