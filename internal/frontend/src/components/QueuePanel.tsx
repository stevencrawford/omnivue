import { useState, useEffect, useCallback } from "react";
import { Copy, Trash2, Check, MessageSquare } from "lucide-react";
import type { QueuedPrompt, Session } from "../hooks/types";
import { fetchPrompts, deletePrompt } from "../hooks/apiClient";

interface QueuePanelProps {
  sessions: Session[];
  promptVersion: number;
  onSessionSelect?: (sessionId: string) => void;
  onPromptClick?: (sessionId: string, promptId: string) => void;
}

export function QueuePanel({
  sessions,
  promptVersion,
  onSessionSelect,
  onPromptClick,
}: QueuePanelProps) {
  const [prompts, setPrompts] = useState<QueuedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await fetchPrompts("queued", "", 200);
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

  const sessionScoped = prompts.filter((p) => p.sessionId != null);

  const sessionName = (sessionId: string): string => {
    const s = sessions.find((s) => s.id === sessionId);
    return s?.title || s?.repository || sessionId.slice(0, 8);
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
    } catch {
      /* ignore */
    }
  };

  const handleClick = (prompt: QueuedPrompt) => {
    onSessionSelect?.(prompt.sessionId!);
    onPromptClick?.(prompt.sessionId!, prompt.id);
  };

  const queuedCount = sessionScoped.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Queue
        </span>
        {queuedCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
            {queuedCount}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-ov-text-secondary">Loading...</span>
          </div>
        ) : sessionScoped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare size={24} className="text-ov-text-secondary/40 mb-3" />
            <p className="text-xs text-ov-text-secondary/60 max-w-36 leading-relaxed">
              No prompts queued yet. Open a session and expand the Prompt bar to queue one.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sessionScoped.map((prompt) => (
              <div key={prompt.id} className="group relative">
                <button
                  type="button"
                  onClick={() => handleClick(prompt)}
                  className="w-full flex flex-col px-2 py-1.5 pr-7 rounded-lg hover:bg-ov-bg-hover transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-ov-text truncate flex-1">
                      {prompt.promptText}
                    </span>
                    <span className="shrink-0 text-[10px] text-ov-text-secondary tabular-nums group-hover:opacity-0 transition-opacity">
                      {timeAgo(prompt.createdAt)}
                    </span>
                  </div>
                  <span className="text-[10px] text-ov-text-secondary truncate mt-0.5">
                    {sessionName(prompt.sessionId!)}
                  </span>
                </button>
                <div className="hidden group-hover:flex absolute right-1.5 top-1/2 -translate-y-1/2 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(prompt);
                    }}
                    className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedId === prompt.id ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(prompt.id);
                    }}
                    className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
