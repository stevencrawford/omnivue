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
| Codex | `internal/ingest/codex/` | `~/.codex/session_index.jsonl` | JSONL (session index) |

## Adapter interface

`internal/ingest/adapter.go`:

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

All types in `internal/ingest/types.go`.

### Session

| Field | Type | Description |
|-------|------|-------------|
| ID | `string` | Unique session identifier |
| SourceID | `string` | Source this session belongs to |
| ParentID | `string` | Parent session ID (for sub-agent sessions) |
| Title | `string` | Human-readable session name |
| Repository | `string` | Git repository name |
| Branch | `string` | Git branch |
| Directory | `string` | Working directory |
| Agent | `AgentType` | Agent type constant |
| SubAgent | `string` | Sub-agent type name |
| Model | `string` | AI model identifier |
| Cost | `float64` | Total cost in USD |
| Status | `string` | `"active"`, `"completed"`, or `"archived"` |
| TokensInput | `int` | Input tokens consumed |
| TokensOutput | `int` | Output tokens consumed |
| TokensReasoning | `int` | Reasoning tokens consumed |
| TokensCacheRead | `int` | Cache read tokens |
| TokensCacheWrite | `int` | Cache write tokens |
| MessageCount | `int` | Number of messages |
| DiffFiles | `int` | File change count |
| DiffAdditions | `int` | Total additions across diffs |
| DiffDeletions | `int` | Total deletions across diffs |
| CreatedAt | `time.Time` | Session creation timestamp |
| UpdatedAt | `time.Time` | Session last-updated timestamp |

### Message

| Field | Type | Description |
|-------|------|-------------|
| ID | `string` | Message identifier |
| Role | `string` | `"user"`, `"assistant"`, or `"system"` |
| Content | `string` | Markdown text content |
| Model | `string` | Model used for this message |
| Agent | `string` | Agent type for this message (sub-agent) |
| Reasoning | `string` | Model thinking/reasoning content (collapsible in UI) |
| ToolCalls | `[]ToolCall` | Tool invocations |
| StepEvents | `[]StepEvent` | Step-start/step-finish markers |
| TokensInput | `int` | Input tokens for this message |
| TokensOutput | `int` | Output tokens for this message |
| Timestamp | `time.Time` | Message timestamp |
| Metadata | `map[string]string` | Additional metadata |

### ToolCall

| Field | Type | Description |
|-------|------|-------------|
| ID | `string` | Tool call identifier |
| Name | `string` | Tool name (`edit`, `write`, `read`, `bash`, `grep`, `glob`, etc.) |
| Input | `string` | Tool input (JSON or text) |
| Output | `string` | Tool output |
| Status | `string` | `"completed"`, `"failed"`, or `"running"` |
| Duration | `int64` | Execution duration in milliseconds |
| Metadata | `string` | Tool-specific metadata (JSON) |

### StepEvent

| Field | Type | Description |
|-------|------|-------------|
| Step | `string` | `"start"` or `"finish"` |
| Snapshot | `string` | Snapshot reference |
| Reason | `string` | Reason for step change |
| Cost | `float64` | Cost accumulator |
| Tokens | `StepTokens` | Token counts at step boundary |

### StepTokens

| Field | Type |
|-------|------|
| Input | `int` |
| Output | `int` |
| Reasoning | `int` |
| CacheRead | `int` |
| CacheWrite | `int` |

### Plan

| Field | Type | Description |
|-------|------|-------------|
| Markdown | `string` | Plan content as markdown |
| Source | `string` | `"file"`, `"synthesized"`, or `"codex"` |

### PlanItem

| Field | Type | Description |
|-------|------|-------------|
| Content | `string` | Item description |
| Status | `string` | `"pending"`, `"in_progress"`, `"completed"`, or `"cancelled"` |
| Priority | `string` | `"high"`, `"medium"`, or `"low"` |

### DiffFile

| Field | Type | Description |
|-------|------|-------------|
| Path | `string` | File path |
| Status | `string` | `"added"`, `"modified"`, `"deleted"`, or `"renamed"` |
| Additions | `int` | Lines added |
| Deletions | `int` | Lines deleted |
| Patch | `string` | Unified diff content |

### FileEdit

| Field | Type | Description |
|-------|------|-------------|
| FilePath | `string` | File path |
| ToolName | `string` | `"edit"` or `"write"` |
| OldStr | `string` | Original content (for edits) |
| NewStr | `string` | New content |
| Content | `string` | Full content (for writes) |
| ViewRange | `[]int` | Line range for view operations |
| Timestamp | `time.Time` | When the edit occurred |

### Source

| Field | Type | Description |
|-------|------|-------------|
| ID | `string` | Source identifier |
| Path | `string` | Filesystem path |
| AgentType | `AgentType` | Agent type constant |
| Label | `string` | Display label |
| Enabled | `bool` | Whether the source is active |
| CreatedAt | `time.Time` | When the source was added |

## Safety

All agent database connections use `?mode=ro` (read-only). The `OpenReadOnlyDB()` helper in `internal/ingest/adapter.go` verifies this by attempting a write operation at open time and panicking if the database is writable.

## Adding a new adapter

1. Create a new package under `internal/ingest/<agent>/`
2. Implement all 11 methods of the `Adapter` interface
3. Use `ingest.OpenReadOnlyDB()` for any SQLite access
4. Add the agent type constant to `internal/ingest/types.go`
5. Add the agent path to `KnownPaths` in `internal/ingest/detect.go`
6. Add the detection case in `ingest.AutoDiscover()`
7. Add the create case in `internal/server/server.go:createAdapter()`
8. Add `--type` support in `cmd/add.go`
9. Optionally add to the init display in `cmd/init.go`

See `internal/ingest/AGENTS.md` for detailed integration patterns, tool call normalization, and reference implementations for each adapter.
