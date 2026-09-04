package main

import (
	"encoding/json"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
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
	// Scraping -- true for the duration of a scrape cycle (runConcurrent,
	// main.go), not just before the very first one ever completes. Drives
	// base.html's scraperOverlay/cricket video -- see that field's own
	// comment on the `scraping` package var, below, for why this replaced
	// gating the video on "not LastScrapedAt" (that only fired once, on
	// cold start, then never again since LastScrapedAt only ever gets SET,
	// never cleared).
	Scraping    bool
	VenueFilter string
	SearchQuery string      // artist/show-name search bar, ?q= -- see ByName, events.go
	VenuesJSON  template.JS // JSON array of venues with coordinates + their events

	Venues             []VenueOption       // every known venue (hardcoded + discovered), for the sidebar filter list
	PendingSubmissions []PendingSubmission // "add venue" submissions still being discovered or that failed
	VenueSubmitted     bool                // just submitted a venue URL -- show a "we're on it" notice
	VenueError         string              // set if the submitted URL itself was rejected (empty/not http(s))

	// Genres/GenreFilter -- spec item 6, same role as Venues/VenueFilter
	// just above but for the sidebar's genre tag filter: Genres is every
	// distinct genre actually scraped (DistinctGenres, events.go, rebuilt
	// in output.go's saveAllEvents alongside the venue list), GenreFilter
	// is the current ?genre= value (handlePage, below), if any.
	Genres      []string
	GenreFilter string
}

func newPageData(title string, events EventList) PageData {
	return PageData{
		Title:       title,
		Events:      events,
		EventCount:  len(events),
		GeneratedAt: time.Now().In(loc).Format("Monday, January 2 at 3:04PM"),
	}
}

// VenueOption is one entry in the sidebar's venue filter list -- built fresh
// after every scrape cycle (saveAllEvents, output.go) from the union of
// hardcoded (venues.go) and discovered (discovered_venues.json) venues, plus
// updated immediately when a new venue is added through the site's "add
// venue" form (see mergeNewVenueIntoCache below) rather than waiting for the
// next full rescrape.
type VenueOption struct {
	Key  string
	Name string
}

// PendingSubmission tracks one in-flight or failed "add venue" request from
// the site's URL bar (see handleAddVenue / runVenueSubmission). There's no
// live-update mechanism (no JS polling) -- a visitor just sees this on the
// page and checks back after a refresh; a successful submission removes
// itself from this list once its venue is merged into the live cache.
type PendingSubmission struct {
	URL         string
	SubmittedAt time.Time
	Status      string // "pending" or "failed"
	Message     string // populated on failure
}

var (
	cachedVenueList      []VenueOption
	cachedGenreList      []string // spec item 6 -- see DistinctGenres' and saveAllEvents' own comments
	pendingSubmissions   = make(map[string]*PendingSubmission)
	pendingSubmissionsMu sync.Mutex
)

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
	// scraping -- user: "add a scraper-loading animation... visible only
	// while actively scraping." The video was originally gated on
	// `not LastScrapedAt`, which only worked for the very first scrape
	// after a cold start (LastScrapedAt is set once at the end of a cycle
	// and never reset to zero, so every cycle after the first left it
	// already non-empty). This is a real "is a scrape running right now"
	// flag instead: set true at the top of runConcurrent (main.go), false
	// once it's done, guarded by the same `mu` as everything else here --
	// see handlePage's own read of it, below.
	scraping bool
	mu       sync.RWMutex

	// FIX -- user: "I DONT WANT desaturation for the images. I WANT 3
	// channels. white grey black. posterize the images. dont desaturate."
	// This originally motivated routing poster images through THIS server
	// (proxyImg/handleImageProxy, below) instead of hotlinking them
	// directly, so a client-side canvas quantization pass could read their
	// pixels without hitting cross-origin canvas-tainting. That
	// quantization pass (client-side, then later moved server-side for
	// performance -- see git history / the old posterizeImageBytes) is now
	// GONE ENTIRELY: user, most recently -- "remove all effect on the
	// images. i just want the normal images." handleImageProxy (below) now
	// just fetches and re-serves the original bytes, untouched. The proxy
	// itself stays, though, because it still does something real and
	// unrelated to posterizing: same-origin serving avoids hotlinking
	// scraped venue/ticketing hosts directly from visitors' browsers (some
	// block hotlinks outright; this also keeps venue image traffic/referrer
	// off this project's back). Funcs(...) has to run before ParseFiles --
	// template functions must exist before the template referencing them is
	// parsed, not just before it's executed.
	// "upper" -- spec item 6's genre tag boxes render their text uppercase,
	// same visual language as the .bandTag boxes they're modeled on
	// (splitLineup()'s own client-side .toUpperCase() call, see that
	// function's comment) -- but genre names are server-rendered straight
	// from Event.Genre/DistinctGenres, not built client-side, so the
	// uppercasing needs a template func instead of JS this time.
	baseTmpl = template.Must(template.New("base.html").Funcs(template.FuncMap{"proxyImg": proxyImg, "upper": strings.ToUpper}).ParseFiles("frontend/base.html"))

	// imageProxyClient -- a bounded timeout so one slow/unreachable venue
	// image host can't hang a request to handleImageProxy indefinitely;
	// http.Get's zero-value client has no timeout at all.
	imageProxyClient = &http.Client{Timeout: 10 * time.Second}

	// imageProxyCache -- keyed by the ORIGINAL (unproxied) image URL, holds
	// the original fetched image bytes for that poster (no processing done
	// to them any more -- see baseTmpl's own comment, above). Still worth
	// caching: avoids re-fetching the same venue image from its source host
	// on every visitor's every page load.
	imageProxyCache   = make(map[string][]byte)
	imageProxyCacheMu sync.RWMutex
)

// proxyImg -- template func for frontend/base.html's own poster <img> tag.
// Wraps a scraped EventImage URL so the browser fetches it through
// handleImageProxy (below) instead of hotlinking the original host
// directly. See baseTmpl's own comment, above, for why that matters.
func proxyImg(raw string) string {
	if raw == "" {
		return ""
	}
	return "/img-proxy?u=" + url.QueryEscape(raw)
}

// imageProxyCacheType -- keyed the same as imageProxyCache, holds the
// original Content-Type returned by the source host for that URL. Needed
// now that handleImageProxy no longer re-encodes everything to PNG (that
// was a side effect of the old quantize-and-re-encode step) -- a cache hit
// has to know what the bytes actually are to set the right header.
var (
	imageProxyCacheType   = make(map[string]string)
	imageProxyCacheTypeMu sync.RWMutex
)

// handleImageProxy -- see baseTmpl's own comment, above, for why this
// exists at all. Fetches whatever http(s) URL ?u= names and streams it back
// unmodified, with this server's own origin instead of the original host's
// -- same reasoning/shape as handleAddVenue's own scheme/host validation
// just below, reused here for the same "reject anything that isn't a real
// http(s) URL" purpose. No processing of the image bytes happens here any
// more (see baseTmpl's own comment for that history) -- imageProxyCache
// just avoids re-fetching the same venue image from its source host on
// every visitor's every page load.
func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("u")
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		http.Error(w, "bad image url", http.StatusBadRequest)
		return
	}

	imageProxyCacheMu.RLock()
	cached, hit := imageProxyCache[raw]
	imageProxyCacheMu.RUnlock()
	if hit {
		imageProxyCacheTypeMu.RLock()
		ct := imageProxyCacheType[raw]
		imageProxyCacheTypeMu.RUnlock()
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(cached)
		return
	}

	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		http.Error(w, "bad image url", http.StatusBadRequest)
		return
	}
	// Some venue/CDN hosts refuse a request with no User-Agent at all.
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; EBYS-image-proxy/1.0)")
	resp, err := imageProxyClient.Do(req)
	if err != nil {
		http.Error(w, "fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, "fetch failed", http.StatusBadGateway)
		return
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "fetch failed", http.StatusBadGateway)
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}

	imageProxyCacheMu.Lock()
	imageProxyCache[raw] = body
	imageProxyCacheMu.Unlock()
	imageProxyCacheTypeMu.Lock()
	imageProxyCacheType[raw] = ct
	imageProxyCacheTypeMu.Unlock()

	w.Header().Set("Content-Type", ct)
	// Same-origin now, so the browser never needs to consult CORS for this
	// response at all -- no Access-Control-Allow-Origin header to add here.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(body)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
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
		venueList := cachedVenueList
		genreList := cachedGenreList
		scraped := lastScrapedAt
		isScraping := scraping
		mu.RUnlock()

		venueFilter := r.URL.Query().Get("venue")
		if venueFilter != "" {
			events = events.ByVenue(venueFilter)
		}

		// Genre filter -- spec item 6: "clicking a genre activates it as a
		// filter/search criterion; filtering behavior should match the
		// existing artist/venue filtering system." Same ?param=/ByX()
		// pairing as venueFilter just above, applied in the same place so
		// it stacks with it (a venue selected AND a genre tag clicked both
		// narrow the same list) exactly the way venueFilter+searchQuery
		// already stack, below.
		genreFilter := r.URL.Query().Get("genre")
		if genreFilter != "" {
			events = events.ByGenre(genreFilter)
		}

		// Search bar -- user: "a search bar for artist name," placed "as a
		// rectangle where currently mtl show is" (frontend/base.html, right
		// at the top of .page). Applied after the venue filter so the two
		// combine (searching within an already-selected venue), same as
		// venueFilter's own placement just above. Stacks fine with the
		// sidebar's When/Weekend filters too, since those are separate
		// handlers (handlePage is called once per route, e.g. /tonight)
		// rather than another query param on this same route.
		searchQuery := r.URL.Query().Get("q")
		if searchQuery != "" {
			events = events.ByName(searchQuery)
		}

		data := newPageData(title, events)
		data.VenueFilter = venueFilter
		data.SearchQuery = searchQuery
		data.VenuesJSON = venuesJSON
		data.Venues = venueList
		data.Genres = genreList
		data.GenreFilter = genreFilter
		data.VenueSubmitted = r.URL.Query().Get("venue_submitted") != ""
		data.VenueError = r.URL.Query().Get("venue_error")
		if !scraped.IsZero() {
			data.LastScrapedAt = scraped.Format("Monday, January 2 at 3:04 PM")
		}
		data.Scraping = isScraping

		pendingSubmissionsMu.Lock()
		for _, s := range pendingSubmissions {
			data.PendingSubmissions = append(data.PendingSubmissions, *s)
		}
		pendingSubmissionsMu.Unlock()
		sort.Slice(data.PendingSubmissions, func(i, j int) bool {
			return data.PendingSubmissions[i].SubmittedAt.After(data.PendingSubmissions[j].SubmittedAt)
		})

		if err := baseTmpl.ExecuteTemplate(w, "base", data); err != nil {
			log.Fatal(err)
		}
	}
}

// handleAddVenue is the "add venue" URL bar's form target. It does the bare
// minimum of validation (must actually parse as a URL, must be http/https,
// must have a host -- rejecting "javascript:", empty strings, etc.) and
// otherwise accepts anything, per your call not to add rate limiting or
// private-network blocking for now. Discovery itself is kicked off in the
// background (runVenueSubmission) so this handler returns immediately
// instead of holding the visitor's request open for however long discovery
// takes.
func handleAddVenue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/?venue_error=Couldn%27t+read+that+submission", http.StatusSeeOther)
		return
	}

	rawURL := strings.TrimSpace(r.FormValue("url"))
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		http.Redirect(w, r, "/?venue_error=Please+enter+a+valid+http%28s%29%3A%2F%2F+URL", http.StatusSeeOther)
		return
	}

	pendingSubmissionsMu.Lock()
	pendingSubmissions[rawURL] = &PendingSubmission{URL: rawURL, SubmittedAt: time.Now().In(loc), Status: "pending"}
	pendingSubmissionsMu.Unlock()

	go runVenueSubmission(rawURL)

	http.Redirect(w, r, "/?venue_submitted=1", http.StatusSeeOther)
}

// runVenueSubmission runs a full Ollama discovery for a venue URL submitted
// through the site's "add venue" form. It's launched with `go` from
// handleAddVenue so the visitor's request isn't held open for the minutes
// discovery can take. On success it's promoted into discovered_venues.json
// exactly like a -discover CLI run (same fast-path/self-healing behavior on
// every future -conc/-serve scrape), its events are merged into
// all_events.json, and the live in-memory cache is updated directly
// (mergeNewVenueIntoCache) so the venue shows up on the site without waiting
// for the next full rescrape of every other venue.
func runVenueSubmission(rawURL string) {
	result, err := promoteVenue(DiscoverConfig{
		StartURL:      rawURL,
		OllamaHost:    *ollamaHost,
		Model:         *ollamaModel,
		MaxSteps:      *discoverSteps,
		OllamaTimeout: *ollamaTimeout,
		Verbose:       *discoverVerbose,
	})

	pendingSubmissionsMu.Lock()
	if err != nil {
		sub := pendingSubmissions[rawURL]
		if sub == nil {
			sub = &PendingSubmission{URL: rawURL, SubmittedAt: time.Now().In(loc)}
			pendingSubmissions[rawURL] = sub
		}
		sub.Status = "failed"
		sub.Message = err.Error()
		pendingSubmissionsMu.Unlock()
		log.Printf("[add-venue] discovery failed for %s: %v", rawURL, err)
		return
	}
	delete(pendingSubmissions, rawURL)
	pendingSubmissionsMu.Unlock()

	if mergeErr := mergeVenueEvents(result.VenueKey, result.VenueName, result.Events); mergeErr != nil {
		log.Printf("[add-venue] discovery succeeded for %s but failed to update all_events.json: %v", rawURL, mergeErr)
	}
	mergeNewVenueIntoCache(result.VenueKey, result.VenueName, result.Events)
	log.Printf("[add-venue] %s added successfully as %q (%d event(s))", rawURL, result.VenueKey, len(result.Events))
}

// mergeNewVenueIntoCache folds one venue's freshly discovered events into
// the live in-memory cache the web server serves (cachedEvents,
// cachedVenueList) immediately, rather than waiting for the next scheduled
// -conc/-serve cycle to rebuild everything from scratch. cachedMarkers is
// deliberately left untouched: it's only ever built from allVenues
// (venues.go), which carry known lat/lng -- a venue discovered through the
// URL bar has no coordinates, so it appears in the events list and the
// sidebar filter but not as a map pin.
func mergeNewVenueIntoCache(venueKey, venueName string, events EventList) {
	mu.Lock()
	defer mu.Unlock()

	updated := make(EventList, 0, len(cachedEvents)+len(events))
	for _, e := range cachedEvents {
		if e.VenueKey != venueKey {
			updated = append(updated, e)
		}
	}
	updated = append(updated, events...)
	updated.SortByDate()
	cachedEvents = updated

	for i := range cachedVenueList {
		if cachedVenueList[i].Key == venueKey {
			cachedVenueList[i].Name = venueName
			return
		}
	}
	cachedVenueList = append(cachedVenueList, VenueOption{Key: venueKey, Name: venueName})
	sort.Slice(cachedVenueList, func(i, j int) bool { return cachedVenueList[i].Name < cachedVenueList[j].Name })
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
