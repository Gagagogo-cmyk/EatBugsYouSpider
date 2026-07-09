package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

func saveAllEvents(allEvents map[string]EventList) {
	for _, dir := range []string{"right_now", "tonight", "tomorrow", "this_week", "this_weekend", "output"} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Printf("Failed to create %s directory: %v\n", dir, err)
			return
		}
	}

	// Create group subdirectories
	for _, venue := range allVenues {
		if venue.Group != "" {
			if err := os.MkdirAll(fmt.Sprintf("output/%s", venue.Group), 0755); err != nil {
				fmt.Printf("Failed to create group directory %s: %v\n", venue.Group, err)
			}
		}
	}

	totalEvents := 0
	for _, events := range allEvents {
		totalEvents += len(events)
	}
	allEventsList := make(EventList, 0, totalEvents)

	for venueKey, event := range allEvents {
		venue := allVenues[venueKey]

		// Use group subdir if venue belongs to a group (rare)
		path := "output"
		if venue.Group != "" {
			path = fmt.Sprintf("output/%s", venue.Group)
		}
		saveAllEventsToTextFile(event, fmt.Sprintf("%s/%s.txt", path, venueKey), venue.Name)
		saveVenueEventsJSON(event, venueKey, venue.Name, path)

		allEventsList = append(allEventsList, event...)
	}

	allEventsList.SortByDate()

	// update cached events for the API
	mu.Lock()
	cachedEvents = allEventsList
	cachedMarkers = buildMarkers(allEventsList)
	lastScrapedAt = time.Now().In(loc)
	mu.Unlock()

	// all Jason output
	//saveAllEventsJSON(allEventsList)
	//saveRightNowJSON(allEventsList)
	//saveTonightJSON(allEventsList)
	//saveTomorrowJSON(allEventsList)
	//saveThisWeekJSON(allEventsList)
	//saveThisWeekendJSON(allEventsList)
	//
	//// all filtered output
	//saveEventsText(allEventsList.RightNow(), "right_now/right_now.txt", "RIGHT NOW")
	//saveEventsText(allEventsList.Tonight(), "tonight/tonight.txt", "tonight")
	//saveEventsText(allEventsList.Tomorrow(), "tomorrow/tomorrow.txt", "tomorrow")
	//saveEventsText(allEventsList.ThisWeek(), "this_week/this_week.txt", "this week")
	//saveEventsText(allEventsList.ThisWeekend(), "this_weekend/this_weekend.txt", "this weekend")

}

func saveAllEventsToTextFile(events EventList, filename, venueName string) error {
	var sb strings.Builder
	sb.Grow(len(events) * 512)

	sb.WriteString(fmt.Sprintf("%s Events\n", venueName))
	sb.WriteString(strings.Repeat("=", 90) + "\n\n")

	if len(events) == 0 {
		sb.WriteString("No upcoming events.\n")
	}

	for i, e := range events {
		sb.WriteString(fmt.Sprintf("Event #%d\n", i+1))
		sb.WriteString(fmt.Sprintf("Name:      %s\n", e.Name))
		sb.WriteString(fmt.Sprintf("Venue:     %s\n", e.Venue))
		sb.WriteString(fmt.Sprintf("Address:   %s\n", e.Address))
		sb.WriteString(fmt.Sprintf("Date:      %s\n", e.Date))
		if e.Time != "" {
			sb.WriteString(fmt.Sprintf("Time:      %s\n", e.Time))
		} else {
			sb.WriteString("Time:      not available\n")
		}
		if e.Price != "" {
			sb.WriteString(fmt.Sprintf("Price:     %s\n", e.Price))
		} else {
			sb.WriteString("Price:     not available.\n")
		}
		if e.TicketURL != "" {
			sb.WriteString(fmt.Sprintf("Ticket Link:  %s\n\n", e.TicketURL))
		} else {
			sb.WriteString("Ticket Link:  not available\n\n\n")
		}

		// ---------------------------- detailed info ------------------------------
		sb.WriteString(fmt.Sprintf("Parsed Date:       %s\n", e.ParsedDate))
		sb.WriteString(fmt.Sprintf("Day of week:       %s\n", e.DayOfWeek))
		if e.Price != "" {
			sb.WriteString(fmt.Sprintf("Price value:       %.2f\n", e.PriceValue))
			sb.WriteString(fmt.Sprintf("is free:           %t\n", e.IsFree))
		}
		sb.WriteString(fmt.Sprintf("Days Until:        %d\n", e.DaysUntil))
		sb.WriteString(fmt.Sprintf("is today:          %t\n", e.IsToday))
		sb.WriteString(fmt.Sprintf("is this week:      %t\n", e.IsThisWeek))
		sb.WriteString(fmt.Sprintf("is this weekend:   %t\n\n", e.IsThisWeekend))
		sb.WriteString(strings.Repeat("-", 90) + "\n\n")
	}

	return os.WriteFile(filename, []byte(sb.String()), 0644)
}

// -------------------------------------FILTERED---------------------------------------------------

func saveEventsText(events EventList, filename, label string) error {

	var sb strings.Builder
	sb.Grow(len(events) * 512)

	sb.WriteString(fmt.Sprintf("# Shows & Events %s\n", label))
	sb.WriteString("----------------------------------------------\n\n")

	for i, e := range events {
		sb.WriteString(fmt.Sprintf("Event #%d\n", i+1))
		sb.WriteString(fmt.Sprintf("Name:      %s\n", e.Name))
		sb.WriteString(fmt.Sprintf("Venue:     %s\n", e.Venue))
		sb.WriteString(fmt.Sprintf("Date:      %s\n", e.Date))
		sb.WriteString(fmt.Sprintf("Address:   %s\n", e.Address))
		if e.Time != "" {
			sb.WriteString(fmt.Sprintf("Time:      %s\n", e.Time))
		} else {
			sb.WriteString("Time:      not available\n")
		}
		if e.Price != "" {
			sb.WriteString(fmt.Sprintf("Price:     %s\n", e.Price))
		} else {
			sb.WriteString("Price:     not available\n")
		}
		if e.TicketURL != "" {
			sb.WriteString(fmt.Sprintf("Ticket Link:  %s\n\n", e.TicketURL))
		} else {
			sb.WriteString("Ticket Link:  not available\n\n\n")
		}
		sb.WriteString(strings.Repeat("-", 90) + "\n\n")
	}

	return os.WriteFile(filename, []byte(sb.String()), 0644)
}
