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
	if v != 2 {
		t.Fatalf("expected legacy db stamped to version 2, got %d", v)
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
	if v != 2 {
		t.Fatalf("expected version 2 on fresh install, got %d", v)
	}

	matches, err := filepath.Glob(filepath.Join(filepath.Dir(s.path), "omnivue.db.premigrate-*.bak"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no backup on fresh install, got %d: %v", len(matches), matches)
	}
}
