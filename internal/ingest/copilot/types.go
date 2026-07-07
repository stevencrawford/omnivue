package copilot

import (
	"encoding/json"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// syntheticSession holds a virtual child session created from sub-agent delegation events.
type syntheticSession struct {
	session  ingest.Session
	messages []ingest.Message
}

// Event types for parsing events.jsonl.

type eventEnvelope struct {
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	ID        string          `json:"id"`
	Timestamp string          `json:"timestamp"`
	ParentID  *string         `json:"parentId"`
	AgentID   string          `json:"agentId,omitempty"`
}

type modelChangeData struct {
	NewModel string `json:"newModel"`
}

type subAgentStartedData struct {
	ToolCallID       string `json:"toolCallId"`
	AgentName        string `json:"agentName"`
	AgentDisplayName string `json:"agentDisplayName"`
}

type userMessageData struct {
	Content            string `json:"content"`
	TransformedContent string `json:"transformedContent"`
}

type assistantMessageData struct {
	MessageID    string        `json:"messageId"`
	Content      string        `json:"content"`
	ToolRequests []toolRequest `json:"toolRequests"`
	OutputTokens int           `json:"outputTokens"`
}

type toolRequest struct {
	ToolCallID string          `json:"toolCallId"`
	Name       string          `json:"name"`
	Arguments  json.RawMessage `json:"arguments"`
	Type       string          `json:"type"`
}

type toolCompleteData struct {
	ToolCallID string `json:"toolCallId"`
	Model      string `json:"model"`
	Success    bool   `json:"success"`
	Result     struct {
		Content         string `json:"content"`
		DetailedContent string `json:"detailedContent"`
	} `json:"result"`
}

type systemReminderData struct {
	Content string `json:"content"`
	File    string `json:"file"`
}

// toolEditArgs mirrors the actual arguments in Copilot file edit/create tool requests.
type toolEditArgs struct {
	Path     string `json:"path"`
	OldStr   string `json:"old_str"`
	NewStr   string `json:"new_str"`
	FileText string `json:"file_text"`
}

// shutdownSnapshot holds the cumulative token/cost data from one session.shutdown event.
type shutdownSnapshot struct {
	Timestamp       string
	TokensInput     int
	TokensOutput    int
	TokensReasoning int
	TokensCacheRead int
	Cost            float64
}

// eventsMetadata holds summary info extracted from events.jsonl.
type eventsMetadata struct {
	Model            string
	Cost             float64
	TokensInput      int
	TokensOutput     int
	TokensReasoning  int
	TokensCacheRead  int
	TokensCacheWrite int
	DiffAdditions    int
	DiffDeletions    int
	DiffFiles        int
}

// subAgentState tracks the buffering of sub-agent events between subagent.started and subagent.completed.
type subAgentState struct {
	toolCallID    string
	agentName     string
	agentDisplay  string
	parentMsgIdx  int
	parentToolIdx int
	messages      []ingest.Message
}
