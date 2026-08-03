package copilot

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// createSessionStoreDB creates a valid session-store.db that has no sessions
// table, exercising the empty-DB fallback path in ListSessions.
func createSessionStoreDB(t *testing.T, dir string) {
	t.Helper()
	dbPath := filepath.Join(dir, "session-store.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeSessionFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestListSessions_SessionStateOnlyWhenEmptyDB(t *testing.T) {
	dir := t.TempDir()
	createSessionStoreDB(t, dir)
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"user.message","data":{"content":"hello"}}`,
		`{"type":"assistant.message","data":{"content":"hi","messageId":"m1"}}`,
	})

	adapter, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session from session-state, got %d", len(sessions))
	}
	if sessions[0].ID != "sess-1" {
		t.Errorf("expected session ID sess-1, got %s", sessions[0].ID)
	}
	if sessions[0].MessageCount != 2 {
		t.Errorf("expected message count 2, got %d", sessions[0].MessageCount)
	}
}

func TestListSessions_ResearchReports(t *testing.T) {
	dir := t.TempDir()
	createSessionStoreDB(t, dir)
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"user.message","data":{"content":"research this"}}`,
		`{"type":"assistant.message","data":{"content":"ok","messageId":"m1"}}`,
	})
	writeSessionFile(t, filepath.Join(dir, "session-state", "sess-1", "research", "report.md"),
		"# Auth Design\n\nInvestigated the auth flow.\n")

	adapter, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	var report *ingest.Session
	for i := range sessions {
		if sessions[i].ParentID == "sess-1" {
			report = &sessions[i]
			break
		}
	}
	if report == nil {
		t.Fatalf("expected research report child session, got %d sessions", len(sessions))
	}
	if report.SubAgent != "research" {
		t.Errorf("expected SubAgent research, got %q", report.SubAgent)
	}
	if report.Title != "Auth Design" {
		t.Errorf("expected title from H1, got %q", report.Title)
	}
	if report.MessageCount != 1 {
		t.Errorf("expected MessageCount 1, got %d", report.MessageCount)
	}

	msgs, err := adapter.Messages(context.Background(), report.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if !strings.Contains(msgs[0].Content, "Investigated the auth flow.") {
		t.Errorf("expected report body in message content")
	}
}

func TestListSessions_CacheHitIncludesSynthetic(t *testing.T) {
	dir := t.TempDir()
	createSessionStoreDB(t, dir)
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"user.message","data":{"content":"hello"}}`,
	})

	adapter, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	// Simulate a synthetic session created after the cache was populated.
	adapter.mu.Lock()
	adapter.syntheticSessions["sess-1-sub-tool-1"] = &syntheticSession{
		session: ingest.Session{
			ID:           "sess-1-sub-tool-1",
			ParentID:     "sess-1",
			Agent:        ingest.AgentCopilot,
			SubAgent:     "code-review",
			Title:        "Code Review",
			MessageCount: 2,
		},
	}
	adapter.mu.Unlock()

	sessions, err = adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, s := range sessions {
		if s.ID == "sess-1-sub-tool-1" {
			found = true
		}
	}
	if !found {
		t.Error("expected synthetic session to appear on cache-hit path")
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions with no duplicates, got %d", len(sessions))
	}
}

func TestMessagesFromEvents_SubAgentMessageCount(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"user.message","data":{"content":"do it"},"id":"u1","timestamp":"2025-01-01T00:00:00Z"}`,
		`{"type":"assistant.message","data":{"content":"","messageId":"a1","toolRequests":[{"toolCallId":"tool-1","name":"delegate","arguments":{}}]},"id":"e2","timestamp":"2025-01-01T00:00:01Z"}`,
		`{"type":"subagent.started","data":{"toolCallId":"tool-1","agentName":"code-review","agentDisplayName":"Code Review"}}`,
		`{"type":"user.message","data":{"content":"sub user"},"id":"u2","timestamp":"2025-01-01T00:00:02Z"}`,
		`{"type":"assistant.message","data":{"content":"sub reply","messageId":"a2"},"id":"e4","timestamp":"2025-01-01T00:00:03Z"}`,
		`{"type":"subagent.completed","data":{},"id":"e5"}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}

	if _, err := a.messagesFromEvents("sess-1"); err != nil {
		t.Fatal(err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.syntheticSessions) != 1 {
		t.Fatalf("expected 1 synthetic session, got %d", len(a.syntheticSessions))
	}
	for _, syn := range a.syntheticSessions {
		if syn.session.MessageCount != 2 {
			t.Errorf("expected MessageCount 2, got %d", syn.session.MessageCount)
		}
		if syn.session.ParentID != "sess-1" {
			t.Errorf("expected ParentID sess-1, got %q", syn.session.ParentID)
		}
	}
}

func TestMessagesFromEvents_SubAgentFailedReleasesStack(t *testing.T) {
	dir := t.TempDir()
	writeEventsJSONL(t, dir, "sess-1", []string{
		`{"type":"user.message","data":{"content":"do it"},"id":"u1","timestamp":"2025-01-01T00:00:00Z"}`,
		`{"type":"assistant.message","data":{"content":"","messageId":"a1","toolRequests":[{"toolCallId":"tool-1","name":"delegate","arguments":{}}]},"id":"e2","timestamp":"2025-01-01T00:00:01Z"}`,
		`{"type":"subagent.started","data":{"toolCallId":"tool-1","agentName":"sidekick","agentDisplayName":"Sidekick"}}`,
		`{"type":"subagent.failed","data":{"toolCallId":"tool-1","error":"No response generated"},"id":"e4"}`,
		`{"type":"user.message","data":{"content":"main user follow-up"},"id":"u3","timestamp":"2025-01-01T00:00:04Z"}`,
		`{"type":"assistant.message","data":{"content":"main assistant reply","messageId":"a2"},"id":"e6","timestamp":"2025-01-01T00:00:05Z"}`,
	})
	a := &Adapter{basePath: dir, syntheticSessions: make(map[string]*syntheticSession)}

	messages, err := a.messagesFromEvents("sess-1")
	if err != nil {
		t.Fatal(err)
	}

	if len(messages) != 4 {
		t.Fatalf("expected 4 messages after failed subagent, got %d", len(messages))
	}
	if got := messages[3].Content; got != "main assistant reply" {
		t.Errorf("expected last message content %q, got %q", "main assistant reply", got)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.syntheticSessions) != 0 {
		t.Errorf("expected no synthetic session for a failed subagent, got %d", len(a.syntheticSessions))
	}
}
