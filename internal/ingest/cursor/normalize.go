package cursor

import (
	"encoding/json"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// normalizeToolCall maps Cursor-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers.
func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "edit_file_v2", "edit_file":
		tc.Name = "edit"
	case "read_file_v2", "read_file":
		tc.Name = "read"
	case "glob_file_search", "list_dir":
		tc.Name = "glob"
	case "ripgrep_raw_search", "grep_search":
		tc.Name = "grep"
	case "run_terminal_command_v2", "run_terminal_command":
		tc.Name = "bash"
	case "delete_file":
		tc.Name = "delete"
	case "Read":
		tc.Name = "read"
	case "Grep", "GrepSearch":
		tc.Name = "grep"
	case "Glob":
		tc.Name = "glob"
	case "Shell":
		tc.Name = "bash"
	case "Write":
		tc.Name = "write"
	case "StrReplace":
		tc.Name = "edit"
	case "Task", "task_v2", "explore:task_v2":
		tc.Name = "task"
	case "ReadLints":
		tc.Name = "read_lints"
	case "UpdateCurrentStep":
		tc.Name = "task_complete"
	default:
		return
	}

	// Output formatting — must happen before the Input parsing guard since
	// legacy tool calls may have non-JSON or empty Input fields.
	switch tc.Name {
	case "read":
		// Cursor read output: {"contents":"...","totalLinesInFile":N} -> raw text
		tc.Output = ingestkit.ExtractJSONString(tc.Output, "contents")
	case "bash":
		// Cursor bash output: {"output":"...","rejected":bool,"notInterrupted":bool}
		if text, rejected := extractBashOutput(tc.Output); rejected {
			tc.Output = text
			tc.Metadata = `{"exit":1}`
		} else if text != "" {
			tc.Output = text
		}
	case "grep":
		if out := formatGrepOutput(tc.Output); out != "" {
			tc.Output = out
		}
	case "glob":
		if out := formatGlobOutput(tc.Output); out != "" {
			tc.Output = out
		} else if out := formatLegacyGlobOutput(tc.Output); out != "" {
			tc.Output = out
		}
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	// Input field name normalization
	switch tc.Name {
	case "read":
		if v, ok := p["targetFile"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "targetFile")
		}
		if v, ok := p["effectiveUri"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "effectiveUri")
		}
		if v, ok := p["relativeWorkspacePath"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "relativeWorkspacePath")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		delete(p, "charsLimit")

	case "edit":
		if v, ok := p["relativeWorkspacePath"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "relativeWorkspacePath")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		if v, ok := p["contents"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "contents")
		}
		if v, ok := p["streamingContent"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "streamingContent")
		}
		if v, ok := p["newStr"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "newStr")
		}
		if v, ok := p["new_string"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "new_string")
		}
		if v, ok := p["oldStr"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "oldStr")
		}
		if v, ok := p["old_string"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "old_string")
		}

	case "grep":
		if v, ok := p["pattern"]; ok {
			if _, exists := p["query"]; !exists {
				p["query"] = v
			}
			delete(p, "pattern")
		}

	case "glob":
		if v, ok := p["globPattern"]; ok {
			if _, exists := p["pattern"]; !exists {
				p["pattern"] = v
			}
			delete(p, "globPattern")
		}
		if v, ok := p["targetDirectory"]; ok {
			if _, exists := p["directory"]; !exists {
				p["directory"] = v
			}
			delete(p, "targetDirectory")
		}
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}
