# Changelog

## [v0.1.1](https://github.com/stevencrawford/omnivue/compare/v0.1.0...v0.1.1) - 2026-07-05

### Dependency Updates ⬆️
- chore(deps): Bump the dependencies group in /internal/frontend with 23 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/22
- chore(deps): Bump the dependencies group with 5 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/21
### Other Changes
- fix: various fixes for copilot agent by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/17
- fix: mobile-responsive header and agent hero pill by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/23
- feat: add replay/resume button to OverviewScreen by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/24
- fix: cancel in-progress pages deploys to avoid duplicate artifact conflict by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/25
- Resize carousel images, fix favicon, restore README image by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/26
- Fix SQLITE_BUSY errors from incorrect modernc.org/sqlite DSN syntax by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/27
- Session tokenomics charts & card styling consistency by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/28
- fix: cleanup loading/error UX and session rename refresh by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/29
- refactor(ingest): adapter registry, interface segregation, typed enums, and performance fixes by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/20
- feat(store): version-tracked schema migrations via goose by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/19
- feat(notify): in-app notification system by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/30
- fix: flaky TestClassifyChanges_EmitsQuestionNotification due to flood suppression by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/31
- feat(build): ad-hoc codesign binary on macOS to satisfy Gatekeeper by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/32

## [v0.1.0](https://github.com/stevencrawford/omnivue/commits/v0.1.0) - 2026-07-02
### Other Changes
- Add GitHub Pages deployment workflow by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/11
- Enable CI, tagpr, and trivy workflows by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/10
- Fix GitHub Pages action hashes by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/13
- Add OSS hygiene templates by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/9
- fix: resolve 83 golangci-lint issues by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/15

## [0.1.0] - 2026-06-01

Initial release of **Omnivue** (formerly **sess**) — forked from [mo](https://github.com/k1LoW/mo) v1.5.5 by Ken'ichiro Oyama (k1LoW) and completely repurposed from a Markdown viewer to an AI session manager.

### Features

- **OpenCode adapter** — Reads `opencode.db` (SQLite) for sessions, messages, plans, diffs, tokens, and costs
- **Copilot adapter** — Reads `session-store.db` (SQLite) + `events.jsonl` (JSONL) + checkpoint markdown
- **Cursor adapter** — Reads `state.vscdb` (SQLite KV) + `agent-transcripts` JSONL + `ai-code-tracking.db`
- **Browser UI** — Tabbed session viewer with conversation, plan, and diff views
- **Real-time updates** — Adaptive SSE polling (5s live / 30s idle)
- **Full-text search** — FTS5 index across all session content
- **User folders** — Virtual session organization with nesting, color, and icons
- **Scratch notes** — Per-session markdown notes (TipTap rich text + Monaco code editor)
- **Session renaming** — Display name overrides persisted in `omnivue.db`
- **Settings UI** — Add/remove session sources from the browser
- **Keyboard shortcuts** — `j`/`k` navigation, `⌘1`/`⌘2` tabs, `⌘P` search
- **Deep linking** — URL hash-based session links (`#/session/{id}/step/{n}`)
- **Single-instance** — Probes running server before starting a new one
- **Read-only safety** — Agent databases opened with `?mode=ro`, verified at connection time
- **Light/dark theme** — GitHub-style theme with persistent preference
- **Background/foreground** — Server daemonizes by default, `--foreground` for dev
