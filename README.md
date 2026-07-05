<p align="center">
  <picture>
    <source srcset="site/app_icon.svg" media="(prefers-color-scheme: dark)">
    <img src="site/app_icon.svg" alt="Omnivue" width="120">
  </picture>
</p>
<h1 align="center">Omnivue</h1>
<p align="center">Session browser for OpenCode, Copilot, Cursor, Pi, Claude Code, and Codex.</p>
<p align="center">
  <img alt="Go version" src="https://img.shields.io/badge/Go-1.26-blue?style=flat-square&logo=go" />
</p>

<p align="center">
  <img src="site/images/omnivue-sessions-view.jpg" alt="Omnivue sessions view" width="700" />
</p>

---

Omnivue is a 100% local session browser for your AI Agent Harnesses. It reads the session data already on your machine and shows it all in one place — conversation history, file diffs, implementation plans, and more.

## Features

- **Multi-agent support** — OpenCode, Copilot, Cursor, Pi, Claude Code, and Codex out of the box
- **Conversation viewer** — Full message history with tool calls, reasoning, and step events
- **File diffs** — Unified diff view of every file change made during a session
- **Plan tracking** — Implementation plans and checkpoints with status indicators
- **Live updates** — Adaptive SSE-based polling (5s when active, 30s when idle) with notification events
- **Full-text search** — FTS5 index across all session content, scoped or global
- **Notifications** — In-app toasts and OS notifications for new messages, questions, task completions, and status changes; configurable kinds, scope, quiet hours, and channels
- **Bookmarks** — Toggle bookmarks on any message or tool call; navigate from a sidebar panel
- **User folders** — Virtual organization with nesting, color, and icon support
- **Scratch notes** — Per-session markdown notes with rich text or code editor
- **Session renaming** — Override display names from the sidebar
- **Overview screen** — Analytics dashboard with session activity charts, model/agent breakdown, and time-range filtering
- **Settings UI** — Add/remove session sources from the browser
- **Resume sessions** — One-click copy of the CLI command to resume
- **Keyboard-driven** — `j`/`k` navigate, `⌘1`/`⌘2` tabs, `⌘F` search
- **Deep linking** — Shareable URLs `#/session/{id}/step/{n}`
- **Multi-theme** — Ayu, Nord, Catppuccino, Tokyo Night, and GitHub themes with light/dark modes
- **Read-only access** — Never writes to agent databases (enforced at driver level)
- **Single binary** — Go + embedded React SPA, zero runtime dependencies

## Local by Design

Omnivue keeps your workflow on your machine:

- **100% local** — Reads local session stores and writes only to its own local state database
- **No cloud sync** — Nothing is uploaded, indexed remotely, or sent to a hosted service
- **Read-only adapters** — Agent databases are opened in read-only mode and never modified
- **localhost UI** — The browser app runs against a local server on your machine

## Quick Start

```console
$ omnivue init
$ omnivue
```

## Installation

### From source

Requires Go 1.26+ and [pnpm](https://pnpm.io/).

```bash
make build
```

### Binary

```bash
# macOS (arm64)
curl -fsSL https://github.com/stevencrawford/omnivue/releases/latest/download/omnivue_darwin_arm64.zip -o omnivue.zip && unzip omnivue.zip && rm omnivue.zip

# Linux (amd64)
curl -fsSL https://github.com/stevencrawford/omnivue/releases/latest/download/omnivue_linux_amd64.tar.gz | tar xz
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `ArrowDown` | Select next session |
| `k` / `ArrowUp` | Select previous session |
| `⌘1` / `Ctrl+1` | Conversation tab |
| `⌘2` / `Ctrl+2` | Diff tab |
| `⌘F` / `Ctrl+F` or `⌘K` / `Ctrl+K` | Open search (scoped to active session) |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `Escape` | Close search / results |

## Documentation

For detailed documentation, API reference, adapter guide, and frontend overview, see the [docs/](docs/) directory.

## License

MIT License — see [LICENSE](LICENSE).
