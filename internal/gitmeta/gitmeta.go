// Package gitmeta reconstructs a session's workspace and worktree placement
// from read-only filesystem metadata. It never writes to a repository and never
// shells out to git: resolution is a handful of small file reads (.git pointer,
// commondir, HEAD, worktrees registry, reflog).
package gitmeta

import (
	"path/filepath"
	"sync"
	"time"
)

// Kind distinguishes a standard repository from a bare workspace container
// that holds its worktrees as sibling directories.
type Kind string

const (
	// KindStandard is a normal repository whose main worktree contains .git.
	KindStandard Kind = "standard"
	// KindBare is a bare or container repository (for example workspace/.bare)
	// whose worktrees live elsewhere.
	KindBare Kind = "bare"
)

// Confidence records how a session's branch was determined.
type Confidence string

const (
	// ConfidenceRecorded means the branch was observed inside the session
	// transcript or in the worktree reflog during the session window.
	ConfidenceRecorded Confidence = "recorded"
	// ConfidenceSnapshot means the branch came from an agent-maintained column
	// captured when the session was opened.
	ConfidenceSnapshot Confidence = "snapshot"
	// ConfidenceCurrent means no session-scoped evidence existed and the
	// worktree's current HEAD was used.
	ConfidenceCurrent Confidence = "current"
)

// Info is the resolved placement of a directory inside its git layout.
type Info struct {
	Found           bool
	WorkspaceRoot   string
	WorkspaceName   string
	WorkspaceKind   Kind
	WorktreeRoot    string
	WorktreeRelPath string
	GitDir          string
	GitCommonDir    string
	Branch          string
	Head            string
	RemoteURL       string
	IsWorktree      bool
	External        bool
	Submodule       bool
}

// BranchSample is one observed branch value with the time it was observed.
type BranchSample struct {
	Time   time.Time
	Branch string
	CWD    string
}

// Workspace is the derived map of a workspace and every registered worktree.
type Workspace struct {
	Root      string
	Name      string
	Kind      Kind
	CommonDir string
	RemoteURL string
	Worktrees []Worktree
}

// Worktree is one checkout registered against a workspace.
type Worktree struct {
	Root       string
	RelPath    string
	Branch     string
	Head       string
	Detached   bool
	External   bool
	Registered bool
}

type dirCacheEntry struct {
	info    Info
	expires time.Time
}

type reflogCacheEntry struct {
	timeline reflogTimeline
	size     int64
	mod      time.Time
}

type workspaceCacheEntry struct {
	workspace Workspace
	expires   time.Time
}

const (
	defaultTTL        = 30 * time.Second
	defaultMaxEntries = 512
)

// Resolver resolves directories to git metadata with a small in-memory cache.
// It is safe for concurrent use.
type Resolver struct {
	mu         sync.Mutex
	dirs       map[string]dirCacheEntry
	reflogs    map[string]reflogCacheEntry
	workspaces map[string]workspaceCacheEntry
	maxEntries int
	ttl        time.Duration

	now func() time.Time
}

// NewResolver returns a resolver with the default cache size and TTL.
func NewResolver() *Resolver {
	return &Resolver{
		dirs:       make(map[string]dirCacheEntry),
		reflogs:    make(map[string]reflogCacheEntry),
		workspaces: make(map[string]workspaceCacheEntry),
		maxEntries: defaultMaxEntries,
		ttl:        defaultTTL,
		now:        time.Now,
	}
}

// Resolve returns the git placement for dir. Unknown or unreadable directories
// return a zero Info with Found=false; callers fall back to repository naming.
func (r *Resolver) Resolve(dir string) Info {
	if dir == "" {
		return Info{}
	}
	clean, err := filepath.EvalSymlinks(dir)
	if err != nil {
		clean = filepath.Clean(dir)
	}

	r.mu.Lock()
	if entry, ok := r.dirs[clean]; ok && r.now().Before(entry.expires) {
		r.mu.Unlock()
		return entry.info
	}
	r.mu.Unlock()

	info := resolve(clean)

	r.mu.Lock()
	if len(r.dirs) >= r.maxEntries {
		for key := range r.dirs {
			delete(r.dirs, key)
			break
		}
	}
	r.dirs[clean] = dirCacheEntry{info: info, expires: r.now().Add(r.ttl)}
	r.mu.Unlock()
	return info
}

// BranchAt picks the branch a session ended on, preferring evidence recorded
// inside the session over agent snapshots and the live worktree HEAD.
func (r *Resolver) BranchAt(info Info, snapshot string, end time.Time, samples []BranchSample) (string, Confidence) {
	if branch := latestSample(samples, end); branch != "" {
		return branch, ConfidenceRecorded
	}
	if branch, ok := r.branchFromReflog(info, end); ok {
		return branch, ConfidenceRecorded
	}
	if snapshot != "" {
		return snapshot, ConfidenceSnapshot
	}
	if info.Branch != "" {
		return info.Branch, ConfidenceCurrent
	}
	return "", ""
}

// latestSample returns the last non-empty sample observed at or before end.
// If every sample is after end (clock skew), the temporally closest sample to
// end is used.
func latestSample(samples []BranchSample, end time.Time) string {
	best := ""
	var bestTime time.Time
	for _, sample := range samples {
		if sample.Branch == "" || sample.Time.After(end) {
			continue
		}
		if best == "" || !sample.Time.Before(bestTime) {
			best = sample.Branch
			bestTime = sample.Time
		}
	}
	if best != "" {
		return best
	}
	for _, sample := range samples {
		if sample.Branch == "" {
			continue
		}
		if best == "" || sample.Time.Before(bestTime) {
			best = sample.Branch
			bestTime = sample.Time
		}
	}
	return best
}
