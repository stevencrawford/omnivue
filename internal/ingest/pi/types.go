package pi

import "encoding/json"

// piEditEntry represents a single old→new edit within a Pi edit tool call.
type piEditEntry struct {
	OldText string `json:"oldText"`
	NewText string `json:"newText"`
}

// piCost holds the per-message cost breakdown from Pi's usage object.
type piCost struct {
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cacheRead"`
	CacheWrite float64 `json:"cacheWrite"`
	Total      float64 `json:"total"`
}

// piSessionHeader is the JSONL session header line.
type piSessionHeader struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	CWD       string `json:"cwd"`
}

// piMessageEnvelope wraps every JSONL line with type routing.
type piMessageEnvelope struct {
	Type     string          `json:"type"`
	ID       string          `json:"id"`
	ParentID string          `json:"parentId,omitempty"`
	Raw      json.RawMessage `json:"-"` // unused, for extensibility

	// session header fields (type="session")
	Timestamp string `json:"timestamp,omitempty"`
	CWD       string `json:"cwd,omitempty"`

	// model_change fields
	Provider string `json:"provider,omitempty"`
	ModelID  string `json:"modelId,omitempty"`

	// thinking_level_change fields
	ThinkingLevel string `json:"thinkingLevel,omitempty"`

	// message fields (type="message")
	Message *piMessageData `json:"message,omitempty"`
}

type piMessageData struct {
	Role          string          `json:"role"`
	Content       json.RawMessage `json:"content"`
	Model         string          `json:"model,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	API           string          `json:"api,omitempty"`
	StopReason    string          `json:"stopReason,omitempty"`
	ResponseID    string          `json:"responseId,omitempty"`
	ResponseModel string          `json:"responseModel,omitempty"`
	Usage         *piUsage        `json:"usage,omitempty"`
	ErrorMsg      string          `json:"errorMessage,omitempty"`

	// toolResult-specific
	ToolCallID string `json:"toolCallId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	IsError    bool   `json:"isError,omitempty"`
}

type piUsage struct {
	Input       int     `json:"input"`
	Output      int     `json:"output"`
	CacheRead   int     `json:"cacheRead"`
	CacheWrite  int     `json:"cacheWrite"`
	Reasoning   int     `json:"reasoning"`
	TotalTokens int     `json:"totalTokens"`
	Cost        *piCost `json:"cost,omitempty"`
}

type piContentPart struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"thinkingSignature,omitempty"`

	// toolCall
	ToolCallID string          `json:"id,omitempty"`
	Name       string          `json:"name,omitempty"`
	Arguments  json.RawMessage `json:"arguments,omitempty"`
}
