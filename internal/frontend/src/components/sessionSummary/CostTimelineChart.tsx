import { ArrowRight, DollarSign } from "lucide-react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
} from "recharts";
import type { TokenTimelinePoint } from "../../hooks/useSessionTokenomics";
import { formatCost } from "../../utils/sessionUtils";

function CostTimelineTooltip({
  active,
  payload,
  onNavigateToMessage,
}: {
  active?: boolean;
  payload?: { payload: TokenTimelinePoint }[];
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const linkable = onNavigateToMessage && (p.messageIndex !== undefined || p.messageId);
  return (
    <div className="ov-chart-tooltip">
      <p className="ov-chart-tooltip-date">Step {p.stepIndex + 1}</p>
      <div className="ov-chart-tooltip-row font-medium">
        <span>Cost</span>
        <span className="ml-auto tabular-nums">{formatCost(p.cost)}</span>
      </div>
      <div className="ov-chart-tooltip-row text-ov-text-secondary">
        <span>Total</span>
        <span className="ml-auto tabular-nums">{formatCost(p.cumulativeCost)}</span>
      </div>
      {linkable && (
        <>
          <div className="ov-chart-tooltip-divider" />
          <button
            type="button"
            onClick={() => onNavigateToMessage(p.messageIndex!, p.messageId)}
            className="ov-chart-tooltip-row w-full items-center gap-1 text-left text-accent hover:text-accent cursor-pointer"
          >
            <span>View message</span>
            <ArrowRight size={12} className="ml-auto" />
          </button>
        </>
      )}
    </div>
  );
}

export function CostTimelineChart({
  timeline,
  hideCosts,
  onNavigateToMessage,
}: {
  timeline: TokenTimelinePoint[];
  hideCosts: boolean;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}) {
  if (timeline.length === 0 || hideCosts) return null;
  const hasCost = timeline.some((p) => p.cost > 0);
  if (!hasCost) return null;

  return (
    <div className="sess-overview-card">
      <div className="sess-overview-section-header">
        <DollarSign size={14} />
        <h3>Cost Timeline</h3>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={timeline} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ov-border)" vertical={false} />
          <XAxis
            dataKey="stepIndex"
            tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v + 1}`}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => (v < 0.01 ? `<${0.01}` : `$${v.toFixed(2)}`)}
          />
          <Tooltip
            content={<CostTimelineTooltip onNavigateToMessage={onNavigateToMessage} />}
            cursor={{ fill: "var(--color-ov-bg-hover)" }}
          />
          <Line
            type="monotone"
            dataKey="cumulativeCost"
            stroke="var(--color-accent-secondary)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
