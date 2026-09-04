package main

type Venue struct {
	Name           string
	Address        string
	Neighborhood   string
	Group          string // group related venues (multiple venues for a single website) this is rare
	Link           string
	AllowedDomains []string
	Selector       string // CSS selector for events on page -- Colly
	Website        string

	// interactive map values
	Latitude  float64
	Longitude float64
}

// colly CSS selectors
const (
	OlympiaSelector = "div.wtb-olympia-concert_wrap"
)

// endpoints for JS-rendered venue websites
//
// parsers.go's JSON-driven scrapers (scrapeTurboHausJSON, scrapeBarLeRitzJSON,
// scrapeMTelusJSON, scrapeOlympiaAJAX) call these directly, independent of the
// allVenues map.
const (
	TurboHausURL   = "https://www.turbohaus.ca/api/events"
	BarLeRitzURL   = "https://www.barleritzpdb.com/vnements?format=json"
	mtelusAPIBase  = "https://mtelus.com/api/algolia/search?query="
	OlympiaAjaxURL = "https://www.olympiamontreal.com/wp-admin/admin-ajax.php"
)

// allVenues is the registry of venues with a hand-written scraper: a Colly
// CSS selector for most of them, or (for the four JSON/AJAX-backed venues --
// Olympia, MTelus, Bar Le Ritz, Turbo Haüs) a special case in runConcurrent's
// switch statement (main.go) that calls a dedicated JSON client in
// parsers.go instead of using Selector at all.
//
// This is the fast, precise path -- see README.md for how it relates to the
// Ollama-driven discovery path (discover.go). As of this restore, it's also
// self-healing: if a venue's hardcoded scrape comes back with 0 events
// (either the page couldn't be fetched, or the selector matched nothing --
// runConcurrent doesn't distinguish the two, since either one means "this
// key produced nothing"), runConcurrent automatically falls back to a full
// Ollama discovery run starting from this venue's Link, using this venue's
// own key and Name so it keeps the same identity (map marker, ?venue=
// filter link, etc.) rather than becoming a separate "new" venue. A
// successful fallback promotes the venue into discovered_venues.json under
// that same key, so every subsequent scrape goes straight through the fast,
// self-healing discovered-venue path instead of retrying the broken
// selector every cycle.
var allVenues = map[string]Venue{
	"casa-del-popolo": {
		Name:           "Casa del Popolo",
		Address:        "4873 Boul. St-Laurent",
		Group:          "casa-del-popolo-group",
		Link:           "https://casadelpopolo.com/en/events/casa-del-popolo",
		Website:        "https://casadelpopolo.com/en",
		AllowedDomains: []string{"casadelpopolo.com", "www.casadelpopolo.com"},
		Selector:       `div.md\:w-5\/12.p-6`,
		Latitude:       45.521805,
		Longitude:      -73.590431,
	},
	"la-sala-rossa": {
		Name:           "La Sala Rossa",
		Address:        "4848 Boul. St-Laurent",
		Group:          "casa-del-popolo-group",
		Link:           "https://casadelpopolo.com/en/events/la-sala-rossa",
		Website:        "https://casadelpopolo.com/en",
		AllowedDomains: []string{"casadelpopolo.com", "www.casadelpopolo.com"},
		Selector:       `div.md\:w-5\/12.p-6`,
		Latitude:       45.521771,
		Longitude:      -73.590493,
	},
	"la-sotterenea": {
		Name:           "La Sotterenea",
		Address:        "4848 Boul. St-Laurent",
		Group:          "casa-del-popolo-group",
		Link:           "https://casadelpopolo.com/en/events/la-sotterenea",
		Website:        "https://casadelpopolo.com/en",
		AllowedDomains: []string{"casadelpopolo.com", "www.casadelpopolo.com"},
		Selector:       `div.md\:w-5\/12.p-6`,
		Latitude:       45.521771,
		Longitude:      -73.590493,
	},
	"ptit-ours": {
		Name:           "Ptit Ours",
		Address:        "5589 Avenue du Parc",
		Group:          "casa-del-popolo-group",
		Link:           "https://casadelpopolo.com/en/events/ptit-ours",
		Website:        "https://casadelpopolo.com/en",
		AllowedDomains: []string{"casadelpopolo.com", "www.casadelpopolo.com"},
		Selector:       `div.md\:w-5\/12.p-6`,
		Latitude:       45.522644,
		Longitude:      -73.602695,
	},
	"la-toscadura": {
		Name:           "La Toscadura",
		Address:        "4388 St-Laurent",
		Group:          "casa-del-popolo-group",
		Link:           "https://casadelpopolo.com/en/events/la-toscadura",
		Website:        "https://casadelpopolo.com/en",
		AllowedDomains: []string{"casadelpopolo.com", "www.casadelpopolo.com"},
		Selector:       `div.md\:w-5\/12.p-6`,
		Latitude:       45.519246,
		Longitude:      -73.584909,
	},
	"quai-des-brumes": {
		Name:           "Quai des Brumes",
		Address:        "4481 Rue Saint-Denis",
		Link:           "https://quaidesbrumes.ca/calendrier/",
		Website:        "https://quaidesbrumes.ca",
		AllowedDomains: []string{"quaidesbrumes.ca", "www.quaidesbrumes.ca"},
		Selector:       `article.mec-event-article`,
		Latitude:       45.523917,
		Longitude:      -73.582513,
	},
	"cafe-campus": {
		Name:           "Cafe Campus",
		Address:        "57 Rue Prince-Arthur Est",
		Link:           "https://spectacles.cafecampus.com/evenements",
		Website:        "https://www.cafecampus.com/",
		AllowedDomains: []string{"spectacles.cafecampus.com", "www.spectacles.cafecampus.com"},
		Selector:       `div.noo-shevent-content`,
		Latitude:       45.514541,
		Longitude:      -73.572183,
	},
	"hemisphere-gauche": {
		Name:           "L'Hemisphere Gauche",
		Address:        "221 Beaubien Est",
		Link:           "https://www.hemispheregauche.com/?lang=en",
		Website:        "https://www.hemispheregauche.com",
		AllowedDomains: []string{"hemispheregauche.com", "www.hemispheregauche.com"},
		Selector:       `div.IFphb0`,
		Latitude:       45.532241,
		Longitude:      -73.606866,
	},
	"verre-bouteille": {
		Name:           "Le Verre Bouteille",
		Address:        "2112 Avenue du Mont-Royal Est",
		Link:           "https://verrebouteille.com/shows.php",
		Website:        "https://verrebouteille.com",
		AllowedDomains: []string{"verrebouteille.com", "www.verrebouteille.com"},
		Selector:       `div.card-container`,
		Latitude:       45.535373,
		Longitude:      -73.572007,
	},
	"piranha-bar": {
		Name:           "Piranha Bar",
		Address:        "680 Rue Sainte-Catherine Ouest",
		Link:           "https://www.piranhabar.ca/events",
		Website:        "https://www.piranhabar.ca",
		AllowedDomains: []string{"piranhabar.ca", "www.piranhabar.ca"},
		Selector:       `article.eventlist-event`,
		Latitude:       45.502818,
		Longitude:      -73.569794,
	},
	"club-soda": {
		Name:           "Club Soda",
		Address:        "1225 Boul. Saint-Laurent",
		Link:           "https://clubsoda.ca/fr/evenements",
		Website:        "https://clubsoda.ca",
		AllowedDomains: []string{"clubsoda.ca", "www.clubsoda.ca"},
		Selector:       `div.card.h-100`,
		Latitude:       45.509597,
		Longitude:      -73.563217,
	},
	"le-ministere": {
		Name:           "Le Ministère",
		Address:        "4521 Boul. Saint-Laurent",
		Link:           "https://leministere.ca/evenements",
		Website:        "https://leministere.ca",
		AllowedDomains: []string{"leministere.ca", "www.leministere.ca"},
		Selector:       `div.col-sm-6.col-lg-4.mb-4`,
		Latitude:       45.520459,
		Longitude:      -73.586783,
	},
	"fairmount-theatre": {
		Name:           "Fairmount Theatre",
		Address:        "5240 Avenue du Parc",
		Link:           "https://www.theatrefairmount.com/",
		Website:        "https://www.theatrefairmount.com/",
		AllowedDomains: []string{"theatrefairmount.com", "www.theatrefairmount.com"},
		Selector:       `article.eventlist-event--upcoming`,
		Latitude:       45.520477,
		Longitude:      -73.598509,
	},
	"olympia": {
		Name:           "L'Olympia",
		Address:        "1004 Rue Sainte-Catherine Est",
		Link:           "https://www.olympiamontreal.com/en/programmation/",
		Website:        "https://www.olympiamontreal.com/",
		AllowedDomains: []string{"olympiamontreal.com", "www.olympiamontreal.com"},
		Selector:       OlympiaSelector, // not actually used at runtime -- "olympia" is special-cased to scrapeOlympiaAJAX() in main.go
		Latitude:       45.517137,
		Longitude:      -73.557311,
	},
	"mtelus": {
		Name:           "MTelus",
		Address:        "59 Rue Sainte-Catherine Est",
		Link:           "https://mtelus.com/en/events?display=list",
		Website:        "https://mtelus.com",
		AllowedDomains: []string{"mtelus.com", "www.mtelus.com"},
		Latitude:       45.510586,
		Longitude:      -73.56321,
	},
	"bar-le-ritz": {
		Name:           "Bar Le Ritz PDB",
		Address:        "179 Rue Jean-Talon Ouest",
		Link:           "https://www.barleritzpdb.com/vnements",
		Website:        "https://www.barleritzpdb.com",
		AllowedDomains: []string{"barleritzpdb.com", "www.barleritzpdb.com"},
		Latitude:       45.530927,
		Longitude:      -73.614784,
	},
	"turbo-haus": {
		Name:           "Turbo Haüs",
		Address:        "2040 Rue Saint-Denis",
		Link:           "https://www.turbohaus.ca/cal",
		Website:        "https://www.turbohaus.ca",
		AllowedDomains: []string{"turbohaus.ca", "www.turbohaus.ca"},
		Latitude:       45.516304,
		Longitude:      -73.566101,
	},
}
