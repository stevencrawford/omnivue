package opencode

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

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
	return &Adapter{db: db, basePath: basePath}, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentOpenCode }

func (a *Adapter) Detect(path string) bool {
	dbPath := filepath.Join(path, "opencode.db")
	_, err := os.Stat(dbPath)
	return err == nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && opencode -s %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTime int64
	err := a.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(m), 0) FROM (
			SELECT MAX(time_updated) AS m FROM session
			UNION ALL
			SELECT MAX(time_created) FROM message
		)
	`).Scan(&maxTime)
	return maxTime, err
}

func (a *Adapter) Close() error {
	return a.db.Close()
}
