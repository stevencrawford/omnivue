package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	_ "github.com/stevencrawford/omnivue/internal/ingest/claude-code"
	_ "github.com/stevencrawford/omnivue/internal/ingest/codex"
	_ "github.com/stevencrawford/omnivue/internal/ingest/copilot"
	_ "github.com/stevencrawford/omnivue/internal/ingest/cursor"
	_ "github.com/stevencrawford/omnivue/internal/ingest/opencode"
	_ "github.com/stevencrawford/omnivue/internal/ingest/pi"
	"github.com/stevencrawford/omnivue/internal/notify"
	"github.com/stevencrawford/omnivue/internal/static"
	"github.com/stevencrawford/omnivue/internal/store"
	"github.com/stevencrawford/omnivue/version"
)

// State holds the session manager state.
type State struct {
	mu          sync.RWMutex
	store       *store.Store
	adapters    map[string]ingest.Adapter // sourceID -> adapter
	sessions    []ingest.Session          // cached session list
	subscribers map[chan sseEvent]struct{}
	shutdownCh  chan struct{}
	restartCh   chan string
	pollStop    context.CancelFunc

	// prevStatus tracks the previous Status of each session so the poll loop
	// can detect status transitions and emit status notifications.
	prevStatus map[string]string

	// activeViews tracks the most recent time each session was reported as the
	// user's currently-viewed session. Used by the ExcludeActiveView setting.
	activeViewsMu sync.Mutex
	activeViews   map[string]time.Time
}

type sseEvent struct {
	Name string `json:"name"`
	Data string `json:"data,omitempty"`
}

// NewState creates a new State. It loads configured sources from the store
// and starts background polling.
func NewState(ctx context.Context) *State {
	s := &State{
		adapters:     make(map[string]ingest.Adapter),
		subscribers:  make(map[chan sseEvent]struct{}),
		shutdownCh:   make(chan struct{}, 1),
		restartCh:    make(chan string, 1),
		prevStatus:   make(map[string]string),
		activeViews:  make(map[string]time.Time),
	}

	// Open Omnivue store
	st, err := store.New()
	if err != nil {
		slog.Error("failed to open store", "error", err)
	} else {
		s.store = st
	}

	// Load configured sources and create adapters
	if s.store != nil {
		sources, err := s.store.ListSources()
		if err != nil {
			slog.Error("failed to list sources", "error", err)
		} else {
			for _, src := range sources {
				if !src.Enabled {
					continue
				}
				adapter, err := createAdapter(src)
				if err != nil {
					slog.Warn("failed to create adapter", "source", src.Path, "error", err)
					continue
				}
				s.adapters[src.ID] = adapter
				slog.Info("loaded source", "type", src.AgentType, "path", src.Path)
			}
		}
	}

	// Initial session load and indexing (background, non-blocking).
	// Uses the server lifecycle context so it is canceled on shutdown.
	go func() {
		s.refreshAndIndex(ctx)
	}()

	// Start poller
	pollCtx, pollCancel := context.WithCancel(ctx)
	s.pollStop = pollCancel
	go s.pollLoop(pollCtx)

	return s
}

func createAdapter(src ingest.Source) (ingest.Adapter, error) {
	return ingest.CreateAdapter(src)
}

// liveWindow defines how recently a session must have been updated to be
// considered "active" (live). Used as a server-side liveness heuristic since
// neither OpenCode nor Copilot expose an explicit in-progress flag.
const liveWindow = 2 * time.Minute

// pollCadenceLive / pollCadenceIdle control the adaptive poll interval. When
// at least one session is live, the server polls every 5s so the UI feels
// real-time; otherwise it backs off to 30s to save DB queries.
const (
	pollCadenceLive = 5 * time.Second
	pollCadenceIdle = 30 * time.Second
)

// pollInterval returns the cadence to use for the next poll tick, based on
// the number of currently-live sessions.
func pollInterval(liveCount int) time.Duration {
	if liveCount > 0 {
		return pollCadenceLive
	}
	return pollCadenceIdle
}

// --- Exported State methods ---

// ShutdownCh returns the shutdown signal channel.
func (s *State) ShutdownCh() <-chan struct{} {
	return s.shutdownCh
}

// RestartCh returns the restart signal channel.
func (s *State) RestartCh() <-chan string {
	return s.restartCh
}

// CloseAllSubscribers closes all SSE subscriber channels.
func (s *State) CloseAllSubscribers() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pollStop != nil {
		s.pollStop()
	}
	for ch := range s.subscribers {
		close(ch)
		delete(s.subscribers, ch)
	}
}

// Sessions returns the cached session list.
func (s *State) Sessions() []ingest.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]ingest.Session, len(s.sessions))
	copy(result, s.sessions)
	return result
}

// Session returns a single session by ID.
func (s *State) Session(ctx context.Context, id string) (*ingest.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, sess := range s.sessions {
		if sess.ID == id {
			return &sess, nil
		}
	}
	return nil, fmt.Errorf("session not found: %s", id)
}

// Messages returns messages for a session.
func (s *State) Messages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
	s.mu.RLock()
	// Find which adapter owns this session
	var sourceID string
	for _, sess := range s.sessions {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			break
		}
	}
	adapter := s.adapters[sourceID]
	s.mu.RUnlock()

	if adapter == nil {
		return nil, fmt.Errorf("no adapter for session: %s", sessionID)
	}
	return adapter.Messages(ctx, sessionID)
}

// Plan returns the plan for a session.
func (s *State) Plan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
	s.mu.RLock()
	var sourceID string
	for _, sess := range s.sessions {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			break
		}
	}
	adapter := s.adapters[sourceID]
	s.mu.RUnlock()

	if adapter == nil {
		return nil, fmt.Errorf("no adapter for session: %s", sessionID)
	}
	if ps, ok := adapter.(ingest.Planner); ok {
		return ps.Plan(ctx, sessionID)
	}
	return nil, nil
}

// Diffs returns file diffs for a session.
func (s *State) Diffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
	s.mu.RLock()
	var sourceID string
	for _, sess := range s.sessions {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			break
		}
	}
	adapter := s.adapters[sourceID]
	s.mu.RUnlock()

	if adapter == nil {
		return nil, fmt.Errorf("no adapter for session: %s", sessionID)
	}
	if ds, ok := adapter.(ingest.Differ); ok {
		return ds.Diffs(ctx, sessionID)
	}
	return []ingest.DiffFile{}, nil
}

// Edits returns raw edit tool call data for a session.
func (s *State) Edits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
	s.mu.RLock()
	var sourceID string
	for _, sess := range s.sessions {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			break
		}
	}
	adapter := s.adapters[sourceID]
	s.mu.RUnlock()

	if adapter == nil {
		return nil, fmt.Errorf("no adapter for session: %s", sessionID)
	}
	if es, ok := adapter.(ingest.Editor); ok {
		return es.Edits(ctx, sessionID)
	}
	return []ingest.FileEdit{}, nil
}

// AddSource adds a new source, creates its adapter (if enabled), and triggers a refresh.
// The session refresh and indexing run in the background so the HTTP handler returns
// immediately; an SSE "update" event is sent once the new source's sessions are loaded.
func (s *State) AddSource(ctx context.Context, src ingest.Source) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	if err := s.store.AddSource(src); err != nil {
		return err
	}
	if src.Enabled {
		adapter, err := createAdapter(src)
		if err != nil {
			slog.Warn("failed to create adapter for new source", "source", src.Path, "error", err)
		} else {
			s.mu.Lock()
			s.adapters[src.ID] = adapter
			s.mu.Unlock()
		}
	}
	go s.refreshAndIndex(context.WithoutCancel(ctx))
	return nil
}

// RemoveSource removes a source by ID, closes its adapter, and triggers a refresh.
func (s *State) RemoveSource(ctx context.Context, id string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	s.mu.Lock()
	if adapter, ok := s.adapters[id]; ok {
		adapter.Close()
		delete(s.adapters, id)
	}
	s.mu.Unlock()
	if err := s.store.RemoveSource(id); err != nil {
		return err
	}
	s.refreshSessions(ctx)
	s.sendEvent(sseEvent{Name: "update"})
	return nil
}

// UpdateSource updates a source and re-creates its adapter if needed.
// Like AddSource, the refresh runs in the background so the handler returns immediately.
func (s *State) UpdateSource(ctx context.Context, id, path, agentType, label string, enabled bool) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	// Close existing adapter
	s.mu.Lock()
	if adapter, ok := s.adapters[id]; ok {
		adapter.Close()
		delete(s.adapters, id)
	}
	s.mu.Unlock()

	if err := s.store.UpdateSource(id, path, agentType, label, enabled); err != nil {
		return err
	}

	// Re-create adapter if enabled
	if enabled {
		src, err := s.store.Source(id)
		if err != nil {
			return fmt.Errorf("failed to get updated source: %w", err)
		}
		adapter, err := createAdapter(*src)
		if err != nil {
			slog.Warn("failed to create adapter for updated source", "source", src.Path, "error", err)
		} else {
			s.mu.Lock()
			s.adapters[id] = adapter
			s.mu.Unlock()
		}
	}
	go s.refreshAndIndex(context.WithoutCancel(ctx))
	return nil
}

// Sources returns configured sources from the store.
func (s *State) Sources() []ingest.Source {
	if s.store == nil {
		return nil
	}
	sources, err := s.store.ListSources()
	if err != nil {
		slog.Error("failed to list sources", "error", err)
		return nil
	}
	return sources
}

// ResumeCommand returns the CLI command to resume a session.
func (s *State) ResumeCommand(ctx context.Context, sessionID string) (string, error) {
	s.mu.RLock()
	var sourceID string
	var sess *ingest.Session
	for i, se := range s.sessions {
		if se.ID == sessionID {
			sourceID = se.SourceID
			sess = &s.sessions[i]
			break
		}
	}
	adapter := s.adapters[sourceID]
	s.mu.RUnlock()

	if adapter == nil || sess == nil {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return adapter.ResumeCommand(sess), nil
}

// Search performs full-text search across indexed session content.
func (s *State) Search(query string, limit int, sessionID string) ([]store.SearchResult, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	results, err := s.store.Search(query, limit, sessionID)
	if err != nil {
		return nil, err
	}
	// Enrich results with session title
	s.mu.RLock()
	sessionTitles := make(map[string]string, len(s.sessions))
	for _, sess := range s.sessions {
		sessionTitles[sess.ID] = sess.Title
	}
	s.mu.RUnlock()
	for i := range results {
		if title, ok := sessionTitles[results[i].SessionID]; ok {
			results[i].SessionName = title
		}
	}
	return results, nil
}

// Config returns all config key-value pairs.
func (s *State) Config() (map[string]string, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.AllConfig()
}

// SetConfig upserts a config key-value pair.
func (s *State) SetConfig(key, value string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.SetConfig(key, value)
}

// RecentSearches returns the list of recent search queries.
func (s *State) RecentSearches() ([]string, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.RecentSearches()
}

// SetRecentSearches stores the list of recent search queries.
func (s *State) SetRecentSearches(searches []string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.SetRecentSearches(searches)
}

// SetSessionName overrides the display name for a session.
func (s *State) SetSessionName(sessionID, displayName string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	// Also update the cached session list so the change takes effect immediately
	s.mu.Lock()
	for i := range s.sessions {
		if s.sessions[i].ID == sessionID {
			s.sessions[i].Title = displayName
			break
		}
	}
	s.mu.Unlock()
	return s.store.SetSessionName(sessionID, displayName)
}

// ClearSessionName removes the display name override for a session.
func (s *State) ClearSessionName(sessionID string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	s.mu.Lock()
	// Revert to original title by re-reading from adapter
	for i := range s.sessions {
		if s.sessions[i].ID == sessionID {
			s.sessions[i].Title = "" // will be filled on next refresh
			break
		}
	}
	s.mu.Unlock()
	return s.store.ClearSessionName(sessionID)
}

// --- Scratch Files ---

// ListScratchFiles returns scratch files for a session.
func (s *State) ListScratchFiles(sessionID string) ([]store.ScratchFile, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	var files []store.ScratchFile
	err := retryOnBusy(func() error {
		var innerErr error
		files, innerErr = s.store.ListScratchFiles(sessionID)
		return innerErr
	})
	return files, err
}

// ListAllScratchFiles returns all scratch files across all sessions.
func (s *State) ListAllScratchFiles() ([]store.ScratchFile, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.ListAllScratchFiles()
}

// CreateScratchFile creates a new scratch file.
func (s *State) CreateScratchFile(f store.ScratchFile) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.CreateScratchFile(f)
}

// ScratchFile returns a scratch file by ID.
func (s *State) ScratchFile(id string) (*store.ScratchFile, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.ScratchFile(id)
}

// UpdateScratchFile updates a scratch file.
func (s *State) UpdateScratchFile(id, title, content string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.UpdateScratchFile(id, title, content)
}

// RenameScratchFile updates only the title of a scratch file.
func (s *State) RenameScratchFile(id, title string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.RenameScratchFile(id, title)
}

// DeleteScratchFile deletes a scratch file.
func (s *State) DeleteScratchFile(id string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.DeleteScratchFile(id)
}

// --- Standalone helper functions ---

func isSQLiteBusy(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLITE_BUSY")
}

func retryOnBusy(fn func() error) error {
	var err error
	for i := range 3 {
		err = fn()
		if err == nil || !isSQLiteBusy(err) {
			return err
		}
		time.Sleep(time.Duration(100*(i+1)) * time.Millisecond)
	}
	return err
}

// isPlanTool returns true for tool call names whose Input should be included
// in the search index along with Name and Output.
func isPlanTool(name string) bool {
	switch name {
	case "todowrite", "task", "task_complete", "task-complete":
		return true
	}
	return false
}

// --- Unexported State methods ---

// refreshSessions re-reads the session list from every adapter, applies the
// liveness heuristic (sets Status="active" when UpdatedAt is within liveWindow),
// and returns the set of session IDs whose UpdatedAt changed since the last
// refresh plus the total live count.
func (s *State) refreshSessions(ctx context.Context) (changedIDs []string, liveCount int, transitions []statusTransition) {
	s.mu.RLock()
	adapters := make(map[string]ingest.Adapter, len(s.adapters))
	maps.Copy(adapters, s.adapters)
	prev := make(map[string]time.Time, len(s.sessions))
	prevStatus := make(map[string]string, len(s.sessions))
	for _, sess := range s.sessions {
		prev[sess.ID] = sess.UpdatedAt
		prevStatus[sess.ID] = string(sess.Status)
	}
	s.mu.RUnlock()

	var allSessions []ingest.Session
	for sourceID, adapter := range adapters {
		sessions, err := adapter.ListSessions(ctx)
		if err != nil {
			slog.Warn("failed to list sessions", "source", sourceID, "error", err)
			continue
		}
		for i := range sessions {
			sessions[i].SourceID = sourceID
			// Liveness heuristic: a session is "active" if its last update is
			// within liveWindow. We override whatever the adapter hardcoded so
			// the frontend gets a single source of truth.
			if !sessions[i].UpdatedAt.IsZero() && time.Since(sessions[i].UpdatedAt) < liveWindow {
				if sessions[i].Status != ingest.SessionStatusActive {
					sessions[i].Status = ingest.SessionStatusActive
				}
				liveCount++
			} else if sessions[i].Status == ingest.SessionStatusActive {
				sessions[i].Status = ingest.SessionStatusCompleted
			}
		}
		allSessions = append(allSessions, sessions...)
	}

	// Filter out Copilot sessions with no messages (e.g. sessions created on CLI launch)
	filtered := allSessions[:0]
	for _, sess := range allSessions {
		if sess.Agent == ingest.AgentCopilot && sess.MessageCount == 0 {
			continue
		}
		filtered = append(filtered, sess)
	}
	allSessions = filtered

	// Apply display name overrides
	if s.store != nil {
		overrides, err := s.store.AllSessionNames()
		if err == nil {
			for i := range allSessions {
				if name, ok := overrides[allSessions[i].ID]; ok {
					allSessions[i].Title = name
				}
			}
		}
	}

	// Diff against the previous snapshot to identify sessions whose content
	// has changed since the last refresh. Newly-arrived sessions and sessions
	// whose UpdatedAt moved forward are both considered changed.
	for _, sess := range allSessions {
		if prevTime, ok := prev[sess.ID]; !ok || !sess.UpdatedAt.Equal(prevTime) {
			changedIDs = append(changedIDs, sess.ID)
		}
		if old, ok := prevStatus[sess.ID]; ok && old != string(sess.Status) {
			transitions = append(transitions, statusTransition{sessionID: sess.ID, from: old, to: string(sess.Status)})
		}
	}

	s.mu.Lock()
	s.sessions = allSessions
	// Rebuild prevStatus snapshot for the next poll.
	s.prevStatus = make(map[string]string, len(allSessions))
	for _, sess := range allSessions {
		s.prevStatus[sess.ID] = string(sess.Status)
	}
	s.mu.Unlock()
	return changedIDs, liveCount, transitions
}

// statusTransition records a single session status change detected during a
// refresh, used by notification classification.
type statusTransition struct {
	sessionID string
	from      string
	to        string
}

// refreshAndIndex runs a session refresh followed by background indexing and
// emits the SSE events the frontend expects. Used by AddSource/UpdateSource
// so the HTTP handler is never blocked by adapter I/O.
func (s *State) refreshAndIndex(ctx context.Context) {
	ids, _, transitions := s.refreshSessions(ctx)
	go s.indexSessions(ctx)
	s.sendEvent(sseEvent{Name: "update"})
	if len(ids) > 0 {
		data, err := json.Marshal(map[string]any{"ids": ids})
		if err != nil {
			slog.Warn("failed to marshal session change event", "error", err)
			return
		}
		s.sendEvent(sseEvent{Name: "session-changed", Data: string(data)})
		go s.classifyChanges(ctx, ids, transitions)
	}
}

// indexSessions indexes session content into the FTS5 search index.
// It runs incrementally: sessions are only re-indexed if their content hash changes.
func (s *State) indexSessions(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in indexSessions", "recover", r)
		}
	}()
	if s.store == nil {
		return
	}

	s.mu.RLock()
	sessions := make([]ingest.Session, len(s.sessions))
	copy(sessions, s.sessions)
	adapters := make(map[string]ingest.Adapter, len(s.adapters))
	maps.Copy(adapters, s.adapters)
	s.mu.RUnlock()

	for _, sess := range sessions {
		adapter := adapters[sess.SourceID]
		if adapter == nil {
			continue
		}

		// Get messages for hashing
		messages, err := adapter.Messages(ctx, sess.ID)
		if err != nil {
			continue
		}
		if len(messages) == 0 {
			continue
		}

		// Build content for each chunk type
		var messagesBuilder strings.Builder
		for _, msg := range messages {
			messagesBuilder.WriteString(msg.Content)
			messagesBuilder.WriteString("\n")
			for _, tc := range msg.ToolCalls {
				messagesBuilder.WriteString(tc.Name)
				messagesBuilder.WriteString(" ")
				if isPlanTool(tc.Name) && tc.Input != "" {
					messagesBuilder.WriteString(tc.Input)
					messagesBuilder.WriteString(" ")
				}
				messagesBuilder.WriteString(tc.Output)
				messagesBuilder.WriteString("\n")
			}
		}
		messagesContent := messagesBuilder.String()

		// Build plan content
		var planContent string
		if plan, err := adapter.Plan(ctx, sess.ID); err == nil && plan != nil {
			planContent = plan.Markdown
		}

		// Build name content (title is searchable)
		nameContent := sess.Title

		// Get scratch files for hash comparison and indexing
		scratchFiles, err := s.store.ListScratchFiles(sess.ID)
		if err != nil {
			slog.Warn("failed to list scratch files", "session_id", sess.ID, "error", err)
		}
		var scratchBuilder strings.Builder
		for _, sf := range scratchFiles {
			scratchBuilder.WriteString(sf.Title)
			scratchBuilder.WriteString("\n")
			scratchBuilder.WriteString(sf.Content)
			scratchBuilder.WriteString("\n")
		}
		scratchContent := scratchBuilder.String()

		// Combined content for hash comparison
		combined := nameContent + "\n" + planContent + "\n" + messagesContent + "\n" + scratchContent
		h := sha256.Sum256([]byte(combined))
		contentHash := hex.EncodeToString(h[:8])

		// Check if already indexed with same hash
		existingHash, err := s.store.IndexState(sess.ID)
		if err != nil {
			continue
		}
		if existingHash == contentHash {
			continue // already up to date
		}

		// Clear old index entries and re-index
		if err := retryOnBusy(func() error { return s.store.ClearSessionIndex(sess.ID) }); err != nil {
			slog.Warn("failed to clear session index", "session", sess.ID, "error", err)
			continue
		}

		updatedAt := sess.UpdatedAt.Format(time.RFC3339)

		// Index name chunk
		if err := retryOnBusy(func() error {
			return s.store.IndexSessionAt(sess.ID, sess.SourceID, "name", sess.Repository, nameContent, updatedAt, "", "", 0)
		}); err != nil {
			slog.Warn("failed to index session name", "session", sess.ID, "error", err)
		}

		// Index plan chunk
		if planContent != "" {
			if err := retryOnBusy(func() error {
				return s.store.IndexSessionAt(sess.ID, sess.SourceID, "plan", sess.Repository, planContent, updatedAt, "", "", 0)
			}); err != nil {
				slog.Warn("failed to index session plan", "session", sess.ID, "error", err)
			}
		}

		// Index individual messages with their index for exact message targeting
		for mi, msg := range messages {
			var msgBuilder strings.Builder
			msgBuilder.WriteString(msg.Content)
			msgBuilder.WriteString("\n")
			for _, tc := range msg.ToolCalls {
				msgBuilder.WriteString(tc.Name)
				msgBuilder.WriteString(" ")
				if isPlanTool(tc.Name) && tc.Input != "" {
					msgBuilder.WriteString(tc.Input)
					msgBuilder.WriteString(" ")
				}
				msgBuilder.WriteString(tc.Output)
				msgBuilder.WriteString("\n")
			}
			msgContent := msgBuilder.String()
			if err := retryOnBusy(func() error {
				return s.store.IndexSessionAt(sess.ID, sess.SourceID, "message", sess.Repository, msgContent, updatedAt, "", "", mi)
			}); err != nil {
				slog.Warn("failed to index session message", "session", sess.ID, "idx", mi, "error", err)
			}
		}

		// Index scratch files chunk
		if len(scratchFiles) > 0 {
			if err := retryOnBusy(func() error { return s.store.ClearSessionChunkType(sess.ID, "scratch") }); err != nil {
				slog.Warn("failed to clear scratch index", "session", sess.ID, "error", err)
			}
			for _, sf := range scratchFiles {
				if sf.Content == "" {
					continue
				}
				fileContent := sf.Title + "\n" + sf.Content
				if err := retryOnBusy(func() error {
					return s.store.IndexSessionAt(sess.ID, sess.SourceID, "scratch", sess.Repository, fileContent, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0)
				}); err != nil {
					slog.Warn("failed to index scratch file", "session", sess.ID, "file", sf.ID, "error", err)
				}
			}
		}

		// Update index state
		if err := retryOnBusy(func() error { return s.store.UpdateIndexState(sess.ID, sess.SourceID, contentHash) }); err != nil {
			slog.Warn("failed to update index state", "session", sess.ID, "error", err)
		}
	}
}

func (s *State) pollLoop(ctx context.Context) {
	// Track last known modification times per source
	lastMod := make(map[string]int64)
	var liveCount int

	for {
		interval := pollInterval(liveCount)
		timer := time.NewTimer(interval)

		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			changed := false
			for sourceID, adapter := range s.adapters {
				ts, err := adapter.LastModified(ctx)
				if err != nil {
					continue
				}
				if prev, ok := lastMod[sourceID]; !ok || ts > prev {
					lastMod[sourceID] = ts
					if ok { // skip first iteration
						changed = true
					}
				}
			}
			if changed {
				ids, lc, transitions := s.refreshSessions(ctx)
				liveCount = lc
	
				go s.indexSessions(ctx)
				s.sendEvent(sseEvent{Name: "update"})
				if len(ids) > 0 {
					data, err := json.Marshal(map[string]any{"ids": ids})
					if err != nil {
						slog.Warn("failed to marshal session change event", "error", err)
					} else {
						s.sendEvent(sseEvent{Name: "session-changed", Data: string(data)})
					}

					go s.classifyChanges(ctx, ids, transitions)
				}
			} else if liveCount > 0 {
				// No source-level change, but liveness windows may have expired
				// since the last refresh (e.g. a session went idle 3 min ago).
				// Re-run the heuristic to keep Status fresh without the heavier
				// full reload cost — but only if the snapshot might be stale.
				_, lc, transitions := s.refreshSessions(ctx)
				if lc != liveCount {
					// Status transitions are visible to clients; push an update.
					s.sendEvent(sseEvent{Name: "update"})
					if len(transitions) > 0 {
						var tids []string
						for _, t := range transitions {
							tids = append(tids, t.sessionID)
						}
						go s.classifyChanges(ctx, tids, transitions)
					}
				}
				liveCount = lc
			}
		}
	}
}

func (s *State) subscribe() chan sseEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan sseEvent, 64)
	s.subscribers[ch] = struct{}{}
	return ch
}

func (s *State) unsubscribe(ch chan sseEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, ch)
}

func (s *State) sendEvent(event sseEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for ch := range s.subscribers {
		select {
		case ch <- event:
		default:

		}
	}
}

// --- Notification classification ---

const notifySettingsKey = "notifications.settings"

// loadNotifySettings loads notification settings from the config table,
// falling back to defaults on any error or missing row.
func (s *State) loadNotifySettings() notify.Settings {
	if s.store == nil {
		return notify.DefaultSettings()
	}
	raw, err := s.store.Config(notifySettingsKey)
	if err != nil || raw == "" {
		return notify.DefaultSettings()
	}
	var settings notify.Settings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return notify.DefaultSettings()
	}
	return settings
}

// saveNotifySettings persists notification settings.
func (s *State) saveNotifySettings(settings notify.Settings) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	if err := s.store.SetConfig(notifySettingsKey, string(data)); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// reportActiveView records that the given session is currently being viewed by
// the user. Used by the ExcludeActiveView notification setting.
func (s *State) reportActiveView(sessionID string) {
	if sessionID == "" {
		return
	}
	s.activeViewsMu.Lock()
	s.activeViews[sessionID] = time.Now()
	s.activeViewsMu.Unlock()
}


// classifyChanges inspects the changed sessions, runs the pure classifier, and
// persists+emits any resulting notifications. It must not block the poll loop,
// so callers always invoke it in a goroutine.
func (s *State) classifyChanges(ctx context.Context, changedIDs []string, transitions []statusTransition) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in classifyChanges", "recover", r)
		}
	}()
	if s.store == nil || len(changedIDs) == 0 {
		return
	}
	settings := s.loadNotifySettings()
	if !settings.Enabled {
		// Even when disabled, advance the seen-message cursor so we don't
		// flood the user with a backlog of pre-existing messages the moment
		// they re-enable notifications.
		s.advanceSeenCursors(ctx, changedIDs)
		return
	}

	// Cap per-tick work to protect against a first-load burst.
	if len(changedIDs) > 50 {
		slog.Warn("classifyChanges: capping changed sessions", "count", len(changedIDs))
		// Advance cursors for uncapped sessions so their bookkeeping
		// stays in sync even though we defer their classification.
		s.advanceSeenCursors(ctx, changedIDs[50:])
		changedIDs = changedIDs[:50]
	}

	// Index transitions by session id for quick lookup.
	transBySession := make(map[string]statusTransition, len(transitions))
	for _, t := range transitions {
		transBySession[t.sessionID] = t
	}

	var emittedAny bool
	for _, sid := range changedIDs {
		sess, err := s.Session(ctx, sid)
		if err != nil || sess == nil {
			continue
		}
		// Scope filter: only sessions the user has opened / pinned.
		if !s.sessionInScope(ctx, sess.ID, settings.Scope) {
			// Still advance the cursor so future messages are detected.
			s.advanceSeenCursor(ctx, sess)
			continue
		}
		msgs, err := s.Messages(ctx, sess.ID)
		if err != nil {
			continue
		}

		st, err := s.store.NotificationState(sess.ID)
		if err != nil {
			slog.Warn("failed to load notification state", "session", sess.ID, "error", err)
			continue
		}

		prevStatus := ""
		if t, ok := transBySession[sess.ID]; ok {
			prevStatus = t.from
		}

		candidates := notify.Classify(prevStatus, string(sess.Status), msgs, st.LastSeenMessageCount, settings)

		for _, c := range candidates {
			n := store.Notification{
				ID:        fmt.Sprintf("notif_%d_%s", time.Now().UnixNano(), shortID(c.DedupKey)),
				SessionID: sess.ID,
				SourceID:  sess.SourceID,
				Kind:      string(c.Kind),
				Title:     c.Title,
				Preview:   c.Preview,
				Severity:  string(c.Severity),
				CreatedAt: time.Now().UnixMilli(),
			}
			if c.Payload != nil {
				if data, err := json.Marshal(c.Payload); err == nil {
					n.Payload = string(data)
				}
			}
			inserted, err := s.store.InsertNotification(n, c.DedupKey)
			if err != nil {
				slog.Warn("failed to insert notification", "session", sess.ID, "error", err)
				continue
			}
			if inserted {
				emittedAny = true
				s.emitNotification(n, c.Payload)
			}
		}

		// Advance the seen-message cursor regardless of whether we emitted.
		if len(msgs) != st.LastSeenMessageCount {
			if err := s.store.SetNotificationState(sess.ID, len(msgs), time.Now()); err != nil {
				slog.Warn("failed to set notification state", "session", sess.ID, "error", err)
			}
		}
	}

	if emittedAny {
		// Opportunistically prune old notifications so the table stays bounded.
		if err := s.store.PruneNotifications(500); err != nil {
			slog.Warn("failed to prune notifications", "error", err)
		}
	}
}

// advanceSeenCursors advances the seen-message cursor for every changed
// session without classifying. Used when notifications are disabled.
func (s *State) advanceSeenCursors(ctx context.Context, changedIDs []string) {
	for _, sid := range changedIDs {
		sess, err := s.Session(ctx, sid)
		if err != nil || sess == nil {
			continue
		}
		s.advanceSeenCursor(ctx, sess)
	}
}

func (s *State) advanceSeenCursor(ctx context.Context, sess *ingest.Session) {
	if s.store == nil || sess == nil {
		return
	}
	msgs, err := s.Messages(ctx, sess.ID)
	if err != nil {
		return
	}
	st, err := s.store.NotificationState(sess.ID)
	if err != nil {
		return
	}
	if len(msgs) != st.LastSeenMessageCount {
		if err := s.store.SetNotificationState(sess.ID, len(msgs), time.Now()); err != nil {
			slog.Warn("failed to set notification state", "session", sess.ID, "error", err)
		}
	}
}

// sessionInScope reports whether the session passes the configured scope
// filter. "all" passes everything; "opened" requires the user to have opened
// the session at least once; "pinned" requires the session to be assigned to a
// folder.
func (s *State) sessionInScope(ctx context.Context, sessionID, scope string) bool {
	switch scope {
	case "opened":
		st, err := s.store.NotificationState(sessionID)
		if err != nil || st.FirstViewedAt == nil {
			return false
		}
		return true
	case "pinned":
		folders, err := s.store.SessionFolders(sessionID)
		if err != nil {
			return false
		}
		return len(folders) > 0
	default: // "all"
		return true
	}
}

// emitNotification broadcasts a single notification via SSE and also fires a
// generic "notifications-read"-style update is not needed here; the frontend
// listens for "notification" events to refetch the list.
func (s *State) emitNotification(n store.Notification, payload map[string]any) {
	// Build the SSE payload from the stored notification plus the structured
	// payload (so the frontend gets typed fields for navigation).
	evt := map[string]any{
		"id":        n.ID,
		"sessionId": n.SessionID,
		"sourceId":  n.SourceID,
		"kind":      n.Kind,
		"title":     n.Title,
		"preview":   n.Preview,
		"severity":  n.Severity,
		"createdAt": n.CreatedAt,
		"payload":   payload,
	}
	data, err := json.Marshal(evt)
	if err != nil {
		slog.Warn("failed to marshal notification event", "error", err)
		return
	}
	s.sendEvent(sseEvent{Name: "notification", Data: string(data)})
}

// shortID returns a short suffix of a dedup key for use in notification IDs.
func shortID(key string) string {
	if len(key) <= 12 {
		return key
	}
	return key[len(key)-12:]
}

// reindexSessionScratch re-indexes all scratch files for a session.
func (s *State) reindexSessionScratch(sessionID string) {
	if s.store == nil {
		return
	}
	scratchFiles, err := s.store.ListScratchFiles(sessionID)
	if err != nil {
		return
	}
	// Look up session info for sourceID/repository
	sourceID := ""
	repository := ""
	s.mu.RLock()
	for _, sess := range s.sessions {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			repository = sess.Repository
			break
		}
	}
	s.mu.RUnlock()

	if err := retryOnBusy(func() error { return s.store.ClearSessionChunkType(sessionID, "scratch") }); err != nil {
		return
	}
	for _, sf := range scratchFiles {
		if sf.Content == "" {
			continue
		}
		content := sf.Title + "\n" + sf.Content
		if err := retryOnBusy(func() error {
			return s.store.IndexSessionAt(sessionID, sourceID, "scratch", repository, content, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0)
		}); err != nil {
			slog.Warn("failed to index scratch file", "session", sessionID, "file", sf.ID, "error", err)
		}
	}
}

// --- HTTP Handler ---

// NewHandler creates the HTTP handler for the Omnivue server.
func NewHandler(state *State) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /_/api/status", handleStatus(state))
	mux.HandleFunc("GET /_/api/sources", handleSources(state))
	mux.HandleFunc("POST /_/api/sources", handleAddSource(state))
	mux.HandleFunc("DELETE /_/api/sources/{id}", handleRemoveSource(state))
	mux.HandleFunc("PATCH /_/api/sources/{id}", handleUpdateSource(state))
	mux.HandleFunc("GET /_/api/config", handleGetConfig(state))
	mux.HandleFunc("PUT /_/api/config", handleSetConfig(state))
	mux.HandleFunc("GET /_/api/sessions", handleSessions(state))
	mux.HandleFunc("GET /_/api/sessions/{id}", handleGetSession(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/messages", handleGetMessages(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/plan", handleGetPlan(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/diffs", handleGetDiffs(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/edits", handleGetEdits(state))
	mux.HandleFunc("PUT /_/api/sessions/{id}/name", handleSetSessionName(state))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/name", handleClearSessionName(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch", handleListScratchFiles(state))
	mux.HandleFunc("POST /_/api/sessions/{id}/scratch", handleCreateScratchFile(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch/{fileId}", handleGetScratchFile(state))
	mux.HandleFunc("PUT /_/api/sessions/{id}/scratch/{fileId}", handleUpdateScratchFile(state))
	mux.HandleFunc("PATCH /_/api/sessions/{id}/scratch/{fileId}", handleRenameScratchFile(state))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/scratch/{fileId}", handleDeleteScratchFile(state))
	mux.HandleFunc("GET /_/api/scratch", handleListAllScratchFiles(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/resume", handleGetResumeCommand(state))
	mux.HandleFunc("GET /_/api/recent-searches", handleGetRecentSearches(state))
	mux.HandleFunc("POST /_/api/recent-searches", handleSetRecentSearches(state))
	mux.HandleFunc("GET /_/api/search", handleSearch(state))
	mux.HandleFunc("GET /_/api/folders", handleListFolders(state))
	mux.HandleFunc("POST /_/api/folders", handleCreateFolder(state))
	mux.HandleFunc("PATCH /_/api/folders/{id}", handleUpdateFolder(state))
	mux.HandleFunc("DELETE /_/api/folders/{id}", handleDeleteFolder(state))
	mux.HandleFunc("GET /_/api/folders/{id}/sessions", handleGetFolderSessions(state))
	mux.HandleFunc("POST /_/api/folders/{id}/sessions/{sessionId}", handleAssignSession(state))
	mux.HandleFunc("DELETE /_/api/folders/{id}/sessions/{sessionId}", handleUnassignSession(state))
	mux.HandleFunc("GET /_/api/bookmarks", handleListBookmarks(state))
	mux.HandleFunc("POST /_/api/bookmarks", handleCreateBookmark(state))
	mux.HandleFunc("DELETE /_/api/bookmarks/{id}", handleDeleteBookmark(state))
	mux.HandleFunc("GET /_/api/notifications", handleListNotifications(state))
	mux.HandleFunc("DELETE /_/api/notifications", handleClearNotifications(state))
	mux.HandleFunc("POST /_/api/notifications/read", handleMarkNotificationsRead(state))
	mux.HandleFunc("POST /_/api/notifications/active-view", handleActiveView(state))
	mux.HandleFunc("GET /_/api/notifications/settings", handleGetNotifySettings(state))
	mux.HandleFunc("PUT /_/api/notifications/settings", handleSetNotifySettings(state))
	mux.HandleFunc("POST /_/api/shutdown", handleShutdown(state))
	mux.HandleFunc("POST /_/api/restart", handleRestart(state))
	mux.HandleFunc("POST /_/api/reset", handleReset(state))
	mux.HandleFunc("GET /_/events", handleSSE(state))

	// SPA fallback
	mux.HandleFunc("/", handleSPA())

	return mux
}

func handleStatus(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var schemaVersion int
		if state.store != nil {
			v, err := state.store.SchemaVersion()
			if err != nil {
				slog.Warn("failed to read schema version", "error", err)
			} else {
				schemaVersion = v
			}
		}
		resp := map[string]any{
			"version":       version.Version,
			"pid":           os.Getpid(),
			"sources":       len(state.Sources()),
			"sessions":      len(state.Sessions()),
			"schemaVersion": schemaVersion,
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSources(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sources := state.Sources()
		if len(sources) == 0 {
			sources = []ingest.Source{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(sources); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleAddSource(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path      string `json:"path"`
			AgentType string `json:"agentType"`
			Label     string `json:"label"`
			Enabled   bool   `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Path == "" {
			http.Error(w, "path is required", http.StatusBadRequest)
			return
		}
		// Expand tilde in path (frontend sends raw user input)
		if len(body.Path) > 1 && body.Path[:2] == "~/" {
			home, err := os.UserHomeDir()
			if err == nil {
				body.Path = home + body.Path[1:]
			}
		}
		if body.AgentType == "" {
			body.AgentType = string(ingest.AgentOpenCode)
		}
		// Auto-set a label if not provided
		if body.Label == "" {
			for _, ai := range ingest.KnownAgentTypes() {
				if ai.Type == ingest.AgentType(body.AgentType) {
					body.Label = ai.Label
					break
				}
			}
		}
		// Generate source ID from path (same scheme as CLI)
		h := sha256.Sum256([]byte(body.Path))
		id := hex.EncodeToString(h[:])[:12]

		src := ingest.Source{
			ID:        id,
			Path:      body.Path,
			AgentType: ingest.AgentType(body.AgentType),
			Label:     body.Label,
			Enabled:   body.Enabled,
			CreatedAt: time.Now(),
		}
		if err := state.AddSource(r.Context(), src); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(src); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleRemoveSource(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := state.RemoveSource(r.Context(), id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUpdateSource(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Path      string `json:"path"`
			AgentType string `json:"agentType"`
			Label     string `json:"label"`
			Enabled   bool   `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Path == "" {
			http.Error(w, "path is required", http.StatusBadRequest)
			return
		}
		if err := state.UpdateSource(r.Context(), id, body.Path, body.AgentType, body.Label, body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetConfig(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg, err := state.Config()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if cfg == nil {
			cfg = make(map[string]string)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(cfg); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetConfig(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Key == "" {
			http.Error(w, "key is required", http.StatusBadRequest)
			return
		}
		if err := state.SetConfig(body.Key, body.Value); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSessions(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessions := state.Sessions()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(sessions); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetSession(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		session, err := state.Session(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(session); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetMessages(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		messages, err := state.Messages(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(messages); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetPlan(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		plan, err := state.Plan(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(plan); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetDiffs(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		diffs, err := state.Diffs(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if len(diffs) == 0 {
			diffs = []ingest.DiffFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(diffs); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetEdits(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		edits, err := state.Edits(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if len(edits) == 0 {
			edits = []ingest.FileEdit{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(edits); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetResumeCommand(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cmd, err := state.ResumeCommand(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"command": cmd}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetSessionName(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			DisplayName string `json:"displayName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.DisplayName == "" {
			http.Error(w, "displayName is required", http.StatusBadRequest)
			return
		}
		if err := state.SetSessionName(id, body.DisplayName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleClearSessionName(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := state.ClearSessionName(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleListScratchFiles(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		files, err := state.ListScratchFiles(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(files) == 0 {
			files = []store.ScratchFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(files); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleCreateScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.PathValue("id")
		var body struct {
			Title   string `json:"title"`
			Content string `json:"content"`
			Mode    string `json:"mode"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Title == "" {
			body.Title = "Untitled"
		}
		if body.Mode == "" {
			body.Mode = "writable"
		}
		now := time.Now()
		f := store.ScratchFile{
			ID:        fmt.Sprintf("scratch_%d", now.UnixNano()),
			SessionID: sessionID,
			Title:     body.Title,
			Content:   body.Content,
			Mode:      body.Mode,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := state.CreateScratchFile(f); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.reindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(f); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		f, err := state.ScratchFile(fileID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(f); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleUpdateScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		var body struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Title == "" {
			body.Title = "Untitled"
		}
		sessionID := r.PathValue("id")
		if err := state.UpdateScratchFile(fileID, body.Title, body.Content); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.reindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleRenameScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		var body struct {
			Title string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.Title == "" {
			http.Error(w, "title is required", http.StatusBadRequest)
			return
		}
		sessionID := r.PathValue("id")
		if err := state.RenameScratchFile(fileID, body.Title); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.reindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDeleteScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		sessionID := r.PathValue("id")
		if err := state.DeleteScratchFile(fileID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.reindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleListAllScratchFiles(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		files, err := state.ListAllScratchFiles()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(files) == 0 {
			files = []store.ScratchFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(files); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetRecentSearches(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		searches, err := state.RecentSearches()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(searches) == 0 {
			searches = []string{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(searches); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetRecentSearches(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var searches []string
		if err := json.NewDecoder(r.Body).Decode(&searches); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := state.SetRecentSearches(searches); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSearch(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.SearchResult{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		sessionID := r.URL.Query().Get("session_id")
		results, err := state.Search(q, limit, sessionID)
		if err != nil {
			// FTS5 syntax errors should return empty results, not 500
			slog.Warn("search error", "query", q, "error", err)
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.SearchResult{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		if len(results) == 0 {
			results = []store.SearchResult{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(results); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

// --- Folder handlers ---

func handleListFolders(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Folder{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		folders, err := state.store.ListFolders()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(folders) == 0 {
			folders = []store.Folder{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(folders); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

type createFolderRequest struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

func handleCreateFolder(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var req createFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		now := time.Now()
		f := store.Folder{
			ID:        fmt.Sprintf("folder_%d", now.UnixNano()),
			Name:      req.Name,
			Color:     req.Color,
			Icon:      req.Icon,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := state.store.CreateFolder(f); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(f); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

type updateFolderRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
}

func handleUpdateFolder(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		var req updateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}
		if err := state.store.UpdateFolder(id, req.Name, req.Color, req.Icon); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteFolder(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		if err := state.store.DeleteFolder(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetFolderSessions(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]string{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		id := r.PathValue("id")
		sessionIDs, err := state.store.FolderSessions(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(sessionIDs) == 0 {
			sessionIDs = []string{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(sessionIDs); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleAssignSession(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		folderID := r.PathValue("id")
		sessionID := r.PathValue("sessionId")
		if err := state.store.AssignSession(folderID, sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUnassignSession(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		folderID := r.PathValue("id")
		sessionID := r.PathValue("sessionId")
		if err := state.store.UnassignSession(folderID, sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Bookmark handlers ---

func handleListBookmarks(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Bookmark{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		bookmarks, err := state.store.ListBookmarks()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(bookmarks) == 0 {
			bookmarks = []store.Bookmark{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(bookmarks); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleCreateBookmark(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var req struct {
			SessionID    string `json:"sessionId"`
			MessageIndex int    `json:"messageIndex"`
			ToolCallID   string `json:"toolCallId"`
			Label        string `json:"label"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.SessionID == "" || req.Label == "" {
			http.Error(w, "sessionId and label are required", http.StatusBadRequest)
			return
		}

		// Toggle: if bookmark already exists for this ref, delete it
		existing, err := state.store.BookmarkByRef(req.SessionID, req.MessageIndex, req.ToolCallID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if existing != nil {
			if err := state.store.DeleteBookmark(existing.ID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{
				"action": "deleted",
				"id":     existing.ID,
			}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}

		now := time.Now()
		b := store.Bookmark{
			ID:           fmt.Sprintf("bm_%d", now.UnixNano()),
			SessionID:    req.SessionID,
			MessageIndex: req.MessageIndex,
			ToolCallID:   req.ToolCallID,
			Label:        req.Label,
			CreatedAt:    now,
		}
		if err := state.store.CreateBookmark(b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(map[string]any{
			"action":   "created",
			"bookmark": b,
		}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDeleteBookmark(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		if err := state.store.DeleteBookmark(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Notification handlers ---

func handleListNotifications(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Notification{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		unreadOnly := r.URL.Query().Get("unreadOnly") == "true" || r.URL.Query().Get("unreadOnly") == "1"
		notifs, err := state.store.ListNotifications(limit, unreadOnly)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(notifs) == 0 {
			notifs = []store.Notification{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(notifs); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleMarkNotificationsRead(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := state.store.MarkAllNotificationsRead(body.IDs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Broadcast read-state sync so other tabs update without refetching.
		data, err := json.Marshal(map[string]any{"ids": body.IDs})
		if err != nil {
			slog.Warn("failed to marshal notifications-read event", "error", err)
		} else {
			state.sendEvent(sseEvent{Name: "notifications-read", Data: string(data)})
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleClearNotifications(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := state.store.ClearNotifications(time.Time{}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.sendEvent(sseEvent{Name: "notifications-read", Data: "{\"all\":true}"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleActiveView(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.SessionID == "" {
			http.Error(w, "sessionId is required", http.StatusBadRequest)
			return
		}
		state.reportActiveView(body.SessionID)
		if state.store != nil {
			if err := state.store.MarkSessionViewed(body.SessionID); err != nil {
				slog.Warn("failed to mark session viewed", "session", body.SessionID, "error", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetNotifySettings(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		settings := state.loadNotifySettings()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(settings); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetNotifySettings(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var settings notify.Settings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		// If the user is enabling notifications for the first time (or after
		// having disabled them), stamp EnabledAt so the classifier can suppress
		// the flood of pre-existing messages.
		prev := state.loadNotifySettings()
		if settings.Enabled && (!prev.Enabled || prev.EnabledAt == 0) {
			settings.EnabledAt = time.Now().UnixMilli()
		} else if !settings.Enabled {
			settings.EnabledAt = 0
		} else {
			settings.EnabledAt = prev.EnabledAt
		}
		if err := state.saveNotifySettings(settings); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(settings); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleShutdown(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in shutdown handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			state.shutdownCh <- struct{}{}
		}()
	}
}

func handleRestart(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in restart handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			state.restartCh <- ""
		}()
	}
}

func handleReset(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := state.store.Reset(); err != nil {
			slog.Error("reset failed", "error", err)
			http.Error(w, "reset failed", http.StatusInternalServerError)
			return
		}
		// Close all adapters
		state.mu.Lock()
		for id, adapter := range state.adapters {
			adapter.Close()
			delete(state.adapters, id)
		}
		state.sessions = nil
		state.mu.Unlock()
		// Notify frontend to reload
		state.sendEvent(sseEvent{Name: "reset"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSSE(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ch := state.subscribe()
		defer state.unsubscribe(ch)

		// Send initial event
		fmt.Fprintf(w, "event: started\ndata: {\"pid\":%d}\n\n", os.Getpid())
		flusher.Flush()

		for {
			select {
			case <-r.Context().Done():
				return
			case event, ok := <-ch:
				if !ok {
					return
				}
				fmt.Fprintf(w, "event: %s\n", event.Name)
				if event.Data != "" {
					fmt.Fprintf(w, "data: %s\n", event.Data)
				} else {
					fmt.Fprintf(w, "data: {}\n")
				}
				fmt.Fprintf(w, "\n")
				flusher.Flush()
			}
		}
	}
}

func handleSPA() http.HandlerFunc {
	fsys, err := fs.Sub(static.Frontend, "dist")
	if err != nil {
		slog.Warn("failed to open frontend dist", "error", err)
	}
	fileServer := http.FileServer(http.FS(fsys))

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else {
			path = strings.TrimPrefix(path, "/")
		}

		// Try to serve the file directly
		if f, err := fsys.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for all routes
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}
}
