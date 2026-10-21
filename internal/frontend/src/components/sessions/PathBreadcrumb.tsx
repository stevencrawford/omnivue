import { AlertTriangle, FolderGit2, GitBranch } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Session } from "../../hooks/types";
import { sessionBranchLabel, workspaceLabel, worktreeLabel } from "../../utils/projectTree";

interface PathBreadcrumbProps {
  session: Session;
}

/**
 * Replaces the flat "repository" label in the session header with the path the
 * session actually occupied: workspace / worktree / branch. Clicking the
 * workspace opens the Projects surface focused on it.
 */
export function PathBreadcrumb({ session }: PathBreadcrumbProps) {
  const navigate = useNavigate();

  if (!session.workspaceRoot) {
    return (
      <span
        className="text-[11px] font-mono text-ov-text-secondary ml-auto truncate max-w-[32%]"
        title={session.directory}
      >
        {session.repository || session.directory}
      </span>
    );
  }

  const worktree = worktreeLabel(session);
  const branch = sessionBranchLabel(session);
  const workspace = workspaceLabel(session);

  return (
    <span
      className="ml-auto flex min-w-0 max-w-[40%] items-center gap-1 text-[11px] text-ov-text-secondary"
      title={[session.workspaceRoot, session.worktreeRoot, branch].filter(Boolean).join("\n")}
    >
      <button
        type="button"
        onClick={() =>
          navigate(`/projects?workspace=${encodeURIComponent(session.workspaceRoot || "")}`)
        }
        className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-ov-bg-hover hover:text-ov-text cursor-pointer"
        title={`Open ${workspace} in Projects`}
      >
        <FolderGit2 size={11} className="shrink-0" />
        <span className="truncate">{workspace}</span>
      </button>
      <span className="shrink-0 opacity-40">/</span>
      <span className="flex min-w-0 items-center gap-1">
        <GitBranch size={11} className="shrink-0" />
        <span className="truncate">{worktree}</span>
      </span>
      {branch && (
        <>
          <span className="shrink-0 opacity-40">/</span>
          <span
            className="max-w-32 truncate rounded bg-ov-bg-active px-1 py-px font-mono text-[10px] text-ov-text-secondary"
            title={
              session.branchConfidence
                ? `Branch from session ${session.branchConfidence} evidence`
                : "Branch"
            }
          >
            {branch}
          </span>
        </>
      )}
      {session.externalWorktree && (
        <span
          className="shrink-0 rounded bg-ov-bg-active px-1 py-px text-[10px]"
          title="Worktree lives outside the workspace root"
        >
          ext
        </span>
      )}
      {session.worktreeMissing && (
        <AlertTriangle
          size={11}
          className="shrink-0 text-amber-500"
          aria-label="Worktree directory is missing"
        />
      )}
    </span>
  );
}
