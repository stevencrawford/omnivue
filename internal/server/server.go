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
// constructed with only the collaborators and role interfaces it serves, so a
// handler never reaches for the whole wiring bundle.
func NewHandler(dep Dep) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /_/api/status", handleStatus(dep.Meta, dep.Sources, dep.Hub))
	mux.HandleFunc("GET /_/api/sources", handleSources(dep.Sources))
	mux.HandleFunc("POST /_/api/sources", handleAddSource(dep.Sources, dep.Pipeline))
	mux.HandleFunc("DELETE /_/api/sources/{id}", handleRemoveSource(dep.Pipeline, dep.Sources))
	mux.HandleFunc("PATCH /_/api/sources/{id}", handleUpdateSource(dep.Pipeline, dep.Sources))
	mux.HandleFunc("GET /_/api/sources/discover", handleDiscoverSources())
	mux.HandleFunc("GET /_/api/config", handleGetConfig(dep.Config))
	mux.HandleFunc("PUT /_/api/config", handleSetConfig(dep.Config))
	mux.HandleFunc("GET /_/api/sessions", handleSessions(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}", handleGetSession(dep.Hub))
	mux.HandleFunc("GET /_/api/analytics", handleAnalytics(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/messages", handleGetMessages(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/plan", handleGetPlan(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/diffs", handleGetDiffs(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/edits", handleGetEdits(dep.Hub))
	mux.HandleFunc("PUT /_/api/sessions/{id}/name", handleSetSessionName(dep.Hub))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/name", handleClearSessionName(dep.Hub))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch", handleListScratchFiles(dep.Scratch))
	mux.HandleFunc("POST /_/api/sessions/{id}/scratch", handleCreateScratchFile(dep.Scratch, dep.Indexer))
	mux.HandleFunc("GET /_/api/sessions/{id}/scratch/{fileId}", handleGetScratchFile(dep.Scratch))
	mux.HandleFunc("PUT /_/api/sessions/{id}/scratch/{fileId}", handleUpdateScratchFile(dep.Scratch, dep.Indexer))
	mux.HandleFunc("PATCH /_/api/sessions/{id}/scratch/{fileId}", handleRenameScratchFile(dep.Scratch, dep.Indexer))
	mux.HandleFunc("DELETE /_/api/sessions/{id}/scratch/{fileId}", handleDeleteScratchFile(dep.Scratch, dep.Indexer))
	mux.HandleFunc("GET /_/api/scratch", handleListAllScratchFiles(dep.Scratch))
	mux.HandleFunc("GET /_/api/sessions/{id}/resume", handleGetResumeCommand(dep.Hub))
	mux.HandleFunc("GET /_/api/recent-searches", handleGetRecentSearches(dep.Config))
	mux.HandleFunc("POST /_/api/recent-searches", handleSetRecentSearches(dep.Config))
	mux.HandleFunc("GET /_/api/search", handleSearch(dep.Search, dep.Hub))
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
	mux.HandleFunc("GET /_/api/notifications", handleListNotifications(dep.Notifs))
	mux.HandleFunc("DELETE /_/api/notifications", handleClearNotifications(dep.Notifs, dep.Bus))
	mux.HandleFunc("POST /_/api/notifications/read", handleMarkNotificationsRead(dep.Notifs, dep.Bus))
	mux.HandleFunc("POST /_/api/notifications/active-view", handleActiveView(dep.Notifier, dep.Notifs))
	mux.HandleFunc("GET /_/api/notifications/settings", handleGetNotifySettings(dep.Notifier))
	mux.HandleFunc("PUT /_/api/notifications/settings", handleSetNotifySettings(dep.Notifier))
	mux.HandleFunc("GET /_/api/prompts", handleListPrompts(dep.Prompts))
	mux.HandleFunc("POST /_/api/prompts", handleCreatePrompt(dep.Prompts, dep.Bus))
	mux.HandleFunc("PATCH /_/api/prompts/{id}", handleUpdatePrompt(dep.Prompts, dep.Bus))
	mux.HandleFunc("DELETE /_/api/prompts/{id}", handleDeletePrompt(dep.Prompts, dep.Bus))
	mux.HandleFunc("POST /_/api/prompts/{id}/dispatch", handleDispatchPrompt(dep.Prompts, dep.Bus))
	mux.HandleFunc("POST /_/api/prompts/batch", handleBatchDeletePrompts(dep.Prompts, dep.Bus))
	mux.HandleFunc("POST /_/api/shutdown", handleShutdown(dep.Shutdown))
	mux.HandleFunc("POST /_/api/restart", handleRestart(dep.Restart))
	mux.HandleFunc("POST /_/api/reset", handleReset(dep.Reset, dep.Hub, dep.Bus))
	mux.HandleFunc("GET /_/events", handleSSE(dep.Bus))
	mux.HandleFunc("GET /_/ws/terminal", handleTerminalWS(dep.Hub))

	// SPA fallback
	mux.HandleFunc("/", handleSPA())

	return mux
}

func handleStatus(meta store.SchemaVersioner, sources store.SourceStore, catalog SessionCatalog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var schemaVersion int
		if meta != nil {
			if v, err := meta.SchemaVersion(); err != nil {
				slog.Warn("failed to read schema version", "error", err)
			} else {
				schemaVersion = v
			}
		}
		sourceCount := 0
		if sources != nil {
			if all, err := sources.ListSources(); err == nil {
				sourceCount = len(all)
			}
		}
		writeOK(w, map[string]any{
			"version":       version.Version,
			"pid":           os.Getpid(),
			"sources":       sourceCount,
			"sessions":      len(catalog.Sessions()),
			"schemaVersion": schemaVersion,
		})
	}
}

func handleSources(sources store.SourceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var out []ingest.Source
		if sources != nil {
			if list, err := sources.ListSources(); err == nil {
				out = list
			}
		}
		if len(out) == 0 {
			out = []ingest.Source{}
		}
		writeOK(w, out)
	}
}

func handleAddSource(sources store.SourceStore, p *Pipeline) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path      string `json:"path"`
			AgentType string `json:"agentType"`
			Label     string `json:"label"`
			Enabled   bool   `json:"enabled"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Path == "" {
			writeError(w, badRequest("path is required"))
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
		if sources != nil {
			if err := sources.AddSource(src); err != nil {
				writeError(w, err)
				return
			}
		}
		if src.Enabled {
			if adapter, err := ingest.CreateAdapter(src); err != nil {
				slog.Warn("failed to create adapter for new source", "source", src.Path, "error", err)
			} else {
				p.hub.AddAdapter(src.ID, adapter)
			}
		}
		go p.Refresh(context.WithoutCancel(r.Context()))
		writeCreated(w, src)
	}
}

func handleRemoveSource(p *Pipeline, sources store.SourceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		p.hub.RemoveAdapter(id)
		if sources != nil {
			if err := sources.RemoveSource(id); err != nil {
				writeError(w, err)
				return
			}
		}
		go p.Refresh(context.WithoutCancel(r.Context()))
		writeNoContent(w)
	}
}

func handleUpdateSource(p *Pipeline, sources store.SourceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Path      string `json:"path"`
			AgentType string `json:"agentType"`
			Label     string `json:"label"`
			Enabled   bool   `json:"enabled"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Path == "" {
			writeError(w, badRequest("path is required"))
			return
		}
		p.hub.RemoveAdapter(id)
		if sources != nil {
			if err := sources.UpdateSource(id, body.Path, body.AgentType, body.Label, body.Enabled); err != nil {
				writeError(w, err)
				return
			}
			if body.Enabled {
				if src, err := sources.Source(id); err == nil && src != nil {
					if adapter, err := ingest.CreateAdapter(*src); err != nil {
						slog.Warn("failed to create adapter for updated source", "source", src.Path, "error", err)
					} else {
						p.hub.AddAdapter(id, adapter)
					}
				}
			}
		}
		go p.Refresh(context.WithoutCancel(r.Context()))
		writeNoContent(w)
	}
}

func handleDiscoverSources() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		discovered := ingest.AutoDiscover()
		if len(discovered) == 0 {
			discovered = []ingest.DiscoveredSource{}
		}
		writeOK(w, discovered)
	}
}

func handleGetConfig(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, cfg) {
			return
		}
		config, err := cfg.AllConfig()
		if err != nil {
			writeError(w, err)
			return
		}
		if config == nil {
			config = make(map[string]string)
		}
		writeOK(w, config)
	}
}

func handleSetConfig(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Key == "" {
			writeError(w, badRequest("key is required"))
			return
		}
		if !requireStore(w, cfg) {
			return
		}
		if err := cfg.SetConfig(body.Key, body.Value); err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleSessions(catalog SessionCatalog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeOK(w, catalog.Sessions())
	}
}

func handleGetSession(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := reader.Session(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, session)
	}
}

func handleGetMessages(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		messages, err := reader.Messages(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, messages)
	}
}

func handleGetPlan(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		plan, err := reader.Plan(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, plan)
	}
}

func handleGetDiffs(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		diffs, err := reader.Diffs(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if len(diffs) == 0 {
			diffs = []ingest.DiffFile{}
		}
		writeOK(w, diffs)
	}
}

func handleGetEdits(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		edits, err := reader.Edits(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if len(edits) == 0 {
			edits = []ingest.FileEdit{}
		}
		writeOK(w, edits)
	}
}

func handleGetResumeCommand(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spec, err := reader.ResumeCommand(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{
			"directory":    spec.Directory,
			"absolute":     spec.Command,
			"relative":     spec.CommandNoCD,
			"agentCommand": spec.AgentCommand,
		})
	}
}

func handleSetSessionName(names SessionNames) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DisplayName string `json:"displayName"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.DisplayName == "" {
			writeError(w, badRequest("displayName is required"))
			return
		}
		if err := names.SetName(r.PathValue("id"), body.DisplayName); err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleClearSessionName(names SessionNames) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := names.ClearName(r.PathValue("id")); err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleListScratchFiles(scratch store.ScratchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var files []store.ScratchFile
		if scratch != nil {
			if f, err := scratch.ListScratchFiles(r.PathValue("id")); err == nil {
				files = f
			}
		}
		if len(files) == 0 {
			files = []store.ScratchFile{}
		}
		writeOK(w, files)
	}
}

func handleCreateScratchFile(scratch store.ScratchStore, index *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title   string `json:"title"`
			Content string `json:"content"`
			Mode    string `json:"mode"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Title == "" {
			body.Title = "Untitled"
		}
		if body.Mode == "" {
			body.Mode = "writable"
		}
		if !requireStore(w, scratch) {
			return
		}
		now := time.Now()
		f := store.ScratchFile{
			ID:        fmt.Sprintf("scratch_%d", now.UnixNano()),
			SessionID: r.PathValue("id"),
			Title:     body.Title,
			Content:   body.Content,
			Mode:      body.Mode,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := scratch.CreateScratchFile(f); err != nil {
			writeError(w, err)
			return
		}
		index.ReindexSessionScratch(f.SessionID)
		writeOK(w, f)
	}
}

func handleGetScratchFile(scratch store.ScratchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, scratch) {
			return
		}
		f, err := scratch.ScratchFile(r.PathValue("fileId"))
		if err != nil {
			writeError(w, notFound(err.Error()))
			return
		}
		writeOK(w, f)
	}
}

func handleUpdateScratchFile(scratch store.ScratchStore, index *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title   string `json:"title"`
			Content string `json:"content"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Title == "" {
			body.Title = "Untitled"
		}
		if !requireStore(w, scratch) {
			return
		}
		if err := scratch.UpdateScratchFile(r.PathValue("fileId"), body.Title, body.Content); err != nil {
			writeError(w, err)
			return
		}
		index.ReindexSessionScratch(r.PathValue("id"))
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleRenameScratchFile(scratch store.ScratchStore, index *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title string `json:"title"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.Title == "" {
			writeError(w, badRequest("title is required"))
			return
		}
		if !requireStore(w, scratch) {
			return
		}
		if err := scratch.RenameScratchFile(r.PathValue("fileId"), body.Title); err != nil {
			writeError(w, err)
			return
		}
		index.ReindexSessionScratch(r.PathValue("id"))
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleDeleteScratchFile(scratch store.ScratchStore, index *Indexer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, scratch) {
			return
		}
		if err := scratch.DeleteScratchFile(r.PathValue("fileId")); err != nil {
			writeError(w, err)
			return
		}
		index.ReindexSessionScratch(r.PathValue("id"))
		writeOK(w, map[string]string{"status": "ok"})
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
		writeOK(w, files)
	}
}

func handleGetRecentSearches(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, cfg) {
			return
		}
		searches, err := cfg.RecentSearches()
		if err != nil {
			writeError(w, err)
			return
		}
		if len(searches) == 0 {
			searches = []string{}
		}
		writeOK(w, searches)
	}
}

func handleSetRecentSearches(cfg store.ConfigStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var searches []string
		if err := decodeJSON(r, &searches); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if !requireStore(w, cfg) {
			return
		}
		if err := cfg.SetRecentSearches(searches); err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleSearch(search store.SearchStore, catalog SessionCatalog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			writeOK(w, []store.SearchResult{})
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
		if search != nil {
			if res, err := search.Search(q, limit, sessionID); err == nil {
				results = res
			} else {
				slog.Warn("search error", "query", q, "error", err)
			}
		}
		// Enrich results with session title.
		titles := catalog.TitleMap()
		for i := range results {
			if title, ok := titles[results[i].SessionID]; ok {
				results[i].SessionName = title
			}
		}
		if len(results) == 0 {
			results = []store.SearchResult{}
		}
		writeOK(w, results)
	}
}

// --- Tag handlers ---

func handleListTags(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			writeOK(w, []store.Tag{})
			return
		}
		list, err := tags.ListTags()
		if err != nil {
			writeError(w, err)
			return
		}
		if len(list) == 0 {
			list = []store.Tag{}
		}
		writeOK(w, list)
	}
}

type createTagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

func handleCreateTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, tags) {
			return
		}
		var req createTagRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if req.Name == "" {
			writeError(w, badRequest("name is required"))
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
			writeError(w, err)
			return
		}
		writeCreated(w, t)
	}
}

type updateTagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func handleUpdateTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, tags) {
			return
		}
		var req updateTagRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if req.Name == "" {
			writeError(w, badRequest("name is required"))
			return
		}
		if err := tags.UpdateTag(r.PathValue("id"), req.Name, req.Color); err != nil {
			writeError(w, err)
			return
		}
		writeNoContent(w)
	}
}

func handleDeleteTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, tags) {
			return
		}
		if err := tags.DeleteTag(r.PathValue("id")); err != nil {
			writeError(w, err)
			return
		}
		writeNoContent(w)
	}
}

func handleGetTagSessions(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			writeOK(w, []string{})
			return
		}
		sessionIDs, err := tags.TagSessions(r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if len(sessionIDs) == 0 {
			sessionIDs = []string{}
		}
		writeOK(w, sessionIDs)
	}
}

func handleAssignTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, tags) {
			return
		}
		if err := tags.AssignTag(r.PathValue("id"), r.PathValue("sessionId")); err != nil {
			writeError(w, err)
			return
		}
		writeNoContent(w)
	}
}

func handleUnassignTag(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, tags) {
			return
		}
		if err := tags.UnassignTag(r.PathValue("id"), r.PathValue("sessionId")); err != nil {
			writeError(w, err)
			return
		}
		writeNoContent(w)
	}
}

func handleGetSessionTags(tags store.TagStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if tags == nil {
			writeOK(w, []store.Tag{})
			return
		}
		list, err := tags.SessionTags(r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if len(list) == 0 {
			list = []store.Tag{}
		}
		writeOK(w, list)
	}
}

// --- Bookmark handlers ---

func handleListBookmarks(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if bookmarks == nil {
			writeOK(w, []store.Bookmark{})
			return
		}
		list, err := bookmarks.ListBookmarks()
		if err != nil {
			writeError(w, err)
			return
		}
		if len(list) == 0 {
			list = []store.Bookmark{}
		}
		writeOK(w, list)
	}
}

type createBookmarkRequest struct {
	SessionID    string `json:"sessionId"`
	MessageIndex int    `json:"messageIndex"`
	ToolCallID   string `json:"toolCallId"`
	Label        string `json:"label"`
	Kind         string `json:"kind"`
}

func handleCreateBookmark(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, bookmarks) {
			return
		}
		var req createBookmarkRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if req.SessionID == "" {
			writeError(w, badRequest("sessionId is required"))
			return
		}
		if req.Kind == "" {
			req.Kind = "message"
		}
		if req.Kind != "message" && req.Kind != "plan" {
			writeError(w, badRequest("kind must be 'message' or 'plan'"))
			return
		}
		// Toggle: if a bookmark exists at this reference, remove it.
		if existing, err := bookmarks.BookmarkByRef(req.SessionID, req.MessageIndex, req.ToolCallID); err == nil && existing != nil {
			if err := bookmarks.DeleteBookmark(existing.ID); err != nil {
				writeError(w, err)
				return
			}
			writeOK(w, map[string]any{"deleted": true, "id": existing.ID})
			return
		}
		b := store.Bookmark{
			ID:           fmt.Sprintf("bm_%d", time.Now().UnixNano()),
			SessionID:    req.SessionID,
			MessageIndex: req.MessageIndex,
			ToolCallID:   req.ToolCallID,
			Label:        req.Label,
			Kind:         req.Kind,
			CreatedAt:    time.Now(),
		}
		if err := bookmarks.CreateBookmark(b); err != nil {
			writeError(w, err)
			return
		}
		writeCreated(w, b)
	}
}

func handleDeleteBookmark(bookmarks store.BookmarkStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, bookmarks) {
			return
		}
		if err := bookmarks.DeleteBookmark(r.PathValue("id")); err != nil {
			writeError(w, err)
			return
		}
		writeNoContent(w)
	}
}

// --- Notification handlers ---

func handleListNotifications(notifs store.NotificationStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if notifs == nil {
			writeOK(w, []store.Notification{})
			return
		}
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}
		unread := r.URL.Query().Get("unreadOnly") == "true" || r.URL.Query().Get("unreadOnly") == "1"
		list, err := notifs.ListNotifications(limit, unread)
		if err != nil {
			writeError(w, err)
			return
		}
		if len(list) == 0 {
			list = []store.Notification{}
		}
		writeOK(w, list)
	}
}

func handleMarkNotificationsRead(notifs store.NotificationStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, notifs) {
			return
		}
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if err := notifs.MarkAllNotificationsRead(body.IDs); err != nil {
			writeError(w, err)
			return
		}
		// Broadcast read-state sync so other tabs update without refetching.
		data, err := json.Marshal(map[string]any{"ids": body.IDs})
		if err != nil {
			slog.Warn("failed to marshal notifications-read event", "error", err)
		} else {
			bus.Send(sseEvent{Name: "notifications-read", Data: string(data)})
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleClearNotifications(notifs store.NotificationStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, notifs) {
			return
		}
		if err := notifs.ClearNotifications(time.Time{}); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "notifications-read", Data: "{\"all\":true}"})
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleActiveView(notifier *Notifier, notifs store.NotificationStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.SessionID == "" {
			writeError(w, badRequest("sessionId is required"))
			return
		}
		notifier.ReportActiveView(body.SessionID)
		if notifs != nil {
			if err := notifs.MarkSessionViewed(body.SessionID); err != nil {
				slog.Warn("failed to mark session viewed", "session", body.SessionID, "error", err)
			}
		}
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleGetNotifySettings(notifier *Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeOK(w, notifier.LoadSettings())
	}
}

func handleSetNotifySettings(notifier *Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var settings notify.Settings
		if err := decodeJSON(r, &settings); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		// If the user is enabling notifications for the first time (or after
		// having disabled them), stamp EnabledAt so the classifier can suppress
		// the flood of pre-existing messages. The decision lives in the notify
		// package so the flood-suppression policy has a single home.
		prev := notifier.LoadSettings()
		settings.EnabledAt = notify.ResolveEnabledAt(prev, settings, time.Now())
		if err := notifier.SaveSettings(settings); err != nil {
			writeError(w, err)
			return
		}
		writeOK(w, settings)
	}
}

// --- Prompt Queue handlers ---

func handleListPrompts(prompts store.PromptStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if prompts == nil {
			writeOK(w, []store.QueuedPrompt{})
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
			writeError(w, err)
			return
		}
		if len(list) == 0 {
			list = []store.QueuedPrompt{}
		}
		writeOK(w, list)
	}
}

func handleCreatePrompt(prompts store.PromptStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, prompts) {
			return
		}
		var body struct {
			SessionID  *string  `json:"sessionId"`
			SourceID   *string  `json:"sourceId"`
			PromptText string   `json:"promptText"`
			Priority   int      `json:"priority"`
			Tags       []string `json:"tags"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if body.PromptText == "" {
			writeError(w, badRequest("promptText is required"))
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
		if err := prompts.CreatePrompt(p); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "prompt-queue-changed"})
		writeCreated(w, p)
	}
}

func handleUpdatePrompt(prompts store.PromptStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, prompts) {
			return
		}
		var body struct {
			PromptText *string  `json:"promptText"`
			Priority   *int     `json:"priority"`
			Tags       []string `json:"tags"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		existing, err := prompts.Prompt(r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if existing == nil {
			writeError(w, notFound("not found"))
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
		if err := prompts.UpdatePromptContent(r.PathValue("id"), promptText, tags, priority); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "prompt-queue-changed"})
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleDeletePrompt(prompts store.PromptStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, prompts) {
			return
		}
		if err := prompts.DeletePrompt(r.PathValue("id")); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "prompt-queue-changed"})
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleDispatchPrompt(prompts store.PromptStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, prompts) {
			return
		}
		existing, err := prompts.Prompt(r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if existing == nil {
			writeError(w, notFound("not found"))
			return
		}
		now := time.Now().UnixMilli()
		if err := prompts.UpdatePromptStatus(r.PathValue("id"), "dispatched", &now); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "prompt-queue-changed"})
		writeOK(w, map[string]any{"status": "ok", "promptText": existing.PromptText})
	}
}

func handleBatchDeletePrompts(prompts store.PromptStore, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, prompts) {
			return
		}
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, badRequest("invalid request body"))
			return
		}
		if err := prompts.BatchDeletePrompts(body.IDs); err != nil {
			writeError(w, err)
			return
		}
		bus.Send(sseEvent{Name: "prompt-queue-changed"})
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleShutdown(shutdown func()) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeAccepted(w)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in shutdown handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			shutdown()
		}()
	}
}

func handleRestart(restart func(string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeAccepted(w)
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in restart handler", "recover", r)
				}
			}()
			time.Sleep(100 * time.Millisecond)
			restart("")
		}()
	}
}

func handleReset(reset store.Resetter, hub *SessionHub, bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStore(w, reset) {
			return
		}
		if err := reset.Reset(); err != nil {
			slog.Error("reset failed", "error", err)
			writeError(w, internalError("reset failed"))
			return
		}
		// Close all adapters and clear the cache.
		hub.CloseAdapters()
		// Notify frontend to reload.
		bus.Send(sseEvent{Name: "reset"})
		writeOK(w, map[string]string{"status": "ok"})
	}
}

func handleSSE(bus *EventBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, internalError("streaming unsupported"))
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

func handleTerminalWS(reader SessionReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.URL.Query().Get("session_id")
		if sessionID == "" {
			writeError(w, badRequest("missing session_id"))
			return
		}

		spec, err := reader.ResumeCommand(r.Context(), sessionID)
		if err != nil {
			writeError(w, notFound("session not found"))
			return
		}
		dir := spec.Directory
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

		if err := terminal.Run(r.Context(), ws, dir, spec.CommandNoCD); err != nil {
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
