package copilot

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var edits []ingest.FileEdit
	var msgCounter int
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		var event eventEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}

		switch event.Type {
		case "user.message":
			msgCounter++
			continue
		case "assistant.message":
			msgCounter++
		default:
			continue
		}

		var data assistantMessageData
		if err := json.Unmarshal(event.Data, &data); err != nil {
			continue
		}

		for _, req := range data.ToolRequests {
			ts := ingestkit.ParseTime(event.Timestamp)

			if req.Name == "apply_patch" {
				var patchText string
				if err := json.Unmarshal(req.Arguments, &patchText); err != nil || patchText == "" {
					continue
				}
				filePath := extractCopilotPatchPath(patchText)
				if filePath == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:     filePath,
					ToolName:     "edit",
					Content:      patchText,
					Timestamp:    ts,
					MessageIndex: msgCounter - 1,
					MessageID:    data.MessageID,
				})
				continue
			}

			var args toolEditArgs
			if err := json.Unmarshal(req.Arguments, &args); err != nil {
				continue
			}

			switch req.Name {
			case "create":
				if args.Path == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:     args.Path,
					ToolName:     "write",
					Content:      args.FileText,
					Timestamp:    ts,
					MessageIndex: msgCounter - 1,
					MessageID:    data.MessageID,
				})
			case "edit":
				if args.Path == "" && args.OldStr == "" && args.NewStr == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:     args.Path,
					ToolName:     "edit",
					OldStr:       args.OldStr,
					NewStr:       args.NewStr,
					Timestamp:    ts,
					MessageIndex: msgCounter - 1,
					MessageID:    data.MessageID,
				})
			}
		}
	}

	return edits, scanner.Err()
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT file_path, tool_name
		FROM session_files
		WHERE session_id = ?
		ORDER BY first_seen_at ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying session files: %w", err)
	}
	defer rows.Close()

	var diffs []ingest.DiffFile
	for rows.Next() {
		var filePath, toolName sql.NullString
		if err := rows.Scan(&filePath, &toolName); err != nil {
			continue
		}

		status := ingest.DiffModified
		if toolName.Valid {
			switch toolName.String {
			case "create":
				status = ingest.DiffAdded
			case "delete":
				status = ingest.DiffDeleted
			}
		}

		diffs = append(diffs, ingest.DiffFile{
			Path:   filePath.String,
			Status: status,
		})
	}

	return diffs, rows.Err()
}
