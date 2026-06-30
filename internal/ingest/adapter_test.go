package ingest_test

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/stevencrawford/omnivue/internal/ingest"

	_ "modernc.org/sqlite"
)

func TestOpenReadOnlyDB_RejectsWrites(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create a writable database with a table
	wdb, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_journal_mode=wal", dbPath))
	if err != nil {
		t.Fatal(err)
	}
	_, err = wdb.Exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY, val TEXT)")
	if err != nil {
		t.Fatal(err)
	}
	_, err = wdb.Exec("INSERT INTO test_table (val) VALUES ('hello')")
	if err != nil {
		t.Fatal(err)
	}
	wdb.Close()

	// Open read-only via our safeguard
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		t.Fatalf("expected read-only open to succeed, got: %v", err)
	}
	defer db.Close()

	// Verify reads work
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM test_table").Scan(&count)
	if err != nil {
		t.Fatalf("read query failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 row, got %d", count)
	}

	// Verify all write operations are rejected
	writeOps := []struct {
		name string
		sql  string
	}{
		{"INSERT", "INSERT INTO test_table (val) VALUES ('bad')"},
		{"UPDATE", "UPDATE test_table SET val = 'bad'"},
		{"DELETE", "DELETE FROM test_table"},
		{"DROP", "DROP TABLE test_table"},
		{"CREATE", "CREATE TABLE bad_table (id INTEGER)"},
	}

	for _, op := range writeOps {
		t.Run(op.name, func(t *testing.T) {
			_, err := db.Exec(op.sql)
			if err == nil {
				t.Fatalf("expected %s to be rejected on read-only database", op.name)
			}
		})
	}
}

func TestOpenReadOnlyDB_NonexistentPath(t *testing.T) {
	_, err := ingest.OpenReadOnlyDB("/nonexistent/path/db.sqlite")
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}
