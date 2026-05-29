import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../hooks/useApi";
import { buildTree, relativeTime, formatCost } from "../utils/buildTree";
import type { TreeNode, SortMode } from "../utils/buildTree";
import { FolderPanel } from "./FolderPanel";
import { useSessionNav } from "../hooks/useNav";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

const SIDEBAR_WIDTH_KEY = "sess-sidebar-width";
const COLLAPSED_KEY = "sess-sidebar-collapsed";
const SORT_KEY = "sess-sidebar-sort";

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) return Math.max(200, Math.min(600, Number(stored)));
  } catch {
    /* ignore */
  }
  return 300;
}

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    /* ignore */
  }
  return new Set();
}

function getInitialSort(): SortMode {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored === "name" || stored === "agent") return stored;
  } catch {
    /* ignore */
  }
  return "recent";
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
};

function shortModel(model: string): string {
  return model.replace("claude-", "").replace("openai/", "");
}

export function Sidebar({ sessions, activeSessionId, onSessionSelect }: SidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSort);
  const [isResizing, setIsResizing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const [childrenCollapsed, setChildrenCollapsed] = useState<Set<string>>(new Set());

  const toggleChildCollapse = useCallback((id: string) => {
    setChildrenCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tree = useMemo(() => buildTree(sessions, sortMode), [sessions, sortMode]);

  const saveCollapsed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapse = useCallback(
    (path: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        saveCollapsed(next);
        return next;
      });
    },
    [saveCollapsed],
  );

  const collapseAll = useCallback(() => {
    const all = new Set(tree.map((n) => n.fullPath));
    setCollapsed(all);
    saveCollapsed(all);
  }, [tree, saveCollapsed]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
    saveCollapsed(new Set());
  }, [saveCollapsed]);

  const setSort = useCallback((mode: SortMode) => {
    setSortMode(mode);
    setSortOpen(false);
    try {
      localStorage.setItem(SORT_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  // Close sort dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    if (sortOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch {
        /* ignore */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const allCollapsed = tree.length > 0 && tree.every((n) => collapsed.has(n.fullPath));

  return (
    <aside
      className="flex flex-col border-r border-gh-border bg-gh-bg-sidebar overflow-hidden shrink-0 relative"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <FolderPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
        />

        {/* SESSIONS header */}
        {sessions.length > 0 && (
          <div className="flex items-center justify-between px-2 py-1 mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gh-text-secondary">
              Sessions
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={allCollapsed ? expandAll : collapseAll}
                className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                title={allCollapsed ? "Expand all" : "Collapse all"}
              >
                {allCollapsed ? (
                  <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
                  </svg>
                ) : (
                  <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
                  </svg>
                )}
              </button>
              <div className="relative" ref={sortRef}>
                <button
                  type="button"
                  onClick={() => setSortOpen((v) => !v)}
                  className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                  title="Sort sessions"
                >
                  <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.5 2.75a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 4.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" />
                  </svg>
                </button>
                {sortOpen && (
                  <div className="absolute left-0 top-full mt-1 w-24 bg-gh-bg-sidebar border border-gh-border rounded shadow-lg z-20 py-1">
                    {(["recent", "name", "agent"] as SortMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                          sortMode === mode
                            ? "text-gh-text bg-gh-bg-active"
                            : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
                        }`}
                        onClick={() => setSort(mode)}
                      >
                        {SORT_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tree.length === 0 ? (
          <div className="text-xs text-gh-text-secondary p-2">No sessions</div>
        ) : (
          tree.map((node) => (
            <RepoNode
              key={node.fullPath}
              node={node}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              activeSessionId={activeSessionId}
              onSessionSelect={onSessionSelect}
              childrenCollapsed={childrenCollapsed}
              onToggleChildCollapse={toggleChildCollapse}
            />
          ))
        )}
      </div>
      {/* Resize handle */}
      <div
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400/50 transition-colors ${isResizing ? "bg-blue-400/50" : ""}`}
        style={{ left: `${width - 2}px`, position: "fixed", height: "100vh", top: 0 }}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}

interface RepoNodeProps {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  childrenCollapsed: Set<string>;
  onToggleChildCollapse: (id: string) => void;
}

function RepoNode({
  node,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onSessionSelect,
  childrenCollapsed,
  onToggleChildCollapse,
}: RepoNodeProps) {
  const isCollapsed = collapsed.has(node.fullPath);

  return (
    <div className="mb-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs font-medium text-gh-text-secondary hover:bg-gh-bg-hover cursor-pointer"
        onClick={() => onToggleCollapse(node.fullPath)}
      >
        <svg
          className={`size-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[10px] text-gh-text-secondary">{node.children.length}</span>
      </button>
      {!isCollapsed && (
        <div className="ml-2 border-l border-gh-border">
          {node.children.map((child) => (
            <SessionNode
              key={child.session!.id}
              session={child.session!}
              isActive={child.session!.id === activeSessionId}
              onSelect={() => onSessionSelect(child.session!.id)}
              childNodes={child.children}
              collapsedChildren={childrenCollapsed}
              onToggleChildren={onToggleChildCollapse}
              activeSessionId={activeSessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SessionNodeProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  childNodes?: TreeNode[];
  collapsedChildren?: Set<string>;
  onToggleChildren?: (id: string) => void;
  activeSessionId?: string | null;
}

function SessionNode({
  session,
  isActive,
  onSelect,
  childNodes,
  collapsedChildren,
  onToggleChildren,
  activeSessionId: outerActiveId,
}: SessionNodeProps) {
  const { navigateToSession } = useSessionNav();
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const hasChildren = childNodes && childNodes.length > 0;
  const isCollapsed = collapsedChildren?.has(session.id);

  return (
    <div>
      <div className="flex items-center w-full">
        {hasChildren && (
          <button
            type="button"
            className="shrink-0 p-1 text-gh-text-secondary hover:text-gh-text cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onToggleChildren?.(session.id);
            }}
          >
            <svg
              className={`size-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        )}
        {!hasChildren && <div className="w-5 shrink-0" />}
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          className={`session-draggable flex flex-col gap-0.5 flex-1 min-w-0 px-1 py-1.5 text-left rounded-sm cursor-pointer transition-colors ${
            isActive
              ? "bg-gh-bg-active text-gh-text"
              : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
          }`}
          onClick={onSelect}
          title={session.directory}
        >
          <div className="flex items-center gap-1.5 w-full">
            <AgentBadge agent={session.agent} subAgent={session.subAgent} />
            <span className="text-xs truncate flex-1">
              {session.title || session.id.slice(0, 12)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gh-text-secondary pl-5">
            <span>{relativeTime(session.updatedAt)}</span>
            {session.model && (
              <span className="truncate max-w-[80px]">{shortModel(session.model)}</span>
            )}
            {session.subAgent && <span className="text-[9px] uppercase">{session.subAgent}</span>}
            {session.cost > 0 && <span>{formatCost(session.cost)}</span>}
          </div>
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <div className="ml-4 border-l border-gh-border">
          {childNodes!.map((child) => (
            <SessionNode
              key={child.session!.id}
              session={child.session!}
              isActive={child.session!.id === outerActiveId}
              onSelect={() => navigateToSession(child.session!.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentBadge({ agent, subAgent }: { agent: string; subAgent?: string }) {
  const colors: Record<string, string> = {
    opencode: "bg-purple-500/20 text-purple-400",
    copilot: "bg-blue-500/20 text-blue-400",
  };
  const cls = colors[agent] || "bg-gray-500/20 text-gray-400";
  return (
    <span
      className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${cls}`}
      title={subAgent || agent}
    >
      {agent === "opencode" ? "OC" : agent === "copilot" ? "CP" : agent.slice(0, 2)}
    </span>
  );
}
