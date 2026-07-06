package copilot

import (
	"database/sql"
	"path/filepath"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// sessionDBItem represents a raw row from the session.db todos table.
type sessionDBItem struct {
	ID          string
	Title       string
	Description string
	Status      string
}

// openSessionDB opens the session.db for the given session in read-only mode.
func openSessionDB(basePath, sessionID string) (*sql.DB, error) {
	dbPath := filepath.Join(basePath, "session-state", sessionID, "session.db")
	return ingest.OpenReadOnlyDB(dbPath)
}

// queryAllTodos reads all todo items from the session's session.db todos table.
// Returns nil if the table doesn't exist, has no rows, or can't be queried.
func queryAllTodos(db *sql.DB) []sessionDBItem {
	rows, err := db.Query(`SELECT id, title, COALESCE(description, ''), COALESCE(status, 'pending') FROM todos ORDER BY rowid`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var items []sessionDBItem
	for rows.Next() {
		var item sessionDBItem
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.Status); err != nil {
			return nil
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil
	}
	return items
}
