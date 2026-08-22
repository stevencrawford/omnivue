package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// TestMigrate_PreMigrationBackupOnLegacyDB creates a pre-versioning database
// (application table present, no goose version table) and verifies that
// migrate() takes a pre-migration backup before running the baseline, then
// stamps version 1 and preserves the existing row.
func TestMigrate_PreMigrationBackupOnLegacyDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE sources (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			agent_type TEXT NOT NULL,
			label TEXT,
			enabled INTEGER DEFAULT 1,
			last_scanned_at TEXT,
			created_at TEXT NOT NULL
		);
		INSERT INTO sources (id, path, agent_type, label, enabled, created_at)
		VALUES ('legacy-src', '/legacy/path', 'opencode', 'Legacy', 1, '2024-01-01T00:00:00Z');
	`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected legacy db stamped to version 11, got %d", v)
	}

	// A pre-migration backup must exist (from-version 0, the pre-versioning
	// state) and be non-empty.
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(s.path), "omnivue.db.premigrate-v0-*.bak"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected 1 pre-migration backup, got %d: %v", len(matches), matches)
	}
	info, err := os.Stat(matches[0])
	if err != nil {
		t.Fatalf("stat backup: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("backup file is empty")
	}

	// User data survives the baseline.
	sources, err := s.ListSources()
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].ID != "legacy-src" {
		t.Fatalf("expected legacy source preserved, got %+v", sources)
	}
}

// TestMigrate_NoBackupOnFreshInstall asserts that a fresh install (no
// application tables) is never backed up, since there is nothing to lose.
func TestMigrate_NoBackupOnFreshInstall(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected version 11 on fresh install, got %d", v)
	}

	matches, err := filepath.Glob(filepath.Join(filepath.Dir(s.path), "omnivue.db.premigrate-*.bak"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no backup on fresh install, got %d: %v", len(matches), matches)
	}
}

// TestMigrate_BackfillFileActivity seeds a legacy database with a stale
// index_state row, then verifies that the migrations clear index_state (the
// rebuildable cache) so the next poll re-indexes every session and backfills
// its file_activity rows.
func TestMigrate_BackfillFileActivity(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	// A pre-versioning database with application tables: sources plus a
	// populated search_index/index_state pair, as an existing user would have.
	if _, err := db.Exec(`
		CREATE TABLE sources (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			agent_type TEXT NOT NULL,
			label TEXT,
			enabled INTEGER DEFAULT 1,
			last_scanned_at TEXT,
			created_at TEXT NOT NULL
		);
		CREATE TABLE index_state (
			session_id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			content_hash TEXT NOT NULL
		);
		INSERT INTO sources (id, path, agent_type, label, enabled, created_at)
		VALUES ('legacy-src', '/legacy/path', 'opencode', 'Legacy', 1, '2024-01-01T00:00:00Z');
		INSERT INTO index_state (session_id, source_id, content_hash)
		VALUES ('sess-1', 'src-1', 'deadbeef');
	`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected version 11 after migration, got %d", v)
	}

	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM index_state`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("expected index_state cleared for file-activity backfill, got %d rows", n)
	}

	// User data survives.
	sources, err := s.ListSources()
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].ID != "legacy-src" {
		t.Fatalf("expected legacy source preserved, got %+v", sources)
	}
}

// TestMigrate_ConsolidateFoldersIntoTags seeds a version-5 database containing
// folders, folder_sessions, tags and session_tags, then runs the 0006
// migration and verifies folder memberships were copied onto tags using the
// folder names.
func TestMigrate_ConsolidateFoldersIntoTags(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE folders (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			parent_id TEXT REFERENCES folders(id),
			sort_order INTEGER DEFAULT 0,
			color TEXT,
			icon TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE folder_sessions (
			folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
			session_id TEXT NOT NULL,
			sort_order INTEGER DEFAULT 0,
			added_at TEXT NOT NULL,
			PRIMARY KEY (folder_id, session_id)
		);
		CREATE TABLE tags (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			color TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE session_tags (
			tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			session_id TEXT NOT NULL,
			added_at TEXT NOT NULL,
			PRIMARY KEY (tag_id, session_id)
		);
		INSERT INTO folders (id, name, color, created_at, updated_at) VALUES
			('f-1', 'Frontend', '#3178c6', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
			('f-2', 'Alpha', '#58a6ff', '2024-01-03T00:00:00Z', '2024-01-03T00:00:00Z');
		INSERT INTO folder_sessions (folder_id, session_id, added_at) VALUES
			('f-1', 's-1', '2024-02-01T00:00:00Z'),
			('f-1', 's-2', '2024-02-02T00:00:00Z'),
			('f-2', 's-3', '2024-02-03T00:00:00Z');
	`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected version 11 after migration, got %d", v)
	}

	tags, err := s.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]Tag{}
	for _, tg := range tags {
		byName[tg.Name] = tg
	}
	if _, ok := byName["Frontend"]; !ok {
		t.Fatalf("expected migrated tag 'Frontend', got %+v", byName)
	}
	if _, ok := byName["Alpha"]; !ok {
		t.Fatalf("expected migrated tag 'Alpha', got %+v", byName)
	}

	// f-1 -> 'Frontend' should carry s-1 and s-2.
	members, err := s.TagSessions(byName["Frontend"].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("expected Frontend [s-1 s-2], got %v", members)
	}

	// Folder tables must be dropped.
	if _, err := s.db.Query(`SELECT 1 FROM folders LIMIT 1`); err == nil {
		t.Fatal("expected folders table to be dropped")
	}
	if _, err := s.db.Query(`SELECT 1 FROM folder_sessions LIMIT 1`); err == nil {
		t.Fatal("expected folder_sessions table to be dropped")
	}
}

// TestMigrate_BookmarkKind seeds a version-6 database with a bookmarks table
// (pre-0007 schema, no kind column) containing a row, then runs the migrations
// through 0009 and verifies the schema version advances to 9. The legacy
// bookmark is dropped because its rendered message_index cannot be resolved to
// a stable Position identity.
func TestMigrate_BookmarkKind(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE bookmarks (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			message_index INTEGER NOT NULL,
			tool_call_id TEXT,
			label TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		INSERT INTO bookmarks (id, session_id, message_index, tool_call_id, label, created_at)
		VALUES ('bm-1', 's-1', 3, '', 'Fix sidebar', '2024-01-01T00:00:00Z');
	`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected version 11 after migration, got %d", v)
	}

	bookmarks, err := s.ListBookmarks()
	if err != nil {
		t.Fatal(err)
	}
	if len(bookmarks) != 0 {
		t.Fatalf("expected legacy bookmarks to be dropped, got %d", len(bookmarks))
	}
}

// TestMigrate_BookmarkMessageID seeds a version-6 database with a bookmarks
// table (pre-0007/0008 schema: no kind or message_id columns) containing a
// row, then runs the migrations through 0009 and verifies the schema version
// advances to 9. The legacy bookmark is dropped because its rendered
// message_index cannot be resolved to a stable Position identity.
func TestMigrate_BookmarkMessageID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE bookmarks (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			message_index INTEGER NOT NULL,
			tool_call_id TEXT,
			label TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		INSERT INTO bookmarks (id, session_id, message_index, tool_call_id, label, created_at)
		VALUES ('bm-1', 's-1', 3, 'tc-9', 'Fix sidebar', '2024-01-01T00:00:00Z');
	`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 11 {
		t.Fatalf("expected version 11 after migration, got %d", v)
	}

	bookmarks, err := s.ListBookmarks()
	if err != nil {
		t.Fatal(err)
	}
	if len(bookmarks) != 0 {
		t.Fatalf("expected legacy bookmarks to be dropped, got %d", len(bookmarks))
	}
}
