package opencode

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
	_ "modernc.org/sqlite"
)

// TestMessages_StepAttributedUsage exercises the step-attributed token/cost
// back-fill: tool parts emitted between a step-start and step-finish inherit the
// step-finish's token totals and cost.
func TestMessages_StepAttributedUsage(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "opencode.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE message (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		data TEXT NOT NULL,
		time_created INTEGER NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE part (
		id INTEGER PRIMARY KEY,
		message_id TEXT NOT NULL,
		data TEXT NOT NULL,
		time_created INTEGER NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO message VALUES ('m1','sess-1',? ,1000)`,
		`{"role":"assistant"}`); err != nil {
		t.Fatal(err)
	}
	parts := []struct {
		id, ts int
		data   string
	}{
		{1, 1, `{"type":"step-start","snapshot":"s"}`},
		{2, 2, `{"type":"tool","callID":"tc1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"out","time":{"start":1,"end":2001}}}`},
		{3, 3, `{"type":"step-finish","tokens":{"input":100,"output":50,"reasoning":5,"cache":{"read":20,"write":10}},"cost":0.004}`},
	}
	for _, p := range parts {
		if _, err := db.Exec(`INSERT INTO part VALUES (?, 'm1', ?, ?)`, p.id, p.data, p.ts); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	a, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	messages, err := a.Messages(context.Background(), "sess-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}
	if len(messages[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(messages[0].ToolCalls))
	}

	tc := messages[0].ToolCalls[0]
	if tc.Duration != 2000 {
		t.Errorf("duration = %dms, want 2000", tc.Duration)
	}
	if tc.Usage == nil {
		t.Fatal("expected attributed usage on tool call")
	}
	if tc.Usage.Source != ingest.UsageStep {
		t.Errorf("usage source = %q, want %q", tc.Usage.Source, ingest.UsageStep)
	}
	if tc.Usage.Tokens.Input != 100 || tc.Usage.Tokens.Output != 50 || tc.Usage.Tokens.Reasoning != 5 {
		t.Errorf("unexpected token usage: %+v", tc.Usage.Tokens)
	}
	if tc.Usage.Tokens.CacheRead != 20 || tc.Usage.Tokens.CacheWrite != 10 {
		t.Errorf("unexpected cache tokens: %+v", tc.Usage.Tokens)
	}
	if tc.Usage.Cost != 0.004 {
		t.Errorf("cost = %v, want 0.004", tc.Usage.Cost)
	}
}