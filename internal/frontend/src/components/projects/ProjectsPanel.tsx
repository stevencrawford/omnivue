import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderGit2 } from "lucide-react";
import type { Session } from "../../hooks/types";
import { buildWorkspaces } from "../../utils/projectTree";
import { relativeTime } from "../../utils/buildTree";

interface ProjectsPanelProps {
  sessions: Session[];
}

/**
 * Sidebar list for the Projects channel. It is intentionally a navigation aid,
 * not a second detail view: selecting a workspace opens the Projects surface.
 */
export function ProjectsPanel({ sessions }: ProjectsPanelProps) {
  const workspaces = useMemo(() => buildWorkspaces(sessions), [sessions]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const selectedRoot = params.get("workspace");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Projects
        </span>
        <span className="text-[11px] tabular-nums text-ov-text-secondary">{workspaces.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {workspaces.length === 0 ? (
          <p className="px-1.5 py-2 text-[11px] leading-relaxed text-ov-text-secondary/70">
            No git workspaces yet. Projects appear once a session has run inside a repository.
          </p>
        ) : (
          workspaces.map((workspace) => {
            const active = workspace.root === selectedRoot;
            return (
              <button
                key={workspace.key}
                type="button"
                onClick={() =>
                  navigate(`/projects?workspace=${encodeURIComponent(workspace.root)}`)
                }
                className={`mb-px flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${
                  active ? "bg-ov-bg-active" : "hover:bg-ov-bg-hover"
                }`}
              >
                <FolderGit2
                  size={13}
                  className={`shrink-0 ${active ? "text-accent" : "text-ov-text-secondary"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ov-text">{workspace.name}</div>
                  <div className="truncate text-[10px] text-ov-text-secondary">
                    {workspace.worktrees.length} worktree
                    {workspace.worktrees.length === 1 ? "" : "s"} · {workspace.sessionCount} session
                    {workspace.sessionCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-ov-text-secondary">
                  {relativeTime(workspace.lastUpdated)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
