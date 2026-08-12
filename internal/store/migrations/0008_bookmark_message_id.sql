-- +goose Up
ALTER TABLE bookmarks ADD COLUMN message_id TEXT;

-- +goose Down
-- Intentionally empty: migrations are forward-only. Downgrading the binary is
-- unsupported; restore a pre-migration backup (omnivue.db.premigrate-v*.bak)
-- from the state directory instead.