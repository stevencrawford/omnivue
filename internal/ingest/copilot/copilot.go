package copilot

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/ingest/internal/util"

	_ "modernc.org/sqlite"
)

// Adapter reads GitHub Copilot session data from its SQLite database and session-state files.
type Adapter struct {
	db       *sql.DB
	basePath string
}

// New creates a new Copilot adapter for the given base path.
// The path should be the Copilot data directory (e.g., ~/.copilot).
func New(basePath string) (*Adapter, error) {
	dbPath := filepath.Join(basePath, "session-store.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("copilot adapter: %w", err)
	}
	return &Adapter{db: db, basePath: basePath}, nil
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
		s.CreatedAt = util.ParseTime(createdAt)
		s.UpdatedAt = util.ParseTime(updatedAt)

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
		_ = a.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM session_files WHERE session_id = ?`, s.ID,
		).Scan(&fileCount)
		s.DiffFiles = fileCount

		// Count messages from events.jsonl when available (aligns with GetMessages)
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
		sessions = append(sessions, ingest.Session{
			ID:           id,
			Agent:        ingest.AgentCopilot,
			Title:        title,
			Status:       "active",
			CreatedAt:    info.ModTime(),
			UpdatedAt:    info.ModTime(),
			MessageCount: msgCount,
		})
	}

	// Re-sort by UpdatedAt desc since appended filesystem sessions
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	return sessions, nil
}

func (a *Adapter) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
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
	s.CreatedAt = util.ParseTime(createdAt)
	s.UpdatedAt = util.ParseTime(updatedAt)

	if s.Title == "" {
		s.Title = filepath.Base(s.Directory)
	}

	// Count diff files (same as ListSessions)
	var fileCount int
	_ = a.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM session_files WHERE session_id = ?`, id,
	).Scan(&fileCount)
	s.DiffFiles = fileCount

	// Count messages (same as ListSessions)
	var msgCount int
	_ = a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM turns
		WHERE session_id = ?
		AND (user_message IS NOT NULL AND user_message != ''
		     OR assistant_response IS NOT NULL AND assistant_response != '')
	`, id).Scan(&msgCount)
	s.MessageCount = msgCount

	return &s, nil
}

func (a *Adapter) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	// First try to load rich data from events.jsonl
	messages, err := a.getMessagesFromEvents(sessionID)
	if err == nil && len(messages) > 0 {
		return messages, nil
	}

	// Fall back to the turns table in the SQLite database
	return a.getMessagesFromTurns(ctx, sessionID)
}

func (a *Adapter) getMessagesFromTurns(ctx context.Context, sessionID string) ([]ingest.Message, error) {
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

		ts := util.ParseTime(timestamp)

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

func (a *Adapter) getMessagesFromEvents(sessionID string) ([]ingest.Message, error) {
	eventsPath := filepath.Join(a.basePath, "session-state", sessionID, "events.jsonl")
	f, err := os.Open(eventsPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ingest.Message
	var currentModel string

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

		case "user.message":
			var data userMessageData
			if json.Unmarshal(event.Data, &data) == nil {
				messages = append(messages, ingest.Message{
					ID:        event.ID,
					Role:      "user",
					Content:   data.Content,
					Timestamp: util.ParseTime(event.Timestamp),
				})
			}

		case "assistant.message":
			var data assistantMessageData
			if json.Unmarshal(event.Data, &data) == nil {
				msg := ingest.Message{
					ID:        data.MessageID,
					Role:      "assistant",
					Content:   data.Content,
					Model:     currentModel,
					Timestamp: util.ParseTime(event.Timestamp),
				}

				// Extract tool calls from tool requests
				for _, req := range data.ToolRequests {
					inputJSON, _ := json.Marshal(req.Arguments)
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
					msg.ToolCalls = append(msg.ToolCalls, tc)
				}

				messages = append(messages, msg)
			}

		case "tool.execution_complete":
			var data toolCompleteData
			if json.Unmarshal(event.Data, &data) == nil {
				// Find and update the tool call in previous messages
				updateToolCallResult(&messages, data)
			}

		case "system_reminder":
			var data systemReminderData
			if json.Unmarshal(event.Data, &data) == nil {
				fileName := "AGENTS.md"
				if data.File != "" {
					fileName = data.File
				}
				messages = append(messages, ingest.Message{
					ID:        event.ID,
					Role:      "system",
					Content:   data.Content,
					Timestamp: util.ParseTime(event.Timestamp),
					Metadata: map[string]string{
						"type": "system_reminder",
						"file": fileName,
					},
				})
			}
		}
	}

	return messages, scanner.Err()
}

// updateToolCallResult finds the tool call by ID and updates its output/status.
func updateToolCallResult(messages *[]ingest.Message, data toolCompleteData) {
	for i := len(*messages) - 1; i >= 0; i-- {
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

// toolEditArgs mirrors the actual arguments in Copilot file edit/create tool requests.
type toolEditArgs struct {
	Path    string `json:"path"`
	OldStr  string `json:"old_str"`
	NewStr  string `json:"new_str"`
	FileText string `json:"file_text"`
}

// GetEdits extracts file edits from assistant.message tool requests in events.jsonl.
// It looks for "edit" tools (with path/old_str/new_str) and "create" tools (with path/file_text).
func (a *Adapter) GetEdits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
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
			var args toolEditArgs
			if err := json.Unmarshal(req.Arguments, &args); err != nil {
				continue
			}

			ts := util.ParseTime(event.Timestamp)

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

func (a *Adapter) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
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

func (a *Adapter) GetPlan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
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
		maxTS = util.ParseTime(maxTime.String).UnixMilli()
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
	return a.db.Close()
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
	out, _ := json.Marshal(transformed)
	return string(out)
}

// Event types for parsing events.jsonl

type eventEnvelope struct {
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	ID        string          `json:"id"`
	Timestamp string          `json:"timestamp"`
	ParentID  *string         `json:"parentId"`
}

type modelChangeData struct {
	NewModel string `json:"newModel"`
}

type userMessageData struct {
	Content            string `json:"content"`
	TransformedContent string `json:"transformedContent"`
}

type assistantMessageData struct {
	MessageID    string        `json:"messageId"`
	Content      string        `json:"content"`
	ToolRequests []toolRequest `json:"toolRequests"`
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
