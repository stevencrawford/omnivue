package pi

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

type modelChangeEvent struct {
	timestamp time.Time
	model     string
	provider  string
}

// extractErrorMessage normalizes Pi's error format.
// Pi returns errors as either:
//
//	"Upstream error from Nvidia: ResourceExhausted: ..."           (plain text)
//	"400: {\"message\":\"...\", \"code\":400, \"metadata\":{...}}" (HTTP + JSON body)
func extractErrorMessage(raw string) string {
	if parts := strings.SplitN(raw, ": ", 2); len(parts) == 2 {
		if _, err := strconv.Atoi(parts[0]); err == nil {
			var payload struct {
				Message string `json:"message"`
			}
			if json.Unmarshal([]byte(parts[1]), &payload) == nil && payload.Message != "" {
				return payload.Message
			}
		}
	}
	return raw
}

func (a *Adapter) parsePiMessages(filePath, sessionID string) ([]ingest.Message, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var parsed []ingest.Message
	currentModel := ""
	var modelChanges []modelChangeEvent

	scanner := ingestkit.NewJSONLScanner(f)
	// Skip session header
	if !scanner.Scan() {
		return nil, fmt.Errorf("empty file: %s", filePath)
	}

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env piMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "model_change":
			if env.ModelID != "" {
				currentModel = env.ModelID
				if t, err := time.Parse(time.RFC3339, env.Timestamp); err == nil {
					modelChanges = append(modelChanges, modelChangeEvent{
						timestamp: t,
						model:     env.ModelID,
						provider:  env.Provider,
					})
				}
			}

		case "thinking_level_change":

		case "message":
			if env.Message == nil {
				continue
			}
			msg, err := parseMessage(env, currentModel)
			if err != nil {
				continue
			}
			parsed = append(parsed, msg)
		}
	}

	slices.SortFunc(parsed, func(a, b ingest.Message) int {
		return a.Timestamp.Compare(b.Timestamp)
	})

	// Pass 1: Index all tool calls by ID and collect toolResult messages separately.
	// This avoids the out-of-order edge case where a toolResult appears before its
	// corresponding toolCall in the sorted message list.
	toolCallsByID := make(map[string]*ingest.ToolCall)
	var toolResults []ingest.Message
	for _, msg := range parsed {
		if msg.Role == ingest.MessageRoleAssistant {
			for i := range msg.ToolCalls {
				tc := &msg.ToolCalls[i]
				toolCallsByID[tc.ID] = tc
			}
		}
		if msg.Role == "toolResult" {
			toolResults = append(toolResults, msg)
		}
	}

	// Pass 2: Merge toolResult output into the corresponding ToolCall.Output.
	for _, tr := range toolResults {
		tcID := tr.Metadata["toolCallId"]
		if tcID == "" {
			continue
		}
		tc, ok := toolCallsByID[tcID]
		if !ok {
			log.Printf("pi adapter: orphaned toolResult for toolCallId=%s (no matching tool call found)", tcID)
			continue
		}
		tc.Output = tr.Content
		if envIsError, ok := tr.Metadata["isError"]; ok {
			if tc.Metadata == "" {
				tc.Metadata = `{"isError":` + envIsError + `}`
			}
		}
	}

	// Pass 3: Build final message list, filtering out toolResult messages.
	var messages []ingest.Message
	for _, msg := range parsed {
		if msg.Role == "toolResult" {
			continue
		}
		messages = append(messages, msg)
	}

	// Inject synthesized model_switch tool calls for mid-session model changes.
	// modelChanges[0] is the initial model (set at session start), skip it.
	for i := 1; i < len(modelChanges); i++ {
		mc := modelChanges[i]
		for j := range messages {
			if messages[j].Role == ingest.MessageRoleAssistant && messages[j].Timestamp.After(mc.timestamp) {
				input, err := json.Marshal(map[string]string{
					"model":    mc.model,
					"provider": mc.provider,
				})
				if err != nil {
					break
				}
				tc := ingest.ToolCall{
					ID:     fmt.Sprintf("model-switch-%d", i),
					Name:   "model_switch",
					Input:  string(input),
					Status: ingest.ToolCallCompleted,
				}
				messages[j].ToolCalls = append(messages[j].ToolCalls, tc)
				break
			}
		}
	}

	return messages, nil
}

func parseMessage(env piMessageEnvelope, currentModel string) (ingest.Message, error) {
	msg := ingest.Message{
		ID:    env.ID,
		Role:  ingest.MessageRole(env.Message.Role),
		Model: currentModel,
	}

	if env.Timestamp != "" {
		msg.Timestamp = ingestkit.ParseTime(env.Timestamp)
	}

	if env.Message.Model != "" {
		msg.Model = env.Message.Model
	}

	switch env.Message.Role {
	case "user":
		msg.Content = extractTextContent(env.Message.Content)

	case "assistant":
		parts, tc, reasoning, err := parseAssistantContent(env.Message.Content)
		if err != nil {
			return msg, nil
		}
		msg.Content = parts
		msg.ToolCalls = tc
		msg.Reasoning = reasoning

		// Capture API errors (rate limits, context length, etc.)
		if env.Message.StopReason == "error" && env.Message.ErrorMsg != "" {
			msg.Error = extractErrorMessage(env.Message.ErrorMsg)
		}

		if env.Message.Usage != nil {
			msg.TokensInput = env.Message.Usage.Input
			msg.TokensOutput = env.Message.Usage.Output
		}

	case "toolResult":
		msg.Content = extractTextContent(env.Message.Content)
		if env.Message.ToolCallID != "" {
			md := map[string]string{
				"toolCallId": env.Message.ToolCallID,
				"toolName":   env.Message.ToolName,
			}
			if env.Message.IsError {
				md["isError"] = "true"
			}
			msg.Metadata = md
		}
	}

	return msg, nil
}

// extractTextContent extracts text from a content array like [{"type":"text","text":"..."}]
// or returns the string directly if it's already a plain string.
func extractTextContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try plain string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try array of parts
	var parts []piContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			if p.Type == "text" {
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(p.Text)
			}
		}
		return b.String()
	}

	return ""
}

// parseAssistantContent parses the assistant content array into text, tool calls, and reasoning.
func parseAssistantContent(raw json.RawMessage) (text string, toolCalls []ingest.ToolCall, reasoning string, err error) {
	if len(raw) == 0 {
		return "", nil, "", nil
	}

	var parts []piContentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return string(raw), nil, "", nil
	}

	var textParts []string
	for _, p := range parts {
		switch p.Type {
		case "text":
			textParts = append(textParts, p.Text)
		case "thinking":
			reasoning = p.Thinking
		case "toolCall":
			input := ""
			if p.Arguments != nil {
				input = string(p.Arguments)
			}
			tc := ingest.ToolCall{
				ID:     p.ToolCallID,
				Name:   p.Name,
				Input:  input,
				Status: ingest.ToolCallCompleted,
			}
			normalizeToolCall(&tc)
			toolCalls = append(toolCalls, tc)
		}
	}

	text = strings.Join(textParts, "\n")
	return text, toolCalls, reasoning, nil
}

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
		// Unrecognized name — leave as-is; frontend's effectiveToolKind()
		// may still infer the kind from input field presence.
		return
	}

	if tc.Input == "" {
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	// Normalize field names within the input JSON to match frontend conventions.
	switch tc.Name {
	case "read":
		// Pi may use "path", "file", "file_path" for the file path
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
		// Pi read output format: {"content":"...","filePath":"..."}
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
		// Pi may use "new_content", "content", "updated_content" for new string
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
			// Keep "content" field — the frontend and parsePiEditContent
			// both read "content" for write tool calls.
		}
		// Pi may use "old_content" for old string
		if v, ok := p["old_content"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "old_content")
		}

		// Pi edit calls use an "edits" array of {oldText, newText} pairs.
		// Flatten it into oldString/newString so the frontend's EditToolDiff can render diffs.
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
		// Pi bash output: {"stdout":"...","stderr":"...","exitCode":N}
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
		// Pi glob uses standard "pattern" and "directory" fields
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}
