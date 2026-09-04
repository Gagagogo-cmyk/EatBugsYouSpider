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
	// Genre -- spec item 6: "add genre information to the scraped data...
	// genres must actually be scraped/stored." A comma-separated list of
	// genre names (an event can genuinely have more than one, e.g.
	// MTelus's own API returns an array), not a single string, so a show
	// tagged both "rock" and "electronic" shows up under both filters
	// instead of being forced into one bucket. Only ever populated where
	// a real source actually exposes genre -- see convertMTelusHit
	// (parsers.go, the one hardcoded scraper whose upstream API returns a
	// genre field already) and extractEvents (discover_extractor.go, the
	// Ollama discovery path, which is told to leave it blank rather than
	// guess). Every other hardcoded Colly-selector venue in allVenues
	// (venues.go) scrapes plain HTML with no structured genre data
	// anywhere on the page, so those events simply carry no Genre --
	// same "don't invent what the source doesn't have" honesty as the
	// rest of this struct, not a bug to fix later.
	Genre string `json:"genre,omitempty"`

	IsFree        bool `json:"is_free"`
	IsToday       bool `json:"is_today"`
	IsTomorrow    bool `json:"is_tomorrow"`
	IsThisWeekend bool `json:"is_this_weekend"`
	IsThisWeek    bool `json:"is_this_week"`

	PriceValue      float64   `json:"-"`
	ParsedDate      time.Time `json:"-"` // start date -- same as the event's date for a normal single-day event
	ParsedEndDate   time.Time `json:"-"` // end date -- equal to ParsedDate unless Date was a "X au Y" range (parseDateRange, below)
	DaysUntil       int       `json:"-"` // days until ParsedDate (the start); can be negative once an event/range has begun
	AlreadyHappened bool      `json:"-"`
}

// enrichEvent fills in every field derived from Date/Price: ParsedDate (and,
// for a multi-day "X au Y" run, ParsedEndDate), and the IsToday/IsTomorrow/
// IsThisWeek/IsThisWeekend flags used for the site's filter pages and the
// map marker colors.
//
// Those flags are computed from whether [ParsedDate, ParsedEndDate] overlaps
// today/tomorrow/this week, not just whether ParsedDate itself falls on that
// day -- for an ordinary single-day event ParsedDate == ParsedEndDate, so
// this reduces to the original single-date behavior; the difference only
// shows up for a range, where it's what makes a still-running multi-week
// show correctly show up as "today"/"this week" every day it's actually
// running, not just on its first day. AlreadyHappened is likewise based on
// the END of the range -- a show that started last week but runs through
// this weekend hasn't "already happened" yet.
func (e *Event) enrichEvent() {

	e.PriceValue = parsePrice(e.Price)
	e.IsFree = e.PriceValue == 0

	start, end, _, err := parseDateRange(e.Date)
	if err != nil {
		// if date parsing fails (which it shouldn't), set defaults for date-dependent fields
		e.ParsedDate = time.Time{}
		e.ParsedEndDate = time.Time{}
		e.DaysUntil = -1
		e.DayOfWeek = ""
		e.IsToday = false
		e.IsTomorrow = false
		e.IsThisWeekend = false
		e.IsThisWeek = false

		log.Printf("WARNING: could not parse date %q for event: %v", e.Date, err)
		return
	}

	e.ParsedDate = start
	e.ParsedEndDate = end
	e.AlreadyHappened = isPast(end)
	e.DaysUntil = daysUntil(start)
	e.DayOfWeek = start.Weekday().String()

	daysUntilStart := e.DaysUntil
	daysUntilEnd := daysUntil(end)

	e.IsToday = daysUntilStart <= 0 && daysUntilEnd >= 0
	e.IsTomorrow = daysUntilStart <= 1 && daysUntilEnd >= 1
	e.IsThisWeek = daysUntilStart <= 7 && daysUntilEnd >= 0
	// isThisWeekend only checks a single date; for a range, count it as "this
	// weekend" if either endpoint falls in the coming Fri-Sun window, or if
	// it's already running today and today itself is that window -- an
	// approximation (it can miss a range that spans the weekend without
	// starting or ending on it) rather than a full interval/weekend overlap
	// check, but covers the common cases.
	e.IsThisWeekend = isThisWeekend(start) || isThisWeekend(end) ||
		(e.IsToday && isThisWeekend(time.Now().In(loc)))
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

// ByGenre filters to events whose comma-separated Genre field contains the
// given genre as one of its own tokens, case-insensitively -- same shape as
// ByVenue above (a plain scan, no separate index), but a substring/token
// match rather than exact-equality: Event.Genre can genuinely hold more
// than one genre (see that field's own comment), so "techno" has to match
// an event tagged "Techno, House" without also matching "Technoise" as a
// false positive -- splitting on comma and comparing whole tokens handles
// both. Added for the sidebar's new genre tag filter (spec item 6) -- same
// ?genre= query param / handlePage wiring as ByVenue's own ?venue=, see
// server.go.
func (el EventList) ByGenre(genre string) (result EventList) {
	g := strings.ToLower(strings.TrimSpace(genre))
	for _, e := range el {
		for _, tok := range strings.Split(e.Genre, ",") {
			if strings.ToLower(strings.TrimSpace(tok)) == g {
				result = append(result, e)
				break
			}
		}
	}
	return result
}

// DistinctGenres collects every distinct genre token actually present
// across el's own Event.Genre fields (each one comma-separated, see that
// field's own comment), case-insensitively deduplicated but keeping the
// first-seen casing, sorted alphabetically -- this is .Genres on PageData
// (server.go), the sidebar's own genre tag list (frontend/base.html,
// underneath "Add a venue"). Built fresh from whatever's actually been
// scraped, same as VenueOption's own venueList (output.go) -- an event
// source that exposes no genre info just contributes nothing here, never
// a hardcoded/fake tag.
func DistinctGenres(el EventList) []string {
	seen := make(map[string]string) // lowercase token -> first-seen casing
	for _, e := range el {
		for _, tok := range strings.Split(e.Genre, ",") {
			t := strings.TrimSpace(tok)
			if t == "" {
				continue
			}
			key := strings.ToLower(t)
			if _, ok := seen[key]; !ok {
				seen[key] = t
			}
		}
	}
	genres := make([]string, 0, len(seen))
	for _, v := range seen {
		genres = append(genres, v)
	}
	sort.Strings(genres)
	return genres
}

// ByName filters to events whose Name (the artist/show name) contains query,
// case-insensitively. Added for the site's new search bar -- user: "a search
// bar for artist name" -- same shape as ByVenue above (plain substring/exact
// filter over the already-cached, already-scraped event list; no separate
// index, since the full list is small enough that a linear scan per request
// is cheap). An empty query is treated as "no filter" by the caller
// (handlePage, server.go), not here, so this always does a real filter.
func (el EventList) ByName(query string) (result EventList) {
	q := strings.ToLower(strings.TrimSpace(query))
	for _, e := range el {
		if strings.Contains(strings.ToLower(e.Name), q) {
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

// parseDate parses a single date string, inferring a year (via inferYear --
// whichever of the next two calendar years is closest to today) when the
// source text doesn't include one. See parseDateWithYearHint for the
// variant used when a better year guess than "closest to today" is
// available (the start half of a date range, where the end half's year is
// far more reliable).
func parseDate(date string) (time.Time, error) {
	return parseDateWithYearHint(date, 0)
}

// parseDateWithYearHint is parseDate's actual implementation. When the
// source text has no year of its own, yearHint is used verbatim if
// non-zero; otherwise it falls back to inferYear's guess. A date that
// already has its own year in the text always uses that, regardless of
// yearHint.
func parseDateWithYearHint(date string, yearHint int) (time.Time, error) {

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
				year := yearHint
				if year == 0 {
					year = inferYear(t)
				}
				t = time.Date(
					year,
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

// dateRangeRegex matches a "<start> au <end>" range -- French for "to",
// used on multi-day/multi-week runs (a touring musical, a festival) where a
// single date can't represent the whole listing, e.g.
// "25 août au 6 septembre 2026" or "13 octobre au 18 octobre 2026".
var dateRangeRegex = regexp.MustCompile(`(?i)^(.+?)\s+au\s+(.+)$`)

// parseDateRange parses date as either a single day (start == end,
// isRange == false) or a "<start> au <end>" range (isRange == true, start
// before or equal to end). For a range, the start side very often has no
// year of its own ("25 août" rather than "25 août 2026") since the end
// supplies it -- parseDateWithYearHint is used with the end's year for
// exactly that reason, correcting back a year if that would put the start
// after the end (a range spanning New Year's Eve, e.g.
// "28 décembre au 3 janvier 2027").
func parseDateRange(date string) (start, end time.Time, isRange bool, err error) {
	if m := dateRangeRegex.FindStringSubmatch(strings.TrimSpace(date)); m != nil {
		startRaw, endRaw := strings.TrimSpace(m[1]), strings.TrimSpace(m[2])

		end, err = parseDate(endRaw)
		if err != nil {
			return time.Time{}, time.Time{}, false, fmt.Errorf("parsing range end %q: %w", endRaw, err)
		}

		start, err = parseDateWithYearHint(startRaw, end.Year())
		if err != nil {
			return time.Time{}, time.Time{}, false, fmt.Errorf("parsing range start %q: %w", startRaw, err)
		}
		if start.After(end) {
			start = time.Date(start.Year()-1, start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
		}
		return start, end, true, nil
	}

	t, err := parseDate(date)
	if err != nil {
		return time.Time{}, time.Time{}, false, err
	}
	return t, t, false, nil
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
