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
	var todoState = newTodoState(a.basePath, sessionID)

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
				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, *msg)
				} else {
					messages = append(messages, *msg)
				}
			}

		case "assistant.message":
			if msg := handleAssistantMessage(event, currentModel); msg != nil {
				// Normalize sql to todowrite when query targets the todos table.
				// Instead of parsing the SQL, we query session.db directly for
				// the current todo state and use snapshot-based change detection.
				for i, tc := range msg.ToolCalls {
					if tc.Name == "sql" {
						var args struct {
							Query string `json:"query"`
						}
						if err := json.Unmarshal([]byte(tc.Input), &args); err == nil && args.Query != "" {
							if isTodoQuery(args.Query) {
								if synthesized := todoState.synthesizeInput(); synthesized != "" {
									msg.ToolCalls[i].Name = "todowrite"
									msg.ToolCalls[i].Input = synthesized
								}
							}
						}
					}
				}
				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, *msg)
				} else {
					messages = append(messages, *msg)
				}
			}

		case "tool.execution_complete":
			if data := handleToolComplete(event); data != nil {
				if len(subAgentStack) > 0 {
					updateToolCallResult(&subAgentStack[len(subAgentStack)-1].messages, *data)
				} else {
					updateToolCallResult(&messages, *data)
				}
			}

		case "subagent.started":
			if sa := handleSubAgentStarted(event, messages); sa != nil {
				subAgentStack = append(subAgentStack, sa)
			}

		case "subagent.completed":
			a.handleSubAgentCompleted(sessionID, &subAgentStack, &messages)

		case "system_reminder":
			if msg := handleSystemReminder(event); msg != nil {
				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, *msg)
				} else {
					messages = append(messages, *msg)
				}
			}
		}
	}

	return messages, scanner.Err()
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
		ID:        data.MessageID,
		Role:      ingest.MessageRoleAssistant,
		Content:   data.Content,
		Model:     currentModel,
		Timestamp: ingestkit.ParseTime(event.Timestamp),
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
		if tc.Name == "ask_user" {
			tc.Name = "question"
			tc.Input = normalizeAskUserInput(tc.Input)
		}
		if tc.Name == "atlassian-getJiraIssue" || tc.Name == "atlassian_getJiraIssue" {
			tc.Name = "jira"
		}
		if tc.Name == "apply_patch" {
			tc.Name = "edit"
			var patchText string
			if err := json.Unmarshal(req.Arguments, &patchText); err == nil && patchText != "" {
				filePath := extractCopilotPatchPath(patchText)
				if filePath != "" {
					newInput, err := json.Marshal(map[string]string{
						"filePath": filePath,
						"content":  patchText,
					})
					if err != nil {
						slog.Warn("failed to marshal patch input", "error", err)
						newInput = []byte("{}")
					}
					tc.Input = string(newInput)
				}
			}
		}
		if tc.Name == "create" {
			tc.Name = "write"
			var args struct {
				Path     string `json:"path"`
				FileText string `json:"file_text"`
			}
			if err := json.Unmarshal(req.Arguments, &args); err == nil && args.FileText != "" {
				newInput, err := json.Marshal(map[string]string{
					"filePath": args.Path,
					"content":  args.FileText,
				})
				if err != nil {
					slog.Warn("failed to marshal create input", "error", err)
					newInput = []byte("{}")
				}
				tc.Input = string(newInput)
			}
		}
		if tc.Name == "web_fetch" {
			tc.Name = "webfetch"
		}
		if tc.Name == "read_bash" {
			tc.Name = "bash"
		}
		if tc.Name == "stop_bash" {
			tc.Name = "bash"
		}
		if tc.Name == "read_agent" {
			tc.Name = "task"
		}
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
				ID:        synID,
				ParentID:  sessionID,
				Agent:     ingest.AgentCopilot,
				SubAgent:  sa.agentName,
				Title:     sa.agentDisplay,
				Status:    ingest.SessionStatusCompleted,
				CreatedAt: createdAt,
				UpdatedAt: updatedAt,
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

// normalizeAskUserInput transforms Copilot's ask_user input format
// {question, choices, allow_freeform} to the standard QuestionToolDiff format
// {questions: [{question, header, options: [{label}]}]}.
func normalizeAskUserInput(input string) string {
	var raw struct {
		Question      string   `json:"question"`
		Choices       []string `json:"choices"`
		AllowFreeform bool     `json:"allow_freeform"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil || raw.Question == "" {
		return input
	}
	options := make([]map[string]string, len(raw.Choices))
	for i, c := range raw.Choices {
		options[i] = map[string]string{"label": c}
	}
	transformed := map[string]any{
		"questions": []map[string]any{
			{
				"question": raw.Question,
				"header":   "Question for you",
				"options":  options,
			},
		},
	}
	out, err := json.Marshal(transformed)
	if err != nil {
		slog.Warn("failed to marshal ask_user input", "error", err)
		return "{}"
	}
	return string(out)
}
