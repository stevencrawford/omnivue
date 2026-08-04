import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Tags as TagsIcon } from "lucide-react";
import type { Session, Tag } from "../hooks/types";
import {
  fetchTags,
  createTag,
  updateTag,
  deleteTag,
  fetchTagSessions,
  assignTagToSession,
  unassignTagFromSession,
} from "../hooks/apiClient";
import { useTagsContext } from "../hooks/useTags";
import { CreateTagModal } from "./CreateTagModal";
import { TagListHeader, type TagSort } from "./tags/TagListHeader";
import { TagFilterBar } from "./tags/TagFilterBar";
import { TagRow } from "./tags/TagRow";

interface TagPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

const EXPANDED_KEY = "omnivue-tags-expanded";
const SORT_TAG_KEY = "omnivue-tag-sort";

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

async function loadTagSessions(id: string): Promise<string[]> {
  try {
    return await fetchTagSessions(id);
  } catch (err) {
    console.error("Failed to load tag sessions:", err);
    return [];
  }
}

export function TagPanel({ sessions, activeSessionId, onSessionSelect }: TagPanelProps) {
  const { version, filterTag, bump, clearFilter } = useTagsContext();
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagSessions, setTagSessions] = useState<Record<string, string[]>>({});
  const [expandedTags, setExpandedTags] = useState<Set<string>>(getInitialExpanded);
  const initialExpandedRef = useRef<Set<string> | null>(null);
  if (!initialExpandedRef.current) {
    initialExpandedRef.current = getInitialExpanded();
  }
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assigningTag, setAssigningTag] = useState<string | null>(null);
  const [tagSort, setTagSort] = useState<TagSort>(() => {
    try {
      const stored = localStorage.getItem(SORT_TAG_KEY);
      if (stored === "name" || stored === "count") return stored;
    } catch {
      /* noop */
    }
    return "name";
  });
  const [tagSortOpen, setTagSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    saveExpanded(expandedTags);
  }, [expandedTags]);

  useEffect(() => {
    if (tags.length === 0) return;
    tags.forEach((t) => {
      if (initialExpandedRef.current?.has(t.id)) {
        loadTagSessions(t.id).then((ids) => {
          setTagSessions((prev) => ({ ...prev, [t.id]: ids }));
        });
      }
    });
  }, [tags]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_TAG_KEY, tagSort);
    } catch {
      /* noop */
    }
  }, [tagSort]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setTagSortOpen(false);
      }
    };
    if (tagSortOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagSortOpen]);

  const loadTags = useCallback(async () => {
    try {
      const data = await fetchTags();
      setTags(data);
    } catch (err) {
      console.error("Failed to load tags:", err);
      setTags([]);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags, version]);

  useEffect(() => {
    if (!filterTag) return;
    const matched = tags.find((t) => t.name === filterTag);
    if (!matched) return;
    setExpandedTags((prev) => new Set(prev).add(matched.id));
    loadTagSessions(matched.id).then((ids) => {
      setTagSessions((prev) => ({ ...prev, [matched.id]: ids }));
    });
  }, [filterTag, tags]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const handleCreate = async (name: string, color?: string) => {
    try {
      await createTag(name, color);
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
    setCreating(false);
    loadTags();
    bump();
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await updateTag(id, editName.trim());
    } catch (err) {
      console.error("Failed to rename tag:", err);
    }
    setEditingId(null);
    loadTags();
    bump();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTag(id);
    } catch (err) {
      console.error("Failed to delete tag:", err);
    }
    setExpandedTags((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    loadTags();
    bump();
  };

  const toggleExpand = async (id: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    const ids = await loadTagSessions(id);
    setTagSessions((prev) => ({ ...prev, [id]: ids }));
  };

  const expandAll = useCallback(() => {
    setExpandedTags(new Set(tags.map((t) => t.id)));
    tags.forEach((t) => {
      loadTagSessions(t.id).then((ids) => {
        setTagSessions((prev) => ({ ...prev, [t.id]: ids }));
      });
    });
  }, [tags]);

  const collapseAll = useCallback(() => {
    setExpandedTags(new Set());
  }, []);

  const handleDrop = async (tagId: string, sessionId: string) => {
    try {
      await assignTagToSession(tagId, sessionId);
    } catch (err) {
      console.error("Failed to assign session to tag:", err);
    }
    const ids = await loadTagSessions(tagId);
    setTagSessions((prev) => ({ ...prev, [tagId]: ids }));
    bump();
  };

  const handleAssign = async (tagId: string, sessionId: string) => {
    try {
      await assignTagToSession(tagId, sessionId);
    } catch (err) {
      console.error("Failed to assign session to tag:", err);
    }
    const ids = await loadTagSessions(tagId);
    setTagSessions((prev) => ({ ...prev, [tagId]: ids }));
    setAssigningTag(null);
    bump();
  };

  const handleUnassign = async (tagId: string, sessionId: string) => {
    try {
      await unassignTagFromSession(tagId, sessionId);
    } catch (err) {
      console.error("Failed to unassign session from tag:", err);
    }
    const ids = await loadTagSessions(tagId);
    setTagSessions((prev) => ({ ...prev, [tagId]: ids }));
    bump();
  };

  const filteredTag = filterTag ? tags.find((t) => t.name === filterTag) : undefined;

  const sortedTags = [...tags]
    .filter((t) =>
      filterTag
        ? t.name === filterTag
        : !search || t.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (tagSort === "count") {
        const aCount = tagSessions[a.id]?.length || 0;
        const bCount = tagSessions[b.id]?.length || 0;
        return bCount - aCount;
      }
      return a.name.localeCompare(b.name);
    });

  const allExpanded = tags.length > 0 && tags.every((t) => expandedTags.has(t.id));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TagListHeader
        allExpanded={allExpanded}
        tagSort={tagSort}
        sortOpen={tagSortOpen}
        sortRef={sortRef}
        onToggleSort={() => setTagSortOpen((v) => !v)}
        onSortSelect={(mode) => {
          setTagSort(mode);
          setTagSortOpen(false);
        }}
        onToggleAll={() => (allExpanded ? collapseAll() : expandAll())}
        onNewTag={() => setCreating(true)}
      />

      <div className="px-1.5 pb-1 shrink-0">
        <TagFilterBar
          search={search}
          searchActive={searchActive}
          filterTag={filterTag}
          filteredTag={filteredTag}
          onSearchChange={setSearch}
          onSearchKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              setSearchActive(false);
            }
          }}
          onSearchOpen={() => setSearchActive(true)}
          onSearchClose={() => {
            setSearch("");
            setSearchActive(false);
          }}
          onClearFilter={clearFilter}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {sortedTags.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <TagsIcon size={24} className="text-ov-text-secondary/40 mb-3" />
            <p className="text-xs text-ov-text-secondary/60 max-w-36 leading-relaxed mb-3">
              Tag sessions to organize them across projects.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors"
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>
        )}
        {sortedTags.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            sessions={sessions}
            tagSessionIds={tagSessions[tag.id] || []}
            expanded={expandedTags.has(tag.id)}
            editing={editingId === tag.id}
            editName={editName}
            assigning={assigningTag === tag.id}
            activeSessionId={activeSessionId}
            editRef={editRef}
            onToggleExpand={() => toggleExpand(tag.id)}
            onStartEdit={() => {
              setEditingId(tag.id);
              setEditName(tag.name);
            }}
            onEditNameChange={setEditName}
            onRename={() => handleRename(tag.id)}
            onCancelEdit={() => setEditingId(null)}
            onDelete={() => handleDelete(tag.id)}
            onToggleAssign={() => setAssigningTag(assigningTag === tag.id ? null : tag.id)}
            onAssign={(sid) => handleAssign(tag.id, sid)}
            onCloseAssign={() => setAssigningTag(null)}
            onUnassign={(sid) => handleUnassign(tag.id, sid)}
            onDrop={(sid) => handleDrop(tag.id, sid)}
            onSelectSession={onSessionSelect}
          />
        ))}
      </div>

      <CreateTagModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
