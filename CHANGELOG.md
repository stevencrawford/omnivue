# Changelog

## [v0.2.0](https://github.com/stevencrawford/omnivue/compare/v0.1.2...v0.2.0) - 2026-08-05

### Dependency Updates ⬆️
- chore(deps): Bump the dependencies group in /internal/frontend with 18 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/55
- chore(deps): Bump the dependencies group across 1 directory with 3 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/64
- chore(deps): Bump the dependencies group across 1 directory with 25 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/65
- chore(deps): bump modernc.org/sqlite from 1.53.0 to 1.54.0 in the dependencies group by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/61
- chore(deps): bump the dependencies group with 2 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/80
- chore(deps): bump the dependencies group in /internal/frontend with 14 updates by @dependabot[bot] in https://github.com/stevencrawford/omnivue/pull/81
### Other Changes
- fix: Resume + Terminal as icon-only buttons on tab bar RHS by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/44
- fix: Keyboard shortcuts, notification dots, permission requests, settings flash, and 4 new themes by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/46
- fix: Copy/pin plan content, scratch editor improvements, Pin Message dialog UX by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/47
- docs: Update documentation to reflect current codebase by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/48
- feat: Integrate EffectJS for frontend state management and event streams by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/49
- feat: Enable partial word matching in search via FTS5 prefix queries by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/50
- refactor: migrate remaining API consumers to EffectJS by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/53
- fix(settings): Reset UI state after reset API call by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/54
- feat: punctuate copilot todo accumulation on batch completion by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/57
- fix: banner scroll, plan refresh, and exit_plan_mode notification kind by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/56
- feat: auto-discover and suggest agent sources in settings when empty by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/58
- feat: diff tab enhancements — collapse file tree + jump to message from diff by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/59
- docs(site): Polish landing page copy and fix platform details by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/60
- fix: restore Copilot reasoning display, handle system_reminder inline by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/66
- feat: derive session titles from summary data for Claude Code and Pi by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/67
- chore: simplify README installation section by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/68
- fix: soften system reminder styling to muted gray divider pattern by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/69
- fix: correct Copilot cost double-counting from multiple shutdown events by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/70
- feat: add store_memory tool call renderer for Copilot by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/71
- fix: system_reminder styling & skill modal by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/72
- fix: skill/store_memory visuals by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/73
- fix: align store_memory summary styling with edit/write pattern by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/74
- Use updatedAt instead of createdAt for overview timeframe filtering by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/75
- fix: render all sub-questions and preserve question message boundaries by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/76
- chore: Rebrand as Multi-Agent Session Manager by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/78
- feat: 3-tier resume copy dropdown (absolute/relative/agent command) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/79
- chore: ignore .worktrees directory by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/82
- feat(prompt-queue): Add prompt queue for session-scoped and global prompts by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/77
- feat: copilot research ingest, sub-agent nav fix, scratch & copy UI polish by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/85
- feat: hide stale completed sessions from the session list by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/83
- feat: session tags with header tagging and LHS tag panel by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/84
- chore: allow agents to access .worktrees directory by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/86
- fix(copilot): release conversation after failed subagent by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/90
- feat: macOS-style markdown screenshot capture by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/92
- fix(copilot): route events by agent identity + read_inbox/read_memories renderers by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/93
- fix(frontend): hide queued prompts on sub-agents + reliable notification jump by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/91
- refactor: ATH-05/06 ingest canonicalization + adapter interface shrink by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/89
- refactor(frontend): collapse EffectJS service layer into apiClient (ATH-04) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/87
- refactor: split State god-object + store role interfaces (ATH-01/02/03) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/88
- refactor(frontend): fix effect-cleanup correctness in hooks (ATH-12) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/95
- refactor(frontend): unify error/loading/empty-state handling (ATH-13) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/96
- refactor(frontend): widen markdown screenshot captures and lighter pixel ratio by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/97
- refactor: architecture deepening round 1 + 2 (ATH-07..18) by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/103
- feat: narrow screenshot window + serialize refresh pipeline by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/104
- fix(frontend): apply message jump scroll once per focus target by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/105

## [v0.1.2](https://github.com/stevencrawford/omnivue/compare/v0.1.1...v0.1.2) - 2026-07-07

### Other Changes
- feat: Compaction card styling, marker visibility, and summary improvements by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/33
- feat: surface API errors and model changes in Pi adapter by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/34
- fix(claude): Refactor adapter and fix task output rendering by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/37
- fix: normalize Copilot tool calls, improve token/todo tracking, frontend fixes by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/36
- fix(copilot): fix todo state SQL parsing for real Copilot patterns by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/38
- feat: Add custom websearch tool renderer with Globe icon by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/39
- refactor(ingest): Split adapter packages into canonical 8-file layout by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/41
- feat: Add Terminal panel with xterm.js by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/42
- feat: Support deeply nested sub-agent sessions by @stevencrawford in https://github.com/stevencrawford/omnivue/pull/43

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
- **User tags** — Virtual session organization with unique names and optional colors
- **Scratch notes** — Per-session markdown notes (TipTap rich text + Monaco code editor)
- **Session renaming** — Display name overrides persisted in `omnivue.db`
- **Settings UI** — Add/remove session sources from the browser
- **Keyboard shortcuts** — `j`/`k` navigation, `⌘1`/`⌘2` tabs, `⌘P` search
- **Deep linking** — URL hash-based session links (`#/session/{id}/step/{n}`)
- **Single-instance** — Probes running server before starting a new one
- **Read-only safety** — Agent databases opened with `?mode=ro`, verified at connection time
- **Light/dark theme** — GitHub-style theme with persistent preference
- **Background/foreground** — Server daemonizes by default, `--foreground` for dev
