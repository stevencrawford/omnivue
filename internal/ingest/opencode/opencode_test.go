package opencode_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/opencode"
)

func opencodePath(t *testing.T) string {
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

func TestListSessions_OpenStepMarksInProgress(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "opencode.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`
		CREATE TABLE session (
			id text PRIMARY KEY,
			project_id text,
			parent_id text,
			slug text NOT NULL,
			directory text NOT NULL,
			title text NOT NULL,
			version text NOT NULL,
			summary_additions integer,
			summary_deletions integer,
			summary_files integer,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			agent text,
			model text,
			cost real DEFAULT 0 NOT NULL,
			tokens_input integer DEFAULT 0 NOT NULL,
			tokens_output integer DEFAULT 0 NOT NULL,
			tokens_reasoning integer DEFAULT 0 NOT NULL,
			tokens_cache_read integer DEFAULT 0 NOT NULL,
			tokens_cache_write integer DEFAULT 0 NOT NULL
		);
		CREATE TABLE project (id text PRIMARY KEY, name text);
		CREATE TABLE message (
			id text PRIMARY KEY,
			session_id text NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			data text NOT NULL
		);
		CREATE TABLE part (
			id text PRIMARY KEY,
			message_id text NOT NULL,
			session_id text NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			data text NOT NULL
		);
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		t.Fatal(err)
	}

	insert := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	insert(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses-open', 'proj_1', 's', '/proj', 'open', 'v', 1000, 1000)`)
	insert(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses-closed', 'proj_1', 's', '/proj', 'closed', 'v', 1000, 1000)`)
	insert(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses-stale', 'proj_1', 's', '/proj', 'stale', 'v', 1000, 1000)`)
	insert(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m-open', 'ses-open', 1000, 1000, '{}')`)
	insert(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m-closed', 'ses-closed', 1000, 1000, '{}')`)
	// ses-stale: an earlier message with an unmatched step-start, then a later
	// message that closed its step — the session is done, not in progress.
	insert(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m-stale-1', 'ses-stale', 1000, 1000, '{}')`)
	insert(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m-stale-2', 'ses-stale', 2000, 2000, '{}')`)
	// ses-open: step-start + reasoning, no step-finish (model mid-think).
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p1', 'm-open', 'ses-open', 1000, 1000, '{"type":"step-start"}')`)
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p2', 'm-open', 'ses-open', 1001, 1001, '{"type":"reasoning","text":""}')`)
	// ses-closed: a completed step.
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p3', 'm-closed', 'ses-closed', 1000, 1000, '{"type":"step-start"}')`)
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p4', 'm-closed', 'ses-closed', 1002, 1002, '{"type":"step-finish"}')`)
	// ses-stale: first message aborted mid-step, second message completed.
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p5', 'm-stale-1', 'ses-stale', 1000, 1000, '{"type":"step-start"}')`)
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p6', 'm-stale-2', 'ses-stale', 2000, 2000, '{"type":"step-start"}')`)
	insert(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('p7', 'm-stale-2', 'ses-stale', 2001, 2001, '{"type":"step-finish"}')`)

	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ingest.Session{}
	for _, s := range sessions {
		byID[s.ID] = s
	}
	if !byID["ses-open"].InProgress {
		t.Error("ses-open: expected InProgress=true (open step with no finish)")
	}
	if byID["ses-closed"].InProgress {
		t.Error("ses-closed: expected InProgress=false (step finished)")
	}
	if byID["ses-stale"].InProgress {
		t.Error("ses-stale: expected InProgress=false (newest message closed its step)")
	}
}

func TestAdapter_ListSessions(t *testing.T) {
	path := opencodePath(t)
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
	path := opencodePath(t)
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

	messages, err := adapter.Messages(context.Background(), sessionID)
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
	path := opencodePath(t)
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

// TestAdapter_PartUpdateDrivesChangeDetection pins that an in-place write to a
// part (e.g. reasoning streamed while the model is thinking) advances both
// LastModified and the session's UpdatedAt even when the session and message
// timestamps are frozen. Without this, the poller never sees the change, no
// session-changed SSE fires, and an open transcript stays stale for the whole
// thinking phase.
func TestAdapter_PartUpdateDrivesChangeDetection(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "opencode.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`
		CREATE TABLE session (
			id text PRIMARY KEY,
			project_id text NOT NULL,
			parent_id text,
			slug text NOT NULL,
			directory text NOT NULL,
			title text NOT NULL,
			version text NOT NULL,
			summary_additions integer,
			summary_deletions integer,
			summary_files integer,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			agent text,
			model text,
			cost real DEFAULT 0 NOT NULL,
			tokens_input integer DEFAULT 0 NOT NULL,
			tokens_output integer DEFAULT 0 NOT NULL,
			tokens_reasoning integer DEFAULT 0 NOT NULL,
			tokens_cache_read integer DEFAULT 0 NOT NULL,
			tokens_cache_write integer DEFAULT 0 NOT NULL
		);
		CREATE TABLE project (id text PRIMARY KEY, name text);
		CREATE TABLE message (
			id text PRIMARY KEY,
			session_id text NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			data text NOT NULL
		);
		CREATE TABLE part (
			id text PRIMARY KEY,
			message_id text NOT NULL,
			session_id text NOT NULL,
			time_created integer NOT NULL,
			time_updated integer NOT NULL,
			data text NOT NULL
		);
	`); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		t.Fatal(err)
	}

	const (
		frozen = int64(1000000)
		partTU = int64(2000000)
	)
	if _, err := db.Exec(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_1', 'proj_1', 's', '/proj', 'title', 'v', ?, ?)`, frozen, frozen); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_1', 'ses_1', ?, ?, '{}')`, frozen, frozen); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_1', 'msg_1', 'ses_1', ?, ?, '{"type":"reasoning","text":"thinking..."}')`, frozen, partTU); err != nil {
		t.Fatal(err)
	}

	adapter, err := opencode.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	ts, err := adapter.LastModified(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ts != partTU {
		t.Errorf("LastModified() = %d, want %d (in-place part write must be detected)", ts, partTU)
	}

	sessions, err := adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("ListSessions() returned %d sessions, want 1", len(sessions))
	}
	if got := sessions[0].UpdatedAt.UnixMilli(); got != partTU {
		t.Errorf("ListSessions() UpdatedAt = %d, want %d", got, partTU)
	}
}

func TestAdapter_ResumeCommand(t *testing.T) {
	adapter := &opencode.Adapter{}
	spec := adapter.ResumeCommand()

	got := spec.Command("/proj", "abc")
	if want := "cd /proj && opencode -s abc"; got != want {
		t.Errorf("Command() = %q, want %q", got, want)
	}
	if got := spec.CommandNoCD("abc"); got != "opencode -s abc" {
		t.Errorf("CommandNoCD() = %q, want %q", got, "opencode -s abc")
	}
	if got := spec.AgentCommand("abc"); got != "/session abc" {
		t.Errorf("AgentCommand() = %q, want %q", got, "/session abc")
	}
}
