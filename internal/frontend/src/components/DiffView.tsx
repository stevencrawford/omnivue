import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileEdit } from "../hooks/useApi";
import { fetchEdits } from "../hooks/useApi";
import { useTheme } from "../hooks/useTheme";

interface DiffViewProps {
  sessionId: string;
  sessionDirectory?: string;
}

interface MergedFileDiff {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
}

interface ExtractedHunk {
  deletionStart: number;
  deletionCount: number;
  additionStart: number;
  additionCount: number;
  lines: string[];
}

interface FileTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: FileTreeNode[];
  diff?: MergedFileDiff;
  depth: number;
}

const DIFF_TREE_WIDTH_KEY = "sess-diff-tree-width";

function extractHunks(
  filePath: string,
  oldContent: string,
  newContent: string,
  lang: string,
): ExtractedHunk[] {
  try {
    const meta = parseDiffFromFile(
      { name: filePath, contents: oldContent, lang },
      { name: filePath, contents: newContent, lang },
    );

    const result: ExtractedHunk[] = [];
    for (const hunk of meta.hunks) {
      const lines: string[] = [];
      const delLines = meta.deletionLines;
      const addLines = meta.additionLines;
      let delIdx = hunk.deletionLineIndex;
      let addIdx = hunk.additionLineIndex;

      let header = `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
      if (hunk.hunkContext) header += " " + hunk.hunkContext;
      lines.push(header);

      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let i = 0; i < content.lines; i++) {
            lines.push(" " + delLines[delIdx]);
            delIdx++;
            addIdx++;
          }
        } else {
          for (let i = 0; i < content.deletions; i++) {
            lines.push("-" + delLines[delIdx]);
            delIdx++;
          }
          for (let i = 0; i < content.additions; i++) {
            lines.push("+" + addLines[addIdx]);
            addIdx++;
          }
        }
      }

      result.push({
        deletionStart: hunk.deletionStart,
        deletionCount: hunk.deletionCount,
        additionStart: hunk.additionStart,
        additionCount: hunk.additionCount,
        lines,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    json: "json", md: "markdown", css: "css", html: "html",
    go: "go", py: "python", rs: "rust", rb: "ruby",
    java: "java", yml: "yaml", yaml: "yaml", toml: "toml",
    sh: "shellscript", bash: "shellscript", sql: "sql",
    graphql: "graphql", vue: "vue", svelte: "svelte",
    c: "c", cpp: "cpp", h: "c",
  };
  return langMap[ext] || "";
}

function mergeFileEdits(filePath: string, edits: FileEdit[]): MergedFileDiff {
  const allHunks: ExtractedHunk[] = [];
  let isNew = false;
  const lang = detectLanguage(filePath);

  for (const edit of edits) {
    if (edit.toolName === "write" && edit.content && !edit.oldStr) {
      isNew = true;
      const lines = edit.content.split("\n");
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
      });
      continue;
    }

    if (!edit.oldStr && !edit.newStr) continue;

    const oldContent = edit.oldStr || "";
    const newContent = edit.newStr || edit.content || "";
    const hunks = extractHunks(filePath, oldContent, newContent, lang);
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
  if (merged.length > 0) {
    patch = `--- a/${filePath}\n+++ b/${filePath}\n`;
    for (const hunk of merged) {
      patch += hunk.lines.join("\n") + "\n";
    }
  }

  return {
    path: filePath,
    status: isNew ? "added" : "modified",
    additions: totalAdditions,
    deletions: totalDeletions,
    patch,
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
    case "added": return { letter: "A", color: "text-green-500" };
    case "deleted": return { letter: "D", color: "text-red-500" };
    default: return { letter: "M", color: "text-yellow-500" };
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
        selected ? "bg-accent-muted" : "hover:bg-gh-bg-hover"
      }`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={onSelect}
    >
      <span className={`text-[11px] font-bold shrink-0 ${statusConfig.color}`}>
        {statusConfig.letter}
      </span>
      <span className="text-xs font-mono truncate min-w-0">
        <span className="text-gh-text font-medium">{fileName}</span>
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
        className="flex items-center gap-1 w-full px-1 py-1 text-left text-[11px] text-gh-text-secondary hover:text-gh-text cursor-pointer transition-colors hover:bg-gh-bg-hover"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
        </svg>
        <span className="font-medium truncate">{node.name}/</span>
        <span className="text-[10px] text-gh-text-secondary/60">({fileCount})</span>
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

export function DiffView({ sessionId, sessionDirectory }: DiffViewProps) {
  const { theme } = useTheme();
  const [edits, setEdits] = useState<FileEdit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>("");
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
  }, [sessionId]);

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

  const selectedDiff = useMemo(
    () => mergedDiffs.find((d) => d.path === selectedPath),
    [mergedDiffs, selectedPath],
  );

  useEffect(() => {
    if (!selectedPath && mergedDiffs.length > 0) {
      setSelectedPath(mergedDiffs[0].path);
    }
  }, [mergedDiffs, selectedPath]);

  const stats = useMemo(() => {
    let additions = 0, deletions = 0, added = 0, modified = 0, deleted = 0;
    for (const d of mergedDiffs) {
      additions += d.additions;
      deletions += d.deletions;
      if (d.status === "added") added++;
      else if (d.status === "deleted") deleted++;
      else modified++;
    }
    return { additions, deletions, added, modified, deleted };
  }, [mergedDiffs]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = treeWidthRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem(DIFF_TREE_WIDTH_KEY, String(treeWidthRef.current));
      } catch {
        /* */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-gh-text-secondary">
        <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading diffs...
      </div>
    );
  }

  if (mergedDiffs.length === 0) {
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

  return (
    <div className="flex flex-col min-h-0" style={{ height: "100%" }}>
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-elevated border-b border-gh-border text-xs shrink-0">
        <span className="font-semibold text-gh-text">
          {mergedDiffs.length} {mergedDiffs.length === 1 ? "file" : "files"} changed
        </span>
        {stats.additions > 0 && (
          <span className="text-green-500 font-mono">+{stats.additions}</span>
        )}
        {stats.deletions > 0 && (
          <span className="text-red-500 font-mono">-{stats.deletions}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-gh-text-secondary">
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
        <div
          className="overflow-y-auto overflow-x-hidden shrink-0 border-r border-gh-border"
          style={{ width: treeWidth }}
        >
          <FileTree
            nodes={tree}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        </div>

        {/* Resizable divider */}
        <div
          className="w-1 cursor-col-resize shrink-0 bg-gh-border hover:bg-accent transition-colors relative"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Right: Diff view */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {selectedDiff && selectedDiff.patch ? (
            <div className="p-4">
              <PatchDiff
                key={theme}
                patch={selectedDiff.patch}
                options={{
                  theme: { light: "github-light", dark: "github-dark" },
                  diffStyle: "unified",
                  disableFileHeader: false,
                }}
              />
            </div>
          ) : selectedDiff ? (
            <div className="flex items-center justify-center h-full text-sm text-gh-text-secondary">
              Patch content not available for this file
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gh-text-secondary">
              <div className="text-center">
                <svg className="size-8 mx-auto mb-2 opacity-40" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2Z" />
                </svg>
                Select a file to view its changes
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
