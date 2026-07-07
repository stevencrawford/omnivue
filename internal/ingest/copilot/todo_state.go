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
	ID          string
	Title       string
	Description string
	Content     string
	Status      string
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
				Status:  "pending",
			}
			if desc != "" {
				ts.items[id].Description = desc
				ts.items[id].Content = title + ": " + desc
			} else {
				ts.items[id].Content = title
			}
		}

		vals = strings.TrimSpace(vals)
		vals = strings.TrimPrefix(vals, ",")
	}
}

// parseUpdate applies a single UPDATE to the todoState, extracting status changes,
// description updates, and target items from the WHERE clause.
func (ts *todoState) parseUpdate(query string) {
	uq := strings.ToUpper(query)

	// Extract SET values
	newStatus, hasStatus := extractSetStatus(uq)
	newDescription, hasDesc := extractSetDescription(query)

	if !hasStatus && !hasDesc {
		return
	}

	// Extract WHERE clause
	_, whereClause, ok := strings.Cut(uq, "WHERE")
	if !ok {
		return
	}

	// Build list of target IDs
	targets := extractUpdateTargets(whereClause, ts.items)
	if len(targets) > 0 {
		for _, t := range targets {
			if hasStatus {
				t.Status = newStatus
			}
			if hasDesc && newDescription != "" {
				t.Description = newDescription
				t.Content = t.Title + ": " + newDescription
			}
		}
		return
	}

	// Fallback: WHERE status = 'value' — update all items with matching status
	if strings.Contains(whereClause, "STATUS =") && hasStatus {
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

// extractSetStatus extracts the new status value from an uppercased SET clause.
// Returns the lowercased status and whether it was found.
func extractSetStatus(uq string) (string, bool) {
	prefix, prefixLen := "SET STATUS =", len("SET STATUS =")
	setIdx := strings.Index(uq, prefix)
	if setIdx < 0 {
		prefix = "SET STATUS="
		prefixLen = len(prefix)
		setIdx = strings.Index(uq, prefix)
	}
	if setIdx < 0 {
		return "", false
	}
	rest := uq[setIdx+prefixLen:]
	rest = strings.TrimSpace(rest)
	if !strings.HasPrefix(rest, "'") {
		return "", true
	}
	end := strings.IndexByte(rest[1:], '\'')
	if end < 0 {
		return "", true
	}
	return strings.ToLower(rest[1 : end+1]), true
}

// extractSetDescription searches for a SET description clause in the original
// (non-uppercased) query and returns the value with original casing preserved.
func extractSetDescription(query string) (string, bool) {
	uq := strings.ToUpper(query)

	prefix, prefixLen := "SET DESCRIPTION =", len("SET DESCRIPTION =")
	setIdx := strings.Index(uq, prefix)
	descLen := prefixLen
	if setIdx < 0 {
		prefix = "SET DESCRIPTION="
		prefixLen = len(prefix)
		setIdx = strings.Index(uq, prefix)
		descLen = prefixLen
	}
	if setIdx < 0 {
		return "", false
	}

	// Skip to the value start in the original query. Since the prefix
	// may differ in length between upper and original case (e.g. "DESCRIPTION="
	// vs "description="), find the character of the original query at the
	// same byte position as the value start in the uppercased query.
	valStart := setIdx + descLen
	origRest := query
	if valStart < len(origRest) {
		origRest = origRest[valStart:]
	}
	origRest = strings.TrimSpace(origRest)
	if !strings.HasPrefix(origRest, "'") {
		return "", true
	}
	end := strings.IndexByte(origRest[1:], '\'')
	if end < 0 {
		return "", true
	}
	return origRest[1 : end+1], true
}

// extractUpdateTargets extracts the list of todoItem pointers targeted by
// a WHERE clause. Supports "WHERE id = 'value'", "WHERE id='value'",
// and "WHERE id IN ('a','b')" patterns. Returns nil if no targets found.
func extractUpdateTargets(whereClause string, items map[string]*todoItem) []*todoItem {
	// WHERE id = 'value' (with space around =)
	if strings.Contains(whereClause, "ID =") {
		eqIdx := strings.Index(whereClause, "=")
		restID := strings.TrimSpace(whereClause[eqIdx+1:])
		if strings.HasPrefix(restID, "'") {
			if end := strings.IndexByte(restID[1:], '\''); end >= 0 {
				id := strings.ToLower(restID[1 : end+1])
				if t, ok := items[id]; ok {
					return []*todoItem{t}
				}
			}
		}
	}

	// WHERE id='value' (no space around =)
	if strings.Contains(whereClause, "ID=") {
		eqIdx := strings.Index(whereClause, "=")
		restID := strings.TrimSpace(whereClause[eqIdx+1:])
		if strings.HasPrefix(restID, "'") {
			if end := strings.IndexByte(restID[1:], '\''); end >= 0 {
				id := strings.ToLower(restID[1 : end+1])
				if t, ok := items[id]; ok {
					return []*todoItem{t}
				}
			}
		}
	}

	// WHERE id IN ('a', 'b')
	if strings.Contains(whereClause, "IN (") {
		_, restIn, ok := strings.Cut(whereClause, "IN (")
		if !ok {
			return nil
		}
		listPart, _, _ := strings.Cut(restIn, ")")
		parts := strings.FieldsFunc(listPart, func(r rune) bool {
			return r == ',' || r == ' ' || r == '\''
		})
		var result []*todoItem
		for _, id := range parts {
			id = strings.ToLower(strings.TrimSpace(id))
			if id != "" {
				if t, ok := items[id]; ok {
					result = append(result, t)
				}
			}
		}
		if len(result) > 0 {
			return result
		}
	}

	return nil
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
