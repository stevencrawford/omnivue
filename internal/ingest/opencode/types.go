package opencode

import "database/sql"

// schemaKind records which OpenCode storage schema the database uses. OpenCode
// v2 migrated from the v1 tables (session/message/part) to session_v2/
// session_message; the adapter probes once at construction and routes reads
// accordingly so both generations stay supported.
type schemaKind int

const (
	schemaV1 schemaKind = iota
	schemaV2
)

// Adapter reads OpenCode session data from its SQLite database.
type Adapter struct {
	db       *sql.DB
	basePath string
	schema   schemaKind
}

// editInput mirrors the JSON fields in edit/write tool call inputs.
type editInput struct {
	Path      string `json:"path"`
	FilePath  string `json:"filePath"`
	FilePath2 string `json:"file_path"`
	OldStr    string `json:"old_str"`
	OldString string `json:"oldString"`
	NewStr    string `json:"new_str"`
	NewString string `json:"newString"`
	Content   string `json:"content"`
	ViewRange []int  `json:"view_range"`
}

type messageData struct {
	Role    string `json:"role"`
	Agent   string `json:"agent"`
	Model   any    `json:"model"`
	ModelID string `json:"modelID"`
}

type partData struct {
	Type        string      `json:"type"`
	Text        string      `json:"text"`
	Synthetic   bool        `json:"synthetic,omitempty"`
	Tool        string      `json:"tool"`
	CallID      string      `json:"callID"`
	State       partState   `json:"state"`
	Snapshot    string      `json:"snapshot,omitempty"`
	Reason      string      `json:"reason,omitempty"`
	Cost        float64     `json:"cost,omitempty"`
	Tokens      *stepTokens `json:"tokens,omitempty"`
	Auto        *bool       `json:"auto,omitempty"`
	Overflow    *bool       `json:"overflow,omitempty"`
	TailStartID string      `json:"tail_start_id,omitempty"`
}

type stepTokens struct {
	Input     int              `json:"input"`
	Output    int              `json:"output"`
	Reasoning int              `json:"reasoning"`
	Cache     *stepCacheTokens `json:"cache,omitempty"`
}

type stepCacheTokens struct {
	Read  int `json:"read"`
	Write int `json:"write"`
}

type partState struct {
	Status   string    `json:"status"`
	Input    any       `json:"input"`
	Output   string    `json:"output"`
	Metadata any       `json:"metadata,omitempty"`
	Time     *partTime `json:"time,omitempty"`
}

type partTime struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

type todoItem struct {
	Content  string `json:"content"`
	Status   string `json:"status"`
	Priority string `json:"priority"`
}

// sessionMessageData mirrors the JSON blob in a v2 session_message row. Its
// populated fields depend on the row's type column (user, assistant, system,
// synthetic, compaction), so most fields are optional.
type sessionMessageData struct {
	Time    *sessionMessageTime `json:"time,omitempty"`
	Text    string              `json:"text,omitempty"`
	Agent   string              `json:"agent,omitempty"`
	Model   any                 `json:"model,omitempty"`
	Content []v2ContentPart     `json:"content,omitempty"`
	Cost    float64             `json:"cost,omitempty"`
	Tokens  *stepTokens         `json:"tokens,omitempty"`
	Finish  string              `json:"finish,omitempty"`
	Summary string              `json:"summary,omitempty"`
	Reason  string              `json:"reason,omitempty"`
}

type sessionMessageTime struct {
	Created   int64 `json:"created"`
	Streamed  int64 `json:"streamed"`
	Completed int64 `json:"completed"`
}

// v2ContentPart is a single item in an assistant message's content array. A
// tool part carries id/name/state/time; a text or reasoning part carries text.
type v2ContentPart struct {
	Type  string       `json:"type"`
	Text  string       `json:"text"`
	ID    string       `json:"id,omitempty"`
	Name  string       `json:"name,omitempty"`
	State *v2ToolState `json:"state,omitempty"`
	Time  *v2ToolTime  `json:"time,omitempty"`
}

type v2ToolState struct {
	Status   string          `json:"status"`
	Input    any             `json:"input"`
	Content  []v2ContentPart `json:"content,omitempty"`
	Metadata any             `json:"metadata,omitempty"`
	Error    any             `json:"error,omitempty"`
}

type v2ToolTime struct {
	Created   int64 `json:"created"`
	Ran       int64 `json:"ran"`
	Completed int64 `json:"completed"`
}

type v2ToolError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}
