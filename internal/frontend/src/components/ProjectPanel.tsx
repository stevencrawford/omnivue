import { useCallback, useEffect, useRef, useState } from "react";
import type { Folder, Session } from "../hooks/useApi";
import {
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  fetchFolderSessions,
  assignSessionToFolder,
  unassignSessionFromFolder,
} from "../hooks/useApi";
import { sessionTitle, sessionMetaParts, relativeTime } from "../utils/sessionUtils";
import { ContextMenu } from "./ContextMenu";
import { AddToProjectDialog } from "./AddToProjectDialog";

interface ProjectPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  showToast: (msg: string) => void;
}

type FolderSort = "name" | "count";

const EXPANDED_KEY = "sess-project-folders-expanded";

function getInitialExpanded(): Set<string> {
  try {
    const stored = localStorage.getItem(EXPANDED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    /* noop */
  }
  return new Set();
}

function saveExpanded(next: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  } catch {
    /* noop */
  }
}

export function ProjectPanel({
  sessions,
  activeSessionId,
  onSessionSelect,
  showToast,
}: ProjectPanelProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSessions, setFolderSessions] = useState<Record<string, string[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(getInitialExpanded);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assigningFolder, setAssigningFolder] = useState<string | null>(null);
  const [folderSort, setFolderSort] = useState<FolderSort>("name");
  const [folderSortOpen, setFolderSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    saveExpanded(expandedFolders);
  }, [expandedFolders]);

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

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setFolderSortOpen(false);
      }
    };
    if (folderSortOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [folderSortOpen]);

  const loadFolders = useCallback(async () => {
    try {
      const data = await fetchFolders();
      setFolders(data);
    } catch (err) {
      console.error("Failed to load folders:", err);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createFolder(newName.trim());
      setNewName("");
      setCreating(false);
      loadFolders();
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateFolder(id, editName.trim());
      setEditingId(null);
      loadFolders();
    } catch (err) {
      console.error("Failed to rename folder:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFolder(id);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadFolders();
    } catch (err) {
      console.error("Failed to delete folder:", err);
    }
  };

  const toggleExpand = async (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    try {
      const ids = await fetchFolderSessions(id);
      setFolderSessions((prev) => ({ ...prev, [id]: ids }));
    } catch (err) {
      console.error("Failed to load folder sessions:", err);
    }
  };

  const expandAll = useCallback(() => {
    setExpandedFolders(new Set(folders.map((f) => f.id)));
    folders.forEach((f) => {
      fetchFolderSessions(f.id)
        .then((ids) => {
          setFolderSessions((prev) => ({ ...prev, [f.id]: ids }));
        })
        .catch(() => {});
    });
  }, [folders]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  const handleDrop = async (folderId: string, sessionId: string) => {
    try {
      await assignSessionToFolder(folderId, sessionId);
      const ids = await fetchFolderSessions(folderId);
      setFolderSessions((prev) => ({ ...prev, [folderId]: ids }));
    } catch (err) {
      console.error("Failed to assign session to folder:", err);
    }
  };

  const handleAssign = async (folderId: string, sessionId: string) => {
    try {
      await assignSessionToFolder(folderId, sessionId);
      const ids = await fetchFolderSessions(folderId);
      setFolderSessions((prev) => ({ ...prev, [folderId]: ids }));
      setAssigningFolder(null);
    } catch (err) {
      console.error("Failed to assign session to folder:", err);
    }
  };

  const handleUnassign = async (folderId: string, sessionId: string) => {
    try {
      await unassignSessionFromFolder(folderId, sessionId);
      const ids = await fetchFolderSessions(folderId);
      setFolderSessions((prev) => ({ ...prev, [folderId]: ids }));
    } catch (err) {
      console.error("Failed to unassign session from folder:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const getSession = (id: string) => sessions.find((s) => s.id === id);

  const sortedFolders = [...folders].sort((a, b) => {
    if (folderSort === "count") {
      const aCount = folderSessions[a.id]?.length || 0;
      const bCount = folderSessions[b.id]?.length || 0;
      return bCount - aCount;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gh-text-secondary">
          Projects
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              const allExpanded =
                folders.length > 0 && folders.every((f) => expandedFolders.has(f.id));
              if (allExpanded) collapseAll();
              else expandAll();
            }}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
            title={
              folders.length > 0 && folders.every((f) => expandedFolders.has(f.id))
                ? "Collapse all"
                : "Expand all"
            }
          >
            {folders.length > 0 && folders.every((f) => expandedFolders.has(f.id)) ? (
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
              </svg>
            ) : (
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
              </svg>
            )}
          </button>
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setFolderSortOpen((v) => !v)}
              className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
              title="Sort folders"
            >
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 2.75a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 4.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" />
              </svg>
            </button>
            {folderSortOpen && (
              <div className="absolute left-0 top-full mt-1 w-24 bg-surface-elevated border border-gh-border rounded-lg shadow-lg z-20 py-1">
                {(["name", "count"] as FolderSort[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                      folderSort === mode
                        ? "sess-session-active"
                        : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
                    }`}
                    onClick={() => {
                      setFolderSort(mode);
                      setFolderSortOpen(false);
                    }}
                  >
                    {mode === "name" ? "Name" : "Count"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
            title="New folder"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create new folder */}
      {creating && (
        <div className="px-1.5 pb-1">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            onBlur={() => {
              if (!newName.trim()) setCreating(false);
            }}
            placeholder="Folder name"
            className="w-full text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
          />
        </div>
      )}

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {sortedFolders.length === 0 && !creating && (
          <div className="text-[11px] text-gh-text-secondary px-1 py-2">No folders yet</div>
        )}
        {sortedFolders.map((folder) => (
          <div key={folder.id} className="group">
            <div
              className="flex items-center gap-1 px-1 py-0.5 rounded transition-colors hover:bg-gh-bg-hover"
              onDragOver={handleDragOver}
              onDrop={(e) => {
                e.preventDefault();
                const sessionId = e.dataTransfer.getData("text/plain");
                if (sessionId) handleDrop(folder.id, sessionId);
              }}
            >
              {editingId === folder.id ? (
                <input
                  ref={editRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(folder.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => handleRename(folder.id)}
                  className="flex-1 text-xs bg-gh-bg border border-gh-border rounded-md px-1.5 py-0.5 text-gh-text outline-none focus:border-accent"
                />
              ) : (
                <button
                  type="button"
                  className={`flex items-center gap-1.5 flex-1 text-xs cursor-pointer truncate transition-colors text-gh-text-secondary hover:text-gh-text`}
                  onClick={() => toggleExpand(folder.id)}
                >
                  <svg
                    className={`size-2.5 transition-transform shrink-0 ${
                      expandedFolders.has(folder.id) ? "rotate-90" : ""
                    }`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
                  </svg>
                  <span className="truncate">{folder.name}</span>
                  {folderSessions[folder.id] && (
                    <span className="text-[11px] text-gh-text-secondary ml-auto tabular-nums">
                      {folderSessions[folder.id].length}
                    </span>
                  )}
                </button>
              )}
              {editingId !== folder.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setAssigningFolder(assigningFolder === folder.id ? null : folder.id)
                    }
                    className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                    title="Add session"
                  >
                    <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(folder.id);
                      setEditName(folder.name);
                    }}
                    className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                    title="Rename"
                  >
                    <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(folder.id)}
                    className="text-gh-text-secondary hover:text-red-400 cursor-pointer p-0.5"
                    title="Delete"
                  >
                    <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15H5.405a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15Z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {assigningFolder === folder.id && (
              <AssignPicker
                sessions={sessions}
                assignedIds={folderSessions[folder.id] || []}
                onAssign={(sid) => handleAssign(folder.id, sid)}
                onClose={() => setAssigningFolder(null)}
              />
            )}

            {expandedFolders.has(folder.id) && folderSessions[folder.id] && (
              <div>
                {folderSessions[folder.id].length === 0 ? (
                  <div className="text-[11px] text-gh-text-secondary px-3 py-1">Empty</div>
                ) : (
                  folderSessions[folder.id].map((sid) => {
                    const sess = getSession(sid);
                    if (!sess) return null;
                    return (
                      <FolderSessionRow
                        key={sid}
                        session={sess}
                        isActive={sid === activeSessionId}
                        onSelect={() => onSessionSelect(sid)}
                        onRemove={() => handleUnassign(folder.id, sid)}
                        onContextMenu={handleContextMenu}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        ))}
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

// ─── Folder Session Row ──────────────────────────────────────────

interface FolderSessionRowProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onContextMenu: (sessionId: string, e: React.MouseEvent) => void;
}

function FolderSessionRow({
  session,
  isActive,
  onSelect,
  onRemove,
  onContextMenu,
}: FolderSessionRowProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="group/item relative">
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onClick={onSelect}
        onContextMenu={(e) => onContextMenu(session.id, e)}
        title={session.directory || session.repository}
        className={`session-draggable sess-parent-session w-full text-left transition-all ${
          isActive ? "sess-session-active" : "hover:bg-gh-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-6">
          <span
            className={`sess-parent-session-title truncate flex-1 ${isActive ? "text-gh-text" : "text-gh-text"}`}
          >
            {sessionTitle(session)}
          </span>
          <span className="shrink-0 text-[11px] text-gh-text-secondary tabular-nums">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
        {sessionMetaParts(session).length > 0 && (
          <p className="sess-parent-session-meta truncate mt-0.5 pr-6">
            {sessionMetaParts(session).join(" · ")}
          </p>
        )}
      </button>
      <button
        type="button"
        className="hidden group-hover/item:block absolute right-1 top-1/2 -translate-y-1/2 text-gh-text-secondary hover:text-red-400 cursor-pointer p-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove from folder"
      >
        <svg className="size-2.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Assign Picker ────────────────────────────────────────────────

interface AssignPickerProps {
  sessions: Session[];
  assignedIds: string[];
  onAssign: (sessionId: string) => void;
  onClose: () => void;
}

function AssignPicker({ sessions, assignedIds, onAssign, onClose }: AssignPickerProps) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const unassigned = sessions.filter(
    (s) =>
      !assignedIds.includes(s.id) &&
      (!filter ||
        s.title.toLowerCase().includes(filter.toLowerCase()) ||
        s.repository.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="mx-2 my-1 border border-gh-border rounded bg-gh-bg shadow-sm max-h-40 flex flex-col">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="Filter sessions..."
        className="text-xs bg-transparent border-b border-gh-border px-2 py-1 text-gh-text placeholder:text-gh-text-secondary outline-none"
      />
      <div className="flex-1 overflow-y-auto">
        {unassigned.length === 0 ? (
          <div className="text-[11px] text-gh-text-secondary p-2 text-center">
            No sessions to add
          </div>
        ) : (
          unassigned.slice(0, 20).map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2 py-1 text-xs text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer truncate"
              onClick={() => onAssign(s.id)}
            >
              {s.title || s.id.slice(0, 12)}
              {s.repository && (
                <span className="text-[11px] text-gh-text-secondary ml-1">({s.repository})</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
