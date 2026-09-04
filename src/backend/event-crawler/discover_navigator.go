package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// navigatorSystemPrompt is the Navigator's whole job description. It never
// sees raw HTML and never calls the network -- it only sees a PageSnapshot
// (see discover_snapshot.go) and picks NAVIGATE / EXTRACT / STOP.
const navigatorSystemPrompt = `You are the navigation agent for OMM (Open Music Model).
Your purpose is to locate upcoming music events on a venue website.

You are NOT a web crawler. You cannot access URLs yourself.
You only analyze information provided by the crawler.
Your job is to decide what the crawler should do next.

AVAILABLE ACTIONS:

NAVIGATE
  Choose one URL from the provided links when the current page
  does not contain the event information.

EXTRACT
  Use this when the current page contains a genuinely complete listing of
  upcoming music events -- not just a short preview.

STOP
  Use this when the website does not appear to contain upcoming
  music events, or further navigation is impossible.

RULES:
1. Only choose URLs explicitly provided in the LINKS lists below. Never invent
   or guess a URL, even if it seems obvious.
2. Prefer links whose text or context suggests: events, shows, concerts, gigs,
   program, programming, calendar, agenda, "what's on", billetterie, spectacles,
   Veranstaltungen, événements.
3. You may need to follow multiple levels of navigation to get there.
4. A homepage or landing page often shows only a short preview or teaser of
   events (e.g. a "featured events" carousel with a handful of highlights).
   If you see one of these AND there is a link (per rule 2) to what looks
   like a dedicated events/shows/calendar/program page, prefer NAVIGATE to
   that dedicated page over EXTRACT -- it's more likely to be the complete
   list, while a homepage preview is usually just a sample. Only EXTRACT from
   a preview/teaser section if no more dedicated page is linked anywhere.
5. Do not assume the events page is called /events -- check what's actually offered.
6. Do not extract past events.
7. Do not treat generic artist biographies as events.
8. Do not treat ticket-provider or social-media pages as the primary venue event
   page unless nothing else plausible remains.
9. Stop if there is no plausible path toward event information.
10. Never invent information that is not present in the page.
11. Return valid JSON only, matching exactly one of these shapes:
{"action": "navigate", "url": "<one of the URLs listed above>", "reason": "<short reason>", "confidence": 0.0}
{"action": "extract", "reason": "<short reason>", "confidence": 0.0}
{"action": "stop", "reason": "<short reason>"}
`

// NavigatorDecision is the Navigator's single decision for the current page.
type NavigatorDecision struct {
	Action     string  `json:"action"`
	URL        string  `json:"url,omitempty"`
	Reason     string  `json:"reason,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
}

func buildNavigatorPrompt(snap PageSnapshot) string {
	var b strings.Builder

	fmt.Fprintf(&b, "CURRENT URL:\n%s\n\n", snap.URL)
	fmt.Fprintf(&b, "PAGE TITLE:\n%s\n\n", snap.Title)

	b.WriteString("PAGE HEADINGS:\n")
	if len(snap.Headings) == 0 {
		b.WriteString("(none found)\n")
	}
	for _, h := range snap.Headings {
		fmt.Fprintf(&b, "- %s\n", h)
	}
	b.WriteString("\n")

	b.WriteString("MENU / NAVIGATION LINKS:\n")
	if len(snap.NavLinks) == 0 {
		b.WriteString("(none found)\n")
	}
	for i, l := range snap.NavLinks {
		fmt.Fprintf(&b, "%d. %s -> %s\n", i+1, l.Text, l.URL)
	}
	b.WriteString("\n")

	b.WriteString("OTHER LINKS ON PAGE:\n")
	if len(snap.OtherLinks) == 0 {
		b.WriteString("(none found)\n")
	}
	for i, l := range snap.OtherLinks {
		fmt.Fprintf(&b, "%d. %s -> %s\n", i+1, l.Text, l.URL)
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "VISIBLE TEXT (truncated):\n%s\n", snap.VisibleText)

	return b.String()
}

// decideNavigation asks Ollama what the crawler should do next with the
// current page. It guards against hallucinated URLs by rejecting any
// "navigate" decision whose URL was not actually offered in the snapshot's
// link lists -- the whole point being that Ollama can only pick real,
// Colly-discovered links, never invent one (see rule 1 above).
func decideNavigation(client *OllamaClient, snap PageSnapshot) (NavigatorDecision, error) {
	prompt := buildNavigatorPrompt(snap)
	allowed := snap.AllLinks()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		raw, err := client.chatJSON(navigatorSystemPrompt, prompt)
		if err != nil {
			return NavigatorDecision{}, err
		}

		var d NavigatorDecision
		if err := json.Unmarshal([]byte(extractJSONBlock(raw)), &d); err != nil {
			lastErr = fmt.Errorf("navigator returned invalid JSON: %w (raw: %s)", err, truncate(raw, 300))
			continue
		}
		d.Action = strings.ToLower(strings.TrimSpace(d.Action))

		switch d.Action {
		case "navigate":
			d.URL = strings.TrimSpace(d.URL)
			if !linkListContains(allowed, d.URL) {
				lastErr = fmt.Errorf("navigator chose a URL not present in the provided links: %q", d.URL)
				continue
			}
			return d, nil
		case "extract", "stop":
			return d, nil
		default:
			lastErr = fmt.Errorf("navigator returned unknown action %q", d.Action)
			continue
		}
	}
	return NavigatorDecision{}, fmt.Errorf("navigator failed after retries: %w", lastErr)
}

func linkListContains(links []PageLink, url string) bool {
	for _, l := range links {
		if l.URL == url {
			return true
		}
	}
	return false
}
