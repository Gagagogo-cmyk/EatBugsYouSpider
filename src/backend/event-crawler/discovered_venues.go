package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

// DiscoveredVenue is a venue found via the Ollama navigator (-discover) and
// then promoted (-promote) into the regular scheduled scrape. Unlike the
// hardcoded venues in venues.go, it has no CSS selector -- extraction always
// goes through Ollama. What IS cached is EventsURL: the page the navigator
// landed on last time EXTRACT fired, so routine scrapes can skip straight
// there ("hardcoded") instead of re-running the full NAVIGATE loop every
// cycle. If that cached URL stops working, the venue falls back to a full
// re-discovery from StartURL and EventsURL gets updated -- see
// scrapeAllDiscoveredVenues.
type DiscoveredVenue struct {
	Key                string `json:"key"`
	Name               string `json:"name"`
	StartURL           string `json:"start_url"`  // original homepage -- used when a full re-discovery is needed
	EventsURL          string `json:"events_url"` // cached "hardcoded" fast-path URL (last known good events page)
	Render             bool   `json:"render"`     // whether this venue needs headless-Chrome rendering (see render.go) -- set from the -render flag at promotion time
	PromotedAt         string `json:"promoted_at"`
	LastVerifiedAt     string `json:"last_verified_at,omitempty"`
	LastRediscoveredAt string `json:"last_rediscovered_at,omitempty"`
}

const discoveredVenuesFile = "discovered_venues.json"

// discoveredVenuesFileMu guards the read-modify-write in promoteVenue.
// promoteVenue used to only ever be called from a single -discover CLI
// invocation (one process, one call, no concurrency to worry about), but
// runConcurrent (main.go) can now call it from several goroutines at once --
// one per hardcoded venue whose selector broke this cycle -- and without a
// lock, two concurrent load-modify-save round trips race and the loser's
// promotion silently vanishes from disk.
var discoveredVenuesFileMu sync.Mutex

func loadDiscoveredVenues() ([]DiscoveredVenue, error) {
	data, err := os.ReadFile(discoveredVenuesFile)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", discoveredVenuesFile, err)
	}
	var venues []DiscoveredVenue
	if err := json.Unmarshal(data, &venues); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", discoveredVenuesFile, err)
	}
	return venues, nil
}

func saveDiscoveredVenues(venues []DiscoveredVenue) error {
	data, err := json.MarshalIndent(venues, "", "\t")
	if err != nil {
		return fmt.Errorf("marshaling discovered venues: %w", err)
	}
	return os.WriteFile(discoveredVenuesFile, data, 0644)
}

// promoteVenue runs a full discovery against cfg.StartURL, and if it
// successfully finds events, saves (or updates) a DiscoveredVenue entry so
// every future scheduled scrape (-conc / -serve) picks it up automatically --
// the "hardcode it" step, minus a CSS selector. Nothing is saved if
// discovery fails, so a confusing site can't silently join the live site.
// Returns the full DiscoverResult (not just the events) so callers can merge
// into the persistent multi-venue store keyed by VenueKey/VenueName -- see
// mergeVenueEvents in events_store.go.
//
// Uses discoverVenueAuto rather than discoverVenueDetailed directly, so a
// venue added without -render (the common case: whoever's adding it usually
// has no idea whether the site is JavaScript-rendered) still gets tried with
// headless-Chrome rendering automatically if the fast path comes back empty
// -- see discoverVenueAuto's own comment in discover.go. What actually
// worked (result.Rendered) is what gets saved as this venue's Render flag,
// not whatever cfg.Render happened to be going in.
func promoteVenue(cfg DiscoverConfig) (DiscoverResult, error) {
	result, err := discoverVenueAuto(cfg)
	if err != nil {
		return DiscoverResult{}, err
	}

	// Only the file read-modify-write needs the lock -- the (potentially
	// minutes-long) discovery run above stays unlocked so concurrent
	// promoteVenue calls (see runConcurrent, main.go) don't serialize on
	// each other for the slow part, only the fast part.
	discoveredVenuesFileMu.Lock()
	defer discoveredVenuesFileMu.Unlock()

	venues, err := loadDiscoveredVenues()
	if err != nil {
		return DiscoverResult{}, err
	}

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range venues {
		if venues[i].Key == result.VenueKey {
			venues[i].EventsURL = result.FoundURL
			venues[i].Render = result.Rendered
			venues[i].LastVerifiedAt = now
			found = true
			break
		}
	}
	if !found {
		venues = append(venues, DiscoveredVenue{
			Key:            result.VenueKey,
			Name:           result.VenueName,
			StartURL:       cfg.StartURL,
			EventsURL:      result.FoundURL,
			Render:         result.Rendered,
			PromotedAt:     now,
			LastVerifiedAt: now,
		})
	}

	if err := saveDiscoveredVenues(venues); err != nil {
		return DiscoverResult{}, err
	}

	return result, nil
}

// scrapeDiscoveredVenueFast is the "hardcoded" fast path for a promoted
// venue: fetch the cached EventsURL directly and extract, skipping the
// NAVIGATE loop entirely. ok is false only on a hard failure (page fetch
// error, or an Ollama/JSON error from the extractor) -- an empty-but-
// successful extraction (no upcoming events right now) is NOT treated as a
// failure, since that can legitimately happen and shouldn't trigger a
// re-discovery.
func scrapeDiscoveredVenueFast(dv DiscoveredVenue, client *OllamaClient, allowedDomains []string, timeout time.Duration) (events EventList, ok bool) {
	snap, err := fetchSnapshot(dv.EventsURL, allowedDomains, timeout, dv.Render, false)
	if err != nil {
		log.Printf("[%s] cached events URL failed (%v) -- will try full re-discovery", dv.Key, err)
		return nil, false
	}

	events, err = extractEvents(client, snap, dv.Key, dv.Name)
	if err != nil {
		log.Printf("[%s] extraction from cached URL failed (%v) -- will try full re-discovery", dv.Key, err)
		return nil, false
	}

	return events, true
}

// scrapeAllDiscoveredVenues scrapes every promoted venue using the fast
// cached-URL path, falling back to a full re-discovery per venue if the
// cached URL is broken (see scrapeDiscoveredVenueFast). Any URL/timestamp
// updates are persisted back to discoveredVenuesFile at the end. Results are
// written into `into`, keyed by venue key, guarded by mu -- meant to be
// called from its own goroutine alongside the hardcoded venues in
// runConcurrent() (main.go).
func scrapeAllDiscoveredVenues(venues []DiscoveredVenue, mu *sync.Mutex, into map[string]EventList) {
	client := NewOllamaClient(*ollamaHost, *ollamaModel, *ollamaTimeout)
	const plainFetchTimeout = 30 * time.Second
	const renderFetchTimeout = 60 * time.Second // headless Chrome needs real time to load + settle

	changed := false
	for i := range venues {
		dv := &venues[i]
		fmt.Printf("Scraping (discovered) %s...\n", dv.Name)

		_, allowedDomains, err := allowedDomainsForURL(dv.StartURL)
		if err != nil {
			log.Printf("[%s] bad start URL %q, skipping: %v", dv.Key, dv.StartURL, err)
			continue
		}

		fetchTimeout := plainFetchTimeout
		if dv.Render {
			fetchTimeout = renderFetchTimeout
		}
		events, ok := scrapeDiscoveredVenueFast(*dv, client, allowedDomains, fetchTimeout)

		if !ok {
			fmt.Printf("[%s] falling back to full re-discovery from %s\n", dv.Key, dv.StartURL)
			result, err := discoverVenueDetailed(DiscoverConfig{
				StartURL:          dv.StartURL,
				OllamaHost:        *ollamaHost,
				Model:             *ollamaModel,
				MaxSteps:          *discoverSteps,
				OllamaTimeout:     *ollamaTimeout,
				Render:            dv.Render,
				VenueKeyOverride:  dv.Key,
				VenueNameOverride: dv.Name,
			})
			if err != nil {
				log.Printf("[%s] re-discovery also failed this cycle, skipping: %v", dv.Key, err)
				continue
			}
			events = result.Events
			dv.EventsURL = result.FoundURL
			dv.LastRediscoveredAt = time.Now().Format(time.RFC3339)
			fmt.Printf("[%s] re-discovery succeeded, cached URL updated to %s\n", dv.Key, dv.EventsURL)
		}

		dv.LastVerifiedAt = time.Now().Format(time.RFC3339)
		changed = true

		mu.Lock()
		into[dv.Key] = events
		mu.Unlock()
	}

	if changed {
		if err := saveDiscoveredVenues(venues); err != nil {
			fmt.Println("warning: failed to persist discovered venues:", err)
		}
	}
}
