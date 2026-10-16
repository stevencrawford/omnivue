import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Session } from "../../hooks/types";
import type { TreeNode } from "../../utils/buildTree";
import { relativeTime, sessionMetaParts, sessionTitle } from "../../utils/sessionUtils";
import { VerboseStats } from "./VerboseStats";

export type DisplayMode = "condensed" | "verbose";

export const VISIBLE_LIMIT = 15;

/** Session row shared props (RepoNode <-> SessionRow recursion). */
export interface SessionRowSharedProps {
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
  displayMode: DisplayMode;
  sessionUnread: Record<string, number>;
  staleIds: Set<string>;
}

function SessionRow({
  session,
  isActive,
  unreadCount = 0,
  staleIds,
  ...shared
}: {
  session: Session;
  isActive: boolean;
  unreadCount?: number;
  staleIds?: Set<string>;
} & SessionRowSharedProps) {
  const isStale = staleIds ? staleIds.has(session.id) : false;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleClick = () => {
    shared.onSessionSelect(session.id);
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onContextMenu={(e) => shared.onContextMenu(session.id, e)}
      title={session.directory || session.repository}
      className={`session-draggable sess-parent-session w-full text-left transition-all ${
        isActive ? "sess-session-active" : "hover:bg-ov-bg-hover"
      } ${isStale && !isActive ? "sess-session-stale" : ""}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {session.status === "active" && (
          <span className="sess-live-dot shrink-0" title="Session active" />
        )}
        <span className="sess-parent-session-title truncate flex-1 text-ov-text">
          {sessionTitle(session)}
        </span>
        {unreadCount > 0 && (
          <span
            title={`${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`}
            className="shrink-0 min-w-3.5 h-3.5 px-1 flex items-center justify-center text-[9px] font-bold rounded-full bg-accent text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-ov-text-secondary tabular-nums">
          {relativeTime(session.updatedAt)}
        </span>
      </div>
      {sessionMetaParts(session).length > 0 && (
        <p className="sess-parent-session-meta truncate mt-0.5">
          {sessionMetaParts(session).join(" · ")}
        </p>
      )}
      {shared.displayMode === "verbose" && <VerboseStats session={session} />}
    </button>
  );
}

function GroupNode({
  node,
  collapsed,
  onToggleCollapse,
  ...shared
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
} & SessionRowSharedProps) {
  const isCollapsed = collapsed.has(node.fullPath);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? node.children : node.children.slice(0, VISIBLE_LIMIT);
  const hasMore = node.children.length > VISIBLE_LIMIT;

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 w-full px-1.5 py-1 rounded-md text-[11px] font-medium text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text cursor-pointer"
        onClick={() => onToggleCollapse(node.fullPath)}
        title={node.fullPath}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform text-ov-text-secondary ${!isCollapsed ? "rotate-90" : ""}`}
        />
        <span className="truncate flex-1 text-left">{node.name}</span>
        <span className="text-[11px] tabular-nums opacity-70">{node.children.length}</span>
      </button>
      {!isCollapsed && (
        <div className="space-y-px mt-px">
          {visible.map((child) => {
            const session = child.session;
            if (!session) return null;
            return (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === shared.activeSessionId}
                unreadCount={shared.sessionUnread[session.id] || 0}
                {...shared}
              />
            );
          })}
          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full text-center text-[11px] text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover px-1.5 py-1 rounded cursor-pointer transition-colors"
            >
              +{node.children.length - VISIBLE_LIMIT} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionTree({
  nodes,
  collapsed,
  onToggleCollapse,
  ...shared
}: SessionRowSharedProps & {
  nodes: TreeNode[];
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) =>
        node.isGroup ? (
          <GroupNode
            key={node.fullPath}
            node={node}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            {...shared}
          />
        ) : (
          node.session && (
            <SessionRow
              key={node.session.id}
              session={node.session}
              isActive={node.session.id === shared.activeSessionId}
              unreadCount={shared.sessionUnread[node.session.id] || 0}
              {...shared}
            />
          )
        ),
      )}
    </div>
  );
}
