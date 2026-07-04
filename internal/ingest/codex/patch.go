package codex

import "strings"

func extractFilePathFromPatch(patch string) string {
	for _, prefix := range []string{"*** Add File: ", "*** Modify File: ", "*** Update File: ", "--- Add File: ", "--- Modify File: ", "--- Update File: "} {
		if _, after, found := strings.Cut(patch, prefix); found {
			if nl := strings.IndexAny(after, "\n\r"); nl >= 0 {
				return strings.TrimSpace(after[:nl])
			}
			return strings.TrimSpace(after)
		}
	}
	return ""
}

func parseRawPatch(input string) rawPatchResult {
	filePath := ""
	var contentLines []string
	inContent := false
	for line := range strings.SplitSeq(input, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
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
		case strings.HasPrefix(trimmed, "*** Begin Patch"):
			inContent = true
		case strings.HasPrefix(trimmed, "*** End Patch"):
			inContent = false
		case inContent && filePath != "":
			contentLines = append(contentLines, line)
		}
	}
	content := strings.TrimRight(strings.Join(contentLines, "\n"), "\n")
	return rawPatchResult{
		filePath: filePath,
		content:  content,
	}
}
