package claudecode

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "Read":
		tc.Name = "read"
	case "Write":
		tc.Name = "write"
	case "Edit":
		tc.Name = "edit"
	case "Bash":
		tc.Name = "bash"
	case "Glob":
		tc.Name = "glob"
	case "Grep":
		tc.Name = "grep"
	case "Task":
		tc.Name = "task"
	case "ExitPlanMode":
		tc.Name = "exit_plan_mode"
	case "Delete":
		tc.Name = "delete"
	case "WebFetch":
		tc.Name = "webfetch"
	case "WebSearch":
		tc.Name = "websearch"
	default:
		normalizeClaudeInternalTool(tc)
	}
}

// normalizeClaudeInternalTool handles Claude Code internal tool names that
// originate from harness tool definitions rather than standard tool calls.
func normalizeClaudeInternalTool(tc *ingest.ToolCall) {
	switch tc.Name {
	case "TaskCreate":
		tc.Name = "todowrite"
		normalizeTaskCreateInput(tc)
	case "TaskUpdate":
		tc.Name = "todowrite"
		normalizeTaskUpdateInput(tc)
	case "Agent":
		// Agent launches a sub-agent — maps to "task" for frontend rendering.
		// Metadata["sessionId"] carries the sub-agent ID for disambiguation.
		tc.Name = "task"
	case "TaskOutput":
		tc.Name = "task_complete"
	default:
		// Strip harness prefix (e.g., "Bash:Bash" → "Bash"), then lowercase
		// so the result is consistent with main normalizeToolCall switch cases.
		if idx := strings.Index(tc.Name, ":"); idx > 0 && idx+1 < len(tc.Name) && tc.Name[:idx] == tc.Name[idx+1:] {
			tc.Name = strings.ToLower(tc.Name[:idx])
		}
	}
}

// normalizeTaskCreateInput transforms TaskCreate input to todowrite format.
// Input:  {"subject":"...", "description":"...", "activeForm":"..."}
// Output: {"todos":[{"content":"<subject>","status":"pending","priority":"medium","id":""}]}.
func normalizeTaskCreateInput(tc *ingest.ToolCall) {
	var input struct {
		Subject string `json:"subject"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if input.Subject == "" {
		return
	}
	todos := []map[string]string{{
		"content":  input.Subject,
		"status":   "pending",
		"priority": "medium",
		"id":       "",
	}}
	transformed, err := json.Marshal(map[string]any{"todos": todos})
	if err != nil {
		return
	}
	tc.Input = string(transformed)
}

// normalizeTaskUpdateInput transforms TaskUpdate input to todowrite format.
// Input:  {"taskId":"1","status":"in_progress"}
// Output: {"todos":[{"content":"","status":"in_progress","priority":"medium","id":"1"}]}.
// The content is left empty so postProcessToolCalls can fill it from the
// matching TaskCreate's subject, avoiding a placeholder round-trip.
func normalizeTaskUpdateInput(tc *ingest.ToolCall) {
	var input struct {
		TaskID string `json:"taskId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if input.TaskID == "" {
		return
	}
	status := input.Status
	if status == "" {
		status = "in_progress"
	}
	todos := []map[string]string{{
		"content":  "",
		"status":   status,
		"priority": "medium",
		"id":       input.TaskID,
	}}
	transformed, err := json.Marshal(map[string]any{"todos": todos})
	if err != nil {
		return
	}
	tc.Input = string(transformed)
}

// postProcessToolCalls performs cross-tool-call fixups after normalization:
// 1. Replaces empty content in todowrite updates with the actual task subject.
// 2. Merges task_complete output into the matching task card and strips XML wrapper.
// 3. Drops consumed task_complete tool calls.
// 4. Accumulates all sequential todowrite calls into one at end of conversation.
func postProcessToolCalls(messages []ingest.Message) {
	var taskCounter int
	type taskSubjectEntry struct {
		subject string
		used    bool
	}
	taskSubjects := make(map[int]*taskSubjectEntry)
	taskCompleteByID := make(map[string]*ingest.ToolCall)

	for i := range messages {
		for j := range messages[i].ToolCalls {
			tc := &messages[i].ToolCalls[j]

			if tc.Name == "todowrite" {
				var input struct {
					Todos []struct {
						Content string `json:"content"`
						ID      string `json:"id"`
					} `json:"todos"`
				}
				if json.Unmarshal([]byte(tc.Input), &input) != nil {
					continue
				}
				for _, t := range input.Todos {
					if t.ID == "" && t.Content != "" {
						taskCounter++
						taskSubjects[taskCounter] = &taskSubjectEntry{subject: t.Content}
					}
				}
				continue
			}

			if tc.Name == "task_complete" {
				var input struct {
					TaskID string `json:"task_id"`
				}
				if json.Unmarshal([]byte(tc.Input), &input) == nil && input.TaskID != "" {
					taskCompleteByID[input.TaskID] = tc
				}
			}
		}
	}

	// Second pass: fill todowrite content and merge task/task_complete.
	for i := range messages {
		for j := range messages[i].ToolCalls {
			tc := &messages[i].ToolCalls[j]

			if tc.Name == "todowrite" {
				var input struct {
					Todos []struct {
						Content  string `json:"content"`
						ID       string `json:"id"`
						Status   string `json:"status,omitempty"`
						Priority string `json:"priority,omitempty"`
					} `json:"todos"`
				}
				if json.Unmarshal([]byte(tc.Input), &input) != nil {
					continue
				}
				changed := false
				for k, t := range input.Todos {
					if t.ID == "" {
						continue
					}
					if t.Content != "" {
						continue
					}
					idx := 0
					if _, err := fmt.Sscanf(t.ID, "%d", &idx); err != nil {
						continue
					}
					if entry, ok := taskSubjects[idx]; ok && entry.subject != "" {
						input.Todos[k].Content = entry.subject
						entry.used = true
						changed = true
					}
				}
				if changed {
					data, err := json.Marshal(map[string]any{"todos": input.Todos})
					if err == nil {
						tc.Input = string(data)
					}
				}
				continue
			}

			if tc.Name != "task" {
				continue
			}
			agentID := extractAgentIDFromOutput(tc)
			if agentID == "" {
				agentID = extractAgentIDFromMetadata(tc)
			}
			if agentID == "" {
				continue
			}
			if taskTC, ok := taskCompleteByID[agentID]; ok && taskTC.Output != "" {
				tc.Output = extractOutputContent(taskTC.Output)
				taskTC.Name = "" // mark consumed
			}
		}
	}

	// Third pass: accumulate consecutive todowrites and drop consumed task_complete.
	// When a non-todowrite tool call interrupts, flush the accumulated todowrite
	// at that position in the tool call sequence.
	type todoItem struct {
		Content  string `json:"content"`
		ID       string `json:"id"`
		Status   string `json:"status,omitempty"`
		Priority string `json:"priority,omitempty"`
	}
	var masterTodos []todoItem
	createIdxMap := make(map[int]int)
	var pendingTodos []todoItem

	for i := range messages {
		filtered := make([]ingest.ToolCall, 0, len(messages[i].ToolCalls))

		flushPending := func() {
			if len(pendingTodos) == 0 {
				return
			}
			data, err := json.Marshal(map[string]any{"todos": pendingTodos})
			if err != nil {
				pendingTodos = nil
				return
			}
			filtered = append(filtered, ingest.ToolCall{
				ID:     "todowrite-merged",
				Name:   "todowrite",
				Input:  string(data),
				Output: string(data),
				Status: ingest.ToolCallCompleted,
			})
			pendingTodos = nil
		}

		for _, tc := range messages[i].ToolCalls {
			switch tc.Name {
			case "":
				continue
			case "todowrite":
				var input struct {
					Todos []todoItem `json:"todos"`
				}
				if json.Unmarshal([]byte(tc.Input), &input) != nil {
					flushPending()
					filtered = append(filtered, tc)
					continue
				}
				for _, t := range input.Todos {
					if t.ID == "" {
						idx := len(masterTodos)
						masterTodos = append(masterTodos, t)
						createIdxMap[idx+1] = idx
						pendingTodos = append(pendingTodos, t)
					} else {
						id := 0
						if _, err := fmt.Sscanf(t.ID, "%d", &id); err != nil {
							continue
						}
						if idx, ok := createIdxMap[id]; ok && idx < len(masterTodos) {
							masterTodos[idx].Status = t.Status
							if t.Content != "" {
								masterTodos[idx].Content = t.Content
							}
							masterTodos[idx].ID = t.ID
							found := false
							for k, pt := range pendingTodos {
								if pt.ID == t.ID {
									pendingTodos[k].Status = t.Status
									found = true
									break
								}
							}
							if !found && idx < len(pendingTodos) && pendingTodos[idx].ID == "" {
								pendingTodos[idx].Status = t.Status
								pendingTodos[idx].ID = t.ID
								if t.Content != "" {
									pendingTodos[idx].Content = t.Content
								}
								found = true
							}
							if !found {
								pendingTodos = append(pendingTodos, masterTodos[idx])
							}
						} else {
							masterTodos = append(masterTodos, t)
							pendingTodos = append(pendingTodos, t)
						}
					}
				}
				continue
			default:
				flushPending()
				filtered = append(filtered, tc)
			}
		}
		messages[i].ToolCalls = filtered
	}

	// Flush remaining pending to the last tool-call-bearing message
	if len(pendingTodos) > 0 {
		data, err := json.Marshal(map[string]any{"todos": pendingTodos})
		if err != nil {
			return
		}
		for i := range slices.Backward(messages) {
			if len(messages[i].ToolCalls) > 0 {
				messages[i].ToolCalls = append(messages[i].ToolCalls, ingest.ToolCall{
					ID:     "todowrite-merged",
					Name:   "todowrite",
					Input:  string(data),
					Output: string(data),
					Status: ingest.ToolCallCompleted,
				})
				break
			}
		}
	}
}

// agentIDRx extracts the agent ID from the launch confirmation text.
var agentIDRx = regexp.MustCompile(`agentId:\s*(\S+)`)

func extractAgentIDFromOutput(tc *ingest.ToolCall) string {
	matches := agentIDRx.FindStringSubmatch(tc.Output)
	if len(matches) == 2 {
		return matches[1]
	}
	return ""
}

// extractAgentIDFromMetadata extracts the agent ID from a task tool call's metadata sessionId.
// The sessionId has the format: parentSID-agent-AGENTID.
func extractAgentIDFromMetadata(tc *ingest.ToolCall) string {
	if tc.Metadata == "" {
		return ""
	}
	var md map[string]string
	if err := json.Unmarshal([]byte(tc.Metadata), &md); err != nil {
		return ""
	}
	sid, ok := md["sessionId"]
	if !ok || sid == "" {
		return ""
	}
	parts := strings.Split(sid, "-agent-")
	if len(parts) != 2 || parts[1] == "" {
		return ""
	}
	return parts[1]
}

// outputTagRx extracts content from <output>...</output> tags in task results.
var outputTagRx = regexp.MustCompile(`(?s)<output>(.*?)</output>`)

func extractOutputContent(s string) string {
	matches := outputTagRx.FindStringSubmatch(s)
	if len(matches) == 2 {
		return strings.TrimSpace(matches[1])
	}
	return s
}
