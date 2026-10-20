package opencode_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest/opencode"
)

const v1SchemaDDL = `
	CREATE TABLE project (id text PRIMARY KEY, name text, worktree text);
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
`

const v2SessionMessageDDL = `
	CREATE TABLE session_message (
		id text PRIMARY KEY,
		session_id text NOT NULL,
		type text NOT NULL,
		seq integer NOT NULL,
		time_created integer NOT NULL,
		time_updated integer NOT NULL,
		data text NOT NULL
	);
`

const v2SessionDDL = `
	CREATE TABLE session_v2 (
		id text PRIMARY KEY,
		project_id text NOT NULL,
		parent_id text,
		slug text NOT NULL,
		directory text NOT NULL,
		title text,
		version text NOT NULL,
		agent text,
		model text,
		cost real DEFAULT 0 NOT NULL,
		tokens_input integer DEFAULT 0 NOT NULL,
		tokens_output integer DEFAULT 0 NOT NULL,
		tokens_reasoning integer DEFAULT 0 NOT NULL,
		tokens_cache_read integer DEFAULT 0 NOT NULL,
		tokens_cache_write integer DEFAULT 0 NOT NULL,
		summary_files integer,
		summary_additions integer,
		summary_deletions integer,
		time_created integer NOT NULL,
		time_updated integer NOT NULL
	);
`

// newSchemaFixture creates an empty OpenCode database in a temp directory and
// returns its directory plus an open handle for seeding.
func newSchemaFixture(t *testing.T) (string, *sql.DB) {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "opencode.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		t.Fatal(err)
	}
	return dir, db
}

// TestListSessions_PartialV2SchemaStaysOnV1 guards against OpenCode's migration
// creating session_message before session_v2: a half-built v2 schema must keep
// reading the (frozen) v1 tables instead of failing with "no such table:
// session_v2" on every poll.
func TestListSessions_PartialV2SchemaStaysOnV1(t *testing.T) {
	dir, db := newSchemaFixture(t)
	execFixture(t, db, v1SchemaDDL)
	execFixture(t, db, v2SessionMessageDDL)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_v1', 'p1', 's', '/proj', 'v1 session', 'v', 1000, 1000)`)
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
		t.Fatalf("ListSessions() error = %v, want nil while v2 schema is incomplete", err)
	}
	if len(sessions) != 1 || sessions[0].ID != "ses_v1" {
		t.Fatalf("sessions = %+v, want the v1 session", sessions)
	}
}

// TestListSessions_NoSessionTablesReturnsEmpty covers a fresh database or a
// migration window where neither generation's tables exist: Omnivue should
// report no sessions rather than log a warning every poll cycle.
func TestListSessions_NoSessionTablesReturnsEmpty(t *testing.T) {
	dir, db := newSchemaFixture(t)
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
		t.Fatalf("ListSessions() error = %v, want nil", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("sessions = %+v, want none", sessions)
	}

	ts, err := adapter.LastModified(context.Background())
	if err != nil {
		t.Fatalf("LastModified() error = %v, want nil", err)
	}
	if ts != 0 {
		t.Errorf("LastModified() = %d, want 0", ts)
	}
}

// TestListSessions_PicksUpV2MigrationWithoutRestart ensures the adapter
// re-probes the schema as it reads, so an OpenCode upgrade that lands while the
// server is running is picked up without restarting Omnivue.
func TestListSessions_PicksUpV2MigrationWithoutRestart(t *testing.T) {
	dir, db := newSchemaFixture(t)
	execFixture(t, db, v1SchemaDDL)
	execFixture(t, db, `INSERT INTO project (id, name) VALUES ('p1', 'repo')`)
	execFixture(t, db, `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_v1', 'p1', 's', '/proj', 'v1 session', 'v', 1000, 1000)`)
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
	if len(sessions) != 1 || sessions[0].ID != "ses_v1" {
		t.Fatalf("before migration sessions = %+v, want the v1 session", sessions)
	}

	// Simulate OpenCode finishing its v2 migration while the adapter is open.
	writer, err := sql.Open("sqlite", filepath.Join(dir, "opencode.db"))
	if err != nil {
		t.Fatal(err)
	}
	execFixture(t, writer, v2SessionDDL)
	execFixture(t, writer, v2SessionMessageDDL)
	execFixture(t, writer, `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
		VALUES ('ses_v2', 'p1', 's', '/proj', 'v2 session', '2.0.31', 2000, 2000)`)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	sessions, err = adapter.ListSessions(context.Background())
	if err != nil {
		t.Fatalf("after migration ListSessions() error = %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != "ses_v2" {
		t.Fatalf("after migration sessions = %+v, want the v2 session", sessions)
	}
}
