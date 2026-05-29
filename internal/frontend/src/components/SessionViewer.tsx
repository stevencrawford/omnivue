import { useCallback, useEffect, useState } from "react";
import type { Session, Message } from "../hooks/useApi";
import { fetchMessages } from "../hooks/useApi";
import { relativeTime, formatCost } from "../utils/buildTree";

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

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
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
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "session" && (
          <ConversationView messages={messages} loading={loading} />
        )}
        {activeTab === "plan" && (
          <div className="text-sm text-gh-text-secondary italic">
            Plan view coming in Phase 3
          </div>
        )}
        {activeTab === "diff" && (
          <div className="text-sm text-gh-text-secondary italic">
            Diff view coming in Phase 3
          </div>
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
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold uppercase">
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
            {session.diffFiles} files (+{session.diffAdditions} -{session.diffDeletions})
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
    return <div className="text-sm text-gh-text-secondary">Loading messages...</div>;
  }

  if (messages.length === 0) {
    return <div className="text-sm text-gh-text-secondary">No messages in this session</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`rounded-lg p-3 ${isUser ? "bg-blue-500/10 border border-blue-500/20" : "bg-gh-bg-sidebar border border-gh-border"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-bold uppercase ${isUser ? "text-blue-400" : "text-green-400"}`}>
          {message.role}
        </span>
        {message.agent && (
          <span className="text-[10px] text-gh-text-secondary">{message.agent}</span>
        )}
        <span className="text-[10px] text-gh-text-secondary ml-auto">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {message.content && (
        <div className="text-sm text-gh-text whitespace-pre-wrap break-words">
          {message.content.length > 2000
            ? message.content.slice(0, 2000) + "..."
            : message.content}
        </div>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-2 space-y-1">
          {message.toolCalls.map((tool) => (
            <div key={tool.id} className="border border-gh-border rounded">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-2 py-1 text-left cursor-pointer hover:bg-gh-bg-hover"
                onClick={() => toggleTool(tool.id)}
              >
                <svg
                  className={`size-3 transition-transform ${expandedTools.has(tool.id) ? "rotate-90" : ""}`}
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className="text-[11px] font-mono text-gh-text-secondary">
                  {tool.name}
                </span>
                <span className={`text-[10px] ml-auto ${tool.status === "completed" ? "text-green-400" : "text-red-400"}`}>
                  {tool.status}
                </span>
              </button>
              {expandedTools.has(tool.id) && (
                <div className="px-2 py-1 border-t border-gh-border text-[11px] font-mono">
                  {tool.input && (
                    <div className="mb-1">
                      <span className="text-gh-text-secondary">Input: </span>
                      <pre className="mt-0.5 p-1 bg-gh-bg rounded overflow-x-auto text-[10px] max-h-40 overflow-y-auto">
                        {tool.input.length > 1000 ? tool.input.slice(0, 1000) + "..." : tool.input}
                      </pre>
                    </div>
                  )}
                  {tool.output && (
                    <div>
                      <span className="text-gh-text-secondary">Output: </span>
                      <pre className="mt-0.5 p-1 bg-gh-bg rounded overflow-x-auto text-[10px] max-h-40 overflow-y-auto">
                        {tool.output.length > 1000 ? tool.output.slice(0, 1000) + "..." : tool.output}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
