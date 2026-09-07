# Adapters

Adapters are the pluggable interface between Omnivue and AI coding agent data stores. Each agent has its own adapter that normalizes agent-specific formats into Omnivue's unified session model.

## Supported agents

| Agent | Adapter | Source data | Format |
|-------|---------|-------------|--------|
| OpenCode | `internal/ingest/opencode/` | `~/.local/share/opencode/opencode.db` | SQLite (`session`, `message`, `part` tables; plans from `part` tool `todowrite`/`task`; diffs from `session.summary_diffs` JSON) |
| Copilot | `internal/ingest/copilot/` | `~/.copilot/session-store.db` | SQLite (`sessions`, `turns`, `session_files` tables, `checkpoints` table) |
| | | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL (conversation + tool calls) |
| | | `~/.copilot/session-state/<id>/session.db` | SQLite (`todos` table) |
| | | `~/.copilot/session-state/<id>/plan.md` | Markdown (implementation plan) |
| | | `~/.copilot/session-state/<id>/research/*.md` | Markdown (synthetic research sessions) |
| Cursor | `internal/ingest/cursor/` | `~/.cursor/.../state.vscdb` (resolved to the file; see below) | SQLite KV (`cursorDiskKV`: composer sessions, bubbles, tool calls) |
| | | `<cursorDir>/projects/<sessionID>/*.jsonl` | JSONL (agentic session transcripts) |
| Pi | `internal/ingest/pi/` | `~/.pi/agent/sessions/*.jsonl` | JSONL (sessions, messages, tool calls, reasoning) |
| Claude Code | `internal/ingest/claude-code/` | `~/.claude/projects/*/*.jsonl` | JSONL (sessions, messages, tool calls) |
| | | `~/.claude/plans/<slug>.md` | Markdown (implementation plan files) |
| | | `~/.claude/projects/<enc>/<sid>/subagents/*.jsonl` | JSONL (subagent transcripts) |
| | | `~/.claude/projects/<enc>/sessions-index.json` | JSON (session index) |
| | | `~/.claude/projects/<enc>/<parent>/tool-results/` | Files (tool result payloads) |
| Codex | `internal/ingest/codex/` | `~/.codex/session_index.jsonl` | JSONL (session index) |
| | | `~/.codex/sessions/**/*.jsonl` | JSONL (sessions; plans and diffs parsed inline) |

Detection notes (`internal/ingest/detect.go`, `registry.go`):
- Cursor resolves to the `state.vscdb` **file** (checks the given path,
  `<path>/state.vscdb`, and the standard macOS/Linux globalStorage
  locations), so its `Source.Path` is a file while other adapters use
  directories.
- Copilot is detected when either `session-store.db` or `session-state/`
  exists, but construction requires `session-store.db`.
- Codex falls back to the parent directory when expanding `~/`-prefixed paths.

## Adapter capabilities

`Planner`, `Differ`, and `Editor` are optional. Pinned by
`internal/ingest/capabilities_test.go`:

| Agent | Plan | Diffs | Edits |
|-------|------|-------|-------|
| OpenCode | yes | yes | yes |
| Copilot | yes | yes | yes |
| Cursor | no | yes | yes |
| Pi | no | yes | yes |
| Claude Code | yes | yes | yes |
| Codex | yes | yes | yes |

Cursor and Pi have no `plan.go`: the missing method is the declaration of
absence. Cursor diffs and Pi diffs are synthesized from edit/write tool
calls.

## Resume commands

Each adapter returns a structured `resumecmd.Spec`; `internal/resumecmd`
renders the full `cd <dir> && <bin> <flag> <id>` command, the same
invocation with the `cd` prefix stripped, and the in-harness command:

| Agent | Command | In-harness |
|-------|---------|------------|
| OpenCode | `cd <dir> && opencode -s <id>` | `/session <id>` |
| Copilot | `cd <dir> && copilot --resume=<id>` | `/resume` |
| Cursor | `cd <dir> && cursor --composer <id>` | `/resume` |
| Pi | `cd <dir> && pi --session <id>` | `/resume` |
| Claude Code | `cd <dir> && claude -r <id>` | `/resume` |
| Codex | `cd <dir> && codex resume <id>` | `/resume` |

## Adapter interface

`internal/ingest/adapter.go`:

The `Adapter` interface is the core `SessionSource` only. `Planner`, `Differ`, and `Editor` are
genuinely-optional capability seams: an adapter implements them only when it supports the
feature, and consumers detect support with a type assertion. Adapters never carry a stub method
for a capability they lack. Capabilities are pinned by the table test in
`internal/ingest/capabilities_test.go`.

```go
type SessionSource interface {
    ListSessions(ctx context.Context) ([]Session, error)
    Session(ctx context.Context, id string) (*Session, error)
    Messages(ctx context.Context, sessionID string) ([]Message, error)
    ResumeCommand() resumecmd.Spec
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
}
```

## Adding a new adapter

See `internal/ingest/AGENTS.md` for the step-by-step guide.
