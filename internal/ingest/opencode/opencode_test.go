package opencode_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/sess/internal/ingest/opencode"
)

func getOpenCodePath(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot determine home directory")
	}
	path := filepath.Join(home, ".local", "share", "opencode")
	if _, err := os.Stat(filepath.Join(path, "opencode.db")); err != nil {
		t.Skip("OpenCode database not found, skipping integration test")
	}
	return path
}

func TestAdapter_ListSessions(t *testing.T) {
	path := getOpenCodePath(t)
	adapter, err := opencode.New(path)
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

	// Verify first session has required fields
	s := sessions[0]
	if s.ID == "" {
		t.Error("session ID is empty")
	}
	if s.Title == "" {
		t.Log("warning: session title is empty (may be normal for recent sessions)")
	}
	if s.Directory == "" {
		t.Error("session directory is empty")
	}
	if s.CreatedAt.IsZero() {
		t.Error("session created_at is zero")
	}

	t.Logf("Found %d sessions, first: %q (repo: %s, model: %s)", len(sessions), s.Title, s.Repository, s.Model)
}

func TestAdapter_GetMessages(t *testing.T) {
	path := getOpenCodePath(t)
	adapter, err := opencode.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	// Find a session with content
	var sessionID string
	for _, s := range sessions {
		if s.Title != "" {
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

	t.Logf("Session %s has %d messages", sessionID, len(messages))
	for i, m := range messages {
		if i >= 3 {
			break
		}
		contentPreview := m.Content
		if len(contentPreview) > 100 {
			contentPreview = contentPreview[:100] + "..."
		}
		t.Logf("  [%s] %s (tools: %d)", m.Role, contentPreview, len(m.ToolCalls))
	}
}

func TestAdapter_LastModified(t *testing.T) {
	path := getOpenCodePath(t)
	adapter, err := opencode.New(path)
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
