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
import {
  TOKENS_COLOR_INPUT,
  TOKENS_COLOR_OUTPUT,
  TOKENS_COLOR_CACHE,
  TOKENS_COLOR_REASONING,
} from "../../hooks/useSessionTokenomics";
import { formatTokens } from "../../utils/sessionUtils";
import { ChartActivePinDot } from "./ChartActivePinDot";

function TokenBreakdown({ p }: { p: TokenTimelinePoint }) {
  return (
    <>
      {[
        { key: "tokensInput", label: "Input", color: TOKENS_COLOR_INPUT },
        { key: "tokensOutput", label: "Output", color: TOKENS_COLOR_OUTPUT },
        { key: "tokensCached", label: "Cache", color: TOKENS_COLOR_CACHE },
        { key: "tokensReasoning", label: "Reasoning", color: TOKENS_COLOR_REASONING },
      ].map(({ key, label, color }) => (
        <div key={key} className="ov-chart-tooltip-row">
          <span className="ov-chart-tooltip-swatch" style={{ background: color }} />
          <span>{label}</span>
          <span className="ml-auto tabular-nums">{formatTokens((p as any)[key] || 0)}</span>
        </div>
      ))}
      <div className="ov-chart-tooltip-divider" />
      <div className="ov-chart-tooltip-row font-medium">
        <span>Total</span>
        <span className="ml-auto tabular-nums">
          {formatTokens(p.tokensInput + p.tokensOutput + p.tokensCached + p.tokensReasoning)}
        </span>
      </div>
    </>
  );
}

function TokenStepTooltip({
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
      <TokenBreakdown p={p} />
      <p className="ov-chart-tooltip-row text-[11px] text-ov-text-secondary">
        Click a point to view the message
      </p>
    </div>
  );
}

export function TokenTimelineChart({
  timeline,
  onNavigateToMessage,
}: {
  timeline: TokenTimelinePoint[];
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}) {
  if (timeline.length === 0) return null;

  const activeDot = (color: string) => (props: any) => (
    <ChartActivePinDot {...props} fill={color} onNavigateToMessage={onNavigateToMessage} />
  );

  return (
    <div className="sess-overview-card">
      <ResponsiveContainer width="100%" height={160}>
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
            tickFormatter={(v: number) => formatTokens(v)}
          />
          <Tooltip content={<TokenStepTooltip />} cursor={{ fill: "var(--color-ov-bg-hover)" }} />
          <Line
            type="monotone"
            dataKey="tokensInput"
            stroke={TOKENS_COLOR_INPUT}
            strokeWidth={1.5}
            dot={false}
            activeDot={activeDot(TOKENS_COLOR_INPUT)}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tokensOutput"
            stroke={TOKENS_COLOR_OUTPUT}
            strokeWidth={1.5}
            dot={false}
            activeDot={activeDot(TOKENS_COLOR_OUTPUT)}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tokensCached"
            stroke={TOKENS_COLOR_CACHE}
            strokeWidth={1.5}
            dot={false}
            activeDot={activeDot(TOKENS_COLOR_CACHE)}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tokensReasoning"
            stroke={TOKENS_COLOR_REASONING}
            strokeWidth={1.5}
            dot={false}
            activeDot={activeDot(TOKENS_COLOR_REASONING)}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
        {[
          { key: "Input", color: TOKENS_COLOR_INPUT },
          { key: "Output", color: TOKENS_COLOR_OUTPUT },
          { key: "Cache", color: TOKENS_COLOR_CACHE },
          { key: "Reasoning", color: TOKENS_COLOR_REASONING },
        ].map(({ key, color }) => (
          <div key={key} className="flex items-center gap-1.5 text-[11px] text-ov-text-secondary">
            <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            <span>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
