import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, File, MessageSquareText } from "lucide-react";
import type { FileGraphNode, Session } from "../../hooks/types";
import { fetchEdits } from "../../hooks/apiClient";
import { mergeFileEdits, relativizePath, type MergedFileDiff } from "../../utils/diffTree";
import { detectLanguage } from "../../utils/detectLanguage";
import { HunkRenderer } from "../DiffRenderer";
import { LoadingState } from "../ui/LoadingState";

// Writing sessions are fetched lazily for their diffs; cap the fan-out so a
// hub file touched by dozens of sessions does not fire dozens of requests.
const MAX_DIFF_SESSIONS = 10;

interface FileDetailProps {
  node: FileGraphNode;
  sessions: Session[];
  baseDir?: string;
  onSessionSelect: (sessionId: string) => void;
  onBack: () => void;
}

function matchesPath(editPath: string, target: string, baseDir?: string): boolean {
  if (editPath === target) return true;
  const rel = relativizePath(editPath, baseDir);
  return rel === target || editPath.endsWith(`/${target}`);
}

export function FileDetail({ node, sessions, baseDir, onSessionSelect, onBack }: FileDetailProps) {
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const relPath = relativizePath(node.path, baseDir);

  const writeSessions = useMemo(() => node.touches.filter((t) => t.writes > 0), [node.touches]);
  const readSessions = useMemo(
    () => node.touches.filter((t) => t.reads > 0 && t.writes === 0),
    [node.touches],
  );

  const [diffsLoading, setDiffsLoading] = useState(true);
  const [diffsBySession, setDiffsBySession] = useState<Map<string, MergedFileDiff>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setDiffsLoading(true);
    setDiffsBySession(new Map());
    const toLoad = writeSessions.slice(0, MAX_DIFF_SESSIONS);
    if (toLoad.length === 0) {
      setDiffsLoading(false);
      return;
    }
    Promise.all(
      toLoad.map(async (touch) => {
        try {
          const edits = await fetchEdits(touch.sessionId);
          const matched = edits.filter((e) => matchesPath(e.filePath, node.path, baseDir));
          if (matched.length === 0) return [touch.sessionId, null] as const;
          return [touch.sessionId, mergeFileEdits(relPath, matched)] as const;
        } catch {
          return [touch.sessionId, null] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, MergedFileDiff>();
      for (const [id, diff] of results) {
        if (diff && diff.hunks.length > 0) map.set(id, diff);
      }
      setDiffsBySession(map);
      setDiffsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [node.path, writeSessions, baseDir, relPath]);

  const title = (id: string) => sessionById.get(id)?.title || id;

  const renderSessionList = (label: string, list: typeof node.touches, accentClass: string) =>
    list.length > 0 && (
      <div>
        <div className="mb-1 text-[11px] font-medium text-ov-text-secondary">{label}</div>
        <div className="flex flex-wrap gap-1">
          {list.map((t) => (
            <button
              key={t.sessionId}
              type="button"
              className={`max-w-[240px] truncate rounded border border-ov-border px-1.5 py-0.5 text-[11px] hover:bg-ov-bg-hover ${accentClass}`}
              title={title(t.sessionId)}
              onClick={() => onSessionSelect(t.sessionId)}
            >
              {title(t.sessionId)}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-ov-border bg-surface-elevated px-3 py-2 text-xs">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
          onClick={onBack}
        >
          <ArrowLeft size={13} />
          Overview
        </button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-ov-text"
          title={node.path}
        >
          {relPath}
        </span>
        <span className="shrink-0 font-mono text-cyan-500">{node.reads}R</span>
        <span className="shrink-0 font-mono text-amber-500">{node.writes}W</span>
        <span className="shrink-0 text-ov-text-secondary">{node.sessions} sessions</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 shrink-0 space-y-4 overflow-y-auto border-r border-ov-border p-3 text-xs">
          {renderSessionList(
            `Written by (${writeSessions.length})`,
            writeSessions,
            "text-amber-500",
          )}
          {renderSessionList(`Read by (${readSessions.length})`, readSessions, "text-cyan-500")}
          {writeSessions.length > MAX_DIFF_SESSIONS && (
            <p className="text-[11px] text-ov-text-secondary">
              Showing changes from the {MAX_DIFF_SESSIONS} most recent writing sessions.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {diffsLoading ? (
            <LoadingState label="Loading changes..." />
          ) : diffsBySession.size === 0 ? (
            <div className="flex h-full items-center justify-center p-4 text-sm text-ov-text-secondary">
              <div className="text-center">
                <File size={32} className="mx-auto mb-2 opacity-40" />
                No recorded patch content for this file
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              {[...diffsBySession.entries()].map(([sessionId, diff]) => (
                <div key={sessionId}>
                  <button
                    type="button"
                    className="mb-2 flex w-full items-center gap-1.5 border-b border-ov-border pb-1.5 text-left text-[11px] text-ov-text-secondary hover:text-accent"
                    onClick={() => onSessionSelect(sessionId)}
                  >
                    <MessageSquareText size={11} />
                    <span className="truncate font-medium">{title(sessionId)}</span>
                    <span className="ml-auto shrink-0 font-mono">
                      <span className="text-green-500">+{diff.additions}</span>{" "}
                      <span className="text-red-500">-{diff.deletions}</span>
                    </span>
                  </button>
                  <div className="space-y-2">
                    {diff.hunks.map((hunk, i) => (
                      <HunkRenderer key={i} hunk={hunk} lang={detectLanguage(node.path)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
