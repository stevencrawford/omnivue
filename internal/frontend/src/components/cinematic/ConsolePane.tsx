import { useEffect, useMemo, useRef } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import type { Message, Session } from "../../hooks/types";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { extractJSONField } from "../../utils/jsonField";
import { useCopy } from "../../hooks/useCopy";

interface ConsolePaneProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function ConsoleCopyButton({ text, title }: { text: string; title?: string }) {
  const { copied, copy } = useCopy(2000);
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className="size-6 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 cursor-pointer transition-colors shrink-0"
      title={title ?? "Copy"}
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tools]);

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
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs bg-[#0b0e14]"
    >
      {tools.map((item) => {
        const command = extractJSONField(item.tool.input, "command") || item.summary;
        const output = item.tool.output || "";
        const isCompleted = item.tool.status === "completed";
        return (
          <div key={item.tool.id} className="space-y-1 group">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-emerald-400 select-none">❯</span>
              <span className="text-[#e6e6e6] truncate flex-1" title={command}>
                {command}
              </span>
              <span className="text-[11px] font-mono text-white/30 hidden sm:inline tabular-nums">
                {item.tool.duration ? `${item.tool.duration}ms` : ""}
              </span>
              <ConsoleCopyButton text={command} title="Copy command" />
              <span
                className={`text-[10px] font-mono ${isCompleted ? "text-emerald-400/70" : "text-amber-400/70"}`}
              >
                {item.tool.status}
              </span>
            </div>
            {output ? (
              <div className="ml-4 relative group/output">
                <pre className="whitespace-pre-wrap break-words text-[#a9b1c7] leading-relaxed text-[12px] opacity-90 pr-8">
                  {output.slice(0, 8000)}
                </pre>
                <div className="absolute top-0 right-0 opacity-0 group-hover/output:opacity-100 transition-opacity">
                  <ConsoleCopyButton text={output} title="Copy output" />
                </div>
              </div>
            ) : (
              <div className="ml-4 text-[11px] text-white/30 italic">no output</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConsolePane(props: ConsolePaneProps) {
  const { session, messages, cursor, maxIndex } = props;
  const isCollapsed = !!props.collapsed;

  const tokenBreakdown = useMemo(() => {
    let eventIdx = 0;
    let totalVisible = 0;
    for (const m of messages) {
      const isUser = m.role === "user";
      const msgEvents = isUser ? 1 : m.toolCalls?.length ? m.toolCalls.length : 1;
      const msgEnd = eventIdx + msgEvents - 1;
      const visible = msgEnd <= cursor || cursor >= maxIndex;
      if (visible) totalVisible += (m.tokensInput ?? 0) + (m.tokensOutput ?? 0);
      eventIdx += msgEvents;
    }
    let full = 0;
    for (const m of messages) full += (m.tokensInput ?? 0) + (m.tokensOutput ?? 0);
    const pct = full > 0 ? totalVisible / full : 1;
    const cached = Math.round((session.tokensCacheRead ?? 0) * pct);
    const fmt = (n: number) => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
      return `${n}`;
    };
    if (cached > 0) return `${fmt(cached)} cached`;
    return "—";
  }, [messages, cursor, maxIndex, session.tokensCacheRead]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ov-bg-secondary border-t border-ov-border">
      <div
        className={`flex items-center gap-0 px-2 border-b border-ov-border bg-surface-elevated shrink-0 ${props.onToggleCollapse ? "cursor-pointer" : ""}`}
        onClick={() => {
          if (props.onToggleCollapse) props.onToggleCollapse();
        }}
        role={props.onToggleCollapse ? "button" : undefined}
        title={
          props.onToggleCollapse
            ? isCollapsed
              ? "Click to expand console"
              : "Click to collapse console"
            : undefined
        }
      >
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 border-accent text-ov-text bg-ov-bg cursor-pointer"
        >
          <Terminal size={12} />
          Console
        </button>
        <span className="ml-auto text-[11px] font-mono text-ov-text-secondary hidden sm:inline-flex items-center gap-2">
          <span className="tabular-nums">{tokenBreakdown}</span>
          <span className="opacity-50">•</span>
          <span>{`${messages.filter((m) => (m.toolCalls ?? []).some((tc) => effectiveToolKind(tc) === "bash")).length} cmds`}</span>
        </span>
      </div>

      {!isCollapsed && <ConsoleStream messages={messages} cursor={cursor} maxIndex={maxIndex} />}
    </div>
  );
}
