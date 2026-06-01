import { useCallback, useEffect, useState } from "react";
import type { DiffFile } from "../hooks/useApi";
import { fetchDiffs } from "../hooks/useApi";

interface DiffViewProps {
  sessionId: string;
}

export function DiffView({ sessionId }: DiffViewProps) {
  const [diffs, setDiffs] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDiffs(sessionId);
      setDiffs(data || []);
    } catch {
      setDiffs([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-gh-text-secondary">
        <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading diffs...
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div className="sess-empty-state p-8">
        <div className="sess-empty-icon">
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2Z" />
          </svg>
        </div>
        <p className="text-sm text-gh-text-secondary">No file changes in this session</p>
      </div>
    );
  }

  const stats = computeStats(diffs);

  return (
    <div className="p-6 w-full">
      {/* Summary bar */}
      <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-surface-elevated border border-gh-border rounded-xl text-xs">
        <span className="font-semibold text-gh-text">
          {diffs.length} {diffs.length === 1 ? "file" : "files"} changed
        </span>
        {stats.additions > 0 && (
          <span className="text-green-500 font-mono">+{stats.additions}</span>
        )}
        {stats.deletions > 0 && <span className="text-red-500 font-mono">-{stats.deletions}</span>}
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-gh-text-secondary">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-green-500" /> {stats.added} added
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-yellow-500" /> {stats.modified} modified
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-red-500" /> {stats.deleted} deleted
          </span>
          {stats.renamed > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-purple-500" /> {stats.renamed} renamed
            </span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="border border-gh-border rounded-xl overflow-hidden divide-y divide-gh-border bg-surface-elevated">
        {diffs.map((diff, i) => (
          <DiffFileRow key={i} diff={diff} />
        ))}
      </div>
    </div>
  );
}

function DiffFileRow({ diff }: { diff: DiffFile }) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = getFileStatusConfig(diff.status);
  const fileName = getFileName(diff.path);
  const dirPath = getDirPath(diff.path);
  const hasPatch = diff.patch && diff.patch.length > 0;

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gh-bg-hover transition-colors cursor-pointer"
        onClick={() => hasPatch && setExpanded(!expanded)}
      >
        {/* Expand arrow (only if patch exists) */}
        {hasPatch ? (
          <svg
            className={`size-3 text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {/* Status icon */}
        <span className={`text-[10px] font-bold shrink-0 ${statusConfig.color}`}>
          {statusConfig.letter}
        </span>

        {/* File path */}
        <span className="text-xs font-mono truncate">
          {dirPath && <span className="text-gh-text-secondary">{dirPath}/</span>}
          <span className="text-gh-text font-medium">{fileName}</span>
        </span>

        {/* Change stats */}
        {(diff.additions > 0 || diff.deletions > 0) && (
          <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[10px] font-mono">
            {diff.additions > 0 && <span className="text-green-500">+{diff.additions}</span>}
            {diff.deletions > 0 && <span className="text-red-500">-{diff.deletions}</span>}
          </span>
        )}

        {/* Change bar */}
        {(diff.additions > 0 || diff.deletions > 0) && (
          <ChangeBar additions={diff.additions} deletions={diff.deletions} />
        )}
      </button>

      {/* Expanded patch view */}
      {expanded && hasPatch && (
        <div className="border-t border-gh-border bg-gh-bg">
          <PatchView patch={diff.patch!} />
        </div>
      )}
    </div>
  );
}

function PatchView({ patch }: { patch: string }) {
  const lines = patch.split("\n");

  return (
    <div className="overflow-x-auto text-[11px] font-mono leading-5">
      {lines.map((line, i) => {
        const lineClass = getLineClass(line);
        return (
          <div key={i} className={`px-3 ${lineClass}`}>
            <span className="select-all">{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const maxBlocks = 5;
  const addBlocks = total > 0 ? Math.round((additions / total) * maxBlocks) : 0;
  const delBlocks = maxBlocks - addBlocks;

  return (
    <span className="flex gap-px ml-2 shrink-0">
      {Array.from({ length: addBlocks }).map((_, i) => (
        <span key={`a${i}`} className="size-1.5 rounded-sm bg-green-500" />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <span key={`d${i}`} className="size-1.5 rounded-sm bg-red-500" />
      ))}
    </span>
  );
}

function getLineClass(line: string): string {
  if (line.startsWith("@@")) return "bg-accent-muted text-accent";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300";
  return "text-gh-text";
}

function getFileStatusConfig(status: string) {
  switch (status) {
    case "added":
      return { letter: "A", color: "text-green-500" };
    case "deleted":
      return { letter: "D", color: "text-red-500" };
    case "renamed":
      return { letter: "R", color: "text-purple-500" };
    default:
      return { letter: "M", color: "text-yellow-500" };
  }
}

function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function getDirPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return path.slice(0, lastSlash);
}

function computeStats(diffs: DiffFile[]) {
  let additions = 0;
  let deletions = 0;
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;

  for (const d of diffs) {
    additions += d.additions;
    deletions += d.deletions;
    switch (d.status) {
      case "added":
        added++;
        break;
      case "deleted":
        deleted++;
        break;
      case "renamed":
        renamed++;
        break;
      default:
        modified++;
        break;
    }
  }

  return { additions, deletions, added, modified, deleted, renamed };
}
