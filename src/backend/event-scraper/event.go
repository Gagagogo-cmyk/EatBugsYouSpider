package main

import (
	"log"
	"time"
)

type Event struct {
	VenueKey   string `json:"venue_key"` // key for venue map
	Name       string `json:"name"`
	Venue      string `json:"venue"`
	Date       string `json:"date"`
	Address    string `json:"address"`
	Time       string `json:"time,omitempty"`
	Price      string `json:"price,omitempty"`
	TicketURL  string `json:"ticket_url,omitempty"`
	EventImage string `json:"event_image,omitempty"`
	DayOfWeek  string `json:"day_of_week"`

	IsFree        bool `json:"is_free"`
	IsToday       bool `json:"is_today"`
	IsTomorrow    bool `json:"is_tomorrow"`
	IsThisWeekend bool `json:"is_this_weekend"`
	IsThisWeek    bool `json:"is_this_week"`

	PriceValue      float64   `json:"-"`
	ParsedDate      time.Time `json:"-"`
	DaysUntil       int       `json:"-"`
	AlreadyHappened bool      `json:"-"`
}

func (e *Event) enrichEvent() {

	e.PriceValue = parsePrice(e.Price)
	e.IsFree = e.PriceValue == 0

	parsedDate, err := parseDate(e.Date)
	if err != nil {
		// if date parsing fails (which it shouldn't), set defaults for date-dependent fields
		e.ParsedDate = time.Time{}
		e.DaysUntil = -1
		e.DayOfWeek = ""
		e.IsToday = false
		e.IsTomorrow = false
		e.IsThisWeekend = false
		e.IsThisWeek = false

		log.Printf("WARNING: could not parse date %q for event: %v", e.Date, err)
		return
	}

	e.ParsedDate = parsedDate
	e.AlreadyHappened = isPast(parsedDate)
	e.DaysUntil = daysUntil(e.ParsedDate)
	e.DayOfWeek = e.ParsedDate.Weekday().String()
	e.IsToday = isToday(e.ParsedDate)
	e.IsTomorrow = e.DaysUntil == 1
	e.IsThisWeekend = isThisWeekend(e.ParsedDate)
	e.IsThisWeek = e.DaysUntil >= 0 && e.DaysUntil <= 7
}

func (e *Event) validateEvent() (missing []string) {
	switch {
	case e.Name == "":
		missing = append(missing, "Name")
	case e.Venue == "":
		missing = append(missing, "Venue")
	case e.Price == "":
		missing = append(missing, "Price Value")
	case e.Time == "":
		missing = append(missing, "Time")
	case e.ParsedDate.IsZero():
		missing = append(missing, "ParsedDate")
	}
	return missing
}
