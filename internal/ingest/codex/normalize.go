package codex

import (
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func normalizeBashInput(tc *ingest.ToolCall) {
	if tc.Name != "bash" || tc.Input == "" {
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(tc.Input), &raw); err != nil {
		return
	}
	if cmd, ok := raw["cmd"]; ok {
		if _, hasCommand := raw["command"]; !hasCommand {
			raw["command"] = cmd
		}
	}
	out, err := json.Marshal(raw)
	if err != nil {
		slog.Warn("failed to marshal tool input", "error", err)
		out = []byte("{}")
	}
	tc.Input = string(out)
}

func normalizeBashOutput(tc *ingest.ToolCall) {
	if tc.Name != "bash" || tc.Output == "" {
		return
	}
	output := tc.Output
	if !strings.HasPrefix(output, "Chunk ID:") {
		return
	}
	_, after, found := strings.Cut(output, "\nOutput:\n")
	if found {
		tc.Output = after
	}
}

func normalizeEditInput(tc *ingest.ToolCall) {
	if tc.Name != "edit" || tc.Input == "" {
		return
	}
	if tc.Input[0] == '{' {
		var check any
		if json.Unmarshal([]byte(tc.Input), &check) == nil {
			return
		}
	}

	filePath, content := ingestkit.ParseApplyPatch(tc.Input)
	if filePath == "" {
		return
	}

	out := map[string]string{
		"filePath": filePath,
		"content":  content,
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		slog.Warn("failed to marshal write input", "error", err)
		encoded = []byte("{}")
	}
	tc.Input = string(encoded)
}
