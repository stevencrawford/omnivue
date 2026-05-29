import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import { fetchMessages, fetchResumeCommand } from "../hooks/useApi";
import { formatCost } from "../utils/buildTree";
import { MarkdownContent } from "./MarkdownContent";
import { PlanView } from "./PlanView";
import { DiffView } from "./DiffView";
import { useSessionNav } from "../hooks/useNav";

interface SessionViewerProps {
  session: Session;
}

type Tab = "session" | "plan" | "diff";

export function SessionViewer({ session }: SessionViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("session");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMessages(session.id);
      setMessages(data || []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const messageCount = useMemo(() => {
    const user = messages.filter((m) => m.role === "user").length;
    const assistant = messages.filter((m) => m.role === "assistant").length;
    return { user, assistant, total: messages.length };
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <SessionHeader session={session} />

      {/* Tab bar */}
      <div className="flex border-b border-gh-border px-4 bg-gh-bg-sidebar shrink-0">
        {(["session", "plan", "diff"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-blue-500 text-gh-text"
                : "border-transparent text-gh-text-secondary hover:text-gh-text"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "session" && messageCount.total > 0 && (
              <span className="ml-1.5 text-[10px] text-gh-text-secondary">
                ({messageCount.total})
              </span>
            )}
          </button>
        ))}
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
    </div>
  );
}

function SessionHeader({ session }: { session: Session }) {
  return (
    <div className="px-4 py-2 border-b border-gh-border bg-gh-bg-sidebar shrink-0">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gh-text truncate">
          {session.title || session.id}
        </h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold uppercase shrink-0">
          {session.agent}
        </span>
        <span className="text-[10px] text-gh-text-secondary ml-auto" title={session.directory}>
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
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="inline-block animate-pulse text-sm text-gh-text-secondary">
          Loading conversation...
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gh-text-secondary">
        No messages in this session
      </div>
    );
  }

  const firstMessage = messages[0];
  const restMessages = messages.slice(1);

  // Group consecutive assistant messages that are tool-only (no text content)
  const groupedMessages = groupAssistantMessages(restMessages);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Scrollable conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="divide-y divide-gh-border">
          {groupedMessages.map((msg) => (
            <MessageBubble key={isGrouped(msg) ? msg.groupId : msg.id} message={msg} />
          ))}
        </div>
      </div>

      {/* Pinned user prompt at bottom */}
      <div className="pinned-prompt bg-gh-bg-sidebar">
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
          <svg className="size-4 text-blue-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm5 6a5 5 0 0 0-10 0h10Z" />
          </svg>
          <span className="text-xs font-semibold text-gh-text">User Prompt</span>
          {session.model && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg-hover text-gh-text-secondary font-mono">
              {session.model}
            </span>
          )}
          <span className="text-[10px] text-purple-400 font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/20">
            {session.agent}
          </span>

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
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border cursor-pointer transition-colors ml-auto shrink-0 ${
              copied
                ? "border-green-500/40 bg-green-500/10 text-green-400"
                : "border-gh-border bg-gh-bg hover:bg-gh-bg-hover text-gh-text-secondary hover:text-gh-text"
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
          <div className="px-4 pb-3 max-h-content border-t border-gh-border">
            <div className="ml-6 mt-2">
              <UserPromptBubble message={firstMessage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Group consecutive assistant messages ---

type DisplayMessage =
  | Message
  | {
      groupId: string;
      messages: Message[];
      role: "assistant";
      content: "";
      toolCalls: ToolCall[];
      timestamp: string;
      model?: string;
      agent?: string;
      id: string;
      tokensInput?: number;
      tokensOutput?: number;
    };

function isGrouped(msg: DisplayMessage): msg is {
  groupId: string;
  messages: Message[];
  role: "assistant";
  content: "";
  toolCalls: ToolCall[];
  timestamp: string;
  model?: string;
  agent?: string;
  id: string;
  tokensInput?: number;
  tokensOutput?: number;
} {
  return "groupId" in msg;
}

function groupAssistantMessages(messages: Message[]): DisplayMessage[] {
  if (messages.length === 0) return [];

  const result: DisplayMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // If this is an assistant message with tool calls but no text content
    // look ahead to group consecutive similar messages
    if (msg.role === "assistant" && !msg.content && msg.toolCalls && msg.toolCalls.length > 0) {
      const group: Message[] = [msg];
      let j = i + 1;
      while (j < messages.length) {
        const next = messages[j];
        if (
          next.role === "assistant" &&
          !next.content &&
          next.toolCalls &&
          next.toolCalls.length > 0
        ) {
          group.push(next);
          j++;
        } else {
          break;
        }
      }

      if (group.length > 1) {
        const allCalls = group.flatMap((m) => m.toolCalls || []);
        result.push({
          groupId: `group-${i}`,
          messages: group,
          role: "assistant",
          content: "",
          toolCalls: allCalls,
          timestamp: group[0].timestamp,
          model: group[0].model,
          agent: group[0].agent,
          id: group[0].id,
          tokensInput: group.reduce((s, m) => s + (m.tokensInput || 0), 0),
          tokensOutput: group.reduce((s, m) => s + (m.tokensOutput || 0), 0),
        });
        i = j;
        continue;
      }
    }

    result.push(msg);
    i++;
  }

  return result;
}

// --- User Prompt Bubble ---

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
          className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// --- Message Bubble ---

function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistantGroup = isGrouped(message);
  const [expanded, setExpanded] = useState(true);
  const [groupExpanded, setGroupExpanded] = useState(false);
  const isLong = message.content.length > 3000;

  return (
    <div className={`px-4 py-3 ${isUser ? "bg-blue-500/5" : isSystem ? "bg-yellow-500/5" : ""}`}>
      {/* Assistant group header */}
      {isAssistantGroup && (
        <div className="flex items-center gap-2 mb-2">
          <svg className="size-4 text-green-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM5.5 10.5a2.5 2.5 0 0 1 5 0v.5h-5v-.5Z" />
          </svg>
          <span className="text-xs font-semibold text-green-400">Assistant</span>
          <span className="text-[10px] text-gh-text-secondary">
            {message.messages!.length} grouped messages
          </span>
          <button
            type="button"
            className="ml-auto text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
            onClick={() => setGroupExpanded(!groupExpanded)}
          >
            {groupExpanded ? "Collapse all" : "Show all"}
          </button>
        </div>
      )}

      {/* Regular message header */}
      {!isAssistantGroup && (
        <div className="flex items-center gap-2 mb-2">
          <RoleIcon role={message.role} />
          <span
            className={`text-xs font-semibold ${isUser ? "text-blue-400" : isSystem ? "text-yellow-400" : "text-green-400"}`}
          >
            {message.role === "assistant"
              ? "Assistant"
              : message.role === "user"
                ? "You"
                : "System"}
          </span>
          {message.model && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg-hover text-gh-text-secondary font-mono">
              {truncateModel(message.model)}
            </span>
          )}
          {message.agent && message.agent !== "main" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
              {message.agent}
            </span>
          )}
          {message.tokensInput || message.tokensOutput ? (
            <span className="text-[10px] text-gh-text-secondary ml-auto">
              {message.tokensInput ? `${(message.tokensInput / 1000).toFixed(1)}k in` : ""}
              {message.tokensInput && message.tokensOutput ? " / " : ""}
              {message.tokensOutput ? `${(message.tokensOutput / 1000).toFixed(1)}k out` : ""}
            </span>
          ) : null}
          <span className="text-[10px] text-gh-text-secondary ml-auto">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
      )}

      {/* Content (not for assistant groups) */}
      {!isAssistantGroup && message.content && (
        <div className="ml-6 max-h-content">
          {isUser ? (
            <UserContent content={message.content} expanded={expanded} isLong={isLong} />
          ) : (
            <AssistantContent content={message.content} expanded={expanded} isLong={isLong} />
          )}
          {isLong && (
            <button
              type="button"
              className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {/* Tool calls (from single message or grouped) */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="ml-6 mt-2">
          <ToolCallList toolCalls={message.toolCalls} agent={message.agent} />
        </div>
      )}

      {/* Expanded group sub-messages */}
      {isAssistantGroup && groupExpanded && (
        <div className="ml-6 mt-2 border border-gh-border rounded-md divide-y divide-gh-border">
          {message.messages!.map((subMsg) => (
            <div key={subMsg.id} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-gh-text-secondary">
                  {formatTimestamp(subMsg.timestamp)}
                </span>
                {subMsg.model && (
                  <span className="text-[10px] text-gh-text-secondary font-mono">
                    {subMsg.model}
                  </span>
                )}
              </div>
              {subMsg.toolCalls && subMsg.toolCalls.length > 0 && (
                <ToolCallList toolCalls={subMsg.toolCalls} agent={subMsg.agent} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Content renderers ---

function UserContent({
  content,
  expanded,
  isLong,
}: {
  content: string;
  expanded: boolean;
  isLong: boolean;
}) {
  const displayContent = !expanded && isLong ? content.slice(0, 3000) + "\n\n..." : content;
  return (
    <div className="text-sm text-gh-text whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
      {displayContent}
    </div>
  );
}

function AssistantContent({
  content,
  expanded,
  isLong,
}: {
  content: string;
  expanded: boolean;
  isLong: boolean;
}) {
  const displayContent = !expanded && isLong ? content.slice(0, 3000) + "\n\n..." : content;
  return <MarkdownContent content={displayContent} />;
}

// --- Tool call rendering ---

interface ToolCallGroup {
  name: string;
  calls: ToolCall[];
}

function groupToolCalls(toolCalls: ToolCall[]): ToolCallGroup[] {
  if (toolCalls.length === 0) return [];
  const groups: ToolCallGroup[] = [];
  let current: ToolCallGroup = { name: toolCalls[0].name, calls: [toolCalls[0]] };
  for (let i = 1; i < toolCalls.length; i++) {
    if (toolCalls[i].name === current.name) {
      current.calls.push(toolCalls[i]);
    } else {
      groups.push(current);
      current = { name: toolCalls[i].name, calls: [toolCalls[i]] };
    }
  }
  groups.push(current);
  return groups;
}

function ToolCallList({ toolCalls, agent }: { toolCalls: ToolCall[]; agent?: string }) {
  const groups = useMemo(() => groupToolCalls(toolCalls), [toolCalls]);

  return (
    <div className="space-y-1">
      {groups.map((group, i) => (
        <ToolCallGroupItem key={`${group.name}-${i}`} group={group} agent={agent} />
      ))}
    </div>
  );
}

function ToolCallGroupItem({ group, agent }: { group: ToolCallGroup; agent?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { navigateToSession } = useSessionNav();
  const first = group.calls[0];
  const allCompleted = group.calls.every((tc) => tc.status === "completed");
  const statusColor = allCompleted ? "text-green-400" : "text-yellow-400";
  const summary = getToolSummary(first, agent);

  // Extract child session ID from task metadata
  const isTask = first.name === "task";
  let childSessionId: string | null = null;
  if (isTask && first.metadata) {
    try {
      const meta = JSON.parse(first.metadata);
      childSessionId = meta.sessionId || null;
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border border-gh-border rounded-md overflow-hidden">
      <div className="flex items-center w-full">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            className={`size-3 text-gh-text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span className={`text-[10px] ${statusColor} font-bold`}>
            {allCompleted ? "\u2713" : "\u2022"}
          </span>
          <span className="text-[11px] font-mono text-gh-text font-medium truncate">{summary}</span>
          {group.calls.length > 1 && (
            <span className="text-[10px] px-1 rounded bg-gh-bg-hover text-gh-text-secondary shrink-0">
              {group.calls.length}
            </span>
          )}
          <span className={`text-[10px] shrink-0 ${statusColor}`}>{first.status}</span>
          {first.duration && first.duration > 0 && (
            <span className="text-[10px] text-gh-text-secondary shrink-0">
              {first.duration < 1000
                ? `${first.duration}ms`
                : `${(first.duration / 1000).toFixed(1)}s`}
            </span>
          )}
        </button>
        {isTask && childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[10px] font-medium text-blue-400 hover:text-blue-300 hover:bg-gh-bg-hover cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId!);
            }}
          >
            View ▶
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-gh-border divide-y divide-gh-border">
          {group.calls.map((tc) => (
            <ToolCallDetail key={tc.id} tool={tc} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallDetail({ tool, agent }: { tool: ToolCall; agent?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] font-mono text-gh-text-secondary">{tool.name}</span>
        <span className="text-[10px] text-gh-text-secondary truncate">
          {toolDetailPreview(tool, agent)}
        </span>
        <span className="ml-auto text-[10px] text-gh-text-secondary">
          {expanded
            ? "collapse"
            : tool.input.length > 500
              ? `expand (${(tool.input.length / 1024).toFixed(1)}kb)`
              : "details"}
        </span>
      </button>
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
            className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
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

// --- Tool call summarization ---

function getToolSummary(tool: ToolCall, agent?: string): string {
  if (agent === "opencode") {
    if (tool.name === "task") {
      const desc = extractJSONField(tool.input, "description") || "";
      return `\u{1F4CB} ${desc.slice(0, 60)}`;
    }
    if (tool.name === "todowrite") {
      const content =
        extractJSONField(tool.input, "content") || extractJSONField(tool.input, "text") || "";
      const status = extractJSONField(tool.input, "status") || "pending";
      const check = status === "completed" ? "\u2713" : "\u25CB";
      return `${check} ${content.slice(0, 60)}`;
    }
  }
  return getDefaultToolSummary(tool);
}

function getDefaultToolSummary(tool: ToolCall): string {
  const name = tool.name;
  const input = tool.input;

  if (name === "edit" || name === "write" || name === "read") {
    const fp =
      extractJSONField(input, "filePath") ||
      extractJSONField(input, "file_path") ||
      extractJSONField(input, "path") ||
      "";
    if (fp) return `${name}: ${fp}`;
  }

  if (name === "bash" || name === "command") {
    const cmd = extractJSONField(input, "command") || "";
    if (cmd) return `bash: ${cmd.slice(0, 60)}`;
    return "bash";
  }

  if (name === "search" || name === "grep") {
    const pattern = extractJSONField(input, "pattern") || extractJSONField(input, "query") || "";
    if (pattern) return `grep: ${pattern.slice(0, 60)}`;
  }

  if (name === "tool") {
    const toolName = extractJSONField(input, "name") || "";
    if (toolName) return `tool: ${toolName}`;
  }

  return name;
}

function toolDetailPreview(tool: ToolCall, agent?: string): string {
  if (agent === "opencode") {
    if (tool.name === "task") {
      const desc = extractJSONField(tool.input, "description") || "";
      return desc.slice(0, 80);
    }
    if (tool.name === "todowrite") {
      const content = extractJSONField(tool.input, "content") || "";
      return content.slice(0, 80);
    }
  }
  return getDefaultToolSummary(tool);
}

function extractJSONField(jsonStr: string, field: string): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    const val = parsed[field];
    if (typeof val === "string" && val) return val;
    if (typeof val === "number") return String(val);
    return null;
  } catch {
    return null;
  }
}

// --- Helpers ---

function RoleIcon({ role }: { role: string }) {
  if (role === "user") {
    return (
      <svg className="size-4 text-blue-400" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm5 6a5 5 0 0 0-10 0h10Z" />
      </svg>
    );
  }
  if (role === "assistant") {
    return (
      <svg className="size-4 text-green-400" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM5.5 10.5a2.5 2.5 0 0 1 5 0v.5h-5v-.5Z" />
      </svg>
    );
  }
  return (
    <svg className="size-4 text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0V5Zm.75 6.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
  );
}

function truncateModel(model: string): string {
  return model.replace("anthropic/", "").replace("openai/", "").replace("github-copilot/", "");
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}
