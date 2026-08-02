-- +goose Up

CREATE TABLE IF NOT EXISTS prompt_queue (
    id            TEXT PRIMARY KEY,
    session_id    TEXT,
    source_id     TEXT,
    prompt_text   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK(status IN ('queued', 'dispatched', 'cancelled')),
    priority      INTEGER NOT NULL DEFAULT 0,
    tags          TEXT DEFAULT '[]',
    created_at    INTEGER NOT NULL,
    dispatched_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_prompt_queue_status ON prompt_queue(status);
CREATE INDEX IF NOT EXISTS idx_prompt_queue_session ON prompt_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_prompt_queue_created ON prompt_queue(created_at);

-- +goose Down
DROP TABLE IF EXISTS prompt_queue;
