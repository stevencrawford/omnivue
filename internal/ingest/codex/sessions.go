package codex

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
	filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error {
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

func (a *Adapter) sessionFilePath(sessionID string) string {
	sessionsDir := filepath.Join(a.basePath, "sessions")
	var found string
	filepath.WalkDir(sessionsDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if strings.Contains(d.Name(), sessionID) {
			found = p
			return fmt.Errorf("found:%s", p)
		}
		return nil
	})
	return found
}
