package main

import (
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"sync"
	"time"
)

// PageData shows data to HTML output
type PageData struct {
	Title         string
	Events        EventList
	EventCount    int
	GeneratedAt   string
	LastScrapedAt string
	VenueFilter   string
	VenuesJSON    template.JS // JSON array of venues with coordinates + their events
}

func newPageData(title string, events EventList) PageData {
	return PageData{
		Title:       title,
		Events:      events,
		EventCount:  len(events),
		GeneratedAt: time.Now().In(loc).Format("Monday, January 2 at 3:04PM"),
	}
}

type markerEvent struct {
	Name       string `json:"name"`
	Date       string `json:"date"`
	Time       string `json:"time"`
	IsToday    bool   `json:"is_today"`
	IsThisWeek bool   `json:"is_this_week"`
}

type marker struct {
	Name   string        `json:"name"`
	Key    string        `json:"key"`
	Lat    float64       `json:"lat"`
	Lng    float64       `json:"lng"`
	Events []markerEvent `json:"events"`
}

var (
	cachedEvents  EventList
	cachedMarkers template.JS
	lastScrapedAt time.Time
	mu            sync.RWMutex

	baseTmpl = template.Must(template.ParseFiles("frontend/base.html"))
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		if r.Method == http.MethodOptions {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func buildMarkers(events EventList) template.JS {
	byVenue := events.GroupByVenue()
	markers := make([]marker, 0, len(allVenues))
	for key, venue := range allVenues {
		m := marker{Name: venue.Name, Key: key, Lat: venue.Latitude, Lng: venue.Longitude}
		for _, e := range byVenue[key] {
			m.Events = append(m.Events, markerEvent{
				Name:       e.Name,
				Date:       e.Date,
				Time:       e.Time,
				IsToday:    e.IsToday,
				IsThisWeek: e.IsThisWeek,
			})
		}
		markers = append(markers, m)
	}
	b, _ := json.Marshal(markers)
	return template.JS(b)
}

func handlePage(title string, filter func(list EventList) EventList) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		events := filter(cachedEvents)
		venuesJSON := cachedMarkers
		scraped := lastScrapedAt
		mu.RUnlock()

		venueFilter := r.URL.Query().Get("venue")
		if venueFilter != "" {
			events = events.ByVenue(venueFilter)
		}

		data := newPageData(title, events)
		data.VenueFilter = venueFilter
		data.VenuesJSON = venuesJSON
		if !scraped.IsZero() {
			data.LastScrapedAt = scraped.Format("Monday, January 2 at 3:04 PM")
		}

		if err := baseTmpl.ExecuteTemplate(w, "base", data); err != nil {
			log.Fatal(err)
		}
	}
}

//func handleAllEvents(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "All Events"))
//}
//
//func handleRightNow(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents.RightNow()
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "Right Now"))
//}
//
//func handleTonight(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents.Tonight()
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "Tonight"))
//}
//
//func handleTomorrow(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents.Tomorrow()
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "Tomorrow"))
//}
//
//func handleThisWeek(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents.ThisWeek()
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "This Week"))
//}
//
//func handleThisWeekend(w http.ResponseWriter, r *http.Request) {
//	mu.RLock()
//	events := cachedEvents.ThisWeekend()
//	mu.RUnlock()
//
//	w.Header().Set("Content-Type", "application/json")
//	json.NewEncoder(w).Encode(newJSONEnvelope(events, "This Weekend"))
//}
