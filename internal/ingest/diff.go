package ingest

import "strings"

// EditParser extracts a single FileEdit from a normalized tool call, or returns
// nil when the tool call is not an edit/write applicable to file edits.
// Adapters own the field parsing of their native tool-call input; the walk
// over messages is shared.
type EditParser func(tc ToolCall, msgIndex int, msg Message) *FileEdit

// ExtractEdits walks normalized messages once and collects file edits from
// edit/write tool calls using the adapter's parser. Adapters whose Edits()
// previously re-scanned raw data can derive edits from the messages they
// already built for Messages(), so each raw source is parsed once.
func ExtractEdits(msgs []Message, parse EditParser) []FileEdit {
	var edits []FileEdit
	for mi, m := range msgs {
		for _, tc := range m.ToolCalls {
			if e := parse(tc, mi, m); e != nil {
				edits = append(edits, *e)
			}
		}
	}
	return edits
}

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
