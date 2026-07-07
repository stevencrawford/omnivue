# Ingest Adapter Conventions

## Canonical per-adapter file layout

Every adapter follows this fixed file set, in this order. A file is omitted only
when the responsibility does not apply (e.g. no Plan support).

| File | Responsibility |
|------|----------------|
| `adapter.go` | Dispatch shell only: `init()`, `detectPath()`, `New()`, `Adapter` struct, `Type()`, `Detect()`, `Close()`, `ResumeCommand()`, `LastModified()` cache wrapper. No listing/parsing/extraction logic. |
| `store.go` | Sole raw data-access layer. Opens files, queries SQLite, walks dirs, reads indexes. Returns raw bytes/strings/`*sql.Rows`. JSONL adapters: file discovery + index reading. SQLite adapters: DB handle + query helpers. Hybrid (cursor, copilot): both backends. |
| `types.go` | Adapter-native envelope/payload structs only. Never redefines `ingest.*` domain types. |
| `sessions.go` | `ListSessions()`, `Session()`, `loadSessions()`, `parseSessionFile()` + session-level helpers (title extraction, status mapping, repo/dir derivation). |
| `messages.go` | `Messages()` + the parse pipeline (`parseMessages`, `parseAssistantContent`, `extractUserContent`, etc.). |
| `normalize.go` | Sole location for tool-name + I/O field normalization (`normalizeToolCall` and any `normalize<Format>Input/Output`). No inline normalization elsewhere. |
| `edits.go` | `Edits()`, `Diffs()`, `parseEditContent()` + diff helpers. |
| `plan.go` | `Plan()` + plan helpers. Omitted entirely where `Plan()` returns `(nil, nil)`. |

Adapter-specific files kept as-is (genuinely unique, documented below):
- `content.go`, `pricing.go`, `toolresults.go` (claude-code)
- `output_format.go`, `paths.go` (cursor)
- `events.go`, `events_metadata.go`, `db.go`, `todo_state.go` (copilot)
- `filecontext.go`, `diff_metrics.go` (opencode)
- `patch.go` (codex)

## Rules

### `adapter.go` is a dispatch shell

No business logic. Only:
- Lifecycle: `init()`, `detectPath()`, `New()`, `Close()`
- Accessors: `Type()`, `Detect()`
- Cache wrapper: `LastModified()` invalidates and delegates
- Command: `ResumeCommand()`

`ListSessions`/`Session`/`Messages`/`Plan`/`Edits`/`Diffs` live in their
respective files, never in `adapter.go`.

### `store.go` is the sole I/O layer

Only `store.go` opens files, queries SQLite, walks directories, or reads
indexes. All other files consume raw data and produce domain types. For
SQLite adapters: DB handle + query helpers. For JSONL adapters: file
discovery + index reading. For hybrid adapters (cursor, copilot): both
backends side by side.

### `normalize.go` is the sole normalization location

`normalizeToolCall` (and any `normalize<Format>Input/Output`) live
exclusively in `normalize.go`. Never inline tool-name or field-name mapping
in `messages.go` or `adapter.go`.

### Types stay in `types.go`

Adapter-native envelope/payload structs only. Domain types (`ingest.Session`,
`ingest.Message`, `ingest.ToolCall`, etc.) come from the `ingest` package
and are never redefined.

### Omitted files signal absent capabilities

No `plan.go` means `Plan()` returns `(nil, nil)`. No `edits.go` means
`Edits()` and `Diffs()` return `(nil, nil)`. The omission is the
documentation.

### Naming conventions

- Public method names match the `Adapter` interface exactly.
- Internal helpers are `parse*`/`extract*`/`normalize*`.
- Avoid `Get*` prefixes — use `Session()` not `GetSession()`.

## Canonical edit-input field schema

All adapters normalize to these destination field names when producing
`ingest.ToolCall.Input` or `ingest.FileEdit`:

| Field | Purpose |
|-------|---------|
| `filePath` | Target file path |
| `oldStr` / `oldString` | Content to replace (edit only) |
| `newStr` / `newString` | Replacement content |
| `content` | Full file content (write/create only) |
| `query` | Search pattern (grep) |
| `pattern` | Glob pattern (glob) |
| `directory` | Search directory (glob) |
| `command` | Shell command (bash) |

Native aliases (`file_path`, `path`, `file`, `new_content`, `old_content`,
`pattern` for grep, etc.) are mapped to these canonical names in
`normalize.go`.

## When to promote a helper to `ingestkit`

- **≥3 adapters** share the same logic (e.g. `ScanJSONL`, `ParseTime`).
- **≥2 adapters** share byte-identical logic.

**Exception — import-cycle constraint:** `DiffStatsFromEdits` lives in
package `ingest` (not `ingestkit`) because it operates on `ingest.FileEdit`
/ `ingest.DiffFile` types that `ingestkit` cannot import (circular
dependency). When a helper's signature references types from the `ingest`
package itself, promote to `ingest` instead of `ingestkit`.

Below either bar, keep the helper in the adapter package. Prefer
conservative extraction — a helper extracted too early constrains future
adapters.
