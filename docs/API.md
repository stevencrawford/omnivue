# API Reference

All internal API endpoints are under `/_/api/` and SSE under `/_/events`. The `/_/` prefix avoids collisions with SPA routes.

## Status

```http
GET /_/api/status
```

Returns server status.

```json
{
  "version": "0.1.0",
  "pid": 12345,
  "sources": 3,
  "sessions": 42
}
```

## Sources

```http
GET /_/api/sources
```

List configured session sources.

```json
[
  {
    "id": "a1b2c3d4e5f6",
    "path": "/Users/user/.local/share/opencode",
    "agentType": "opencode",
    "label": "OpenCode",
    "enabled": true,
    "createdAt": "2026-06-01T12:00:00Z"
  }
]
```

```http
POST /_/api/sources
```

Add a new session source. The `agentType` field is auto-detected if omitted.

```json
{
  "path": "/Users/user/.cursor",
  "agentType": "cursor",
  "label": "Cursor",
  "enabled": true
}
```

```http
DELETE /_/api/sources/{id}
```

Remove a source by ID. Returns `204`.

```http
PATCH /_/api/sources/{id}
```

Update a source's path, type, label, or enabled state.

```json
{
  "path": "/Users/user/.local/share/opencode",
  "agentType": "opencode",
  "label": "OpenCode",
  "enabled": true
}
```

## Config

```http
GET /_/api/config
```

Returns all config key-value pairs.

```json
{
  "theme": "dark"
}
```

```http
PUT /_/api/config
```

Set a config key-value pair.

```json
{
  "key": "theme",
  "value": "dark"
}
```

## Sessions

```http
GET /_/api/sessions
```

List all sessions across all enabled sources. Returns an array of `Session` objects.

```http
GET /_/api/sessions/{id}
```

Get a single session by ID.

```http
GET /_/api/sessions/{id}/messages
```

Get session conversation messages, including tool calls, step events, and reasoning content.

```http
GET /_/api/sessions/{id}/plan
```

Get the session's implementation plan as markdown. Returns `null` if no plan exists.

```http
GET /_/api/sessions/{id}/diffs
```

Get file changes for the session. Each entry includes path, status (added/modified/deleted), and unified diff patch.

```http
GET /_/api/sessions/{id}/edits
```

Get raw edit/write tool call data with old/new content, useful for reconstructing file-level diffs.

```http
GET /_/api/sessions/{id}/resume
```

Get the CLI command to resume a session.

```json
{
  "command": "cd /path/to/project && opencode --resume abc123"
}
```

```http
PUT /_/api/sessions/{id}/name
```

Override the display name for a session.

```json
{
  "displayName": "My Custom Name"
}
```

```http
DELETE /_/api/sessions/{id}/name
```

Clear the display name override, reverting to the original title.

## Scratch Files

```http
GET /_/api/sessions/{id}/scratch
```

List scratch files for a session.

```http
POST /_/api/sessions/{id}/scratch
```

Create a new scratch file.

```json
{
  "title": "Notes",
  "content": "# Notes\n\nMy observations...",
  "mode": "writable"
}
```

The optional `mode` field defaults to `"writable"`.

```http
GET /_/api/sessions/{id}/scratch/{fileId}
```

Get a single scratch file.

```http
PUT /_/api/sessions/{id}/scratch/{fileId}
```

Update a scratch file's title and content.

```json
{
  "title": "Updated Notes",
  "content": "# Updated\n\nNew content..."
}
```

```http
DELETE /_/api/sessions/{id}/scratch/{fileId}
```

Delete a scratch file.

```http
GET /_/api/scratch
```

List all scratch files across all sessions.

## Search

```http
GET /_/api/search?q=<query>&limit=<n>&session_id=<id>
```

Full-text search across indexed session content. Uses SQLite FTS5 syntax.

Parameters:
- `q` (required) — Search query (FTS5 syntax)
- `limit` (optional, default 50) — Max results
- `session_id` (optional) — Scope search to a single session

```json
[
  {
    "sessionId": "abc123",
    "sessionName": "Fix login bug",
    "sourceId": "src1",
    "chunkType": "messages",
    "repository": "my-app",
    "snippet": "fix the <mark>login</mark> form validation",
    "updatedAt": "2026-06-01T12:00:00Z",
    "fileTitle": "",
    "fileId": "",
    "messageIndex": 0
  }
]
```

Results are ordered by chunk type (name → plan → messages → scratch) then by FTS rank.

## Folders

```http
GET /_/api/folders
```

List all folders.

```json
[
  {
    "id": "folder_1234",
    "name": "Frontend bugs",
    "parentId": null,
    "sortOrder": 0,
    "color": "#ff0000",
    "icon": "bug",
    "createdAt": "2026-06-01T12:00:00Z",
    "updatedAt": "2026-06-01T12:00:00Z"
  }
]
```

```http
POST /_/api/folders
```

Create a new folder.

```json
{
  "name": "Frontend bugs",
  "color": "#ff0000",
  "icon": "bug"
}
```

Returns the created folder with `201`.

```http
PATCH /_/api/folders/{id}
```

Update folder name, color, or icon. Returns `204`.

```http
DELETE /_/api/folders/{id}
```

Delete a folder and its session assignments (cascade). Returns `204`.

```http
GET /_/api/folders/{id}/sessions
```

List session IDs assigned to a folder.

```http
POST /_/api/folders/{id}/sessions/{sessionId}
```

Assign a session to a folder. Returns `204`.

```http
DELETE /_/api/folders/{id}/sessions/{sessionId}
```

Remove a session from a folder. Returns `204`.

## Server Lifecycle

```http
POST /_/api/shutdown
```

Gracefully shut down the server. Returns `202` with no body.

```http
POST /_/api/restart
```

Restart the server. The server spawns a new process before shutting down. Returns `202` with no body.

## Recent Searches

```http
GET /_/api/recent-searches
```

Returns the list of recent search queries as `[]string`.

```http
POST /_/api/recent-searches
```

Save recent search queries. Accepts `[]string` body.

## Bookmarks

```http
GET /_/api/bookmarks
```

List all bookmarks.

```json
[
  {
    "id": "bm_abc123",
    "sessionId": "sess_123",
    "messageIndex": 5,
    "toolCallId": "tc_456",
    "label": "Interesting output",
    "createdAt": "2026-06-01T12:00:00Z"
  }
]
```

```http
POST /_/api/bookmarks
```

Create or toggle a bookmark. If a bookmark for the same session+message+toolCall already exists, it is deleted instead. Accepts `sessionId`, `messageIndex`, `toolCallId`, and optional `label`.

```json
{
  "sessionId": "sess_123",
  "messageIndex": 5,
  "toolCallId": "tc_456",
  "label": "Interesting output"
}
```

Response indicates the action taken:

```json
{"action": "created", "bookmark": {...}}
```
or
```json
{"action": "deleted", "id": "bm_abc123"}
```

```http
DELETE /_/api/bookmarks/{id}
```

Delete a bookmark by ID. Returns `204`.

## Reset

```http
POST /_/api/reset
```

Reset all user data: sources, folders, search index, session names, scratch files, config, and bookmarks. Agent data on disk is unaffected. Closes all adapters, clears sessions, and sends an SSE `reset` event.

```json
{"status": "ok"}
```

## Server-Sent Events

```http
GET /_/events
```

SSE stream for live updates. The response headers are set for streaming (`text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`).

```
event: started
data: {"pid":12345}

event: update
data: {}

event: session-changed
data: {"ids":["sess1","sess2"]}
```

Events:
- `started` — Initial connection confirmation (includes PID)
- `update` — Session list may have changed (refresh)
- `session-changed` — Specific sessions changed, with IDs
