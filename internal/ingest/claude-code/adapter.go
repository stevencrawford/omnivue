package claudecode

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

type Adapter struct {
	basePath  string
	claudeDir string

	mu       sync.RWMutex
	sessions []ingest.Session
	lastMod  int64
}

func init() {
	ingest.Register(ingest.AgentClaudeCode, "Claude Code", "~/.claude",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	projectsDir := filepath.Join(path, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}
	ents, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}
	var found bool
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		sessionEnts, err := os.ReadDir(filepath.Join(projectsDir, ent.Name()))
		if err != nil {
			continue
		}
		for _, se := range sessionEnts {
			if !se.IsDir() && filepath.Ext(se.Name()) == ".jsonl" {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentClaudeCode,
		Label:     "Claude Code",
	}
}

const projectDir = "projects"
const planDir = "plans"

func New(basePath string) (*Adapter, error) {
	return &Adapter{
		basePath:  basePath,
		claudeDir: basePath,
	}, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentClaudeCode }

func (a *Adapter) Detect(path string) bool {
	projectsPath := filepath.Join(path, projectDir)
	fi, err := os.Stat(projectsPath)
	if err != nil || !fi.IsDir() {
		return false
	}
	ents, err := os.ReadDir(projectsPath)
	if err != nil {
		return false
	}
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		sessionEnts, err := os.ReadDir(filepath.Join(projectsPath, ent.Name()))
		if err != nil {
			continue
		}
		for _, se := range sessionEnts {
			if !se.IsDir() && strings.HasSuffix(se.Name(), ".jsonl") {
				return true
			}
		}
	}
	return false
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && claude -p %s -s %s", session.Directory, session.Directory, session.ID)
}

func (a *Adapter) LastModified(_ context.Context) (int64, error) {
	a.mu.RLock()
	lastMod := a.lastMod
	a.mu.RUnlock()

	var maxMod int64
	projectsPath := filepath.Join(a.claudeDir, projectDir)

	filepath.WalkDir(projectsPath, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
		return nil
	})

	if maxMod == 0 {
		maxMod = time.Now().UnixMilli()
	}

	if maxMod > lastMod {
		a.mu.Lock()
		a.sessions = nil
		a.lastMod = maxMod
		a.mu.Unlock()
	}

	return maxMod, nil
}

func (a *Adapter) Close() error { return nil }
