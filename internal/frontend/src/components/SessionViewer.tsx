import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import {
  fetchMessages,
  fetchResumeCommand,
  setSessionName,
  clearSessionName,
} from "../hooks/useApi";
import { formatCost } from "../utils/buildTree";
import { getToolSummary, shouldShowStepContent } from "../utils/toolDisplay";
import { MarkdownContent } from "./MarkdownContent";
import { PlanView } from "./PlanView";
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

export type Tab = "session" | "plan" | "diff" | `scratch:${string}`;

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

const MAIN_TABS: { tab: "session" | "plan" | "diff"; label: string; icon: ReactNode }[] = [
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
    tab: "plan",
    label: "Plan",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25h-8.5ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.75Z" />
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
    if (tab === "plan")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25h-8.5ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.75Z" />
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
          <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25h-8.5Z" />
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
                  <span className="text-[10px] opacity-70 tabular-nums">{messageCount.total}</span>
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
        <ConversationView messages={messages} session={session} loading={loading} />
      )}
      {activeTab === "plan" && <PlanView sessionId={session.id} />}
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
              onTitleChange={(_newTitle) => {
                // Title changes reflected via scratchFileMap passed from parent
              }}
            />
          );
        })()}
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
              className="text-[10px] text-gh-text-secondary hover:text-gh-text cursor-pointer shrink-0 px-1"
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
          className="text-[10px] font-mono text-gh-text-secondary ml-auto truncate max-w-[40%]"
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
}: {
  messages: Message[];
  session: Session;
  loading: boolean;
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {grouped.length === 0 ? (
          <p className="text-center text-xs text-gh-text-secondary py-8">
            Agent work appears here as tools run and responses stream in.
          </p>
        ) : (
          grouped.map((msg) => <MessageBlock key={msg.id} message={msg} />)
        )}
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
        className="sess-pinned-bar shrink-0 overflow-hidden"
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg-hover text-gh-text-secondary font-mono">
              {session.model}
            </span>
          )}

          {/* Stats */}
          {totalTokens > 0 && (
            <span className="text-[10px] text-gh-text-secondary" title="Tokens">
              {(totalTokens / 1000).toFixed(0)}k tokens
            </span>
          )}
          {session.cost > 0 && (
            <span className="text-[10px] text-gh-text-secondary" title="Cost">
              {formatCost(session.cost)}
            </span>
          )}
          {session.diffFiles > 0 && (
            <span className="text-[10px] text-gh-text-secondary" title="Files changed">
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
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md border cursor-pointer transition-all ml-auto shrink-0 ${
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
              <UserPromptBubble message={firstMessage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Per-message rendering (chronological) ---

function MessageBlock({ message }: { message: Message }) {
  if (message.role === "user") {
    return <UserTurnView content={message.content} />;
  }
  if (message.role === "system") {
    if (!message.content?.trim()) return null;
    return <div className="sess-system-notice whitespace-pre-wrap">{message.content}</div>;
  }
  return <AssistantMessageView message={message} />;
}

function UserTurnView({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true);
  const isLong = content.length > 2000;
  const display = !expanded && isLong ? content.slice(0, 2000) + "…" : content;

  return (
    <div className="sess-user-turn">
      <div className="sess-user-turn-label">Follow-up</div>
      <div className="text-sm text-gh-text whitespace-pre-wrap break-words leading-relaxed">
        {display}
      </div>
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

function AssistantMessageView({ message }: { message: Message }) {
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
        <span className="inline-block mb-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border">
          {agent}
        </span>
      )}
      <ThinkingBlock reasoning={reasoning} />
      {showText && <AssistantStepContent content={text} />}
      {tools.length > 0 && (
        <div className={showText ? "mt-2" : ""}>
          <ToolCallList toolCalls={tools} agent={agent} compact />
        </div>
      )}
    </div>
  );
}

function AssistantStepContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true);
  const isLong = content.length > 4000;
  const display = !expanded && isLong ? content.slice(0, 4000) + "\n\n…" : content;

  return (
    <div>
      <MarkdownContent content={display} className="markdown-body--wide" />
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

function UserPromptBubble({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(true);
  const isLong = message.content.length > 3000;

  return (
    <div>
      <div className="text-sm text-gh-text whitespace-pre-wrap break-words leading-relaxed">
        {!expanded && isLong ? message.content.slice(0, 3000) + "\n\n..." : message.content}
      </div>
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

// --- Tool call rendering ---

const TOOL_CALL_VISIBLE_CAP = 10;

function ToolCallList({
  toolCalls,
  agent,
  compact = false,
}: {
  toolCalls: ToolCall[];
  agent?: string;
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped = toolCalls.length > TOOL_CALL_VISIBLE_CAP;
  const visible = capped && !showAll ? toolCalls.slice(0, TOOL_CALL_VISIBLE_CAP) : toolCalls;
  const hiddenCount = toolCalls.length - visible.length;

  if (compact) {
    return (
      <div className="sess-tool-compact">
        {visible.map((tool) => (
          <ToolCallRow key={tool.id} tool={tool} agent={agent} compact />
        ))}
        {capped && (
          <button type="button" className="sess-tool-more" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "Show fewer"
              : `Show ${hiddenCount} more tool call${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <ToolCallRow key={tool.id} tool={tool} agent={agent} />
      ))}
    </div>
  );
}

function ToolCallRow({
  tool,
  agent,
  compact = false,
}: {
  tool: ToolCall;
  agent?: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { navigateToSession } = useSessionNav();
  const completed = tool.status === "completed";
  const statusColor = completed ? "text-emerald-400" : "text-amber-400";
  const summary = getToolSummary(tool, agent);

  const isTask = tool.name === "task";
  let childSessionId: string | null = null;
  if (isTask && tool.metadata) {
    try {
      const meta = JSON.parse(tool.metadata);
      childSessionId = meta.sessionId || null;
    } catch {
      /* ignore */
    }
  }

  const rowClass = compact
    ? "sess-tool-compact-row"
    : "flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors";

  const wrapperClass = compact
    ? ""
    : "border border-gh-border rounded-lg overflow-hidden bg-gh-bg-secondary/50";

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
          <span className={`text-[10px] ${statusColor} font-bold shrink-0`}>
            {completed ? "\u2713" : "\u2022"}
          </span>
          <span className="font-mono text-[11px] truncate flex-1 min-w-0 text-gh-text">
            {summary}
          </span>
          {!compact && tool.duration && tool.duration > 0 ? (
            <span className="text-[10px] text-gh-text-secondary shrink-0">
              {tool.duration < 1000
                ? `${tool.duration}ms`
                : `${(tool.duration / 1000).toFixed(1)}s`}
            </span>
          ) : null}
        </button>
        {isTask && childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[10px] font-medium text-accent hover:text-accent-secondary hover:bg-gh-bg-hover cursor-pointer transition-colors"
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

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        {isLong && (
          <button
            type="button"
            className="text-[10px] text-accent hover:text-accent-secondary cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "collapse" : `expand (${(content.length / 1024).toFixed(1)}kb)`}
          </button>
        )}
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[10px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}
