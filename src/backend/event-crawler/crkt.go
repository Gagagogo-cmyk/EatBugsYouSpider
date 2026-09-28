package main

// crkt.go -- DJ bookings as show cards. User: "When a user books a slot, it
// must be added in the venue scraper. as a card. but the venue will be the
// cybervenue "CRKT"." Every page asks the Express backend (the one the panel
// books through, src/backend/routes/bookings.js GET /bookings/upcoming) for
// the upcoming slots and shows each one as an event at CRKT, mixed in with the
// scraped shows (same filters, same sort). Cached for 30s; the backend being
// down just means no CRKT cards, never a slow or broken page.
//
// EBYS_BACKEND_URL points at that backend (default http://localhost:3000).

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const crktVenueKey = "crkt"
const crktVenueName = "CRKT"

var (
	crktMu      sync.Mutex
	crktCache   EventList
	crktFetched time.Time
	crktClient  = &http.Client{Timeout: 1500 * time.Millisecond}
)

type crktBooking struct {
	ID        int     `json:"id"`
	ModelRef  string  `json:"model_ref"`
	ModelName *string `json:"model_name"`
	DJName    string  `json:"dj_name"`
	StartsAt  string  `json:"starts_at"`
	EndsAt    string  `json:"ends_at"`
	Hours     any     `json:"hours"`
}

func crktBackendURL() string {
	if u := strings.TrimRight(os.Getenv("EBYS_BACKEND_URL"), "/"); u != "" {
		return u
	}
	return "http://localhost:3000"
}

// crktEvents -- the upcoming bookings as Events (cached; nil when the backend
// can't be reached)
func crktEvents() EventList {
	crktMu.Lock()
	defer crktMu.Unlock()
	if !crktFetched.IsZero() && time.Since(crktFetched) < 30*time.Second {
		return crktCache
	}
	crktFetched = time.Now()
	resp, err := crktClient.Get(crktBackendURL() + "/bookings/upcoming")
	if err != nil {
		crktCache = nil
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		crktCache = nil
		return nil
	}
	var rows []crktBooking
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		crktCache = nil
		return nil
	}
	out := make(EventList, 0, len(rows))
	for _, b := range rows {
		start, err1 := time.Parse(time.RFC3339, b.StartsAt)
		end, err2 := time.Parse(time.RFC3339, b.EndsAt)
		if err1 != nil || err2 != nil {
			continue
		}
		start = start.In(loc)
		_ = end
		// same layout as the scraped cards, nothing extra: the dj, CRKT --
		// gnumbat radio, date + time, free (user: "dont overkill it with name.
		// just keep gnumbat radio")
		e := Event{
			VenueKey: crktVenueKey,
			Name:     b.DJName,
			Venue:    crktVenueName,
			Address:  "gnumbat radio",
			Date:     fmt.Sprintf("%s %d, %d", start.Month().String(), start.Day(), start.Year()),
			Time:     start.Format("15:04"),
			Price:    "free",
		}
		e.enrichEvent()
		out = append(out, e)
	}
	crktCache = out
	return out
}

// withCrkt -- the scraped list plus the CRKT cards, date-sorted
func withCrkt(list, extra EventList) EventList {
	if len(extra) == 0 {
		return list
	}
	all := make(EventList, 0, len(list)+len(extra))
	all = append(all, list...)
	all = append(all, extra...)
	all.SortByDate()
	return all
}
