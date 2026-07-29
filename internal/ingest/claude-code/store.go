package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

const maxTitleLen = 80

func truncateTitle(s string) string {
	if idx := strings.Index(s, "\n"); idx >= 0 {
		s = s[:idx]
	}
	s = strings.TrimSpace(s)
	if len(s) > maxTitleLen {
		s = s[:maxTitleLen] + "..."
	}
	return s
}

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

func (a *Adapter) loadSessionIndex(projectPath string) map[string]sessionIndexEntry {
	indexPath := filepath.Join(projectPath, "sessions-index.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return nil
	}
	var idx sessionIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil
	}
	m := make(map[string]sessionIndexEntry, len(idx.Entries))
	for _, e := range idx.Entries {
		m[e.SessionID] = e
	}
	return m
}
