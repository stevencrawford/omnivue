package cursor

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"

	_ "modernc.org/sqlite"
)

// Adapter reads Cursor session data from state.vscdb (SQLite KV store) and
// optionally from agent-transcripts JSONL and ai-code-tracking.db.
type Adapter struct {
	db            *sql.DB
	vscdbPath     string
	cursorDir     string
	appSupportDir string
}

func New(vscdbPath string) (*Adapter, error) {
	resolved := resolveVscdbPath(vscdbPath)
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
			createdStr := ""
			updatedStr := ""
			if !ts.CreatedAt.IsZero() {
				createdStr = fmt.Sprintf("%d", ts.CreatedAt.UnixMilli())
			}
			if !ts.UpdatedAt.IsZero() {
				updatedStr = fmt.Sprintf("%d", ts.UpdatedAt.UnixMilli())
			}
			sessions[id] = &composerData{
				ComposerID:    id,
				CreatedAt:     json.Number(createdStr),
				LastUpdatedAt: json.Number(updatedStr),
				Status:        ts.Status,
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

		result = append(result, session)
	}

	sort.Slice(result, func(i, j int) bool {
		// Sessions with zero timestamps go to the end
		ui, uj := result[i].UpdatedAt, result[j].UpdatedAt
		if ui.IsZero() {
			return false
		}
		if uj.IsZero() {
			return true
		}
		return ui.After(uj)
	})

	return result, nil
}

func (a *Adapter) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
	sessions, err := a.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	for _, s := range sessions {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("session not found: %s", id)
}

func (a *Adapter) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
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

func (a *Adapter) GetPlan(_ context.Context, _ string) (*ingest.Plan, error) {
	return nil, nil
}

func (a *Adapter) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	messages, err := a.GetMessages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var diffs []ingest.DiffFile

	// Extract file paths from tool calls in messages
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit_file_v2" && tc.Name != "edit" && tc.Name != "write" {
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
				Status: "modified",
			})
		}
	}
	if len(diffs) > 0 {
		return diffs, nil
	}

	// Fallback: try codeBlockDiff entries
	rows, err := a.db.QueryContext(ctx,
		`SELECT key FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:`+sessionID+`:%'`)
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
			Status: "modified",
		})
	}
	return diffs, nil
}

func (a *Adapter) GetEdits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.GetMessages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for _, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}
			fp, oldStr, newStr := a.parseEditContent(ctx, tc)
			if fp == "" {
				continue
			}
			content := newStr
			if oldStr != "" {
				content = "" // prefer oldStr+newStr pair for diff rendering
			}
			edits = append(edits, ingest.FileEdit{
				FilePath: fp,
				ToolName: tc.Name,
				OldStr:   oldStr,
				NewStr:   newStr,
				Content:  content,
			})
		}
	}
	return edits, nil
}

// parseEditContent extracts file path and old/new content from a tool call,
// handling Cursor's various edit formats:
//   - inline content fields (contents, streamingContent, content, newStr)
//   - content-ID references (beforeContentId/afterContentId in output)
//   - output-embedded diff chunks
func (a *Adapter) parseEditContent(ctx context.Context, tc ingest.ToolCall) (filePath, oldStr, newStr string) {
	var input struct {
		RelativeWorkspacePath string `json:"relativeWorkspacePath"`
		FilePath             string `json:"filePath"`
		Contents             string `json:"contents"`
		Content              string `json:"content"`
		NewStr               string `json:"newStr"`
		StreamingContent     string `json:"streamingContent"`
		OldStr               string `json:"oldStr"`
		OldString            string `json:"oldString"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}

	filePath = input.FilePath
	if filePath == "" {
		filePath = input.RelativeWorkspacePath
	}
	if filePath == "" {
		return
	}

	oldStr = input.OldStr
	if oldStr == "" {
		oldStr = input.OldString
	}

	newStr = input.NewStr
	if newStr == "" {
		newStr = input.StreamingContent
	}
	if newStr == "" {
		newStr = input.Content
	}
	if newStr == "" {
		newStr = input.Contents
	}

	// If the output contains content-ID references (Cursor stores file content
	// in the KV table keyed by hash), look up the actual content. The output
	// may also embed pre-computed unified diff chunks.
	var output struct {
		BeforeContentID string `json:"beforeContentId"`
		AfterContentID  string `json:"afterContentId"`
		Diff            *struct {
			Chunks []struct {
				DiffString string `json:"diffString"`
			} `json:"chunks"`
		} `json:"diff"`
		Contents string `json:"contents"`
	}
	if err := json.Unmarshal([]byte(tc.Output), &output); err == nil {
		if output.BeforeContentID != "" {
			if c := a.readContentBlock(ctx, output.BeforeContentID); c != "" {
				oldStr = truncateContent(c)
			}
		}
		if output.AfterContentID != "" {
			if c := a.readContentBlock(ctx, output.AfterContentID); c != "" {
				newStr = truncateContent(c)
			}
		}
		if newStr == "" && output.Contents != "" {
			newStr = output.Contents
		}
	}

	return
}

// maxContentBytes caps the size of content injected into tool call input/output
// fields. Large file blobs blow up the API payload and crash the browser.
const maxContentBytes = 2000

// truncateContent returns content truncated to maxContentBytes, appending a
// notice if truncated. This keeps API payloads manageable while still providing
// enough context for diff rendering.
func truncateContent(s string) string {
	if len(s) <= maxContentBytes {
		return s
	}
	// Truncate at the last newline within the limit so we don't break mid-line.
	end := strings.LastIndex(s[:maxContentBytes], "\n")
	if end < 0 {
		end = maxContentBytes
	}
	return s[:end] + "\n… (truncated)"
}

// readContentBlock looks up a composer.content.<hash> key in the KV store.
// The contentID may or may not include the "composer.content." prefix.
func (a *Adapter) readContentBlock(ctx context.Context, contentID string) string {
	key := contentID
	if !strings.HasPrefix(key, "composer.content.") {
		key = "composer.content." + key
	}
	var value []byte
	err := a.db.QueryRowContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key = ?`, key).Scan(&value)
	if err != nil {
		return ""
	}
	return string(value)
}

// enrichToolCall resolves content-ID references in the tool call's output and
// populates the input with the actual file content. This ensures the Session
// tab's EditToolDiff component sees oldStr/newStr instead of cloudAgentEdit.
func (a *Adapter) enrichToolCall(ctx context.Context, tc *ingest.ToolCall) {
	if tc.Name != "edit" {
		return
	}
	var output struct {
		BeforeContentID string `json:"beforeContentId"`
		AfterContentID  string `json:"afterContentId"`
	}
	if err := json.Unmarshal([]byte(tc.Output), &output); err != nil {
		return
	}
	if output.AfterContentID == "" && output.BeforeContentID == "" {
		return
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if after := a.readContentBlock(ctx, output.AfterContentID); after != "" {
		if _, exists := input["newString"]; !exists {
			input["newString"] = truncateContent(after)
			delete(input, "noCodeblock")
			delete(input, "cloudAgentEdit")
		}
	}
	if before := a.readContentBlock(ctx, output.BeforeContentID); before != "" {
		if _, exists := input["oldString"]; !exists {
			input["oldString"] = truncateContent(before)
		}
	}
	if out, err := json.Marshal(input); err == nil {
		tc.Input = string(out)
	}
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
		ms := parseMillis(cd.LastUpdatedAt)
		if ms > maxTs {
			maxTs = ms
		}
	}

	transcriptDir := filepath.Join(a.cursorDir, "projects")
	if pathExists(transcriptDir) {
		filepath.WalkDir(transcriptDir, func(path string, d os.DirEntry, err error) error {
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

// --- Internal types ---

type composerContext struct {
	Mentions *mentionsData `json:"mentions,omitempty"`
}

type mentionsData struct {
	FolderSelections map[string][]interface{} `json:"folderSelections,omitempty"`
}

type composerData struct {
	V                             int                    `json:"_v"`
	ComposerID                    string                 `json:"composerId"`
	Name                          string                 `json:"name"`
	CreatedAt                     json.Number            `json:"createdAt"`
	LastUpdatedAt                 json.Number            `json:"lastUpdatedAt"`
	Status                        string                 `json:"status"`
	IsAgentic                     bool                   `json:"isAgentic"`
	LatestConversationSummary     *conversationSummary   `json:"latestConversationSummary,omitempty"`
	FullConversationHeadersOnly   []bubbleReference      `json:"fullConversationHeadersOnly,omitempty"`
	UsageData                     json.RawMessage        `json:"usageData,omitempty"`
	Context                       *composerContext       `json:"context,omitempty"`
	ConversationState             string                 `json:"conversationState,omitempty"`
	UnifiedMode                   string                 `json:"unifiedMode,omitempty"`
	AllAttachedFileCodeChunksUris []string               `json:"allAttachedFileCodeChunksUris,omitempty"`
}

type conversationSummary struct {
	Summary *conversationSummaryInner `json:"summary,omitempty"`
	LastBubbleID string               `json:"lastBubbleId,omitempty"`
}

type conversationSummaryInner struct {
	Summary string `json:"summary"`
}

type bubbleReference struct {
	BubbleID string `json:"bubbleId"`
	Type     int    `json:"type"`
}

type usageStat struct {
	CostInCents float64 `json:"costInCents"`
	Amount      float64 `json:"amount"`
}

type bubbleData struct {
	V                 int              `json:"_v"`
	Type              int              `json:"type"`
	BubbleID          string           `json:"bubbleId"`
	Text              string           `json:"text"`
	RichText          json.RawMessage  `json:"richText,omitempty"`
	IsAgentic         bool             `json:"isAgentic"`
	TokenCount        *tokenData       `json:"tokenCount,omitempty"`
	ToolFormerData    *toolData        `json:"toolFormerData,omitempty"`
	Capabilities      []capabilityData `json:"capabilities,omitempty"`
	CodeBlocks        []codeBlockData  `json:"codeBlocks,omitempty"`
	RelevantFiles     []string         `json:"relevantFiles,omitempty"`
	CreatedAt         string           `json:"createdAt"`
	ConversationState string           `json:"conversationState,omitempty"`
}

type tokenData struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type toolData struct {
	Tool        int    `json:"tool"`
	ToolIndex   int    `json:"toolIndex"`
	ModelCallID string `json:"modelCallId"`
	ToolCallID  string `json:"toolCallId"`
	Status      string `json:"status"`
	Name        string `json:"name"`
	Params      string `json:"params"`
	Result      string `json:"result"`
}

type capabilityData struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type codeBlockData struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Path string `json:"path"`
}

type transcriptSession struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	Status    string
	Messages  []ingest.Message
}

// --- composerData helpers ---

func (cd *composerData) timeCreated() time.Time {
	return unixMillis(parseMillis(cd.CreatedAt))
}

func (cd *composerData) timeUpdated() time.Time {
	return unixMillis(parseMillis(cd.LastUpdatedAt))
}

func (cd *composerData) usageInfo() (model string, cost float64, inputTokens, outputTokens int) {
	if cd.UsageData == nil || len(cd.UsageData) <= 2 {
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

// --- Agent-transcripts JSONL reader ---

func (a *Adapter) discoverTranscriptSessions(ctx context.Context) []transcriptSession {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !pathExists(projectsDir) {
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
			Status:    "completed",
			Messages:  msgs,
		})
		return nil
	})

	return sessions
}

func (a *Adapter) readTranscriptMessages(ctx context.Context, sessionID string) []ingest.Message {
	projectsDir := filepath.Join(a.cursorDir, "projects")
	if !pathExists(projectsDir) {
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

func parseTranscriptJSONL(path string) []ingest.Message {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var messages []ingest.Message
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var envelope struct {
			Role    string `json:"role"`
			Message struct {
				Content []struct {
					Type  string          `json:"type"`
					Text  string          `json:"text"`
					Name  string          `json:"name,omitempty"`
					Input json.RawMessage `json:"input,omitempty"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &envelope); err != nil {
			continue
		}

		var contentParts []string
		var toolCalls []ingest.ToolCall
		for _, c := range envelope.Message.Content {
			switch c.Type {
			case "text":
				contentParts = append(contentParts, c.Text)
			case "tool_use":
				tc := ingest.ToolCall{
					ID:     fmt.Sprintf("tool-%d", len(toolCalls)),
					Name:   c.Name,
					Input:  string(c.Input),
					Status: "completed",
				}
				normalizeToolCall(&tc)
				toolCalls = append(toolCalls, tc)
			}
		}

		messages = append(messages, ingest.Message{
			ID:        fmt.Sprintf("msg-%d", len(messages)),
			Role:      envelope.Role,
			Content:   strings.Join(contentParts, "\n"),
			ToolCalls: toolCalls,
		})
	}

	return messages
}

// --- Bubble message reader ---

func (a *Adapter) readBubbleMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	var value []byte
	err := a.db.QueryRowContext(ctx,
		`SELECT value FROM cursorDiskKV WHERE key = 'composerData:`+sessionID+`'`).Scan(&value)
	if err != nil {
		return nil, fmt.Errorf("composer session not found: %w", err)
	}

	var cd composerData
	if err := json.Unmarshal(value, &cd); err != nil {
		return nil, fmt.Errorf("parsing composer data: %w", err)
	}

	bubbles := cd.FullConversationHeadersOnly

	var messages []ingest.Message
	for _, ref := range bubbles {
		bubbleKey := fmt.Sprintf("bubbleId:%s:%s", sessionID, ref.BubbleID)
		var bValue []byte
		err := a.db.QueryRowContext(ctx,
			`SELECT value FROM cursorDiskKV WHERE key = ?`, bubbleKey).Scan(&bValue)
		if err != nil {
			continue
		}

		var bd bubbleData
		if err := json.Unmarshal(bValue, &bd); err != nil {
			continue
		}

		role := "user"
		if bd.Type == 2 {
			role = "assistant"
		}

		content := bd.Text
		if content == "" && bd.RichText != nil {
			content = extractTextFromRichText(bd.RichText)
		}

		msg := ingest.Message{
			ID:        bd.BubbleID,
			Role:      role,
			Content:   content,
			Timestamp: parseTime(bd.CreatedAt),
		}

		if content == "" && role == "assistant" {
			if msg.Metadata == nil {
				msg.Metadata = make(map[string]string)
			}
			msg.Metadata["privacy"] = "true"
		}

		if bd.ToolFormerData != nil {
			tc := ingest.ToolCall{
				ID:     bd.ToolFormerData.ToolCallID,
				Name:   bd.ToolFormerData.Name,
				Input:  bd.ToolFormerData.Params,
				Output: bd.ToolFormerData.Result,
				Status: mapToolStatus(bd.ToolFormerData.Status),
			}
			normalizeToolCall(&tc)
			a.enrichToolCall(ctx, &tc)
			msg.ToolCalls = append(msg.ToolCalls, tc)
		}

		messages = append(messages, msg)
	}

	return messages, nil
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

func mapStatus(cursorStatus string) string {
	switch cursorStatus {
	case "completed":
		return "completed"
	case "aborted":
		return "archived"
	default:
		return "active"
	}
}

func mapToolStatus(s string) string {
	switch s {
	case "error":
		return "failed"
	case "running":
		return "running"
	default:
		return "completed"
	}
}

// extractJSONString parses raw as JSON and returns the value of the given key
// if it is a string. Returns raw unchanged on any failure.
func extractJSONString(raw, key string) string {
	if !json.Valid([]byte(raw)) {
		return raw
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return raw
	}
	if s, ok := m[key].(string); ok {
		return s
	}
	return raw
}

// formatGlobOutput parses Cursor's glob output JSON and returns a
// newline-separated list of file paths suitable for the frontend.
// Returns "" if the JSON doesn't match the expected format.
func formatGlobOutput(raw string) string {
	var resp struct {
		Directories []struct {
			AbsPath string `json:"absPath"`
			Files   []struct {
				RelPath string `json:"relPath"`
			} `json:"files"`
		} `json:"directories"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return ""
	}
	var lines []string
	for _, dir := range resp.Directories {
		for _, f := range dir.Files {
			p := f.RelPath
			if dir.AbsPath != "" && !strings.HasPrefix(p, "/") {
				p = dir.AbsPath + "/" + p
			}
			lines = append(lines, p)
		}
	}
	return strings.Join(lines, "\n")
}

// extractBashOutput parses Cursor's run_terminal output JSON and returns the
// text output plus whether the command was rejected (non-zero exit).
func extractBashOutput(raw string) (text string, rejected bool) {
	var resp struct {
		Output   string `json:"output"`
		Rejected bool   `json:"rejected"`
	}
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return raw, false
	}
	return resp.Output, resp.Rejected
}

// normalizeToolCall maps Cursor-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers.
func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "edit_file_v2":
		tc.Name = "edit"
	case "read_file_v2":
		tc.Name = "read"
	case "glob_file_search":
		tc.Name = "glob"
	case "ripgrep_raw_search":
		tc.Name = "grep"
	case "run_terminal_command_v2":
		tc.Name = "bash"
	case "delete_file":
		tc.Name = "delete"
	default:
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	switch tc.Name {
	case "read":
		if v, ok := p["targetFile"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "targetFile")
		}
		if v, ok := p["effectiveUri"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "effectiveUri")
		}
		if v, ok := p["relativeWorkspacePath"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "relativeWorkspacePath")
		}
		delete(p, "charsLimit")
		// Cursor read output: {"contents":"...","totalLinesInFile":N} → raw text
		tc.Output = extractJSONString(tc.Output, "contents")

	case "edit":
		if v, ok := p["relativeWorkspacePath"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "relativeWorkspacePath")
		}
		if v, ok := p["contents"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "contents")
		}
		if v, ok := p["streamingContent"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "streamingContent")
		}
		if v, ok := p["newStr"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "newStr")
		}
		if v, ok := p["oldStr"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "oldStr")
		}

	case "grep":
		if v, ok := p["pattern"]; ok {
			if _, exists := p["query"]; !exists {
				p["query"] = v
			}
			delete(p, "pattern")
		}

	case "glob":
		if v, ok := p["globPattern"]; ok {
			if _, exists := p["pattern"]; !exists {
				p["pattern"] = v
			}
			delete(p, "globPattern")
		}
		if v, ok := p["targetDirectory"]; ok {
			if _, exists := p["directory"]; !exists {
				p["directory"] = v
			}
			delete(p, "targetDirectory")
		}
		// Cursor glob output: {"directories":[{"absPath":"...","files":[{"relPath":"..."}]}]}
		// → newline-separated file paths
		if out := formatGlobOutput(tc.Output); out != "" {
			tc.Output = out
		}

	case "bash":
		// Cursor bash output: {"output":"...","rejected":bool,"notInterrupted":bool}
		// Extract the text and surface exit status in Metadata
		if text, rejected := extractBashOutput(tc.Output); rejected {
			tc.Output = text
			tc.Metadata = `{"exit":1}`
		} else if text != "" {
			tc.Output = text
		}
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}

func parseMillis(n json.Number) int64 {
	if n == "" {
		return 0
	}
	// Try integer (milliseconds)
	if ms, err := n.Int64(); err == nil {
		return ms
	}
	// Try float (seconds with decimals, though unlikely)
	if f, err := n.Float64(); err == nil {
		return int64(f)
	}
	return 0
}

func unixMillis(ms int64) time.Time {
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err == nil {
		return t
	}
	t, err = time.Parse("2006-01-02T15:04:05.999Z07:00", s)
	if err == nil {
		return t
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.999999999Z",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05",
	} {
		t, err := time.Parse(layout, s)
		if err == nil {
			return t
		}
	}
	return time.Time{}
}

func extractTextFromRichText(rt json.RawMessage) string {
	var node struct {
		Text     string            `json:"text"`
		Children []json.RawMessage `json:"children"`
	}
	if err := json.Unmarshal(rt, &node); err != nil {
		return ""
	}
	if node.Text != "" {
		return node.Text
	}
	var parts []string
	for _, child := range node.Children {
		if t := extractTextFromRichText(child); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n")
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// resolveVscdbPath resolves a Cursor entry path (directory or file) to the
// actual state.vscdb database path. It searches common locations relative to
// the entry point, and falls back to macOS/Linux App Support paths.
func resolveVscdbPath(entry string) string {
	if entry == "" {
		return ""
	}
	candidates := []string{
		entry,
		filepath.Join(entry, "state.vscdb"),
		filepath.Join(entry, "User", "globalStorage", "state.vscdb"),
	}
	home, err := os.UserHomeDir()
	if err == nil {
		candidates = append(candidates,
			filepath.Join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
			filepath.Join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
		)
	}
	for _, c := range candidates {
		if pathExists(c) {
			if fi, err := os.Stat(c); err == nil && fi.IsDir() {
				c = filepath.Join(c, "state.vscdb")
				if !pathExists(c) {
					continue
				}
			}
			return c
		}
	}
	return ""
}

func resolveCursorDir(vscdbPath string) string {
	dir := filepath.Dir(vscdbPath)
	for i := 0; i < 5; i++ {
		if filepath.Base(dir) == "Cursor" {
			return filepath.Join(homeDirFallback(), ".cursor")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	home, err := os.UserHomeDir()
	if err == nil {
		cursorDir := filepath.Join(home, ".cursor")
		if pathExists(cursorDir) {
			return cursorDir
		}
	}
	return filepath.Dir(filepath.Dir(vscdbPath))
}

func resolveAppSupportDir(vscdbPath string) string {
	dir := filepath.Dir(vscdbPath)
	for i := 0; i < 5; i++ {
		if filepath.Base(dir) == "Cursor" {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	home, err := os.UserHomeDir()
	if err == nil {
		paths := []string{
			filepath.Join(home, "Library", "Application Support", "Cursor"),
			filepath.Join(home, ".config", "Cursor"),
		}
		for _, p := range paths {
			if pathExists(p) {
				return p
			}
		}
	}
	return filepath.Dir(filepath.Dir(vscdbPath))
}

func homeDirFallback() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp"
	}
	return home
}

// --- ai-code-tracking.db reader (unused currently but available for enrichment) ---

type conversationSummaryRow struct {
	ConversationID string  `json:"conversationId"`
	Title          string  `json:"title"`
	TLDR           string  `json:"tldr"`
	Overview       string  `json:"overview"`
	Model          string  `json:"model"`
	Mode           string  `json:"mode"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
	Cost           float64 `json:"cost"`
	InputTokens    int     `json:"inputTokens"`
	OutputTokens   int     `json:"outputTokens"`
}

func (a *Adapter) readConversationSummaries(ctx context.Context) map[string]conversationSummaryRow {
	result := make(map[string]conversationSummaryRow)

	dbPath := filepath.Join(a.appSupportDir, "User", "globalStorage", "ai-code-tracking.db")
	if !pathExists(dbPath) {
		return result
	}

	db, err := ingest.OpenReadOnlyDB(dbPath)
	if err != nil {
		return result
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx,
		`SELECT conversationId, title, tldr, overview, model, mode, createdAt, updatedAt, cost, inputTokens, outputTokens FROM conversation_summaries`)
	if err != nil {
		return result
	}
	defer rows.Close()

	for rows.Next() {
		var r conversationSummaryRow
		if err := rows.Scan(&r.ConversationID, &r.Title, &r.TLDR, &r.Overview,
			&r.Model, &r.Mode, &r.CreatedAt, &r.UpdatedAt,
			&r.Cost, &r.InputTokens, &r.OutputTokens); err != nil {
			continue
		}
		if r.ConversationID != "" {
			result[r.ConversationID] = r
		}
	}

	return result
}
