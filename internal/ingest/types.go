package ingest

import "time"

// AgentType identifies the AI coding agent that produced the session.
type AgentType string

const (
	AgentOpenCode   AgentType = "opencode"
	AgentCopilot    AgentType = "copilot"
	AgentCursor     AgentType = "cursor"
	AgentPi         AgentType = "pi"
	AgentCodex      AgentType = "codex"
	AgentClaudeCode AgentType = "claude-code"
)

// SessionStatus represents the lifecycle state of a session.
type SessionStatus string

const (
	SessionStatusActive    SessionStatus = "active"
	SessionStatusCompleted SessionStatus = "completed"
	SessionStatusArchived  SessionStatus = "archived"
)

// MessageRole represents the role of a message participant.
type MessageRole string

const (
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
	MessageRoleSystem    MessageRole = "system"
)

// ToolCallStatus represents the execution state of a tool call.
type ToolCallStatus string

const (
	ToolCallCompleted ToolCallStatus = "completed"
	ToolCallFailed    ToolCallStatus = "failed"
	ToolCallRunning   ToolCallStatus = "running"
)

// DiffFileStatus represents the type of file change.
type DiffFileStatus string

const (
	DiffAdded   DiffFileStatus = "added"
	DiffModified DiffFileStatus = "modified"
	DiffDeleted  DiffFileStatus = "deleted"
	DiffRenamed  DiffFileStatus = "renamed"
)

// TodoStatus represents the progression state of a tracked todo item.
type TodoStatus string

const (
	TodoPending     TodoStatus = "pending"
	TodoInProgress  TodoStatus = "in_progress" //lint:ignore gostyle.repetition disambiguates from PlanItemStatus
	TodoCompleted   TodoStatus = "completed"
	TodoBlocked     TodoStatus = "blocked"
)

// PlanDataSource indicates how a Plan's markdown content was obtained.
type PlanDataSource string

const (
	PlanDataFile        PlanDataSource = "file"
	PlanDataSynthesized PlanDataSource = "synthesized"
)

// StepEventType indicates whether a step event is starting or finishing.
type StepEventType string

const (
	StepEventStart  StepEventType = "start"
	StepEventFinish StepEventType = "finish"
)

// PlanItemStatus represents the completion state of a plan item.
type PlanItemStatus string

const (
	PlanItemPending     PlanItemStatus = "pending"
	PlanItemInProgress  PlanItemStatus = "in_progress" //lint:ignore gostyle.repetition disambiguates from TodoStatus
	PlanItemCompleted   PlanItemStatus = "completed"
	PlanItemCanceled    PlanItemStatus = "canceled"
)

// PlanItemPriority represents the urgency of a plan item.
type PlanItemPriority string

const (
	PlanPriorityHigh   PlanItemPriority = "high"
	PlanPriorityMedium PlanItemPriority = "medium"
	PlanPriorityLow    PlanItemPriority = "low"
)

// Source represents a configured session data source.
type Source struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	AgentType AgentType `json:"agentType"`
	Label     string    `json:"label"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
}

// Session represents a unified session entry from any agent.
type Session struct {
	ID         string    `json:"id"`
	SourceID   string    `json:"sourceId"`
	ParentID   string    `json:"parentId,omitempty"`
	Title      string    `json:"title"`
	Repository string    `json:"repository"`
	Branch     string    `json:"branch"`
	Agent      AgentType `json:"agent"`
	SubAgent   string    `json:"subAgent,omitempty"`
	Model      string    `json:"model"`
	Cost       float64   `json:"cost"`
	Directory  string    `json:"directory"`
	Status     SessionStatus `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`

	// Token usage
	TokensInput      int `json:"tokensInput"`
	TokensOutput     int `json:"tokensOutput"`
	TokensReasoning  int `json:"tokensReasoning"`
	TokensCacheRead  int `json:"tokensCacheRead"`
	TokensCacheWrite int `json:"tokensCacheWrite"`

	// Message count (used to filter empty sessions)
	MessageCount int `json:"messageCount"`

	// Diff summary
	DiffFiles     int `json:"diffFiles"`
	DiffAdditions int `json:"diffAdditions"`
	DiffDeletions int `json:"diffDeletions"`

	// TODOs extracted from agent task tracking (e.g. Copilot's todo table in session.db)
	TODOs []Todo `json:"todos,omitempty"`
}

// Todo represents a tracked task within a session.
type Todo struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Status      string   `json:"status"` // pending, in_progress, done, blocked
	DependsOn   []string `json:"depends_on,omitempty"`
}

// StepEvent represents a step-start or step-finish event in a message.
type StepEvent struct {
	Step     StepEventType `json:"step"`
	Snapshot string     `json:"snapshot,omitempty"`
	Reason   string     `json:"reason,omitempty"`
	Cost     float64    `json:"cost,omitempty"`
	Tokens   StepTokens `json:"tokens,omitzero"`
}

// StepTokens represents token usage for a step.
type StepTokens struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	Reasoning  int `json:"reasoning"`
	CacheRead  int `json:"cacheRead"`
	CacheWrite int `json:"cacheWrite"`
}

// Message represents a conversation message within a session.
type Message struct {
	ID        string     `json:"id"`
	Role      MessageRole `json:"role"`
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"toolCalls,omitempty"`
	Timestamp time.Time  `json:"timestamp"`
	Model     string     `json:"model,omitempty"`
	Agent     string     `json:"agent,omitempty"`

	// Reasoning/model thinking content (shown as collapsible in the UI)
	Reasoning string `json:"reasoning,omitempty"`

	// Step events (step-start/step-finish markers)
	StepEvents []StepEvent `json:"stepEvents,omitempty"`

	// Arbitrary metadata key-value pairs (e.g., system_reminder file name)
	Metadata map[string]string `json:"metadata,omitempty"`

	// Token usage for this message
	TokensInput  int `json:"tokensInput,omitempty"`
	TokensOutput int `json:"tokensOutput,omitempty"`
}

// ToolCall represents a tool invocation within a message.
type ToolCall struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Input    string `json:"input"`
	Output   string `json:"output"`
	Status   ToolCallStatus `json:"status"`
	Duration int64  `json:"duration,omitempty"` // milliseconds
	Metadata string `json:"metadata,omitempty"` // tool-specific metadata (JSON)
}

// PlanItem represents a task/todo within a session plan.
type PlanItem struct {
	Content  string `json:"content"`
	Status   PlanItemStatus   `json:"status"`
	Priority PlanItemPriority `json:"priority"`
}

// Plan represents a session plan rendered as markdown.
type Plan struct {
	Markdown string `json:"markdown"`
	Source   PlanDataSource `json:"source"`
}

// FileEdit represents a single edit/write tool call within a session.
type FileEdit struct {
	FilePath  string    `json:"filePath"`
	ToolName  string    `json:"toolName"` // "edit" or "write"
	OldStr    string    `json:"oldStr,omitempty"`
	NewStr    string    `json:"newStr,omitempty"`
	Content   string    `json:"content,omitempty"`
	ViewRange []int     `json:"viewRange,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// DiffFile represents a changed file in a session.
type DiffFile struct {
	Path      string `json:"path"`
	Status   DiffFileStatus `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch,omitempty"` // unified diff content
}

// SessionDetail includes the full session with messages, plan, and diffs.
type SessionDetail struct {
	Session  Session    `json:"session"`
	Messages []Message  `json:"messages,omitempty"`
	Plan     *Plan      `json:"plan,omitempty"`
	Diffs    []DiffFile `json:"diffs,omitempty"`
}

// DiscoveredSource represents a potential session source found during auto-discovery.
type DiscoveredSource struct {
	Path      string    `json:"path"`
	AgentType AgentType `json:"agentType"`
	Label     string    `json:"label"`
	Sessions  int       `json:"sessions"` // approximate count
}
