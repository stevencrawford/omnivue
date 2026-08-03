import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Minus,
  ArrowUpDown,
  ChevronRight,
  Tags as TagsIcon,
  Pencil,
  Trash2,
  X,
  Search,
} from "lucide-react";
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
import { sessionTitle, sessionMetaParts, relativeTime } from "../utils/sessionUtils";
import { tagColor, hasTagColor } from "../utils/tagColors";
import { CreateTagModal } from "./CreateTagModal";

interface TagPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

type TagSort = "name" | "count";

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const getSession = (id: string) => sessions.find((s) => s.id === id);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Tags
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              const allExpanded = tags.length > 0 && tags.every((t) => expandedTags.has(t.id));
              if (allExpanded) collapseAll();
              else expandAll();
            }}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
            title={
              tags.length > 0 && tags.every((t) => expandedTags.has(t.id))
                ? "Collapse all"
                : "Expand all"
            }
          >
            {tags.length > 0 && tags.every((t) => expandedTags.has(t.id)) ? (
              <Minus size={14} />
            ) : (
              <Plus size={14} />
            )}
          </button>
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setTagSortOpen((v) => !v)}
              className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
              title="Sort tags"
            >
              <ArrowUpDown size={14} />
            </button>
            {tagSortOpen && (
              <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
                {(["name", "count"] as TagSort[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                      tagSort === mode
                        ? "sess-session-active"
                        : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
                    }`}
                    onClick={() => {
                      setTagSort(mode);
                      setTagSortOpen(false);
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
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
            title="New tag"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search / filter */}
      <div className="px-1.5 pb-1 shrink-0">
        {searchActive || filterTag ? (
          <div className="flex items-center gap-1 border border-ov-border rounded bg-surface-elevated px-1.5 py-1">
            {filterTag ? (
              <>
                <span
                  className="flex items-center gap-1 text-xs text-ov-text truncate flex-1"
                  title={`Showing tag "${filterTag}"`}
                >
                  {hasTagColor(tags.find((t) => t.name === filterTag)?.color) ? (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: tagColor(tags.find((t) => t.name === filterTag)!.color),
                      }}
                    />
                  ) : (
                    <span className="w-2 h-2 shrink-0" />
                  )}
                  <span className="truncate">{filterTag}</span>
                </span>
                <button
                  type="button"
                  onClick={() => clearFilter()}
                  className="text-ov-text-secondary hover:text-ov-text cursor-pointer shrink-0 p-0.5"
                  title="Clear tag filter"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearch("");
                      setSearchActive(false);
                    }
                  }}
                  placeholder="Filter tags..."
                  className="flex-1 text-xs bg-transparent text-ov-text placeholder:text-ov-text-secondary outline-none min-w-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSearchActive(false);
                  }}
                  className="text-ov-text-secondary hover:text-ov-text cursor-pointer shrink-0 p-0.5"
                  title="Close search"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchActive(true)}
            className="flex items-center gap-1 text-[11px] text-ov-text-secondary hover:text-ov-text cursor-pointer w-full px-1 py-0.5 transition-colors"
          >
            <Search size={12} />
            <span>{filterTag ? `Filtered: ${filterTag}` : "Filter tags..."}</span>
          </button>
        )}
      </div>

      {/* Tag list */}
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
          <div key={tag.id} className="group">
            <div
              className="flex items-center gap-1 px-1 py-0.5 rounded transition-colors hover:bg-ov-bg-hover"
              onDragOver={handleDragOver}
              onDrop={(e) => {
                e.preventDefault();
                const sessionId = e.dataTransfer.getData("text/plain");
                if (sessionId) handleDrop(tag.id, sessionId);
              }}
            >
              {editingId === tag.id ? (
                <input
                  ref={editRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(tag.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => handleRename(tag.id)}
                  className="flex-1 text-xs bg-ov-bg border border-ov-border rounded-md px-1.5 py-0.5 text-ov-text outline-none focus:border-accent"
                />
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-xs cursor-pointer truncate transition-colors text-ov-text-secondary hover:text-ov-text"
                  onClick={() => toggleExpand(tag.id)}
                >
                  <ChevronRight
                    size={10}
                    className={`transition-transform shrink-0 ${
                      expandedTags.has(tag.id) ? "rotate-90" : ""
                    }`}
                  />
                  {hasTagColor(tag.color) ? (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tagColor(tag.color) }}
                    />
                  ) : (
                    <span className="w-2 h-2 shrink-0" />
                  )}
                  <span className="truncate">{tag.name}</span>
                  {tagSessions[tag.id] && (
                    <span className="text-[11px] text-ov-text-secondary ml-auto tabular-nums">
                      {tagSessions[tag.id].length}
                    </span>
                  )}
                </button>
              )}
              {editingId !== tag.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAssigningTag(assigningTag === tag.id ? null : tag.id)}
                    className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
                    title="Add session"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditName(tag.name);
                    }}
                    className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
                    title="Rename"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tag.id)}
                    className="text-ov-text-secondary hover:text-red-400 cursor-pointer p-0.5"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {assigningTag === tag.id && (
              <AssignPicker
                sessions={sessions}
                assignedIds={tagSessions[tag.id] || []}
                onAssign={(sid) => handleAssign(tag.id, sid)}
                onClose={() => setAssigningTag(null)}
              />
            )}

            {expandedTags.has(tag.id) && tagSessions[tag.id] && tagSessions[tag.id].length > 0 && (
              <div>
                {tagSessions[tag.id].map((sid) => {
                  const sess = getSession(sid);
                  if (!sess) return null;
                  return (
                    <TagSessionRow
                      key={sid}
                      session={sess}
                      isActive={sid === activeSessionId}
                      onSelect={() => onSessionSelect(sid)}
                      onRemove={() => handleUnassign(tag.id, sid)}
                    />
                  );
                })}
              </div>
            )}
          </div>
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

// ─── Tag Session Row ──────────────────────────────────────────────

interface TagSessionRowProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function TagSessionRow({ session, isActive, onSelect, onRemove }: TagSessionRowProps) {
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
          isActive ? "sess-session-active" : "hover:bg-ov-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-6">
          <span className="sess-parent-session-title truncate flex-1 text-ov-text">
            {sessionTitle(session)}
          </span>
          <span className="shrink-0 text-[11px] text-ov-text-secondary tabular-nums">
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
        className="hidden group-hover/item:block absolute right-1 top-1/2 -translate-y-1/2 text-ov-text-secondary hover:text-red-400 cursor-pointer p-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove tag"
      >
        <X size={10} />
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
    <div className="mx-2 my-1 border border-ov-border rounded bg-ov-bg shadow-sm max-h-40 flex flex-col">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="Filter sessions..."
        className="text-xs bg-transparent border-b border-ov-border px-2 py-1 text-ov-text placeholder:text-ov-text-secondary outline-none"
      />
      <div className="flex-1 overflow-y-auto">
        {unassigned.length === 0 ? (
          <div className="text-[11px] text-ov-text-secondary p-2 text-center">
            No sessions to add
          </div>
        ) : (
          unassigned.slice(0, 20).map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2 py-1 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer truncate"
              onClick={() => onAssign(s.id)}
            >
              {s.title || s.id.slice(0, 12)}
              {s.repository && (
                <span className="text-[11px] text-ov-text-secondary ml-1">({s.repository})</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
