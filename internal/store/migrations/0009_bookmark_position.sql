-- +goose Up
-- Rebuild bookmarks around the canonical Position identity (message_id +
-- tool_call_id) instead of the legacy rendered message_index. message_index is
-- a rendered-block index that is not stable across re-grouping and cannot be
-- resolved back to a stable message id, so all legacy bookmark rows are
-- dropped during migration.
CREATE TABLE bookmarks_new (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    tool_call_id TEXT,
    label TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message',
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_bookmarks_new_ref ON bookmarks_new(session_id, message_id, tool_call_id);

DROP TABLE bookmarks;
ALTER TABLE bookmarks_new RENAME TO bookmarks;

-- +goose Down
-- Intentionally empty: migrations are forward-only. Downgrading the binary is
-- unsupported; restore a pre-migration backup (omnivue.db.premigrate-v*.bak)
-- from the state directory instead.