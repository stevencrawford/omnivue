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
	"time"

	"github.com/coder/websocket"
	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/notify"
	"github.com/stevencrawford/omnivue/internal/static"
	"github.com/stevencrawford/omnivue/internal/store"
	"github.com/stevencrawford/omnivue/internal/terminal"
	"github.com/stevencrawford/omnivue/version"
)

// NewHandler builds the HTTP handler set from the wiring Dep. Each handler is
// constructed with access only to the collaborators and role interfaces it
// serves.
func NewHandler(dep Dep) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /_/api/status", handleStatus(dep))
	mux.HandleFunc("GET /_/api/sources", handleSources(dep.Sources))
	mux.HandleFunc("POST /_/api/sources", handleAddSource(dep))
	mux.HandleFunc("DELETE /_/api/sources/{id}", handleRemoveSource(dep))
	mux.HandleFunc("PATCH /_/api/sources/{id}", handleUpdateSource(dep))
	mux.HandleFunc("GET /_/api/sources/discover", handleDiscoverSources())
	mux.HandleFunc("GET /_/api/config", handleGetConfig(dep.Config))
	mux.HandleFunc("PUT /_/api/config", handleSetConfig(dep.Config))
	mux.HandleFunc("GET /_/api/sessions", handleSessions(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}", handleGetSession(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/messages", handleGetMessages(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/plan", handleGetPlan(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/diffs", handleGetDiffs(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/edits", handleGetEdits(dep.Hub))
	mux.HandleFunc("PUT /_/api/sessions/{id}/name", handleSetSessionName(dep.Hub))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/name", handleClearSessionName(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch", handleListScratchFiles(dep.Scratch))
	mux.HandleFunc("POST /_/api/sessions/{id}/scratch", handleCreateScratchFile(dep))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch/{fileId}", handleGetScratchFile(dep.Scratch))
	mux.HandleFunc("PUT /_/api/sessions/{id}/scratch/{fileId}", handleUpdateScratchFile(dep))
	mux.HandleFunc("PATCH /_/api/sessions/{id}/scratch/{fileId}", handleRenameScratchFile(dep))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/scratch/{fileId}", handleDeleteScratchFile(dep))
	mux.HandleFunc("GET /_/api/scratch", handleListAllScratchFiles(dep.Scratch))
	mux.HandleFunc("GET /_/api/sessions/{id}/resume", handleGetResumeCommand(dep.Hub))
	mux.HandleFunc("GET /_/api/recent-searches", handleGetRecentSearches(dep.Config))
	mux.HandleFunc("POST /_/api/recent-searches", handleSetRecentSearches(dep.Config))
	mux.HandleFunc("GET /_/api/search", handleSearch(dep))
	mux.HandleFunc("GET /_/api/tags", handleListTags(dep.Tags))
	mux.HandleFunc("POST /_/api/tags", handleCreateTag(dep.Tags))
	mux.HandleFunc("PATCH /_/api/tags/{id}", handleUpdateTag(dep.Tags))
	mux.HandleFunc("DELETE /_/api/tags/{id}", handleDeleteTag(dep.Tags))
	mux.HandleFunc("GET /_/api/tags/{id}/sessions", handleGetTagSessions(dep.Tags))
	mux.HandleFunc("POST /_/api/tags/{id}/sessions/{sessionId}", handleAssignTag(dep.Tags))
	mux.HandleFunc("DELETE /_/api/tags/{id}/sessions/{sessionId}", handleUnassignTag(dep.Tags))
	mux.HandleFunc("GET /_/api/sessions/{id}/tags", handleGetSessionTags(dep.Tags))
	mux.HandleFunc("GET /_/api/bookmarks", handleListBookmarks(dep.Bookmarks))
	mux.HandleFunc("POST /_/api/bookmarks", handleCreateBookmark(dep.Bookmarks))
	mux.HandleFunc("DELETE /_/api/bookmarks/{id}", handleDeleteBookmark(dep.Bookmarks))
	mux.HandleFunc("GET /_/api/notifications", handleListNotifications(dep))
	mux.HandleFunc("DELETE /_/api/notifications", handleClearNotifications(dep))
	mux.HandleFunc("POST /_/api/notifications/read", handleMarkNotificationsRead(dep))
	mux.HandleFunc("POST /_/api/notifications/active-view", handleActiveView(dep))
	mux.HandleFunc("GET /_/api/notifications/settings", handleGetNotifySettings(dep.Notifier))
	mux.HandleFunc("PUT /_/api/notifications/settings", handleSetNotifySettings(dep.Notifier))
	mux.HandleFunc("GET /_/api/prompts", handleListPrompts(dep.Prompts))
	mux.HandleFunc("POST /_/api/prompts", handleCreatePrompt(dep))
	mux.HandleFunc("PATCH /_/api/prompts/{id}", handleUpdatePrompt(dep))
	mux.HandleFunc("DELETE /_/api/prompts/{id}", handleDeletePrompt(dep))
	mux.HandleFunc("POST /_/api/prompts/{id}/dispatch", handleDispatchPrompt(dep))
	mux.HandleFunc("POST /_/api/prompts/batch", handleBatchDeletePrompts(dep))
	mux.HandleFunc("POST /_/api/shutdown", handleShutdown(dep))
	mux.HandleFunc("POST /_/api/restart", handleRestart(dep))
	mux.HandleFunc("POST /_/api/reset", handleReset(dep))
	mux.HandleFunc("GET /_/events", handleSSE(dep.Bus))
	mux.HandleFunc("GET /_/ws/terminal", handleTerminalWS(dep.Hub))

	// SPA fallback
	mux.HandleFunc("/", handleSPA())

	return mux
}

func handleStatus(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var schemaVersion int
		if dep.Meta != nil {
			if v, err := dep.Meta.SchemaVersion(); err != nil {
				slog.Warn("failed to read schema version", "error", err)
			} else {
				schemaVersion = v
			}
		}
		sources := 0
		if dep.Sources != nil {
			if all, err := dep.Sources.ListSources(); err == nil {
				sources = len(all)
			}
		}
		resp := map[string]any{
			"version":       version.Version,
			"pid":           os.Getpid(),
			"sources":       sources,
			"sessions":      len(dep.Hub.Sessions()),
			"schemaVersion": schemaVersion,
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSources(sources store.SourceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var out []ingest.Source
		if sources != nil {
			list, err := sources.ListSources()
			if err != nil {
				slog.Warn("failed to list sources", "error", err)
			} else {
				out = list
			}
		}
		if len(out) == 0 {
			out = []ingest.Source{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(out); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleAddSource(dep Dep) http.HandlerFunc {
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
		if len(body.Path) > 1 && body.Path[:2] == "~/" {
			home, err := os.UserHomeDir()
			if err == nil {
				body.Path = home + body.Path[1:]
			}
		}
		if body.AgentType == "" {
			body.AgentType = string(ingest.AgentOpenCode)
		}
		if body.Label == "" {
			for _, ai := range ingest.KnownAgentTypes() {
				if ai.Type == ingest.AgentType(body.AgentType) {
					body.Label = ai.Label
					break
				}
			}
		}
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
		if dep.Sources != nil {
			if err := dep.Sources.AddSource(src); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		if src.Enabled {
			if adapter, err := ingest.CreateAdapter(src); err != nil {
				slog.Warn("failed to create adapter for new source", "source", src.Path, "error", err)
			} else {
				dep.Hub.AddAdapter(src.ID, adapter)
			}
		}
		go refreshAndIndex(context.WithoutCancel(r.Context()), dep.Hub, dep.Indexer, dep.Notifier, dep.Bus)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(src); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleRemoveSource(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		dep.Hub.RemoveAdapter(id)
		if dep.Sources != nil {
			if err := dep.Sources.RemoveSource(id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		dep.Hub.refreshSessions(r.Context())
		dep.Bus.Send(sseEvent{Name: "update"})
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUpdateSource(dep Dep) http.HandlerFunc {
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
		dep.Hub.RemoveAdapter(id)
		if dep.Sources != nil {
			if err := dep.Sources.UpdateSource(id, body.Path, body.AgentType, body.Label, body.Enabled); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if body.Enabled {
				if src, err := dep.Sources.Source(id); err == nil && src != nil {
					if adapter, err := ingest.CreateAdapter(*src); err != nil {
						slog.Warn("failed to create adapter for updated source", "source", src.Path, "error", err)
					} else {
						dep.Hub.AddAdapter(id, adapter)
					}
				}
			}
		}
		go refreshAndIndex(context.WithoutCancel(r.Context()), dep.Hub, dep.Indexer, dep.Notifier, dep.Bus)
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDiscoverSources() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		discovered := ingest.AutoDiscover()
		if len(discovered) == 0 {
			discovered = []ingest.DiscoveredSource{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(discovered); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetConfig(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		config, err := cfg.AllConfig()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if config == nil {
			config = make(map[string]string)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(config); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetConfig(cfg store.ConfigStore) http.HandlerFunc {
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
		if cfg == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := cfg.SetConfig(body.Key, body.Value); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSessions(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessions := hub.Sessions()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(sessions); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetSession(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		session, err := hub.Session(r.Context(), id)
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

func handleGetMessages(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		messages, err := hub.Messages(r.Context(), id)
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

func handleGetPlan(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		plan, err := hub.Plan(r.Context(), id)
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

func handleGetDiffs(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		diffs, err := hub.Diffs(r.Context(), id)
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

func handleGetEdits(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		edits, err := hub.Edits(r.Context(), id)
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

func handleGetResumeCommand(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		abs, rel, agentCmd, err := hub.ResumeCommand(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"absolute":     abs,
			"relative":     rel,
			"agentCommand": agentCmd,
		}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetSessionName(hub *SessionHub) http.HandlerFunc {
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
		if err := hub.SetName(id, body.DisplayName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleClearSessionName(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := hub.ClearName(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleListScratchFiles(scratch store.ScratchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var files []store.ScratchFile
		if scratch != nil {
			if f, err := scratch.ListScratchFiles(id); err == nil {
				files = f
			}
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

func handleCreateScratchFile(dep Dep) http.HandlerFunc {
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
		if dep.Scratch == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
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
		if err := dep.Scratch.CreateScratchFile(f); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Indexer.ReindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(f); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetScratchFile(scratch store.ScratchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		if scratch == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		f, err := scratch.ScratchFile(fileID)
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

func handleUpdateScratchFile(dep Dep) http.HandlerFunc {
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
		if dep.Scratch == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := dep.Scratch.UpdateScratchFile(fileID, body.Title, body.Content); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Indexer.ReindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleRenameScratchFile(dep Dep) http.HandlerFunc {
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
		if dep.Scratch == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := dep.Scratch.RenameScratchFile(fileID, body.Title); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Indexer.ReindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDeleteScratchFile(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		sessionID := r.PathValue("id")
		if dep.Scratch == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := dep.Scratch.DeleteScratchFile(fileID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Indexer.ReindexSessionScratch(sessionID)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleListAllScratchFiles(scratch store.ScratchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var files []store.ScratchFile
		if scratch != nil {
			if f, err := scratch.ListAllScratchFiles(); err == nil {
				files = f
			}
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

func handleGetRecentSearches(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		searches, err := cfg.RecentSearches()
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

func handleSetRecentSearches(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var searches []string
		if err := json.NewDecoder(r.Body).Decode(&searches); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if cfg == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := cfg.SetRecentSearches(searches); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSearch(dep Dep) http.HandlerFunc {
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
		var results []store.SearchResult
		if dep.Search != nil {
			if res, err := dep.Search.Search(q, limit, sessionID); err == nil {
				results = res
			} else {
				slog.Warn("search error", "query", q, "error", err)
			}
		}
		// Enrich results with session title.
		titles := dep.Hub.TitleMap()
		for i := range results {
			if title, ok := titles[results[i].SessionID]; ok {
				results[i].SessionName = title
			}
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

// --- Tag handlers ---

func handleListTags(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Tag{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		list, err := tags.ListTags()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(list) == 0 {
			list = []store.Tag{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(list); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

type createTagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

func handleCreateTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var req createTagRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}
		now := time.Now()
		t := store.Tag{
			ID:        fmt.Sprintf("tag_%d", now.UnixNano()),
			Name:      req.Name,
			Color:     req.Color,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tags.CreateTag(t); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(t); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

type updateTagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func handleUpdateTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		var req updateTagRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}
		if err := tags.UpdateTag(id, req.Name, req.Color); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		if err := tags.DeleteTag(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetTagSessions(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]string{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		id := r.PathValue("id")
		sessionIDs, err := tags.TagSessions(id)
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

func handleAssignTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		tagID := r.PathValue("id")
		sessionID := r.PathValue("sessionId")
		if err := tags.AssignTag(tagID, sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUnassignTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		tagID := r.PathValue("id")
		sessionID := r.PathValue("sessionId")
		if err := tags.UnassignTag(tagID, sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetSessionTags(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Tag{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		sessionID := r.PathValue("id")
		list, err := tags.SessionTags(sessionID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(list) == 0 {
			list = []store.Tag{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(list); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

// --- Bookmark handlers ---

func handleListBookmarks(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if bookmarks == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.Bookmark{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		list, err := bookmarks.ListBookmarks()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(list) == 0 {
			list = []store.Bookmark{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(list); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

type createBookmarkRequest struct {
	SessionID    string `json:"sessionId"`
	MessageIndex int    `json:"messageIndex"`
	ToolCallID   string `json:"toolCallId"`
	Label        string `json:"label"`
}

func handleCreateBookmark(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if bookmarks == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var req createBookmarkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.SessionID == "" {
			http.Error(w, "sessionId is required", http.StatusBadRequest)
			return
		}
		// Toggle: if a bookmark exists at this reference, remove it.
		if existing, err := bookmarks.BookmarkByRef(req.SessionID, req.MessageIndex, req.ToolCallID); err == nil && existing != nil {
			if err := bookmarks.DeleteBookmark(existing.ID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"deleted": true, "id": existing.ID}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		b := store.Bookmark{
			ID:           fmt.Sprintf("bm_%d", time.Now().UnixNano()),
			SessionID:    req.SessionID,
			MessageIndex: req.MessageIndex,
			ToolCallID:   req.ToolCallID,
			Label:        req.Label,
			CreatedAt:    time.Now(),
		}
		if err := bookmarks.CreateBookmark(b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(b); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDeleteBookmark(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if bookmarks == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		if err := bookmarks.DeleteBookmark(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Notification handlers ---

func handleListNotifications(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Notifs == nil {
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
		unread := r.URL.Query().Get("unreadOnly") == "true" || r.URL.Query().Get("unreadOnly") == "1"
		list, err := dep.Notifs.ListNotifications(limit, unread)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(list) == 0 {
			list = []store.Notification{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(list); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleMarkNotificationsRead(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Notifs == nil {
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
		if err := dep.Notifs.MarkAllNotificationsRead(body.IDs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Broadcast read-state sync so other tabs update without refetching.
		data, err := json.Marshal(map[string]any{"ids": body.IDs})
		if err != nil {
			slog.Warn("failed to marshal notifications-read event", "error", err)
		} else {
			dep.Bus.Send(sseEvent{Name: "notifications-read", Data: string(data)})
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleClearNotifications(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Notifs == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := dep.Notifs.ClearNotifications(time.Time{}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "notifications-read", Data: "{\"all\":true}"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleActiveView(dep Dep) http.HandlerFunc {
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
		dep.Notifier.ReportActiveView(body.SessionID)
		if dep.Notifs != nil {
			if err := dep.Notifs.MarkSessionViewed(body.SessionID); err != nil {
				slog.Warn("failed to mark session viewed", "session", body.SessionID, "error", err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleGetNotifySettings(notifier *Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		settings := notifier.LoadSettings()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(settings); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSetNotifySettings(notifier *Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var settings notify.Settings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		// If the user is enabling notifications for the first time (or after
		// having disabled them), stamp EnabledAt so the classifier can suppress
		// the flood of pre-existing messages.
		prev := notifier.LoadSettings()
		if settings.Enabled && (!prev.Enabled || prev.EnabledAt == 0) {
			settings.EnabledAt = time.Now().UnixMilli()
		} else if !settings.Enabled {
			settings.EnabledAt = 0
		} else {
			settings.EnabledAt = prev.EnabledAt
		}
		if err := notifier.SaveSettings(settings); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(settings); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

// --- Prompt Queue handlers ---

func handleListPrompts(prompts store.PromptStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if prompts == nil {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]store.QueuedPrompt{}); err != nil {
				slog.Warn("failed to encode response", "error", err)
			}
			return
		}
		status := r.URL.Query().Get("status")
		sessionID := r.URL.Query().Get("session_id")
		limit := 100
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		list, err := prompts.ListPrompts(status, sessionID, limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(list) == 0 {
			list = []store.QueuedPrompt{}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(list); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleCreatePrompt(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Prompts == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		var body struct {
			SessionID  *string  `json:"sessionId"`
			SourceID   *string  `json:"sourceId"`
			PromptText string   `json:"promptText"`
			Priority   int      `json:"priority"`
			Tags       []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if body.PromptText == "" {
			http.Error(w, "promptText is required", http.StatusBadRequest)
			return
		}
		tagsJSON := "[]"
		if len(body.Tags) > 0 {
			if data, err := json.Marshal(body.Tags); err == nil {
				tagsJSON = string(data)
			}
		}
		p := store.QueuedPrompt{
			ID:         fmt.Sprintf("qp_%d", time.Now().UnixNano()),
			SessionID:  body.SessionID,
			SourceID:   body.SourceID,
			PromptText: body.PromptText,
			Status:     "queued",
			Priority:   body.Priority,
			Tags:       tagsJSON,
			CreatedAt:  time.Now().UnixMilli(),
		}
		if err := dep.Prompts.CreatePrompt(p); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "prompt-queue-changed"})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(p); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleUpdatePrompt(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Prompts == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		var body struct {
			PromptText *string  `json:"promptText"`
			Priority   *int     `json:"priority"`
			Tags       []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		existing, err := dep.Prompts.Prompt(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if existing == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		promptText := existing.PromptText
		if body.PromptText != nil {
			promptText = *body.PromptText
		}
		priority := existing.Priority
		if body.Priority != nil {
			priority = *body.Priority
		}
		tags := existing.Tags
		if len(body.Tags) > 0 {
			if data, err := json.Marshal(body.Tags); err == nil {
				tags = string(data)
			}
		}
		if err := dep.Prompts.UpdatePromptContent(id, promptText, tags, priority); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "prompt-queue-changed"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDeletePrompt(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Prompts == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		if err := dep.Prompts.DeletePrompt(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "prompt-queue-changed"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleDispatchPrompt(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Prompts == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		id := r.PathValue("id")
		existing, err := dep.Prompts.Prompt(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if existing == nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		now := time.Now().UnixMilli()
		if err := dep.Prompts.UpdatePromptStatus(id, "dispatched", &now); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "prompt-queue-changed"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"status": "ok", "promptText": existing.PromptText}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleBatchDeletePrompts(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Prompts == nil {
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
		if err := dep.Prompts.BatchDeletePrompts(body.IDs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dep.Bus.Send(sseEvent{Name: "prompt-queue-changed"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleShutdown(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in shutdown handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			dep.Shutdown()
		}()
	}
}

func handleRestart(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in restart handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			dep.Restart("")
		}()
	}
}

func handleReset(dep Dep) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if dep.Reset == nil {
			http.Error(w, "store not available", http.StatusInternalServerError)
			return
		}
		if err := dep.Reset.Reset(); err != nil {
			slog.Error("reset failed", "error", err)
			http.Error(w, "reset failed", http.StatusInternalServerError)
			return
		}
		// Close all adapters and clear the cache.
		dep.Hub.CloseAdapters()
		// Notify frontend to reload.
		dep.Bus.Send(sseEvent{Name: "reset"})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			slog.Warn("failed to encode response", "error", err)
		}
	}
}

func handleSSE(bus *EventBus) http.HandlerFunc {
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

		ch := bus.Subscribe()
		defer bus.Unsubscribe(ch)

		// Send initial event.
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

func handleTerminalWS(hub *SessionHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.URL.Query().Get("session_id")
		if sessionID == "" {
			http.Error(w, "missing session_id", http.StatusBadRequest)
			return
		}

		dir, initCmd := hub.TerminalTarget(sessionID)
		if initCmd == "" {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		if dir == "" {
			dir = "."
		}

		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			slog.Warn("terminal: websocket upgrade failed", "session", sessionID, "error", err)
			return
		}
		defer ws.Close(websocket.StatusNormalClosure, "terminal closed") //nolint:errcheck

		if err := terminal.Run(r.Context(), ws, dir, initCmd); err != nil {
			slog.Debug("terminal: session ended", "session", sessionID, "error", err)
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

		// Try to serve the file directly.
		if f, err := fsys.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for all routes.
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}
}
