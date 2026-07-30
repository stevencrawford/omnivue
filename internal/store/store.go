package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
	"github.com/stevencrawford/omnivue/internal/xdg"

	_ "modernc.org/sqlite"
)

// Store manages the Omnivue application database (sources, folders, search index).
type Store struct {
	db   *sql.DB
	path string
}

// New creates or opens the Omnivue database at $XDG_STATE_HOME/omnivue/omnivue.db.
func New() (*Store, error) {
	stateHome, err := xdg.StateHome()
	if err != nil {
		return nil, fmt.Errorf("resolving state home: %w", err)
	}
	stateDir := filepath.Join(stateHome, "omnivue")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, fmt.Errorf("creating state directory: %w", err)
	}

	dbPath := filepath.Join(stateDir, "omnivue.db")
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=journal_mode(wal)&_pragma=busy_timeout(10000)", dbPath))
	if err != nil {
		return nil, fmt.Errorf("opening omnivue.db: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	s := &Store{db: db, path: dbPath}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrating omnivue.db: %w", err)
	}

	return s, nil
}

// Path returns the database file path.
func (s *Store) Path() string {
	return s.path
}

// Close closes the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// --- Source CRUD ---

// AddSource adds a new session data source.
func (s *Store) AddSource(src ingest.Source) error {
	if src.Path == "" {
		// Cloud sources with no path — upsert by id (which is agent-type derived).
		_, err := s.db.Exec(`
			INSERT INTO sources (id, path, agent_type, label, enabled, created_at)
			VALUES (?, NULL, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET label=excluded.label, enabled=excluded.enabled
		`, src.ID, string(src.AgentType), src.Label, src.Enabled, src.CreatedAt.Format(time.RFC3339))
		return err
	}
	_, err := s.db.Exec(`
		INSERT INTO sources (id, path, agent_type, label, enabled, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET label=excluded.label, enabled=excluded.enabled
	`, src.ID, src.Path, string(src.AgentType), src.Label, src.Enabled, src.CreatedAt.Format(time.RFC3339))
	return err
}

// ListSources returns all configured sources.
func (s *Store) ListSources() ([]ingest.Source, error) {
	rows, err := s.db.Query(`SELECT id, path, agent_type, label, enabled, created_at FROM sources ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sources []ingest.Source
	for rows.Next() {
		var (
			src       ingest.Source
			agentType string
			createdAt string
			path      sql.NullString
			label     sql.NullString
		)
		if err := rows.Scan(&src.ID, &path, &agentType, &label, &src.Enabled, &createdAt); err != nil {
			return nil, err
		}
		src.Path = path.String
		src.Label = label.String
		src.AgentType = ingest.AgentType(agentType)
		src.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			src.CreatedAt = time.Time{}
		}
		sources = append(sources, src)
	}
	return sources, rows.Err()
}

// RemoveSource removes a source by ID.
func (s *Store) RemoveSource(id string) error {
	_, err := s.db.Exec(`DELETE FROM sources WHERE id = ?`, id)
	return err
}

// UpdateSource updates a source's path, agent_type, label, and enabled status.
func (s *Store) UpdateSource(id, path, agentType, label string, enabled bool) error {
	_, err := s.db.Exec(`
		UPDATE sources SET path = ?, agent_type = ?, label = ?, enabled = ?
		WHERE id = ?
	`, path, agentType, label, enabled, id)
	return err
}

// Source returns a single source by ID.
func (s *Store) Source(id string) (*ingest.Source, error) {
	var src ingest.Source
	var agentType string
	var createdAt string
	var path sql.NullString
	var label sql.NullString
	err := s.db.QueryRow(
		`SELECT id, path, agent_type, label, enabled, created_at FROM sources WHERE id = ?`, id,
	).Scan(&src.ID, &path, &agentType, &label, &src.Enabled, &createdAt)
	if err != nil {
		return nil, err
	}
	src.Path = path.String
	src.Label = label.String
	src.AgentType = ingest.AgentType(agentType)
	src.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
	if err != nil {
		slog.Warn("failed to parse time", "error", err)
		src.CreatedAt = time.Time{}
	}
	return &src, nil
}

// --- Config CRUD ---

// Config returns a config value by key. Returns empty string if not set.
func (s *Store) Config(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM config WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

// SetConfig upserts a config key-value pair.
func (s *Store) SetConfig(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO config (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

// RecentSearches returns the list of recent search queries.
func (s *Store) RecentSearches() ([]string, error) {
	val, err := s.Config("recent_searches")
	if err != nil {
		return nil, err
	}
	if val == "" {
		return nil, nil
	}
	var searches []string
	if err := json.Unmarshal([]byte(val), &searches); err != nil {
		return nil, nil
	}
	return searches, nil
}

// SetRecentSearches stores the list of recent search queries.
func (s *Store) SetRecentSearches(searches []string) error {
	data, err := json.Marshal(searches)
	if err != nil {
		return err
	}
	return s.SetConfig("recent_searches", string(data))
}

// AllConfig returns all config key-value pairs.
func (s *Store) AllConfig() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM config`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cfg := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		cfg[key] = value
	}
	return cfg, rows.Err()
}

// --- Folder CRUD ---

// Folder represents a user-defined folder.
type Folder struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  *string   `json:"parentId,omitempty"`
	SortOrder int       `json:"sortOrder"`
	Color     string    `json:"color,omitempty"`
	Icon      string    `json:"icon,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateFolder creates a new folder.
func (s *Store) CreateFolder(f Folder) error {
	_, err := s.db.Exec(`
		INSERT INTO folders (id, name, parent_id, sort_order, color, icon, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, f.ID, f.Name, f.ParentID, f.SortOrder, f.Color, f.Icon,
		f.CreatedAt.Format(time.RFC3339), f.UpdatedAt.Format(time.RFC3339))
	return err
}

// ListFolders returns all folders.
func (s *Store) ListFolders() ([]Folder, error) {
	rows, err := s.db.Query(`SELECT id, name, parent_id, sort_order, color, icon, created_at, updated_at FROM folders ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []Folder
	for rows.Next() {
		var (
			f         Folder
			createdAt string
			updatedAt string
		)
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.SortOrder, &f.Color, &f.Icon, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		f.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.CreatedAt = time.Time{}
		}
		f.UpdatedAt, err = time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.UpdatedAt = time.Time{}
		}
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

// AssignSession assigns a session to a folder.
func (s *Store) AssignSession(folderID, sessionID string) error {
	_, err := s.db.Exec(`
		INSERT INTO folder_sessions (folder_id, session_id, sort_order, added_at)
		VALUES (?, ?, 0, ?)
		ON CONFLICT DO NOTHING
	`, folderID, sessionID, time.Now().Format(time.RFC3339))
	return err
}

// UnassignSession removes a session from a folder.
func (s *Store) UnassignSession(folderID, sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM folder_sessions WHERE folder_id = ? AND session_id = ?`, folderID, sessionID)
	return err
}

// UpdateFolder updates a folder's name, color, and icon.
func (s *Store) UpdateFolder(id, name, color, icon string) error {
	_, err := s.db.Exec(`
		UPDATE folders SET name = ?, color = ?, icon = ?, updated_at = ?
		WHERE id = ?
	`, name, color, icon, time.Now().Format(time.RFC3339), id)
	return err
}

// DeleteFolder removes a folder and its session assignments.
func (s *Store) DeleteFolder(id string) error {
	// folder_sessions has ON DELETE CASCADE, so just delete the folder
	_, err := s.db.Exec(`DELETE FROM folders WHERE id = ?`, id)
	return err
}

// FolderSessions returns session IDs assigned to a folder.
func (s *Store) FolderSessions(folderID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT session_id FROM folder_sessions WHERE folder_id = ? ORDER BY sort_order, added_at`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SessionFolders returns folder IDs that a session belongs to.
func (s *Store) SessionFolders(sessionID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT folder_id FROM folder_sessions WHERE session_id = ?`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// --- Bookmark CRUD ---

// Bookmark represents a bookmarked message or tool call within a session.
type Bookmark struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"sessionId"`
	MessageIndex int       `json:"messageIndex"`
	ToolCallID   string    `json:"toolCallId,omitempty"`
	Label        string    `json:"label"`
	CreatedAt    time.Time `json:"createdAt"`
}

// CreateBookmark creates a new bookmark. Silently ignores duplicates.
func (s *Store) CreateBookmark(b Bookmark) error {
	_, err := s.db.Exec(`
		INSERT INTO bookmarks (id, session_id, message_index, tool_call_id, label, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT DO NOTHING
	`, b.ID, b.SessionID, b.MessageIndex, b.ToolCallID, b.Label, b.CreatedAt.Format(time.RFC3339))
	return err
}

// ListBookmarks returns all bookmarks ordered by creation time (newest first).
func (s *Store) ListBookmarks() ([]Bookmark, error) {
	rows, err := s.db.Query(`SELECT id, session_id, message_index, tool_call_id, label, created_at FROM bookmarks ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var bookmarks []Bookmark
	for rows.Next() {
		var (
			b         Bookmark
			createdAt string
		)
		if err := rows.Scan(&b.ID, &b.SessionID, &b.MessageIndex, &b.ToolCallID, &b.Label, &createdAt); err != nil {
			return nil, err
		}
		b.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			b.CreatedAt = time.Time{}
		}
		bookmarks = append(bookmarks, b)
	}
	return bookmarks, rows.Err()
}

// BookmarkByRef finds a bookmark by its composite reference key.
func (s *Store) BookmarkByRef(sessionID string, messageIndex int, toolCallID string) (*Bookmark, error) {
	var b Bookmark
	var createdAt string
	err := s.db.QueryRow(
		`SELECT id, session_id, message_index, tool_call_id, label, created_at FROM bookmarks WHERE session_id = ? AND message_index = ? AND tool_call_id = ?`,
		sessionID, messageIndex, toolCallID,
	).Scan(&b.ID, &b.SessionID, &b.MessageIndex, &b.ToolCallID, &b.Label, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
	if err != nil {
		slog.Warn("failed to parse time", "error", err)
		b.CreatedAt = time.Time{}
	}
	return &b, nil
}

// DeleteBookmark removes a bookmark by ID.
func (s *Store) DeleteBookmark(id string) error {
	_, err := s.db.Exec(`DELETE FROM bookmarks WHERE id = ?`, id)
	return err
}

// --- Session Name Overrides ---

// SetSessionName sets or updates the display name override for a session.
func (s *Store) SetSessionName(sessionID, displayName string) error {
	_, err := s.db.Exec(`
		INSERT INTO session_names (session_id, display_name, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at
	`, sessionID, displayName, time.Now().Format(time.RFC3339))
	return err
}

// ClearSessionName removes the display name override for a session.
func (s *Store) ClearSessionName(sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM session_names WHERE session_id = ?`, sessionID)
	return err
}

// SessionName returns the display name override, or empty string if not set.
func (s *Store) SessionName(sessionID string) (string, error) {
	var name string
	err := s.db.QueryRow(`SELECT display_name FROM session_names WHERE session_id = ?`, sessionID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return name, err
}

// AllSessionNames returns all display name overrides as a map.
func (s *Store) AllSessionNames() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT session_id, display_name FROM session_names`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := make(map[string]string)
	for rows.Next() {
		var sid, name string
		if err := rows.Scan(&sid, &name); err != nil {
			continue
		}
		names[sid] = name
	}
	return names, rows.Err()
}

// --- Scratch Files ---

// ScratchFile represents a scratch markdown note attached to a session.
type ScratchFile struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Mode      string    `json:"mode"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateScratchFile creates a new scratch file.
func (s *Store) CreateScratchFile(f ScratchFile) error {
	mode := f.Mode
	if mode == "" {
		mode = "writable"
	}
	_, err := s.db.Exec(`
		INSERT INTO scratch_files (id, session_id, title, content, mode, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, f.ID, f.SessionID, f.Title, f.Content, mode, f.CreatedAt.Format(time.RFC3339), f.UpdatedAt.Format(time.RFC3339))
	return err
}

// ListScratchFiles returns all scratch files for a session, ordered by updated_at desc.
func (s *Store) ListScratchFiles(sessionID string) ([]ScratchFile, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, title, content, mode, created_at, updated_at
		FROM scratch_files
		WHERE session_id = ?
		ORDER BY updated_at DESC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []ScratchFile
	for rows.Next() {
		var f ScratchFile
		var createdAt, updatedAt string
		if err := rows.Scan(&f.ID, &f.SessionID, &f.Title, &f.Content, &f.Mode, &createdAt, &updatedAt); err != nil {
			continue
		}
		f.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.CreatedAt = time.Time{}
		}
		f.UpdatedAt, err = time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.UpdatedAt = time.Time{}
		}
		files = append(files, f)
	}
	return files, rows.Err()
}

// ListAllScratchFiles returns all scratch files across all sessions.
func (s *Store) ListAllScratchFiles() ([]ScratchFile, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, title, content, mode, created_at, updated_at
		FROM scratch_files
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []ScratchFile
	for rows.Next() {
		var f ScratchFile
		var createdAt, updatedAt string
		if err := rows.Scan(&f.ID, &f.SessionID, &f.Title, &f.Content, &f.Mode, &createdAt, &updatedAt); err != nil {
			continue
		}
		f.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.CreatedAt = time.Time{}
		}
		f.UpdatedAt, err = time.Parse(time.RFC3339, updatedAt)
		if err != nil {
			slog.Warn("failed to parse time", "error", err)
			f.UpdatedAt = time.Time{}
		}
		files = append(files, f)
	}
	return files, rows.Err()
}

// ScratchFile returns a single scratch file by ID.
func (s *Store) ScratchFile(id string) (*ScratchFile, error) {
	var f ScratchFile
	var createdAt, updatedAt string
	err := s.db.QueryRow(`
		SELECT id, session_id, title, content, mode, created_at, updated_at
		FROM scratch_files WHERE id = ?
	`, id).Scan(&f.ID, &f.SessionID, &f.Title, &f.Content, &f.Mode, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	f.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
	if err != nil {
		slog.Warn("failed to parse time", "error", err)
		f.CreatedAt = time.Time{}
	}
	f.UpdatedAt, err = time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		slog.Warn("failed to parse time", "error", err)
		f.UpdatedAt = time.Time{}
	}
	return &f, nil
}

// UpdateScratchFile updates a scratch file's title and content.
func (s *Store) UpdateScratchFile(id, title, content string) error {
	_, err := s.db.Exec(`
		UPDATE scratch_files SET title = ?, content = ?, updated_at = ?
		WHERE id = ?
	`, title, content, time.Now().Format(time.RFC3339), id)
	return err
}

// RenameScratchFile updates only a scratch file's title without touching content.
func (s *Store) RenameScratchFile(id, title string) error {
	_, err := s.db.Exec(`
		UPDATE scratch_files SET title = ?, updated_at = ?
		WHERE id = ?
	`, title, time.Now().Format(time.RFC3339), id)
	return err
}

// DeleteScratchFile removes a scratch file.
func (s *Store) DeleteScratchFile(id string) error {
	_, err := s.db.Exec(`DELETE FROM scratch_files WHERE id = ?`, id)
	return err
}

// --- Notification CRUD ---

// Notification represents a single in-app notification tied to a session.
type Notification struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	SourceID  string `json:"sourceId"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Preview   string `json:"preview"`
	Severity  string `json:"severity"`
	Payload   string `json:"payload,omitempty"` // JSON string
	CreatedAt int64  `json:"createdAt"`         // unix ms
	ReadAt    *int64 `json:"readAt,omitempty"`  // unix ms, nil = unread
}

// NotificationState tracks per-session notification bookkeeping: how many
// messages the classifier has already seen, when the user last interacted
// with the session, and when they first opened it (for scope filtering).
type NotificationState struct {
	SessionID            string
	LastSeenMessageCount int
	LastSeenAt           *int64 // unix ms
	FirstViewedAt        *int64 // unix ms
}

// InsertNotification inserts a notification row, deduplicating by
// (session_id, kind, dedup_key). It returns true if a new row was inserted.
func (s *Store) InsertNotification(n Notification, dedupKey string) (bool, error) {
	res, err := s.db.Exec(`
		INSERT INTO notifications (id, session_id, source_id, kind, dedup_key, title, preview, severity, payload, created_at, read_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT(session_id, kind, dedup_key) DO NOTHING
	`, n.ID, n.SessionID, n.SourceID, n.Kind, dedupKey, n.Title, n.Preview, n.Severity, n.Payload, n.CreatedAt)
	if err != nil {
		return false, err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

// ListNotifications returns notifications newest-first. If unreadOnly is true,
// only unread rows are returned. limit is clamped to [1, 200].
func (s *Store) ListNotifications(limit int, unreadOnly bool) ([]Notification, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	q := `SELECT id, session_id, source_id, kind, title, preview, severity, payload, created_at, read_at
		  FROM notifications`
	if unreadOnly {
		q += ` WHERE read_at IS NULL`
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	rows, err := s.db.Query(q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Notification
	for rows.Next() {
		var n Notification
		var payload sql.NullString
		var readAt sql.NullInt64
		if err := rows.Scan(&n.ID, &n.SessionID, &n.SourceID, &n.Kind, &n.Title, &n.Preview, &n.Severity, &payload, &n.CreatedAt, &readAt); err != nil {
			return nil, err
		}
		if payload.Valid {
			n.Payload = payload.String
		}
		if readAt.Valid {
			v := readAt.Int64
			n.ReadAt = &v
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkNotificationRead marks a single notification as read.
func (s *Store) MarkNotificationRead(id string) error {
	_, err := s.db.Exec(`UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL`, time.Now().UnixMilli(), id)
	return err
}

// MarkAllNotificationsRead marks all (or the given subset of) notifications as
// read. If ids is empty, all unread notifications are marked read.
func (s *Store) MarkAllNotificationsRead(ids []string) error {
	if len(ids) == 0 {
		_, err := s.db.Exec(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`, time.Now().UnixMilli())
		return err
	}
	// Build the query with the correct number of placeholders, then bind args.
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = strings.TrimSuffix(placeholders, ",")
	query := "UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND id IN (" + placeholders + ")" //nolint:gosec // placeholders are "?", not user input
	args := make([]any, 0, len(ids)+1)
	args = append(args, time.Now().UnixMilli())
	for _, id := range ids {
		args = append(args, id)
	}
	_, err := s.db.Exec(query, args...)
	return err
}

// ClearNotifications removes notifications older than the given time. If
// olderThan is the zero time, all notifications are removed.
func (s *Store) ClearNotifications(olderThan time.Time) error {
	if olderThan.IsZero() {
		_, err := s.db.Exec(`DELETE FROM notifications`)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM notifications WHERE created_at < ?`, olderThan.UnixMilli())
	return err
}

// PruneNotifications keeps only the newest `keep` notifications.
func (s *Store) PruneNotifications(keep int) error {
	_, err := s.db.Exec(`
		DELETE FROM notifications
		WHERE id NOT IN (
			SELECT id FROM notifications ORDER BY created_at DESC LIMIT ?
		)
	`, keep)
	return err
}

// NotificationState returns the per-session notification bookkeeping row, or a
// zero value if none exists yet.
func (s *Store) NotificationState(sessionID string) (NotificationState, error) {
	var st NotificationState
	var lastSeenAt, firstViewedAt sql.NullInt64
	err := s.db.QueryRow(`
		SELECT session_id, last_seen_message_count, last_seen_at, first_viewed_at
		FROM notification_state WHERE session_id = ?
	`, sessionID).Scan(&st.SessionID, &st.LastSeenMessageCount, &lastSeenAt, &firstViewedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return NotificationState{SessionID: sessionID}, nil
	}
	if err != nil {
		return st, err
	}
	if lastSeenAt.Valid {
		v := lastSeenAt.Int64
		st.LastSeenAt = &v
	}
	if firstViewedAt.Valid {
		v := firstViewedAt.Int64
		st.FirstViewedAt = &v
	}
	return st, nil
}

// SetNotificationState upserts the per-session notification state. It records
// the count of messages the classifier has seen and the timestamp of this
// update.
func (s *Store) SetNotificationState(sessionID string, lastSeenCount int, at time.Time) error {
	_, err := s.db.Exec(`
		INSERT INTO notification_state (session_id, last_seen_message_count, last_seen_at, first_viewed_at)
		VALUES (?, ?, ?, NULL)
		ON CONFLICT(session_id) DO UPDATE SET
			last_seen_message_count = excluded.last_seen_message_count,
			last_seen_at = excluded.last_seen_at
	`, sessionID, lastSeenCount, at.UnixMilli())
	return err
}

// MarkSessionViewed records that the user has opened a session (sets
// first_viewed_at the first time, used by the "opened" scope filter).
func (s *Store) MarkSessionViewed(sessionID string) error {
	_, err := s.db.Exec(`
		INSERT INTO notification_state (session_id, last_seen_message_count, last_seen_at, first_viewed_at)
		VALUES (?, 0, NULL, ?)
		ON CONFLICT(session_id) DO UPDATE SET first_viewed_at = COALESCE(first_viewed_at, excluded.first_viewed_at)
	`, sessionID, time.Now().UnixMilli())
	return err
}

// --- Search Index ---

// ClearSessionIndex removes all FTS entries for a session (before re-indexing).
func (s *Store) ClearSessionIndex(sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM search_index WHERE session_id = ?`, sessionID)
	return err
}

// ClearSessionChunkType removes FTS entries for a specific chunk type within a session.
func (s *Store) ClearSessionChunkType(sessionID, chunkType string) error {
	_, err := s.db.Exec(`DELETE FROM search_index WHERE session_id = ? AND chunk_type = ?`, sessionID, chunkType)
	return err
}

// IndexSession indexes a session's content for full-text search.
func (s *Store) IndexSession(sessionID, sourceID, chunkType, repository, content string) error {
	return s.IndexSessionAt(sessionID, sourceID, chunkType, repository, content, "", "", "", 0)
}

// IndexSessionAt indexes session content with an explicit last-updated timestamp.
func (s *Store) IndexSessionAt(sessionID, sourceID, chunkType, repository, content, updatedAt, fileTitle, fileID string, messageIndex int) error {
	_, err := s.db.Exec(`
		INSERT INTO search_index (content, session_id, source_id, chunk_type, repository, updated_at, file_title, file_id, message_index)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, content, sessionID, sourceID, chunkType, repository, updatedAt, fileTitle, fileID, messageIndex)
	return err
}

// UpdateIndexState records that a session has been indexed.
func (s *Store) UpdateIndexState(sessionID, sourceID, contentHash string) error {
	_, err := s.db.Exec(`
		INSERT INTO index_state (session_id, source_id, last_indexed_at, content_hash)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET last_indexed_at=excluded.last_indexed_at, content_hash=excluded.content_hash
	`, sessionID, sourceID, time.Now().Format(time.RFC3339), contentHash)
	return err
}

// IndexState returns the last indexed hash for a session.
func (s *Store) IndexState(sessionID string) (string, error) {
	var hash string
	err := s.db.QueryRow(`SELECT content_hash FROM index_state WHERE session_id = ?`, sessionID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return hash, err
}

// sanitizeFTS5Query wraps individual tokens in double quotes to prevent FTS5
// from interpreting hyphens, AND, OR, NOT, and other operators as syntax, and
// appends * to each term to enable prefix (partial-word) matching. For example,
// "instru" becomes `"instru"*`, which matches "instrument", "instruction", etc.
func sanitizeFTS5Query(q string) string {
	fields := strings.Fields(q)
	if len(fields) == 0 {
		return q
	}
	quoted := make([]string, len(fields))
	for i, f := range fields {
		quoted[i] = `"` + strings.NewReplacer(`"`, `""`).Replace(f) + `"*`
	}
	return strings.Join(quoted, " ")
}

// Search performs a full-text search across indexed session content.
func (s *Store) Search(query string, limit int, sessionID string) ([]SearchResult, error) {
	query = sanitizeFTS5Query(query)
	if limit <= 0 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if sessionID != "" {
		rows, err = s.db.Query(`
			SELECT session_id, source_id, chunk_type, repository, snippet(search_index, 0, '<mark>', '</mark>', '...', 64), COALESCE(updated_at, ''), COALESCE(file_title, ''), COALESCE(file_id, ''), COALESCE(message_index, 0)
			FROM search_index
			WHERE search_index MATCH ?
			  AND session_id = ?
			ORDER BY
				CASE chunk_type
					WHEN 'name' THEN 0
					WHEN 'plan' THEN 1
					WHEN 'message' THEN 2
					WHEN 'scratch' THEN 3
					ELSE 4
				END,
				rank
			LIMIT ?
		`, query, sessionID, limit)
	} else {
		rows, err = s.db.Query(`
			SELECT session_id, source_id, chunk_type, repository, snippet(search_index, 0, '<mark>', '</mark>', '...', 64), COALESCE(updated_at, ''), COALESCE(file_title, ''), COALESCE(file_id, ''), COALESCE(message_index, 0)
			FROM search_index
			WHERE search_index MATCH ?
			ORDER BY
				CASE chunk_type
					WHEN 'name' THEN 0
					WHEN 'plan' THEN 1
					WHEN 'message' THEN 2
					WHEN 'scratch' THEN 3
					ELSE 4
				END,
				rank
			LIMIT ?
		`, query, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.SessionID, &r.SourceID, &r.ChunkType, &r.Repository, &r.Snippet, &r.UpdatedAt, &r.FileTitle, &r.FileID, &r.MessageIndex); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// SearchResult represents a search hit.
type SearchResult struct {
	SessionID    string `json:"sessionId"`
	SessionName  string `json:"sessionName"`
	SourceID     string `json:"sourceId"`
	ChunkType    string `json:"chunkType"`
	Repository   string `json:"repository"`
	Snippet      string `json:"snippet"`
	UpdatedAt    string `json:"updatedAt"`
	FileTitle    string `json:"fileTitle,omitempty"`
	FileID       string `json:"fileId,omitempty"`
	MessageIndex int    `json:"messageIndex,omitempty"`
}

// Reset removes all user data from the store (sources, folders, search index,
// session names, scratch files, config, bookmarks). Agent data is unaffected.
func (s *Store) Reset() error {
	tables := []string{
		"bookmarks",
		"notifications",
		"notification_state",
		"scratch_files",
		"session_names",
		"index_state",
		"search_index",
		"folder_sessions",
		"folders",
		"sources",
		"config",
	}
	for _, t := range tables {
		if _, err := s.db.Exec(`DELETE FROM ` + t); err != nil { //nolint:gosec
			return fmt.Errorf("reset: delete %s: %w", t, err)
		}
	}
	return nil
}

// migrate is implemented in migrate.go.
