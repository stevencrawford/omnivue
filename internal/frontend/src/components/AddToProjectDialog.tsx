import { useCallback, useEffect, useRef, useState } from "react";
import { Folder as FolderIcon, Plus, Loader } from "lucide-react";
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
        <p className="text-xs text-ov-text-secondary">
          Add{" "}
          <span className="text-ov-text font-medium">{sessionTitle || sessionId.slice(0, 12)}</span>{" "}
          to a project:
        </p>

        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects..."
          className="w-full text-xs bg-ov-bg border border-ov-border rounded-md px-2.5 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
        />

        <div className="max-h-48 overflow-y-auto space-y-0.5 -mx-1">
          {loading ? (
            <div className="text-xs text-ov-text-secondary px-3 py-2">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-ov-text-secondary px-3 py-2">
              {filter ? "No matching projects" : "No projects yet"}
            </div>
          ) : (
            filtered.map((folder) => (
              <button
                key={folder.id}
                type="button"
                disabled={assigning === folder.id}
                onClick={() => handleAssign(folder)}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer disabled:opacity-40 rounded transition-colors"
              >
                <FolderIcon size={14} className="shrink-0" />
                <span className="truncate flex-1">{folder.name}</span>
                {assigning === folder.id && <Loader size={12} className="animate-spin shrink-0" />}
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
            <Plus size={12} />
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
              className="flex-1 text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
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
