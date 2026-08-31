import { useMemo, useState } from "react";
import { Terminal, MessageSquare, FileText } from "lucide-react";
import type { Message, Plan, Session } from "../../hooks/types";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { toolRendererRegistry } from "../tool-renderers/registry";
import { ToolRendererWrapper } from "../tool-renderers/ToolRendererWrapper";
import { PinnedPromptBar } from "../PinnedPromptBar";
import { MarkdownContent } from "../ui/MarkdownContent";
import { extractJSONField } from "../../utils/jsonField";

type ConsoleTab = "prompt" | "plan" | "console";

interface ConsolePaneProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
  plan: Plan | null;
  planLoading: boolean;
  firstMessage?: Message | null;
  onOpenModal?: (content: string, title?: string) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}

function ConsoleStream({
  messages,
  cursor,
  maxIndex,
}: Pick<ConsolePaneProps, "messages" | "cursor" | "maxIndex">) {
  const tools = useMemo(() => {
    const list: Array<{
      tool: NonNullable<Message["toolCalls"]>[number];
      summary: string;
      msg: Message;
    }> = [];
    let eventIdx = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        eventIdx++;
        continue;
      }
      const toolsInMsg = msg.toolCalls ?? [];
      if (toolsInMsg.length > 0) {
        for (const t of toolsInMsg) {
          const isBash = effectiveToolKind(t) === "bash" || effectiveToolKind(t) === "sql";
          if (eventIdx <= cursor || cursor >= maxIndex) {
            if (isBash) list.push({ tool: t, summary: getToolSummary(t, msg.agent), msg });
          }
          eventIdx++;
        }
      } else {
        eventIdx++;
      }
    }
    return list;
  }, [messages, cursor, maxIndex]);

  if (tools.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-ov-text-secondary font-mono">
        <span className="flex items-center gap-2 opacity-60">
          <Terminal size={12} /> no shell activity in range
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-xs bg-[#0b0e14] rounded">
      {tools.map((item) => {
        const kind = effectiveToolKind(item.tool);
        const renderer = toolRendererRegistry.getRenderer(kind);
        const command = extractJSONField(item.tool.input, "command") || item.summary;
        const output = item.tool.output || "";
        // ghostty/fish style: prompt line + output block
        if (!renderer) {
          return (
            <div
              key={item.tool.id}
              className="border border-white/5 rounded bg-[#151a21] overflow-hidden"
            >
              <div className="flex items-center gap-2 px-2.5 py-1 bg-white/[0.03] border-b border-white/5 text-[11px]">
                <span className="text-emerald-400">❯</span>
                <span className="text-[#bfbdb6] truncate">{command}</span>
                <span
                  className={`ml-auto text-[10px] px-1 py-0.5 rounded ${item.tool.status === "completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}
                >
                  {item.tool.status}
                </span>
              </div>
              {output && (
                <pre className="px-3 py-2 whitespace-pre-wrap break-words text-[#abb2bf] leading-relaxed max-h-60 overflow-y-auto">
                  {output.slice(0, 4000)}
                </pre>
              )}
            </div>
          );
        }
        return (
          <div
            key={item.tool.id}
            className="border border-white/5 rounded overflow-hidden bg-[#0b0e14]"
          >
            <div className="flex items-center gap-2 px-2.5 py-1 bg-white/[0.04] border-b border-white/5 text-[11px] font-mono">
              <span className="text-emerald-400">❯</span>
              <span className="text-[#bfbdb6] truncate flex-1">{command}</span>
            </div>
            <div className="p-2 bg-[#0b0e14]">
              <ToolRendererWrapper renderer={renderer} tool={item.tool} variant="detail" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanTab({ plan, loading }: { plan: Plan | null; loading: boolean }) {
  if (loading) return <div className="p-4 text-xs text-ov-text-secondary">Loading plan…</div>;
  if (!plan?.markdown)
    return <div className="p-4 text-xs text-ov-text-secondary">No plan for this session yet.</div>;
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
    </div>
  );
}

export function ConsolePane(props: ConsolePaneProps) {
  const {
    session,
    messages,
    cursor,
    maxIndex,
    plan,
    planLoading,
    firstMessage,
    onOpenModal,
    onQueueChanged,
    highlightPromptId,
    onHighlightDone,
  } = props;
  const [active, setActive] = useState<ConsoleTab>("prompt");

  const tabs: { id: ConsoleTab; label: string; icon: React.ReactNode }[] = [
    { id: "prompt", label: "Prompt", icon: <MessageSquare size={12} /> },
    { id: "plan", label: "Plan", icon: <FileText size={12} /> },
    { id: "console", label: "Console", icon: <Terminal size={12} /> },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ov-bg-secondary border-t border-ov-border">
      <div className="flex items-center gap-0 px-2 border-b border-ov-border bg-surface-elevated shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 cursor-pointer transition-colors ${active === t.id ? "border-accent text-ov-text bg-ov-bg" : "border-transparent text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"}`}
          >
            {t.icon}
            {t.label}
            {t.id === "plan" && plan?.markdown && (
              <span className="size-1.5 rounded-full bg-amber-400 ml-1" />
            )}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ov-text-secondary hidden sm:inline">
          {active === "console"
            ? `${messages.filter((m) => (m.toolCalls ?? []).some((tc) => effectiveToolKind(tc) === "bash")).length} cmds`
            : active === "plan"
              ? (plan?.source ?? "")
              : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {active === "prompt" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <PinnedPromptBar
              session={session}
              firstMessage={firstMessage ?? null}
              onOpenModal={onOpenModal}
              onQueueChanged={onQueueChanged}
              highlightPromptId={highlightPromptId}
              onHighlightDone={onHighlightDone}
            />
          </div>
        )}
        {active === "plan" && <PlanTab plan={plan} loading={planLoading} />}
        {active === "console" && (
          <ConsoleStream messages={messages} cursor={cursor} maxIndex={maxIndex} />
        )}
      </div>
    </div>
  );
}
