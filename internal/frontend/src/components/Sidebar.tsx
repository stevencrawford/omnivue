import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, ScratchFile } from "../hooks/useApi";
import { buildTree } from "../utils/buildTree";
import type { TreeNode, SortMode } from "../utils/buildTree";
import {
  sessionTitle,
  sessionMetaParts,
  SessionStatusDot,
  relativeTime,
} from "../utils/sessionUtils";
import { FolderPanel } from "./FolderPanel";
import { useSessionNav } from "../hooks/useNav";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
  newSessionIds: Set<string>;
  scratchFiles?: ScratchFile[];
}

const SIDEBAR_WIDTH_KEY = "sess-sidebar-width";
const FOLDER_HEIGHT_KEY = "sess-sidebar-folder-height";
const COLLAPSED_KEY = "sess-sidebar-collapsed";
const SORT_KEY = "sess-sidebar-sort";

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) return Math.max(220, Math.min(600, Number(stored)));
  } catch {
    // localStorage may be unavailable
  }
  return 280;
}

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // localStorage may be unavailable
  }
  return new Set();
}

function getInitialSort(): SortMode {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored === "name" || stored === "agent") return stored;
  } catch {
    // localStorage may be unavailable
  }
  return "recent";
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
};

export function Sidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  onScratchFileSelect,
  newSessionIds,
  scratchFiles = [],
}: SidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [folderHeight, setFolderHeight] = useState(() => {
    try {
      const stored = localStorage.getItem(FOLDER_HEIGHT_KEY);
      if (stored) return Math.max(80, Math.min(600, Number(stored)));
    } catch {
      // localStorage may be unavailable
    }
    return 200;
  });
  const [isFolderResizing, setIsFolderResizing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSort);
  const [isResizing, setIsResizing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [expandedParentId, setExpandedParentId] = useState<string | null>(() => {
    if (!activeSessionId) return null;
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.parentId || null;
  });

  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    const parentId = session?.parentId || null;
    if (parentId) setExpandedParentId(parentId);
  }, [activeSessionId, sessions]);

  const tree = useMemo(() => buildTree(sessions, sortMode), [sessions, sortMode]);
  const scratchFilesBySession = useMemo(() => {
    const map = new Map<string, ScratchFile[]>();
    for (const f of scratchFiles) {
      const list = map.get(f.sessionId) || [];
      list.push(f);
      map.set(f.sessionId, list);
    }
    return map;
  }, [scratchFiles]);

  const saveCollapsed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // localStorage may be unavailable
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
      // localStorage may be unavailable
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
        // localStorage may be unavailable
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const allCollapsed = tree.length > 0 && tree.every((n) => collapsed.has(n.fullPath));

  const handleFolderResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsFolderResizing(true);
    const startY = e.clientY;
    const startHeight = folderHeight;

    const handleMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(80, Math.min(600, startHeight + (ev.clientY - startY)));
      setFolderHeight(newHeight);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsFolderResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      const finalHeight = Math.max(80, Math.min(600, startHeight + (ev.clientY - startY)));
      try {
        localStorage.setItem(FOLDER_HEIGHT_KEY, String(finalHeight));
      } catch {
        // localStorage may be unavailable
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <aside
      className="flex flex-col border-r border-gh-border bg-gh-bg-sidebar overflow-hidden shrink-0 relative"
      style={{ width: `${width}px` }}
    >
      <div className="overflow-y-auto shrink-0 px-1.5 py-2" style={{ height: folderHeight }}>
        <FolderPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
        />
      </div>

      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isFolderResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handleFolderResizeStart}
      >
        <div className="w-6 h-0.5 rounded-full bg-gh-border" />
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {sessions.length > 0 && (
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gh-text-secondary">
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
                onScratchFileSelect={onScratchFileSelect}
                expandedParentId={expandedParentId}
                onExpandParent={setExpandedParentId}
                newSessionIds={newSessionIds}
                scratchFilesBySession={scratchFilesBySession}
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
  onScratchFileSelect,
  expandedParentId,
  onExpandParent,
  newSessionIds,
  scratchFilesBySession,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  newSessionIds: Set<string>;
  scratchFilesBySession: Map<string, ScratchFile[]>;
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
        <span className="text-[11px] tabular-nums opacity-70">{node.children.length}</span>
      </button>
      {!isCollapsed && (
        <div className="space-y-px mt-px">
          {node.children.map((child) => {
            const session = child.session;
            if (!session) return null;
            const sessionScratchFiles = scratchFilesBySession.get(session.id) || [];
            return (
              <SessionRow
                key={session.id}
                session={session}
                childNodes={child.children}
                isActive={session.id === activeSessionId}
                activeSessionId={activeSessionId}
                onSelect={() => onSessionSelect(session.id)}
                expandedParentId={expandedParentId}
                onExpandParent={onExpandParent}
                newSessionIds={newSessionIds}
                scratchFiles={sessionScratchFiles}
                onScratchFileSelect={onScratchFileSelect}
              />
            );
          })}
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
  expandedParentId,
  onExpandParent,
  newSessionIds,
  scratchFiles = [],
  onScratchFileSelect,
}: {
  session: Session;
  childNodes: TreeNode[];
  isActive: boolean;
  activeSessionId: string | null;
  onSelect: () => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  newSessionIds: Set<string>;
  scratchFiles?: ScratchFile[];
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
}) {
  const { navigateToSession } = useSessionNav();
  const subCount = childNodes.length;
  const subsVisible = session.id === expandedParentId;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleClick = () => {
    if (subCount > 0 || scratchFiles.length > 0) onExpandParent(session.id);
    onSelect();
  };

  return (
    <div>
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onClick={handleClick}
        title={session.directory || session.repository}
        className={`session-draggable sess-parent-session w-full text-left transition-all ${
          isActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <SessionStatusDot
            isNew={newSessionIds.has(session.id)}
            isLive={session.status === "active"}
          />
          <span
            className={`sess-parent-session-title truncate flex-1 ${isActive ? "text-gh-text" : "text-gh-text"}`}
          >
            {sessionTitle(session)}
          </span>
          {(subCount > 0 || scratchFiles.length > 0) && !subsVisible && (
            <span className="shrink-0 text-[11px] px-1 rounded bg-gh-bg-hover text-gh-text-secondary">
              {subCount > 0 ? subCount : "✎"}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-gh-text-secondary tabular-nums">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
        {sessionMetaParts(session).length > 0 && (
          <p className="sess-parent-session-meta truncate mt-0.5">
            {sessionMetaParts(session).join(" · ")}
          </p>
        )}
      </button>
      {subCount > 0 && subsVisible && (
        <div className="ml-2 mt-px mb-1 space-y-px border-l border-gh-border/60">
          {childNodes.map((child) => {
            const session = child.session;
            if (!session) return null;
            const subActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", session.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => navigateToSession(session.id)}
                title={session.directory || session.title}
                className={`session-draggable w-full flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 text-left rounded-r-md transition-colors ${
                  subActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
                }`}
              >
                <span className="text-[11px] text-accent/80 shrink-0">↳</span>
                <span className="text-[11px] truncate flex-1">
                  {session.subAgent ? (
                    <span className="text-gh-text-secondary">{session.subAgent}: </span>
                  ) : null}
                  {sessionTitle(session)}
                </span>
                <span className="text-[11px] opacity-60 tabular-nums shrink-0">
                  {relativeTime(session.updatedAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Scratch files for this session */}
      {scratchFiles.length > 0 && subsVisible && onScratchFileSelect && (
        <div className="ml-2 mt-px mb-1 space-y-px border-l border-gh-border/40">
          {scratchFiles.map((sf) => (
            <button
              key={sf.id}
              type="button"
              onClick={() => onScratchFileSelect?.(session.id, sf.id)}
              className="w-full flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 text-left rounded-r-md transition-colors hover:bg-gh-bg-hover"
              title={sf.title}
            >
              <span className="text-[11px] text-amber-400/80 shrink-0">✎</span>
              <span className="text-[11px] truncate flex-1 text-gh-text-secondary">{sf.title}</span>
              <span className="text-[11px] opacity-60 tabular-nums shrink-0">
                {new Date(sf.updatedAt).toLocaleDateString()}
              </span>
            </button>
          ))}
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
