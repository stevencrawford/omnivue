import { useMemo } from "react";
import { BarChart3, Hash } from "lucide-react";
import type { SummaryCategory } from "../../hooks/useSessionSummary";
import { formatPct, formatDuration } from "./format";

export function ActivityBreakdown({
  categories,
  hasTiming,
}: {
  categories: SummaryCategory[];
  hasTiming: boolean;
}) {
  const barSegments = useMemo(() => categories.filter((c) => c.count > 0), [categories]);

  return (
    <section>
      <div className="sess-overview-section-header">
        <BarChart3 size={14} />
        <h3>Activity Breakdown</h3>
      </div>
      <div className="sess-overview-card">
        <div
          className="flex h-7 w-full rounded-full overflow-hidden border border-ov-border/50"
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
                  <div className="bg-ov-bg-active text-ov-text text-[11px] px-2 py-1 rounded-md whitespace-nowrap border border-ov-border shadow-md">
                    <div className="font-medium">{seg.label}</div>
                    <div className="text-ov-text-secondary">
                      {seg.count} ({formatPct(seg.percentage)})
                      {hasTiming && seg.duration > 0 && ` \u00b7 ${formatDuration(seg.duration)}`}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
          {barSegments.map((seg) => (
            <div
              key={seg.kind}
              className="flex items-center gap-1.5 text-[11px] text-ov-text-secondary"
            >
              <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
              <span>{seg.label}</span>
            </div>
          ))}
        </div>

        <div className="space-y-1 mt-4">
          <div className="sess-overview-section-header">
            <Hash size={14} />
            <h3>Details</h3>
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
                  <span className="text-ov-text">{seg.label}</span>
                </div>
                <div className="flex items-center gap-2 text-ov-text-secondary">
                  <span className="font-medium text-ov-text">{seg.count}</span>
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
    </section>
  );
}
