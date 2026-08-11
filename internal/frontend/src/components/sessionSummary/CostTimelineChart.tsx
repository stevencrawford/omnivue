import { DollarSign } from "lucide-react";
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
import { ChartActivePinDot } from "./ChartActivePinDot";

function CostTimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TokenTimelinePoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
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
      <p className="ov-chart-tooltip-row text-[11px] text-ov-text-secondary">
        Click a point to view the message
      </p>
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
            content={<CostTimelineTooltip />}
            cursor={{ fill: "var(--color-ov-bg-hover)" }}
          />
          <Line
            type="monotone"
            dataKey="cumulativeCost"
            stroke="var(--color-accent-secondary)"
            strokeWidth={2}
            dot={false}
            activeDot={(props: any) => (
              <ChartActivePinDot
                {...props}
                fill="var(--color-accent-secondary)"
                onNavigateToMessage={onNavigateToMessage}
              />
            )}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
