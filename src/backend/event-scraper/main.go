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
	sequential     = flag.Bool("seq", false, "sequential scraping")
	concurrent     = flag.Bool("conc", false, "concurrent scraping")
	serve          = flag.Bool("serve", false,
		"scrape concurrently at startup, then runs API server with 1 hour scrape scheduler")
)

func main() {
	start := time.Now()
	flag.Parse()

	if *sequential {
		runSequential()
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
	allEvents := make(map[string]EventList)

	var scrapeMu sync.Mutex
	var wg sync.WaitGroup

	for key, venue := range allVenues {
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
			scrapeMu.Lock()
			allEvents[key] = events
			scrapeMu.Unlock()
		})
	}

	wg.Wait()
	saveAllEvents(allEvents)

	fmt.Println("\nScraping of all venues complete.")
	fmt.Printf("Scraping took %v\n", time.Since(now))
}

func runSequential() {
	fmt.Println("running scraper in sequential mode...")
	allEvents := make(map[string]EventList)

	for key, venue := range allVenues {
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
		allEvents[key] = events
	}
	saveAllEvents(allEvents)
}
