package ingest

import (
	"os"
	"path/filepath"
)

// KnownPaths are the default locations to scan for AI agent session data.
var KnownPaths = []struct {
	Path      string
	AgentType AgentType
	Label     string
}{
	{"~/.local/share/opencode", AgentOpenCode, "OpenCode"},
	{"~/.copilot", AgentCopilot, "GitHub Copilot"},
}

// AutoDiscover scans known paths for AI agent session sources.
func AutoDiscover() []DiscoveredSource {
	var discovered []DiscoveredSource

	for _, known := range KnownPaths {
		path := expandHome(known.Path)
		if !pathExists(path) {
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
		}
	}

	return discovered
}

func detectOpenCode(path string) *DiscoveredSource {
	dbPath := filepath.Join(path, "opencode.db")
	if !pathExists(dbPath) {
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
	if !pathExists(dbPath) && !pathExists(statePath) {
		return nil
	}
	return &DiscoveredSource{
		Path:      path,
		AgentType: AgentCopilot,
		Label:     "GitHub Copilot",
	}
}

func expandHome(path string) string {
	if len(path) > 1 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
