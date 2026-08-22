-- +goose Up

CREATE TABLE IF NOT EXISTS file_activity (
    session_id TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    repository TEXT,
    path       TEXT NOT NULL,
    reads      INTEGER NOT NULL DEFAULT 0,
    writes     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_activity_path  ON file_activity(path);
CREATE INDEX IF NOT EXISTS idx_file_activity_source ON file_activity(source_id);
CREATE INDEX IF NOT EXISTS idx_file_activity_repo   ON file_activity(repository);

-- +goose Down

DROP TABLE IF EXISTS file_activity;
