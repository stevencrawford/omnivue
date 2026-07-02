package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/internal/ingestutil"
)

type Adapter struct {
	basePath string
	mu       sync.RWMutex
	sessions []ingest.Session
	lastMod  int64
}

func New(basePath string) (*Adapter, error) {
	if len(basePath) > 1 && basePath[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err == nil {
			basePath = home + basePath[1:]
		}
	}
	// Walk up one level if basePath is a sessions/ subdirectory
	if !hasIndexFile(basePath) {
		parent := filepath.Dir(basePath)
		if hasIndexFile(parent) {
			basePath = parent
		}
	}
	if !hasIndexFile(basePath) {
		return nil, fmt.Errorf("codex adapter: session_index.jsonl not found at %s", basePath)
	}
	return &Adapter{basePath: basePath}, nil
}

func hasIndexFile(basePath string) bool {
	_, err := os.Stat(filepath.Join(basePath, "session_index.jsonl"))
	return err == nil
}

// --- Exported methods ---

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentCodex
}

func (a *Adapter) Detect(path string) bool {
	indexPath := filepath.Join(path, "session_index.jsonl")
	_, err := os.Stat(indexPath)
	return err == nil
}

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	a.mu.RLock()
	cached := a.sessions
	a.mu.RUnlock()
	if len(cached) > 0 {
		return cached, nil
	}
	return a.loadSessions(ctx)
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	// Check cache first (fast path)
	a.mu.RLock()
	if len(a.sessions) > 0 {
		for i := range a.sessions {
			if a.sessions[i].ID == id {
				s := a.sessions[i]
				a.mu.RUnlock()
				return &s, nil
			}
		}
	}
	a.mu.RUnlock()

	// Fallback: find just the one session by scanning the index for this ID
	indexPath := filepath.Join(a.basePath, "session_index.jsonl")
	indexEntries, err := readIndex(indexPath)
	if err != nil {
		return nil, fmt.Errorf("codex adapter: reading index: %w", err)
	}

	for _, entry := range indexEntries {
		if entry.ID == id {
			return a.resolveSessionFromIndex(ctx, entry)
		}
	}

	// Last resort: scan the filesystem for the session file directly.
	// This covers orphan sessions not yet in session_index.jsonl.
	fpath := a.sessionFilePath(id)
	if fpath != "" {
		return a.parseSessionFileMinimal(ctx, id, fpath)
	}

	return nil, fmt.Errorf("session not found: %s", id)
}

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parseMessages(fpath, sessionID)
}

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var sections []string
	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		if env.Type != "event_msg" {
			continue
		}

		var pl eventMsgPayload
		if err := json.Unmarshal(env.Payload, &pl); err != nil {
			continue
		}
		if pl.Type != "item_completed" || pl.Item == nil || pl.Item.Type != "Plan" {
			continue
		}

		text := strings.TrimSpace(pl.Item.Text)
		if text != "" {
			sections = append(sections, text)
		}
	}

	if len(sections) == 0 {
		return nil, nil
	}

	return &ingest.Plan{
		Markdown: strings.Join(sections, "\n\n---\n\n"),
		Source:   "codex",
	}, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var diffs []ingest.DiffFile
	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		if env.Type != "event_msg" {
			continue
		}

		var pl eventMsgPayload
		if err := json.Unmarshal(env.Payload, &pl); err != nil {
			continue
		}
		if pl.Type != "patch_apply_end" || len(pl.Changes) == 0 {
			continue
		}

		var changes map[string]changeEntry
		if err := json.Unmarshal(pl.Changes, &changes); err != nil {
			continue
		}

		for path, change := range changes {
			status := "modified"
			switch change.Type {
			case "add":
				status = "added"
			case "delete":
				status = "deleted"
			}

			patch := ""
			if change.Content != "" {
				patch = fmt.Sprintf("--- a/%s\n+++ b/%s\n@@ -1 +1 @@\n-%s\n+%s\n", path, path, change.Content, change.Content)
			}

			diffs = append(diffs, ingest.DiffFile{
				Path:   path,
				Status: status,
				Patch:  patch,
			})
		}
	}

	if len(diffs) == 0 {
		return nil, nil
	}
	return diffs, nil
}

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, nil
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, nil
	}
	defer f.Close()

	var edits []ingest.FileEdit
	patchSeen := make(map[string]bool)
	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "event_msg":
			var pl eventMsgPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			if pl.Type != "patch_apply_end" || len(pl.Changes) == 0 {
				continue
			}

			ts := ingestutil.ParseTime(env.Timestamp)

			var changes map[string]changeEntry
			if err := json.Unmarshal(pl.Changes, &changes); err != nil {
				continue
			}

			for path, change := range changes {
				content := change.Content
				if content == "" {
					content = change.UnifiedDiff
				}
				toolName := "edit"
				if change.Type == "add" {
					toolName = "write"
				}
				edits = append(edits, ingest.FileEdit{
					FilePath:  path,
					ToolName:  toolName,
					NewStr:    content,
					Content:   content,
					Timestamp: ts,
				})
				patchSeen[path] = true
			}

		case "response_item":
			var pl responseItemPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			if pl.Type != "custom_tool_call" || pl.Name != "apply_patch" {
				continue
			}

			ts := ingestutil.ParseTime(env.Timestamp)
			patchText := pl.Input
			if patchText == "" {
				patchText = pl.Arguments
			}

			filePath := extractFilePathFromPatch(patchText)
			if filePath == "" || patchSeen[filePath] {
				continue
			}

			result := parseRawPatch(patchText)
			editContent := result.content
			if editContent == "" {
				editContent = patchText
			}
			edits = append(edits, ingest.FileEdit{
				FilePath:  filePath,
				ToolName:  "edit",
				NewStr:    editContent,
				Content:   patchText,
				Timestamp: ts,
			})
		}
	}

	if len(edits) == 0 {
		return nil, nil
	}
	return edits, nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && codex resume %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	a.mu.RLock()
	lastMod := a.lastMod
	a.mu.RUnlock()

	var maxMod int64

	indexPath := filepath.Join(a.basePath, "session_index.jsonl")
	if fi, err := os.Stat(indexPath); err == nil {
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
	}

	sessionsDir := filepath.Join(a.basePath, "sessions")
	if fi, err := os.Stat(sessionsDir); err == nil {
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
	}

	err := filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		if m := fi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
		return nil
	})
	if err != nil {
		if lastMod > 0 {
			return lastMod, nil
		}
		return time.Now().UnixMilli(), nil
	}

	if maxMod == 0 {
		maxMod = time.Now().UnixMilli()
	}

	if maxMod > lastMod {
		a.mu.Lock()
		a.sessions = nil
		a.lastMod = maxMod
		a.mu.Unlock()
	}

	return maxMod, nil
}

func (a *Adapter) Close() error {
	return nil
}

// --- Type definitions ---

type codexIndexEntry struct {
	ID         string `json:"id"`
	ThreadName string `json:"thread_name"`
	UpdatedAt  string `json:"updated_at"`
}

type codexEnvelope struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type sessionMetaPayload struct {
	ID            string `json:"id"`
	Timestamp     string `json:"timestamp"`
	CWD           string `json:"cwd"`
	ModelProvider string `json:"model_provider"`
	Git           *struct {
		CommitHash    string `json:"commit_hash"`
		Branch        string `json:"branch"`
		RepositoryURL string `json:"repository_url"`
	} `json:"git,omitempty"`
}

type turnContextPayload struct {
	TurnID string `json:"turn_id"`
	CWD    string `json:"cwd"`
	Model  string `json:"model"`
}

type eventMsgPayload struct {
	Type        string          `json:"type"`
	TurnID      string          `json:"turn_id,omitempty"`
	Message     string          `json:"message,omitempty"`
	Phase       string          `json:"phase,omitempty"`
	StartedAt   int64           `json:"started_at,omitempty"`
	CompletedAt int64           `json:"completed_at,omitempty"`
	DurationMs  int64           `json:"duration_ms,omitempty"`
	Info        *tokenCountInfo `json:"info,omitempty"`
	Item        *itemComplete   `json:"item,omitempty"`
	Changes     json.RawMessage `json:"changes,omitempty"`
	CallID      string          `json:"call_id,omitempty"`
	Success     bool            `json:"success,omitempty"`
}

type tokenCountInfo struct {
	TotalTokenUsage *tokenUsage `json:"total_token_usage"`
}

type tokenUsage struct {
	InputTokens       int `json:"input_tokens"`
	OutputTokens      int `json:"output_tokens"`
	CachedInputTokens int `json:"cached_input_tokens"`
	TotalTokens       int `json:"total_tokens"`
}

type itemComplete struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Text string `json:"text"`
}

type responseItemPayload struct {
	Type      string             `json:"type"`
	Role      string             `json:"role,omitempty"`
	Content   []responseContent  `json:"content,omitempty"`
	Name      string             `json:"name,omitempty"`
	Arguments string             `json:"arguments,omitempty"`
	CallID    string             `json:"call_id,omitempty"`
	Output    string             `json:"output,omitempty"`
	Phase     string             `json:"phase,omitempty"`
	Status    string             `json:"status,omitempty"`
	Input     string             `json:"input,omitempty"`
	Metadata  map[string]string  `json:"metadata,omitempty"`
	Summary   []json.RawMessage  `json:"summary,omitempty"`
}

type responseContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type changeEntry struct {
	Type        string `json:"type"`
	Content     string `json:"content"`
	UnifiedDiff string `json:"unified_diff"`
}

type rawPatchResult struct {
	filePath string
	content  string
}

// --- Unexported methods ---

func (a *Adapter) loadSessions(ctx context.Context) ([]ingest.Session, error) {
	indexPath := filepath.Join(a.basePath, "session_index.jsonl")
	indexEntries, err := readIndex(indexPath)
	if err != nil {
		return nil, fmt.Errorf("codex adapter: reading index: %w", err)
	}

	var sessions []ingest.Session
	var maxMod int64

	indexFi, err := os.Stat(indexPath)
	if err == nil {
		if m := indexFi.ModTime().UnixMilli(); m > maxMod {
			maxMod = m
		}
	}

	for _, entry := range indexEntries {
		session, err := a.resolveSessionFromIndex(ctx, entry)
		if err != nil {
			log.Printf("codex adapter: skipping session %s: %v", entry.ID, err)
			continue
		}
		if session == nil {
			continue
		}

		sessions = append(sessions, *session)

		sfi, err := os.Stat(a.sessionFilePath(entry.ID))
		if err == nil {
			if m := sfi.ModTime().UnixMilli(); m > maxMod {
				maxMod = m
			}
		}
	}

	// Scan the sessions/ directory for orphan .jsonl files not yet in the index.
	// Codex may write a session file to disk before adding it to session_index.jsonl,
	// so we need to discover these the same way we handle Copilot's session-state/.
	indexIDs := make(map[string]bool, len(indexEntries))
	for _, entry := range indexEntries {
		indexIDs[entry.ID] = true
	}

	sessionsDir := filepath.Join(a.basePath, "sessions")
	filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		id := extractIDFromSessionFile(p, d.Name())
		if id == "" || indexIDs[id] {
			return nil
		}
		indexIDs[id] = true // avoid duplicates
		fi, err := d.Info()
		if err != nil {
			fi = nil
		}
		s := ingest.Session{
			ID:     id,
			Agent:  ingest.AgentCodex,
			Title:  id,
			Status: "active",
		}
		if fi != nil {
			s.CreatedAt = fi.ModTime()
			s.UpdatedAt = fi.ModTime()
			if m := fi.ModTime().UnixMilli(); m > maxMod {
				maxMod = m
			}
		}
		sessions = append(sessions, s)
		return nil
	})

	slices.SortFunc(sessions, func(a, b ingest.Session) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})

	a.mu.Lock()
	a.sessions = sessions
	a.lastMod = maxMod
	a.mu.Unlock()

	return sessions, nil
}

func (a *Adapter) resolveSessionFromIndex(ctx context.Context, entry codexIndexEntry) (*ingest.Session, error) {
	fpath := a.sessionFilePath(entry.ID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found for %s", entry.ID)
	}

	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	session := &ingest.Session{
		ID:        entry.ID,
		SourceID:  a.basePath,
		Title:     entry.ThreadName,
		Agent:     ingest.AgentCodex,
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Directory: "",
		Model:     "",
	}

	parsedTime, err := time.Parse(time.RFC3339, entry.UpdatedAt)
	if err == nil {
		session.UpdatedAt = parsedTime
		session.CreatedAt = parsedTime
	}

	var msgCount int
	var model string
	var cost float64
	var tokensInput, tokensOutput int

	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "session_meta":
			var pl sessionMetaPayload
			if json.Unmarshal(env.Payload, &pl) == nil {
				if session.Directory == "" && pl.CWD != "" {
					session.Directory = pl.CWD
				}
				if pl.Git != nil {
					session.Repository = ingestutil.DeriveRepoFromURL(pl.Git.RepositoryURL)
					session.Branch = pl.Git.Branch
				}
				if session.Title == "" && pl.ID != "" {
					session.Title = pl.ID[:8]
				}
			}

		case "turn_context":
			var pl turnContextPayload
			if json.Unmarshal(env.Payload, &pl) == nil {
				if session.Directory == "" && pl.CWD != "" {
					session.Directory = pl.CWD
				}
				if pl.Model != "" {
					model = pl.Model
				}
			}

		case "event_msg":
			var pl eventMsgPayload
			if json.Unmarshal(env.Payload, &pl) == nil {
				switch pl.Type {
				case "user_message", "agent_message":
					msgCount++
				case "token_count":
					if pl.Info != nil && pl.Info.TotalTokenUsage != nil {
						tokensInput += pl.Info.TotalTokenUsage.InputTokens
						tokensOutput += pl.Info.TotalTokenUsage.OutputTokens
						cost += float64(pl.Info.TotalTokenUsage.TotalTokens) * 0.000001
					}
				}
			}

		case "response_item":
			msgCount++
		}
	}

	session.MessageCount = msgCount
	session.Model = model
	session.Cost = cost
	session.TokensInput = tokensInput
	session.TokensOutput = tokensOutput

	if session.Title == "" {
		session.Title = session.ID
		if len(session.Title) > 8 {
			session.Title = session.Title[:8]
		}
	}

	if session.Directory == "" {
		session.Directory = a.basePath
	}

	if session.Repository == "" {
		session.Repository = ingestutil.DeriveRepoFromURL("")
		if session.Repository == "" {
			session.Repository = filepath.Base(session.Directory)
		}
	}

	return session, nil
}

func (a *Adapter) sessionFilePath(sessionID string) string {
	sessionsDir := filepath.Join(a.basePath, "sessions")
	err := filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			return nil
		}
		if strings.Contains(name, sessionID) {
			return fmt.Errorf("found:%s", p)
		}
		return nil
	})
	if err != nil {
		msg := err.Error()
		if strings.HasPrefix(msg, "found:") {
			return msg[6:]
		}
	}
	return ""
}

func (a *Adapter) parseMessages(fpath, sessionID string) ([]ingest.Message, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ingest.Message
	toolCallsByID := make(map[string]*ingest.ToolCall)
	hasDeveloperContent := false

	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env codexEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "response_item":
			var pl responseItemPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}

			switch pl.Type {
			case "message":
				msg := ingest.Message{
					Timestamp: ingestutil.ParseTime(env.Timestamp),
				}

				switch pl.Role {
				case "user":
					msg.Role = "user"
					content := extractContentText(pl.Content)
					content, msg.Metadata = normalizeUserContent(content)
					msg.Content = content
					messages = append(messages, msg)

				case "assistant":
					msg.Role = "assistant"
					msg.Content = extractContentText(pl.Content)

					var reasoning string
					var msgToolCalls []ingest.ToolCall
					for _, tc := range toolCallsByID {
						msgToolCalls = append(msgToolCalls, *tc)
					}
					msg.ToolCalls = msgToolCalls
					msg.Reasoning = reasoning

					messages = append(messages, msg)
					toolCallsByID = make(map[string]*ingest.ToolCall)

				case "developer":
					if !hasDeveloperContent {
						hasDeveloperContent = true
						msg := ingest.Message{
							Role:      "system",
							Content:   extractContentText(pl.Content),
							Timestamp: ingestutil.ParseTime(env.Timestamp),
						}
						messages = append(messages, msg)
					}
				}

			case "function_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Arguments,
					Status: "running",
				}
				normalizeBashInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "function_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = "completed"
					normalizeBashOutput(tc)
				}

			case "custom_tool_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Input,
					Status: "running",
				}
				normalizeEditInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "custom_tool_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = "completed"
				}
			}

		case "event_msg":
			var pl eventMsgPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}

			switch pl.Type {
			case "user_message":
				content := pl.Message
				normalized, meta := normalizeUserContent(content)
				msg := ingest.Message{
					Role:      "user",
					Content:   normalized,
					Metadata:  meta,
					Timestamp: ingestutil.ParseTime(env.Timestamp),
				}
				messages = append(messages, msg)

			case "agent_message":
				msg := ingest.Message{
					Role:      "assistant",
					Content:   pl.Message,
					Timestamp: ingestutil.ParseTime(env.Timestamp),
				}
				var msgToolCalls []ingest.ToolCall
				for _, tc := range toolCallsByID {
					msgToolCalls = append(msgToolCalls, *tc)
				}
				msg.ToolCalls = msgToolCalls
				messages = append(messages, msg)
				toolCallsByID = make(map[string]*ingest.ToolCall)

			case "task_complete":
				summaryBytes, err := json.Marshal(pl.Message)
			if err != nil {
				slog.Warn("failed to marshal summary", "error", err)
				summaryBytes = []byte("{}")
			}
				tc := &ingest.ToolCall{
					ID:     pl.TurnID,
					Name:   "task_complete",
					Status: "completed",
					Output: "completed",
					Input:  fmt.Sprintf(`{"turn_id":%q,"completed_at":%d,"duration_ms":%d,"summary":%s,"success":%v}`, pl.TurnID, pl.CompletedAt, pl.DurationMs, string(summaryBytes), pl.Success),
				}
				toolCallsByID[pl.TurnID] = tc
			}
		}
	}

	// Collect any remaining tool calls (e.g., at end of session) into a synthetic message
	if len(toolCallsByID) > 0 {
		var msgToolCalls []ingest.ToolCall
		for _, tc := range toolCallsByID {
			msgToolCalls = append(msgToolCalls, *tc)
		}
		messages = append(messages, ingest.Message{
			Role:      "assistant",
			ToolCalls: msgToolCalls,
			Timestamp: time.Now(),
		})
	}

	messages = dedupMessages(messages)

	slices.SortFunc(messages, func(a, b ingest.Message) int {
		return a.Timestamp.Compare(b.Timestamp)
	})

	return messages, nil
}

// parseSessionFileMinimal builds a basic Session from a session .jsonl file
// without requiring an index entry. Used by Session for orphan sessions.
func (a *Adapter) parseSessionFileMinimal(_ context.Context, id, fpath string) (*ingest.Session, error) {
	fi, err := os.Stat(fpath)
	if err != nil {
		return nil, err
	}
	s := &ingest.Session{
		ID:        id,
		Agent:     ingest.AgentCodex,
		Title:     id,
		Status:    "active",
		CreatedAt: fi.ModTime(),
		UpdatedAt: fi.ModTime(),
	}
	if len(id) > 8 {
		s.Title = id[:8]
	}
	// Try to read a few events for richer metadata
	f, err := os.Open(fpath)
	if err != nil {
		return s, nil
	}
	defer f.Close()
	scanner := ingestutil.NewJSONLScanner(f)
	var msgCount int
	for scanner.Scan() {
		var env codexEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) != nil {
			continue
		}
		switch env.Type {
		case "session_meta":
			var meta sessionMetaPayload
			if json.Unmarshal(env.Payload, &meta) == nil {
				if s.Directory == "" && meta.CWD != "" {
					s.Directory = meta.CWD
				}
				if meta.Git != nil {
					s.Repository = ingestutil.DeriveRepoFromURL(meta.Git.RepositoryURL)
					s.Branch = meta.Git.Branch
				}
			}
		case "event_msg":
			msgCount++
		case "response_item":
			msgCount++
		}
	}
	s.MessageCount = msgCount
	if s.Directory == "" {
		s.Directory = a.basePath
	}
	if s.Repository == "" {
		s.Repository = filepath.Base(s.Directory)
	}
	return s, nil
}

// --- Helper functions ---

func readIndex(path string) ([]codexIndexEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []codexIndexEntry
	scanner := ingestutil.NewJSONLScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry codexIndexEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			log.Printf("codex adapter: skipping malformed index line: %v", err)
			continue
		}
		if entry.ID == "" {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}

func dedupMessages(messages []ingest.Message) []ingest.Message {
	if len(messages) < 2 {
		return messages
	}
	var result []ingest.Message
	seen := make(map[string]bool)
	for _, m := range messages {
		key := m.Role + "|" + m.Content
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, m)
	}
	return result
}

func extractContentText(content []responseContent) string {
	var parts []string
	for _, c := range content {
		if c.Text != "" {
			parts = append(parts, c.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func normalizeToolName(name string) string {
	switch name {
	case "exec_command":
		return "bash"
	case "apply_patch":
		return "edit"
	case "read_file":
		return "read"
	case "write_file":
		return "write"
	case "multi_tool_use.parallel":
		return name
	case "request_user_input":
		return "question"
	default:
		if strings.HasPrefix(name, "exec_") {
			return "bash"
		}
		if strings.HasPrefix(name, "edit_") || strings.HasSuffix(name, "_patch") {
			return "edit"
		}
		if strings.HasPrefix(name, "read_") {
			return "read"
		}
		return name
	}
}

func extractFilePathFromPatch(patch string) string {
	for _, prefix := range []string{"*** Add File: ", "*** Modify File: ", "*** Update File: ", "--- Add File: ", "--- Modify File: ", "--- Update File: "} {
		if _, after, found := strings.Cut(patch, prefix); found {
			if nl := strings.IndexAny(after, "\n\r"); nl >= 0 {
				return strings.TrimSpace(after[:nl])
			}
			return strings.TrimSpace(after)
		}
	}
	return ""
}

// extractIDFromSessionFile reads the first event of a Codex session .jsonl file
// to extract the session ID. Falls back to the filename stem (without .jsonl) if
// no session_meta event is found.
func extractIDFromSessionFile(path, name string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := ingestutil.NewJSONLScanner(f)
	if scanner.Scan() {
		var env codexEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) == nil && env.Type == "session_meta" {
			var meta sessionMetaPayload
			if json.Unmarshal(env.Payload, &meta) == nil && meta.ID != "" {
				return meta.ID
			}
		}
	}
	// Fallback: use filename stem
	if idx := strings.LastIndex(name, ".jsonl"); idx > 0 {
		return name[:idx]
	}
	return name
}

func normalizeBashInput(tc *ingest.ToolCall) {
	if tc.Name != "bash" || tc.Input == "" {
		return
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(tc.Input), &raw); err != nil {
		return
	}
	// Rename "cmd" to "command" for frontend compatibility
	if cmd, ok := raw["cmd"]; ok {
		if _, hasCommand := raw["command"]; !hasCommand {
			raw["command"] = cmd
		}
	}
	out, err := json.Marshal(raw)
	if err != nil {
		slog.Warn("failed to marshal tool input", "error", err)
		out = []byte("{}")
	}
	tc.Input = string(out)
}

func normalizeBashOutput(tc *ingest.ToolCall) {
	if tc.Name != "bash" || tc.Output == "" {
		return
	}
	output := tc.Output
	if !strings.HasPrefix(output, "Chunk ID:") {
		return
	}
	_, after, found := strings.Cut(output, "\nOutput:\n")
	if found {
		tc.Output = after
	}
}

func normalizeEditInput(tc *ingest.ToolCall) {
	if tc.Name != "edit" || tc.Input == "" {
		return
	}
	// Skip if already valid JSON
	if tc.Input[0] == '{' {
		var check any
		if json.Unmarshal([]byte(tc.Input), &check) == nil {
			return
		}
	}

	result := parseRawPatch(tc.Input)
	if result.filePath == "" {
		return
	}

	out := map[string]string{
		"filePath": result.filePath,
		"content":  result.content,
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		slog.Warn("failed to marshal write input", "error", err)
		encoded = []byte("{}")
	}
	tc.Input = string(encoded)
}

// parseRawPatch parses Codex raw patch format:
//
//	*** Begin Patch
//	*** Add File: auth.go
//	+content
//	*** End Patch
func parseRawPatch(input string) rawPatchResult {
	filePath := ""
	var contentLines []string
	inContent := false
	for line := range strings.SplitSeq(input, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "*** Add File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Add File: ")
		case strings.HasPrefix(trimmed, "*** Modify File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Modify File: ")
		case strings.HasPrefix(trimmed, "*** Update File: "):
			filePath = strings.TrimPrefix(trimmed, "*** Update File: ")
		case strings.HasPrefix(trimmed, "--- Add File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Add File: ")
		case strings.HasPrefix(trimmed, "--- Modify File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Modify File: ")
		case strings.HasPrefix(trimmed, "--- Update File: "):
			filePath = strings.TrimPrefix(trimmed, "--- Update File: ")
		case strings.HasPrefix(trimmed, "*** Chunk: "):
			rest := strings.TrimPrefix(trimmed, "*** Chunk: ")
			if idx := strings.Index(rest, " : "); idx > 0 {
				filePath = rest[:idx]
			} else {
				filePath = rest
			}
		case strings.HasPrefix(trimmed, "*** Begin Patch"):
			inContent = true
		case strings.HasPrefix(trimmed, "*** End Patch"):
			inContent = false
		case inContent && filePath != "":
			contentLines = append(contentLines, line)
		}
	}
	content := strings.TrimRight(strings.Join(contentLines, "\n"), "\n")
	return rawPatchResult{
		filePath: filePath,
		content:  content,
	}
}

func normalizeUserContent(content string) (string, map[string]string) {
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, "<turn_aborted>") {
		end := strings.Index(trimmed, "</turn_aborted>")
		if end >= 0 {
			inner := trimmed[len("<turn_aborted>"):end]
			return strings.TrimSpace(inner), map[string]string{"type": "turn_aborted"}
		}
	}
	return content, nil
}
