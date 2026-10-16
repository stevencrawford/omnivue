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
		s           ingest.Session
		parentID    sql.NullString
		title       sql.NullString
		slug        string
		modelJSON   sql.NullString
		agentCol    sql.NullString
		summFiles   sql.NullInt64
		summAdd     sql.NullInt64
		summDel     sql.NullInt64
		timeCreated int64
		timeUpdated int64
		projectName string
		msgCount    int
	)

	err := scan(
		&s.ID, &parentID, &title, &slug, &s.Directory, &modelJSON, &agentCol,
		&s.Cost, &s.TokensInput, &s.TokensOutput, &s.TokensReasoning,
		&s.TokensCacheRead, &s.TokensCacheWrite,
		&summFiles, &summAdd, &summDel,
		&timeCreated, &timeUpdated,
		&projectName, &msgCount,
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
	s.Repository = ingestkit.DeriveRepository(s.Directory, projectName)
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

func (a *Adapter) messagesV2(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, type, data, time_created
		FROM session_message
		WHERE session_id = ?
		ORDER BY seq ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying session messages: %w", err)
	}
	defer rows.Close()

	type messageRow struct {
		id          string
		kind        string
		dataJSON    string
		timeCreated int64
	}
	var msgRows []messageRow
	for rows.Next() {
		var r messageRow
		if err := rows.Scan(&r.id, &r.kind, &r.dataJSON, &r.timeCreated); err != nil {
			return nil, fmt.Errorf("scanning session message: %w", err)
		}
		msgRows = append(msgRows, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(msgRows) == 0 {
		return nil, nil
	}

	messages := make([]ingest.Message, 0, len(msgRows))
	var pendingCompaction *ingest.ToolCall
	var prevModel string

	for _, r := range msgRows {
		// synthetic rows are harness-injected system reminders, not transcript.
		if r.kind == "synthetic" {
			continue
		}

		var data sessionMessageData
		if err := json.Unmarshal([]byte(r.dataJSON), &data); err != nil {
			continue
		}

		msg := ingest.Message{
			ID:        r.id,
			Timestamp: time.UnixMilli(r.timeCreated),
		}
		var curModel, curProvider string

		switch r.kind {
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
			applyAssistantContent(&msg, data)
		case "user":
			msg.Role = ingest.MessageRoleUser
			msg.Content = data.Text
		case "system":
			msg.Role = ingest.MessageRoleSystem
			msg.Content = data.Text
		case "compaction":
			comp := ingest.ToolCall{
				ID:     r.id,
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

// applyAssistantContent flattens a v2 assistant message's content array into the
// unified Message shape: text -> Content, reasoning -> Reasoning, tool -> a
// ToolCall. Each v2 assistant message is a single model step, so it also yields
// one synthesized step-finish event carrying the message's cost and tokens.
func applyAssistantContent(msg *ingest.Message, data sessionMessageData) {
	var reasoningAt int64
	for _, part := range data.Content {
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
	rows, err := a.db.QueryContext(ctx, `
		SELECT m.id, m.time_created, j.value,
			(SELECT COUNT(*) FROM session_message m2
			 WHERE m2.session_id = m.session_id AND m2.seq < m.seq) AS message_index
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.session_id = ?
		  AND m.type = 'assistant'
		  AND json_extract(j.value, '$.type') = 'tool'
		  AND json_extract(j.value, '$.name') IN ('edit', 'write')
		ORDER BY m.seq ASC, j.key ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying edit parts: %w", err)
	}
	defer rows.Close()

	var edits []ingest.FileEdit
	for rows.Next() {
		var (
			messageID    string
			timeCreated  int64
			partJSON     string
			messageIndex int
		)
		if err := rows.Scan(&messageID, &timeCreated, &partJSON, &messageIndex); err != nil {
			continue
		}

		var part v2ContentPart
		if err := json.Unmarshal([]byte(partJSON), &part); err != nil {
			continue
		}
		if part.State == nil {
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
			Timestamp:    time.UnixMilli(timeCreated),
			MessageIndex: messageIndex,
			MessageID:    messageID,
		})
	}

	return edits, rows.Err()
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

	//nolint:gosec
	query := fmt.Sprintf(`
		SELECT
			m.session_id,
			COUNT(DISTINCT COALESCE(
				json_extract(j.value, '$.state.input.filePath'),
				json_extract(j.value, '$.state.input.file_path'),
				json_extract(j.value, '$.state.input.path')
			)) AS file_count,
			COALESCE(SUM(CASE
				WHEN json_extract(j.value, '$.name') = 'edit'
					THEN CASE
						WHEN json_extract(j.value, '$.state.input.newString') IS NOT NULL
						 AND json_extract(j.value, '$.state.input.newString') != ''
						THEN LENGTH(json_extract(j.value, '$.state.input.newString'))
						   - LENGTH(REPLACE(json_extract(j.value, '$.state.input.newString'), CHAR(10), '')) + 1
						ELSE 0
					END
				WHEN json_extract(j.value, '$.name') = 'write'
					THEN CASE
						WHEN json_extract(j.value, '$.state.input.content') IS NOT NULL
						 AND json_extract(j.value, '$.state.input.content') != ''
						THEN LENGTH(json_extract(j.value, '$.state.input.content'))
						   - LENGTH(REPLACE(json_extract(j.value, '$.state.input.content'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) AS total_additions,
			COALESCE(SUM(CASE
				WHEN json_extract(j.value, '$.name') = 'edit'
					THEN CASE
						WHEN json_extract(j.value, '$.state.input.oldString') IS NOT NULL
						 AND json_extract(j.value, '$.state.input.oldString') != ''
						THEN LENGTH(json_extract(j.value, '$.state.input.oldString'))
						   - LENGTH(REPLACE(json_extract(j.value, '$.state.input.oldString'), CHAR(10), '')) + 1
						ELSE 0
					END
				ELSE 0
			END), 0) AS total_deletions
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.session_id IN (%s)
		  AND m.type = 'assistant'
		  AND json_extract(j.value, '$.type') = 'tool'
		  AND json_extract(j.value, '$.name') IN ('edit', 'write')
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
	var dataJSON string
	err := a.db.QueryRowContext(ctx, `
		SELECT data FROM session_message
		WHERE session_id = ? AND type = 'assistant'
		ORDER BY seq DESC
		LIMIT 1
	`, sessionID).Scan(&dataJSON)
	if err != nil {
		return nil, nil
	}

	var data sessionMessageData
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return nil, nil
	}

	var sections []string
	for _, part := range data.Content {
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
	rows, err := a.db.QueryContext(ctx, `
		SELECT j.value
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.session_id = ?
		  AND m.type = 'assistant'
		  AND json_extract(j.value, '$.type') = 'text'
		ORDER BY m.seq ASC, j.key ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying plan parts: %w", err)
	}
	defer rows.Close()

	var sections []string
	for rows.Next() {
		var partJSON string
		if err := rows.Scan(&partJSON); err != nil {
			continue
		}
		var part v2ContentPart
		if err := json.Unmarshal([]byte(partJSON), &part); err != nil {
			continue
		}
		if ingestkit.HasPlanContent(part.Text) {
			sections = append(sections, part.Text)
		}
	}
	return sections, rows.Err()
}

func (a *Adapter) planTodoSectionsV2(ctx context.Context, sessionID string) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT j.value
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.session_id = ?
		  AND m.type = 'assistant'
		  AND json_extract(j.value, '$.type') = 'tool'
		  AND json_extract(j.value, '$.name') = 'todowrite'
		ORDER BY m.seq ASC, j.key ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("querying todo parts: %w", err)
	}
	defer rows.Close()

	var sections []string
	for rows.Next() {
		var partJSON string
		if err := rows.Scan(&partJSON); err != nil {
			continue
		}
		var part v2ContentPart
		if err := json.Unmarshal([]byte(partJSON), &part); err != nil {
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
	return sections, rows.Err()
}

func (a *Adapter) findTaskOutputV2(ctx context.Context, parentID, childID string) (string, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT j.value
		FROM session_message m, json_each(m.data, '$.content') j
		WHERE m.session_id = ?
		  AND m.type = 'assistant'
		  AND json_extract(j.value, '$.type') = 'tool'
		  AND json_extract(j.value, '$.name') = 'task'
	`, parentID)
	if err != nil {
		return "", fmt.Errorf("querying task parts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var partJSON string
		if err := rows.Scan(&partJSON); err != nil {
			continue
		}
		var part v2ContentPart
		if err := json.Unmarshal([]byte(partJSON), &part); err != nil {
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
	return "", rows.Err()
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
