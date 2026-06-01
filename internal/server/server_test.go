package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/store"
	"github.com/stevencrawford/sess/version"
)

type mockAdapter struct {
	sessions []ingest.Session
	messages []ingest.Message
}

func (m *mockAdapter) Type() ingest.AgentType                     { return ingest.AgentOpenCode }
func (m *mockAdapter) Detect(path string) bool                    { return false }
func (m *mockAdapter) ListSessions(context.Context) ([]ingest.Session, error) { return m.sessions, nil }
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

	var body map[string]interface{}
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
