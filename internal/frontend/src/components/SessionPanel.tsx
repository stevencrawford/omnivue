import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, ScratchFile } from "../hooks/useApi";
import { buildTree, formatCost } from "../utils/buildTree";
import type { TreeNode, SortMode } from "../utils/buildTree";
import { sessionTitle, sessionMetaParts, relativeTime } from "../utils/sessionUtils";
import { useSessionNav } from "../hooks/useNav";
import { getDistinctValues, filterSessions, type SessionFilters } from "../utils/sessionFilters";
import { ContextMenu } from "./ContextMenu";
import { AddToProjectDialog } from "./AddToProjectDialog";

interface SessionPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
  onDeleteScratchFile?: (sessionId: string, fileId: string) => void;
  onRenameScratchFile?: (sessionId: string, fileId: string, newTitle: string) => void;
  scratchFiles?: ScratchFile[];
  showToast: (msg: string) => void;
}

const COLLAPSED_KEY = "sess-sidebar-collapsed";
const SORT_KEY = "sess-sidebar-sort";
const DISPLAY_KEY = "sess-sidebar-display";

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
};

export function SessionPanel({
  sessions,
  activeSessionId,
  onSessionSelect,
  onScratchFileSelect,
  onDeleteScratchFile,
  onRenameScratchFile,
  scratchFiles = [],
  showToast,
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

  const scratchFilesBySession = useMemo(() => {
    const map = new Map<string, ScratchFile[]>();
    for (const f of scratchFiles) {
      const list = map.get(f.sessionId) || [];
      list.push(f);
      map.set(f.sessionId, list);
    }
    return map;
  }, [scratchFiles]);

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
          <IconBtn
            title={displayMode === "condensed" ? "Verbose view" : "Condensed view"}
            onClick={toggleDisplayMode}
          >
            {displayMode === "condensed" ? <VerboseIcon /> : <CondensedIcon />}
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
          <div className="text-xs text-gh-text-secondary px-2 py-1">
            {hasFilters ? "No sessions match filters" : "No sessions"}
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
                onScratchFileSelect={onScratchFileSelect}
                onDeleteScratchFile={onDeleteScratchFile}
                onRenameScratchFile={onRenameScratchFile}
                expandedParentId={expandedParentId}
                onExpandParent={setExpandedParentId}
                scratchFilesBySession={scratchFilesBySession}
                onContextMenu={handleContextMenu}
                displayMode={displayMode}
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
              icon: (
                <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
                </svg>
              ),
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
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
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

  const displayLabel = value || `All ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[11px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          value
            ? "border-accent-border bg-accent-muted text-accent"
            : "border-gh-border text-gh-text-secondary hover:border-accent-border hover:text-gh-text"
        }`}
      >
        {label}: {displayLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-surface-elevated border border-gh-border rounded-lg shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
          <button
            type="button"
            className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
              !value
                ? "text-gh-text bg-gh-bg-active"
                : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
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
                  ? "text-gh-text bg-gh-bg-active"
                  : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
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
  onScratchFileSelect,
  onDeleteScratchFile,
  onRenameScratchFile,
  expandedParentId,
  onExpandParent,
  scratchFilesBySession,
  onContextMenu,
  displayMode,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
  onDeleteScratchFile?: (sessionId: string, fileId: string) => void;
  onRenameScratchFile?: (sessionId: string, fileId: string, newTitle: string) => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  scratchFilesBySession: Map<string, ScratchFile[]>;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
  displayMode: DisplayMode;
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
                scratchFiles={sessionScratchFiles}
                onScratchFileSelect={onScratchFileSelect}
                onDeleteScratchFile={onDeleteScratchFile}
                onRenameScratchFile={onRenameScratchFile}
                onContextMenu={onContextMenu}
                displayMode={displayMode}
              />
            );
          })}
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
  scratchFiles = [],
  onScratchFileSelect,
  onDeleteScratchFile,
  onRenameScratchFile,
  onContextMenu,
  displayMode,
}: {
  session: Session;
  childNodes: TreeNode[];
  isActive: boolean;
  activeSessionId: string | null;
  onSelect: () => void;
  expandedParentId: string | null;
  onExpandParent: (id: string) => void;
  scratchFiles?: ScratchFile[];
  onScratchFileSelect?: (sessionId: string, fileId: string) => void;
  onDeleteScratchFile?: (sessionId: string, fileId: string) => void;
  onRenameScratchFile?: (sessionId: string, fileId: string, newTitle: string) => void;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
  displayMode: DisplayMode;
}) {
  const { navigateToSession } = useSessionNav();
  const subCount = childNodes.length;
  const subsVisible = session.id === expandedParentId;
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingFileId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFileId]);

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
        onContextMenu={(e) => onContextMenu(session.id, e)}
        title={session.directory || session.repository}
        className={`session-draggable sess-parent-session w-full text-left transition-all ${
          isActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
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
        {displayMode === "verbose" && <VerboseStats session={session} />}
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
                onContextMenu={(e) => onContextMenu(session.id, e)}
                title={session.directory || session.title}
                className={`session-draggable w-full flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 text-left rounded-r-md transition-colors ${
                  subActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
                }`}
              >
                <span className="text-[11px] text-accent/80 shrink-0">&rarr;</span>
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

      {scratchFiles.length > 0 && subsVisible && onScratchFileSelect && (
        <div className="ml-2 mt-px mb-1 space-y-px border-l border-gh-border/40">
          {scratchFiles.map((sf) => (
            <div
              key={sf.id}
              className="group flex items-center rounded-r-md transition-colors hover:bg-gh-bg-hover"
            >
              {renamingFileId === sf.id ? (
                <div className="flex-1 flex items-center pl-1 py-0.5">
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        const val = renameValue.trim();
                        if (val) {
                          onRenameScratchFile?.(session.id, sf.id, val);
                        }
                        setRenamingFileId(null);
                      } else if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenamingFileId(null);
                      }
                    }}
                    onBlur={() => {
                      const val = renameValue.trim();
                      if (val && val !== sf.title) {
                        onRenameScratchFile?.(session.id, sf.id, val);
                      }
                      setRenamingFileId(null);
                    }}
                    className="flex-1 bg-gh-bg-secondary text-[11px] text-gh-text outline-none border border-accent-border rounded px-1 py-0.5 min-w-0"
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onScratchFileSelect?.(session.id, sf.id)}
                    className="flex-1 flex items-center gap-1.5 pl-1 py-0.5 text-left min-w-0"
                    title={sf.title}
                  >
                    <svg
                      className="size-3 text-gh-text-secondary shrink-0"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 9 3.25V1.5H3.75Z" />
                    </svg>
                    <span className="text-[11px] truncate flex-1 text-gh-text-secondary">
                      {sf.title}
                    </span>
                    <span className="text-[11px] opacity-60 tabular-nums shrink-0">
                      {new Date(sf.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <div className="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity">
                    {onRenameScratchFile && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameValue(sf.title);
                          setRenamingFileId(sf.id);
                        }}
                        className="shrink-0 p-1 text-gh-text-secondary hover:text-accent cursor-pointer"
                        title="Rename"
                      >
                        <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.745 8.815a.25.25 0 0 0-.063.109l-.579 2.027 2.027-.579a.25.25 0 0 0 .109-.063l8.273-8.273a.25.25 0 0 0 0-.354l-1.086-1.086Z" />
                        </svg>
                      </button>
                    )}
                    {onDeleteScratchFile && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteScratchFile(session.id, sf.id);
                        }}
                        className="shrink-0 p-1 text-gh-text-secondary hover:text-red-400 cursor-pointer"
                        title="Delete scratch file"
                      >
                        <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.272l-.98 9.8a1.75 1.75 0 0 1-1.738 1.56H5.74a1.75 1.75 0 0 1-1.738-1.56l-.98-9.8H3A.75.75 0 0 1 3 3h2.25V1.75A1.75 1.75 0 0 1 7 0h2a1.75 1.75 0 0 1 1.75 1.75ZM5.26 14.5a.25.25 0 0 1-.248-.223l-.96-9.61h8.896l-.96 9.61a.25.25 0 0 1-.248.223H5.26Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VerboseStats ────────────────────────────────────────────────

function VerboseStats({ session }: { session: Session }) {
  const totalTokens = session.tokensInput + session.tokensOutput;
  const parts: ReactNode[] = [];

  if (totalTokens > 0) {
    parts.push(
      <span key="tokens" title="Tokens">
        {(totalTokens / 1000).toFixed(0)}k tok
      </span>,
    );
  }
  if (session.cost > 0) {
    parts.push(
      <span key="cost" title="Cost">
        {formatCost(session.cost)}
      </span>,
    );
  }
  if (session.messageCount > 0) {
    parts.push(
      <span key="msgs" title="Messages">
        {session.messageCount} msgs
      </span>,
    );
  }
  if (session.diffFiles > 0) {
    parts.push(
      <span key="files" title="Files changed">
        {session.diffFiles}f <span className="text-green-500">+{session.diffAdditions}</span>
        <span className="text-red-500">-{session.diffDeletions}</span>
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <p className="sess-parent-session-meta truncate mt-0.5">
      {parts.flatMap((part, i) =>
        i === 0
          ? [part]
          : [<span key={`dot-${i}`} className="mx-1">·</span>, part],
      )}
    </p>
  );
}

// ─── Small SVG icons ──────────────────────────────────────────────

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

/** Compact line-spacing icon (Word-style single spacing) */
function CondensedIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 4a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 4a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}

/** Expanded line-spacing icon (Word-style double spacing) */
function VerboseIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}
