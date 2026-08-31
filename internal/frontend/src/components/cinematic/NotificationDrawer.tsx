import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Brain, ChevronRight } from "lucide-react";
import type { Message } from "../../hooks/types";
import { effectiveToolKind } from "../../utils/toolDisplay";
import { MarkdownContent } from "../ui/MarkdownContent";
import type { Session } from "../../hooks/types";
import { ToolRendererWrapper } from "../tool-renderers/ToolRendererWrapper";
import { toolRendererRegistry } from "../tool-renderers/registry";

interface NotificationDrawerProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
}

function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning) return null;
  return (
    <div className="border border-violet-500/20 rounded overflow-hidden bg-violet-500/[0.04]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-violet-300 hover:text-violet-200 cursor-pointer hover:bg-violet-500/10 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <Brain size={12} className="shrink-0" />
        <span className="font-medium">Thinking</span>
        <span className="ml-auto text-[10px] text-violet-300/60">
          {reasoning.length > 80
            ? `${Math.round(reasoning.length / 1000)}k`
            : `${reasoning.split(/\s+/).length}w`}
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-violet-500/15 bg-violet-500/[0.03] max-h-64 overflow-y-auto">
          <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationDrawer({ messages, cursor, maxIndex }: NotificationDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleMessages = useMemo(() => {
    let eventIdx = 0;
    const out: Message[] = [];
    for (const msg of messages) {
      const isUser = msg.role === "user";
      const msgEvents = isUser ? 1 : msg.toolCalls?.length ? msg.toolCalls.length : 1;
      const msgEnd = eventIdx + msgEvents - 1;
      const visible = msgEnd <= cursor || cursor >= maxIndex;
      if (visible) out.push(msg);
      eventIdx += msgEvents;
    }
    return out;
  }, [messages, cursor, maxIndex]);

  const drawerItems = useMemo(() => {
    const items: Array<{ key: string; node: React.ReactNode }> = [];
    for (const msg of visibleMessages) {
      if (msg.role === "user") continue;
      if (msg.reasoning) {
        items.push({
          key: `${msg.id}-reasoning`,
          node: <ThinkingBlock reasoning={msg.reasoning} />,
        });
      }
      if (msg.content?.trim()) {
        items.push({
          key: `${msg.id}-content`,
          node: (
            <div className="px-3 py-2 border border-ov-border rounded bg-ov-bg-secondary/40">
              <div className="flex items-center gap-1.5 mb-1">
                <MessageSquare size={12} className="text-ov-text-secondary" />
                <span className="text-[11px] font-semibold text-ov-text-secondary">Assistant</span>
                {msg.model && (
                  <span className="text-[10px] font-mono bg-ov-bg-hover px-1 py-0.5 rounded text-ov-text-secondary">
                    {msg.model}
                  </span>
                )}
              </div>
              <MarkdownContent content={msg.content} className="markdown-body--wide text-xs" />
            </div>
          ),
        });
      }
      for (const tool of msg.toolCalls ?? []) {
        const kind = effectiveToolKind(tool);
        if (
          ![
            "question",
            "task_complete",
            "exit_plan_mode",
            "task",
            "skill",
            "compaction",
            "permission_request",
            "store_memory",
          ].includes(kind)
        )
          continue;
        const renderer = toolRendererRegistry.getRenderer(kind);
        if (!renderer) continue;
        items.push({
          key: tool.id,
          node: <ToolRendererWrapper renderer={renderer} tool={tool} variant="detail" />,
        });
      }
    }
    return items;
  }, [visibleMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages, cursor, maxIndex]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ov-bg">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {drawerItems.length === 0 ? (
          <div className="text-xs text-ov-text-secondary text-center py-6">
            Assistant activity appears here
          </div>
        ) : (
          drawerItems.map((it) => <div key={it.key}>{it.node}</div>)
        )}
      </div>
    </div>
  );
}
