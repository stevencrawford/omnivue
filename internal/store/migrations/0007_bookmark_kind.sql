-- +goose Up
ALTER TABLE bookmarks ADD COLUMN kind TEXT NOT NULL DEFAULT 'message';

-- +goose Down
-- Intentionally empty: migrations are forward-only. Downgrading the binary is
-- unsupported; restore a pre-migration backup (omnivue.db.premigrate-v*.bak)
-- from the state directory instead.