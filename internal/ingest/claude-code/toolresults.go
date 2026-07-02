package claudecode

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// resolveToolResultsDir resolves the tool-results directory path from a session file path.
func resolveToolResultsDir(fpath, parentSID string) string {
	// Walk up to find the project directory (parent of the session directory)
	dir := filepath.Dir(fpath)
	for {
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		if filepath.Base(parent) == projectDir {
			// Found projects/ — tool-results dir is projects/<enc>/<parentSID>/tool-results/
			return filepath.Join(dir, parentSID, "tool-results")
		}
		dir = parent
	}
}

func readToolResultFile(toolResultsDir, toolUseID string) string {
	// Tool results are stored as {tool_use_id}.txt
	fpath := filepath.Join(toolResultsDir, toolUseID+".txt")
	content, err := os.ReadFile(fpath)
	if err != nil {
		return ""
	}
	return string(content)
}

// truncateToolOutput truncates content to maxContentBytes unless the tool is a task.
func truncateToolOutput(content string, toolName string) string {
	if toolName == "task" || toolName == "Task" {
		return content
	}
	return ingestkit.TruncateContent(content, maxContentBytes)
}

// setToolMetadataSessionID sets the sessionId field in a tool call's metadata JSON.
func setToolMetadataSessionID(tc *ingest.ToolCall, parentSID, agentID string) {
	if agentID == "" {
		return
	}
	childID := parentSID + "-agent-" + agentID
	var md map[string]any
	if tc.Metadata != "" {
		if err := json.Unmarshal([]byte(tc.Metadata), &md); err != nil {
			slog.Warn("failed to unmarshal metadata", "error", err)
		}
	}
	if md == nil {
		md = make(map[string]any)
	}
	md["sessionId"] = childID
	mdBytes, err := json.Marshal(md)
	if err != nil {
		slog.Warn("failed to marshal metadata", "error", err)
		mdBytes = []byte("{}")
	}
	tc.Metadata = string(mdBytes)
}
