package pi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// findSessionFile locates a session JSONL file by session ID. It first tries
// the filename pattern {timestamp}_{sessionID}.jsonl, then falls back to
// reading the first line of each JSONL file to find a matching session header.
func (a *Adapter) findSessionFile(sessionID string) string {
	var found string
	filepath.WalkDir(a.basePath, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found != "" {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		name := strings.TrimSuffix(d.Name(), ".jsonl")
		if parts := strings.SplitN(name, "_", 2); len(parts) == 2 && parts[1] == sessionID {
			found = p
			return nil
		}
		f, err := os.Open(p) //nolint:gosec
		if err != nil {
			return nil
		}
		var header piSessionHeader
		if json.NewDecoder(f).Decode(&header) == nil && header.ID == sessionID {
			found = p
		}
		f.Close()
		return nil
	})
	return found
}
