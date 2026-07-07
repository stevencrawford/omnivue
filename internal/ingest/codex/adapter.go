package codex

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func init() {
	ingest.Register(ingest.AgentCodex, "Codex", "~/.codex",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	indexPath := filepath.Join(path, "session_index.jsonl")
	if !ingestkit.PathExists(indexPath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentCodex,
		Label:     "Codex",
	}
}

type Adapter struct {
	basePath string
	cache    *ingest.SessionCache
}

func New(basePath string) (*Adapter, error) {
	if len(basePath) > 1 && basePath[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err == nil {
			basePath = home + basePath[1:]
		}
	}
	if !hasIndexFile(basePath) {
		parent := filepath.Dir(basePath)
		if hasIndexFile(parent) {
			basePath = parent
		}
	}
	if !hasIndexFile(basePath) {
		return nil, fmt.Errorf("codex adapter: session_index.jsonl not found at %s", basePath)
	}
	return &Adapter{
		basePath: basePath,
		cache:    ingest.NewSessionCacheWithKey(basePath, ".jsonl", codexSessionIDFromPath),
	}, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentCodex }

func (a *Adapter) Detect(path string) bool {
	indexPath := filepath.Join(path, "session_index.jsonl")
	_, err := os.Stat(indexPath)
	return err == nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && codex resume %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	currentLastMod := a.cache.LastModified()

	var maxMod int64

	indexPath := filepath.Join(a.basePath, "session_index.jsonl")
	if fi, err := os.Stat(indexPath); err == nil {
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
	}

	sessionsDir := filepath.Join(a.basePath, "sessions")
	if fi, err := os.Stat(sessionsDir); err == nil {
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
	}

	err := filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
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
	if err != nil {
		if currentLastMod > 0 {
			return currentLastMod, nil
		}
		return time.Now().UnixMilli(), nil
	}

	if maxMod == 0 {
		maxMod = time.Now().UnixMilli()
	}

	if maxMod > currentLastMod {
		a.cache.ReplaceAll(nil)
	}

	return maxMod, nil
}

func (a *Adapter) Close() error { return nil }
