package store

import (
	"io"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

// SourceStore exposes CRUD for configured session data sources.
type SourceStore interface {
	AddSource(src ingest.Source) error
	ListSources() ([]ingest.Source, error)
	RemoveSource(id string) error
	UpdateSource(id, path, agentType, label string, enabled bool) error
	Source(id string) (*ingest.Source, error)
}

// SessionNameStore exposes read/write over per-session display-name overrides.
type SessionNameStore interface {
	SetSessionName(sessionID, displayName string) error
	ClearSessionName(sessionID string) error
	SessionName(sessionID string) (string, error)
	AllSessionNames() (map[string]string, error)
}

// TagStore exposes CRUD for user tags and their session assignments.
type TagStore interface {
	CreateTag(t Tag) error
	ListTags() ([]Tag, error)
	UpdateTag(id, name, color string) error
	DeleteTag(id string) error
	AssignTag(tagID, sessionID string) error
	UnassignTag(tagID, sessionID string) error
	TagSessions(tagID string) ([]string, error)
	SessionTags(sessionID string) ([]Tag, error)
}

// BookmarkStore exposes CRUD for bookmarked messages within sessions.
type BookmarkStore interface {
	CreateBookmark(b Bookmark) error
	ListBookmarks() ([]Bookmark, error)
	BookmarkByPosition(sessionID, messageID, toolCallID string) (*Bookmark, error)
	DeleteBookmark(id string) error
}

// ScratchStore exposes CRUD for per-session scratch notes.
type ScratchStore interface {
	CreateScratchFile(f ScratchFile) error
	ListScratchFiles(sessionID string) ([]ScratchFile, error)
	ListAllScratchFiles() ([]ScratchFile, error)
	ScratchFile(id string) (*ScratchFile, error)
	UpdateScratchFile(id, title, content string) error
	RenameScratchFile(id, title string) error
	DeleteScratchFile(id string) error
}

// ConfigStore exposes key-value config plus the recent-search history that is
// stored inside the config table.
type ConfigStore interface {
	Config(key string) (string, error)
	SetConfig(key, value string) error
	AllConfig() (map[string]string, error)
	RecentSearches() ([]string, error)
	SetRecentSearches(searches []string) error
}

// NotificationStore exposes CRUD for notifications and their per-session state.
type NotificationStore interface {
	InsertNotification(n Notification, dedupKey string) (bool, error)
	ListNotifications(limit int, unreadOnly bool) ([]Notification, error)
	MarkNotificationRead(id string) error
	MarkAllNotificationsRead(ids []string) error
	ClearNotifications(olderThan time.Time) error
	PruneNotifications(keep int) error
	NotificationState(sessionID string) (NotificationState, error)
	SetNotificationState(sessionID string, lastSeenCount int, at time.Time) error
	MarkSessionViewed(sessionID string) error
}

// PromptStore exposes CRUD for the deferred prompt queue.
type PromptStore interface {
	CreatePrompt(p QueuedPrompt) error
	Prompt(id string) (*QueuedPrompt, error)
	ListPrompts(status, sessionID string, limit int) ([]QueuedPrompt, error)
	UpdatePromptStatus(id, status string, dispatchedAt *int64) error
	UpdatePromptContent(id, promptText, tags string, priority int) error
	DeletePrompt(id string) error
	BatchDeletePrompts(ids []string) error
}

// SearchStore exposes the FTS5 search index read/write operations.
type SearchStore interface {
	ClearSessionIndex(sessionID string) error
	ClearSessionChunkType(sessionID, chunkType string) error
	IndexSession(sessionID, sourceID, chunkType, repository, content string) error
	IndexSessionAt(sessionID, sourceID, chunkType, repository, content, updatedAt, fileTitle, fileID string, messageIndex int) error
	UpdateIndexState(sessionID, sourceID, contentHash string) error
	IndexState(sessionID string) (string, error)
	Search(query string, limit int, sessionID string) ([]SearchResult, error)
	SearchTags(query string, limit int) []SearchResult
}

// Resetter exposes the destructive full reset of all user data.
type Resetter interface {
	Reset() error
}

// SchemaVersioner exposes the schema version of the underlying database.
type SchemaVersioner interface {
	SchemaVersion() (int, error)
}

var (
	_ SourceStore       = (*Store)(nil)
	_ SessionNameStore  = (*Store)(nil)
	_ TagStore          = (*Store)(nil)
	_ BookmarkStore     = (*Store)(nil)
	_ ScratchStore      = (*Store)(nil)
	_ ConfigStore       = (*Store)(nil)
	_ NotificationStore = (*Store)(nil)
	_ PromptStore       = (*Store)(nil)
	_ SearchStore       = (*Store)(nil)
	_ Resetter          = (*Store)(nil)
	_ SchemaVersioner   = (*Store)(nil)
	_ io.Closer         = (*Store)(nil)
)
