package claudecode

import (
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

const maxContentBytes = 2000

func parseAssistantContent(raw json.RawMessage, _ string) (text, reasoning string, toolCalls []ingest.ToolCall) {
	if len(raw) == 0 {
		return "", "", nil
	}

	// Try as array of content parts first
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) != nil {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s, "", nil
		}
		return "", "", nil
	}

	var texts []string
	var thinkTexts []string

	for _, p := range parts {
		switch p.Type {
		case "text":
			texts = append(texts, p.Text)
		case "thinking":
			thinkTexts = append(thinkTexts, p.Thinking)
		case "tool_use":
			if p.Name == "ExitPlanMode" {
				// Transform exit_plan_mode input for the frontend renderer.
				// The frontend ExitPlanModeToolDiff expects: {"summary":"<plan markdown>"}
				// Claude Code stores the plan under either "plan", "content", or "summary" key.
				planText := extractPlanContent(p.Input)
				if planText != "" {
				transformed, err := json.Marshal(map[string]string{
					"summary": planText,
				})
				if err != nil {
					slog.Warn("failed to marshal plan text", "error", err)
					transformed = []byte("{}")
				}
					tc := ingest.ToolCall{
						ID:     p.ID,
						Name:   p.Name,
						Input:  string(transformed),
						Status: "running",
					}
					toolCalls = append(toolCalls, tc)
				} else {
					tc := ingest.ToolCall{
						ID:     p.ID,
						Name:   p.Name,
						Input:  string(p.Input),
						Status: "running",
					}
					toolCalls = append(toolCalls, tc)
				}
			} else if (p.Name == "Write" || p.Name == "Edit") && p.Input != nil {
				tc := ingest.ToolCall{
					ID:     p.ID,
					Name:   p.Name,
					Input:  truncateEditInput(p.Input),
					Status: "running",
				}
				toolCalls = append(toolCalls, tc)
			} else {
				input := ""
				if p.Input != nil {
					input = string(p.Input)
				}
				tc := ingest.ToolCall{
					ID:     p.ID,
					Name:   p.Name,
					Input:  ingestkit.TruncateContent(input, 2000),
					Status: "running",
				}
				toolCalls = append(toolCalls, tc)
			}
		}
	}

	text = strings.Join(texts, "\n")
	reasoning = strings.Join(thinkTexts, "\n")
	return text, reasoning, toolCalls
}

func extractToolResultContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try as string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try as content array with text parts
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var texts []string
		for _, p := range parts {
			if p.Type == "text" {
				texts = append(texts, p.Text)
			}
		}
		return strings.Join(texts, "\n")
	}

	return ""
}

func extractUserContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try plain string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try content array (Claude Code sometimes embeds tool_results in user messages)
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var texts []string
		for _, p := range parts {
			if p.Type == "text" {
				texts = append(texts, p.Text)
			}
		}
		return strings.Join(texts, "\n")
	}

	return ""
}

// extractAndMergeToolResults checks if a user message content is actually an array of
// tool_result objects embedded inline (as Claude Code sometimes does). If so, it
// merges the outputs into toolCallsByID and returns true (skip the user message).
func extractAndMergeToolResults(raw json.RawMessage, toolCallsByID map[string]*ingest.ToolCall, parentIsError *bool) bool {
	if len(raw) == 0 {
		return false
	}

	// Try parsing as array of embedded tool results
	var results []embeddedToolResult
	if json.Unmarshal(raw, &results) != nil {
		return false
	}

	// Check if at least one entry is a tool_result
	hasToolResult := false
	for _, r := range results {
		if r.Type == "tool_result" || r.ToolUseID != "" {
			hasToolResult = true
			break
		}
	}
	if !hasToolResult {
		return false
	}

	for _, r := range results {
		if r.ToolUseID == "" {
			continue
		}
		content := ""
		if r.Content != nil {
			content = extractToolResultContent(r.Content)
		}
		isError := parentIsError
		if r.IsError != nil {
			isError = r.IsError
		}
		if tc, ok := toolCallsByID[r.ToolUseID]; ok {
			if content != "" {
				tc.Output = truncateToolOutput(content, tc.Name)
			}
			if isError != nil && *isError {
				tc.Status = "failed"
			} else {
				tc.Status = "completed"
			}
		}
	}

	return true
}

// handleProgressEvent processes agent_progress events that carry Task tool results.
// These events contain the sub-agent's tool results and metadata linking back to
// the parent Task tool call via parentToolUseID.
func handleProgressEvent(line []byte, toolCallsByID map[string]*ingest.ToolCall, parentSID string) {
	var prog claudeProgressEnvelope
	if err := json.Unmarshal(line, &prog); err != nil {
		return
	}
	if prog.ParentToolUseID == "" || prog.Data == nil {
		return
	}
	tc, ok := toolCallsByID[prog.ParentToolUseID]
	if !ok {
		return
	}

	// Set sessionId metadata from the sub-agent ID
	if prog.Data.AgentID != "" {
		setToolMetadataSessionID(tc, parentSID, prog.Data.AgentID)
	}

	// Mark the task tool as completed
	tc.Status = "completed"

	// Extract content from the embedded tool result in the progress event
	if len(prog.Data.Message) == 0 {
		return
	}
	var wrapper progressMessageWrapper
	if json.Unmarshal(prog.Data.Message, &wrapper) != nil {
		return
	}
	if wrapper.Message == nil || len(wrapper.Message.Content) == 0 {
		return
	}
	content := extractToolResultContent(wrapper.Message.Content)
	if content == "" {
		return
	}
	tc.Output = truncateToolOutput(content, tc.Name)
}

// truncateEditInput truncates only the content payload fields inside a Write/Edit
// tool call's JSON input, keeping the JSON valid so the frontend can still parse
// structural fields like file_path, old_str, new_str.
func truncateEditInput(raw json.RawMessage) string {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return ingestkit.TruncateContent(string(raw), maxContentBytes)
	}
	changed := false
	for _, key := range []string{"content", "new_str", "newStr", "old_str", "oldStr"} {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok && len(s) > maxContentBytes {
				m[key] = s[:maxContentBytes] + "\n… (truncated)"
				changed = true
			}
		}
	}
	if !changed {
		return string(raw)
	}
	result, err := json.Marshal(m)
	if err != nil {
		slog.Warn("failed to marshal truncated content", "error", err)
		return "{}"
	}
	return string(result)
}

// extractPlanContent extracts plan markdown from an ExitPlanMode tool_use input.
// Claude Code stores the plan under "plan", "content", or "summary" keys.
func extractPlanContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	for _, key := range []string{"plan", "content", "summary"} {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}
