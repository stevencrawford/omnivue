package claudecode

import "encoding/json"

// claudeMessageEnvelope wraps every JSONL line with type routing.
type claudeMessageEnvelope struct {
	Type      string          `json:"type"`
	UUID      string          `json:"uuid,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Timestamp string          `json:"timestamp,omitempty"`
	ParentUuid string         `json:"parentUuid,omitempty"`

	// user / assistant
	Message     *claudeMessageData `json:"message,omitempty"`
	IsMeta      *bool              `json:"isMeta,omitempty"`
	Slug        string             `json:"slug,omitempty"`
	GitBranch   string             `json:"gitBranch,omitempty"`
	CWD         string             `json:"cwd,omitempty"`
	Version     string             `json:"version,omitempty"`
	UserType    string             `json:"userType,omitempty"`
	IsSidechain bool               `json:"isSidechain"`

	// agent / subagent
	AgentID    string `json:"agentId,omitempty"`

	// system (local_command)
	Subtype string `json:"subtype,omitempty"`
	Level   string `json:"level,omitempty"`

	// tool_result
	ToolUseID string          `json:"tool_use_id,omitempty"`
	IsError   *bool           `json:"is_error,omitempty"`
	Content   json.RawMessage `json:"content,omitempty"`
}

type claudeMessageData struct {
	Role    string               `json:"role"`
	Content json.RawMessage      `json:"content"`
	ID      string               `json:"id,omitempty"`
	Model   string               `json:"model,omitempty"`
	Usage   *claudeUsage         `json:"usage,omitempty"`
}

type claudeUsage struct {
	InputTokens             int  `json:"input_tokens"`
	OutputTokens            int  `json:"output_tokens"`
	CacheCreationInputTokens *int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     *int `json:"cache_read_input_tokens"`
}

type claudeContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Thinking string          `json:"thinking,omitempty"`

	// tool_use
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

// progress event fields (used for agent_progress carrying Task tool results).
type claudeProgressData struct {
	Type    string          `json:"type"`
	AgentID string          `json:"agentId,omitempty"`
	Message json.RawMessage `json:"message,omitempty"`
	Prompt  string          `json:"prompt,omitempty"`
}

// claudeProgressEnvelope wraps progress events (including agent_progress).
type claudeProgressEnvelope struct {
	ParentToolUseID string             `json:"parentToolUseID,omitempty"`
	ToolUseID       string             `json:"toolUseID,omitempty"`
	Data            *claudeProgressData `json:"data,omitempty"`
}

// progressMessageWrapper wraps the nested message inside agent_progress data.
type progressMessageWrapper struct {
	Type    string            `json:"type"`
	Message *claudeMessageData `json:"message"`
}

// sessionsIndex mirrors the schema of sessions-index.json.
type sessionsIndex struct {
	Version      int    `json:"version"`
	OriginalPath string `json:"originalPath"`
}
