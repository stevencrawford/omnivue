package cursor

import (
	"context"
	"database/sql"
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
	sessions, err := a.listComposerSummaries(ctx)
	if err != nil {
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
			sessions[id] = &composerSummary{
				ComposerID:    id,
				CreatedAt:     json.Number(created),
				LastUpdatedAt: json.Number(updated),
				Status:        string(ts.Status),
			}
		}
	}

	result := make([]ingest.Session, 0, len(sessions))
	mtimes := a.transcriptMtimes()
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
			MessageCount: cd.MessageCount,
		}

		if mt := mtimes[id]; mt.After(session.UpdatedAt) {
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
			sum := summaryOf(&cd)
			createdAt := sum.timeCreated()
			updatedAt := sum.timeUpdated()
			title := extractTitle(sum)
			dir := resolveDir(sum)
			model, cost, inputTokens, outputTokens := sum.usageInfo()

			sess := &ingest.Session{
				ID:           id,
				Title:        title,
				Directory:    dir,
				Repository:   deriveRepository(dir),
				Agent:        ingest.AgentCursor,
				Model:        model,
				Cost:         cost,
				Status:       mapStatus(sum.Status),
				CreatedAt:    createdAt,
				UpdatedAt:    updatedAt,
				TokensInput:  inputTokens,
				TokensOutput: outputTokens,
				MessageCount: sum.MessageCount,
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

func summaryOf(cd *composerData) *composerSummary {
	sum := &composerSummary{
		ComposerID:    cd.ComposerID,
		Name:          cd.Name,
		CreatedAt:     cd.CreatedAt,
		LastUpdatedAt: cd.LastUpdatedAt,
		Status:        cd.Status,
		MessageCount:  len(cd.FullConversationHeadersOnly),
		UsageData:     cd.UsageData,
	}
	sum.AllAttachedFileCodeChunksUris = append([]string(nil), cd.AllAttachedFileCodeChunksUris...)
	if cd.LatestConversationSummary != nil && cd.LatestConversationSummary.Summary != nil {
		sum.SummaryTitle = cd.LatestConversationSummary.Summary.Summary
	}
	return sum
}

// listComposerSummaries returns a lean projection of every composerData row,
// extracted in SQL so the large conversation/capabilities blobs are never read
// or parsed into Go.
func (a *Adapter) listComposerSummaries(ctx context.Context) (map[string]*composerSummary, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT
		json_extract(value, '$.composerId'),
		json_extract(value, '$.name'),
		json_extract(value, '$.createdAt'),
		json_extract(value, '$.lastUpdatedAt'),
		json_extract(value, '$.status'),
		json_array_length(value, '$.fullConversationHeadersOnly'),
		json_extract(value, '$.usageData'),
		json_extract(value, '$.latestConversationSummary.summary.summary'),
		json_extract(value, '$.allAttachedFileCodeChunksUris')
		FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
	if err != nil {
		return nil, fmt.Errorf("querying composer sessions: %w", err)
	}
	defer rows.Close()

	sessions := make(map[string]*composerSummary)
	for rows.Next() {
		var (
			id, name     sql.NullString
			created, up  sql.NullString
			status       sql.NullString
			msgCount     sql.NullInt64
			usageData    []byte
			summaryTitle sql.NullString
			urisJSON     []byte
		)
		if err := rows.Scan(&id, &name, &created, &up, &status,
			&msgCount, &usageData, &summaryTitle, &urisJSON); err != nil {
			continue
		}
		if !id.Valid || id.String == "" {
			continue
		}

		var uris []string
		if len(urisJSON) > 0 {
			if err := json.Unmarshal(urisJSON, &uris); err != nil {
				uris = nil
			}
		}

		sessions[id.String] = &composerSummary{
			ComposerID:                    id.String,
			Name:                          name.String,
			CreatedAt:                     json.Number(created.String),
			LastUpdatedAt:                 json.Number(up.String),
			Status:                        status.String,
			MessageCount:                  int(msgCount.Int64),
			UsageData:                     usageData,
			SummaryTitle:                  summaryTitle.String,
			AllAttachedFileCodeChunksUris: uris,
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}

func extractTitle(cd *composerSummary) string {
	if cd.Name != "" {
		return cd.Name
	}
	if cd.SummaryTitle != "" {
		return cd.SummaryTitle
	}
	if cd.MessageCount > 0 {
		return fmt.Sprintf("Composer %s", cd.ComposerID[:8])
	}
	return ""
}

func resolveDir(cd *composerSummary) string {
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
	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
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

// transcriptMtimes walks the projects tree once and returns the latest jsonl
// mtime per session directory, so ListSessions can avoid walking the tree once
// per session.
func (a *Adapter) transcriptMtimes() map[string]time.Time {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}
	mtimes := make(map[string]time.Time)
	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		sessionID := filepath.Base(filepath.Dir(path))
		info, err := d.Info()
		if err == nil && info.ModTime().After(mtimes[sessionID]) {
			mtimes[sessionID] = info.ModTime()
		}
		return nil
	})
	return mtimes
}

func (a *Adapter) discoverTranscriptSessions(ctx context.Context) []transcriptSession {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}

	var sessions []transcriptSession

	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
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

	filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
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

func (s *composerSummary) timeCreated() time.Time {
	return ingestkit.UnixMillis(ingestkit.ParseMillis(string(s.CreatedAt)))
}

func (s *composerSummary) timeUpdated() time.Time {
	return ingestkit.UnixMillis(ingestkit.ParseMillis(string(s.LastUpdatedAt)))
}

func (s *composerSummary) usageInfo() (model string, cost float64, inputTokens, outputTokens int) {
	if len(s.UsageData) <= 2 {
		return "", 0, 0, 0
	}
	var m map[string]usageStat
	if err := json.Unmarshal(s.UsageData, &m); err != nil {
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
