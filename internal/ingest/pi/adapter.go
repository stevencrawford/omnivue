package pi

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func init() {
	ingest.Register(ingest.AgentPi, "Pi", "~/.pi/agent/sessions",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	if !ingestkit.PathExists(path) {
		return nil
	}
	var found bool
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found {
			return err
		}
		if !d.IsDir() && filepath.Ext(d.Name()) == ".jsonl" {
			found = true
		}
		return nil
	})
	if !found {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentPi,
		Label:     "Pi",
	}
}

type Adapter struct {
	basePath string
	cache    *ingest.SessionCache
}

func New(basePath string) (*Adapter, error) {
	return &Adapter{
		basePath: basePath,
		cache:    ingest.NewSessionCache(basePath, ".jsonl"),
	}, nil
}

func (a *Adapter) Type() ingest.AgentType { return ingest.AgentPi }

func (a *Adapter) Detect(path string) bool {
	fi, err := os.Stat(path)
	if err != nil || !fi.IsDir() {
		return false
	}
	var found bool
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
			found = true
		}
		return nil
	})
	return found
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && pi --session %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	maxMod, err := a.cache.ScanAndRebuild(func(path string) (*ingest.Session, int64, error) {
		session, err := a.parseSessionFile(path)
		if err != nil {
			return nil, 0, err
		}
		fi, err := os.Stat(path)
		if err != nil {
			return nil, 0, err
		}
		return session, fi.ModTime().UnixMilli(), nil
	})
	if err != nil {
		return a.cache.LastModified(), nil
	}
	return maxMod, nil
}

func (a *Adapter) Close() error { return nil }
