# Notifications

Omnivue can alert you when an agent asks a question, requests permission,
proposes a plan, completes a task, produces new output, or changes status.
Notifications are **opt-in** and evaluated locally after each session refresh.

Implementation:

| Layer | File | Responsibility |
|-------|------|----------------|
| Classification | `internal/notify/notify.go` | Pure function over session status, messages, seen cursor, and settings |
| Persistence + delivery | `internal/server/notifier.go` | Scope filtering, deduplication, pruning, SSE emission, active-view exclusion |
| In-app UI | `internal/frontend/src/components/NotificationPanel.tsx`, `NotificationRow.tsx` | Sidebar list, unread badge, filters |
| Toasts + OS notifications | `internal/frontend/src/lib/browserNotify.ts`, `NotificationToaster` in `App.tsx` | Toast and browser-notification channels |
| Settings UI | `internal/frontend/src/components/settings/NotificationsSettingsTab.tsx` | Master toggle, kinds, scope, channels |
| API | `docs/API.md` | `/_/api/notifications*` endpoints and SSE events |

## Settings

Settings are stored as a JSON blob in the `config` table under
`notifications.settings`. Defaults are intentionally conservative: notifications
are off, and only the four action-requiring kinds are preselected.

| Setting | Default | Values | Meaning |
|---------|---------|--------|---------|
| `enabled` | `false` | boolean | Master switch; nothing is classified while off |
| `kinds` | `question`, `permission_request`, `exit_plan_mode`, `task_complete` | array of kinds | Which events create notifications |
| `scope` | `"all"` | `"all"` / `"opened"` / `"pinned"` | Which sessions may notify |
| `inAppToast` | `true` | boolean | Show in-app toasts |
| `sidebarBadge` | `true` | boolean | Save the "unread badge in sidebar" preference |
| `browserNotify` | `false` | boolean | Fire OS notifications (requires browser permission and a hidden tab) |
| `excludeActiveView` | `true` | boolean | Suppress notifications for the session currently being viewed |
| `enabledAt` | unset | unix ms | Set when notifications are enabled; bounds first-run suppression |

Scope values:

| Scope | Includes |
|-------|----------|
| `all` | Every enabled source/session |
| `opened` | Sessions you have opened at least once (recorded server-side) |
| `pinned` | Sessions carrying at least one tag |

## Kinds

| Kind | Severity | Trigger | Default |
|------|----------|---------|---------|
| `question` | attention | A `question`/`ask` tool call that is not an Allow/Deny permission prompt | on |
| `permission_request` | attention | A permission tool call, or a `question` whose choices are Allow/Deny | on |
| `exit_plan_mode` | attention | An `exit_plan_mode` tool call (agent proposes a plan) | on |
| `task_complete` | info | A task-completion tool call | on |
| `new_messages` | info | One or more new messages since the last seen cursor | off |
| `new_tool_call` | info | Any other tool call | off |
| `status_active` | info | Session transitioned to `active` | off |
| `status_completed` | info | Session transitioned to `completed` | off |
| `status_error` | info | Session transitioned to a status containing `error` or `failed` | off |

Tool-name interpretation comes from the shared vocabulary in
`internal/ingest/ingestkit` (`KindsOf` / `HasKind`), so adapters do not each
maintain their own notification name lists.

## Behavior

### Seen cursor

Each session has a `last_seen_message_count` cursor. Only messages at or beyond
that cursor are classified. The cursor advances after every pass, including
when notifications are disabled, are out of scope, or are suppressed for the
active view — so re-enabling notifications never replays a backlog.

### First-run suppression

`enabledAt` is stamped when notifications are first enabled (and re-stamped
after disabling and re-enabling). Messages older than `enabledAt` are skipped,
which prevents a flood of historical sessions. Status transitions are not
suppressed because they reflect current state.

### Deduplication

Notifications are deduplicated in the store by
`(session_id, kind, dedup_key)`. Tool notifications key on the tool-call ID
(falling back to a hash of message ID + tool name); `new_messages` keys on the
last message ID; status notifications use a stable per-kind key. Re-seeing the
same event never creates a second row.

### Active-view exclusion

The frontend reports the session you are viewing to
`POST /_/api/notifications/active-view` on a heartbeat. With
`excludeActiveView` enabled, notifications for that session are suppressed for
a five-minute window while the seen cursor still advances.

### Volume limits

At most 50 changed sessions are classified per refresh pass; the rest have
their cursors advanced and are picked up on the next pass. The newest 500
notifications are retained; older rows are pruned after a pass that emitted
something.

## Channels

`resolveChannels()` in `lib/browserNotify.ts` decides delivery:

- **In-app toast** — when `enabled` and `inAppToast` are true.
- **OS notification** — when `enabled`, `browserNotify` is true, the browser
  permission is `granted`, and the tab is hidden. Clicking the OS notification
  focuses the window.
- **Sidebar badge/list** — unread notifications appear in the notifications
  panel and the icon-channel badge; the `sidebarBadge` preference is stored but
  is not currently consulted when rendering the badge.

## API and events

| Endpoint | Purpose |
|----------|---------|
| `GET /_/api/notifications?limit=&unreadOnly=` | List notifications, newest first |
| `DELETE /_/api/notifications` | Delete all notifications |
| `POST /_/api/notifications/read` | Mark IDs read (`ids: null` marks all) |
| `POST /_/api/notifications/active-view` | Report the currently viewed session |
| `GET /_/api/notifications/settings` | Read settings |
| `PUT /_/api/notifications/settings` | Save settings |

SSE events (`GET /_/events`):

| Event | Payload | Meaning |
|-------|---------|---------|
| `notification` | The notification object | A new notification was created |
| `notifications-read` | `{"ids":[...]}` or `{"all":true}` | Read state changed or the list was cleared |
