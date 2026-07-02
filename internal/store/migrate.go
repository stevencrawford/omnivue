package store

import (
	"database/sql"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// gooseLogger adapts goose's two-method Logger interface to slog so migration
// activity appears in the standard omnivue log stream instead of raw stdout.
type gooseLogger struct{}

func (*gooseLogger) Fatalf(format string, v ...any) {
	slog.Error("goose: " + fmt.Sprintf(format, v...))
}

func (*gooseLogger) Printf(format string, v ...any) {
	slog.Info("goose: " + fmt.Sprintf(format, v...))
}

var _ goose.Logger = (*gooseLogger)(nil)

func init() {
	// Expose only the migration .sql files to goose, rooted at ".".
	fsys, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		// The embed path is compile-time verified; this is unreachable.
		slog.Error("goose: invalid migrations embed", "error", err)
		return
	}
	goose.SetBaseFS(fsys)
	goose.SetLogger(&gooseLogger{})
	goose.SetVerbose(false)
	// modernc.org/sqlite registers the driver as "sqlite", which goose's
	// auto-detection does not recognize (it expects "sqlite3" like the mattn
	// driver). Set the dialect explicitly so goose emits SQLite-flavored SQL.
	if err := goose.SetDialect("sqlite3"); err != nil {
		slog.Error("goose: set dialect", "error", err)
	}
}

// SchemaVersion reports the highest migration version applied to the database,
// or 0 if none has run yet (fresh or pre-versioning legacy database). It
// initializes goose's version table on first call if needed.
func (s *Store) SchemaVersion() (int, error) {
	v, err := goose.EnsureDBVersion(s.db)
	if err != nil {
		return 0, err
	}
	return int(v), nil
}

// latestMigrationVersion returns the highest version number among the embedded
// migration files, used to decide whether any migration is pending without
// running goose.Up.
func latestMigrationVersion() (int, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return 0, err
	}
	max := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		v, err := goose.NumericComponent(e.Name())
		if err != nil {
			continue
		}
		if int(v) > max {
			max = int(v)
		}
	}
	return max, nil
}

// appTablesExist reports whether application tables already exist in the
// database. It distinguishes a fresh install (nothing to back up) from a
// pre-versioning legacy database or an in-place upgrade.
func (s *Store) appTablesExist() (bool, error) {
	var name string
	err := s.db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='sources' LIMIT 1`).Scan(&name)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// migrate runs forward-only schema migrations via goose. Migration files live
// in migrations/*.sql (embedded) and are applied in version order, each in its
// own transaction by default.
//
// Before applying any migration to a database that already holds application
// data, a pre-migration backup of omnivue.db is taken so a failed migration
// can be recovered manually. Fresh installs are not backed up (nothing to
// lose).
//
// No special command is needed: this runs automatically on every startup. A
// user who downloads a newer binary is migrated on the next launch. There is
// no auto-downgrade.
func (s *Store) migrate() error {
	current, err := goose.EnsureDBVersion(s.db)
	if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	latest, err := latestMigrationVersion()
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	if int64(latest) <= current {
		return nil
	}

	// Back up only when there is existing data to lose. A fresh install (no
	// application tables) has nothing to back up; this covers both in-place
	// upgrades (current >= 1) and pre-versioning legacy databases (current == 0
	// but tables present) jumping straight to a multi-migration release.
	if exists, err := s.appTablesExist(); err != nil {
		slog.Warn("failed to check for existing tables before backup", "error", err)
	} else if exists {
		backupPath, berr := s.backupBeforeMigrate(int(current))
		if berr != nil {
			// A failed backup is not fatal — warn and continue. Losing the
			// ability to back up should not block a required migration.
			slog.Warn("failed to create pre-migration backup", "error", berr)
		} else {
			slog.Info("created pre-migration backup", "path", backupPath, "from", current)
		}
	}

	if err := goose.Up(s.db, "."); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// backupBeforeMigrate makes a timestamped copy of omnivue.db (after
// checkpointing the WAL into the main file) so the user can recover if a
// migration corrupts state. The copy lives next to the database in the state
// directory.
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
