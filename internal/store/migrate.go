package store

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// migration is a single forward-only schema change identified by a monotonic
// version number. The up function runs inside a transaction begun by the
// runner; it must use the provided *sql.Tx for every statement so that a
// failure rolls the whole migration (schema change + version stamp) back
// atomically.
type migration struct {
	version int
	desc    string
	up      func(*sql.Tx) error
}

// migrations is the append-only, ordered list of schema migrations. Version 1
// is the baseline reproducing the pre-versioning schema in full; it is
// idempotent so that running it against a pre-versioning (legacy) database is
// safe and equivalent to what prior binaries did on every startup.
//
// New schema changes append a higher-numbered migration here. NEVER modify,
// reorder, or delete an existing entry — that would corrupt databases already
// migrated past that version.
var migrations = []migration{
	{version: 1, desc: "baseline", up: migrateV1Baseline},
}

// SchemaVersion reports the highest migration version recorded as applied to
// the database, or 0 if the schema_migrations table is empty (e.g. a fresh or
// legacy database that has not yet been migrated).
func (s *Store) SchemaVersion() (int, error) {
	var v int
	err := s.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&v)
	return v, err
}

// ensureMigrationsTable creates the schema_migrations bookkeeping table.
func (s *Store) ensureMigrationsTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			desc TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`)
	return err
}

// applyMigration runs a single migration inside a transaction. The schema
// change (m.up) and the version stamp are committed atomically: if either
// fails the transaction is rolled back, leaving the database exactly as it was
// before the migration was attempted. On success the migration is never
// re-run because the stamp is now recorded.
func (s *Store) applyMigration(m migration) (retErr error) {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin migration %d: %w", m.version, err)
	}
	defer func() {
		if retErr != nil {
			if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
				slog.Warn("failed to rollback failed migration", "error", rbErr)
			}
		}
	}()

	if err := m.up(tx); err != nil {
		return fmt.Errorf("apply migration %d (%s): %w", m.version, m.desc, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO schema_migrations (version, desc, applied_at) VALUES (?, ?, ?)
		 ON CONFLICT(version) DO NOTHING`,
		m.version, m.desc, time.Now().Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("record migration %d: %w", m.version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %d: %w", m.version, err)
	}
	return nil
}

// migrate runs forward-only schema migrations.
//
// On a pre-versioning database (no schema_migrations table, but application
// tables already present), the baseline migration runs once — it is
// idempotent, so this is exactly what prior binaries did on every startup —
// and is then recorded so it never re-runs. Fresh databases run the baseline
// normally. Each subsequent migration runs exactly once in version order,
// each inside its own transaction.
func (s *Store) migrate() error {
	if err := s.ensureMigrationsTable(); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}
	current, err := s.SchemaVersion()
	if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	applied := current
	backedUp := false
	for _, m := range migrations {
		if m.version <= applied {
			continue
		}
		// The v1 baseline is additive/idempotent (CREATE IF NOT EXISTS, ADD
		// COLUMN, rebuildable FTS) and runs on fresh installs where there is
		// nothing to lose, so it never needs a backup. Real schema changes start
		// at v2: snapshot the database once before the first such migration.
		if !backedUp && m.version > 1 {
			backupPath, berr := s.backupBeforeMigrate(applied)
			if berr != nil {
				// A failed backup is not fatal — warn and continue. Losing the
				// ability to back up should not block a required migration.
				slog.Warn("failed to create pre-migration backup", "error", berr)
			} else {
				slog.Info("created pre-migration backup", "path", backupPath, "from", applied)
			}
			backedUp = true
		}
		if err := s.applyMigration(m); err != nil {
			return err
		}
		applied = m.version
	}
	return nil
}

// backupBeforeMigrate makes a timestamped copy of omnivue.db (after checkpointing
// the WAL into the main file) so the user can recover if a migration corrupts
// state. The copy lives next to the database in the state directory.
func (s *Store) backupBeforeMigrate(fromVersion int) (string, error) {
	// Flush WAL pages into the main database file so the copy is consistent on
	// its own. TRUNCATE resets the -wal file to zero size after checkpointing.
	if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return "", fmt.Errorf("wal checkpoint before backup: %w", err)
	}
	stamp := time.Now().Format("20060102-150405")
	backupPath := filepath.Join(filepath.Dir(s.path), fmt.Sprintf("omnivue.db.premigrate-v%d-%s.bak", fromVersion, stamp))
	if err := copyFile(s.path, backupPath); err != nil {
		return "", fmt.Errorf("copy database: %w", err)
	}
	return backupPath, nil
}

// copyFile copies src to dst with a 0600 mode, matching the state directory's
// privacy posture.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// migrateV1Baseline is the baseline migration. It reproduces the schema as it
// existed under the prior monolithic migrate(): every CREATE TABLE IF NOT
// EXISTS, the bookmarks unique index, the scratch_files.mode column backfill,
// and the search_index column probe-and-rebuild. All of it is idempotent, so
// running it against a database already shaped by a prior binary is a no-op
// (matching the previous per-startup behavior) while a fresh database gets the
// complete current schema. It runs inside the transaction provided by
// applyMigration; a partial failure rolls the whole baseline back.
//
//nolint:errcheck // search_index rebuild intentionally swallows probe errors
func migrateV1Baseline(tx *sql.Tx) error {
	if _, err := tx.Exec(`
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

		CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
			content,
			session_id UNINDEXED,
			source_id UNINDEXED,
			chunk_type UNINDEXED,
			repository UNINDEXED,
			updated_at UNINDEXED,
			file_title UNINDEXED,
			file_id UNINDEXED
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
	`); err != nil {
		return err
	}

	// Migration: ensure bookmarks unique index.
	if _, err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_ref ON bookmarks(session_id, message_index, tool_call_id)`); err != nil {
		return err
	}

	// Migration: add mode column to scratch_files for existing databases.
	// Swallow the error when the column already exists, matching prior behavior.
	// A statement-level error like "duplicate column name" does not abort the
	// surrounding transaction in SQLite, so subsequent statements still run.
	if _, err := tx.Exec(`ALTER TABLE scratch_files ADD COLUMN mode TEXT NOT NULL DEFAULT 'writable'`); err != nil {
		// column may already exist — ignore
		_ = err
	}

	// Migration: ensure message_index, updated_at, file_title, file_id columns
	// exist on search_index. FTS5 ALTER TABLE ADD COLUMN may fail on some
	// platforms, so test the column and drop/recreate the table if needed.
	if _, probeErr := tx.Exec(`SELECT updated_at, file_title, file_id, message_index FROM search_index LIMIT 0`); probeErr != nil {
		tx.Exec(`DROP TABLE IF EXISTS search_index`)
		tx.Exec(`DROP TABLE IF EXISTS index_state`)
		tx.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
			content,
			session_id UNINDEXED,
			source_id UNINDEXED,
			chunk_type UNINDEXED,
			repository UNINDEXED,
			updated_at UNINDEXED,
			file_title UNINDEXED,
			file_id UNINDEXED,
			message_index UNINDEXED
		)`)
		tx.Exec(`CREATE TABLE IF NOT EXISTS index_state (
			session_id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			last_indexed_at TEXT NOT NULL,
			content_hash TEXT
		)`)
	}

	return nil
}
