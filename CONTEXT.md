# Domain Glossary — omnivue

Terms that name good seams in the codebase. Architecture reviews and refactors speak in
these terms. When a new module earns a stable name, record it here.

## Session refresh pipeline

The path from "a session source changed" to "clients are told". Owns the orchestration
that used to live scattered across the poller and handlers: refresh the session cache from
the adapters, re-index search content, classify notifications, and broadcast SSE events.

- **Module:** `internal/server` `Pipeline` (formerly `fanout`)
- **Interface:** `Refresh(ctx) (liveCount int)` — full pass (index + classify + broadcast)
  and `RefreshLiveness(ctx) (liveCount int)` — light pass (broadcast only on liveness
  change). Synchronous; callers own concurrency.
- **Seam:** the poller's two cadences and the HTTP add/update/remove-source handlers all
  cross it. No caller touches `hub`, `indexer`, `notifier`, or `bus` directly.

### Collaborators behind the pipeline

- **Poller** — watches sources (`AdapterProvider`) and drives the pipeline at the live
  (5s) or idle (30s) cadence. Owns change detection, not broadcast.
- **SessionHub** — the session cache + adapter registry; `refreshSessions` re-reads every
  adapter and diffs against the previous snapshot (→ changed IDs, live count, status
  transitions).
- **Indexer** — indexes session content into the FTS5 search index, incrementally by
  content hash.
- **Notifier** — classifies session/message changes into notifications; pure policy lives
  in `internal/notify`.
- **EventBus** — SSE pub/sub; subscribers get buffered channels, a slow client never blocks
  the bus.

## Source

A configured agent data location (OpenCode, Copilot, Cursor, Pi, Claude Code, Codex).
Type → adapter mapping is owned by the ingest registry, not the server.

## Adapter

A concrete thing that satisfies the ingest `Adapter` interface at the seam between a raw
agent data store and the unified `Session`/`Message` model. Two adapters make the seam real;
six make it load-bearing.

## Resume command

The CLI command a user runs to resume a session in the agent's own harness. Adapters declare
only the structured parts (binary, flag, in-harness verb); the module renders the three
variants — the full `cd <dir> && <bin> <flag> <id>` command, the same invocation with the `cd`
prefix stripped, and the in-harness `/resume <id>` (or opencode's `/session <id>`) command.

- **Module:** `internal/resumecmd` — pure, no I/O, no PTY.
- **Interface:** `Spec{Binary, Flag, Sep, Verb}` with `Command(dir, id)`, `CommandNoCD(id)`,
  and `AgentCommand(id)`.
- **Seam:** the six adapters return their static `Spec`; the hub renders the `ResumeSpec`;
  the terminal module consumes the rendered string at the edge.

## Tool-kind vocabulary

The one place that says what a tool-call name *means* to consumers downstream of
canonicalization. `CanonicalizeToolName` answers "what is this tool called?"; the vocabulary
answers "what role does it play?" — question, permission request, task completion, or plan
content. One name can signal more than one kind (a `task_complete` call is both a completion
signal and searchable plan content), so a name maps to a set of kinds.

- **Module:** `internal/ingest/ingestkit` — pure.
- **Interface:** `KindsOf(name) []ToolKind` and `HasKind(name, kind) bool`, with
  `KindQuestion`, `KindPermission`, `KindTaskComplete`, `KindPlan`.
- **Seam:** the notifier (`internal/notify`) and the search indexer (`internal/server`) both
  consume it; neither maintains its own tool-name literal set.
