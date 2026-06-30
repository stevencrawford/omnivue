# Copilot Instructions for Omnivue (AI Session Manager)

## What is Omnivue

`omnivue` is a CLI tool that watches AI coding agent sessions (OpenCode, GitHub Copilot, Cursor) and presents them in a browser UI for easy browsing, searching, and management. It runs a Go HTTP server that embeds a React SPA as a single binary. The Go module is `github.com/stevencrawford/omnivue`.

Forked from [mo](https://github.com/k1LoW/mo) (a Markdown viewer), `omnivue` repurposes the architecture for AI session management.

## Build & Run

Requires Go 1.26+ and [pnpm](https://pnpm.io/). Build with `make build`, run with `./omnivue --foreground --port 16275`.

## Architecture

- `cmd/root.go` — CLI entry point (Cobra). Handles single-instance detection, server lifecycle (background/foreground), status/shutdown/restart.
- `cmd/init.go` — `omnivue init` command: auto-discovers session sources, interactive prompts.
- `cmd/add.go` — `omnivue add` command: manually adds a source.
- `internal/ingest/` — Core ingest layer with adapter pattern
- `internal/store/store.go` — Manages `$XDG_STATE_HOME/omnivue/omnivue.db`: sources, folders, FTS5 search index, scratch files, config, session name overrides
- `internal/server/server.go` — HTTP server, session state, SSE for live-updates, adaptive polling (5s live / 30s idle)
- `internal/static/static.go` — `go:generate` + `go:embed` for frontend build output
- `internal/frontend/` — Vite + React 19 + TypeScript + Tailwind CSS v4 SPA
- `internal/logfile/` — Rotating JSON logging to `$XDG_STATE_HOME/omnivue/log/`
- `internal/xdg/` — XDG Base Directory helper
- `version/version.go` — Version info

## Key Design Patterns

- **Read-only agent data**: We NEVER write to agent databases. SQLite connections use `?mode=ro`. The `OpenReadOnlyDB()` helper enforces this with a write-attempt assertion.
- **Single instance**: CLI probes `/_/api/status`. If server running, just opens browser.
- **Unified session model**: Adapters normalize agent-specific formats to common `Session`/`Message` types.
- **Auto-discovery**: `omnivue init` scans known paths (`~/.local/share/opencode`, `~/.copilot`, `~/.cursor`).
- **Live-reload via SSE**: Adaptive polling (5s when active sessions, 30s when idle).
- **Persistent search**: FTS5 in `omnivue.db` indexes all session content incrementally with content-hash dedup.
- **User folders**: Stored in `omnivue.db` (not filesystem) — virtual organization of sessions (nested, color-coded).
- **Scratch notes**: Per-session markdown notes stored in `omnivue.db`, rendered with rich text (TipTap) or code editor (Monaco).
- **Session renaming**: Display name overrides stored in `omnivue.db`, persisted across restarts.
