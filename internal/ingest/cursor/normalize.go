package cursor

import (
	"encoding/json"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// cursorRenameRules holds Cursor's conservative field-rename rules per
// canonical tool kind. They are applied by ingestkit.RenameToolKeys; only
// the rules are adapter-local so per-adapter behavior is preserved.
var cursorRenameRules = map[string]ingestkit.RenameRules{
	"read": {
		FilePath: []string{"targetFile", "effectiveUri", "relativeWorkspacePath", "path"},
		Drop:     []string{"charsLimit"},
	},
	"edit": {
		FilePath:  []string{"relativeWorkspacePath", "path"},
		NewString: []string{"contents", "streamingContent", "newStr", "new_string"},
		OldString: []string{"oldStr", "old_string"},
	},
	"grep": {
		Query: []string{"pattern"},
	},
	"glob": {
		Pattern:   []string{"globPattern"},
		Directory: []string{"targetDirectory"},
	},
}

// normalizeToolCall maps Cursor-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers. Name
// mapping is centralized in ingestkit.CanonicalizeToolName; field renaming is
// applied through the shared ingestkit.RenameToolKeys mechanism.
func normalizeToolCall(tc *ingest.ToolCall) {
	if tc.Name == "" {
		return
	}
	tc.Name = ingestkit.CanonicalizeToolName(tc.Name)

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

	if tc.Input == "" {
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	if rules, ok := cursorRenameRules[tc.Name]; ok {
		ingestkit.RenameToolKeys(p, rules)
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}
