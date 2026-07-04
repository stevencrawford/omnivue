package store_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

func TestNew_CreatesDatabase(t *testing.T) {
	// Use temp XDG_STATE_HOME
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if s.Path() == "" {
		t.Fatal("expected non-empty path")
	}

	// Verify database file exists
	if _, err := os.Stat(s.Path()); err != nil {
		t.Fatalf("database file not created: %v", err)
	}
}

func TestStore_SourceCRUD(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Add a source
	src := ingest.Source{
		ID:        "src-1",
		Path:      "/home/user/.local/share/opencode",
		AgentType: ingest.AgentOpenCode,
		Label:     "OpenCode",
		Enabled:   true,
		CreatedAt: time.Now(),
	}
	if err := s.AddSource(src); err != nil {
		t.Fatal(err)
	}

	// List sources
	sources, err := s.ListSources()
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 {
		t.Fatalf("expected 1 source, got %d", len(sources))
	}
	if sources[0].ID != "src-1" {
		t.Errorf("expected id 'src-1', got %q", sources[0].ID)
	}
	if sources[0].AgentType != ingest.AgentOpenCode {
		t.Errorf("expected agent type 'opencode', got %q", sources[0].AgentType)
	}

	// Remove source
	if err := s.RemoveSource("src-1"); err != nil {
		t.Fatal(err)
	}
	sources, err = s.ListSources()
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 0 {
		t.Fatalf("expected 0 sources after removal, got %d", len(sources))
	}
}

func TestStore_SearchIndex(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Index some content
	err = s.IndexSession("ses-1", "src-1", "message", "org/repo", "implementing a new feature for user authentication")
	if err != nil {
		t.Fatal(err)
	}
	err = s.IndexSession("ses-1", "src-1", "tool_call", "org/repo", "grep -r 'auth' src/")
	if err != nil {
		t.Fatal(err)
	}
	err = s.IndexSession("ses-2", "src-1", "message", "org/other", "refactoring the database layer")
	if err != nil {
		t.Fatal(err)
	}

	// Search
	results, err := s.Search("authentication", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for 'authentication', got %d", len(results))
	}
	if results[0].SessionID != "ses-1" {
		t.Errorf("expected session 'ses-1', got %q", results[0].SessionID)
	}

	// Search across sessions
	results, err = s.Search("auth*", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) < 1 {
		t.Fatal("expected at least 1 result for 'auth*'")
	}
}

func TestStore_Folders(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Now()
	err = s.CreateFolder(store.Folder{
		ID:        "f-1",
		Name:      "Project Alpha",
		SortOrder: 0,
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}

	folders, err := s.ListFolders()
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 1 {
		t.Fatalf("expected 1 folder, got %d", len(folders))
	}
	if folders[0].Name != "Project Alpha" {
		t.Errorf("expected name 'Project Alpha', got %q", folders[0].Name)
	}

	// Assign a session
	err = s.AssignSession("f-1", "ses-1")
	if err != nil {
		t.Fatal(err)
	}

	// Unassign
	err = s.UnassignSession("f-1", "ses-1")
	if err != nil {
		t.Fatal(err)
	}
}

func TestMigrate_FreshInstall(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 1 {
		t.Fatalf("expected schema version 1 on fresh install, got %d", v)
	}
}

func TestMigrate_LegacyDatabaseIsBaselined(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	// Build the state dir + db path exactly as store.New would.
	stateDir := filepath.Join(tmpDir, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(stateDir, "omnivue.db")

	// Create a pre-versioning database: application tables present, no
	// schema_migrations table, plus a user-owned row we expect to survive.
	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
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
	`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	// Open via store.New(): should run the baseline, stamp version 1, and
	// preserve the existing row.
	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	v, err := s.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v != 1 {
		t.Fatalf("expected legacy db stamped to version 1, got %d", v)
	}

	sources, err := s.ListSources()
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0].ID != "legacy-src" {
		t.Fatalf("expected legacy source preserved, got %+v", sources)
	}
}

func TestMigrate_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s1, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	v1, err := s1.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v1 != 1 {
		t.Fatalf("expected version 1 after first open, got %d", v1)
	}
	s1.Close()

	// Second open must not re-run migrations and must report the same version.
	s2, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	v2, err := s2.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v2 != 1 {
		t.Fatalf("expected version 1 after second open, got %d", v2)
	}
}
