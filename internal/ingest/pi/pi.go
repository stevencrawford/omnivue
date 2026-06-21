package pi

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
	filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
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
	if cached != nil {
		return cached, nil
	}
	return a.loadSessions(ctx)
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

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[j].UpdatedAt.Before(sessions[i].UpdatedAt)
	})

	a.mu.Lock()
	a.sessions = sessions
	a.lastMod = maxMod
	a.mu.Unlock()

	return sessions, nil
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
	Input       int `json:"input"`
	Output      int `json:"output"`
	CacheRead   int `json:"cacheRead"`
	CacheWrite  int `json:"cacheWrite"`
	TotalTokens int `json:"totalTokens"`
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

func (a *Adapter) parseSessionFile(fpath string) (*ingest.Session, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := util.NewJSONLScanner(f)
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

	repo := util.DeriveRepository(header.CWD, "")
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

	// Count messages and track current model by scanning lines
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
			}
		}
	}

	session.MessageCount = msgCount
	session.Model = currentModel

	return session, nil
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

	// Fallback: find and parse just the one session file
	fpath := a.findSessionFile(id)
	if fpath == "" {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	return a.parseSessionFile(fpath)
}

func (a *Adapter) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	filePath := a.findSessionFile(sessionID)
	if filePath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parsePiMessages(filePath, sessionID)
}

func (a *Adapter) findSessionFile(sessionID string) string {
	var found string
	filepath.WalkDir(a.basePath, func(p string, d os.DirEntry, err error) error {
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
		f, err := os.Open(p)
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

	scanner := util.NewJSONLScanner(f)
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

	sort.Slice(parsed, func(i, j int) bool {
		return parsed[i].Timestamp.Before(parsed[j].Timestamp)
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
		tcID, _ := tr.Metadata["toolCallId"]
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
		msg.Timestamp = util.ParseTime(env.Timestamp)
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

func (a *Adapter) GetPlan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	return nil, nil
}

func (a *Adapter) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	return nil, nil
}

func (a *Adapter) GetEdits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	return nil, nil
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

// normalizeToolCall maps Pi-native tool call names and field names to the
// standard conventions expected by the frontend's tool renderers.
func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "read_file", "read_files", "view_file":
		tc.Name = "read"
	case "write_file", "create_file", "new_file":
		tc.Name = "write"
	case "edit_file", "edit_file_content", "modify_file", "apply_diff", "replace_text":
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
		if content := util.ExtractJSONString(tc.Output, "content"); content != "" {
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
		// Pi may use "old_content" for old string
		if v, ok := p["old_content"]; ok {
			if _, exists := p["oldString"]; !exists {
				p["oldString"] = v
			}
			delete(p, "old_content")
		}

	case "bash":
		// Pi bash output: {"stdout":"...","stderr":"...","exitCode":N}
		if stdout := util.ExtractJSONString(tc.Output, "stdout"); stdout != "" {
			if stderr := util.ExtractJSONString(tc.Output, "stderr"); stderr != "" {
				tc.Output = stdout + "\n" + stderr
			} else {
				tc.Output = stdout
			}
		}
		if exitCode := util.ExtractJSONString(tc.Output, "exitCode"); exitCode != "" && exitCode != "0" {
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


