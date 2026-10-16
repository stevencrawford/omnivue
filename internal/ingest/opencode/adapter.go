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
	schema, err := detectSchema(db)
	if err != nil {
		if closeErr := db.Close(); closeErr != nil {
			return nil, fmt.Errorf("opencode adapter: %w (closing after probe: %w)", err, closeErr)
		}
		return nil, fmt.Errorf("opencode adapter: %w", err)
	}
	return &Adapter{db: db, basePath: basePath, schema: schema}, nil
}

// detectSchema reports which storage generation the database uses. The presence
// of the v2 session_message table is the authoritative signal: v2 databases
// retain a frozen copy of the v1 tables for compatibility, and v1 databases
// never have v2 tables.
func detectSchema(db *sql.DB) (schemaKind, error) {
	var name string
	err := db.QueryRow(`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name = 'session_message'
		LIMIT 1
	`).Scan(&name)
	if err == sql.ErrNoRows {
		return schemaV1, nil
	}
	if err != nil {
		return schemaV1, fmt.Errorf("probing schema: %w", err)
	}
	return schemaV2, nil
}

var opencodeResumeSpec = resumecmd.Spec{Binary: "opencode", Flag: "-s", Verb: "/session"}

func (a *Adapter) ResumeCommand() resumecmd.Spec {
	return opencodeResumeSpec
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	if a.schema == schemaV2 {
		return a.lastModifiedV2(ctx)
	}
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
}

func (a *Adapter) Close() error {
	return a.db.Close()
}
