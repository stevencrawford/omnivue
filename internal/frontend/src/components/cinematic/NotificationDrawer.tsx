import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Brain, ChevronRight, User as UserIcon } from "lucide-react";
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
  onOpenModal?: (content: string, title?: string) => void;
}

function ThinkingBlock({
  reasoning,
  defaultExpanded,
}: {
  reasoning: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
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

export function NotificationDrawer({
  session,
  messages,
  cursor,
  maxIndex,
  onOpenModal,
}: NotificationDrawerProps) {
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
    const reasoningMap = new Map<string, string>();
    let pendingReasoning: string | null = null;
    let pendingKey: string | null = null;
    const flushReasoning = () => {
      if (pendingReasoning !== null && pendingKey !== null) {
        const key = pendingKey;
        const reasoning = pendingReasoning;
        reasoningMap.set(`${key}-reasoning`, reasoning);
        items.push({
          key: `${key}-reasoning`,
          node: <ThinkingBlock reasoning={reasoning} />,
        });
      }
      pendingReasoning = null;
      pendingKey = null;
    };
    for (const msg of visibleMessages) {
      if (msg.role === "user") {
        flushReasoning();
        if (msg.content?.trim()) {
          items.push({
            key: `${msg.id}-user`,
            node: (
              <div className="px-3 py-2 border border-blue-500/20 rounded bg-blue-500/[0.04]">
                <div className="flex items-center gap-1.5 mb-1">
                  <UserIcon size={12} className="text-blue-400" />
                  <span className="text-[11px] font-semibold text-blue-400">User</span>
                </div>
                <MarkdownContent
                  content={msg.content}
                  className="markdown-body--wide text-xs"
                  onOpenModal={
                    msg.content.length > 100 && onOpenModal
                      ? () => onOpenModal(msg.content, "User message")
                      : undefined
                  }
                />
              </div>
            ),
          });
        }
        continue;
      }
      if (msg.reasoning) {
        if (pendingReasoning === null) {
          pendingReasoning = msg.reasoning;
          pendingKey = msg.id;
        } else {
          pendingReasoning += "\n\n" + msg.reasoning;
        }
      } else {
        flushReasoning();
      }
      if (msg.content?.trim()) {
        flushReasoning();
        const isLong = msg.content.length > 100;
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
              <MarkdownContent
                content={msg.content}
                className="markdown-body--wide text-xs"
                onOpenModal={
                  isLong && onOpenModal
                    ? () => onOpenModal(msg.content, "Assistant message")
                    : undefined
                }
              />
            </div>
          ),
        });
      }
      let hasVisibleTool = false;
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
            "todowrite",
          ].includes(kind)
        )
          continue;
        hasVisibleTool = true;
        const renderer = toolRendererRegistry.getRenderer(kind);
        if (!renderer) continue;
        // Flush reasoning before tool so tool breaks sequential chain
        flushReasoning();
        items.push({
          key: tool.id,
          node: <ToolRendererWrapper renderer={renderer} tool={tool} variant="detail" />,
        });
      }
      // If message had reasoning but also visible tool, flush already done; if it had reasoning and no content/tool, keep pending for next iteration to allow collapse
      if (msg.content?.trim() || hasVisibleTool) {
        // already flushed
      } else if (!msg.reasoning) {
        flushReasoning();
      }
    }
    flushReasoning();
    // Latest thinking should be expanded while session is active
    if (session.status === "active") {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].key.endsWith("-reasoning")) {
          const key = items[i].key;
          const reasoning = reasoningMap.get(key);
          if (reasoning) {
            items[i] = {
              key,
              node: <ThinkingBlock reasoning={reasoning} defaultExpanded />,
            };
          }
          break;
        }
      }
    }
    return items;
  }, [visibleMessages, session.status, onOpenModal]);

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
