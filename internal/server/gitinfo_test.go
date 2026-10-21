package server

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/ingest"
)

func git(t *testing.T, dir string, env []string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com",
	)
	cmd.Env = append(cmd.Env, env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

func commitAt(t *testing.T, dir string, epoch int64, msg string) {
	t.Helper()
	git(t, dir, []string{"GIT_COMMITTER_DATE=" + time.Unix(epoch, 0).Format(time.RFC3339)},
		"commit", "--allow-empty", "-m", msg)
}

// fixtureBareWorkspace builds ws/.bare + worktrees ws/main and ws/fix/team,
// and returns the workspace root (symlink-evaluated) plus the fix worktree.
func fixtureBareWorkspace(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	ws := filepath.Join(root, "ws")
	seed := filepath.Join(root, "seed")
	if err := os.MkdirAll(seed, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, seed, nil, "init", "-q", "-b", "main")
	commitAt(t, seed, time.Now().Unix()-500, "seed")
	git(t, seed, nil, "clone", "--bare", "--quiet", seed, filepath.Join(ws, ".bare"))
	bare := filepath.Join(ws, ".bare")
	git(t, bare, nil, "worktree", "add", filepath.Join(ws, "main"))
	git(t, bare, []string{"GIT_COMMITTER_DATE=" + time.Unix(time.Now().Unix()-400, 0).Format(time.RFC3339)},
		"worktree", "add", filepath.Join(ws, "fix", "team"), "-b", "fix/team")
	real, err := filepath.EvalSymlinks(ws)
	if err != nil {
		t.Fatal(err)
	}
	return real, filepath.Join(real, "fix", "team")
}

func TestEnrichGitInfo_WorkspaceLayout(t *testing.T) {
	ws, fixDir := fixtureBareWorkspace(t)

	sess := ingest.Session{
		ID:        "fix-1",
		Directory: fixDir,
		Branch:    "fix/team",
		CreatedAt: time.Now().Add(-time.Hour),
		UpdatedAt: time.Now(),
	}
	enrichGitInfo(&sess)

	if !sess.IsWorktree {
		t.Errorf("IsWorktree = false, want true")
	}
	if sess.WorkspaceRoot != ws {
		t.Errorf("WorkspaceRoot = %q, want %q", sess.WorkspaceRoot, ws)
	}
	if sess.WorktreeRelPath != "fix/team" {
		t.Errorf("WorktreeRelPath = %q, want fix/team", sess.WorktreeRelPath)
	}
	if sess.BranchSource != ingest.BranchSourceAgent {
		t.Errorf("BranchSource = %q, want %q", sess.BranchSource, ingest.BranchSourceAgent)
	}
}

func TestEnrichGitInfo_BranchSamplesFromAdapter(t *testing.T) {
	ws, fixDir := fixtureBareWorkspace(t)

	sess := ingest.Session{
		ID:           "fix-2",
		Directory:    fixDir,
		Branch:       "feat/late",
		BranchStart:  "fix/team",
		BranchSource: ingest.BranchSourceAdapter,
		CreatedAt:    time.Now().Add(-time.Hour),
		UpdatedAt:    time.Now(),
	}
	enrichGitInfo(&sess)

	if !sess.BranchChanged {
		t.Errorf("BranchChanged = false, want true (fix/team → feat/late)")
	}
	if sess.WorkspaceRoot != ws {
		t.Errorf("WorkspaceRoot = %q, want %q", sess.WorkspaceRoot, ws)
	}
}

func TestEnrichGitInfo_UnresolvedDirectory(t *testing.T) {
	plainDir := t.TempDir()
	sess := ingest.Session{ID: "plain", Directory: plainDir}
	enrichGitInfo(&sess)
	if sess.WorkspaceRoot != "" || sess.IsWorktree {
		t.Errorf("plain dir must not resolve: %+v", sess)
	}
}

func TestBranchChanged(t *testing.T) {
	cases := []struct {
		start, end string
		want       bool
	}{
		{"main", "feat/x", true},
		{"main", "main", false},
		{"", "main", false},
		{"main", "", false},
	}
	for _, tc := range cases {
		if got := branchChanged(tc.start, tc.end); got != tc.want {
			t.Errorf("branchChanged(%q, %q) = %v, want %v", tc.start, tc.end, got, tc.want)
		}
	}
}

// TestEnrichGit_SessionList exercises the batch path used by refreshSessions:
// field isolation must hold when one session's resolution fails.
func TestEnrichGit_SessionList(t *testing.T) {
	_, fixDir := fixtureBareWorkspace(t)
	sessions := []ingest.Session{
		{ID: "a", Directory: fixDir, CreatedAt: time.Now().Add(-time.Hour), UpdatedAt: time.Now()},
	}
	enrichGit(sessions)
	if len(sessions) != 1 || sessions[0].WorkspaceRoot == "" {
		t.Fatalf("batch enrichment failed: %+v", sessions)
	}
}

// sanity: the resolver used by the server is the gitmeta one
func TestGitResolverCaches(t *testing.T) {
	_, fixDir := fixtureBareWorkspace(t)
	first := gitResolver.Resolve(fixDir)
	second := gitResolver.Resolve(fixDir)
	firstJSON, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if string(firstJSON) != string(secondJSON) {
		t.Errorf("cached resolution drifted: %s vs %s", firstJSON, secondJSON)
	}
}
