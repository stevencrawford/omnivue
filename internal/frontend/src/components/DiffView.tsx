import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  File,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquareText,
  ArrowRight,
} from "lucide-react";
import type { FileEdit } from "../hooks/useApi";
import { fetchEdits } from "../hooks/useApi";
import { computeDiff } from "../utils/diff";
import { PatchRenderer } from "./DiffRenderer";
import { CopyButton } from "./CopyButton";
import { detectLanguage } from "../utils/detectLanguage";

interface DiffViewProps {
  sessionId: string;
  sessionDirectory?: string;
  refreshKey: number;
  searchHighlightQuery?: string | null;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}

interface MergedFileDiff {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
  perHunkPatches: string[];
  perHunkMessageIndices: number[];
}

interface ExtractedHunk {
  deletionStart: number;
  deletionCount: number;
  additionStart: number;
  additionCount: number;
  lines: string[];
  messageIndex: number;
}

interface FileTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: FileTreeNode[];
  diff?: MergedFileDiff;
  depth: number;
}

const DIFF_TREE_WIDTH_KEY = "omnivue-diff-tree-width";

function extractHunks(
  _filePath: string,
  oldContent: string,
  newContent: string,
  _lang: string,
  messageIndex: number,
): ExtractedHunk[] {
  try {
    const hunks = computeDiff(oldContent, newContent);
    return hunks.map((h) => ({ ...h, messageIndex }));
  } catch {
    return [];
  }
}

function mergeFileEdits(filePath: string, edits: FileEdit[]): MergedFileDiff {
  const allHunks: ExtractedHunk[] = [];
  let isNew = false;
  const lang = detectLanguage(filePath);

  for (const edit of edits) {
    const mi = edit.messageIndex ?? -1;
    const body = edit.newStr || edit.content || "";
    if (body && !edit.oldStr) {
      isNew = true;
      if (body.startsWith("@@")) {
        const lines = body.split("\n");
        allHunks.push({
          deletionStart: 0,
          deletionCount: 0,
          additionStart: 1,
          additionCount: 0,
          lines,
          messageIndex: mi,
        });
      } else {
        const lines = body.split("\n");
        const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
        if (count === 0) continue;
        const hunkLines: string[] = [`@@ -0,0 +1,${count} @@`];
        for (const l of lines.slice(0, count)) {
          hunkLines.push("+" + l);
        }
        allHunks.push({
          deletionStart: 0,
          deletionCount: 0,
          additionStart: 1,
          additionCount: count,
          lines: hunkLines,
          messageIndex: mi,
        });
      }
      continue;
    }

    if (!edit.oldStr && !edit.newStr) continue;

    const oldContent = edit.oldStr || "";
    const newContent = edit.newStr || edit.content || "";
    const hunks = extractHunks(filePath, oldContent, newContent, lang, mi);
    allHunks.push(...hunks);
  }

  allHunks.sort((a, b) => a.deletionStart - b.deletionStart);

  const merged = allHunks;

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const hunk of merged) {
    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("++")) totalAdditions++;
      else if (line.startsWith("-") && !line.startsWith("--")) totalDeletions++;
    }
  }

  let patch = "";
  const perHunkPatches: string[] = [];
  const perHunkMessageIndices: number[] = [];
  if (merged.length > 0) {
    const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
    for (const hunk of merged) {
      const hunkPatch = header + hunk.lines.join("\n") + "\n";
      patch += hunk.lines.join("\n") + "\n";
      perHunkPatches.push(hunkPatch);
      perHunkMessageIndices.push(hunk.messageIndex);
    }
    patch = header + patch;
  }

  return {
    path: filePath,
    status: isNew ? "added" : "modified",
    additions: totalAdditions,
    deletions: totalDeletions,
    patch,
    perHunkPatches,
    perHunkMessageIndices,
  };
}

function flattenDirectoryChains(nodes: FileTreeNode[]): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      flattenDirectoryChains(node.children);

      while (node.children.length === 1 && node.children[0].isDirectory) {
        const child = node.children[0];
        node.name = node.name + "/" + child.name;
        node.fullPath = child.fullPath;
        node.children = child.children;
        for (const c of node.children) {
          c.depth = node.depth + 1;
        }
      }
    }
  }
}

function buildFileTree(diffs: MergedFileDiff[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const diff of diffs) {
    const parts = diff.path.replace(/^\/+/, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          fullPath,
          isDirectory: !isLast,
          children: [],
          depth: i,
        };
        current.push(existing);
      }

      if (isLast) {
        existing.isDirectory = false;
        existing.diff = diff;
      }

      current = existing.children;
    }
  }

  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }

  sortNodes(root);
  flattenDirectoryChains(root);
  return root;
}

function computeFileStatus(diff?: MergedFileDiff): { letter: string; color: string } {
  if (!diff) return { letter: "", color: "" };
  switch (diff.status) {
    case "added":
      return { letter: "A", color: "text-green-500" };
    case "deleted":
      return { letter: "D", color: "text-red-500" };
    default:
      return { letter: "M", color: "text-yellow-500" };
  }
}

function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function FileTreeFileRow({
  diff,
  selected,
  onSelect,
  depth,
}: {
  diff: MergedFileDiff;
  selected: boolean;
  onSelect: () => void;
  depth: number;
}) {
  const statusConfig = computeFileStatus(diff);
  const fileName = getFileName(diff.path);

  return (
    <button
      type="button"
      className={`flex items-center gap-2 w-full text-left cursor-pointer transition-colors py-0.5 ${
        selected ? "bg-accent-muted" : "hover:bg-ov-bg-hover"
      }`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={onSelect}
    >
      <span className={`text-[11px] font-bold shrink-0 ${statusConfig.color}`}>
        {statusConfig.letter}
      </span>
      <span className="text-xs font-mono truncate min-w-0">
        <span className="text-ov-text font-medium">{fileName}</span>
      </span>
      {(diff.additions > 0 || diff.deletions > 0) && (
        <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] font-mono pr-2">
          {diff.additions > 0 && <span className="text-green-500">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="text-red-500">-{diff.deletions}</span>}
        </span>
      )}
    </button>
  );
}

function FileTree({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.isDirectory) {
          return (
            <DirectoryNode
              key={node.fullPath}
              node={node}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth}
            />
          );
        }
        if (!node.diff) return null;
        return (
          <FileTreeFileRow
            key={node.fullPath}
            diff={node.diff}
            selected={selectedPath === node.fullPath}
            onSelect={() => onSelect(node.fullPath)}
            depth={depth}
          />
        );
      })}
    </div>
  );
}

function DirectoryNode({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  const fileCount = useMemo(() => {
    let count = 0;
    function walk(nodes: FileTreeNode[]) {
      for (const n of nodes) {
        if (!n.isDirectory) count++;
        walk(n.children);
      }
    }
    walk(node.children);
    return count;
  }, [node.children]);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 w-full px-1 py-1 text-left text-[11px] text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors hover:bg-ov-bg-hover"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Folder size={14} className="shrink-0" />
        <span className="font-medium truncate">{node.name}/</span>
        <span className="text-[10px] text-ov-text-secondary/60">({fileCount})</span>
      </button>
      {expanded && (
        <FileTree
          nodes={node.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

function relativizePath(filePath: string, directory: string | undefined): string {
  if (!directory) return filePath;
  const dir = directory.endsWith("/") ? directory : directory + "/";
  if (filePath.startsWith(dir)) {
    return filePath.slice(dir.length);
  }
  return filePath;
}

const DIFF_TREE_COLLAPSED_KEY = "omnivue-diff-tree-collapsed";

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
  const [treeWidth, setTreeWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(DIFF_TREE_WIDTH_KEY);
      if (stored) return Math.max(200, Math.min(600, Number(stored)));
    } catch {
      /* */
    }
    return 280;
  });
  const treeWidthRef = useRef(treeWidth);
  treeWidthRef.current = treeWidth;
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEdits(sessionId);
      setEdits(data || []);
    } catch (err) {
      console.error("Failed to load edits:", err);
      setEdits([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, refreshKey]);

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
      (d) => d.path.toLowerCase().includes(q) || d.patch.toLowerCase().includes(q),
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

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];

    const startX = e.clientX;
    const startWidth = treeWidthRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      resizeListeners.current = [];
      try {
        localStorage.setItem(DIFF_TREE_WIDTH_KEY, String(treeWidthRef.current));
      } catch {
        /* */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  }, []);

  if (loading && edits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-ov-text-secondary">
        <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading diffs...
      </div>
    );
  }

  if (mergedDiffs.length === 0) {
    return (
      <div className="sess-empty-state p-8 h-full">
        <div className="sess-empty-icon">
          <File size={20} />
        </div>
        <p className="text-sm text-ov-text-secondary">No file changes in this session</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0" style={{ height: "100%" }}>
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-elevated border-b border-ov-border text-xs shrink-0">
        <span className="font-semibold text-ov-text">
          {mergedDiffs.length} {mergedDiffs.length === 1 ? "file" : "files"} changed
        </span>
        {stats.additions > 0 && (
          <span className="text-green-500 font-mono">+{stats.additions}</span>
        )}
        {stats.deletions > 0 && <span className="text-red-500 font-mono">-{stats.deletions}</span>}
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
          className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          title={treeCollapsed ? "Show file tree" : "Hide file tree"}
        >
          {treeCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-ov-text-secondary">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-green-500" /> {stats.added} added
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-yellow-500" /> {stats.modified} modified
          </span>
          {stats.deleted > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-red-500" /> {stats.deleted} deleted
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
            onMouseDown={handleResizeStart}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Right: Diff view */}
        <div ref={rightPanelRef} className="flex-1 overflow-y-auto min-w-0">
          {selectedDiff && selectedDiff.patch ? (
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
              {selectedDiff.perHunkPatches.map((hunkPatch, i) => {
                const msgIdx = selectedDiff.perHunkMessageIndices[i];
                const prevMsgIdx = i > 0 ? selectedDiff.perHunkMessageIndices[i - 1] : -2;
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
                    <PatchRenderer patch={hunkPatch} lang={detectLanguage(selectedDiff.path)} />
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
