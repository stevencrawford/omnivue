package pi

import (
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// parsePiEditContent extracts file path and old/new content from an edit or
// write tool call, handling Pi's native formats:
//   - write:  {"content": "...", "filePath": "..."}
//   - edit:   {"edits": [{"oldText": "...", "newText": "..."}], "filePath": "..."}
func parsePiEditContent(tc ingest.ToolCall) (filePath, oldStr, newStr string) {
	var input struct {
		FilePath string        `json:"filePath"`
		Path     string        `json:"path"`
		Content  string        `json:"content"`
		Edits    []piEditEntry `json:"edits,omitempty"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return "", "", ""
	}

	filePath = input.FilePath
	if filePath == "" {
		filePath = input.Path
	}
	if filePath == "" {
		return "", "", ""
	}

	switch tc.Name {
	case "write":
		newStr = input.Content
		if newStr == "" {
			var fallback struct {
				NewString string `json:"newString"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &fallback); err == nil {
				newStr = fallback.NewString
			}
		}
		return filePath, "", newStr
	case "edit":
		if len(input.Edits) == 0 {
			// Some edit calls may use oldString/newString directly
			var fallback struct {
				OldString string `json:"oldString"`
				NewString string `json:"newString"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &fallback); err == nil {
				return filePath, fallback.OldString, fallback.NewString
			}
			return filePath, "", ""
		}
		// Merge all edits into a single old/new pair.
		// Each edit entry is a standalone replacement within the file; concatenating
		// them produces a single diff that the frontend can display as multiple hunks.
		var oldParts, newParts []string
		for _, e := range input.Edits {
			oldParts = append(oldParts, e.OldText)
			newParts = append(newParts, e.NewText)
		}
		return filePath, strings.Join(oldParts, "\n"), strings.Join(newParts, "\n")
	}
	return "", "", ""
}
