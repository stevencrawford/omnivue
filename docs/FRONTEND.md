# Frontend

The frontend is a React 19 SPA located in `internal/frontend/`. It is built with Vite 8 and embedded into the Go binary via `go:embed`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 6 |
| Build | Vite 8.1, `@vitejs/plugin-react` 6 |
| Styling | Tailwind CSS v4 |
| Markdown | `react-markdown` 10 + `remark-gfm` 4 + `remark-breaks` 4 + `rehype-highlight` 7 |
| Icons | `lucide-react` |
| Rich text | `@tiptap/*` (starter-kit, link, table, code-block-lowlight) |
| Code editor | `@monaco-editor/react` + `monaco-editor` |
| Diff | `diff` (unified diff parsing) |
| Markdown utility | `marked` (markdown→HTML), `turndown` (HTML→markdown) |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit` (PTY terminal in browser) |
| Charts | `recharts` (activity charts, model/agent breakdown) |
| Validation | `zod` (runtime schema validation for API responses) |
| Fonts | `@fontsource/geist-mono`, `@fontsource/geist-sans` |
| Testing | vitest + jsdom + @testing-library/react |
| Linting | oxlint, oxfmt |

## Component catalog

### App state (`App.tsx`)

The root component manages global state:
- Session list, active session, search state, bookmarks, notifications
- Scratch files, open scratch tabs, live changed session IDs from SSE
- Pin message flow (create scratch file from message content)
- Keyboard shortcut dispatch
- URL hash deep-linking (`#/session/{id}/step/{n}`)
- `NotificationToaster` — subscribes to notification list and fires in-app toasts + browser OS notifications, respecting quiet hours and `excludeActiveView`

### Sidebar (`Sidebar.tsx`)

Resizable panel showing session tree grouped by repository. Uses `omnivue-sidebar-width` localStorage key for width persistence. Has three navigation sections:
- **Sessions** — group by repo using `buildTree()`
- **Projects** — folder-based organization via `FolderPanel`
- **Notifications** — notification list with filters via `NotificationPanel`

### Session list panels (`SessionPanel.tsx`, `ProjectPanel.tsx`)

Virtualized list of sessions within each repo/folder group. Uses localStorage for:
- `omnivue-sidebar-collapsed` — collapsed parent group names
- `omnivue-sidebar-sort` — session sort order
- `omnivue-sidebar-display` — condensed vs verbose mode
- `omnivue-project-folders-expanded` — expanded folder IDs
- `omnivue-project-folder-sort` — folder sort order

### Overview screen (`OverviewScreen.tsx`)

Analytics dashboard shown when no session is selected. Includes:
- Recent session activity timeline
- `ActivityCharts` — session count and edit activity over time
- `ModelAgentBreakdown` — usage breakdown by model and agent
- `TimeRangeSelector` — filter overview data by time range (7d, 14d, 30d, 90d)
- `SessionSummary` — per-session summary cards with key metrics

### Session detail (`SessionViewer.tsx`)

Tabbed detail view with tabs: Session (conversation), Diff, Plan, and Scratch.
Tab state is driven by the `activeTab` URL parameter.

### Conversation view (`ConversationView.tsx`)

Renders message list grouped by user turn. Each message can contain:
- User request text (`UserTurnMessage`, `UserPromptBubble`)
- Assistant text with markdown (`AssistantMessage`, `MarkdownContent`)
- Tool calls (expandable cards with `ToolCallList`, `ToolRendererWrapper`)
- Reasoning blocks (collapsible)
- System reminders (collapsible at top, `SystemReminderView`)
- `ScrollMarkers` — jump-to markers for tool calls and key steps
- `BookmarkButton` — toggle bookmarks on individual tool call outputs
- `CopyButton` — copy message content to clipboard
- `ResumeButton` — one-click copy of resume command

### Diff view (`DiffView.tsx`)

Three-panel layout: file tree, diff stats, and unified diff content. Uses `omnivue-diff-tree-width` localStorage key for tree panel width. Uses `DiffRenderer` for inline unified diff rendering.

### Plan view (`PlanView.tsx`)

Plan/checkpoint items with status indicators (pending, in_progress, completed, blocked, canceled) and priority badges (high, medium, low).

### Todos view (`TodosView.tsx`)

Session todo/task list with status tracking and dependency links.

### Scratch editor (`ScratchEditor.tsx`)

Dual-mode editor:
- **WYSIWYG mode** using TipTap (rich markdown editing)
- **Code mode** using Monaco editor (raw markdown)
Mode is stored in the database per-scratch-file.

### Search (`SearchPanel.tsx`, `SearchResultsDrawer.tsx`)

Inline search bar with typeahead suggestions and recent searches; full-screen results drawer with highlighted snippets. Press `Esc` or `Enter` to close/open results. Search scope can be limited to a specific session. Recent searches are persisted server-side via `/_/api/recent-searches`.

### Settings (`SettingsModal.tsx`)

Modal with multiple tabs:
- **Sources** — Manage session sources (add/remove)
- **Appearance** — Theme selection (Ayu, Nord, Catppuccino, Tokyo Night, GitHub) with light/dark mode toggle, cost display toggle
- **Notifications** — `NotificationsSettingsTab` with kind filters, scope, delivery channels, quiet hours, auto-dismiss

### Theme (`ThemeToggle.tsx`, `useTheme.tsx`)

Light/dark toggle + theme picker. Persisted in localStorage as `omnivue-theme` and `omnivue-mode`. Uses `data-theme` attribute on document.

### Folders (`FolderPanel.tsx`, `AddToProjectDialog.tsx`)

CRUD UI for virtual folders. Supports nesting, color labels, and icons.

### Notifications (`NotificationPanel.tsx`, `NotificationRow.tsx`, `NotificationToaster` inline)

- `NotificationPanel` — sidebar panel listing notifications with filters (All, Questions, Activity)
- `NotificationRow` — single notification row with kind icon, title, preview, session name, relative time, read/unread styling
- `NotificationsSettingsTab` — settings UI for notification kinds, scope, channels, quiet hours, auto-dismiss
- `NotificationToaster` (in `App.tsx`) — subscribes to notification list, fires in-app toasts and browser OS notifications

### Terminal (`TerminalPanel.tsx`)

Inline PTY terminal inside the session viewer. Uses xterm.js backed by a WebSocket (`/_/ws/terminal`) that spawns the agent's resume command in a PTY. Supports:
- Full TUI interaction (keyboard input, resize)
- Auto-reconnect with exponential backoff
- Theme-aware styling (reads CSS variables)
- ResizeObserver-based fitting
- Lazy-loaded xterm.js (dynamic import)

Connected via a `ResumeButton` that opens a terminal tab for the session.

### Bookmarks (`BookmarkPanel.tsx`, `BookmarkButton.tsx`)

- `BookmarkPanel` — sidebar panel listing bookmarks with time-ago, delete-on-hover
- `BookmarkButton` — toggle bookmark on tool call output cards

### Other components

- `AppHeader` — Top bar with home button, search highlight indicator, navigation
- `SessionHeader` — Session detail header with title, model, agent, status, timestamps
- `EmptyState` — Shown when no sessions are configured
- `PinMessageModal` — Modal to create a scratch file from selected message content
- `PinnedPromptBar` — Bar showing pinned message context
- `ShortcutsModal` — Keyboard shortcuts reference modal
- `Modal` — Reusable modal wrapper
- `ContextMenu` — Right-click context menus
- `Toast` — Toast notification component (used by NotificationToaster)
- `ErrorBoundary` — Graceful error recovery
- `IconChannel` — Section navigation toggle (sessions/projects/notifications)

## API integration

All data flows through typed fetchers in `useApi.ts` (barrel) → `apiClient.ts` (implementation) with `schemas.ts` for zod runtime validation:

```typescript
// Types (from hooks/types.ts and hooks/schemas.ts)
interface Session { id, sourceId, parentId?, title, repository, branch, agent, subAgent?, model, cost, directory, status, createdAt, updatedAt, tokensInput, tokensOutput, tokensReasoning, tokensCacheRead, tokensCacheWrite, messageCount, diffFiles, diffAdditions, diffDeletions, todos? }
interface Todo { id, title, description?, status, depends_on? }
interface Message { id, role, content, reasoning?, toolCalls?, stepEvents?, timestamp, model?, agent?, tokensInput?, tokensOutput?, metadata? }
interface ToolCall { id, name, input, output, status, duration?, metadata? }
interface PlanItem { id, title, description?, status?, assignedTo? }
interface DiffFile { path, status, additions, deletions, patch? }
interface FileEdit { filePath, toolName, oldStr?, newStr?, content?, viewRange?, timestamp }
interface Source { id, path, agentType, label, enabled, createdAt }
interface Bookmark { id, sessionId, messageIndex, toolCallId?, label, createdAt }
interface AppNotification { id, sessionId, sourceId, kind, title, preview, severity, payload?, createdAt, readAt? }
interface NotificationSettings { enabled, kinds, scope, inAppToast, sidebarBadge, browserNotify, quietHoursEnabled, quietHoursStart, quietHoursEnd, autoDismissSec, excludeActiveView }
interface Folder { id, name, parentId?, sortOrder, color?, icon?, createdAt, updatedAt }
interface ScratchFile { id, sessionId, title, content, mode, createdAt, updatedAt }
interface SearchResult { sessionId, sessionName?, sourceId, chunkType, repository, snippet, updatedAt?, fileTitle?, fileId?, messageIndex? }
```

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useTerminal` | `hooks/useTerminal.ts` | WebSocket terminal connect/disconnect, send input, resize, auto-reconnect with backoff |
| `useSessions` | `hooks/useSessions.ts` | Session list, loading, active session, SSE live updates |
| `useSSE` | `hooks/useSSE.ts` | SSE connection with auto-reconnect |
| `useApi` | `hooks/useApi.ts` | Typed API fetchers (barrel) |
| `apiClient` | `hooks/apiClient.ts` | Raw API fetch implementations |
| `schemas` | `hooks/schemas.ts` | Zod schemas for API response validation |
| `types` | `hooks/types.ts` | TypeScript interfaces for all API types |
| `useTheme` | `hooks/useTheme.tsx` | Theme state/persistence (localStorage) |
| `useNav` | `hooks/useNav.tsx` | Session navigation context |
| `useBookmarks` | `hooks/useBookmarks.ts` | Bookmark list, toggle create/delete, navigation |
| `useNotifications` | `hooks/useNotifications.ts` | Notification list, polling, SSE, mark-read, settings, per-session unread counts |
| `useActiveView` | `hooks/useNotifications.ts` | Reports currently-viewed session to server (debounced) |
| `useNotificationPermission` | `hooks/useNotificationPermission.ts` | Web Notifications API permission state |
| `useScratchFiles` | `hooks/useScratchFiles.ts` | Scratch file CRUD, open tabs, pin-as-scratch |
| `usePinMessage` | `hooks/usePinMessage.ts` | Pin message modal state and confirm flow |
| `useRecentSearches` | `hooks/useRecentSearches.ts` | Recent search queries (local + server sync) |
| `useSearchScope` | `hooks/useSearchScope.ts` | Search scope (all sessions vs single session) |
| `useSearchState` | `hooks/useSearchState.ts` | Search results drawer state |
| `useSearchHighlight` | `hooks/useSearchHighlight.ts` | Search highlight in message content |
| `useSessionRouting` | `hooks/useSessionRouting.ts` | URL hash deep-linking |
| `useSessionSummary` | `hooks/useSessionSummary.ts` | Session metrics for overview cards |
| `useSessionTokenomics` | `hooks/useSessionTokenomics.ts` | Token/cost breakdown |
| `useTimeRange` | `hooks/useTimeRange.ts` | Overview time range filtering |
| `useToast` | `hooks/useToast.tsx` | Toast notification system |
| `useCopy` | `hooks/useCopy.ts` | Clipboard copy with feedback |
| `useConversationScroll` | `hooks/useConversationScroll.ts` | Scroll position tracking in conversation |
| `useAppKeyboard` | `hooks/useAppKeyboard.ts` | Keyboard shortcut dispatch |

## State management

No external state library. Core state lives in `App.tsx`:
- `sessions` — Session[]
- `activeSessionId` — string | null
- `searchQuery` / `searchResults` — search state
- `folderSessions` — sessions by folder
- `liveChangedSessionIds` — SSE-driven dirty list
- `bookmarks` — Bookmark[]
- `notifications` / `notificationSettings` — Notification state
- `pinMessage` / `openScratchTabs` / `scratchFileMap` — Scratch state
- `recentSearches` — string[]
- `activeSection` / `sidebarOpen` / `settingsOpen` / `shortcutsOpen` — UI state

## Utility files

| File | Purpose |
|------|---------|
| `utils/buildTree.ts` | Groups sessions by repository |
| `utils/detectLanguage.ts` | Language detection for syntax highlighting |
| `utils/diff.ts` | Unified diff parsing helpers |
| `utils/jsonField.ts` | JSON field serialization utilities |
| `utils/overviewAnalytics.ts` | Overview analytics data computation |
| `utils/searchUtils.tsx` | Search result rendering utilities |
| `utils/sessionFilters.ts` | Session list filtering logic |
| `utils/sessionUtils.tsx` | Session display helpers (time ago, status labels) |
| `utils/storageKeys.ts` | Centralized localStorage key constants |
| `utils/theme.ts` | Theme color definitions |
| `utils/toolDisplay.ts` | Tool name display formatting |

## localStorage keys

All use `omnivue-` prefix:

| Key | Purpose | Component |
|-----|---------|-----------|
| `omnivue-theme` | Theme name | `useTheme` |
| `omnivue-mode` | Light/dark mode | `useTheme` |
| `omnivue-hide-costs` | Hide cost display | `SettingsModal` |
| `omnivue-sidebar-width` | Sidebar width | `Sidebar` |
| `omnivue-sidebar-collapsed` | Collapsed repo groups | `SessionPanel` |
| `omnivue-sidebar-sort` | Session sort order | `SessionPanel` |
| `omnivue-sidebar-display` | Condensed/verbose | `SessionPanel` |
| `omnivue-pinned-height` | Pinned prompt bar height | `PinnedPromptBar` |
| `omnivue-project-folders-expanded` | Expanded folder IDs | `ProjectPanel` |
| `omnivue-project-folder-sort` | Folder sort order | `ProjectPanel` |
| `omnivue-diff-tree-width` | Diff tree panel width | `DiffView` |
| `omnivue-disable-custom-renderers` | Disable custom tool renderers | `ToolRendererWrapper` |
| `omnivue-overview-timerange` | Overview time range selection | `TimeRangeSelector` |

## Tool call renderers (`components/ToolRenderers/`)

The tool renderer system uses a registry that auto-discovers renderers, maps tool names to components, and provides compact/full display modes with marker bar integration.

**Architecture:**
- `registry.ts` — Central registry that maps tool names to renderer components
- `types.ts` — Renderer component interface and types
- `ToolCallList.tsx` — Renders a list of tool calls with expandable cards
- `ToolRendererWrapper.tsx` — Wraps tool renderers with controls, supports custom renderer disabling
- `ToolActionsBar.tsx` — Action bar with bookmark, copy, and expand controls
- `BookmarkButton.tsx` — Bookmark toggle on individual tool call outputs

**Builtin renderers** (`ToolRenderers/builtin/`):
- `BashToolDiff`, `ReadToolDiff`, `EditToolDiff`, `WriteToolDiff`, `GlobToolDiff`, `GrepToolDiff`
- `DeleteToolDiff`, `QuestionToolDiff`, `TaskToolDiff`, `TaskCompleteToolDiff`
- `CompactionToolDiff`, `ExitPlanModeToolDiff`, `SqlToolDiff`, `SkillToolDiff`, `DefaultToolDiff`
- `index.ts` — Registers all builtin renderers

**Vendor renderers** (`ToolRenderers/vendor/`):
- `atlassian/` — Jira tool diff renderer
- `example/` — Example renderer for reference

**Custom renderers:** Third-party renderers can be added by creating a package under `ToolRenderers/vendor/` and registering it. See `ToolRenderers/AGENTS.md`.

## Notification system

The notification system (`lib/browserNotify.ts`) provides:

- `canBrowserNotify(settings)` — Checks if OS notifications are permitted
- `fireBrowserNotification(n)` — Fires a native `Notification` with the session title, click focuses window
- `inQuietHours(settings)` — Checks if current time falls within configured quiet hours (overnight ranges supported)
- `parseHHMM(s)` — Parses "HH:MM" to minutes since midnight
- `resolveChannels(n, settings)` — Central decision function returning `{ toast, browser }` based on all settings, kind severity, and quiet hours

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
cd internal/frontend && pnpm run lint
cd internal/frontend && pnpm run fmt             # auto-format
cd internal/frontend && pnpm run fmt:check       # check only
```
