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
