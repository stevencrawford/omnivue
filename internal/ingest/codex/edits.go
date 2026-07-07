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

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var edits []ingest.FileEdit
	patchSeen := make(map[string]bool)
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

		switch env.Type {
		case "event_msg":
			var pl eventMsgPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			if pl.Type != "patch_apply_end" || len(pl.Changes) == 0 {
				continue
			}

			ts := ingestkit.ParseTime(env.Timestamp)

			var changes map[string]changeEntry
			if err := json.Unmarshal(pl.Changes, &changes); err != nil {
				continue
			}

			for path, change := range changes {
				content := change.Content
				if content == "" {
					content = change.UnifiedDiff
				}
				toolName := "edit"
				if change.Type == "add" {
					toolName = "write"
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:  path,
					ToolName:  toolName,
					NewStr:    content,
					Content:   content,
					Timestamp: ts,
				})
				patchSeen[path] = true
			}

		case "response_item":
			var pl responseItemPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			if pl.Type != "custom_tool_call" || pl.Name != "apply_patch" {
				continue
			}

			ts := ingestkit.ParseTime(env.Timestamp)
			patchText := pl.Input
			if patchText == "" {
				patchText = pl.Arguments
			}

			filePath := extractFilePathFromPatch(patchText)
			if filePath == "" || patchSeen[filePath] {
				continue
			}

			result := parseRawPatch(patchText)
			editContent := result.content
			if editContent == "" {
				editContent = patchText
			}
			edits = append(edits, ingest.FileEdit{
				FilePath:  filePath,
				ToolName:  "edit",
				NewStr:    editContent,
				Content:   patchText,
				Timestamp: ts,
			})
		}
	}

	if len(edits) == 0 {
		return nil, nil
	}
	return edits, nil
}
