import { useState, useEffect, useCallback } from "react";
import { ListTodo, Plus, Copy, Trash2, ExternalLink, ChevronDown, ChevronRight, Check } from "lucide-react";
import type { QueuedPrompt, Session } from "../hooks/useApi";
import { fetchPrompts, dispatchPrompt, deletePrompt } from "../hooks/useApi";
import { AddPromptDialog } from "./AddPromptDialog";

interface QueuePanelProps {
  sessions: Session[];
  onQueueChanged?: () => void;
  onSessionSelect?: (sessionId: string) => void;
}

type FilterTab = "all" | "queued" | "dispatched";

export function QueuePanel({ sessions, onQueueChanged, onSessionSelect }: QueuePanelProps) {
  const [prompts, setPrompts] = useState<QueuedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await fetchPrompts("", "", 200);
      setPrompts(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const filtered = prompts.filter((p) => {
    if (filter === "all") return true;
    return p.status === filter;
  });

  const sessionName = (sessionId: string | null | undefined): string => {
    if (!sessionId) return "Global";
    const s = sessions.find((s) => s.id === sessionId);
    return s?.title || s?.repository || sessionId.slice(0, 8);
  };

  const groupBySession = (items: QueuedPrompt[]): Array<{ label: string; prompts: QueuedPrompt[] }> => {
    const map = new Map<string, QueuedPrompt[]>();
    for (const p of items) {
      const key = p.sessionId || "__global__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const groups: Array<{ label: string; prompts: QueuedPrompt[] }> = [];
    for (const [key, list] of map) {
      groups.push({
        label: key === "__global__" ? "Global" : sessionName(key),
        prompts: list,
      });
    }
    groups.sort((a, b) => (a.label === "Global" ? 1 : b.label === "Global" ? -1 : a.label.localeCompare(b.label)));
    return groups;
  };

  const handleDispatch = async (prompt: QueuedPrompt) => {
    try {
      const result = await dispatchPrompt(prompt.id);
      await navigator.clipboard.writeText(result.promptText);
      setCopiedId(prompt.id);
      setTimeout(() => setCopiedId(null), 2000);
      setPrompts((prev) =>
        prev.map((p) => (p.id === prompt.id ? { ...p, status: "dispatched" as const } : p)),
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
      case "queued": return "text-blue-400";
      case "dispatched": return "text-yellow-400";
      case "cancelled": return "text-gray-400";
      default: return "text-gray-400";
    }
  };

  const groups = groupBySession(filtered);
  const queuedCount = prompts.filter((p) => p.status === "queued").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTodo size={14} className="text-accent" />
          <span className="text-xs font-semibold text-ov-text">Prompt Queue</span>
          {queuedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
              {queuedCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAddDialogOpen(true)}
          className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          title="Add prompt"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-1.5 pb-1 shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "queued", "dispatched"] as FilterTab[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`text-[11px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                filter === f
                  ? "bg-accent/20 text-accent font-medium"
                  : "text-ov-text-secondary hover:text-ov-text"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-ov-text-secondary">Loading...</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListTodo size={24} className="text-ov-text-secondary/40" />
            <span className="text-xs text-ov-text-secondary text-center">
              {filter === "all" ? "No prompts queued yet" : `No ${filter} prompts`}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="text-[10px] font-semibold text-ov-text-secondary uppercase tracking-wider px-1 py-1">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.prompts.map((prompt) => (
                    <div key={prompt.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === prompt.id ? null : prompt.id)}
                        className="w-full flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-ov-bg-hover transition-colors text-left cursor-pointer"
                      >
                        <div className={`mt-0.5 ${statusColor(prompt.status)}`}>
                          {expandedId === prompt.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-ov-text truncate">{prompt.promptText}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-medium ${statusColor(prompt.status)}`}>
                              ● {prompt.status}
                            </span>
                            <span className="text-[10px] text-ov-text-secondary">{timeAgo(prompt.createdAt)}</span>
                          </div>
                        </div>
                      </button>
                      {expandedId === prompt.id && (
                        <div className="px-4 pb-1">
                          <div className="text-xs text-ov-text whitespace-pre-wrap break-words bg-ov-bg-hover rounded-lg p-2 mb-1">
                            {prompt.promptText}
                          </div>
                          <div className="flex items-center gap-1">
                            {prompt.status === "queued" && (
                              <button
                                type="button"
                                onClick={() => handleDispatch(prompt)}
                                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-ov-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                              >
                                {copiedId === prompt.id ? <Check size={10} /> : <Copy size={10} />}
                                {copiedId === prompt.id ? "Copied" : "Copy"}
                              </button>
                            )}
                            {prompt.sessionId && onSessionSelect && (
                              <button
                                type="button"
                                onClick={() => onSessionSelect(prompt.sessionId!)}
                                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-ov-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                              >
                                <ExternalLink size={10} />
                                Open session
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(prompt.id)}
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-ov-text-secondary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                            >
                              <Trash2 size={10} />
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addDialogOpen && (
        <AddPromptDialog
          sessions={sessions}
          onClose={() => setAddDialogOpen(false)}
          onCreated={() => {
            loadPrompts();
            onQueueChanged?.();
          }}
        />
      )}
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
