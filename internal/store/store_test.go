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
	results, err = s.Search("auth", 10, "")
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

func TestStore_NotificationCRUD(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Now().UnixMilli()
	n := store.Notification{
		ID:        "n-1",
		SessionID: "ses-1",
		SourceID:  "src-1",
		Kind:      "question",
		Title:     "Asked a question",
		Preview:   "should I refactor?",
		Severity:  "attention",
		Payload:   `{"toolCallId":"tc-1"}`,
		CreatedAt: now,
	}

	// Insert first time -> true
	inserted, err := s.InsertNotification(n, "tc-1")
	if err != nil {
		t.Fatal(err)
	}
	if !inserted {
		t.Fatal("expected first insert to report true")
	}

	// Insert duplicate (same dedup key) -> false, no new row
	inserted2, err := s.InsertNotification(n, "tc-1")
	if err != nil {
		t.Fatal(err)
	}
	if inserted2 {
		t.Fatal("expected duplicate insert to report false")
	}

	// List (all)
	all, err := s.ListNotifications(50, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(all))
	}
	if all[0].ReadAt != nil {
		t.Error("expected unread notification")
	}

	// List unread
	unread, err := s.ListNotifications(50, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 1 {
		t.Fatalf("expected 1 unread, got %d", len(unread))
	}

	// Mark read
	if err := s.MarkNotificationRead("n-1"); err != nil {
		t.Fatal(err)
	}
	unread, err = s.ListNotifications(50, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("expected 0 unread after markRead, got %d", len(unread))
	}

	// Clear all
	if err := s.ClearNotifications(time.Time{}); err != nil {
		t.Fatal(err)
	}
	all, err = s.ListNotifications(50, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatalf("expected 0 after clear, got %d", len(all))
	}
}

func TestStore_NotificationState(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Default for unseen session
	st, err := s.NotificationState("ses-x")
	if err != nil {
		t.Fatal(err)
	}
	if st.LastSeenMessageCount != 0 {
		t.Errorf("expected 0 seen count for unseen session, got %d", st.LastSeenMessageCount)
	}

	// Set state
	if err := s.SetNotificationState("ses-x", 5, time.Now()); err != nil {
		t.Fatal(err)
	}
	st, err = s.NotificationState("ses-x")
	if err != nil {
		t.Fatal(err)
	}
	if st.LastSeenMessageCount != 5 {
		t.Errorf("expected 5 seen count, got %d", st.LastSeenMessageCount)
	}

	// Mark viewed sets first_viewed_at once
	if err := s.MarkSessionViewed("ses-x"); err != nil {
		t.Fatal(err)
	}
	st, err = s.NotificationState("ses-x")
	if err != nil {
		t.Fatal(err)
	}
	if st.FirstViewedAt == nil {
		t.Fatal("expected first_viewed_at to be set")
	}
	first := *st.FirstViewedAt
	// Second view should not overwrite.
	if err := s.MarkSessionViewed("ses-x"); err != nil {
		t.Fatal(err)
	}
	st, err = s.NotificationState("ses-x")
	if err != nil {
		t.Fatal(err)
	}
	if *st.FirstViewedAt != first {
		t.Error("expected first_viewed_at to remain the first value")
	}
}

func TestStore_MarkAllNotificationsRead(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", tmpDir)

	s, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for i, id := range []string{"n-a", "n-b", "n-c"} {
		_, err := s.InsertNotification(store.Notification{
			ID: id, SessionID: "ses-1", SourceID: "src-1", Kind: "question",
			Title: "q", Preview: "p", Severity: "info", CreatedAt: time.Now().UnixMilli() + int64(i),
		}, "tc-"+id)
		if err != nil {
			t.Fatal(err)
		}
	}

	// Mark subset
	if err := s.MarkAllNotificationsRead([]string{"n-a", "n-b"}); err != nil {
		t.Fatal(err)
	}
	unread, err := s.ListNotifications(50, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 1 || unread[0].ID != "n-c" {
		t.Fatalf("expected only n-c unread, got %v", unread)
	}

	// Mark all
	if err := s.MarkAllNotificationsRead(nil); err != nil {
		t.Fatal(err)
	}
	unread, err = s.ListNotifications(50, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("expected 0 unread after mark-all, got %d", len(unread))
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
	if v != 2 {
		t.Fatalf("expected schema version 2 on fresh install, got %d", v)
	}
}

func TestMigrate_LegacyDatabaseIsBaselined(t *testing.T) {
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

	s, err := store.New()
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
	if v1 != 2 {
		t.Fatalf("expected version 2 after first open, got %d", v1)
	}
	s1.Close()

	s2, err := store.New()
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	v2, err := s2.SchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if v2 != 2 {
		t.Fatalf("expected version 2 after second open, got %d", v2)
	}
}
