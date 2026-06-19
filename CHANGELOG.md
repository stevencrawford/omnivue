# Changelog

## [0.1.0] - 2026-05-29

Initial release of **sess** — forked from [mo](https://github.com/k1LoW/mo) v1.5.5 by Ken'ichiro Oyama (k1LoW) and completely repurposed from a Markdown viewer to an AI session manager.

### What's new
- OpenCode session adapter (SQLite with full conversation, plan, diff views)
- Copilot session adapter (SQLite + events.jsonl)
- Tabbed browser UI with conversation, plan, and diff views
- FTS5 full-text search across all session content
- Virtual folder organization
- Session resume command
- Read-only access to agent databases (enforced at driver level)
- SSE-based live updates with adaptive polling
- Light/dark theme
- Single binary (Go + embedded React SPA)
