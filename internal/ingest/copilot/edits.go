package copilot

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return ingest.ExtractEdits(msgs, parseCopilotEdit), nil
}

// parseCopilotEdit extracts a FileEdit from a normalized Copilot tool call.
// Normalization rewrites apply_patch→edit and create→write into the
// {filePath, content} shape; a native edit retains {path, old_str, new_str}.
func parseCopilotEdit(tc ingest.ToolCall, mi int, m ingest.Message) *ingest.FileEdit {
	if tc.Name != "edit" && tc.Name != "write" {
		return nil
	}

	var input struct {
		FilePath string `json:"filePath"`
		Path     string `json:"path"`
		Content  string `json:"content"`
		OldStr   string `json:"old_str"`
		NewStr   string `json:"new_str"`
		FileText string `json:"file_text"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return nil
	}
	fp := input.FilePath
	if fp == "" {
		fp = input.Path
	}
	if fp == "" {
		return nil
	}

	e := &ingest.FileEdit{
		FilePath:     fp,
		ToolName:     tc.Name,
		Timestamp:    m.Timestamp,
		MessageIndex: mi,
		MessageID:    m.ID,
	}
	if input.OldStr != "" || input.NewStr != "" {
		e.OldStr = input.OldStr
		e.NewStr = input.NewStr
		return e
	}
	content := input.FileText
	if content == "" {
		content = input.Content
	}
	e.Content = content
	return e
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
