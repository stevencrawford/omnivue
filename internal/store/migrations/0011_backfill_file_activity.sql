-- +goose Up

-- Backfill for the file-activity graph. Migration 0010 created the
-- file_activity table, but the indexer only computes activity for sessions it
-- re-indexes — and it skips any session whose stored content hash is
-- unchanged. Without this step, every session that existed before the upgrade
-- keeps its old hash and never gets file_activity rows, leaving the graph
-- empty for existing users.
--
-- index_state is a rebuildable cache (see AGENTS.md): clearing it forces the
-- next poll cycle to re-index every session transparently, which recomputes
-- both the FTS5 search chunks and the per-session read/write activity. No user
-- data is affected.
DELETE FROM index_state;

-- +goose Down
