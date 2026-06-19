# Adapters

Adapters are the pluggable interface between sess and AI coding agent data stores. Each agent has its own adapter that normalizes agent-specific formats into sess's unified session model.

## Supported agents

| Agent | Adapter | Source data | Format |
|-------|---------|-------------|--------|
| OpenCode | `internal/ingest/opencode/` | `~/.local/share/opencode/opencode.db` | SQLite (messages, todos, diffs, tokens, costs) |
| | | `~/.local/share/opencode/snapshot/` | Git bare repos (file rewind) |
| Copilot | `internal/ingest/copilot/` | `~/.copilot/session-store.db` | SQLite (sessions, turns, checkpoints, FTS) |
| | | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL (conversation + tool calls) |
| | | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown (implementation plans) |
| | | `~/.copilot/session-state/<uuid>/rewind-snapshots/` | JSON + files (file backups) |
| Cursor | `internal/ingest/cursor/` | `~/.cursor/state.vscdb` | SQLite KV (composer sessions, bubbles, tool calls) |
| | | `~/.cursor/projects/<uuid>/*.jsonl` | JSONL (agentic session transcripts) |
| | | `~/.cursor/ai-code-tracking.db` | SQLite (summaries, model, cost, tokens) |
| Pi | `internal/ingest/pi/` | `~/.pi/agent/sessions/*.jsonl` | JSONL (sessions, messages, tool calls, reasoning) |

## Adapter interface

```go
type Adapter interface {
    Type() AgentType
    Detect(path string) bool
    ListSessions(ctx context.Context) ([]Session, error)
    GetSession(ctx context.Context, id string) (*Session, error)
    GetMessages(ctx context.Context, sessionID string) ([]Message, error)
    GetPlan(ctx context.Context, sessionID string) (*Plan, error)
    GetDiffs(ctx context.Context, sessionID string) ([]DiffFile, error)
    GetEdits(ctx context.Context, sessionID string) ([]FileEdit, error)
    ResumeCommand(session *Session) string
    LastModified(ctx context.Context) (int64, error)
    Close() error
}
```

## Unified types

### Session

```go
type Session struct {
    ID              string    `json:"id"`
    SourceID        string    `json:"sourceId"`
    Title           string    `json:"title"`
    Repository      string    `json:"repository"`
    Agent           AgentType `json:"agent"`
    Model           string    `json:"model"`
    Cost            float64   `json:"cost"`
    Status          string    `json:"status"` // "active", "completed", "archived"
    CreatedAt       time.Time `json:"createdAt"`
    UpdatedAt       time.Time `json:"updatedAt"`
    TokensInput     int       `json:"tokensInput"`
    TokensOutput    int       `json:"tokensOutput"`
    TokensReasoning int       `json:"tokensReasoning"`
    MessageCount    int       `json:"messageCount"`
    DiffFiles       int       `json:"diffFiles"`
    DiffAdditions   int       `json:"diffAdditions"`
    DiffDeletions   int       `json:"diffDeletions"`
    // ...
}
```

### Message

```go
type Message struct {
    ID         string     `json:"id"`
    Role       string     `json:"role"`     // "user", "assistant", "system"
    Content    string     `json:"content"`
    ToolCalls  []ToolCall `json:"toolCalls,omitempty"`
    Reasoning  string     `json:"reasoning,omitempty"`  // Collapsible in UI
    StepEvents []StepEvent `json:"stepEvents,omitempty"`
    Timestamp  time.Time  `json:"timestamp"`
    Metadata   map[string]string `json:"metadata,omitempty"`
    // ...
}
```

### ToolCall

```go
type ToolCall struct {
    ID       string `json:"id"`
    Name     string `json:"name"`
    Input    string `json:"input"`
    Output   string `json:"output"`
    Status   string `json:"status"`   // "completed", "failed", "running"
    Duration int64  `json:"duration,omitempty"`
    Metadata string `json:"metadata,omitempty"`
}
```

### Plan

```go
type Plan struct {
    Markdown string `json:"markdown"`
    Source   string `json:"source"` // "file" or "synthesized"
}
```

### DiffFile

```go
type DiffFile struct {
    Path      string `json:"path"`
    Status    string `json:"status"` // "added", "modified", "deleted", "renamed"
    Additions int    `json:"additions"`
    Deletions int    `json:"deletions"`
    Patch     string `json:"patch,omitempty"`
}
```

### FileEdit

```go
type FileEdit struct {
    FilePath  string    `json:"filePath"`
    ToolName  string    `json:"toolName"` // "edit" or "write"
    OldStr    string    `json:"oldStr,omitempty"`
    NewStr    string    `json:"newStr,omitempty"`
    Timestamp time.Time `json:"timestamp"`
}
```

## Safety

All agent database connections use `?mode=ro` (read-only). The `OpenReadOnlyDB()` helper verifies this by attempting a write operation at open time and panicking if the database is writable.

## Adding a new adapter

1. Create a new package under `internal/ingest/<agent>/`
2. Implement all methods of the `Adapter` interface
3. Use `ingest.OpenReadOnlyDB()` for any SQLite access
4. Add the agent type constant to `internal/ingest/types.go`
5. Add the agent path to `KnownPaths` in `internal/ingest/detect.go`
6. Add the detection case in `AutoDiscover()`
7. Add the create case in `server.go:createAdapter()`
8. Add `--type` support in `cmd/add.go`
9. Add the source to the init display in `cmd/init.go`

Reference implementations:
- `internal/ingest/opencode/` — SQLite-based, messages stored as JSON parts
- `internal/ingest/copilot/` — Multi-source (SQLite + JSONL + filesystem)
- `internal/ingest/cursor/` — SQLite KV store + JSONL transcripts with tool call normalization
- `internal/ingest/AGENTS.md` — Detailed adapter integration guide with step-by-step instructions
