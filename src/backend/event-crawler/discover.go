package main

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// DiscoverConfig controls one navigator-driven discovery run against an
// arbitrary venue site -- one that isn't in the hardcoded allVenues map in
// venues.go.
type DiscoverConfig struct {
	StartURL       string
	OllamaHost     string
	Model          string
	MaxSteps       int
	RequestTimeout time.Duration // per-page fetch timeout (Colly, or headless Chrome if Render is set)
	OllamaTimeout  time.Duration // per-call timeout for Ollama (navigator/extractor); can be slow on first run -- see NewOllamaClient
	Render         bool          // use headless Chrome instead of a plain HTTP fetch -- see render.go; needed for JS-rendered sites like Evenko
	Headed         bool          // with Render: open a visible Chrome window instead of a hidden headless one, for debugging what the page actually shows
	Verbose        bool

	// VenueKeyOverride/VenueNameOverride force the discovered venue's
	// identity instead of letting it be auto-derived from StartURL's
	// hostname ("discover-" + slugify(host)) and the page's <title>. Used
	// when discovery is a *fallback* for a venue that already has a known
	// identity -- e.g. a hardcoded venue (venues.go) whose selector broke,
	// or re-discovering an already-promoted venue -- so it keeps the same
	// key (map marker, ?venue= filter link, all_events.json entry) instead
	// of turning into what looks like a brand new venue. Leave both empty
	// for a genuinely new venue (e.g. one submitted through the "add venue"
	// form), where auto-deriving the identity is exactly what's wanted.
	VenueKeyOverride  string
	VenueNameOverride string
}

// DiscoverResult is the full outcome of a discovery run -- not just the
// events, but where they were found. FoundURL is what makes "promotion"
// possible (see discovered_venues.go): it's the page a future scrape can go
// straight to instead of re-running the whole NAVIGATE loop. Rendered
// records whether headless-Chrome rendering (render.go) was actually used to
// produce this result -- which may differ from the Render a caller originally
// asked for, when the auto-detect path in discoverVenueAuto is involved.
type DiscoverResult struct {
	Events    EventList
	VenueKey  string
	VenueName string
	FoundURL  string // the page URL where EXTRACT actually fired
	Rendered  bool   // whether headless-Chrome rendering was used to get this result
}

// DiscoverVenue drives Colly through an arbitrary venue website, using Ollama
// as the "brain": the Navigator decides where to click (see
// discover_navigator.go), the Extractor turns the events page into Event data
// (see discover_extractor.go). This is the loop from the design doc:
//
//	COLLY (fetch) -> snapshot -> OLLAMA (decide) -> NAVIGATE / EXTRACT / STOP
//	                                  ^                  |
//	                                  +---- COLLY <-------+ (navigate)
//
// Ollama never fetches a page itself; it only ever reasons over the
// PageSnapshot Colly builds for it, and can only choose URLs Colly actually
// found on the page (enforced in decideNavigation).
//
// This is a thin wrapper around discoverVenueAuto for callers that only care
// about the events themselves. Callers that need to know *where* they were
// found, or whether rendering ended up being used (like -promote, see
// discovered_venues.go), should call discoverVenueAuto directly.
func DiscoverVenue(cfg DiscoverConfig) (EventList, error) {
	result, err := discoverVenueAuto(cfg)
	if err != nil {
		return nil, err
	}
	return result.Events, nil
}

// discoverVenueAuto is the default discovery strategy, and the reason a
// person adding a venue from anywhere in the world doesn't need to know or
// guess whether that venue's site happens to be JavaScript-rendered: it
// tries the fast path first (a plain HTTP fetch via Colly, no browser --
// cfg.Render left false), since most independent/smaller venue sites are
// still simple server-rendered HTML, and that path is roughly an order of
// magnitude faster per page. Only if that comes back empty (found the
// events page but 0 events -- suspicious for a first-time "cold" discovery,
// where "no events" more often means "the real content never loaded" than
// "this venue genuinely has nothing upcoming") or fails outright does it
// retry the *whole* discovery with headless-Chrome rendering (render.go),
// which is slower but actually executes JavaScript. Whichever attempt
// succeeds is what promoteVenue "hardcodes" -- so a JS-heavy site like
// Evenko ends up with Render:true saved, a plain site ends up with
// Render:false, and the person who added the venue never had to know which.
//
// If cfg.Render is already true when this is called, that's treated as an
// explicit request to skip straight to the rendered path (e.g. -render on
// the command line, when you already know a site needs it and don't want to
// burn time on a fast attempt you know will fail) -- only cfg.Render==false
// triggers the two-phase auto-detect.
func discoverVenueAuto(cfg DiscoverConfig) (DiscoverResult, error) {
	if cfg.Render {
		return discoverVenueDetailed(cfg)
	}

	fastCfg := cfg
	fastCfg.Render = false
	fastResult, fastErr := discoverVenueDetailed(fastCfg)
	if fastErr == nil && len(fastResult.Events) > 0 {
		return fastResult, nil
	}

	if cfg.Verbose {
		if fastErr != nil {
			fmt.Printf("[discover] fast (non-rendered) attempt failed (%v) -- retrying with headless-Chrome rendering, in case this site needs JavaScript\n", fastErr)
		} else {
			fmt.Println("[discover] fast (non-rendered) attempt found 0 events -- retrying with headless-Chrome rendering, in case this site needs JavaScript to show its content")
		}
	}

	renderedCfg := cfg
	renderedCfg.Render = true
	renderedResult, renderErr := discoverVenueDetailed(renderedCfg)
	if renderErr != nil {
		if fastErr != nil {
			// both attempts failed outright
			return DiscoverResult{}, fmt.Errorf("both a plain fetch and a rendered (headless Chrome) attempt failed -- plain: %v; rendered: %w", fastErr, renderErr)
		}
		// the fast attempt structurally succeeded but found 0 events, and
		// the rendered retry then failed outright (e.g. Chrome not
		// installed) -- an empty-but-valid fast result still beats nothing
		if cfg.Verbose {
			fmt.Printf("[discover] rendered retry also failed (%v) -- keeping the fast attempt's result (%d event(s))\n", renderErr, len(fastResult.Events))
		}
		return fastResult, nil
	}
	return renderedResult, nil
}

func discoverVenueDetailed(cfg DiscoverConfig) (DiscoverResult, error) {
	host, allowedDomains, err := allowedDomainsForURL(cfg.StartURL)
	if err != nil {
		return DiscoverResult{}, err
	}

	venueKey := cfg.VenueKeyOverride
	if venueKey == "" {
		venueKey = "discover-" + slugify(host)
	}
	client := NewOllamaClient(cfg.OllamaHost, cfg.Model, cfg.OllamaTimeout)

	maxSteps := cfg.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 8
	}
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		if cfg.Render {
			timeout = 60 * time.Second // headless Chrome needs real time to load + settle, not just a network round trip
		} else {
			timeout = 30 * time.Second
		}
	}

	currentURL := cfg.StartURL
	// visitedSnaps caches every page's snapshot, keyed by normalizeURLForCompare,
	// so a trailing-slash or #fragment variant still counts as "already seen".
	// Caching the snapshot itself (not just a visited/not-visited bool) is what
	// lets the "navigator looped back" recovery below extract from the RIGHT
	// page instead of whatever page currently happens to be in scope -- see the
	// "navigate" case.
	visitedSnaps := make(map[string]PageSnapshot)
	venueName := cfg.VenueNameOverride

	for step := 0; step < maxSteps; step++ {
		currentKey := normalizeURLForCompare(currentURL)
		if _, already := visitedSnaps[currentKey]; already {
			return DiscoverResult{}, fmt.Errorf("navigator looped back to an already-visited URL: %s", currentURL)
		}

		if cfg.Verbose {
			fmt.Printf("[discover] step %d/%d: visiting %s\n", step+1, maxSteps, currentURL)
		}

		snap, err := fetchSnapshot(currentURL, allowedDomains, timeout, cfg.Render, cfg.Headed)
		if err != nil {
			return DiscoverResult{}, fmt.Errorf("fetching %s: %w", currentURL, err)
		}
		visitedSnaps[currentKey] = snap
		if venueName == "" {
			venueName = firstNonEmpty(snap.Title, host)
		}

		if cfg.Verbose {
			fmt.Printf("[discover] page title: %q | %d heading(s) | %d nav link(s) | %d other link(s) | %d event link(s) | %d chars of visible text\n",
				snap.Title, len(snap.Headings), len(snap.NavLinks), len(snap.OtherLinks), len(snap.EventLinks), len([]rune(snap.VisibleText)))
			fmt.Printf("[discover] visible text preview: %s\n", truncate(snap.VisibleText, 400))
			fmt.Println("[discover] asking navigator (this can be slow on the first call while the model loads)...")
		}
		decision, err := decideNavigation(client, snap)
		if err != nil {
			return DiscoverResult{}, fmt.Errorf("navigator error at %s: %w", currentURL, err)
		}

		if cfg.Verbose {
			fmt.Printf("[discover] navigator decided: %s (confidence %.2f) -- %s\n",
				decision.Action, decision.Confidence, decision.Reason)
		}

		switch decision.Action {
		case "navigate":
			next := decision.URL
			nextKey := normalizeURLForCompare(next)
			if targetSnap, already := visitedSnaps[nextKey]; already {
				// The navigator wants to go to a page it (or an earlier step)
				// already visited -- either a literal "you are here" self-link
				// back to the current page, or (as with Evenko wandering into
				// "Ventes de groupes" and then trying to return to the real
				// events page it saw two steps earlier) a page from further
				// back in the walk. Either way, failing the whole discovery
				// over it would be wrong, but so would extracting from
				// whatever page we currently happen to be standing on -- that
				// silently returns the WRONG page's content (e.g. a handful
				// of group-sales listings instead of the real events list).
				// The fix: extract from the CACHED snapshot of the page the
				// navigator actually asked for, not the current one.
				if cfg.Verbose {
					fmt.Printf("[discover] navigator chose an already-visited URL (%s) -- extracting from that cached page instead of looping\n", targetSnap.URL)
				}
				events, err := extractEvents(client, targetSnap, venueKey, venueName)
				if err != nil {
					return DiscoverResult{}, fmt.Errorf("extractor error at %s: %w", targetSnap.URL, err)
				}
				if cfg.Verbose {
					fmt.Printf("[discover] extractor found %d upcoming event(s) at %s\n", len(events), targetSnap.URL)
				}
				return DiscoverResult{
					Events:    events,
					VenueKey:  venueKey,
					VenueName: venueName,
					FoundURL:  targetSnap.URL,
					Rendered:  cfg.Render,
				}, nil
			}
			currentURL = next
			continue

		case "extract":
			if cfg.Verbose {
				fmt.Println("[discover] asking extractor to pull events from this page...")
			}
			events, err := extractEvents(client, snap, venueKey, venueName)
			if err != nil {
				return DiscoverResult{}, fmt.Errorf("extractor error at %s: %w", currentURL, err)
			}
			if cfg.Verbose {
				fmt.Printf("[discover] extractor found %d upcoming event(s) at %s\n", len(events), currentURL)
			}
			return DiscoverResult{
				Events:    events,
				VenueKey:  venueKey,
				VenueName: venueName,
				FoundURL:  currentURL,
				Rendered:  cfg.Render,
			}, nil

		case "stop":
			reason := decision.Reason
			if reason == "" {
				reason = "no reason given"
			}
			return DiscoverResult{}, fmt.Errorf("navigator stopped at %s: %s", currentURL, reason)

		default:
			return DiscoverResult{}, fmt.Errorf("unexpected navigator action %q", decision.Action)
		}
	}

	return DiscoverResult{}, errors.New("reached max navigation steps without finding events -- try raising -max-steps")
}

// allowedDomainsForURL parses a URL and returns its hostname plus the
// www./non-www. pair Colly should be scoped to while navigating that site.
func allowedDomainsForURL(rawURL string) (host string, allowedDomains []string, err error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", nil, fmt.Errorf("invalid URL %q: %w", rawURL, err)
	}
	host = parsed.Hostname()
	if host == "" {
		return "", nil, fmt.Errorf("URL %q has no host", rawURL)
	}

	allowedDomains = []string{host}
	if strings.HasPrefix(host, "www.") {
		allowedDomains = append(allowedDomains, strings.TrimPrefix(host, "www."))
	} else {
		allowedDomains = append(allowedDomains, "www."+host)
	}
	return host, allowedDomains, nil
}
