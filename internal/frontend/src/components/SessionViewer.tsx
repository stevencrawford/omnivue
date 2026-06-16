import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import {
  fetchMessages,
  fetchResumeCommand,
  setSessionName,
  clearSessionName,
} from "../hooks/useApi";
import { formatCost } from "../utils/buildTree";
import { effectiveToolKind, getToolSummary, shouldShowStepContent } from "../utils/toolDisplay";
import { File, FileDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import { workerFactory } from "../utils/workerFactory";
import { MarkdownContent } from "./MarkdownContent";
import { Modal } from "./Modal";
import { DiffView } from "./DiffView";
import { ScratchEditor } from "./ScratchEditor";
import { useSessionNav } from "../hooks/useNav";

/** Merge consecutive tool-call-only assistant messages into a single block. */
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

export type Tab = "session" | "diff" | `scratch:${string}`;

interface SessionViewerProps {
  session: Session;
  liveChangedIds: Set<string>;
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  openScratchTabs: string[];
  scratchFileMap: Record<string, { title: string }>;
  onCloseScratchTab: (fileId: string) => void;
  onNewScratchFile?: () => void;
}

const MAIN_TABS: { tab: "session" | "diff"; label: string; icon: ReactNode }[] = [
  {
    tab: "session",
    label: "Session",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.75 6.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5H6.5v3.5a.75.75 0 0 1-1.5 0V6.5Z" />
      </svg>
    ),
  },
  {
    tab: "diff",
    label: "Diff",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
      </svg>
    ),
  },
];

export function SessionViewer({
  session,
  liveChangedIds,
  activeTab: activeTabProp,
  onTabChange,
  openScratchTabs,
  scratchFileMap,
  onCloseScratchTab,
  onNewScratchFile,
}: SessionViewerProps) {
  const [localTab, setLocalTab] = useState<Tab>("session");
  const activeTab = activeTabProp ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMessages(session.id);
      setMessages(data || []);
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Live refetch: when the backend announces a change to this session,
  // re-pull messages with a small debounce so a burst of changes coalesces
  // into a single network request. Only acts on the session tab — plan/diff
  // tabs manage their own fetch on sessionId change.
  useEffect(() => {
    if (activeTab !== "session") return;
    if (!liveChangedIds.has(session.id)) return;
    const handle = setTimeout(() => {
      loadMessages();
    }, 300);
    return () => clearTimeout(handle);
  }, [liveChangedIds, session.id, activeTab, loadMessages]);

  const messageCount = useMemo(() => {
    const user = messages.filter((m) => m.role === "user").length;
    const assistant = messages.filter((m) => m.role === "assistant").length;
    return { user, assistant, total: messages.length };
  }, [messages]);

  // Fallback: if active tab refers to a scratch file no longer open, go to session
  useEffect(() => {
    if (activeTab.startsWith("scratch:") && !openScratchTabs.includes(activeTab.slice(8))) {
      setActiveTab("session");
    }
  }, [activeTab, openScratchTabs]);

  // Tab helper: get tab icon
  const tabIcon = (tab: Tab): ReactNode => {
    if (tab === "session")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.75 6.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5H6.5v3.5a.75.75 0 0 1-1.5 0V6.5Z" />
        </svg>
      );
    if (tab === "diff")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
        </svg>
      );
    if (tab.startsWith("scratch:"))
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 9 3.25V1.5H3.75Z" />
        </svg>
      );
    return null;
  };

  const scratchTabLabel = (fileId: string): string => {
    const info = scratchFileMap[fileId];
    return info?.title || "Untitled";
  };

  const isScratchTab = (tab: Tab): tab is `scratch:${string}` => tab.startsWith("scratch:");
  const scratchFileIdFromTab = (tab: Tab): string | null =>
    isScratchTab(tab) ? tab.slice(8) : null;

  return (
    <div className="flex flex-col h-full">
      <SessionHeader session={session} />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gh-border shrink-0 overflow-x-auto">
        {MAIN_TABS.map(
          (meta) =>
            (meta.tab !== "diff" || !session.parentId) && (
              <button
                key={meta.tab}
                type="button"
                className={`sess-tab-pill shrink-0 ${activeTab === meta.tab ? "sess-tab-pill--active" : ""}`}
                onClick={() => setActiveTab(meta.tab)}
              >
                {meta.icon}
                {meta.label}
                {meta.tab === "session" && messageCount.total > 0 && (
                  <span className="text-[11px] opacity-70 tabular-nums">{messageCount.total}</span>
                )}
              </button>
            ),
        )}
        {openScratchTabs.map((fid) => {
          const tab: Tab = `scratch:${fid}`;
          return (
            <button
              key={fid}
              type="button"
              className={`sess-tab-pill shrink-0 ${activeTab === tab ? "sess-tab-pill--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabIcon(tab)}
              <span className="truncate max-w-28">{scratchTabLabel(fid)}</span>
              <span
                role="button"
                className="ml-1 text-gh-text-secondary hover:text-gh-text cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseScratchTab(fid);
                }}
              >
                <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </span>
            </button>
          );
        })}
        {!session.parentId && (
          <>
            <div className="w-px h-4 bg-gh-border mx-1 shrink-0" />
            <button
              type="button"
              onClick={onNewScratchFile}
              className="sess-tab-pill text-gh-text-secondary hover:text-gh-text shrink-0"
              title="New scratch file"
            >
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "session" && (
        <ConversationView
          messages={messages}
          session={session}
          loading={loading}
          onOpenModal={(content, title) => setMarkdownModal({ content, title })}
        />
      )}
      {activeTab === "diff" && (
        <div className="flex-1 overflow-y-auto">
          <DiffView sessionId={session.id} />
        </div>
      )}
      {isScratchTab(activeTab) &&
        (() => {
          const fid = scratchFileIdFromTab(activeTab)!;
          return (
            <ScratchEditor
              key={fid}
              sessionId={session.id}
              fileId={fid}
              onDelete={() => onCloseScratchTab(fid)}
            />
          );
        })()}

      {/* Markdown modal */}
      <Modal
        isOpen={markdownModal !== null}
        onClose={() => setMarkdownModal(null)}
        title={markdownModal?.title}
        size="xl"
      >
        {markdownModal && (
          <MarkdownContent content={markdownModal.content} className="markdown-body--wide" />
        )}
      </Modal>
    </div>
  );
}

function SessionHeader({ session }: { session: Session }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [displayTitle, setDisplayTitle] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display title when session changes
  useEffect(() => {
    setDisplayTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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
    } catch {
      /* ignore */
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") setEditing(false);
  };

  const badgeClass =
    session.agent === "opencode"
      ? "sess-agent-badge sess-agent-badge--opencode"
      : session.agent === "copilot"
        ? "sess-agent-badge sess-agent-badge--copilot"
        : "sess-agent-badge bg-gh-bg-hover text-gh-text-secondary";

  return (
    <div className="px-4 py-3 border-b border-gh-border shrink-0">
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
              className="flex-1 text-sm font-semibold bg-gh-bg-secondary border border-accent-border rounded px-1.5 py-0.5 text-gh-text outline-none min-w-0"
            />
            <button
              type="button"
              onClick={clearOverride}
              className="text-[11px] text-gh-text-secondary hover:text-gh-text cursor-pointer shrink-0 px-1"
              title="Revert to original name"
            >
              Reset
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gh-text truncate">
              {displayTitle || session.id}
            </h2>
            {!session.parentId && (
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 text-gh-text-secondary hover:text-accent cursor-pointer p-0.5 rounded transition-colors"
                title="Rename session"
              >
                <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.745 8.815a.25.25 0 0 0-.063.109l-.579 2.027 2.027-.579a.25.25 0 0 0 .109-.063l8.273-8.273a.25.25 0 0 0 0-.354l-1.086-1.086Z" />
                </svg>
              </button>
            )}
          </>
        )}
        <span className={`${badgeClass} shrink-0`}>{session.agent}</span>
        <span
          className="text-[11px] font-mono text-gh-text-secondary ml-auto truncate max-w-[40%]"
          title={session.directory}
        >
          {session.repository || session.directory}
        </span>
      </div>
    </div>
  );
}

// --- Conversation View ---

function ConversationView({
  messages,
  session,
  loading,
  onOpenModal,
}: {
  messages: Message[];
  session: Session;
  loading: boolean;
  onOpenModal?: (content: string, title?: string) => void;
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

  // Restore scroll position on initial load, otherwise auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const saved = scrollPositions.get(session.id);
      if (saved !== undefined && prevLengthRef.current === 0) {
        scrollRef.current.scrollTop = saved;
      }
    }
  }, [messages.length, session.id, scrollPositions]);

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        saveScrollPosition(session.id, scrollRef.current.scrollTop);
      }
    };
  }, [session.id, saveScrollPosition]);

  // Auto-scroll to bottom when new messages arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (messages.length > prevLengthRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  const firstMessage = messages[0];
  const tail = messages.slice(1);
  const grouped = useMemo(() => groupMessages(tail), [tail]);

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
          {grouped.length === 0 ? (
            <p className="text-center text-xs text-gh-text-secondary py-8">
              Agent work appears here as tools run and responses stream in.
            </p>
          ) : (
            grouped.map((msg) => (
              <MessageBlock key={msg.id} message={msg} onOpenModal={onOpenModal} />
            ))
          )}
        </WorkerPoolContextProvider>
      </div>

      {/* Divider between messages and pinned bar */}
      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isPinnedResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handlePinnedResizeStart}
      >
        <div className="w-6 h-0.5 rounded-full bg-gh-border" />
      </div>

      {/* Pinned user prompt at bottom */}
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

          {/* Stats */}
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

          {/* Resume button */}
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
    </div>
  );
}

// --- Per-message rendering (chronological) ---

function MessageBlock({
  message,
  onOpenModal,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  if (message.role === "user") {
    return <UserTurnView content={message.content} onOpenModal={onOpenModal} />;
  }
  if (message.role === "system") {
    if (!message.content?.trim()) return null;
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

function UserTurnView({
  content,
  onOpenModal,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isLong = content.length > 2000;
  const display = !expanded && isLong ? content.slice(0, 2000) + "…" : content;

  return (
    <div className="sess-user-turn">
      <div className="sess-user-turn-label">USER-REQUEST</div>
      <MarkdownContent
        content={display}
        className="markdown-body--wide"
        onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
        modalTitle="USER-REQUEST"
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
  const tools = message.toolCalls ?? [];
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

// --- Pinned user prompt ---

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

// --- Task Complete message rendering ---

function TaskCompleteMessageView({ tool }: { tool: ToolCall }) {
  let summary = "";
  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  return (
    <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.03] mx-4 mb-3">
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
      {tool.output && (
        <div className="border-t border-emerald-500/20">
          <MarkdownContent
            content={tool.output}
            expandable
            defaultExpanded
            className="markdown-body--wide"
          />
        </div>
      )}
    </div>
  );
}

// --- Edit tool diff rendering ---

interface EditInput {
  path?: string;
  filePath?: string;
  file_path?: string;
  old_str?: string;
  new_str?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  view_range?: [number, number];
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    go: "go",
    py: "python",
    rs: "rust",
    rb: "ruby",
    java: "java",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sh: "shellscript",
    bash: "shellscript",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
    c: "c",
    cpp: "cpp",
    h: "c",
  };
  return langMap[ext] || "";
}

function EditToolDiff({ tool }: { tool: ToolCall }) {
  let input: EditInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  // OpenCode uses oldString/newString, Copilot uses old_str/new_str
  const oldStr = input.old_str || input.oldString || "";
  const newStr = input.new_str || input.newString || "";
  const content = input.content || "";
  const viewRange = input.view_range;
  const lang = detectLanguage(filePath);

  // Write tools provide new file content (no old content to diff against)
  const isWrite = tool.name === "write" && !!content;
  // Additions: view_range present with no old_str, or write tool
  const isAddition = (viewRange != null && !oldStr) || isWrite;

  let fileDiffMetadata: ReturnType<typeof parseDiffFromFile> | null = null;
  if (!isAddition && oldStr && newStr) {
    try {
      fileDiffMetadata = parseDiffFromFile(
        { name: filePath, contents: oldStr, lang },
        { name: filePath, contents: newStr, lang },
      );
    } catch {
      /* ignore */
    }
  }

  const baseOptions = {
    disableLineNumbers: false,
    disableFileHeader: true,
    theme: { light: "github-light" as const, dark: "github-dark" as const },
  };

  const displayContent = newStr || content;

  return (
    <div className="border border-accent-border rounded-lg overflow-hidden bg-gh-bg-secondary/30 mx-4 mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 text-accent shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
        </svg>
        <span className="font-medium text-gh-text truncate">{filePath}</span>
        {viewRange && (
          <span className="shrink-0 text-gh-text-secondary/70">
            :{viewRange[0]}-{viewRange[1]}
          </span>
        )}
      </div>
      {fileDiffMetadata ? (
        <FileDiff
          fileDiff={fileDiffMetadata}
          options={{ ...baseOptions, diffStyle: "split" as const }}
        />
      ) : isAddition && displayContent ? (
        <File file={{ name: filePath, contents: displayContent, lang }} options={baseOptions} />
      ) : null}
    </div>
  );
}

// --- Bash tool rendering ---

interface BashMetadata {
  output?: string;
  exit?: number;
  description?: string;
  truncated?: boolean;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-gh-bg-secondary border border-accent-border text-gh-text-secondary hover:text-gh-text"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function BashToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let command = "";
  let description = "";
  try {
    const input = JSON.parse(tool.input);
    command = input.command || "";
    description = input.description || "";
  } catch {
    /* ignore */
  }

  let stdout = tool.output || "";
  let exitCode: number | undefined;
  let truncated = false;
  try {
    const meta: BashMetadata = JSON.parse(tool.metadata || "{}");
    if (meta.output && !stdout) stdout = meta.output;
    if (meta.exit != null) exitCode = meta.exit;
    if (meta.truncated) truncated = true;
  } catch {
    /* ignore */
  }

  const success = exitCode == null || exitCode === 0;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`size-3 text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className={`shrink-0 font-bold ${success ? "text-emerald-400" : "text-red-400"}`}>
          {success ? "✓" : "✗"}
        </span>
        <span className="text-gh-text truncate" title={description || command}>
          {description || command}
        </span>
        {truncated && <span className="shrink-0 ml-auto text-gh-text-secondary/60">truncated</span>}
      </button>
      {expanded && (
        <>
          <div className="relative group px-3 py-2 bg-gh-bg-secondary/30">
            <CopyBtn text={command} />
            <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all">
              <span className="text-accent-secondary">$ </span>
              {command}
            </pre>
          </div>
          {stdout && (
            <div className="relative group border-t border-accent-border">
              <CopyBtn text={stdout} />
              <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {trimBashOutput(stdout)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function trimBashOutput(output: string): string {
  const lines = output.split("\n");
  const maxLines = 200;
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines)`;
  }
  return output;
}

// --- Read tool rendering ---

interface ReadInput {
  filePath?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

function ReadToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let input: ReadInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const isPartialRead = (input.offset ?? 0) > 0 || (input.limit ?? 0) > 0;

  let truncated = false;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    truncated = !!meta.truncated;
  } catch {
    /* ignore */
  }

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^[0-9]{5}\| ?/gm, "");

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`size-3 text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="shrink-0 text-gh-text-secondary/70 font-medium">read:</span>
        <span className="font-medium text-gh-text truncate" title={filePath}>
          {filePath}
        </span>
        {isPartialRead && (
          <span className="shrink-0 text-gh-text-secondary/70">
            :{input.offset ?? 1}-{(input.offset ?? 0) + (input.limit ?? 0)}
          </span>
        )}
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">file truncated</span>}
      </button>
      {expanded && cleanContent && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
          {cleanContent}
        </pre>
      )}
    </div>
  );
}

// --- Grep tool rendering ---

interface GrepInput {
  pattern?: string;
  query?: string;
  path?: string;
  include?: string;
}

function GrepToolDiff({ tool }: { tool: ToolCall }) {
  let input: GrepInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let matchCount = 0;
  let truncated = false;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    matchCount = meta.matches ?? 0;
    truncated = !!meta.truncated;
  } catch {
    /* ignore */
  }

  const pattern = input.pattern || input.query || "";
  const results = tool.output || "";
  const maxLines = 200;
  const lines = results.split("\n");
  const displayLines = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const overLimit = lines.length > maxLines;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.75 1.5a.75.75 0 0 0-1.5 0v5.25H2a.75.75 0 0 0 0 1.5h5.25v5.25a.75.75 0 0 0 1.5 0V8.25H14a.75.75 0 0 0 0-1.5H8.75V1.5Z" />
        </svg>
        <span className="font-medium text-gh-text truncate" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {matchCount > 0 && (
          <span className="shrink-0">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">truncated</span>}
      </div>
      {displayLines.length > 0 && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
          {displayLines.join("\n")}
          {overLimit && `\n\n... (${lines.length - maxLines} more lines)`}
        </pre>
      )}
    </div>
  );
}

// --- Glob tool rendering ---

interface GlobInput {
  pattern?: string;
}

function GlobToolDiff({ tool }: { tool: ToolCall }) {
  let input: GlobInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let count = 0;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    count = meta.count ?? 0;
  } catch {
    /* ignore */
  }

  const pattern = input.pattern || "";
  const output = tool.output || "";

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5Z" />
        </svg>
        <span className="font-medium text-gh-text truncate" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {output && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  );
}

// --- Todowrite tool rendering ---

interface TodoItem {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface TodowriteInput {
  todos: TodoItem[];
}

function TodoWriteToolDiff({ tool }: { tool: ToolCall }) {
  let todos: TodoItem[] = [];
  try {
    const parsed: TodowriteInput = JSON.parse(tool.input);
    todos = parsed.todos || [];
  } catch {
    /* ignore */
  }

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25h-8.5ZM6.5 5.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
        <span className="font-medium text-gh-text">Plan</span>
        <span className="text-gh-text-secondary/70">
          {completed}/{todos.length} done
        </span>
        {inProgress > 0 && <span className="text-amber-400">{inProgress} in progress</span>}
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 shrink-0">
              {todo.status === "completed" ? (
                <svg className="size-3.5 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.36 4.76-4.25 4.5a.75.75 0 0 1-1.08.02L3.97 8.6a.75.75 0 0 1 1.06-1.06l1.7 1.7 3.72-3.94a.75.75 0 1 1 1.1 1.04Z" />
                </svg>
              ) : todo.status === "in_progress" ? (
                <svg className="size-3.5 text-amber-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                  <circle cx="8" cy="8" r="3.25" fill="currentColor" />
                </svg>
              ) : (
                <svg
                  className="size-3.5 text-gh-text-secondary/50"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                </svg>
              )}
            </span>
            <span
              className={`text-[11px] leading-relaxed ${
                todo.status === "completed"
                  ? "text-gh-text-secondary/60 line-through"
                  : "text-gh-text"
              }`}
            >
              {todo.content}
            </span>
            {todo.priority === "high" && todo.status !== "completed" && (
              <span className="shrink-0 text-[10px] font-medium text-red-400 bg-red-500/10 px-1 rounded">
                high
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Task tool rendering ---

interface TaskInput {
  description?: string;
  subagent_type?: string;
}

function TaskToolDiff({ tool, onOpenModal }: { tool: ToolCall; onOpenModal?: (content: string, title?: string) => void }) {
  let input: TaskInput = {};
  let childSessionId: string | null = null;
  let summary: Array<{ tool: string; state: { status: string; title?: string } }> | null = null;
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    childSessionId = meta.sessionId || null;
    summary = meta.summary || null;
  } catch {
    /* ignore */
  }

  const { navigateToSession } = useSessionNav();
  const description = input.description || "";
  const agent = input.subagent_type || "";

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 2.75A1.75 1.75 0 0 1 3.25 1h9.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 12.75 15h-9.5A1.75 1.75 0 0 1 1.5 13.25V2.75Z" />
        </svg>
        <span
          className={`font-medium text-gh-text truncate ${tool.output && onOpenModal ? "cursor-pointer hover:text-accent" : ""}`}
          title={description || "Sub-task"}
          onClick={(e) => {
            if (tool.output && onOpenModal) {
              e.stopPropagation();
              onOpenModal(tool.output, description);
            }
          }}
        >
          {description || "Sub-task"}
        </span>
        {agent && <span className="text-gh-text-secondary/70">{agent}</span>}
        {totalCount > 0 && (
          <span className="text-gh-text-secondary/70">
            {completedCount}/{totalCount} steps
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {childSessionId && (
            <button
              type="button"
              className="text-accent hover:text-accent-secondary cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                navigateToSession(childSessionId!);
              }}
            >
              View session →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Question tool rendering ---

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

interface QuestionInput {
  questions: QuestionItem[];
}

function QuestionToolDiff({ tool }: { tool: ToolCall }) {
  let questions: QuestionItem[] = [];
  try {
    const parsed: QuestionInput = JSON.parse(tool.input);
    questions = parsed.questions || [];
  } catch {
    /* ignore */
  }

  if (questions.length === 0) {
    // Fallback: treat the whole input as a question text
    const text = tool.input
      ?.replace(/^\{?"(?:question|text|prompt)":\s*"/, "")
      .replace(/"\}$/, "")
      .slice(0, 120);
    if (!text) return null;
    return (
      <div className="overflow-hidden">
        <div className="px-3 py-2 text-[11px] text-gh-text">{text}</div>
        {tool.output && (
          <div className="border-t border-accent-border px-3 py-1.5 text-[11px] text-emerald-400">
            → {tool.output}
          </div>
        )}
      </div>
    );
  }

  const q = questions[0];

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 11.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm.75-7.25a1.75 1.75 0 0 0-1.75 1.75.75.75 0 0 0 1.5 0 .25.25 0 0 1 .5 0c0 .375-.108.555-.46.928l-.09.095C6.36 7.946 6 8.462 6 9.5a.75.75 0 0 0 1.5 0c0-.375.108-.555.46-.928l.09-.095C8.64 8.054 9 7.538 9 6.5a1.75 1.75 0 0 0-1.25-1.75Z" />
        </svg>
        <span className="font-medium text-gh-text truncate">{q.header || q.question}</span>
      </div>
      <div className="px-3 py-2">
        {q.question && q.header !== q.question && (
          <p className="text-[11px] text-gh-text mb-2">{q.question}</p>
        )}
        {q.options && q.options.length > 0 && (
          <div className="space-y-1">
            {q.options.map((opt, i) => {
              const chosen =
                tool.output &&
                (tool.output.toLowerCase().includes(opt.label.toLowerCase()) ||
                  tool.output.toLowerCase().includes(`option ${i + 1}`));
              return (
                <div
                  key={i}
                  className={`px-2.5 py-1.5 rounded text-[11px] border ${
                    chosen
                      ? "border-accent-border bg-accent-muted text-accent"
                      : "border-gh-border bg-gh-bg-secondary/30 text-gh-text-secondary"
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="ml-1 text-gh-text-secondary/70">— {opt.description}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tool.output && (
          <div className="mt-2 border-t border-accent-border pt-2 text-[11px] text-emerald-400 flex items-center gap-1">
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Z" />
            </svg>
            <span>User answered: {tool.output}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tool call rendering ---

const TOOL_CALL_VISIBLE_CAP = 10;

function ToolCallList({
  toolCalls,
  agent,
  compact = false,
  onOpenModal,
}: {
  toolCalls: ToolCall[];
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped = toolCalls.length > TOOL_CALL_VISIBLE_CAP;
  const visible = capped && !showAll ? toolCalls.slice(0, TOOL_CALL_VISIBLE_CAP) : toolCalls;
  const hiddenCount = toolCalls.length - visible.length;

  if (compact) {
    return (
      <>
        {visible.map((tool) => (
          <ToolCallRow key={tool.id} tool={tool} agent={agent} compact onOpenModal={onOpenModal} />
        ))}
        {capped && (
          <button type="button" className="sess-tool-more" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "Show fewer"
              : `Show ${hiddenCount} more tool call${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <ToolCallRow key={tool.id} tool={tool} agent={agent} onOpenModal={onOpenModal} />
      ))}
    </div>
  );
}

function ToolCallRow({
  tool,
  agent,
  compact = false,
  onOpenModal,
}: {
  tool: ToolCall;
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { navigateToSession } = useSessionNav();
  const completed = tool.status === "completed";
  const statusColor = completed ? "text-emerald-400" : "text-amber-400";
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool, agent);

  // Special rendering for task_complete
  if (tool.name === "task_complete" && !compact) {
    let taskSummary = "";
    try {
      const parsed = JSON.parse(tool.input);
      taskSummary = parsed.summary || "";
    } catch {
      /* ignore */
    }

    return (
      <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.03]">
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <svg
              className="size-4 text-emerald-400 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.36 4.76-4.25 4.5a.75.75 0 0 1-1.08.02L3.97 8.6a.75.75 0 0 1 1.06-1.06l1.7 1.7 3.72-3.94a.75.75 0 1 1 1.1 1.04Z" />
            </svg>
            <span className="font-semibold text-[11px] text-emerald-400">Task Complete</span>
          </div>
          {taskSummary && (
            <p className="mt-1 text-[11px] text-gh-text-secondary leading-relaxed">
              {taskSummary.split("\n")[0]}
            </p>
          )}
        </div>
        {tool.output && (
          <div className="border-t border-emerald-500/20">
            <MarkdownContent content={tool.output} expandable defaultExpanded />
          </div>
        )}
      </div>
    );
  }

  // Compact-mode special renderers dispatch by kind
  if (compact) {
    switch (kind) {
      case "bash":
        return <BashToolDiff tool={tool} />;
      case "edit":
      case "write":
        return <EditToolDiff tool={tool} />;
      case "read":
        return <ReadToolDiff tool={tool} />;
      case "grep":
        return <GrepToolDiff tool={tool} />;
      case "glob":
        return <GlobToolDiff tool={tool} />;
      case "todowrite":
        return <TodoWriteToolDiff tool={tool} />;
      case "task":
        return <TaskToolDiff tool={tool} onOpenModal={onOpenModal} />;
      case "question":
        return <QuestionToolDiff tool={tool} />;
    }
  }

  // Extract child session ID for task tools (non-compact)
  let childSessionId: string | null = null;
  if (kind === "task" && tool.metadata) {
    try {
      const meta = JSON.parse(tool.metadata);
      childSessionId = meta.sessionId || null;
    } catch {
      /* ignore */
    }
  }

  const rowClass = "flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors";

  const wrapperClass = "border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center w-full">
        <button type="button" className={rowClass} onClick={() => setExpanded(!expanded)}>
          {!compact && (
            <svg
              className={`size-3 text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          )}
          <span className={`text-[11px] ${statusColor} font-bold shrink-0`}>
            {completed ? "\u2713" : "\u2022"}
          </span>
          <span className="font-mono text-[11px] truncate flex-1 min-w-0 text-gh-text">
            {summary}
          </span>
          {!compact && tool.duration && tool.duration > 0 ? (
            <span className="text-[11px] text-gh-text-secondary shrink-0">
              {tool.duration < 1000
                ? `${tool.duration}ms`
                : `${(tool.duration / 1000).toFixed(1)}s`}
            </span>
          ) : null}
        </button>
        {kind === "task" && childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:text-accent-secondary hover:bg-gh-bg-hover cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId);
            }}
          >
            View ▶
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-gh-border px-3 py-2 space-y-2 bg-gh-bg-secondary/50">
          {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
          {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
        </div>
      )}
    </div>
  );
}

function ToolDataBlock({ label, content }: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = content.length > 500;
  const displayContent = !expanded && isLong ? content.slice(0, 500) + "..." : content;

  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted =
        !expanded && isLong
          ? JSON.stringify(parsed, null, 2).slice(0, 500) + "..."
          : JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        {isLong && (
          <span className="text-[10px] text-gh-text-secondary/60">
            (
            {content.length > 1024
              ? `${(content.length / 1024).toFixed(1)}kb`
              : `${content.length}b`}
            )
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              <svg
                className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
            title="Copy"
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
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}
