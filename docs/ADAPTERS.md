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
| | | `~/.codex/edits/*.json` | JSON (edit events) |
| | | `~/.codex/plans/*.json` | JSON (implementation plans) |

## Adapter interface

`internal/ingest/adapter.go`:

The `Adapter` interface is composed of four sub-interfaces. Adapters that don't support optional features return `(nil, nil)`.

```go
type SessionSource interface {
    Type() AgentType
    Detect(path string) bool
    ListSessions(ctx context.Context) ([]Session, error)
    Session(ctx context.Context, id string) (*Session, error)
    Messages(ctx context.Context, sessionID string) ([]Message, error)
    ResumeCommand(session *Session) string
    LastModified(ctx context.Context) (int64, error)
    Close() error
}

type Planner interface {
    Plan(ctx context.Context, sessionID string) (*Plan, error)
}

type Differ interface {
    Diffs(ctx context.Context, sessionID string) ([]DiffFile, error)
}

type Editor interface {
    Edits(ctx context.Context, sessionID string) ([]FileEdit, error)
}

type Adapter interface {
    SessionSource
    Planner
    Differ
    Editor
}
```

## Adding a new adapter

See `internal/ingest/AGENTS.md` for the step-by-step guide.
