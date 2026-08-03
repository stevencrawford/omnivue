package copilot

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) messagesFromEvents(sessionID string) ([]ingest.Message, error) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ingest.Message
	var currentModel string
	var subAgentStack []*subAgentState
	var todoState = newTodoState()
	var shutdownSnapshots []shutdownSnapshot
	var pendingReasoning string

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		var event eventEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}

		switch event.Type {
		case "session.model_change":
			if m := handleModelChange(event); m != "" {
				currentModel = m
			}

		case "user.message":
			if msg := handleUserMessage(event); msg != nil {
				if cleaned, ok := stripSystemReminder(msg.Content); ok {
					msg.Content = cleaned
					msg.Metadata = map[string]string{"type": "system_reminder_inline"}
				}
				target := routeTarget(event, subAgentStack, &messages)
				*target = append(*target, *msg)
			}

		case "assistant.message":
			var asstData assistantMessageData
			if json.Unmarshal(event.Data, &asstData) != nil {
				break
			}
			if asstData.Phase == "thinking" && asstData.Content != "" {
				if pendingReasoning == "" {
					pendingReasoning = asstData.Content
				}
				break
			}
			if msg := handleAssistantMessage(event, currentModel); msg != nil {
				switch {
				case asstData.ReasoningText != "":
					msg.Reasoning = asstData.ReasoningText
				case pendingReasoning != "":
					msg.Reasoning = pendingReasoning
					pendingReasoning = ""
				}
				for i := range msg.ToolCalls {
					normalizeSQLToTodoWrite(&msg.ToolCalls[i], todoState)
				}
				target := routeTarget(event, subAgentStack, &messages)
				*target = append(*target, *msg)
			}

		case "tool.execution_complete":
			if data := handleToolComplete(event); data != nil {
				updateToolCallResult(routeTarget(event, subAgentStack, &messages), *data)
			}

		case "subagent.started":
			if sa := handleSubAgentStarted(event, messages); sa != nil {
				subAgentStack = append(subAgentStack, sa)
			}

		case "subagent.completed":
			a.handleSubAgentCompleted(sessionID, &subAgentStack, &messages)

		case "subagent.failed":
			a.handleSubAgentFailed(&subAgentStack)

		case "system_reminder":
			if msg := handleSystemReminder(event); msg != nil {
				target := routeTarget(event, subAgentStack, &messages)
				*target = append(*target, *msg)
			}

		case "session.shutdown":
			if snap := parseShutdownSnapshot(event); snap != nil {
				if len(shutdownSnapshots) > 0 {
					prev := shutdownSnapshots[len(shutdownSnapshots)-1]
					dInput := snap.TokensInput - prev.TokensInput
					dOutput := snap.TokensOutput - prev.TokensOutput
					dReasoning := snap.TokensReasoning - prev.TokensReasoning
					dCache := snap.TokensCacheRead - prev.TokensCacheRead
					dCost := snap.Cost - prev.Cost
					if dInput > 0 || dOutput > 0 || dReasoning > 0 || dCache > 0 {
						delta := ingest.StepEvent{
							Step: ingest.StepEventFinish,
							Tokens: ingest.StepTokens{
								Input:     max(dInput, 0),
								Output:    max(dOutput, 0),
								Reasoning: max(dReasoning, 0),
								CacheRead: max(dCache, 0),
							},
							Cost: max(dCost, 0),
						}
						for i := range slices.Backward(messages) {
							if messages[i].Role == ingest.MessageRoleAssistant {
								messages[i].StepEvents = append(messages[i].StepEvents, delta)
								break
							}
						}
					}
				}
				shutdownSnapshots = append(shutdownSnapshots, *snap)
			}
		}
	}

	messages = mergeSkillFollowUps(messages)
	return messages, scanner.Err()
}

// mergeSkillFollowUps merges the text content of an assistant message that
// immediately follows a message containing a skill tool call into the skill
// tool call's Output. The follow-up message is then removed from the result.
func mergeSkillFollowUps(messages []ingest.Message) []ingest.Message {
	if len(messages) < 2 {
		return messages
	}
	result := make([]ingest.Message, 0, len(messages))
	skipNext := false
	for i := range messages {
		if skipNext {
			skipNext = false
			continue
		}
		msg := messages[i]
		hasSkill := false
		for j := range msg.ToolCalls {
			if msg.ToolCalls[j].Name == "skill" {
				hasSkill = true
				break
			}
		}
		if hasSkill && i+1 < len(messages) {
			next := messages[i+1]
			if next.Role == ingest.MessageRoleAssistant && len(next.ToolCalls) == 0 && next.Content != "" {
				for j := range msg.ToolCalls {
					if msg.ToolCalls[j].Name == "skill" {
						if msg.ToolCalls[j].Output != "" {
							msg.ToolCalls[j].Output += "\n\n" + next.Content
						} else {
							msg.ToolCalls[j].Output = next.Content
						}
						break
					}
				}
				skipNext = true
			}
		}
		result = append(result, msg)
	}
	return result
}

func handleModelChange(event eventEnvelope) string {
	var data modelChangeData
	if json.Unmarshal(event.Data, &data) != nil {
		return ""
	}
	return data.NewModel
}

func handleUserMessage(event eventEnvelope) *ingest.Message {
	var data userMessageData
	if json.Unmarshal(event.Data, &data) != nil {
		return nil
	}
	return &ingest.Message{
		ID:        event.ID,
		Role:      ingest.MessageRoleUser,
		Content:   data.Content,
		Timestamp: ingestkit.ParseTime(event.Timestamp),
	}
}

func handleAssistantMessage(event eventEnvelope, currentModel string) *ingest.Message {
	var data assistantMessageData
	if json.Unmarshal(event.Data, &data) != nil {
		return nil
	}
	msg := ingest.Message{
		ID:           data.MessageID,
		Role:         ingest.MessageRoleAssistant,
		Content:      data.Content,
		Model:        currentModel,
		Timestamp:    ingestkit.ParseTime(event.Timestamp),
		TokensOutput: data.OutputTokens,
	}

	for _, req := range data.ToolRequests {
		inputJSON, err := json.Marshal(req.Arguments)
		if err != nil {
			slog.Warn("failed to marshal arguments", "error", err)
			inputJSON = []byte("{}")
		}
		tc := ingest.ToolCall{
			ID:     req.ToolCallID,
			Name:   req.Name,
			Input:  string(inputJSON),
			Status: ingest.ToolCallRunning,
		}
		normalizeToolCall(&tc, req.Arguments)
		msg.ToolCalls = append(msg.ToolCalls, tc)
	}

	return &msg
}

func handleToolComplete(event eventEnvelope) *toolCompleteData {
	var data toolCompleteData
	if json.Unmarshal(event.Data, &data) != nil {
		return nil
	}
	return &data
}

func handleSubAgentStarted(event eventEnvelope, messages []ingest.Message) *subAgentState {
	var data subAgentStartedData
	if json.Unmarshal(event.Data, &data) != nil || data.ToolCallID == "" {
		return nil
	}
	sa := &subAgentState{
		agentID:       event.AgentID,
		toolCallID:    data.ToolCallID,
		agentName:     data.AgentName,
		agentDisplay:  data.AgentDisplayName,
		parentMsgIdx:  -1,
		parentToolIdx: -1,
	}
	for i := range slices.Backward(messages) {
		msg := &messages[i]
		for j := range msg.ToolCalls {
			if msg.ToolCalls[j].ID == data.ToolCallID {
				sa.parentMsgIdx = i
				sa.parentToolIdx = j
				break
			}
		}
		if sa.parentMsgIdx >= 0 {
			break
		}
	}
	return sa
}

// routeTarget returns the message slice that an event should be routed into.
// Events produced by the active sub-agent (matching its agentID) go into that
// sub-agent's buffer; all other events — including main-agent messages that
// interleave while a background sub-agent is running — belong to the main
// conversation. Routing by agent identity (rather than stack depth) ensures a
// concurrently running sub-agent never swallows the main conversation.
func routeTarget(event eventEnvelope, subAgentStack []*subAgentState, messages *[]ingest.Message) *[]ingest.Message {
	if event.AgentID == "" {
		return messages
	}
	for i := range slices.Backward(subAgentStack) {
		if subAgentStack[i].agentID == event.AgentID {
			return &subAgentStack[i].messages
		}
	}
	return messages
}

func (a *Adapter) handleSubAgentCompleted(sessionID string, subAgentStack *[]*subAgentState, messages *[]ingest.Message) {
	if len(*subAgentStack) == 0 {
		return
	}
	sa := (*subAgentStack)[len(*subAgentStack)-1]
	*subAgentStack = (*subAgentStack)[:len(*subAgentStack)-1]

	synID := fmt.Sprintf("%s-sub-%s-%s", sessionID, sa.agentName, sa.toolCallID)
	if len(synID) > 100 {
		synID = synID[:100]
	}

	if len(sa.messages) > 0 {
		createdAt := sa.messages[0].Timestamp
		updatedAt := sa.messages[len(sa.messages)-1].Timestamp

		syn := &syntheticSession{
			session: ingest.Session{
				ID:           synID,
				ParentID:     sessionID,
				Agent:        ingest.AgentCopilot,
				SubAgent:     sa.agentName,
				Title:        sa.agentDisplay,
				Status:       ingest.SessionStatusCompleted,
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
				MessageCount: len(sa.messages),
			},
			messages: sa.messages,
		}

		a.mu.Lock()
		a.syntheticSessions[synID] = syn
		a.mu.Unlock()
	}

	if sa.parentMsgIdx >= 0 && sa.parentToolIdx >= 0 && sa.parentMsgIdx < len(*messages) {
		parentMsg := &(*messages)[sa.parentMsgIdx]
		if sa.parentToolIdx < len(parentMsg.ToolCalls) {
			tc := &parentMsg.ToolCalls[sa.parentToolIdx]
			meta := make(map[string]string)
			if tc.Metadata != "" {
				if err := json.Unmarshal([]byte(tc.Metadata), &meta); err != nil {
					slog.Warn("failed to unmarshal metadata", "error", err)
				}
			}
			meta["sessionId"] = synID
			metaBytes, err := json.Marshal(meta)
			if err != nil {
				slog.Warn("failed to marshal metadata", "error", err)
				metaBytes = []byte("{}")
			}
			tc.Metadata = string(metaBytes)
		}
	}
}

// handleSubAgentFailed pops a sub-agent's buffered state after the agent
// reports a failure via a subagent.failed event. Unlike a completed subagent,
// a failed one produces no usable transcript, so its buffered messages are
// discarded and no synthetic session is created. Popping the stack is required
// to release the parent conversation so its subsequent messages are no longer
// routed into the sub-agent's buffer.
func (a *Adapter) handleSubAgentFailed(subAgentStack *[]*subAgentState) {
	if len(*subAgentStack) == 0 {
		return
	}
	*subAgentStack = (*subAgentStack)[:len(*subAgentStack)-1]
}

func handleSystemReminder(event eventEnvelope) *ingest.Message {
	var data systemReminderData
	if json.Unmarshal(event.Data, &data) != nil {
		return nil
	}
	fileName := "AGENTS.md"
	if data.File != "" {
		fileName = data.File
	}
	return &ingest.Message{
		ID:        event.ID,
		Role:      ingest.MessageRoleSystem,
		Content:   data.Content,
		Timestamp: ingestkit.ParseTime(event.Timestamp),
		Metadata: map[string]string{
			"type": "system_reminder",
			"file": fileName,
		},
	}
}

// parseShutdownSnapshot extracts cumulative token/cost data from a session.shutdown event.
func parseShutdownSnapshot(event eventEnvelope) *shutdownSnapshot {
	var data struct {
		ModelMetrics map[string]*struct {
			Requests *struct {
				Cost float64 `json:"cost"`
			} `json:"requests"`
			Usage *struct {
				InputTokens      int `json:"inputTokens"`
				OutputTokens     int `json:"outputTokens"`
				ReasoningTokens  int `json:"reasoningTokens"`
				CacheReadTokens  int `json:"cacheReadTokens"`
				CacheWriteTokens int `json:"cacheWriteTokens"`
			} `json:"usage"`
		} `json:"modelMetrics"`
	}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		return nil
	}
	snap := &shutdownSnapshot{
		Timestamp: event.Timestamp,
	}
	for _, m := range data.ModelMetrics {
		if m.Requests != nil {
			snap.Cost += m.Requests.Cost
		}
		if m.Usage != nil {
			snap.TokensInput += m.Usage.InputTokens
			snap.TokensOutput += m.Usage.OutputTokens
			snap.TokensReasoning += m.Usage.ReasoningTokens
			snap.TokensCacheRead += m.Usage.CacheReadTokens
		}
	}
	return snap
}

// updateToolCallResult finds the tool call by ID and updates its output/status.
func updateToolCallResult(messages *[]ingest.Message, data toolCompleteData) {
	for i := range slices.Backward(*messages) {
		msg := &(*messages)[i]
		for j := range msg.ToolCalls {
			if msg.ToolCalls[j].ID == data.ToolCallID {
				if data.Success {
					msg.ToolCalls[j].Status = ingest.ToolCallCompleted
				} else {
					msg.ToolCalls[j].Status = ingest.ToolCallFailed
				}
				if data.Result.Content != "" {
					msg.ToolCalls[j].Output = data.Result.Content
				} else if data.Result.DetailedContent != "" {
					msg.ToolCalls[j].Output = data.Result.DetailedContent
				}
				if data.Model != "" {
					msg.Model = data.Model
				}
				return
			}
		}
	}
}

// stripSystemReminder detects user messages containing <system_reminder> tags
// (e.g. injected by Copilot for MCP server configuration) and strips them,
// returning the cleaned content. If no tags are found, ok is false.
func stripSystemReminder(content string) (string, bool) {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "<system_reminder>") {
		return content, false
	}
	cleaned := trimmed
	cleaned = strings.TrimPrefix(cleaned, "<system_reminder>")
	cleaned = strings.TrimSuffix(cleaned, "</system_reminder>")
	cleaned = strings.TrimSpace(cleaned)
	return cleaned, true
}

// extractCopilotPatchPath extracts the file path from apply_patch text.
// Format: "*** Begin Patch\n*** Update File: <path>\n...\n*** End Patch".
func extractCopilotPatchPath(patch string) string {
	for _, prefix := range []string{"*** Update File: ", "*** Add File: ", "*** Modify File: "} {
		if _, after, found := strings.Cut(patch, prefix); found {
			rest := after
			if nl := strings.IndexAny(rest, "\n\r"); nl >= 0 {
				return strings.TrimSpace(rest[:nl])
			}
			return strings.TrimSpace(rest)
		}
	}
	return ""
}
