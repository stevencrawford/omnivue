import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight, User, Copy, Trash2, Loader2, Check } from "lucide-react";
import type { Session, Message, QueuedPrompt } from "../hooks/types";
import { createPrompt, fetchPrompts, deletePrompt } from "../hooks/apiClient";
import { formatCost, formatTokenBreakdown } from "../utils/sessionUtils";
import { UserPromptBubble } from "./UserPromptBubble";
import { useHideCosts } from "../hooks/useHideCosts";
import { useResizable } from "../hooks/useResizable";
import { scrollElementToCenter } from "../hooks/useConversationScroll";
import { STORAGE_KEYS } from "../utils/storageKeys";

export function PinnedPromptBar({
  session,
  firstMessage,
  onOpenModal,
  onQueueChanged,
  highlightPromptId,
  onHighlightDone,
}: {
  session: Session;
  firstMessage?: Message | null;
  onOpenModal?: (content: string, title?: string) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}) {
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [prompts, setPrompts] = useState<QueuedPrompt[]>([]);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const [inputText, setInputText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const hideCosts = useHideCosts();
  const {
    value: pinnedHeight,
    isResizing: isPinnedResizing,
    startResize: handlePinnedResizeStart,
  } = useResizable({
    storageKey: STORAGE_KEYS.PINNED_HEIGHT,
    axis: "vertical",
    min: 120,
    max: 600,
    defaultValue: 300,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const totalTokens =
    session.tokensInput + session.tokensOutput + session.tokensCacheRead + session.tokensCacheWrite;

  const loadPrompts = useCallback(async () => {
    try {
      const data = await fetchPrompts("queued", session.id, 100);
      setPrompts(data);
      setPromptsLoaded(true);
    } catch {
      setPromptsLoaded(true);
    }
  }, [session.id]);

  useEffect(() => {
    if (pinnedExpanded && !promptsLoaded) {
      loadPrompts();
    }
  }, [pinnedExpanded, promptsLoaded, loadPrompts]);

  // Auto-expand and load prompts when highlightPromptId is set (e.g. from QueuePanel click)
  useEffect(() => {
    if (highlightPromptId) {
      loadPrompts();
      setPinnedExpanded(true);
    }
  }, [highlightPromptId, loadPrompts]);

  // Scroll to highlighted prompt when prompts load;
  // signal onHighlightDone after the flash animation completes.
  const highlightDoneRef = useRef(false);
  useEffect(() => {
    if (highlightPromptId && prompts.some((p) => p.id === highlightPromptId)) {
      const container = document.querySelector(".sess-pinned-bar");
      const el = container?.querySelector(`[data-queued-prompt-id="${highlightPromptId}"]`);
      if (el && container) {
        scrollElementToCenter(container as HTMLElement, el as HTMLElement);
        highlightDoneRef.current = false;
        const onEnd = () => {
          if (highlightDoneRef.current) return;
          highlightDoneRef.current = true;
          el.removeEventListener("animationend", onEnd);
          onHighlightDone?.();
        };
        el.addEventListener("animationend", onEnd);
        // Fallback: call done after 1.5s even if animationend doesn't fire
        const fallback = setTimeout(onEnd, 1500);
        return () => {
          el.removeEventListener("animationend", onEnd);
          clearTimeout(fallback);
        };
      }
    }
  }, [highlightPromptId, prompts, onHighlightDone]);

  const handleSubmit = async () => {
    const text = inputText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const created = await createPrompt({
        promptText: text,
        sessionId: session.id,
      });
      setPrompts((prev) => [created, ...prev]);
      setQueuedId(created.id);
      setInputText("");
      setTimeout(() => setQueuedId(null), 1500);
      onQueueChanged?.();
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
      handleSubmit();
    }
  };

  const handleCopy = async (prompt: QueuedPrompt) => {
    try {
      await navigator.clipboard.writeText(prompt.promptText);
      setCopiedId(prompt.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePrompt(id);
      setPrompts((prev) => prev.filter((p) => p.id !== id));
      onQueueChanged?.();
    } catch {
      /* ignore */
    }
  };

  const queuedCount = prompts.length;

  return (
    <>
      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isPinnedResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handlePinnedResizeStart}
      >
        <div className="w-6 h-0.5 rounded-full bg-ov-border" />
      </div>

      <div
        className="sess-pinned-bar shrink-0 flex flex-col overflow-hidden"
        style={pinnedExpanded ? { height: pinnedHeight } : undefined}
      >
        <button
          type="button"
          className="flex items-center gap-2 w-full px-4 py-2 text-left cursor-pointer hover:bg-ov-bg-hover transition-colors shrink-0"
          onClick={() => setPinnedExpanded((v) => !v)}
        >
          <ChevronRight
            size={12}
            className={`text-ov-text-secondary transition-transform ${pinnedExpanded ? "rotate-90" : ""}`}
          />
          <User size={16} className="text-accent-secondary shrink-0" />
          <span className="text-xs font-semibold text-ov-text">Prompt</span>
          {session.model && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-ov-bg-hover text-ov-text-secondary font-mono">
              {session.model}
            </span>
          )}
          {totalTokens > 0 && (
            <span
              className="text-[11px] text-ov-text-secondary"
              title={`${session.tokensInput.toLocaleString()} in / ${session.tokensCacheRead.toLocaleString()} cached / ${session.tokensOutput.toLocaleString()} out`}
            >
              {formatTokenBreakdown(session)}
            </span>
          )}
          {session.cost > 0 && !hideCosts && (
            <span className="text-[11px] text-ov-text-secondary" title="Cost">
              {formatCost(session.cost)}
            </span>
          )}
          {queuedCount > 0 && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
              {queuedCount} queued
            </span>
          )}
        </button>

        {pinnedExpanded && (
          <div className="flex-1 overflow-y-auto min-h-0 border-t border-ov-border">
            <div className="px-4 pb-2 pt-3">
              {firstMessage && (
                <div className="ml-6 mt-1">
                  <UserPromptBubble message={firstMessage} onOpenModal={onOpenModal} />
                </div>
              )}
            </div>

            {prompts.length > 0 && (
              <div className="px-4 pb-2 space-y-1">
                {prompts.map((prompt) => (
                  <div
                    key={prompt.id}
                    data-queued-prompt-id={prompt.id}
                    className={`group flex items-start gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      highlightPromptId === prompt.id
                        ? "queued-prompt-flash"
                        : queuedId === prompt.id
                          ? "border-accent bg-accent/10"
                          : "border-transparent hover:bg-ov-bg-hover hover:border-ov-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {queuedId === prompt.id ? (
                          <span className="text-[10px] text-accent font-medium flex items-center gap-0.5">
                            <Check size={10} />
                            Queued!
                          </span>
                        ) : (
                          <span className="text-[10px] text-ov-text-secondary">
                            {timeAgo(prompt.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ov-text leading-relaxed whitespace-pre-wrap break-words">
                        {prompt.promptText}
                      </div>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 mt-0.5">
                      <button
                        type="button"
                        onClick={() => handleCopy(prompt)}
                        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedId === prompt.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(prompt.id)}
                        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {pinnedExpanded && (
          <div className="shrink-0 border-t border-ov-border px-4 py-2 bg-ov-bg-sidebar">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a prompt to queue for this session..."
                rows={Math.min(10, Math.max(3, inputText.split("\n").length))}
                className="flex-1 resize-none bg-ov-bg-hover border border-ov-border rounded-lg px-3 py-2 text-sm text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent transition-colors"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputText.trim() || submitting}
                className="shrink-0 size-8 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                title="Queue prompt"
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-[10px] text-ov-text-secondary">
                Enter to queue · Shift+Enter for newline
              </span>
            </div>
          </div>
        )}
      </div>
    </>
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
