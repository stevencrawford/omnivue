package cursor

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

	_ "modernc.org/sqlite"
)

type Adapter struct {
	db            *sql.DB
	vscdbPath     string
	cursorDir     string
	appSupportDir string
}

func init() {
	ingest.Register(ingest.AgentCursor, "Cursor", "~/.cursor",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := ingestkit.FindCursorVscdbPath(path)
	if dbPath != "" {
		return &ingest.DiscoveredSource{
			Path:      dbPath,
			AgentType: ingest.AgentCursor,
			Label:     "Cursor",
		}
	}
	return nil
}

func New(vscdbPath string) (*Adapter, error) {
	resolved := ingestkit.FindCursorVscdbPath(vscdbPath)
	if resolved == "" {
		return nil, fmt.Errorf("cursor adapter: no state.vscdb found at %s", vscdbPath)
	}
	db, err := ingest.OpenReadOnlyDB(resolved)
	if err != nil {
		return nil, fmt.Errorf("cursor adapter: %w", err)
	}

	a := &Adapter{
		db:        db,
		vscdbPath: resolved,
	}
	a.cursorDir = resolveCursorDir(resolved)
	a.appSupportDir = resolveAppSupportDir(resolved)

	return a, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentCursor }

func (a *Adapter) Detect(path string) bool { return path == a.vscdbPath }

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	dir := session.Directory
	if dir == "" {
		dir = "."
	}
	return fmt.Sprintf("cd %s && cursor --composer %s", dir, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTs int64

	rows, err := a.db.QueryContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
	if err != nil {
		return 0, fmt.Errorf("querying last modified: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var value []byte
		if err := rows.Scan(&value); err != nil {
			continue
		}
		var cd struct {
			LastUpdatedAt json.Number `json:"lastUpdatedAt"`
		}
		if err := json.Unmarshal(value, &cd); err != nil {
			continue
		}
		ms := ingestkit.ParseMillis(string(cd.LastUpdatedAt))
		if ms > maxTs {
			maxTs = ms
		}
	}

	transcriptDir := filepath.Join(a.cursorDir, "projects")
	if ingestkit.PathExists(transcriptDir) {
		filepath.WalkDir(transcriptDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
			if err != nil {
				return nil
			}
			if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
				if fi, e := d.Info(); e == nil {
					if ms := fi.ModTime().UnixMilli(); ms > maxTs {
						maxTs = ms
					}
				}
			}
			return nil
		})
	}

	return maxTs, nil
}

func (a *Adapter) Close() error { return a.db.Close() }

func (a *Adapter) Plan(_ context.Context, _ string) (*ingest.Plan, error) {
	return nil, nil
}
