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

// Adapter reads Pi agent session data from JSONL files.
type Adapter struct {
	basePath string
	cache    *ingest.SessionCache
}

// New creates a new Pi adapter for the given base path.
func New(basePath string) (*Adapter, error) {
	return &Adapter{
		basePath: basePath,
		cache:    ingest.NewSessionCache(basePath, ".jsonl"),
	}, nil
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
	if cached := a.cache.List(); len(cached) > 0 {
		return cached, nil
	}
	return a.loadSessions(ctx)
}

func (a *Adapter) Session(ctx context.Context, id string) (*ingest.Session, error) {
	if s, ok := a.cache.Lookup(id); ok {
		return &s, nil
	}

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
	return planFromMessages(msgs), nil
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
		status := ingest.DiffModified
		if e.OldStr == "" && e.NewStr != "" {
			status = ingest.DiffAdded
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
	maxMod, err := a.cache.ScanAndRebuild(func(path string) (*ingest.Session, int64, error) {
		session, err := a.parseSessionFile(path)
		if err != nil {
			return nil, 0, err
		}
		fi, err := os.Stat(path)
		if err != nil {
			return nil, 0, err
		}
		return session, fi.ModTime().UnixMilli(), nil
	})
	if err != nil {
		return a.cache.LastModified(), nil
	}
	return maxMod, nil
}

func (a *Adapter) Close() error {
	return nil
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

	repo := ingestkit.DeriveRepository(header.CWD, "")
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
