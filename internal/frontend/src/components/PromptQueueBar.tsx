import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight, User, Copy, Trash2, ListTodo, Loader2 } from "lucide-react";
import type { Session, Message, QueuedPrompt } from "../hooks/useApi";
import { createPrompt, fetchPrompts, dispatchPrompt, deletePrompt } from "../hooks/useApi";
import { formatCost, formatTokenBreakdown } from "../utils/sessionUtils";
import { UserPromptBubble } from "./UserPromptBubble";
export function PromptQueueBar({
  session,
  firstMessage,
  onOpenModal,
  onQueueChanged,
}: {
  session: Session;
  firstMessage: Message;
  onOpenModal?: (content: string, title?: string) => void;
  onQueueChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [prompts, setPrompts] = useState<QueuedPrompt[]>([]);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const [inputText, setInputText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newPromptId, setNewPromptId] = useState<string | null>(null);
  const [barHeight, setBarHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("omnivue-queue-height");
      if (stored) return Math.max(120, Math.min(600, Number(stored)));
    } catch { /* ignore */ }
    return 300;
  });
  const [isResizing, setIsResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);
  const totalTokens =
    session.tokensInput + session.tokensOutput + session.tokensCacheRead + session.tokensCacheWrite;

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await fetchPrompts("", session.id, 100);
      setPrompts(data);
      setPromptsLoaded(true);
    } catch {
      setPromptsLoaded(true);
    }
  }, [session.id]);

  useEffect(() => {
    if (expanded && !promptsLoaded) {
      loadPrompts();
    }
  }, [expanded, promptsLoaded, loadPrompts]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = barHeight;

    const handleMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(120, Math.min(600, startHeight + (startY - ev.clientY)));
      setBarHeight(newHeight);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove as EventListener);
      document.removeEventListener("mouseup", handleMouseUp as EventListener);
      resizeListeners.current = [];
      const finalHeight = Math.max(120, Math.min(600, startHeight + (startY - ev.clientY)));
      try {
        localStorage.setItem("omnivue-queue-height", String(finalHeight));
      } catch { /* ignore */ }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  };

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
      setNewPromptId(created.id);
      setInputText("");
      setTimeout(() => setNewPromptId(null), 2000);
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

  const handleDispatch = async (prompt: QueuedPrompt) => {
    try {
      const result = await dispatchPrompt(prompt.id);
      await navigator.clipboard.writeText(result.promptText);
      setPrompts((prev) =>
        prev.map((p) => (p.id === prompt.id ? { ...p, status: "dispatched" as const, dispatchedAt: Date.now() } : p)),
      );
      onQueueChanged?.();
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

  const statusColor = (status: string) => {
    switch (status) {
      case "queued": return "bg-blue-500/20 text-blue-400";
      case "dispatched": return "bg-yellow-500/20 text-yellow-400";
      case "cancelled": return "bg-gray-500/20 text-gray-400";
      default: return "bg-gray-500/20 text-gray-400";
    }
  };

  const queuedCount = prompts.filter((p) => p.status === "queued").length;

  function hideCosts(): boolean {
    try {
      return localStorage.getItem("omnivue-hide-costs") === "true";
    } catch {
      return false;
    }
  }

  return (
    <>
      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handleResizeStart}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="w-6 h-0.5 rounded-full bg-ov-border" />
      </div>

      {expanded && (
        <div
          className="sess-pinned-bar shrink-0 flex flex-col overflow-hidden"
          style={{ height: barHeight }}
        >
          <div className="flex-1 overflow-y-auto min-h-0">
            <button
              type="button"
              className="flex items-center gap-2 w-full px-4 py-2 text-left cursor-pointer hover:bg-ov-bg-hover transition-colors shrink-0"
              onClick={() => setExpanded(false)}
            >
              <ListTodo size={14} className="text-accent shrink-0" />
              <span className="text-xs font-semibold text-ov-text">
                Queue {queuedCount > 0 ? `(${queuedCount})` : ""}
              </span>
              <span className="text-[11px] text-ov-text-secondary">· Click to add a prompt</span>
              <ChevronRight
                size={12}
                className="text-ov-text-secondary ml-auto -rotate-90"
              />
            </button>

            <div className="px-4 pb-2 border-t border-ov-border">
              <div className="ml-6 mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <User size={14} className="text-accent-secondary shrink-0" />
                  <span className="text-xs font-semibold text-ov-text">Initial Prompt</span>
                  {session.model && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-ov-bg-hover text-ov-text-secondary font-mono">
                      {session.model}
                    </span>
                  )}
                  {totalTokens > 0 && (
                    <span className="text-[11px] text-ov-text-secondary" title={`${session.tokensInput.toLocaleString()} in / ${session.tokensCacheRead.toLocaleString()} cached / ${session.tokensOutput.toLocaleString()} out`}>
                      {formatTokenBreakdown(session)}
                    </span>
                  )}
                  {session.cost > 0 && !hideCosts() && (
                    <span className="text-[11px] text-ov-text-secondary">{formatCost(session.cost)}</span>
                  )}
                </div>
                <UserPromptBubble message={firstMessage} onOpenModal={onOpenModal} />
              </div>
            </div>

            {prompts.length > 0 && (
              <div className="px-4 pb-2 space-y-1">
                {prompts.map((prompt) => (
                  <div
                    key={prompt.id}
                    className={`group flex items-start gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      newPromptId === prompt.id
                        ? "border-accent bg-accent/5 animate-pulse"
                        : "border-transparent hover:bg-ov-bg-hover hover:border-ov-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ov-text leading-relaxed whitespace-pre-wrap break-words">
                        {prompt.promptText}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(prompt.status)}`}>
                          {prompt.status}
                        </span>
                        <span className="text-[10px] text-ov-text-secondary">
                          {timeAgo(prompt.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 mt-0.5">
                      {prompt.status === "queued" && (
                        <button
                          type="button"
                          onClick={() => handleDispatch(prompt)}
                          className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                          title="Copy to clipboard"
                        >
                          <Copy size={12} />
                        </button>
                      )}
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

          <div className="shrink-0 border-t border-ov-border px-4 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a prompt to queue for this session..."
                rows={2}
                className="flex-1 resize-none bg-ov-bg-hover border border-ov-border rounded-lg px-3 py-2 text-xs text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent transition-colors"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputText.trim() || submitting}
                className="shrink-0 size-8 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                title="Queue prompt"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-[10px] text-ov-text-secondary">
                Enter to queue · Shift+Enter for newline
              </span>
            </div>
          </div>
        </div>
      )}
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
