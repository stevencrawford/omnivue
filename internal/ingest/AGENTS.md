# Ingest Adapters — Integration Guide

This file explains how to add a new agent adapter to Omnivue, the patterns used by existing adapters, and best practices for tool call normalization.

## Adapter Interface

Every adapter implements `ingest.Adapter` defined in `internal/ingest/adapter.go`:

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

## Unified Types

All types are in `internal/ingest/types.go`:

| Type | Purpose |
|------|---------|
| `Session` | Unified session metadata (title, repo, model, cost, tokens, status, timestamps, counts) |
| `Message` | Conversation message with role, content, tool calls, reasoning, step events |
| `ToolCall` | Tool invocation with name, input, output, status, duration, metadata |
| `FileEdit` | Raw edit/write tool call data (filePath, oldStr, newStr) |
| `DiffFile` | File change with path, status, additions/deletions, unified diff patch |
| `Plan` | Implementation plan as markdown |
| `StepEvent` | Step-start/step-finish markers with snapshot and cost info |
| `Source` | Configured data source |

## Best Practices

### Read-Only Safety

Agent databases must never be modified. Use `ingest.OpenReadOnlyDB()` for all SQLite access. This opens the database with `?mode=ro` and verifies read-only mode by attempting a write:

```go
db, err := ingest.OpenReadOnlyDB(dbPath)
if err != nil {
    return nil, fmt.Errorf("myagent adapter: %w", err)
}
```

### Content Truncation

Large file content in tool call input/output fields can bloat API payloads. Cursor's adapter caps blocks at 2000 bytes:

```go
const maxContentBytes = 2000
func truncateContent(s string) string { ... }
```

Follow this pattern when embedding file contents into `ToolCall.Input` or `ToolCall.Output`.

### Error Handling

- Wrap all errors with a prefix like `"myagent adapter: %w"` for traceability
- Return `(nil, nil)` from `GetPlan` / `GetDiffs` if the agent doesn't support the feature
- Log and skip malformed records rather than failing the entire listing

### Polling

Implement `LastModified` to return the latest modification timestamp across all sessions (unix milliseconds). This drives the server's adaptive polling (5s when active, 30s when idle). Query agent tables or scan filesystem timestamps.

## Existing Adapters

### OpenCode (`internal/ingest/opencode/`)

- **Source**: Single SQLite file (`~/.local/share/opencode/opencode.db`)
- **Table structure**: `session`, `message`, `project`, `todo`, `task`
- **Messages**: Stored in `message` table with `parts` column containing JSON array of content parts (text + tool calls)
- **Tool calls**: Inline in message parts with standard names (`edit`, `write`, `read`, `bash`, `grep`, `glob`, `todowrite`, `task`, `question`, `webfetch`, `websearch`, `codesearch`)
- **Plans**: Synthesized from `todo` and `task` tables
- **Diffs**: Computed from `tool_call` data and snapshot git repos
- **Resume**: `opencode --resume <session_id>`
- **Key pattern**: Parse message parts JSON to extract text content and tool calls:

  ```go
  var parts []struct {
      Type string          `json:"type"`
      Text string          `json:"text"`
      ToolCall *ingest.ToolCall `json:"tool_call,omitempty"`
  }
  json.Unmarshal([]byte(msg.Parts), &parts)
  ```

### Copilot (`internal/ingest/copilot/`)

- **Sources**: Multi-source — `session-store.db` (SQLite) + `session-state/<uuid>/events.jsonl` (JSONL) + `checkpoints/` (Markdown)
- **Table structure**: `sessions`, `turns`, `session_files` in `session-store.db`
- **Messages**: From `events.jsonl` — each line is a conversation turn with content parts (text + tool_use)
- **Tool calls**: Only `tool_use` type in events (limited detail). The adapter stores them but with minimal metadata.
- **Plans**: From `checkpoints/` directory as markdown files
- **Diffs**: From `session_files` table (file path + status) — no unified diff patch available
- **Resume**: `copilot --session <session_id>`
- **Key pattern**: Parse JSONL events with scanner, extract tool calls from content array:

  ```go
  scanner := bufio.NewScanner(f)
  for scanner.Scan() {
      line := scanner.Bytes()
      // parse envelope with Message.Content[] containing text/tool_use items
  }
  ```

### Cursor (`internal/ingest/cursor/`)

- **Sources**: `state.vscdb` (SQLite KV) + `projects/<uuid>/*.jsonl` (agent transcripts) + `ai-code-tracking.db` (enrichment)
- **KV store**: Key-value table `cursorDiskKV` with keys like `composerData:<id>`, `bubbleId:<session>:<id>`, `composer.content.<hash>`
- **Bubble messages**: Full conversation from KV store with tool call data (preferred path)
- **Transcript fallback**: From JSONL files when bubble data is unavailable
- **Tool call normalization**: Cursor uses native names (`read_file_v2`, `edit_file_v2`, `glob_file_search`, etc.) that must be mapped to standard names. See `normalizeToolCall()` function.
- **Content resolution**: Cursor stores file content under `composer.content.<hash>` keys; `readContentBlock()` resolves these references
- **Key pattern**: KV store queries with `LIKE` pattern matching:

  ```go
  rows, err := a.db.QueryContext(ctx,
      `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
  ```

### Pi (`internal/ingest/pi/`)

- **Sources**: Single source — `~/.pi/agent/sessions/*.jsonl` (JSONL files)
- **Session data**: Each `.jsonl` file is a session, starting with a session header line (`"session"` type) followed by event lines
- **Events**: `model_change`, `thinking_level_change`, `message` (user/assistant), `toolResult`
- **Messages**: Assistant messages may contain `text`, `thinking` (reasoning), and `toolCall` content parts
- **Tool calls**: Parsed from JSON but not normalized to standard names (pass-through)
- **Plans/Diffs**: Not supported — returns `(nil, nil)`
- **Resume**: `cd /path && pi --session <id>`
- **Key pattern**: Parse JSONL files with scanner, read first line as session header, subsequent lines as events:

## Tool Call Normalization

Different agents use different naming conventions for tool calls. The frontend expects standard names. The normalization happens at two levels:

### 1. Backend normalization (in adapters)

Cursor's `normalizeToolCall()` is the most comprehensive example (`internal/ingest/cursor/cursor.go:953`). It maps:

| Cursor name | Standard name |
|-------------|---------------|
| `edit_file_v2` | `edit` |
| `read_file_v2` | `read` |
| `glob_file_search` | `glob` |
| `ripgrep_raw_search` | `grep` |
| `run_terminal_command_v2` | `bash` |
| `delete_file` | `delete` |

It also renames fields within the input JSON:
- `targetFile`, `effectiveUri`, `relativeWorkspacePath` → `filePath` (for read)
- `params` → `input`, `contents`, `streamingContent`, `newStr` → `newString` (for edit)
- `pattern` → `query` (for grep)
- `globPattern`, `targetDirectory` → `pattern`, `directory` (for glob)

### 2. Frontend normalization (in toolDisplay.ts)

The `effectiveToolKind()` function (`internal/frontend/src/utils/toolDisplay.ts:18`) provides a second layer of normalization:
- Maps `view` → `read`, `create` → `write`, `edit_file_v2` → `edit`
- Guesses tool kind from input field presence (e.g., `command` field → `bash`, `filePath` + `offset` → `read`)
- Uses `extractJSONField()` to peek into input JSON without full parsing

**When adding a new adapter**: implement backend normalization in the adapter to map agent-native names to the standard set. This keeps the frontend renderer list clean and avoids frontend changes for each new agent.

## Adding a New Adapter — Step by Step

### 1. Create package directory

```
internal/ingest/myagent/
├── myagent.go
└── myagent_test.go
```

### 2. Implement Adapter struct

```go
package myagent

import (
    "context"
    "database/sql"
    "fmt"
    "github.com/stevencrawford/omnivue/internal/ingest"
    _ "modernc.org/sqlite"
)

type Adapter struct {
    db       *sql.DB
    basePath string
}

func New(basePath string) (*Adapter, error) {
    // Find the database file within basePath
    dbPath := filepath.Join(basePath, "myagent.db")
    db, err := ingest.OpenReadOnlyDB(dbPath)
    if err != nil {
        return nil, fmt.Errorf("myagent adapter: %w", err)
    }
    return &Adapter{db: db, basePath: basePath}, nil
}
```

### 3. Register the agent type

Add a constant in `internal/ingest/types.go`:

```go
const (
    AgentOpenCode AgentType = "opencode"
    AgentCopilot  AgentType = "copilot"
    AgentCursor   AgentType = "cursor"
    AgentMyAgent  AgentType = "myagent"
)
```

### 4. Add auto-discovery

Add the known path in `internal/ingest/detect.go`:

```go
var KnownPaths = []struct {
    Path      string
    AgentType AgentType
    Label     string
}{
    // ... existing entries ...
    {"~/.myagent", AgentMyAgent, "MyAgent"},
}
```

Add a detect function and detection case in `AutoDiscover()`:

```go
case AgentMyAgent:
    if d := detectMyAgent(path); d != nil {
        discovered = append(discovered, *d)
    }
```

### 5. Add adapter factory

Add a case in `internal/server/server.go` in `createAdapter()`:

```go
case ingest.AgentMyAgent:
    return myagent.New(src.Path)
```

### 6. Add CLI support

- `--type` flag in `cmd/add.go`:
  ```go
  case ingest.AgentMyAgent:
      label = "MyAgent"
  ```
- Default case error message should list all valid types
- Display in `cmd/init.go` help text

### 7. Implement all interface methods

- `Detect(path string) bool` — Check if the path contains recognizable data
- `ListSessions(ctx)` — Query and return all sessions sorted by `UpdatedAt` desc
- `GetSession(ctx, id)` — Return single session (can delegate to `ListSessions` + filter)
- `GetMessages(ctx, id)` — Return conversation messages with tool calls normalized
- `GetPlan(ctx, id)` — Return plan markdown or `(nil, nil)`
- `GetDiffs(ctx, id)` — Return file changes or `(nil, nil)`
- `GetEdits(ctx, id)` — Return edit/write tool call data (reuse GetMessages logic)
- `ResumeCommand(session)` — Return CLI command string to resume
- `LastModified(ctx)` — Return latest unix millisecond timestamp

### 8. Add tests

Follow the pattern in existing adapter tests:
- `TestAdapter_ListSessions` — Verify session listing works
- `TestAdapter_LastModified` — Verify timestamp query
- Table-driven tests using temporary databases

## Interface Method Details

### ListSessions

Returns all sessions sorted by `UpdatedAt` descending. Required fields:
- `ID` — Unique session identifier
- `Agent` — Set to `ingest.AgentMyAgent`
- `Title` — Human-readable session name (derive from summary, directory, or ID)
- `Status` — One of `"active"`, `"completed"`, `"archived"` (the server overrides this with liveness heuristic)
- `CreatedAt`, `UpdatedAt` — Timestamps
- `MessageCount` — Used to filter empty Copilot sessions (count messages or tool calls)

Optional but recommended:
- `Directory` — Working directory for the session
- `Repository` — Repo name for grouping in the sidebar
- `Model` — AI model identifier
- `Cost` — Total cost in USD
- `TokensInput`, `TokensOutput`, `TokensReasoning` — Token usage

### GetMessages

Returns conversation messages in chronological order. Each message has:
- `Role` — `"user"`, `"assistant"`, or `"system"`
- `Content` — Markdown text content
- `ToolCalls` — Array of `ToolCall` objects with names normalized to standard set
- `Reasoning` — Model thinking/reasoning content (shown as collapsible in UI)
- `StepEvents` — Step-start/step-finish markers (e.g., plan mode → code mode transitions)

### GetEdits

Returns raw edit/write tool call data extracted from messages. Used for file-level diff reconstruction in the frontend. Each `FileEdit` has:
- `FilePath` — Path to the file
- `ToolName` — `"edit"` or `"write"`
- `OldStr`, `NewStr` — Before/after content

If the agent stores content by reference (like Cursor's content IDs), resolve the actual content before returning.

### ResumeCommand

Return the CLI command the user would run to resume the session. Examples:
- OpenCode: `cd /path && opencode --resume <id>`
- Copilot: `cd /path && copilot --session <id>`
- Cursor: `cd /path && cursor --composer <id>`
- Pi: `cd /path && pi --session <id>`
