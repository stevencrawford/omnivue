package opencode

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

type modelInfo struct {
	ID       string `json:"id"`
	Provider string `json:"providerID"`
	Variant  string `json:"variant"`
}

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
	var s string
	if err := json.Unmarshal([]byte(modelJSON), &s); err == nil {
		return s
	}
	return modelJSON
}

func extractModelInfo(modelJSON string) (modelInfo, bool) {
	if modelJSON == "" || modelJSON == "null" {
		return modelInfo{}, false
	}
	var m modelInfo
	if err := json.Unmarshal([]byte(modelJSON), &m); err == nil && m.ID != "" {
		return m, true
	}
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

// openStepSessions returns the session IDs whose newest message has started a
// step but not finished it — the model is mid-turn (thinking, streaming, or
// running a tool). OpenCode writes nothing to the DB while it is thinking, so
// the timestamp-based liveness heuristic alone would flip such a session stale;
// the open step is the in-progress signal.
func (a *Adapter) openStepSessions(ctx context.Context) (map[string]bool, error) {
	rows, err := a.db.QueryContext(ctx, `
		WITH ranked AS (
			SELECT id, session_id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC, id DESC) rn
			FROM message
		)
		SELECT r.session_id FROM ranked r
		WHERE r.rn = 1
			AND EXISTS (SELECT 1 FROM part p WHERE p.message_id = r.id AND p.data LIKE '%"type":"step-start"%')
			AND NOT EXISTS (SELECT 1 FROM part p WHERE p.message_id = r.id AND p.data LIKE '%"type":"step-finish"%')`)
	if err != nil {
		return nil, fmt.Errorf("querying open steps: %w", err)
	}
	defer rows.Close()

	open := make(map[string]bool)
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			continue
		}
		open[sid] = true
	}
	return open, rows.Err()
}

func (a *Adapter) hasOpenStep(ctx context.Context, sessionID string) (bool, error) {
	var count int
	err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM message m
		WHERE m.id = (
			SELECT id FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1
		)
			AND EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id AND p.data LIKE '%"type":"step-start"%')
			AND NOT EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id AND p.data LIKE '%"type":"step-finish"%')`, sessionID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("querying open step: %w", err)
	}
	return count > 0, nil
}

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT 
			s.id, s.parent_id, s.title, s.directory, s.model, s.agent,
			s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
			s.tokens_cache_read, s.tokens_cache_write,
			s.summary_files, s.summary_additions, s.summary_deletions,
			s.time_created,
			MAX(s.time_updated,
				COALESCE((SELECT MAX(time_created) FROM message WHERE session_id = s.id), 0),
				COALESCE((SELECT MAX(time_updated) FROM part WHERE session_id = s.id), 0)) AS time_updated,
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
			s           ingest.Session
			parentID    sql.NullString
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

	openSteps, err := a.openStepSessions(ctx)
	if err == nil {
		for i := range sessions {
			sessions[i].InProgress = openSteps[sessions[i].ID]
		}
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
		s           ingest.Session
		parentID    sql.NullString
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

	err := a.db.QueryRowContext(ctx, `
		SELECT 
			s.id, s.parent_id, s.title, s.directory, s.model, s.agent,
			s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
			s.tokens_cache_read, s.tokens_cache_write,
			s.summary_files, s.summary_additions, s.summary_deletions,
			s.time_created,
			MAX(s.time_updated,
				COALESCE((SELECT MAX(time_created) FROM message WHERE session_id = s.id), 0),
				COALESCE((SELECT MAX(time_updated) FROM part WHERE session_id = s.id), 0)) AS time_updated,
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

	if open, err := a.hasOpenStep(ctx, id); err == nil {
		s.InProgress = open
	}

	return &s, nil
}
