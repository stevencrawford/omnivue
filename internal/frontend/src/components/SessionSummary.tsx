import { useMemo } from "react";
import { BarChart3, Timer, DollarSign, Hash, Activity } from "lucide-react";
import type { Session, Message } from "../hooks/useApi";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { formatCost } from "../utils/sessionUtils";

interface SessionSummaryProps {
  session: Session;
  messages: Message[];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

function formatPct(value: number): string {
  if (value === 0) return "—";
  if (value >= 99.95) return "100%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

export function SessionSummary({ session, messages }: SessionSummaryProps) {
  const { categories, totalCount, totalDuration, hasTiming } = useSessionSummary(messages);

  const barSegments = useMemo(() => {
    return categories.filter((c) => c.count > 0);
  }, [categories]);

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gh-text-secondary p-8">
        <Activity size={32} className="mb-3 opacity-40" />
        <p className="text-sm">No session data to summarize</p>
      </div>
    );
  }

  const tokenDisplay =
    session.tokensInput > 0 || session.tokensOutput > 0
      ? `${formatTokenCount(session.tokensInput)} in / ${formatTokenCount(session.tokensOutput)} out`
      : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 pb-2 space-y-5">
        {/* Stacked bar */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-gh-text-secondary">
            <BarChart3 size={14} />
            <span>Activity Breakdown</span>
          </div>
          <div
            className="flex h-7 w-full rounded-full overflow-hidden border border-gh-border/50"
            role="img"
            aria-label={`Session activity breakdown: ${barSegments.map((s) => `${s.label} ${s.percentage.toFixed(0)}%`).join(", ")}`}
          >
            {barSegments.length === 1 ? (
              <div
                className="h-full transition-all"
                style={{
                  backgroundColor: barSegments[0].color,
                  width: "100%",
                }}
                title={`${barSegments[0].label}: ${barSegments[0].count} (100%)`}
              />
            ) : (
              barSegments.map((seg) => (
                <div
                  key={seg.kind}
                  className="h-full transition-all first:rounded-l-full last:rounded-r-full relative group"
                  style={{
                    backgroundColor: seg.color,
                    width: `${Math.max(seg.percentage, 0.3)}%`,
                    minWidth: seg.percentage > 0 ? "3px" : "0",
                  }}
                  title={`${seg.label}: ${seg.count} (${formatPct(seg.percentage)})`}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10">
                    <div className="bg-gh-bg-active text-gh-text text-[11px] px-2 py-1 rounded-md whitespace-nowrap border border-gh-border shadow-md">
                      <div className="font-medium">{seg.label}</div>
                      <div className="text-gh-text-secondary">
                        {seg.count} ({formatPct(seg.percentage)})
                        {hasTiming && seg.duration > 0 && ` · ${formatDuration(seg.duration)}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Bar legend row */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
            {barSegments.map((seg) => (
              <div
                key={seg.kind}
                className="flex items-center gap-1.5 text-[11px] text-gh-text-secondary"
              >
                <span
                  className="size-2 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span>{seg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detailed breakdown */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-gh-text-secondary mb-1">
            <Hash size={14} />
            <span>Details</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {barSegments.map((seg) => (
              <div
                key={seg.kind}
                className="flex items-center justify-between text-[13px] tabular-nums px-1"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-gh-text">{seg.label}</span>
                </div>
                <div className="flex items-center gap-2 text-gh-text-secondary">
                  <span className="font-medium text-gh-text">{seg.count}</span>
                  <span className="text-[11px] w-10 text-right">{formatPct(seg.percentage)}</span>
                  {hasTiming && seg.duration > 0 && (
                    <span className="text-[11px] font-mono">{formatDuration(seg.duration)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats footer */}
      {(session.cost > 0 || tokenDisplay || totalDuration > 0) && (
        <div className="mt-auto border-t border-gh-border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-xs text-gh-text-secondary">
            <div className="flex items-center gap-1.5">
              <Activity size={12} />
              <span className="tabular-nums">{totalCount} total actions</span>
            </div>
            {hasTiming && totalDuration > 0 && (
              <div className="flex items-center gap-1.5">
                <Timer size={12} />
                <span className="tabular-nums">{formatDuration(totalDuration)} total</span>
              </div>
            )}
            {session.cost > 0 && (
              <div className="flex items-center gap-1.5">
                <DollarSign size={12} />
                <span className="tabular-nums font-medium text-gh-text">
                  {formatCost(session.cost)}
                </span>
              </div>
            )}
            {tokenDisplay && (
              <div className="flex items-center gap-1.5 tabular-nums">
                <span className="font-medium text-gh-text">Tokens</span>
                {tokenDisplay}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
