# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is Omnivue

`omnivue` is an AI session manager for OpenCode, GitHub Copilot, Cursor, Pi, Claude Code, and Codex. All your sessions, visible in one place. The Go module is `github.com/stevencrawford/omnivue`.

Forked from [mo](https://github.com/k1LoW/mo) (a Markdown viewer), `omnivue` repurposes the architecture for AI session management.

## Build & Run

Requires Go 1.26+ and [pnpm](https://pnpm.io/). Node.js version is managed via `pnpm.executionEnv.nodeVersion` in `internal/frontend/package.json`.

After making changes to any files under `internal/frontend/`, run the following to ensure consistent formatting:

```
cd internal/frontend && pnpm run fmt
```

```bash
# Full build (frontend + Go binary, with ldflags)
make build

# Run in foreground (dev mode)
./omnivue --foreground --port 16275

# Initialize sources (auto-discovers OpenCode, Copilot, Cursor, Pi, Claude Code, Codex)
./omnivue init

# Add a source manually
./omnivue add ~/.local/share/opencode
./omnivue add ~/.copilot --type copilot
./omnivue add ~/.cursor --type cursor
./omnivue add ~/.pi/agent/sessions --type pi
./omnivue add ~/.claude --type claude-code
./omnivue add ~/.codex --type codex

# Frontend code generation only (called by make build via go generate)
make generate

# Run all tests (frontend + Go)
make test

# Run Go tests only
go test ./...

# Run linters
make lint
```

## Pre-Commit Checks for Go Changes

Before committing any Go changes, run ALL of the following:

```bash
# 1. Build must pass
go build ./...

# 2. golangci-lint must return 0 issues
golangci-lint run ./...

# 3. gostyle must return 0 issues (custom lint rules)
go vet -vettool=$(which gostyle) -gostyle.config=.gostyle.yml ./...

# 4. All Go tests must pass
go test ./...

# 5. Full test suite (frontend + Go, required before push)
make test
```

These checks enforce style rules that, if ignored, accumulate into a large
backlog at PR time (e.g. 197 gostyle issues had to be fixed in one batch).
Key gostyle rules that commonly trigger:
- `handlerrors` — never use `_ =` to discard errors
- `getters` — no `Get` prefix on methods (use `Counts` not `GetCounts`)
- `nilslices` — use `len(s) == 0` not `s == nil`
- `repetition` — don't name vars after their type (`createdStr` → `created`)
- `recvtype` — use pointer receivers
- `errorstrings` — lowercase, no punctuation
- `pkgnames` — avoid `util`, `helper`, `common` package names
- `dontpanic` — never use `panic()` in production code

### CLI Flags

- `--port` / `-p` — Server port (default: 6275)
- `--bind` / `-b` — Bind address (default: localhost)
- `--open` — Always open browser
- `--no-open` — Never open browser
- `--foreground` — Run server in foreground (do not background)
- `--status` — Show status of running servers
- `--shutdown` — Shut down the running server
- `--restart` — Restart the running server
- `--json` — Output structured data as JSON

### Subcommands

- `omnivue init` — Discover and configure AI agent session sources interactively
- `omnivue add <path> [--type opencode|copilot|cursor|pi|claude-code|codex]` — Manually add a session source

## Architecture

**Go backend + embedded React SPA**, single binary.

- `cmd/root.go` — CLI entry point (Cobra). Handles single-instance detection, server lifecycle (background/foreground), status/shutdown/restart.
- `cmd/init.go` — `omnivue init` command: auto-discovers session sources, interactive prompts.
- `cmd/add.go` — `omnivue add` command: manually adds a source.
- `internal/ingest/` — Core ingest layer:
  - `types.go` — Unified types: `Session`, `Message`, `ToolCall`, `PlanItem`, `DiffFile`, `Source`, `FileEdit`, `StepEvent`
  - `adapter.go` — `Adapter` interface + `OpenReadOnlyDB()` safeguard
  - `detect.go` — `AutoDiscover()` scans known paths for agent session data
  - `opencode/opencode.go` — OpenCode adapter: reads `opencode.db` (SQLite, read-only)
  - `copilot/copilot.go` — Copilot adapter: reads `session-store.db` + `events.jsonl` (read-only)
  - `cursor/cursor.go` — Cursor adapter: reads `state.vscdb` (SQLite KV) + `agent-transcripts` JSONL + `ai-code-tracking.db` (read-only)
  - `pi/pi.go` — Pi adapter: reads `~/.pi/agent/sessions/*.jsonl` (JSONL, read-only)
  - `claude-code/claude_code.go` — Claude Code adapter: reads `~/.claude/projects/*/*.jsonl` (JSONL, read-only)
- `internal/store/store.go` — Manages `$XDG_STATE_HOME/omnivue/omnivue.db`: sources, folders, FTS5 search index, scratch files, config, session name overrides
- `internal/server/server.go` — HTTP server, session state, SSE for live-updates, adaptive polling (5s live / 30s idle)
- `internal/static/static.go` — `go:generate` + `go:embed` for frontend build output
- `internal/frontend/` — Vite + React 19 + TypeScript + Tailwind CSS v4 SPA
- `internal/backup/` — State persistence (kept from mo, will be repurposed)
- `internal/logfile/` — Rotating JSON logging to `$XDG_STATE_HOME/omnivue/log/`
- `internal/xdg/` — XDG Base Directory helper
- `version/version.go` — Version info

## Key Design Patterns

- **Read-only agent data**: We NEVER write to agent databases. All SQLite connections use `?mode=ro`. The `OpenReadOnlyDB()` helper enforces this with a write-attempt assertion.
- **Single instance**: CLI probes `/_/api/status`. If server running, just opens browser.
- **Unified session model**: Adapters normalize agent-specific formats to common `Session`/`Message` types.
- **Auto-discovery**: `omnivue init` scans known paths (`~/.local/share/opencode`, `~/.copilot`, `~/.cursor`, `~/.pi/agent/sessions`, `~/.claude`, `~/.codex`).
- **Live-reload via SSE**: Adaptive polling (5s when active sessions, 30s when idle) detects new/changed sessions, sends `update` events to frontend.
- **Persistent search**: FTS5 in `omnivue.db` indexes all session content incrementally (content-hash dedup).
- **User folders**: Stored in `omnivue.db` (not filesystem) — virtual organization of sessions (nested, color-coded).
- **Scratch notes**: Per-session markdown notes stored in `omnivue.db`, rendered with rich text (TipTap) or code editor (Monaco).
- **Session renaming**: Display name overrides stored in `omnivue.db`, persisted across restarts.

## Database Schema Migrations

The application's own persistent state lives in `$XDG_STATE_HOME/omnivue/omnivue.db` (sources, folders, FTS5 search index, scratch files, config, bookmarks, session name overrides). This is the **only** surface where a new binary version can break against state from an older binary — the frontend ships inside the binary and agent data is always read-only, so neither is a breaking-change surface.

Schema changes are managed by **forward-only, version-tracked migrations** in `internal/store/migrate.go`. The `schema_migrations` table records the applied version; `store.New()` runs `migrate()` automatically on every startup, so **no special command is needed** — a user who downloads a newer binary gets migrated on the next launch. There is intentionally **no auto-downgrade**; downgrading the binary is unsupported (restore a backup if required).

### What requires a new migration file

Append a new entry to the `migrations` slice in `internal/store/migrate.go` with the next integer version, a short `desc`, and an `up` function for **any** change to the `omnivue.db` schema or the semantics of its data:

- Adding a new table, column, index, or constraint.
- Renaming, retyping, or dropping a column/table (use a create-copy-drop-rename rebuild).
- Adding a `NOT NULL` column without a usable default for existing rows (must backfill).
- Changing the meaning of a `config` key or any stored value (rewrite in the migration).
- Changing the FTS5 `search_index`/`index_state` schema. **These two tables are rebuildable** from agent data — drop and recreate them, then bump the version; the next poll cycle reindexes transparently. This is not user-data loss.

A change that only adds a new Go struct field, a new API endpoint, or new read logic that works against the *existing* schema does **not** need a migration.

### Rules

- **Never modify, reorder, or delete** an existing migration entry. Once a version is in a release, databases in the wild are stamped at that version. Edit an old migration and you corrupt them. Append only.
- Migrations must be **idempotent at the statement level** where possible (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded for prior existence) so the baseline (v1) is safe to run against a pre-versioning legacy database.
- The first real schema change after the baseline is **v2**. v1 is the baseline that captures the pre-versioning schema in full.
- Wrap data-backfill / multi-statement migrations in a transaction so a partial failure leaves the schema untouched.
- Surface the new version: bump `schemaVersion` (visible in `GET /_/api/status`) in the CHANGELOG when the migration ships, and note whether user data is preserved (it always should be unless intentionally dropping a deprecated table).
- Add or update a test in `internal/store/store_test.go` for any non-trivial migration, especially one that backfills or rebuilds data.
- **Do not** put schema DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`) anywhere in `internal/store/` other than a numbered migration in `migrate.go`.

### Backups

Before applying any migration beyond the recorded version, `store.New()` creates a pre-migration backup copy of `omnivue.db` (+ `-wal`/`-shm`) in the state directory. On migration failure, `New()` returns a descriptive error pointing at the backup; `omnivue reset` remains as the last-resort escape hatch.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/_/api/status` | Server status (version, pid, source/session counts, schemaVersion) |
| GET | `/_/api/sources` | List configured sources |
| POST | `/_/api/sources` | Add a session source |
| DELETE | `/_/api/sources/{id}` | Remove a session source |
| PATCH | `/_/api/sources/{id}` | Update a session source |
| GET | `/_/api/config` | Get all config key-value pairs |
| PUT | `/_/api/config` | Set a config key-value pair |
| GET | `/_/api/sessions` | List all sessions |
| GET | `/_/api/sessions/{id}` | Get session details |
| GET | `/_/api/sessions/{id}/messages` | Get session messages with tool calls |
| GET | `/_/api/sessions/{id}/plan` | Get session plan/checkpoint items |
| GET | `/_/api/sessions/{id}/diffs` | Get session file changes |
| GET | `/_/api/sessions/{id}/edits` | Get raw edit/write tool call data |
| GET | `/_/api/sessions/{id}/resume` | Get CLI command to resume the session |
| PUT | `/_/api/sessions/{id}/name` | Override session display name |
| DELETE | `/_/api/sessions/{id}/name` | Clear session display name override |
| GET | `/_/api/sessions/{id}/scratch` | List scratch files for a session |
| POST | `/_/api/sessions/{id}/scratch` | Create a scratch file |
| GET | `/_/api/sessions/{id}/scratch/{fileId}` | Get a scratch file |
| PUT | `/_/api/sessions/{id}/scratch/{fileId}` | Update a scratch file |
| PATCH | `/_/api/sessions/{id}/scratch/{fileId}` | Rename a scratch file (title only) |
| DELETE | `/_/api/sessions/{id}/scratch/{fileId}` | Delete a scratch file |
| GET | `/_/api/scratch` | List all scratch files across sessions |
| GET | `/_/api/search?q=&limit=&session_id=` | Full-text search (optionally scoped to session) |
| GET | `/_/api/folders` | List all folders |
| POST | `/_/api/folders` | Create a new folder |
| PATCH | `/_/api/folders/{id}` | Update folder (name, color, icon) |
| DELETE | `/_/api/folders/{id}` | Delete a folder |
| GET | `/_/api/folders/{id}/sessions` | List session IDs in a folder |
| POST | `/_/api/folders/{id}/sessions/{sid}` | Assign a session to a folder |
| DELETE | `/_/api/folders/{id}/sessions/{sid}` | Remove a session from a folder |
| POST | `/_/api/shutdown` | Shutdown server |
| POST | `/_/api/restart` | Restart server |
| GET | `/_/events` | SSE event stream (update, session-changed) |

## Frontend

- Package manager: **pnpm**
- Framework: React 19 + TypeScript + Tailwind CSS v4
- Key dependencies: `react-markdown`, `remark-gfm`, `remark-breaks`, `rehype-highlight`, `@monaco-editor/react`, `@tiptap/*`, `diff`, `marked`, `lucide-react`, `turndown`
- Key components:
  - `App.tsx` — Root state, session selection, keyboard shortcuts, URL hash deep-linking
  - `Sidebar.tsx` — Session tree grouped by repo, resizable, section nav (sessions/projects)
  - `SessionViewer.tsx` — Tabbed detail view (session/diff/plan/scratch)
  - `ConversationView.tsx` — Message rendering with step events, reasoning, tool calls
  - `MarkdownContent.tsx` — Markdown renderer with syntax highlighting
  - `PlanView.tsx` — Plan/checkpoint items with status indicators
  - `DiffView.tsx` — File change list with expandable unified diff
  - `DiffRenderer.tsx` — Inline unified diff rendering
  - `ScratchEditor.tsx` — WYSIWYG (TipTap) + code editor (Monaco) for scratch notes
  - `SearchPanel.tsx` — Inline search typeahead
  - `SearchResultsDrawer.tsx` — Full-screen search results
  - `SettingsModal.tsx` — Manage sources, theme
  - `ThemeToggle.tsx` — Light/dark theme toggle
  - `FolderPanel.tsx` — Folder CRUD
  - `AddToProjectDialog.tsx` — Assign sessions to folders
  - `ErrorBoundary.tsx` — Graceful error recovery
  - `IconChannel.tsx` — Section navigation toggle
  - `SessionPanel.tsx` — Session list by repo
  - `ProjectPanel.tsx` — Project-based browsing
  - `ContextMenu.tsx` — Right-click menus
  - `Toast.tsx` — Notification toasts
- Hooks: `useSSE.ts` (SSE with auto-reconnect), `useApi.ts` (typed API fetchers), `useTheme.ts` (theme state/persistence), `useNav.ts` (session nav context)
- Utilities: `buildTree.ts` (groups sessions by repository)
- Theme: GitHub-style light/dark via `data-theme` attribute
- localStorage keys use `omnivue-` prefix.

## Data Sources

| Agent | Location | Format | Data |
|-------|----------|--------|------|
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | Sessions, messages, parts, todos, diffs, tokens, costs |
| OpenCode snapshots | `~/.local/share/opencode/snapshot/` | Git bare repos | File-level rewind |
| Copilot | `~/.copilot/session-store.db` | SQLite | Sessions, turns, checkpoints, FTS index |
| Copilot events | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL | Full conversation + tool calls |
| Copilot plans | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown | Implementation plans |
| Copilot snapshots | `~/.copilot/session-state/<uuid>/rewind-snapshots/` | JSON + raw files | File backups |
| Cursor | `~/.cursor/state.vscdb` | SQLite KV | Composer sessions, bubble messages, tool calls |
| Cursor transcripts | `~/.cursor/projects/<uuid>/*.jsonl` | JSONL | Agentic session transcripts |
| Cursor tracking | `~/.cursor/ai-code-tracking.db` | SQLite | Conversation summaries, model, cost, tokens |
| Pi | `~/.pi/agent/sessions/` | JSONL | Sessions, messages, tool calls, reasoning |
| Claude Code | `~/.claude/projects/*/*.jsonl` | JSONL | Sessions, messages, tool calls, plans, file snapshots |
| Claude Code subagents | `~/.claude/projects/*/*/subagents/agent-*.jsonl` | JSONL | Subagent transcripts |

## Phase Status

- [x] Phase 1: Foundation — OpenCode ingest & list (COMPLETE)
- [x] Phase 1.5: Copilot adapter (COMPLETE)
- [x] Phase 2: Session conversation view (messages rendering) (COMPLETE)
- [x] Phase 3: Plan & diff tabs (COMPLETE)
- [x] Phase 4: Persistent search (FTS5 indexing) (COMPLETE)
- [x] Phase 5: User folders (COMPLETE)
- [x] Phase 6: Resume session (COMPLETE)
- [x] Phase 7: Cursor adapter (COMPLETE)
- [x] Phase 8: Scratch notes + session rename (COMPLETE)
- [x] Phase 9: Settings UI + keyboard shortcuts + deep linking (COMPLETE)
- [x] Phase 10: Pi adapter (COMPLETE)
- [x] Phase 11: Claude Code adapter (COMPLETE)
