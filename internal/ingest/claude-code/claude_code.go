package claudecode

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
	ingest.Register(ingest.AgentClaudeCode, "Claude Code", "~/.claude",
		func(path string) (ingest.Adapter, error) { return New(path) },
		detectPath)
}

// detectPath checks whether the given path contains Claude Code session data.
func detectPath(path string) *ingest.DiscoveredSource {
	projectsDir := filepath.Join(path, "projects")
	if !ingestkit.PathExists(projectsDir) {
		return nil
	}
	ents, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}
	var found bool
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		sessionEnts, err := os.ReadDir(filepath.Join(projectsDir, ent.Name()))
		if err != nil {
			continue
		}
		for _, se := range sessionEnts {
			if !se.IsDir() && filepath.Ext(se.Name()) == ".jsonl" {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		return nil
	}
	return &ingest.DiscoveredSource{
		Path:      path,
		AgentType: ingest.AgentClaudeCode,
		Label:     "Claude Code",
	}
}

// projectDir is the subdirectory within ~/.claude that holds session data.
const projectDir = "projects"

// planDir is the subdirectory within ~/.claude that holds exported plan files.
const planDir = "plans"

// Adapter reads Claude Code session data from JSONL files in ~/.claude/projects/.
type Adapter struct {
	basePath string
	claudeDir string

	mu         sync.RWMutex
	sessions   []ingest.Session
	lastMod    int64
}

// New creates a new Claude Code adapter for the given base path.
// basePath should be the Claude Code data directory (e.g., ~/.claude).
func New(basePath string) (*Adapter, error) {
	return &Adapter{
		basePath:  basePath,
		claudeDir: basePath,
	}, nil
}

func (a *Adapter) Type() ingest.AgentType {
	return ingest.AgentClaudeCode
}

func (a *Adapter) Detect(path string) bool {
	projectsPath := filepath.Join(path, projectDir)
	fi, err := os.Stat(projectsPath)
	if err != nil || !fi.IsDir() {
		return false
	}
	// Verify at least one session JSONL exists
	ents, err := os.ReadDir(projectsPath)
	if err != nil {
		return false
	}
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		sessionEnts, err := os.ReadDir(filepath.Join(projectsPath, ent.Name()))
		if err != nil {
			continue
		}
		for _, se := range sessionEnts {
			if !se.IsDir() && strings.HasSuffix(se.Name(), ".jsonl") {
				return true
			}
		}
	}
	return false
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

	// Fallback: scan for the session file
	fpath := a.findSessionFile(id)
	if fpath == "" {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	projectPath := filepath.Dir(fpath)
	// Walk up to find the project directory
	for {
		parent := filepath.Dir(projectPath)
		if filepath.Base(parent) == projectDir || parent == projectPath {
			break
		}
		projectPath = parent
	}
	return a.parseSessionFile(fpath, projectPath)
}

func (a *Adapter) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	fpath := a.findSessionFile(sessionID)
	if fpath == "" {
		return nil, fmt.Errorf("session file not found: %s", sessionID)
	}
	return a.parseMessages(fpath, sessionID)
}

func (a *Adapter) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	// First, try to find the slug from the session messages
	fpath := a.findSessionFile(sessionID)
	if fpath == "" {
		return nil, nil
	}

	slug := a.findSlugFromSession(fpath)
	if slug == "" {
		return nil, nil
	}

	// Look for plan file in ~/.claude/plans/{slug}.md
	planPath := filepath.Join(a.claudeDir, planDir, slug+".md")
	if ingestkit.PathExists(planPath) {
		content, err := os.ReadFile(planPath)
		if err != nil {
			return nil, nil
		}
		return &ingest.Plan{
			Markdown: string(content),
			Source:   "file",
		}, nil
	}

	return nil, nil
}

func (a *Adapter) Diffs(_ context.Context, _ string) ([]ingest.DiffFile, error) {
	return nil, nil
}

func (a *Adapter) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	msgs, err := a.Messages(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	var edits []ingest.FileEdit
	for _, m := range msgs {
		for _, tc := range m.ToolCalls {
			if tc.Name != "write" && tc.Name != "edit" {
				continue
			}
			var fp, content string
			if tc.Name == "write" {
				var input struct {
					FilePath string `json:"file_path"`
					Content  string `json:"content"`
				}
				if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
					continue
				}
				fp = input.FilePath
				content = input.Content
			} else {
				var input struct {
					FilePath string `json:"file_path"`
					OldStr   string `json:"old_str"`
					NewStr   string `json:"new_str"`
					Content  string `json:"content"`
				}
				if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
					continue
				}
				fp = input.FilePath
				content = input.NewStr
				if content == "" {
					content = input.Content
				}
			}
			if fp == "" {
				continue
			}
			edits = append(edits, ingest.FileEdit{
				FilePath:  fp,
				ToolName:  tc.Name,
				NewStr:    content,
				Timestamp: m.Timestamp,
			})
		}
	}
	if len(edits) == 0 {
		return nil, nil
	}
	return edits, nil
}

func (a *Adapter) ResumeCommand(session *ingest.Session) string {
	return fmt.Sprintf("cd %s && claude -p %s -s %s", session.Directory, session.Directory, session.ID)
}

func (a *Adapter) LastModified(_ context.Context) (int64, error) {
	a.mu.RLock()
	lastMod := a.lastMod
	a.mu.RUnlock()

	var maxMod int64
	projectsPath := filepath.Join(a.claudeDir, projectDir)

	filepath.WalkDir(projectsPath, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".jsonl") {
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

func (a *Adapter) loadSessions(_ context.Context) ([]ingest.Session, error) {
	projectsPath := filepath.Join(a.claudeDir, projectDir)
	ents, err := os.ReadDir(projectsPath)
	if err != nil {
		return nil, fmt.Errorf("claude-code adapter: reading projects dir: %w", err)
	}

	var sessions []ingest.Session
	var maxMod int64

	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		projectPath := filepath.Join(projectsPath, ent.Name())
		info, err := ent.Info()
		if err == nil {
			if m := info.ModTime().UnixMilli(); m > maxMod {
				maxMod = m
			}
		}
		sessionEnts, err := os.ReadDir(projectPath)
		if err != nil {
			continue
		}
		for _, se := range sessionEnts {
			if se.IsDir() || !strings.HasSuffix(se.Name(), ".jsonl") {
				continue
			}
			fpath := filepath.Join(projectPath, se.Name())
			session, err := a.parseSessionFile(fpath, projectPath)
			if err != nil {
				log.Printf("claude-code adapter: skipping %s: %v", fpath, err)
				continue
			}
			if session.MessageCount == 0 {
				continue
			}
			fi, err := se.Info()
			if err == nil {
				if m := fi.ModTime().UnixMilli(); m > maxMod {
					maxMod = m
				}
			}

			// Discover subagents
			sessionID := strings.TrimSuffix(se.Name(), ".jsonl")
			subagents := a.discoverSubagents(sessionID, projectPath)

			sessions = append(sessions, *session)
			for _, sa := range subagents {
				if sa.MessageCount == 0 {
					continue
				}
				if m := sa.UpdatedAt.UnixMilli(); m > maxMod {
					maxMod = m
				}
				sessions = append(sessions, sa)
			}
		}
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

func (a *Adapter) parseSessionFile(fpath, projectPath string) (*ingest.Session, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)

	var (
		parentSID   string
		slug        string
		cwd         string
		gitBranch   string
		firstTS     time.Time
		lastTS      time.Time
		model       string
		msgCount    int
		tokensIn    int
		tokensOut   int
		cacheRead   int
		cacheWrite  int
		hasRealUser bool
		agentID     string
	)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env claudeMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		if env.SessionID != "" {
			if parentSID == "" {
				parentSID = env.SessionID
			}
		}

		if env.Slug != "" && slug == "" {
			slug = env.Slug
		}

		if env.CWD != "" && cwd == "" {
			cwd = env.CWD
		}

		if env.GitBranch != "" && gitBranch == "" {
			gitBranch = env.GitBranch
		}

		if env.AgentID != "" && agentID == "" {
			agentID = env.AgentID
		}

		ts := ingestkit.ParseTime(env.Timestamp)
		if firstTS.IsZero() {
			firstTS = ts
		}
		if ts.After(lastTS) {
			lastTS = ts
		}

		if env.Type == "assistant" && env.Message != nil {
			if env.Message.Model != "" && model == "" {
				model = env.Message.Model
			}
			if env.Message.Usage != nil {
				tokensIn += env.Message.Usage.InputTokens
				tokensOut += env.Message.Usage.OutputTokens
				if env.Message.Usage.CacheReadInputTokens != nil {
					cacheRead += *env.Message.Usage.CacheReadInputTokens
				}
				if env.Message.Usage.CacheCreationInputTokens != nil {
					cacheWrite += *env.Message.Usage.CacheCreationInputTokens
				}
			}
		}

		if env.Type == "assistant" || (env.Type == "user" && !isMetaMsg(&env)) {
			msgCount++
			if env.Type == "user" && !isMetaMsg(&env) {
				hasRealUser = true
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	// Determine session ID
	// For subagent files (in /subagents/ directory), use composite ID
	isSubagent := strings.Contains(fpath, "/subagents/")
	var sessionID string
	if isSubagent {
		// Extract agent ID from filename (agent-{agentId}.jsonl) or use env field
		basename := strings.TrimSuffix(filepath.Base(fpath), ".jsonl")
		if aid, ok := strings.CutPrefix(basename, "agent-"); ok {
			if aid == "" {
				aid = agentID
			}
			sessionID = parentSID + "-agent-" + aid
		}
	} else {
		sessionID = parentSID
		if sessionID == "" {
			sessionID = strings.TrimSuffix(filepath.Base(fpath), ".jsonl")
		}
	}

	title := slug
	if title == "" {
		title = sessionID
		if len(title) > 8 {
			title = title[:8]
		}
	}

	repo := ingestkit.DeriveRepository(cwd, "")

	status := "active"
	if hasRealUser && lastTS.Before(time.Now().Add(-5*time.Minute)) {
		status = "completed"
	}

	subAgentName := ""
	if isSubagent && agentID != "" {
		subAgentName = "agent-" + agentID
	}

	simplifiedModel := simplifyModelName(model)
	return &ingest.Session{
		ID:                sessionID,
		Title:             title,
		Repository:        repo,
		Branch:            gitBranch,
		Agent:             ingest.AgentClaudeCode,
		Model:             simplifiedModel,
		Cost:              calculateCost(simplifiedModel, tokensIn, tokensOut, cacheWrite, cacheRead),
		Directory:         cwd,
		Status:            status,
		CreatedAt:         firstTS,
		UpdatedAt:         lastTS,
		TokensInput:       tokensIn,
		TokensOutput:      tokensOut,
		TokensCacheRead:   cacheRead,
		TokensCacheWrite:  cacheWrite,
		MessageCount:      msgCount,
		SubAgent:          subAgentName,
	}, nil
}

func (a *Adapter) discoverSubagents(sessionID, projectPath string) []ingest.Session {
	subagentDir := filepath.Join(projectPath, sessionID, "subagents")
	ents, err := os.ReadDir(subagentDir)
	if err != nil {
		return nil
	}

	var sessions []ingest.Session
	for _, ent := range ents {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".jsonl") {
			continue
		}
		fpath := filepath.Join(subagentDir, ent.Name())
		session, err := a.parseSessionFile(fpath, projectPath)
		if err != nil {
			log.Printf("claude-code adapter: skipping subagent %s: %v", fpath, err)
			continue
		}
		session.ParentID = sessionID
		sessions = append(sessions, *session)
	}
	return sessions
}

func (a *Adapter) parseMessages(fpath, sessionID string) ([]ingest.Message, error) {
	f, err := os.Open(fpath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)

	var messages []ingest.Message
	toolCallsByID := make(map[string]*ingest.ToolCall)
	var currentModel string

	// Resolve tool-results directory once
	parentSID := resolveParentSessionID(sessionID)
	toolResultsDir := resolveToolResultsDir(fpath, parentSID)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var env claudeMessageEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		// Skip non-message types
		switch env.Type {
		case "file-history-snapshot", "queue-operation", "system":
			continue
		case "progress":
			handleProgressEvent(line, toolCallsByID, parentSID)
			continue
		case "user":
			if isMetaMsg(&env) {
				continue
			}
		}

		ts := ingestkit.ParseTime(env.Timestamp)

		switch env.Type {
		case "user", "assistant":
			if env.Message == nil {
				continue
			}

			// Check if this is a user message containing embedded tool results
			if env.Type == "user" && env.Message.Role == "user" && env.Message.Content != nil {
				if extractAndMergeToolResults(env.Message.Content, toolCallsByID, env.IsError) {
					continue // tool_result user message, skip adding as a user message
				}
			}

			msg := ingest.Message{
				ID:        env.UUID,
				Role:      env.Message.Role,
				Timestamp: ts,
				Model:     currentModel,
			}

			if env.Message.Model != "" {
				currentModel = env.Message.Model
				msg.Model = currentModel
			}

			if env.Message.Usage != nil {
				msg.TokensInput = env.Message.Usage.InputTokens
				msg.TokensOutput = env.Message.Usage.OutputTokens
			}

			if env.Slug != "" {
				if msg.Metadata == nil {
					msg.Metadata = make(map[string]string)
				}
				msg.Metadata["slug"] = env.Slug
			}

			switch env.Message.Role {
			case "assistant":
				text, reasoning, toolCalls := parseAssistantContent(env.Message.Content, msg.ID)
				msg.Content = text
				msg.Reasoning = reasoning
				for i := range toolCalls {
					if toolResultsDir != "" {
						if tr := readToolResultFile(toolResultsDir, toolCalls[i].ID); tr != "" {
							toolCalls[i].Output = truncateToolOutput(tr, toolCalls[i].Name)
							toolCalls[i].Status = "completed"
						}
					}
					toolCallsByID[toolCalls[i].ID] = &toolCalls[i]
				}
				msg.ToolCalls = toolCalls

			case "user":
				msg.Content = extractUserContent(env.Message.Content)
			}

			messages = append(messages, msg)

		case "tool_result":
			tcID := env.ToolUseID
			if tcID == "" {
				continue
			}
			content := extractToolResultContent(env.Content)
			if content == "" && toolResultsDir != "" {
				content = readToolResultFile(toolResultsDir, tcID)
			}

			if tc, ok := toolCallsByID[tcID]; ok {
				tc.Output = truncateToolOutput(content, tc.Name)
				if env.IsError != nil && *env.IsError {
					tc.Status = "failed"
				} else {
					tc.Status = "completed"
				}
				if env.AgentID != "" {
					setToolMetadataSessionID(tc, parentSID, env.AgentID)
				}
			}
		}
	}

	// Normalize tool names
	for i := range messages {
		for j := range messages[i].ToolCalls {
			normalizeToolCall(&messages[i].ToolCalls[j])
		}
	}

	return messages, scanner.Err()
}

func (a *Adapter) findSlugFromSession(fpath string) string {
	f, err := os.Open(fpath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := ingestkit.NewJSONLScanner(f)
	for scanner.Scan() {
		var env claudeMessageEnvelope
		if json.Unmarshal(scanner.Bytes(), &env) != nil {
			continue
		}
		if env.Slug != "" {
			return env.Slug
		}
	}
	return ""
}

func (a *Adapter) findSessionFile(sessionID string) string {
	projectsPath := filepath.Join(a.claudeDir, projectDir)

	// Check if this is a subagent session ID (format: {parentID}-agent-{agentId})
	var subagentID string
	if strings.Contains(sessionID, "-agent-") {
		parts := strings.SplitN(sessionID, "-agent-", 2)
		if len(parts) == 2 {
			subagentID = parts[1]
		}
	}

	var found string
	filepath.WalkDir(projectsPath, func(p string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || found != "" {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		basename := strings.TrimSuffix(d.Name(), ".jsonl")
		if basename == sessionID {
			// Direct match (parent session or standalone)
			found = p
		} else if subagentID != "" && strings.HasPrefix(basename, "agent-") {
			// Check for subagent match: look in subagents/ directory
			aid := strings.TrimPrefix(basename, "agent-")
			if aid == subagentID && strings.Contains(p, "/subagents/") {
				found = p
			}
		}
		return nil
	})

	return found
}

func isMetaMsg(env *claudeMessageEnvelope) bool {
	if env.IsMeta != nil && *env.IsMeta {
		return true
	}
	return false
}

// embeddedToolResult represents a tool result embedded in a user message content array.
type embeddedToolResult struct {
	ToolUseID string          `json:"tool_use_id"`
	Type      string          `json:"type"`
	Content   json.RawMessage `json:"content"`
	IsError   *bool           `json:"is_error,omitempty"`
}

// extractAndMergeToolResults checks if a user message content is actually an array of
// tool_result objects embedded inline (as Claude Code sometimes does). If so, it
// merges the outputs into toolCallsByID and returns true (skip the user message).
func extractAndMergeToolResults(raw json.RawMessage, toolCallsByID map[string]*ingest.ToolCall, parentIsError *bool) bool {
	if len(raw) == 0 {
		return false
	}

	// Try parsing as array of embedded tool results
	var results []embeddedToolResult
	if json.Unmarshal(raw, &results) != nil {
		return false
	}

	// Check if at least one entry is a tool_result
	hasToolResult := false
	for _, r := range results {
		if r.Type == "tool_result" || r.ToolUseID != "" {
			hasToolResult = true
			break
		}
	}
	if !hasToolResult {
		return false
	}

	for _, r := range results {
		if r.ToolUseID == "" {
			continue
		}
		content := ""
		if r.Content != nil {
			content = extractToolResultContent(r.Content)
		}
		isError := parentIsError
		if r.IsError != nil {
			isError = r.IsError
		}
		if tc, ok := toolCallsByID[r.ToolUseID]; ok {
			if content != "" {
				tc.Output = truncateToolOutput(content, tc.Name)
			}
			if isError != nil && *isError {
				tc.Status = "failed"
			} else {
				tc.Status = "completed"
			}
		}
	}

	return true
}

func extractUserContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try plain string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try content array (Claude Code sometimes embeds tool_results in user messages)
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var texts []string
		for _, p := range parts {
			if p.Type == "text" {
				texts = append(texts, p.Text)
			}
		}
		return strings.Join(texts, "\n")
	}

	return ""
}

func parseAssistantContent(raw json.RawMessage, _ string) (text, reasoning string, toolCalls []ingest.ToolCall) {
	if len(raw) == 0 {
		return "", "", nil
	}

	// Try as array of content parts first
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) != nil {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s, "", nil
		}
		return "", "", nil
	}

	var texts []string
	var thinkTexts []string

	for _, p := range parts {
		switch p.Type {
		case "text":
			texts = append(texts, p.Text)
		case "thinking":
			thinkTexts = append(thinkTexts, p.Thinking)
		case "tool_use":
			if p.Name == "ExitPlanMode" {
				// Transform exit_plan_mode input for the frontend renderer.
				// The frontend ExitPlanModeToolDiff expects: {"summary":"<plan markdown>"}
				// Claude Code stores the plan under either "plan", "content", or "summary" key.
				planText := extractPlanContent(p.Input)
				if planText != "" {
				transformed, err := json.Marshal(map[string]string{
					"summary": planText,
				})
				if err != nil {
					slog.Warn("failed to marshal plan text", "error", err)
					transformed = []byte("{}")
				}
					tc := ingest.ToolCall{
						ID:     p.ID,
						Name:   p.Name,
						Input:  string(transformed),
						Status: "running",
					}
					toolCalls = append(toolCalls, tc)
				} else {
					tc := ingest.ToolCall{
						ID:     p.ID,
						Name:   p.Name,
						Input:  string(p.Input),
						Status: "running",
					}
					toolCalls = append(toolCalls, tc)
				}
			} else if (p.Name == "Write" || p.Name == "Edit") && p.Input != nil {
				tc := ingest.ToolCall{
					ID:     p.ID,
					Name:   p.Name,
					Input:  truncateEditInput(p.Input),
					Status: "running",
				}
				toolCalls = append(toolCalls, tc)
			} else {
				input := ""
				if p.Input != nil {
					input = string(p.Input)
				}
				tc := ingest.ToolCall{
					ID:     p.ID,
					Name:   p.Name,
					Input:  ingestkit.TruncateContent(input, 2000),
					Status: "running",
				}
				toolCalls = append(toolCalls, tc)
			}
		}
	}

	text = strings.Join(texts, "\n")
	reasoning = strings.Join(thinkTexts, "\n")
	return text, reasoning, toolCalls
}

func extractToolResultContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try as string first
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}

	// Try as content array with text parts
	var parts []claudeContentPart
	if json.Unmarshal(raw, &parts) == nil {
		var texts []string
		for _, p := range parts {
			if p.Type == "text" {
				texts = append(texts, p.Text)
			}
		}
		return strings.Join(texts, "\n")
	}

	return ""
}

// truncateToolOutput truncates content to maxContentBytes unless the tool is a task.
func truncateToolOutput(content string, toolName string) string {
	if toolName == "task" || toolName == "Task" {
		return content
	}
	return ingestkit.TruncateContent(content, maxContentBytes)
}

const maxContentBytes = 2000

// truncateEditInput truncates only the content payload fields inside a Write/Edit
// tool call's JSON input, keeping the JSON valid so the frontend can still parse
// structural fields like file_path, old_str, new_str.
func truncateEditInput(raw json.RawMessage) string {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return ingestkit.TruncateContent(string(raw), maxContentBytes)
	}
	changed := false
	for _, key := range []string{"content", "new_str", "newStr", "old_str", "oldStr"} {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok && len(s) > maxContentBytes {
				m[key] = s[:maxContentBytes] + "\n… (truncated)"
				changed = true
			}
		}
	}
	if !changed {
		return string(raw)
	}
	result, err := json.Marshal(m)
	if err != nil {
		slog.Warn("failed to marshal truncated content", "error", err)
		return "{}"
	}
	return string(result)
}

// extractPlanContent extracts plan markdown from an ExitPlanMode tool_use input.
// Claude Code stores the plan under "plan", "content", or "summary" keys.
func extractPlanContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	for _, key := range []string{"plan", "content", "summary"} {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func readToolResultFile(toolResultsDir, toolUseID string) string {
	// Tool results are stored as {tool_use_id}.txt
	fpath := filepath.Join(toolResultsDir, toolUseID+".txt")
	content, err := os.ReadFile(fpath)
	if err != nil {
		return ""
	}
	return string(content)
}

// setToolMetadataSessionID sets the sessionId field in a tool call's metadata JSON.
func setToolMetadataSessionID(tc *ingest.ToolCall, parentSID, agentID string) {
	if agentID == "" {
		return
	}
	childID := parentSID + "-agent-" + agentID
	var md map[string]any
	if tc.Metadata != "" {
		if err := json.Unmarshal([]byte(tc.Metadata), &md); err != nil {
			slog.Warn("failed to unmarshal metadata", "error", err)
		}
	}
	if md == nil {
		md = make(map[string]any)
	}
	md["sessionId"] = childID
	mdBytes, err := json.Marshal(md)
	if err != nil {
		slog.Warn("failed to marshal metadata", "error", err)
		mdBytes = []byte("{}")
	}
	tc.Metadata = string(mdBytes)
}

// handleProgressEvent processes agent_progress events that carry Task tool results.
// These events contain the sub-agent's tool results and metadata linking back to
// the parent Task tool call via parentToolUseID.
func handleProgressEvent(line []byte, toolCallsByID map[string]*ingest.ToolCall, parentSID string) {
	var prog claudeProgressEnvelope
	if err := json.Unmarshal(line, &prog); err != nil {
		return
	}
	if prog.ParentToolUseID == "" || prog.Data == nil {
		return
	}
	tc, ok := toolCallsByID[prog.ParentToolUseID]
	if !ok {
		return
	}

	// Set sessionId metadata from the sub-agent ID
	if prog.Data.AgentID != "" {
		setToolMetadataSessionID(tc, parentSID, prog.Data.AgentID)
	}

	// Mark the task tool as completed
	tc.Status = "completed"

	// Extract content from the embedded tool result in the progress event
	if len(prog.Data.Message) == 0 {
		return
	}
	var wrapper progressMessageWrapper
	if json.Unmarshal(prog.Data.Message, &wrapper) != nil {
		return
	}
	if wrapper.Message == nil || len(wrapper.Message.Content) == 0 {
		return
	}
	content := extractToolResultContent(wrapper.Message.Content)
	if content == "" {
		return
	}
	tc.Output = truncateToolOutput(content, tc.Name)
}

func normalizeToolCall(tc *ingest.ToolCall) {
	switch tc.Name {
	case "Read":
		tc.Name = "read"
	case "Write":
		tc.Name = "write"
	case "Edit":
		tc.Name = "edit"
	case "Bash":
		tc.Name = "bash"
	case "Glob":
		tc.Name = "glob"
	case "Grep":
		tc.Name = "grep"
	case "Task":
		// Task tool spawns subagents — map to our internal task name
		tc.Name = "task"
	case "ExitPlanMode":
		tc.Name = "exit_plan_mode"
	case "Delete":
		tc.Name = "delete"
	case "WebFetch":
		tc.Name = "webfetch"
	case "WebSearch":
		tc.Name = "websearch"
	default:
	}
}

// resolveParentSessionID extracts the parent session ID from a subagent composite ID.
func resolveParentSessionID(sessionID string) string {
	if idx := strings.Index(sessionID, "-agent-"); idx > 0 {
		return sessionID[:idx]
	}
	return sessionID
}

// resolveToolResultsDir resolves the tool-results directory path from a session file path.
func resolveToolResultsDir(fpath, parentSID string) string {
	// Walk up to find the project directory (parent of the session directory)
	dir := filepath.Dir(fpath)
	for {
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		if filepath.Base(parent) == projectDir {
			// Found projects/ — tool-results dir is projects/<enc>/<parentSID>/tool-results/
			return filepath.Join(dir, parentSID, "tool-results")
		}
		dir = parent
	}
}

// simplifyModelName strips the "anthropic/" prefix from model names for display.
func simplifyModelName(model string) string {
	return strings.TrimPrefix(model, "anthropic/")
}

// anthropicPricing maps model names to per-million-token costs.
// Prices are for Claude 4.5 family and older Claude models.
var anthropicPricing = map[string]struct {
	Input, Output, CacheRead, CacheWrite float64
}{
	"claude-4-5-sonnet-20250929":       {3.00, 15.00, 0.30, 3.75},
	"claude-sonnet-4-5-20250929":       {3.00, 15.00, 0.30, 3.75},
	"claude-4-5-opus-20251101":         {15.00, 75.00, 1.50, 18.75},
	"claude-opus-4-5-20251101":         {15.00, 75.00, 1.50, 18.75},
	"claude-4-5-haiku-20251001":        {0.25, 1.25, 0.025, 0.3125},
	"claude-haiku-4-5-20251001":        {0.25, 1.25, 0.025, 0.3125},
	"claude-3-5-sonnet-20241022":       {3.00, 15.00, 0.30, 3.75},
	"claude-3-5-haiku-20241022":        {0.80, 4.00, 0.08, 1.00},
	"claude-3-opus-20240229":           {15.00, 75.00, 1.50, 18.75},
	"claude-3-sonnet-20240229":         {3.00, 15.00, 0.30, 3.75},
	"claude-3-haiku-20240307":          {0.25, 1.25, 0.025, 0.3125},
}

func calculateCost(model string, tokensIn, tokensOut, cacheWrite, cacheRead int) float64 {
	pricing, ok := anthropicPricing[model]
	if !ok {
		return 0
	}
	inputCost := float64(tokensIn) / 1_000_000.0 * pricing.Input
	outputCost := float64(tokensOut) / 1_000_000.0 * pricing.Output
	cacheReadCost := float64(cacheRead) / 1_000_000.0 * pricing.CacheRead
	cacheWriteCost := float64(cacheWrite) / 1_000_000.0 * pricing.CacheWrite
	return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
