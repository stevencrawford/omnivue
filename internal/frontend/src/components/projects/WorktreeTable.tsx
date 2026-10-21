import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, GitBranch } from "lucide-react";
import type { Session } from "../../hooks/types";
import { relativeTime } from "../../utils/buildTree";
import type { WorktreeSummary, WorkspaceSummary } from "../../utils/projectTree";

interface WorktreeTableProps {
  workspace: WorkspaceSummary;
  onSessionSelect: (sessionId: string) => void;
}

/**
 * Worktree map for one workspace. Every registered worktree is listed, including
 * ones that hosted no sessions, so the Projects surface can show the full shape
 * of a multi-checkout setup rather than only what was recently active.
 */
export function WorktreeTable({ workspace, onSessionSelect }: WorktreeTableProps) {
  const [selectedRoot, setSelectedRoot] = useState<string | null>(
    workspace.worktrees[0]?.root ?? null,
  );

  const selected = useMemo(
    () =>
      workspace.worktrees.find((worktree) => worktree.root === selectedRoot) ??
      workspace.worktrees[0],
    [workspace.worktrees, selectedRoot],
  );

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-ov-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-ov-bg-active/60 text-[10px] uppercase tracking-wider text-ov-text-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Worktree</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium text-right">Sessions</th>
              <th className="px-3 py-2 font-medium text-right">Updated</th>
              <th className="w-6 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {workspace.worktrees.map((worktree) => {
              const active = selected?.root === worktree.root;
              return (
                <tr
                  key={`${worktree.root}:${worktree.relPath}`}
                  onClick={() => setSelectedRoot(worktree.root)}
                  className={`cursor-pointer border-t border-ov-border transition-colors ${
                    active ? "bg-ov-bg-active" : "hover:bg-ov-bg-hover"
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <GitBranch size={12} className="shrink-0 text-ov-text-secondary" />
                      <span className="font-medium text-ov-text">{worktree.label}</span>
                      {worktree.isMain && (
                        <span className="rounded bg-ov-bg-active px-1 py-px text-[9px] uppercase tracking-wide text-ov-text-secondary">
                          main
                        </span>
                      )}
                      {worktree.external && (
                        <span className="text-[9px] uppercase tracking-wide text-ov-text-secondary/70">
                          external
                        </span>
                      )}
                      {worktree.missing && (
                        <AlertTriangle size={11} className="text-amber-500" aria-label="Missing" />
                      )}
                    </div>
                    {worktree.root && (
                      <div className="mt-0.5 max-w-md truncate font-mono text-[10px] text-ov-text-secondary/70">
                        {worktree.root}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {worktree.branches.length === 0 ? (
                      <span className="text-ov-text-secondary">detached</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {worktree.branches.map((branch) => (
                          <span
                            key={branch}
                            className="rounded bg-ov-bg-active px-1 py-px font-mono text-[10px] text-ov-text-secondary"
                          >
                            {branch}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ov-text-secondary">
                    {worktree.sessions.length}
                  </td>
                  <td className="px-3 py-2 text-right text-ov-text-secondary">
                    {worktree.lastUpdated ? relativeTime(worktree.lastUpdated) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <ChevronRight
                      size={12}
                      className={`text-ov-text-secondary transition-transform ${
                        active ? "rotate-90" : ""
                      }`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && <WorktreeSessions worktree={selected} onSessionSelect={onSessionSelect} />}
    </div>
  );
}

function WorktreeSessions({
  worktree,
  onSessionSelect,
}: {
  worktree: WorktreeSummary;
  onSessionSelect: (sessionId: string) => void;
}) {
  if (worktree.sessions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ov-border px-3 py-2 text-xs text-ov-text-secondary">
        No sessions recorded in <span className="font-mono">{worktree.label}</span> yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ov-border">
      <div className="border-b border-ov-border bg-ov-bg-active/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-ov-text-secondary">
        Sessions in {worktree.label}
      </div>
      <div className="divide-y divide-ov-border">
        {worktree.sessions.map((session) => (
          <SessionLine key={session.id} session={session} onSessionSelect={onSessionSelect} />
        ))}
      </div>
    </div>
  );
}

function SessionLine({
  session,
  onSessionSelect,
}: {
  session: Session;
  onSessionSelect: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSessionSelect(session.id)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-ov-bg-hover cursor-pointer"
    >
      {session.status === "active" && (
        <span className="sess-live-dot shrink-0" title="Session active" />
      )}
      <span className="min-w-0 flex-1 truncate text-ov-text">{session.title || session.id}</span>
      <span className="shrink-0 text-[11px] text-ov-text-secondary">{session.agent}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-ov-text-secondary">
        {relativeTime(session.updatedAt)}
      </span>
    </button>
  );
}
