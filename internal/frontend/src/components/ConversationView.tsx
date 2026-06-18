import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import { fetchResumeCommand } from "../hooks/useApi";
import { formatCost } from "../utils/buildTree";
import { shouldShowStepContent } from "../utils/toolDisplay";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { workerFactory } from "../utils/workerFactory";
import { MarkdownContent } from "./MarkdownContent";
import { ToolCallList } from "./ToolRenderers/ToolCallList";
import { useSessionNav } from "../hooks/useNav";

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
  focusStepIndex,
  searchHighlightQuery,
}: {
  messages: Message[];
  session: Session;
  loading: boolean;
  onOpenModal?: (content: string, title?: string) => void;
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
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Re-check scroll position after messages render (e.g. initial load, tab switch)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      setShowScrollTop(el.scrollTop > 200);
    });
  }, [messages.length]);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

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
        setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
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
        setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
        break;
      }
    }
  }, [searchHighlightQuery, messagesWithoutReminders.length]);

  const handleResume = async () => {
    try {
      const cmd = await fetchResumeCommand(session.id);
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handlePinnedResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
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
      const finalHeight = Math.max(60, Math.min(600, startHeight + (startY - ev.clientY)));
      try {
        localStorage.setItem("sess-pinned-height", String(finalHeight));
      } catch {
        // localStorage may be unavailable
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
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
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.75 6.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5H6.5v3.5a.75.75 0 0 1-1.5 0V6.5Z" />
          </svg>
        </div>
        <p className="text-sm text-gh-text-secondary">No messages in this session</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden mb-3 relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        <WorkerPoolContextProvider
          poolOptions={{ workerFactory }}
          highlighterOptions={{
            theme: { light: "github-light", dark: "github-dark" },
            langs: [
              "typescript",
              "javascript",
              "tsx",
              "jsx",
              "css",
              "html",
              "json",
              "markdown",
              "go",
              "python",
              "rust",
              "shellscript",
              "yaml",
              "sql",
            ],
          }}
        >
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
              <div key={msg.id} data-message-index={idx}>
                <MessageBlock message={msg} onOpenModal={onOpenModal} />
              </div>
            ))
          )}
        </WorkerPoolContextProvider>
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
          <svg
            className={`size-3 text-gh-text-secondary transition-transform ${pinnedExpanded ? "rotate-90" : ""}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <svg
            className="size-4 text-accent-secondary shrink-0"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm5 6a5 5 0 0 0-10 0h10Z" />
          </svg>
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
                <svg className="size-2.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="size-2.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
                </svg>
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

      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="absolute top-2 right-2 z-10 size-7 flex items-center justify-center rounded-md bg-gh-bg-secondary border border-gh-border text-gh-text-secondary hover:text-gh-text hover:border-accent-border transition-colors cursor-pointer shadow-sm"
          title="Scroll to top"
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 13.75a.75.75 0 0 1-.75-.75V4.81L3.53 8.53a.75.75 0 0 1-1.06-1.06l5-5a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1-1.06 1.06L8.75 4.81V13c0 .414-.336.75-.75.75Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function MessageBlock({
  message,
  onOpenModal,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  if (message.role === "user") {
    if (!message.content?.trim()) return null;
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
  return <AssistantMessageView message={message} onOpenModal={onOpenModal} />;
}

function extractInlineBlocks(content: string) {
  const blocks: Array<{
    type: "skill-context";
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

  remaining = remaining.trim();
  return { blocks, remaining };
}

function CollapsibleBlock({
  content,
  label,
  icon,
  className,
  onOpenModal,
}: {
  content: string;
  label: string;
  icon: ReactNode;
  className?: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n…" : content;

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 ${className || ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        {icon}
        <span className="font-semibold text-[11px]">{label}</span>
      </div>
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

function UserTurnView({
  content,
  onOpenModal,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const { blocks, remaining } = extractInlineBlocks(content);
  const [expanded, setExpanded] = useState(true);

  if (blocks.length === 0) {
    const lines = content.split("\n");
    const isLong = lines.length > 20;
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
      {blocks.map((block, i) =>
        block.type === "skill-context" ? (
          <CollapsibleBlock
            key={i}
            content={block.content}
            label={block.fileName || "Context"}
            icon={
              <svg className="size-4 text-sky-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 5.5a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0v-3Zm1 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
              </svg>
            }
            className="border-sky-500/30 bg-sky-500/[0.03]"
            onOpenModal={onOpenModal}
          />
        ) : null,
      )}
      {remaining && (
        <MarkdownContent
          content={remaining}
          className="markdown-body--wide"
          onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
          modalTitle="USER-REQUEST"
        />
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
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
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
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
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
      {showText && <AssistantStepContent content={text} onOpenModal={onOpenModal} />}
      {tools.length > 0 && (
        <div className={showText ? "mt-2" : ""}>
          <ToolCallList toolCalls={tools} agent={agent} compact onOpenModal={onOpenModal} />
        </div>
      )}
    </div>
  );
}

function AssistantStepContent({
  content,
  onOpenModal,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
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
        <svg className="size-4 text-amber-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 5.5a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0v-3Zm1 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
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
  const [copied, setCopied] = useState(false);
  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.03] mx-4 mb-3 relative group">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="size-4 text-emerald-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.36 4.76-4.25 4.5a.75.75 0 0 1-1.08.02L3.97 8.6a.75.75 0 0 1 1.06-1.06l1.7 1.7 3.72-3.94a.75.75 0 1 1 1.1 1.04Z" />
          </svg>
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
          onClick={handleCopy}
          className="absolute top-2 right-2 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-all opacity-0 group-hover:opacity-100 border border-gh-border bg-surface-elevated"
          title="Copy summary"
        >
          {copied ? (
            <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          ) : (
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
