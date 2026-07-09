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
	CasaDelPopoloSelector    = "div.md\\:w-5\\/12.p-6"
	QuaiDesBrumesSelector    = "article.mec-event-article"
	CafeCampusSelector       = "div.noo-shevent-content"
	HemisphereGaucheSelector = "div.IFphb0"
	VerreBouteilleSelector   = "div.card-container"
	PiranhaBarSelector       = "article.eventlist-event"
	ClubSodaSelector         = "div.card.h-100"
	LeMinistereSelector      = "div.col-sm-6.col-lg-4.mb-4"
	FairmountTheatreSelector = "article.eventlist-event--upcoming"
	OlympiaSelector          = "div.wtb-olympia-concert_wrap"
)

// endpoints for JS-rendered venue websites
const (
	TurboHausURL   = "https://www.turbohaus.ca/api/events"
	BarLeRitzURL   = "https://www.barleritzpdb.com/vnements?format=json"
	mtelusAPIBase  = "https://mtelus.com/api/algolia/search?query="
	OlympiaAjaxURL = "https://www.olympiamontreal.com/wp-admin/admin-ajax.php"
)

var allVenues = map[string]Venue{
	"casa-del-popolo": {
		Name:    "Casa del Popolo",
		Address: "4873 Boul. St-Laurent",
		Group:   "casa-del-popolo-group",

		Link: "https://casadelpopolo.com/en/events/casa-del-popolo",
		AllowedDomains: []string{
			"casadelpopolo.com",
			"www.casadelpopolo.com",
		},
		Selector: CasaDelPopoloSelector,
		Website:  "https://casadelpopolo.com/en",

		Latitude:  45.521805,
		Longitude: -73.590431,
	},

	"la-sala-rossa": {
		Name:    "La Sala Rossa",
		Address: "4848 Boul. St-Laurent",
		Group:   "casa-del-popolo-group",

		Link: "https://casadelpopolo.com/en/events/la-sala-rossa",
		AllowedDomains: []string{
			"casadelpopolo.com",
			"www.casadelpopolo.com",
		},
		Selector: CasaDelPopoloSelector,
		Website:  "https://casadelpopolo.com/en",

		Latitude:  45.521771,
		Longitude: -73.590493,
	},

	"la-sotterenea": {
		Name:    "La Sotterenea",
		Address: "4848 Boul. St-Laurent",
		Group:   "casa-del-popolo-group",

		Link: "https://casadelpopolo.com/en/events/la-sotterenea",
		AllowedDomains: []string{
			"casadelpopolo.com",
			"www.casadelpopolo.com",
		},

		Selector: CasaDelPopoloSelector,
		Website:  "https://casadelpopolo.com/en",

		Latitude:  45.521771,
		Longitude: -73.590493,
	},

	"ptit-ours": {
		Name:    "Ptit Ours",
		Address: "5589 Avenue du Parc",
		Group:   "casa-del-popolo-group",

		Link: "https://casadelpopolo.com/en/events/ptit-ours",
		AllowedDomains: []string{
			"casadelpopolo.com",
			"www.casadelpopolo.com",
		},

		Selector: CasaDelPopoloSelector,
		Website:  "https://casadelpopolo.com/en",

		Latitude:  45.522644,
		Longitude: -73.602695,
	},

	"la-toscadura": {
		Name:    "La Toscadura",
		Address: "4388 St-Laurent",
		Group:   "casa-del-popolo-group",

		Link: "https://casadelpopolo.com/en/events/la-toscadura",
		AllowedDomains: []string{
			"casadelpopolo.com",
			"www.casadelpopolo.com",
		},

		Selector: CasaDelPopoloSelector,
		Website:  "https://casadelpopolo.com/en",

		Latitude:  45.519246,
		Longitude: -73.584909,
	},

	"quai-des-brumes": {
		Name:    "Quai des Brumes",
		Address: "4481 Rue Saint-Denis",

		Link: "https://quaidesbrumes.ca/calendrier/",
		AllowedDomains: []string{
			"quaidesbrumes.ca",
			"www.quaidesbrumes.ca",
		},

		Selector: QuaiDesBrumesSelector,
		Website:  "https://quaidesbrumes.ca",

		Latitude:  45.523917,
		Longitude: -73.582513,
	},

	"cafe-campus": {
		Name:    "Cafe Campus",
		Address: "57 Rue Prince-Arthur Est",

		Link: "https://spectacles.cafecampus.com/evenements",
		AllowedDomains: []string{
			"spectacles.cafecampus.com",
			"www.spectacles.cafecampus.com",
		},

		Selector: CafeCampusSelector,
		Website:  "https://www.cafecampus.com/",

		Latitude:  45.514541,
		Longitude: -73.572183,
	},

	"hemisphere-gauche": {
		Name:    "L'Hemisphere Gauche",
		Address: "221 Beaubien Est",

		Link: "https://www.hemispheregauche.com/?lang=en",
		AllowedDomains: []string{
			"hemispheregauche.com",
			"www.hemispheregauche.com",
		},

		Selector: HemisphereGaucheSelector,
		Website:  "https://www.hemispheregauche.com",

		Latitude:  45.532241,
		Longitude: -73.606866,
	},

	"verre-bouteille": {
		Name:    "Le Verre Bouteille",
		Address: "2112 Avenue du Mont-Royal Est",

		Link: "https://verrebouteille.com/shows.php",
		AllowedDomains: []string{
			"verrebouteille.com",
			"www.verrebouteille.com",
		},

		Selector: VerreBouteilleSelector,
		Website:  "https://verrebouteille.com",

		Latitude:  45.535373,
		Longitude: -73.572007,
	},

	"piranha-bar": {
		Name:    "Piranha Bar",
		Address: "680 Rue Sainte-Catherine Ouest",

		Link: "https://www.piranhabar.ca/events",
		AllowedDomains: []string{
			"piranhabar.ca",
			"www.piranhabar.ca",
		},

		Selector: PiranhaBarSelector,
		Website:  "https://www.piranhabar.ca",

		Latitude:  45.502818,
		Longitude: -73.569794,
	},

	"club-soda": {
		Name:    "Club Soda",
		Address: "1225 Boul. Saint-Laurent",

		Link: "https://clubsoda.ca/fr/evenements",
		AllowedDomains: []string{
			"clubsoda.ca",
			"www.clubsoda.ca",
		},

		Selector: ClubSodaSelector,
		Website:  "https://clubsoda.ca",

		Latitude:  45.509597,
		Longitude: -73.563217,
	},

	"le-ministere": {
		Name:    "Le Ministère",
		Address: "4521 Boul. Saint-Laurent",

		Link: "https://leministere.ca/evenements",
		AllowedDomains: []string{
			"leministere.ca",
			"www.leministere.ca",
		},

		Selector: LeMinistereSelector,
		Website:  "https://leministere.ca",

		Latitude:  45.520459,
		Longitude: -73.586783,
	},

	"fairmount-theatre": {
		Name:    "Fairmount Theatre",
		Address: "5240 Avenue du Parc",

		Link: "https://www.theatrefairmount.com/",
		AllowedDomains: []string{
			"theatrefairmount.com",
			"www.theatrefairmount.com",
		},

		Selector: FairmountTheatreSelector,
		Website:  "https://www.theatrefairmount.com/",

		Latitude:  45.520477,
		Longitude: -73.598509,
	},

	"olympia": {
		Name:    "L'Olympia",
		Address: "1004 Rue Sainte-Catherine Est",

		Link: "https://www.olympiamontreal.com/en/programmation/",
		AllowedDomains: []string{
			"olympiamontreal.com",
			"www.olympiamontreal.com",
		},

		// no Selector - paginated via admin-ajax.php
		Website: "https://www.olympiamontreal.com/",

		Latitude:  45.517137,
		Longitude: -73.557311,
	},

	"mtelus": {
		Name:    "MTelus",
		Address: "59 Rue Sainte-Catherine Est",

		Link: "https://mtelus.com/en/events?display=list",
		AllowedDomains: []string{
			"mtelus.com",
			"www.mtelus.com",
		},

		// no Selector - parse JSON (JS-rendered)
		Website: "https://mtelus.com",

		Latitude:  45.510586,
		Longitude: -73.56321,
	},

	"bar-le-ritz": {
		Name:    "Bar Le Ritz PDB",
		Address: "179 Rue Jean-Talon Ouest",

		Link: "https://www.barleritzpdb.com/vnements",
		AllowedDomains: []string{
			"barleritzpdb.com",
			"www.barleritzpdb.com",
		},

		// no Selector - parse JSON (Squarespace)
		Website: "https://www.barleritzpdb.com",

		Latitude:  45.530927,
		Longitude: -73.614784,
	},

	"turbo-haus": {
		Name:    "Turbo Haüs",
		Address: "2040 Rue Saint-Denis",

		Link: "https://www.turbohaus.ca/cal",
		AllowedDomains: []string{
			"turbohaus.ca",
			"www.turbohaus.ca",
		},

		// no Selector - parse JSON
		Website: "https://www.turbohaus.ca",

		Latitude:  45.516304,
		Longitude: -73.566101,
	},
}
