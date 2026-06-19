import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Minus,
  ArrowUpDown,
  ChevronRight,
  Folder as FolderIcon,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
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

interface FolderPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

type FolderSort = "name" | "count";

export function FolderPanel({ sessions, activeSessionId, onSessionSelect }: FolderPanelProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSessions, setFolderSessions] = useState<Record<string, string[]>>({});
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assigningFolder, setAssigningFolder] = useState<string | null>(null);
  const [folderSort, setFolderSort] = useState<FolderSort>("name");
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [folderSortOpen, setFolderSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Close sort dropdown on outside click
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
      if (expandedFolder === id) setExpandedFolder(null);
      loadFolders();
    } catch (err) {
      console.error("Failed to delete folder:", err);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedFolder === id) {
      setExpandedFolder(null);
      return;
    }
    setExpandedFolder(id);
    try {
      const ids = await fetchFolderSessions(id);
      setFolderSessions((prev) => ({ ...prev, [id]: ids }));
    } catch (err) {
      console.error("Failed to load folder sessions:", err);
    }
  };

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
    <div className="border-b border-gh-border pb-1 mb-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gh-text-secondary">
          Folders
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setAllCollapsed((v) => !v)}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
            title={allCollapsed ? "Expand all" : "Collapse all"}
          >
            {allCollapsed ? <Plus size={14} /> : <Minus size={14} />}
          </button>
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setFolderSortOpen((v) => !v)}
              className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
              title="Sort folders"
            >
              <ArrowUpDown size={14} />
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
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Create new folder */}
      {creating && (
        <div className="px-2 py-1">
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
      {sortedFolders.length === 0 && !creating && (
        <div className="text-[11px] text-gh-text-secondary px-2 py-1">No folders yet</div>
      )}
      {sortedFolders.map((folder) => (
        <div key={folder.id} className="group">
          <div
            className="flex items-center gap-1 px-2 py-0.5 transition-colors"
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
                className={`flex items-center gap-1.5 flex-1 text-xs cursor-pointer truncate transition-colors ${
                  allCollapsed && expandedFolder !== folder.id
                    ? "text-gh-text-secondary"
                    : "text-gh-text-secondary hover:text-gh-text"
                }`}
                onClick={() => !allCollapsed && toggleExpand(folder.id)}
              >
                <ChevronRight
                  size={10}
                  className={`transition-transform ${
                    !allCollapsed && expandedFolder === folder.id ? "rotate-90" : ""
                  }`}
                />
                <FolderIcon size={12} className="shrink-0" />
                <span className="truncate">{folder.name}</span>
                {folderSessions[folder.id] && (
                  <span className="text-[11px] text-gh-text-secondary ml-auto">
                    {folderSessions[folder.id].length}
                  </span>
                )}
              </button>
            )}
            {/* Actions (visible on hover) */}
            {editingId !== folder.id && (
              <div className="hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setAssigningFolder(assigningFolder === folder.id ? null : folder.id)
                  }
                  className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                  title="Add session"
                >
                  <Plus size={12} />
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
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(folder.id)}
                  className="text-gh-text-secondary hover:text-red-400 cursor-pointer p-0.5"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Assign session picker */}
          {assigningFolder === folder.id && (
            <AssignPicker
              sessions={sessions}
              assignedIds={folderSessions[folder.id] || []}
              onAssign={(sid) => handleAssign(folder.id, sid)}
              onClose={() => setAssigningFolder(null)}
            />
          )}

          {/* Expanded folder sessions */}
          {!allCollapsed && expandedFolder === folder.id && folderSessions[folder.id] && (
            <div>
              {folderSessions[folder.id].length === 0 ? (
                <div className="text-[11px] text-gh-text-secondary px-2 py-1">Empty</div>
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
                    />
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Folder Session Row ---

interface FolderSessionRowProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function FolderSessionRow({ session, isActive, onSelect, onRemove }: FolderSessionRowProps) {
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
        <X size={10} />
      </button>
    </div>
  );
}

// --- Assign Picker (dropdown to pick a session to add) ---

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
