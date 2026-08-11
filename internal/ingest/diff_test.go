package ingest_test

import (
	"encoding/json"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func TestExtractEditsSharedWalk(t *testing.T) {
	msgs := []ingest.Message{
		{ID: "m1", Role: ingest.MessageRoleAssistant, ToolCalls: []ingest.ToolCall{
			{Name: "write", Input: `{"file_path":"a.txt","content":"hi"}`},
			{Name: "read", Input: `{}`},
			{Name: "edit", Input: `{"file_path":"b.txt","old_str":"x","new_str":"y"}`},
		}},
		{ID: "m2", Role: ingest.MessageRoleAssistant, ToolCalls: []ingest.ToolCall{
			{Name: "bash", Input: `{}`},
		}},
	}

	parse := func(tc ingest.ToolCall, mi int, m ingest.Message) *ingest.FileEdit {
		switch tc.Name {
		case "write", "edit":
		default:
			return nil
		}
		var in struct {
			FilePath string `json:"file_path"`
			Content  string `json:"content"`
			OldStr   string `json:"old_str"`
			NewStr   string `json:"new_str"`
		}
		if err := json.Unmarshal([]byte(tc.Input), &in); err != nil {
			return nil
		}
		return &ingest.FileEdit{
			FilePath:     in.FilePath,
			ToolName:     tc.Name,
			OldStr:       in.OldStr,
			NewStr:       in.NewStr,
			Content:      in.Content,
			MessageIndex: mi,
			MessageID:    m.ID,
		}
	}

	edits := ingest.ExtractEdits(msgs, parse)
	if len(edits) != 2 {
		t.Fatalf("expected 2 edits, got %d", len(edits))
	}
	if edits[0].FilePath != "a.txt" || edits[0].MessageIndex != 0 || edits[0].MessageID != "m1" {
		t.Errorf("edits[0] = %+v", edits[0])
	}
	if edits[1].FilePath != "b.txt" || edits[1].MessageIndex != 0 {
		t.Errorf("edits[1] = %+v", edits[1])
	}
}
