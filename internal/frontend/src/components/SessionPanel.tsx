import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, FolderTree, Minus, Plus, Tags } from "lucide-react";
import type { Session } from "../hooks/types";
import { buildTree, type GroupMode } from "../utils/buildTree";
import { shortDir } from "../utils/sessionUtils";
import {
  getDistinctValues,
  filterSessions,
  splitStaleSessions,
  type SessionFilters,
} from "../utils/sessionFilters";
import { useSessionListSettings } from "../hooks/useSessionListSettings";
import { ContextMenu } from "./ContextMenu";
import { ManageTagsDialog } from "./ManageTagsDialog";
import { FilterChip } from "./FilterChip";
import { SessionTree, type DisplayMode } from "./sessions/SessionTree";
import { IconBtn } from "./sessions/IconBtn";
import { GroupMenu } from "./sessions/GroupMenu";
import { STORAGE_KEYS } from "../utils/storageKeys";

function getAncestorChain(sessions: Session[], id: string): string[] {
  const chain: string[] = [];
  let current = sessions.find((s) => s.id === id);
  while (current && current.parentId) {
    const parentId = current.parentId;
    chain.unshift(parentId);
    current = sessions.find((s) => s.id === parentId);
  }
  return chain;
}

interface SessionPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  sessionUnread?: Record<string, number>;
}

const COLLAPSED_KEY = STORAGE_KEYS.SIDEBAR_COLLAPSED;
const GROUP_KEY = STORAGE_KEYS.SIDEBAR_GROUP;
const DISPLAY_KEY = STORAGE_KEYS.SIDEBAR_DISPLAY;

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    /* noop */
  }
  return new Set();
}

function getInitialGroup(): GroupMode {
  try {
    const stored = localStorage.getItem(GROUP_KEY);
    if (stored === "repo" || stored === "cwd" || stored === "model" || stored === "none") {
      return stored;
    }
  } catch {
    /* noop */
  }
  return "repo";
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

export function SessionPanel({
  sessions,
  activeSessionId,
  onSessionSelect,
  sessionUnread = {},
}: SessionPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [groupMode, setGroupMode] = useState<GroupMode>(getInitialGroup);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getInitialDisplay);
  const { hideStale, staleDays, setHideStale } = useSessionListSettings();
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
  const [toggledIds, setToggledIds] = useState<Set<string>>(new Set());
  const prevActiveRef = useRef(activeSessionId);

  const toggleExpand = useCallback((id: string) => {
    setToggledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // On navigation, clear manual toggles and auto-expand the ancestor chain
  useEffect(() => {
    if (!activeSessionId) return;
    if (activeSessionId !== prevActiveRef.current) {
      prevActiveRef.current = activeSessionId;
      setToggledIds(new Set());
    }
  }, [activeSessionId]);

  // Derive the full set of expanded IDs: ancestors of active session + manual toggles
  const expandedIds = useMemo(() => {
    const ids = new Set(toggledIds);
    if (activeSessionId) {
      for (const id of getAncestorChain(sessions, activeSessionId)) ids.add(id);
      if (sessions.some((s) => s.parentId === activeSessionId)) ids.add(activeSessionId);
    }
    return ids;
  }, [toggledIds, activeSessionId, sessions]);
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [tagsSessionId, setTagsSessionId] = useState<string | null>(null);

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

  const filteredSessions = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);

  // Sessions that must remain visible even when stale: the selected session
  // and any session with unread notifications (live "inbox" reminders).
  const keepIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSessionId) ids.add(activeSessionId);
    for (const [id, count] of Object.entries(sessionUnread)) {
      if (count > 0) ids.add(id);
    }
    return ids;
  }, [activeSessionId, sessionUnread]);

  const { visible: visibleSessions, stale: staleSessions } = useMemo(
    () => splitStaleSessions(filteredSessions, Date.now(), staleDays, keepIds),
    [filteredSessions, staleDays, keepIds],
  );

  const staleIds = useMemo(() => new Set(staleSessions.map((s) => s.id)), [staleSessions]);

  const treeSessions = hideStale ? visibleSessions : filteredSessions;

  const tree = useMemo(() => buildTree(treeSessions, groupMode), [treeSessions, groupMode]);

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
    const all = new Set(tree.filter((n) => n.isGroup).map((n) => n.fullPath));
    setCollapsed(all);
    saveCollapsed(all);
  }, [tree, saveCollapsed]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
    saveCollapsed(new Set());
  }, [saveCollapsed]);

  const setGroup = useCallback((mode: GroupMode) => {
    setGroupMode(mode);
    setGroupOpen(false);
    try {
      localStorage.setItem(GROUP_KEY, mode);
    } catch {
      /* noop */
    }
  }, []);

  const toggleHideStale = useCallback(() => {
    setHideStale(!hideStale);
  }, [hideStale, setHideStale]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setGroupOpen(false);
      }
    };
    if (groupOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [groupOpen]);

  const groupNodes = tree.filter((n) => n.isGroup);
  const allCollapsed = groupNodes.length > 0 && groupNodes.every((n) => collapsed.has(n.fullPath));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          {groupMode !== "none" && (
            <IconBtn
              title={allCollapsed ? "Expand all groups" : "Collapse all groups"}
              onClick={allCollapsed ? expandAll : collapseAll}
            >
              {allCollapsed ? <Plus size={14} /> : <Minus size={14} />}
            </IconBtn>
          )}
          <div className="relative" ref={groupRef}>
            <IconBtn title="Group by" onClick={() => setGroupOpen((v) => !v)}>
              <FolderTree size={14} />
            </IconBtn>
            <GroupMenu open={groupOpen} groupMode={groupMode} onSelect={setGroup} />
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
          <IconBtn
            title={hideStale ? "Show all sessions" : "Hide completed sessions"}
            onClick={toggleHideStale}
            active={hideStale}
          >
            <Archive size={14} />
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
          <SessionTree
            nodes={tree}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            activeSessionId={activeSessionId}
            onSessionSelect={onSessionSelect}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onContextMenu={handleContextMenu}
            displayMode={displayMode}
            sessionUnread={sessionUnread}
            staleIds={staleIds}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Add Tags...",
              icon: <Tags size={14} />,
              onClick: () => {
                setTagsSessionId(contextMenu.sessionId);
              },
            },
          ]}
        />
      )}

      {tagsSessionId && (
        <ManageTagsDialog
          isOpen={!!tagsSessionId}
          sessionId={tagsSessionId}
          onClose={() => setTagsSessionId(null)}
        />
      )}
    </div>
  );
}
