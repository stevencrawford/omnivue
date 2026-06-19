# sess

**sess** is a CLI tool that watches AI coding agent sessions — [OpenCode](https://opencode.ai), [GitHub Copilot](https://github.com/features/copilot), and [Cursor](https://cursor.com) — and presents them in a browser UI for easy browsing, searching, and management. A Go HTTP server embeds a React SPA as a single binary.

## Features

- **Multi-agent support** — OpenCode, Copilot, and Cursor out of the box; extensible via the `Adapter` interface
- **Browser UI** — Tabbed session viewer with conversation, plan, and diff views
- **Live updates** — Adaptive SSE-based polling (5s when active, 30s when idle)
- **Full-text search** — FTS5 index across all session content, scoped or global
- **User folders** — Virtual organization with nesting, color, and icon support
- **Scratch notes** — Per-session markdown notes with rich text or code editor
- **Session renaming** — Override display names from the sidebar
- **Settings UI** — Add/remove session sources from the browser
- **Resume sessions** — One-click copy of the CLI command to resume
- **Keyboard-driven** — `j`/`k` navigate, `⌘1`/`⌘2` tabs, `⌘P` search
- **Deep linking** — Shareable URLs `#/session/{id}/step/{n}`
- **Read-only access** — Never writes to agent databases (enforced at driver level)
- **Single binary** — Go + embedded React SPA, zero runtime dependencies
- **Light/dark theme** — GitHub-style theme with persistent preference

## Quick Start

```console
# Initialize sources (auto-discovers OpenCode, Copilot, Cursor)
$ sess init

# Start the server (opens browser automatically)
$ sess

# Or run in foreground on a custom port
$ sess --foreground --port 16275

# Add a source manually
$ sess add ~/.local/share/opencode
$ sess add ~/.copilot --type copilot
$ sess add ~/.cursor --type cursor
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
$ sess add <path> [--type opencode|copilot|cursor]
```

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

### Lifecycle

`sess` probes `/_/api/status` on startup. If a server is already running, it opens the browser and exits — no duplicate server is started. Use `--status`, `--shutdown`, and `--restart` to manage running instances.

## Architecture

```
                    ┌────────────────────┐
                    │   Browser (SPA)    │
                    └────────┬───────────┘
                             │ HTTP / SSE
                    ┌────────▼───────────┐
                    │   Go HTTP Server   │
                    │  adaptive polling  │
                    └────────┬───────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼────────┐ ┌────────▼──────┐ ┌───────────▼────┐
│ OpenCode       │ │ Copilot       │ │ Cursor         │
│ adapter        │ │ adapter       │ │ adapter        │
└────────────────┘ └───────────────┘ └────────────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  sess.db       │
                    │ FTS5, folders, │
                    │ scratch, config│
                    └─────────────────┘
```

The backend normalizes agent-specific session data into a unified model via the `Adapter` interface. See [docs/ADAPTERS.md](docs/ADAPTERS.md) for implementing new adapters and [docs/API.md](docs/API.md) for the full HTTP API reference.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `ArrowDown` | Select next session |
| `k` / `ArrowUp` | Select previous session |
| `⌘1` / `Ctrl+1` | Conversation tab |
| `⌘2` / `Ctrl+2` | Diff tab |
| `⌘P` / `Ctrl+P` | Open search |
| `Escape` | Close search / results |

## Build from source

```console
$ make build        # Full build (frontend + Go binary)
$ make generate     # Frontend code generation only
$ make test         # Run all tests (frontend + Go)
$ make lint         # Run all linters
$ go test ./...     # Run Go tests only
```

## Learn more

- [API reference](docs/API.md) — All HTTP endpoints
- [Adapters](docs/ADAPTERS.md) — Data sources, implementing new agent adapters
- [Frontend](docs/FRONTEND.md) — Component catalog, hooks, dependencies

## License

MIT License — see [LICENSE](LICENSE).
