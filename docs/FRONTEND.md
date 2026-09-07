# Frontend

The frontend is a React 19 SPA located in `internal/frontend/`. It is built with Vite 8 and embedded into the Go binary via `go:embed`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 7 |
| Build | Vite 8.2, `@vitejs/plugin-react` 6 |
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
| Data fetching | `effect` (SSE stream only), `AbortController` (one-shot fetches) |
| Routing | `react-router-dom` (hash/deep-link support) |
| Screenshots | `html-to-image` (markdown screenshot capture) |
| Syntax highlighting | `lowlight` (via TipTap code blocks) |
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
- URL hash deep-linking (`#/session/{id}`)
- `NotificationToaster` — subscribes to notification list and fires in-app toasts + browser OS notifications, respecting `excludeActiveView`

### Sidebar (`Sidebar.tsx`)

Resizable panel showing session tree grouped by repository. Uses `omnivue-sidebar-width` localStorage key for width persistence. Navigation sections (`IconChannel.tsx`: sessions, queued prompts, tags, bookmarks, notifications):
- **Sessions** — group by repo using `buildTree()` (`sessions/SessionTree.tsx`)
- **Queued Prompts** — prompt queue via `QueuePanel`
- **Tags** — tag-based organization via `TagPanel` (`tags/` row/filter/list components)
- **Bookmarks** — bookmarked sessions via `BookmarkPanel`
- **Notifications** — notification list with filters via `NotificationPanel`

### Session list panels (`SessionPanel.tsx`, `TagPanel.tsx`)

Virtualized list of sessions within each repo/tag group. Uses localStorage for:
- `omnivue-sidebar-collapsed` — collapsed parent group names
- `omnivue-sidebar-group` — session group-by option
- `omnivue-sidebar-display` — condensed vs verbose mode

### Overview screen (`OverviewScreen.tsx`)

Analytics dashboard shown when no session is selected. Includes:
- Recent session activity timeline
- `ActivityCharts` — session count and edit activity over time
- `ModelAgentBreakdown` — usage breakdown by model and agent
- `TimeRangeSelector` — filter overview data by time range (7d, 14d, 30d, 90d)
- `SessionSummary` — per-session summary cards with key metrics

### Session detail (`SessionViewer.tsx`)

Tabbed detail view with tabs: Session (conversation), Diff, Plan, Summary,
Todos, Terminal, and per-file Scratch tabs. Tab state is driven by the
`activeTab` URL parameter.
The tab bar (`SessionTabBar.tsx`) owns main/scratch tabs plus the
rename/create/delete dialogs and the resume/terminal buttons.

### Conversation view (`ConversationView.tsx`)

Renders the message list grouped by user turn (`utils/conversationGrouping.ts`
`groupMessages`, `MessageBlock.tsx` per block). Each message can contain:
- User request text (`UserTurnMessage`, `UserPromptBubble`)
- Assistant text with markdown (`AssistantMessage`, `ui/MarkdownContent`)
- Tool calls (expandable cards with `ToolCallList`, `ToolRendererWrapper`)
- Reasoning blocks (collapsible)
- System reminders (collapsible at top, `SystemReminderView`)
- `ScrollMarkers` — jump-to markers for tool calls and key steps
- `BookmarkButton` — toggle bookmarks on individual tool call outputs
- `CopyButton` (`ui/CopyButton`) — copy message content to clipboard
- `ResumeButton` — one-click copy of resume command
- `PinnedPromptBar` — pinned message context plus queued prompts for the session
- `PinMessageModal` — create a scratch file from selected message content

### Diff view (`DiffView.tsx`)

Three-panel layout: file tree (`diff/FileTree.tsx`), diff stats, and unified diff content. Uses `omnivue-diff-tree-width` / `omnivue-diff-tree-collapsed` localStorage keys for tree panel width/collapse. Uses `DiffRenderer` for inline unified diff rendering. Diff hunks are structured `DiffLine` objects (`utils/diff.ts`); search matches over hunks via `hunksContain`.

### Session summary (`SessionSummary.tsx`, `session-summary/`)

Per-session analytics: token/cost timeline charts (`TokenTimelineChart`,
`CostTimelineChart`), token breakdown pie (`TokenBreakdownPie`),
effectiveness cards (`EffectivenessCards`), activity breakdown
(`ActivityBreakdown`), timeline step navigation.

### Cinematic view (`cinematic/`)

Alternative full-screen session presentation: `CinematicSessionView` with
`TimelineScrubber`, `ConsolePane`, `FileAccessTree`, `FileDetail`, and
`NotificationDrawer`. Width/collapse persisted via the `omnivue-cinematic-*`
localStorage keys.

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

Modal with tabs (`components/settings/`):
- **Agent** (`AgentSettingsTab`) — agent-specific settings
- **Sessions** (`SessionsSettingsTab`) — session source management (add/remove) + stale-session hiding
- **Notifications** (`NotificationsSettingsTab`) — kind filters, scope, delivery channels
- **Appearance** (`AppearanceSettingsTab`) — theme selection (9 themes) with light/dark mode toggle, high-contrast toggle, cost display toggle
- **Privacy** / **Developer** (`PrivacyDeveloperSettingsTabs`) — privacy and developer options
- **About** (`AboutSettingsTab`) — version info

### Theme (`ThemeToggle.tsx`, `useTheme.tsx`)

Light/dark toggle + theme picker (Ayu, Nord, Catppuccin, Tokyo Night, GitHub, One Monokai, Atom One, Dracula, Night Owl). Persisted in localStorage as `omnivue-theme`, `omnivue-mode`, and `omnivue-contrast`. Uses `data-theme`/`data-mode`/`data-contrast` attributes on document.

### Tags (`TagPanel.tsx`, `CreateTagModal.tsx`, `EditTagModal.tsx`, `ManageTagsDialog.tsx`, `tags/`)

Tag-based session organization. Supports unique names, optional colors, and session assignment (`tags/TagRow`, `TagFilterBar`, `TagSessionRow`, `TagListHeader`, `AssignPicker`).

### Notifications (`NotificationPanel.tsx`, `NotificationRow.tsx`, `NotificationToaster` inline)

- `NotificationPanel` — sidebar panel listing notifications with filters (All, Questions, Activity)
- `NotificationRow` — single notification row with kind icon, title, preview, session name, relative time, read/unread styling
- `NotificationsSettingsTab` — settings UI for notification kinds, scope, and channels
- `NotificationToaster` (in `App.tsx`) — subscribes to notification list, fires in-app toasts and browser OS notifications

### Prompt queue (`QueuePanel.tsx`, `PinnedPromptBar.tsx`)

- `QueuePanel` — sidebar section listing queued prompts (session-scoped and global) with dispatch/delete
- `PinnedPromptBar` — per-session prompt bar to queue prompts and show pinned message context

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
- `SessionTabBar` — Main/scratch tab bar with rename/create/delete dialogs
- `MessageBlock` — Single grouped message block (assistant/user/system)
- `AssistantMessage` / `UserTurnMessage` / `UserPromptBubble` / `SystemReminderView` — Message renderers
- `TimeRangeSelector` — Overview time range filtering
- `MarkdownScreenshotButton` + `ScreenshotWindow` + `ScreenshotCaptureLayer` — Markdown screenshot capture (`lib/screenshot.ts`, `html-to-image`)
- `ShortcutsModal` — Keyboard shortcuts reference modal (opens with `?`)
- `Modal` (`ui/Modal`) — Reusable modal wrapper
- `ContextMenu` — Right-click context menus
- `Toast` — Toast notification component (used by NotificationToaster)
- `ErrorBoundary` (`ui/ErrorBoundary`) — Graceful error recovery
- `IconChannel` — Section navigation toggle (sessions/queued prompts/tags/bookmarks/notifications)
- Presentational widgets in `components/ui/`: `Spinner`, `LoadingState`, `EmptyState`, `EmptyPanel`, `FilterChip`, `Toggle`, `CopyButton`, `MarkdownContent`, `Modal`, `ErrorBoundary`
- Feature subdirs: `sessions/` (`SessionTree`, `VerboseStats`, `GroupMenu`, `IconBtn`), `overview/` (`ActivityCharts`, `StatCard`, `MiniSessionRow`, `ModelAgentBreakdown`, `RepoCard`)

## API integration

All data flows through typed fetchers in `apiClient.ts` (implementation) with `schemas.ts` for zod runtime validation:

```typescript
// Types (from hooks/types.ts, each derived via z.infer from hooks/schemas.ts)
interface Session { id, sourceId, parentId?, title, repository, branch, agent, subAgent?, model, cost, directory, status, createdAt, updatedAt, tokensInput, tokensOutput, tokensReasoning, tokensCacheRead, tokensCacheWrite, messageCount, diffFiles, diffAdditions, diffDeletions, todos? }
interface Todo { id, title, description?, status, depends_on? }
interface Message { id, role, content, reasoning?, toolCalls?, stepEvents?, timestamp, model?, agent?, tokensInput?, tokensOutput?, metadata? }
interface ToolCall { id, name, input, output, status, duration?, metadata? }
interface PlanItem { id, title, description?, status?, assignedTo? }
interface DiffFile { path, status, additions, deletions, patch? }
interface FileEdit { filePath, toolName, oldStr?, newStr?, content?, viewRange?, timestamp }
interface Source { id, path, agentType, label, enabled, createdAt }
interface Bookmark { id, sessionId, messageId?, toolCallId?, label, kind, createdAt }
interface AppNotification { id, sessionId, sourceId, kind, title, preview, severity, payload?, createdAt, readAt? }
interface NotificationSettings { enabled, kinds, scope, inAppToast, sidebarBadge, browserNotify, excludeActiveView, enabledAt }
interface QueuedPrompt { id, sessionId?, sourceId?, promptText, status, priority, tags, createdAt, dispatchedAt? }
interface Tag { id, name, color?, createdAt, updatedAt }
interface ScratchFile { id, sessionId, title, content, mode, createdAt, updatedAt }
interface SearchResult { sessionId, sessionName?, sourceId, chunkType, repository, snippet, updatedAt?, fileTitle?, fileId?, messageIndex? }
```

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useTerminal` | `hooks/useTerminal.ts` | WebSocket terminal connect/disconnect, send input, resize, auto-reconnect with backoff |
| `useSessions` | `hooks/useSessions.ts` | Session list, loading, active session, SSE live updates |
| `useSSE` | `hooks/useSSE.ts` | SSE connection with auto-reconnect |
| `apiClient` | `hooks/apiClient.ts` | Raw API fetch implementations |
| `schemas` | `hooks/schemas.ts` | Zod schemas for API response validation (source of truth) |
| `types` | `hooks/types.ts` | TypeScript interfaces derived via `z.infer` from `schemas.ts` |
| `useTheme` | `hooks/useTheme.tsx` | Theme state/persistence (localStorage) |
| `useNavigation` | `hooks/useNavigation.tsx` | Session navigation context (intent verbs) |
| `navigationReducer` | `hooks/navigationReducer.ts` | Pure navigation transition table |
| `useRouteSync` | `hooks/useRouteSync.ts` | URL hash deep-linking sync |
| `useBookmarks` | `hooks/useBookmarks.ts` | Bookmark list, toggle create/delete, navigation |
| `useTags` | `hooks/useTags.tsx` | Tag list, create/update/delete, session assignment |
| `useNotifications` | `hooks/useNotifications.ts` | Notification list, polling, SSE, mark-read, settings, per-session unread counts |
| `useActiveView` | `hooks/useNotifications.ts` | Reports currently-viewed session to server (debounced) |
| `useNotificationPermission` | `hooks/useNotificationPermission.ts` | Web Notifications API permission state |
| `useScratchFiles` | `hooks/useScratchFiles.ts` | Scratch file CRUD, open tabs, pin-as-scratch |
| `usePinMessage` | `hooks/usePinMessage.ts` | Pin message modal state and confirm flow |
| `useRecentSearches` | `hooks/useRecentSearches.ts` | Recent search queries (local + server sync) |
| `useSearchScope` | `hooks/useSearchScope.ts` | Search scope (all sessions vs single session) |
| `useSearchState` | `hooks/useSearchState.ts` | Search results drawer state |
| `useSearchHighlight` | `hooks/useSearchHighlight.ts` | Search highlight in message content |
| `useSearchHighlightContext` | `hooks/useSearchHighlightContext.tsx` | Search highlight context provider |
| `useSessionSummary` | `hooks/useSessionSummary.ts` | Session metrics for overview cards |
| `useSessionTokenomics` | `hooks/useSessionTokenomics.ts` | Token/cost breakdown |
| `useSessionListSettings` | `hooks/useSessionListSettings.tsx` | Session list group-by, stale-session hiding |
| `useSessionPosition` | `hooks/useSessionPosition.ts` | Per-session scroll position persistence |
| `useTimeRange` | `hooks/useTimeRange.ts` | Overview time range filtering |
| `useStatus` | `hooks/useStatus.ts` | Server status (version, schemaVersion) |
| `useTimeline` | `hooks/useTimeline.ts` | Session timeline step navigation |
| `useCinematicMode` | `hooks/useCinematicMode.tsx` | Cinematic view mode state |
| `useCinematicSearchJump` | `hooks/useCinematicSearchJump.ts` | Search-result jumps in cinematic view |
| `useConversationJumps` | `hooks/useConversationJumps.ts` | Message jump targets in conversation |
| `useConversationScroll` | `hooks/useConversationScroll.ts` | Scroll position tracking in conversation |
| `useDisableCustomRenderers` | `hooks/useDisableCustomRenderers.ts` | Custom tool renderer opt-out |
| `useHideCosts` | `hooks/useHideCosts.ts` | Hide cost display |
| `useResizable` | `hooks/useResizable.ts` | Resizable panels (sidebar, diff tree, prompt bar) |
| `useToast` | `hooks/useToast.tsx` | Toast notification system |
| `useCopy` | `hooks/useCopy.ts` | Clipboard copy with feedback |
| `useAppKeyboard` | `hooks/useAppKeyboard.ts` | Keyboard shortcut dispatch |

## State management

No external state library. Core state lives in `App.tsx`:
- `sessions` — Session[]
- `activeSessionId` — string | null
- `searchQuery` / `searchResults` — search state
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
| `utils/conversationGrouping.ts` | Groups messages by user turn |
| `utils/detectLanguage.ts` | Language detection for syntax highlighting |
| `utils/diff.ts` | Structured diff hunks (`DiffLine`), compute/parse/render, `hunksContain` search |
| `utils/diffTree.ts` | File-tree building, `mergeFileEdits`, `DIFF_STATUS_COLORS` |
| `utils/errors.ts` | Shared error helpers (`getErrorMessage`, `isAbortError`, `describeApiError`, `runCatching`, `showErrorToast`) |
| `utils/fileAccess.ts` | File access helpers for cinematic view |
| `utils/jsonField.ts` | JSON field serialization utilities |
| `utils/latestThinking.ts` | Latest thinking-stream extraction |
| `utils/overviewAnalytics.ts` | Overview analytics data computation |
| `utils/patchBody.ts` | Patch body helpers |
| `utils/reasoningChunks.ts` | Reasoning chunk helpers |
| `utils/scratchMarkdown.ts` | Scratch markdown helpers |
| `utils/searchSections.ts` | Shared search section grouping (`groupSearchSections`) |
| `utils/searchUtils.tsx` | Search result rendering utilities |
| `utils/sessionFilters.ts` | Session list filtering logic |
| `utils/sessionUtils.tsx` | Session display helpers (time ago, status labels, `agentLabel`) |
| `utils/storageKeys.ts` | Centralized localStorage key constants (`STORAGE_KEYS`) |
| `utils/tagColors.ts` | Tag color definitions |
| `utils/toolDisplay.ts` | Tool name display formatting (`effectiveToolKind`) |
| `utils/toolKindTaxonomy.ts` | Single tool-kind + token-color taxonomy (`TOOL_KIND_TAXONOMY`, `TOKEN_COLOR_SEGMENTS`) |
| `utils/uuid.ts` | ID generation (`makeId`) |

## localStorage keys

All use `omnivue-` prefix (centralized in `utils/storageKeys.ts` as `STORAGE_KEYS`):

| Key | Purpose | Component |
|-----|---------|-----------|
| `omnivue-theme` | Theme name | `useTheme` |
| `omnivue-mode` | Light/dark mode | `useTheme` |
| `omnivue-contrast` | High contrast (`default`/`high`) | `useTheme` |
| `omnivue-hide-costs` | Hide cost display | `useHideCosts` |
| `omnivue-sidebar-width` | Sidebar width | `Sidebar` (`useResizable`) |
| `omnivue-sidebar-collapsed` | Collapsed repo groups | `SessionPanel` |
| `omnivue-sidebar-group` | Session group-by option | `useSessionListSettings` |
| `omnivue-sidebar-display` | Condensed/verbose | `SessionPanel` |
| `omnivue-pinned-height` | Pinned prompt bar height | `PinnedPromptBar` |
| `omnivue-diff-tree-width` | Diff tree panel width | `DiffView` |
| `omnivue-diff-tree-collapsed` | Diff tree collapsed state | `DiffView` |
| `omnivue-cinematic-tree-width` | Cinematic tree width | Cinematic view |
| `omnivue-cinematic-drawer-width` | Cinematic drawer width | Cinematic view |
| `omnivue-cinematic-console-height` | Cinematic console height | Cinematic view |
| `omnivue-cinematic-drawer-collapsed` | Cinematic drawer collapsed | Cinematic view |
| `omnivue-cinematic-console-collapsed` | Cinematic console collapsed | Cinematic view |
| `omnivue-cinematic-activity-tab` | Cinematic activity tab | Cinematic view |
| `omnivue-cinematic` | Cinematic mode flag | `useCinematicMode` |
| `omnivue-tags-expanded` | Expanded tags | `TagPanel` |
| `omnivue-tag-sort` | Tag sort order | `TagPanel` |
| `omnivue-copy-mode-` (prefix) | Per-session copy mode | `ModeAwareCopyButton` |
| `omnivue-session-position-` (prefix) | Per-session scroll position | `useSessionPosition` |
| `omnivue-disable-custom-renderers` | Disable custom tool renderers | `useDisableCustomRenderers` |
| `omnivue-overview-timerange` | Overview time range selection | `TimeRangeSelector` |

## Tool call renderers (`components/tool-renderers/`)

The tool renderer system uses a registry that auto-discovers renderers, maps tool names to components, and provides compact/full display modes with marker bar integration.

**Architecture:**
- `registry.ts` — Central registry that maps tool names to renderer components
- `types.ts` — Renderer component interface and types
- `ToolCallList.tsx` — Renders a list of tool calls with expandable cards
- `ToolRendererWrapper.tsx` — Wraps tool renderers with controls, supports custom renderer disabling
- `ToolActionsBar.tsx` — Action bar with bookmark, copy, and expand controls
- `ToolUsageInfo.tsx` — Per-tool-call token/cost attribution
- `ModeAwareCopyButton.tsx` — Copy button with per-session mode persistence
- `BookmarkButton.tsx` — Bookmark toggle on individual tool call outputs

**Builtin renderers** (`tool-renderers/builtin/`, 23 files):
- `BashToolDiff`, `ReadToolDiff`, `EditToolDiff` (edit + write), `GlobToolDiff`, `GrepToolDiff`
- `DeleteToolDiff`, `QuestionToolDiff`, `TaskToolDiff`, `TaskGroupDiff`, `TaskCompleteToolDiff`, `TodoWriteToolDiff`
- `CompactionToolDiff`, `ExitPlanModeToolDiff`, `PermissionRequestToolDiff`, `ModelSwitchToolDiff`
- `SqlToolDiff`, `SkillToolDiff`, `WebSearchToolDiff`, `WebFetchToolDiff`
- `StoreMemoryToolDiff`, `ReadMemoriesToolDiff`, `ReadInboxToolDiff`, `DefaultToolDiff`
- `index.ts` — Registers all builtin renderers

**Vendor renderers** (`tool-renderers/vendor/`):
- `atlassian/` — Jira tool diff renderer
- `example/` — Example renderer for reference

**Custom renderers:** Third-party renderers can be added by creating a package under `tool-renderers/vendor/` and registering it. See `tool-renderers/AGENTS.md`.

## Notification system

The notification system (`lib/browserNotify.ts`) provides:

- `canBrowserNotify(settings)` — Checks if OS notifications are permitted
- `fireBrowserNotification(n)` — Fires a native `Notification` with the session title, click focuses window
- `resolveChannels(settings)` — Central decision function returning `{ toast, browser }` based on which channels are enabled

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
