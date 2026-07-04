package copilot

import (
	"encoding/json"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"path/filepath"
)

// todoItem tracks the in-memory state of a todo item parsed from SQL tool calls.
type todoItem struct {
	ID      string
	Title   string
	Status  string
	Content string
}

// todoState is a mutable accumulator for tracking todo state across sql tool calls.
type todoState struct {
	items map[string]*todoItem
}

func newTodoState() *todoState {
	return &todoState{items: make(map[string]*todoItem)}
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

// applySQL applies a single SQL statement to the todoState, extracting
// todo items from INSERT INTO and status changes from UPDATE.
func (ts *todoState) applySQL(query string) {
	q := strings.TrimSpace(query)

	switch {
	case strings.HasPrefix(strings.ToUpper(q), "INSERT INTO TODOS"):
		ts.parseInsert(q)
	case strings.HasPrefix(strings.ToUpper(q), "UPDATE TODOS"):
		ts.parseUpdate(q)
	case strings.HasPrefix(strings.ToUpper(q), "DELETE FROM TODOS"):
		clear(ts.items)
	}
}

// parseInsert parses "INSERT INTO todos (id, title, description) VALUES (...), (...)".
func (ts *todoState) parseInsert(query string) {
	valuesIdx := strings.Index(strings.ToUpper(query), "VALUES")
	if valuesIdx < 0 {
		return
	}
	valuesPart := query[valuesIdx+6:]

	parenOpen := strings.Index(query, "(")
	parenClose := strings.Index(query, ")")
	if parenOpen < 0 || parenClose < 0 || parenClose < parenOpen {
		return
	}
	colSpec := query[parenOpen+1 : parenClose]
	colNames := strings.FieldsFunc(colSpec, func(r rune) bool { return r == ',' || r == ' ' })
	idIdx, titleIdx, descIdx := -1, -1, -1
	for i, name := range colNames {
		name = strings.TrimSpace(strings.ToLower(name))
		switch name {
		case "id":
			idIdx = i
		case "title":
			titleIdx = i
		case "description":
			descIdx = i
		}
	}
	if idIdx < 0 || titleIdx < 0 {
		return
	}

	vals := valuesPart
	for {
		vals = strings.TrimSpace(vals)
		if vals == "" || vals[0] != '(' {
			break
		}
		vals = vals[1:]
		var parts []string
		for vals != "" {
			vals = strings.TrimSpace(vals)
			if vals[0] == ')' {
				vals = vals[1:]
				break
			}
			if vals[0] == ',' {
				vals = vals[1:]
				continue
			}
			if vals[0] == '\'' {
				vals = vals[1:]
				end := strings.IndexByte(vals, '\'')
				if end < 0 {
					parts = append(parts, vals)
					break
				}
				parts = append(parts, vals[:end])
				vals = vals[end+1:]
				continue
			}
			if end := strings.IndexAny(vals, ",)"); end >= 0 {
				parts = append(parts, strings.TrimSpace(vals[:end]))
				vals = vals[end:]
			} else {
				parts = append(parts, strings.TrimSpace(vals))
				break
			}
		}

		if idIdx < len(parts) && titleIdx < len(parts) {
			id := parts[idIdx]
			title := parts[titleIdx]
			desc := ""
			if descIdx >= 0 && descIdx < len(parts) {
				desc = parts[descIdx]
			}
			ts.items[id] = &todoItem{
				ID:      id,
				Title:   title,
				Content: title,
				Status:  "pending",
			}
			if desc != "" {
				ts.items[id].Content = title + ": " + desc
			}
		}

		vals = strings.TrimSpace(vals)
		vals = strings.TrimPrefix(vals, ",")
	}
}

// parseUpdate parses "UPDATE todos SET status = '<val>' WHERE id = '<id>' OR id IN (...)".
func (ts *todoState) parseUpdate(query string) {
	q := strings.ToUpper(query)

	setIdx := strings.Index(q, "SET STATUS =")
	if setIdx < 0 {
		setIdx = strings.Index(q, "SET STATUS=")
	}
	if setIdx < 0 {
		return
	}
	rest := q[setIdx+len("SET STATUS ="):]
	rest = strings.TrimSpace(rest)

	newStatus := "pending"
	if strings.HasPrefix(rest, "'") {
		if end := strings.IndexByte(rest[1:], '\''); end >= 0 {
			newStatus = strings.ToLower(rest[1 : end+1])
		}
	}

	_, whereClause, ok := strings.Cut(q, "WHERE")
	if !ok {
		return
	}

	if strings.Contains(whereClause, "ID =") {
		eqIdx := strings.Index(whereClause, "=")
		restID := strings.TrimSpace(whereClause[eqIdx+1:])
		if strings.HasPrefix(restID, "'") {
			if end := strings.IndexByte(restID[1:], '\''); end >= 0 {
				id := strings.ToLower(restID[1 : end+1])
				if t, ok := ts.items[id]; ok {
					t.Status = newStatus
				}
			}
		}
	}

	if strings.Contains(whereClause, "IN (") {
		_, restIn, ok := strings.Cut(whereClause, "IN (")
		if !ok {
			return
		}
		listPart, _, _ := strings.Cut(restIn, ")")
		items := strings.FieldsFunc(listPart, func(r rune) bool {
			return r == ',' || r == ' ' || r == '\''
		})
		for _, id := range items {
			id = strings.ToLower(strings.TrimSpace(id))
			if id != "" {
				if t, ok := ts.items[id]; ok {
					t.Status = newStatus
				}
			}
		}
	}

	if strings.Contains(whereClause, "STATUS =") {
		_, restStatus, _ := strings.Cut(whereClause, "STATUS =")
		restStatus = strings.TrimSpace(restStatus)
		if strings.HasPrefix(restStatus, "'") {
			if end := strings.IndexByte(restStatus[1:], '\''); end >= 0 {
				srcStatus := strings.ToLower(restStatus[1 : end+1])
				for _, t := range ts.items {
					if t.Status == srcStatus {
						t.Status = newStatus
					}
				}
			}
		}
	}
}

// synthesizeInput builds a todowrite-compatible input JSON from the current todoState.
func (ts *todoState) synthesizeInput() string {
	type todoEntry struct {
		ID       string `json:"id"`
		Content  string `json:"content"`
		Status   string `json:"status"`
		Priority string `json:"priority,omitempty"`
	}

	var entries []todoEntry
	for _, item := range ts.items {
		status := item.Status
		if status == "done" {
			status = "completed"
		}
		entries = append(entries, todoEntry{
			ID:      item.ID,
			Content: item.Content,
			Status:  status,
		})
	}

	out, err := json.Marshal(map[string]any{"todos": entries})
	if err != nil {
		return "{}"
	}
	return string(out)
}

// loadSessionTodos reads the todos table from a Copilot session's session.db.
// Returns nil if the db file is missing or has no todos table.
func (a *Adapter) loadSessionTodos(sessionID string) []ingest.Todo {
	dbPath := filepath.Join(a.basePath, "session-state", sessionID, "session.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil
	}
	defer db.Close()

	rows, err := db.Query(`SELECT id, title, COALESCE(description, ''), COALESCE(status, 'pending') FROM todos`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var todos []ingest.Todo
	todoIndex := make(map[string]*ingest.Todo)
	for rows.Next() {
		var t ingest.Todo
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &t.Status); err != nil {
			continue
		}
		todos = append(todos, t)
		todoIndex[t.ID] = &todos[len(todos)-1]
	}

	depRows, err := db.Query(`SELECT todo_id, depends_on FROM todo_deps`)
	if err == nil {
		defer depRows.Close()
		for depRows.Next() {
			var todoID, dependsOn string
			if depRows.Scan(&todoID, &dependsOn) == nil {
				if t, ok := todoIndex[todoID]; ok {
					t.DependsOn = append(t.DependsOn, dependsOn)
				}
			}
		}
	}

	if len(todos) == 0 {
		return nil
	}
	return todos
}
