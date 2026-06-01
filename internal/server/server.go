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
	"github.com/stevencrawford/sess/internal/ingest/copilot"
	"github.com/stevencrawford/sess/internal/ingest/opencode"
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
	default:
		return nil, fmt.Errorf("unsupported agent type: %s", src.AgentType)
	}
}

func (s *State) refreshSessions(ctx context.Context) {
	s.mu.RLock()
	adapters := make(map[string]ingest.Adapter, len(s.adapters))
	for k, v := range s.adapters {
		adapters[k] = v
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
		}
		allSessions = append(allSessions, sessions...)
	}

	s.mu.Lock()
	s.sessions = allSessions
	s.mu.Unlock()
}

// indexSessions indexes session content into the FTS5 search index.
// It runs incrementally: sessions are only re-indexed if their content hash changes.
func (s *State) indexSessions(ctx context.Context) {
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

		// Build content and compute hash
		var contentBuilder strings.Builder
		contentBuilder.WriteString(sess.Title)
		contentBuilder.WriteString("\n")
		for _, msg := range messages {
			contentBuilder.WriteString(msg.Content)
			contentBuilder.WriteString("\n")
			for _, tc := range msg.ToolCalls {
				contentBuilder.WriteString(tc.Name)
				contentBuilder.WriteString(" ")
				contentBuilder.WriteString(tc.Output)
				contentBuilder.WriteString("\n")
			}
		}
		content := contentBuilder.String()

		h := sha256.Sum256([]byte(content))
		contentHash := hex.EncodeToString(h[:8]) // 16 chars is enough

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

		// Index as a single chunk (session content)
		if err := s.store.IndexSession(sess.ID, sess.SourceID, "messages", sess.Repository, content); err != nil {
			slog.Warn("failed to index session", "session", sess.ID, "error", err)
			continue
		}

		// Update index state
		if err := s.store.UpdateIndexState(sess.ID, sess.SourceID, contentHash); err != nil {
			slog.Warn("failed to update index state", "session", sess.ID, "error", err)
		}
	}
}

func (s *State) pollLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Track last known modification times per source
	lastMod := make(map[string]int64)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
				s.refreshSessions(ctx)
				go s.indexSessions(ctx)
				s.sendEvent(sseEvent{Name: "update"})
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

// GetSources returns configured sources from the store.
func (s *State) GetSources() []ingest.Source {
	if s.store == nil {
		return nil
	}
	sources, _ := s.store.ListSources()
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

// Search performs full-text search across indexed session content.
func (s *State) Search(query string, limit int) ([]store.SearchResult, error) {
	if s.store == nil {
		return nil, fmt.Errorf("store not available")
	}
	return s.store.Search(query, limit)
}

// --- HTTP Handler ---

// NewHandler creates the HTTP handler for the sess server.
func NewHandler(state *State) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /_/api/status", handleStatus(state))
	mux.HandleFunc("GET /_/api/sources", handleSources(state))
	mux.HandleFunc("GET /_/api/sessions", handleSessions(state))
	mux.HandleFunc("GET /_/api/sessions/{id}", handleGetSession(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/messages", handleGetMessages(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/plan", handleGetPlan(state))
	mux.HandleFunc("GET /_/api/sessions/{id}/diffs", handleGetDiffs(state))
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
		if plan == nil {
			plan = &ingest.Plan{Markdown: "", Source: ""}
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
		results, err := state.Search(q, limit)
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
			time.Sleep(100 * time.Millisecond)
			state.shutdownCh <- struct{}{}
		}()
	}
}

func handleRestart(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		go func() {
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

// Legacy exports needed by cmd package (minimal interface).
// These will be removed once we fully decouple.

const DefaultGroup = "default"

func ResolveGroupName(name string) (string, error) {
	if name == "" {
		return DefaultGroup, nil
	}
	return name, nil
}

// RestoreData is kept for API compatibility with backup package.
type RestoreData struct {
	Groups        map[string][]string  `json:"groups,omitempty"`
	Patterns      map[string][]string  `json:"patterns,omitempty"`
	UploadedFiles []UploadedFileData   `json:"uploadedFiles,omitempty"`
}

type UploadedFileData struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Group   string `json:"group"`
}

func WriteRestoreFile(data RestoreData) (string, error) {
	return "", nil // Not used in sess
}
