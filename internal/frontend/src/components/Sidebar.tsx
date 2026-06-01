import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "../hooks/useApi";
import { buildTree, parentIdsWithChildren, relativeTime } from "../utils/buildTree";
import type { TreeNode, SortMode } from "../utils/buildTree";
import { FolderPanel } from "./FolderPanel";
import { useSessionNav } from "../hooks/useNav";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  newSessionIds: Set<string>;
}

const SIDEBAR_WIDTH_KEY = "sess-sidebar-width";
const COLLAPSED_KEY = "sess-sidebar-collapsed";
const SORT_KEY = "sess-sidebar-sort";
const SUB_COLLAPSED_KEY = "sess-sidebar-sub-collapsed";

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) return Math.max(220, Math.min(600, Number(stored)));
  } catch {
    /* ignore */
  }
  return 280;
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

function getInitialSubCollapsed(sessions: Session[]): Set<string> {
  try {
    const stored = localStorage.getItem(SUB_COLLAPSED_KEY);
    if (stored !== null) return new Set(JSON.parse(stored));
  } catch {
    /* ignore */
  }
  return parentIdsWithChildren(sessions);
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
};

function sessionTitle(session: Session): string {
  const t = session.title?.trim();
  if (t) return t;
  return session.id.slice(0, 10);
}

function shortDir(directory: string): string {
  if (!directory) return "";
  const parts = directory.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : directory;
}

function shortModel(model: string): string {
  if (!model) return "";
  return model
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("github-copilot/", "")
    .replace("claude-", "")
    .replace("gpt-", "");
}

function agentLabel(agent: string): string {
  if (agent === "opencode") return "OpenCode";
  if (agent === "copilot") return "Copilot";
  return agent;
}

function sessionMetaParts(session: Session): string[] {
  const parts: string[] = [];
  if (session.agent) parts.push(agentLabel(session.agent));
  const dir = shortDir(session.directory);
  if (dir) parts.push(dir);
  if (session.branch) parts.push(session.branch);
  const model = shortModel(session.model);
  if (model) parts.push(model);
  return parts;
}

function SessionStatusDot({ isNew }: { isNew: boolean }) {
  return (
    <span
      className={`sess-session-dot ${isNew ? "sess-session-dot--new" : "sess-session-dot--seen"}`}
      title={isNew ? "New or updated" : "Viewed"}
    />
  );
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  newSessionIds,
}: SidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSort);
  const [isResizing, setIsResizing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [subCollapsed, setSubCollapsed] = useState<Set<string>>(() =>
    getInitialSubCollapsed(sessions),
  );

  const tree = useMemo(() => buildTree(sessions, sortMode), [sessions, sortMode]);

  const saveCollapsed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const saveSubCollapsed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(SUB_COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapse = useCallback(
    (path: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        saveCollapsed(next);
        return next;
      });
    },
    [saveCollapsed],
  );

  const toggleSubCollapsed = useCallback(
    (parentId: string) => {
      setSubCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(parentId)) next.delete(parentId);
        else next.add(parentId);
        saveSubCollapsed(next);
        return next;
      });
    },
    [saveSubCollapsed],
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
      const newWidth = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const finalWidth = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)));
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
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
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        <FolderPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
        />

        {sessions.length > 0 && (
          <div className="flex items-center justify-between px-1.5 py-1 mt-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gh-text-secondary">
              Sessions
            </span>
            <div className="flex items-center gap-0.5">
              <IconBtn
                title={allCollapsed ? "Expand all repos" : "Collapse all repos"}
                onClick={allCollapsed ? expandAll : collapseAll}
              >
                {allCollapsed ? <PlusIcon /> : <MinusIcon />}
              </IconBtn>
              <div className="relative" ref={sortRef}>
                <IconBtn title="Sort" onClick={() => setSortOpen((v) => !v)}>
                  <SortIcon />
                </IconBtn>
                {sortOpen && (
                  <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-gh-border rounded-lg shadow-lg z-20 py-1">
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
          <div className="text-xs text-gh-text-secondary px-2 py-1">No sessions</div>
        ) : (
          <div className="space-y-0.5">
            {tree.map((node) => (
              <RepoNode
                key={node.fullPath}
                node={node}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
                activeSessionId={activeSessionId}
              onSessionSelect={onSessionSelect}
              subCollapsed={subCollapsed}
              onToggleSubCollapsed={toggleSubCollapsed}
              newSessionIds={newSessionIds}
            />
            ))}
          </div>
        )}
      </div>
      <div
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors ${isResizing ? "bg-accent/50" : ""}`}
        style={{ left: `${width - 2}px`, position: "fixed", height: "100vh", top: 0 }}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}

function RepoNode({
  node,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onSessionSelect,
  subCollapsed,
  onToggleSubCollapsed,
  newSessionIds,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  subCollapsed: Set<string>;
  onToggleSubCollapsed: (id: string) => void;
  newSessionIds: Set<string>;
}) {
  const isCollapsed = collapsed.has(node.fullPath);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 w-full px-1.5 py-1 rounded-md text-[11px] font-medium text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text cursor-pointer"
        onClick={() => onToggleCollapse(node.fullPath)}
        title={node.fullPath}
      >
        <Chevron open={!isCollapsed} />
        <span className="truncate flex-1 text-left">{node.name}</span>
        <span className="text-[10px] tabular-nums opacity-70">{node.children.length}</span>
      </button>
      {!isCollapsed && (
        <div className="space-y-px mt-px">
          {node.children.map((child) => (
            <SessionRow
              key={child.session!.id}
              session={child.session!}
              childNodes={child.children}
              isActive={child.session!.id === activeSessionId}
              activeSessionId={activeSessionId}
              onSelect={() => onSessionSelect(child.session!.id)}
              subCollapsed={subCollapsed}
              onToggleSubCollapsed={onToggleSubCollapsed}
              newSessionIds={newSessionIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  childNodes,
  isActive,
  activeSessionId,
  onSelect,
  subCollapsed,
  onToggleSubCollapsed,
  newSessionIds,
}: {
  session: Session;
  childNodes: TreeNode[];
  isActive: boolean;
  activeSessionId: string | null;
  onSelect: () => void;
  subCollapsed: Set<string>;
  onToggleSubCollapsed: (id: string) => void;
  newSessionIds: Set<string>;
}) {
  const { navigateToSession } = useSessionNav();
  const subCount = childNodes.length;
  const subsHidden = subCollapsed.has(session.id);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="pl-2">
      <div className="flex items-stretch min-w-0">
        {subCount > 0 ? (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center w-5 text-gh-text-secondary hover:text-gh-text cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSubCollapsed(session.id);
            }}
            aria-label={subsHidden ? "Show sub-agents" : "Hide sub-agents"}
          >
            <Chevron open={!subsHidden} className="size-2.5" />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onClick={onSelect}
          title={session.directory || session.repository}
          className={`session-draggable sess-parent-session flex-1 min-w-0 text-left transition-all ${
            isActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <SessionStatusDot isNew={newSessionIds.has(session.id)} />
            <span
              className={`sess-parent-session-title truncate flex-1 ${isActive ? "text-gh-text" : "text-gh-text"}`}
            >
              {sessionTitle(session)}
            </span>
            {subCount > 0 && subsHidden && (
              <span className="shrink-0 text-[10px] px-1 rounded bg-gh-bg-hover text-gh-text-secondary">
                {subCount}
              </span>
            )}
            <span className="shrink-0 text-[10px] text-gh-text-secondary tabular-nums">
              {relativeTime(session.updatedAt)}
            </span>
          </div>
          {sessionMetaParts(session).length > 0 && (
            <p className="sess-parent-session-meta truncate mt-0.5 pl-[0.875rem]">
              {sessionMetaParts(session).join(" · ")}
            </p>
          )}
        </button>
      </div>
      {subCount > 0 && !subsHidden && (
        <div className="ml-5 mt-px mb-1 space-y-px border-l border-gh-border/60">
          {childNodes.map((child) => {
            const sub = child.session!;
            const subActive = sub.id === activeSessionId;
            return (
              <button
                key={sub.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", sub.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => navigateToSession(sub.id)}
                title={sub.directory || sub.title}
                className={`session-draggable w-full flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 text-left rounded-r-md transition-colors ${
                  subActive
                    ? "sess-session-active"
                    : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
                }`}
              >
                <span className="text-[10px] text-accent/80 shrink-0">↳</span>
                <span className="text-[11px] truncate flex-1">
                  {sub.subAgent ? (
                    <span className="text-gh-text-secondary">{sub.subAgent}: </span>
                  ) : null}
                  {sessionTitle(sub)}
                </span>
                <span className="text-[10px] opacity-60 tabular-nums shrink-0">
                  {relativeTime(sub.updatedAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chevron({ open, className = "size-3" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 transition-transform text-gh-text-secondary ${open ? "rotate-90" : ""}`}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5 rounded"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2.75a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 4.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" />
    </svg>
  );
}
