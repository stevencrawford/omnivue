package pi

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for _, msg := range msgs {
		for _, tc := range msg.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}

			fp, oldContent, newContent := parsePiEditContent(tc)
			if fp == "" {
				continue
			}

			content := newContent
			if oldContent != "" {
				content = ""
			}

			edits = append(edits, ingest.FileEdit{
				FilePath: fp,
				ToolName: tc.Name,
				OldStr:   oldContent,
				NewStr:   newContent,
				Content:  content,
			})
		}
	}
	return edits, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	edits, err := a.Edits(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return ingest.DiffStatsFromEdits(edits), nil
}

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
			var fallback struct {
				OldString string `json:"oldString"`
				NewString string `json:"newString"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &fallback); err == nil {
				return filePath, fallback.OldString, fallback.NewString
			}
			return filePath, "", ""
		}
		var oldParts, newParts []string
		for _, e := range input.Edits {
			oldParts = append(oldParts, e.OldText)
			newParts = append(newParts, e.NewText)
		}
		return filePath, strings.Join(oldParts, "\n"), strings.Join(newParts, "\n")
	}
	return "", "", ""
}
