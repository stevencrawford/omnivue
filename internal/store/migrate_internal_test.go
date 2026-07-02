package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// TestMigrate_PreMigrationBackupCreated forces a v1->v2 migration on a fresh
// database and verifies migrate() takes a pre-migration backup before applying
// v2. It does not depend on any real future schema change.
func TestMigrate_PreMigrationBackupCreated(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	orig := migrations
	t.Cleanup(func() { migrations = orig })
	migrations = []migration{
		orig[0], // baseline v1
		{version: 2, desc: "noop-for-test", up: func(*sql.DB) error { return nil }},
	}

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
		t.Fatalf("expected version 2, got %d", v)
	}

	matches, err := filepath.Glob(filepath.Join(filepath.Dir(s.path), "omnivue.db.premigrate-v1-*.bak"))
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
}
