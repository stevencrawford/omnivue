package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/ingest/ingestkit"
)

func (a *Adapter) ListSessions(ctx context.Context) ([]ingest.Session, error) {
	if cached := a.cache.List(); len(cached) > 0 {
		return cached, nil
	}
	return a.loadSessions(ctx)
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	if s, ok := a.cache.Lookup(id); ok {
		return &s, nil
	}

	fpath := a.findSessionFile(id)
	if fpath == "" {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	return a.parseSessionFile(fpath)
}

func (a *Adapter) loadSessions(ctx context.Context) ([]ingest.Session, error) {
	entries := make(map[string]ingest.SessionEntry)

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
		modTime := fi.ModTime().UnixMilli()

		session, err := a.parseSessionFile(p)
		if err != nil {
			return nil
		}
		id := session.ID
		entries[id] = ingest.SessionEntry{
			Session:  *session,
			FilePath: p,
			ModTime:  modTime,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("pi adapter: walking directory: %w", err)
	}

	a.cache.ReplaceAll(entries)
	return a.cache.List(), nil
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

	repo := ingestkit.DeriveRepository("", "")
	if header.CWD != "" {
		repo = ingestkit.DeriveRepository(header.CWD, "")
	}
	title := deriveTitle(header.ID, header.CWD)

	session := &ingest.Session{
		ID:         header.ID,
		SourceID:   a.basePath,
		Title:      title,
		Repository: repo,
		Directory:  header.CWD,
		Agent:      ingest.AgentPi,
		Status:     ingest.SessionStatusActive,
		CreatedAt:  parsedTime,
		UpdatedAt:  parsedTime,
	}

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
				if t, err := time.Parse(time.RFC3339, env.Timestamp); err == nil {
					if t.After(session.UpdatedAt) {
						session.UpdatedAt = t
					}
				}
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
	if len(id) >= 8 {
		return id[:8]
	}
	if cwd != "" {
		return filepath.Base(cwd)
	}
	return id
}
