# Frontend

The frontend is a React 19 SPA located in `internal/frontend/`. It is built with Vite 8 and embedded into the Go binary via `go:embed`.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 7 |
| Build | Vite 8, `@vitejs/plugin-react` 6 |
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

The root component wires the data hooks and global UI state:
- Session list / loading / indexing / live changed IDs (`useSessions`)
- Navigation intent verbs (`useNavigationState` — selection, focus, tabs, URL depth)
- Search state, scope, recent searches
- Bookmarks, notifications, prompt count
- Scratch pin flow (`useScratchFiles` backs only "pin message as scratch"; the cinematic view owns its own file list)
- Keyboard shortcut dispatch (`useAppKeyboard`)
- Sidebar expand/collapse (persisted) and settings/shortcuts modals
- Search deep-linking (`#/search?q=…` opens the results drawer)
- `NotificationToaster` — subscribes to the notification list and fires in-app toasts + browser OS notifications, respecting `excludeActiveView`

Screens render one of: the cinematic session view (when a session is selected), the indexing placeholder, the overview screen, or the empty state.

### Sidebar (`Sidebar.tsx`, `IconChannel.tsx`)

Icon-channel navigation on the left edge, with the active panel to its right. The sidebar is a click-only expand/collapse (never hover-driven) and the panel width is resizable (`useResizable`). Sections:
- **Sessions** — grouped by repo (`sessions/SessionTree.tsx`); lists root sessions only (sub-agents surface via the header family selector, `sessions/SessionFamilySelect.tsx`)
- **Prompts** — the global prompt pad (`PromptsPanel`)
- **Tags** — tag-based organization (`TagPanel` + `tags/` row/filter/list components)
- **Bookmarks** — bookmarked sessions/messages/plans (`BookmarkPanel`)
- **Notifications** — notification list with filters (`NotificationPanel`)

Panels stay mounted and toggle visibility with `className="hidden"`.

### Prompts (`PromptsPanel.tsx`)

The global, session-independent prompt pad in the sidebar — a place to keep the prompts you reuse. Entries scroll above a composer pinned to the bottom:
- A dashed "Paste from clipboard" box adds the clipboard contents as a new prompt on click (with a native-paste fallback when the async Clipboard API is unavailable)
- Per-entry: copy back, check off/done, inline edit, pin-to-top, drag reorder, delete
- Backed by `/_/api/prompts`; refresh is driven by the `prompts-changed` SSE event

### Session list (`SessionPanel.tsx`)

Virtualized session list grouped by repository, tag, working directory, or model. Uses `useResizable` for the panel and localStorage for:
- `omnivue-sidebar-collapsed` — collapsed parent group names
- `omnivue-sidebar-group` — group-by option
- `omnivue-sidebar-display` — condensed vs verbose mode

### Overview screen (`OverviewScreen.tsx`)

Analytics dashboard shown when the overview is active. Includes:
- Recent session activity timeline
- `overview/ActivityCharts` — session count and edit activity over time
- `overview/ModelAgentBreakdown` — usage breakdown by model and agent
- `TimeRangeSelector` — filter overview data by time range (7d, 14d, 30d, 90d)

### Session view (`cinematic/`)

`CinematicSessionView` is the **sole** session presentation: a full-screen workspace composed of
- `TimelineScrubber` — timeline cursor with play/pause, step, speed, and go-live controls; Shift+Click isolates a contiguous range of turns
- `NotificationDrawer` — the activity/plan/prompt drawer carrying conversation rendering, plans, and tool calls
- `ConsolePane` — command/output console up to the cursor
- `FileAccessTree` + `FileDetail` — the file-access tree (reads/edits/writes/deletes + scratch files) and the selected file's preview/diff
- `TerminalPanel` (toggled from the header), scratch editor, and a markdown modal for the expanded file viewer

The row layout (tree | detail | drawer) is resizable and the drawer auto-collapses on narrow widths; width/collapse/tab state persists via `omnivue-cinematic-*` localStorage keys. The session row falls back to 5s polling while a session is active, on top of SSE.

The drawer's tabs are **activity** (conversation), **plan**, and **prompt**. Each activity item can contain:
- User request text (`UserPromptBubble`)
- Assistant text with markdown (`ui/MarkdownContent`)
- Tool calls (expandable cards via `ToolCallList`, `ToolRendererWrapper`) with `BookmarkButton` and `CopyButton`
- Reasoning blocks (collapsible)
- `PinMessageModal` — create a scratch file from selected message content

Plan items (status indicators: pending, in_progress, completed, blocked, canceled) render in the drawer's plan tab.

Diff hunks are structured `DiffLine` objects (`utils/diff.ts`); `mergeFileEdits` (`utils/diffTree.ts`) merges edits per file, and `DiffRenderer` renders the structured hunks inline inside `FileDetail`.

### Scratch editor (`ScratchEditor.tsx`)

Dual-mode editor:
- **WYSIWYG mode** using TipTap (rich markdown editing)
- **Code mode** using Monaco editor (raw markdown)

Mode is stored in the database per-scratch-file.

### Search (`SearchPanel.tsx`, `SearchResultsDrawer.tsx`)

Inline search bar with typeahead and recent searches; full-screen results drawer with highlighted snippets. Search scope can be limited to a specific session. Recent searches are persisted server-side via `/_/api/recent-searches`.

### Settings (`SettingsModal.tsx`)

Tabbed modal (`components/settings/`):
- **Agent** (`AgentSettingsTab`) — source discovery + add/remove
- **Sessions** (`SessionsSettingsTab`) — hide-stale toggle + stale-days threshold
- **Notifications** (`NotificationsSettingsTab`) — kind filters, scope, delivery channels
- **Appearance** (`AppearanceSettingsTab`) — theme selection (9 themes), light/dark mode, high-contrast toggle
- **Privacy** / **Developer** (`PrivacyDeveloperSettingsTabs`) — hide costs, disable custom renderers
- **About** (`AboutSettingsTab`) — version info

### Theme (`ThemeToggle.tsx`, `useTheme.tsx`)

Light/dark toggle + theme picker: Ayu, Nord, Catppuccin, Tokyo Night, GitHub, One Monokai, Atom One, Dracula, Night Owl. Persisted in localStorage (`omnivue-theme`, `omnivue-mode`, `omnivue-contrast`) and applied as `data-theme`/`data-mode`/`data-contrast` attributes on `<html>`.

### Tags (`TagPanel.tsx`, `CreateTagModal.tsx`, `EditTagModal.tsx`, `ManageTagsDialog.tsx`, `tags/`)

Tag-based session organization: unique names, optional colors, and session assignment (`tags/TagRow`, `TagFilterBar`, `TagSessionRow`, `TagListHeader`, `AssignPicker`).

### Bookmarks (`BookmarkPanel.tsx`, `BookmarkButton.tsx`)

`BookmarkPanel` lists bookmarks (messages, plans) with time-ago and delete-on-hover; `BookmarkButton` toggles a bookmark on tool call output cards and plan items.

### Notifications (`NotificationPanel.tsx`, `NotificationRow.tsx`, `NotificationToaster` inline)

- `NotificationPanel` — sidebar panel listing notifications with filters
- `NotificationRow` — single notification row with kind icon, title, preview, session name, relative time, read/unread styling
- `NotificationsSettingsTab` — settings UI for notification kinds, scope, and channels
- `NotificationToaster` (in `App.tsx`) — subscribes to notification list, fires in-app toasts and browser OS notifications

### Terminal (`TerminalPanel.tsx`, `useTerminal.ts`)

Inline PTY terminal inside the session view. Uses xterm.js backed by a WebSocket (`/_/ws/terminal`) that runs the agent's resume command in a PTY. Supports full TUI interaction (keyboard input, resize), auto-reconnect with exponential backoff, theme-aware styling, and ResizeObserver-based fitting. xterm.js is lazy-loaded.

### Other components

- `AppHeader` — Top bar with home button, search, connection indicator, running version, theme toggle
- `SessionHeader` — Session detail header with title, model, agent, status, timestamps; resume menu (`ResumeButton`), terminal toggle; and — when the session has sub-agents — a family selector (`sessions/SessionFamilySelect`) to switch between the main session and its sub-agents
- `ResumeButton` — Dropdown that copies the resume command variants (absolute, `cd`-stripped, in-harness) or opens the embedded terminal; also used by overview session rows
- `session-summary/format.ts` — Duration/number formatting shared by the console and session summaries
- `UserPromptBubble` — User request bubble (rendered inline in the drawer's prompt tab)
- `TimeRangeSelector` — Overview time-range filtering
- `MarkdownScreenshotButton` + `ScreenshotWindow` + `ScreenshotCaptureLayer` — Markdown screenshot capture (`lib/screenshot.ts`, `html-to-image`)
- `ShortcutsModal` — Keyboard shortcuts reference modal (opens with `?`)
- `Modal` (`ui/Modal`) — Reusable modal wrapper
- `ContextMenu` — Right-click context menus
- `Toast` — Toast notification component (used by NotificationToaster)
- `ErrorBoundary` (`ui/ErrorBoundary`) — Graceful error recovery
- `IconChannel` — Section navigation toggle (sessions/prompts/tags/bookmarks/notifications)
- Presentational widgets in `components/ui/`: `Spinner`, `LoadingState`, `EmptyState`, `EmptyPanel`, `FilterChip`, `Toggle`, `CopyButton`, `MarkdownContent`, `Modal`, `ErrorBoundary`
- Feature subdirs: `sessions/` (`SessionTree`, `SessionFamilySelect`, `VerboseStats`, `GroupMenu`, `IconBtn`), `overview/` (`ActivityCharts`, `StatCard`, `MiniSessionRow`, `ModelAgentBreakdown`, `RepoCard`), `cinematic/` (see above)

## API integration

All data flows through typed fetchers in `apiClient.ts` (implementation) with `schemas.ts` for zod runtime validation. Domain types (`types.ts`) are derived via `z.infer`:

```typescript
interface Session { id, sourceId, parentId?, title, repository, branch, agent, subAgent?, model, cost, directory, status, createdAt, updatedAt, tokensInput, tokensOutput, tokensReasoning, tokensCacheRead, tokensCacheWrite, messageCount, diffFiles, diffAdditions, diffDeletions, todos? }
interface Todo { id, title, description?, status, depends_on? }
interface Position { messageID, toolCallID? }
interface Message { id, role, content, reasoning?, reasoningAt?, toolCalls?, stepEvents?, timestamp, model?, agent?, tokensInput?, tokensOutput?, metadata?, error?, position? }
interface ToolCall { id, name, input, output, status, duration?, metadata?, messageId?, position?, usage? }
interface StepEvent { step: "start" | "finish", snapshot?, reason?, cost?, tokens? }
interface Plan { markdown, source } | null
interface DiffFile { path, status, additions, deletions, patch? }
interface FileEdit { filePath, toolName, oldStr?, newStr?, content?, viewRange?, timestamp, messageIndex?, messageId? }
interface Source { id, path, agentType, label, enabled, createdAt }
interface DiscoveredSource { path, agentType, label, sessions }
interface ScratchFile { id, sessionId, title, content, mode: "writable" | "readonly", createdAt, updatedAt }
interface SessionFile { path, content }
interface StatusInfo { version, pid, sources, sessions, indexed? }
interface Tag { id, name, color?, createdAt, updatedAt }
interface Bookmark { id, sessionId, messageId?, toolCallId?, label, kind: "message" | "plan", createdAt }
interface AppNotification { id, sessionId, sourceId, kind, title, preview, severity, payload?, createdAt, readAt? }
interface NotificationSettings { enabled, kinds, scope, inAppToast, sidebarBadge, browserNotify, excludeActiveView, enabledAt? }
interface Prompt { id, promptText, status: "open" | "done", pinned, position, createdAt, updatedAt?, doneAt? }
interface SearchResult { sessionId, sessionName?, sourceId, chunkType, repository, snippet, updatedAt?, fileTitle?, fileId?, messageIndex?, tagName? }
type Tab = "session" | "plan" | `scratch:${string}`
```

## Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useTerminal` | `hooks/useTerminal.ts` | WebSocket terminal connect/disconnect, send input, resize, auto-reconnect with backoff |
| `useSessions` | `hooks/useSessions.ts` | Session list, loading, indexing status, live changed IDs, SSE updates |
| `useSSE` | `hooks/useSSE.ts` | SSE connection with auto-reconnect (Effect stream) |
| `useStatus` | `hooks/useStatus.ts` | Server status (version, counts, indexed) |
| `useTheme` | `hooks/useTheme.tsx` | Theme name/mode/contrast state + persistence |
| `useNavigation` | `hooks/useNavigation.tsx` | Session navigation context (intent verbs) |
| `navigationReducer` | `hooks/navigationReducer.ts` | Pure navigation transition table |
| `useRouteSync` | `hooks/useRouteSync.ts` | URL hash deep-linking sync |
| `useBookmarks` | `hooks/useBookmarks.ts` | Bookmark list, toggle create/delete, navigation |
| `useTags` | `hooks/useTags.tsx` | Tag list, create/update/delete, session assignment |
| `useNotifications` | `hooks/useNotifications.ts` | Notification list, polling, SSE, mark-read, settings, per-session unread counts |
| `useActiveView` | `hooks/useNotifications.ts` | Reports currently-viewed session to server (debounced) |
| `useNotificationPermission` | `hooks/useNotificationPermission.ts` | Web Notifications API permission state |
| `useScratchFiles` | `hooks/useScratchFiles.ts` | Pin-message-as-scratch flow |
| `usePinMessage` | `hooks/usePinMessage.ts` | Pin message modal state and confirm flow |
| `useRecentSearches` | `hooks/useRecentSearches.ts` | Recent search queries (local + server sync) |
| `useSearchScope` | `hooks/useSearchScope.ts` | Search scope (all sessions vs single session) |
| `useSearchState` | `hooks/useSearchState.ts` | Search results drawer state + cancellation |
| `useSearchHighlightContext` | `hooks/useSearchHighlightContext.tsx` | Search highlight context provider |
| `useSessionTokenomics` | `hooks/useSessionTokenomics.ts` | Token/cost breakdown |
| `useSessionListSettings` | `hooks/useSessionListSettings.tsx` | Session list group-by, stale-session hiding |
| `useSessionPosition` | `hooks/useSessionPosition.ts` | Per-session scroll position persistence |
| `useTimeRange` | `hooks/useTimeRange.ts` | Overview time range filtering |
| `useTimeline` | `hooks/useTimeline.ts` | Timeline events + cursor/playback state |
| `useCinematicSearchJump` | `hooks/useCinematicSearchJump.ts` | Search/bookmark/notification jumps in cinematic view |
| `useConversationScroll` | `hooks/useConversationScroll.ts` | Scroll position tracking in conversation |
| `useDisableCustomRenderers` | `hooks/useDisableCustomRenderers.ts` | Custom tool renderer opt-out |
| `useHideCosts` | `hooks/useHideCosts.ts` | Hide cost display |
| `useResizable` | `hooks/useResizable.ts` | Resizable panels (sidebar, drawers, console, tree) |
| `useElementWidth` | `hooks/useElementWidth.ts` | ResizeObserver element width measurement |
| `useToast` | `hooks/useToast.tsx` | Toast notification system |
| `useCopy` | `hooks/useCopy.ts` | Clipboard copy with feedback |
| `useAppKeyboard` | `hooks/useAppKeyboard.ts` | Keyboard shortcut dispatch |

## State management

No external state library. Core state lives in `App.tsx`:
- `sessions` / `sessionsLoading` / `indexing` / `liveChangedIds` / `connected` — from `useSessions`
- `bookmarks` — from `useBookmarks`
- `notifications` / `notificationSettings` — from `useNotifications`
- `nav` — the navigation intent store (`useNavigationState`)
- `searchOpen` / `searchInput` / `drawerOpen` / `drawerResults` / `searchSessionScope` — search UI
- `sidebarOpen` — sidebar expand/collapse (persisted)
- `settingsOpen` / `shortcutsOpen` — modal state
- `promptCount` / `promptVersion` — prompt pad badge / SSE refresh
- `pinnedScratchId` — freshly pinned scratch focus

## Utility files

| File | Purpose |
|------|---------|
| `utils/buildTree.ts` | Groups sessions by repository |
| `utils/cinematicLayout.ts` | Cinematic row layout constants/math (min widths, handles, auto-collapse) |
| `utils/detectLanguage.ts` | Language detection for syntax highlighting |
| `utils/diff.ts` | Structured diff hunks (`DiffLine`/`DiffHunk`), compute/parse/render, `hunksContain` search |
| `utils/diffTree.ts` | Merge file edits into a diff tree (`MergedHunk`/`MergedFileDiff`) |
| `utils/errors.ts` | Shared error helpers (`getErrorMessage`, `isAbortError`, `describeApiError`, `runCatching`, `showErrorToast`) |
| `utils/fileAccess.ts` | Extract file read/edit/write/delete access from tool calls |
| `utils/jsonField.ts` | JSON field serialization utilities |
| `utils/overviewAnalytics.ts` | Overview analytics data computation |
| `utils/patchBody.ts` | Parse Codex/Copilot `apply_patch` bodies |
| `utils/reasoningChunks.ts` | Reasoning chunk helpers |
| `utils/reconcileMessages.ts` | Preserve message identity across SSE polls (avoids re-renders) |
| `utils/scratchMarkdown.ts` | Scratch markdown helpers |
| `utils/searchSections.ts` | Shared search section grouping (`groupSearchSections`) |
| `utils/searchUtils.tsx` | Search result rendering utilities |
| `utils/sessionFilters.ts` | Session list filtering logic |
| `utils/sessionUtils.tsx` | Session display helpers (time ago, status labels, `agentLabel`) |
| `utils/spanRange.ts` | Turn-span range math (containment, range merging) |
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
| `omnivue-sidebar-expanded` | Sidebar expanded/collapsed | `App` |
| `omnivue-sidebar-collapsed` | Collapsed repo groups | `SessionPanel` |
| `omnivue-sidebar-group` | Session group-by option | `SessionPanel` |
| `omnivue-sidebar-display` | Condensed/verbose | `SessionPanel` |
| `omnivue-cinematic-tree-width` | Cinematic tree width | Cinematic view |
| `omnivue-cinematic-drawer-width` | Cinematic drawer width | Cinematic view |
| `omnivue-cinematic-console-height` | Cinematic console height | Cinematic view |
| `omnivue-cinematic-drawer-collapsed` | Cinematic drawer collapsed | Cinematic view |
| `omnivue-cinematic-console-collapsed` | Cinematic console collapsed | Cinematic view |
| `omnivue-cinematic-activity-tab` | Cinematic activity tab | Cinematic view |
| `omnivue-cinematic-tree-filters` | File-tree kind visibility filters | `FileAccessTree` |
| `omnivue-tags-expanded` | Expanded tags | `TagPanel` |
| `omnivue-tag-sort` | Tag sort order | `TagPanel` |
| `omnivue-copy-mode-` (prefix) | Per-session copy mode | `ModeAwareCopyButton` |
| `omnivue-session-position-` (prefix) | Per-session scroll position | `useSessionPosition` |
| `omnivue-disable-custom-renderers` | Disable custom tool renderers | `useDisableCustomRenderers` |
| `omnivue-overview-timerange` | Overview time range selection | `useTimeRange` |

## Tool call renderers (`components/tool-renderers/`)

The tool renderer system uses a registry that auto-discovers renderers, maps tool names to components, and provides compact/full display modes with marker bar integration.

**Architecture:**
- `registry.ts` — Central registry that maps tool names to renderer components (auto-discovery via `import.meta.glob`)
- `types.ts` — Renderer component interface and types
- `ToolCallList.tsx` — Renders a list of tool calls with expandable cards
- `ToolRendererWrapper.tsx` — Wraps tool renderers with controls, supports custom renderer disabling
- `ToolActionsBar.tsx` — Action bar with bookmark, copy, and expand controls
- `ToolUsageInfo.tsx` — Per-tool-call token/cost attribution
- `ModeAwareCopyButton.tsx` — Copy button with per-session mode persistence
- `BookmarkButton.tsx` — Bookmark toggle on individual tool call outputs

**Builtin renderers** (`tool-renderers/builtin/`, + `index.ts`):
- `BashToolDiff`, `ReadToolDiff`, `EditToolDiff` (edit + write), `GlobToolDiff`, `GrepToolDiff`
- `DeleteToolDiff`, `QuestionToolDiff`, `TaskToolDiff`, `TaskGroupDiff`, `TaskCompleteToolDiff`, `TodoWriteToolDiff`
- `CompactionToolDiff`, `ExitPlanModeToolDiff`, `PermissionRequestToolDiff`, `ModelSwitchToolDiff`
- `SqlToolDiff`, `SkillToolDiff`, `WebSearchToolDiff`, `WebFetchToolDiff`
- `StoreMemoryToolDiff`, `ReadMemoriesToolDiff`, `ReadInboxToolDiff`, `DefaultToolDiff`
- `index.ts` — Registers all builtin renderers. (See `tool-renderers/AGENTS.md` for the full kind → component table.)

**Vendor renderers** (`tool-renderers/vendor/`):
- `atlassian/` — Jira tool diff renderer
- `example/` — Example renderer for reference

**Custom renderers:** Third-party renderers can be added by creating a package under `tool-renderers/vendor/` and registering it. See `tool-renderers/AGENTS.md`.

## Notification system

See [NOTIFICATIONS.md](NOTIFICATIONS.md) for classification, settings, scope,
deduplication, and channel behavior.

The delivery helpers (`lib/browserNotify.ts`) provide:

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
