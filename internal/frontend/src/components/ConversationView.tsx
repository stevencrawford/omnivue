import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CirclePlus,
  ChevronDown,
  ChevronUp,
  Filter,
  ChevronRight,
  User,
  Check,
  Copy,
  Info,
  TriangleAlert,
  CircleCheckBig,
} from "lucide-react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import { fetchResumeCommand } from "../hooks/useApi";
import { formatCost } from "../utils/buildTree";
import { effectiveToolKind, getToolSummary, shouldShowStepContent } from "../utils/toolDisplay";

import { MarkdownContent } from "./MarkdownContent";
import { ToolCallList } from "./ToolRenderers/ToolCallList";
import { FileRenderer } from "./DiffRenderer";
import { CopyButton } from "./CopyButton";
import { useSessionNav } from "../hooks/useNav";
import { useCopy } from "../hooks/useCopy";
import { detectLanguage } from "../utils/detectLanguage";

const MARKER_COLORS: Record<string, string> = {
  "user-request": "#58a6ff",
  edit: "#ef4444",
  read: "#06b6d4",
  bash: "#eab308",
  "task-complete": "#10b981",
  plan: "#a855f7",
  question: "#f97316",
  search: "#8b5cf6",
  web: "#ec4899",
  todowrite: "#f59e0b",
  delete: "#ef4444",
  "assistant-text": "#8b949e",
  "sub-agent": "#f472b6",
  tool: "#6b7280",
};

const MARKER_DISPLAY_LABELS: Record<string, string> = {
  "user-request": "User requests",
  edit: "Edits",
  read: "Reads",
  bash: "Shell",
  "task-complete": "Task complete",
  plan: "Plans",
  question: "Questions",
  search: "Search",
  web: "Web",
  todowrite: "Todo",
  delete: "Deletes",
  "assistant-text": "Assistant Message",
  "sub-agent": "Sub-agent",
  tool: "Other",
};

function markerDisplayType(kind: string): string {
  if (
    kind === "user-request" ||
    kind === "assistant-text" ||
    kind === "bash" ||
    kind === "read" ||
    kind === "question" ||
    kind === "todowrite" ||
    kind === "delete"
  )
    return kind;
  if (kind === "edit" || kind === "write") return "edit";
  if (kind === "task_complete" || kind === "task-complete") return "task-complete";
  if (kind === "task") return "sub-agent";
  if (kind === "exit_plan_mode") return "plan";
  if (kind === "grep" || kind === "glob" || kind === "codesearch") return "search";
  if (kind === "webfetch" || kind === "websearch") return "web";
  return "tool";
}

function groupMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0 && !shouldShowStepContent(msg.content ?? "", tools)) {
        const last = result[result.length - 1];
        if (last && last.role === "assistant" && last.toolCalls && last.toolCalls.length > 0) {
          last.toolCalls = [...last.toolCalls, ...tools];
          continue;
        }
      }
    }
    result.push({ ...msg, toolCalls: msg.toolCalls ? [...msg.toolCalls] : undefined });
  }
  return result;
}

export function ConversationView({
  messages,
  session,
  loading,
  onOpenModal,
  onPin,
  focusStepIndex,
  searchHighlightQuery,
}: {
  messages: Message[];
  session: Session;
  loading: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  focusStepIndex?: number;
  searchHighlightQuery?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinnedHeight, setPinnedHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("sess-pinned-height");
      if (stored) return Math.max(60, Math.min(600, Number(stored)));
    } catch {
      // localStorage may be unavailable
    }
    return 260;
  });
  const [isPinnedResizing, setIsPinnedResizing] = useState(false);
  const totalTokens = session.tokensInput + session.tokensOutput;
  const { scrollPositions, saveScrollPosition } = useSessionNav();
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        saveScrollPosition(session.id, scrollRef.current.scrollTop);
      }
    };
  }, [session.id, saveScrollPosition]);

  useEffect(() => {
    if (scrollRef.current) {
      const saved = scrollPositions.get(session.id);
      const isInitialLoad = prevLengthRef.current === 0;

      if (isInitialLoad) {
        if (saved !== undefined) {
          scrollRef.current.scrollTop = saved;
        } else {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      } else if (messages.length > prevLengthRef.current) {
        const el = scrollRef.current;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (nearBottom) {
          el.scrollTop = el.scrollHeight;
        }
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, session.id, scrollPositions]);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setShowScrollTop(el.scrollTop > 200);
      setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Re-check scroll position after messages render (e.g. initial load, tab switch)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      setShowScrollTop(el.scrollTop > 200);
      setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    });
  }, [messages.length]);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const [markerPositions, setMarkerPositions] = useState<Record<string, number>>({});
  const [markerFilterOpen, setMarkerFilterOpen] = useState(false);
  const [hiddenMarkerTypes, setHiddenMarkerTypes] = useState<Set<string>>(new Set());

  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!markerFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setMarkerFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [markerFilterOpen]);

  const firstMessage = messages[0];
  const tail = messages.slice(1);
  const grouped = useMemo(() => groupMessages(tail), [tail]);

  const systemReminders = useMemo(
    () => messages.filter((m) => m.role === "system" && m.metadata?.type === "system_reminder"),
    [messages],
  );
  const messagesWithoutReminders = useMemo(
    () => grouped.filter((m) => m.role !== "system" || m.metadata?.type !== "system_reminder"),
    [grouped],
  );

  const markers = useMemo(() => {
    const result: Array<{
      id: string;
      type: string;
      summary: string;
      color: string;
      label: string;
    }> = [];
    messagesWithoutReminders.forEach((msg, idx) => {
      if (msg.role === "user") {
        result.push({
          id: `msg-${idx}`,
          type: "user-request",
          summary: msg.content?.slice(0, 120) || "",
          color: MARKER_COLORS["user-request"],
          label: MARKER_DISPLAY_LABELS["user-request"],
        });
        return;
      }
      if (msg.role === "assistant") {
        const tools = (msg.toolCalls ?? []).filter((t) => t.name !== "report_intent");
        if (tools.length > 0) {
          const priority = [
            "task_complete",
            "task",
            "edit",
            "write",
            "read",
            "bash",
            "exit_plan_mode",
            "question",
            "grep",
            "glob",
            "codesearch",
            "webfetch",
            "websearch",
            "todowrite",
            "delete",
          ];
          const toolKinds = tools.map((t) => effectiveToolKind(t));
          let dominantKind = "tool";
          for (const p of priority) {
            if (toolKinds.includes(p)) {
              dominantKind = p;
              break;
            }
          }
          const domToolIdx = toolKinds.indexOf(dominantKind);
          const domTool = domToolIdx >= 0 ? tools[domToolIdx] : tools[0];
          const displayType = markerDisplayType(dominantKind);
          result.push({
            id: `msg-${idx}`,
            type: displayType,
            summary: getToolSummary(domTool, msg.agent),
            color: MARKER_COLORS[displayType] || MARKER_COLORS["tool"],
            label: MARKER_DISPLAY_LABELS[displayType] || MARKER_DISPLAY_LABELS["tool"],
          });
        } else if (msg.content?.trim()) {
          result.push({
            id: `msg-${idx}`,
            type: "assistant-text",
            summary: msg.content.slice(0, 120),
            color: MARKER_COLORS["assistant-text"],
            label: MARKER_DISPLAY_LABELS["assistant-text"],
          });
        }
      }
    });
    return result;
  }, [messagesWithoutReminders]);

  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      for (const t of highlightTimers.current) clearTimeout(t);
      highlightTimers.current = [];
    };
  }, []);

  // Scroll to focused step when focusStepIndex is provided
  useEffect(() => {
    if (focusStepIndex === undefined || !scrollRef.current) return;
    const container = scrollRef.current;
    const msgElements = container.querySelectorAll("[data-message-index]");
    for (const el of msgElements) {
      const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
      if (idx === focusStepIndex) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("sess-message-highlight");
        const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
        highlightTimers.current.push(timer);
        break;
      }
    }
  }, [focusStepIndex, grouped.length]);

  // Scroll to and highlight first message matching search highlight query
  useEffect(() => {
    if (!searchHighlightQuery || !scrollRef.current || messagesWithoutReminders.length === 0)
      return;
    const q = searchHighlightQuery.toLowerCase();
    const container = scrollRef.current;
    const msgElements = container.querySelectorAll("[data-message-index]");
    for (const el of msgElements) {
      const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
      const msg = messagesWithoutReminders[idx];
      if (msg && (msg.content || "").toLowerCase().includes(q)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("sess-message-highlight");
        const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
        highlightTimers.current.push(timer);
        break;
      }
    }
  }, [searchHighlightQuery, messagesWithoutReminders.length]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const positions: Record<string, number> = {};
    const total = container.scrollHeight || 1;
    const els = container.querySelectorAll("[data-marker-id]");
    els.forEach((el) => {
      const id = el.getAttribute("data-marker-id");
      if (!id) return;
      positions[id] = ((el as HTMLElement).offsetTop / total) * 100;
    });
    setMarkerPositions(positions);
  }, [messagesWithoutReminders.length]);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleResume = async () => {
    try {
      const cmd = await fetchResumeCommand(session.id);
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handlePinnedResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];
    setIsPinnedResizing(true);
    const startY = e.clientY;
    const startHeight = pinnedHeight;

    const handleMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(60, Math.min(600, startHeight + (startY - ev.clientY)));
      setPinnedHeight(newHeight);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsPinnedResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      resizeListeners.current = [];
      const finalHeight = Math.max(60, Math.min(600, startHeight + (startY - ev.clientY)));
      try {
        localStorage.setItem("sess-pinned-height", String(finalHeight));
      } catch {
        // localStorage may be unavailable
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gh-text-secondary">
          <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          Loading conversation...
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="sess-empty-state flex-1">
        <div className="sess-empty-icon">
          <CirclePlus size={20} />
        </div>
        <p className="text-sm text-gh-text-secondary">No messages in this session</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden mb-3">
      {/* Scroll area wrapper */}
      <div className="flex-1 relative min-h-0">
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden py-3">
          {systemReminders.length > 0 && (
            <div className="px-4 pb-2">
              {systemReminders.map((msg) => (
                <SystemReminderView
                  key={msg.id}
                  content={msg.content}
                  fileName={msg.metadata?.file || "AGENTS.md"}
                  onOpenModal={onOpenModal}
                />
              ))}
            </div>
          )}
          {messagesWithoutReminders.length === 0 ? (
            <p className="text-center text-xs text-gh-text-secondary py-8">
              Agent work appears here as tools run and responses stream in.
            </p>
          ) : (
            messagesWithoutReminders.map((msg, idx) => (
              <div key={msg.id} data-marker-id={`msg-${idx}`} data-message-index={idx}>
                <MessageBlock message={msg} onOpenModal={onOpenModal} onPin={onPin} />
              </div>
            ))
          )}
        </div>

        {showScrollBottom && (
          <div className="absolute bottom-0 right-14 z-20 pb-3 pointer-events-none">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto size-7 flex items-center justify-center rounded-md bg-gh-bg-secondary border border-gh-border text-gh-text-secondary hover:text-gh-text hover:border-accent-border transition-colors cursor-pointer shadow-sm"
              title="Scroll to bottom"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        {showScrollTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="absolute top-2 right-14 z-20 size-7 flex items-center justify-center rounded-md bg-gh-bg-secondary border border-gh-border text-gh-text-secondary hover:text-gh-text hover:border-accent-border transition-colors cursor-pointer shadow-sm"
            title="Scroll to top"
          >
            <ChevronUp size={14} />
          </button>
        )}

        {markers.length > 0 && (
          <div className="absolute right-0 top-0 bottom-0 z-10 group" style={{ width: "28px" }}>
            <div
              className={`absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-150 ${markerFilterOpen ? "w-12" : "w-3 group-hover:w-12"}`}
            >
              <div className="relative h-full w-full">
                {/* Filter toggle */}
                <div ref={filterRef} className="absolute top-1 left-1/2 -translate-x-1/2 z-20">
                  <div className="relative pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => setMarkerFilterOpen((v) => !v)}
                      className="size-4 flex items-center justify-center rounded text-gh-text-secondary/50 hover:text-gh-text hover:bg-gh-bg-hover transition-colors cursor-pointer"
                      title="Filter markers"
                    >
                      <Filter size={12} />
                    </button>
                    {markerFilterOpen && (
                      <div className="absolute right-full top-0 mr-2 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl min-w-36 max-h-60 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setHiddenMarkerTypes(
                              hiddenMarkerTypes.size > 0
                                ? new Set()
                                : new Set(Object.keys(MARKER_DISPLAY_LABELS)),
                            );
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-gh-bg-hover transition-colors cursor-pointer border-b border-gh-border"
                        >
                          {hiddenMarkerTypes.size > 0 ? "Select all" : "Deselect all"}
                        </button>
                        {Object.entries(MARKER_DISPLAY_LABELS).map(([type, label]) => (
                          <label
                            key={type}
                            className="flex items-center gap-2 px-3 py-1 text-[11px] cursor-pointer hover:bg-gh-bg-hover transition-colors whitespace-nowrap"
                          >
                            <input
                              type="checkbox"
                              checked={!hiddenMarkerTypes.has(type)}
                              onChange={() => {
                                setHiddenMarkerTypes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(type)) next.delete(type);
                                  else next.add(type);
                                  return next;
                                });
                              }}
                              className="accent-accent"
                            />
                            <span
                              className="w-2 h-2 rounded-sm shrink-0"
                              style={{ backgroundColor: MARKER_COLORS[type] }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Marker dots */}
                {markers
                  .filter((m) => !hiddenMarkerTypes.has(m.type))
                  .map((m) => {
                    const pos = markerPositions[m.id];
                    if (pos === undefined) return null;
                    return (
                      <div
                        key={m.id}
                        className={`absolute cursor-pointer transition-all pointer-events-auto ${markerFilterOpen ? "left-0 -translate-x-0 w-full h-0.5 rounded-none opacity-100" : "left-1/2 -translate-x-1/2 w-1.5 h-1 rounded-full opacity-30 group-hover:left-0 group-hover:-translate-x-0 group-hover:w-full group-hover:h-0.5 group-hover:rounded-none group-hover:opacity-100"} hover:opacity-100 hover:[&>div]:block`}
                        style={{
                          top: `${Math.max(0, Math.min(100, pos))}%`,
                          backgroundColor: m.color,
                        }}
                        onClick={() => {
                          const el = scrollRef.current?.querySelector(`[data-marker-id="${m.id}"]`);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 hidden bg-gh-bg-secondary border border-gh-border rounded-md px-2 py-1 text-xs whitespace-nowrap z-30 shadow-lg pointer-events-none">
                          <div className="font-medium text-[10px] uppercase tracking-wider opacity-60">
                            {m.label}
                          </div>
                          <div className="text-gh-text truncate max-w-56">{m.summary}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isPinnedResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handlePinnedResizeStart}
      >
        <div className="w-6 h-0.5 rounded-full bg-gh-border" />
      </div>

      <div
        className="sess-pinned-bar shrink-0 overflow-hidden mb-3"
        style={pinnedExpanded ? { maxHeight: pinnedHeight } : undefined}
      >
        <button
          type="button"
          className="flex items-center gap-2 w-full px-4 py-2 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
          onClick={() => setPinnedExpanded((v) => !v)}
        >
          <ChevronRight
            size={12}
            className={`text-gh-text-secondary transition-transform ${pinnedExpanded ? "rotate-90" : ""}`}
          />
          <User size={16} className="text-accent-secondary shrink-0" />
          <span className="text-xs font-semibold text-gh-text">Initial Prompt</span>
          {session.model && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gh-bg-hover text-gh-text-secondary font-mono">
              {session.model}
            </span>
          )}

          {totalTokens > 0 && (
            <span className="text-[11px] text-gh-text-secondary" title="Tokens">
              {(totalTokens / 1000).toFixed(0)}k tokens
            </span>
          )}
          {session.cost > 0 && (
            <span className="text-[11px] text-gh-text-secondary" title="Cost">
              {formatCost(session.cost)}
            </span>
          )}
          {session.diffFiles > 0 && (
            <span className="text-[11px] text-gh-text-secondary" title="Files changed">
              {session.diffFiles}f<span className="text-green-500">+{session.diffAdditions}</span>
              <span className="text-red-500">-{session.diffDeletions}</span>
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleResume();
            }}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border cursor-pointer transition-all ml-auto shrink-0 ${
              copied
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-accent-border bg-accent-muted text-accent hover:shadow-[0_0_12px_var(--color-glow)]"
            }`}
            title="Copy resume command"
          >
            {copied ? (
              <>
                <Check size={10} className="text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy size={10} />
                Resume
              </>
            )}
          </button>
        </button>
        {pinnedExpanded && (
          <div className="px-4 pb-3 overflow-y-auto border-t border-gh-border">
            <div className="ml-6 mt-2">
              <UserPromptBubble message={firstMessage} onOpenModal={onOpenModal} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  onOpenModal,
  onPin,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
}) {
  if (message.role === "user") {
    if (!message.content?.trim()) return null;
    const turnAborted = message.metadata?.type === "turn_aborted";
    if (turnAborted) {
      return (
        <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
            <TriangleAlert size={14} className="text-red-400 shrink-0" />
            <span className="text-[11px] font-semibold text-red-400">TURN ABORTED</span>
          </div>
          <div className="px-3 py-2 text-xs text-gh-text-secondary whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
        </div>
      );
    }
    return <UserTurnView content={message.content} onOpenModal={onOpenModal} />;
  }
  if (message.role === "system") {
    if (!message.content?.trim()) return null;
    const isReminder = message.metadata?.type === "system_reminder";
    if (isReminder) {
      return (
        <SystemReminderView
          content={message.content}
          fileName={message.metadata?.file || "AGENTS.md"}
          onOpenModal={onOpenModal}
        />
      );
    }
    return <div className="sess-system-notice whitespace-pre-wrap">{message.content}</div>;
  }
  if (message.role === "assistant") {
    const taskComplete = (message.toolCalls ?? []).find((t) => t.name === "task_complete");
    if (taskComplete) {
      return <TaskCompleteMessageView tool={taskComplete} />;
    }
  }
  return <AssistantMessageView message={message} onOpenModal={onOpenModal} onPin={onPin} />;
}

function extractInlineBlocks(content: string) {
  const blocks: Array<{
    type: "skill-context" | "file-context";
    content: string;
    fileName?: string;
  }> = [];

  let remaining = content;

  remaining = remaining.replace(
    /<skill-context(?:\s+(?:file|name)="([^"]*)")?\s*>([\s\S]*?)<\/skill-context>\n?/g,
    (_match, fileOrName, inner) => {
      blocks.push({
        type: "skill-context",
        content: inner.trim(),
        fileName: fileOrName || undefined,
      });
      return "";
    },
  );

  remaining = remaining.replace(
    /<file-context(?:\s+path="([^"]*)")?(?:\s+lang="([^"]*)")?\s*>([\s\S]*?)<\/file-context>\n?/g,
    (_match, filePath, _lang, inner) => {
      blocks.push({
        type: "file-context",
        content: inner.trim(),
        fileName: filePath || undefined,
      });
      return "";
    },
  );

  remaining = remaining.trim();
  return { blocks, remaining };
}

function CollapsibleBlock({
  content,
  label,
  icon,
  className,
  onOpenModal,
  defaultCollapsed = false,
}: {
  content: string;
  label: string;
  icon: ReactNode;
  className?: string;
  onOpenModal?: (content: string, title?: string) => void;
  defaultCollapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const lines = content.split("\n");
  const isLong = defaultCollapsed || lines.length > 20;
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n…" : content;

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 ${className || ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        {icon}
        <span className="font-semibold text-[11px]">{label}</span>
      </div>
      {expanded && (
        <div className="px-3 py-2">
          <div className="relative">
            {!expanded && isLong && (
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg-secondary)] to-transparent z-10 pointer-events-none" />
            )}
            <MarkdownContent
              content={display}
              className="markdown-body--wide"
              onOpenModal={onOpenModal ? () => onOpenModal(content, label) : undefined}
              modalTitle={label}
            />
          </div>
        </div>
      )}
      {isLong && (
        <div className="flex justify-center border-t border-inherit">
          <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

function FileContextBlock({ block }: { block: { content: string; fileName?: string } }) {
  const [expanded, setExpanded] = useState(false);
  const fileName = block.fileName || "";
  const baseName = fileName.split("/").pop() || fileName;
  const lang = detectLanguage(fileName);
  const content = block.content;

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">read:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={fileName}>
          {baseName}
        </span>
      </button>
      {expanded && content && (
        <div className="relative group">
          <CopyButton text={content} className="absolute top-1 right-1 z-10" />
          <FileRenderer content={content} lang={lang} />
        </div>
      )}
    </div>
  );
}

function UserTurnView({
  content,
  onOpenModal,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const { blocks, remaining } = extractInlineBlocks(content);
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const [expanded, setExpanded] = useState(!isLong);

  if (blocks.length === 0) {
    const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n…" : content;

    return (
      <div className="sess-user-turn">
        <div className="sess-user-turn-label">USER-REQUEST</div>
        <div className="relative">
          {!expanded && isLong && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg)] to-transparent z-10 pointer-events-none" />
          )}
          <MarkdownContent
            content={display}
            className="markdown-body--wide"
            onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
            modalTitle="USER-REQUEST"
          />
        </div>
        {isLong && (
          <div className="flex justify-center mt-1">
            <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const isSkillOnly = blocks.length > 0 && !remaining;

  return (
    <div className="sess-user-turn">
      <div className="sess-user-turn-label">
        {isSkillOnly ? `SKILL: ${blocks[0].fileName || "Context"}` : "USER-REQUEST"}
      </div>
      {remaining && (
        <MarkdownContent
          content={remaining}
          className="markdown-body--wide"
          onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
          modalTitle="USER-REQUEST"
        />
      )}
      {blocks.map((block, i) =>
        block.type === "skill-context" ? (
          <CollapsibleBlock
            key={i}
            content={block.content}
            label={block.fileName || "Context"}
            icon={<Info size={16} className="text-sky-400 shrink-0" />}
            className="border-sky-500/30 bg-sky-500/[0.03]"
            onOpenModal={onOpenModal}
          />
        ) : block.type === "file-context" ? (
          <FileContextBlock key={i} block={block} />
        ) : null,
      )}
    </div>
  );
}

function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning) return null;
  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        {expanded ? "Hide thinking" : "Show thinking"}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-2.5 border-l-2 border-accent-muted">
          <div className="text-xs text-gh-text-secondary whitespace-pre-wrap leading-relaxed">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  onOpenModal,
  onPin,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
}) {
  const agent = message.agent && message.agent !== "main" ? message.agent : undefined;
  const text = (message.content || "").trim();
  const reasoning = message.reasoning || "";
  const tools = (message.toolCalls ?? []).filter((t) => t.name !== "report_intent");
  if (!text && !reasoning && tools.length === 0) return null;
  const showText = shouldShowStepContent(text, tools);
  if (!showText && !reasoning && tools.length === 0) return null;

  return (
    <div className="sess-agent-stream">
      {agent && (
        <span className="inline-block mb-2 text-[11px] px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border">
          {agent}
        </span>
      )}
      <ThinkingBlock reasoning={reasoning} />
      {showText && <AssistantStepContent content={text} onOpenModal={onOpenModal} onPin={onPin} />}
      {tools.length > 0 && (
        <div className={showText ? "mt-2" : ""}>
          <ToolCallList
            toolCalls={tools}
            agent={agent}
            compact
            onOpenModal={onOpenModal}
            onPin={onPin}
          />
        </div>
      )}
    </div>
  );
}

function AssistantStepContent({
  content,
  onOpenModal,
  onPin,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isLong = content.length > 4000;
  const display = !expanded && isLong ? content.slice(0, 4000) + "\n\n…" : content;

  return (
    <div>
      <MarkdownContent
        content={display}
        className="markdown-body--wide"
        onOpenModal={() => onOpenModal?.(content, "Assistant response")}
        onPin={onPin ? () => onPin(content) : undefined}
        modalTitle="Assistant response"
      />
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function UserPromptBubble({
  message,
  onOpenModal,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isLong = message.content.length > 3000;
  const display =
    !expanded && isLong ? message.content.slice(0, 3000) + "\n\n..." : message.content;

  return (
    <div>
      <MarkdownContent
        content={display}
        className="markdown-body--wide"
        onOpenModal={() => onOpenModal?.(message.content, "Initial prompt")}
        modalTitle="Initial prompt"
      />
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function SystemReminderView({
  content,
  fileName,
  onOpenModal,
}: {
  content: string;
  fileName: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n…" : content;

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/[0.03] mx-4 mb-3 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        <TriangleAlert size={16} className="text-amber-400 shrink-0" />
        <span className="font-semibold text-[11px] text-amber-400 uppercase">{fileName}</span>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          {!expanded && isLong && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg-secondary)] to-transparent z-10 pointer-events-none" />
          )}
          <MarkdownContent
            content={display}
            className="markdown-body--wide"
            onOpenModal={onOpenModal ? () => onOpenModal(content, fileName) : undefined}
            modalTitle={fileName}
          />
        </div>
      </div>
      {isLong && (
        <div className="flex justify-center border-t border-amber-500/10">
          <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

function TaskCompleteMessageView({ tool }: { tool: ToolCall }) {
  let summary = "";
  const { copied, copy } = useCopy(2000);

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  return (
    <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.03] mx-4 mb-3 relative group">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CircleCheckBig size={16} className="text-emerald-400 shrink-0" />
          <span className="font-semibold text-[11px] text-emerald-400">Task Complete</span>
        </div>
        {summary && (
          <div className="mt-1.5">
            <MarkdownContent content={summary} className="markdown-body--wide" />
          </div>
        )}
      </div>
      {summary && (
        <button
          type="button"
          onClick={() => copy(summary)}
          className="absolute top-2 right-2 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-all opacity-0 group-hover:opacity-100 border border-gh-border bg-surface-elevated"
          title="Copy summary"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}
