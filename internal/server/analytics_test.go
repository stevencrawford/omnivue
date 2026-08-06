package server

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/resumecmd"
)

// countingAdapter returns per-session messages and counts how many times the
// message seam is hit, so tests can assert the tool-count cache prevents
// redundant transcript scans.
type countingAdapter struct {
	sessions []ingest.Session
	messages map[string][]ingest.Message
	msgCalls atomic.Int64
}

func (a *countingAdapter) ListSessions(context.Context) ([]ingest.Session, error) {
	return a.sessions, nil
}

func (a *countingAdapter) Session(_ context.Context, id string) (*ingest.Session, error) {
	for _, s := range a.sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, os.ErrNotExist
}

func (a *countingAdapter) Messages(_ context.Context, sessionID string) ([]ingest.Message, error) {
	a.msgCalls.Add(1)
	return a.messages[sessionID], nil
}

func (a *countingAdapter) ResumeCommand() resumecmd.Spec { return resumecmd.Spec{} }

func (a *countingAdapter) LastModified(context.Context) (int64, error) { return 0, nil }

func (a *countingAdapter) Close() error { return nil }

func TestToolGroup(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "read", in: "read", want: "read"},
		{name: "edit", in: "edit", want: "edit"},
		{name: "write maps to edit", in: "write", want: "edit"},
		{name: "delete maps to edit", in: "delete", want: "edit"},
		{name: "bash", in: "bash", want: "bash"},
		{name: "grep maps to search", in: "grep", want: "search"},
		{name: "glob maps to search", in: "glob", want: "search"},
		{name: "webfetch maps to web", in: "webfetch", want: "web"},
		{name: "unknown stays other", in: "todowrite", want: "other"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := toolGroup(tt.in); got != tt.want {
				t.Errorf("toolGroup(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestCountToolCalls(t *testing.T) {
	msgs := []ingest.Message{
		{ToolCalls: []ingest.ToolCall{
			{Name: "read", Status: ingest.ToolCallCompleted},
			{Name: "edit", Status: ingest.ToolCallCompleted},
			{Name: "bash", Status: ingest.ToolCallFailed},
			{Name: "webfetch", Status: ingest.ToolCallCompleted},
		}},
		{ToolCalls: []ingest.ToolCall{
			{Name: "grep", Status: ingest.ToolCallCompleted},
			{Name: "custom_tool", Status: "error"},
		}},
	}

	counts := countToolCalls(msgs)
	if counts.Reads != 1 || counts.Edits != 1 || counts.Bash != 1 || counts.Web != 1 || counts.Search != 1 {
		t.Errorf("unexpected bucket counts: %+v", counts)
	}
	if counts.Other != 1 {
		t.Errorf("expected 1 other tool, got %d", counts.Other)
	}
	if counts.Total != 6 {
		t.Errorf("expected 6 total tool calls, got %d", counts.Total)
	}
	if counts.Failed != 2 {
		t.Errorf("expected 2 failed calls, got %d", counts.Failed)
	}
}

func TestAggregateAnalytics(t *testing.T) {
	day1 := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	outside := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)

	sessions := []ingest.Session{
		{ID: "s1", SourceID: "src", UpdatedAt: day1},
		{ID: "s2", SourceID: "src", UpdatedAt: day2},
		{ID: "s3", SourceID: "src", UpdatedAt: outside},
	}
	adapter := &countingAdapter{
		sessions: sessions,
		messages: map[string][]ingest.Message{
			"s1": {{ToolCalls: []ingest.ToolCall{{Name: "read", Status: ingest.ToolCallCompleted}}}},
			"s2": {{ToolCalls: []ingest.ToolCall{{Name: "edit", Status: ingest.ToolCallCompleted}}}},
			"s3": {{ToolCalls: []ingest.ToolCall{{Name: "bash", Status: ingest.ToolCallCompleted}}}},
		},
	}
	hub := NewSessionHub(newFakeNameStore())
	hub.AddAdapter("src", adapter)
	hub.sessions = sessions

	from := day1.Add(-time.Hour).UnixMilli()
	to := day2.Add(time.Hour).UnixMilli()
	resp := aggregateAnalytics(context.Background(), hub, from, to)

	if len(resp.Daily) != 2 {
		t.Fatalf("expected 2 daily entries, got %d: %+v", len(resp.Daily), resp.Daily)
	}
	if resp.Daily[0].Date != "2026-08-04" || resp.Daily[1].Date != "2026-08-05" {
		t.Errorf("unexpected dates: %q %q", resp.Daily[0].Date, resp.Daily[1].Date)
	}
	if resp.Daily[0].Reads != 1 || resp.Daily[0].Sessions != 1 {
		t.Errorf("unexpected day-1 aggregation: %+v", resp.Daily[0])
	}
	if resp.Daily[1].Edits != 1 || resp.Daily[1].Total != 1 {
		t.Errorf("unexpected day-2 aggregation: %+v", resp.Daily[1])
	}
}

func TestToolCountsCache(t *testing.T) {
	updated := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sess := ingest.Session{ID: "s1", SourceID: "src", UpdatedAt: updated}
	adapter := &countingAdapter{
		sessions: []ingest.Session{sess},
		messages: map[string][]ingest.Message{
			"s1": {{ToolCalls: []ingest.ToolCall{{Name: "read", Status: ingest.ToolCallCompleted}}}},
		},
	}
	hub := NewSessionHub(newFakeNameStore())
	hub.AddAdapter("src", adapter)
	hub.sessions = []ingest.Session{sess}

	if _, err := hub.ToolCounts(context.Background(), &sess); err != nil {
		t.Fatalf("ToolCounts: %v", err)
	}
	if _, err := hub.ToolCounts(context.Background(), &sess); err != nil {
		t.Fatalf("ToolCounts (cached): %v", err)
	}
	if adapter.msgCalls.Load() != 1 {
		t.Fatalf("expected 1 message scan after cache hit, got %d", adapter.msgCalls.Load())
	}

	stale := sess
	stale.UpdatedAt = updated.Add(time.Hour)
	if _, err := hub.ToolCounts(context.Background(), &stale); err != nil {
		t.Fatalf("ToolCounts (stale): %v", err)
	}
	if adapter.msgCalls.Load() != 2 {
		t.Fatalf("expected 2 message scans after staleness, got %d", adapter.msgCalls.Load())
	}
}

func TestHandleAnalytics(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	sessions := []ingest.Session{
		{ID: "s1", SourceID: "src-1", UpdatedAt: now.Add(-time.Hour)},
	}
	adapter := &countingAdapter{
		sessions: sessions,
		messages: map[string][]ingest.Message{
			"s1": {{ToolCalls: []ingest.ToolCall{{Name: "read", Status: ingest.ToolCallCompleted}}}},
		},
	}
	dep := newFakeDep(map[string]ingest.Adapter{"src-1": adapter}, sessions)

	from := now.AddDate(0, 0, -1).UnixMilli()
	to := now.Add(time.Hour).UnixMilli()

	var resp analyticsResponse
	doJSON(t, NewHandler(dep), http.MethodGet,
		"/_/api/analytics?from="+itoa(from)+"&to="+itoa(to), nil, http.StatusOK, &resp)
	if len(resp.Daily) != 1 {
		t.Fatalf("expected 1 daily entry, got %+v", resp.Daily)
	}
	if resp.Daily[0].Reads != 1 || resp.Daily[0].Sessions != 1 {
		t.Errorf("unexpected aggregation: %+v", resp.Daily[0])
	}

	// A window with no sessions returns an empty, non-nil daily list.
	emptyFrom := now.Add(-10 * 24 * time.Hour).UnixMilli()
	emptyTo := now.Add(-9 * 24 * time.Hour).UnixMilli()
	resp = analyticsResponse{}
	doJSON(t, NewHandler(dep), http.MethodGet,
		"/_/api/analytics?from="+itoa(emptyFrom)+"&to="+itoa(emptyTo), nil, http.StatusOK, &resp)
	if len(resp.Daily) != 0 {
		t.Fatalf("expected no daily entries, got %+v", resp.Daily)
	}
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}
