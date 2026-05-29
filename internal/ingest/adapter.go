package ingest

import (
	"context"
	"database/sql"
	"fmt"
	"os"
)

// Adapter is the interface that session source adapters must implement.
type Adapter interface {
	// Type returns the agent type this adapter handles.
	Type() AgentType

	// Detect returns true if the given path contains session data this adapter can read.
	Detect(path string) bool

	// ListSessions returns all sessions from this source.
	ListSessions(ctx context.Context) ([]Session, error)

	// GetSession returns detailed session info including metadata.
	GetSession(ctx context.Context, id string) (*Session, error)

	// GetMessages returns the conversation messages for a session.
	GetMessages(ctx context.Context, sessionID string) ([]Message, error)

	// GetPlan returns the plan/todo items for a session.
	GetPlan(ctx context.Context, sessionID string) ([]PlanItem, error)

	// GetDiffs returns the file diffs for a session.
	GetDiffs(ctx context.Context, sessionID string) ([]DiffFile, error)

	// ResumeCommand returns the command string to resume a session.
	ResumeCommand(session *Session) string

	// LastModified returns the latest modification time across all sessions (unix ms).
	// Used by the poller to detect changes.
	LastModified(ctx context.Context) (int64, error)

	// Close releases any resources held by the adapter.
	Close() error
}

// OpenReadOnlyDB opens a SQLite database in read-only mode with WAL journal.
// This ensures we never accidentally modify agent data.
func OpenReadOnlyDB(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("database not found: %s: %w", path, err)
	}

	dsn := fmt.Sprintf("file:%s?mode=ro&_journal_mode=wal&_busy_timeout=5000", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database %s: %w", path, err)
	}

	// Verify read-only mode by attempting a write
	_, err = db.Exec("CREATE TABLE _sess_write_test (id INTEGER)")
	if err == nil {
		db.Close()
		return nil, fmt.Errorf("SAFETY VIOLATION: database %s opened in writable mode", path)
	}

	return db, nil
}
