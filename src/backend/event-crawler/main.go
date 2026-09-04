package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

const addr = ":6969"

var (
	scrapeSchedule = 1 * time.Hour // scrape every hour
	concurrent     = flag.Bool("conc", false, "concurrent scraping")
	serve          = flag.Bool("serve", false,
		"scrape concurrently at startup, then runs API server with 1 hour scrape scheduler")

	// discover mode: the Ollama-driven navigator/extractor, for venues that
	// aren't in the hardcoded allVenues map (venues.go). See discover.go.
	discover        = flag.String("discover", "", "URL of an arbitrary venue site to crawl with the Ollama navigator. On success, automatically saves it into discovered_venues.json so every future -conc/-serve scrape includes it (\"hardcodes\" it) -- nothing is saved if discovery fails.")
	promote         = flag.String("promote", "", "alias for -discover -- same behavior, kept as an explicit name for when you're specifically promoting a venue you already tested")
	ollamaHost      = flag.String("ollama-host", "http://localhost:11434", "base URL of the local Ollama server")
	ollamaModel     = flag.String("model", "llama3.1:8b", "Ollama model to use for the navigator/extractor")
	discoverSteps   = flag.Int("max-steps", 8, "maximum number of pages the navigator may visit before giving up")
	ollamaTimeout   = flag.Duration("ollama-timeout", 5*time.Minute, "timeout per Ollama call -- raise this if you see 'context deadline exceeded' (first-run model loading + long pages can be slow)")
	renderJS        = flag.Bool("render", false, "force headless Chrome (chromedp) rendering, skipping the fast plain-HTTP attempt. Normally you don't need this flag at all: -discover tries a fast plain fetch first and automatically retries with headless-Chrome rendering if that comes back with 0 events, so it works whether or not a venue's site is JavaScript-heavy without you needing to know in advance. Pass -render explicitly only when you already know a site needs it and want to skip straight there (e.g. re-testing a known JS-heavy site like Evenko). Whichever mode actually worked is remembered per-venue once promoted, so this only ever matters on that venue's first successful -discover run.")
	headed          = flag.Bool("headed", false, "with -render: open a VISIBLE Chrome window instead of a hidden headless one, so you can watch what the page actually does (useful for debugging bot-detection or slow-loading content). Ignored without -render.")
	discoverVerbose = flag.Bool("v", false, "verbose discovery logging (prints each navigator decision)")
)

func main() {
	start := time.Now()
	flag.Parse()

	if *discover != "" || *promote != "" {
		runDiscover()
		fmt.Println("\nruntime duration: ", time.Since(start))
		return
	}

	if *concurrent {
		runConcurrent()
		fmt.Println("\nruntime duration: ", time.Since(start))
		return
	}

	if *serve {
		ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer cancel()

		go runOnSchedule(ctx, scrapeSchedule)

		mux := http.NewServeMux()

		mux.HandleFunc("/", handlePage("All Events", func(el EventList) EventList { return el }))
		mux.HandleFunc("/right-now", handlePage("Right Now", EventList.RightNow))
		mux.HandleFunc("/tonight", handlePage("Tonight", EventList.Tonight))
		mux.HandleFunc("/tomorrow", handlePage("Tomorrow", EventList.Tomorrow))
		mux.HandleFunc("/this-week", handlePage("This Week", EventList.ThisWeek))
		mux.HandleFunc("/this-weekend", handlePage("This Weekend", EventList.ThisWeekend))

		mux.HandleFunc("/this-weekend/friday", handlePage("This Weekend — Friday",
			func(el EventList) EventList { return el.ThisWeekend().ByWeekday(time.Friday) }))
		mux.HandleFunc("/this-weekend/saturday", handlePage("This Weekend — Saturday",
			func(el EventList) EventList { return el.ThisWeekend().ByWeekday(time.Saturday) }))
		mux.HandleFunc("/this-weekend/sunday", handlePage("This Weekend — Sunday",
			func(el EventList) EventList { return el.ThisWeekend().ByWeekday(time.Sunday) }))

		mux.HandleFunc("/venues/add", handleAddVenue)

		// /img-proxy -- see handleImageProxy's own comment (server.go, next
		// to baseTmpl) for why poster images are routed through this
		// server instead of hotlinked from their original host directly.
		mux.HandleFunc("/img-proxy", handleImageProxy)

		// Scraper-loading animation -- user: "add a scraper-loading animation
		// using cricket.mp4, centered on screen, visible only while actively
		// scraping, respecting the existing posterize effect." base.html
		// (frontend/base.html) references this at /static/cricket.mp4 inside
		// its own .Scraping-gated branch, so the video only actually renders
		// while a scrape is in flight -- this route just needs to make the
		// file reachable at all, since nothing under frontend/ was served
		// over HTTP before (base.html itself is parsed server-side via
		// html/template, never fetched as a static file by the browser). A
		// single dedicated route per file, rather than a blanket
		// http.FileServer(http.Dir("frontend")) mounted at /static/ -- that
		// would also expose frontend/base.html.bak-* and any other non-public
		// file that happens to live alongside it.
		//
		// ROLLBACK -- a WebM-alpha attempt, then a canvas-chroma-key attempt
		// (and their own /static/cricket_greenkey.mp4 route) both lived here
		// briefly, trying to make this transparent. Both caused real
		// problems (layout/rendering issues) that weren't worth chasing
		// further right now, so this is back to just the one plain opaque
		// route it started with. cricket_greenkey.mp4/cricket_transparent.mov/
		// cricket_transparent.webm are still sitting in frontend/, unused --
		// safe to delete, or revisit transparency later from those.
		mux.HandleFunc("/static/cricket.mp4", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "frontend/cricket.mp4")
		})
		srv := &http.Server{
			Addr:    addr,
			Handler: corsMiddleware(mux),
		}

		go func() {
			<-ctx.Done()
			if err := srv.Shutdown(context.Background()); err != nil {
				fmt.Println("error shutting down application.")
				return
			}
		}()

		fmt.Println("API server running on port : " + addr)
		fmt.Println()
		if err := srv.ListenAndServe(); err != nil {
			return
		}
		return
	}
}

// runDiscover drives the Ollama navigator/extractor against a single
// arbitrary venue URL (passed via -discover, or its alias -promote) and
// prints + saves whatever it finds. On success it does two things: saves the
// venue into discovered_venues.json via promoteVenue (discovered_venues.go)
// so every future -conc/-serve scrape includes it automatically ("hardcodes"
// it), and merges these events into all_events.json (events_store.go) --
// the persistent, cumulative store that every venue's events live in side by
// side, so testing one venue never erases another venue's events, and each
// event sticks around on its own until its date passes. If discovery fails,
// neither file is touched, so a confusing site can't silently join the live
// site.
func runDiscover() {
	targetURL := *discover
	if targetURL == "" {
		targetURL = *promote
	}
	fmt.Printf("Discovering events at %s using Ollama model %q...\n\n", targetURL, *ollamaModel)

	result, err := promoteVenue(DiscoverConfig{
		StartURL:      targetURL,
		OllamaHost:    *ollamaHost,
		Model:         *ollamaModel,
		MaxSteps:      *discoverSteps,
		OllamaTimeout: *ollamaTimeout,
		Render:        *renderJS,
		Headed:        *headed,
		Verbose:       *discoverVerbose,
	})
	if err != nil {
		fmt.Println("discovery failed -- nothing was saved:", err)
		return
	}
	events := result.Events

	events.SortByDate()
	fmt.Printf("\nFound %d upcoming event(s):\n\n", len(events))
	for _, e := range events {
		fmt.Printf("- %s | %s | %s %s | %s\n", e.Name, e.Venue, e.Date, e.Time, e.TicketURL)
	}

	fmt.Println("\nSaved to discovered_venues.json -- this venue will now be scraped automatically on every -conc / -serve run.")

	if err := mergeVenueEvents(result.VenueKey, result.VenueName, events); err != nil {
		fmt.Println("warning: failed to update all_events.json:", err)
	} else {
		fmt.Println("Merged into all_events.json -- other venues' events are untouched, and these will stay listed until their dates pass.")
	}
}

func runOnSchedule(ctx context.Context, interval time.Duration) {
	fmt.Println("running scraper on schedule...")
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// scrape immediately
	runConcurrent()

	for {
		select {
		case <-ticker.C:
			fmt.Println("Scheduled scrape starting...")
			runConcurrent()
		case <-ctx.Done():
			fmt.Println("Scheduler stopped.")
			return
		}
	}
}

func runConcurrent() {
	now := time.Now()
	fmt.Println("running scraper in concurrent mode...")

	// scraping flag -- see its own comment (server.go) for why this exists
	// instead of gating the loading video on LastScrapedAt alone. On for
	// the full duration of this function, off again once saveAllEvents (or
	// its fallback below) has run.
	mu.Lock()
	scraping = true
	mu.Unlock()

	allEvents := make(map[string]EventList)

	var scrapeMu sync.Mutex
	var wg sync.WaitGroup

	// Loaded up front (not after the hardcoded loop) so the hardcoded loop
	// below can skip any venue that has already graduated to the discovered/
	// self-healing path -- see the discoveredKeys check.
	discoveredVenues, err := loadDiscoveredVenues()
	if err != nil {
		fmt.Println("warning: could not load discovered_venues.json:", err)
	}
	discoveredKeys := make(map[string]bool, len(discoveredVenues))
	for _, dv := range discoveredVenues {
		discoveredKeys[dv.Key] = true
	}

	for key, venue := range allVenues {
		if discoveredKeys[key] {
			// This hardcoded venue's selector broke in an earlier cycle and
			// it already fell back to discovery successfully -- it's now
			// tracked in discovered_venues.json under this same key, so the
			// scrapeAllDiscoveredVenues goroutine below handles it (and its
			// own self-healing fallback) instead. Re-attempting the known-
			// broken hardcoded path every cycle would just waste time.
			continue
		}
		wg.Go(func() {
			fmt.Printf("Scraping %s...\n", venue.Name)
			var events EventList

			switch key {
			case "turbo-haus":
				events = scrapeTurboHausJSON()
			case "bar-le-ritz":
				events = scrapeBarLeRitzJSON()
			case "mtelus":
				events = scrapeMTelusJSON()
			case "olympia":
				events = scrapeOlympiaAJAX()
			default:
				events = scrapeVenue(key, venue)
			}

			if len(events) == 0 {
				// Either the page couldn't be fetched at all, or it fetched
				// fine but the hand-written selector matched nothing -- both
				// collapse to "0 events" here, and either one is a
				// reasonable sign the site changed under this venue's
				// selector. Fall back to a full Ollama discovery run,
				// starting from the same URL this venue already uses, kept
				// under the SAME key/name so it stays the same venue (map
				// marker, ?venue= filter link) rather than becoming a
				// separate "new" one.
				fmt.Printf("[%s] hardcoded path found 0 events -- falling back to Ollama discovery from %s\n", key, venue.Link)
				result, discErr := promoteVenue(DiscoverConfig{
					StartURL:          venue.Link,
					OllamaHost:        *ollamaHost,
					Model:             *ollamaModel,
					MaxSteps:          *discoverSteps,
					OllamaTimeout:     *ollamaTimeout,
					Verbose:           *discoverVerbose,
					VenueKeyOverride:  key,
					VenueNameOverride: venue.Name,
				})
				if discErr != nil {
					fmt.Printf("[%s] fallback discovery also failed this cycle, keeping 0 events: %v\n", key, discErr)
				} else {
					fmt.Printf("[%s] fallback discovery succeeded (%d event(s)) -- now self-healing via discovered_venues.json\n", key, len(result.Events))
					events = result.Events
				}
			}

			scrapeMu.Lock()
			allEvents[key] = events
			scrapeMu.Unlock()
		})
	}

	// Promoted (-promote, or a hardcoded venue that just fell back above)
	// venues: scraped via their cached "hardcoded" URL, falling back to a
	// full Ollama re-discovery if that URL breaks. See discovered_venues.go.
	// Run as one extra goroutine (not one per venue -- a single local Ollama
	// instance serves requests one at a time anyway, so there's nothing to
	// gain from parallelizing these against each other, only against the
	// hardcoded venues above).
	if len(discoveredVenues) > 0 {
		wg.Go(func() {
			scrapeAllDiscoveredVenues(discoveredVenues, &scrapeMu, allEvents)
		})
	}

	wg.Wait()

	// Every known venue's display name (hardcoded + discovered), used both
	// to rebuild the sidebar's venue list (saveAllEvents, output.go) and to
	// merge this run's results into all_events.json without wiping any
	// venue NOT scraped this cycle -- see events_store.go.
	names := make(map[string]string, len(allVenues)+len(discoveredVenues))
	for key, venue := range allVenues {
		names[key] = venue.Name
	}
	for _, dv := range discoveredVenues {
		names[dv.Key] = dv.Name
	}

	// Build the live site's cache from the full merged all_events.json store
	// (see saveAllEvents's own comment, output.go, for why this changed from
	// passing THIS cycle's raw allEvents directly) -- only fall back to that
	// raw, cycle-only data if the merge itself failed (e.g. a disk error),
	// so the site still shows something rather than going fully stale.
	venues, err := mergeAllVenueEvents(allEvents, names)
	if err != nil {
		fmt.Println("warning: failed to update all_events.json:", err)
		fallback := make(map[string]VenueBlock, len(allEvents))
		for key, events := range allEvents {
			fallback[key] = VenueBlock{Name: names[key], Events: events}
		}
		saveAllEvents(fallback)
	} else {
		saveAllEvents(venues)
	}

	mu.Lock()
	scraping = false
	mu.Unlock()

	fmt.Println("\nScraping of all venues complete.")
	fmt.Printf("Scraping took %v\n", time.Since(now))
}
