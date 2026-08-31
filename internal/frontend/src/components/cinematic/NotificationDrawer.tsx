import { useMemo } from "react";
import { FileText, MessageSquare, Brain, ChevronRight } from "lucide-react";
import type { Message, Plan } from "../../hooks/types";
import { effectiveToolKind } from "../../utils/toolDisplay";
import { MarkdownContent } from "../ui/MarkdownContent";
import { PinnedPromptBar } from "../PinnedPromptBar";
import type { Session } from "../../hooks/types";
import { ToolRendererWrapper } from "../tool-renderers/ToolRendererWrapper";
import { toolRendererRegistry } from "../tool-renderers/registry";

interface NotificationDrawerProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
  plan: Plan | null;
  planLoading: boolean;
  onTogglePlan: () => void;
  planOpen: boolean;
  firstMessage?: Message | null;
  onOpenModal?: (content: string, title?: string) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}

export function NotificationDrawer({
  session,
  messages,
  cursor,
  maxIndex,
  plan,
  planLoading,
  onTogglePlan,
  planOpen,
  firstMessage,
  onOpenModal,
  onQueueChanged,
  highlightPromptId,
  onHighlightDone,
}: NotificationDrawerProps) {
  const visibleMessages = useMemo(() => {
    let eventIdx = 0;
    const out: Message[] = [];
    for (const msg of messages) {
      // User messages count as 1 event; assistant with tools counts per tool
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
          node: (
            <div className="px-3 py-2 border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r">
              <div className="flex items-center gap-1.5 mb-1">
                <Brain size={12} className="text-violet-400" />
                <span className="text-[11px] font-semibold text-violet-400">Thinking</span>
              </div>
              <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                {msg.reasoning}
              </div>
            </div>
          ),
        });
      }
      if (msg.content?.trim()) {
        // avoid duplicate header when toolCalls already have content? show always
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

  return (
    <div className="w-[360px] shrink-0 border-l border-ov-border bg-ov-bg flex flex-col overflow-hidden">
      <button
        type="button"
        onClick={onTogglePlan}
        className={`flex items-center gap-2 px-3 py-2 border-b border-ov-border text-left shrink-0 cursor-pointer hover:bg-ov-bg-hover transition-colors ${planOpen ? "bg-accent-muted text-accent" : "bg-surface-elevated text-ov-text"}`}
        title={plan ? "Toggle plan drawer" : "No plan yet"}
      >
        <FileText size={14} className={plan ? "text-amber-400" : "text-ov-text-secondary"} />
        <span className="text-xs font-semibold">Plan</span>
        <span className="text-[11px] text-ov-text-secondary">
          {planLoading ? "loading…" : plan?.markdown ? plan.source : "none yet"}
        </span>
        <ChevronRight
          size={12}
          className={`ml-auto transition-transform ${planOpen ? "rotate-90" : ""}`}
        />
      </button>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {drawerItems.length === 0 ? (
          <div className="text-xs text-ov-text-secondary text-center py-6">
            Assistant activity appears here
          </div>
        ) : (
          drawerItems.map((it) => <div key={it.key}>{it.node}</div>)
        )}
      </div>

      <div className="shrink-0 border-t border-ov-border">
        <PinnedPromptBar
          session={session}
          firstMessage={firstMessage ?? null}
          onOpenModal={onOpenModal}
          onQueueChanged={onQueueChanged}
          highlightPromptId={highlightPromptId}
          onHighlightDone={onHighlightDone}
        />
      </div>
    </div>
  );
}
