package codex

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// readIndex reads the session_index.jsonl file and returns all entries.
func readIndex(path string) ([]codexIndexEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []codexIndexEntry
	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry codexIndexEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			log.Printf("codex adapter: skipping malformed index line: %v", err)
			continue
		}
		if entry.ID == "" {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}

// extractIDFromSessionFile reads the first line of a session JSONL file and
// returns the session ID from the session_meta header. Falls back to the
// filename without .jsonl extension.
func extractIDFromSessionFile(path, name string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := ingestkit.NewJSONLScanner(f)
	if scanner.Scan() {
		var env codexEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) == nil && env.Type == "session_meta" {
			var meta sessionMetaPayload
			if json.Unmarshal(env.Payload, &meta) == nil && meta.ID != "" {
				return meta.ID
			}
		}
	}
	if idx := strings.LastIndex(name, ".jsonl"); idx > 0 {
		return name[:idx]
	}
	return name
}

// hasIndexFile checks whether session_index.jsonl exists at the given path.
func hasIndexFile(basePath string) bool {
	_, err := os.Stat(filepath.Join(basePath, "session_index.jsonl"))
	return err == nil
}
