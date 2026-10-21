package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stevencrawford/omnivue/internal/gitmeta"
	"github.com/stevencrawford/omnivue/internal/ingest"
)

func TestResumeDirectoryPrefersEndWhenItExists(t *testing.T) {
	existing := t.TempDir()
	missing := filepath.Join(t.TempDir(), "gone")

	cases := []struct {
		name     string
		session  ingest.Session
		expected string
	}{
		{
			name:     "end differs and exists",
			session:  ingest.Session{Directory: missing, DirectoryEnd: existing},
			expected: existing,
		},
		{
			name:     "end differs but is gone",
			session:  ingest.Session{Directory: existing, DirectoryEnd: missing},
			expected: existing,
		},
		{
			name:     "end matches start",
			session:  ingest.Session{Directory: existing, DirectoryEnd: existing},
			expected: existing,
		},
		{
			name:     "no end recorded",
			session:  ingest.Session{Directory: existing},
			expected: existing,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resumeDirectory(&tc.session); got != tc.expected {
				t.Fatalf("resumeDirectory() = %q, want %q", got, tc.expected)
			}
		})
	}
}

func TestEnrichProjectsUsesWorktreeAndTranscriptBranch(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	worktree := filepath.Join(repo, ".worktrees", "wt")

	write := func(path, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	gitDir := filepath.Join(repo, ".git")
	write(filepath.Join(gitDir, "HEAD"), "ref: refs/heads/main\n")
	write(filepath.Join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n")
	admin := filepath.Join(gitDir, "worktrees", "wt")
	write(filepath.Join(admin, "gitdir"), filepath.Join(worktree, ".git")+"\n")
	write(filepath.Join(admin, "commondir"), "../..\n")
	write(filepath.Join(admin, "HEAD"), "ref: refs/heads/feat/x\n")
	write(filepath.Join(worktree, ".git"), "gitdir: "+admin+"\n")

	sessions := []ingest.Session{{
		ID:            "ses-1",
		Directory:     worktree,
		DirectoryEnd:  worktree,
		Branch:        "main",
		CreatedAt:     time.Unix(1000, 0),
		UpdatedAt:     time.Unix(2000, 0),
		BranchSamples: []gitmeta.BranchSample{{Time: time.Unix(1500, 0), Branch: "feat/x"}},
	}}

	NewSessionHub(nil).enrichProjects(sessions)
	got := sessions[0]

	wantRepo, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatal(err)
	}
	wantWorktree, err := filepath.EvalSymlinks(worktree)
	if err != nil {
		t.Fatal(err)
	}
	if got.WorkspaceRoot != wantRepo {
		t.Fatalf("workspaceRoot = %q, want %q", got.WorkspaceRoot, wantRepo)
	}
	if got.WorktreeRoot != wantWorktree {
		t.Fatalf("worktreeRoot = %q, want %q", got.WorktreeRoot, wantWorktree)
	}
	if got.WorktreeRelPath != "wt" {
		t.Fatalf("worktreeRelPath = %q, want wt", got.WorktreeRelPath)
	}
	if !got.IsWorktree {
		t.Fatal("expected isWorktree")
	}
	if got.Branch != "feat/x" || got.BranchEnd != "feat/x" {
		t.Fatalf("branch = %q, branchEnd = %q, want feat/x", got.Branch, got.BranchEnd)
	}
	if got.BranchConfidence != string(gitmeta.ConfidenceRecorded) {
		t.Fatalf("branchConfidence = %q, want recorded", got.BranchConfidence)
	}
	if got.WorktreeMissing {
		t.Fatal("worktree exists, must not be marked missing")
	}
}

func TestEnrichProjectsFallsBackWhenDirectoryIsNotInRepo(t *testing.T) {
	sessions := []ingest.Session{{
		ID:        "ses-1",
		Directory: t.TempDir(),
		Branch:    "main",
	}}
	NewSessionHub(nil).enrichProjects(sessions)
	got := sessions[0]
	if got.WorkspaceRoot != "" {
		t.Fatalf("workspaceRoot = %q, want empty", got.WorkspaceRoot)
	}
	if got.DirectoryStart == "" || got.DirectoryEnd == "" {
		t.Fatalf("expected directory defaults, got %+v", got)
	}
}
