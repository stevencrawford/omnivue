package copilot

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// todoState tracks todo state for a session by querying session.db directly.
// It uses snapshot-based change detection: each call to synthesizeInput queries
// the database and compares against a cached hash. Only changes emit output.
type todoState struct {
	basePath  string
	sessionID string
	lastHash  string
}

func newTodoState(basePath, sessionID string) *todoState {
	return &todoState{basePath: basePath, sessionID: sessionID}
}

// isTodoQuery checks whether a SQL query targets the todos table.
func isTodoQuery(query string) bool {
	lower := strings.ToLower(strings.TrimSpace(query))
	for _, keyword := range []string{"from todos", "into todos", "update todos", "table todos"} {
		if strings.Contains(lower, keyword) {
			return true
		}
	}
	return false
}

// synthesizeInput queries session.db for the current todo state and returns
// a todowrite-compatible JSON string if the state has changed since the last
// call. Returns "" if no change, the session.db is unavailable, or empty.
func (ts *todoState) synthesizeInput() string {
	db, err := openSessionDB(ts.basePath, ts.sessionID)
	if err != nil {
		return ""
	}
	defer db.Close()

	items := queryAllTodos(db)
	if len(items) == 0 {
		return ""
	}

	hash := ts.hashItems(items)
	if hash == ts.lastHash {
		return "" // no change since last call
	}
	ts.lastHash = hash

	entries := make([]map[string]string, len(items))
	for i, item := range items {
		status := item.Status
		if status == "done" {
			status = "completed"
		}
		entries[i] = map[string]string{
			"id":      item.ID,
			"content": item.Title,
			"status":  status,
		}
	}

	out, err := json.Marshal(map[string]any{"todos": entries})
	if err != nil {
		return ""
	}
	return string(out)
}

// loadSessionTodos reads the todos table from a Copilot session's session.db
// for the session-level TODOs view. Returns nil if unavailable or empty.
func (a *Adapter) loadSessionTodos(sessionID string) []ingest.Todo {
	db, err := openSessionDB(a.basePath, sessionID)
	if err != nil {
		return nil
	}
	defer db.Close()

	items := queryAllTodos(db)
	if len(items) == 0 {
		return nil
	}

	todos := make([]ingest.Todo, len(items))
	todoIndex := make(map[string]*ingest.Todo, len(items))
	for i, item := range items {
		t := ingest.Todo{
			ID:          item.ID,
			Title:       item.Title,
			Description: item.Description,
			Status:      item.Status,
		}
		todos[i] = t
		todoIndex[t.ID] = &todos[i]
	}

	// Load dependencies
	if depRows, err := db.Query(`SELECT todo_id, depends_on FROM todo_deps`); err == nil {
		defer depRows.Close()
		for depRows.Next() {
			var todoID, dependsOn string
			if depRows.Scan(&todoID, &dependsOn) == nil {
				if t, ok := todoIndex[todoID]; ok {
					t.DependsOn = append(t.DependsOn, dependsOn)
				}
			}
		}
		if err := depRows.Err(); err != nil {
			slog.Warn("copilot: error reading todo_deps", "error", err)
		}
	}

	return todos
}

// hashItems produces a deterministic hash of the todo items for change detection.
func (ts *todoState) hashItems(items []sessionDBItem) string {
	h := sha256.New()
	for _, item := range items {
		h.Write([]byte(item.ID))
		h.Write([]byte{0})
		h.Write([]byte(item.Title))
		h.Write([]byte{0})
		h.Write([]byte(item.Description))
		h.Write([]byte{0})
		h.Write([]byte(item.Status))
		h.Write([]byte{0})
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}
