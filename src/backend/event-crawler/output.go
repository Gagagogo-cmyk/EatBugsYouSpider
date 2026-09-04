package main

import (
	"sort"
	"time"
)

// saveAllEvents rebuilds everything the web server serves -- the flat
// sorted event list, the map markers, and the sidebar's venue list -- from
// venues, the full merged+pruned all_events.json store (see
// mergeAllVenueEvents, events_store.go), NOT from a single scrape cycle's
// raw results.
//
// UPDATE — user: "the scraper/crawler isnt actually showing any data. but
// the json is populated. something is broken." Root cause: this used to
// take THIS CYCLE's raw allEvents map directly, so cachedEvents (what the
// site actually serves) only ever reflected whatever the most recent
// -conc/-serve pass happened to scrape -- if even one cycle came back
// empty for a venue (a timeout, Ollama briefly unreachable, anything
// transient), that venue's events vanished from the live site even though
// all_events.json still had them on record from an earlier successful
// scrape, since the two were built from different data. Taking the merged
// store instead (which mergeAllVenueEvents now also protects from being
// overwritten by a single empty cycle -- see keepExistingOnEmpty) means
// the live cache and the on-disk record are always the same data, and a
// bad cycle can no longer blank out events the site already knew about.
func saveAllEvents(venues map[string]VenueBlock) {
	// UPDATE — user: "never put the same venue twice in the menu" / split
	// evenko by venue, drop the duplicate casa del popolo batch. See
	// explodeAndDedupeVenues's own comment (events_store.go) for the full
	// reasoning; this is the one place its result actually reaches the
	// sidebar (venueList, below), the events grid (allEventsList), and the
	// map markers (buildMarkers), since every one of those is built from
	// `venues` right here.
	venues = explodeAndDedupeVenues(venues)

	totalEvents := 0
	for _, block := range venues {
		totalEvents += len(block.Events)
	}
	allEventsList := make(EventList, 0, totalEvents)

	for _, block := range venues {
		allEventsList = append(allEventsList, block.Events...)
	}

	allEventsList.SortByDate()

	venueList := make([]VenueOption, 0, len(venues))
	for key, block := range venues {
		venueList = append(venueList, VenueOption{Key: key, Name: block.Name})
	}
	sort.Slice(venueList, func(i, j int) bool { return venueList[i].Name < venueList[j].Name })

	// genreList -- spec item 6's sidebar tag list. Same "rebuilt fresh after
	// every scrape cycle from the real merged data" reasoning as venueList
	// just above (see DistinctGenres' own comment, events.go) -- not a
	// static/hardcoded list, so a venue whose scraper stops (or starts)
	// returning genre data is reflected here on the very next cycle.
	genreList := DistinctGenres(allEventsList)

	// update cached events for the API
	mu.Lock()
	cachedEvents = allEventsList
	cachedMarkers = buildMarkers(allEventsList)
	cachedVenueList = venueList
	cachedGenreList = genreList
	lastScrapedAt = time.Now().In(loc)
	mu.Unlock()

}
