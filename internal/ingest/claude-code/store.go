package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) findSlugFromSession(fpath string) string {
	f, err := os.Open(fpath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		var env claudeMessageEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) != nil {
			continue
		}
		if env.Slug != "" {
			return env.Slug
		}
	}
	return ""
}

func (a *Adapter) findSessionFile(sessionID string) string {
	projectsPath := filepath.Join(a.claudeDir, projectDir)

	var subagentID string
	if strings.Contains(sessionID, "-agent-") {
		parts := strings.SplitN(sessionID, "-agent-", 2)
		if len(parts) == 2 {
			subagentID = parts[1]
		}
	}

	var found string
	filepath.WalkDir(projectsPath, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found != "" {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		basename := strings.TrimSuffix(d.Name(), ".jsonl")
		if basename == sessionID {
			found = p
		} else if subagentID != "" && strings.HasPrefix(basename, "agent-") {
			aid := strings.TrimPrefix(basename, "agent-")
			if aid == subagentID && strings.Contains(p, "/subagents/") {
				found = p
			}
		}
		return nil
	})

	return found
}

func resolveParentSessionID(sessionID string) string {
	if idx := strings.Index(sessionID, "-agent-"); idx > 0 {
		return sessionID[:idx]
	}
	return sessionID
}
