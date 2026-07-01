package cursor_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest/cursor"
)

func getCursorDB(t *testing.T) string {
	t.Helper()

	// Check common locations for state.vscdb
	candidates := []string{
		filepath.Join(os.Getenv("HOME"), ".cursor", "User", "globalStorage", "state.vscdb"),
		filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
		filepath.Join(os.Getenv("HOME"), ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
	}

	// Also check if the path itself might be a state.vscdb
	if p := os.Getenv("SESS_CURSOR_DB"); p != "" {
		candidates = append([]string{p}, candidates...)
	}

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	t.Skip("Cursor state.vscdb not found, skipping integration test")
	return ""
}

func TestAdapter_ListSessions(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if len(sessions) == 0 {
		t.Fatal("expected at least one session")
	}

	s := sessions[0]
	if s.ID == "" {
		t.Error("session ID is empty")
	}
	if s.Agent != "cursor" {
		t.Errorf("expected agent 'cursor', got %q", s.Agent)
	}
	if s.CreatedAt.IsZero() {
		t.Error("session created_at is zero")
	}
	if s.UpdatedAt.IsZero() {
		t.Error("session updated_at is zero")
	}

	t.Logf("Found %d sessions, first: %q (repo: %s, model: %s, status: %s)",
		len(sessions), s.Title, s.Repository, s.Model, s.Status)
}

func TestAdapter_SessionOrder(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if len(sessions) < 2 {
		t.Skip("need at least 2 sessions to test ordering")
	}

	for i := 1; i < len(sessions); i++ {
		if sessions[i].UpdatedAt.After(sessions[i-1].UpdatedAt) {
			t.Error("sessions not sorted by updated_at descending")
		}
	}

	t.Logf("First session: %s (%s)", sessions[0].ID, sessions[0].UpdatedAt)
	t.Logf("Last session:  %s (%s)", sessions[len(sessions)-1].ID, sessions[len(sessions)-1].UpdatedAt)
}

func TestAdapter_GetMessages(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	// Find a session with messages
	var sessionID string
	for _, s := range sessions {
		if s.MessageCount > 0 {
			sessionID = s.ID
			break
		}
	}
	if sessionID == "" {
		sessionID = sessions[0].ID
	}

	messages, err := adapter.GetMessages(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("Session %s has %d messages (%d reported)", sessionID, len(messages), sessions[0].MessageCount)
	for i, m := range messages {
		if i >= 5 {
			break
		}
		contentPreview := m.Content
		if len(contentPreview) > 100 {
			contentPreview = contentPreview[:100] + "..."
		}
		t.Logf("  [%s] %s (tools: %d, privacy: %v)", m.Role, contentPreview, len(m.ToolCalls), m.Metadata["privacy"])
	}
}

func TestAdapter_GetPlan(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	plan, err := adapter.GetPlan(context.Background(), "nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if plan != nil {
		t.Error("expected nil plan for cursor (no-op)")
	}
}

func TestAdapter_GetDiffs(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	for _, s := range sessions {
		diffs, err := adapter.GetDiffs(context.Background(), s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(diffs) > 0 {
			t.Logf("Session %s has %d changed files", s.ID, len(diffs))
			for i, d := range diffs {
				t.Logf("  [%s] %s (patchLen=%d)", d.Status, d.Path, len(d.Patch))
				if i >= 5 {
					break
				}
			}
			return
		}
	}
	t.Log("No sessions with file diffs found")
}

func TestAdapter_GetEdits(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	for _, s := range sessions {
		edits, err := adapter.GetEdits(context.Background(), s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(edits) > 0 {
			t.Logf("Session %s has %d file edits", s.ID, len(edits))
			for i, e := range edits {
				t.Logf("  [%s] %s (oldLen=%d, newLen=%d)", e.ToolName, e.FilePath, len(e.OldStr), len(e.NewStr))
				if i >= 5 {
					break
				}
			}
			return
		}
	}
	t.Log("No sessions with file edits found")
}

func TestAdapter_ResumeCommand(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	cmd := adapter.ResumeCommand(&sessions[0])
	if cmd == "" {
		t.Error("resume command is empty")
	}
	t.Logf("Resume command: %s", cmd)
}

func TestAdapter_LastModified(t *testing.T) {
	path := getCursorDB(t)
	adapter, err := cursor.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	ts, err := adapter.LastModified(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ts == 0 {
		t.Error("expected non-zero last modified timestamp")
	}
	t.Logf("Last modified: %d", ts)
}
