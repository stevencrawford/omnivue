import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronRight,
  Folder,
  FilePlus,
  FilePen,
  BookOpen,
  Trash2,
  UnfoldVertical,
  FoldVertical,
} from "lucide-react";
import type { FileAccess } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";

interface TreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
  access?: FileAccess;
  accesses: FileAccess[];
  depth: number;
}

function buildTree(accesses: FileAccess[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const acc of accesses) {
    const parts = acc.filePath.replace(/^\/+/, "").split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.name === part && n.isDirectory !== isLast);
      if (!existing) existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          fullPath,
          isDirectory: !isLast,
          children: [],
          depth: i,
          accesses: [],
        };
        current.push(existing);
      }
      if (isLast) {
        existing.isDirectory = false;
        existing.access = acc;
        existing.accesses.push(acc);
      }
      current = existing.children;
    }
  }
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children.length) sortNodes(n.children);
  }
  sortNodes(root);
  flattenDirectoryChains(root);
  return root;
}

function flattenDirectoryChains(nodes: TreeNode[]): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      flattenDirectoryChains(node.children);
      while (node.children.length === 1 && node.children[0].isDirectory) {
        const child = node.children[0];
        node.name = node.name + "/" + child.name;
        node.fullPath = child.fullPath;
        node.children = child.children;
        for (const c of node.children) c.depth = node.depth + 1;
      }
    }
  }
}

function kindIcon(kind: string) {
  if (kind === "read") return <BookOpen size={12} className="text-cyan-400 shrink-0" />;
  if (kind === "delete") return <Trash2 size={12} className="text-red-400 shrink-0" />;
  if (kind === "write") return <FilePlus size={12} className="text-green-400 shrink-0" />;
  if (kind === "edit") return <FilePen size={12} className="text-yellow-400 shrink-0" />;
  return <FilePlus size={12} className="text-accent shrink-0" />;
}

function kindLetter(kind: string): { letter: string; color: string } {
  if (kind === "read") return { letter: "R", color: "text-cyan-400" };
  if (kind === "delete") return { letter: "D", color: "text-red-400" };
  if (kind === "write") return { letter: "A", color: "text-green-500" };
  return { letter: "M", color: "text-yellow-500" };
}

interface FileAccessTreeProps {
  accesses: FileAccess[];
  selectedPath: string;
  onSelect: (path: string) => void;
}

function collectAllDirectoryPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isDirectory) {
      out.push(n.fullPath);
      collectAllDirectoryPaths(n.children, out);
    }
  }
  return out;
}

function flattenVisibleNodes(
  nodes: TreeNode[],
  expandedMap: Record<string, boolean>,
  out: { node: TreeNode; depth: number }[] = [],
  depth = 0,
): { node: TreeNode; depth: number }[] {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.isDirectory && expandedMap[n.fullPath] !== false) {
      flattenVisibleNodes(n.children, expandedMap, out, depth + 1);
    }
  }
  return out;
}

function TreeFileRow({
  node,
  selected,
  onSelect,
  depth,
  isFocused,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: () => void;
  depth: number;
  isFocused?: boolean;
}) {
  const acc = node.access!;
  const info = kindLetter(acc.kind);
  return (
    <button
      type="button"
      data-tree-path={node.fullPath}
      data-tree-kind="file"
      className={`flex items-center gap-2 w-full text-left cursor-pointer py-0.5 ${selected ? "bg-accent-muted" : isFocused ? "bg-ov-bg-hover" : "hover:bg-ov-bg-hover"} ${isFocused ? "ring-1 ring-accent/40" : ""}`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={onSelect}
      title={`${acc.kind}: ${acc.filePath} — ${detectLanguage(acc.filePath)}`}
    >
      <span className={`text-[11px] font-bold shrink-0 ${info.color}`}>{info.letter}</span>
      {kindIcon(acc.kind)}
      <span className="text-xs font-mono truncate min-w-0 text-ov-text">{node.name}</span>
    </button>
  );
}

// Inner component that respects centralized expandedMap
function FileAccessTreeInner({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
  expandedMap,
  onToggleDir,
  focusedPath,
}: {
  nodes: TreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
  expandedMap: Record<string, boolean>;
  onToggleDir: (path: string) => void;
  focusedPath: string | null;
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.isDirectory) {
          const expanded = expandedMap[node.fullPath] !== false;
          const isFocused = focusedPath === node.fullPath;
          return (
            <div key={node.fullPath}>
              <button
                type="button"
                data-tree-path={node.fullPath}
                data-tree-kind="dir"
                className={`flex items-center gap-1 w-full px-1 py-1 text-left text-[11px] cursor-pointer ${isFocused ? "bg-ov-bg-hover ring-1 ring-accent/40 text-ov-text" : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"}`}
                style={{ paddingLeft: 8 + depth * 16 }}
                onClick={() => onToggleDir(node.fullPath)}
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                />
                <Folder size={14} className="shrink-0" />
                <span className="font-medium truncate">{node.name}/</span>
              </button>
              {expanded && (
                <FileAccessTreeInner
                  nodes={node.children}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  depth={depth + 1}
                  expandedMap={expandedMap}
                  onToggleDir={onToggleDir}
                  focusedPath={focusedPath}
                />
              )}
            </div>
          );
        }
        if (!node.access) return null;
        const isFocused = focusedPath === node.fullPath;
        return (
          <TreeFileRow
            key={node.fullPath}
            node={node}
            selected={selectedPath === node.fullPath}
            onSelect={() => onSelect(node.fullPath)}
            depth={depth}
            isFocused={isFocused}
          />
        );
      })}
    </div>
  );
}

export function FileAccessTree({ accesses, selectedPath, onSelect }: FileAccessTreeProps) {
  const tree = useMemo(() => buildTree(accesses), [accesses]);

  const treeSummary = useMemo(() => {
    let reads = 0,
      edits = 0;
    for (const a of accesses) {
      if (a.kind === "read") reads++;
      else edits++;
    }
    return { reads, edits, total: accesses.length };
  }, [accesses]);

  const allDirPaths = useMemo(() => collectAllDirectoryPaths(tree), [tree]);

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const p of allDirPaths) init[p] = true;
    return init;
  });

  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep expandedMap in sync when tree changes (new dirs default expanded)
  useEffect(() => {
    setExpandedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of allDirPaths) next[p] = prev[p] !== undefined ? prev[p] : true;
      return next;
    });
    // also set focused to selectedPath if not set
    if (selectedPath && !focusedPath) setFocusedPath(selectedPath);
  }, [allDirPaths, selectedPath, focusedPath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedMap((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const handleExpandAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const p of allDirPaths) next[p] = true;
    setExpandedMap(next);
  }, [allDirPaths]);

  const handleCollapseAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const p of allDirPaths) next[p] = false;
    setExpandedMap(next);
  }, [allDirPaths]);

  const isAllExpanded = useMemo(() => {
    if (allDirPaths.length === 0) return true;
    return allDirPaths.every((p) => expandedMap[p] !== false);
  }, [allDirPaths, expandedMap]);

  const visibleFlattened = useMemo(
    () => flattenVisibleNodes(tree, expandedMap),
    [tree, expandedMap],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleFlattened.length === 0) return;
      const currentIdx = focusedPath
        ? visibleFlattened.findIndex((v) => v.node.fullPath === focusedPath)
        : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIdx < visibleFlattened.length - 1 ? currentIdx + 1 : currentIdx;
        const next = visibleFlattened[nextIdx];
        if (next) {
          setFocusedPath(next.node.fullPath);
          if (!next.node.isDirectory) onSelect(next.node.fullPath);
          // ensure visible
          requestAnimationFrame(() => {
            const el = containerRef.current?.querySelector(
              `[data-tree-path="${CSS.escape(next.node.fullPath)}"]`,
            ) as HTMLElement | null;
            el?.scrollIntoView({ block: "nearest" });
          });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0;
        const prev = visibleFlattened[prevIdx];
        if (prev) {
          setFocusedPath(prev.node.fullPath);
          if (!prev.node.isDirectory) onSelect(prev.node.fullPath);
          requestAnimationFrame(() => {
            const el = containerRef.current?.querySelector(
              `[data-tree-path="${CSS.escape(prev.node.fullPath)}"]`,
            ) as HTMLElement | null;
            el?.scrollIntoView({ block: "nearest" });
          });
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const cur = currentIdx >= 0 ? visibleFlattened[currentIdx] : null;
        if (cur && cur.node.isDirectory) {
          if (!expandedMap[cur.node.fullPath]) {
            setExpandedMap((prev) => ({ ...prev, [cur.node.fullPath]: true }));
          } else {
            // if already expanded, move to first child
            const nextIdx = currentIdx + 1;
            const next = visibleFlattened[nextIdx];
            if (next && next.depth > cur.depth) {
              setFocusedPath(next.node.fullPath);
              if (!next.node.isDirectory) onSelect(next.node.fullPath);
            }
          }
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = currentIdx >= 0 ? visibleFlattened[currentIdx] : null;
        if (cur && cur.node.isDirectory && expandedMap[cur.node.fullPath] !== false) {
          setExpandedMap((prev) => ({ ...prev, [cur.node.fullPath]: false }));
        } else if (cur) {
          // move to parent
          let parentIdx = currentIdx - 1;
          while (parentIdx >= 0) {
            const cand = visibleFlattened[parentIdx];
            if (cand && cand.depth < cur.depth) {
              setFocusedPath(cand.node.fullPath);
              break;
            }
            parentIdx--;
          }
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const cur = currentIdx >= 0 ? visibleFlattened[currentIdx] : null;
        if (cur) {
          if (cur.node.isDirectory) {
            setExpandedMap((prev) => ({ ...prev, [cur.node.fullPath]: !prev[cur.node.fullPath] }));
          } else {
            onSelect(cur.node.fullPath);
          }
        }
      }
    },
    [visibleFlattened, focusedPath, expandedMap, onSelect],
  );

  if (accesses.length === 0) {
    return (
      <div className="p-4 text-xs text-ov-text-secondary text-center">
        No file reads or edits in visible range
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-ov-border bg-surface-elevated text-[11px] flex items-center gap-2 shrink-0">
        <span className="font-semibold text-ov-text">
          {treeSummary.total} {treeSummary.total === 1 ? "file" : "files"}
        </span>
        <span className="text-yellow-500">{treeSummary.edits} edits</span>
        <span className="text-cyan-400">{treeSummary.reads} reads</span>
        <button
          type="button"
          onClick={() => (isAllExpanded ? handleCollapseAll() : handleExpandAll())}
          className="ml-auto size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer"
          title={isAllExpanded ? "Collapse all" : "Expand all"}
        >
          {isAllExpanded ? <FoldVertical size={14} /> : <UnfoldVertical size={14} />}
        </button>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        role="tree"
        aria-label="File tree"
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (!focusedPath && visibleFlattened.length > 0) {
            const sel = selectedPath || visibleFlattened[0].node.fullPath;
            setFocusedPath(sel);
          }
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        <FileAccessTreeInner
          nodes={tree}
          selectedPath={selectedPath}
          onSelect={(p) => {
            onSelect(p);
            setFocusedPath(p);
          }}
          expandedMap={expandedMap}
          onToggleDir={toggleDir}
          focusedPath={focusedPath}
        />
      </div>
    </div>
  );
}
