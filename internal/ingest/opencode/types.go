package opencode

import "database/sql"

// Adapter reads OpenCode session data from its SQLite database.
type Adapter struct {
	db       *sql.DB
	basePath string
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
	Role  string `json:"role"`
	Agent string `json:"agent"`
	Model any    `json:"model"`
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
	Status   string   `json:"status"`
	Input    any      `json:"input"`
	Output   string   `json:"output"`
	Metadata any      `json:"metadata,omitempty"`
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
