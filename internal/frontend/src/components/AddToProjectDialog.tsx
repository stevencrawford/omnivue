import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { fetchFolders, createFolder, assignSessionToFolder } from "../hooks/useApi";
import type { Folder } from "../hooks/useApi";

interface AddToProjectDialogProps {
  isOpen: boolean;
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
  onAssigned: (folderName: string) => void;
}

export function AddToProjectDialog({
  isOpen,
  sessionId,
  sessionTitle,
  onClose,
  onAssigned,
}: AddToProjectDialogProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFilter("");
      setCreating(false);
      setNewName("");
      setAssigning(null);
      loadFolders();
      setTimeout(() => filterRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFolders();
      setFolders(data);
    } catch {
      console.error("Failed to load folders");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAssign = async (folder: Folder) => {
    setAssigning(folder.id);
    try {
      await assignSessionToFolder(folder.id, sessionId);
      onAssigned(folder.name);
      onClose();
    } catch (err) {
      console.error("Failed to assign session:", err);
    } finally {
      setAssigning(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const folder = await createFolder(name);
      await assignSessionToFolder(folder.id, sessionId);
      onAssigned(folder.name);
      onClose();
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  };

  const filtered = folders.filter(
    (f) => !filter || f.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add to Project" size="md">
      <div className="space-y-3">
        <p className="text-xs text-gh-text-secondary">
          Add{" "}
          <span className="text-gh-text font-medium">{sessionTitle || sessionId.slice(0, 12)}</span>{" "}
          to a project:
        </p>

        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects..."
          className="w-full text-xs bg-gh-bg border border-gh-border rounded-md px-2.5 py-1.5 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
        />

        <div className="max-h-48 overflow-y-auto space-y-0.5 -mx-1">
          {loading ? (
            <div className="text-xs text-gh-text-secondary px-3 py-2">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-gh-text-secondary px-3 py-2">
              {filter ? "No matching projects" : "No projects yet"}
            </div>
          ) : (
            filtered.map((folder) => (
              <button
                key={folder.id}
                type="button"
                disabled={assigning === folder.id}
                onClick={() => handleAssign(folder)}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer disabled:opacity-40 rounded transition-colors"
              >
                <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
                </svg>
                <span className="truncate flex-1">{folder.name}</span>
                {assigning === folder.id && (
                  <svg
                    className="size-3 animate-spin shrink-0"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 10.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z"
                      opacity="0.3"
                    />
                    <path d="M8 2a6 6 0 0 1 5.22 3.1l-1.33.74A4.5 4.5 0 0 0 8 3.5Z" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>

        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors"
          >
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
            New project
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
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
              placeholder="Project name"
              className="flex-1 text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
              autoFocus
            />
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={handleCreate}
              className="text-xs px-3 py-1.5 rounded-md border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent-border bg-accent-muted text-accent hover:bg-accent/20"
            >
              Create
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
