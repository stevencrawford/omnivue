package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.findSessionFile(sessionID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}

	return a.loadMessages(fpath)
}

func (a *Adapter) loadMessages(fpath string) ([]ingest.Message, error) {
	scanner, f, err := ingestkit.OpenJSONL(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	if !scanner.Scan() {
		return nil, fmt.Errorf("empty file: %s", fpath)
	}

	var lines []string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}

	var parsed []ingest.Message
	currentModel := ""

	for lineIdx, line := range lines {
		var env piMessageEnvelope
		if err := json.Unmarshal([]byte(line), &env); err != nil {
			continue
		}

		switch env.Type {
		case "model_change":
			if env.ModelID != "" {
				currentModel = env.ModelID
			}

		case "message":
			if env.Message == nil {
				continue
			}
			msg := parseMessage(env, currentModel)
			parsed = append(parsed, msg)
			if msg.Role == ingest.MessageRoleAssistant && len(msg.ToolCalls) > 0 {
				_ = lineIdx // for debugging
			}
		}
	}

	toolCallsByID := make(map[string]*ingest.ToolCall)
	var toolResults []ingest.Message
	for i := range parsed {
		msg := &parsed[i]
		if msg.Role == ingest.MessageRoleAssistant {
			for j := range msg.ToolCalls {
				tc := &msg.ToolCalls[j]
				toolCallsByID[tc.ID] = tc
			}
		}
		if msg.Role == "toolResult" {
			toolResults = append(toolResults, *msg)
		}
	}

	for _, tr := range toolResults {
		tcID := tr.Metadata["toolCallId"]
		if tcID == "" {
			continue
		}
		tc, ok := toolCallsByID[tcID]
		if !ok {
			continue
		}
		tc.Output = tr.Content
		if isErr, ok := tr.Metadata["isError"]; ok && isErr == "true" {
			if tc.Metadata == "" {
				tc.Metadata = `{"isError":true}`
			}
		}
	}

	var messages []ingest.Message
	for _, msg := range parsed {
		if msg.Role == "toolResult" {
			continue
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

func parseMessage(env piMessageEnvelope, currentModel string) ingest.Message {
	msg := ingest.Message{
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
		parts, tcs, reasoning := parseAssistantContent(env.Message.Content)
		msg.Content = parts
		msg.ToolCalls = tcs
		msg.Reasoning = reasoning

		if env.Message.Usage != nil {
			msg.TokensInput = env.Message.Usage.Input
			msg.TokensOutput = env.Message.Usage.Output
		}

	default:
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

	return msg
}

func extractTextContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

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

	return string(raw)
}

func parseAssistantContent(raw json.RawMessage) (text string, toolCalls []ingest.ToolCall, reasoning string) {
	if len(raw) == 0 {
		return "", nil, ""
	}

	var parts []piContentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return string(raw), nil, ""
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
	return text, toolCalls, reasoning
}
