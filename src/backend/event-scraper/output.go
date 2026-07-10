package main

import (
	"time"
)

func saveAllEvents(allEvents map[string]EventList) {
	totalEvents := 0
	for _, events := range allEvents {
		totalEvents += len(events)
	}
	allEventsList := make(EventList, 0, totalEvents)

	for _, event := range allEvents {
		allEventsList = append(allEventsList, event...)
	}

	allEventsList.SortByDate()

	// update cached events for the API
	mu.Lock()
	cachedEvents = allEventsList
	cachedMarkers = buildMarkers(allEventsList)
	lastScrapedAt = time.Now().In(loc)
	mu.Unlock()

}
