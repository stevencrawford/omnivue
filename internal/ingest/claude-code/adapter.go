package claudecode

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
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
	basePath  string
	claudeDir string

	mu       sync.RWMutex
	sessions []ingest.Session
	lastMod  int64
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
			Source:   ingest.PlanDataFile,
		}, nil
	}

	return nil, nil
}

func (a *Adapter) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	edits, err := a.Edits(ctx, sessionID)
	if err != nil {
		return nil, nil
	}
	if len(edits) == 0 {
		return nil, nil
	}

	var diffs []ingest.DiffFile
	for _, e := range edits {
		if e.OldStr == "" || e.NewStr == "" {
			continue
		}
		patch, err := computeUnifiedDiff(e.FilePath, e.OldStr, e.NewStr)
		if err != nil {
			continue
		}
		diffs = append(diffs, ingest.DiffFile{
			Path:  e.FilePath,
			Patch: patch,
		})
	}
	if len(diffs) == 0 {
		return nil, nil
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
			if tc.Name != "write" && tc.Name != "edit" {
				continue
			}
			var fp, content, oldStr string
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
					FilePath  string `json:"file_path"`
					OldStr    string `json:"old_str"`
					OldString string `json:"old_string"`
					NewStr    string `json:"new_str"`
					NewString string `json:"new_string"`
					Content   string `json:"content"`
				}
				if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
					continue
				}
				fp = input.FilePath
				oldStr = input.OldStr
				if oldStr == "" {
					oldStr = input.OldString
				}
				content = input.NewStr
				if content == "" {
					content = input.NewString
				}
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
				OldStr:    oldStr,
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

	status := ingest.SessionStatusActive
	if hasRealUser && lastTS.Before(time.Now().Add(-5*time.Minute)) {
		status = ingest.SessionStatusCompleted
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
				Role:      ingest.MessageRole(env.Message.Role),
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
							toolCalls[i].Status = ingest.ToolCallCompleted
						}
					}
					toolCallsByID[toolCalls[i].ID] = &toolCalls[i]
				}
				msg.ToolCalls = toolCalls

			case "user":
				msg.Content = extractUserContent(env.Message.Content)
				msg = processUserMessage(msg)
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
					tc.Status = ingest.ToolCallFailed
				} else {
					tc.Status = ingest.ToolCallCompleted
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
		normalizeClaudeInternalTool(tc)
	}
}

// normalizeClaudeInternalTool handles Claude Code internal tool names that
// originate from harness tool definitions rather than standard tool calls.
func normalizeClaudeInternalTool(tc *ingest.ToolCall) {
	switch tc.Name {
	case "TaskCreate:TaskCreate":
		tc.Name = "todowrite"
		normalizeTaskCreateInput(tc)
	case "TaskUpdate:TaskUpdate":
		tc.Name = "todowrite"
		normalizeTaskUpdateInput(tc)
	case "Agent:Agent":
		tc.Name = "task"
	case "TaskOutput:TaskOutput":
		tc.Name = "task_complete"
	default:
		// Strip harness prefix (e.g., "ToolName:ToolName" → "ToolName")
		if idx := strings.Index(tc.Name, ":"); idx > 0 && idx+1 < len(tc.Name) && tc.Name[:idx] == tc.Name[idx+1:] {
			tc.Name = tc.Name[:idx]
		}
	}
}

// normalizeTaskCreateInput transforms TaskCreate input to todowrite format.
// Input:  {"subject":"...", "description":"...", "activeForm":"..."}
// Output: {"todos":[{"content":"<subject>","status":"pending","priority":"medium","id":""}]}.
func normalizeTaskCreateInput(tc *ingest.ToolCall) {
	var input struct {
		Subject string `json:"subject"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if input.Subject == "" {
		return
	}
	todos := []map[string]string{{
		"content":  input.Subject,
		"status":   "pending",
		"priority": "medium",
		"id":       "",
	}}
	transformed, err := json.Marshal(map[string]any{"todos": todos})
	if err != nil {
		return
	}
	tc.Input = string(transformed)
}

// normalizeTaskUpdateInput transforms TaskUpdate input to todowrite format.
// Input:  {"taskId":"1","status":"in_progress"}
// Output: {"todos":[{"content":"Task #1","status":"in_progress","priority":"medium","id":"1"}]}.
func normalizeTaskUpdateInput(tc *ingest.ToolCall) {
	var input struct {
		TaskID string `json:"taskId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &input); err != nil {
		return
	}
	if input.TaskID == "" {
		return
	}
	status := input.Status
	if status == "" {
		status = "in_progress"
	}
	todos := []map[string]string{{
		"content":  fmt.Sprintf("Task #%s", input.TaskID),
		"status":   status,
		"priority": "medium",
		"id":       input.TaskID,
	}}
	transformed, err := json.Marshal(map[string]any{"todos": todos})
	if err != nil {
		return
	}
	tc.Input = string(transformed)
}

// interruptedContentRx matches user interrupt messages from Claude Code.
var interruptedContentRx = regexp.MustCompile(`(?i)\[Request interrupted by user`)

// commandTagRx matches command tags embedded in user messages.
var commandTagRx = regexp.MustCompile(`(?s)<command-name>(.*?)</command-name>\s*<command-message>(.*?)</command-message>\s*<command-args>(.*?)</command-args>`)

// processUserMessage handles interrupt detection and command tag processing.
func processUserMessage(msg ingest.Message) ingest.Message {
	content := msg.Content

	if interruptedContentRx.MatchString(content) {
		if msg.Metadata == nil {
			msg.Metadata = make(map[string]string)
		}
		msg.Metadata["type"] = "turn_aborted"
		return msg
	}

	matches := commandTagRx.FindStringSubmatch(content)
	if len(matches) == 4 {
		cmdName := strings.TrimSpace(matches[1])
		cmdMessage := strings.TrimSpace(matches[2])
		cmdArgs := strings.TrimSpace(matches[3])

		msg.Content = commandTagRx.ReplaceAllString(content, "")

		if msg.Metadata == nil {
			msg.Metadata = make(map[string]string)
		}
		msg.Metadata["command_name"] = cmdName
		msg.Metadata["command_message"] = cmdMessage
		msg.Metadata["command_args"] = cmdArgs

		if cmdName == "/model" {
			tc := ingest.ToolCall{
				ID:     "cmd-" + cmdName,
				Name:   "model_switch",
				Input:  fmt.Sprintf(`{"model":"%s"}`, cmdMessage),
				Status: ingest.ToolCallCompleted,
			}
			msg.ToolCalls = append(msg.ToolCalls, tc)
		}
	}

	return msg
}

// computeUnifiedDiff generates a unified diff patch string for a file change.
func computeUnifiedDiff(filePath, oldStr, newStr string) (string, error) {
	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)

	var hunks []string
	var oldLine, newLine int

	for oldLine < len(oldLines) || newLine < len(newLines) {
		if oldLine < len(oldLines) && newLine < len(newLines) && oldLines[oldLine] == newLines[newLine] {
			oldLine++
			newLine++
			continue
		}

		oldStart := oldLine
		newStart := newLine
		for oldLine < len(oldLines) || newLine < len(newLines) {
			if oldLine < len(oldLines) && newLine < len(newLines) && oldLines[oldLine] == newLines[newLine] {
				break
			}
			if oldLine < len(oldLines) {
				oldLine++
			}
			if newLine < len(newLines) {
				newLine++
			}
		}
		oldEnd := oldLine
		newEnd := newLine

		hunk := fmt.Sprintf("@@ -%d,%d +%d,%d @@", oldStart+1, oldEnd-oldStart, newStart+1, newEnd-newStart)
		var lines []string
		for i := oldStart; i < oldEnd; i++ {
			lines = append(lines, "-"+oldLines[i])
		}
		for i := newStart; i < newEnd; i++ {
			lines = append(lines, "+"+newLines[i])
		}
		hunk += "\n" + strings.Join(lines, "\n")
		hunks = append(hunks, hunk)
	}

	if len(hunks) == 0 {
		return "", nil
	}

	header := fmt.Sprintf("--- a/%s\n+++ b/%s\n", filePath, filePath)
	return header + strings.Join(hunks, "\n") + "\n", nil
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	var lines []string
	scanner := bufio.NewScanner(strings.NewReader(s))
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if len(lines) == 0 {
		lines = []string{""}
	}
	return lines
}

// resolveParentSessionID extracts the parent session ID from a subagent composite ID.
func resolveParentSessionID(sessionID string) string {
	if idx := strings.Index(sessionID, "-agent-"); idx > 0 {
		return sessionID[:idx]
	}
	return sessionID
}
