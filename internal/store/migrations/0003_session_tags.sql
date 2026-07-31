-- +goose Up

-- User-defined tags applied to sessions (parallel to folders, many-to-many).
-- Tags are flat (no hierarchy) with a unique name and an optional color used
-- for chips in the UI. session_tags records which sessions carry each tag.

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_tags (
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (tag_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tags_session ON session_tags(session_id);

-- +goose Down
DROP INDEX IF EXISTS idx_session_tags_session;
DROP TABLE IF EXISTS session_tags;
DROP TABLE IF EXISTS tags;
