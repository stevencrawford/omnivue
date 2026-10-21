package server

import (
	"strings"

	"github.com/stevencrawford/omnivue/internal/gitmeta"
	"github.com/stevencrawford/omnivue/internal/ingest"
)

// gitResolver caches git-layout lookups across polls. Lookups parse git's own
// on-disk metadata read-only; no git subprocess runs in the common path.
var gitResolver = gitmeta.NewResolver()

// enrichGit fills the workspace-layout and branch-history fields of every
// session from its Directory so the frontend can group by workspace/worktree
// and render branch movement (main → feat/x) without knowing git internals.
func enrichGit(sessions []ingest.Session) {
	for i := range sessions {
		enrichGitInfo(&sessions[i])
	}
}

// enrichGitInfo layers git resolution on top of one session. Adapter-recorded
// branch evidence wins where it exists (BranchStart from the transcript,
// BranchSource=adapter); otherwise the checkout's reflog timeline supplies
// branch history and the current HEAD is the last resort.
func enrichGitInfo(sess *ingest.Session) {
	if sess.Directory == "" {
		return
	}
	info := gitResolver.Resolve(sess.Directory)
	if !info.Found {
		return
	}
	sess.WorkspaceRoot = info.WorkspaceRoot
	sess.WorktreeRoot = info.WorktreeRoot
	sess.WorktreeRelPath = info.RelPath
	sess.IsWorktree = info.IsWorktree
	sess.External = info.External

	if sess.BranchSource == "" && sess.Branch != "" {
		// Branch set by the adapter without a provenance marker: agent
		// session-record evidence (tier 2).
		sess.BranchSource = ingest.BranchSourceAgent
	}

	if sess.BranchStart == "" {
		use := gitResolver.BranchAt(sess.Directory, sess.CreatedAt, sess.UpdatedAt)
		if use.Start != "" && use.Start != sess.Branch {
			sess.BranchStart = use.Start
		}
		if sess.Branch == "" && use.End != "" {
			sess.Branch = use.End
			sess.BranchSource = use.Source
		}
	}

	sess.BranchChanged = branchChanged(sess.BranchStart, sess.Branch)
}

// branchChanged reports whether a session demonstrably moved branches.
func branchChanged(start, end string) bool {
	return start != "" && end != "" && strings.Compare(start, end) != 0
}
