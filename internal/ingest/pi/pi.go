package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
	ingest.Register(ingest.AgentPi, "Pi", "~/.pi/agent/sessions",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

// detectPath checks whether the given path contains Pi JSONL session files.
func detectPath(path string) *ingest.DiscoveredSource {
	if !ingestkit.PathExists(path) {
		return nil
	}
	var found bool
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found {
			return err
		}
		if !d.IsDir() && filepath.Ext(d.Name()) == ".jsonl" {
			found = true
		}
		return nil
	})
	if !found {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentPi,
		Label:     "Pi",
	}
}

// piEditEntry represents a single old→new edit within a Pi edit tool call.
type piEditEntry struct {
	OldText string `json:"oldText"`
	NewText string `json:"newText"`
}

// piCost holds the per-message cost breakdown from Pi's usage object.
type piCost struct {
	Input     float64 `json:"input"`
	Output    float64 `json:"output"`
	CacheRead float64 `json:"cacheRead"`
	CacheWrite float64 `json:"cacheWrite"`
	Total     float64 `json:"total"`
}

// Adapter reads Pi agent session data from JSONL files.
type Adapter struct {
	basePath string
	// Cache parsed session data to avoid re-reading files on every call
	mu         sync.RWMutex
	sessions   []ingest.Session
	lastMod    int64 // unix millis of latest modified file
}

// New creates a new Pi adapter for the given base path.
func New(basePath string) (*Adapter, error) {
	return &Adapter{basePath: basePath}, nil
}

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentPi
}

func (a *Adapter) Detect(path string) bool {
	fi, err := os.Stat(path)
	if err != nil || !fi.IsDir() {
		return false
	}
	var found bool
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
			found = true
		}
		return nil
	})
	return found
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

	// Fallback: find and parse just the one session file
	fpath := a.findSessionFile(id)
	if fpath == "" {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	return a.parseSessionFile(fpath)
}

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	filePath := a.findSessionFile(sessionID)
	if filePath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parsePiMessages(filePath, sessionID)
}

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var sections []string
	for _, msg := range msgs {
		if msg.Role != "assistant" {
			continue
		}
		if msg.Content != "" && hasPlanContent(msg.Content) {
			sections = append(sections, msg.Content)
		}
	}

	if len(sections) == 0 {
		return nil, nil
	}

	md := strings.Join(sections, "\n\n---\n\n")
	return &ingest.Plan{
		Markdown: md,
		Source:   "synthesized",
	}, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	edits, err := a.Edits(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var diffs []ingest.DiffFile
	for _, e := range edits {
		if seen[e.FilePath] {
			continue
		}
		seen[e.FilePath] = true
		adds := 0
		dels := 0
		if e.NewStr != "" {
			adds = strings.Count(e.NewStr, "\n") + 1
		}
		if e.OldStr != "" {
			dels = strings.Count(e.OldStr, "\n") + 1
		}
		status := "modified"
		if e.OldStr == "" && e.NewStr != "" {
			status = "added"
		}
		diffs = append(diffs, ingest.DiffFile{
			Path:      e.FilePath,
			Status:    status,
			Additions: adds,
			Deletions: dels,
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
	for _, msg := range msgs {
		for _, tc := range msg.ToolCalls {
			if tc.Name != "edit" && tc.Name != "write" {
				continue
			}

			fp, oldContent, newContent := parsePiEditContent(tc)
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
	return fmt.Sprintf("cd %s && pi --session %s", session.Directory, session.ID)
}

func (a *Adapter) LastModified(ctx context.Context) (int64, error) {
	a.mu.RLock()
	lastMod := a.lastMod
	a.mu.RUnlock()

	// Re-scan to get fresh mod times
	var maxMod int64
	err := filepath.WalkDir(a.basePath, func(p string, d os.DirEntry, err error) error {
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
		mod := fi.ModTime().UnixMilli()
		if mod > maxMod {
			maxMod = mod
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

	// Invalidate cache if files changed
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

// piSessionHeader is the JSONL session header line.
type piSessionHeader struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	CWD       string `json:"cwd"`
}

// piMessageEnvelope wraps every JSONL line with type routing.
type piMessageEnvelope struct {
	Type     string          `json:"type"`
	ID       string          `json:"id"`
	ParentID string          `json:"parentId,omitempty"`
	Raw      json.RawMessage `json:"-"` // unused, for extensibility

	// session header fields (type="session")
	Timestamp string `json:"timestamp,omitempty"`
	CWD       string `json:"cwd,omitempty"`

	// model_change fields
	Provider string `json:"provider,omitempty"`
	ModelID  string `json:"modelId,omitempty"`

	// thinking_level_change fields
	ThinkingLevel string `json:"thinkingLevel,omitempty"`

	// message fields (type="message")
	Message *piMessageData `json:"message,omitempty"`
}

type piMessageData struct {
	Role      string            `json:"role"`
	Content   json.RawMessage   `json:"content"`
	Model     string            `json:"model,omitempty"`
	Provider  string            `json:"provider,omitempty"`
	API       string            `json:"api,omitempty"`
	StopReason string           `json:"stopReason,omitempty"`
	ResponseID string           `json:"responseId,omitempty"`
	ResponseModel string        `json:"responseModel,omitempty"`
	Usage     *piUsage          `json:"usage,omitempty"`
	ErrorMsg  string            `json:"errorMessage,omitempty"`

	// toolResult-specific
	ToolCallID string `json:"toolCallId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	IsError    bool   `json:"isError,omitempty"`
}

type piUsage struct {
	Input       int      `json:"input"`
	Output      int      `json:"output"`
	CacheRead   int      `json:"cacheRead"`
	CacheWrite  int      `json:"cacheWrite"`
	Reasoning   int      `json:"reasoning"`
	TotalTokens int      `json:"totalTokens"`
	Cost        *piCost  `json:"cost,omitempty"`
}

type piContentPart struct {
	Type    string          `json:"type"`
	Text    string          `json:"text,omitempty"`
	Thinking string         `json:"thinking,omitempty"`
	Signature string        `json:"thinkingSignature,omitempty"`

	// toolCall
	ToolCallID string          `json:"id,omitempty"`
	Name       string          `json:"name,omitempty"`
	Arguments  json.RawMessage `json:"arguments,omitempty"`
}

func (a *Adapter) loadSessions(ctx context.Context) ([]ingest.Session, error) {
	var sessions []ingest.Session
	var maxMod int64

	err := filepath.WalkDir(a.basePath, func(p string, d os.DirEntry, err error) error {
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
		mod := fi.ModTime().UnixMilli()
		if mod > maxMod {
			maxMod = mod
		}

		session, err := a.parseSessionFile(p)
		if err != nil {
			return nil
		}
		sessions = append(sessions, *session)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("pi adapter: walking directory: %w", err)
	}

	slices.SortFunc(sessions, func(a, b ingest.Session) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})

	a.mu.Lock()
	a.sessions = sessions
	a.lastMod = maxMod
	a.mu.Unlock()

	return sessions, nil
}

func (a *Adapter) parseSessionFile(fpath string) (*ingest.Session, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)
	if !scanner.Scan() {
		return nil, fmt.Errorf("empty file: %s", fpath)
	}

	var header piSessionHeader
	if err := json.Unmarshal(scanner.Bytes(), &header); err != nil {
		return nil, fmt.Errorf("parsing session header: %w", err)
	}
	if header.Type != "session" {
		return nil, fmt.Errorf("expected session header, got %s", header.Type)
	}

	parsedTime, err := time.Parse(time.RFC3339, header.Timestamp)
	if err != nil {
		parsedTime = extractTimestampFromFilename(filepath.Base(fpath))
	}

	repo := ingestkit.DeriveRepository(header.CWD, "")
	title := deriveTitle(header.ID, header.CWD)

	session := &ingest.Session{
		ID:         header.ID,
		SourceID:   a.basePath,
		Title:      title,
		Repository: repo,
		Directory:  header.CWD,
		Agent:      ingest.AgentPi,
		Status:     "active",
		CreatedAt:  parsedTime,
		UpdatedAt:  parsedTime,
	}

	// Count messages, track model, and extract cost/token data
	var msgCount int
	currentModel := ""
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var env piMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}
		switch env.Type {
		case "model_change":
			currentModel = env.ModelID
		case "message":
			if env.Message != nil {
				msgCount++
				if env.Message.Model != "" {
					currentModel = env.Message.Model
				}
				// Update updatedAt from last message
				if t, err := time.Parse(time.RFC3339, env.Timestamp); err == nil {
					if t.After(session.UpdatedAt) {
						session.UpdatedAt = t
					}
				}
				// Extract token and cost data from assistant messages
				if env.Message.Role == "assistant" && env.Message.Usage != nil {
					session.TokensInput += env.Message.Usage.Input
					session.TokensOutput += env.Message.Usage.Output
					session.TokensReasoning += env.Message.Usage.Reasoning
					session.TokensCacheRead += env.Message.Usage.CacheRead
					session.TokensCacheWrite += env.Message.Usage.CacheWrite
					if env.Message.Usage.Cost != nil {
						session.Cost += env.Message.Usage.Cost.Total
					}
				}
			}
		}
	}

	session.MessageCount = msgCount
	session.Model = currentModel

	return session, nil
}

func (a *Adapter) findSessionFile(sessionID string) string {
	var found string
	filepath.WalkDir(a.basePath, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found != "" {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		// Filename pattern: {timestamp}_{sessionID}.jsonl
		name := strings.TrimSuffix(d.Name(), ".jsonl")
		if parts := strings.SplitN(name, "_", 2); len(parts) == 2 && parts[1] == sessionID {
			found = p
			return nil
		}
		// Fallback: read first line
		f, err := os.Open(p) //nolint:gosec
		if err != nil {
			return nil
		}
		var header piSessionHeader
		if json.NewDecoder(f).Decode(&header) == nil && header.ID == sessionID {
			found = p
		}
		f.Close()
		return nil
	})
	return found
}

func (a *Adapter) parsePiMessages(filePath, sessionID string) ([]ingest.Message, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var parsed []ingest.Message
	currentModel := ""

	scanner := ingestkit.NewJSONLScanner(f)
	// Skip session header
	if !scanner.Scan() {
		return nil, fmt.Errorf("empty file: %s", filePath)
	}

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env piMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		switch env.Type {
		case "model_change":
			if env.ModelID != "" {
				currentModel = env.ModelID
			}

		case "thinking_level_change":

		case "message":
			if env.Message == nil {
				continue
			}
			msg, err := parseMessage(env, currentModel)
			if err != nil {
				continue
			}
			parsed = append(parsed, msg)
		}
	}

	slices.SortFunc(parsed, func(a, b ingest.Message) int {
		return a.Timestamp.Compare(b.Timestamp)
	})

	// Pass 1: Index all tool calls by ID and collect toolResult messages separately.
	// This avoids the out-of-order edge case where a toolResult appears before its
	// corresponding toolCall in the sorted message list.
	toolCallsByID := make(map[string]*ingest.ToolCall)
	var toolResults []ingest.Message
	for _, msg := range parsed {
		if msg.Role == "assistant" {
			for i := range msg.ToolCalls {
				tc := &msg.ToolCalls[i]
				toolCallsByID[tc.ID] = tc
			}
		}
		if msg.Role == "toolResult" {
			toolResults = append(toolResults, msg)
		}
	}

	// Pass 2: Merge toolResult output into the corresponding ToolCall.Output.
	for _, tr := range toolResults {
		tcID := tr.Metadata["toolCallId"]
		if tcID == "" {
			continue
		}
		tc, ok := toolCallsByID[tcID]
		if !ok {
			log.Printf("pi adapter: orphaned toolResult for toolCallId=%s (no matching tool call found)", tcID)
			continue
		}
		tc.Output = tr.Content
		if envIsError, ok := tr.Metadata["isError"]; ok {
			if tc.Metadata == "" {
				tc.Metadata = `{"isError":` + envIsError + `}`
			}
		}
	}

	// Pass 3: Build final message list, filtering out toolResult messages.
	var messages []ingest.Message
	for _, msg := range parsed {
		if msg.Role == "toolResult" {
			continue
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

func parseMessage(env piMessageEnvelope, currentModel string) (ingest.Message, error) {
	msg := ingest.Message{
		ID:    env.ID,
		Role:  env.Message.Role,
		Model: currentModel,
	}

	if env.Timestamp != "" {
		msg.Timestamp = ingestkit.ParseTime(env.Timestamp)
	}

	if env.Message.Model != "" {
		msg.Model = env.Message.Model
	}

	switch env.Message.Role {
	case "user":
		msg.Content = extractTextContent(env.Message.Content)

	case "assistant":
		parts, tc, reasoning, err := parseAssistantContent(env.Message.Content)
		if err != nil {
			return msg, nil
		}
		msg.Content = parts
		msg.ToolCalls = tc
		msg.Reasoning = reasoning

		if env.Message.Usage != nil {
			msg.TokensInput = env.Message.Usage.Input
			msg.TokensOutput = env.Message.Usage.Output
		}

	case "toolResult":
		msg.Content = extractTextContent(env.Message.Content)
		if env.Message.ToolCallID != "" {
			md := map[string]string{
				"toolCallId": env.Message.ToolCallID,
				"toolName":   env.Message.ToolName,
			}
			if env.Message.IsError {
				md["isError"] = "true"
			}
			msg.Metadata = md
		}
	}

	return msg, nil
}

// extractTextContent extracts text from a content array like [{"type":"text","text":"..."}]
// or returns the string directly if it's already a plain string.
func extractTextContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try plain string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try array of parts
	var parts []piContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			if p.Type == "text" {
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(p.Text)
			}
		}
		return b.String()
	}

	return ""
}

// parseAssistantContent parses the assistant content array into text, tool calls, and reasoning.
func parseAssistantContent(raw json.RawMessage) (text string, toolCalls []ingest.ToolCall, reasoning string, err error) {
	if len(raw) == 0 {
		return "", nil, "", nil
	}

	var parts []piContentPart
	if err := json.Unmarshal(raw, &parts); err != nil {
		return string(raw), nil, "", nil
	}

	var textParts []string
	for _, p := range parts {
		switch p.Type {
		case "text":
			textParts = append(textParts, p.Text)
		case "thinking":
			reasoning = p.Thinking
		case "toolCall":
			input := ""
			if p.Arguments != nil {
				input = string(p.Arguments)
			}
			tc := ingest.ToolCall{
				ID:     p.ToolCallID,
				Name:   p.Name,
				Input:  input,
				Status: "completed",
			}
			normalizeToolCall(&tc)
			toolCalls = append(toolCalls, tc)
		}
	}

	text = strings.Join(textParts, "\n")
	return text, toolCalls, reasoning, nil
}

// hasPlanContent checks if text contains markers suggesting a plan or
// structured task list (mirrors the OpenCode heuristic).
func hasPlanContent(text string) bool {
	markers := []string{
		"- [", "## Plan", "## Implemen", "## Steps", "## Todo",
		"## Task", "## Goal", "## Object", "## Check",
		"Step ", "\n1. ", "\n2. ", "\n3. ",
	}
	for _, m := range markers {
		if strings.Contains(text, m) {
			return true
		}
	}
	return false
}

// parsePiEditContent extracts file path and old/new content from an edit or
// write tool call, handling Pi's native formats:
//   - write:  {"content": "...", "filePath": "..."}
//   - edit:   {"edits": [{"oldText": "...", "newText": "..."}], "filePath": "..."}
func parsePiEditContent(tc ingest.ToolCall) (filePath, oldStr, newStr string) {
	var input struct {
		FilePath string        `json:"filePath"`
		Path     string        `json:"path"`
		Content  string        `json:"content"`
		Edits    []piEditEntry `json:"edits,omitempty"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return "", "", ""
	}

	filePath = input.FilePath
	if filePath == "" {
		filePath = input.Path
	}
	if filePath == "" {
		return "", "", ""
	}

	switch tc.Name {
	case "write":
		newStr = input.Content
		if newStr == "" {
			var fallback struct {
				NewString string `json:"newString"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &fallback); err == nil {
				newStr = fallback.NewString
			}
		}
		return filePath, "", newStr
	case "edit":
		if len(input.Edits) == 0 {
			// Some edit calls may use oldString/newString directly
			var fallback struct {
				OldString string `json:"oldString"`
				NewString string `json:"newString"`
			}
			if err := json.Unmarshal([]byte(tc.Input), &fallback); err == nil {
				return filePath, fallback.OldString, fallback.NewString
			}
			return filePath, "", ""
		}
		// Merge all edits into a single old/new pair.
		// Each edit entry is a standalone replacement within the file; concatenating
		// them produces a single diff that the frontend can display as multiple hunks.
		var oldParts, newParts []string
		for _, e := range input.Edits {
			oldParts = append(oldParts, e.OldText)
			newParts = append(newParts, e.NewText)
		}
		return filePath, strings.Join(oldParts, "\n"), strings.Join(newParts, "\n")
	}
	return "", "", ""
}

// normalizeToolCall maps Pi-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers.
func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "read_file", "read_files", "view_file":
		tc.Name = "read"
	case "write", "write_file", "create_file", "new_file":
		tc.Name = "write"
	case "edit", "edit_file", "edit_file_content", "modify_file", "apply_diff", "replace_text":
		tc.Name = "edit"
	case "delete_file", "remove_file":
		tc.Name = "delete"
	case "run_command", "execute_command", "shell", "run_terminal":
		tc.Name = "bash"
	case "search_files", "grep_search", "find_text", "search_text":
		tc.Name = "grep"
	case "list_files", "list_directory", "find_file":
		tc.Name = "glob"
	case "ask_question", "ask_user", "prompt_user":
		tc.Name = "question"
	case "fetch_url", "http_request", "make_request", "web_fetch":
		tc.Name = "webfetch"
	case "web_search", "search_web", "search_internet":
		tc.Name = "websearch"
	default:
		// Unrecognized name — leave as-is; frontend's effectiveToolKind() 
		// may still infer the kind from input field presence.
		return
	}

	if tc.Input == "" {
		return
	}

	var p map[string]any
	if err := json.Unmarshal([]byte(tc.Input), &p); err != nil {
		return
	}

	// Normalize field names within the input JSON to match frontend conventions.
	switch tc.Name {
	case "read":
		// Pi may use "path", "file", "file_path" for the file path
		if v, ok := p["file"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		// Pi read output format: {"content":"...","filePath":"..."}
		if content := ingestkit.ExtractJSONString(tc.Output, "content"); content != "" {
			tc.Output = content
		}

	case "edit", "write":
		if v, ok := p["file"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file")
		}
		if v, ok := p["path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "path")
		}
		if v, ok := p["file_path"]; ok {
			if _, exists := p["filePath"]; !exists {
				p["filePath"] = v
			}
			delete(p, "file_path")
		}
		// Pi may use "new_content", "content", "updated_content" for new string
		if v, ok := p["new_content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "new_content")
		}
		if v, ok := p["updated_content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			delete(p, "updated_content")
		}
		if v, ok := p["content"]; ok {
			if _, exists := p["newString"]; !exists {
				p["newString"] = v
			}
			// Keep "content" field — the frontend and parsePiEditContent
			// both read "content" for write tool calls.
		}
		// Pi may use "old_content" for old string
		if v, ok := p["old_content"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "old_content")
		}

		// Pi edit calls use an "edits" array of {oldText, newText} pairs.
		// Flatten it into oldString/newString so the frontend's EditToolDiff can render diffs.
		if editsRaw, ok := p["edits"]; ok {
			if editsArr, ok := editsRaw.([]any); ok && len(editsArr) > 0 {
				var oldParts, newParts []string
				for _, e := range editsArr {
					if em, ok := e.(map[string]any); ok {
						if ot, ok := em["oldText"].(string); ok {
							oldParts = append(oldParts, ot)
						}
						if nt, ok := em["newText"].(string); ok {
							newParts = append(newParts, nt)
						}
					}
				}
				if _, exists := p["oldString"]; !exists && len(oldParts) > 0 {
					p["oldString"] = strings.Join(oldParts, "\n")
				}
				if _, exists := p["newString"]; !exists && len(newParts) > 0 {
					p["newString"] = strings.Join(newParts, "\n")
				}
			}
		}

	case "bash":
		// Pi bash output: {"stdout":"...","stderr":"...","exitCode":N}
		if stdout := ingestkit.ExtractJSONString(tc.Output, "stdout"); stdout != "" {
			if stderr := ingestkit.ExtractJSONString(tc.Output, "stderr"); stderr != "" {
				tc.Output = stdout + "\n" + stderr
			} else {
				tc.Output = stdout
			}
		}
		if exitCode := ingestkit.ExtractJSONString(tc.Output, "exitCode"); exitCode != "" && exitCode != "0" {
			tc.Metadata = `{"exit":` + exitCode + `}`
		}

	case "grep":
		if v, ok := p["pattern"]; ok {
			if _, exists := p["query"]; !exists {
				p["query"] = v
			}
			delete(p, "pattern")
		}

	case "glob":
		// Pi glob uses standard "pattern" and "directory" fields
	}

	if out, err := json.Marshal(p); err == nil {
		tc.Input = string(out)
	}
}

// --- Helpers ---

func extractTimestampFromFilename(filename string) time.Time {
	parts := strings.SplitN(filename, "_", 2)
	if len(parts) < 1 {
		return time.Now()
	}
	ts := strings.ReplaceAll(parts[0], "T", " ")
	ts = strings.TrimSuffix(ts, "Z")

	for _, layout := range []string{
		"2006-01-02 15:04:05.999",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, ts); err == nil {
			return t
		}
	}
	return time.Now()
}

func deriveTitle(id, cwd string) string {
	// Use first 8 chars of ID as fallback
	if len(id) >= 8 {
		return id[:8]
	}
	if cwd != "" {
		return filepath.Base(cwd)
	}
	return id
}
