package pi

import (
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// piRenameRules holds Pi's conservative field-rename rules per canonical tool
// kind, applied via ingestkit.RenameToolKeys. Pi keeps its "content" key
// alongside the canonical "newString", so it is copied rather than moved.
var piRenameRules = map[string]ingestkit.RenameRules{
	"read": {
		FilePath: []string{"file", "path"},
	},
	"edit": {
		FilePath:      []string{"file", "path", "file_path"},
		NewString:     []string{"new_content", "updated_content"},
		OldString:     []string{"old_content"},
		CopyNewString: []string{"content"},
	},
	"write": {
		FilePath:      []string{"file", "path", "file_path"},
		NewString:     []string{"new_content", "updated_content"},
		OldString:     []string{"old_content"},
		CopyNewString: []string{"content"},
	},
	"grep": {
		Query: []string{"pattern"},
	},
}

// normalizeToolCall maps Pi-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers. Name
// mapping is centralized in ingestkit.CanonicalizeToolName; field renaming is
// applied through the shared ingestkit.RenameToolKeys mechanism.
func normalizeToolCall(tc *ingest.ToolCall) {
	if tc.Name == "" {
		return
	}
	tc.Name = ingestkit.CanonicalizeToolName(tc.Name)

	if tc.Input == "" {
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	switch tc.Name {
	case "read":
		ingestkit.RenameToolKeys(p, piRenameRules["read"])
		if content := ingestkit.ExtractJSONString(tc.Output, "content"); content != "" {
			tc.Output = content
		}

	case "edit", "write":
		ingestkit.RenameToolKeys(p, piRenameRules[tc.Name])
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
		ingestkit.RenameToolKeys(p, piRenameRules["grep"])
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}
