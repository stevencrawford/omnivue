package cursor_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
	gocursor "github.com/stevencrawford/omnivue/internal/ingest/cursor"
)

var (
	testAdapter *gocursor.Adapter
	testSessions []ingest.Session
)

func TestMain(m *testing.M) {
	path := findCursorDB()
	if path != "" {
		a, err := gocursor.New(path)
		if err == nil {
			testAdapter = a
			testSessions, err = a.ListSessions(context.Background())
			if err != nil {
				testAdapter.Close()
				testAdapter = nil
			}
		}
	}
	os.Exit(m.Run())
}

func findCursorDB() string {
	candidates := []string{
		filepath.Join(os.Getenv("HOME"), ".cursor", "User", "globalStorage", "state.vscdb"),
		filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
		filepath.Join(os.Getenv("HOME"), ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
	}
	if p := os.Getenv("SESS_CURSOR_DB"); p != "" {
		candidates = append([]string{p}, candidates...)
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil { //nolint:gosec // test helper, path from env
			return p
		}
	}
	return ""
}

func adapterForTest(t *testing.T) *gocursor.Adapter {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping cursor integration test in short mode")
	}
	if testAdapter != nil {
		return testAdapter
	}
	path := findCursorDB()
	if path == "" {
		t.Skip("Cursor state.vscdb not found, skipping integration test")
	}
	a, err := gocursor.New(path)
	if err != nil {
		t.Fatalf("failed to create cursor adapter: %v", err)
	}
	t.Cleanup(func() { a.Close() })
	return a
}

func TestAdapter_ListSessions(t *testing.T) {
	adapterForTest(t)

	if len(testSessions) == 0 {
		t.Fatal("expected at least one session")
	}

	s := testSessions[0]
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
		len(testSessions), s.Title, s.Repository, s.Model, s.Status)
}

func TestAdapter_SessionOrder(t *testing.T) {
	adapterForTest(t)

	if len(testSessions) < 2 {
		t.Skip("need at least 2 sessions to test ordering")
	}

	for i := 1; i < len(testSessions); i++ {
		if testSessions[i].UpdatedAt.After(testSessions[i-1].UpdatedAt) {
			t.Error("sessions not sorted by updated_at descending")
		}
	}

	t.Logf("First session: %s (%s)", testSessions[0].ID, testSessions[0].UpdatedAt)
	t.Logf("Last session:  %s (%s)", testSessions[len(testSessions)-1].ID, testSessions[len(testSessions)-1].UpdatedAt)
}

func TestAdapter_GetMessages(t *testing.T) {
	adapter := adapterForTest(t)

	if len(testSessions) == 0 {
		t.Skip("no sessions available")
	}

	var sessionID string
	for _, s := range testSessions {
		if s.MessageCount > 0 {
			sessionID = s.ID
			break
		}
	}
	if sessionID == "" {
		sessionID = testSessions[0].ID
	}

	messages, err := adapter.Messages(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("Session %s has %d messages (%d reported)", sessionID, len(messages), testSessions[0].MessageCount)
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
	adapter := adapterForTest(t)

	plan, err := adapter.Plan(context.Background(), "nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if plan != nil {
		t.Error("expected nil plan for cursor (no-op)")
	}
}

func TestAdapter_GetDiffs(t *testing.T) {
	adapter := adapterForTest(t)

	if len(testSessions) == 0 {
		t.Skip("no sessions available")
	}

	for _, s := range testSessions {
		diffs, err := adapter.Diffs(context.Background(), s.ID)
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
	adapter := adapterForTest(t)

	if len(testSessions) == 0 {
		t.Skip("no sessions available")
	}

	for _, s := range testSessions {
		edits, err := adapter.Edits(context.Background(), s.ID)
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
	adapter := adapterForTest(t)

	if len(testSessions) == 0 {
		t.Skip("no sessions available")
	}

	cmd := adapter.ResumeCommand(&testSessions[0])
	if cmd == "" {
		t.Error("resume command is empty")
	}
	t.Logf("Resume command: %s", cmd)
}

func TestAdapter_LastModified(t *testing.T) {
	adapter := adapterForTest(t)

	ts, err := adapter.LastModified(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ts == 0 {
		t.Error("expected non-zero last modified timestamp")
	}
	t.Logf("Last modified: %d", ts)
}
