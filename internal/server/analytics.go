package server

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// Tool-kind aggregate buckets. The names mirror the frontend's toolKindTaxonomy
// groups so both ends of the wire describe the same categories.
const (
	toolGroupRead   = "read"
	toolGroupEdit   = "edit"
	toolGroupBash   = "bash"
	toolGroupSearch = "search"
	toolGroupWeb    = "web"
	toolGroupOther  = "other"
)

// ToolCounts is a per-session summary of tool-call usage bucketed into the
// aggregate kinds the analytics UI charts, plus total and failed counts.
type ToolCounts struct {
	Reads  int `json:"reads"`
	Edits  int `json:"edits"`
	Bash   int `json:"bash"`
	Search int `json:"search"`
	Web    int `json:"web"`
	Other  int `json:"other"`
	Total  int `json:"total"`
	Failed int `json:"failed"`
}

// analyticsDaily is one day's aggregated tool-call activity across the sessions
// that updated within that day.
type analyticsDaily struct {
	Date     string `json:"date"` // YYYY-MM-DD (UTC)
	Reads    int    `json:"reads"`
	Edits    int    `json:"edits"`
	Bash     int    `json:"bash"`
	Search   int    `json:"search"`
	Web      int    `json:"web"`
	Other    int    `json:"other"`
	Total    int    `json:"total"`
	Failed   int    `json:"failed"`
	Sessions int    `json:"sessions"`
}

type analyticsResponse struct {
	From  int64            `json:"from"`
	To    int64            `json:"to"`
	Daily []analyticsDaily `json:"daily"`
}

// toolGroup maps a canonical tool-call name to its aggregate analytics bucket.
// Adapters normalize agent-native names via ingestkit.CanonicalizeToolName, so
// the standard set below is the complete switch surface.
func toolGroup(name string) string {
	switch name {
	case "edit", "write", "delete":
		return toolGroupEdit
	case "read":
		return toolGroupRead
	case "bash":
		return toolGroupBash
	case "grep", "glob", "codesearch", "read_lints":
		return toolGroupSearch
	case "webfetch", "websearch":
		return toolGroupWeb
	default:
		return toolGroupOther
	}
}

// countToolCalls tallies every tool call in the given messages into the
// aggregate buckets. A call whose status is not a clean completion counts as
// failed, matching the frontend's success-rate definition.
func countToolCalls(msgs []ingest.Message) ToolCounts {
	var counts ToolCounts
	for _, m := range msgs {
		for _, tc := range m.ToolCalls {
			counts.Total++
			if tc.Status == ingest.ToolCallFailed || tc.Status == "error" {
				counts.Failed++
			}
			switch toolGroup(tc.Name) {
			case toolGroupRead:
				counts.Reads++
			case toolGroupEdit:
				counts.Edits++
			case toolGroupBash:
				counts.Bash++
			case toolGroupSearch:
				counts.Search++
			case toolGroupWeb:
				counts.Web++
			default:
				counts.Other++
			}
		}
	}
	return counts
}

// handleAnalytics serves the per-day tool-call aggregation for sessions whose
// UpdatedAt falls within [from, to). Both bounds are unix milliseconds; an
// omitted from means all time. The endpoint is read-only: it reads the cached
// session list and the per-session message seam, never agent databases.
func handleAnalytics(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		from := int64(0)
		to := time.Now().AddDate(1, 0, 0).UnixMilli()
		if v := q.Get("from"); v != "" {
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				from = parsed
			}
		}
		if v := q.Get("to"); v != "" {
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				to = parsed
			}
		}
		writeOK(w, aggregateAnalytics(r.Context(), hub, from, to))
	}
}

// aggregateAnalytics buckets the tool-call activity of every session updated
// within [from, to) by the day of its last update, so the analytics tab covers
// exactly the sessions the overview's time filter shows.
func aggregateAnalytics(ctx context.Context, hub *SessionHub, from, to int64) analyticsResponse {
	byDay := make(map[string]*analyticsDaily)
	var dates []string
	for _, sess := range hub.Sessions() {
		updated := sess.UpdatedAt.UnixMilli()
		if updated < from || updated >= to {
			continue
		}
		day := sess.UpdatedAt.UTC().Format("2006-01-02")
		entry := byDay[day]
		if entry == nil {
			entry = &analyticsDaily{Date: day}
			byDay[day] = entry
			dates = append(dates, day)
		}
		counts, err := hub.ToolCounts(ctx, &sess)
		if err != nil {
			slog.Debug("analytics: failed to load tool counts", "session", sess.ID, "error", err)
			continue
		}
		entry.Sessions++
		entry.Reads += counts.Reads
		entry.Edits += counts.Edits
		entry.Bash += counts.Bash
		entry.Search += counts.Search
		entry.Web += counts.Web
		entry.Other += counts.Other
		entry.Total += counts.Total
		entry.Failed += counts.Failed
	}
	sort.Strings(dates)
	resp := analyticsResponse{From: from, To: to, Daily: []analyticsDaily{}}
	for _, d := range dates {
		resp.Daily = append(resp.Daily, *byDay[d])
	}
	return resp
}
