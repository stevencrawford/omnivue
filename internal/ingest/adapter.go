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

	// Session returns detailed session info including metadata.
	Session(ctx context.Context, id string) (*Session, error)

	// Messages returns the conversation messages for a session.
	Messages(ctx context.Context, sessionID string) ([]Message, error)

	// Plan returns the session plan as markdown.
	Plan(ctx context.Context, sessionID string) (*Plan, error)

	// Diffs returns the file diffs for a session.
	Diffs(ctx context.Context, sessionID string) ([]DiffFile, error)

	// Edits returns the raw edit/write tool call data for a session.
	Edits(ctx context.Context, sessionID string) ([]FileEdit, error)

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

	dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=journal_mode(wal)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database %s: %w", path, err)
	}

	// Limit concurrent connections to prevent WAL conflicts on read-only DBs.
	db.SetMaxOpenConns(1)

	// Enforce read-only at the SQLite layer using a no-op pragma.
	// This is a safety net in case the ?mode=ro driver enforcement is bypassed.
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to enforce read-only mode: %w", err)
	}

	return db, nil
}
