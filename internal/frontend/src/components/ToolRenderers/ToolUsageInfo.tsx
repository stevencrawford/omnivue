import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import type { ToolCall } from "../../hooks/types";

function formatCost(cost: number): string {
  if (cost <= 0) return "";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function formatDuration(duration: number): string {
  if (!duration || duration <= 0) return "";
  return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;
}

function formatTokens(value: number | undefined): string {
  if (!value || value <= 0) return "";
  return value.toLocaleString();
}

/**
 * Header-area info affordance for a tool call. Rendered only when the tool call
 * carries real usage data (duration, attributed tokens, or cost). Hovering
 * reveals a tooltip with whichever of those the adapter actually recorded.
 *
 * The tooltip is rendered through a portal because tool-call cards clip their
 * content (`overflow-hidden`); an in-flow tooltip would be cut off on collapsed
 * cards. Portal + fixed positioning keeps it visible regardless of card state.
 */
export function ToolUsageInfo({ tool }: { tool: Pick<ToolCall, "duration" | "usage"> }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);

  const hasDuration = tool.duration != null && tool.duration > 0;
  const hasUsage = !!tool.usage;

  if (!hasDuration && !hasUsage) return null;

  const showPopup = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopup({ top: rect.bottom + 6, left: rect.right });
  };

  const hidePopup = () => setPopup(null);

  const tokens = tool.usage?.tokens;
  const rows: { label: string; value: string }[] = [];

  const duration = formatDuration(tool.duration ?? 0);
  if (duration) rows.push({ label: "Duration", value: duration });
  if (tokens) {
    const input = formatTokens(tokens.input);
    const output = formatTokens(tokens.output);
    const cacheRead = formatTokens(tokens.cacheRead);
    const cacheWrite = formatTokens(tokens.cacheWrite);
    const reasoning = formatTokens(tokens.reasoning);
    if (input) rows.push({ label: "Input tokens", value: input });
    if (output) rows.push({ label: "Output tokens", value: output });
    if (cacheRead) rows.push({ label: "Cache read", value: cacheRead });
    if (cacheWrite) rows.push({ label: "Cache write", value: cacheWrite });
    if (reasoning) rows.push({ label: "Reasoning", value: reasoning });
  }
  const cost = formatCost(tool.usage?.cost ?? 0);
  if (cost) rows.push({ label: "Cost", value: cost });

  const caption =
    tool.usage?.source === "step"
      ? "Derived from step usage"
      : tool.usage?.source === "message"
        ? "Derived from message usage"
        : "";

  return (
    <>
      <span
        ref={triggerRef}
        className="shrink-0 px-1 cursor-default"
        onMouseEnter={showPopup}
        onMouseLeave={hidePopup}
        aria-label="Tool usage details"
      >
        <Info
          size={12}
          className="text-ov-text-secondary/50 hover:text-ov-text-secondary transition-colors"
        />
      </span>
      {popup &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 flex w-max min-w-52 flex-col gap-1 rounded-lg border border-ov-border bg-ov-bg-secondary px-2.5 py-2 text-[11px] text-ov-text shadow-lg"
            style={{ top: popup.top, left: popup.left, transform: "translateX(-100%)" }}
          >
            {rows.length > 0 && (
              <span className="flex flex-col gap-0.5">
                {rows.map((row) => (
                  <span key={row.label} className="flex justify-between gap-4">
                    <span className="text-ov-text-secondary">{row.label}</span>
                    <span className="font-mono text-ov-text">{row.value}</span>
                  </span>
                ))}
              </span>
            )}
            {caption && <span className="text-[10px] text-ov-text-secondary/70">{caption}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
