import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, FolderGit2, GitBranch, Layers, MessageSquare, Radio } from "lucide-react";
import type { Session } from "../../hooks/types";
import { relativeTime } from "../../utils/buildTree";
import { buildWorkspaces, type WorkspaceSummary } from "../../utils/projectTree";
import { WorktreeTable } from "./WorktreeTable";

interface ProjectsScreenProps {
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
}

function branchCount(workspace: WorkspaceSummary): number {
  const branches = new Set<string>();
  for (const worktree of workspace.worktrees) {
    for (const branch of worktree.branches) branches.add(branch);
  }
  return branches.size;
}

/**
 * Projects is the workspace-level map: every git workspace, every registered
 * worktree, and the sessions recorded in each. It is derived from the same
 * enriched session list as the sidebar, so there is no second source of truth
 * and no extra backend endpoint.
 */
export function ProjectsScreen({ sessions, onSessionSelect }: ProjectsScreenProps) {
  const workspaces = useMemo(() => buildWorkspaces(sessions), [sessions]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const selectedRoot = params.get("workspace");
  const selected = workspaces.find((workspace) => workspace.root === selectedRoot) ?? null;

  if (workspaces.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FolderGit2 className="size-8 text-ov-text-secondary/40" />
        <h2 className="text-sm font-medium text-ov-text">No git workspaces yet</h2>
        <p className="max-w-md text-xs leading-relaxed text-ov-text-secondary">
          Omnivue derives workspaces from the directories your sessions ran in. Once a session has
          run inside a repository, its workspace and worktrees will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-ov-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
            Projects
          </span>
          <span className="text-[11px] tabular-nums text-ov-text-secondary">
            {workspaces.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {workspaces.map((workspace) => {
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
                <ChevronRight size={12} className="shrink-0 text-ov-text-secondary" />
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <WorkspaceDetail
            workspace={selected}
            onSessionSelect={onSessionSelect}
            onBack={() => navigate("/projects")}
          />
        ) : (
          <WorkspaceGrid
            workspaces={workspaces}
            onSelect={(workspace) =>
              navigate(`/projects?workspace=${encodeURIComponent(workspace.root)}`)
            }
          />
        )}
      </div>
    </div>
  );
}

function WorkspaceGrid({
  workspaces,
  onSelect,
}: {
  workspaces: WorkspaceSummary[];
  onSelect: (workspace: WorkspaceSummary) => void;
}) {
  return (
    <div className="p-5">
      <header className="mb-4">
        <h1 className="text-base font-semibold text-ov-text">Projects</h1>
        <p className="mt-1 text-xs text-ov-text-secondary">
          Workspaces and worktrees discovered from session directories.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => (
          <button
            key={workspace.key}
            type="button"
            onClick={() => onSelect(workspace)}
            className="flex flex-col gap-2 rounded-lg border border-ov-border bg-ov-bg-sidebar p-3 text-left transition-colors hover:border-accent/50 hover:bg-ov-bg-hover cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <FolderGit2 size={15} className="text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ov-text">
                {workspace.name}
              </span>
              <span className="rounded bg-ov-bg-active px-1 py-px text-[9px] uppercase tracking-wide text-ov-text-secondary">
                {workspace.kind}
              </span>
            </div>
            <p className="truncate font-mono text-[10px] text-ov-text-secondary/70">
              {workspace.root}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-ov-text-secondary">
              <span className="flex items-center gap-1">
                <Layers size={11} /> {workspace.worktrees.length}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare size={11} /> {workspace.sessionCount}
              </span>
              <span className="flex items-center gap-1">
                <GitBranch size={11} /> {branchCount(workspace)}
              </span>
              <span className="ml-auto">{relativeTime(workspace.lastUpdated)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {workspace.worktrees.slice(0, 4).map((worktree) => (
                <span
                  key={`${worktree.root}:${worktree.relPath}`}
                  className="max-w-32 truncate rounded bg-ov-bg-active px-1 py-px font-mono text-[10px] text-ov-text-secondary"
                >
                  {worktree.label}
                </span>
              ))}
              {workspace.worktrees.length > 4 && (
                <span className="text-[10px] text-ov-text-secondary">
                  +{workspace.worktrees.length - 4}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceDetail({
  workspace,
  onSessionSelect,
  onBack,
}: {
  workspace: WorkspaceSummary;
  onSessionSelect: (sessionId: string) => void;
  onBack: () => void;
}) {
  const activeSessions = workspace.sessions.filter((session) => session.status === "active").length;
  return (
    <div className="p-5">
      <nav className="mb-3 flex items-center gap-1 text-[11px] text-ov-text-secondary">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-1 py-0.5 hover:bg-ov-bg-hover hover:text-ov-text cursor-pointer"
        >
          Projects
        </button>
        <ChevronRight size={11} />
        <span className="truncate text-ov-text">{workspace.name}</span>
      </nav>

      <header className="mb-4">
        <div className="flex items-center gap-2">
          <FolderGit2 size={17} className="text-accent" />
          <h1 className="text-base font-semibold text-ov-text">{workspace.name}</h1>
          <span className="rounded bg-ov-bg-active px-1 py-px text-[9px] uppercase tracking-wide text-ov-text-secondary">
            {workspace.kind}
          </span>
          {activeSessions > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
              <Radio size={10} /> {activeSessions} live
            </span>
          )}
        </div>
        <p className="mt-1 break-all font-mono text-[11px] text-ov-text-secondary/80">
          {workspace.root}
        </p>
        {workspace.remoteUrl && (
          <p className="mt-0.5 break-all font-mono text-[10px] text-ov-text-secondary/60">
            {workspace.remoteUrl}
          </p>
        )}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sessions" value={workspace.sessionCount} />
        <Stat label="Worktrees" value={workspace.worktrees.length} />
        <Stat label="Branches" value={branchCount(workspace)} />
        <Stat label="Last active" value={relativeTime(workspace.lastUpdated)} />
      </div>

      <WorktreeTable key={workspace.key} workspace={workspace} onSessionSelect={onSessionSelect} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-ov-border bg-ov-bg-sidebar px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ov-text-secondary">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-ov-text">{value}</div>
    </div>
  );
}
