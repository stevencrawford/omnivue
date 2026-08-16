import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, Loader, Slash } from "lucide-react";
import { Modal } from "./ui/Modal";
import type { Tag } from "../hooks/types";
import { tagColor, hasTagColor, TAG_COLORS, TAG_NO_COLOR } from "../utils/tagColors";
import {
  fetchTags,
  fetchSessionTags,
  createTag,
  assignTagToSession,
  unassignTagFromSession,
} from "../hooks/apiClient";

interface ManageTagsDialogProps {
  isOpen: boolean;
  sessionId: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function ManageTagsDialog({ isOpen, sessionId, onClose, onChanged }: ManageTagsDialogProps) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [sessionTags, setSessionTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(TAG_NO_COLOR);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFilter("");
      setCreating(false);
      setNewName("");
      loadTags();
      setTimeout(() => filterRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const [tags, sessionTags] = await Promise.all([fetchTags(), fetchSessionTags(sessionId)]);
      setAllTags(tags);
      setSessionTags(sessionTags);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [sessionId]);

  const toggleTag = async (tag: Tag) => {
    const assigned = sessionTags.some((t) => t.id === tag.id);
    setBusyId(tag.id);
    try {
      if (assigned) {
        await unassignTagFromSession(tag.id, sessionId);
      } else {
        await assignTagToSession(tag.id, sessionId);
      }
      await loadTags();
      onChanged?.();
    } catch {
      /* ignore */
    }
    setBusyId(null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const tag = await createTag(name, newColor || undefined);
      await assignTagToSession(tag.id, sessionId);
      await loadTags();
      onChanged?.();
      setCreating(false);
      setNewName("");
    } catch {
      /* ignore */
    }
  };

  const filtered = allTags.filter(
    (t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Tags" size="md">
      <div className="space-y-3">
        <input
          ref={filterRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tags..."
          className="w-full text-xs bg-ov-bg border border-ov-border rounded-md px-2.5 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
        />

        <div className="max-h-48 overflow-y-auto space-y-0.5 -mx-1">
          {loading ? (
            <div className="text-xs text-ov-text-secondary px-3 py-2">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-ov-text-secondary px-3 py-2">
              {filter ? "No matching tags" : "No tags yet"}
            </div>
          ) : (
            filtered.map((tag) => {
              const assigned = sessionTags.some((t) => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={busyId === tag.id}
                  onClick={() => toggleTag(tag)}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer disabled:opacity-40 rounded transition-colors"
                >
                  {hasTagColor(tag.color) ? (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tagColor(tag.color) }}
                    />
                  ) : (
                    <span className="w-2 h-2 shrink-0" />
                  )}
                  <span className="truncate flex-1">{tag.name}</span>
                  {busyId === tag.id ? (
                    <Loader size={12} className="animate-spin shrink-0" />
                  ) : assigned ? (
                    <Check size={12} className="shrink-0 text-accent" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors"
          >
            <Plus size={12} />
            New tag
          </button>
        ) : (
          <div className="space-y-2">
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
                placeholder="Tag name"
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
            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setNewColor(TAG_NO_COLOR)}
                className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center border border-ov-border bg-ov-bg ${
                  newColor === TAG_NO_COLOR
                    ? "ring-2 ring-accent/60 ring-offset-1 ring-offset-surface"
                    : ""
                }`}
                title="No colour"
              >
                <Slash size={10} className="text-ov-text-secondary" />
              </button>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className="w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {newColor === c && (
                    <Check size={10} className="tag-check text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
