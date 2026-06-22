package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/ingest/codex"
	"github.com/stevencrawford/sess/internal/ingest/copilot"
	"github.com/stevencrawford/sess/internal/ingest/cursor"
	"github.com/stevencrawford/sess/internal/ingest/opencode"
	"github.com/stevencrawford/sess/internal/ingest/pi"
	"github.com/stevencrawford/sess/internal/static"
	"github.com/stevencrawford/sess/internal/store"
	"github.com/stevencrawford/sess/version"
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
}

type sseEvent struct {
	Name string `json:"name"`
	Data string `json:"data,omitempty"`
}

// NewState creates a new State. It loads configured sources from the store
// and starts background polling.
func NewState(ctx context.Context) *State {
	s := &State{
		adapters:    make(map[string]ingest.Adapter),
		subscribers: make(map[chan sseEvent]struct{}),
		shutdownCh:  make(chan struct{}, 1),
		restartCh:   make(chan string, 1),
	}

	// Open sess store
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

	// Initial session load
	s.refreshSessions(ctx)

	// Initial indexing (background)
	go s.indexSessions(ctx)

	// Start poller
	pollCtx, pollCancel := context.WithCancel(ctx)
	s.pollStop = pollCancel
	go s.pollLoop(pollCtx)

	return s
}

func createAdapter(src ingest.Source) (ingest.Adapter, error) {
	switch src.AgentType {
	case ingest.AgentOpenCode:
		return opencode.New(src.Path)
	case ingest.AgentCopilot:
		return copilot.New(src.Path)
	case ingest.AgentCursor:
		return cursor.New(src.Path)
	case ingest.AgentPi:
		return pi.New(src.Path)
	case ingest.AgentCodex:
		return codex.New(src.Path)
	default:
		return nil, fmt.Errorf("unsupported agent type: %s", src.AgentType)
	}
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

// refreshSessions re-reads the session list from every adapter, applies the
// liveness heuristic (sets Status="active" when UpdatedAt is within liveWindow),
// and returns the set of session IDs whose UpdatedAt changed since the last
// refresh plus the total live count.
func (s *State) refreshSessions(ctx context.Context) (changedIDs []string, liveCount int) {
	s.mu.RLock()
	adapters := make(map[string]ingest.Adapter, len(s.adapters))
	for k, v := range s.adapters {
		adapters[k] = v
	}
	prev := make(map[string]time.Time, len(s.sessions))
	for _, sess := range s.sessions {
		prev[sess.ID] = sess.UpdatedAt
	}
	s.mu.RUnlock()

	var allSessions []ingest.Session
	now := time.Now()
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
			if !sessions[i].UpdatedAt.IsZero() && now.Sub(sessions[i].UpdatedAt) < liveWindow {
				if sessions[i].Status != "active" {
					sessions[i].Status = "active"
				}
				liveCount++
			} else if sessions[i].Status == "active" {
				sessions[i].Status = "completed"
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
	}

	s.mu.Lock()
	s.sessions = allSessions
	s.mu.Unlock()
	return changedIDs, liveCount
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
	for k, v := range s.adapters {
		adapters[k] = v
	}
	s.mu.RUnlock()

	for _, sess := range sessions {
		adapter := adapters[sess.SourceID]
		if adapter == nil {
			continue
		}

		// Get messages for hashing
		messages, err := adapter.GetMessages(ctx, sess.ID)
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
				messagesBuilder.WriteString(tc.Output)
				messagesBuilder.WriteString("\n")
			}
		}
		messagesContent := messagesBuilder.String()

		// Build plan content
		var planContent string
		if plan, err := adapter.GetPlan(ctx, sess.ID); err == nil && plan != nil {
			planContent = plan.Markdown
		}

		// Build name content (title is searchable)
		nameContent := sess.Title

		// Get scratch files for hash comparison and indexing
		scratchFiles, _ := s.store.ListScratchFiles(sess.ID)
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
		existingHash, err := s.store.GetIndexState(sess.ID)
		if err != nil {
			continue
		}
		if existingHash == contentHash {
			continue // already up to date
		}

		// Clear old index entries and re-index
		if err := s.store.ClearSessionIndex(sess.ID); err != nil {
			slog.Warn("failed to clear session index", "session", sess.ID, "error", err)
			continue
		}

		updatedAt := sess.UpdatedAt.Format(time.RFC3339)

		// Index name chunk
		if err := s.store.IndexSessionAt(sess.ID, sess.SourceID, "name", sess.Repository, nameContent, updatedAt, "", "", 0); err != nil {
			slog.Warn("failed to index session name", "session", sess.ID, "error", err)
		}

		// Index plan chunk
		if planContent != "" {
			if err := s.store.IndexSessionAt(sess.ID, sess.SourceID, "plan", sess.Repository, planContent, updatedAt, "", "", 0); err != nil {
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
				msgBuilder.WriteString(tc.Output)
				msgBuilder.WriteString("\n")
			}
			msgContent := msgBuilder.String()
			if err := s.store.IndexSessionAt(sess.ID, sess.SourceID, "message", sess.Repository, msgContent, updatedAt, "", "", mi); err != nil {
				slog.Warn("failed to index session message", "session", sess.ID, "idx", mi, "error", err)
			}
		}

		// Index scratch files chunk
		if len(scratchFiles) > 0 {
			if err := s.store.ClearSessionChunkType(sess.ID, "scratch"); err != nil {
				slog.Warn("failed to clear scratch index", "session", sess.ID, "error", err)
			}
			for _, sf := range scratchFiles {
				if sf.Content == "" {
					continue
				}
				fileContent := sf.Title + "\n" + sf.Content
				if err := s.store.IndexSessionAt(sess.ID, sess.SourceID, "scratch", sess.Repository, fileContent, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0); err != nil {
					slog.Warn("failed to index scratch file", "session", sess.ID, "file", sf.ID, "error", err)
				}
			}
		}

		// Update index state
		if err := s.store.UpdateIndexState(sess.ID, sess.SourceID, contentHash); err != nil {
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
				ids, lc := s.refreshSessions(ctx)
				liveCount = lc
				go s.indexSessions(ctx)
				s.sendEvent(sseEvent{Name: "update"})
				if len(ids) > 0 {
					data, _ := json.Marshal(map[string]any{"ids": ids})
					s.sendEvent(sseEvent{Name: "session-changed", Data: string(data)})
				}
			} else if liveCount > 0 {
				// No source-level change, but liveness windows may have expired
				// since the last refresh (e.g. a session went idle 3 min ago).
				// Re-run the heuristic to keep Status fresh without the heavier
				// full reload cost — but only if the snapshot might be stale.
				_, lc := s.refreshSessions(ctx)
				if lc != liveCount {
					// Status transitions are visible to clients; push an update.
					s.sendEvent(sseEvent{Name: "update"})
				}
				liveCount = lc
			}
		}
	}
}

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
	for ch := range s.subscribers {
		close(ch)
		delete(s.subscribers, ch)
	}
}

func (s *State) subscribe() chan sseEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan sseEvent, 16)
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
			// Drop event if subscriber is slow
		}
	}
}

// GetSessions returns the cached session list.
func (s *State) GetSessions() []ingest.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]ingest.Session, len(s.sessions))
	copy(result, s.sessions)
	return result
}

// GetSession returns a single session by ID.
func (s *State) GetSession(ctx context.Context, id string) (*ingest.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, sess := range s.sessions {
		if sess.ID == id {
			return &sess, nil
		}
	}
	return nil, fmt.Errorf("session not found: %s", id)
}

// GetMessages returns messages for a session.
func (s *State) GetMessages(ctx context.Context, sessionID string) ([]ingest.Message, error) {
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
	return adapter.GetMessages(ctx, sessionID)
}

// GetPlan returns the plan for a session.
func (s *State) GetPlan(ctx context.Context, sessionID string) (*ingest.Plan, error) {
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
	return adapter.GetPlan(ctx, sessionID)
}

// GetDiffs returns file diffs for a session.
func (s *State) GetDiffs(ctx context.Context, sessionID string) ([]ingest.DiffFile, error) {
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
	return adapter.GetDiffs(ctx, sessionID)
}

// GetEdits returns raw edit tool call data for a session.
func (s *State) GetEdits(ctx context.Context, sessionID string) ([]ingest.FileEdit, error) {
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
	return adapter.GetEdits(ctx, sessionID)
}

// AddSource adds a new source, creates its adapter (if enabled), and triggers a refresh.
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
	s.refreshSessions(ctx)
	go s.indexSessions(ctx)
	s.sendEvent(sseEvent{Name: "update"})
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
		src, err := s.store.GetSource(id)
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
	s.refreshSessions(ctx)
	go s.indexSessions(ctx)
	s.sendEvent(sseEvent{Name: "update"})
	return nil
}

// GetSources returns configured sources from the store.
func (s *State) GetSources() []ingest.Source {
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

// GetResumeCommand returns the CLI command to resume a session.
func (s *State) GetResumeCommand(ctx context.Context, sessionID string) (string, error) {
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

	if err := s.store.ClearSessionChunkType(sessionID, "scratch"); err != nil {
		return
	}
	for _, sf := range scratchFiles {
		if sf.Content == "" {
			continue
		}
		content := sf.Title + "\n" + sf.Content
		if err := s.store.IndexSessionAt(sessionID, sourceID, "scratch", repository, content, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0); err != nil {
			slog.Warn("failed to index scratch file", "session", sessionID, "file", sf.ID, "error", err)
		}
	}
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

// GetConfig returns all config key-value pairs.
func (s *State) GetConfig() (map[string]string, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.GetAllConfig()
}

// SetConfig upserts a config key-value pair.
func (s *State) SetConfig(key, value string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.SetConfig(key, value)
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
	return s.store.ListScratchFiles(sessionID)
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

// GetScratchFile returns a scratch file by ID.
func (s *State) GetScratchFile(id string) (*store.ScratchFile, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.GetScratchFile(id)
}

// UpdateScratchFile updates a scratch file.
func (s *State) UpdateScratchFile(id, title, content string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.UpdateScratchFile(id, title, content)
}

// DeleteScratchFile deletes a scratch file.
func (s *State) DeleteScratchFile(id string) error {
	if s.store == nil {
		return fmt.Errorf("store not available")
	}
	return s.store.DeleteScratchFile(id)
}

// --- HTTP Handler ---

// NewHandler creates the HTTP handler for the sess server.
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
	mux.HandleFunc("DELETE /_/api/sessions/{id}/scratch/{fileId}", handleDeleteScratchFile(state))
	mux.HandleFunc("GET /_/api/scratch", handleListAllScratchFiles(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/resume", handleGetResumeCommand(state))
	mux.HandleFunc("GET /_/api/search", handleSearch(state))
	mux.HandleFunc("GET /_/api/folders", handleListFolders(state))
	mux.HandleFunc("POST /_/api/folders", handleCreateFolder(state))
	mux.HandleFunc("PATCH /_/api/folders/{id}", handleUpdateFolder(state))
	mux.HandleFunc("DELETE /_/api/folders/{id}", handleDeleteFolder(state))
	mux.HandleFunc("GET /_/api/folders/{id}/sessions", handleGetFolderSessions(state))
	mux.HandleFunc("POST /_/api/folders/{id}/sessions/{sessionId}", handleAssignSession(state))
	mux.HandleFunc("DELETE /_/api/folders/{id}/sessions/{sessionId}", handleUnassignSession(state))
	mux.HandleFunc("POST /_/api/shutdown", handleShutdown(state))
	mux.HandleFunc("POST /_/api/restart", handleRestart(state))
	mux.HandleFunc("GET /_/events", handleSSE(state))

	// SPA fallback
	mux.HandleFunc("/", handleSPA())

	return mux
}

func handleStatus(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"version": version.Version,
			"pid":     os.Getpid(),
			"sources": len(state.GetSources()),
			"sessions": len(state.GetSessions()),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func handleSources(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sources := state.GetSources()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sources)
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
			switch ingest.AgentType(body.AgentType) {
			case ingest.AgentOpenCode:
				body.Label = "OpenCode"
			case ingest.AgentCopilot:
				body.Label = "GitHub Copilot"
			case ingest.AgentCursor:
				body.Label = "Cursor"
			case ingest.AgentPi:
				body.Label = "Pi"
			case ingest.AgentCodex:
				body.Label = "Codex"
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
		json.NewEncoder(w).Encode(src)
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
		cfg, err := state.GetConfig()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if cfg == nil {
			cfg = make(map[string]string)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg)
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

func handleSessions(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessions := state.GetSessions()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)
	}
}

func handleGetSession(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		session, err := state.GetSession(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}
}

func handleGetMessages(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		messages, err := state.GetMessages(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(messages)
	}
}

func handleGetPlan(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		plan, err := state.GetPlan(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(plan)
	}
}

func handleGetDiffs(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		diffs, err := state.GetDiffs(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if diffs == nil {
			diffs = []ingest.DiffFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(diffs)
	}
}

func handleGetEdits(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		edits, err := state.GetEdits(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if edits == nil {
			edits = []ingest.FileEdit{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(edits)
	}
}

func handleGetResumeCommand(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cmd, err := state.GetResumeCommand(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"command": cmd})
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
		if files == nil {
			files = []store.ScratchFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(files)
	}
}

func handleCreateScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.PathValue("id")
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
		now := time.Now()
		f := store.ScratchFile{
			ID:        fmt.Sprintf("scratch_%d", now.UnixNano()),
			SessionID: sessionID,
			Title:     body.Title,
			Content:   body.Content,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := state.CreateScratchFile(f); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state.reindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(f)
	}
}

func handleGetScratchFile(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		f, err := state.GetScratchFile(fileID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(f)
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

func handleListAllScratchFiles(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		files, err := state.ListAllScratchFiles()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if files == nil {
			files = []store.ScratchFile{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(files)
	}
}

func handleSearch(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]store.SearchResult{})
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
			json.NewEncoder(w).Encode([]store.SearchResult{})
			return
		}
		if results == nil {
			results = []store.SearchResult{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	}
}

// --- Folder handlers ---

func handleListFolders(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if state.store == nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]store.Folder{})
			return
		}
		folders, err := state.store.ListFolders()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if folders == nil {
			folders = []store.Folder{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(folders)
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
		json.NewEncoder(w).Encode(f)
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
			json.NewEncoder(w).Encode([]string{})
			return
		}
		id := r.PathValue("id")
		sessionIDs, err := state.store.GetFolderSessions(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if sessionIDs == nil {
			sessionIDs = []string{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessionIDs)
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
	fsys, _ := fs.Sub(static.Frontend, "dist")
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


