package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"

	_ "modernc.org/sqlite"
)

// Adapter reads OpenCode session data from its SQLite database.
type Adapter struct {
	db       *sql.DB
	basePath string
}

// New creates a new OpenCode adapter for the given base path.
// The path should be the OpenCode data directory (e.g., ~/.local/share/opencode).
func New(basePath string) (*Adapter, error) {
	dbPath := filepath.Join(basePath, "opencode.db")
	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opencode adapter: %w", err)
	}
	return &Adapter{db: db, basePath: basePath}, nil
}

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentOpenCode
}

func (a *Adapter) Detect(path string) bool {
	return ingest.AutoDiscover() != nil // simplified; real detection in detect.go
}

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT 
			s.id, s.parent_id, s.title, s.directory, s.model, s.agent,
			s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
			s.tokens_cache_read, s.tokens_cache_write,
			s.summary_files, s.summary_additions, s.summary_deletions,
			s.time_created, s.time_updated,
			COALESCE(p.name, '')
		FROM session s
		LEFT JOIN project p ON s.project_id = p.id
		ORDER BY s.time_updated DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	defer rows.Close()

	var sessions []ingest.Session
	for rows.Next() {
		var (
			s            ingest.Session
			parentID     sql.NullString
			modelJSON    sql.NullString
			agentCol     sql.NullString
			summFiles    sql.NullInt64
			summAdd      sql.NullInt64
			summDel      sql.NullInt64
			timeCreated  int64
			timeUpdated  int64
			projectName  string
		)

		err := rows.Scan(
			&s.ID, &parentID, &s.Title, &s.Directory, &modelJSON, &agentCol,
			&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
			&s.TokensCacheRead, &s.TokensCacheWrite,
			&summFiles, &summAdd, &summDel,
			&timeCreated, &timeUpdated,
			&projectName,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}

		s.Agent = ingest.AgentOpenCode
		s.Model = extractModelID(modelJSON.String)
		s.Repository = deriveRepository(s.Directory, projectName)
		s.Branch = "" // OpenCode doesn't store branch in session table
		s.CreatedAt = time.UnixMilli(timeCreated)
		s.UpdatedAt = time.UnixMilli(timeUpdated)
		s.Status = "completed"

		if parentID.Valid {
			s.ParentID = parentID.String
		}

		if agentCol.Valid && agentCol.String != "" {
			s.SubAgent = agentCol.String
		} else {
			s.SubAgent = extractSubAgentFromTitle(s.Title)
		}

		// Infer status: if parent_id and agent_col are both set, it's definitely completed
		if agentCol.Valid {
			s.Status = "completed"
		}

		if summFiles.Valid {
			s.DiffFiles = int(summFiles.Int64)
		}
		if summAdd.Valid {
			s.DiffAdditions = int(summAdd.Int64)
		}
		if summDel.Valid {
			s.DiffDeletions = int(summDel.Int64)
		}

		sessions = append(sessions, s)
	}

	return sessions, rows.Err()
}

func (a *Adapter) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
	sessions, err := a.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	for i := range sessions {
		if sessions[i].ID == id {
			return &sessions[i], nil
		}
	}
	return nil, fmt.Errorf("session not found: %s", id)
}

func (a *Adapter) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	// Query messages ordered by time
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, data, time_created
		FROM message
		WHERE session_id = ?
		ORDER BY time_created ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying messages: %w", err)
	}
	defer rows.Close()

	var messages []ingest.Message
	for rows.Next() {
		var (
			id          string
			dataJSON    string
			timeCreated int64
		)
		if err := rows.Scan(&id, &dataJSON, &timeCreated); err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}

		msg := ingest.Message{
			ID:        id,
			Timestamp: time.UnixMilli(timeCreated),
		}

		// Parse the JSON data blob
		var data messageData
		if err := json.Unmarshal([]byte(dataJSON), &data); err == nil {
			msg.Role = data.Role
			msg.Model = extractModelID(marshalJSON(data.Model))
			msg.Agent = data.Agent
		}

		// Get parts for this message
		parts, err := a.getMessageParts(ctx, id)
		if err == nil {
			for _, p := range parts {
				switch p.Type {
				case "text":
					if msg.Content == "" {
						msg.Content = p.Text
					} else {
						msg.Content += "\n" + p.Text
					}
				case "tool":
					tc := ingest.ToolCall{
						ID:     p.CallID,
						Name:   p.Tool,
						Input:  marshalJSON(p.State.Input),
						Output: p.State.Output,
						Status: p.State.Status,
					}
					if p.State.Metadata != nil {
						tc.Metadata = marshalJSON(p.State.Metadata)
					}
					if p.State.Time != nil {
						tc.Duration = p.State.Time.End - p.State.Time.Start
					}
					msg.ToolCalls = append(msg.ToolCalls, tc)
				}
			}
		}

		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

func (a *Adapter) getMessageParts(ctx context.Context, messageID string) ([]partData, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT data FROM part
		WHERE message_id = ?
		ORDER BY time_created ASC, id ASC
	`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []partData
	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err == nil {
			parts = append(parts, p)
		}
	}
	return parts, rows.Err()
}

func (a *Adapter) GetPlan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	// Check if this is a child session (has a parent) and read agent mode
	var parentID sql.NullString
	var agentCol sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT parent_id, agent FROM session WHERE id = ?`, sessionID).Scan(&parentID, &agentCol)
	if err != nil || !parentID.Valid {
		if agentCol.Valid && agentCol.String == "plan" {
			return a.planFromLastMessage(ctx, sessionID)
		}
		return a.planFromMessages(ctx, sessionID)
	}

	// Child session: find the task output in the parent session
	output, err := a.findTaskOutput(ctx, parentID.String, sessionID)
	if err != nil {
		return nil, err
	}
	if output != "" {
		source := "task-output"
		cleaned := stripTaskWrapper(output)
		md := "# Sub-agent Response\n\n" + cleaned
		return &ingest.Plan{Markdown: md, Source: source}, nil
	}

	if agentCol.Valid && agentCol.String == "plan" {
		return a.planFromLastMessage(ctx, sessionID)
	}

	return a.planFromMessages(ctx, sessionID)
}

func (a *Adapter) planFromLastMessage(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	// Get the last assistant message
	var lastMsgID string
	err := a.db.QueryRowContext(ctx, `
		SELECT id FROM message
		WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
		ORDER BY time_created DESC, id DESC
		LIMIT 1
	`, sessionID).Scan(&lastMsgID)
	if err != nil {
		return nil, nil
	}

	// Get text and reasoning parts from the last message
	rows, err := a.db.QueryContext(ctx, `
		SELECT data FROM part
		WHERE message_id = ? AND json_extract(data, '$.type') IN ('text', 'reasoning')
		ORDER BY time_created ASC, id ASC
	`, lastMsgID)
	if err != nil {
		return nil, fmt.Errorf("querying last message parts: %w", err)
	}
	defer rows.Close()

	var sections []string
	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if strings.Contains(p.Text, "## ") && len(p.Text) > 200 {
			sections = append(sections, p.Text)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{Markdown: md, Source: "synthesized"}, nil
}

func (a *Adapter) findTaskOutput(ctx context.Context, parentID, childID string) (string, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE m.session_id = ?
		  AND json_extract(m.data, '$.role') = 'assistant'
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') = 'task'
	`, parentID)
	if err != nil {
		return "", fmt.Errorf("querying task parts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if p.State.Metadata == nil {
			continue
		}
		meta, ok := p.State.Metadata.(map[string]interface{})
		if !ok {
			continue
		}
		sid, _ := meta["sessionId"].(string)
		if sid == childID {
			return p.State.Output, nil
		}
	}
	return "", rows.Err()
}

func (a *Adapter) planFromMessages(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE p.session_id = ?
		  AND json_extract(m.data, '$.role') = 'assistant'
		  AND json_extract(p.data, '$.type') = 'text'
		ORDER BY m.time_created ASC, p.time_created ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying plan parts: %w", err)
	}
	defer rows.Close()

	var sections []string
	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}
		if hasPlanContent(p.Text) {
			sections = append(sections, p.Text)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{
		Markdown: md,
		Source:   "synthesized",
	}, nil
}

func hasPlanContent(text string) bool {
	markers := []string{
		"- [", "## Plan", "## Implemen", "## Steps", "## Todo",
		"## Task", "## Goal", "## Object", "## Check",
		"Step ", "\n1. ", "\n2. ", "\n3. ",
	}
	for _, m := range markers {
		if strings.Contains(text, m) {
			return true
		}
	}
	return false
}

func (a *Adapter) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	// Read summary_diffs from session table
	var diffsJSON sql.NullString
	err := a.db.QueryRowContext(ctx, `
		SELECT summary_diffs FROM session WHERE id = ?
	`, sessionID).Scan(&diffsJSON)
	if err != nil {
		return nil, fmt.Errorf("querying session diffs: %w", err)
	}

	if !diffsJSON.Valid || diffsJSON.String == "" {
		return nil, nil
	}

	var diffs []ingest.DiffFile
	if err := json.Unmarshal([]byte(diffsJSON.String), &diffs); err != nil {
		// Try parsing as a simple string (unified diff)
		return []ingest.DiffFile{{Patch: diffsJSON.String}}, nil
	}
	return diffs, nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && opencode --session %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTime int64
	err := a.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(time_updated), 0) FROM session`).Scan(&maxTime)
	return maxTime, err
}

func (a *Adapter) Close() error {
	return a.db.Close()
}

// Internal JSON structs for parsing OpenCode's data blobs.

type messageData struct {
	Role  string      `json:"role"`
	Agent string      `json:"agent"`
	Model interface{} `json:"model"`
}

type partData struct {
	Type   string    `json:"type"`
	Text   string    `json:"text"`
	Tool   string    `json:"tool"`
	CallID string    `json:"callID"`
	State  partState `json:"state"`
}

type partState struct {
	Status   string      `json:"status"`
	Input    interface{} `json:"input"`
	Output   string      `json:"output"`
	Metadata interface{} `json:"metadata,omitempty"`
	Time     *partTime   `json:"time,omitempty"`
}

type partTime struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// extractModelID extracts the model ID from a JSON model object or plain string.
func extractModelID(modelJSON string) string {
	if modelJSON == "" {
		return ""
	}
	var m struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(modelJSON), &m); err == nil && m.ID != "" {
		return m.ID
	}
	// Try as plain string
	var s string
	if err := json.Unmarshal([]byte(modelJSON), &s); err == nil {
		return s
	}
	return modelJSON
}

// deriveRepository creates a repository identifier from directory and project name.
func deriveRepository(directory, projectName string) string {
	if projectName != "" {
		return projectName
	}
	// Fall back to last path component
	return filepath.Base(directory)
}

func extractSubAgentFromTitle(title string) string {
	idx := strings.Index(title, "(@")
	if idx == -1 {
		return ""
	}
	endIdx := strings.Index(title[idx+2:], " ")
	if endIdx == -1 {
		return ""
	}
	return title[idx+2 : idx+2+endIdx]
}

func stripTaskWrapper(output string) string {
	lines := strings.Split(output, "\n")
	var result []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || trimmed == "<task_result>" || trimmed == "</task_result>" || trimmed == "</task>" {
			continue
		}
		if strings.HasPrefix(trimmed, "<task ") && strings.HasSuffix(trimmed, ">") {
			continue
		}
		result = append(result, line)
	}
	return strings.TrimSpace(strings.Join(result, "\n"))
}

func marshalJSON(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}
