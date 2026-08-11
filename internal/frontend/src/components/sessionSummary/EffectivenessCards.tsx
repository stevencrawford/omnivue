import { Zap, TrendingUp, CheckCircle, Activity } from "lucide-react";
import type { EffectivenessMetrics } from "../../hooks/useSessionTokenomics";
import { formatPct } from "./format";

function MiniMetricCard({
  icon: Icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-ov-border"
      style={{ backgroundColor: "var(--color-surface-elevated)" }}
      title={tooltip}
    >
      <span className="text-ov-text-secondary shrink-0">
        <Icon size={12} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-ov-text-secondary">{label}</p>
        <p className="text-xs font-semibold tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}

export function EffectivenessCards({ metrics }: { metrics: EffectivenessMetrics }) {
  const cards: {
    icon: React.ComponentType<{ size?: number }>;
    label: string;
    value: string;
    tooltip: string;
  }[] = [
    {
      icon: Zap,
      label: "Cache Hit Rate",
      value: formatPct(metrics.cacheHitRate),
      tooltip:
        "Percentage of input tokens served from cache. Higher means fewer API calls and lower latency.",
    },
    {
      icon: TrendingUp,
      label: "Efficiency",
      value: metrics.efficiencyRatio !== null ? formatPct(metrics.efficiencyRatio * 100) : "\u2014",
      tooltip:
        "Ratio of output tokens to input tokens. Lower numbers mean more context processed per response token.",
    },
    {
      icon: CheckCircle,
      label: "Tool Success",
      value: formatPct(metrics.toolSuccessRate),
      tooltip:
        "Percentage of tool calls (file edits, shell commands, searches) that completed without error.",
    },
  ];

  return (
    <>
      <div className="sess-overview-section-header">
        <Activity size={14} />
        <h3>Effectiveness</h3>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {cards.map((card) => (
          <MiniMetricCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value}
            tooltip={card.tooltip}
          />
        ))}
      </div>
    </>
  );
}
