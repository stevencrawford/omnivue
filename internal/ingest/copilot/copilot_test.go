package copilot_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/sess/internal/ingest/copilot"
)

func getCopilotPath(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot determine home directory")
	}
	path := filepath.Join(home, ".copilot")
	if _, err := os.Stat(filepath.Join(path, "session-store.db")); err != nil {
		t.Skip("Copilot database not found, skipping integration test")
	}
	return path
}

func TestAdapter_ListSessions(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
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
	if s.Directory == "" {
		t.Error("session directory is empty")
	}
	if s.CreatedAt.IsZero() {
		t.Error("session created_at is zero")
	}

	t.Logf("Found %d sessions, first: %q (repo: %s, branch: %s)", len(sessions), s.Title, s.Repository, s.Branch)
}

func TestAdapter_GetSession(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	session, err := adapter.GetSession(context.Background(), sessions[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	if session.ID != sessions[0].ID {
		t.Errorf("expected session ID %s, got %s", sessions[0].ID, session.ID)
	}
	t.Logf("Session: %q (dir: %s, files: %d, msgs: %d)", session.Title, session.Directory, session.DiffFiles, session.MessageCount)
}

func TestAdapter_GetMessages(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	var sessionID string
	for _, s := range sessions {
		if s.Title != "" && s.Title != filepath.Base(s.Directory) {
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
		if i >= 5 {
			break
		}
		contentPreview := m.Content
		if len(contentPreview) > 100 {
			contentPreview = contentPreview[:100] + "..."
		}
		t.Logf("  [%s] %s (tools: %d)", m.Role, contentPreview, len(m.ToolCalls))
	}
}

func TestAdapter_GetPlan(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil || len(sessions) == 0 {
		t.Skip("no sessions available")
	}

	for _, s := range sessions {
		plan, err := adapter.GetPlan(context.Background(), s.ID)
		if err != nil {
			t.Fatal(err)
		}
		if plan != nil && plan.Markdown != "" {
			t.Logf("Session %s has plan (source: %s, %d bytes)", s.ID, plan.Source, len(plan.Markdown))
			preview := plan.Markdown
			if len(preview) > 200 {
				preview = preview[:200] + "..."
			}
			t.Logf("  %s", preview)
			return
		}
	}
	t.Log("No sessions with plans found")
}

func TestAdapter_GetEdits(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
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
				if i >= 5 {
					break
				}
				t.Logf("  [%s] %s (oldLen=%d, newLen=%d)", e.ToolName, e.FilePath, len(e.OldStr), len(e.NewStr))
			}
			return
		}
	}
	t.Log("No sessions with file edits found")
}

func TestAdapter_GetDiffs(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
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
				t.Logf("  [%s] %s", d.Status, d.Path)
				if i >= 5 {
					break
				}
			}
			return
		}
	}
	t.Log("No sessions with file changes found")
}

func TestAdapter_LastModified(t *testing.T) {
	path := getCopilotPath(t)
	adapter, err := copilot.New(path)
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
