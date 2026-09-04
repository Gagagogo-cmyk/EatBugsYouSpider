package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/gocolly/colly/v2"
)

// PageLink is a single link Colly found on the page, as handed to the
// navigator. Ollama is only ever allowed to choose a URL that appears in one
// of these lists -- see decideNavigation's validation in discover_navigator.go.
type PageLink struct {
	Text string
	URL  string
}

// PageSnapshot is what Colly hands Ollama for one page: enough to decide
// NAVIGATE / EXTRACT / STOP without Ollama ever touching the network itself.
type PageSnapshot struct {
	URL         string
	Title       string
	Headings    []string
	NavLinks    []PageLink
	OtherLinks  []PageLink
	EventLinks  []PageLink // candidate ticket/buy links, handed to the Extractor -- see collectEventLinks
	VisibleText string
}

// AllLinks is every link Ollama may legally choose for a "navigate" decision.
func (s PageSnapshot) AllLinks() []PageLink {
	all := make([]PageLink, 0, len(s.NavLinks)+len(s.OtherLinks))
	all = append(all, s.NavLinks...)
	all = append(all, s.OtherLinks...)
	return all
}

const (
	maxSnapshotLinks    = 40   // per category (nav / other) -- keeps the prompt small
	maxSnapshotTextRune = 4000 // visible text budget, in runes

	maxEventLinks        = 60  // candidate ticket links handed to the Extractor
	maxEventLinkTextRune = 300 // per-link text budget, in runes -- enough for a whole "card" anchor's text
	minRichCardLinkRune  = 20  // an anchor's own text needs at least this many runes to look like a whole event card, not just a nav crumb
)

// ticketLinkKeywords are short link-text fragments that strongly suggest an
// anchor is a "buy tickets" / "more info" action, in English and French, even
// when the anchor's own text is too short to look like a full event card
// (e.g. just "Acheter" or "Buy") -- see collectEventLinks.
var ticketLinkKeywords = []string{
	"acheter", "achat", "billet",
	"buy", "ticket",
	"book", "réserver", "reserver", "reserve",
	"détails", "details", "en savoir plus", "more info",
}

func looksLikeTicketLinkText(text string) bool {
	lower := strings.ToLower(text)
	for _, kw := range ticketLinkKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

var whitespaceRegex = regexp.MustCompile(`\s+`)
var dashCollapseRegex = regexp.MustCompile(`-+`)

func collapseWhitespace(s string) string {
	return strings.TrimSpace(whitespaceRegex.ReplaceAllString(s, " "))
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func dedupeStrings(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// slugify turns a hostname into a venue-key-safe slug, e.g.
// "www.example-club.com" -> "example-club-com".
func slugify(s string) string {
	s = strings.ToLower(s)
	s = strings.TrimPrefix(s, "www.")
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	return strings.Trim(dashCollapseRegex.ReplaceAllString(b.String(), "-"), "-")
}

// resolveURL resolves href relative to pageURL (e.g. "/en/events" relative to
// "https://example.com/home" -> "https://example.com/en/events"), the same
// job colly.Request.AbsoluteURL does for the Colly fetch path. Kept as a
// plain net/url helper (rather than depending on a *colly.Request) so the
// same snapshot builder below works for both the Colly fetch and the
// headless-Chrome render fetch (see render.go). Returns "" if either URL is
// unparseable.
func resolveURL(pageURL, href string) string {
	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

// normalizeURLForCompare reduces a URL to scheme+host+path+query (dropping
// the fragment and any trailing slash) so two URLs that differ only in a
// "#section" fragment or a trailing "/" are still recognized as the same
// page -- used to filter self-links out of a page's link list (see
// buildSnapshot) and to detect when the navigator has looped back to the
// current page (see discoverVenueDetailed in discover.go). Falls back to the
// raw string if the URL doesn't parse.
func normalizeURLForCompare(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	parsed.Fragment = ""
	return strings.TrimSuffix(parsed.String(), "/")
}

// buildSnapshot turns a fetched page's DOM into the structured view Ollama
// reasons over: title, headings, nav links, other links, visible text. doc is
// the page's root selection (from either Colly's e.DOM or a goquery document
// parsed from headless-Chrome-rendered HTML -- see render.go); pageURL is
// used to resolve relative links to absolute ones. Only the nav/other links
// are candidates for a NAVIGATE decision; everything else is context only.
func buildSnapshot(doc *goquery.Selection, pageURL string) PageSnapshot {
	title := collapseWhitespace(doc.Find("title").First().Text())

	var headings []string
	doc.Find("h1, h2, h3").Each(func(_ int, s *goquery.Selection) {
		if t := collapseWhitespace(s.Text()); t != "" {
			headings = append(headings, t)
		}
	})
	headings = dedupeStrings(headings)
	if len(headings) > 25 {
		headings = headings[:25]
	}

	seen := make(map[string]bool)
	pageURLNorm := normalizeURLForCompare(pageURL)
	var navLinks, otherLinks []PageLink

	addLink := func(s *goquery.Selection, into *[]PageLink) {
		href, exists := s.Attr("href")
		if !exists {
			return
		}
		href = strings.TrimSpace(href)
		lower := strings.ToLower(href)
		if href == "" || strings.HasPrefix(href, "#") ||
			strings.HasPrefix(lower, "mailto:") || strings.HasPrefix(lower, "tel:") ||
			strings.HasPrefix(lower, "javascript:") {
			return
		}
		abs := resolveURL(pageURL, href)
		if abs == "" || seen[abs] {
			return
		}
		// Skip self-links -- a "you are here" nav item pointing back at the
		// current page (e.g. "Tous les événements" while already on the
		// events page) isn't a real navigation option, and offering it just
		// invites the navigator to "navigate" in a circle and trip the loop
		// guard in discover.go instead of extracting.
		if normalizeURLForCompare(abs) == pageURLNorm {
			return
		}

		text := collapseWhitespace(s.Text())
		if text == "" {
			label, _ := s.Attr("aria-label")
			text = collapseWhitespace(label)
		}
		if text == "" {
			text = abs
		}

		seen[abs] = true
		*into = append(*into, PageLink{Text: truncate(text, 80), URL: abs})
	}

	doc.Find("nav a[href], header a[href]").Each(func(_ int, s *goquery.Selection) {
		addLink(s, &navLinks)
	})
	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		addLink(s, &otherLinks)
	})

	if len(navLinks) > maxSnapshotLinks {
		navLinks = navLinks[:maxSnapshotLinks]
	}
	if len(otherLinks) > maxSnapshotLinks {
		otherLinks = otherLinks[:maxSnapshotLinks]
	}

	bodyClone := doc.Find("body").Clone()
	bodyClone.Find("script, style, noscript, svg, footer").Remove()
	visibleText := truncate(collapseWhitespace(bodyClone.Text()), maxSnapshotTextRune)

	eventLinks := collectEventLinks(doc, pageURL, pageURLNorm)

	return PageSnapshot{
		URL:         pageURL,
		Title:       title,
		Headings:    headings,
		NavLinks:    navLinks,
		OtherLinks:  otherLinks,
		EventLinks:  eventLinks,
		VisibleText: visibleText,
	}
}

// collectEventLinks finds anchors on the page that are plausible "go buy
// tickets for this specific event" links, so the Extractor has real URLs to
// match events against instead of only plain text (which never contains a
// href -- see extractEvents in discover_extractor.go, and the "Acheter" text
// literally ending up in ticket_url before this existed). Many ticketing
// sites (Evenko included) wrap an entire event card -- name, date, venue,
// and buy-button label all together -- in one big <a href>; that anchor's
// own concatenated text is basically a one-line summary of the event, which
// is a strong, site-agnostic signal to key off of. Anchors that are too
// short to be a whole card but whose text matches a buy/tickets/details
// keyword (English or French) are captured too, for sites where the button
// is a separate, smaller anchor from the card's descriptive text.
func collectEventLinks(doc *goquery.Selection, pageURL, pageURLNorm string) []PageLink {
	seen := make(map[string]bool)
	var links []PageLink

	doc.Find("a[href]").EachWithBreak(func(_ int, s *goquery.Selection) bool {
		if len(links) >= maxEventLinks {
			return false // stop walking once the budget is spent
		}

		href, exists := s.Attr("href")
		if !exists {
			return true
		}
		href = strings.TrimSpace(href)
		lower := strings.ToLower(href)
		if href == "" || strings.HasPrefix(href, "#") ||
			strings.HasPrefix(lower, "mailto:") || strings.HasPrefix(lower, "tel:") ||
			strings.HasPrefix(lower, "javascript:") {
			return true
		}
		abs := resolveURL(pageURL, href)
		if abs == "" || seen[abs] || normalizeURLForCompare(abs) == pageURLNorm {
			return true
		}

		text := collapseWhitespace(s.Text())
		isRichCard := len([]rune(text)) >= minRichCardLinkRune
		isBuyButton := text != "" && looksLikeTicketLinkText(text)
		if !isRichCard && !isBuyButton {
			return true
		}

		seen[abs] = true
		links = append(links, PageLink{Text: truncate(text, maxEventLinkTextRune), URL: abs})
		return true
	})

	return links
}

// fetchSnapshot visits a single URL and returns a snapshot of what it found.
// When render is false (the default, and much faster), it uses a fresh,
// domain-scoped Colly collector -- a plain HTTP fetch that never executes
// JavaScript. When render is true, it instead uses a real headless Chrome
// instance (see render.go) so JavaScript-rendered content (common on bigger
// ticketing platforms like Evenko) is actually present in what Ollama sees.
// A fresh fetch per step (rather than one long-lived collector/browser)
// keeps the control loop in discover.go simple and avoids visited-URL dedup
// fighting with the navigator's own loop protection.
func fetchSnapshot(targetURL string, allowedDomains []string, timeout time.Duration, render, headed bool) (PageSnapshot, error) {
	if render {
		return fetchSnapshotRendered(targetURL, allowedDomains, timeout, headed)
	}
	return fetchSnapshotColly(targetURL, allowedDomains, timeout)
}

func fetchSnapshotColly(targetURL string, allowedDomains []string, timeout time.Duration) (PageSnapshot, error) {
	var snap PageSnapshot
	var snapErr error
	got := false

	c := colly.NewCollector(colly.AllowedDomains(allowedDomains...))
	c.SetRequestTimeout(timeout)

	c.OnHTML("html", func(e *colly.HTMLElement) {
		snap = buildSnapshot(e.DOM, e.Request.URL.String())
		got = true
	})
	c.OnError(func(r *colly.Response, err error) {
		snapErr = err
	})

	if err := c.Visit(targetURL); err != nil {
		return PageSnapshot{}, err
	}
	if snapErr != nil {
		return PageSnapshot{}, snapErr
	}
	if !got {
		return PageSnapshot{}, fmt.Errorf("no HTML content found at %s", targetURL)
	}
	return snap, nil
}
