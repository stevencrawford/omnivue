import { useState, useRef, useEffect } from "react";
import { X, Star, Loader2 } from "lucide-react";
import type { Session } from "../hooks/useApi";
import { createPrompt } from "../hooks/useApi";
import { Modal } from "./Modal";

interface AddPromptDialogProps {
  sessions: Session[];
  sessionId?: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function AddPromptDialog({ sessions, sessionId, onClose, onCreated }: AddPromptDialogProps) {
  const [promptText, setPromptText] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessionId || null);
  const [priority, setPriority] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setShowSessionDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredSessions = sessions.filter((s) => {
    if (!sessionSearch) return true;
    const q = sessionSearch.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.repository.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  });

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim();
      if (!tags.includes(t)) {
        setTags([...tags, t]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  const handleSubmit = async () => {
    const text = promptText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await createPrompt({
        promptText: text,
        sessionId: selectedSessionId,
        priority,
        tags,
      });
      onCreated?.();
      onClose();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Queue a prompt" size="md">
      <div className="p-3 space-y-3" onKeyDown={handleKeyDown}>
        <textarea
          ref={textareaRef}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="Type your prompt here..."
          rows={5}
          className="w-full resize-none bg-ov-bg-hover border border-ov-border rounded-lg px-3 py-2 text-xs text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent transition-colors"
        />

        <div className="relative" ref={sessionDropdownRef}>
          <label className="text-[11px] text-ov-text-secondary block mb-1">Session (optional)</label>
          <button
            type="button"
            onClick={() => setShowSessionDropdown(!showSessionDropdown)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-ov-bg-hover border border-ov-border text-xs text-ov-text hover:border-accent transition-colors cursor-pointer text-left"
          >
            {selectedSessionId
              ? sessions.find((s) => s.id === selectedSessionId)?.title || selectedSessionId
              : "Global (no session)"}
          </button>
          {showSessionDropdown && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-elevated border border-ov-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              <div className="p-1">
                <input
                  type="text"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  placeholder="Search sessions..."
                  className="w-full bg-ov-bg-hover border border-ov-border rounded px-2 py-1 text-xs text-ov-text placeholder:text-ov-text-secondary outline-none mb-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSessionId(null);
                    setShowSessionDropdown(false);
                    setSessionSearch("");
                  }}
                  className="w-full flex items-center px-2 py-1 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover rounded cursor-pointer"
                >
                  Global (no session)
                </button>
                {filteredSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedSessionId(s.id);
                      setShowSessionDropdown(false);
                      setSessionSearch("");
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1 text-xs rounded cursor-pointer ${
                      selectedSessionId === s.id
                        ? "bg-accent/10 text-accent"
                        : "text-ov-text hover:bg-ov-bg-hover"
                    }`}
                  >
                    <span className="truncate">{s.title || s.repository || s.id.slice(0, 8)}</span>
                  </button>
                ))}
                {filteredSessions.length === 0 && (
                  <div className="px-2 py-1 text-xs text-ov-text-secondary">No sessions found</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="text-[11px] text-ov-text-secondary block mb-1">Priority</label>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPriority(priority === n ? 0 : n)}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  n <= priority ? "text-yellow-400" : "text-ov-text-secondary/30 hover:text-ov-text-secondary/60"
                }`}
              >
                <Star size={14} fill={n <= priority ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] text-ov-text-secondary block mb-1">Tags</label>
          <div className="flex items-center flex-wrap gap-1 px-2 py-1 rounded-lg bg-ov-bg-hover border border-ov-border min-h-[28px]">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent"
              >
                {t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="cursor-pointer hover:text-accent/80"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder={tags.length === 0 ? "Type and press Enter to add tags..." : ""}
              className="flex-1 min-w-[60px] bg-transparent text-xs text-ov-text placeholder:text-ov-text-secondary outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!promptText.trim() || submitting}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center gap-1"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Queue prompt
          </button>
        </div>
      </div>
    </Modal>
  );
}
