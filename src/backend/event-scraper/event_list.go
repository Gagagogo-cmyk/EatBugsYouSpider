package main

import (
	"sort"
	"time"
)

// EventList implements sort.Interface to sort events by specified parameter
type EventList []Event

func (el EventList) Len() int      { return len(el) }
func (el EventList) Swap(i, j int) { el[i], el[j] = el[j], el[i] }
func (el EventList) Less(i, j int) bool {
	return el[i].ParsedDate.Before(el[j].ParsedDate) // defaults to sort by date (soonest first)
}

func (el EventList) SortByDate() {
	sort.Stable(el)
}

// SortByPrice sorts events by price (cheapest to most expensive) -> maybe use it, since venues don't always show price
func (el EventList) SortByPrice() {
	sort.SliceStable(el, func(i, j int) bool {
		return el[i].PriceValue < el[j].PriceValue
	})
}

// RightNow returns events still happening from 1 an hour ago, and events happening within 2 hours of current time
func (el EventList) RightNow() (result EventList) {
	now := time.Now().In(loc)

	for _, e := range el {
		eventStart := combineDateAndTime(e.ParsedDate, e.Time)
		if eventStart.IsZero() {
			continue // cant parse, skip.
		}

		// Event started up to 1 hour ago (likely still happening)
		startedRecently := eventStart.After(now.Add(-1*time.Hour)) && eventStart.Before(now)

		// Event starts within the next 2 hours
		startsSoon := eventStart.After(now) && eventStart.Before(now.Add(2*time.Hour))

		if startedRecently || startsSoon {
			result = append(result, e)
		}
	}
	return result
}

func (el EventList) Tonight() (result EventList) {
	for _, e := range el {
		if e.IsToday {
			result = append(result, e)
		}
	}
	return result
}

func (el EventList) Tomorrow() (result EventList) {
	for _, e := range el {
		if e.IsTomorrow {
			result = append(result, e)
		}
	}
	return result
}

func (el EventList) ThisWeek() (result EventList) {
	for _, e := range el {
		if e.IsThisWeek {
			result = append(result, e)
		}
	}
	return result
}

func (el EventList) ThisWeekend() (result EventList) {
	for _, e := range el {
		if e.IsThisWeekend {
			result = append(result, e)
		}
	}
	return result
}

//func (el EventList) Free() (result EventList) {
//	for _, e := range el {
//		if e.IsFree {
//			result = append(result, e)
//		}
//	}
//	return result
//}

// ByWeekday return events by the specified day in the day argument
func (el EventList) ByWeekday(day time.Weekday) (result EventList) {
	for _, e := range el {
		if e.ParsedDate.Weekday() == day {
			result = append(result, e)
		}
	}
	return result
}

// ByVenue filters by venue
func (el EventList) ByVenue(venueKey string) (result EventList) {
	for _, e := range el {
		if e.VenueKey == venueKey {
			result = append(result, e)
		}
	}
	return result
}

// GroupByVenue indexes events by VenueKey in a single pass.
func (el EventList) GroupByVenue() map[string]EventList {
	result := make(map[string]EventList, len(allVenues))
	for _, e := range el {
		result[e.VenueKey] = append(result[e.VenueKey], e)
	}
	return result
}
