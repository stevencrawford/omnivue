# sess

**sess** is a CLI tool that watches AI coding agent sessions — currently [OpenCode](https://opencode.ai) and [GitHub Copilot](https://github.com/features/copilot) — and presents them in a browser UI for easy browsing, searching, and management. A Go HTTP server embeds a React SPA as a single binary.

## Features

- **Multi-agent support** — OpenCode and Copilot out of the box; extensible via the `Adapter` interface
- **Browser UI** — Tabbed session viewer with conversation, plan, and diff views
- **Live updates** — SSE-based polling (30s) detects new and changed sessions automatically
- **Full-text search** — FTS5 index across all session content (messages, plans, diffs)
- **User folders** — Virtual organization of sessions stored in `sess.db`
- **Resume sessions** — One-click copy of the CLI command to resume a session
- **Read-only access** — Never writes to agent databases (enforced at the driver level)
- **Single binary** — Go backend + embedded React SPA, zero runtime dependencies
- **Light/dark theme** — GitHub-style theme with persistent preference

## Quick Start

```console
# Initialize sources (auto-discovers OpenCode, Copilot)
$ sess init

# Start the server (opens browser automatically)
$ sess

# Or run in foreground on a custom port
$ sess --foreground --port 16275

# Add a source manually
$ sess add ~/.local/share/opencode
$ sess add ~/.copilot --type copilot
```

## Installation

### From source

Requires Go 1.26+ and [pnpm](https://pnpm.io/).

```console
$ make build
```

### Binary

Download from the [releases page](https://github.com/stevencrawford/sess/releases).

## CLI Usage

```console
$ sess [flags]
$ sess init
$ sess add <path> [--type opencode|copilot]
```

### Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `6275` | Server port |
| `--bind` | `-b` | `localhost` | Bind address |
| `--open` | | | Always open browser |
| `--no-open` | | | Never open browser |
| `--foreground` | | | Run server in foreground |
| `--status` | | | Show status of running servers |
| `--shutdown` | | | Shut down the running server |
| `--restart` | | | Restart the running server |
| `--json` | | | Output structured data as JSON |

### Subcommands

- **`init`** — Discover and configure AI agent session sources interactively
- **`add <path>`** — Manually add a session source (`--type opencode` or `--type copilot`)

### Single-instance behavior

`sess` probes `/_/api/status` on startup. If a server is already running, it opens the browser and exits — no duplicate server is started.

### Session management

```console
# Show running servers
$ sess --status

# Shut down the server on the default port
$ sess --shutdown

# Restart the server
$ sess --restart
```

## Architecture

```
                    ┌────────────────────┐
                    │   Browser (SPA)    │
                    │  React 19 + TS     │
                    └────────┬───────────┘
                             │ HTTP / SSE
                    ┌────────▼───────────┐
                    │   Go HTTP Server   │
                    │  (internal/server) │
                    └────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼──────┐ ┌────▼─────┐ ┌──────▼─────┐
    │  ingest/opencode│ │ingest/   │ │  store/    │
    │  (SQLite, RO)   │ │copilot   │ │ (sess.db)  │
    │                 │ │(SQLite,  │ │ FTS5,      │
    │                 │ │ JSONL)   │ │ folders)   │
    └─────────────────┘ └──────────┘ └────────────┘
```

### Key packages

| Package | Purpose |
|---------|---------|
| `cmd/` | CLI entry point (Cobra), single-instance detection, server lifecycle |
| `internal/ingest/` | Core ingest layer: `Adapter` interface, type definitions, auto-detection |
| `internal/ingest/opencode/` | OpenCode adapter — reads `opencode.db` (SQLite, read-only) |
| `internal/ingest/copilot/` | Copilot adapter — reads `session-store.db` + `events.jsonl` |
| `internal/store/` | Manages `$XDG_STATE_HOME/sess/sess.db`: sources, folders, FTS5 index |
| `internal/server/` | HTTP server, session state, SSE, 30s polling for changes |
| `internal/frontend/` | Vite + React 19 + TypeScript + Tailwind CSS v4 SPA |
| `internal/static/` | `go:generate` + `go:embed` for frontend build output |
| `internal/logfile/` | Rotating JSON logging to `$XDG_STATE_HOME/sess/log/` |
| `internal/xdg/` | XDG Base Directory path helper |
| `version/` | Version and revision constants |

### Design principles

- **Read-only agent data** — All SQLite connections use `?mode=ro`. The `OpenReadOnlyDB()` helper verifies read-only mode at open time.
- **Unified session model** — Adapters normalize agent-specific formats to common `Session`/`Message` types.
- **Auto-discovery** — `sess init` scans known paths (`~/.local/share/opencode`, `~/.copilot`).
- **Live-reload via SSE** — Background polling detects new/changed sessions and pushes updates to the frontend.
- **Persistent search** — FTS5 in `sess.db` indexes all session content incrementally.
- **Virtual folders** — Session organization is stored in `sess.db`, not the filesystem.

## Adding a new agent adapter

Implement the `ingest.Adapter` interface:

```go
type Adapter interface {
    Type() AgentType
    Detect(path string) bool
    ListSessions(ctx context.Context) ([]Session, error)
    GetSession(ctx context.Context, id string) (*Session, error)
    GetMessages(ctx context.Context, sessionID string) ([]Message, error)
    GetPlan(ctx context.Context, sessionID string) (*Plan, error)
    GetDiffs(ctx context.Context, sessionID string) ([]DiffFile, error)
    ResumeCommand(session *Session) string
    LastModified(ctx context.Context) (int64, error)
    Close() error
}
```

See `internal/ingest/opencode/` and `internal/ingest/copilot/` for reference implementations.

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/_/api/status` | Server status (version, PID, source/session counts) |
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

- **Framework**: React 19 + TypeScript + Tailwind CSS v4
- **Key components**: `SessionViewer` (tabbed detail), `Sidebar` (resizable session tree), `MarkdownContent`, `PlanView`, `DiffView`, `ThemeToggle`
- **State**: SSE-powered live updates via `useSSE` hook
- **Build**: Vite 8, `go:embed` into the Go binary

## Data sources

| Agent | Location | Format | Data |
|-------|----------|--------|------|
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | Sessions, messages, parts, todos, diffs, tokens, costs |
| OpenCode snapshots | `~/.local/share/opencode/snapshot/` | Git bare repos | File-level rewind |
| Copilot | `~/.copilot/session-store.db` | SQLite | Sessions, turns, checkpoints, FTS index |
| Copilot events | `~/.copilot/session-state/<uuid>/events.jsonl` | JSONL | Full conversation + tool calls |
| Copilot plans | `~/.copilot/session-state/<uuid>/checkpoints/` | Markdown | Implementation plans |
| Copilot snapshots | `~/.copilot/session-state/<uuid>/rewind-snapshots/` | JSON + raw files | File backups |

## Build from source

```console
$ make build        # Full build (frontend + Go binary)
$ make generate     # Frontend code generation only
$ make test         # Run all tests (frontend + Go)
$ make lint         # Run all linters
$ go test ./...     # Run Go tests only
```

## License

MIT License — see [LICENSE](LICENSE).
