package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
			s.time_created,
			MAX(s.time_updated, COALESCE((SELECT MAX(time_created) FROM message WHERE session_id = s.id), 0)) AS time_updated,
			COALESCE(p.name, ''),
			(SELECT COUNT(*) FROM message WHERE session_id = s.id)
		FROM session s
		LEFT JOIN project p ON s.project_id = p.id
		ORDER BY time_updated DESC
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
		s.Status = ingest.SessionStatusCompleted

		if parentID.Valid {
			s.ParentID = parentID.String
		}

		if agentCol.Valid && agentCol.String != "" {
			s.SubAgent = agentCol.String
		} else {
			s.SubAgent = extractSubAgentFromTitle(s.Title)
		}

	if agentCol.Valid {
			s.Status = ingest.SessionStatusCompleted
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
			s.time_created,
			MAX(s.time_updated, COALESCE((SELECT MAX(time_created) FROM message WHERE session_id = s.id), 0)) AS time_updated,
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
		s.Status = ingest.SessionStatusCompleted
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

	type msgRow struct {
		id          string
		dataJSON    string
		timeCreated int64
	}
	var msgRows []msgRow
	for rows.Next() {
		var m msgRow
		if err := rows.Scan(&m.id, &m.dataJSON, &m.timeCreated); err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}
		msgRows = append(msgRows, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if len(msgRows) == 0 {
		return nil, nil
	}

	// Batch-load parts for all messages in a single query
	msgIDSet := make(map[string]int, len(msgRows))
	msgOrder := make([]string, len(msgRows))
	for i, m := range msgRows {
		msgIDSet[m.id] = i
		msgOrder[i] = m.id
	}

	partRows, err := a.db.QueryContext(ctx, `
		SELECT message_id, data FROM part
		WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)
		ORDER BY message_id, time_created ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying parts: %w", err)
	}
	defer partRows.Close()

	partsByMsg := make(map[string][]partData, len(msgRows))
	for partRows.Next() {
		var messageID, dataJSON string
		if err := partRows.Scan(&messageID, &dataJSON); err != nil {
			continue
		}
		var p partData
		if err := json.Unmarshal([]byte(dataJSON), &p); err == nil {
			partsByMsg[messageID] = append(partsByMsg[messageID], p)
		}
	}

	messages := make([]ingest.Message, 0, len(msgRows))
	var pendingCompaction *ingest.ToolCall
	var prevModel string

	for _, m := range msgRows {
		msg := ingest.Message{
			ID:        m.id,
			Timestamp: time.UnixMilli(m.timeCreated),
		}

		var data messageData
		var curModel string
		var curProvider string
		if err := json.Unmarshal([]byte(m.dataJSON), &data); err == nil {
			msg.Role = ingest.MessageRole(data.Role)
			msg.Agent = data.Agent
			if data.Model != nil {
				modelJSON := ingestkit.MarshalJSON(data.Model)
				msg.Model = extractModelID(modelJSON)
				if mi, ok := extractModelInfo(modelJSON); ok {
					curModel = mi.ID
					curProvider = mi.Provider
				}
			} else if data.ModelID != "" {
				msg.Model = data.ModelID
				curModel = data.ModelID
			}
		}

		for _, p := range partsByMsg[m.id] {
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
					Step:     ingest.StepEventStart,
					Snapshot: p.Snapshot,
				})
			case "step-finish":
				se := ingest.StepEvent{
					Step:     ingest.StepEventFinish,
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
					Status: ingest.ToolCallStatus(p.State.Status),
				}
				if p.State.Metadata != nil {
					tc.Metadata = ingestkit.MarshalJSON(p.State.Metadata)
				}
				if p.State.Time != nil {
					tc.Duration = p.State.Time.End - p.State.Time.Start
				}
				msg.ToolCalls = append(msg.ToolCalls, tc)
			case "compaction":
				// Synthesize a compaction tool call from the compaction part data.
				// The part's message is a user message that only exists to carry
				// the compaction marker — we skip it and inject the synthesized
				// tool call into the subsequent assistant message instead.
				inputJSON := marshalCompactionInput(p)
				pendingCompaction = &ingest.ToolCall{
					ID:     p.CallID,
					Name:   "compaction",
					Input:  inputJSON,
					Status: ingest.ToolCallCompleted,
				}
				// Clear the current message — it exists only to carry the
				// compaction marker and has no meaningful content.
				msg.Content = ""
				msg.Reasoning = ""
				msg.StepEvents = nil
				msg.ToolCalls = nil
			}
		}

		// Inject model_switch tool call when model changes between assistant messages,
		// so the UI shows a visual indicator (via ModelSwitchToolDiff) of the new model.
		if curModel != "" && prevModel != "" && curModel != prevModel && msg.Role == ingest.MessageRoleAssistant {
			modelInput := map[string]string{"model": curModel}
			if curProvider != "" {
				modelInput["provider"] = curProvider
			}
			tc := ingest.ToolCall{
				ID:     fmt.Sprintf("model-switch-%s", msg.ID),
				Name:   "model_switch",
				Input:  ingestkit.MarshalJSON(modelInput),
				Status: ingest.ToolCallCompleted,
			}
			msg.ToolCalls = append([]ingest.ToolCall{tc}, msg.ToolCalls...)
		}
		if curModel != "" && msg.Role == ingest.MessageRoleAssistant {
			prevModel = curModel
		}

		// Inject a pending compaction tool call at the front of the next
		// assistant message's tool call list so it renders as a visual marker.
		if pendingCompaction != nil && msg.Role == ingest.MessageRoleAssistant {
			if msg.Content != "" {
				pendingCompaction.Output = msg.Content
				msg.Content = ""
			}
			msg.ToolCalls = append([]ingest.ToolCall{*pendingCompaction}, msg.ToolCalls...)
			pendingCompaction = nil
		}

		if msg.Role == ingest.MessageRoleUser {
			msg.Content = wrapEmbeddedFileContent(msg.Content)
		}

		if msg.Content == "" && len(msg.ToolCalls) == 0 {
			continue
		}

		messages = append(messages, msg)
	}

	return messages, nil
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
		return &ingest.Plan{Markdown: md, Source: ingest.PlanDataSource(source)}, nil
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
	err := a.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(m), 0) FROM (
			SELECT MAX(time_updated) AS m FROM session
			UNION ALL
			SELECT MAX(time_created) FROM message
		)
	`).Scan(&maxTime)
	return maxTime, err
}

func (a *Adapter) Close() error {
	return a.db.Close()
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

// modelInfo holds the parsed fields from an OpenCode model descriptor.
type modelInfo struct {
	ID       string `json:"id"`
	Provider string `json:"providerID"`
	Variant  string `json:"variant"`
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

// extractModelInfo extracts the full model details (ID, provider, variant)
// from a JSON model object or plain string.
func extractModelInfo(modelJSON string) (modelInfo, bool) {
	if modelJSON == "" || modelJSON == "null" {
		return modelInfo{}, false
	}
	var m modelInfo
	if err := json.Unmarshal([]byte(modelJSON), &m); err == nil && m.ID != "" {
		return m, true
	}
	// Try as plain string
	var s string
	if err := json.Unmarshal([]byte(modelJSON), &s); err == nil && s != "" {
		return modelInfo{ID: s}, true
	}
	return modelInfo{}, false
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

type compactionInput struct {
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Auto      bool   `json:"auto"`
	Overflow  bool   `json:"overflow"`
}

func marshalCompactionInput(p partData) string {
	auto := false
	if p.Auto != nil {
		auto = *p.Auto
	}
	overflow := false
	if p.Overflow != nil {
		overflow = *p.Overflow
	}
	input := compactionInput{
		Kind:     "context_compaction",
		Label:    "Compaction",
		Auto:     auto,
		Overflow: overflow,
	}
	return ingestkit.MarshalJSON(input)
}
