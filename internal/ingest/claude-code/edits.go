package claudecode

import (
	"context"
	"encoding/json"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	edits, err := a.Edits(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return ingest.DiffStatsFromEdits(edits), nil
}

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for _, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "write" && tc.Name != "edit" {
				continue
			}
			var fp, content, old string
			if tc.Name == "write" {
				var input struct {
					FilePath string `json:"file_path"`
					Content  string `json:"content"`
				}
				if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
					continue
				}
				fp = input.FilePath
				content = input.Content
			} else {
				var input struct {
					FilePath  string `json:"file_path"`
					OldStr    string `json:"old_str"`
					OldString string `json:"old_string"`
					NewStr    string `json:"new_str"`
					NewString string `json:"new_string"`
					Content   string `json:"content"`
				}
				if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
					continue
				}
				fp = input.FilePath
				old = input.OldStr
				if old == "" {
					old = input.OldString
				}
				content = input.NewStr
				if content == "" {
					content = input.NewString
				}
				if content == "" {
					content = input.Content
				}
			}
			if fp == "" {
				continue
			}
			edits = append(edits, ingest.FileEdit{
				FilePath:  fp,
				ToolName:  tc.Name,
				OldStr:    old,
				NewStr:    content,
				Timestamp: m.Timestamp,
			})
		}
	}
	if len(edits) == 0 {
		return nil, nil
	}
	return edits, nil
}
