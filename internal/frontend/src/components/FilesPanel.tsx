import { useMemo } from "react";
import type { FileGraph, FilesFilters, Session } from "../hooks/types";
import { ActivityFileTree } from "./files/ActivityFileTree";

interface FilesPanelProps {
  sessions: Session[];
  filters: FilesFilters;
  onFiltersChange: (filters: FilesFilters) => void;
  graph: FileGraph | null;
  loading: boolean;
  error: string | null;
  selectedPath: string;
  onFileSelect: (path: string) => void;
}

// FilesPanel is the left-hand companion of the Touched Files section: project
// first, then time range, then agent, followed by the cross-session file tree
// once a project is picked.
export function FilesPanel({
  sessions,
  filters,
  onFiltersChange,
  graph,
  loading,
  error,
  selectedPath,
  onFileSelect,
}: FilesPanelProps) {
  const repos = repoList(sessions);
  const agents = agentList(sessions);
  const repoSessions = useMemo(
    () => sessions.filter((s) => s.repository === filters.repo),
    [sessions, filters.repo],
  );
  const baseDir = commonBaseDir(repoSessions);
  const patch = (next: Partial<FilesFilters>) => onFiltersChange({ ...filters, ...next });

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="border-b border-ov-border px-3 py-2 text-sm font-medium text-ov-text">
        Touched Files
      </div>

      <div className="space-y-2 border-b border-ov-border px-3 py-2 text-xs">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-ov-text-secondary">
            Project
          </span>
          <select
            className="w-full rounded border border-ov-border bg-ov-bg px-2 py-1"
            value={filters.repo}
            onChange={(e) => patch({ repo: e.target.value })}
          >
            <option value="">Select a project…</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label="From date"
            className="min-w-0 flex-1 rounded border border-ov-border bg-ov-bg px-2 py-1"
            value={filters.from}
            onChange={(e) => patch({ from: e.target.value })}
          />
          <span className="text-ov-text-secondary">→</span>
          <input
            type="date"
            aria-label="To date"
            className="min-w-0 flex-1 rounded border border-ov-border bg-ov-bg px-2 py-1"
            value={filters.to}
            onChange={(e) => patch({ to: e.target.value })}
          />
        </div>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-ov-text-secondary">Agent</span>
          <select
            className="w-full rounded border border-ov-border bg-ov-bg px-2 py-1"
            value={filters.agent}
            onChange={(e) => patch({ agent: e.target.value })}
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {!filters.repo && (
          <p className="text-[11px] leading-relaxed text-ov-text-secondary">
            Pick a project to see which files AI sessions read and wrote, as a graph overview plus a
            per-file drill-down.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {loading && (
          <div className="px-3 py-2 text-xs text-ov-text-secondary">Loading activity…</div>
        )}
        {error && <div className="px-3 py-2 text-xs text-red-500">Failed to load: {error}</div>}
        {!loading && !error && filters.repo && graph && (
          <ActivityFileTree
            nodes={graph.nodes}
            baseDir={baseDir}
            selectedPath={selectedPath}
            onSelect={onFileSelect}
          />
        )}
        {!loading && !error && filters.repo && graph && graph.nodes.length === 0 && (
          <div className="px-3 py-2 text-xs leading-relaxed text-ov-text-secondary">
            No file activity recorded for this selection yet.
          </div>
        )}
      </div>
    </div>
  );
}

function repoList(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.repository).filter(Boolean))].sort();
}

function agentList(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.agent))].sort();
}

function commonBaseDir(sessions: Session[]): string | undefined {
  // The common working directory for the repo's sessions; used to display and
  // match relative paths. Falls back to undefined when sessions carry none.
  const dirs = sessions.map((s) => s.directory).filter(Boolean) as string[];
  if (dirs.length === 0) return undefined;
  let prefix = dirs[0];
  for (const d of dirs) {
    while (!d.startsWith(prefix)) {
      const next = prefix.slice(0, Math.max(0, prefix.lastIndexOf("/")));
      if (next === prefix || next === "") return undefined;
      prefix = next;
    }
  }
  return prefix;
}
