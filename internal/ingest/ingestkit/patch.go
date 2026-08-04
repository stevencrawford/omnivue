package ingestkit

import "strings"

// ParseApplyPatch parses the shared apply_patch dialect and returns the first
// target file path together with the patch body (the lines between the Begin
// and End markers). It is the single implementation of this dialect: Copilot,
// Codex, and any future adapter that emits apply_patch text route through it
// instead of each declaring a private parser.
//
// Supported markers (both "***" and the "--" variant are recognized):
//
//	*** Add File: <path> / *** Update File: <path> / *** Modify File: <path>
//	--- Add File: <path> / --- Update File: <path> / --- Modify File: <path>
//	*** Chunk: <path> : <description>
//	*** Begin Patch ... *** End Patch
func ParseApplyPatch(input string) (filePath, content string) {
	var contentLines []string
	inContent := false
	for line := range strings.SplitSeq(input, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "*** Begin Patch"):
			inContent = true
		case strings.HasPrefix(trimmed, "*** End Patch"):
			inContent = false
		case strings.HasPrefix(trimmed, "*** Add File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Add File: ")
		case strings.HasPrefix(trimmed, "*** Modify File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Modify File: ")
		case strings.HasPrefix(trimmed, "*** Update File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Update File: ")
		case strings.HasPrefix(trimmed, "--- Add File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Add File: ")
		case strings.HasPrefix(trimmed, "--- Modify File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Modify File: ")
		case strings.HasPrefix(trimmed, "--- Update File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Update File: ")
		case strings.HasPrefix(trimmed, "*** Chunk: "):
			rest := strings.TrimPrefix(trimmed, "*** Chunk: ")
			if idx := strings.Index(rest, " : "); idx > 0 {
				filePath = rest[:idx]
			} else {
				filePath = rest
			}
		case inContent && filePath != "":
			contentLines = append(contentLines, line)
		}
	}
	return filePath, strings.TrimRight(strings.Join(contentLines, "\n"), "\n")
}