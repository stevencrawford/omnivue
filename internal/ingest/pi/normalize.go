package pi

import (
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// normalizeToolCall maps Pi-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers.
func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "read_file", "read_files", "view_file":
		tc.Name = "read"
	case "write", "write_file", "create_file", "new_file":
		tc.Name = "write"
	case "edit", "edit_file", "edit_file_content", "modify_file", "apply_diff", "replace_text":
		tc.Name = "edit"
	case "delete_file", "remove_file":
		tc.Name = "delete"
	case "run_command", "execute_command", "shell", "run_terminal":
		tc.Name = "bash"
	case "search_files", "grep_search", "find_text", "search_text":
		tc.Name = "grep"
	case "list_files", "list_directory", "find_file":
		tc.Name = "glob"
	case "ask_question", "ask_user", "prompt_user":
		tc.Name = "question"
	case "fetch_url", "http_request", "make_request", "web_fetch":
		tc.Name = "webfetch"
	case "web_search", "search_web", "search_internet":
		tc.Name = "websearch"
	default:
		return
	}

	if tc.Input == "" {
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	switch tc.Name {
	case "read":
		if v, ok := p["file"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		if content := ingestkit.ExtractJSONString(tc.Output, "content"); content != "" {
			tc.Output = content
		}

	case "edit", "write":
		if v, ok := p["file"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		if v, ok := p["file_path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file_path")
		}
		if v, ok := p["new_content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "new_content")
		}
		if v, ok := p["updated_content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "updated_content")
		}
		if v, ok := p["content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
		}
		if v, ok := p["old_content"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "old_content")
		}

		if editsRaw, ok := p["edits"]; ok {
			if editsArr, ok := editsRaw.([]any); ok && len(editsArr) > 0 {
				var oldParts, newParts []string
				for _, e := range editsArr {
					if em, ok := e.(map[string]any); ok {
						if ot, ok := em["oldText"].(string); ok {
							oldParts = append(oldParts, ot)
						}
						if nt, ok := em["newText"].(string); ok {
							newParts = append(newParts, nt)
						}
					}
				}
				if _, exists := p["oldString"]; !exists && len(oldParts) > 0 {
					p["oldString"] = strings.Join(oldParts, "\n")
				}
				if _, exists := p["newString"]; !exists && len(newParts) > 0 {
					p["newString"] = strings.Join(newParts, "\n")
				}
			}
		}

	case "bash":
		if stdout := ingestkit.ExtractJSONString(tc.Output, "stdout"); stdout != "" {
			if stderr := ingestkit.ExtractJSONString(tc.Output, "stderr"); stderr != "" {
				tc.Output = stdout + "\n" + stderr
			} else {
				tc.Output = stdout
			}
		}
		if exitCode := ingestkit.ExtractJSONString(tc.Output, "exitCode"); exitCode != "" && exitCode != "0" {
			tc.Metadata = `{"exit":` + exitCode + `}`
		}

	case "grep":
		if v, ok := p["pattern"]; ok {
			if _, exists := p["query"]; !exists {
				p["query"] = v
			}
			delete(p, "pattern")
		}

	case "glob":
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}
