package cursor

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"

	_ "modernc.org/sqlite"
)

func init() {
	ingest.Register(ingest.AgentCursor, "Cursor", "~/.cursor",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

// detectPath checks whether the given path contains a Cursor state database.
func detectPath(path string) *ingest.DiscoveredSource {
	dbPath := ingestkit.FindCursorVscdbPath(path)
	if dbPath != "" {
		return &ingest.DiscoveredSource{
			Path:      dbPath,
			AgentType: ingest.AgentCursor,
			Label:     "Cursor",
		}
	}
	return nil
}

// Adapter reads Cursor session data from state.vscdb (SQLite KV store) and
// optionally from agent-transcripts JSONL and ai-code-tracking.db.
type Adapter struct {
	db            *sql.DB
	vscdbPath     string
	cursorDir     string
	appSupportDir string
}

func New(vscdbPath string) (*Adapter, error) {
	resolved := ingestkit.FindCursorVscdbPath(vscdbPath)
	if resolved == "" {
		return nil, fmt.Errorf("cursor adapter: no state.vscdb found at %s", vscdbPath)
	}
	db, err := ingest.OpenReadOnlyDB(resolved)
	if err != nil {
		return nil, fmt.Errorf("cursor adapter: %w", err)
	}

	a := &Adapter{
		db:        db,
		vscdbPath: resolved,
	}
	a.cursorDir = resolveCursorDir(resolved)
	a.appSupportDir = resolveAppSupportDir(resolved)

	return a, nil
}

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentCursor
}

func (a *Adapter) Detect(path string) bool {
	return path == a.vscdbPath
}

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

		// Override UpdatedAt with transcript file mtime if newer, so the polling
		// loop detects changes in transcript-only sessions (no KV store updates).
		if mt := a.transcriptMtime(id); mt.After(session.UpdatedAt) {
			session.UpdatedAt = mt
		}

		result = append(result, session)
	}

	slices.SortFunc(result, func(a, b ingest.Session) int {
		// Sessions with zero timestamps go to the end
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
	// Try composer data from KV store first
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

	// Fallback: try transcript sessions
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

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	// Bubble messages contain full content plus tool calls. Prefer them when
	// available, and only fall back to the transcript summary (which omits
	// tool calls) when no bubble data exists.
	if msgs, err := a.readBubbleMessages(ctx, sessionID); err == nil {
		if len(msgs) > 0 {
			return msgs, nil
		}
	} else {
		// Log the error but continue to try transcript fallback
		slog.Warn("cursor: bubble messages unavailable", "session", sessionID, "error", err)
	}
	if msgs := a.readTranscriptMessages(ctx, sessionID); len(msgs) > 0 {
		return msgs, nil
	}
	return nil, nil
}

func (a *Adapter) Plan(_ context.Context, _ string) (*ingest.Plan, error) {
	return nil, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	messages, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var diffs []ingest.DiffFile

	// Extract file paths from tool calls in messages
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit_file_v2" && tc.Name != "edit_file" && tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			var p struct {
				RelativeWorkspacePath string `json:"relativeWorkspacePath"`
				FilePath             string `json:"filePath"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
				continue
			}
			fp := p.FilePath
			if fp == "" {
				fp = p.RelativeWorkspacePath
			}
			if fp == "" || seen[fp] {
				continue
			}
			seen[fp] = true
			diffs = append(diffs, ingest.DiffFile{
				Path:   fp,
				Status: ingest.DiffModified,
			})
		}
	}
	if len(diffs) > 0 {
		return diffs, nil
	}

	// Fallback: try codeBlockDiff entries
	rows, err := a.db.QueryContext(ctx,
		`SELECT key FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:`+sessionID+`:%'`) //nolint:gosec
	if err != nil {
		return nil, fmt.Errorf("querying diffs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			continue
		}
		parts := strings.Split(key, ":")
		uuid := ""
		if len(parts) >= 3 {
			uuid = parts[2]
		}
		diffs = append(diffs, ingest.DiffFile{
			Path:   uuid,
			Status: ingest.DiffModified,
		})
	}
	return diffs, nil
}

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for _, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			fp, oldContent, newContent := a.parseEditContent(ctx, tc)
			if fp == "" {
				continue
			}
			content := newContent
			if oldContent != "" {
				content = ""
			}
			edits = append(edits, ingest.FileEdit{
				FilePath: fp,
				ToolName: tc.Name,
				OldStr:   oldContent,
				NewStr:   newContent,
				Content:  content,
			})
		}
	}
	return edits, nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	dir := session.Directory
	if dir == "" {
		dir = "."
	}
	return fmt.Sprintf("cd %s && cursor --composer %s", dir, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	var maxTs int64

	rows, err := a.db.QueryContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
	if err != nil {
		return 0, fmt.Errorf("querying last modified: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var value []byte
		if err := rows.Scan(&value); err != nil {
			continue
		}
		var cd struct {
			LastUpdatedAt json.Number `json:"lastUpdatedAt"`
		}
		if err := json.Unmarshal(value, &cd); err != nil {
			continue
		}
		ms := ingestkit.ParseMillis(string(cd.LastUpdatedAt))
		if ms > maxTs {
			maxTs = ms
		}
	}

	transcriptDir := filepath.Join(a.cursorDir, "projects")
	if ingestkit.PathExists(transcriptDir) {
		filepath.WalkDir(transcriptDir, func(path string, d os.DirEntry, err error) error { //nolint:errcheck
			if err != nil {
				return nil
			}
			if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
				if fi, e := d.Info(); e == nil {
					if ms := fi.ModTime().UnixMilli(); ms > maxTs {
						maxTs = ms
					}
				}
			}
			return nil
		})
	}

	return maxTs, nil
}

func (a *Adapter) Close() error {
	return a.db.Close()
}

// --- Helpers ---

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
	// Extract workspace root from file URIs (all down to common prefix)
	for _, uri := range cd.AllAttachedFileCodeChunksUris {
		fp := strings.TrimPrefix(uri, "file://")
		if fp == uri {
			continue
		}
		// Walk up 3-4 directories from a src/ file to find project root
		parts := strings.Split(fp, string(filepath.Separator))
		// Find a likely project root (contains package.json, go.mod, etc.) or go up 4 levels
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

// transcriptMtime returns the modification time of the most recently modified
// JSONL file in the session's transcript directory. Returns zero time if no
// transcript files are found, allowing the caller to use the zero-value guard
// pattern (mt.After(session.UpdatedAt)).
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

// --- composerData helpers ---

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
