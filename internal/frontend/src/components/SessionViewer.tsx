import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, Message, ToolCall } from "../hooks/useApi";
import { fetchMessages } from "../hooks/useApi";
import { relativeTime, formatCost } from "../utils/buildTree";
import { MarkdownContent } from "./MarkdownContent";
import { PlanView } from "./PlanView";
import { DiffView } from "./DiffView";

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
      <div className="flex border-b border-gh-border px-4 bg-gh-bg-sidebar">
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
      <div className="flex-1 overflow-y-auto">
        {activeTab === "session" && (
          <ConversationView messages={messages} loading={loading} />
        )}
        {activeTab === "plan" && (
          <PlanView sessionId={session.id} />
        )}
        {activeTab === "diff" && (
          <DiffView sessionId={session.id} />
        )}
      </div>
    </div>
  );
}

function SessionHeader({ session }: { session: Session }) {
  const totalTokens = session.tokensInput + session.tokensOutput;
  return (
    <div className="px-4 py-3 border-b border-gh-border bg-gh-bg-sidebar">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-gh-text truncate">
          {session.title || session.id}
        </h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold uppercase shrink-0">
          {session.agent}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gh-text-secondary">
        <span title="Repository">{session.repository}</span>
        {session.branch && <span title="Branch">@{session.branch}</span>}
        {session.model && (
          <span className="px-1.5 py-0.5 rounded bg-gh-bg-hover" title="Model">
            {session.model}
          </span>
        )}
        {session.cost > 0 && <span title="Cost">{formatCost(session.cost)}</span>}
        {totalTokens > 0 && (
          <span title="Tokens">
            {(totalTokens / 1000).toFixed(0)}k tokens
          </span>
        )}
        {session.diffFiles > 0 && (
          <span title="Files changed">
            {session.diffFiles} files
            <span className="text-green-500 ml-1">+{session.diffAdditions}</span>
            <span className="text-red-500 ml-0.5">-{session.diffDeletions}</span>
          </span>
        )}
        <span title="Last updated">{relativeTime(session.updatedAt)}</span>
      </div>
      <div className="text-[10px] text-gh-text-secondary mt-1 truncate" title={session.directory}>
        {session.directory}
      </div>
    </div>
  );
}

function ConversationView({ messages, loading }: { messages: Message[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-pulse text-sm text-gh-text-secondary">
          Loading conversation...
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gh-text-secondary">
        No messages in this session
      </div>
    );
  }

  return (
    <div className="divide-y divide-gh-border">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const [expanded, setExpanded] = useState(true);
  const isLong = message.content.length > 3000;

  // Collapse assistant messages with only tool calls and no text content
  const isToolOnly = !isUser && !message.content && message.toolCalls && message.toolCalls.length > 0;

  return (
    <div className={`px-4 py-3 ${isUser ? "bg-blue-500/5" : isSystem ? "bg-yellow-500/5" : ""}`}>
      {/* Message header */}
      <div className="flex items-center gap-2 mb-2">
        <RoleIcon role={message.role} />
        <span className={`text-xs font-semibold ${isUser ? "text-blue-400" : isSystem ? "text-yellow-400" : "text-green-400"}`}>
          {message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : "System"}
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
        {(message.tokensInput || message.tokensOutput) ? (
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

      {/* Content */}
      {message.content && (
        <div className="ml-6">
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

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="ml-6 mt-2">
          {isToolOnly && !message.content && (
            <div className="text-[11px] text-gh-text-secondary mb-1">
              {message.toolCalls.length} tool {message.toolCalls.length === 1 ? "call" : "calls"}
            </div>
          )}
          <ToolCallList toolCalls={message.toolCalls} />
        </div>
      )}
    </div>
  );
}

function UserContent({ content, expanded, isLong }: { content: string; expanded: boolean; isLong: boolean }) {
  const displayContent = !expanded && isLong ? content.slice(0, 3000) + "\n\n..." : content;
  return (
    <div className="text-sm text-gh-text whitespace-pre-wrap break-words leading-relaxed">
      {displayContent}
    </div>
  );
}

function AssistantContent({ content, expanded, isLong }: { content: string; expanded: boolean; isLong: boolean }) {
  const displayContent = !expanded && isLong ? content.slice(0, 3000) + "\n\n..." : content;
  return <MarkdownContent content={displayContent} />;
}

function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <ToolCallItem key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = tool.status === "completed" ? "text-green-400" : tool.status === "failed" ? "text-red-400" : "text-yellow-400";
  const statusIcon = tool.status === "completed" ? "\u2713" : tool.status === "failed" ? "\u2717" : "\u2022";

  return (
    <div className="border border-gh-border rounded-md overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`size-3 text-gh-text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-[11px] font-mono text-gh-text font-medium">
          {tool.name}
        </span>
        <span className={`text-[10px] ml-auto ${statusColor}`}>
          {statusIcon} {tool.status}
        </span>
        {tool.duration && tool.duration > 0 && (
          <span className="text-[10px] text-gh-text-secondary">
            {tool.duration < 1000 ? `${tool.duration}ms` : `${(tool.duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-gh-border px-2.5 py-2 space-y-2 bg-gh-bg-secondary/50">
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

  // Try to pretty-print JSON
  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted = !expanded && isLong
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
  // Shorten common model prefixes
  return model
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("github-copilot/", "");
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
