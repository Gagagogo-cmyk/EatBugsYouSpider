package main

import (
	"regexp"
	"strings"
)

type squarespaceResponse struct {
	Upcoming []squarespaceItem `json:"upcoming"`
	Past     []squarespaceItem `json:"past"`
	Items    []squarespaceItem `json:"items"`
}

type squarespaceItem struct {
	Title     string               `json:"title"`
	FullURL   string               `json:"fullUrl"`
	StartDate int64                `json:"startDate"` // Unix ms
	EndDate   int64                `json:"endDate"`   // Unix ms
	AssetURL  string               `json:"assetUrl"`  // poster image
	Location  *squarespaceLocation `json:"location"`
	Body      string               `json:"body"`
	Excerpt   string               `json:"excerpt"`
	Tags      []string             `json:"tags"`
}

type squarespaceLocation struct {
	AddressTitle   string `json:"addressTitle"`
	AddressLine1   string `json:"addressLine1"`
	AddressLine2   string `json:"addressLine2"`
	AddressCountry string `json:"addressCountry"`
}

func mergeSquarespaceItems(resp squarespaceResponse) (merged []squarespaceItem) {
	seen := make(map[string]struct{})
	addUnique := func(items []squarespaceItem) {
		for _, item := range items {
			if _, exists := seen[item.FullURL]; !exists {
				seen[item.FullURL] = struct{}{}
				merged = append(merged, item)
			}
		}
	}
	addUnique(resp.Upcoming)
	addUnique(resp.Items)

	return merged
}

var h2Regex = regexp.MustCompile(`<h2[^>]*>(.*?)</h2>`)
var tagStripper = regexp.MustCompile(`<[^>]*>`)

// extractEventName pulls the artist/event name from the first <h2> in the Squarespace body HTML.
func extractEventName(body string) string {
	match := h2Regex.FindStringSubmatch(body)
	if len(match) < 2 {
		return ""
	}
	name := tagStripper.ReplaceAllString(match[1], "")
	return strings.TrimSpace(name)
}
