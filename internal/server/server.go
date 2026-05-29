package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
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
	// case ingest.AgentCopilot:
	//     return copilot.New(src.Path)
	default:
		return nil, fmt.Errorf("unsupported agent type: %s", src.AgentType)
	}
}

func (s *State) refreshSessions(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var allSessions []ingest.Session
	for sourceID, adapter := range s.adapters {
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

	s.sessions = allSessions
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

// GetSources returns configured sources from the store.
func (s *State) GetSources() []ingest.Source {
	if s.store == nil {
		return nil
	}
	sources, _ := s.store.ListSources()
	return sources
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
