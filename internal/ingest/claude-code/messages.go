package claudecode

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.findSessionFile(sessionID)
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

	scanner := ingestkit.NewJSONLScanner(f)

	var messages []ingest.Message
	toolCallsByID := make(map[string]*ingest.ToolCall)
	var currentModel string

	// Resolve tool-results directory once
	parentSID := resolveParentSessionID(sessionID)
	toolResultsDir := resolveToolResultsDir(fpath, parentSID)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env claudeMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		// Skip non-message types
		switch env.Type {
		case "file-history-snapshot", "queue-operation", "system":
			continue
		case "progress":
			handleProgressEvent(line, toolCallsByID, parentSID)
			continue
		case "user":
			if isMetaMsg(&env) {
				continue
			}
		}

		ts := ingestkit.ParseTime(env.Timestamp)

		switch env.Type {
		case "user", "assistant":
			if env.Message == nil {
				continue
			}

			// Check if this is a user message containing embedded tool results
			if env.Type == "user" && env.Message.Role == "user" && env.Message.Content != nil {
				if extractAndMergeToolResults(env.Message.Content, toolCallsByID, env.IsError) {
					continue // tool_result user message, skip adding as a user message
				}
			}

			msg := ingest.Message{
				ID:        env.UUID,
				Role:      ingest.MessageRole(env.Message.Role),
				Timestamp: ts,
				Model:     currentModel,
			}

			if env.Message.Model != "" {
				currentModel = env.Message.Model
				msg.Model = currentModel
			}

			if env.Message.Usage != nil {
				msg.TokensInput = env.Message.Usage.InputTokens
				msg.TokensOutput = env.Message.Usage.OutputTokens
			}

			if env.Slug != "" {
				if msg.Metadata == nil {
					msg.Metadata = make(map[string]string)
				}
				msg.Metadata["slug"] = env.Slug
			}

			switch env.Message.Role {
			case "assistant":
				text, reasoning, toolCalls := parseAssistantContent(env.Message.Content, msg.ID)
				msg.Content = text
				msg.Reasoning = reasoning
				for i := range toolCalls {
					if toolResultsDir != "" {
						if tr := readToolResultFile(toolResultsDir, toolCalls[i].ID); tr != "" {
							toolCalls[i].Output = truncateToolOutput(tr, toolCalls[i].Name)
							toolCalls[i].Status = ingest.ToolCallCompleted
						}
					}
					toolCallsByID[toolCalls[i].ID] = &toolCalls[i]
				}
				msg.ToolCalls = toolCalls

			case "user":
				msg.Content = extractUserContent(env.Message.Content)
				msg = processUserMessage(msg)
			}

			messages = append(messages, msg)

		case "tool_result":
			tcID := env.ToolUseID
			if tcID == "" {
				continue
			}
			content := extractToolResultContent(env.Content)
			if content == "" && toolResultsDir != "" {
				content = readToolResultFile(toolResultsDir, tcID)
			}

			if tc, ok := toolCallsByID[tcID]; ok {
				// Don't overwrite Agent/Task output that was already set by a progress event.
				// The progress event already carries the real sub-agent response; the
				// tool_result only has a short launch confirmation boilerplate.
				if tc.Name != "Agent" && tc.Name != "Task" || tc.Output == "" {
					tc.Output = truncateToolOutput(content, tc.Name)
				}
				if env.IsError != nil && *env.IsError {
					tc.Status = ingest.ToolCallFailed
				} else {
					tc.Status = ingest.ToolCallCompleted
				}
				if env.AgentID != "" {
					setToolMetadataSessionID(tc, parentSID, env.AgentID)
				}
			}
		}
	}

	// Normalize tool names
	for i := range messages {
		for j := range messages[i].ToolCalls {
			normalizeToolCall(&messages[i].ToolCalls[j])
		}
	}

	postProcessToolCalls(messages)

	return messages, scanner.Err()
}

func isMetaMsg(env *claudeMessageEnvelope) bool {
	if env.IsMeta != nil && *env.IsMeta {
		return true
	}
	return false
}

// interruptedContentRx matches user interrupt messages from Claude Code.
var interruptedContentRx = regexp.MustCompile(`(?i)\[Request interrupted by user`)

// commandTagRx matches command tags embedded in user messages.
var commandTagRx = regexp.MustCompile(`(?s)<command-name>(.*?)</command-name>\s*<command-message>(.*?)</command-message>\s*<command-args>(.*?)</command-args>`)

// processUserMessage handles interrupt detection and command tag processing.
func processUserMessage(msg ingest.Message) ingest.Message {
	content := msg.Content

	if interruptedContentRx.MatchString(content) {
		if msg.Metadata == nil {
			msg.Metadata = make(map[string]string)
		}
		msg.Metadata["type"] = "turn_aborted"
		return msg
	}

	matches := commandTagRx.FindStringSubmatch(content)
	if len(matches) == 4 {
		cmdName := strings.TrimSpace(matches[1])
		cmdMessage := strings.TrimSpace(matches[2])
		cmdArgs := strings.TrimSpace(matches[3])

		msg.Content = strings.TrimSpace(commandTagRx.ReplaceAllString(content, ""))
		if msg.Content == "" {
			msg.Content = cmdName
		}

		if msg.Metadata == nil {
			msg.Metadata = make(map[string]string)
		}
		msg.Metadata["command_name"] = cmdName
		msg.Metadata["command_message"] = cmdMessage
		msg.Metadata["command_args"] = cmdArgs

		if cmdName == "/model" {
			msg.Metadata["model_switch"] = cmdMessage
		}
	}

	return msg
}
