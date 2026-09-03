import { useCallback, useEffect, useMemo, useRef } from "react";
import { Terminal } from "lucide-react";
import type { Message, Session } from "../../hooks/types";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { extractJSONField } from "../../utils/jsonField";
import { CopyButton } from "../ui/CopyButton";
import { formatCost } from "../../utils/sessionUtils";
import { useHideCosts } from "../../hooks/useHideCosts";
import { EmptyPanel } from "../ui/EmptyPanel";

interface ConsolePaneProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
  selectedSpan?: { start: number; end: number; trailing?: boolean } | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function ConsoleStream({
  messages,
  cursor,
  maxIndex,
  selectedSpan,
}: Pick<ConsolePaneProps, "messages" | "cursor" | "maxIndex" | "selectedSpan">) {
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
          const isShell = effectiveToolKind(t) === "bash" || effectiveToolKind(t) === "sql";
          const visible = selectedSpan
            ? eventIdx >= selectedSpan.start && eventIdx < selectedSpan.end
            : eventIdx <= cursor || cursor >= maxIndex;
          if (visible) {
            if (isShell) list.push({ tool: t, summary: getToolSummary(t, msg.agent), msg });
          }
          eventIdx++;
        }
      } else {
        eventIdx++;
      }
    }
    return list;
  }, [messages, cursor, maxIndex, selectedSpan]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const threshold = 80;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distance <= threshold;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!isAtBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [tools]);

  if (tools.length === 0) {
    return (
      <EmptyPanel
        icon={<Terminal size={20} />}
        title="No shell activity in visible range"
        hint="Shell commands appear here as the timeline advances."
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs bg-ov-bg"
    >
      {tools.map((item) => {
        const command = extractJSONField(item.tool.input, "command") || item.summary;
        const output = item.tool.output || "";
        const isCompleted = item.tool.status === "completed";
        return (
          <div key={item.tool.id} className="space-y-1 group">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-emerald-400 select-none">❯</span>
              <span className="text-ov-text truncate flex-1" title={command}>
                {command}
              </span>
              <span className="text-[11px] font-mono text-ov-text-secondary hidden sm:inline tabular-nums">
                {item.tool.duration ? `${item.tool.duration}ms` : ""}
              </span>
              <span
                className={`text-[10px] font-mono ${isCompleted ? "text-emerald-400/70" : "text-amber-400/70"}`}
              >
                {item.tool.status}
              </span>
              <CopyButton
                text={command}
                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              />
            </div>
            {output ? (
              <div className="ml-4 relative group/output">
                <pre className="whitespace-pre-wrap break-words text-ov-text-secondary leading-relaxed text-[12px] pr-8">
                  {output.slice(0, 8000)}
                </pre>
                <div className="absolute top-0 right-0 opacity-0 group-hover/output:opacity-100 transition-opacity">
                  <CopyButton text={output} />
                </div>
              </div>
            ) : (
              <div className="ml-4 text-[11px] text-ov-text-secondary/60 italic">no output</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConsolePane(props: ConsolePaneProps) {
  const { session, messages, cursor, maxIndex, selectedSpan } = props;
  const isCollapsed = !!props.collapsed;
  const hideCosts = useHideCosts();

  const tokenStats = useMemo(() => {
    let eventIdx = 0;
    let visIn = 0;
    let visOut = 0;
    let visTotal = 0;
    let fullIn = 0;
    let fullOut = 0;
    for (const m of messages) {
      const isUser = m.role === "user";
      const msgEvents = isUser ? 1 : m.toolCalls?.length ? m.toolCalls.length : 1;
      const msgStart = eventIdx;
      const msgEnd = eventIdx + msgEvents - 1;
      const visible = selectedSpan
        ? msgEnd >= selectedSpan.start && msgStart < selectedSpan.end
        : msgEnd <= cursor || cursor >= maxIndex;
      const ti = m.tokensInput ?? 0;
      const to = m.tokensOutput ?? 0;
      if (visible) {
        visIn += ti;
        visOut += to;
        visTotal += ti + to;
      }
      fullIn += ti;
      fullOut += to;
      eventIdx += msgEvents;
    }
    const full = fullIn + fullOut;
    let inTokens = visIn;
    let outTokens = visOut;
    let cached = 0;
    let cost = 0;
    if (full > 0) {
      const pct = visTotal / full;
      cached = Math.round((session.tokensCacheRead ?? 0) * pct);
      cost = (session.cost ?? 0) * pct;
      if (fullIn === 0 && session.tokensInput > 0) inTokens = Math.round(session.tokensInput * pct);
      if (fullOut === 0 && session.tokensOutput > 0)
        outTokens = Math.round(session.tokensOutput * pct);
    } else {
      inTokens = session.tokensInput ?? 0;
      outTokens = session.tokensOutput ?? 0;
      cached = session.tokensCacheRead ?? 0;
      cost = session.cost ?? 0;
      if (selectedSpan) {
        if (maxIndex > 0 && selectedSpan.end > selectedSpan.start) {
          const pct = (selectedSpan.end - selectedSpan.start) / (maxIndex + 1);
          inTokens = Math.round(inTokens * pct);
          outTokens = Math.round(outTokens * pct);
          cached = Math.round(cached * pct);
          cost *= pct;
        } else {
          inTokens = 0;
          outTokens = 0;
          cached = 0;
          cost = 0;
        }
      } else if (cursor < maxIndex && maxIndex > 0) {
        const pct = (cursor + 1) / (maxIndex + 1);
        inTokens = Math.round(inTokens * pct);
        outTokens = Math.round(outTokens * pct);
        cached = Math.round(cached * pct);
        cost *= pct;
      }
    }
    return { inTokens, outTokens, cached, cost };
  }, [
    messages,
    cursor,
    maxIndex,
    selectedSpan,
    session.tokensCacheRead,
    session.tokensInput,
    session.tokensOutput,
    session.cost,
  ]);

  const bashCount = useMemo(
    () =>
      messages.filter((m) => (m.toolCalls ?? []).some((tc) => effectiveToolKind(tc) === "bash"))
        .length,
    [messages],
  );

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return `${n}`;
  };

  const costLabel = !hideCosts && tokenStats.cost > 0 ? formatCost(tokenStats.cost) : "";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ov-bg-secondary border-t border-ov-border">
      <div
        className={`flex items-center gap-0 px-2 border-b border-ov-border bg-surface-elevated shrink-0 ${props.onToggleCollapse ? "cursor-pointer" : ""}`}
        onClick={() => props.onToggleCollapse?.()}
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
        <span className="ml-auto text-[11px] font-mono text-ov-text-secondary hidden sm:inline-flex items-center gap-1.5 tabular-nums">
          {tokenStats.inTokens > 0 && (
            <span title="Input tokens">{fmt(tokenStats.inTokens)} in</span>
          )}
          {tokenStats.inTokens > 0 && tokenStats.outTokens > 0 && (
            <span className="opacity-40">/</span>
          )}
          {tokenStats.outTokens > 0 && (
            <span title="Output tokens">{fmt(tokenStats.outTokens)} out</span>
          )}
          {tokenStats.cached > 0 && (
            <>
              {(tokenStats.inTokens > 0 || tokenStats.outTokens > 0) && (
                <span className="opacity-40">/</span>
              )}
              <span title="Cached tokens">{fmt(tokenStats.cached)} cached</span>
            </>
          )}
          {costLabel && (
            <>
              <span className="opacity-40">•</span>
              <span title="Cost" className="text-ov-text">
                {costLabel}
              </span>
            </>
          )}
          {tokenStats.inTokens === 0 && tokenStats.outTokens === 0 && tokenStats.cached === 0 && (
            <span>—</span>
          )}
          <span className="opacity-40">•</span>
          <span>{bashCount} cmds</span>
        </span>
      </div>

      {!isCollapsed && (
        <ConsoleStream
          messages={messages}
          cursor={cursor}
          maxIndex={maxIndex}
          selectedSpan={selectedSpan}
        />
      )}
    </div>
  );
}
