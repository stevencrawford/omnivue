package store

import (
	"database/sql"
	"errors"
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
		{version: 2, desc: "noop-for-test", up: func(*sql.Tx) error { return nil }},
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

// TestMigrate_FailedMigrationRollsBack stamps a database at v1, then attempts a
// v2 migration whose up returns an error. It asserts that migrate() propagates
// the error, the v2 stamp is NOT recorded (the transaction rolled back), and
// the database is still usable afterwards with the original schema intact.
func TestMigrate_FailedMigrationRollsBack(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	// 1. Bring the database up to v1 with the real migrations.
	s, err := New()
	if err != nil {
		t.Fatal(err)
	}
	s.Close()

	// 2. Swap in a v2 that always fails. A backup is attempted first; that is
	//    expected and fine — the point is that the failed migration does not
	//    leave a v2 stamp behind.
	orig := migrations
	t.Cleanup(func() { migrations = orig })
	boom := errors.New("simulated migration failure")
	migrations = []migration{
		orig[0], // baseline v1
		{version: 2, desc: "always-fails", up: func(*sql.Tx) error { return boom }},
	}

	// 3. Reopen: migrate() should return the wrapped failure.
	s2, err := New()
	if err == nil {
		s2.Close()
		t.Fatal("expected migration to fail, but New() succeeded")
	}
	if !errors.Is(err, boom) {
		t.Fatalf("expected error to wrap %v, got %v", boom, err)
	}

	// 4. Restore the real migrations and reopen: the DB must still be at v1,
	//    proving the failed v2 transaction rolled back (no partial stamp).
	migrations = orig
	s3, err := New()
	if err != nil {
		t.Fatalf("reopen after failed migration: %v", err)
	}
	defer s3.Close()
	v, err := s3.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 1 {
		t.Fatalf("expected version 1 after rolled-back v2, got %d", v)
	}
}
