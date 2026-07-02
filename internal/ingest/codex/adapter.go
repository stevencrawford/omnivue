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
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func init() {
	ingest.Register(ingest.AgentCodex, "Codex", "~/.codex",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

func detectPath(path string) *ingest.DiscoveredSource {
	indexPath := filepath.Join(path, "session_index.jsonl")
	if !ingestkit.PathExists(indexPath) {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentCodex,
		Label:     "Codex",
	}
}

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
	if len(cached) > 0 {
		return cached, nil
	}
	return a.loadSessions(ctx)
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
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
	scanner := ingestkit.NewJSONLScanner(f)
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
		Source:   ingest.PlanDataSynthesized,
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
	scanner := ingestkit.NewJSONLScanner(f)
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
				Status: ingest.DiffFileStatus(status),
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
	scanner := ingestkit.NewJSONLScanner(f)
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

			ts := ingestkit.ParseTime(env.Timestamp)

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

			ts := ingestkit.ParseTime(env.Timestamp)
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
		indexIDs[id] = true
		fi, err := d.Info()
		if err != nil {
			fi = nil
		}
		s := ingest.Session{
			ID:     id,
			Agent:  ingest.AgentCodex,
			Title:  id,
			Status: ingest.SessionStatusActive,
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
		Status:    ingest.SessionStatusActive,
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

	scanner := ingestkit.NewJSONLScanner(f)
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
					session.Repository = ingestkit.DeriveRepoFromURL(pl.Git.RepositoryURL)
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
		session.Repository = ingestkit.DeriveRepoFromURL("")
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

	scanner := ingestkit.NewJSONLScanner(f)
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
					Timestamp: ingestkit.ParseTime(env.Timestamp),
				}

				switch pl.Role {
				case "user":
					msg.Role = ingest.MessageRoleUser
					content := extractContentText(pl.Content)
					content, msg.Metadata = normalizeUserContent(content)
					msg.Content = content
					messages = append(messages, msg)

				case "assistant":
					msg.Role = ingest.MessageRoleAssistant
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
							Role:      ingest.MessageRoleSystem,
							Content:   extractContentText(pl.Content),
							Timestamp: ingestkit.ParseTime(env.Timestamp),
						}
						messages = append(messages, msg)
					}
				}

			case "function_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Arguments,
					Status: ingest.ToolCallRunning,
				}
				normalizeBashInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "function_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = ingest.ToolCallCompleted
					normalizeBashOutput(tc)
				}

			case "custom_tool_call":
				tc := &ingest.ToolCall{
					ID:     pl.CallID,
					Name:   normalizeToolName(pl.Name),
					Input:  pl.Input,
					Status: ingest.ToolCallRunning,
				}
				normalizeEditInput(tc)
				toolCallsByID[pl.CallID] = tc

			case "custom_tool_call_output":
				if tc, ok := toolCallsByID[pl.CallID]; ok {
					tc.Output = pl.Output
					tc.Status = ingest.ToolCallCompleted
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
					Role:      ingest.MessageRoleUser,
					Content:   normalized,
					Metadata:  meta,
					Timestamp: ingestkit.ParseTime(env.Timestamp),
				}
				messages = append(messages, msg)

			case "agent_message":
				msg := ingest.Message{
					Role:      ingest.MessageRoleAssistant,
					Content:   pl.Message,
					Timestamp: ingestkit.ParseTime(env.Timestamp),
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
					Status: ingest.ToolCallCompleted,
					Output: "completed",
					Input:  fmt.Sprintf(`{"turn_id":%q,"completed_at":%d,"duration_ms":%d,"summary":%s,"success":%v}`, pl.TurnID, pl.CompletedAt, pl.DurationMs, string(summaryBytes), pl.Success),
				}
				toolCallsByID[pl.TurnID] = tc
			}
		}
	}

	if len(toolCallsByID) > 0 {
		var msgToolCalls []ingest.ToolCall
		for _, tc := range toolCallsByID {
			msgToolCalls = append(msgToolCalls, *tc)
		}
		messages = append(messages, ingest.Message{
			Role:      ingest.MessageRoleAssistant,
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

func (a *Adapter) parseSessionFileMinimal(_ context.Context, id, fpath string) (*ingest.Session, error) {
	fi, err := os.Stat(fpath)
	if err != nil {
		return nil, err
	}
	s := &ingest.Session{
		ID:        id,
		Agent:     ingest.AgentCodex,
		Title:     id,
		Status:    ingest.SessionStatusActive,
		CreatedAt: fi.ModTime(),
		UpdatedAt: fi.ModTime(),
	}
	if len(id) > 8 {
		s.Title = id[:8]
	}
	f, err := os.Open(fpath)
	if err != nil {
		return s, nil
	}
	defer f.Close()
	scanner := ingestkit.NewJSONLScanner(f)
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
					s.Repository = ingestkit.DeriveRepoFromURL(meta.Git.RepositoryURL)
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

func readIndex(path string) ([]codexIndexEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []codexIndexEntry
	scanner := ingestkit.NewJSONLScanner(f)
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
		key := string(m.Role) + "|" + m.Content
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

func extractIDFromSessionFile(path, name string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := ingestkit.NewJSONLScanner(f)
	if scanner.Scan() {
		var env codexEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) == nil && env.Type == "session_meta" {
			var meta sessionMetaPayload
			if json.Unmarshal(env.Payload, &meta) == nil && meta.ID != "" {
				return meta.ID
			}
		}
	}
	if idx := strings.LastIndex(name, ".jsonl"); idx > 0 {
		return name[:idx]
	}
	return name
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
