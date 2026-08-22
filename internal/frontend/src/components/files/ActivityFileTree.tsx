import { useMemo, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import type { FileGraphNode } from "../../hooks/types";

interface ActivityTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: ActivityTreeNode[];
  file?: FileGraphNode;
}

interface ActivityFileTreeProps {
  nodes: FileGraphNode[];
  /** Prefix stripped from paths for display (the repo's working directory). */
  baseDir?: string;
  selectedPath: string;
  onSelect: (path: string) => void;
}

function relativize(path: string, baseDir?: string): string {
  if (!baseDir) return path.replace(/^\/+/, "");
  const dir = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return path.startsWith(dir) ? path.slice(dir.length) : path.replace(/^\/+/, "");
}

function buildActivityTree(entries: { full: string; rel: string; file: FileGraphNode }[]) {
  const root: ActivityTreeNode[] = [];
  for (const { full, rel, file } of entries) {
    const parts = rel.split("/");
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
        };
        current.push(existing);
      }
      if (isLast) {
        existing.isDirectory = false;
        existing.file = file;
        // fullPath built from the relative display path is the tree identity;
        // keep the original path for selection/detail loading.
        existing.fullPath = full;
      }
      current = existing.children;
    }
  }

  function sortNodes(list: ActivityTreeNode[]) {
    list.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of list) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }
  sortNodes(root);

  // Collapse single-directory chains (a/src/b -> src/b) like DiffView's tree.
  function flattenChains(list: ActivityTreeNode[]) {
    for (const node of list) {
      if (!node.isDirectory) continue;
      flattenChains(node.children);
      while (node.children.length === 1 && node.children[0].isDirectory) {
        const child = node.children[0];
        node.name = `${node.name}/${child.name}`;
        node.fullPath = child.fullPath;
        node.children = child.children;
      }
    }
  }
  flattenChains(root);

  return root;
}

function countFiles(node: ActivityTreeNode): number {
  let count = 0;
  const walk = (list: ActivityTreeNode[]) => {
    for (const n of list) {
      if (!n.isDirectory) count++;
      walk(n.children);
    }
  };
  walk(node.children);
  return count;
}

function DirectoryRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: ActivityTreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1 px-1 py-1 text-left text-[11px] text-ov-text-secondary transition-colors hover:bg-ov-bg-hover hover:text-ov-text"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Folder size={14} className="shrink-0" />
        <span className="truncate font-medium">{node.name}/</span>
        <span className="text-[10px] text-ov-text-secondary/60">({countFiles(node)})</span>
      </button>
      {expanded && (
        <ActivityTreeRows
          nodes={node.children}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function TouchBadge({ reads, writes }: { reads: number; writes: number }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-2 font-mono text-[10px]">
      {reads > 0 && (
        <span title={`${reads} reads`} className="text-cyan-500">
          {reads}R
        </span>
      )}
      {writes > 0 && (
        <span title={`${writes} writes`} className="text-amber-500">
          {writes}W
        </span>
      )}
    </span>
  );
}

function ActivityTreeRows({
  nodes,
  depth,
  selectedPath,
  onSelect,
}: {
  nodes: ActivityTreeNode[];
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.isDirectory ? (
          <DirectoryRow
            key={node.fullPath}
            node={node}
            depth={depth}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ) : (
          <button
            key={node.fullPath}
            type="button"
            className={`flex w-full cursor-pointer items-center gap-2 py-0.5 text-left transition-colors ${
              selectedPath === node.fullPath ? "bg-accent-muted" : "hover:bg-ov-bg-hover"
            }`}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => onSelect(node.fullPath)}
            title={node.fullPath}
          >
            <span className="min-w-0 truncate font-mono text-xs text-ov-text">{node.name}</span>
            {node.file && <TouchBadge reads={node.file.reads} writes={node.file.writes} />}
          </button>
        ),
      )}
    </>
  );
}

export function ActivityFileTree({
  nodes,
  baseDir,
  selectedPath,
  onSelect,
}: ActivityFileTreeProps) {
  const tree = useMemo(
    () =>
      buildActivityTree(
        nodes.map((file) => ({ full: file.path, rel: relativize(file.path, baseDir), file })),
      ),
    [nodes, baseDir],
  );
  return (
    <ActivityTreeRows nodes={tree} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
  );
}
