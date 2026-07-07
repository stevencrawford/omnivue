package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parseMessages(fpath, sessionID)
}

func (a *Adapter) parseMessages(fpath, sessionID string) ([]ingest.Message, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ingest.Message
	toolCallsByID := make(map[string]*ingest.ToolCall)
	hasDeveloperContent := false

	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "response_item":
			var pl responseItemPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}

			switch pl.Type {
			case "message":
				msg := ingest.Message{
					Timestamp: ingestkit.ParseTime(env.Timestamp),
				}

				switch pl.Role {
				case "user":
					msg.Role = ingest.MessageRoleUser
					content := extractContentText(pl.Content)
					content, msg.Metadata = normalizeUserContent(content)
					msg.Content = content
					messages = append(messages, msg)

				case "assistant":
					msg.Role = ingest.MessageRoleAssistant
					msg.Content = extractContentText(pl.Content)

					var msgToolCalls []ingest.ToolCall
					for _, tc := range toolCallsByID {
						msgToolCalls = append(msgToolCalls, *tc)
					}
					msg.ToolCalls = msgToolCalls

					messages = append(messages, msg)
					toolCallsByID = make(map[string]*ingest.ToolCall)

				case "developer":
					if !hasDeveloperContent {
						hasDeveloperContent = true
						msg := ingest.Message{
							Role:      ingest.MessageRoleSystem,
							Content:   extractContentText(pl.Content),
							Timestamp: ingestkit.ParseTime(env.Timestamp),
						}
						messages = append(messages, msg)
					}
				}

			case "function_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Arguments,
					Status: ingest.ToolCallRunning,
				}
				normalizeBashInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "function_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = ingest.ToolCallCompleted
					normalizeBashOutput(tc)
				}

			case "custom_tool_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Input,
					Status: ingest.ToolCallRunning,
				}
				normalizeEditInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "custom_tool_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = ingest.ToolCallCompleted
				}
			}

		case "event_msg":
			var pl eventMsgPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}

			switch pl.Type {
			case "user_message":
				content := pl.Message
				normalized, meta := normalizeUserContent(content)
				msg := ingest.Message{
					Role:      ingest.MessageRoleUser,
					Content:   normalized,
					Metadata:  meta,
					Timestamp: ingestkit.ParseTime(env.Timestamp),
				}
				messages = append(messages, msg)

			case "agent_message":
				msg := ingest.Message{
					Role:      ingest.MessageRoleAssistant,
					Content:   pl.Message,
					Timestamp: ingestkit.ParseTime(env.Timestamp),
				}
				var msgToolCalls []ingest.ToolCall
				for _, tc := range toolCallsByID {
					msgToolCalls = append(msgToolCalls, *tc)
				}
				msg.ToolCalls = msgToolCalls
				messages = append(messages, msg)
				toolCallsByID = make(map[string]*ingest.ToolCall)

			case "task_complete":
				summaryBytes, err := json.Marshal(pl.Message)
				if err != nil {
					slog.Warn("failed to marshal summary", "error", err)
					summaryBytes = []byte("{}")
				}
				tc := &ingest.ToolCall{
					ID:     pl.TurnID,
					Name:   "task_complete",
					Status: ingest.ToolCallCompleted,
					Output: "completed",
					Input:  fmt.Sprintf(`{"turn_id":%q,"completed_at":%d,"duration_ms":%d,"summary":%s,"success":%v}`, pl.TurnID, pl.CompletedAt, pl.DurationMs, string(summaryBytes), pl.Success),
				}
				toolCallsByID[pl.TurnID] = tc
			}
		}
	}

	if len(toolCallsByID) > 0 {
		var msgToolCalls []ingest.ToolCall
		for _, tc := range toolCallsByID {
			msgToolCalls = append(msgToolCalls, *tc)
		}
		messages = append(messages, ingest.Message{
			Role:      ingest.MessageRoleAssistant,
			ToolCalls: msgToolCalls,
			Timestamp: time.Now(),
		})
	}

	messages = dedupMessages(messages)

	slices.SortFunc(messages, func(a, b ingest.Message) int {
		return a.Timestamp.Compare(b.Timestamp)
	})

	return messages, nil
}

func dedupMessages(messages []ingest.Message) []ingest.Message {
	if len(messages) < 2 {
		return messages
	}
	var result []ingest.Message
	seen := make(map[string]bool)
	for _, m := range messages {
		key := string(m.Role) + "|" + m.Content
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, m)
	}
	return result
}

func extractContentText(content []responseContent) string {
	var parts []string
	for _, c := range content {
		if c.Text != "" {
			parts = append(parts, c.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func normalizeUserContent(content string) (string, map[string]string) {
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, "<turn_aborted>") {
		end := strings.Index(trimmed, "</turn_aborted>")
		if end >= 0 {
			inner := trimmed[len("<turn_aborted>"):end]
			return strings.TrimSpace(inner), map[string]string{"type": "turn_aborted"}
		}
	}
	return content, nil
}
