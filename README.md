# sess

**sess** is a 100% local session browser for [OpenCode](https://opencode.ai), [GitHub Copilot](https://github.com/features/copilot), [Cursor](https://cursor.com), [Pi](https://pi.ai), and [Codex](https://codex.ai). It is for viewing sessions across your favorite agent harnesses, reading the data already on your developer machine and showing it all in one place.

## Features

- **Multi-agent support** — OpenCode, Copilot, Cursor, Pi, and Codex out of the box; extensible via the `Adapter` interface
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
- **Multi-theme** — Ayu, Nord, Catppuccin, Tokyo Night, and GitHub themes with light/dark modes

## Local by Design

sess keeps your workflow on your machine:

- **100% local** — Reads local session stores and writes only to its own local state database
- **No cloud sync** — Nothing is uploaded, indexed remotely, or sent to a hosted service
- **Read-only adapters** — Agent databases are opened in read-only mode and never modified
- **localhost UI** — The browser app runs against a local server on your machine

## Quick Start

```console
# Initialize sources (auto-discovers OpenCode, Copilot, Cursor, Pi)
$ sess init

# Start the server (opens browser automatically)
$ sess

# Or run in foreground on a custom port
$ sess --foreground --port 16275

# Add a source manually
$ sess add ~/.local/share/opencode
$ sess add ~/.copilot --type copilot
$ sess add ~/.cursor --type cursor
$ sess add ~/.pi/agent/sessions --type pi
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
$ sess add <path> [--type opencode|copilot|cursor|pi]
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
         │                    │                    │
         │                    │                    │
         │                    │                    │
 ┌───────▼────────┐ ┌────────▼──────┐ ┌───────────▼────┐ ┌──────────▼─────┐
 │ OpenCode       │ │ Copilot       │ │ Cursor         │ │ Pi             │
 │ adapter        │ │ adapter       │ │ adapter        │ │ adapter        │
 └────────────────┘ └───────────────┘ └────────────────┘ └────────────────┘
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
| `⌘P` / `Ctrl+P` or `⌘K` / `Ctrl+K` | Open search (scoped to active session) |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
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

## Acknowledgements

sess is a fork of [mo](https://github.com/k1LoW/mo) by [Ken'ichiro Oyama (k1LoW)](https://github.com/k1LoW). The original project was adapted from a Markdown viewer into an AI session manager. We're grateful for the excellent architecture and infrastructure that made this possible.
