import { useState, useEffect, useCallback, useRef } from "react";
import {
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  GripVertical,
  Loader2,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import type { Prompt } from "../hooks/types";
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  reorderPrompts,
  updatePrompt,
} from "../hooks/apiClient";
import { useCopy } from "../hooks/useCopy";

interface PromptsPanelProps {
  /** Bumped by the app when a prompts-changed SSE event arrives, forcing a reload. */
  promptVersion?: number;
}

// PromptsPanel is the global prompt pad: a session-independent dumping ground
// for useful prompts and drafts. Entries can be typed or pasted in, copied back
// out, checked off when done, edited, pinned, and dragged into a custom order.
export function PromptsPanel({ promptVersion = 0 }: PromptsPanelProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await fetchPrompts(undefined, 500);
      setPrompts(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts, promptVersion]);

  const open = prompts.filter((p) => p.status === "open");
  const done = prompts.filter((p) => p.status === "done");

  const handleCreate = async (text: string) => {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      const created = await createPrompt({ promptText: value });
      setPrompts((prev) => [created, ...prev]);
      setInputText("");
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreate(inputText);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) await handleCreate(text);
    } catch {
      /* clipboard unavailable or permission denied */
    }
  };

  const handleToggleDone = async (prompt: Prompt) => {
    const status = prompt.status === "open" ? "done" : "open";
    setPrompts((prev) => prev.map((p) => (p.id === prompt.id ? { ...p, status } : p)));
    try {
      await updatePrompt(prompt.id, { status });
    } catch {
      loadPrompts();
    }
  };

  const handleTogglePin = async (prompt: Prompt) => {
    const pinned = !prompt.pinned;
    setPrompts((prev) => prev.map((p) => (p.id === prompt.id ? { ...p, pinned } : p)));
    try {
      await updatePrompt(prompt.id, { pinned });
    } catch {
      loadPrompts();
    }
  };

  const handleDelete = async (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    try {
      await deletePrompt(id);
    } catch {
      loadPrompts();
    }
  };

  const handleStartEdit = (prompt: Prompt) => {
    setEditingId(prompt.id);
    setEditText(prompt.promptText);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const text = editText.trim();
    if (!text) return;
    const id = editingId;
    setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, promptText: text } : p)));
    setEditingId(null);
    try {
      await updatePrompt(id, { promptText: text });
    } catch {
      loadPrompts();
    }
  };

  const handleDrop = async (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = open.map((p) => p.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...open];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setPrompts([...reordered.map((p, i) => ({ ...p, position: i })), ...done]);
    try {
      await reorderPrompts(reordered.map((p) => p.id));
    } catch {
      loadPrompts();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Prompts
        </span>
        {open.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
            {open.length}
          </span>
        )}
      </div>

      <div className="shrink-0 px-1.5 pb-1.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a prompt to save..."
            rows={Math.min(8, Math.max(2, inputText.split("\n").length))}
            className="flex-1 resize-none bg-ov-bg-secondary border border-ov-border rounded-[0.625rem] px-2.5 py-2 text-xs text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent-border transition-[border-color,box-shadow] duration-150"
          />
          <button
            type="button"
            onClick={() => handleCreate(inputText)}
            disabled={!inputText.trim() || submitting}
            className="shrink-0 size-8 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Add prompt"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 px-0.5">
          <button
            type="button"
            onClick={handlePaste}
            className="flex items-center gap-1 text-[10px] text-ov-text-secondary hover:text-accent cursor-pointer transition-colors"
            title="Paste from clipboard"
          >
            <ClipboardPaste size={11} />
            Paste from clipboard
          </button>
          <span className="text-[10px] text-ov-text-secondary">Enter to add</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2 border-t border-ov-border">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-ov-text-secondary">Loading...</span>
          </div>
        ) : open.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <ClipboardPaste size={24} className="text-ov-text-secondary/40 mb-3" />
            <p className="text-xs text-ov-text-secondary/60 max-w-40 leading-relaxed">
              A dumping ground for useful prompts and drafts. Type one in or paste from your
              clipboard.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-0.5 pt-1.5">
              {open.map((prompt) => (
                <PromptRow
                  key={prompt.id}
                  prompt={prompt}
                  editing={editingId === prompt.id}
                  editText={editText}
                  onEditTextChange={setEditText}
                  dragging={dragId === prompt.id}
                  onDragStart={() => setDragId(prompt.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(prompt.id)}
                  onToggleDone={() => handleToggleDone(prompt)}
                  onTogglePin={() => handleTogglePin(prompt)}
                  onStartEdit={() => handleStartEdit(prompt)}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => handleDelete(prompt.id)}
                />
              ))}
            </div>

            {done.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setDoneExpanded((v) => !v)}
                  className="flex items-center gap-1 w-full px-1 py-1 text-[10px] font-semibold uppercase tracking-widest text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors"
                >
                  <ChevronRight
                    size={11}
                    className={`transition-transform ${doneExpanded ? "rotate-90" : ""}`}
                  />
                  Done ({done.length})
                </button>
                {doneExpanded && (
                  <div className="space-y-0.5 mt-0.5">
                    {done.map((prompt) => (
                      <div
                        key={prompt.id}
                        className="group relative flex items-start gap-1.5 px-1.5 py-1 rounded-lg hover:bg-ov-bg-hover transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleDone(prompt)}
                          className="mt-0.5 size-3.5 shrink-0 flex items-center justify-center rounded border border-emerald-500/60 bg-emerald-500/20 text-emerald-400 cursor-pointer"
                          title="Mark as not done"
                        >
                          <Check size={9} />
                        </button>
                        <span className="text-xs text-ov-text-secondary line-through truncate flex-1">
                          {prompt.promptText}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(prompt.id)}
                          className="hidden group-hover:flex size-5 shrink-0 items-center justify-center rounded text-ov-text-secondary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface PromptRowProps {
  prompt: Prompt;
  editing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onToggleDone: () => void;
  onTogglePin: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function PromptRow({
  prompt,
  editing,
  editText,
  onEditTextChange,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onToggleDone,
  onTogglePin,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: PromptRowProps) {
  const { copied, copy } = useCopy(1500);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  return (
    <div
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative flex items-start gap-1.5 px-1.5 py-1.5 rounded-lg border transition-colors ${
        dragging
          ? "border-accent bg-accent/10 opacity-60"
          : "border-transparent hover:bg-ov-bg-hover hover:border-ov-border"
      }`}
    >
      <button
        type="button"
        onClick={onToggleDone}
        className="mt-0.5 size-3.5 shrink-0 flex items-center justify-center rounded border border-ov-border text-transparent hover:border-emerald-500/60 hover:text-emerald-400/60 cursor-pointer transition-colors"
        title="Mark as done"
      >
        <Check size={9} />
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  onCancelEdit();
                }
              }}
              rows={Math.min(8, Math.max(2, editText.split("\n").length))}
              className="w-full resize-none bg-ov-bg-secondary border border-ov-border rounded-md px-2 py-1 text-xs text-ov-text outline-none focus:border-accent-border transition-colors"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSaveEdit}
                className="text-[10px] px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/90 cursor-pointer transition-colors"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="text-[10px] px-2 py-0.5 rounded text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartEdit}
            className="w-full text-left text-xs text-ov-text leading-relaxed whitespace-pre-wrap break-words cursor-text"
            title="Click to edit"
          >
            {prompt.promptText}
          </button>
        )}
        {!editing && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-ov-text-secondary">{timeAgo(prompt.createdAt)}</span>
            {prompt.pinned && <Pin size={9} className="text-accent shrink-0" />}
          </div>
        )}
      </div>

      {!editing && (
        <>
          <span className="mt-0.5 shrink-0 text-ov-text-secondary/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
            <GripVertical size={12} />
          </span>
          <div className="absolute right-1.5 top-1.5 hidden group-hover:flex items-center gap-0.5 rounded-md border border-ov-border bg-surface-elevated px-0.5 py-0.5">
            <IconButton
              title={prompt.pinned ? "Unpin" : "Pin to top"}
              onClick={onTogglePin}
              active={prompt.pinned}
            >
              <Pin size={10} />
            </IconButton>
            <IconButton
              title="Copy to clipboard"
              onClick={() => copy(prompt.promptText)}
              done={copied}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
            </IconButton>
            <IconButton title="Edit" onClick={onStartEdit}>
              <Pencil size={10} />
            </IconButton>
            <IconButton title="Delete" danger onClick={onDelete}>
              <Trash2 size={10} />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
  danger = false,
  active = false,
  done = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  active?: boolean;
  done?: boolean;
}) {
  const tone = danger
    ? "hover:text-red-400 hover:bg-red-500/10"
    : active || done
      ? "text-accent hover:bg-accent/10"
      : "hover:text-accent hover:bg-accent/10";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`size-5 flex items-center justify-center rounded cursor-pointer transition-colors ${tone}`}
    >
      {children}
    </button>
  );
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
