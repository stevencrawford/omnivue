import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Message, ToolCall } from "../../../hooks/types";
import { fetchMessages } from "../../../hooks/apiClient";
import { MarkdownContent } from "../../ui/MarkdownContent";
import { Spinner } from "../../ui/Spinner";
import { effectiveToolKind } from "../../../utils/toolDisplay";
import { toolRendererRegistry } from "../registry";
import { ToolRendererWrapper } from "../ToolRendererWrapper";
import { DefaultToolDiff } from "./DefaultToolDiff";
import type { ToolRendererDefinition } from "../types";

const fallbackRenderer: ToolRendererDefinition = {
  kind: "unknown",
  names: [],
  Component: DefaultToolDiff,
  display: { type: "expandable" },
};

function ToolCallInline({ tool }: { tool: ToolCall }) {
  const kind = effectiveToolKind(tool);
  const renderer = toolRendererRegistry.getRenderer(kind) ?? fallbackRenderer;
  // For transcript we render detail inline without extra outer chrome when possible;
  // ToolRendererWrapper already handles truncation and chrome.
  return <ToolRendererWrapper renderer={renderer} tool={tool} variant="detail" />;
}

export function SubAgentTranscript({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchMessages(sessionId, ac.signal)
      .then((msgs) => {
        if (!ac.signal.aborted) setMessages(msgs);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-ov-text-secondary">
        <Spinner />
        Loading sub-agent transcript…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-3 py-2 text-xs text-red-400">
        Failed to load sub-agent transcript: {error}
      </div>
    );
  }
  if (!messages || messages.length === 0) {
    return <div className="px-3 py-2 text-xs text-ov-text-secondary">No sub-agent output</div>;
  }

  // Skip the first message if it's the initial user prompt echoed from parent (firstMessage pattern in ConversationView)
  // Keep all but filter empty.
  const filtered = messages.filter(
    (m) =>
      (m.content && m.content.trim()) || (m.toolCalls && m.toolCalls.length > 0) || m.reasoning,
  );

  return (
    <div className="divide-y divide-ov-border/30">
      {filtered.map((msg) => (
        <div key={msg.id} className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`text-[10px] font-mono px-1 py-0.5 rounded border ${
                msg.role === "assistant"
                  ? "bg-violet-500/10 border-violet-500/20 text-violet-400"
                  : msg.role === "user"
                    ? "bg-ov-bg-secondary border-ov-border text-ov-text-secondary"
                    : "bg-ov-bg-secondary border-ov-border text-ov-text-secondary"
              }`}
            >
              {msg.role}
            </span>
            {msg.agent && msg.agent !== "main" && (
              <span className="text-[10px] text-ov-text-secondary">{msg.agent}</span>
            )}
            <span className="text-[10px] text-ov-text-secondary/60">
              {new Date(msg.timestamp).toLocaleString()}
            </span>
          </div>
          {msg.reasoning && (
            <div className="mb-2 pl-2 border-l-2 border-accent-muted">
              <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
                {msg.reasoning}
              </div>
            </div>
          )}
          {msg.content && msg.content.trim() && (
            <MarkdownContent content={msg.content} className="markdown-body--small" />
          )}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="mt-2 space-y-1">
              {msg.toolCalls.map((tc) => (
                <div key={tc.id}>
                  <ToolCallInline tool={tc} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SubAgentTranscriptToggle({
  sessionId,
  defaultOpen = false,
}: {
  sessionId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-violet-500/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono text-violet-400 hover:text-violet-300 hover:bg-violet-500/5 transition-colors cursor-pointer text-left"
      >
        <ChevronRight
          size={12}
          className={`transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
        />
        <span className="font-medium">Sub-agent transcript</span>
        <span className="text-violet-400/60">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-violet-500/20 bg-ov-bg-secondary/30">
          <SubAgentTranscript sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}
