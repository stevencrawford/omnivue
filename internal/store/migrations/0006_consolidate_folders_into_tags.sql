-- +goose Up

-- Consolidate the deprecated "folders" feature into tags. Folders were a
-- user-defined, hierarchical organizational layer stored in the `folders` /
-- `folder_sessions` tables. Tags are the replacement (flat, unique-named,
-- optional color). This migration:
--   1. Creates one tag per distinct folder name (deduping name collisions onto
--      a single tag, picking a representative color / timestamps).
--   2. Copies every folder<->session membership over to `session_tags`.
--   3. Drops the folder tables.
-- Folder hierarchy (parent_id) and per-entry sort order have no tag equivalent
-- and are intentionally lost. User data preserved: session organization.

-- One tag per distinct folder name. A folder name may collide with an existing
-- tag or another folder; ON CONFLICT(name) keeps the first, so repeated folder
-- names all funnel into a single tag.
INSERT OR IGNORE INTO tags (id, name, color, created_at, updated_at)
SELECT
    'folder:' || MIN(id) AS id,
    name,
    MAX(color),
    MIN(created_at),
    MAX(updated_at)
FROM folders
GROUP BY name;

-- Copy every folder membership onto the matching tag (matched by name so
-- deduplicated folders share one tag).
INSERT OR IGNORE INTO session_tags (tag_id, session_id, added_at)
SELECT
    t.id,
    fs.session_id,
    MIN(fs.added_at)
FROM folder_sessions fs
JOIN folders f ON f.id = fs.folder_id
JOIN tags t ON t.name = f.name
GROUP BY t.id, fs.session_id;

DROP TABLE IF EXISTS folder_sessions;
DROP TABLE IF EXISTS folders;

-- +goose Down