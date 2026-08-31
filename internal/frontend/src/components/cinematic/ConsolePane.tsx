import { useMemo } from "react";
import { Terminal } from "lucide-react";
import type { Message } from "../../hooks/types";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { toolRendererRegistry } from "../tool-renderers/registry";
import { ToolRendererWrapper } from "../tool-renderers/ToolRendererWrapper";

interface ConsolePaneProps {
  messages: Message[];
  cursor: number;
  maxIndex: number;
}

export function ConsolePane({ messages, cursor, maxIndex }: ConsolePaneProps) {
  const visibleTools = useMemo(() => {
    const out: Array<{ msgIdx: number; toolIdx: number; globalIdx: number }> = [];
    let global = 0;
    messages.forEach((msg, mi) => {
      for (let ti = 0; ti < (msg.toolCalls?.length ?? 0); ti++) {
        const tool = msg.toolCalls![ti];
        if (effectiveToolKind(tool) !== "bash" && effectiveToolKind(tool) !== "sql") {
          global++;
          continue;
        }
        if (global <= cursor || cursor >= maxIndex) {
          out.push({ msgIdx: mi, toolIdx: ti, globalIdx: global });
        } else if (global > cursor) {
          // filtered out but keep index progression
        }
        global++;
      }
      if ((msg.toolCalls?.length ?? 0) === 0) {
        // still counts as one event for scrub but no console tool
        global++;
      }
    });
    // Simplified: rely on global cursor mapped to messageTool global index; we built events differently.
    // For prototype, filter by timeline event mapping: cursor maps to event index, not tool global.
    // Re-derive visible by checking each tool's event index via messages order.
    void maxIndex;
    return out;
  }, [messages, cursor, maxIndex]);

  const tools = useMemo(() => {
    const list: Array<{ tool: NonNullable<Message["toolCalls"]>[number]; summary: string }> = [];
    let eventIdx = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        if (eventIdx > cursor && cursor < maxIndex) {
          eventIdx++;
          continue;
        }
        eventIdx++;
        continue;
      }
      const toolsInMsg = msg.toolCalls ?? [];
      if (toolsInMsg.length > 0) {
        for (const t of toolsInMsg) {
          const isBash = effectiveToolKind(t) === "bash" || effectiveToolKind(t) === "sql";
          if (eventIdx <= cursor || cursor >= maxIndex) {
            if (isBash) list.push({ tool: t, summary: getToolSummary(t, msg.agent) });
          }
          eventIdx++;
        }
      } else {
        eventIdx++;
      }
    }
    void visibleTools;
    return list;
  }, [messages, cursor, maxIndex]);

  if (tools.length === 0) {
    return (
      <div className="h-[140px] shrink-0 border-t border-ov-border bg-ov-bg-secondary flex items-center justify-center text-xs text-ov-text-secondary">
        <span className="flex items-center gap-1.5">
          <Terminal size={14} /> No shell commands in visible range
        </span>
      </div>
    );
  }

  return (
    <div className="h-[220px] shrink-0 border-t border-ov-border bg-ov-bg-secondary flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-ov-border shrink-0">
        <Terminal size={12} className="text-amber-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ov-text-secondary">
          Console
        </span>
        <span className="text-[11px] text-ov-text-secondary tabular-nums">{tools.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {tools.map((item) => {
          const kind = effectiveToolKind(item.tool);
          const renderer = toolRendererRegistry.getRenderer(kind);
          if (!renderer) {
            return (
              <div key={item.tool.id} className="text-xs font-mono px-2 py-1 bg-ov-bg rounded">
                {item.summary}
              </div>
            );
          }
          return (
            <ToolRendererWrapper
              key={item.tool.id}
              renderer={renderer}
              tool={item.tool}
              variant="detail"
            />
          );
        })}
      </div>
    </div>
  );
}
