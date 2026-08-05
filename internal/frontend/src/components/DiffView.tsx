import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, MessageSquareText, ArrowRight, File } from "lucide-react";
import type { FileEdit } from "../hooks/types";
import { fetchEdits } from "../hooks/apiClient";
import { HunkRenderer } from "./DiffRenderer";
import { CopyButton } from "./CopyButton";
import { detectLanguage } from "../utils/detectLanguage";
import { LoadingState } from "./LoadingState";
import { EmptyPanel } from "./EmptyPanel";
import { useToast } from "../hooks/useToast";
import {
  mergeFileEdits,
  relativizePath,
  buildFileTree,
  DIFF_STATUS_COLORS,
  type MergedFileDiff,
} from "../utils/diffTree";
import { FileTree } from "./diff/FileTree";
import { useResizable } from "../hooks/useResizable";
import { STORAGE_KEYS } from "../utils/storageKeys";

interface DiffViewProps {
  sessionId: string;
  sessionDirectory?: string;
  refreshKey: number;
  searchHighlightQuery?: string | null;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}

const DIFF_TREE_WIDTH_KEY = STORAGE_KEYS.DIFF_TREE_WIDTH;
const DIFF_TREE_COLLAPSED_KEY = STORAGE_KEYS.DIFF_TREE_COLLAPSED;

export function DiffView({
  sessionId,
  sessionDirectory,
  refreshKey,
  searchHighlightQuery,
  onNavigateToMessage,
}: DiffViewProps) {
  const [edits, setEdits] = useState<FileEdit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [treeCollapsed, setTreeCollapsed] = useState(() => {
    try {
      return localStorage.getItem(DIFF_TREE_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const { value: treeWidth, startResize } = useResizable({
    storageKey: DIFF_TREE_WIDTH_KEY,
    axis: "horizontal",
    min: 200,
    max: 600,
    defaultValue: 280,
  });
  const { showErrorToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEdits(sessionId);
      setEdits(data || []);
    } catch (err) {
      showErrorToast(err, "Failed to load diffs");
      setEdits([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, refreshKey, showErrorToast]);

  useEffect(() => {
    load();
  }, [load]);

  const mergedDiffs = useMemo(() => {
    const grouped = new Map<string, FileEdit[]>();
    for (const edit of edits) {
      if (!edit.filePath) continue;
      const relPath = relativizePath(edit.filePath, sessionDirectory);
      const list = grouped.get(relPath) || [];
      list.push({ ...edit, filePath: relPath });
      grouped.set(relPath, list);
    }

    const result: MergedFileDiff[] = [];
    for (const [filePath, fileEdits] of grouped) {
      result.push(mergeFileEdits(filePath, fileEdits));
    }
    return result;
  }, [edits, sessionDirectory]);

  const tree = useMemo(() => buildFileTree(mergedDiffs), [mergedDiffs]);

  const selectedDiff = useMemo(() => {
    const normalizePath = (p: string) => p.replace(/^\/+/, "");
    const normSelected = normalizePath(selectedPath);
    return mergedDiffs.find((d) => normalizePath(d.path) === normSelected);
  }, [mergedDiffs, selectedPath]);

  useEffect(() => {
    if (!selectedPath && mergedDiffs.length > 0) {
      setSelectedPath(mergedDiffs[0].path);
    }
  }, [mergedDiffs, selectedPath]);

  // Auto-select and highlight first diff file matching search query
  useEffect(() => {
    if (!searchHighlightQuery || mergedDiffs.length === 0) return;
    const q = searchHighlightQuery.toLowerCase();
    const match = mergedDiffs.find(
      (d) =>
        d.path.toLowerCase().includes(q) ||
        d.hunks.some((h) => h.lines.some((l) => l.text.toLowerCase().includes(q))),
    );
    if (match) {
      setSelectedPath(match.path);
    }
  }, [searchHighlightQuery, mergedDiffs]);

  const stats = useMemo(() => {
    let additions = 0,
      deletions = 0,
      added = 0,
      modified = 0,
      deleted = 0;
    for (const d of mergedDiffs) {
      additions += d.additions;
      deletions += d.deletions;
      if (d.status === "added") added++;
      else if (d.status === "deleted") deleted++;
      else modified++;
    }
    return { additions, deletions, added, modified, deleted };
  }, [mergedDiffs]);

  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rightPanelRef.current?.scrollTo(0, 0);
  }, [selectedPath]);

  if (loading && edits.length === 0) {
    return <LoadingState label="Loading diffs..." />;
  }

  if (mergedDiffs.length === 0) {
    return <EmptyPanel icon={<File size={20} />} title="No file changes in this session" />;
  }

  return (
    <div className="flex flex-col min-h-0" style={{ height: "100%" }}>
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-elevated border-b border-ov-border text-xs shrink-0">
        <button
          type="button"
          onClick={() => {
            setTreeCollapsed((v) => {
              const next = !v;
              try {
                localStorage.setItem(DIFF_TREE_COLLAPSED_KEY, String(next));
              } catch {
                /* */
              }
              return next;
            });
          }}
          className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
          title={treeCollapsed ? "Show file tree" : "Hide file tree"}
        >
          {treeCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
        <span className="font-semibold text-ov-text">
          {mergedDiffs.length} {mergedDiffs.length === 1 ? "file" : "files"} changed
        </span>
        {stats.additions > 0 && (
          <span className={`${DIFF_STATUS_COLORS.added.text} font-mono`}>+{stats.additions}</span>
        )}
        {stats.deletions > 0 && (
          <span className={`${DIFF_STATUS_COLORS.deleted.text} font-mono`}>-{stats.deletions}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-ov-text-secondary">
          <span className="flex items-center gap-1">
            <span className={`size-2.5 rounded-sm ${DIFF_STATUS_COLORS.added.bg}`} /> {stats.added}{" "}
            added
          </span>
          <span className="flex items-center gap-1">
            <span className={`size-2.5 rounded-sm ${DIFF_STATUS_COLORS.modified.bg}`} />{" "}
            {stats.modified} modified
          </span>
          {stats.deleted > 0 && (
            <span className="flex items-center gap-1">
              <span className={`size-2.5 rounded-sm ${DIFF_STATUS_COLORS.deleted.bg}`} />{" "}
              {stats.deleted} deleted
            </span>
          )}
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: File tree */}
        {!treeCollapsed && (
          <div
            className="overflow-y-auto overflow-x-hidden shrink-0 border-r border-ov-border"
            style={{ width: treeWidth }}
          >
            <FileTree nodes={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
          </div>
        )}

        {/* Resizable divider */}
        {!treeCollapsed && (
          <div
            className="w-1 cursor-col-resize shrink-0 bg-ov-border hover:bg-accent transition-colors relative"
            onMouseDown={startResize}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Right: Diff view */}
        <div ref={rightPanelRef} className="flex-1 overflow-y-auto min-w-0">
          {selectedDiff && selectedDiff.hunks.length > 0 ? (
            <div className="p-4 space-y-3">
              <div className="group flex items-center gap-2 pb-2 border-b border-ov-border">
                <File size={14} className="shrink-0 text-ov-text-secondary" />
                <span className="font-mono text-xs text-ov-text-secondary truncate min-w-0">
                  {sessionDirectory
                    ? `${sessionDirectory}/${selectedDiff.path}`
                    : selectedDiff.path}
                </span>
                <CopyButton
                  text={
                    sessionDirectory
                      ? `${sessionDirectory}/${selectedDiff.path}`
                      : selectedDiff.path
                  }
                  iconSize={12}
                />
              </div>
              {selectedDiff.hunks.map((hunk, i) => {
                const msgIdx = hunk.messageIndex;
                const prevMsgIdx = i > 0 ? selectedDiff.hunks[i - 1].messageIndex : -2;
                const showIndicator = msgIdx >= 0 && msgIdx !== prevMsgIdx && onNavigateToMessage;
                const edit = edits.find((e) => e.messageIndex === msgIdx);
                const msgId = edit?.messageId;
                return (
                  <div key={i}>
                    {showIndicator && (
                      <button
                        type="button"
                        onClick={() => onNavigateToMessage(msgIdx, msgId)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-ov-text-secondary/60 hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors w-full"
                        title={`Jump to message #${msgIdx + 1}`}
                      >
                        <MessageSquareText size={10} />
                        <span>Message #{msgIdx + 1}</span>
                        <ArrowRight size={10} />
                      </button>
                    )}
                    <HunkRenderer hunk={hunk} lang={detectLanguage(selectedDiff.path)} />
                  </div>
                );
              })}
            </div>
          ) : selectedDiff ? (
            <div className="flex items-center justify-center h-full text-sm text-ov-text-secondary">
              Patch content not available for this file
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-ov-text-secondary">
              <div className="text-center">
                <File size={32} className="mx-auto mb-2 opacity-40" />
                Select a file to view its changes
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
