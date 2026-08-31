import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Tag as TagIcon, X, Check, Terminal } from "lucide-react";
import type { Session, Tag } from "../hooks/types";
import {
  setSessionName,
  clearSessionName,
  fetchTags,
  fetchSessionTags,
  createTag,
  assignTagToSession,
  unassignTagFromSession,
} from "../hooks/apiClient";
import { agentLabel } from "../utils/sessionUtils";
import { hasTagColor, tagColor } from "../utils/tagColors";
import { useTagsContext } from "../hooks/useTags";
import { CreateTagModal } from "./CreateTagModal";
import { ResumeButton } from "./ResumeButton";

export function SessionHeader({
  session,
  hasPrivacy,
  onNameChanged,
  onJumpTerminal,
  terminalActive,
}: {
  session: Session;
  hasPrivacy?: boolean;
  onNameChanged?: () => void;
  onJumpTerminal?: () => void;
  terminalActive?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [displayTitle, setDisplayTitle] = useState(session.title);
  const [sessionTags, setSessionTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [tagInitialName, setTagInitialName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const { version, bump, openTag } = useTagsContext();

  useEffect(() => {
    setDisplayTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const loadSessionTags = useCallback(async () => {
    try {
      const tags = await fetchSessionTags(session.id);
      setSessionTags(tags);
    } catch {
      /* ignore */
    }
  }, [session.id]);

  useEffect(() => {
    loadSessionTags();
  }, [session.id, loadSessionTags, version]);

  useEffect(() => {
    if (tagMenuOpen) {
      fetchTags()
        .then(setAllTags)
        .catch(() => {
          /* ignore */
        });
      setTimeout(() => tagInputRef.current?.focus(), 0);
    } else {
      setTagFilter("");
    }
  }, [tagMenuOpen]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenuOpen(false);
      }
    };
    if (tagMenuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagMenuOpen]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    if (overflowOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [overflowOpen]);

  const startEdit = () => {
    setEditValue(displayTitle);
    setEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      try {
        await setSessionName(session.id, trimmed);
        setDisplayTitle(trimmed);
        onNameChanged?.();
      } catch {
        /* ignore */
      }
    }
    setEditing(false);
  };

  const clearOverride = async () => {
    try {
      await clearSessionName(session.id);
      setDisplayTitle(session.title);
      onNameChanged?.();
    } catch {
      /* ignore */
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") setEditing(false);
  };

  const toggleTag = async (tag: Tag) => {
    const assigned = sessionTags.some((t) => t.id === tag.id);
    try {
      if (assigned) {
        await unassignTagFromSession(tag.id, session.id);
      } else {
        await assignTagToSession(tag.id, session.id);
      }
      await loadSessionTags();
      bump();
    } catch {
      /* ignore */
    }
  };

  const removeTag = async (tagId: string) => {
    setSessionTags((prev) => prev.filter((t) => t.id !== tagId));
    try {
      await unassignTagFromSession(tagId, session.id);
      await loadSessionTags();
      bump();
    } catch {
      await loadSessionTags();
    }
  };

  const handleCreateTag = async (name: string, color?: string) => {
    try {
      const tag = await createTag(name, color);
      await assignTagToSession(tag.id, session.id);
      await loadSessionTags();
      bump();
      setShowCreateModal(false);
    } catch {
      /* ignore */
    }
  };

  const handleQuickCreateTag = async () => {
    const name = tagFilter.trim();
    if (!name || creatingTag) return;
    setCreatingTag(true);
    try {
      const tag = await createTag(name);
      await assignTagToSession(tag.id, session.id);
      await loadSessionTags();
      bump();
      setTagMenuOpen(false);
    } catch {
      /* ignore */
    } finally {
      setCreatingTag(false);
    }
  };

  const badgeClass = `sess-agent-badge sess-agent-badge--${session.agent}`;

  const MAX_VISIBLE = 3;
  const visibleTags = sessionTags.slice(0, MAX_VISIBLE);
  const extraTags = sessionTags.slice(MAX_VISIBLE);

  const filteredTags = allTags.filter(
    (t) => !tagFilter || t.name.toLowerCase().includes(tagFilter.toLowerCase()),
  );

  return (
    <div className="px-4 py-3 border-b border-ov-border shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveEdit}
              className="flex-1 text-sm font-semibold bg-ov-bg-secondary border border-accent-border rounded px-1.5 py-0.5 text-ov-text outline-none min-w-0"
            />
            <button
              type="button"
              onClick={clearOverride}
              className="text-[11px] text-ov-text-secondary hover:text-ov-text cursor-pointer shrink-0 px-1"
              title="Revert to original name"
            >
              Reset
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-ov-text truncate">
              {displayTitle || session.id}
            </h2>
            {!session.parentId && (
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 text-ov-text-secondary hover:text-accent cursor-pointer p-0.5 rounded transition-colors"
                title="Rename session"
              >
                <Pencil size={14} />
              </button>
            )}
          </>
        )}
        <span className={`${badgeClass} shrink-0`}>{agentLabel(session.agent)}</span>
        {hasPrivacy && <span className="sess-privacy-badge shrink-0">Privacy mode</span>}

        <div className="flex items-center gap-1.5 min-w-0">
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              className="sess-tag sess-tag-chip"
              title={`Tag ${tag.name} — click to filter`}
            >
              <button
                type="button"
                className="sess-tag-body"
                onClick={() => openTag(tag.name)}
                title={`Show tag ${tag.name}`}
              >
                {hasTagColor(tag.color) && (
                  <span className="sess-tag-dot" style={{ backgroundColor: tagColor(tag.color) }} />
                )}
                <span className="sess-tag-name">{tag.name}</span>
              </button>
              <button
                type="button"
                className="sess-tag-remove"
                onClick={() => removeTag(tag.id)}
                title={`Remove tag ${tag.name}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}

          {extraTags.length > 0 && (
            <span className="sess-tag sess-tag-more" ref={overflowRef}>
              <button
                type="button"
                className="sess-tag-body"
                title="Show more tags"
                onClick={() => setOverflowOpen((v) => !v)}
              >
                +{extraTags.length}
              </button>
              {overflowOpen && (
                <div className="sess-tag-popover">
                  {extraTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="sess-tag sess-tag-pop-item"
                      title={`Open tag ${tag.name}`}
                    >
                      <button
                        type="button"
                        className="sess-tag-body"
                        onClick={() => {
                          setOverflowOpen(false);
                          openTag(tag.name);
                        }}
                      >
                        {hasTagColor(tag.color) && (
                          <span
                            className="sess-tag-dot"
                            style={{ backgroundColor: tagColor(tag.color) }}
                          />
                        )}
                        <span className="sess-tag-name">{tag.name}</span>
                      </button>
                      <button
                        type="button"
                        className="sess-tag-remove"
                        onClick={() => removeTag(tag.id)}
                        title={`Remove tag ${tag.name}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </span>
          )}

          <div className="relative" ref={tagMenuRef}>
            <button
              type="button"
              className="sess-tag sess-tag-add"
              onClick={() => setTagMenuOpen((v) => !v)}
              title="Tag this session"
            >
              <Plus size={10} />
              <TagIcon size={10} />
            </button>

            {tagMenuOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 flex flex-col overflow-hidden">
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setTagMenuOpen(false);
                  }}
                  placeholder="Search tags..."
                  className="text-xs bg-transparent border-b border-ov-border px-2.5 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none"
                />
                <div className="max-h-48 overflow-y-auto py-0.5">
                  {filteredTags.length === 0 ? (
                    tagFilter.trim() ? (
                      <button
                        type="button"
                        disabled={creatingTag}
                        onClick={handleQuickCreateTag}
                        className="w-full text-left flex items-center gap-2 px-2.5 py-2 text-xs text-accent hover:bg-ov-bg-hover cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus size={12} />
                        <span className="truncate">Create "{tagFilter.trim()}"</span>
                      </button>
                    ) : (
                      <div className="text-[11px] text-ov-text-secondary px-2.5 py-2 text-center">
                        No tags yet
                      </div>
                    )
                  ) : (
                    filteredTags.map((tag) => {
                      const assigned = sessionTags.some((t) => t.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            toggleTag(tag);
                            setTagMenuOpen(false);
                          }}
                          className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
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
                          {assigned && <Check size={12} className="shrink-0 text-accent" />}
                        </button>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTagInitialName(tagFilter.trim());
                    setTagMenuOpen(false);
                    setShowCreateModal(true);
                  }}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs text-accent hover:bg-ov-bg-hover cursor-pointer border-t border-ov-border transition-colors"
                >
                  <Plus size={12} />
                  Create new tag...
                </button>
              </div>
            )}
          </div>
        </div>

        <span
          className="text-[11px] font-mono text-ov-text-secondary ml-auto truncate max-w-[32%]"
          title={session.directory}
        >
          {session.repository || session.directory}
        </span>

        <div className="flex items-center gap-1 ml-2 pl-2 border-l border-ov-border shrink-0">
          <ResumeButton sessionId={session.id} />
          {onJumpTerminal && (
            <button
              type="button"
              onClick={onJumpTerminal}
              className={`size-7 flex items-center justify-center rounded shrink-0 cursor-pointer transition-colors ${terminalActive ? "bg-accent text-white" : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"}`}
              title="Jump to terminal"
              aria-label="Jump to terminal"
            >
              <Terminal size={14} />
            </button>
          )}
        </div>
      </div>

      <CreateTagModal
        isOpen={showCreateModal}
        initialName={showCreateModal ? tagInitialName : undefined}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateTag}
      />
    </div>
  );
}
