package ingest

import (
	"context"
	"database/sql"
	"fmt"
	"os"
)

// SessionSource is the core interface that every session source adapter
// must implement. It provides session listing, message retrieval, and lifecycle.
type SessionSource interface {
	Type() AgentType
	Detect(path string) bool
	ListSessions(ctx context.Context) ([]Session, error)
	Session(ctx context.Context, id string) (*Session, error)
	Messages(ctx context.Context, sessionID string) ([]Message, error)
	ResumeCommand(session *Session) string
	LastModified(ctx context.Context) (int64, error)
	Close() error
}

// Planner is optionally implemented by adapters that can provide
// structured plan data (checklists, task lists) for their sessions.
type Planner interface {
	Plan(ctx context.Context, sessionID string) (*Plan, error)
}

// Differ is optionally implemented by adapters that can provide
// file-level diff summaries (additions, deletions, patches).
type Differ interface {
	Diffs(ctx context.Context, sessionID string) ([]DiffFile, error)
}

// Editor is optionally implemented by adapters that can provide
// raw edit/write tool call data for granular file change tracking.
type Editor interface {
	Edits(ctx context.Context, sessionID string) ([]FileEdit, error)
}

// Adapter is the combined interface that all session source adapters must
// implement. It includes the core SessionSource plus Planner, Differ,
// and Editor. Adapters that don't support optional features should
// return (nil, nil) from the corresponding methods.
type Adapter interface {
	SessionSource
	Planner
	Differ
	Editor
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

	// Enforce read-only at the SQLite layer using a no-op pragma.
	// This is a safety net in case the ?mode=ro driver enforcement is bypassed.
	// NOTE: Do NOT set SetMaxOpenConns(1) here. Several adapters issue nested
	// queries while a *sql.Rows cursor is open (e.g. copilot ListSessions),
	// and a single-connection pool deadlocks the second query against the
	// held cursor. The mode=ro + query_only pragmas already guarantee no
	// writes; read concurrency is safe under WAL.
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to enforce read-only mode: %w", err)
	}

	return db, nil
}
