package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chromedp/chromedp"
)

// fetchSnapshotRendered fetches targetURL with a real, headless Chrome
// instance instead of a plain HTTP request, so that JavaScript-rendered
// content (common on ticketing platforms like Evenko -- see the "0 résultats"
// problem worked through with Evenko/Centre Bell) actually shows up in what
// Ollama gets to see. It's meaningfully slower than the Colly path (seconds,
// not milliseconds) since it has to run a real browser, so it's opt-in via
// -render, not the default.
//
// Requires Chrome or Chromium installed locally -- chromedp drives whatever
// browser it finds (or CHROMEDP_EXECUTABLE_PATH / chromedp.ExecPath, if you
// need to point it at a specific binary).
func fetchSnapshotRendered(targetURL string, allowedDomains []string, timeout time.Duration, headed bool) (PageSnapshot, error) {
	if !hostAllowed(targetURL, allowedDomains) {
		return PageSnapshot{}, fmt.Errorf("refusing to render %s: host is outside the allowed domains for this venue", targetURL)
	}

	html, err := fetchRenderedHTML(targetURL, timeout, headed)
	if err != nil {
		return PageSnapshot{}, fmt.Errorf("rendering %s with headless Chrome: %w", targetURL, err)
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return PageSnapshot{}, fmt.Errorf("parsing rendered HTML from %s: %w", targetURL, err)
	}

	return buildSnapshot(doc.Selection, targetURL), nil
}

// fetchRenderedHTML opens targetURL in headless Chrome, gives its JavaScript
// a few seconds to run, scrolls to the bottom a few times (to trigger
// scroll-to-load / infinite-scroll content the way a person scrolling the
// page would), and returns the fully rendered document's outerHTML.
//
// The wait/scroll strategy here is a simple, generic heuristic -- not
// tailored to any one site -- since the whole point of this project is not
// hardcoding per-venue behavior. It won't catch every possible loading
// pattern (e.g. content behind a click, not a scroll), but it covers the
// common cases: an initial async data fetch, and lazy-loaded/infinite-scroll
// listings.
func fetchRenderedHTML(targetURL string, timeout time.Duration, headed bool) (string, error) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", !headed),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
	)
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancelAlloc()

	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx)
	defer cancelBrowser()

	timeoutCtx, cancelTimeout := context.WithTimeout(browserCtx, timeout)
	defer cancelTimeout()

	var html string
	var scrollResult any

	err := chromedp.Run(timeoutCtx,
		chromedp.Navigate(targetURL),
		chromedp.Sleep(1500*time.Millisecond), // let the page (and any cookie banner) render

		chromedp.ActionFunc(func(ctx context.Context) error {
			dismissCookieConsent(ctx)
			return nil
		}),

		chromedp.Sleep(2*time.Second), // let the real, post-consent JS-driven data fetch land

		chromedp.Evaluate(`window.scrollTo(0, document.body.scrollHeight)`, &scrollResult),
		chromedp.Sleep(1*time.Second),
		chromedp.Evaluate(`window.scrollTo(0, document.body.scrollHeight)`, &scrollResult),
		chromedp.Sleep(1*time.Second),
		chromedp.Evaluate(`window.scrollTo(0, document.body.scrollHeight)`, &scrollResult),
		chromedp.Sleep(1*time.Second),

		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	)
	if err != nil {
		return "", err
	}
	return html, nil
}

// cookieCloseSelectors specifically target the "X" / close-icon dismissal
// some consent banners use instead of (or in addition to) an "Accept"
// button -- e.g. OneTrust's separate close button in the corner of the
// banner (#onetrust-close-btn-container), which just dismisses the banner
// without necessarily recording a choice. Tried first, since closing the
// panel outright is what we actually want here -- see cookieConsentSelectors
// below for the "Accept"-style fallback if no close icon is found.
var cookieCloseSelectors = []string{
	`#onetrust-close-btn-container button`, // OneTrust's dedicated close (X) button
	`.onetrust-close-btn-handler`,
	`button[aria-label="Close"]`,
	`button[aria-label*="close" i]`,
	`button[aria-label*="fermer" i]`, // French for "close"
	`[class*="close" i][class*="cookie" i]`,
	`[class*="cookie" i] [class*="close" i]`,
	// Generic "×"/"X"-glyph close buttons, common when a banner has no
	// aria-label at all -- matches a <button> (or a <span>/<i> icon inside
	// one) whose only visible text is the close glyph.
	`//button[normalize-space(.)='×' or normalize-space(.)='X' or normalize-space(.)='✕' or normalize-space(.)='✖']`,
	`//*[normalize-space(.)='×' or normalize-space(.)='✕' or normalize-space(.)='✖'][self::span or self::i]/ancestor::button[1]`,
}

// cookieConsentSelectors are best-effort ways to click through a
// cookie-consent banner when no close icon is found (see
// cookieCloseSelectors, tried first). Sites overwhelmingly use one of a
// handful of consent-management platforms (OneTrust, Didomi, Cookiebot) or a
// plain button with "accept"-ish text, so this is a generic heuristic across
// many sites rather than anything tailored to Evenko specifically. Order
// matters: the well-known platform selectors go first (fast, precise), the
// text-match fallbacks go last (slower, broader).
var cookieConsentSelectors = []string{
	`#onetrust-accept-btn-handler`,                           // OneTrust -- very common
	`#didomi-notice-agree-button`,                            // Didomi
	`#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`, // Cookiebot
	// Generic text match, English then French (accent-insensitive), for
	// anything not covered above -- matches a <button> whose visible text
	// contains "accept"/"accepter"/"j'accepte".
	`//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÂÉÈÊÎÔÙÛÇ', 'abcdefghijklmnopqrstuvwxyzàâéèêîôùûç'), 'accept')]`,
	`//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÂÉÈÊÎÔÙÛÇ', 'abcdefghijklmnopqrstuvwxyzàâéèêîôùûç'), 'accepter')]`,
}

// dismissCookieConsent makes a few bounded, best-effort attempts to close a
// cookie-consent banner, stopping at the first one that succeeds. It tries
// "X"/close-icon buttons first (cookieCloseSelectors) since that's the most
// direct way to just get the panel out of the way, then falls back to
// "Accept"-style buttons (cookieConsentSelectors) for banners that only
// offer that. Each attempt gets a short timeout of its own so a selector
// that doesn't match this particular page fails fast rather than eating
// into the overall page-load budget; a page with no consent banner at all is
// expected to run through every candidate and find nothing, which is fine --
// this is silently a no-op in that case.
func dismissCookieConsent(parent context.Context) {
	for _, sel := range append(append([]string{}, cookieCloseSelectors...), cookieConsentSelectors...) {
		attemptCtx, cancel := context.WithTimeout(parent, 800*time.Millisecond)
		var err error
		if strings.HasPrefix(sel, "//") {
			err = chromedp.Run(attemptCtx, chromedp.Click(sel, chromedp.BySearch))
		} else {
			err = chromedp.Run(attemptCtx, chromedp.Click(sel, chromedp.ByQuery))
		}
		cancel()

		if err == nil {
			// give the banner a moment to actually close before moving on
			settleCtx, cancel2 := context.WithTimeout(parent, 1*time.Second)
			_ = chromedp.Run(settleCtx, chromedp.Sleep(500*time.Millisecond))
			cancel2()
			return
		}
	}
}

// hostAllowed reports whether targetURL's host is in allowedDomains, mirroring
// what colly.AllowedDomains enforces on the normal fetch path -- since the
// headless-Chrome fetch bypasses Colly entirely, this is the equivalent
// guard against the navigator (or a redirect) wandering off-domain.
func hostAllowed(targetURL string, allowedDomains []string) bool {
	parsed, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, d := range allowedDomains {
		if host == strings.ToLower(d) {
			return true
		}
	}
	return false
}
