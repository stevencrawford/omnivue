package cursor

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for mi, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			fp, oldContent, newContent := a.parseEditContent(ctx, tc)
			if fp == "" {
				continue
			}
			content := newContent
			if oldContent != "" {
				content = ""
			}
			edits = append(edits, ingest.FileEdit{
				FilePath:     fp,
				ToolName:     tc.Name,
				OldStr:       oldContent,
				NewStr:       newContent,
				Content:      content,
				MessageIndex: mi,
			})
		}
	}
	return edits, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	messages, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var diffs []ingest.DiffFile

	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit_file_v2" && tc.Name != "edit_file" && tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			var p struct {
				RelativeWorkspacePath string `json:"relativeWorkspacePath"`
				FilePath              string `json:"filePath"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
				continue
			}
			fp := p.FilePath
			if fp == "" {
				fp = p.RelativeWorkspacePath
			}
			if fp == "" || seen[fp] {
				continue
			}
			seen[fp] = true
			diffs = append(diffs, ingest.DiffFile{
				Path:   fp,
				Status: ingest.DiffModified,
			})
		}
	}
	if len(diffs) > 0 {
		return diffs, nil
	}

	var rows *sql.Rows
	rows, err = a.db.QueryContext(ctx,
		`SELECT key FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:`+sessionID+`:%'`) //nolint:gosec
	if err != nil {
		return nil, fmt.Errorf("querying diffs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			continue
		}
		parts := strings.Split(key, ":")
		uuid := ""
		if len(parts) >= 3 {
			uuid = parts[2]
		}
		diffs = append(diffs, ingest.DiffFile{
			Path:   uuid,
			Status: ingest.DiffModified,
		})
	}
	return diffs, nil
}
