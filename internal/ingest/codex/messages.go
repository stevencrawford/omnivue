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
	var pendingUsage *ingest.ToolUsage
	var lastTotalInput, lastTotalOutput, lastTotalCached int
	var haveLastTotal bool

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
					Name:   ingestkit.CanonicalizeToolName(pl.Name),
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
					Name:   ingestkit.CanonicalizeToolName(pl.Name),
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

				// Attribute the turn's token usage down to its tool calls. Codex reports
				// per-turn usage via token_count events, which is applied here to the
				// tool calls collected since the last attribution.
				if pendingUsage != nil && len(msg.ToolCalls) > 0 {
					msg.TokensInput = pendingUsage.Tokens.Input
					msg.TokensOutput = pendingUsage.Tokens.Output
					for i := range msg.ToolCalls {
						msg.ToolCalls[i].Usage = pendingUsage
					}
				}

				messages = append(messages, msg)
				toolCallsByID = make(map[string]*ingest.ToolCall)
				pendingUsage = nil

			case "token_count":
				if pl.Info == nil || pl.Info.TotalTokenUsage == nil {
					break
				}
				u := pl.Info.TotalTokenUsage
				// TotalTokenUsage is cumulative across the session. Convert to per-turn
				// delta for attribution, handling counter rebases (smaller than previous)
				// the same way Copilot's shutdown interval does.
				curIn := u.InputTokens
				curOut := u.OutputTokens
				curCached := u.CachedInputTokens
				var deltaIn, deltaOut, deltaCached int
				if haveLastTotal {
					if curIn >= lastTotalInput {
						deltaIn = curIn - lastTotalInput
					} else {
						deltaIn = curIn
					}
					if curOut >= lastTotalOutput {
						deltaOut = curOut - lastTotalOutput
					} else {
						deltaOut = curOut
					}
					if curCached >= lastTotalCached {
						deltaCached = curCached - lastTotalCached
					} else {
						deltaCached = curCached
					}
				} else {
					deltaIn = curIn
					deltaOut = curOut
					deltaCached = curCached
				}
				lastTotalInput = curIn
				lastTotalOutput = curOut
				lastTotalCached = curCached
				haveLastTotal = true
				if pendingUsage != nil {
					pendingUsage.Tokens.Input += deltaIn
					pendingUsage.Tokens.Output += deltaOut
					pendingUsage.Tokens.CacheRead += deltaCached
				} else {
					pendingUsage = &ingest.ToolUsage{
						Tokens: ingest.StepTokens{
							Input:     deltaIn,
							Output:    deltaOut,
							CacheRead: deltaCached,
						},
						Source: ingest.UsageMessage,
					}
				}

			case "task_complete":
				summaryBytes, err := json.Marshal(pl.Message)
				if err != nil {
					slog.Warn("failed to marshal summary", "error", err)
					summaryBytes = []byte("{}")
				}
				tc := &ingest.ToolCall{
					ID:       pl.TurnID,
					Name:     "task_complete",
					Status:   ingest.ToolCallCompleted,
					Output:   "completed",
					Duration: pl.DurationMs,
					Input:    fmt.Sprintf(`{"turn_id":%q,"completed_at":%d,"duration_ms":%d,"summary":%s,"success":%v}`, pl.TurnID, pl.CompletedAt, pl.DurationMs, string(summaryBytes), pl.Success),
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
