package codex

import "encoding/json"

type codexIndexEntry struct {
	ID         string `json:"id"`
	ThreadName string `json:"thread_name"`
	UpdatedAt  string `json:"updated_at"`
}

type codexEnvelope struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type sessionMetaPayload struct {
	ID            string `json:"id"`
	Timestamp     string `json:"timestamp"`
	CWD           string `json:"cwd"`
	ModelProvider string `json:"model_provider"`
	Git           *struct {
		CommitHash    string `json:"commit_hash"`
		Branch        string `json:"branch"`
		RepositoryURL string `json:"repository_url"`
	} `json:"git,omitempty"`
}

type turnContextPayload struct {
	TurnID string `json:"turn_id"`
	CWD    string `json:"cwd"`
	Model  string `json:"model"`
}

type eventMsgPayload struct {
	Type        string          `json:"type"`
	TurnID      string          `json:"turn_id,omitempty"`
	Message     string          `json:"message,omitempty"`
	Phase       string          `json:"phase,omitempty"`
	StartedAt   int64           `json:"started_at,omitempty"`
	CompletedAt int64           `json:"completed_at,omitempty"`
	DurationMs  int64           `json:"duration_ms,omitempty"`
	Info        *tokenCountInfo `json:"info,omitempty"`
	Item        *itemComplete   `json:"item,omitempty"`
	Changes     json.RawMessage `json:"changes,omitempty"`
	CallID      string          `json:"call_id,omitempty"`
	Success     bool            `json:"success,omitempty"`
}

type tokenCountInfo struct {
	TotalTokenUsage *tokenUsage `json:"total_token_usage"`
}

type tokenUsage struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CachedInputTokens int `json:"cached_input_tokens"`
	TotalTokens       int `json:"total_tokens"`
}

type itemComplete struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Text string `json:"text"`
}

type responseItemPayload struct {
	Type      string             `json:"type"`
	Role      string             `json:"role,omitempty"`
	Content   []responseContent  `json:"content,omitempty"`
	Name      string             `json:"name,omitempty"`
	Arguments string             `json:"arguments,omitempty"`
	CallID    string             `json:"call_id,omitempty"`
	Output    string             `json:"output,omitempty"`
	Phase     string             `json:"phase,omitempty"`
	Status    string             `json:"status,omitempty"`
	Input     string             `json:"input,omitempty"`
	Metadata  map[string]string  `json:"metadata,omitempty"`
	Summary   []json.RawMessage  `json:"summary,omitempty"`
}

type responseContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type changeEntry struct {
	Type        string `json:"type"`
	Content     string `json:"content"`
	UnifiedDiff string `json:"unified_diff"`
}

type rawPatchResult struct {
	filePath string
	content  string
}
