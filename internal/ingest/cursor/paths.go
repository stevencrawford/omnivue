package cursor

import (
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func resolveCursorDir(vscdbPath string) string {
	dir := filepath.Dir(vscdbPath)
	for range 5 {
		if filepath.Base(dir) == "Cursor" {
			return filepath.Join(homeDirFallback(), ".cursor")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	home, err := os.UserHomeDir()
	if err == nil {
		cursorDir := filepath.Join(home, ".cursor")
		if ingestkit.PathExists(cursorDir) {
			return cursorDir
		}
	}
	return filepath.Dir(filepath.Dir(vscdbPath))
}

func resolveAppSupportDir(vscdbPath string) string {
	dir := filepath.Dir(vscdbPath)
	for range 5 {
		if filepath.Base(dir) == "Cursor" {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	home, err := os.UserHomeDir()
	if err == nil {
		paths := []string{
			filepath.Join(home, "Library", "Application Support", "Cursor"),
			filepath.Join(home, ".config", "Cursor"),
		}
		for _, p := range paths {
			if ingestkit.PathExists(p) {
				return p
			}
		}
	}
	return filepath.Dir(filepath.Dir(vscdbPath))
}

func homeDirFallback() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp"
	}
	return home
}
