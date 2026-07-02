package ingest

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// SessionEntry holds a cached session with its file path and modification time.
type SessionEntry struct {
	Session  Session
	FilePath string
	ModTime  int64 // unix millis
}

// SessionCache provides per-file caching for JSONL-based session data.
// It tracks modification times so that only changed files are re-parsed.
type SessionCache struct {
	mu       sync.RWMutex
	entries  map[string]SessionEntry // sessionID -> entry
	lastMod  int64                   // global max mod time across all files
	basePath string
	ext      string // file extension to scan (e.g., ".jsonl")
}

// NewSessionCache creates a new cache that scans basePath for session files.
func NewSessionCache(basePath, ext string) *SessionCache {
	return &SessionCache{
		entries:  make(map[string]SessionEntry),
		basePath: basePath,
		ext:      ext,
	}
}

// List returns all cached sessions sorted by UpdatedAt descending.
// Returns nil if the cache is empty so the caller knows to populate.
func (c *SessionCache) List() []Session {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.entries) == 0 {
		return nil
	}
	sessions := make([]Session, 0, len(c.entries))
	for _, e := range c.entries {
		sessions = append(sessions, e.Session)
	}
	slices.SortFunc(sessions, func(a, b Session) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})
	return sessions
}

// Lookup returns a single session by ID from the cache.
func (c *SessionCache) Lookup(id string) (Session, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[id]
	if !ok {
		return Session{}, false
	}
	return e.Session, true
}

// Put stores a single session entry in the cache.
func (c *SessionCache) Put(id string, session Session, filePath string, modTime int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[id] = SessionEntry{Session: session, FilePath: filePath, ModTime: modTime}
	if modTime > c.lastMod {
		c.lastMod = modTime
	}
}

// ReplaceAll replaces the entire cache contents.
func (c *SessionCache) ReplaceAll(entries map[string]SessionEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = entries
	var maxMod int64
	for _, e := range entries {
		if e.ModTime > maxMod {
			maxMod = e.ModTime
		}
	}
	c.lastMod = maxMod
}

// FilePath returns the file path for a cached session.
func (c *SessionCache) FilePath(id string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.entries[id].FilePath
}

// LastModified returns the latest modification timestamp across all cached files (unix ms).
func (c *SessionCache) LastModified() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastMod
}

// ScanAndRebuild walks the basePath, collects mtimes for all matching files,
// and rebuilds the cache for files whose mtime has changed.
// parseFn is called for each file that needs (re-)parsing.
// Returns the global max modification time.
func (c *SessionCache) ScanAndRebuild(parseFn func(path string) (*Session, int64, error)) (int64, error) {
	var maxMod int64

	type fileInfo struct {
		path    string
		modTime int64
	}
	var files []fileInfo

	err := filepath.WalkDir(c.basePath, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), c.ext) {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		mod := fi.ModTime().UnixMilli()
		files = append(files, fileInfo{path: p, modTime: mod})
		if mod > maxMod {
			maxMod = mod
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if maxMod == 0 {
		maxMod = time.Now().UnixMilli()
	}

	c.mu.RLock()
	oldLastMod := c.lastMod
	c.mu.RUnlock()

	if maxMod <= oldLastMod {
		return maxMod, nil
	}

	c.mu.RLock()
	oldEntries := c.entries
	c.mu.RUnlock()

	newEntries := make(map[string]SessionEntry, len(files))
	for _, fi := range files {
		id := sessionIDFromPath(fi.path)
		oldEntry, exists := oldEntries[id]
		if exists && fi.modTime <= oldEntry.ModTime {
			newEntries[id] = oldEntry
			continue
		}
		session, modTime, err := parseFn(fi.path)
		if err != nil || session == nil {
			continue
		}
		newEntries[id] = SessionEntry{
			Session:  *session,
			FilePath: fi.path,
			ModTime:  modTime,
		}
	}

	c.ReplaceAll(newEntries)
	return maxMod, nil
}

// sessionIDFromPath extracts a session ID from a JSONL file path.
func sessionIDFromPath(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}
