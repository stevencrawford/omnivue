-- +goose Up

-- Rebuild the session-scoped prompt queue as a global prompt pad. Prompts are
-- no longer tied to a session, source, priority, or tag set; the status domain
-- collapses from (queued|dispatched|cancelled) to (open|done), and explicit
-- ordering (position, pinned) is introduced.
CREATE TABLE prompts (
    id          TEXT PRIMARY KEY,
    prompt_text TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    pinned      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER,
    done_at     INTEGER
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

DROP TABLE prompt_queue;

CREATE INDEX idx_prompts_status ON prompts(status);
CREATE INDEX idx_prompts_position ON prompts(position);

-- +goose Down
DROP TABLE IF EXISTS prompts;
