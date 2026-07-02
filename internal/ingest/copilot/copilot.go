package copilot

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/internal/ingestutil"

	_ "modernc.org/sqlite"
)

// syntheticSession holds a virtual child session created from sub-agent delegation events.
type syntheticSession struct {
	session  ingest.Session
	messages []ingest.Message
}

// Adapter reads GitHub Copilot session data from its SQLite database and session-state files.
type Adapter struct {
	db                *sql.DB
	basePath          string
	syntheticSessions map[string]*syntheticSession
	mu                sync.Mutex
}

// New creates a new Copilot adapter for the given base path.
// The path should be the Copilot data directory (e.g., ~/.copilot).
func New(basePath string) (*Adapter, error) {
	dbPath := filepath.Join(basePath, "session-store.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("copilot adapter: %w", err)
	}
	return &Adapter{db: db, basePath: basePath, syntheticSessions: make(map[string]*syntheticSession)}, nil
}

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentCopilot
}

func (a *Adapter) Detect(path string) bool {
	dbPath := filepath.Join(path, "session-store.db")
	statePath := filepath.Join(path, "session-state")
	_, errDB := os.Stat(dbPath)
	_, errState := os.Stat(statePath)
	return errDB == nil || errState == nil
}

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, cwd, repository, branch, summary, created_at, updated_at
		FROM sessions
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	defer rows.Close()

	dbIDs := make(map[string]bool)
	var sessions []ingest.Session
	for rows.Next() {
		var (
			s          ingest.Session
			cwd        sql.NullString
			repository sql.NullString
			branch     sql.NullString
			summary    sql.NullString
			createdAt  string
			updatedAt  string
		)

		err := rows.Scan(&s.ID, &cwd, &repository, &branch, &summary, &createdAt, &updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}

		s.Agent = ingest.AgentCopilot
		s.Title = summary.String
		s.Directory = cwd.String
		s.Repository = repository.String
		s.Branch = branch.String
		s.Status = "completed"
		s.CreatedAt = ingestutil.ParseTime(createdAt)
		s.UpdatedAt = ingestutil.ParseTime(updatedAt)

		// events.jsonl often updates faster than the SQLite sessions.updated_at
		// column during an active conversation. Check the filesystem mtime as
		// a fallback so the server detects changes and triggers SSE re-fetch.
		eventsPath := filepath.Join(a.basePath, "session-state", s.ID, "events.jsonl")
		if info, err := os.Stat(eventsPath); err == nil && info.ModTime().After(s.UpdatedAt) {
			s.UpdatedAt = info.ModTime()
		}

		// Derive title from summary or directory if empty
		if s.Title == "" {
			s.Title = filepath.Base(s.Directory)
		}

		// Count files changed from session_files table
		var fileCount int
		if err := a.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM session_files WHERE session_id = ?`, s.ID,
		).Scan(&fileCount); err != nil {
			fileCount = 0
		}
		s.DiffFiles = fileCount

		// Enrich with metadata from events.jsonl (model, cost, tokens, diffs)
		if meta := a.scanEventsMetadata(s.ID); meta != nil {
			s.Model = meta.Model
			s.Cost = meta.Cost
			s.TokensInput = meta.TokensInput
			s.TokensOutput = meta.TokensOutput
			s.TokensReasoning = meta.TokensReasoning
			s.TokensCacheRead = meta.TokensCacheRead
			s.TokensCacheWrite = meta.TokensCacheWrite
			s.DiffAdditions = meta.DiffAdditions
			s.DiffDeletions = meta.DiffDeletions
			if meta.DiffFiles > 0 {
				s.DiffFiles = meta.DiffFiles
			}
		}

		// Count messages from events.jsonl when available (aligns with Messages)
		s.MessageCount = a.countMessagesFromEvents(s.ID)

		dbIDs[s.ID] = true
		sessions = append(sessions, s)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Scan session-state directory for sessions that exist as events.jsonl on disk
	// but aren't yet in the SQLite sessions table (e.g. brand-new Copilot sessions).
	stateDir := filepath.Join(a.basePath, "session-state")
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		// Include synthetic sessions even if the state directory is missing
		sessions = a.appendSyntheticSessions(sessions)
		return sessions, nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		id := entry.Name()
		if dbIDs[id] {
			continue
		}
		eventsPath := filepath.Join(stateDir, id, "events.jsonl")
		info, err := os.Stat(eventsPath)
		if err != nil {
			continue
		}
		msgCount := a.countMessagesFromEvents(id)
		title := id
		if len(id) > 8 {
			title = id[:8] + "..."
		}
		s := ingest.Session{
			ID:           id,
			Agent:        ingest.AgentCopilot,
			Title:        title,
			Status:       "active",
			CreatedAt:    info.ModTime(),
			UpdatedAt:    info.ModTime(),
			MessageCount: msgCount,
		}
		if meta := a.scanEventsMetadata(id); meta != nil {
			s.Model = meta.Model
			s.Cost = meta.Cost
			s.TokensInput = meta.TokensInput
			s.TokensOutput = meta.TokensOutput
			s.TokensReasoning = meta.TokensReasoning
			s.TokensCacheRead = meta.TokensCacheRead
			s.TokensCacheWrite = meta.TokensCacheWrite
			s.DiffAdditions = meta.DiffAdditions
			s.DiffDeletions = meta.DiffDeletions
			if meta.DiffFiles > 0 {
				s.DiffFiles = meta.DiffFiles
			}
		}
		sessions = append(sessions, s)
	}

	// Include synthetic child sessions from sub-agent delegations
	sessions = a.appendSyntheticSessions(sessions)

	// Re-sort by UpdatedAt desc since appended filesystem sessions
	slices.SortFunc(sessions, func(a, b ingest.Session) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})

	return sessions, nil
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	// Check for synthetic child session first
	a.mu.Lock()
	if syn, ok := a.syntheticSessions[id]; ok {
		a.mu.Unlock()
		s := syn.session
		return &s, nil
	}
	a.mu.Unlock()

	var (
		s          ingest.Session
		cwd        sql.NullString
		repository sql.NullString
		branch     sql.NullString
		summary    sql.NullString
		createdAt  string
		updatedAt  string
	)

	err := a.db.QueryRowContext(ctx, `
		SELECT id, cwd, repository, branch, summary, created_at, updated_at
		FROM sessions WHERE id = ?
	`, id).Scan(&s.ID, &cwd, &repository, &branch, &summary, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("session not found: %s", id)
		}
		return nil, fmt.Errorf("querying session: %w", err)
	}

	s.Agent = ingest.AgentCopilot
	s.Title = summary.String
	s.Directory = cwd.String
	s.Repository = repository.String
	s.Branch = branch.String
	s.Status = "completed"
	s.CreatedAt = ingestutil.ParseTime(createdAt)
	s.UpdatedAt = ingestutil.ParseTime(updatedAt)

	if s.Title == "" {
		s.Title = filepath.Base(s.Directory)
	}

	// Count diff files (same as ListSessions)
	var fileCount int
	if err := a.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM session_files WHERE session_id = ?`, id,
	).Scan(&fileCount); err != nil {
		fileCount = 0
	}
	s.DiffFiles = fileCount

	// Enrich with metadata from events.jsonl
	if meta := a.scanEventsMetadata(id); meta != nil {
		s.Model = meta.Model
		s.Cost = meta.Cost
		s.TokensInput = meta.TokensInput
		s.TokensOutput = meta.TokensOutput
		s.TokensReasoning = meta.TokensReasoning
		s.TokensCacheRead = meta.TokensCacheRead
		s.TokensCacheWrite = meta.TokensCacheWrite
		s.DiffAdditions = meta.DiffAdditions
		s.DiffDeletions = meta.DiffDeletions
		if meta.DiffFiles > 0 {
			s.DiffFiles = meta.DiffFiles
		}
	}

	// Count messages (same as ListSessions)
	var msgCount int
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM turns
		WHERE session_id = ?
		AND (user_message IS NOT NULL AND user_message != ''
		     OR assistant_response IS NOT NULL AND assistant_response != '')
	`, id).Scan(&msgCount); err != nil {
		msgCount = 0
	}
	s.MessageCount = msgCount

	// Load TODOs from session.db
	if todos := a.loadSessionTodos(id); len(todos) > 0 {
		s.TODOs = todos
	}

	return &s, nil
}

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	// Check for synthetic child session first
	a.mu.Lock()
	if syn, ok := a.syntheticSessions[sessionID]; ok {
		a.mu.Unlock()
		return syn.messages, nil
	}
	a.mu.Unlock()

	// First try to load rich data from events.jsonl
	messages, err := a.messagesFromEvents(sessionID)
	if err == nil && len(messages) > 0 {
		return messages, nil
	}

	// Fall back to the turns table in the SQLite database
	return a.messagesFromTurns(ctx, sessionID)
}

// Edits extracts file edits from assistant.message tool requests in events.jsonl.
// It looks for "edit" tools (with path/old_str/new_str) and "create" tools (with path/file_text).
func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var edits []ingest.FileEdit
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		var event eventEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}

		if event.Type != "assistant.message" {
			continue
		}

		var data assistantMessageData
		if err := json.Unmarshal(event.Data, &data); err != nil {
			continue
		}

		for _, req := range data.ToolRequests {
			ts := ingestutil.ParseTime(event.Timestamp)

			if req.Name == "apply_patch" {
				var patchText string
				if err := json.Unmarshal(req.Arguments, &patchText); err != nil || patchText == "" {
					continue
				}
				filePath := extractCopilotPatchPath(patchText)
				if filePath == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:  filePath,
					ToolName:  "edit",
					Content:   patchText,
					Timestamp: ts,
				})
				continue
			}

			var args toolEditArgs
			if err := json.Unmarshal(req.Arguments, &args); err != nil {
				continue
			}

			switch req.Name {
			case "create":
				if args.Path == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:  args.Path,
					ToolName:  "write",
					Content:   args.FileText,
					Timestamp: ts,
				})
			case "edit":
				if args.Path == "" && args.OldStr == "" && args.NewStr == "" {
					continue
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:  args.Path,
					ToolName:  "edit",
					OldStr:    args.OldStr,
					NewStr:    args.NewStr,
					Timestamp: ts,
				})
			}
		}
	}

	return edits, scanner.Err()
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT file_path, tool_name
		FROM session_files
		WHERE session_id = ?
		ORDER BY first_seen_at ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying session files: %w", err)
	}
	defer rows.Close()

	var diffs []ingest.DiffFile
	for rows.Next() {
		var filePath, toolName sql.NullString
		if err := rows.Scan(&filePath, &toolName); err != nil {
			continue
		}

		status := "modified"
		if toolName.Valid {
			switch toolName.String {
			case "create":
				status = "added"
			case "delete":
				status = "deleted"
			}
		}

		diffs = append(diffs, ingest.DiffFile{
			Path:   filePath.String,
			Status: status,
		})
	}

	return diffs, rows.Err()
}

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	// Try to read plan.md from the session-state directory
	planPath := filepath.Join(a.basePath, "session-state", sessionID, "plan.md")
	data, err := os.ReadFile(planPath)
	if err == nil && len(data) > 0 {
		return &ingest.Plan{
			Markdown: string(data),
			Source:   "file",
		}, nil
	}

	// Fall back to the checkpoints table
	rows, err := a.db.QueryContext(ctx, `
		SELECT title, overview, next_steps
		FROM checkpoints
		WHERE session_id = ?
		ORDER BY checkpoint_number DESC
		LIMIT 1
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying checkpoints: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, nil
	}

	var title, overview, nextSteps sql.NullString
	if err := rows.Scan(&title, &overview, &nextSteps); err != nil {
		return nil, fmt.Errorf("scanning checkpoint: %w", err)
	}

	var md string
	if title.Valid && title.String != "" {
		md += "# " + title.String + "\n\n"
	}
	if overview.Valid && overview.String != "" {
		md += "## Overview\n\n" + overview.String + "\n\n"
	}
	if nextSteps.Valid && nextSteps.String != "" {
		md += "## Next Steps\n\n" + nextSteps.String + "\n"
	}

	if md == "" {
		return nil, nil
	}

	return &ingest.Plan{
		Markdown: md,
		Source:   "synthesized",
	}, nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && copilot --resume=%s", session.Directory, session.ID)
}

// todoItem tracks the in-memory state of a todo item parsed from SQL tool calls.
type todoItem struct {
	ID      string
	Title   string
	Status  string
	Content string
}

// todoState is a mutable accumulator for tracking todo state across sql tool calls.
type todoState struct {
	items map[string]*todoItem // keyed by todo ID
}

func newTodoState() *todoState {
	return &todoState{items: make(map[string]*todoItem)}
}

// isTodoQuery checks whether a SQL query targets the todos table.
func isTodoQuery(query string) bool {
	lower := strings.ToLower(strings.TrimSpace(query))
	// Match INSERT/UPDATE/DELETE/SELECT/FROM that reference "todos"
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
	// Find VALUES clause
	valuesIdx := strings.Index(strings.ToUpper(query), "VALUES")
	if valuesIdx < 0 {
		return
	}
	valuesPart := query[valuesIdx+6:]

	// Parse column names from the INSERT clause
	parenOpen := strings.Index(query, "(")
	parenClose := strings.Index(query, ")")
	if parenOpen < 0 || parenClose < 0 || parenClose < parenOpen {
		return
	}
	colSpec := query[parenOpen+1 : parenClose]
	colNames := strings.FieldsFunc(colSpec, func(r rune) bool { return r == ',' || r == ' ' })
	// Map column name to index
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

	// Parse each parenthesized value tuple
	vals := valuesPart
	for {
		vals = strings.TrimSpace(vals)
		if vals == "" || vals[0] != '(' {
			break
		}
		vals = vals[1:] // skip '('
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
			// Read a single-quoted string
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
			// Skip non-quoted tokens
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

		// Skip comma after tuple
		vals = strings.TrimSpace(vals)
		vals = strings.TrimPrefix(vals, ",")
	}
}

// parseUpdate parses "UPDATE todos SET status = '<val>' WHERE id = '<id>' OR id IN (...)".
func (ts *todoState) parseUpdate(query string) {
	q := strings.ToUpper(query)

	// Extract the new status
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

	// Extract the IDs from WHERE clause
	_, whereClause, ok := strings.Cut(q, "WHERE")
	if !ok {
		return
	}

	// Handle "WHERE id = 'xxx'"
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

	// Handle "WHERE id IN ('a', 'b', ...)"
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

	// Handle "WHERE status = 'in_progress'" — bulk update by status
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

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTS int64

	// Check SQLite sessions table
	var maxTime sql.NullString
	if err := a.db.QueryRowContext(ctx, `SELECT MAX(updated_at) FROM sessions`).Scan(&maxTime); err == nil && maxTime.Valid {
		maxTS = ingestutil.ParseTime(maxTime.String).UnixMilli()
	}

	// Check filesystem mtimes of events.jsonl files — Copilot may update JSONL
	// without touching the SQLite sessions table (e.g. ongoing conversation).
	stateDir := filepath.Join(a.basePath, "session-state")
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		if maxTS > 0 {
			return maxTS, nil
		}
		return 0, fmt.Errorf("reading session-state: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		eventsPath := filepath.Join(stateDir, entry.Name(), "events.jsonl")
		info, err := os.Stat(eventsPath)
		if err != nil {
			continue
		}
		if mtime := info.ModTime().UnixMilli(); mtime > maxTS {
			maxTS = mtime
		}
	}

	if maxTS == 0 {
		return 0, fmt.Errorf("no sessions found")
	}

	return maxTS, nil
}

func (a *Adapter) Close() error {
	a.mu.Lock()
	a.syntheticSessions = make(map[string]*syntheticSession)
	a.mu.Unlock()
	return a.db.Close()
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

	// Load dependency edges
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

// appendSyntheticSessions adds any synthetic child sessions to the list.
func (a *Adapter) appendSyntheticSessions(sessions []ingest.Session) []ingest.Session {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, syn := range a.syntheticSessions {
		sessions = append(sessions, syn.session)
	}
	return sessions
}

func (a *Adapter) messagesFromTurns(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT turn_index, user_message, assistant_response, timestamp
		FROM turns
		WHERE session_id = ?
		ORDER BY turn_index ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying turns: %w", err)
	}
	defer rows.Close()

	var messages []ingest.Message
	for rows.Next() {
		var (
			turnIndex int
			userMsg   sql.NullString
			assistMsg sql.NullString
			timestamp string
		)
		if err := rows.Scan(&turnIndex, &userMsg, &assistMsg, &timestamp); err != nil {
			return nil, fmt.Errorf("scanning turn: %w", err)
		}

		ts := ingestutil.ParseTime(timestamp)

		if userMsg.Valid && userMsg.String != "" {
			messages = append(messages, ingest.Message{
				ID:        fmt.Sprintf("%s-turn-%d-user", sessionID, turnIndex),
				Role:      "user",
				Content:   userMsg.String,
				Timestamp: ts,
			})
		}

		if assistMsg.Valid && assistMsg.String != "" {
			messages = append(messages, ingest.Message{
				ID:        fmt.Sprintf("%s-turn-%d-assistant", sessionID, turnIndex),
				Role:      "assistant",
				Content:   assistMsg.String,
				Timestamp: ts,
			})
		}
	}

	return messages, rows.Err()
}

func (a *Adapter) messagesFromEvents(sessionID string) ([]ingest.Message, error) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ingest.Message
	var currentModel string
	var subAgentStack []*subAgentState
	var pendingReasoning string
	var todoState = newTodoState()

	scanner := bufio.NewScanner(f)
	// Allow large lines (events can contain tool output)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		var event eventEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}

		switch event.Type {
		case "session.model_change":
			var data modelChangeData
			if json.Unmarshal(event.Data, &data) == nil {
				currentModel = data.NewModel
			}

		case "assistant.reasoning":
			var data assistantReasoningData
			if json.Unmarshal(event.Data, &data) == nil && data.Content != "" {
				pendingReasoning = data.Content
			}

		case "user.message":
			var data userMessageData
			if json.Unmarshal(event.Data, &data) == nil {
				msg := ingest.Message{
					ID:        event.ID,
					Role:      "user",
					Content:   data.Content,
					Timestamp: ingestutil.ParseTime(event.Timestamp),
				}
				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, msg)
				} else {
					messages = append(messages, msg)
				}
			}

		case "assistant.message":
			var data assistantMessageData
			if json.Unmarshal(event.Data, &data) == nil {
				// Thinking-phase messages: the content IS the thinking text.
				// Don't create a separate message — feed into pendingReasoning
				// so the next response-phase message carries the reasoning.
				if data.Phase == "thinking" && data.Content != "" {
					if pendingReasoning == "" {
						pendingReasoning = data.Content
					}
					break
				}

				msg := ingest.Message{
					ID:        data.MessageID,
					Role:      "assistant",
					Content:   data.Content,
					Model:     currentModel,
					Timestamp: ingestutil.ParseTime(event.Timestamp),
				}

				// Populate reasoning from the richest available source:
				//   1. explicit reasoningText on the event
				//   2. content from a preceding assistant.reasoning event or
				//      thinking-phase assistant.message
				switch {
				case data.ReasoningText != "":
					msg.Reasoning = data.ReasoningText
				case pendingReasoning != "":
					msg.Reasoning = pendingReasoning
				}
				pendingReasoning = ""

				// Extract tool calls from tool requests
				for _, req := range data.ToolRequests {
					inputJSON, err := json.Marshal(req.Arguments)
				if err != nil {
					slog.Warn("failed to marshal arguments", "error", err)
					inputJSON = []byte("{}")
				}
					tc := ingest.ToolCall{
						ID:     req.ToolCallID,
						Name:   req.Name,
						Input:  string(inputJSON),
						Status: "running",
					}
					// Normalize ask_user to standard question kind
					if tc.Name == "ask_user" {
						tc.Name = "question"
						tc.Input = normalizeAskUserInput(tc.Input)
					}
					// Normalize Copilot JIRA tool call to standard kind
					if tc.Name == "atlassian-getJiraIssue" || tc.Name == "atlassian_getJiraIssue" {
						tc.Name = "jira"
					}
				// Normalize apply_patch to edit, transforming input to structured format
				if tc.Name == "apply_patch" {
					tc.Name = "edit"
					var patchText string
					if err := json.Unmarshal(req.Arguments, &patchText); err == nil && patchText != "" {
						filePath := extractCopilotPatchPath(patchText)
						if filePath != "" {
						newInput, err := json.Marshal(map[string]string{
							"filePath": filePath,
							"content":  patchText,
						})
						if err != nil {
							slog.Warn("failed to marshal patch input", "error", err)
							newInput = []byte("{}")
						}
							tc.Input = string(newInput)
						}
					}
				}
				// Normalize sql to todowrite when query targets the todos table
				if tc.Name == "sql" {
					var args struct {
						Query string `json:"query"`
					}
					if json.Unmarshal(req.Arguments, &args) == nil && args.Query != "" {
						if isTodoQuery(args.Query) {
							tc.Name = "todowrite"
							for stmt := range strings.SplitSeq(args.Query, ";") {
								stmt = strings.TrimSpace(stmt)
								if stmt != "" {
									todoState.applySQL(stmt)
								}
							}
							tc.Input = todoState.synthesizeInput()
						}
					}
				}
				msg.ToolCalls = append(msg.ToolCalls, tc)
				}

				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, msg)
				} else {
					messages = append(messages, msg)
				}
			}

		case "tool.execution_complete":
			var data toolCompleteData
			if json.Unmarshal(event.Data, &data) == nil {
				if len(subAgentStack) > 0 {
					updateToolCallResult(&subAgentStack[len(subAgentStack)-1].messages, data)
				} else {
					updateToolCallResult(&messages, data)
				}
			}

		case "subagent.started":
			var data subAgentStartedData
			if json.Unmarshal(event.Data, &data) == nil && data.ToolCallID != "" {
				sa := &subAgentState{
					toolCallID:   data.ToolCallID,
					agentName:    data.AgentName,
					agentDisplay: data.AgentDisplayName,
					parentMsgIdx: -1,
					parentToolIdx: -1,
				}
				// Find the matching task tool call in the parent messages and mark it
				// as the delegation point for this sub-agent.
				for i := range slices.Backward(messages) {
					msg := &messages[i]
					for j := range msg.ToolCalls {
						if msg.ToolCalls[j].ID == data.ToolCallID {
							sa.parentMsgIdx = i
							sa.parentToolIdx = j
							break
						}
					}
					if sa.parentMsgIdx >= 0 {
						break
					}
				}
				subAgentStack = append(subAgentStack, sa)
			}

		case "subagent.completed":
			if len(subAgentStack) > 0 {
				sa := subAgentStack[len(subAgentStack)-1]
				subAgentStack = subAgentStack[:len(subAgentStack)-1]

				// Create synthetic child session from buffered messages
				synID := fmt.Sprintf("%s-sub-%s-%s", sessionID, sa.agentName, sa.toolCallID)
				if len(synID) > 100 {
					synID = synID[:100]
				}

				// Only create if there are actual messages
				if len(sa.messages) > 0 {
					// Use the first message's timestamp as created, last as updated
					createdAt := sa.messages[0].Timestamp
					updatedAt := sa.messages[len(sa.messages)-1].Timestamp

					syn := &syntheticSession{
						session: ingest.Session{
							ID:        synID,
							ParentID:  sessionID,
							Agent:     ingest.AgentCopilot,
							SubAgent:  sa.agentName,
							Title:     sa.agentDisplay,
							Status:    "completed",
							CreatedAt: createdAt,
							UpdatedAt: updatedAt,
						},
						messages: sa.messages,
					}

					a.mu.Lock()
					a.syntheticSessions[synID] = syn
					a.mu.Unlock()
				}

				// Update the parent's task tool call metadata to link to the synthetic session
				if sa.parentMsgIdx >= 0 && sa.parentToolIdx >= 0 && sa.parentMsgIdx < len(messages) {
					parentMsg := &messages[sa.parentMsgIdx]
					if sa.parentToolIdx < len(parentMsg.ToolCalls) {
						tc := &parentMsg.ToolCalls[sa.parentToolIdx]
						meta := make(map[string]string)
						if tc.Metadata != "" {
						if err := json.Unmarshal([]byte(tc.Metadata), &meta); err != nil {
							slog.Warn("failed to unmarshal metadata", "error", err)
						}
					}
					meta["sessionId"] = synID
					metaBytes, err := json.Marshal(meta)
					if err != nil {
						slog.Warn("failed to marshal metadata", "error", err)
							metaBytes = []byte("{}")
						}
						tc.Metadata = string(metaBytes)
					}
				}
			}

		case "system_reminder":
			var data systemReminderData
			if json.Unmarshal(event.Data, &data) == nil {
				fileName := "AGENTS.md"
				if data.File != "" {
					fileName = data.File
				}
				msg := ingest.Message{
					ID:        event.ID,
					Role:      "system",
					Content:   data.Content,
					Timestamp: ingestutil.ParseTime(event.Timestamp),
					Metadata: map[string]string{
						"type": "system_reminder",
						"file": fileName,
					},
				}
				if len(subAgentStack) > 0 {
					subAgentStack[len(subAgentStack)-1].messages = append(subAgentStack[len(subAgentStack)-1].messages, msg)
				} else {
					messages = append(messages, msg)
				}
			}
		}
	}

	return messages, scanner.Err()
}

// countMessagesFromEvents counts user.message and assistant.message events
// in a session's events.jsonl file. Returns 0 if the file doesn't exist.
func (a *Adapter) countMessagesFromEvents(sessionID string) int {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return 0
	}
	defer f.Close()

	var count int
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) < 20 {
			continue
		}
		// Fast check: look for "user.message" or "assistant.message"
		if contains(line, `"user.message"`) || contains(line, `"assistant.message"`) {
			count++
		}
	}
	return count
}

// scanEventsMetadata reads a session's events.jsonl and extracts model, cost, token, and diff
// information from session.model_change and session.shutdown events.
func (a *Adapter) scanEventsMetadata(sessionID string) *eventsMetadata {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	meta := &eventsMetadata{}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		var env struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
			continue
		}

		switch env.Type {
		case "session.model_change":
			var data struct {
				NewModel string `json:"newModel"`
			}
			if json.Unmarshal(env.Data, &data) == nil && data.NewModel != "" {
				meta.Model = data.NewModel
			}

		case "session.shutdown":
			var data struct {
				CurrentModel string `json:"currentModel"`
				CodeChanges  *struct {
					LinesAdded    int      `json:"linesAdded"`
					LinesRemoved  int      `json:"linesRemoved"`
					FilesModified []string `json:"filesModified"`
				} `json:"codeChanges"`
				ModelMetrics map[string]*struct {
					Requests *struct {
						Cost float64 `json:"cost"`
					} `json:"requests"`
					Usage *struct {
						InputTokens     int `json:"inputTokens"`
						OutputTokens    int `json:"outputTokens"`
						ReasoningTokens int `json:"reasoningTokens"`
						CacheReadTokens int `json:"cacheReadTokens"`
						CacheWriteTokens int `json:"cacheWriteTokens"`
					} `json:"usage"`
				} `json:"modelMetrics"`
			}
			if json.Unmarshal(env.Data, &data) != nil {
				continue
			}
			if data.CurrentModel != "" {
				meta.Model = data.CurrentModel
			}
			if data.CodeChanges != nil {
				meta.DiffAdditions = data.CodeChanges.LinesAdded
				meta.DiffDeletions = data.CodeChanges.LinesRemoved
				if n := len(data.CodeChanges.FilesModified); n > 0 {
					meta.DiffFiles = n
				}
			}
			if data.ModelMetrics != nil {
				for _, m := range data.ModelMetrics {
					if m.Requests != nil {
						meta.Cost += m.Requests.Cost
					}
					if m.Usage != nil {
						meta.TokensInput += m.Usage.InputTokens
						meta.TokensOutput += m.Usage.OutputTokens
						meta.TokensReasoning += m.Usage.ReasoningTokens
						meta.TokensCacheRead += m.Usage.CacheReadTokens
						meta.TokensCacheWrite += m.Usage.CacheWriteTokens
					}
				}
			}
		}
	}

	return meta
}

// subAgentState tracks the buffering of sub-agent events between subagent.started and subagent.completed.
type subAgentState struct {
	toolCallID    string
	agentName     string
	agentDisplay  string
	parentMsgIdx  int
	parentToolIdx int
	messages      []ingest.Message
}

// updateToolCallResult finds the tool call by ID and updates its output/status.
func updateToolCallResult(messages *[]ingest.Message, data toolCompleteData) {
	for i := range slices.Backward(*messages) {
		msg := &(*messages)[i]
		for j := range msg.ToolCalls {
			if msg.ToolCalls[j].ID == data.ToolCallID {
				if data.Success {
					msg.ToolCalls[j].Status = "completed"
				} else {
					msg.ToolCalls[j].Status = "failed"
				}
				if data.Result.Content != "" {
					msg.ToolCalls[j].Output = data.Result.Content
				} else if data.Result.DetailedContent != "" {
					msg.ToolCalls[j].Output = data.Result.DetailedContent
				}
				if data.Model != "" {
					msg.Model = data.Model
				}
				return
			}
		}
	}
}

// extractCopilotPatchPath extracts the file path from apply_patch text.
// Format: "*** Begin Patch\n*** Update File: <path>\n...\n*** End Patch".
func extractCopilotPatchPath(patch string) string {
	for _, prefix := range []string{"*** Update File: ", "*** Add File: ", "*** Modify File: "} {
		if _, after, found := strings.Cut(patch, prefix); found {
			rest := after
			if nl := strings.IndexAny(rest, "\n\r"); nl >= 0 {
				return strings.TrimSpace(rest[:nl])
			}
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

// toolEditArgs mirrors the actual arguments in Copilot file edit/create tool requests.
type toolEditArgs struct {
	Path     string `json:"path"`
	OldStr   string `json:"old_str"`
	NewStr   string `json:"new_str"`
	FileText string `json:"file_text"`
}

// contains reports whether sub is a substring of b.
func contains(b []byte, sub string) bool {
	return len(b) >= len(sub) && searchBytes(b, sub) >= 0
}

// searchBytes finds the first occurrence of sub in b, or -1.
func searchBytes(b []byte, sub string) int {
	for i := 0; i <= len(b)-len(sub); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if b[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// normalizeAskUserInput transforms Copilot's ask_user input format
// {question, choices, allow_freeform} to the standard QuestionToolDiff format
// {questions: [{question, header, options: [{label}]}]}.
func normalizeAskUserInput(input string) string {
	var raw struct {
		Question      string   `json:"question"`
		Choices       []string `json:"choices"`
		AllowFreeform bool     `json:"allow_freeform"`
	}
	if err := json.Unmarshal([]byte(input), &raw); err != nil || raw.Question == "" {
		return input
	}
	options := make([]map[string]string, len(raw.Choices))
	for i, c := range raw.Choices {
		options[i] = map[string]string{"label": c}
	}
	transformed := map[string]any{
		"questions": []map[string]any{
			{
				"question": raw.Question,
				"header":   "Question for you",
				"options":  options,
			},
		},
	}
	out, err := json.Marshal(transformed)
	if err != nil {
		slog.Warn("failed to marshal ask_user input", "error", err)
		return "{}"
	}
	return string(out)
}

// eventsMetadata holds summary info extracted from events.jsonl.
type eventsMetadata struct {
	Model            string
	Cost             float64
	TokensInput      int
	TokensOutput     int
	TokensReasoning  int
	TokensCacheRead  int
	TokensCacheWrite int
	DiffAdditions    int
	DiffDeletions    int
	DiffFiles        int
}

// Event types for parsing events.jsonl.

type eventEnvelope struct {
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	ID        string          `json:"id"`
	Timestamp string          `json:"timestamp"`
	ParentID  *string         `json:"parentId"`
	AgentID   string          `json:"agentId,omitempty"`
}

type modelChangeData struct {
	NewModel string `json:"newModel"`
}

type subAgentStartedData struct {
	ToolCallID       string `json:"toolCallId"`
	AgentName        string `json:"agentName"`
	AgentDisplayName string `json:"agentDisplayName"`
}

type userMessageData struct {
	Content            string `json:"content"`
	TransformedContent string `json:"transformedContent"`
}

type assistantMessageData struct {
	MessageID        string        `json:"messageId"`
	Content          string        `json:"content"`
	ToolRequests     []toolRequest `json:"toolRequests"`
	ReasoningText    string        `json:"reasoningText"`
	ReasoningOpaque  string        `json:"reasoningOpaque"`
	EncryptedContent string        `json:"encryptedContent"`
	Phase            string        `json:"phase"`
}

type assistantReasoningData struct {
	ReasoningID string `json:"reasoningId"`
	Content     string `json:"content"`
}

type toolRequest struct {
	ToolCallID string          `json:"toolCallId"`
	Name       string          `json:"name"`
	Arguments  json.RawMessage `json:"arguments"`
	Type       string          `json:"type"`
}

type toolCompleteData struct {
	ToolCallID string `json:"toolCallId"`
	Model      string `json:"model"`
	Success    bool   `json:"success"`
	Result     struct {
		Content         string `json:"content"`
		DetailedContent string `json:"detailedContent"`
	} `json:"result"`
}

type systemReminderData struct {
	Content string `json:"content"`
	File    string `json:"file"`
}
