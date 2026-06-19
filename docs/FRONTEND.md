# Frontend

The frontend is a React 19 SPA located in `internal/frontend/`. It is built with Vite 8 and embedded into the Go binary via `go:embed`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 6 |
| Build | Vite 8, `@vitejs/plugin-react` |
| Styling | Tailwind CSS v4 |
| Markdown | `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-highlight` |
| Icons | `lucide-react` |
| Rich text | `@tiptap/*` (starter-kit, link, table, code-block-lowlight) |
| Code editor | `@monaco-editor/react` + `monaco-editor` |
| Diff | `diff` (unified diff parsing) |
| Markdown utility | `marked` (markdown→HTML), `turndown` (HTML→markdown) |
| Testing | vitest + jsdom + @testing-library/react |
| Linting | oxlint, oxfmt |

## Component catalog

### App state (`App.tsx`)

The root component manages global state:
- Session list, active session, scratch files
- Search state (inline panel + results drawer)
- Keyboard shortcut dispatch
- URL hash deep-linking (`#/session/{id}/step/{n}`)
- Browser back/forward support via `hashchange` event

### Sidebar (`Sidebar.tsx`)

Resizable left panel with section navigation:
- **Sessions** tab — session tree grouped by repository directory
- **Projects** tab — project-based folder browsing
- Scratch file list per session
- Persisted sidebar width in localStorage
- Right-click context menus
- Toast notifications

### Section navigation

| Component | Purpose |
|-----------|---------|
| `IconChannel.tsx` | Toggle between Sessions and Projects sections |
| `SessionPanel.tsx` | Session list grouped by repo directory |
| `ProjectPanel.tsx` | Project-based folder browsing with color-coded folders |

### Session viewer (`SessionViewer.tsx`)

Multi-tab view for the active session:
- **Session tab** — Full conversation with `ConversationView`
- **Diff tab** — File change list with `DiffView`
- **Plan tab** — Implementation plan with `PlanView`
- **Scratch tabs** — Open scratch files via `ScratchEditor`

### Conversation rendering

| Component | Purpose |
|-----------|---------|
| `ConversationView.tsx` | Renders message threads with alternating roles |
| `MarkdownContent.tsx` | Markdown→HTML rendering with syntax highlighting |
| `PlanView.tsx` | Structured plan/checkpoint items with status indicators |
| `DiffView.tsx` | File change list with expandable unified diffs |
| `DiffRenderer.tsx` | Inline unified diff rendering (added/deleted lines) |

### Tool call renderers (`ToolRenderers/`)

Each tool call type has a dedicated renderer. See `ToolRenderers/CLAUDE.md` for the detailed architecture guide on adding new renderers, kind mappings, and styling conventions.
- `BashRenderer` — Terminal command output
- `EditToolDiff` — File edit diff visualization (oldStr → newStr)
- `GlobRenderer` — Glob search results
- `GrepRenderer` — Grep search results
- `ReadRenderer` — File read output
- `WriteRenderer` — File write output
- `ToolRenderer` — Generic fallback with collapsible input/output
- `ToolManager` — Coordinates which renderer to use per tool name

### Search

| Component | Purpose |
|-----------|---------|
| `SearchPanel.tsx` | Inline search typeahead at the top of the viewport |
| `SearchResultsDrawer.tsx` | Full-screen search results (opened via `⌘P`/`⌘K`) |

Results show highlighted snippets and link to the relevant session + tab.

### Scratch editor (`ScratchEditor.tsx`)

Per-session markdown notes with dual editing modes:
- **Rich text** — TipTap editor (tables, code blocks with lowlight highlighting, links)
- **Code editor** — Monaco editor (VS Code-level editing)

Features auto-save, tabbed interface, and file management (create/rename/delete).

### Settings (`SettingsModal.tsx`)

Browser-based source management:
- View/add/remove session sources
- Theme toggle (light/dark)
- Placeholder for future agent types (Claude Code, Codex)

### Other UI

| Component | Purpose |
|-----------|---------|
| `ThemeToggle.tsx` | Light/dark theme toggle with persistent preference |
| `ErrorBoundary.tsx` | Graceful error recovery per section |
| `ContextMenu.tsx` | Right-click menus for sessions and files |
| `Toast.tsx` | Notification toasts ("Copied!", "Saved", etc.) |
| `Modal.tsx` | Reusable modal dialog wrapper |
| `AddToProjectDialog.tsx` | Assign sessions to folders |
| `CopyButton.tsx` | Copy-to-clipboard button for code blocks |
| `SessionHeader.tsx` | Session metadata header (model, tokens, cost, status) |

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useSSE` | `hooks/useSSE.ts` | SSE subscription with auto-reconnect; fires `onUpdate` and `onSessionChanged` callbacks |
| `useApi` | `hooks/useApi.ts` | Typed fetch wrappers for all API endpoints |
| `useTheme` | `hooks/useTheme.ts` | Theme state management and localStorage persistence |
| `useNav` | `hooks/useNav.ts` | Session navigation context (scrolling, selection) |

## Utilities

| File | Purpose |
|------|---------|
| `utils/buildTree.ts` | Groups sessions by repository directory for the sidebar tree |

## Data flow

```
App.tsx
 ├── SSE events → loadSessions() → refresh session list
 ├── Keyboard shortcuts → navigation / tab switching
 ├── URL hash → deep-link to session
 │
 ├── Sidebar
 │   ├── SessionPanel → select session → App sets activeSessionId
 │   ├── ProjectPanel → browse folders → select session
 │   └── ContextMenu → rename, resume, copy link
 │
 └── SessionViewer (when activeSessionId set)
     ├── SessionHeader → model, tokens, cost
     ├── ConversationView → messages → MarkdownContent / tool renderers
     ├── DiffView → DiffRenderer
     ├── PlanView → status indicators
     └── ScratchEditor → TipTap / Monaco
```

## Theming

GitHub-style light/dark via `data-theme` attribute on `<html>`. CSS custom properties (`--color-gh-*`) define the color palette. The preference is persisted in localStorage under `sess-theme`.

## Local storage keys

All keys use the `sess-` prefix:

| Key | Purpose |
|-----|---------|
| `sess-sidebar-width` | Sidebar width in pixels |
| `sess-theme` | Theme preference ("light" / "dark") |
