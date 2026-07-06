package copilot

import (
	"encoding/json"
	"log/slog"
	"regexp"
	"sort"
	"strings"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// todoItem tracks the in-memory state of a todo item parsed from SQL tool calls.
type todoItem struct {
	ID      string
	Title   string
	Content string
	Status  string
}

// todoState is a mutable accumulator that builds todo state by parsing SQL
// tool calls in order. No external database required — it extracts task names
// directly from INSERT VALUES and tracks status changes from UPDATE.
type todoState struct {
	items map[string]*todoItem
}

func newTodoState() *todoState {
	return &todoState{items: make(map[string]*todoItem)}
}

// todoTableRe matches SQL statements referencing the todos table.
var todoTableRe = regexp.MustCompile(
	`(?i)(?:from|into|update|delete\s+(?:from\s+)?|table|alter\s+table|drop\s+table)\s+` +
		`(?:["'` + "`" + `]?(?:\w+\.)?["'` + "`" + `]?)todo(?:s|es)?\b`,
)

// applySQL applies a single SQL statement to the todoState, extracting
// todo items from INSERT INTO and status changes from UPDATE.
func (ts *todoState) applySQL(query string) {
	q := strings.TrimSpace(query)
	norm := strings.ToUpper(q)
	for _, quote := range []string{`"`, `'`, "`"} {
		norm = strings.ReplaceAll(norm, quote+"TODOS"+quote, "TODOS")
	}

	switch {
	case strings.HasPrefix(norm, "INSERT INTO TODOS"):
		ts.parseInsert(q)
	case strings.HasPrefix(norm, "UPDATE TODOS"):
		ts.parseUpdate(q)
	case strings.HasPrefix(norm, "DELETE FROM TODOS"):
		clear(ts.items)
	}
}

// parseInsert parses "INSERT INTO todos (id, title, description) VALUES (...), (...)".
func (ts *todoState) parseInsert(query string) {
	valuesIdx := strings.Index(strings.ToUpper(query), "VALUES")
	if valuesIdx < 0 {
		return
	}

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

	vals := query[valuesIdx+6:]
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

	entries := make([]todoEntry, 0, len(ts.items))
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
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ID < entries[j].ID
	})

	out, err := json.Marshal(map[string]any{"todos": entries})
	if err != nil {
		return "{}"
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
