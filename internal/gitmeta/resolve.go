package gitmeta

import (
	"os"
	"path/filepath"
	"strings"
)

// resolve walks up from dir looking for a .git entry or a bare repository root.
// The user's home directory is treated as the walk limit and is not itself
// considered a repository boundary, so sessions in unrelated folders are never
// attributed to a home-level repository (for example a dotfiles repo).
func resolve(dir string) Info {
	if _, err := os.Stat(dir); err != nil {
		return Info{}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	} else if resolved, err := evalSymlinks(home); err == nil {
		// Canonicalise so the break comparison matches dirs that Resolve has
		// already evaluated through symlinks.
		home = resolved
	}
	current := dir
	// current is a canonicalised real directory and never empty, so an empty
	// home (os.UserHomeDir failed) can never match here and the walk then
	// stops at the filesystem root.
	for current != home {
		gitPath := filepath.Join(current, ".git")
		if info, err := os.Lstat(gitPath); err == nil {
			return describe(current, gitPath, info)
		}
		if looksLikeGitDir(current) {
			return describeBareRoot(current)
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return Info{}
}

// evalSymlinks canonicalises path, falling back to cleaning it when resolution
// fails (for example a dangling path).
func evalSymlinks(path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return filepath.Clean(path), err
	}
	return resolved, nil
}

// describe builds Info for a directory that contains the supplied .git entry.
func describe(root, gitPath string, entry os.FileInfo) Info {
	info := Info{Found: true, WorktreeRoot: root}

	var gitDir, commonDir string
	if entry.IsDir() {
		gitDir = gitPath
		commonDir = gitPath
		info.WorkspaceKind = KindStandard
	} else {
		resolved, err := readGitdirFile(gitPath)
		if err != nil {
			return Info{}
		}
		gitDir = resolved
		commonDir = commonDirOf(gitDir)
		info.IsWorktree = true
		info.Submodule = isSubmodulePath(gitDir)
		switch {
		case info.Submodule:
			info.WorkspaceKind = KindStandard
		case filepath.Base(commonDir) == ".git":
			info.WorkspaceKind = KindStandard
		default:
			info.WorkspaceKind = KindBare
		}
	}

	info.GitDir = gitDir
	info.GitCommonDir = commonDir
	if info.Submodule {
		info.WorkspaceRoot = root
	} else {
		info.WorkspaceRoot = filepath.Dir(commonDir)
	}
	info.WorkspaceName = filepath.Base(info.WorkspaceRoot)
	info.WorktreeRelPath = relPath(info.WorkspaceRoot, root)
	info.External = isExternal(info.WorkspaceRoot, root)
	info.Branch, info.Head = readHead(gitDir)
	info.RemoteURL = readRemoteURL(commonDir)
	return info
}

// describeBareRoot handles a directory that is itself a bare repository.
func describeBareRoot(root string) Info {
	branch, head := readHead(root)
	return Info{
		Found:         true,
		WorkspaceRoot: root,
		WorkspaceName: filepath.Base(root),
		WorkspaceKind: KindBare,
		WorktreeRoot:  root,
		GitDir:        root,
		GitCommonDir:  root,
		Branch:        branch,
		Head:          head,
		RemoteURL:     readRemoteURL(root),
	}
}

// readGitdirFile parses a .git file ("gitdir: <path>") or a worktree admin
// file ("<path>"). Relative paths resolve against the file's own directory,
// which is required for hand-written and some tool-created worktrees.
func readGitdirFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(data))
	if rest, ok := strings.CutPrefix(value, "gitdir:"); ok {
		value = strings.TrimSpace(rest)
	}
	if value == "" {
		return "", os.ErrNotExist
	}
	if !filepath.IsAbs(value) {
		value = filepath.Join(filepath.Dir(path), value)
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	// Canonicalise so a macOS /var → /private/var aliases (or any symlinked
	// checkout) does not produce a workspace root that differs from the
	// worktree root by path prefix.
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved, nil
	}
	return filepath.Clean(absolute), nil
}

// commonDirOf returns the shared git directory for a worktree admin dir.
func commonDirOf(gitDir string) string {
	if isSubmodulePath(gitDir) {
		return gitDir
	}
	if data, err := os.ReadFile(filepath.Join(gitDir, "commondir")); err == nil {
		value := strings.TrimSpace(string(data))
		if value != "" {
			if !filepath.IsAbs(value) {
				value = filepath.Join(gitDir, value)
			}
			if absolute, err := filepath.Abs(value); err == nil {
				if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
					return resolved
				}
				return filepath.Clean(absolute)
			}
			return filepath.Clean(value)
		}
	}
	candidate := filepath.Clean(filepath.Join(gitDir, "..", ".."))
	if looksLikeGitDir(candidate) {
		return candidate
	}
	return gitDir
}

// isSubmodulePath reports whether a git dir lives under .git/modules.
func isSubmodulePath(gitDir string) bool {
	return strings.Contains(filepath.ToSlash(gitDir), "/.git/modules/")
}

// looksLikeGitDir reports whether dir has the minimum shape of a git dir.
func looksLikeGitDir(dir string) bool {
	for _, name := range []string{"HEAD", "objects", "refs"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}

// readHead parses a git HEAD file into a branch name or detached commit.
func readHead(gitDir string) (branch, head string) {
	data, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return "", ""
	}
	value := strings.TrimSpace(string(data))
	if ref, ok := strings.CutPrefix(value, "ref:"); ok {
		ref = strings.TrimSpace(ref)
		if name, ok := strings.CutPrefix(ref, "refs/heads/"); ok {
			return name, ""
		}
		return "", ""
	}
	if isHexObjectID(value) {
		return "", value
	}
	return "", ""
}

// isHexObjectID reports whether value is a full SHA-1 or SHA-256 object id.
func isHexObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
			return false
		}
	}
	return true
}

// relPath returns the display path of worktree relative to workspace, with an
// in-repo .worktrees/ prefix removed.
func relPath(workspace, worktree string) string {
	rel, err := filepath.Rel(workspace, worktree)
	if err != nil || rel == "." {
		return ""
	}
	rel = filepath.ToSlash(rel)
	return strings.TrimPrefix(rel, ".worktrees/")
}

// isExternal reports whether worktree sits outside workspace.
func isExternal(workspace, worktree string) bool {
	rel, err := filepath.Rel(workspace, worktree)
	if err != nil {
		return false
	}
	return rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// readRemoteURL extracts remote.origin.url from a git config file.
func readRemoteURL(commonDir string) string {
	data, err := os.ReadFile(filepath.Join(commonDir, "config"))
	if err != nil {
		return ""
	}
	section := ""
	for line := range strings.SplitSeq(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			continue
		}
		if section != `remote "origin"` {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.EqualFold(strings.TrimSpace(key), "url") {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
