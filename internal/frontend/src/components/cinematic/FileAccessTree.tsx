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
  Files,
} from "lucide-react";
import type { FileAccess } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";
import { EmptyPanel } from "../ui/EmptyPanel";

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

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return `${n}`;
}

interface FileAccessTreeProps {
  accesses: FileAccess[];
  selectedPath: string;
  onSelect: (path: string) => void;
  tokenTotals?: Map<string, { in: number; out: number }>;
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
  tokenTotals,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: () => void;
  depth: number;
  isFocused?: boolean;
  tokenTotals?: Map<string, { in: number; out: number }>;
}) {
  const accesses = node.accesses;
  const hasRead = accesses.some((a) => a.kind === "read");
  const hasEdit = accesses.some((a) => a.kind !== "read");
  const showBoth = hasRead && hasEdit;
  const firstKind = accesses[0]?.kind;
  const lastEdit = [...accesses].reverse().find((a) => a.kind !== "read");
  const editKind = lastEdit?.kind ?? "edit";
  const titleKind = showBoth ? `${firstKind}+${editKind}` : (accesses[0]?.kind ?? "");
  const titlePath = accesses[0]?.filePath ?? node.fullPath;
  const tokens = tokenTotals?.get(node.fullPath);
  const inTokens = tokens?.in ?? 0;
  const outTokens = tokens?.out ?? 0;
  const hasTokens = inTokens > 0 || outTokens > 0;
  return (
    <button
      type="button"
      data-tree-path={node.fullPath}
      data-tree-kind="file"
      className={`flex items-center gap-2 w-full text-left cursor-pointer transition-colors py-0.5 ${
        selected ? "bg-accent-muted" : isFocused ? "bg-ov-bg-hover" : "hover:bg-ov-bg-hover"
      } ${isFocused ? "ring-1 ring-accent/40" : ""}`}
      style={{ paddingLeft: 12 + depth * 16 }}
      onClick={onSelect}
      title={`${titleKind}: ${titlePath} — ${detectLanguage(titlePath)}`}
    >
      {showBoth ? (
        firstKind === "read" ? (
          <>
            {kindIcon("read")}
            {kindIcon(editKind)}
          </>
        ) : (
          <>
            {kindIcon(editKind)}
            {kindIcon("read")}
          </>
        )
      ) : (
        kindIcon(accesses[0]?.kind ?? "read")
      )}
      <span className="text-xs font-mono truncate min-w-0 text-ov-text">{node.name}</span>
      {hasTokens && (
        <span
          className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] font-mono pr-2"
          title={`tokens in: ${inTokens.toLocaleString()} / tokens out: ${outTokens.toLocaleString()}`}
        >
          {inTokens > 0 && <span className="text-emerald-500">+{formatCompact(inTokens)}</span>}
          {outTokens > 0 && <span className="text-amber-500">-{formatCompact(outTokens)}</span>}
        </span>
      )}
    </button>
  );
}

function FileAccessTreeInner({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
  expandedMap,
  onToggleDir,
  focusedPath,
  tokenTotals,
}: {
  nodes: TreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
  expandedMap: Record<string, boolean>;
  onToggleDir: (path: string) => void;
  focusedPath: string | null;
  tokenTotals?: Map<string, { in: number; out: number }>;
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
                className={`flex items-center gap-1 w-full px-1 py-1 text-left text-[11px] cursor-pointer transition-colors ${
                  isFocused
                    ? "bg-ov-bg-hover ring-1 ring-accent/40 text-ov-text"
                    : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
                }`}
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
                  tokenTotals={tokenTotals}
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
            tokenTotals={tokenTotals}
          />
        );
      })}
    </div>
  );
}

export function FileAccessTree({
  accesses,
  selectedPath,
  onSelect,
  tokenTotals,
}: FileAccessTreeProps) {
  const tree = useMemo(() => buildTree(accesses), [accesses]);

  const treeSummary = useMemo(() => {
    const fileMap = new Map<string, FileAccess[]>();
    for (const a of accesses) {
      const list = fileMap.get(a.filePath) ?? [];
      list.push(a);
      fileMap.set(a.filePath, list);
    }
    let reads = 0;
    let edits = 0;
    for (const [, list] of fileMap) {
      if (list.some((a) => a.kind === "read")) reads++;
      if (list.some((a) => a.kind !== "read")) edits++;
    }
    return { reads, edits, total: fileMap.size };
  }, [accesses]);

  const allDirPaths = useMemo(() => collectAllDirectoryPaths(tree), [tree]);

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const p of allDirPaths) init[p] = true;
    return init;
  });

  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpandedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of allDirPaths) next[p] = prev[p] !== undefined ? prev[p] : true;
      return next;
    });
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

  const prevSelectedRef = useRef(selectedPath);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedPath && selectedPath) {
      if (visibleFlattened.some((v) => v.node.fullPath === selectedPath)) {
        setFocusedPath(selectedPath);
      }
    }
    prevSelectedRef.current = selectedPath;
  }, [selectedPath, visibleFlattened]);

  const scrollFocusedIntoView = useCallback((path: string) => {
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(
        `[data-tree-path="${CSS.escape(path)}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleFlattened.length === 0) return;
      let currentIdx = focusedPath
        ? visibleFlattened.findIndex((v) => v.node.fullPath === focusedPath)
        : -1;
      if (currentIdx === -1 && selectedPath) {
        currentIdx = visibleFlattened.findIndex((v) => v.node.fullPath === selectedPath);
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIdx < visibleFlattened.length - 1 ? currentIdx + 1 : currentIdx;
        const next = visibleFlattened[nextIdx];
        if (next) {
          setFocusedPath(next.node.fullPath);
          if (!next.node.isDirectory) onSelect(next.node.fullPath);
          scrollFocusedIntoView(next.node.fullPath);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0;
        const prev = visibleFlattened[prevIdx];
        if (prev) {
          setFocusedPath(prev.node.fullPath);
          if (!prev.node.isDirectory) onSelect(prev.node.fullPath);
          scrollFocusedIntoView(prev.node.fullPath);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const cur = currentIdx >= 0 ? visibleFlattened[currentIdx] : null;
        if (cur?.node.isDirectory) {
          if (!expandedMap[cur.node.fullPath]) {
            setExpandedMap((prev) => ({ ...prev, [cur.node.fullPath]: true }));
          } else {
            const next = visibleFlattened[currentIdx + 1];
            if (next && next.depth > cur.depth) {
              setFocusedPath(next.node.fullPath);
              if (!next.node.isDirectory) onSelect(next.node.fullPath);
            }
          }
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = currentIdx >= 0 ? visibleFlattened[currentIdx] : null;
        if (cur?.node.isDirectory && expandedMap[cur.node.fullPath] !== false) {
          setExpandedMap((prev) => ({ ...prev, [cur.node.fullPath]: false }));
        } else if (cur) {
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
    [visibleFlattened, focusedPath, selectedPath, expandedMap, onSelect, scrollFocusedIntoView],
  );

  if (accesses.length === 0) {
    return (
      <EmptyPanel
        icon={<Files size={20} />}
        title="No file reads or edits in visible range"
        hint="Scrub the timeline to reveal earlier file activity."
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-ov-bg-sidebar">
      <div className="h-10 px-3 border-b border-ov-border bg-surface-elevated text-[11px] flex items-center gap-2 shrink-0">
        <span className="font-semibold text-ov-text">
          {treeSummary.total} {treeSummary.total === 1 ? "file" : "files"}
        </span>
        <span className="text-yellow-500">{treeSummary.edits} edits</span>
        <span className="text-cyan-400">{treeSummary.reads} reads</span>
        <button
          type="button"
          onClick={() => (isAllExpanded ? handleCollapseAll() : handleExpandAll())}
          className="ml-auto size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          title={isAllExpanded ? "Collapse all" : "Expand all"}
          aria-label={isAllExpanded ? "Collapse all directories" : "Expand all directories"}
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
            setFocusedPath(selectedPath || visibleFlattened[0].node.fullPath);
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
          tokenTotals={tokenTotals}
        />
      </div>
    </div>
  );
}
