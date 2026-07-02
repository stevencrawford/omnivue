package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

	_ "modernc.org/sqlite"
)

func init() {
	ingest.Register(ingest.AgentOpenCode, "OpenCode", "~/.local/share/opencode",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

// detectPath checks whether the given path contains an OpenCode database.
func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := filepath.Join(path, "opencode.db")
	if !ingestkit.PathExists(dbPath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentOpenCode,
		Label:     "OpenCode",
	}
}

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
	dbPath := filepath.Join(path, "opencode.db")
	_, err := os.Stat(dbPath)
	return err == nil
}

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT 
			s.id, s.parent_id, s.title, s.directory, s.model, s.agent,
			s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
			s.tokens_cache_read, s.tokens_cache_write,
			s.summary_files, s.summary_additions, s.summary_deletions,
			s.time_created, s.time_updated,
			COALESCE(p.name, ''),
			(SELECT COUNT(*) FROM message WHERE session_id = s.id)
		FROM session s
		LEFT JOIN project p ON s.project_id = p.id
		ORDER BY s.time_updated DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	defer rows.Close()

	var sessions []ingest.Session
	var zeroDiffIDs []string
	var zeroDiffIdx []int

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
			msgCount     int
		)

		err := rows.Scan(
			&s.ID, &parentID, &s.Title, &s.Directory, &modelJSON, &agentCol,
			&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
			&s.TokensCacheRead, &s.TokensCacheWrite,
			&summFiles, &summAdd, &summDel,
			&timeCreated, &timeUpdated,
			&projectName, &msgCount,
		)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}

		s.Agent = ingest.AgentOpenCode
		s.Model = extractModelID(modelJSON.String)
		s.Repository = ingestkit.DeriveRepository(s.Directory, projectName)
		s.Branch = ""
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

		if agentCol.Valid {
			s.Status = "completed"
		}

		if summFiles.Valid {
			s.DiffFiles = int(summFiles.Int64) //nolint:gosec
		}
		if summAdd.Valid {
			s.DiffAdditions = int(summAdd.Int64) //nolint:gosec
		}
		if summDel.Valid {
			s.DiffDeletions = int(summDel.Int64) //nolint:gosec
		}

		if s.DiffFiles == 0 {
			zeroDiffIDs = append(zeroDiffIDs, s.ID)
			zeroDiffIdx = append(zeroDiffIdx, len(sessions))
		}

		s.MessageCount = msgCount

		sessions = append(sessions, s)
	}

	if len(zeroDiffIDs) > 0 {
		computed, err := a.computeDiffMetrics(ctx, zeroDiffIDs)
		if err == nil {
			for i, id := range zeroDiffIDs {
				if vals, ok := computed[id]; ok && vals[0] > 0 {
					sessions[zeroDiffIdx[i]].DiffFiles = vals[0]
					sessions[zeroDiffIdx[i]].DiffAdditions = vals[1]
					sessions[zeroDiffIdx[i]].DiffDeletions = vals[2]
				}
			}
		}
	}

	return sessions, nil
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
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
		msgCount     int
	)

	err := a.db.QueryRowContext(ctx, `
		SELECT 
			s.id, s.parent_id, s.title, s.directory, s.model, s.agent,
			s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
			s.tokens_cache_read, s.tokens_cache_write,
			s.summary_files, s.summary_additions, s.summary_deletions,
			s.time_created, s.time_updated,
			COALESCE(p.name, ''),
			(SELECT COUNT(*) FROM message WHERE session_id = s.id)
		FROM session s
		LEFT JOIN project p ON s.project_id = p.id
		WHERE s.id = ?
	`, id).Scan(
		&s.ID, &parentID, &s.Title, &s.Directory, &modelJSON, &agentCol,
		&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
		&s.TokensCacheRead, &s.TokensCacheWrite,
		&summFiles, &summAdd, &summDel,
		&timeCreated, &timeUpdated,
		&projectName, &msgCount,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("session not found: %s", id)
		}
		return nil, fmt.Errorf("querying session: %w", err)
	}

	s.Agent = ingest.AgentOpenCode
	s.Model = extractModelID(modelJSON.String)
	s.Repository = ingestkit.DeriveRepository(s.Directory, projectName)
	s.Branch = ""
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

	if agentCol.Valid {
		s.Status = "completed"
	}

	if summFiles.Valid {
		s.DiffFiles = int(summFiles.Int64) //nolint:gosec
	}
	if summAdd.Valid {
		s.DiffAdditions = int(summAdd.Int64) //nolint:gosec
	}
	if summDel.Valid {
		s.DiffDeletions = int(summDel.Int64) //nolint:gosec
	}

	if s.DiffFiles == 0 {
		computed, err := a.computeDiffMetrics(ctx, []string{id})
		if err == nil {
			if vals, ok := computed[id]; ok && vals[0] > 0 {
				s.DiffFiles = vals[0]
				s.DiffAdditions = vals[1]
				s.DiffDeletions = vals[2]
			}
		}
	}

	s.MessageCount = msgCount

	return &s, nil
}

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
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
			msg.Model = extractModelID(ingestkit.MarshalJSON(data.Model))
			msg.Agent = data.Agent
		}

		// Get parts for this message
		parts, err := a.messageParts(ctx, id)
		if err == nil {
			for _, p := range parts {
				switch p.Type {
		case "text":
			if msg.Content == "" {
				msg.Content = p.Text
			} else {
				msg.Content += "\n" + p.Text
			}
		case "reasoning":
			if msg.Reasoning == "" {
				msg.Reasoning = p.Text
			} else {
				msg.Reasoning += "\n" + p.Text
			}
		case "step-start":
					msg.StepEvents = append(msg.StepEvents, ingest.StepEvent{
						Step:     "start",
						Snapshot: p.Snapshot,
					})
				case "step-finish":
					se := ingest.StepEvent{
						Step:     "finish",
						Snapshot: p.Snapshot,
						Reason:   p.Reason,
						Cost:     p.Cost,
					}
					if p.Tokens != nil {
						se.Tokens = ingest.StepTokens{
							Input:    p.Tokens.Input,
							Output:   p.Tokens.Output,
							Reasoning: p.Tokens.Reasoning,
						}
						if p.Tokens.Cache != nil {
							se.Tokens.CacheRead = p.Tokens.Cache.Read
							se.Tokens.CacheWrite = p.Tokens.Cache.Write
						}
					}
					msg.StepEvents = append(msg.StepEvents, se)
				case "tool":
					tc := ingest.ToolCall{
						ID:     p.CallID,
						Name:   p.Tool,
						Input:  ingestkit.MarshalJSON(p.State.Input),
						Output: p.State.Output,
						Status: p.State.Status,
					}
					if p.State.Metadata != nil {
						tc.Metadata = ingestkit.MarshalJSON(p.State.Metadata)
					}
					if p.State.Time != nil {
						tc.Duration = p.State.Time.End - p.State.Time.Start
					}
					msg.ToolCalls = append(msg.ToolCalls, tc)
				}
			}
		}

		// Wrap large embedded code blocks in user messages with <file-context> tags
		// so the frontend can render them as collapsible file references.
		if msg.Role == "user" {
			msg.Content = wrapEmbeddedFileContent(msg.Content)
		}

		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

// Plan implements ingest.Adapter.
func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
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

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.data, m.time_created
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE p.session_id = ?
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') IN ('edit', 'write')
		ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying edit parts: %w", err)
	}
	defer rows.Close()

	var edits []ingest.FileEdit
	for rows.Next() {
		var dataJSON string
		var timeCreated int64
		if err := rows.Scan(&dataJSON, &timeCreated); err != nil {
			continue
		}

		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
			continue
		}

		if p.Tool != "edit" && p.Tool != "write" {
			continue
		}

		inputJSON := ingestkit.MarshalJSON(p.State.Input)
		if inputJSON == "" {
			continue
		}

		var in editInput
		if err := json.Unmarshal([]byte(inputJSON), &in); err != nil {
			continue
		}

		filePath := in.FilePathResolved()
		if filePath == "" {
			continue
		}

		edits = append(edits, ingest.FileEdit{
			FilePath:  filePath,
			ToolName:  p.Tool,
			OldStr:    in.OldStrResolved(),
			NewStr:    in.NewStrResolved(),
			Content:   in.Content,
			ViewRange: in.ViewRange,
			Timestamp: time.UnixMilli(timeCreated),
		})
	}

	return edits, rows.Err()
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
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
	return fmt.Sprintf("cd %s && opencode -s %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTime int64
	err := a.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(time_updated), 0) FROM session`).Scan(&maxTime)
	return maxTime, err
}

func (a *Adapter) Close() error {
	return a.db.Close()
}

func (a *Adapter) computeDiffMetrics(ctx context.Context, ids []string) (map[string][3]int, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	//nolint:gosec
	query := fmt.Sprintf(`
		SELECT
			m.session_id,
			COUNT(DISTINCT COALESCE(
				json_extract(p.data, '$.state.input.filePath'),
				json_extract(p.data, '$.state.input.file_path'),
				json_extract(p.data, '$.state.input.path')
			)) as file_count,
			COALESCE(SUM(CASE
				WHEN json_extract(p.data, '$.tool') = 'edit'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.newString') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.newString') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.newString'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.newString'), CHAR(10), '')) + 1
						ELSE 0
					END
				WHEN json_extract(p.data, '$.tool') = 'write'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.content') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.content') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.content'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.content'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) as total_additions,
			COALESCE(SUM(CASE
				WHEN json_extract(p.data, '$.tool') = 'edit'
					THEN CASE
						WHEN json_extract(p.data, '$.state.input.oldString') IS NOT NULL
						 AND json_extract(p.data, '$.state.input.oldString') != ''
						THEN LENGTH(json_extract(p.data, '$.state.input.oldString'))
						   - LENGTH(REPLACE(json_extract(p.data, '$.state.input.oldString'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) as total_deletions
		FROM part p
		JOIN message m ON p.message_id = m.id
		WHERE m.session_id IN (%s)
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') IN ('edit', 'write')
		GROUP BY m.session_id
	`, strings.Join(placeholders, ","))

	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("computing diff metrics: %w", err)
	}
	defer rows.Close()

	computed := make(map[string][3]int, len(ids))
	for rows.Next() {
		var sid string
		var files, adds, dels int
		if err := rows.Scan(&sid, &files, &adds, &dels); err != nil {
			continue
		}
		computed[sid] = [3]int{files, adds, dels}
	}

	return computed, rows.Err()
}

func (a *Adapter) messageParts(ctx context.Context, messageID string) ([]partData, error) {
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
		meta, ok := p.State.Metadata.(map[string]any)
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
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Also include plan items from todowrite tool call inputs
	todoRows, err := a.db.QueryContext(ctx, `
		SELECT p.data
		FROM part p
		WHERE p.session_id = ?
		  AND json_extract(p.data, '$.type') = 'tool'
		  AND json_extract(p.data, '$.tool') = 'todowrite'
		ORDER BY p.time_created ASC
	`, sessionID)
	if err == nil {
		var todoSections []string
		for todoRows.Next() {
			var dataJSON string
			if err := todoRows.Scan(&dataJSON); err != nil {
				continue
			}
			var p partData
			if err := json.Unmarshal([]byte(dataJSON), &p); err != nil {
				continue
			}
			if p.State.Input == nil {
				continue
			}
			inputJSON := ingestkit.MarshalJSON(p.State.Input)
			if inputJSON == "" {
				continue
			}
			var items []struct {
				Content  string `json:"content"`
				Status   string `json:"status"`
				Priority string `json:"priority"`
			}
			if err := json.Unmarshal([]byte(inputJSON), &items); err != nil {
				continue
			}
			for _, item := range items {
				if item.Content != "" {
					prefix := "- [ ]"
					switch item.Status {
					case "completed":
						prefix = "- [x]"
					case "in_progress":
						prefix = "- [/]"
					case "canceled":
						prefix = "- [-]"
					}
					content := item.Content
					if !strings.HasPrefix(strings.TrimSpace(content), "- [") {
						content = prefix + " " + content
					}
					todoSections = append(todoSections, content)
				}
			}
		}
		todoRows.Close()
		if len(todoSections) > 0 {
			sections = append(sections, "## Plan Items\n\n"+strings.Join(todoSections, "\n"))
		}
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

// editInput mirrors the JSON fields in edit/write tool call inputs.
type editInput struct {
	Path      string  `json:"path"`
	FilePath  string  `json:"filePath"`
	FilePath2 string  `json:"file_path"`
	OldStr    string  `json:"old_str"`
	OldString string  `json:"oldString"`
	NewStr    string  `json:"new_str"`
	NewString string  `json:"newString"`
	Content   string  `json:"content"`
	ViewRange []int   `json:"view_range"`
}

func (e *editInput) FilePathResolved() string {
	switch {
	case e.FilePath != "":
		return e.FilePath
	case e.FilePath2 != "":
		return e.FilePath2
	default:
		return e.Path
	}
}

func (e *editInput) OldStrResolved() string {
	if e.OldStr != "" {
		return e.OldStr
	}
	return e.OldString
}

func (e *editInput) NewStrResolved() string {
	if e.NewStr != "" {
		return e.NewStr
	}
	return e.NewString
}

// Internal JSON structs for parsing OpenCode's data blobs.

type messageData struct {
	Role  string      `json:"role"`
	Agent string      `json:"agent"`
	Model any `json:"model"`
}

type partData struct {
	Type      string       `json:"type"`
	Text      string       `json:"text"`
	Synthetic bool         `json:"synthetic,omitempty"`
	Tool      string       `json:"tool"`
	CallID    string       `json:"callID"`
	State     partState    `json:"state"`
	Snapshot  string       `json:"snapshot,omitempty"`
	Reason    string       `json:"reason,omitempty"`
	Cost      float64      `json:"cost,omitempty"`
	Tokens    *stepTokens  `json:"tokens,omitempty"`
}

type stepTokens struct {
	Input   int              `json:"input"`
	Output  int              `json:"output"`
	Reasoning int            `json:"reasoning"`
	Cache   *stepCacheTokens `json:"cache,omitempty"`
}

type stepCacheTokens struct {
	Read  int `json:"read"`
	Write int `json:"write"`
}

type partState struct {
	Status   string      `json:"status"`
	Input    any `json:"input"`
	Output   string      `json:"output"`
	Metadata any `json:"metadata,omitempty"`
	Time     *partTime   `json:"time,omitempty"`
}

type partTime struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// stripToolCalledLine removes the synthetic "Called the ..." tool header line
// from the text preceding a <file-context> block. This line is verbose and
// redundant since the file-context block header already shows the filename.
func stripToolCalledLine(text string) string {
	lines := strings.Split(text, "\n")
	var kept []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Called the ") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// wrapEmbeddedFileContent scans user message text for patterns that suggest
// auto-included file content and wraps them in <file-context> tags for
// collapsible rendering in the frontend. This serves as a fallback heuristic
// for agents that don't set the synthetic flag on auto-included content.
func wrapEmbeddedFileContent(text string) string {
	if len(text) < 200 {
		return text
	}

	// Match OpenCode's XML file read format: <path>...</path>\n<type>...</type>\n<content>...</content>
	xmlRe := regexp.MustCompile(`(?s)(.*?)<path>(.*?)</path>\s*<type>(.*?)</type>\s*<content>\n?(.*?)</content>`)
	text = xmlRe.ReplaceAllStringFunc(text, func(match string) string {
		parts := xmlRe.FindStringSubmatch(match)
		if len(parts) < 5 {
			return match
		}
		before := parts[1]
		filePath := strings.TrimSpace(parts[2])
		content := parts[4]
		// Strip the "Called the Read tool..." header line — it's verbose and
		// redundant since the file-context block header already shows the filename.
		before = stripToolCalledLine(before)
		label := filePath
		if idx := strings.LastIndexAny(filePath, "/\\"); idx >= 0 {
			label = filePath[idx+1:]
		}
		result := before
		if trimmed := strings.TrimSpace(content); trimmed != "" {
			result += fmt.Sprintf("<file-context path=%q>%s</file-context>\n", label, trimmed)
		}
		return result
	})

	// Match code blocks where the language tag includes a file path via colon,
	// e.g. ```typescript:src/foo.ts ... ```
	reLangWithPath := regexp.MustCompile("(?s)```(\\w+):([^\\n]+?)\\n(.+?)```\\n?")
	text = reLangWithPath.ReplaceAllStringFunc(text, func(match string) string {
		parts := reLangWithPath.FindStringSubmatch(match)
		if len(parts) < 4 {
			return match
		}
		filePath := strings.TrimSpace(parts[2])
		content := parts[3]
		if strings.Count(content, "\n") < 10 {
			return match
		}
		return fmt.Sprintf("<file-context path=%q>%s</file-context>\n", filePath, content)
	})

	// Match code blocks preceded by a line that looks like a file path,
	// e.g. "src/foo.ts\n```typescript\n...content...\n```"
	rePathBeforeBlock := regexp.MustCompile("(?s)([^\\n]+/(?:[^\\n]+\\.[a-zA-Z]+|[^\\n]+/))\\n(```\\w+\\n.+?```)\\n?")
	const blockMinLines = 20
	text = rePathBeforeBlock.ReplaceAllStringFunc(text, func(match string) string {
		parts := rePathBeforeBlock.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		filePath := strings.TrimSpace(parts[1])
		codeBlock := parts[2]
		lines := strings.Count(codeBlock, "\n")
		if lines < blockMinLines {
			return match
		}
		return fmt.Sprintf("<file-context path=%q>%s</file-context>\n", filePath, codeBlock)
	})

	return text
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
