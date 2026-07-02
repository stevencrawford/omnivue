package ingest

import (
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest/internal/ingestutil"
)

// KnownPaths are the default locations to scan for AI agent session data.
var KnownPaths = []struct {
	Path      string
	AgentType AgentType
	Label     string
}{
	{"~/.local/share/opencode", AgentOpenCode, "OpenCode"},
	{"~/.copilot", AgentCopilot, "GitHub Copilot"},
	{"~/.cursor", AgentCursor, "Cursor"},
	{"~/.pi/agent/sessions", AgentPi, "Pi"},
	{"~/.codex", AgentCodex, "Codex"},
	{"~/.claude", AgentClaudeCode, "Claude Code"},
}

// AutoDiscover scans known paths for AI agent session sources.
func AutoDiscover() []DiscoveredSource {
	var discovered []DiscoveredSource

	for _, known := range KnownPaths {
		path := ingestutil.ExpandHome(known.Path)
		if !ingestutil.PathExists(path) {
			continue
		}

		switch known.AgentType {
		case AgentOpenCode:
			if d := detectOpenCode(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentCopilot:
			if d := detectCopilot(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentCursor:
			if d := detectCursor(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentPi:
			if d := detectPi(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentCodex:
			if d := detectCodex(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentClaudeCode:
			if d := detectClaudeCode(path); d != nil {
				discovered = append(discovered, *d)
			}
		}
	}

	return discovered
}

func detectOpenCode(path string) *DiscoveredSource {
	dbPath := filepath.Join(path, "opencode.db")
	if !ingestutil.PathExists(dbPath) {
		return nil
	}
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentOpenCode,
		Label:     "OpenCode",
	}
}

func detectCopilot(path string) *DiscoveredSource {
	// Check for session-store.db or session-state directory
	dbPath := filepath.Join(path, "session-store.db")
	statePath := filepath.Join(path, "session-state")
	if !ingestutil.PathExists(dbPath) && !ingestutil.PathExists(statePath) {
		return nil
	}
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentCopilot,
		Label:     "GitHub Copilot",
	}
}

func detectCursor(path string) *DiscoveredSource {
	dbPath := ingestutil.FindCursorVscdbPath(path)
	if dbPath != "" {
		return &DiscoveredSource{
			Path:      dbPath,
			AgentType: AgentCursor,
			Label:     "Cursor",
		}
	}
	return nil
}

func detectPi(path string) *DiscoveredSource {
	if !ingestutil.PathExists(path) {
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
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentPi,
		Label:     "Pi",
	}
}

func detectCodex(path string) *DiscoveredSource {
	indexPath := filepath.Join(path, "session_index.jsonl")
	if !ingestutil.PathExists(indexPath) {
		return nil
	}
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentCodex,
		Label:     "Codex",
	}
}

func detectClaudeCode(path string) *DiscoveredSource {
	projectsDir := filepath.Join(path, "projects")
	if !ingestutil.PathExists(projectsDir) {
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
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentClaudeCode,
		Label:     "Claude Code",
	}
}


