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

interface FolderPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

export function FolderPanel({ sessions, activeSessionId, onSessionSelect }: FolderPanelProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSessions, setFolderSessions] = useState<Record<string, string[]>>({});
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assigningFolder, setAssigningFolder] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const loadFolders = useCallback(async () => {
    try {
      const data = await fetchFolders();
      setFolders(data);
    } catch {
      /* ignore */
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
    } catch {
      /* ignore */
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateFolder(id, editName.trim());
      setEditingId(null);
      loadFolders();
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFolder(id);
      if (expandedFolder === id) setExpandedFolder(null);
      loadFolders();
    } catch {
      /* ignore */
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
    } catch {
      /* ignore */
    }
  };

  const handleAssign = async (folderId: string, sessionId: string) => {
    try {
      await assignSessionToFolder(folderId, sessionId);
      const ids = await fetchFolderSessions(folderId);
      setFolderSessions((prev) => ({ ...prev, [folderId]: ids }));
      setAssigningFolder(null);
    } catch {
      /* ignore */
    }
  };

  const handleUnassign = async (folderId: string, sessionId: string) => {
    try {
      await unassignSessionFromFolder(folderId, sessionId);
      const ids = await fetchFolderSessions(folderId);
      setFolderSessions((prev) => ({ ...prev, [folderId]: ids }));
    } catch {
      /* ignore */
    }
  };

  const getSession = (id: string) => sessions.find((s) => s.id === id);

  return (
    <div className="border-b border-gh-border pb-1 mb-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gh-text-secondary">
          Folders
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-gh-text-secondary hover:text-gh-text cursor-pointer"
          title="New folder"
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
          </svg>
        </button>
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
              if (e.key === "Escape") { setCreating(false); setNewName(""); }
            }}
            onBlur={() => { if (!newName.trim()) setCreating(false); }}
            placeholder="Folder name"
            className="w-full text-xs bg-gh-bg border border-gh-border rounded px-2 py-1 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-blue-400"
          />
        </div>
      )}

      {/* Folder list */}
      {folders.length === 0 && !creating && (
        <div className="text-[10px] text-gh-text-secondary px-2 py-1">No folders yet</div>
      )}
      {folders.map((folder) => (
        <div key={folder.id} className="group">
          <div className="flex items-center gap-1 px-2 py-0.5">
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
                className="flex-1 text-xs bg-gh-bg border border-gh-border rounded px-1.5 py-0.5 text-gh-text outline-none focus:border-blue-400"
              />
            ) : (
              <button
                type="button"
                className="flex items-center gap-1.5 flex-1 text-xs text-gh-text-secondary hover:text-gh-text cursor-pointer truncate"
                onClick={() => toggleExpand(folder.id)}
              >
                <svg
                  className={`size-2.5 transition-transform ${expandedFolder === folder.id ? "rotate-90" : ""}`}
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
                </svg>
                <span className="truncate">{folder.name}</span>
                {folderSessions[folder.id] && (
                  <span className="text-[10px] text-gh-text-secondary ml-auto">
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
                  onClick={() => setAssigningFolder(assigningFolder === folder.id ? null : folder.id)}
                  className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                  title="Add session"
                >
                  <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingId(folder.id); setEditName(folder.name); }}
                  className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5"
                  title="Rename"
                >
                  <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z" />
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
          {expandedFolder === folder.id && folderSessions[folder.id] && (
            <div className="ml-5 border-l border-gh-border">
              {folderSessions[folder.id].length === 0 ? (
                <div className="text-[10px] text-gh-text-secondary px-2 py-1">Empty</div>
              ) : (
                folderSessions[folder.id].map((sid) => {
                  const sess = getSession(sid);
                  if (!sess) return null;
                  return (
                    <div key={sid} className="flex items-center group/item">
                      <button
                        type="button"
                        className={`flex-1 text-left px-2 py-1 text-xs truncate cursor-pointer transition-colors ${
                          sid === activeSessionId
                            ? "text-gh-text bg-gh-bg-active"
                            : "text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover"
                        }`}
                        onClick={() => onSessionSelect(sid)}
                      >
                        {sess.title || sid.slice(0, 12)}
                      </button>
                      <button
                        type="button"
                        className="hidden group-hover/item:block text-gh-text-secondary hover:text-red-400 cursor-pointer p-1"
                        onClick={() => handleUnassign(folder.id, sid)}
                        title="Remove from folder"
                      >
                        <svg className="size-2.5" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                        </svg>
                      </button>
                    </div>
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
    (s) => !assignedIds.includes(s.id) && (
      !filter || s.title.toLowerCase().includes(filter.toLowerCase()) ||
      s.repository.toLowerCase().includes(filter.toLowerCase())
    )
  );

  return (
    <div className="mx-2 my-1 border border-gh-border rounded bg-gh-bg shadow-sm max-h-40 flex flex-col">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        placeholder="Filter sessions..."
        className="text-xs bg-transparent border-b border-gh-border px-2 py-1 text-gh-text placeholder:text-gh-text-secondary outline-none"
      />
      <div className="flex-1 overflow-y-auto">
        {unassigned.length === 0 ? (
          <div className="text-[10px] text-gh-text-secondary p-2 text-center">No sessions to add</div>
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
                <span className="text-[10px] text-gh-text-secondary ml-1">({s.repository})</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
