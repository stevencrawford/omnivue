package gitmeta

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Omnivue Test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Omnivue Test",
		"GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func realPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func initRepo(t *testing.T, root string) {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, root, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("hello\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "README.md")
	git(t, root, "commit", "-m", "init")
}

func TestResolveFlatRepo(t *testing.T) {
	requireGit(t)
	root := filepath.Join(t.TempDir(), "repo")
	initRepo(t, root)
	sub := filepath.Join(root, "packages", "app")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	wantRoot := realPath(t, root)
	info := NewResolver().Resolve(sub)
	if !info.Found {
		t.Fatal("expected repository to be found")
	}
	if info.WorkspaceRoot != wantRoot {
		t.Fatalf("workspace root = %q, want %q", info.WorkspaceRoot, wantRoot)
	}
	if info.WorktreeRoot != wantRoot {
		t.Fatalf("worktree root = %q, want %q", info.WorktreeRoot, wantRoot)
	}
	if info.WorktreeRelPath != "" {
		t.Fatalf("rel path = %q, want empty", info.WorktreeRelPath)
	}
	if info.WorkspaceKind != KindStandard {
		t.Fatalf("kind = %q, want standard", info.WorkspaceKind)
	}
	if info.Branch != "main" {
		t.Fatalf("branch = %q, want main", info.Branch)
	}
}

func TestResolveNoRepo(t *testing.T) {
	dir := t.TempDir()
	info := NewResolver().Resolve(dir)
	if info.Found {
		t.Fatalf("expected no repository, got %+v", info)
	}
}

func TestResolveInRepoWorktree(t *testing.T) {
	requireGit(t)
	repo := filepath.Join(t.TempDir(), "repo")
	initRepo(t, repo)
	worktree := filepath.Join(repo, ".worktrees", "feat", "x")
	git(t, repo, "worktree", "add", worktree, "-b", "feat/x")

	wantRepo := realPath(t, repo)
	wantWorktree := realPath(t, worktree)
	info := NewResolver().Resolve(worktree)
	if !info.Found || !info.IsWorktree {
		t.Fatalf("expected worktree, got %+v", info)
	}
	if info.WorkspaceRoot != wantRepo {
		t.Fatalf("workspace root = %q, want %q", info.WorkspaceRoot, wantRepo)
	}
	if info.WorktreeRoot != wantWorktree {
		t.Fatalf("worktree root = %q, want %q", info.WorktreeRoot, wantWorktree)
	}
	if info.WorktreeRelPath != "feat/x" {
		t.Fatalf("rel path = %q, want feat/x", info.WorktreeRelPath)
	}
	if info.External {
		t.Fatal("in-repo worktree must not be external")
	}
	if info.Branch != "feat/x" {
		t.Fatalf("branch = %q, want feat/x", info.Branch)
	}
}

func TestResolveRelativeGitdir(t *testing.T) {
	requireGit(t)
	repo := filepath.Join(t.TempDir(), "repo")
	initRepo(t, repo)
	worktree := filepath.Join(repo, ".worktrees", "rel")
	git(t, repo, "worktree", "add", worktree, "-b", "rel")
	pointer := filepath.Join(worktree, ".git")
	if err := os.WriteFile(pointer, []byte("gitdir: ../../.git/worktrees/rel\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	wantRepo := realPath(t, repo)
	info := NewResolver().Resolve(worktree)
	if !info.Found {
		t.Fatal("expected relative gitdir to resolve")
	}
	if info.WorkspaceRoot != wantRepo || info.WorktreeRelPath != "rel" {
		t.Fatalf("unexpected placement: %+v", info)
	}
}

func TestResolveBareWorkspace(t *testing.T) {
	requireGit(t)
	base := t.TempDir()
	seed := filepath.Join(base, "seed")
	initRepo(t, seed)
	workspace := filepath.Join(base, "workspace-1")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	bare := filepath.Join(workspace, ".bare")
	git(t, base, "clone", "--bare", seed, bare)
	mainRoot := filepath.Join(workspace, "main")
	fixRoot := filepath.Join(workspace, "fix", "fix-a")
	git(t, base, "--git-dir", bare, "worktree", "add", mainRoot, "main")
	git(t, base, "--git-dir", bare, "worktree", "add", fixRoot, "-b", "fix/fix-a")

	wantWorkspace := realPath(t, workspace)
	resolver := NewResolver()
	info := resolver.Resolve(fixRoot)
	if !info.Found || info.WorkspaceKind != KindBare {
		t.Fatalf("expected bare workspace, got %+v", info)
	}
	if info.WorkspaceRoot != wantWorkspace {
		t.Fatalf("workspace root = %q, want %q", info.WorkspaceRoot, wantWorkspace)
	}
	if info.WorktreeRelPath != "fix/fix-a" {
		t.Fatalf("rel path = %q, want fix/fix-a", info.WorktreeRelPath)
	}
	if info.Branch != "fix/fix-a" {
		t.Fatalf("branch = %q, want fix/fix-a", info.Branch)
	}

	workspaceInfo := resolver.Workspace(info)
	if len(workspaceInfo.Worktrees) != 2 {
		t.Fatalf("worktrees = %d, want 2: %+v", len(workspaceInfo.Worktrees), workspaceInfo.Worktrees)
	}
}

func TestWorkspaceEnumeratesAllWorktrees(t *testing.T) {
	requireGit(t)
	repo := filepath.Join(t.TempDir(), "repo")
	initRepo(t, repo)
	git(t, repo, "worktree", "add", filepath.Join(repo, ".worktrees", "feat", "a"), "-b", "feat/a")
	git(t, repo, "worktree", "add", filepath.Join(repo, ".worktrees", "fix", "b"), "-b", "fix/b")

	resolver := NewResolver()
	info := resolver.Resolve(repo)
	workspace := resolver.Workspace(info)
	if len(workspace.Worktrees) != 3 {
		t.Fatalf("worktrees = %d, want 3 (main + 2): %+v", len(workspace.Worktrees), workspace.Worktrees)
	}
	var found bool
	for _, wt := range workspace.Worktrees {
		if wt.RelPath == "feat/a" && wt.Branch == "feat/a" {
			found = true
		}
	}
	if !found {
		t.Fatalf("feat/a worktree missing: %+v", workspace.Worktrees)
	}
}

func TestResolveExternalWorktree(t *testing.T) {
	requireGit(t)
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	initRepo(t, repo)
	external := filepath.Join(base, "elsewhere", "x")
	git(t, repo, "worktree", "add", external, "-b", "feat/external")

	wantRepo := realPath(t, repo)
	info := NewResolver().Resolve(external)
	if !info.Found || !info.External {
		t.Fatalf("expected external worktree, got %+v", info)
	}
	if info.WorkspaceRoot != wantRepo {
		t.Fatalf("workspace root = %q, want %q", info.WorkspaceRoot, wantRepo)
	}
}

func TestResolveDetachedWorktree(t *testing.T) {
	requireGit(t)
	repo := filepath.Join(t.TempDir(), "repo")
	initRepo(t, repo)
	worktree := filepath.Join(repo, ".worktrees", "pr-1234")
	git(t, repo, "worktree", "add", "--detach", worktree, "HEAD")

	info := NewResolver().Resolve(worktree)
	if !info.Found {
		t.Fatal("expected detached worktree to resolve")
	}
	if info.Branch != "" || info.Head == "" {
		t.Fatalf("expected detached head, got branch=%q head=%q", info.Branch, info.Head)
	}
	workspace := NewResolver().Workspace(info)
	var detached bool
	for _, wt := range workspace.Worktrees {
		if wt.RelPath == "pr-1234" {
			detached = wt.Detached
		}
	}
	if !detached {
		t.Fatalf("expected detached worktree in registry: %+v", workspace.Worktrees)
	}
}

func TestRemoteURL(t *testing.T) {
	requireGit(t)
	repo := filepath.Join(t.TempDir(), "repo")
	initRepo(t, repo)
	git(t, repo, "remote", "add", "origin", "git@github.com:acme/thing.git")

	info := NewResolver().Resolve(repo)
	if info.RemoteURL != "git@github.com:acme/thing.git" {
		t.Fatalf("remote = %q", info.RemoteURL)
	}
}

func TestBranchAtEvidenceTiers(t *testing.T) {
	resolver := NewResolver()
	info := Info{Found: true, Branch: "head-branch"}
	end := time.Unix(2000, 0)

	branch, confidence := resolver.BranchAt(info, "snapshot", time.Unix(1000, 0), end, []BranchSample{
		{Time: time.Unix(1200, 0), Branch: "main"},
		{Time: time.Unix(1800, 0), Branch: "feat/x"},
	})
	if branch != "feat/x" || confidence != ConfidenceRecorded {
		t.Fatalf("sample: got %q/%q", branch, confidence)
	}

	branch, confidence = resolver.BranchAt(info, "snapshot", time.Unix(1000, 0), end, nil)
	if branch != "snapshot" || confidence != ConfidenceSnapshot {
		t.Fatalf("snapshot: got %q/%q", branch, confidence)
	}

	branch, confidence = resolver.BranchAt(info, "", time.Unix(1000, 0), end, nil)
	if branch != "head-branch" || confidence != ConfidenceCurrent {
		t.Fatalf("head: got %q/%q", branch, confidence)
	}
}

func TestParseCheckoutMessage(t *testing.T) {
	from, to, ok := parseCheckoutMessage("checkout: moving from main to feat/x")
	if !ok || from != "main" || to != "feat/x" {
		t.Fatalf("got %q -> %q ok=%v", from, to, ok)
	}
	if _, _, ok := parseCheckoutMessage("commit: something"); ok {
		t.Fatal("commit must not parse as checkout")
	}
}

func TestReflogTimelineBranchAt(t *testing.T) {
	timeline := reflogTimeline{events: []checkoutEvent{
		{at: time.Unix(100, 0), from: "main", to: "feat/a"},
		{at: time.Unix(200, 0), from: "feat/a", to: "main"},
		{at: time.Unix(300, 0), from: "main", to: "fix/b"},
	}}

	cases := []struct {
		at   int64
		want string
	}{
		{at: 50, want: "main"},
		{at: 150, want: "feat/a"},
		{at: 250, want: "main"},
		{at: 350, want: "fix/b"},
	}
	for _, tc := range cases {
		got, ok := timeline.branchAt(time.Unix(tc.at, 0))
		if !ok || got != tc.want {
			t.Fatalf("branchAt(%d) = %q ok=%v, want %q", tc.at, got, ok, tc.want)
		}
	}
}
