package server

import (
	"context"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// SessionReader is the per-session read seam: every by-ID read on a session's
// content flows through it, so the read handlers, the Notifier, and the Indexer
// all cross the same interface instead of pinning the concrete SessionHub. The
// concrete hub satisfies it, and an in-memory fake is used by tests, so the
// reader is testable without any adapter machinery.
type SessionReader interface {
	Session(ctx context.Context, id string) (*ingest.Session, error)
	Messages(ctx context.Context, sessionID string) ([]ingest.Message, error)
	Plan(ctx context.Context, sessionID string) (*ingest.Plan, error)
	Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error)
	Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error)
	ResumeCommand(ctx context.Context, sessionID string) (dir, absolute, relative, agentCommand string, err error)
}

// SessionCatalog is the list-level read seam: patterns that consume the cached
// session list or the title map depend on this rather than the whole hub.
type SessionCatalog interface {
	Sessions() []ingest.Session
	TitleMap() map[string]string
}

// SessionNames is the display-name override seam. Renaming a session mutates
// neither adapters nor the source cache, so it is isolated from the lifecycle
// surface that only the process wiring touches.
type SessionNames interface {
	SetName(sessionID, displayName string) error
	ClearName(sessionID string) error
}

// Compile-time assertions keep the seam honest: if SessionHub ever stops
// satisfying a role, these fail at build time rather than at a call site.
var (
	_ SessionReader  = (*SessionHub)(nil)
	_ SessionCatalog = (*SessionHub)(nil)
	_ SessionNames   = (*SessionHub)(nil)
)
