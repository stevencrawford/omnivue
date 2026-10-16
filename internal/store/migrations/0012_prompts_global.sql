-- +goose Up

-- Rebuild the session-scoped prompt queue as a global prompt pad. Prompts are
-- no longer tied to a session, source, priority, or tag set; the status domain
-- collapses from (queued|dispatched|cancelled) to (open|done), and explicit
-- ordering (position, pinned) is introduced.
--
-- This migration was originally numbered 0010. It was renumbered to 0012
-- because version 0010 (and 0011) were already used by 0010_file_activity.sql
-- and 0011_backfill_file_activity.sql on the feat/file-graph branch. Databases
-- that ran those migrations are stamped at version 11, so a "new" 0010 would
-- never be applied and the prompts table would never be created. Bumping above
-- that watermark is the only way to reach those databases.
--
-- Every statement is idempotent so the migration is also safe on databases that
-- already applied the earlier (unreleased) 0010_prompts_global: the table, index
-- and legacy-table guards all no-op there, and the legacy table is recreated
-- empty (then dropped) so the carry-over parses even when it was already gone.
CREATE TABLE IF NOT EXISTS prompts (
    id          TEXT PRIMARY KEY,
    prompt_text TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    pinned      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER,
    done_at     INTEGER
);

-- The old prompt_queue table is created-if-missing so the carry-over below is
-- valid whether or not it still exists.
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

-- Carry over existing prompts. `dispatched` becomes `done`; anything else
-- (queued, cancelled) becomes `open`. position is seeded from created_at so the
-- previous newest-first ordering is preserved.
INSERT INTO prompts (id, prompt_text, status, pinned, position, created_at, done_at)
    SELECT id,
           prompt_text,
           CASE status WHEN 'dispatched' THEN 'done' ELSE 'open' END,
           0,
           created_at,
           created_at,
           dispatched_at
    FROM prompt_queue;

DROP TABLE IF EXISTS prompt_queue;

CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts(status);
CREATE INDEX IF NOT EXISTS idx_prompts_position ON prompts(position);

-- +goose Down
DROP TABLE IF EXISTS prompts;
