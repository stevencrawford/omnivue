package ingest

import "strings"

// DiffStatsFromEdits deduplicates edits by file path and computes additions,
// deletions, and status for each file. Used by adapters whose Diffs()
// implementation reads from Edits() rather than from a native diff source.
func DiffStatsFromEdits(edits []FileEdit) []DiffFile {
	seen := make(map[string]bool)
	var diffs []DiffFile
	for _, e := range edits {
		if seen[e.FilePath] {
			continue
		}
		seen[e.FilePath] = true
		adds := 0
		dels := 0
		if e.NewStr != "" {
			adds = strings.Count(e.NewStr, "\n") + 1
		}
		if e.OldStr != "" {
			dels = strings.Count(e.OldStr, "\n") + 1
		}
		status := DiffModified
		if e.OldStr == "" && e.NewStr != "" {
			status = DiffAdded
		}
		diffs = append(diffs, DiffFile{
			Path:      e.FilePath,
			Status:    status,
			Additions: adds,
			Deletions: dels,
		})
	}
	return diffs
}
