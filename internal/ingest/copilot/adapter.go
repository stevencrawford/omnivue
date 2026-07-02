package copilot

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

	_ "modernc.org/sqlite"
)

func init() {
	ingest.Register(ingest.AgentCopilot, "GitHub Copilot", "~/.copilot",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

// detectPath checks whether the given path contains Copilot session data.
func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := filepath.Join(path, "session-store.db")
	statePath := filepath.Join(path, "session-state")
	if !ingestkit.PathExists(dbPath) && !ingestkit.PathExists(statePath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentCopilot,
		Label:     "GitHub Copilot",
	}
}

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
		s.CreatedAt = ingestkit.ParseTime(createdAt)
		s.UpdatedAt = ingestkit.ParseTime(updatedAt)

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
	s.CreatedAt = ingestkit.ParseTime(createdAt)
	s.UpdatedAt = ingestkit.ParseTime(updatedAt)

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
			ts := ingestkit.ParseTime(event.Timestamp)

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

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTS int64

	// Check SQLite sessions table
	var maxTime sql.NullString
	if err := a.db.QueryRowContext(ctx, `SELECT MAX(updated_at) FROM sessions`).Scan(&maxTime); err == nil && maxTime.Valid {
		maxTS = ingestkit.ParseTime(maxTime.String).UnixMilli()
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

		ts := ingestkit.ParseTime(timestamp)

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
