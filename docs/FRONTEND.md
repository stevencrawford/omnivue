# Frontend

The frontend is a React 19 SPA located in `internal/frontend/`. It is built with Vite 8 and embedded into the Go binary via `go:embed`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 6 |
| Build | Vite 8, `@vitejs/plugin-react` 6 |
| Styling | Tailwind CSS v4 |
| Markdown | `react-markdown` 10 + `remark-gfm` 4 + `remark-breaks` 4 + `rehype-highlight` 7 |
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
- Session list, active session, search state
- Scratch files, open scratch tabs, live changed session IDs from SSE
- Pin message flow (create scratch file from message content)
- Keyboard shortcut dispatch
- URL hash deep-linking (`#/session/{id}/step/{n}`)
- Browser back/forward support via `hashchange` event
- Sidebar section: `"sessions"`, `"projects"`, or `"bookmarks"`

### Sidebar (`Sidebar.tsx`)

Resizable left panel (220–600px) with section navigation:
- **Sessions** tab — session tree grouped by repository directory `SessionPanel`
- **Projects** tab — project-based folder browsing `ProjectPanel`
- **Bookmarks** tab — currently disabled
- Scratch file list per session
- Persisted sidebar width in localStorage
- Right-click context menus
- Toast notifications

### Section navigation

| Component | Purpose |
|-----------|---------|
| `IconChannel.tsx` | Icon bar to toggle between Sessions and Projects sections; settings gear at bottom |
| `SessionPanel.tsx` | Session tree grouped by repo directory with sorting, filtering, and context menus |
| `ProjectPanel.tsx` | Project-based folder browsing with color-coded folders, drag-and-drop, context menus |
| `FolderPanel.tsx` | Standalone folder CRUD with expand/collapse and assign/unassign sessions |

### Session viewer (`SessionViewer.tsx`)

Multi-tab view for the active session with pill-style tab bar:
- **Session tab** — Full conversation with `ConversationView`
- **Diff tab** — File change list with `DiffView` (hidden for child/sub-agent sessions)
- **Plan tab** — Implementation plan with `PlanView`
- **Scratch tabs** — Open scratch files via `ScratchEditor`

Includes `SessionHeader` at top showing agent badge, title (editable inline), repository, and directory.

### Conversation rendering

| Component | Purpose |
|-----------|---------|
| `ConversationView.tsx` | Renders message threads with alternating roles, grouping, color-coded markers, scroll-to-top/bottom, pinned initial prompt bar with resume, step highlighting, search highlighting |
| `MarkdownContent.tsx` | Markdown→HTML rendering with syntax highlighting, expandable mode, copy, pin, open in modal |
| `PlanView.tsx` | Fetches and renders plan markdown; loading spinner, empty state |
| `DiffView.tsx` | Two-panel file tree + diff content; resizable tree, A/M/D status indicators |
| `DiffRenderer.tsx` | `FileRenderer` (syntax-highlighted file view) and `PatchRenderer` (unified diff table) |

### Tool call renderers (`ToolRenderers/`)

Each tool call type has a dedicated renderer. See `ToolRenderers/AGENTS.md` for architecture guide, dispatch logic, and adding new renderers.

| Component | Renders |
|-----------|---------|
| `ToolCallList.tsx` | Dispatch hub — compact (sidebar) and non-compact (full conversation) modes |
| `BashToolDiff.tsx` | Terminal command execution with exit status |
| `EditToolDiff.tsx` | File edit/write diff (oldStr → newStr computed diff) |
| `ReadToolDiff.tsx` | File read output with syntax highlighting |
| `GrepToolDiff.tsx` | Grep search results with match count |
| `GlobToolDiff.tsx` | Glob search results with file count |
| `DeleteToolDiff.tsx` | File deletion confirmation |
| `TodoWriteToolDiff.tsx` | Todo list updates with status icons |
| `TaskToolDiff.tsx` | Sub-agent task delegation with session navigation |
| `QuestionToolDiff.tsx` | User questions with option selection display |
| `ExitPlanModeToolDiff.tsx` | Plan mode exit summary |

### Search

| Component | Purpose |
|-----------|---------|
| `SearchPanel.tsx` | Inline search typeahead (command palette) at top of viewport; debounced, keyboard-navigable, grouped results |
| `SearchResultsDrawer.tsx` | Full-screen slide-in search results drawer (420px, opened via `⌘P`/`⌘K` or Enter in panel) |

Results show highlighted snippets with `<mark>` tags and link to the relevant session + tab. Both components support scope-to-session filtering.

### Scratch editor (`ScratchEditor.tsx`)

Per-session markdown notes with dual editing modes:
- **Rich text** — TipTap editor (tables, code blocks with lowlight highlighting, links)
- **Code editor** — Monaco editor (VS Code-level editing, markdown language)

Features auto-save (800ms debounce), fullscreen mode, word/line/token stats, save status indicator, and close-with-delete.

### Settings (`SettingsModal.tsx`)

Browser-based source management:
- View/add/remove session sources with confirmation
- 5 themes (Ayu, Nord, Catppuccin, Tokyo Night, GitHub) with visual previews
- Light/dark mode toggle
- About section
- Agent types: OpenCode, Copilot, Claude Code (disabled), Codex, Cursor, Pi

### Other UI

| Component | Purpose |
|-----------|---------|
| `ThemeToggle.tsx` | Sun/Moon icon button to toggle light/dark mode |
| `ErrorBoundary.tsx` | Graceful error recovery per section with "Try again" button |
| `ContextMenu.tsx` | Right-click menus for sessions and files; smart viewport positioning |
| `Toast.tsx` | Notification toasts (bottom center, auto-hide 2s, slide-up animation) |
| `Modal.tsx` | Reusable modal dialog wrapper (sizes: md, lg, xl, full) |
| `AddToProjectDialog.tsx` | Assign sessions to folders with search/create |
| `CopyButton.tsx` | Copy-to-clipboard button with group-hover visibility |
| `SessionHeader.tsx` | Session metadata header (title, agent badge, repo, directory) |

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useSSE` | `hooks/useSSE.ts` | SSE subscription to `/_/events` with auto-reconnect (exponential backoff 1s–30s); fires `onUpdate` and `onSessionChanged` callbacks; detects server restart via PID change |
| `useApi` | `hooks/useApi.ts` | Typed fetch wrappers for all API endpoints; defines all TypeScript interfaces |
| `useTheme` | `hooks/useTheme.tsx` | Theme state (5 named themes) and mode (light/dark) with localStorage persistence |
| `useNav` | `hooks/useNav.tsx` | Session navigation context (scroll positions, navigate-to-session) |
| `useCopy` | `hooks/useCopy.ts` | Copy-to-clipboard utility with auto-reset timer |

## Utilities

| File | Purpose |
|------|---------|
| `utils/buildTree.ts` | Groups sessions by repository directory for the sidebar tree |
| `utils/detectLanguage.ts` | Maps file extensions to language names for syntax highlighting |
| `utils/diff.ts` | Computes unified diffs from old/new content using the `diff` library |
| `utils/searchUtils.tsx` | Parses HTML snippets with `<mark>` tags for search result display |
| `utils/sessionFilters.ts` | Session filter types and filter/sort logic |
| `utils/sessionUtils.tsx` | Helper functions for session title, metadata display, relative time |
| `utils/toolDisplay.ts` | Maps tool names to canonical kinds, produces human-readable summaries |

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
 │   └── ContextMenu → rename, resume, copy link, add to project
 │
 └── SessionViewer (when activeSessionId set)
     ├── SessionHeader → model, tokens, cost
     ├── ConversationView → messages → MarkdownContent / ToolCallList
     ├── DiffView → DiffRenderer
     ├── PlanView → status indicators
     └── ScratchEditor → TipTap / Monaco
```

## Theming

Themes applied via `data-theme` (theme name) and `data-mode` (light/dark) attributes on `<html>`. CSS custom properties (`--color-gh-*`) define the color palette for each theme+mode combination.

| Attribute | Values | Stored in |
|-----------|--------|-----------|
| `data-theme` | `default`, `nord`, `catppuccin`, `tokyo-night`, `github` | `sess-theme` |
| `data-mode` | `light`, `dark` | `sess-mode` |

Themes: Ayu (default), Nord, Catppuccin, Tokyo Night, GitHub — each with both light and dark variants.

## Local storage keys

All keys use the `sess-` prefix:

| Key | Set by | Purpose |
|-----|--------|---------|
| `sess-sidebar-width` | `Sidebar.tsx` | Sidebar panel width in pixels |
| `sess-theme` | `useTheme.tsx` | Theme name (`default`, `nord`, `catppuccin`, `tokyo-night`, `github`) |
| `sess-mode` | `useTheme.tsx` | Theme mode (`light` / `dark`) |
| `sess-pinned-height` | `ConversationView.tsx` | Pinned bar height in pixels |
| `sess-sidebar-collapsed` | `SessionPanel.tsx` | Set of collapsed repo paths |
| `sess-sidebar-sort` | `SessionPanel.tsx` | Session sort mode (`recent`, `name`, `agent`) |
| `sess-sidebar-display` | `SessionPanel.tsx` | Display mode (`condensed`, `verbose`) |
| `sess-project-folders-expanded` | `ProjectPanel.tsx` | Set of expanded folder IDs |
| `sess-diff-tree-width` | `DiffView.tsx` | Diff file tree width in pixels |
