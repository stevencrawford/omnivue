// Package gitmeta resolves a session's working directory to its position in
// the user's git layout — repo root, linked worktrees, workspace containers
// (e.g. a bare clone with checkouts beside it), and branch timelines — using
// only reads of git's own on-disk metadata. It never runs mutating git commands
// and never writes to agent data.
//
// The core insight is that every checkout describes itself: a working tree
// contains either a `.git` directory (its own repo) or a `.git` file
// ("gitdir: <path>") pointing at a shared git directory; a linked worktree's
// git dir in turn records its shared directory via a `commondir` file. Walking
// those references reconstructs the layout for flat repos, in-repo
// `.worktrees/`, workspace containers with a bare clone, and submodules, with
// a single code path.
package gitmeta

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// cacheTTL bounds cached resolutions. Git layout changes are rare, so a
	// short TTL is enough to bound the cost of repeated polls without
	// dedicated invalidation plumbing.
	cacheTTL = 30 * time.Second
)

// Source markers describing how a branch value was determined. Matching
// constants live in internal/ingest (ingest.BranchSource*), which is the type
// that reaches the API payload.
const (
	SourceReflog = "reflog" // replayed <gitdir>/logs/HEAD checkout timeline
	SourceHead   = "head"   // current HEAD of the resolved checkout (approximate)
)

// Info describes where a directory sits in the git layout.
type Info struct {
	// WorktreeRoot is the git root of the checkout the directory belongs to
	// (the worktree dir for linked worktrees, the repo root for flat repos).
	WorktreeRoot string
	// WorkspaceRoot is the container that owns the checkout: dirname of the
	// common dir. For a bare workspace (`ws/.bare`) it is `ws`; for a standard
	// repo it is the repo root. Submodule working trees form their own
	// workspace.
	WorkspaceRoot string
	// CommonDir is the shared git directory (`.bare`, or `<repo>/.git`).
	CommonDir string
	// GitDir is the per-checkout git directory (HEAD and logs/HEAD live here).
	GitDir string
	// RelPath is WorktreeRoot relative to WorkspaceRoot, "" when equal.
	RelPath string
	// Branch is the branch currently checked out in the checkout, from its
	// HEAD. Empty for detached HEADs.
	Branch string
	// IsWorktree reports that the session ran in a checkout different from
	// the workspace root (a linked worktree or an in-repo `.worktrees/`
	// checkout). Flat-root sessions are false.
	IsWorktree bool
	// IsSubmodule marks `.git/modules`-owned working trees; the UI can label
	// them `super › sub`.
	IsSubmodule bool
	// External marks a checkout whose worktree root escapes its workspace
	// root (e.g. a worktree of /repo created under /tmp).
	External bool
	// Found is false when the directory is not inside any git layout the
	// resolver understands; callers must degrade to their fallback grouping.
	Found bool
}

// Worktree is one checkout of a workspace.
type Worktree struct {
	Root    string
	RelPath string
	Branch  string
}

// Workspace is the full map of a workspace: every worktree on disk, including
// ones that have never hosted a session.
type Workspace struct {
	Root      string
	CommonDir string
	IsBare    bool
	Worktrees []Worktree
	Found     bool
}

// checkoutEntry is one `checkout: moving from A to B` reflog line.
type checkoutEntry struct {
	at   time.Time
	from string
	to   string
}

// Resolver computes and caches git-layout lookups. Safe for concurrent use.
type Resolver struct {
	mu    sync.Mutex
	cache map[string]cacheEntry
	logs  map[string]logsEntry
}

// cacheEntry keys resolve/map results by path prefix.
type cacheEntry struct {
	info      Info
	workspace Workspace
	expires   time.Time
}

type logsEntry struct {
	entries []checkoutEntry
	expires time.Time
}

// NewResolver returns a Resolver with empty caches.
func NewResolver() *Resolver {
	return &Resolver{
		cache: make(map[string]cacheEntry),
		logs:  make(map[string]logsEntry),
	}
}

// Resolve maps dir to its git layout. Unresolvable directories yield an Info
// with Found=false; callers fall back to their existing grouping.
func (r *Resolver) Resolve(dir string) Info {
	if dir == "" {
		return Info{}
	}
	now := time.Now()
	if e, ok := r.infoLookup(dir, now); ok {
		return e
	}
	info := resolve(dir)
	r.infoStore(dir, info, now)
	return info
}

// MapWorkspace enumerates every worktree of the workspace rooted at root,
// including worktrees that have never hosted a session. Unpopulated worktrees
// are what let a workspace be "detected" before sessions accumulate in it.
func (r *Resolver) MapWorkspace(root string) Workspace {
	if root == "" {
		return Workspace{}
	}
	now := time.Now()
	if ws, ok := r.mapLookup(root, now); ok {
		return ws
	}
	ws := mapWorkspace(root)
	r.mapStore(root, ws, now)
	return ws
}

func (r *Resolver) mapLookup(root string, now time.Time) (Workspace, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.cache[mapKey(root)]
	if !ok || now.After(e.expires) {
		return Workspace{}, false
	}
	return e.workspace, true
}

func (r *Resolver) mapStore(root string, ws Workspace, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cache[mapKey(root)] = cacheEntry{workspace: ws, expires: now.Add(cacheTTL)}
}

func (r *Resolver) infoLookup(dir string, now time.Time) (Info, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.cache[dir]
	if !ok || now.After(e.expires) {
		return Info{}, false
	}
	return e.info, true
}

func (r *Resolver) infoStore(dir string, info Info, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cache[dir] = cacheEntry{info: info, expires: now.Add(cacheTTL)}
}

func mapKey(root string) string {
	return "map:" + root
}

// resolve walks up from dir looking for a checkout root: a `.git` directory
// (own repo) or a `.git` pointer file (linked worktree or submodule). The
// session directory itself may have vanished (deleted worktree); resolution
// then starts from its nearest existing ancestor.
func resolve(dir string) Info {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return Info{}
	}
	cur := filepath.Clean(abs)
	for {
		if real, err := filepath.EvalSymlinks(cur); err == nil {
			cur = real
			break
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return Info{}
		}
		cur = parent
	}
	for {
		gitEntry := filepath.Join(cur, ".git")
		st, statErr := os.Lstat(gitEntry)
		if statErr == nil {
			if st.IsDir() {
				return finishStandard(cur, gitEntry)
			}
			return finishPointer(cur, gitEntry)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return Info{}
}

// finishStandard records a checkout whose `.git` is a directory: the checkout
// root is the repo root itself, and it is also the workspace root.
func finishStandard(worktreeRoot, gitDir string) Info {
	gitDir = evalDir(gitDir)
	return finish(Info{
		Found:         true,
		WorktreeRoot:  worktreeRoot,
		WorkspaceRoot: worktreeRoot,
		CommonDir:     gitDir,
		GitDir:        gitDir,
	})
}

// finishPointer records a checkout whose `.git` is a "gitdir: <path>" pointer
// file: a linked worktree, or a submodule working tree.
func finishPointer(ownerDir, gitFile string) Info {
	base, ok := parsePointer(gitFile)
	if !ok {
		return Info{}
	}
	gitDir := base.GitDir
	base.WorktreeRoot = ownerDir

	if isModuleGitDir(gitDir) {
		// A submodule working tree is its own workspace; the UI may render
		// it as `super › sub`. The module dir holds HEAD directly.
		base.IsSubmodule = true
		base.CommonDir = gitDir
		base.WorkspaceRoot = ownerDir
		return finish(base)
	}

	// Linked worktree: the private git dir records its shared dir.
	common := filepath.Dir(gitDir) // <commonDir>/worktrees/<id> → <commonDir>
	if data, err := os.ReadFile(filepath.Join(gitDir, "commondir")); err == nil {
		rel := strings.TrimSpace(strings.SplitN(string(data), "\n", 2)[0])
		if rel != "" {
			// Relative commondir values resolve against the git dir's own
			// directory (git's documented behavior for linked worktrees).
			candidate := filepath.Clean(filepath.Join(gitDir, rel))
			if dirExists(candidate) {
				common = candidate
			}
		}
	}
	base.CommonDir = evalDir(common)
	base.GitDir = gitDir
	base.WorkspaceRoot = filepath.Dir(base.CommonDir)
	return finish(base)
}

// finish computes the derived fields (rel path, external-ness, branch) once
// WorkspaceRoot/WorktreeRoot/CommonDir/GitDir are populated.
func finish(info Info) Info {
	switch {
	case info.WorktreeRoot == info.WorkspaceRoot:
		// Flat repo root (or a submodule treated as its own workspace).
	case strings.HasPrefix(info.WorktreeRoot, info.WorkspaceRoot+string(os.PathSeparator)):
		info.IsWorktree = true
		if rel, err := filepath.Rel(info.WorkspaceRoot, info.WorktreeRoot); err == nil {
			info.RelPath = filepath.ToSlash(rel)
		}
	default:
		info.External = true
		info.IsWorktree = true
	}
	info.Branch = readBranch(filepath.Join(info.GitDir, "HEAD"))
	return info
}

// mapWorkspace finds the workspace's shared git dir, then enumerates every
// linked worktree recorded under <commonDir>/worktrees/, plus the primary
// checkout for standard (non-bare) repos.
func mapWorkspace(root string) Workspace {
	abs, err := filepath.Abs(root)
	if err != nil {
		return Workspace{}
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return Workspace{}
	}
	common, found := findCommonDir(real)
	if !found {
		return Workspace{}
	}
	ws := Workspace{
		Root:      real,
		CommonDir: common,
		IsBare:    filepath.Base(common) != ".git",
		Found:     true,
	}

	if !ws.IsBare {
		ws.Worktrees = append(ws.Worktrees, Worktree{Root: real})
	}

	// <commonDir>/worktrees/*/gitdir names the worktree's .git pointer file;
	// its parent directory is the worktree root on disk.
	entries, err := os.ReadDir(filepath.Join(common, "worktrees"))
	if err == nil {
		for _, ent := range entries {
			if !ent.IsDir() {
				continue
			}
			gitdirFile := filepath.Join(common, "worktrees", ent.Name(), "gitdir")
			data, err := os.ReadFile(gitdirFile)
			if err != nil {
				continue
			}
			pointer := strings.TrimSpace(strings.SplitN(string(data), "\n", 2)[0])
			if pointer == "" {
				continue
			}
			if !filepath.IsAbs(pointer) {
				// Relative gitdir values resolve against the file's own dir.
				pointer = filepath.Join(filepath.Dir(gitdirFile), pointer)
			}
			wtRoot := evalDir(filepath.Dir(filepath.Clean(pointer)))
			wk := Worktree{Root: wtRoot}
			if rel, err := filepath.Rel(real, wtRoot); err == nil {
				wk.RelPath = filepath.ToSlash(rel)
			}
			wk.Branch = readBranch(filepath.Join(common, "worktrees", ent.Name(), "HEAD"))
			ws.Worktrees = append(ws.Worktrees, wk)
		}
	}
	return ws
}

// findCommonDir locates the git directory that roots the workspace: a `.git`
// directory for standard clones, or any git directory directly inside the
// workspace (the `<ws>/.bare` convention, among others).
func findCommonDir(root string) (string, bool) {
	candidates := []string{filepath.Join(root, ".git")}
	ents, err := os.ReadDir(root)
	if err == nil {
		for _, ent := range ents {
			if !ent.IsDir() || ent.Name() == ".git" {
				continue
			}
			candidates = append(candidates, filepath.Join(root, ent.Name()))
		}
	}
	for _, candidate := range candidates {
		if dirExists(candidate) && isGitDir(candidate) {
			return evalDir(candidate), true
		}
	}
	return "", false
}

// isGitDir reports whether dir is a git directory (bare, or a repo's `.git`):
// both kinds serve as common dirs for worktree enumeration.
func isGitDir(dir string) bool {
	if _, err := os.Stat(filepath.Join(dir, "HEAD")); err != nil {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, "objects"))
	return err == nil
}

// parsePointer reads a `gitdir: <path>` pointer file, returning the git dir.
func parsePointer(gitFile string) (Info, bool) {
	data, err := os.ReadFile(gitFile)
	if err != nil {
		return Info{}, false
	}
	line := strings.TrimSpace(strings.SplitN(string(data), "\n", 2)[0])
	value, ok := strings.CutPrefix(line, "gitdir:")
	if !ok {
		return Info{}, false
	}
	path := strings.TrimSpace(value)
	if path == "" {
		return Info{}, false
	}
	if !filepath.IsAbs(path) {
		// Relative pointers resolve against the pointer file's own dir.
		path = filepath.Join(filepath.Dir(gitFile), path)
	}
	return Info{GitDir: evalDir(filepath.Clean(path)), Found: true}, true
}

func isModuleGitDir(gitDir string) bool {
	return strings.Contains(gitDir,
		".git"+string(os.PathSeparator)+"modules"+string(os.PathSeparator))
}

// readBranch parses a HEAD file ("ref: refs/heads/<branch>"). Detached HEADs
// and unresolvable files yield "".
func readBranch(headPath string) string {
	data, err := os.ReadFile(headPath)
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(strings.SplitN(string(data), "\n", 2)[0])
	branch, ok := strings.CutPrefix(line, "ref: refs/heads/")
	if ok {
		return branch
	}
	return ""
}

// BranchUse is the branch state of a checkout across a session's time window.
type BranchUse struct {
	// Start is the branch in effect when the session began ("" = unknown).
	Start string
	// End is the branch in effect when the session last wrote ("" = unknown).
	End string
	// Source marks where the answer came from (gitmeta.SourceReflog or
	// gitmeta.SourceHead).
	Source string
}

// BranchAt reconstructs which branches a session moved through by replaying
// the checkout timeline in <gitDir>/logs/HEAD. Checkout lines only: a branch
// created without being checked out never moves the session. Sessions in a
// worktree dedicated to their branch need no history: the worktree's HEAD
// already *is* the branch.
func (r *Resolver) BranchAt(dir string, start, end time.Time) BranchUse {
	info := r.Resolve(dir)
	if !info.Found {
		return BranchUse{}
	}
	entries := r.checkouts(info)
	if len(entries) == 0 {
		return BranchUse{Start: info.Branch, End: info.Branch, Source: SourceHead}
	}
	// branchAtTime: entries at/before the queried time win; before any
	// recorded checkout the branch is the first entry's origin; past the
	// log's coverage the answer is the current HEAD.
	out := BranchUse{Source: SourceReflog}
	if start.IsZero() {
		out.Start = entries[0].from
	} else {
		out.Start = branchAtTime(entries, start, entries[0].from, info.Branch)
	}
	if end.IsZero() {
		out.End = info.Branch
	} else {
		out.End = branchAtTime(entries, end, entries[0].from, info.Branch)
	}
	return out
}

// branchAtTime returns the branch in effect at t. When no entry precedes t the
// fallback answers the branch that existed just before the first recorded
// checkout (the first entry's origin), or finally deflt.
func branchAtTime(entries []checkoutEntry, t time.Time, beforeFirst, deflt string) string {
	if t.IsZero() {
		return ""
	}
	last := ""
	found := false
	for _, e := range entries {
		if !e.at.After(t) {
			last = e.to
			found = true
		}
	}
	if found {
		return last
	}
	if beforeFirst != "" {
		return beforeFirst
	}
	return deflt
}

// checkouts parses (and caches, keyed by mtime) the checkout timeline of the
// resolved dir.
func (r *Resolver) checkouts(info Info) []checkoutEntry {
	if info.GitDir == "" {
		return nil
	}
	logsPath := filepath.Join(info.GitDir, "logs", "HEAD")
	fi, err := os.Stat(logsPath)
	if err != nil {
		return nil
	}
	expires := fi.ModTime().Add(cacheTTL)
	now := time.Now()

	r.mu.Lock()
	e, cached := r.logs[logsPath]
	if cached && now.Before(e.expires) {
		entries := e.entries
		r.mu.Unlock()
		return entries
	}
	r.mu.Unlock()

	entries := parseReflog(logsPath)
	r.mu.Lock()
	r.logs[logsPath] = logsEntry{entries: entries, expires: expires}
	r.mu.Unlock()
	return entries
}

// parseReflog reads <gitDir>/logs/HEAD, keeping only `checkout:` lines.
// Lines have the shape:
//
//	<old-sha> <new-sha> <name> <email> <epoch> <tz>\tcheckout: moving from A to B
func parseReflog(path string) []checkoutEntry {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var entries []checkoutEntry
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		metadata, message, hasMessage := strings.Cut(line, "\t")
		if !hasMessage {
			continue
		}
		fields := strings.Fields(metadata)
		if len(fields) < 2 {
			continue
		}
		epoch, err := strconv.ParseInt(fields[len(fields)-2], 10, 64)
		if err != nil {
			continue
		}
		from, to, ok := parseCheckoutMessage(message)
		if !ok {
			continue
		}
		entries = append(entries, checkoutEntry{at: time.Unix(epoch, 0), from: from, to: to})
	}
	return entries
}

// parseCheckoutMessage reads "checkout: moving from A to B" messages and
// returns both branches. Detached-head moves (a raw sha as target) are
// skipped — they do not identify a branch.
func parseCheckoutMessage(message string) (from, to string, ok bool) {
	rest, isCheckout := strings.CutPrefix(message, "checkout: moving from ")
	if !isCheckout {
		return "", "", false
	}
	from, to, found := strings.Cut(rest, " to ")
	if !found || from == "" || to == "" {
		return "", "", false
	}
	if isLikelySHA(to) {
		return "", "", false
	}
	return from, to, true
}

func isLikelySHA(s string) bool {
	if len(s) != 40 {
		return false
	}
	for _, c := range s {
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// evalDir resolves symlinks best-effort, keeping the input on failure.
func evalDir(dir string) string {
	if real, err := filepath.EvalSymlinks(dir); err == nil {
		return real
	}
	return dir
}

func dirExists(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}
