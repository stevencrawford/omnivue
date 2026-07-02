package codex

import (
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func normalizeToolName(name string) string {
	switch name {
	case "exec_command":
		return "bash"
	case "apply_patch":
		return "edit"
	case "read_file":
		return "read"
	case "write_file":
		return "write"
	case "multi_tool_use.parallel":
		return name
	case "request_user_input":
		return "question"
	default:
		if strings.HasPrefix(name, "exec_") {
			return "bash"
		}
		if strings.HasPrefix(name, "edit_") || strings.HasSuffix(name, "_patch") {
			return "edit"
		}
		if strings.HasPrefix(name, "read_") {
			return "read"
		}
		return name
	}
}

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

	result := parseRawPatch(tc.Input)
	if result.filePath == "" {
		return
	}

	out := map[string]string{
		"filePath": result.filePath,
		"content":  result.content,
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		slog.Warn("failed to marshal write input", "error", err)
		encoded = []byte("{}")
	}
	tc.Input = string(encoded)
}
