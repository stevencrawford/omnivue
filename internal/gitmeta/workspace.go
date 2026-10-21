package gitmeta

import (
	"os"
	"path/filepath"
	"sort"
)

// Workspace enumerates every worktree registered against the workspace that
// contains info. Worktrees with no sessions are included: the registry is the
// authoritative source, so a freshly created checkout already appears in the
// map. The result is cached briefly because the registry changes rarely.
func (r *Resolver) Workspace(info Info) Workspace {
	if !info.Found {
		return Workspace{}
	}

	r.mu.Lock()
	if entry, ok := r.workspaces[info.GitCommonDir]; ok && r.now().Before(entry.expires) {
		workspace := entry.workspace
		r.mu.Unlock()
		return workspace
	}
	r.mu.Unlock()

	workspace := Workspace{
		Root:      info.WorkspaceRoot,
		Name:      info.WorkspaceName,
		Kind:      info.WorkspaceKind,
		CommonDir: info.GitCommonDir,
		RemoteURL: info.RemoteURL,
	}

	seen := make(map[string]struct{})
	worktreesDir := filepath.Join(info.GitCommonDir, "worktrees")
	if entries, err := os.ReadDir(worktreesDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			admin := filepath.Join(worktreesDir, entry.Name())
			gitFile, err := readGitdirFile(filepath.Join(admin, "gitdir"))
			if err != nil {
				continue
			}
			root := filepath.Dir(gitFile)
			if _, ok := seen[root]; ok {
				continue
			}
			seen[root] = struct{}{}
			branch, head := readHead(admin)
			workspace.Worktrees = append(workspace.Worktrees, newWorktree(workspace.Root, root, branch, head))
		}
	}

	if info.WorkspaceKind == KindStandard {
		root := info.WorktreeRoot
		if !info.Submodule {
			root = filepath.Dir(info.GitCommonDir)
		}
		if _, ok := seen[root]; !ok {
			branch, head := readHead(info.GitCommonDir)
			workspace.Worktrees = append(workspace.Worktrees, newWorktree(workspace.Root, root, branch, head))
		}
	}

	sort.Slice(workspace.Worktrees, func(i, j int) bool {
		if workspace.Worktrees[i].External != workspace.Worktrees[j].External {
			return !workspace.Worktrees[i].External
		}
		return workspace.Worktrees[i].RelPath < workspace.Worktrees[j].RelPath
	})

	r.mu.Lock()
	r.workspaces[info.GitCommonDir] = workspaceCacheEntry{
		workspace: workspace,
		expires:   r.now().Add(r.ttl),
	}
	r.mu.Unlock()

	return workspace
}

func newWorktree(workspaceRoot, root, branch, head string) Worktree {
	return Worktree{
		Root:       root,
		RelPath:    relPath(workspaceRoot, root),
		Branch:     branch,
		Head:       head,
		Detached:   branch == "" && head != "",
		External:   isExternal(workspaceRoot, root),
		Registered: true,
	}
}
