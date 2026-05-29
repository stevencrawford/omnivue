# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is sess

`sess` is a CLI tool that watches AI coding agent sessions (OpenCode, GitHub Copilot) and presents them in a browser UI for easy browsing, searching, and management. It runs a Go HTTP server that embeds a React SPA as a single binary. The Go module is `github.com/stevencrawford/sess`.

Forked from [mo](https://github.com/k1LoW/mo) (a Markdown viewer), `sess` repurposes the architecture for AI session management.

## Build & Run

Requires Go 1.26+ and [pnpm](https://pnpm.io/). Node.js version is managed via `pnpm.executionEnv.nodeVersion` in `internal/frontend/package.json`.

```bash
# Full build (frontend + Go binary, with ldflags)
make build

# Run in foreground (dev mode)
./sess --foreground --port 16275

# Initialize sources (auto-discovers OpenCode, Copilot)
./sess init

# Add a source manually
./sess add ~/.local/share/opencode
./sess add ~/.copilot --type copilot

# Frontend code generation only (called by make build via go generate)
make generate

# Run all tests (frontend + Go)
make test

# Run Go tests only
go test ./...

# Run linters
make lint
```

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

- `sess init` — Discover and configure AI agent session sources interactively
- `sess add <path> [--type opencode|copilot]` — Manually add a session source

## Architecture

**Go backend + embedded React SPA**, single binary.

- `cmd/root.go` — CLI entry point (Cobra). Handles single-instance detection, server lifecycle (background/foreground), status/shutdown/restart.
- `cmd/init.go` — `sess init` command: auto-discovers session sources, interactive prompts.
- `cmd/add.go` — `sess add` command: manually adds a source.
- `internal/ingest/` — Core ingest layer:
  - `types.go` — Unified types: `Session`, `Message`, `ToolCall`, `PlanItem`, `DiffFile`, `Source`
  - `adapter.go` — `Adapter` interface + `OpenReadOnlyDB()` safeguard
  - `detect.go` — `AutoDiscover()` scans known paths for agent session data
  - `opencode/opencode.go` — OpenCode adapter: reads `opencode.db` (SQLite, read-only)
  - `copilot/copilot.go` — Copilot adapter: reads `session-store.db` + `events.jsonl` (read-only)
- `internal/store/store.go` — Manages `$XDG_STATE_HOME/sess/sess.db`: sources, folders, FTS5 search index
- `internal/server/server.go` — HTTP server, session state, SSE for live-updates, 30s polling for changes
- `internal/static/static.go` — `go:generate` + `go:embed` for frontend build output
- `internal/frontend/` — Vite + React 19 + TypeScript + Tailwind CSS v4 SPA
- `internal/backup/` — State persistence (kept from mo, will be repurposed)
- `internal/logfile/` — Rotating JSON logging to `$XDG_STATE_HOME/sess/log/`
- `internal/xdg/` — XDG Base Directory helper
- `version/version.go` — Version info

## Key Design Patterns

- **Read-only agent data**: We NEVER write to agent databases. All SQLite connections use `?mode=ro`. The `OpenReadOnlyDB()` helper enforces this with a write-attempt assertion.
- **Single instance**: CLI probes `/_/api/status`. If server running, just opens browser.
- **Unified session model**: Adapters normalize agent-specific formats to common `Session`/`Message` types.
- **Auto-discovery**: `sess init` scans known paths (`~/.local/share/opencode`, `~/.copilot`).
- **Live-reload via SSE**: 30s polling detects new/changed sessions, sends `update` events to frontend.
- **Persistent search**: FTS5 in `sess.db` indexes all session content incrementally.
- **User folders**: Stored in `sess.db` (not filesystem) — virtual organization of sessions.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/_/api/status` | Server status (version, pid, source/session counts) |
| GET | `/_/api/sources` | List configured sources |
| GET | `/_/api/sessions` | List all sessions |
| GET | `/_/api/sessions/{id}` | Get session details |
| GET | `/_/api/sessions/{id}/messages` | Get session messages with tool calls |
| GET | `/_/api/sessions/{id}/plan` | Get session plan/checkpoint items |
| GET | `/_/api/sessions/{id}/diffs` | Get session file changes |
| GET | `/_/api/sessions/{id}/resume` | Get CLI command to resume the session |
| GET | `/_/api/search?q=<query>&limit=<n>` | Full-text search across session content |
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
- Key dependencies: `react-markdown`, `remark-gfm`, `remark-breaks`, `rehype-highlight`
- Key components:
  - `App.tsx` — Routing/state, session selection
  - `Sidebar.tsx` — Session tree grouped by repo, resizable
  - `SessionViewer.tsx` — Tabbed detail view (session/plan/diff), message rendering
  - `MarkdownContent.tsx` — Markdown renderer with syntax highlighting
  - `PlanView.tsx` — Plan/checkpoint items with status indicators
  - `DiffView.tsx` — File change list with expandable unified diff view
  - `ThemeToggle.tsx` — Light/dark theme toggle
- Hooks: `useSSE.ts` (SSE with auto-reconnect), `useApi.ts` (typed API fetchers)
- Utilities: `buildTree.ts` (groups sessions by repository)
- Theme: GitHub-style light/dark via `data-theme` attribute
- localStorage keys use `sess-` prefix

## Data Sources

| Agent | Location | Format | Data |
|-------|----------|--------|------|
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | Sessions, messages, parts, todos, diffs, tokens, costs |
| OpenCode snapshots | `~/.local/share/opencode/snapshot/` | Git bare repos | File-level rewind |
| Copilot | `~/.copilot/session-store.db` | SQLite | Sessions, turns, checkpoints, FTS index |
| Copilot events | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL | Full conversation + tool calls |
| Copilot plans | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown | Implementation plans |
| Copilot snapshots | `~/.copilot/session-state/<uuid>/rewind-snapshots/` | JSON + raw files | File backups |

## Phase Status

- [x] Phase 1: Foundation — OpenCode ingest & list (COMPLETE)
- [x] Phase 1.5: Copilot adapter (COMPLETE)
- [x] Phase 2: Session conversation view (messages rendering) (COMPLETE)
- [x] Phase 3: Plan & diff tabs (COMPLETE)
- [x] Phase 4: Persistent search (FTS5 indexing) (COMPLETE)
- [x] Phase 5: User folders (COMPLETE)
- [x] Phase 6: Resume session (COMPLETE)
