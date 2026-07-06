package copilot

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// setupTestSessionDB creates a temporary session.db with WAL journal mode
// (matching realistic SQLite configurations from Copilot) and returns the
// base path and session ID for use by openSessionDB / todoState.
func setupTestSessionDB(t *testing.T) (string, string) {
	t.Helper()
	tmpDir := t.TempDir()
	sessionID := "test-session"

	sessionDir := filepath.Join(tmpDir, "session-state", sessionID)
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(sessionDir, "session.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT)`); err != nil {
		t.Fatal(err)
	}

	return tmpDir, sessionID
}

// execSQL opens session.db, runs all given queries, then closes.
func execSQL(t *testing.T, dbPath string, queries ...string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
}

// sessionDBPath returns the session.db path for a test session.
func sessionDBPath(basePath, sessionID string) string {
	return filepath.Join(basePath, "session-state", sessionID, "session.db")
}

func TestTodoState_FirstCallReturnsTodos(t *testing.T) {
	basePath, sessionID := setupTestSessionDB(t)
	dbPath := sessionDBPath(basePath, sessionID)

	execSQL(t, dbPath,
		`INSERT INTO todos VALUES ('1', 'Task A', '', 'pending')`,
		`INSERT INTO todos VALUES ('2', 'Task B', 'Do B', 'in_progress')`,
		`INSERT INTO todos VALUES ('3', 'Task C', '', 'done')`,
	)

	ts := newTodoState(basePath, sessionID)
	result := ts.synthesizeInput()
	if result == "" {
		t.Fatal("expected non-empty result for first call with data")
	}

	var parsed struct {
		Todos []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed.Todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(parsed.Todos))
	}

	// Verify ordering (by rowid)
	if parsed.Todos[0].ID != "1" || parsed.Todos[1].ID != "2" || parsed.Todos[2].ID != "3" {
		t.Errorf("unexpected ordering: %+v", parsed.Todos)
	}

	// Verify status mapping: "done" → "completed"
	if parsed.Todos[2].Status != "completed" {
		t.Errorf("expected status 'completed' for done item, got %q", parsed.Todos[2].Status)
	}
}

func TestTodoState_NoChangeReturnsEmpty(t *testing.T) {
	basePath, sessionID := setupTestSessionDB(t)
	execSQL(t, sessionDBPath(basePath, sessionID),
		`INSERT INTO todos VALUES ('1', 'Task A', '', 'pending')`,
	)

	ts := newTodoState(basePath, sessionID)

	first := ts.synthesizeInput()
	if first == "" {
		t.Fatal("expected non-empty on first call")
	}

	second := ts.synthesizeInput()
	if second != "" {
		t.Fatal("expected empty on second call (no change)")
	}
}

func TestTodoState_ChangeAfterUpdateReturnsNewState(t *testing.T) {
	basePath, sessionID := setupTestSessionDB(t)
	dbPath := sessionDBPath(basePath, sessionID)

	execSQL(t, dbPath,
		`INSERT INTO todos VALUES ('1', 'Task A', '', 'pending')`,
		`INSERT INTO todos VALUES ('2', 'Task B', '', 'pending')`,
	)

	ts := newTodoState(basePath, sessionID)

	first := ts.synthesizeInput()
	if first == "" {
		t.Fatal("expected non-empty on first call")
	}

	// Update the database
	execSQL(t, dbPath,
		`UPDATE todos SET status = 'done' WHERE id = '1'`,
		`INSERT INTO todos VALUES ('3', 'Task C', '', 'pending')`,
	)

	second := ts.synthesizeInput()
	if second == "" {
		t.Fatal("expected non-empty after DB change")
	}
	if second == first {
		t.Fatal("expected different output after DB change")
	}
}

func TestTodoState_EmptyDBReturnsEmpty(t *testing.T) {
	basePath, sessionID := setupTestSessionDB(t)

	ts := newTodoState(basePath, sessionID)
	result := ts.synthesizeInput()
	if result != "" {
		t.Fatal("expected empty when todos table has no rows")
	}
}

func TestTodoState_NoSessionDBReturnsEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	ts := newTodoState(tmpDir, "nonexistent-session")
	result := ts.synthesizeInput()
	if result != "" {
		t.Fatal("expected empty when session.db doesn't exist")
	}
}

func TestTodoState_OrderPreservedOnMultipleCalls(t *testing.T) {
	basePath, sessionID := setupTestSessionDB(t)
	dbPath := sessionDBPath(basePath, sessionID)

	execSQL(t, dbPath,
		`INSERT INTO todos VALUES ('b', 'Item B', '', 'pending')`,
		`INSERT INTO todos VALUES ('a', 'Item A', '', 'pending')`,
		`INSERT INTO todos VALUES ('c', 'Item C', '', 'pending')`,
	)

	ts := newTodoState(basePath, sessionID)

	first := ts.synthesizeInput()
	if first == "" {
		t.Fatal("expected non-empty")
	}

	// Make a change
	execSQL(t, dbPath, `UPDATE todos SET status = 'done' WHERE id = 'a'`)

	second := ts.synthesizeInput()
	if second == "" {
		t.Fatal("expected non-empty after change")
	}

	var parsed struct {
		Todos []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"todos"`
	}
	if err := json.Unmarshal([]byte(second), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	// Order must be b, a, c (insertion order = rowid order)
	if len(parsed.Todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(parsed.Todos))
	}
	if parsed.Todos[0].ID != "b" || parsed.Todos[1].ID != "a" || parsed.Todos[2].ID != "c" {
		t.Errorf("expected order b, a, c but got %+v", parsed.Todos)
	}
}

func TestTodoState_HashDiffersAcrossSessions(t *testing.T) {
	session1base, session1ID := setupTestSessionDB(t)
	session2base, session2ID := setupTestSessionDB(t)

	// Both have identical data
	for _, p := range []string{
		sessionDBPath(session1base, session1ID),
		sessionDBPath(session2base, session2ID),
	} {
		execSQL(t, p, `INSERT INTO todos VALUES ('1', 'Same', '', 'pending')`)
	}

	ts1 := newTodoState(session1base, session1ID)
	ts2 := newTodoState(session2base, session2ID)

	r1 := ts1.synthesizeInput()
	r2 := ts2.synthesizeInput()
	if r1 != r2 {
		t.Fatal("expected identical todowrite output for identical data")
	}

	// Both should return "" on second call
	if ts1.synthesizeInput() != "" {
		t.Fatal("expected empty on second call for session 1")
	}
	if ts2.synthesizeInput() != "" {
		t.Fatal("expected empty on second call for session 2")
	}
}
