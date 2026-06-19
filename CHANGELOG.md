# Changelog

## v0.1.0 - 2026-06-01

Initial release of sess. Forked from [mo](https://github.com/k1LoW/mo) (a Markdown viewer) and repurposed for AI coding agent session management.

### Features

- **OpenCode adapter** — Reads `opencode.db` (SQLite) for sessions, messages, plans, diffs, tokens, and costs
- **Copilot adapter** — Reads `session-store.db` (SQLite) + `events.jsonl` (JSONL) + checkpoint markdown
- **Cursor adapter** — Reads `state.vscdb` (SQLite KV) + `agent-transcripts` JSONL + `ai-code-tracking.db`
- **Browser UI** — Tabbed session viewer with conversation, plan, and diff views
- **Real-time updates** — Adaptive SSE polling (5s live / 30s idle)
- **Full-text search** — FTS5 index across all session content
- **User folders** — Virtual session organization with nesting, color, and icons
- **Scratch notes** — Per-session markdown notes (TipTap rich text + Monaco code editor)
- **Session renaming** — Display name overrides persisted in `sess.db`
- **Settings UI** — Add/remove session sources from the browser
- **Keyboard shortcuts** — `j`/`k` navigation, `⌘1`/`⌘2` tabs, `⌘P` search
- **Deep linking** — URL hash-based session links (`#/session/{id}/step/{n}`)
- **Single-instance** — Probes running server before starting a new one
- **Read-only safety** — Agent databases opened with `?mode=ro`, verified at connection time
- **Light/dark theme** — GitHub-style theme with persistent preference
- **Background/foreground** — Server daemonizes by default, `--foreground` for dev
