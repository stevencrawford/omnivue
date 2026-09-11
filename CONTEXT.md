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

## Plan vs Todo

Two distinct concepts that agents often pick a single native word for ("todo"), which is
why they get blurred. **A Plan is not a Todo and a Todo is not a Plan**; a session can have
either, both, or neither, independently.

**Plan**:
The document of what a session is going to do, captured in the Plan tab. The top-level
concept for plan content. Produced from a plan artifact the agent left (`file`) or
synthesized from plan-like agent tables (`synthesized`); `Plan.Source` records which feed
produced it, because agents differ in what they leave behind.
_Avoid_: roadmap, checklist (as a destination for "plan" meaning)

**Todo**:
The agent's live task ticker — the tasks the agent updates as it works (e.g. via its
`todowrite` tool). Consumption value is *live*: watching the agent tick tasks off while
streaming a session, not reading a finished document. It is **not** the Plan.
_Avoid_: plan (they are not the same)

## File-change vocabulary

One conversation event, one focused projection, one change summary. These must not collapse
into each other.

**ToolCall**:
A single tool invocation in a message (edit, write, read, bash, …). The conversation record.
_Avoid_: treating an edit/write tool call as itself a "file edit" meaning a change summary

**FileEdit**:
A projection of an edit/write `ToolCall` into file-change evidence (old/new content for a
path). Not an independent concept — derived from a `ToolCall`, never from source of truth.
_Avoid_: diff, change summary (FileEdit is evidence, not a summary)

**DiffFile**:
The change summary for one file: path, status, additions/deletions, optional patch. A
top-level concept. Fed from agent-native diff tracking where available, else synthesized
from `FileEdit`s; the synthesized form is a trusted stand-in, so it carries no provenance
tag and the UI renders it like any other change.
_Avoid_: file edit (a DiffFile is a summary, an edit is evidence)

## Agent and sub-agent identity

Who produced the work — the parent agent or a subordinate. Modeled as first-class identity,
not an ad-hoc string, because most agent sessions have a parent/child split.

**Parent**:
The top-level agent driving a session (opencode, copilot, …). Identified as itself, never
by a "main" sentinel string.
_Avoid_: "main" as a magic string meaning the parent

**Sub-agent** (child):
A subordinate agent invoked within a parent session (research, code-review, agent-sub-1).
A session and each message mention which sub-agent (or none = the parent) produced it.
_Avoid_: parent/child only at the session level — messages need it too

**Parent session**:
The relation that links a sub-agent session back to the parent that spawned it (a session
with a sub-agent has a parent session; `ParentID`)
_Avoid_: calling a parent session a "sub-agent"

## Metadata vocabulary

A normalized set of semantic keys that per-adapter detail maps into, so consumers match
**not** per-adapter literals. The same discipline as tool-name canonicalization, but for
message/tool-call detail keys.

**Metadata**:
Canonical, vocabulary-governed attribute keys attached to messages and tool calls
(the clean set — status codes, fallibility, privacy, commands), each with a single agreed
shape per type. Raw agent detail is mapped to these in the ingest layer, never leaked as
adapter-specific key names.
_Avoid_: arbitrary key-value grab-bags of per-adapter literals

## Model attribution

Which model produced which work. The session's model is the *current* one; the effective
model at the moment each message was generated lives on the message, because a session can
switch models mid-flight (an in-session `/model` switch).

**Current model**:
The model a session is running as of its latest update (surfaced on the `Session`).
_Avoid_: implying it was true for earlier messages

**Message model**:
The model that generated a particular message, recorded when the message is produced.
Authoritative signal of the session's model *over time*, so per-adapter details never have to
be guessed from the session's current model alone.

## Navigation intent (frontend)

The frontend's answer to "where am I, and where am I going?" — which session is selected,
which view/tab/section is showing, and the message-jump focus target. Owns every navigation
state transition so callers cross one seam with intent verbs instead of wiring raw setters.

- **Module:** `internal/frontend/src/hooks/navigationReducer.ts` (pure transition table) bound
  by `internal/frontend/src/hooks/useNavigation.tsx` (React + URL hash + notification
  side-effects).
- **Interface:** a `NavigationState` and typed actions — `SESSION_SELECT`, `JUMP_TO_MESSAGE`,
  `BOOKMARK_SELECT`, `NOTIFICATION_SELECT`, `SEARCH_HIT_SELECT`, `GO_HOME`, `NAV_SESSION_DELTA`,
  `OPEN_TAG`, plus the raw setters. The binding exposes the verbs (navigateToSession,
  jumpToMessage, goHome, …) through a single `NavigationContext`.
- **Seam:** every entry point into a selected session crosses it — Sidebar, SearchPanel,
  notifications, bookmarks, the prompt queue, keyboard shortcuts, and the URL hash (deep
  links and back/forward). Leaf consumers (`ConversationView`, tool-call renderers) read the
  same context instead of separate focus/nav providers.
