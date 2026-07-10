package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var diffs []ingest.DiffFile
	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		if env.Type != "event_msg" {
			continue
		}

		var pl eventMsgPayload
		if err := json.Unmarshal(env.Payload, &pl); err != nil {
			continue
		}
		if pl.Type != "patch_apply_end" || len(pl.Changes) == 0 {
			continue
		}

		var changes map[string]changeEntry
		if err := json.Unmarshal(pl.Changes, &changes); err != nil {
			continue
		}

		for path, change := range changes {
			status := "modified"
			switch change.Type {
			case "add":
				status = "added"
			case "delete":
				status = "deleted"
			}

			patch := ""
			if change.Content != "" {
				patch = fmt.Sprintf("--- a/%s\n+++ b/%s\n@@ -1 +1 @@\n-%s\n+%s\n", path, path, change.Content, change.Content)
			}

			diffs = append(diffs, ingest.DiffFile{
				Path:   path,
				Status: ingest.DiffFileStatus(status),
				Patch:  patch,
			})
		}
	}

	if len(diffs) == 0 {
		return nil, nil
	}
	return diffs, nil
}

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	// First pass: extract edits from message tool calls.
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	patchSeen := make(map[string]bool)

	for mi, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			fp, oldContent, newContent := parseCodexEditContent(tc)
			if fp == "" {
				continue
			}
			patchSeen[fp] = true
			edits = append(edits, ingest.FileEdit{
				FilePath:     fp,
				ToolName:     tc.Name,
				OldStr:       oldContent,
				NewStr:       newContent,
				Content:      newContent,
				Timestamp:    m.Timestamp,
				MessageIndex: mi,
			})
		}
	}

	// Second pass: scan for patch_apply_end events that may not appear as tool calls.
	f, err := os.Open(fpath)
	if err != nil {
		if len(edits) > 0 {
			return edits, nil
		}
		return nil, nil
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		if env.Type != "event_msg" {
			continue
		}

		var pl eventMsgPayload
		if err := json.Unmarshal(env.Payload, &pl); err != nil {
			continue
		}
		if pl.Type != "patch_apply_end" || len(pl.Changes) == 0 {
			continue
		}

		var changes map[string]changeEntry
		if err := json.Unmarshal(pl.Changes, &changes); err != nil {
			continue
		}

		for path, change := range changes {
			if patchSeen[path] {
				continue
			}
			content := change.Content
			if content == "" {
				content = change.UnifiedDiff
			}
			toolName := "edit"
			if change.Type == "add" {
				toolName = "write"
			}
			patchSeen[path] = true
			edits = append(edits, ingest.FileEdit{
				FilePath: path,
				ToolName: toolName,
				NewStr:   content,
				Content:  content,
			})
		}
	}

	if len(edits) == 0 {
		return nil, nil
	}
	return edits, nil
}

// parseCodexEditContent extracts file path and old/new content from an edit or
// write tool call, handling Codex's native and normalized formats.
func parseCodexEditContent(tc ingest.ToolCall) (filePath, oldStr, newStr string) {
	var input struct {
		FilePath   string `json:"filePath"`
		FilePath2  string `json:"file_path"`
		Content    string `json:"content"`
		OldStr     string `json:"old_str"`
		OldString  string `json:"old_string"`
		NewStr     string `json:"new_str"`
		NewString  string `json:"new_string"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return "", "", ""
	}
	filePath = input.FilePath
	if filePath == "" {
		filePath = input.FilePath2
	}
	if filePath == "" {
		return "", "", ""
	}
	switch tc.Name {
	case "write":
		newStr = input.Content
		return filePath, "", newStr
	case "edit":
		oldStr = input.OldStr
		if oldStr == "" {
			oldStr = input.OldString
		}
		newStr = input.NewStr
		if newStr == "" {
			newStr = input.NewString
		}
		if newStr == "" {
			newStr = input.Content
		}
		return filePath, oldStr, newStr
	}
	return "", "", ""
}
