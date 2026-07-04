import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder, Plus, Minus, ArrowUpDown, ArrowRight } from "lucide-react";
import type { Session } from "../hooks/useApi";
import { buildTree } from "../utils/buildTree";
import type { TreeNode, SortMode } from "../utils/buildTree";
import {
  sessionTitle,
  sessionMetaParts,
  relativeTime,
  formatCost,
  formatTokens,
  shortDir,
  shortModel,
} from "../utils/sessionUtils";
import { useSessionNav } from "../hooks/useNav";
import { getDistinctValues, filterSessions, type SessionFilters } from "../utils/sessionFilters";
import { ContextMenu } from "./ContextMenu";
import { AddToProjectDialog } from "./AddToProjectDialog";

interface SessionPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  showToast: (msg: string) => void;
  sessionUnread?: Record<string, number>;
}

const COLLAPSED_KEY = "omnivue-sidebar-collapsed";
const SORT_KEY = "omnivue-sidebar-sort";
const DISPLAY_KEY = "omnivue-sidebar-display";

type DisplayMode = "condensed" | "verbose";

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    /* noop */
  }
  return new Set();
}

function getInitialSort(): SortMode {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored === "name" || stored === "agent") return stored;
  } catch {
    /* noop */
  }
  return "recent";
}

function getInitialDisplay(): DisplayMode {
  try {
    const stored = localStorage.getItem(DISPLAY_KEY);
    if (stored === "condensed" || stored === "verbose") return stored;
  } catch {
    /* noop */
  }
  return "condensed";
}

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
  "cost-asc": "Cost ↑",
  "cost-desc": "Cost ↓",
};

export function SessionPanel({
  sessions,
  activeSessionId,
  onSessionSelect,
  showToast,
  sessionUnread = {},
}: SessionPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSort);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getInitialDisplay);
  const toggleDisplayMode = useCallback(() => {
    setDisplayMode((prev) => {
      const next = prev === "condensed" ? "verbose" : "condensed";
      try {
        localStorage.setItem(DISPLAY_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);
  const [expandedParentId, setExpandedParentId] = useState<string | null>(() => {
    if (!activeSessionId) return null;
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.parentId || null;
  });
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [addToProjectSessionId, setAddToProjectSessionId] = useState<string | null>(null);

  const handleContextMenu = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, []);

  const [filters, setFilters] = useState<SessionFilters>({
    agent: null,
    project: null,
    repository: null,
    model: null,
  });

  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    const parentId = session?.parentId || null;
    if (parentId) setExpandedParentId(parentId);
  }, [activeSessionId, sessions]);

  const filteredSessions = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);

  const tree = useMemo(() => buildTree(filteredSessions, sortMode), [filteredSessions, sortMode]);

  const agents = useMemo(() => getDistinctValues(sessions, "agent"), [sessions]);
  const projects = useMemo(() => getDistinctValues(sessions, "directory"), [sessions]);
  const repos = useMemo(() => getDistinctValues(sessions, "repository"), [sessions]);
  const models = useMemo(() => getDistinctValues(sessions, "model"), [sessions]);

  const hasFilters = Object.values(filters).some((v) => v !== null);

  const clearFilters = useCallback(() => {
    setFilters({ agent: null, project: null, repository: null, model: null });
  }, []);

  const setFilter = useCallback((key: keyof SessionFilters, value: string | null) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveCollapsed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* noop */
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
      /* noop */
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

  const allCollapsed = tree.length > 0 && tree.every((n) => collapsed.has(n.fullPath));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          <IconBtn
            title={allCollapsed ? "Expand all repos" : "Collapse all repos"}
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? <Plus size={14} /> : <Minus size={14} />}
          </IconBtn>
          <div className="relative" ref={sortRef}>
            <IconBtn title="Sort" onClick={() => setSortOpen((v) => !v)}>
              <ArrowUpDown size={14} />
            </IconBtn>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
                {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                      sortMode === mode
                        ? "text-ov-text bg-ov-bg-active"
                        : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
                    }`}
                    onClick={() => setSort(mode)}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <IconBtn
            title={displayMode === "condensed" ? "Verbose view" : "Condensed view"}
            onClick={toggleDisplayMode}
          >
            {displayMode === "condensed" ? (
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 3.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 4a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Z" />
              </svg>
            ) : (
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 2.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Z" />
              </svg>
            )}
          </IconBtn>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-1.5 pb-1 shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip
            label="Agent"
            value={filters.agent}
            options={agents}
            onChange={(v) => setFilter("agent", v)}
          />
          <FilterChip
            label="Project"
            value={filters.project}
            options={projects}
            onChange={(v) => setFilter("project", v)}
            formatOption={shortDir}
          />
          <FilterChip
            label="Repo"
            value={filters.repository}
            options={repos}
            onChange={(v) => setFilter("repository", v)}
          />
          <FilterChip
            label="Model"
            value={filters.model}
            options={models}
            onChange={(v) => setFilter("model", v)}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-accent hover:underline cursor-pointer ml-auto shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Session tree */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg
              className="size-6 mb-3 text-ov-text-secondary/40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-xs text-ov-text-secondary/60 max-w-36 leading-relaxed">
              {hasFilters
                ? "No sessions match filters"
                : "Run sess init or add agents in Settings to discover sessions."}
            </p>
          </div>
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
                expandedParentId={expandedParentId}
                onExpandParent={setExpandedParentId}
                onContextMenu={handleContextMenu}
                displayMode={displayMode}
                sessionUnread={sessionUnread}
              />
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Add to Project",
              icon: <Folder size={14} />,
              onClick: () => {
                setAddToProjectSessionId(contextMenu.sessionId);
              },
            },
          ]}
        />
      )}

      {addToProjectSessionId && (
        <AddToProjectDialog
          isOpen={!!addToProjectSessionId}
          sessionId={addToProjectSessionId}
          sessionTitle={sessions.find((s) => s.id === addToProjectSessionId)?.title || ""}
          onClose={() => setAddToProjectSessionId(null)}
          onAssigned={(name) => showToast(`Added to ${name}`)}
        />
      )}
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────

function FilterChip({
  label,
  value,
  options,
  onChange,
  formatOption,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  formatOption?: (opt: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const displayLabel = value ? (formatOption ? formatOption(value) : value) : `All ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[11px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          value
            ? "border-accent-border bg-accent-muted text-accent"
            : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
        }`}
      >
        {label}: {displayLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
          <button
            type="button"
            className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
              !value
                ? "text-ov-text bg-ov-bg-active"
                : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
            }`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            All {label}s
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors truncate ${
                value === opt
                  ? "text-ov-text bg-ov-bg-active"
                  : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {formatOption ? formatOption(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RepoNode ─────────────────────────────────────────────────────

function RepoNode({
  node,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onSessionSelect,
  expandedParentId,
  onExpandParent,
  onContextMenu,
  displayMode,
  sessionUnread,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
  displayMode: DisplayMode;
  sessionUnread: Record<string, number>;
}) {
  const isCollapsed = collapsed.has(node.fullPath);
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_LIMIT = 15;
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
                childNodes={child.children}
                isActive={session.id === activeSessionId}
                activeSessionId={activeSessionId}
                onSelect={() => onSessionSelect(session.id)}
                expandedParentId={expandedParentId}
                onExpandParent={onExpandParent}
                onContextMenu={onContextMenu}
                displayMode={displayMode}
                unreadCount={sessionUnread[session.id] || 0}
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

// ─── SessionRow ───────────────────────────────────────────────────

function SessionRow({
  session,
  childNodes,
  isActive,
  activeSessionId,
  onSelect,
  expandedParentId,
  onExpandParent,
  onContextMenu,
  displayMode,
  unreadCount = 0,
}: {
  session: Session;
  childNodes: TreeNode[];
  isActive: boolean;
  activeSessionId: string | null;
  onSelect: () => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
  displayMode: DisplayMode;
  unreadCount?: number;
}) {
  const { navigateToSession } = useSessionNav();
  const subCount = childNodes.length;
  const subsVisible = session.id === expandedParentId;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleClick = () => {
    onExpandParent(session.id);
    onSelect();
  };

  return (
    <div>
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(session.id, e)}
        title={session.directory || session.repository}
        className={`session-draggable sess-parent-session w-full text-left transition-all ${
          isActive ? "sess-session-active" : "hover:bg-ov-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`sess-parent-session-title truncate flex-1 ${isActive ? "text-ov-text" : "text-ov-text"}`}
          >
            {sessionTitle(session)}
          </span>
          {subCount > 0 && !subsVisible && (
            <span className="shrink-0 text-[11px] px-1 rounded bg-ov-bg-hover text-ov-text-secondary">
              {subCount}
            </span>
          )}
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
        {displayMode === "verbose" && <VerboseStats session={session} />}
      </button>
      {subCount > 0 && subsVisible && (
        <div className="ml-2 mt-px mb-1 space-y-px border-l border-ov-border/60">
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
                onContextMenu={(e) => onContextMenu(session.id, e)}
                title={buildChildTooltip(session)}
                className={`session-draggable w-full flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 text-left rounded-r-md transition-colors ${
                  subActive ? "sess-session-active" : "hover:bg-ov-bg-hover"
                }`}
              >
                <ArrowRight size={11} className="text-accent/80 shrink-0" />
                <span className="text-[11px] truncate flex-1">
                  {session.subAgent ? (
                    <span className="text-ov-text-secondary">{session.subAgent}: </span>
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
    </div>
  );
}

// ─── VerboseStats ────────────────────────────────────────────────

function hideCosts(): boolean {
  try {
    return localStorage.getItem("omnivue-hide-costs") === "true";
  } catch {
    return false;
  }
}

function VerboseStats({ session }: { session: Session }) {
  const totalTokens =
    session.tokensInput + session.tokensOutput + session.tokensCacheRead + session.tokensCacheWrite;
  const parts: ReactNode[] = [];
  const costsVisible = !hideCosts();

  const model = shortModel(session.model);
  if (model) {
    parts.push(
      <span key="model" title="Model">
        {model}
      </span>,
    );
  }

  if (totalTokens > 0) {
    parts.push(
      <span
        key="tokens"
        title={`${session.tokensInput.toLocaleString()} in / ${session.tokensCacheRead.toLocaleString()} cached / ${session.tokensOutput.toLocaleString()} out`}
      >
        {formatTokens(totalTokens)}
      </span>,
    );
  }
  if (session.cost > 0 && costsVisible) {
    parts.push(
      <span key="cost" title="Cost">
        {formatCost(session.cost)}
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <p className="sess-parent-session-meta truncate mt-0.5">
      {parts.flatMap((part, i) =>
        i === 0
          ? [part]
          : [
              <span key={`dot-${i}`} className="mx-1">
                ·
              </span>,
              part,
            ],
      )}
    </p>
  );
}

// buildChildTooltip returns a descriptive tooltip for child/sub-agent sessions.
function buildChildTooltip(session: Session): string {
  if (session.subAgent) {
    const title = session.title?.trim() || session.id.slice(0, 10);
    return `${session.subAgent}: ${title}`;
  }
  return session.directory || session.title || session.id.slice(0, 10);
}

// ─── Small SVG icons ──────────────────────────────────────────────

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
      className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5 rounded"
    >
      {children}
    </button>
  );
}
