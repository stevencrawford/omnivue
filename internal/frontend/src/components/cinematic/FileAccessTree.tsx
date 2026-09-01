import { useMemo, useState } from "react";
import { ChevronRight, Folder, FilePlus, FilePen, BookOpen, Trash2 } from "lucide-react";
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

function TreeFileRow({
  node,
  selected,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: () => void;
  depth: number;
}) {
  const acc = node.access!;
  const info = kindLetter(acc.kind);
  return (
    <button
      type="button"
      className={`flex items-center gap-2 w-full text-left cursor-pointer py-0.5 ${selected ? "bg-accent-muted" : "hover:bg-ov-bg-hover"}`}
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

function DirectoryNode({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const count = useMemo(() => {
    let c = 0;
    const walk = (n: TreeNode) => {
      for (const ch of n.children) {
        if (!ch.isDirectory) c++;
        walk(ch);
      }
    };
    walk(node);
    return c;
  }, [node]);
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 w-full px-1 py-1 text-left text-[11px] text-ov-text-secondary hover:text-ov-text cursor-pointer hover:bg-ov-bg-hover"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Folder size={14} className="shrink-0" />
        <span className="font-medium truncate">{node.name}/</span>
        <span className="text-[10px] text-ov-text-secondary/60">({count})</span>
      </button>
      {expanded && (
        <FileAccessTreeInner
          nodes={node.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

function FileAccessTreeInner({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
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
        if (!node.access) return null;
        return (
          <TreeFileRow
            key={node.fullPath}
            node={node}
            selected={selectedPath === node.fullPath}
            onSelect={() => onSelect(node.fullPath)}
            depth={depth}
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
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <FileAccessTreeInner nodes={tree} selectedPath={selectedPath} onSelect={onSelect} />
      </div>
    </div>
  );
}
