package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type JSONEnvelope struct {
	Title       string    `json:"title"`
	EventCount  int       `json:"event_count"`
	GeneratedAt string    `json:"generated_at"`
	Events      EventList `json:"events"`
}

func newJSONEnvelope(events EventList, title string) JSONEnvelope {
	return JSONEnvelope{
		Title:       title,
		EventCount:  len(events),
		GeneratedAt: time.Now().In(loc).Format(time.RFC3339),
		Events:      events,
	}
}

func saveJSON(events EventList, title, fileName string) error {
	envelope := newJSONEnvelope(events, title)

	data, err := json.MarshalIndent(envelope, "", "\t")
	if err != nil {
		return fmt.Errorf("error marshaling %s to JSON: %w", title, err)
	}
	return os.WriteFile(fileName, data, 0644)
}

// saveAllEventsJSON saves all events across all venues, sorted by date
func saveAllEventsJSON(events EventList) error {
	return saveJSON(events, "All Events", "output/all_events.json")
}

func saveVenueEventsJSON(events EventList, venueKey, venueName, path string) error {
	return saveJSON(events, venueName+" Events", fmt.Sprintf("%s/%s.json", path, venueKey))
}

// ----------------------------------- FILTERED -----------------------------------
func saveRightNowJSON(events EventList) error {
	return saveJSON(events.RightNow(), "Happening Right Now", "right_now/right_now.json")
}

func saveTonightJSON(events EventList) error {
	return saveJSON(events.Tonight(), "Tonight", "tonight/tonight.json")
}

func saveTomorrowJSON(events EventList) error {
	return saveJSON(events.Tomorrow(), "Tomorrow", "tomorrow/tomorrow.json")
}

func saveThisWeekJSON(events EventList) error {
	return saveJSON(events.ThisWeek(), "This Week", "this_week/this_week.json")
}

func saveThisWeekendJSON(events EventList) error {
	return saveJSON(events.ThisWeekend(), "This Weekend", "this_weekend/this_weekend.json")
}
