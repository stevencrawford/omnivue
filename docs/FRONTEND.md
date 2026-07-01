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

### Sidebar (`Sidebar.tsx`)

Resizable panel showing session tree grouped by repository. Uses `omnivue-sidebar-width` localStorage key for width persistence. Has two navigation sections:
- **Sessions** — group by repo using `buildTree()`
- **Projects** — folder-based organization via `FolderPanel`

### Session list panels (`SessionPanel.tsx`, `ProjectPanel.tsx`)

Virtualized list of sessions within each repo/folder group. Uses localStorage for:
- `omnivue-sidebar-collapsed` — collapsed parent group names
- `omnivue-sidebar-sort` — session sort order
- `omnivue-sidebar-display` — condensed vs verbose mode
- `omnivue-project-folders-expanded` — expanded folder IDs
- `omnivue-project-folder-sort` — folder sort order

### Session detail (`SessionViewer.tsx`)

Tabbed detail view with tabs: Session (conversation), Diff, Plan, and Scratch.
Tab state is driven by the `activeTab` URL parameter.

### Conversation view (`ConversationView.tsx`)

Renders message list grouped by user turn. Each message can contain:
- User request text
- Assistant text with markdown
- Tool calls (expandable cards)
- Reasoning blocks (collapsible)
- System reminders (collapsible at top)

### Diff view (`DiffView.tsx`)

Three-panel layout: file tree, diff stats, and unified diff content. Uses `omnivue-diff-tree-width` localStorage key for tree panel width.

### Scratch editor (`ScratchEditor.tsx`)

Dual-mode editor:
- **WYSIWYG mode** using TipTap (rich markdown editing)
- **Code mode** using Monaco editor (raw markdown)
Mode is stored in the database per-scratch-file.

### Search (`SearchPanel.tsx`, `SearchResultsDrawer.tsx`)

Inline search bar with typeahead suggestions; full-screen results drawer with highlighted snippets. Press `Esc` or `Enter` to close/open results.

### Settings (`SettingsModal.tsx`)

Modal for:
- Managing session sources (add/remove)
- Selecting theme (Ayu, Nord, Catppuccin, Tokyo Night, GitHub)
- Toggling cost display (`omnivue-show-costs`)

### Theme (`ThemeToggle.tsx`, `useTheme.tsx`)

Light/dark toggle + theme picker. Persisted in localStorage as `omnivue-theme` and `omnivue-mode`.

### Folders (`FolderPanel.tsx`, `AddToProjectDialog.tsx`)

CRUD UI for virtual folders. Supports nesting, color labels, and icons.

## API integration

All data flows through typed fetchers in `useApi.ts`:

```typescript
// Types
interface Session { id, title, agent, status, model, cost, createdAt, updatedAt, directory, repository, messageCount, bookmark? }
interface Message { role, content, toolCalls?, reasoning?, stepEvents?, source? }
interface ToolCall { id, name, input, output, status, duration, metadata? }
interface PlanItem { id, title, description?, status?, assignedTo? }
interface DiffFile { path, status, additions, deletions, patch? }
interface Source { id, path, agentType, label, enabled }
```

## State management

No external state library. Core state lives in `App.tsx`:
- `sessions` — Session[]
- `activeSessionId` — string | null
- `searchQuery` / `searchResults` — search state
- `folderSessions` — sessions by folder
- `liveChangedSessionIds` — SSE-driven dirty list

## Tool call renderers

Located in `ToolRenderers/`. The registry auto-discovers renderers, maps tool names to components, provides compact/full modes, and marker bar integration. See `CONTRIBUTING.md` for the plugin system.

## Build & test

```bash
# Development server (standalone, proxies API)
cd internal/frontend && pnpm run dev

# Production build
cd internal/frontend && pnpm run build

# Tests
cd internal/frontend && pnpm run test
pnpm run test:coverage   # with coverage

# Linting
pnpm run lint
pnpm run fmt             # auto-format
pnpm run fmt:check       # check only
```
