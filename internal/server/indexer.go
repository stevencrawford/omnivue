package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/store"
)

// Indexer maintains the FTS5 search index over session content. It reads the
// current cached session list through the SessionHub and persists index rows
// through a narrowed SearchStore, so indexing is testable without the poll
// machinery.
type Indexer struct {
	hub     *SessionHub
	search  store.SearchStore
	scratch store.ScratchStore
}

func NewIndexer(hub *SessionHub, search store.SearchStore, scratch store.ScratchStore) *Indexer {
	return &Indexer{hub: hub, search: search, scratch: scratch}
}

// IndexSessions indexes session content into the FTS5 search index. It runs
// incrementally: sessions are only re-indexed if their content hash changes.
func (ix *Indexer) IndexSessions(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in IndexSessions", "recover", r)
		}
	}()
	if ix.search == nil {
		return
	}

	sessions := ix.hub.Sessions()
	adapters := ix.hub.Adapters()

	for _, sess := range sessions {
		adapter := adapters[sess.SourceID]
		if adapter == nil {
			continue
		}

		// Get messages for hashing.
		messages, err := adapter.Messages(ctx, sess.ID)
		if err != nil {
			continue
		}
		if len(messages) == 0 {
			continue
		}

		// Build content for each chunk type.
		messagesContent := buildMessagesContent(messages)

		// Build plan content.
		var planContent string
		if ps, ok := adapter.(ingest.Planner); ok {
			if plan, err := ps.Plan(ctx, sess.ID); err == nil && plan != nil {
				planContent = plan.Markdown
			}
		}

		// Build name content (title is searchable).
		nameContent := sess.Title

		// Get scratch files for hash comparison and indexing.
		var scratchFiles []store.ScratchFile
		if ix.scratch != nil {
			scratchFiles, err = ix.scratch.ListScratchFiles(sess.ID)
			if err != nil {
				slog.Warn("failed to list scratch files", "session_id", sess.ID, "error", err)
			}
		}
		var scratchBuilder strings.Builder
		for _, sf := range scratchFiles {
			scratchBuilder.WriteString(sf.Title)
			scratchBuilder.WriteString("\n")
			scratchBuilder.WriteString(sf.Content)
			scratchBuilder.WriteString("\n")
		}
		scratchContent := scratchBuilder.String()

		// Combined content for hash comparison.
		combined := nameContent + "\n" + planContent + "\n" + messagesContent + "\n" + scratchContent
		h := sha256.Sum256([]byte(combined))
		contentHash := hex.EncodeToString(h[:8])

		// Check if already indexed with same hash.
		existingHash, err := ix.search.IndexState(sess.ID)
		if err != nil {
			continue
		}
		if existingHash == contentHash {
			continue // already up to date
		}

		// Clear old index entries and re-index.
		if err := retryOnBusy(func() error { return ix.search.ClearSessionIndex(sess.ID) }); err != nil {
			slog.Warn("failed to clear session index", "session", sess.ID, "error", err)
			continue
		}

		updatedAt := sess.UpdatedAt.Format(time.RFC3339)

		// Index name chunk.
		if err := retryOnBusy(func() error {
			return ix.search.IndexSessionAt(sess.ID, sess.SourceID, "name", sess.Repository, nameContent, updatedAt, "", "", 0)
		}); err != nil {
			slog.Warn("failed to index session name", "session", sess.ID, "error", err)
		}

		// Index plan chunk.
		if planContent != "" {
			if err := retryOnBusy(func() error {
				return ix.search.IndexSessionAt(sess.ID, sess.SourceID, "plan", sess.Repository, planContent, updatedAt, "", "", 0)
			}); err != nil {
				slog.Warn("failed to index session plan", "session", sess.ID, "error", err)
			}
		}

		// Index individual messages with their index for exact message targeting.
		for mi, msg := range messages {
			msgContent := buildContentWithTools(msg)
			if err := retryOnBusy(func() error {
				return ix.search.IndexSessionAt(sess.ID, sess.SourceID, "message", sess.Repository, msgContent, updatedAt, "", "", mi)
			}); err != nil {
				slog.Warn("failed to index session message", "session", sess.ID, "idx", mi, "error", err)
			}
		}

		// Index scratch files chunk.
		if len(scratchFiles) > 0 {
			if err := retryOnBusy(func() error { return ix.search.ClearSessionChunkType(sess.ID, "scratch") }); err != nil {
				slog.Warn("failed to clear scratch index", "session", sess.ID, "error", err)
			}
			for _, sf := range scratchFiles {
				if sf.Content == "" {
					continue
				}
				fileContent := sf.Title + "\n" + sf.Content
				if err := retryOnBusy(func() error {
					return ix.search.IndexSessionAt(sess.ID, sess.SourceID, "scratch", sess.Repository, fileContent, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0)
				}); err != nil {
					slog.Warn("failed to index scratch file", "session", sess.ID, "file", sf.ID, "error", err)
				}
			}
		}

		// Update index state.
		if err := retryOnBusy(func() error { return ix.search.UpdateIndexState(sess.ID, sess.SourceID, contentHash) }); err != nil {
			slog.Warn("failed to update index state", "session", sess.ID, "error", err)
		}
	}
}

// ReindexSessionScratch re-indexes all scratch files for a session.
func (ix *Indexer) ReindexSessionScratch(sessionID string) {
	if ix.search == nil || ix.scratch == nil {
		return
	}
	scratchFiles, err := ix.scratch.ListScratchFiles(sessionID)
	if err != nil {
		return
	}

	// Look up session info for sourceID/repository.
	sourceID := ""
	repository := ""
	for _, sess := range ix.hub.Sessions() {
		if sess.ID == sessionID {
			sourceID = sess.SourceID
			repository = sess.Repository
			break
		}
	}

	if err := retryOnBusy(func() error { return ix.search.ClearSessionChunkType(sessionID, "scratch") }); err != nil {
		return
	}
	for _, sf := range scratchFiles {
		if sf.Content == "" {
			continue
		}
		content := sf.Title + "\n" + sf.Content
		if err := retryOnBusy(func() error {
			return ix.search.IndexSessionAt(sessionID, sourceID, "scratch", repository, content, sf.UpdatedAt.Format(time.RFC3339), sf.Title, sf.ID, 0)
		}); err != nil {
			slog.Warn("failed to index scratch file", "session", sessionID, "file", sf.ID, "error", err)
		}
	}
}

// buildMessagesContent concatenates every message's content plus its tool calls.
func buildMessagesContent(messages []ingest.Message) string {
	var b strings.Builder
	for _, msg := range messages {
		b.WriteString(msg.Content)
		b.WriteString("\n")
		writeToolCalls(&b, msg.ToolCalls)
	}
	return b.String()
}

// buildContentWithTools builds a single message's search content including tool calls.
func buildContentWithTools(msg ingest.Message) string {
	var b strings.Builder
	b.WriteString(msg.Content)
	b.WriteString("\n")
	writeToolCalls(&b, msg.ToolCalls)
	return b.String()
}

func writeToolCalls(b *strings.Builder, calls []ingest.ToolCall) {
	for _, tc := range calls {
		b.WriteString(tc.Name)
		b.WriteString(" ")
		if isPlanTool(tc.Name) && tc.Input != "" {
			b.WriteString(tc.Input)
			b.WriteString(" ")
		}
		b.WriteString(tc.Output)
		b.WriteString("\n")
	}
}
