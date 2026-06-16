# Copilot Instructions for sess (Agent Harness Session Manager)

## What is sess

`sess` is a CLI tool that watches AI coding agent sessions (OpenCode, GitHub Copilot) and presents them in a browser UI for easy browsing, searching, and management. It runs a Go HTTP server that embeds a React SPA as a single binary. The Go module is `github.com/stevencrawford/sess`.

Forked from [mo](https://github.com/k1LoW/mo) (a Markdown viewer), `sess` repurposes the architecture for AI session management.

## Build & Run

Requires Go 1.26+ and [pnpm](https://pnpm.io/). Node.js version is managed via `pnpm.executionEnv.nodeVersion` in `internal/frontend/package.json`.

```bash
# Full build (frontend + Go binary, with ldflags)
make build

# Dev: build frontend then run with args (uses port 16275, foreground mode)
make dev ARGS="--foreground --port 16275"

# Frontend code generation only (called by make build/dev via go generate)
make generate

# Run all tests (frontend + Go)
make test

# Run a single frontend test (vitest)
cd internal/frontend && pnpm test src/utils/buildTree.test.ts

# Run Go tests only
go test ./...

# Run a single Go test
go test ./internal/server/ -run TestHandleFiles

# Run linters (oxlint for frontend, golangci-lint + gostyle for Go)
make lint

# CI target (install dev deps + generate + test)
make ci
```

### CLI Flags

- `--port` / `-p` — Server port (default: 6275)
- `--bind` / `-b` — Bind address (default: localhost)
- `--open` — Always open browser
- `--no-open` — Never open browser
- `--status` — Show status of running servers
- `--shutdown` — Shut down the running server
- `--restart` — Restart the running server
- `--foreground` — Run server in foreground (do not background)
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
- `internal/logfile/` — Rotating JSON logging to `$XDG_STATE_HOME/sess/log/`
- `internal/xdg/` — XDG Base Directory helper
- `version/version.go` — Version info

## API Endpoints

All internal API endpoints are under `/_/api/` and SSE under `/_/events`. The `/_/` prefix is intentional to avoid collisions with user-facing SPA routes.

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

- Located in `internal/frontend/`, uses **pnpm** as the package manager.
- React 19, TypeScript, Tailwind CSS v4.
- Markdown rendering: `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-highlight`.
- SPA routing via `window.location.pathname` (no router library).
- Key components: `App.tsx` (routing/state, session selection), `Sidebar.tsx` (session tree grouped by repo, resizable), `SessionViewer.tsx` (tabbed detail view with conversation/plan/diff tabs), `MarkdownContent.tsx` (markdown renderer with syntax highlighting), `PlanView.tsx` (plan/checkpoint items with status indicators), `DiffView.tsx` (file change list with expandable unified diff), `ThemeToggle.tsx` (light/dark theme toggle).
- Custom hooks: `useSSE.ts` (SSE subscription with auto-reconnect), `useApi.ts` (typed API fetch wrappers).
- Utilities: `buildTree.ts` (groups sessions by repository).
- Theme: GitHub-style light/dark via `data-theme` attribute on `<html>`. UI components use CSS custom properties (`--color-gh-*`).
- localStorage keys use `sess-` prefix.

## Key Design Patterns

- **Read-only agent data**: We NEVER write to agent databases. All SQLite connections use `?mode=ro`. The `OpenReadOnlyDB()` helper verifies read-only mode at open time.
- **Single instance**: CLI probes `/_/api/status`. If a server is running, opens browser and exits.
- **Unified session model**: Adapters normalize agent-specific formats to common `Session`/`Message` types.
- **Auto-discovery**: `sess init` scans known paths (`~/.local/share/opencode`, `~/.copilot`).
- **Live-reload via SSE**: 30s polling detects new/changed sessions, sends `update` events to frontend.
- **Persistent search**: FTS5 in `sess.db` indexes all session content incrementally.
- **User folders**: Stored in `sess.db` (not filesystem) — virtual organization of sessions.

## Data Sources

| Agent | Location | Format | Data |
|-------|----------|--------|------|
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | Sessions, messages, parts, todos, diffs, tokens, costs |
| OpenCode snapshots | `~/.local/share/opencode/snapshot/` | Git bare repos | File-level rewind |
| Copilot | `~/.copilot/session-store.db` | SQLite | Sessions, turns, checkpoints, FTS index |
| Copilot events | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL | Full conversation + tool calls |
| Copilot plans | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown | Implementation plans |
| Copilot snapshots | `~/.copilot/session-state/<uuid>/rewind-snapshots/` | JSON + raw files | File backups |

## CI/CD

- **CI**: golangci-lint (via reviewdog), gostyle, `make ci` (test + coverage), octocov
- **Release**: tagpr for automated tagging, goreleaser for cross-platform builds. The `go generate` step (frontend build) runs in goreleaser's `before.hooks`.
- **License check**: Trivy scans for license issues
- CI requires pnpm setup (`pnpm/action-setup`) before any Go build step because `go generate` triggers the frontend build.
