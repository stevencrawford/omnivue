import { useCallback, useEffect, useRef, useState } from "react";
import { Folder as FolderIcon, Plus, Loader } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { fetchFolders, createFolder, assignSessionToFolder } from "../hooks/useApi";
import type { Folder } from "../hooks/useApi";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-ov-text-secondary">
            Add{" "}
            <span className="text-ov-text font-medium">
              {sessionTitle || sessionId.slice(0, 12)}
            </span>{" "}
            to a project:
          </p>

          <Input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter projects..."
            className="w-full h-auto text-xs px-2.5 py-1.5"
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
                  {assigning === folder.id && (
                    <Loader size={12} className="animate-spin shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {!creating ? (
            <Button variant="link" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              New project
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
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
                className="flex-1 h-auto text-xs px-2 py-1.5"
                autoFocus
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!newName.trim()}
                onClick={handleCreate}
              >
                Create
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
