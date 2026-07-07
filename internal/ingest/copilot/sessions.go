package copilot

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	a.sessionsMu.RLock()
	cached := a.cachedSessions
	a.sessionsMu.RUnlock()
	if len(cached) > 0 {
		return cached, nil
	}

	var tblCount int
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sessions'`).Scan(&tblCount); err != nil || tblCount == 0 {
		return nil, nil
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT id, cwd, repository, branch, summary, created_at, updated_at,
		       (SELECT COUNT(*) FROM session_files WHERE session_id = sessions.id) AS file_count
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
			fileCount  int
		)

		err := rows.Scan(&s.ID, &cwd, &repository, &branch, &summary, &createdAt, &updatedAt, &fileCount)
		if err != nil {
			return nil, fmt.Errorf("scanning session row: %w", err)
		}

		s.Agent = ingest.AgentCopilot
		s.Title = summary.String
		s.Directory = cwd.String
		s.Repository = repository.String
		s.Branch = branch.String
		s.Status = ingest.SessionStatusCompleted
		s.CreatedAt = ingestkit.ParseTime(createdAt)
		s.UpdatedAt = ingestkit.ParseTime(updatedAt)

		eventsPath := filepath.Join(a.basePath, "session-state", s.ID, "events.jsonl")
		if info, err := os.Stat(eventsPath); err == nil && info.ModTime().After(s.UpdatedAt) {
			s.UpdatedAt = info.ModTime()
		}

		if s.Title == "" {
			s.Title = filepath.Base(s.Directory)
		}

		s.DiffFiles = fileCount

		if meta, msgCount := a.metadataFromEvents(s.ID); meta != nil {
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
			s.MessageCount = msgCount
		}

		dbIDs[s.ID] = true
		sessions = append(sessions, s)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	stateDir := filepath.Join(a.basePath, "session-state")
	entries, err := os.ReadDir(stateDir)
	if err != nil {
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
		title := id
		if len(id) > 8 {
			title = id[:8] + "..."
		}
		s := ingest.Session{
			ID:        id,
			Agent:     ingest.AgentCopilot,
			Title:     title,
			Status:    ingest.SessionStatusActive,
			CreatedAt: info.ModTime(),
			UpdatedAt: info.ModTime(),
		}
		if meta, msgCount := a.metadataFromEvents(id); meta != nil {
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
			s.MessageCount = msgCount
		}
		sessions = append(sessions, s)
	}

	sessions = a.appendSyntheticSessions(sessions)

	slices.SortFunc(sessions, func(a, b ingest.Session) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})

	a.sessionsMu.Lock()
	a.cachedSessions = sessions
	a.sessionsMu.Unlock()

	return sessions, nil
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	a.mu.Lock()
	if syn, ok := a.syntheticSessions[id]; ok {
		a.mu.Unlock()
		s := syn.session
		return &s, nil
	}
	a.mu.Unlock()

	var tblCount int
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sessions'`).Scan(&tblCount); err != nil || tblCount == 0 {
		return nil, fmt.Errorf("session not found: %s", id)
	}

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
		SELECT id, cwd, repository, branch, summary, created_at, updated_at,
		       (SELECT COUNT(*) FROM session_files WHERE session_id = sessions.id) AS file_count
		FROM sessions WHERE id = ?
	`, id).Scan(&s.ID, &cwd, &repository, &branch, &summary, &createdAt, &updatedAt, &s.DiffFiles)
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
	s.Status = ingest.SessionStatusCompleted
	s.CreatedAt = ingestkit.ParseTime(createdAt)
	s.UpdatedAt = ingestkit.ParseTime(updatedAt)

	if s.Title == "" {
		s.Title = filepath.Base(s.Directory)
	}

	if meta, _ := a.metadataFromEvents(id); meta != nil {
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

	if todos := a.loadSessionTodos(id); len(todos) > 0 {
		s.TODOs = todos
	}

	return &s, nil
}

func (a *Adapter) appendSyntheticSessions(sessions []ingest.Session) []ingest.Session {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, syn := range a.syntheticSessions {
		sessions = append(sessions, syn.session)
	}
	return sessions
}
