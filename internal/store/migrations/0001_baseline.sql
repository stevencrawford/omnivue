-- +goose Up

-- Baseline capturing the omnivue.db schema as of v0.1.0. Every statement is
-- idempotent (CREATE ... IF NOT EXISTS), so this is safe to run against a
-- pre-versioning legacy database already shaped by prior binaries: it is a
-- no-op on tables that already exist with the current shape, and creates the
-- full current schema for fresh databases.
--
-- This runs once (goose stamps goose_db_version on success); it never re-runs.
-- Future schema changes append a higher-numbered 000N_*.sql file here. NEVER
-- modify or reorder an existing migration file.

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    agent_type TEXT NOT NULL,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
    sort_order INTEGER DEFAULT 0,
    color TEXT,
    icon TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_sessions (
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    added_at TEXT NOT NULL,
    PRIMARY KEY (folder_id, session_id)
);

-- search_index and index_state are rebuildable from agent data. The full
-- 9-column FTS5 schema is created here; any prior table with an older shape
-- is left in place (CREATE IF NOT EXISTS is a no-op when it exists). All
-- released binaries that shaped search_index already ensured these columns,
-- so no drop/rebuild is needed at the baseline.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    content,
    session_id UNINDEXED,
    source_id UNINDEXED,
    chunk_type UNINDEXED,
    repository UNINDEXED,
    updated_at UNINDEXED,
    file_title UNINDEXED,
    file_id UNINDEXED,
    message_index UNINDEXED
);

CREATE TABLE IF NOT EXISTS index_state (
    session_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    last_indexed_at TEXT NOT NULL,
    content_hash TEXT
);

CREATE TABLE IF NOT EXISTS session_names (
    session_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scratch_files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'writable',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_index INTEGER NOT NULL,
    tool_call_id TEXT,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_ref ON bookmarks(session_id, message_index, tool_call_id);

-- +goose Down
-- Intentionally empty: migrations are forward-only. Downgrading the binary is
-- unsupported; restore a pre-migration backup (omnivue.db.premigrate-v*.bak)
-- from the state directory instead.
