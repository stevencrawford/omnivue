-- +goose Up

CREATE TABLE IF NOT EXISTS notifications (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    dedup_key     TEXT NOT NULL,
    title         TEXT NOT NULL,
    preview       TEXT NOT NULL,
    severity      TEXT NOT NULL DEFAULT 'info',
    payload       TEXT,
    created_at    INTEGER NOT NULL,
    read_at       INTEGER
);

CREATE TABLE IF NOT EXISTS notification_state (
    session_id              TEXT PRIMARY KEY,
    last_seen_message_count INTEGER NOT NULL DEFAULT 0,
    last_seen_at            INTEGER,
    first_viewed_at         INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(session_id, kind, dedup_key);

-- +goose Down
DROP TABLE IF EXISTS notification_state;
DROP TABLE IF EXISTS notifications;
