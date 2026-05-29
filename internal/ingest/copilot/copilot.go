package copilot

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"

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
		s.CreatedAt = parseTime(createdAt)
		s.UpdatedAt = parseTime(updatedAt)

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

		sessions = append(sessions, s)
	}

	return sessions, rows.Err()
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
	s.CreatedAt = parseTime(createdAt)
	s.UpdatedAt = parseTime(updatedAt)

	if s.Title == "" {
		s.Title = filepath.Base(s.Directory)
	}

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

		ts := parseTime(timestamp)

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
					Timestamp: parseTime(event.Timestamp),
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
					Timestamp: parseTime(event.Timestamp),
				}

				// Extract tool calls from tool requests
				for _, req := range data.ToolRequests {
					inputJSON, _ := json.Marshal(req.Arguments)
					msg.ToolCalls = append(msg.ToolCalls, ingest.ToolCall{
						ID:     req.ToolCallID,
						Name:   req.Name,
						Input:  string(inputJSON),
						Status: "running",
					})
				}

				messages = append(messages, msg)
			}

		case "tool.execution_complete":
			var data toolCompleteData
			if json.Unmarshal(event.Data, &data) == nil {
				// Find and update the tool call in previous messages
				updateToolCallResult(&messages, data)
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

func (a *Adapter) GetPlan(ctx context.Context, sessionID string) ([]ingest.PlanItem, error) {
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

	var items []ingest.PlanItem

	// Add overview as a completed item
	if overview.Valid && overview.String != "" {
		items = append(items, ingest.PlanItem{
			Content:  overview.String,
			Status:   "completed",
			Priority: "medium",
		})
	}

	// Add next steps as pending items
	if nextSteps.Valid && nextSteps.String != "" {
		items = append(items, ingest.PlanItem{
			Content:  nextSteps.String,
			Status:   "pending",
			Priority: "medium",
		})
	}

	return items, nil
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

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && copilot session resume %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTime sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT MAX(updated_at) FROM sessions`).Scan(&maxTime)
	if err != nil || !maxTime.Valid {
		return 0, err
	}
	return parseTime(maxTime.String).UnixMilli(), nil
}

func (a *Adapter) Close() error {
	return a.db.Close()
}

// parseTime parses an ISO 8601 timestamp string.
func parseTime(s string) time.Time {
	// Try common formats
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
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
