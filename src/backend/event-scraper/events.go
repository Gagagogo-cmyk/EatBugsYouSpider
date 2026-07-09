package main

import (
	"fmt"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
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
	if e.Name == "" {
		missing = append(missing, "Name")
	}
	if e.Venue == "" {
		missing = append(missing, "Venue")
	}
	if e.Price == "" {
		missing = append(missing, "Price Value")
	}
	if e.Time == "" {
		missing = append(missing, "Time")
	}
	if e.ParsedDate.IsZero() {
		missing = append(missing, "ParsedDate")
	}
	return missing
}

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

/*
	****************************************************************************************************************
    ****************************************** EVENT UTIL **********************************************************
	****************************************************************************************************************
*/

var (
	// regex to strip ordinal suffixes for date (1st, 2nd, 3rd, 4th, etc.)
	dateOrdinalRegex   = regexp.MustCompile(`(\d+)(st|nd|rd|th)\b`)
	priceRegex         = regexp.MustCompile(`[\d.]+`)
	backgroundURLRegex = regexp.MustCompile(`url\(["']?(.*?)["']?\)`)
	timePattern        = regexp.MustCompile(`\d+h`)
	loc, _             = time.LoadLocation("America/Montreal")
)

var frenchMonthReplacer = strings.NewReplacer(
	"Janvier", "January", "janvier", "January",
	"Février", "February", "février", "February",
	"Mars", "March", "mars", "March",
	"Avril", "April", "avril", "April",
	"Mai", "May", "mai", "May",
	"Juin", "June", "juin", "June",
	"Juillet", "July", "juillet", "July",
	"Août", "August", "août", "August",
	"Septembre", "September", "septembre", "September",
	"Octobre", "October", "octobre", "October",
	"Novembre", "November", "novembre", "November",
	"Décembre", "December", "décembre", "December",

	"janv", "Jan", "Janv", "Jan", "janv.", "Jan", "Janv.", "Jan",
	"Fév", "Feb", "fév", "Feb", "Févr", "Feb", "févr", "Feb",
	"Fév.", "Feb", "fév.", "Feb", "Févr.", "Feb", "févr.", "Feb",
	"Avr", "Apr", "avr", "Apr",
	"Juil", "Jul", "juil", "Jul",
	"Déc", "Dec", "déc", "Dec",
)

var frenchDayReplacer = strings.NewReplacer(
	"lun.", "Mon", "Lun.", "Mon",
	"mar.", "Tue", "Mar.", "Tue",
	"mer.", "Wed", "Mer.", "Wed",
	"jeu.", "Thu", "Jeu.", "Thu",
	"ven.", "Fri", "Ven.", "Fri",
	"sam.", "Sat", "Sam.", "Sat",
	"dim.", "Sun", "Dim.", "Sun",
)

func parseDate(date string) (time.Time, error) {

	normalized := strings.ToLower(translateMonth(date))
	normalized = frenchDayReplacer.Replace(normalized)
	normalized = dateOrdinalRegex.ReplaceAllString(normalized, "$1")
	normalized = strings.TrimSpace(normalized)

	layouts := []struct {
		layout    string
		needsYear bool
	}{
		// Case Popolo : "Wednesday, January 28, 2026" (after removing "th")
		{"Monday, January 2, 2006", false},

		// Case Cafe campus: "30 janvier 2026, 20h"
		// date needs to be stripped and date needs to be translated
		{"2 January 2006", false},

		// Case Verre Bouteille: "12 Février" → normalized to "12 february"
		{"2 January", true},

		// Case Piranha Bar: "Thu, Mar 19, 2026"
		{"Mon, Jan 2, 2006", false},

		// Case quai des brumes : "10 Fév"
		{"2 Jan", true},

		// Case Hemisphere gauche : "sam. 07 févr"
		{"Mon, Jan 02", true},

		// default:
		{"January 2, 2006", false},
	}

	// strip time if it's in the date
	normalized = stripTime(normalized)

	for _, l := range layouts {
		t, err := time.ParseInLocation(l.layout, normalized, loc)
		if err == nil {
			if l.needsYear {
				t = time.Date(
					inferYear(t),
					t.Month(),
					t.Day(),
					0,
					0,
					0,
					0,
					t.Location(),
				)
			}
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse date: %q (normalized: %q)", date, normalized)
}

func stripTime(normalized string) string {
	index := strings.Index(normalized, ",")
	if index != -1 {
		afterComma := normalized[index+1:]
		if timePattern.MatchString(afterComma) || strings.Contains(afterComma, ":") {
			return strings.TrimSpace(normalized[:index])
		}
	}
	return normalized
}

func splitDateTime(raw string) (date, eventTime string) {
	parts := strings.Split(raw, ",")
	if len(parts) < 2 {
		return strings.TrimSpace(raw), ""
	}

	lastPart := strings.TrimSpace(parts[len(parts)-1])

	if strings.Contains(lastPart, "h") || strings.Contains(lastPart, ":") {
		date = strings.TrimSpace(strings.Join(parts[:len(parts)-1], ","))
		eventTime = convertFrenchTime(lastPart)
		return
	}

	return strings.TrimSpace(raw), ""
}

func combineDateAndTime(date time.Time, timeStr string) time.Time {
	if date.IsZero() || timeStr == "" {
		return time.Time{}
	}

	// Try common formats your parsers produce
	formats := []string{"15:04", "3:04 PM", "3PM", "3 PM"}

	for _, format := range formats {
		t, err := time.Parse(format, timeStr)
		if err == nil {
			return time.Date(
				date.Year(), date.Month(), date.Day(),
				t.Hour(), t.Minute(), 0, 0, loc,
			)
		}
	}

	return time.Time{} // couldn't parse time
}

// translateMonth translates a month name from French to English, if it needs to be translated
func translateMonth(date string) string {
	return frenchMonthReplacer.Replace(date)
}

func convertFrenchTime(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	t = strings.ReplaceAll(t, "h", ":")

	parts := strings.Split(t, ":")
	if len(parts) != 2 {
		return t
	}

	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return t
	}

	minute := parts[1]
	if minute == "" {
		minute = "00"
	}

	period := "AM"
	if hour >= 12 {
		period = "PM"
		if hour > 12 {
			hour -= 12
		}
	}
	if hour == 0 {
		hour = 12
	}

	return fmt.Sprintf("%d:%s %s", hour, minute, period)
}

func inferYear(t time.Time) int {
	now := time.Now()
	year := now.Year()

	if now.Month() >= time.November && t.Month() <= time.February {
		return year + 1
	}
	return year
}

func daysUntil(eventDate time.Time) int {
	now := time.Now()

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	eventDay := time.Date(eventDate.Year(), eventDate.Month(), eventDate.Day(), 0, 0, 0, 0, now.Location())

	return int(eventDay.Sub(today).Hours() / 24)
}

func isPast(t time.Time) bool {
	return daysUntil(t) < 0
}

func isSameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

func isToday(t time.Time) bool {
	return isSameDay(t, time.Now())
}

// isThisWeekend includes Friday as the weekend
func isThisWeekend(t time.Time) bool {
	day := t.Weekday()
	isWeekendDay := day == time.Friday || day == time.Saturday || day == time.Sunday
	days := daysUntil(t)
	return isWeekendDay && days >= 0 && days <= 7
}

// parsePrice parses a price string to a float64 value
func parsePrice(priceStr string) float64 {
	priceStr = strings.ToLower(priceStr)
	if strings.Contains(priceStr, "free") || strings.Contains(priceStr, "gratuit") {
		return 0
	}

	match := priceRegex.FindString(priceStr)
	if match == "" {
		return 0
	}

	price, _ := strconv.ParseFloat(match, 64)
	return price
}

// special case for Cafe Campus
func extractAdvancePrice(text string) string {

	if idx := strings.Index(text, "Prix des billets :"); idx != -1 {
		after := text[idx+len("Prix des billets :"):]
		if end := strings.Index(after, "$"); end != -1 {
			return strings.TrimSpace(after[:end+1])
		}
	}
	return ""
}

func extractBackgroundURL(style string) string {
	matches := backgroundURLRegex.FindStringSubmatch(style)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}
