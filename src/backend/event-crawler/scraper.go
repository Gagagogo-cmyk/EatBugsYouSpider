package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/gocolly/colly/v2"
)

// scrapeVenue scrapes the HTML content of a Venue, then parses it in parsers.go
func scrapeVenue(venueKey string, venue Venue) (events EventList) {
	events = make(EventList, 0, 20)

	c := colly.NewCollector(
		colly.AllowedDomains(venue.AllowedDomains...),
	)
	c.OnHTML(venue.Selector, func(h *colly.HTMLElement) {
		event, missing := parseEvent(h, venueKey)

		// skip if event already happened
		if event.AlreadyHappened {
			return
		}
		if len(missing) > 0 {
			fmt.Printf("\t[%s]: missing: %v\n", venueKey, strings.Join(missing, ", "))
		}
		events = append(events, event)
	})

	c.OnError(func(r *colly.Response, e error) {
		fmt.Printf("Error: %s\n", e.Error())
	})
	c.OnScraped(func(r *colly.Response) {
		fmt.Printf("Scraping for %s finished.\n", venue.Name)
	})
	c.SetRequestTimeout(30 * time.Second)

	if err := c.Visit(venue.Link); err != nil {
		return nil
	}
	return events
}
