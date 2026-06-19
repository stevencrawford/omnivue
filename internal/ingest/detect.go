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
	{"~/.cursor", AgentCursor, "Cursor"},
	{"~/.pi/agent/sessions", AgentPi, "Pi"},
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
		case AgentCursor:
			if d := detectCursor(path); d != nil {
				discovered = append(discovered, *d)
			}
		case AgentPi:
			if d := detectPi(path); d != nil {
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

func detectCursor(path string) *DiscoveredSource {
	dbPath := findCursorDB(path)
	if dbPath != "" {
		return &DiscoveredSource{
			Path:      dbPath,
			AgentType: AgentCursor,
			Label:     "Cursor",
		}
	}
	return nil
}

// findCursorDB resolves the Cursor state.vscdb path from any known entry point:
// - Direct path to state.vscdb
// - globalStorage directory
// - Cursor config directory (~/.cursor)
// - macOS App Support path (~/Library/Application Support/Cursor)
// - Linux App Support path (~/.config/Cursor)
func findCursorDB(entry string) string {
	candidates := []string{
		entry,
		filepath.Join(entry, "state.vscdb"),
		filepath.Join(entry, "User", "globalStorage", "state.vscdb"),
	}
	home, err := os.UserHomeDir()
	if err == nil {
		candidates = append(candidates,
			filepath.Join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
			filepath.Join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
		)
	}
	for _, c := range candidates {
		if pathExists(c) {
			// If it's a directory, append state.vscdb
			if fi, err := os.Stat(c); err == nil && fi.IsDir() {
				c = filepath.Join(c, "state.vscdb")
				if !pathExists(c) {
					continue
				}
			}
			return c
		}
	}
	return ""
}

func detectPi(path string) *DiscoveredSource {
	if !pathExists(path) {
		return nil
	}
	var found bool
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
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

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
