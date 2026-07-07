package copilot

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

	_ "modernc.org/sqlite"
)

type Adapter struct {
	db                *sql.DB
	basePath          string
	syntheticSessions map[string]*syntheticSession
	mu                sync.Mutex
	sessionsMu        sync.RWMutex
	cachedSessions    []ingest.Session
	cachedLastMod     int64
}

func init() {
	ingest.Register(ingest.AgentCopilot, "GitHub Copilot", "~/.copilot",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := filepath.Join(path, "session-store.db")
	statePath := filepath.Join(path, "session-state")
	if !ingestkit.PathExists(dbPath) && !ingestkit.PathExists(statePath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentCopilot,
		Label:     "GitHub Copilot",
	}
}

func New(basePath string) (*Adapter, error) {
	dbPath := filepath.Join(basePath, "session-store.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("copilot adapter: %w", err)
	}
	return &Adapter{db: db, basePath: basePath, syntheticSessions: make(map[string]*syntheticSession), cachedSessions: nil}, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentCopilot }

func (a *Adapter) Detect(path string) bool {
	dbPath := filepath.Join(path, "session-store.db")
	statePath := filepath.Join(path, "session-state")
	_, errDB := os.Stat(dbPath)
	_, errState := os.Stat(statePath)
	return errDB == nil || errState == nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && copilot --resume=%s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	a.sessionsMu.RLock()
	lastMod := a.cachedLastMod
	a.sessionsMu.RUnlock()

	var maxTS int64

	var maxTime sql.NullString
	if err := a.db.QueryRowContext(ctx, `SELECT MAX(updated_at) FROM sessions`).Scan(&maxTime); err == nil && maxTime.Valid {
		maxTS = ingestkit.ParseTime(maxTime.String).UnixMilli()
	}

	stateDir := filepath.Join(a.basePath, "session-state")
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		if maxTS > 0 {
			return maxTS, nil
		}
		return 0, fmt.Errorf("reading session-state: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		eventsPath := filepath.Join(stateDir, entry.Name(), "events.jsonl")
		info, err := os.Stat(eventsPath)
		if err != nil {
			continue
		}
		if mtime := info.ModTime().UnixMilli(); mtime > maxTS {
			maxTS = mtime
		}
	}

	if maxTS == 0 {
		return 0, fmt.Errorf("no sessions found")
	}

	if maxTS > lastMod {
		a.sessionsMu.Lock()
		a.cachedSessions = nil
		a.cachedLastMod = maxTS
		a.sessionsMu.Unlock()
	}

	return maxTS, nil
}

func (a *Adapter) Close() error {
	a.mu.Lock()
	a.syntheticSessions = make(map[string]*syntheticSession)
	a.mu.Unlock()
	return a.db.Close()
}
