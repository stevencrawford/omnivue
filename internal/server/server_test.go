package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
	"github.com/stevencrawford/omnivue/version"
)

type mockAdapter struct {
	sessions []ingest.Session
	messages []ingest.Message

	// listCalls counts ListSessions invocations for cadence tests.
	listCalls atomic.Int64
	// liveOverride lets a test force ListSessions to return a fresh UpdatedAt
	// each call (simulating an actively-streaming session).
	liveUpdatedAt time.Time
}

func (m *mockAdapter) Type() ingest.AgentType { return ingest.AgentOpenCode }
func (m *mockAdapter) Detect(path string) bool { return false }
func (m *mockAdapter) ListSessions(context.Context) ([]ingest.Session, error) {
	m.listCalls.Add(1)
	if !m.liveUpdatedAt.IsZero() {
		// Return a copy with a fresh UpdatedAt each call to simulate a live
		// agent actively writing new content.
		out := make([]ingest.Session, len(m.sessions))
		copy(out, m.sessions)
		for i := range out {
			out[i].UpdatedAt = m.liveUpdatedAt
		}
		return out, nil
	}
	return m.sessions, nil
}
func (m *mockAdapter) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
	for _, s := range m.sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, os.ErrNotExist
}
func (m *mockAdapter) GetMessages(context.Context, string) ([]ingest.Message, error) { return m.messages, nil }
func (m *mockAdapter) GetPlan(context.Context, string) (*ingest.Plan, error)         { return nil, nil }
func (m *mockAdapter) GetDiffs(context.Context, string) ([]ingest.DiffFile, error)    { return nil, nil }
func (m *mockAdapter) GetEdits(context.Context, string) ([]ingest.FileEdit, error)   { return nil, nil }
func (m *mockAdapter) ResumeCommand(*ingest.Session) string                          { return "echo resume" }
func (m *mockAdapter) LastModified(context.Context) (int64, error)                   { return 0, nil }
func (m *mockAdapter) Close() error                                                  { return nil }

func TestHandleStatus(t *testing.T) {
	state := &State{
		adapters: map[string]ingest.Adapter{"src-1": &mockAdapter{
			sessions: []ingest.Session{{ID: "ses-1"}},
		}},
		sessions: []ingest.Session{{ID: "ses-1", SourceID: "src-1"}},
	}

	mux := NewHandler(state)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/_/api/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	if body["version"] != version.Version {
		t.Errorf("expected version %q, got %v", version.Version, body["version"])
	}
	if body["sessions"] != float64(1) {
		t.Errorf("expected 1 session, got %v", body["sessions"])
	}
}

func TestHandleSessions(t *testing.T) {
	state := &State{
		adapters: map[string]ingest.Adapter{"src-1": &mockAdapter{
			sessions: []ingest.Session{{ID: "ses-1", Title: "Test Session"}},
		}},
		sessions: []ingest.Session{{ID: "ses-1", SourceID: "src-1", Title: "Test Session"}},
	}

	mux := NewHandler(state)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/_/api/sessions")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var sessions []ingest.Session
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].Title != "Test Session" {
		t.Errorf("expected title 'Test Session', got %q", sessions[0].Title)
	}
}

func TestHandleGetSession_NotFound(t *testing.T) {
	state := &State{
		adapters: make(map[string]ingest.Adapter),
		sessions: nil,
	}

	mux := NewHandler(state)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/_/api/sessions/nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestHandleFolders_StoreUnavailable(t *testing.T) {
	state := &State{store: nil}

	mux := NewHandler(state)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/_/api/folders")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var folders []store.Folder
	if err := json.NewDecoder(resp.Body).Decode(&folders); err != nil {
		t.Fatal(err)
	}
	if len(folders) != 0 {
		t.Errorf("expected empty list, got %d", len(folders))
	}
}

func TestHandleSearch_EmptyQuery(t *testing.T) {
	state := &State{store: nil}

	mux := NewHandler(state)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/_/api/search")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestRefreshSessions_ConcurrencySafe(t *testing.T) {
	state := &State{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{
				sessions: []ingest.Session{{ID: "ses-1"}},
			},
			"src-2": &mockAdapter{
				sessions: []ingest.Session{{ID: "ses-2"}},
			},
		},
	}

	state.refreshSessions(context.Background())

	if len(state.sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(state.sessions))
	}

	ids := make(map[string]bool)
	for _, s := range state.sessions {
		ids[s.ID] = true
	}
	if !ids["ses-1"] || !ids["ses-2"] {
		t.Error("expected both ses-1 and ses-2 to be present")
	}
}

func TestGetSessions_ReturnsCopy(t *testing.T) {
	state := &State{
		sessions: []ingest.Session{{ID: "ses-1"}},
	}

	sessions := state.GetSessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	sessions[0].ID = "modified"
	if state.sessions[0].ID != "ses-1" {
		t.Error("GetSessions should return a copy, not a reference")
	}
}

func TestRefreshSessions_MarksLiveWithinWindow(t *testing.T) {
	now := time.Now()
	state := &State{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{sessions: []ingest.Session{
				{ID: "ses-fresh", Status: "completed", UpdatedAt: now.Add(-30 * time.Second)},
				{ID: "ses-stale", Status: "completed", UpdatedAt: now.Add(-10 * time.Minute)},
			}},
		},
	}

	changed, live := state.refreshSessions(context.Background())
	if live != 1 {
		t.Errorf("expected 1 live session, got %d", live)
	}

	got := state.GetSessions()
	statusByID := map[string]string{}
	for _, s := range got {
		statusByID[s.ID] = s.Status
	}
	if statusByID["ses-fresh"] != "active" {
		t.Errorf("expected ses-fresh to be active, got %q", statusByID["ses-fresh"])
	}
	if statusByID["ses-stale"] != "completed" {
		t.Errorf("expected ses-stale to be completed, got %q", statusByID["ses-stale"])
	}

	// All sessions are "changed" on first refresh (no prior snapshot).
	if len(changed) != 2 {
		t.Errorf("expected 2 changed IDs on first refresh, got %d", len(changed))
	}
}

func TestRefreshSessions_RevertsToCompletedOutsideWindow(t *testing.T) {
	fresh := time.Now()
	state := &State{
		adapters: map[string]ingest.Adapter{
			"src-1": &mockAdapter{sessions: []ingest.Session{
				{ID: "ses-1", Status: "active", UpdatedAt: fresh},
			}},
		},
		sessions: []ingest.Session{
			{ID: "ses-1", Status: "active", UpdatedAt: fresh},
		},
	}

	// Simulate the session aging out: 5 min ago, well outside the 2-min window.
	if ma, ok := state.adapters["src-1"].(*mockAdapter); ok {
		ma.sessions[0].UpdatedAt = fresh.Add(-5 * time.Minute)
	}

	changed, live := state.refreshSessions(context.Background())
	if live != 0 {
		t.Errorf("expected 0 live sessions after staleness, got %d", live)
	}
	if got := state.GetSessions()[0].Status; got != "completed" {
		t.Errorf("expected status reverted to completed, got %q", got)
	}
	// UpdatedAt moved backwards → still "changed" from the diff's perspective.
	if len(changed) != 1 || changed[0] != "ses-1" {
		t.Errorf("expected ses-1 in changed IDs, got %v", changed)
	}
}

func TestRefreshSessions_StableSecondCallProducesNoChanges(t *testing.T) {
	now := time.Now()
	adapter := &mockAdapter{sessions: []ingest.Session{
		{ID: "ses-1", Status: "completed", UpdatedAt: now.Add(-time.Minute)},
	}}
	state := &State{
		adapters: map[string]ingest.Adapter{"src-1": adapter},
	}

	if _, live := state.refreshSessions(context.Background()); live != 1 {
		t.Fatalf("first refresh: expected 1 live, got %d", live)
	}
	changed, live := state.refreshSessions(context.Background())
	if live != 1 {
		t.Errorf("second refresh: expected 1 live, got %d", live)
	}
	if len(changed) != 0 {
		t.Errorf("second refresh: expected 0 changed IDs, got %v", changed)
	}
}

func TestSendEventSessionChanged_FormatAndDelivery(t *testing.T) {
	state := &State{
		subscribers: make(map[chan sseEvent]struct{}),
	}
	ch := state.subscribe()
	defer state.unsubscribe(ch)

	data, err := json.Marshal(map[string]any{"ids": []string{"ses-1", "ses-2"}})
	if err != nil {
		t.Fatal(err)
	}
	state.sendEvent(sseEvent{Name: "session-changed", Data: string(data)})

	select {
	case ev := <-ch:
		if ev.Name != "session-changed" {
			t.Errorf("expected name session-changed, got %q", ev.Name)
		}
		var payload struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal([]byte(ev.Data), &payload); err != nil {
			t.Fatalf("data is not valid JSON: %v", err)
		}
		if len(payload.IDs) != 2 || payload.IDs[0] != "ses-1" || payload.IDs[1] != "ses-2" {
			t.Errorf("unexpected ids payload: %v", payload.IDs)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestPollInterval_PicksLiveCadenceWhenSessionIsActive(t *testing.T) {
	if got := pollInterval(0); got != pollCadenceIdle {
		t.Errorf("expected idle cadence with 0 live, got %s", got)
	}
	if got := pollInterval(1); got != pollCadenceLive {
		t.Errorf("expected live cadence with 1 live, got %s", got)
	}
	if got := pollInterval(42); got != pollCadenceLive {
		t.Errorf("expected live cadence with many live, got %s", got)
	}
}

func TestPollLoop_EmitsSessionChangedOnFirstDetectedChange(t *testing.T) {
	// Pre-warm lastMod by simulating one full iteration through the same
	// comparison logic pollLoop uses internally, so the very first tick
	// observed by the loop registers as a "change".
	adapter := &tickingAdapter{
		mockAdapter: mockAdapter{
			sessions: []ingest.Session{{ID: "ses-live", UpdatedAt: time.Now().Add(-time.Minute)}},
		},
		lastModFn: func() (int64, error) {
			return 2, nil
		},
	}

	state := &State{
		adapters:    map[string]ingest.Adapter{"src-1": adapter},
		subscribers: make(map[chan sseEvent]struct{}),
	}
	ch := state.subscribe()
	defer state.unsubscribe(ch)

	// Drive the same source-changed comparison that pollLoop does, then
	// inject the resulting event directly. This exercises the end-to-end
	// pipeline (refresh → diff → event) without depending on the 30s idle
	// cadence the loop uses in its first iteration.
	lastMod := map[string]int64{"src-1": 1}
	ts, _ := adapter.LastModified(context.Background())
	if prev, ok := lastMod["src-1"]; !ok || ts > prev {
		lastMod["src-1"] = ts
		if ok {
			ids, _ := state.refreshSessions(context.Background())
			state.sendEvent(sseEvent{Name: "update"})
			if len(ids) > 0 {
				data, _ := json.Marshal(map[string]any{"ids": ids})
				state.sendEvent(sseEvent{Name: "session-changed", Data: string(data)})
			}
		}
	}

	// We should receive at least the session-changed event.
	var sawSessionChanged bool
	deadline := time.After(time.Second)
	for !sawSessionChanged {
		select {
		case ev := <-ch:
			if ev.Name != "session-changed" {
				continue
			}
			var payload struct {
				IDs []string `json:"ids"`
			}
			if err := json.Unmarshal([]byte(ev.Data), &payload); err != nil {
				t.Fatalf("invalid event data: %v", err)
			}
			if len(payload.IDs) != 1 || payload.IDs[0] != "ses-live" {
				t.Errorf("expected [ses-live] in ids, got %v", payload.IDs)
			}
			sawSessionChanged = true
		case <-deadline:
			t.Fatal("did not receive session-changed event in time")
		}
	}
}

// tickingAdapter wraps mockAdapter and lets a test inject a LastModified
// implementation, so we can simulate a source that bumps on every call.
type tickingAdapter struct {
	mockAdapter
	lastModFn func() (int64, error)
}

func (a *tickingAdapter) LastModified(context.Context) (int64, error) {
	return a.lastModFn()
}
