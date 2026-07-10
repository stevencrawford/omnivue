-- +goose Up
-- Allow NULL paths for cloud-based sources (e.g. GitHub Cloud agent sessions
-- that have no filesystem path, only a token).

-- SQLite does not support ALTER COLUMN, so we must recreate the table.
CREATE TABLE IF NOT EXISTS sources_new (
    id TEXT PRIMARY KEY,
    path TEXT,
    agent_type TEXT NOT NULL,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(path)
);

INSERT INTO sources_new (id, path, agent_type, label, enabled, last_scanned_at, created_at)
    SELECT id, path, agent_type, label, enabled, last_scanned_at, created_at FROM sources;

DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;

-- +goose Down
-- Intentionally empty: migrations are forward-only. Downgrading the binary is
-- unsupported; restore a pre-migration backup instead.
