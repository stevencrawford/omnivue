package store_test

import (
	"os"
	"testing"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/store"
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
