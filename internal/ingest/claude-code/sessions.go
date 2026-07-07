package claudecode

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

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

	fpath := a.findSessionFile(id)
	if fpath == "" {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	projectPath := filepath.Dir(fpath)
	for {
		parent := filepath.Dir(projectPath)
		if filepath.Base(parent) == projectDir || parent == projectPath {
			break
		}
		projectPath = parent
	}
	return a.parseSessionFile(fpath, projectPath)
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

	isSubagent := strings.Contains(fpath, "/subagents/")
	var sessionID string
	if isSubagent {
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
		ID:               sessionID,
		Title:            title,
		Repository:       repo,
		Branch:           gitBranch,
		Agent:            ingest.AgentClaudeCode,
		Model:            simplifiedModel,
		Cost:             calculateCost(simplifiedModel, tokensIn, tokensOut, cacheWrite, cacheRead),
		Directory:        cwd,
		Status:           status,
		CreatedAt:        firstTS,
		UpdatedAt:        lastTS,
		TokensInput:      tokensIn,
		TokensOutput:     tokensOut,
		TokensCacheRead:  cacheRead,
		TokensCacheWrite: cacheWrite,
		MessageCount:     msgCount,
		SubAgent:         subAgentName,
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
