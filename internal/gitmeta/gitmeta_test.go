package gitmeta

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// gitCmd runs a git command in dir and fails the test on error. A fixed
// identity keeps history deterministic; commit dates are provided via
// GIT_COMMITTER_DATE in envOverride when reflog timing matters.
func gitCmd(t *testing.T, dir string, envOverride []string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t",
		"GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t",
		"GIT_COMMITTER_EMAIL=t@example.com",
	)
	cmd.Env = append(cmd.Env, envOverride...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v in %s: %v: %s", args, dir, err, out)
	}
	return string(out)
}

// formatEpoch renders epoch seconds as the date string git accepts.
func formatEpoch(epoch int64) string {
	return time.Unix(epoch, 0).Format(time.RFC3339)
}

// worktreeAdd creates a worktree with a controlled reflog timestamp (epoch
// seconds) for its checkout entry. An empty branch name checks out the
// repository's default branch instead of creating one.
func worktreeAdd(t *testing.T, commonDir, path string, epoch int64, branch string) {
	t.Helper()
	env := []string{"GIT_COMMITTER_DATE=" + formatEpoch(epoch)}
	args := []string{"worktree", "add", path}
	if branch != "" {
		args = append(args, "-b", branch)
	}
	gitCmd(t, commonDir, env, args...)
}

func eq(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %q, want %q", what, got, want)
	}
}

func boolEq(t *testing.T, what string, got, want bool) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

// bareWorkspace builds the workspace container layout from the design docs:
// ws/.bare (bare clone) with checkout roots ws/main, fix/fix-a, feat/feature-a,
// plus a nested package dir inside fix-a. Each worktree's checkout reflog
// entry carries a distinct epoch.
func bareWorkspace(t *testing.T) (ws string, base int64) {
	t.Helper()
	root := t.TempDir()
	ws = filepath.Join(root, "ws")
	seed := filepath.Join(root, "seed") // keep the seed clone out of the workspace
	if err := os.MkdirAll(seed, 0o755); err != nil {
		t.Fatal(err)
	}
	base = time.Now().Unix() - 1000
	gitCmd(t, seed, []string{"GIT_COMMITTER_DATE=" + formatEpoch(base)}, "init", "-q", "-b", "main")
	gitCmd(t, seed, []string{"GIT_COMMITTER_DATE=" + formatEpoch(base)}, "commit", "--allow-empty", "-m", "seed")
	gitCmd(t, seed, nil, "clone", "--bare", "--quiet", seed, filepath.Join(ws, ".bare"))

	bare := filepath.Join(ws, ".bare")
	worktreeAdd(t, bare, filepath.Join(ws, "main"), base, "")
	worktreeAdd(t, bare, filepath.Join(ws, "fix", "fix-a"), base+10, "fix/fix-a")
	worktreeAdd(t, bare, filepath.Join(ws, "feat", "feature-a"), base+20, "feat/feature-a")
	// A nested package dir inside fix-a (nonexistent-leaf resolution case).
	if err := os.MkdirAll(filepath.Join(ws, "fix", "fix-a", "packages", "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	return ws, base
}

func realdir(t *testing.T, path string) string {
	t.Helper()
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return real
}

func TestResolve_BareWorkspace(t *testing.T) {
	ws, _ := bareWorkspace(t)

	cases := []struct {
		name    string
		dir     string
		wtRoot  string // expected WorktreeRoot; "" = dir itself
		relPath string
		branch  string
	}{
		{"primary", filepath.Join(ws, "main"), "", "main", "main"},
		{"fix worktree", filepath.Join(ws, "fix", "fix-a"), "", "fix/fix-a", "fix/fix-a"},
		{
			// Nested subdirs resolve to the whole worktree.
			"nested subpackage", filepath.Join(ws, "fix", "fix-a", "packages", "web"),
			filepath.Join(ws, "fix", "fix-a"), "fix/fix-a", "fix/fix-a",
		},
		{"feature worktree", filepath.Join(ws, "feat", "feature-a"), "", "feat/feature-a", "feat/feature-a"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wsReal := realdir(t, ws)
			dir := realdir(t, tc.dir)
			resolved := NewResolver().Resolve(dir)
			if !resolved.Found {
				t.Fatalf("resolve(%s) failed: %+v", dir, resolved)
			}
			eq(t, "workspaceRoot", resolved.WorkspaceRoot, wsReal)
			wantWtRoot := dir
			if tc.wtRoot != "" {
				wantWtRoot = realdir(t, tc.wtRoot)
			}
			eq(t, "worktreeRoot", resolved.WorktreeRoot, wantWtRoot)
			eq(t, "relPath", resolved.RelPath, tc.relPath)
			eq(t, "branch", resolved.Branch, tc.branch)
			boolEq(t, "isWorktree", resolved.IsWorktree, true)
			boolEq(t, "external", resolved.External, false)
		})
	}
}

func TestResolve_FlatRepo(t *testing.T) {
	repo := realdir(t, t.TempDir())
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")

	// Session ran from a nested subdirectory of the repo.
	resolved := NewResolver().Resolve(filepath.Join(repo, "deep", "sub"))
	if !resolved.Found {
		t.Fatalf("resolve failed: %+v", resolved)
	}
	eq(t, "workspaceRoot", resolved.WorkspaceRoot, repo)
	eq(t, "worktreeRoot", resolved.WorktreeRoot, repo)
	eq(t, "relPath", resolved.RelPath, "")
	eq(t, "branch", resolved.Branch, "main")
	boolEq(t, "isWorktree", resolved.IsWorktree, false)

	ws := NewResolver().MapWorkspace(repo)
	if !ws.Found {
		t.Fatalf("map failed")
	}
	boolEq(t, "isBare", ws.IsBare, false)
	if len(ws.Worktrees) != 1 {
		t.Fatalf("worktree count = %d, want 1 (primary only): %+v", len(ws.Worktrees), ws.Worktrees)
	}
	eq(t, "primary root", ws.Worktrees[0].Root, repo)
}

func TestResolve_NestedWorktree(t *testing.T) {
	repo := realdir(t, t.TempDir())
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")

	// The in-repo `.worktrees/` pattern (this repo's own layout, e.g. via wt).
	wtPath := filepath.Join(repo, ".worktrees", "feat", "ui")
	gitCmd(t, repo, nil, "worktree", "add", wtPath, "-b", "feat/ui")

	resolved := NewResolver().Resolve(filepath.Join(wtPath, "src"))
	if !resolved.Found {
		t.Fatalf("resolve failed: %+v", resolved)
	}
	eq(t, "worktreeRoot", resolved.WorktreeRoot, wtPath)
	eq(t, "workspaceRoot", resolved.WorkspaceRoot, repo)
	eq(t, "relPath", resolved.RelPath, ".worktrees/feat/ui")
	eq(t, "branch", resolved.Branch, "feat/ui")
	boolEq(t, "isWorktree", resolved.IsWorktree, true)
}

func TestMapWorkspace_EnumeratesUnpopulatedWorktrees(t *testing.T) {
	ws, base := bareWorkspace(t)
	wsReal := realdir(t, ws)

	// Add a worktree that has never hosted a session: enumeration-only.
	wtPath := filepath.Join(ws, "pr-review", "pr-1234-a1b2c")
	worktreeAdd(t, filepath.Join(ws, ".bare"), wtPath, base+30, "pr/pr-1234")

	workspace := NewResolver().MapWorkspace(wsReal)
	if !workspace.Found {
		t.Fatalf("map failed")
	}
	boolEq(t, "isBare", workspace.IsBare, true)
	if len(workspace.Worktrees) != 4 {
		t.Fatalf("worktree count = %d, want 4: %+v", len(workspace.Worktrees), workspace.Worktrees)
	}
	rels := []string{}
	for _, wk := range workspace.Worktrees {
		rels = append(rels, wk.RelPath)
	}
	joined := strings.Join(rels, ",")
	for _, want := range []string{"main", "fix/fix-a", "feat/feature-a", "pr-review/pr-1234-a1b2c"} {
		if !strings.Contains(joined, want) {
			t.Errorf("relPaths %q missing %q", joined, want)
		}
	}
}

func TestResolve_NotARepo(t *testing.T) {
	dir := t.TempDir()
	resolved := NewResolver().Resolve(dir)
	boolEq(t, "found", resolved.Found, false)
	eq(t, "branch", resolved.Branch, "")
}

func TestResolve_RelativeGitdir(t *testing.T) {
	// Hand-build a worktree whose .git pointer uses a RELATIVE gitdir value,
	// as git does when a worktree was attached by relative path.
	ws := realdir(t, t.TempDir())
	seed := filepath.Join(filepath.Dir(ws), "rel-seed")
	if err := os.MkdirAll(seed, 0o755); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, seed, nil, "init", "-q", "-b", "main")
	gitCmd(t, seed, nil, "commit", "--allow-empty", "-m", "seed")
	gitCmd(t, seed, nil, "clone", "--bare", "--quiet", seed, filepath.Join(ws, ".bare"))

	relDir := filepath.Join(ws, "rel-checkout")
	if err := os.MkdirAll(relDir, 0o755); err != nil {
		t.Fatal(err)
	}
	pointerPath := filepath.Join(relDir, ".git")
	if err := os.WriteFile(pointerPath, []byte("gitdir: ../.bare/worktrees/rel-checkout\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitDir := filepath.Join(ws, ".bare", "worktrees", "rel-checkout")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/rel-branch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "commondir"), []byte("../..\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	resolved := NewResolver().Resolve(relDir)
	if !resolved.Found {
		t.Fatalf("relative gitdir failed to resolve: %+v", resolved)
	}
	eq(t, "workspaceRoot", resolved.WorkspaceRoot, ws)
	eq(t, "branch", resolved.Branch, "rel-branch")
	eq(t, "relPath", resolved.RelPath, "rel-checkout")
}

func TestBranchAt_SwitchMidSession(t *testing.T) {
	repo := t.TempDir()
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")
	// The adapter's cwd is a subdirectory of the repo.
	dir := filepath.Join(repo, "sub")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	sessionStart := time.Now().Unix() - 400
	// One checkout inside the session window, with a controlled timestamp.
	switchEpoch := sessionStart + 100
	env := []string{"GIT_COMMITTER_DATE=" + formatEpoch(switchEpoch)}
	gitCmd(t, repo, env, "checkout", "-b", "feat/x")

	r := NewResolver()
	use := r.BranchAt(dir, time.Unix(sessionStart, 0), time.Unix(switchEpoch+50, 0))
	eq(t, "source", use.Source, SourceReflog)
	eq(t, "start", use.Start, "main")
	eq(t, "end", use.End, "feat/x")

	// A window that begins after the switch sees no change.
	late := r.BranchAt(dir, time.Unix(switchEpoch+50, 0), time.Unix(switchEpoch+60, 0))
	eq(t, "late start", late.Start, "feat/x")
	eq(t, "late end", late.End, "feat/x")
}

func TestBranchAt_BranchCreatedWithoutCheckout(t *testing.T) {
	repo := t.TempDir()
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")

	sessionStart := time.Now().Unix() - 200
	// `git branch` without a checkout adds no reflog checkout entry: the
	// session stays on its original branch.
	gitCmd(t, repo, nil, "branch", "feat/never-checked-out")

	use := NewResolver().BranchAt(repo, time.Unix(sessionStart, 0), time.Now())
	// Reflog exists (commit entries) but holds no checkout lines: the HEAD
	// tier answers, and the session stays on its original branch.
	eq(t, "source", use.Source, SourceHead)
	eq(t, "end", use.End, use.Start)
}

func TestBranchAt_NoReflogFallsBackToHead(t *testing.T) {
	repo := t.TempDir()
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")
	if err := os.RemoveAll(filepath.Join(repo, ".git", "logs")); err != nil {
		t.Fatal(err)
	}

	use := NewResolver().BranchAt(repo, time.Unix(time.Now().Unix()-100, 0), time.Now())
	eq(t, "source", use.Source, SourceHead)
	eq(t, "start", use.Start, "main")
	eq(t, "end", use.End, "main")
}

func TestResolve_DeletedDirectory(t *testing.T) {
	ws := t.TempDir()
	missing := filepath.Join(ws, "gone")
	resolved := NewResolver().Resolve(missing)
	boolEq(t, "found", resolved.Found, false)

	// The session of a deleted worktree resolves from its nearest existing
	// ancestor when that ancestor is itself a git checkout.
	repo := realdir(t, t.TempDir())
	gitCmd(t, repo, nil, "init", "-q", "-b", "main")
	gitCmd(t, repo, nil, "commit", "--allow-empty", "-m", "base")
	resolvedRepo := NewResolver().Resolve(filepath.Join(repo, "gone", "deep"))
	boolEq(t, "found for deleted subdir of a repo", resolvedRepo.Found, true)
	eq(t, "worktreeRoot", resolvedRepo.WorktreeRoot, repo)
}
