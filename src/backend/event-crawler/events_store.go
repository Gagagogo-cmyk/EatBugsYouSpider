package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// EventsStore is the cumulative, on-disk record of every venue's events.
//
// discovered_events.json (see runDiscover, main.go) is deliberately a
// one-off snapshot: it gets overwritten every time you run -discover,
// showing you just what that one test run found. all_events.json (this
// file) is the opposite -- it's never wholesale overwritten. Every
// successful scrape, whether it's a single -discover test of one venue or a
// full -conc/-serve run across all of them, merges its venue(s)' events into
// this file by venue key, leaving every other venue's entry exactly as it
// was. That's what makes testing Evenko not erase Casa del Popolo: they're
// separate entries in the same map, and a run that only touches one of them
// only updates that one key.
//
// The only thing that removes an event from here is its own date passing --
// see pruneExpired, applied on every save regardless of which venue
// triggered it, so a venue that isn't rescraped for a while still gets its
// past shows swept out the next time *anything* saves.
const eventsStoreFile = "all_events.json"

type EventsStoreEnvelope struct {
	GeneratedAt string                `json:"generated_at"`
	EventCount  int                   `json:"event_count"`
	Venues      map[string]VenueBlock `json:"venues"`
}

type VenueBlock struct {
	Name   string    `json:"name"`
	Events EventList `json:"events"`
}

var eventsStoreMu sync.Mutex

func loadEventsStore() (map[string]VenueBlock, error) {
	data, err := os.ReadFile(eventsStoreFile)
	if os.IsNotExist(err) {
		return map[string]VenueBlock{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", eventsStoreFile, err)
	}
	var envelope EventsStoreEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", eventsStoreFile, err)
	}
	if envelope.Venues == nil {
		return map[string]VenueBlock{}, nil
	}
	return envelope.Venues, nil
}

func saveEventsStore(venues map[string]VenueBlock) error {
	total := 0
	for _, block := range venues {
		total += len(block.Events)
	}
	envelope := EventsStoreEnvelope{
		GeneratedAt: time.Now().In(loc).Format(time.RFC3339),
		EventCount:  total,
		Venues:      venues,
	}
	data, err := json.MarshalIndent(envelope, "", "\t")
	if err != nil {
		return fmt.Errorf("marshaling events store: %w", err)
	}
	return os.WriteFile(eventsStoreFile, data, 0644)
}

// keepExistingOnEmpty decides, for one venue, whether a fresh (possibly
// empty) scrape result should actually overwrite what's already on record.
// runConcurrent (main.go) collapses "the page couldn't be fetched" and "it
// fetched fine but genuinely has 0 upcoming events" into the same signal --
// an empty EventList -- so without this check, a single transient hiccup
// (a timeout, Ollama briefly unreachable, a site blipping) would wipe out
// real, still-upcoming events that an earlier successful scrape already
// found, the moment the next -conc/-serve cycle ran. If the new result is
// non-empty, or the venue has nothing on record yet, or it's a genuinely
// new key, there's nothing to protect -- only a "new empty result replacing
// an old non-empty one" case is held back. pruneExpired (below, in both
// callers) still cleans out whatever's kept once its own date passes, so
// this doesn't create anything that lingers forever.
func keepExistingOnEmpty(venues map[string]VenueBlock, key string, events EventList) bool {
	if len(events) > 0 {
		return false
	}
	existing, ok := venues[key]
	return ok && len(existing.Events) > 0
}

// mergeVenueEvents upserts a single venue's events into all_events.json
// without touching any other venue's entry, then prunes anything that's
// already happened across the whole store. Safe to call from multiple
// goroutines (guarded by eventsStoreMu).
func mergeVenueEvents(venueKey, venueName string, events EventList) error {
	eventsStoreMu.Lock()
	defer eventsStoreMu.Unlock()

	venues, err := loadEventsStore()
	if err != nil {
		return err
	}
	if !keepExistingOnEmpty(venues, venueKey, events) {
		venues[venueKey] = VenueBlock{Name: venueName, Events: events}
	}
	pruneExpired(venues)
	return saveEventsStore(venues)
}

// mergeAllVenueEvents does the same as mergeVenueEvents but for a whole
// batch at once (e.g. after a full -conc/-serve run across every venue),
// taking a single lock for the whole batch instead of one round-trip per
// venue. names supplies each venue's display name by key; if a key is
// missing there and the store doesn't already have a name for it either,
// the key itself is used as a last resort.
//
// Returns the full merged+pruned venue map (not just the batch that was
// passed in) so callers can rebuild the live server cache from the same
// authoritative, on-disk-consistent data that was just written -- see
// saveAllEvents's own comment (output.go) for why that matters.
func mergeAllVenueEvents(byVenue map[string]EventList, names map[string]string) (map[string]VenueBlock, error) {
	eventsStoreMu.Lock()
	defer eventsStoreMu.Unlock()

	venues, err := loadEventsStore()
	if err != nil {
		return nil, err
	}
	for key, events := range byVenue {
		if keepExistingOnEmpty(venues, key, events) {
			continue
		}
		name := names[key]
		if name == "" {
			if existing, ok := venues[key]; ok && existing.Name != "" {
				name = existing.Name
			} else {
				name = key
			}
		}
		venues[key] = VenueBlock{Name: name, Events: events}
	}
	pruneExpired(venues)
	if err := saveEventsStore(venues); err != nil {
		return nil, err
	}
	return venues, nil
}

// pruneExpired drops events whose date has already passed from every
// venue's list, in place. Events read back from disk have their derived
// fields (AlreadyHappened, ParsedDate, ...) zeroed out, since those are
// marked json:"-" and intentionally not persisted -- Date (the raw string)
// is what's persisted, so every event is re-enriched here to recompute
// AlreadyHappened fresh from Date before the check, rather than trusting
// whatever the field happened to hold coming in. This is what makes an
// event disappear on its own once the show is done, without needing that
// venue to be rescraped again first.
func pruneExpired(venues map[string]VenueBlock) {
	for key, block := range venues {
		kept := make(EventList, 0, len(block.Events))
		for _, e := range block.Events {
			e.enrichEvent()
			if !e.AlreadyHappened {
				kept = append(kept, e)
			}
		}
		block.Events = kept
		venues[key] = block
	}
}

// normalizedVenueName reduces a venue's display name to a loose-matching
// form, so the same physical room lines up across sources even when the
// exact text differs slightly -- lowercased, common punctuation stripped,
// and (crucially) a ticketing platform's own " – <city>" suffix dropped,
// e.g. evenko's "MTELUS – Montréal" needs to match the hardcoded "MTelus"
// (venues.go) despite neither the casing nor the city tag lining up
// literally. Only the EN DASH / EM DASH ("–"/"—") is treated as that city
// separator -- a plain ASCII hyphen is deliberately left alone, since venue
// names routinely contain one as part of the name itself (e.g. "Salle
// Wilfrid-Pelletier, Place des Arts – Montréal" or "Amphithéâtre Fernand-
// Lindsay – Joliette": splitting on the first "-" there would wrongly chop
// the name itself instead of the city tag).
func normalizedVenueName(name string) string {
	name = strings.TrimSpace(name)
	if i := strings.IndexAny(name, "–—"); i != -1 {
		if rest := strings.TrimSpace(name[i+1:]); rest != "" {
			name = strings.TrimSpace(name[:i])
		}
	}
	name = strings.ToLower(name)
	name = strings.NewReplacer("'", "", "’", "", ".", "", ",", "").Replace(name)
	return strings.Join(strings.Fields(name), " ")
}

// retagVenueKey returns a copy of events with VenueKey rewritten to key.
// Needed whenever explodeAndDedupeVenues (below) folds a discovered venue's
// events under a different key than the one they were originally scraped
// under -- e.g. one of evenko.ca's own listed rooms getting its own
// "discover-<room>" key instead of evenko's blanket scraper key -- so
// ByVenue filtering (events.go) and the sidebar's own ?venue= links keep
// matching against whatever key those events actually end up stored under.
func retagVenueKey(events EventList, key string) EventList {
	out := make(EventList, len(events))
	for i, e := range events {
		e.VenueKey = key
		out[i] = e
	}
	return out
}

// explodeAndDedupeVenues turns the raw per-scraper venues map (one block per
// hardcoded venues.go entry or per promoted "discover-*" site) into what the
// sidebar and events grid should actually show.
//
// UPDATE — user: "evenko isnt listed by venue. it's listed as evenko. I'd
// like the menu to split evenko by venue... and for casa del popolo/sala
// rossa/sotterenea/ptit ours/toscadura, dont put twice... never put the same
// venue twice in the menu." Both complaints turn out to be the same
// underlying issue: a "discover-*" entry (one promoted via the site's own
// "Add a venue" form, or -discover on the CLI) is really just wherever a
// SCRAPE started, not necessarily one physical venue. evenko.ca is a
// province-wide ticketing platform covering many different rooms; casa del
// popolo's own site (casadelpopolo.com) covers its five rooms, all five of
// which were ALREADY hardcoded individually in venues.go by hand well before
// anyone pointed the "Add a venue" form at that same site again. Every
// per-event Venue name (see Event.Venue, events.go) is the actual room --
// this regroups a "discover-*" block's events by that name instead of
// trusting the scraper-level key/Name to already mean one venue:
//
//   - A group whose name matches an EXISTING hardcoded venue (allVenues,
//     venues.go) by normalizedVenueName is dropped, not merged -- that venue
//     already has its own dedicated, authoritative scraper, so keeping a
//     second copy here would show it twice in the sidebar and duplicate its
//     events on the page. This is what makes the discovered "Casa del Popolo
//     | La Sala Rossa | La Sotterenea" blob disappear entirely: every one of
//     its five rooms matches an already-hardcoded entry, so every group gets
//     dropped and nothing is left to show under that key.
//   - Every other group becomes its own "discover-<slug of the room name>"
//     entry, named after that room alone -- never the platform's own name.
//     This is what turns evenko's one "Événements | evenko - La source
//     officielle..." entry into one sidebar item per actual room (Place
//     Bell, Théâtre Beanfield, etc.), skipping only whichever of evenko's
//     rooms (MTELUS, currently) is already hardcoded on its own.
//
// A "discover-*" block that turns out to be an ordinary single-venue site --
// the common case for whatever gets submitted through "Add a venue" -- has
// exactly one group and isn't a duplicate of anything hardcoded, so it's
// left exactly as it was before this function existed: same key, same name.
// This costs the ordinary add-venue flow nothing.
//
// Hardcoded (non "discover-*") blocks are never themselves split or
// dropped -- venues.go is hand-maintained per physical room already.
func explodeAndDedupeVenues(venues map[string]VenueBlock) map[string]VenueBlock {
	result := make(map[string]VenueBlock, len(venues))

	hardcodedKeyByName := make(map[string]string, len(allVenues))
	for key, v := range allVenues {
		hardcodedKeyByName[normalizedVenueName(v.Name)] = key
	}

	for key, block := range venues {
		if !strings.HasPrefix(key, "discover-") {
			result[key] = block
			continue
		}

		byVenue := make(map[string]EventList)
		var order []string
		for _, e := range block.Events {
			norm := normalizedVenueName(e.Venue)
			if norm == "" {
				norm = normalizedVenueName(block.Name)
			}
			if _, seen := byVenue[norm]; !seen {
				order = append(order, norm)
			}
			byVenue[norm] = append(byVenue[norm], e)
		}

		if len(order) == 0 {
			result[key] = block // no events scraped yet -- nothing to split, keep the placeholder entry as-is
			continue
		}

		if len(order) == 1 && hardcodedKeyByName[order[0]] == "" {
			// Ordinary single-venue discovered site, and not a duplicate of
			// an already-hardcoded venue -- unchanged from before this
			// function existed.
			result[key] = block
			continue
		}

		for _, norm := range order {
			if _, dup := hardcodedKeyByName[norm]; dup {
				continue // already covered by its own dedicated hardcoded scraper -- drop, don't duplicate
			}

			events := byVenue[norm]
			venueName := events[0].Venue
			if venueName == "" {
				venueName = block.Name
			}
			targetKey := "discover-" + slugify(venueName)

			merged := result[targetKey]
			if merged.Name == "" {
				merged.Name = venueName
			}
			merged.Events = append(merged.Events, retagVenueKey(events, targetKey)...)
			result[targetKey] = merged
		}
	}

	return result
}
