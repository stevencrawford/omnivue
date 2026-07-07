package cursor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	sessions := make(map[string]*composerData)

	rows, err := a.db.QueryContext(ctx, `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
	if err != nil {
		return nil, fmt.Errorf("querying composer sessions: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		var cd composerData
		if err := json.Unmarshal(value, &cd); err != nil {
			continue
		}
		if cd.ComposerID == "" {
			continue
		}
		sessions[cd.ComposerID] = &cd
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	transcriptSessions := a.discoverTranscriptSessions(ctx)
	for _, ts := range transcriptSessions {
		id := ts.ID
		if _, exists := sessions[id]; !exists {
			created := ""
			updated := ""
			if !ts.CreatedAt.IsZero() {
				created = fmt.Sprintf("%d", ts.CreatedAt.UnixMilli())
			}
			if !ts.UpdatedAt.IsZero() {
				updated = fmt.Sprintf("%d", ts.UpdatedAt.UnixMilli())
			}
			sessions[id] = &composerData{
				ComposerID:    id,
				CreatedAt:     json.Number(created),
				LastUpdatedAt: json.Number(updated),
				Status:        string(ts.Status),
				IsAgentic:     true,
			}
		}
	}

	var result []ingest.Session
	for id, cd := range sessions {
		createdAt := cd.timeCreated()
		updatedAt := cd.timeUpdated()

		title := extractTitle(cd)
		dir := resolveDir(cd)
		model, cost, inputTokens, outputTokens := cd.usageInfo()

		session := ingest.Session{
			ID:           id,
			Title:        title,
			Directory:    dir,
			Repository:   deriveRepository(dir),
			Agent:        ingest.AgentCursor,
			Model:        model,
			Cost:         cost,
			Status:       mapStatus(cd.Status),
			CreatedAt:    createdAt,
			UpdatedAt:    updatedAt,
			TokensInput:  inputTokens,
			TokensOutput: outputTokens,
			MessageCount: len(cd.FullConversationHeadersOnly),
		}

		if mt := a.transcriptMtime(id); mt.After(session.UpdatedAt) {
			session.UpdatedAt = mt
		}

		result = append(result, session)
	}

	slices.SortFunc(result, func(a, b ingest.Session) int {
		ui, uj := a.UpdatedAt, b.UpdatedAt
		if ui.IsZero() && uj.IsZero() {
			return 0
		}
		if ui.IsZero() {
			return 1
		}
		if uj.IsZero() {
			return -1
		}
		return uj.Compare(ui)
	})

	return result, nil
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	var value []byte
	err := a.db.QueryRowContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key = 'composerData:`+id+`'`).Scan(&value)
	if err == nil {
		var cd composerData
		if err := json.Unmarshal(value, &cd); err == nil && cd.ComposerID != "" {
			createdAt := cd.timeCreated()
			updatedAt := cd.timeUpdated()
			title := extractTitle(&cd)
			dir := resolveDir(&cd)
			model, cost, inputTokens, outputTokens := cd.usageInfo()

			sess := &ingest.Session{
				ID:           id,
				Title:        title,
				Directory:    dir,
				Repository:   deriveRepository(dir),
				Agent:        ingest.AgentCursor,
				Model:        model,
				Cost:         cost,
				Status:       mapStatus(cd.Status),
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
				TokensInput:  inputTokens,
				TokensOutput: outputTokens,
				MessageCount: len(cd.FullConversationHeadersOnly),
			}
			if mt := a.transcriptMtime(id); mt.After(sess.UpdatedAt) {
				sess.UpdatedAt = mt
			}
			return sess, nil
		}
	}

	for _, ts := range a.discoverTranscriptSessions(ctx) {
		if ts.ID == id {
			sess := &ingest.Session{
				ID:           id,
				Agent:        ingest.AgentCursor,
				Status:       ts.Status,
				CreatedAt:    ts.CreatedAt,
				UpdatedAt:    ts.UpdatedAt,
				MessageCount: len(ts.Messages),
			}
			if mt := a.transcriptMtime(id); mt.After(sess.UpdatedAt) {
				sess.UpdatedAt = mt
			}
			return sess, nil
		}
	}

	return nil, fmt.Errorf("session not found: %s", id)
}

func extractTitle(cd *composerData) string {
	if cd.Name != "" {
		return cd.Name
	}
	if cd.LatestConversationSummary != nil && cd.LatestConversationSummary.Summary != nil {
		if t := cd.LatestConversationSummary.Summary.Summary; t != "" {
			return t
		}
	}
	if len(cd.FullConversationHeadersOnly) > 0 {
		return fmt.Sprintf("Composer %s", cd.ComposerID[:8])
	}
	return ""
}

func resolveDir(cd *composerData) string {
	for _, uri := range cd.AllAttachedFileCodeChunksUris {
		fp := strings.TrimPrefix(uri, "file://")
		if fp == uri {
			continue
		}
		parts := strings.Split(fp, string(filepath.Separator))
		depth := len(parts)
		if depth > 4 {
			return strings.Join(parts[:depth-3], string(filepath.Separator))
		}
		return fp
	}
	return ""
}

func deriveRepository(dir string) string {
	if dir == "" {
		return ""
	}
	return filepath.Base(dir)
}

func mapStatus(cursorStatus string) ingest.SessionStatus {
	switch cursorStatus {
	case "completed":
		return ingest.SessionStatusCompleted
	case "aborted":
		return ingest.SessionStatusArchived
	default:
		return ingest.SessionStatusActive
	}
}

func mapToolStatus(s string) ingest.ToolCallStatus {
	switch s {
	case "error":
		return ingest.ToolCallFailed
	case "running":
		return ingest.ToolCallRunning
	default:
		return ingest.ToolCallCompleted
	}
}

func (a *Adapter) transcriptMtime(sessionID string) time.Time {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return time.Time{}
	}
	var latest time.Time
	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if filepath.Base(filepath.Dir(path)) != sessionID {
			return nil
		}
		info, err := d.Info()
		if err == nil && info.ModTime().After(latest) {
			latest = info.ModTime()
		}
		return nil
	})
	return latest
}

func (a *Adapter) discoverTranscriptSessions(ctx context.Context) []transcriptSession {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}

	var sessions []transcriptSession

	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}

		uuidDir := filepath.Base(filepath.Dir(path))
		if uuidDir == "." || uuidDir == "agent-transcripts" {
			return nil
		}

		msgs := parseTranscriptJSONL(path)
		if len(msgs) == 0 {
			return nil
		}

		var createdAt, updatedAt time.Time
		for _, m := range msgs {
			if createdAt.IsZero() || m.Timestamp.Before(createdAt) {
				createdAt = m.Timestamp
			}
			if m.Timestamp.After(updatedAt) {
				updatedAt = m.Timestamp
			}
		}

		sessions = append(sessions, transcriptSession{
			ID:        uuidDir,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
			Status:    ingest.SessionStatusCompleted,
			Messages:  msgs,
		})
		return nil
	})

	return sessions
}

func (a *Adapter) readTranscriptMessages(ctx context.Context, sessionID string) []ingest.Message {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}

	var messages []ingest.Message

	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if filepath.Base(filepath.Dir(path)) != sessionID {
			return nil
		}
		messages = parseTranscriptJSONL(path)
		for i := range messages {
			for j := range messages[i].ToolCalls {
				a.enrichToolCall(ctx, &messages[i].ToolCalls[j])
			}
		}
		return filepath.SkipAll
	})

	return messages
}

func (cd *composerData) timeCreated() time.Time {
	return ingestkit.UnixMillis(ingestkit.ParseMillis(string(cd.CreatedAt)))
}

func (cd *composerData) timeUpdated() time.Time {
	return ingestkit.UnixMillis(ingestkit.ParseMillis(string(cd.LastUpdatedAt)))
}

func (cd *composerData) usageInfo() (model string, cost float64, inputTokens, outputTokens int) {
	if len(cd.UsageData) <= 2 {
		return "", 0, 0, 0
	}
	var m map[string]usageStat
	if err := json.Unmarshal(cd.UsageData, &m); err != nil {
		return "", 0, 0, 0
	}
	for modelName, stat := range m {
		model = modelName
		cost = stat.CostInCents / 100.0
		_ = stat.Amount
		break
	}
	return model, cost, 0, 0
}
