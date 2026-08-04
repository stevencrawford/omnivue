import { useMemo, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import {
  computeFileStatus,
  getFileName,
  type FileTreeNode,
  type MergedFileDiff,
} from "../../utils/diffTree";

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

export function FileTree({
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
