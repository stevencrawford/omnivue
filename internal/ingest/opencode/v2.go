package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

// This file holds the OpenCode v2 storage readers. OpenCode v2 stores sessions
// in session_v2 and every conversation turn in session_message, where the turn
// type (user/assistant/system/synthetic/compaction), a monotonic seq, and a
// single JSON data blob replace v1's message + part join. The public adapter
// methods dispatch here when the database is detected as v2.

const sessionV2Select = `
	SELECT
		s.id, s.parent_id, s.title, s.slug, s.directory, s.model, s.agent,
		s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
		s.tokens_cache_read, s.tokens_cache_write,
		s.summary_files, s.summary_additions, s.summary_deletions,
		s.time_created,
		MAX(s.time_updated,
			COALESCE((SELECT MAX(time_updated) FROM session_message WHERE session_id = s.id), 0)) AS time_updated,
		COALESCE(p.name, ''),
		COALESCE(p.worktree, ''),
		(SELECT COUNT(*) FROM session_message WHERE session_id = s.id)
	FROM session_v2 s
	LEFT JOIN project p ON s.project_id = p.id
`

func (a *Adapter) lastModifiedV2(ctx context.Context) (int64, error) {
	var maxTime int64
	err := a.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(m), 0) FROM (
			SELECT MAX(time_updated) AS m FROM session_v2
			UNION ALL
			SELECT MAX(time_created) FROM session_message
			UNION ALL
			SELECT MAX(time_updated) FROM session_message
		)
	`).Scan(&maxTime)
	if err != nil {
		return 0, fmt.Errorf("querying last modified: %w", err)
	}
	return maxTime, nil
}

func (a *Adapter) listSessionsV2(ctx context.Context) ([]ingest.Session, error) {
	rows, err := a.db.QueryContext(ctx, sessionV2Select+` ORDER BY time_updated DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	defer rows.Close()

	var sessions []ingest.Session
	var zeroDiffIDs []string
	var zeroDiffIdx []int

	for rows.Next() {
		s, err := scanSessionV2(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}
		if s.DiffFiles == 0 {
			zeroDiffIDs = append(zeroDiffIDs, s.ID)
			zeroDiffIdx = append(zeroDiffIdx, len(sessions))
		}
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	openSteps, err := a.openStepSessionsV2(ctx)
	if err == nil {
		for i := range sessions {
			sessions[i].InProgress = openSteps[sessions[i].ID]
		}
	}

	if len(zeroDiffIDs) > 0 {
		computed, err := a.computeDiffMetricsV2(ctx, zeroDiffIDs)
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

func (a *Adapter) sessionV2(ctx context.Context, id string) (*ingest.Session, error) {
	row := a.db.QueryRowContext(ctx, sessionV2Select+` WHERE s.id = ?`, id)
	s, err := scanSessionV2(row.Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("session not found: %s", id)
		}
		return nil, fmt.Errorf("querying session: %w", err)
	}

	if s.DiffFiles == 0 {
		if computed, err := a.computeDiffMetricsV2(ctx, []string{id}); err == nil {
			if vals, ok := computed[id]; ok && vals[0] > 0 {
				s.DiffFiles = vals[0]
				s.DiffAdditions = vals[1]
				s.DiffDeletions = vals[2]
			}
		}
	}

	if open, err := a.hasOpenStepV2(ctx, id); err == nil {
		s.InProgress = open
	}

	return &s, nil
}

func scanSessionV2(scan func(dest ...any) error) (ingest.Session, error) {
	var (
		s               ingest.Session
		parentID        sql.NullString
		title           sql.NullString
		slug            string
		modelJSON       sql.NullString
		agentCol        sql.NullString
		summFiles       sql.NullInt64
		summAdd         sql.NullInt64
		summDel         sql.NullInt64
		timeCreated     int64
		timeUpdated     int64
		projectName     string
		projectWorktree string
		msgCount        int
	)

	err := scan(
		&s.ID, &parentID, &title, &slug, &s.Directory, &modelJSON, &agentCol,
		&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
		&s.TokensCacheRead, &s.TokensCacheWrite,
		&summFiles, &summAdd, &summDel,
		&timeCreated, &timeUpdated,
		&projectName, &projectWorktree, &msgCount,
	)
	if err != nil {
		return ingest.Session{}, err
	}

	s.Agent = ingest.AgentOpenCode
	if title.Valid && title.String != "" {
		s.Title = title.String
	} else {
		s.Title = slug
	}
	s.Model = extractModelID(modelJSON.String)
	s.Repository = deriveRepositoryV2(s.Directory, projectName, projectWorktree)
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
	if summFiles.Valid {
		s.DiffFiles = int(summFiles.Int64) //nolint:gosec
	}
	if summAdd.Valid {
		s.DiffAdditions = int(summAdd.Int64) //nolint:gosec
	}
	if summDel.Valid {
		s.DiffDeletions = int(summDel.Int64) //nolint:gosec
	}
	s.MessageCount = msgCount

	return s, nil
}

// deriveRepositoryV2 resolves the sidebar grouping name for a v2 session. In v2
// a single project row (keyed by the canonical worktree) can own sessions that
// ran in git worktrees or sandboxes, each with its own session_v2.directory.
// Grouping by that directory would split one repository into a group per
// worktree, so prefer the project's worktree root. The project name wins when
// set, and the session directory is the fallback for the synthetic "global"
// project (worktree "/") or when the project row is missing.
func deriveRepositoryV2(directory, projectName, projectWorktree string) string {
	if projectName != "" {
		return projectName
	}
	root := projectWorktree
	if root == "" || root == "/" {
		root = directory
	}
	return ingestkit.DeriveRepository(root, "")
}

// openStepSessionsV2 returns the sessions whose most recent assistant turn has
// not finished streaming (no time.completed). OpenCode writes nothing to the DB
// while a model is thinking, so this open turn is the in-progress signal that
// keeps a long think from being treated as stale.
func (a *Adapter) openStepSessionsV2(ctx context.Context) (map[string]bool, error) {
	rows, err := a.db.QueryContext(ctx, `
		WITH ranked AS (
			SELECT session_id, data,
				ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY seq DESC) AS rn
			FROM session_message
			WHERE type = 'assistant'
		)
		SELECT session_id FROM ranked
		WHERE rn = 1 AND json_extract(data, '$.time.completed') IS NULL
	`)
	if err != nil {
		return nil, fmt.Errorf("querying open steps: %w", err)
	}
	defer rows.Close()

	open := make(map[string]bool)
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, fmt.Errorf("scanning open step: %w", err)
		}
		open[sid] = true
	}
	return open, rows.Err()
}

func (a *Adapter) hasOpenStepV2(ctx context.Context, sessionID string) (bool, error) {
	var count int
	err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM session_message
		WHERE session_id = ?
		  AND type = 'assistant'
		  AND seq = (SELECT MAX(seq) FROM session_message WHERE session_id = ? AND type = 'assistant')
		  AND json_extract(data, '$.time.completed') IS NULL
	`, sessionID, sessionID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("querying open step: %w", err)
	}
	return count > 0, nil
}

// v2TranscriptMessage is one session_message row with its transcript parts
// resolved. OpenCode 2.4 moved the parts out of the message row into the
// session_part table (leaving data.content empty), while older databases still
// carry them inline.
type v2TranscriptMessage struct {
	ID      string
	Kind    string
	Seq     int64
	Created int64
	Data    sessionMessageData
	Parts   []v2ContentPart
}

// contentParts returns the parts to read for this message: the session_part rows
// when OpenCode wrote them, otherwise the message's inline content array.
func (m *v2TranscriptMessage) contentParts() []v2ContentPart {
	if len(m.Parts) > 0 {
		return m.Parts
	}
	return m.Data.Content
}

// hasSessionPartsV2 reports whether the database has the session_part table
// introduced by OpenCode 2.4. The probe runs on every read because a live
// OpenCode upgrade creates the table while Omnivue keeps polling.
func (a *Adapter) hasSessionPartsV2(ctx context.Context) bool {
	var count int
	err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name = 'session_part'
	`).Scan(&count)
	return err == nil && count > 0
}

// assistantPartsV2 loads the transcript parts OpenCode 2.4+ writes to the
// session_part table, keyed by message id and ordered by the message sequence
// and the part's ordinal. Databases that predate the table (or sessions with no
// parts yet) yield no entries, and readers fall back to inline content.
func (a *Adapter) assistantPartsV2(ctx context.Context, sessionID string) (map[string][]v2ContentPart, error) {
	if !a.hasSessionPartsV2(ctx) {
		return nil, nil
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.message_id, p.data
		FROM session_part p
		JOIN session_message m ON m.id = p.message_id
		WHERE p.session_id = ? AND m.type = 'assistant'
		ORDER BY m.seq ASC, p.ordinal ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying session parts: %w", err)
	}
	defer rows.Close()

	parts := make(map[string][]v2ContentPart)
	for rows.Next() {
		var (
			messageID string
			partJSON  string
		)
		if err := rows.Scan(&messageID, &partJSON); err != nil {
			return nil, fmt.Errorf("scanning session part: %w", err)
		}
		var part v2ContentPart
		if err := json.Unmarshal([]byte(partJSON), &part); err != nil {
			continue
		}
		parts[messageID] = append(parts[messageID], part)
	}
	return parts, rows.Err()
}

// transcriptV2 reads a session's message rows in sequence order and resolves
// each assistant row's parts from session_part when that table is populated.
func (a *Adapter) transcriptV2(ctx context.Context, sessionID string) ([]v2TranscriptMessage, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, type, seq, data, time_created
		FROM session_message
		WHERE session_id = ?
		ORDER BY seq ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying session messages: %w", err)
	}
	defer rows.Close()

	var transcript []v2TranscriptMessage
	for rows.Next() {
		var (
			msg      v2TranscriptMessage
			dataJSON string
		)
		if err := rows.Scan(&msg.ID, &msg.Kind, &msg.Seq, &dataJSON, &msg.Created); err != nil {
			return nil, fmt.Errorf("scanning session message: %w", err)
		}
		if err := json.Unmarshal([]byte(dataJSON), &msg.Data); err != nil {
			continue
		}
		transcript = append(transcript, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(transcript) == 0 {
		return nil, nil
	}

	parts, err := a.assistantPartsV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	for i := range transcript {
		if p := parts[transcript[i].ID]; len(p) > 0 {
			transcript[i].Parts = p
		}
	}
	return transcript, nil
}

func (a *Adapter) messagesV2(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	transcript, err := a.transcriptV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if len(transcript) == 0 {
		return nil, nil
	}

	messages := make([]ingest.Message, 0, len(transcript))
	var pendingCompaction *ingest.ToolCall
	var prevModel string

	for _, r := range transcript {
		// synthetic rows are harness-injected system reminders, not transcript.
		if r.Kind == "synthetic" {
			continue
		}

		data := r.Data
		msg := ingest.Message{
			ID:        r.ID,
			Timestamp: time.UnixMilli(r.Created),
		}
		var curModel, curProvider string

		switch r.Kind {
		case "assistant":
			msg.Role = ingest.MessageRoleAssistant
			msg.Agent = data.Agent
			if data.Model != nil {
				modelJSON := ingestkit.MarshalJSON(data.Model)
				msg.Model = extractModelID(modelJSON)
				if mi, ok := extractModelInfo(modelJSON); ok {
					curModel = mi.ID
					curProvider = mi.Provider
				}
			}
			applyAssistantContent(&msg, data, r.contentParts())
		case "user":
			msg.Role = ingest.MessageRoleUser
			msg.Content = data.Text
		case "system":
			msg.Role = ingest.MessageRoleSystem
			msg.Content = data.Text
		case "compaction":
			comp := ingest.ToolCall{
				ID:     r.ID,
				Name:   "compaction",
				Input:  marshalCompactionInputV2(data),
				Output: data.Summary,
				Status: ingest.ToolCallCompleted,
			}
			pendingCompaction = &comp
			continue
		default:
			continue
		}

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

		if msg.Content == "" && msg.Reasoning == "" && len(msg.ToolCalls) == 0 && len(msg.StepEvents) == 0 {
			continue
		}

		messages = append(messages, msg)
	}

	// A trailing compaction with no following assistant turn would be dropped;
	// surface it as its own message so the summary is not lost.
	if pendingCompaction != nil {
		messages = append(messages, ingest.Message{
			ID:        pendingCompaction.ID,
			Role:      ingest.MessageRoleAssistant,
			ToolCalls: []ingest.ToolCall{*pendingCompaction},
		})
	}

	return messages, nil
}

// applyAssistantContent flattens a v2 assistant message's parts into the unified
// Message shape: text -> Content, reasoning -> Reasoning, tool -> a ToolCall. Each
// v2 assistant message is a single model step, so it also yields one synthesized
// step-finish event carrying the message's cost and tokens.
func applyAssistantContent(msg *ingest.Message, data sessionMessageData, parts []v2ContentPart) {
	var reasoningAt int64
	for _, part := range parts {
		switch part.Type {
		case "text":
			msg.Content = joinText(msg.Content, part.Text)
		case "reasoning":
			msg.Reasoning = joinText(msg.Reasoning, part.Text)
			if part.Time != nil && part.Time.Completed > reasoningAt {
				reasoningAt = part.Time.Completed
			}
		case "tool":
			msg.ToolCalls = append(msg.ToolCalls, toolCallFromV2(part))
		}
	}
	if reasoningAt > 0 {
		t := time.UnixMilli(reasoningAt)
		msg.ReasoningAt = &t
	}

	if data.Tokens != nil {
		msg.TokensInput = data.Tokens.Input
		msg.TokensOutput = data.Tokens.Output
	}

	se := ingest.StepEvent{Step: ingest.StepEventFinish, Cost: data.Cost, Reason: data.Finish}
	if data.Tokens != nil {
		se.Tokens = ingest.StepTokens{
			Input:     data.Tokens.Input,
			Output:    data.Tokens.Output,
			Reasoning: data.Tokens.Reasoning,
		}
		if data.Tokens.Cache != nil {
			se.Tokens.CacheRead = data.Tokens.Cache.Read
			se.Tokens.CacheWrite = data.Tokens.Cache.Write
		}
	}
	if data.Finish != "" || data.Cost != 0 || data.Tokens != nil {
		msg.StepEvents = append(msg.StepEvents, se)
	}

	if len(msg.ToolCalls) > 0 && (data.Cost != 0 || data.Tokens != nil) {
		usage := ingest.ToolUsage{Source: ingest.UsageStep, Cost: data.Cost}
		if data.Tokens != nil {
			usage.Tokens = ingest.StepTokens{
				Input:     data.Tokens.Input,
				Output:    data.Tokens.Output,
				Reasoning: data.Tokens.Reasoning,
			}
			if data.Tokens.Cache != nil {
				usage.Tokens.CacheRead = data.Tokens.Cache.Read
				usage.Tokens.CacheWrite = data.Tokens.Cache.Write
			}
		}
		for i := range msg.ToolCalls {
			u := usage
			msg.ToolCalls[i].Usage = &u
		}
	}
}

func toolCallFromV2(part v2ContentPart) ingest.ToolCall {
	tc := ingest.ToolCall{
		ID:   part.ID,
		Name: ingestkit.CanonicalizeToolName(part.Name),
	}
	if part.State != nil {
		tc.Input = ingestkit.MarshalJSON(part.State.Input)
		tc.Output = joinContentText(part.State.Content)
		tc.Status = ingest.ToolCallStatus(part.State.Status)
		if part.State.Metadata != nil {
			tc.Metadata = ingestkit.MarshalJSON(part.State.Metadata)
		}
		if part.State.Error != nil {
			if errJSON := ingestkit.MarshalJSON(part.State.Error); errJSON != "" {
				var e v2ToolError
				if json.Unmarshal([]byte(errJSON), &e) == nil && e.Message != "" && tc.Output == "" {
					tc.Output = e.Message
				}
			}
		}
	}
	if part.Time != nil {
		if d := part.Time.Completed - part.Time.Created; d > 0 {
			tc.Duration = d
		}
	}
	return tc
}

func (a *Adapter) editsV2(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	transcript, err := a.transcriptV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for messageIndex, msg := range transcript {
		if msg.Kind != "assistant" {
			continue
		}
		for _, part := range msg.contentParts() {
			if part.Type != "tool" || part.State == nil {
				continue
			}

			toolName := ingestkit.CanonicalizeToolName(part.Name)
			if toolName != "edit" && toolName != "write" {
				continue
			}

			inputJSON := ingestkit.MarshalJSON(part.State.Input)
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
				FilePath:     filePath,
				ToolName:     toolName,
				OldStr:       in.OldStrResolved(),
				NewStr:       in.NewStrResolved(),
				Content:      in.Content,
				ViewRange:    in.ViewRange,
				Timestamp:    time.UnixMilli(msg.Created),
				MessageIndex: messageIndex,
				MessageID:    msg.ID,
			})
		}
	}

	return edits, nil
}

func (a *Adapter) computeDiffMetricsV2(ctx context.Context, ids []string) (map[string][3]int, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	// OpenCode 2.4+ stores assistant parts in session_part and leaves the inline
	// content array empty, so prefer those rows and read inline content only for
	// messages that have no parts row.
	partsSource := `
		SELECT m.session_id AS session_id, j.value AS part
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.type = 'assistant'`
	if a.hasSessionPartsV2(ctx) {
		partsSource = `
			SELECT m.session_id AS session_id, p.data AS part
			FROM session_part p
			JOIN session_message m ON m.id = p.message_id
			WHERE m.type = 'assistant'
			UNION ALL
			SELECT m.session_id, j.value
			FROM session_message m, json_each(m.data, '$.content') j
			WHERE m.type = 'assistant'
			  AND NOT EXISTS (SELECT 1 FROM session_part p2 WHERE p2.message_id = m.id)`
	}

	//nolint:gosec
	query := fmt.Sprintf(`
		WITH part_rows AS (%s)
		SELECT
			session_id,
			COUNT(DISTINCT COALESCE(
				json_extract(part, '$.state.input.filePath'),
				json_extract(part, '$.state.input.file_path'),
				json_extract(part, '$.state.input.path')
			)) AS file_count,
			COALESCE(SUM(CASE
				WHEN json_extract(part, '$.name') = 'edit'
					THEN CASE
						WHEN json_extract(part, '$.state.input.newString') IS NOT NULL
						 AND json_extract(part, '$.state.input.newString') != ''
						THEN LENGTH(json_extract(part, '$.state.input.newString'))
						   - LENGTH(REPLACE(json_extract(part, '$.state.input.newString'), CHAR(10), '')) + 1
						ELSE 0
					END
				WHEN json_extract(part, '$.name') = 'write'
					THEN CASE
						WHEN json_extract(part, '$.state.input.content') IS NOT NULL
						 AND json_extract(part, '$.state.input.content') != ''
						THEN LENGTH(json_extract(part, '$.state.input.content'))
						   - LENGTH(REPLACE(json_extract(part, '$.state.input.content'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) AS total_additions,
			COALESCE(SUM(CASE
				WHEN json_extract(part, '$.name') = 'edit'
					THEN CASE
						WHEN json_extract(part, '$.state.input.oldString') IS NOT NULL
						 AND json_extract(part, '$.state.input.oldString') != ''
						THEN LENGTH(json_extract(part, '$.state.input.oldString'))
						   - LENGTH(REPLACE(json_extract(part, '$.state.input.oldString'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) AS total_deletions
		FROM part_rows
		WHERE session_id IN (%s)
		  AND json_extract(part, '$.type') = 'tool'
		  AND json_extract(part, '$.name') IN ('edit', 'write')
		GROUP BY session_id
	`, partsSource, strings.Join(placeholders, ","))

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

func (a *Adapter) planV2(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	var parentID sql.NullString
	var agentCol sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT parent_id, agent FROM session_v2 WHERE id = ?`, sessionID).Scan(&parentID, &agentCol)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("querying session: %w", err)
	}

	if parentID.Valid {
		output, err := a.findTaskOutputV2(ctx, parentID.String, sessionID)
		if err != nil {
			return nil, err
		}
		if output != "" {
			source := "task-output"
			cleaned := stripTaskWrapper(output)
			md := "# Sub-agent Response\n\n" + cleaned
			return &ingest.Plan{Markdown: md, Source: ingest.PlanDataSource(source)}, nil
		}
	}

	if agentCol.Valid && agentCol.String == "plan" {
		return a.planFromLastMessageV2(ctx, sessionID)
	}

	return a.planFromMessagesV2(ctx, sessionID)
}

func (a *Adapter) planFromLastMessageV2(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	transcript, err := a.transcriptV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var last *v2TranscriptMessage
	for i := range transcript {
		if transcript[i].Kind == "assistant" {
			last = &transcript[i]
		}
	}
	if last == nil {
		return nil, nil
	}

	var sections []string
	for _, part := range last.contentParts() {
		if (part.Type == "text" || part.Type == "reasoning") && strings.Contains(part.Text, "## ") && len(part.Text) > 200 {
			sections = append(sections, part.Text)
		}
	}
	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{Markdown: md, Source: ingest.PlanDataSynthesized}, nil
}

func (a *Adapter) planFromMessagesV2(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	sections, err := a.planTextSectionsV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	todoSections, err := a.planTodoSectionsV2(ctx, sessionID)
	if err == nil && len(todoSections) > 0 {
		sections = append(sections, "## Plan Items\n\n"+strings.Join(todoSections, "\n"))
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{Markdown: md, Source: "synthesized"}, nil
}

func (a *Adapter) planTextSectionsV2(ctx context.Context, sessionID string) ([]string, error) {
	transcript, err := a.transcriptV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var sections []string
	for _, msg := range transcript {
		if msg.Kind != "assistant" {
			continue
		}
		for _, part := range msg.contentParts() {
			if part.Type == "text" && ingestkit.HasPlanContent(part.Text) {
				sections = append(sections, part.Text)
			}
		}
	}
	return sections, nil
}

func (a *Adapter) planTodoSectionsV2(ctx context.Context, sessionID string) ([]string, error) {
	transcript, err := a.transcriptV2(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var sections []string
	for _, msg := range transcript {
		if msg.Kind != "assistant" {
			continue
		}
		for _, part := range msg.contentParts() {
			if part.Type != "tool" || part.Name != "todowrite" {
				continue
			}
			if part.State == nil || part.State.Input == nil {
				continue
			}
			inputJSON := ingestkit.MarshalJSON(part.State.Input)
			if inputJSON == "" {
				continue
			}
			sections = append(sections, todoLines(inputJSON)...)
		}
	}
	return sections, nil
}

func (a *Adapter) findTaskOutputV2(ctx context.Context, parentID, childID string) (string, error) {
	transcript, err := a.transcriptV2(ctx, parentID)
	if err != nil {
		return "", err
	}

	for _, msg := range transcript {
		if msg.Kind != "assistant" {
			continue
		}
		for _, part := range msg.contentParts() {
			if part.Type != "tool" || part.Name != "task" {
				continue
			}
			if part.State == nil || part.State.Metadata == nil {
				continue
			}
			meta, ok := part.State.Metadata.(map[string]any)
			if !ok {
				continue
			}
			sid, _ := meta["sessionId"].(string)
			if sid == childID {
				return joinContentText(part.State.Content), nil
			}
		}
	}
	return "", nil
}

// todoLines renders a todowrite tool input (a JSON array of todo items) as
// markdown checklist lines.
func todoLines(inputJSON string) []string {
	var items []todoItem
	if err := json.Unmarshal([]byte(inputJSON), &items); err != nil {
		return nil
	}
	var lines []string
	for _, item := range items {
		if item.Content == "" {
			continue
		}
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
		lines = append(lines, content)
	}
	return lines
}

func marshalCompactionInputV2(data sessionMessageData) string {
	input := compactionInput{
		Kind:  "context_compaction",
		Label: "Compaction",
		Auto:  data.Reason == "auto",
	}
	return ingestkit.MarshalJSON(input)
}

func joinText(existing, add string) string {
	if add == "" {
		return existing
	}
	if existing == "" {
		return add
	}
	return existing + "\n" + add
}

func joinContentText(parts []v2ContentPart) string {
	var texts []string
	for _, p := range parts {
		if p.Text != "" {
			texts = append(texts, p.Text)
		}
	}
	return strings.Join(texts, "\n")
}
