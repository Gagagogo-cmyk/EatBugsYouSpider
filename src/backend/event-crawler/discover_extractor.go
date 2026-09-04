package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// extractorSystemPrompt is the Extractor's whole job description, deliberately
// kept separate from the Navigator's (see discover_navigator.go): the
// Navigator asks "where should I look?", the Extractor asks "what did I
// find?". It only ever sees the current page's snapshot, never other pages.
const extractorSystemPrompt = `You are the extraction agent for OMM (Open Music Model).
Your purpose is to turn a venue webpage's content into a structured list of
UPCOMING music events. You are NOT a web crawler and cannot access other pages --
you only see the text given to you below.

RULES:
1. Only extract events that are clearly upcoming (future) music events: concerts,
   DJ sets, gigs, shows. Do not extract past events.
2. Do not invent any information that is not present in the text. If a field is
   not present, leave it as an empty string -- never guess.
3. Do not treat generic artist biographies, venue descriptions, or news posts as
   events.
4. If there is a date but you cannot tell the year, leave the date exactly as
   written in the source text -- do not invent a year.
5. For ticket_url: you will also be given an EVENT LINKS list below the page
   text, each with the link's own visible TEXT and the URL it actually points
   to. Match each event you extract to one of those entries by comparing the
   event's name/date/venue against the link's TEXT, then copy that entry's URL
   exactly, character for character, as ticket_url. If no EVENT LINKS entry
   clearly matches, leave ticket_url as an empty string. NEVER put a button
   label or placeholder like "Acheter", "Buy", "Buy Tickets", "Book Now", or
   any other plain text into ticket_url -- it must be a real URL from the
   EVENT LINKS list, or empty.
6. Return valid JSON only, matching exactly this shape:
{"events": [
  {
    "name": "",
    "venue": "",
    "address": "",
    "date": "",
    "time": "",
    "price": "",
    "ticket_url": "",
    "event_image": "",
    "genre": ""
  }
]}
7. If there are no genuine upcoming music events on this page, return {"events": []}.
8. For genre: only fill this in if the page itself explicitly labels or
   describes the event's musical genre or style (a genre tag, a line like
   "Genre: techno", a scene descriptor the page itself uses). If more than
   one genre is explicitly stated, separate them with a comma. Leave it as
   an empty string if the page does not explicitly say -- never infer a
   genre from the artist's name alone, and never guess.
`

// extractedEvent mirrors the raw, pre-enrichment fields of Event (see event.go)
// -- the ones a human, or one of the friend's hardcoded parsers in parsers.go,
// would read straight off the page. Event.enrichEvent() fills in the computed
// fields (ParsedDate, IsToday, DaysUntil, ...) afterwards, exactly the same way
// it does for the hardcoded venues, so both paths end up in the same shape.
type extractedEvent struct {
	Name       string `json:"name"`
	Venue      string `json:"venue"`
	Address    string `json:"address"`
	Date       string `json:"date"`
	Time       string `json:"time"`
	Price      string `json:"price"`
	TicketURL  string `json:"ticket_url"`
	EventImage string `json:"event_image"`
	// Genre -- spec item 6, see Event.Genre's own comment (events.go) and
	// this prompt's own rule 8 (above) for what the model is told to put
	// here: only an explicitly-stated genre, comma-separated if there's
	// more than one, empty if the page doesn't say. Never guessed.
	Genre string `json:"genre"`
}

type extractionResult struct {
	Events []extractedEvent `json:"events"`
}

func buildExtractorPrompt(snap PageSnapshot) string {
	var b strings.Builder
	fmt.Fprintf(&b, "PAGE URL:\n%s\n\n", snap.URL)
	fmt.Fprintf(&b, "PAGE TITLE:\n%s\n\n", snap.Title)
	b.WriteString("PAGE HEADINGS:\n")
	for _, h := range snap.Headings {
		fmt.Fprintf(&b, "- %s\n", h)
	}
	fmt.Fprintf(&b, "\nPAGE TEXT:\n%s\n", snap.VisibleText)

	b.WriteString("\nEVENT LINKS (real URLs found on this page -- use these for ticket_url, see rule 5; do not use anything else as a URL):\n")
	if len(snap.EventLinks) == 0 {
		b.WriteString("(none found on this page)\n")
	}
	for _, l := range snap.EventLinks {
		fmt.Fprintf(&b, "- TEXT: %q -> URL: %s\n", l.Text, l.URL)
	}

	return b.String()
}

// extractEvents asks Ollama to pull events out of the current page and
// converts them into the existing Event struct -- the same one produced by
// the hardcoded venue parsers in parsers.go -- tagging each with venueKey so
// it slots straight into the existing EventList / JSON output pipeline
// (saveJSON, the frontend template, the /this-weekend etc. filters all keep
// working unmodified).
func extractEvents(client *OllamaClient, snap PageSnapshot, venueKey, venueName string) (EventList, error) {
	prompt := buildExtractorPrompt(snap)

	raw, err := client.chatJSON(extractorSystemPrompt, prompt)
	if err != nil {
		return nil, err
	}

	block := extractJSONBlock(raw)

	var result extractionResult
	if err := json.Unmarshal([]byte(block), &result); err != nil {
		// The model's response was cut off mid-JSON, most likely because the
		// page listed enough events to hit the num_predict ceiling (see
		// ollama.go). Rather than throw away a page's worth of real work,
		// salvage whichever events fully finished generating before the cut.
		repaired, ok := repairTruncatedEventsJSON(block)
		if !ok {
			return nil, fmt.Errorf("extractor returned invalid JSON: %w (raw: %s)", err, truncate(raw, 300))
		}
		if err := json.Unmarshal([]byte(repaired), &result); err != nil {
			return nil, fmt.Errorf("extractor returned invalid JSON, and salvage repair also failed: %w (raw: %s)", err, truncate(raw, 300))
		}
		fmt.Printf("warning: extractor response was truncated -- salvaged %d complete event(s) from a cut-off list; raise -ollama-timeout or shorten the page if this recurs\n", len(result.Events))
	}

	// Anti-hallucination guard for ticket_url, mirroring how decideNavigation
	// (discover_navigator.go) only trusts a URL the page actually offered:
	// only a URL that was genuinely present in this page's EVENT LINKS is
	// kept. Anything else -- a mangled URL, or (before rule 5 was added to
	// the prompt) a plain button label like "Acheter" -- gets dropped rather
	// than shipped as a fake ticket link.
	validTicketURLs := make(map[string]bool, len(snap.EventLinks))
	for _, l := range snap.EventLinks {
		validTicketURLs[l.URL] = true
	}

	events := make(EventList, 0, len(result.Events))
	for _, ee := range result.Events {
		e := Event{
			VenueKey:   venueKey,
			Name:       strings.TrimSpace(ee.Name),
			Venue:      strings.TrimSpace(firstNonEmpty(ee.Venue, venueName)),
			Address:    strings.TrimSpace(ee.Address),
			Date:       strings.TrimSpace(ee.Date),
			Time:       strings.TrimSpace(ee.Time),
			Price:      strings.TrimSpace(ee.Price),
			TicketURL:  strings.TrimSpace(ee.TicketURL),
			EventImage: strings.TrimSpace(ee.EventImage),
			Genre:      strings.TrimSpace(ee.Genre),
		}
		if e.Name == "" {
			continue // can't do much with an unnamed event
		}
		if e.TicketURL != "" && !validTicketURLs[e.TicketURL] {
			fmt.Printf("warning: dropping ticket_url for %q -- %q wasn't among the links found on the page (likely hallucinated or a placeholder)\n", e.Name, e.TicketURL)
			e.TicketURL = ""
		}
		e.enrichEvent()
		if e.AlreadyHappened {
			continue
		}
		events = append(events, e)
	}

	return events, nil
}

// repairTruncatedEventsJSON salvages a {"events": [...]} response that got
// cut off mid-generation (see extractEvents). It walks the array tracking
// brace depth (respecting quoted strings, so a brace inside a ticket URL or
// event name doesn't confuse it), remembers the end of the last event object
// that closed cleanly, and discards everything after that -- including any
// partial object still being generated when the model stopped. Returns
// ok=false if not even one complete event object was found, in which case
// there's nothing worth salvaging.
func repairTruncatedEventsJSON(s string) (repaired string, ok bool) {
	arrayStart := strings.IndexByte(s, '[')
	if arrayStart == -1 {
		return "", false
	}

	depth := 0
	inString := false
	escaped := false
	lastCompleteObjEnd := -1

	for i := arrayStart; i < len(s); i++ {
		c := s[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				lastCompleteObjEnd = i // just closed a complete top-level event object
			}
		}
	}

	if lastCompleteObjEnd == -1 {
		return "", false
	}

	return s[:lastCompleteObjEnd+1] + "]}", true
}
