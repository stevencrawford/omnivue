package opencode

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
	"github.com/stevencrawford/omnivue/internal/resumecmd"

	_ "modernc.org/sqlite"
)

func init() {
	ingest.Register(ingest.AgentOpenCode, "OpenCode", "~/.local/share/opencode",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := filepath.Join(path, "opencode.db")
	if !ingestkit.PathExists(dbPath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentOpenCode,
		Label:     "OpenCode",
	}
}

func New(basePath string) (*Adapter, error) {
	dbPath := filepath.Join(basePath, "opencode.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opencode adapter: %w", err)
	}
	adapter := &Adapter{db: db, basePath: basePath}
	if _, err := adapter.refreshSchema(context.Background()); err != nil {
		if closeErr := db.Close(); closeErr != nil {
			return nil, fmt.Errorf("opencode adapter: %w (closing after probe: %w)", err, closeErr)
		}
		return nil, fmt.Errorf("opencode adapter: %w", err)
	}
	return adapter, nil
}

// currentSchema re-detects the storage generation before a read. OpenCode
// migrates a live database from the v1 tables to v2 while Omnivue keeps
// polling, and creates the v2 tables one statement at a time, so the
// generation is not fixed at construction. The probe is a single sqlite_master
// lookup, cheap enough to run on every read.
func (a *Adapter) currentSchema(ctx context.Context) schemaKind {
	kind, err := a.refreshSchema(ctx)
	if err != nil {
		// Keep the last known generation when the probe itself fails (for
		// example on a transient lock); the read that follows will surface a
		// real error if one persists.
		return a.cachedSchema()
	}
	return kind
}

// refreshSchema probes the database, caches the result, and returns it.
func (a *Adapter) refreshSchema(ctx context.Context) (schemaKind, error) {
	kind, err := detectSchema(ctx, a.db)
	if err != nil {
		return a.cachedSchema(), err
	}
	a.cacheSchema(kind)
	return kind, nil
}

// detectSchema reports which storage generation the database uses. A database
// is v2 only once both v2 tables exist: OpenCode's migration can create
// session_message before session_v2, and treating that half-built state as v2
// makes every read fail with "no such table: session_v2". v2 databases retain
// a frozen copy of the v1 tables for compatibility, so the presence of the v1
// session table alone is the v1 signal. When neither generation is present
// (fresh database, or migration between dropping and creating tables) the
// result is schemaUnknown and there is simply nothing to read yet.
func detectSchema(ctx context.Context, db *sql.DB) (schemaKind, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name IN ('session', 'session_v2', 'session_message')
	`)
	if err != nil {
		return schemaUnknown, fmt.Errorf("probing schema: %w", err)
	}
	defer rows.Close()

	var hasSession, hasSessionV2, hasSessionMessage bool
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return schemaUnknown, fmt.Errorf("scanning schema probe: %w", err)
		}
		switch name {
		case "session":
			hasSession = true
		case "session_v2":
			hasSessionV2 = true
		case "session_message":
			hasSessionMessage = true
		}
	}
	if err := rows.Err(); err != nil {
		return schemaUnknown, fmt.Errorf("probing schema: %w", err)
	}

	if hasSessionV2 && hasSessionMessage {
		return schemaV2, nil
	}
	if hasSession {
		return schemaV1, nil
	}
	return schemaUnknown, nil
}

var opencodeResumeSpec = resumecmd.Spec{Binary: "opencode", Flag: "-s", Verb: "/session"}

func (a *Adapter) ResumeCommand() resumecmd.Spec {
	return opencodeResumeSpec
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	switch a.currentSchema(ctx) {
	case schemaV2:
		return a.lastModifiedV2(ctx)
	case schemaV1:
		var maxTime int64
		err := a.db.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(m), 0) FROM (
				SELECT MAX(time_updated) AS m FROM session
				UNION ALL
				SELECT MAX(time_created) FROM message
				UNION ALL
				SELECT MAX(time_updated) FROM part
			)
		`).Scan(&maxTime)
		return maxTime, err
	default:
		// No session tables yet: an empty database has no modification time.
		return 0, nil
	}
}

func (a *Adapter) Close() error {
	return a.db.Close()
}
