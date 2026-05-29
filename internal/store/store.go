package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/stevencrawford/sess/internal/ingest"
	"github.com/stevencrawford/sess/internal/xdg"

	_ "modernc.org/sqlite"
)

// Store manages the sess application database (sources, folders, search index).
type Store struct {
	db   *sql.DB
	path string
}

// New creates or opens the sess database at $XDG_STATE_HOME/sess/sess.db.
func New() (*Store, error) {
	stateHome, err := xdg.StateHome()
	if err != nil {
		return nil, fmt.Errorf("resolving state home: %w", err)
	}
	stateDir := filepath.Join(stateHome, "sess")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating state directory: %w", err)
	}

	dbPath := filepath.Join(stateDir, "sess.db")
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_journal_mode=wal&_busy_timeout=5000", dbPath))
	if err != nil {
		return nil, fmt.Errorf("opening sess.db: %w", err)
	}

	s := &Store{db: db, path: dbPath}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrating sess.db: %w", err)
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
		)
		if err := rows.Scan(&src.ID, &src.Path, &agentType, &src.Label, &src.Enabled, &createdAt); err != nil {
			return nil, err
		}
		src.AgentType = ingest.AgentType(agentType)
		src.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		sources = append(sources, src)
	}
	return sources, rows.Err()
}

// RemoveSource removes a source by ID.
func (s *Store) RemoveSource(id string) error {
	_, err := s.db.Exec(`DELETE FROM sources WHERE id = ?`, id)
	return err
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
		f.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		f.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)
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

// GetFolderSessions returns session IDs assigned to a folder.
func (s *Store) GetFolderSessions(folderID string) ([]string, error) {
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

// GetSessionFolders returns folder IDs that a session belongs to.
func (s *Store) GetSessionFolders(sessionID string) ([]string, error) {
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

// --- Search Index ---

// ClearSessionIndex removes all FTS entries for a session (before re-indexing).
func (s *Store) ClearSessionIndex(sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM search_index WHERE session_id = ?`, sessionID)
	return err
}

// IndexSession indexes a session's content for full-text search.
func (s *Store) IndexSession(sessionID, sourceID, chunkType, repository, content string) error {
	_, err := s.db.Exec(`
		INSERT INTO search_index (content, session_id, source_id, chunk_type, repository)
		VALUES (?, ?, ?, ?, ?)
	`, content, sessionID, sourceID, chunkType, repository)
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

// GetIndexState returns the last indexed hash for a session.
func (s *Store) GetIndexState(sessionID string) (string, error) {
	var hash string
	err := s.db.QueryRow(`SELECT content_hash FROM index_state WHERE session_id = ?`, sessionID).Scan(&hash)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return hash, err
}

// Search performs a full-text search across indexed session content.
func (s *Store) Search(query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT session_id, source_id, chunk_type, repository, snippet(search_index, 0, '<mark>', '</mark>', '...', 64)
		FROM search_index
		WHERE search_index MATCH ?
		ORDER BY rank
		LIMIT ?
	`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.SessionID, &r.SourceID, &r.ChunkType, &r.Repository, &r.Snippet); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// SearchResult represents a search hit.
type SearchResult struct {
	SessionID  string `json:"sessionId"`
	SourceID   string `json:"sourceId"`
	ChunkType  string `json:"chunkType"`
	Repository string `json:"repository"`
	Snippet    string `json:"snippet"`
}

// migrate runs database migrations.
func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS sources (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			agent_type TEXT NOT NULL,
			label TEXT,
			enabled INTEGER DEFAULT 1,
			last_scanned_at TEXT,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS folders (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			parent_id TEXT REFERENCES folders(id),
			sort_order INTEGER DEFAULT 0,
			color TEXT,
			icon TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS folder_sessions (
			folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
			session_id TEXT NOT NULL,
			sort_order INTEGER DEFAULT 0,
			added_at TEXT NOT NULL,
			PRIMARY KEY (folder_id, session_id)
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
			content,
			session_id UNINDEXED,
			source_id UNINDEXED,
			chunk_type UNINDEXED,
			repository UNINDEXED
		);

		CREATE TABLE IF NOT EXISTS index_state (
			session_id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL,
			last_indexed_at TEXT NOT NULL,
			content_hash TEXT
		);
	`)
	return err
}
