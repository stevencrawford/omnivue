# Adapters

Adapters are the pluggable interface between Omnivue and AI coding agent data stores. Each agent has its own adapter that normalizes agent-specific formats into Omnivue's unified session model.

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
| Claude Code | `internal/ingest/claude-code/` | `~/.claude/projects/*/*.jsonl` | JSONL (sessions, messages, tool calls) |
| | | `~/.claude/plans/{slug}.md` | Markdown (implementation plan files) |
| | | `~/.claude/projects/*/*/subagents/agent-*.jsonl` | JSONL (subagent transcripts) |
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

## Adding a new adapter

See `internal/ingest/AGENTS.md` for the step-by-step guide.
