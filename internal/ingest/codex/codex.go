package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/ingest/internal/util"
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
	if cached != nil {
		return cached, nil
	}
	return a.loadSessions(ctx)
}

type codexIndexEntry struct {
	ID         string `json:"id"`
	ThreadName string `json:"thread_name"`
	UpdatedAt  string `json:"updated_at"`
}

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

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[j].UpdatedAt.Before(sessions[i].UpdatedAt)
	})

	a.mu.Lock()
	a.sessions = sessions
	a.lastMod = maxMod
	a.mu.Unlock()

	return sessions, nil
}

func readIndex(path string) ([]codexIndexEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []codexIndexEntry
	scanner := util.NewJSONLScanner(f)
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

	scanner := util.NewJSONLScanner(f)
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
					session.Repository = util.DeriveRepoFromURL(pl.Git.RepositoryURL)
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
		session.Repository = util.DeriveRepoFromURL("")
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
			return fmt.Errorf("FOUND:%s", p)
		}
		return nil
	})
	if err != nil {
		msg := err.Error()
		if strings.HasPrefix(msg, "FOUND:") {
			return msg[6:]
		}
	}
	return ""
}

func (a *Adapter) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
	// Check cache first (fast path)
	a.mu.RLock()
	if a.sessions != nil {
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
	return nil, fmt.Errorf("session not found: %s", id)
}

func (a *Adapter) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.sessionFilePath(sessionID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parseMessages(fpath, sessionID)
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
	Type      string          `json:"type"`
	TurnID    string          `json:"turn_id,omitempty"`
	Message   string          `json:"message,omitempty"`
	Phase     string          `json:"phase,omitempty"`
	StartedAt int64           `json:"started_at,omitempty"`
	Info      *tokenCountInfo `json:"info,omitempty"`
	Item      *itemComplete   `json:"item,omitempty"`
	Changes   json.RawMessage `json:"changes,omitempty"`
	CallID    string          `json:"call_id,omitempty"`
	Success   bool            `json:"success,omitempty"`
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
	Type    string `json:"type"`
	Content string `json:"content"`
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

	scanner := util.NewJSONLScanner(f)
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
					Timestamp: util.ParseTime(env.Timestamp),
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
							Timestamp: util.ParseTime(env.Timestamp),
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
					Timestamp: util.ParseTime(env.Timestamp),
				}
				messages = append(messages, msg)

			case "agent_message":
				msg := ingest.Message{
					Role:      "assistant",
					Content:   pl.Message,
					Timestamp: util.ParseTime(env.Timestamp),
				}
				var msgToolCalls []ingest.ToolCall
				for _, tc := range toolCallsByID {
					msgToolCalls = append(msgToolCalls, *tc)
				}
				msg.ToolCalls = msgToolCalls
				messages = append(messages, msg)
				toolCallsByID = make(map[string]*ingest.ToolCall)
			}
		}
	}

	messages = dedupMessages(messages)

	sort.Slice(messages, func(i, j int) bool {
		return messages[i].Timestamp.Before(messages[j].Timestamp)
	})

	return messages, nil
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

func (a *Adapter) GetPlan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
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
	scanner := util.NewJSONLScanner(f)
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

func (a *Adapter) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
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
	scanner := util.NewJSONLScanner(f)
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
			if change.Type == "add" {
				status = "added"
			} else if change.Type == "delete" {
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

func (a *Adapter) GetEdits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
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
	scanner := util.NewJSONLScanner(f)
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

			ts := util.ParseTime(env.Timestamp)

			var changes map[string]changeEntry
			if err := json.Unmarshal(pl.Changes, &changes); err != nil {
				continue
			}

			for path, change := range changes {
				edits = append(edits, ingest.FileEdit{
					FilePath:  path,
					ToolName:  "edit",
					Content:   change.Content,
					Timestamp: ts,
				})
			}

		case "response_item":
			var pl responseItemPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			if pl.Type != "custom_tool_call" || pl.Name != "apply_patch" {
				continue
			}

			ts := util.ParseTime(env.Timestamp)
			patchText := pl.Input
			if patchText == "" {
				patchText = pl.Arguments
			}

			filePath := extractFilePathFromPatch(patchText)
			edits = append(edits, ingest.FileEdit{
				FilePath:  filePath,
				ToolName:  "edit",
				OldStr:    "",
				NewStr:    "",
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

func extractFilePathFromPatch(patch string) string {
	for _, prefix := range []string{"*** Add File: ", "*** Modify File: ", "--- Add File: ", "--- Modify File: "} {
		if idx := strings.Index(patch, prefix); idx >= 0 {
			rest := patch[idx+len(prefix):]
			if nl := strings.IndexAny(rest, "\n\r"); nl >= 0 {
				return strings.TrimSpace(rest[:nl])
			}
			return strings.TrimSpace(rest)
		}
	}
	return ""
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
	out, _ := json.Marshal(raw)
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
	idx := strings.Index(output, "\nOutput:\n")
	if idx >= 0 {
		tc.Output = output[idx+len("\nOutput:\n"):]
	}
}

func normalizeEditInput(tc *ingest.ToolCall) {
	if tc.Name != "edit" || tc.Input == "" {
		return
	}
	// Skip if already valid JSON
	if tc.Input[0] == '{' {
		var check map[string]string
		if json.Unmarshal([]byte(tc.Input), &check) == nil {
			return
		}
	}

	// Parse Codex raw patch format and extract filePath + content as JSON:
	//   *** Begin Patch
	//   *** Add File: auth.go
	//   +content
	//   *** End Patch
	filePath := ""
	var contentLines []string
	inContent := false
	lines := strings.Split(tc.Input, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "*** Add File: ") {
			filePath = strings.TrimPrefix(trimmed, "*** Add File: ")
		} else if strings.HasPrefix(trimmed, "*** Chunk: ") {
			rest := strings.TrimPrefix(trimmed, "*** Chunk: ")
			if idx := strings.Index(rest, " : "); idx > 0 {
				filePath = rest[:idx]
			} else {
				filePath = rest
			}
		} else if strings.HasPrefix(trimmed, "*** Begin Patch") {
			inContent = true
		} else if strings.HasPrefix(trimmed, "*** End Patch") {
			inContent = false
		} else if inContent && strings.HasPrefix(trimmed, "+") && filePath != "" {
			contentLines = append(contentLines, strings.TrimPrefix(trimmed, "+"))
		}
	}

	if filePath == "" {
		return
	}

	out := map[string]string{
		"filePath": filePath,
		"content":  strings.TrimRight(strings.Join(contentLines, "\n"), "\n"),
	}
	encoded, _ := json.Marshal(out)
	tc.Input = string(encoded)
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
