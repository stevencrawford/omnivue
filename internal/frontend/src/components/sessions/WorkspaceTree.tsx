import { useState } from "react";
import { AlertTriangle, ChevronRight, FolderGit2, GitBranch } from "lucide-react";
import type { ProjectNode } from "../../utils/projectTree";
import { SessionRow, VISIBLE_LIMIT, type SessionRowSharedProps } from "./SessionTree";

interface WorkspaceTreeProps extends SessionRowSharedProps {
  nodes: ProjectNode[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}

function NodeIcon({ node }: { node: ProjectNode }) {
  if (node.kind === "workspace") return <FolderGit2 size={12} className="shrink-0" />;
  if (node.kind === "worktree") return <GitBranch size={12} className="shrink-0" />;
  if (node.kind === "branch") return <GitBranch size={12} className="shrink-0 opacity-70" />;
  return null;
}

function GroupRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
}: {
  node: ProjectNode;
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const isCollapsed = collapsed.has(node.id);
  return (
    <button
      type="button"
      className="flex items-center gap-1 w-full py-1 rounded-md text-[11px] font-medium text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text cursor-pointer"
      style={{ paddingLeft: `${depth * 10 + 6}px`, paddingRight: "6px" }}
      onClick={() => onToggleCollapse(node.id)}
      title={node.title || node.label}
    >
      <ChevronRight
        size={12}
        className={`shrink-0 transition-transform text-ov-text-secondary ${
          !isCollapsed ? "rotate-90" : ""
        }`}
      />
      <NodeIcon node={node} />
      <span
        className={`truncate flex-1 text-left ${node.kind === "workspace" ? "text-ov-text" : ""}`}
      >
        {node.label}
      </span>
      {node.branch && node.kind === "worktree" && (
        <span
          className="shrink-0 max-w-24 truncate rounded px-1 py-px text-[10px] font-mono bg-ov-bg-active text-ov-text-secondary"
          title={node.branch}
        >
          {node.branch}
        </span>
      )}
      {node.external && (
        <span
          className="shrink-0 text-[10px] text-ov-text-secondary/70"
          title="Outside the workspace root"
        >
          ext
        </span>
      )}
      {node.missing && (
        <AlertTriangle
          size={11}
          className="shrink-0 text-amber-500"
          aria-label="Worktree missing"
        />
      )}
      {node.count > 1 && <span className="text-[11px] tabular-nums opacity-70">{node.count}</span>}
    </button>
  );
}

function SessionList({
  nodes,
  depth,
  shared,
}: {
  nodes: ProjectNode[];
  depth: number;
  shared: SessionRowSharedProps;
}) {
  const [showAll, setShowAll] = useState(false);
  const sessions = nodes.filter((node) => node.kind === "session" && node.session);
  const visible = showAll ? sessions : sessions.slice(0, VISIBLE_LIMIT);
  const hasMore = sessions.length > VISIBLE_LIMIT;

  return (
    <>
      {visible.map((node) =>
        node.session ? (
          <div key={node.id} style={{ paddingLeft: `${depth * 10}px` }}>
            <SessionRow
              session={node.session}
              isActive={node.session.id === shared.activeSessionId}
              unreadCount={shared.sessionUnread[node.session.id] || 0}
              {...shared}
            />
          </div>
        ) : null,
      )}
      {hasMore && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full text-center text-[11px] text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover px-1.5 py-1 rounded cursor-pointer transition-colors"
          style={{ paddingLeft: `${depth * 10 + 6}px` }}
        >
          +{sessions.length - VISIBLE_LIMIT} more
        </button>
      )}
    </>
  );
}

function NodeView({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  shared,
}: {
  node: ProjectNode;
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
} & { shared: SessionRowSharedProps }) {
  const isCollapsed = collapsed.has(node.id);

  if (node.kind === "session") {
    return node.session ? (
      <div style={{ paddingLeft: `${depth * 10}px` }}>
        <SessionRow
          session={node.session}
          isActive={node.session.id === shared.activeSessionId}
          unreadCount={shared.sessionUnread[node.session.id] || 0}
          {...shared}
        />
      </div>
    ) : null;
  }

  // A group node may hold both direct session leaves and nested groups.
  const groups = node.children.filter((child) => child.kind !== "session");
  const sessions = node.children.filter((child) => child.kind === "session");

  return (
    <div>
      <GroupRow
        node={node}
        depth={depth}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
      {!isCollapsed && (
        <div className="space-y-px">
          {groups.map((child) => (
            <NodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              shared={shared}
            />
          ))}
          {sessions.length > 0 && (
            <SessionList nodes={sessions} depth={depth + 1} shared={shared} />
          )}
        </div>
      )}
    </div>
  );
}

export function WorkspaceTree({
  nodes,
  collapsed,
  onToggleCollapse,
  ...shared
}: WorkspaceTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <NodeView
          key={node.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          shared={shared}
        />
      ))}
    </div>
  );
}
