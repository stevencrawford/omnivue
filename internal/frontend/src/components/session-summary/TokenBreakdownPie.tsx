import { useMemo } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import {
  TOKENS_COLOR_INPUT,
  TOKENS_COLOR_OUTPUT,
  TOKENS_COLOR_CACHE,
  TOKENS_COLOR_REASONING,
} from "../../hooks/useSessionTokenomics";
import { formatTokens } from "../../utils/sessionUtils";
import { formatPct } from "./format";

const PIE_COLORS = [
  TOKENS_COLOR_INPUT,
  TOKENS_COLOR_OUTPUT,
  TOKENS_COLOR_CACHE,
  TOKENS_COLOR_REASONING,
];

export function TokenBreakdownPie({
  tokensInput,
  tokensOutput,
  tokensCached,
  tokensReasoning,
}: {
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensReasoning: number;
}) {
  const data = useMemo(
    () =>
      [
        { name: "Input", value: tokensInput, color: TOKENS_COLOR_INPUT },
        { name: "Output", value: tokensOutput, color: TOKENS_COLOR_OUTPUT },
        { name: "Cache", value: tokensCached, color: TOKENS_COLOR_CACHE },
        {
          name: "Reasoning",
          value: tokensReasoning,
          color: TOKENS_COLOR_REASONING,
        },
      ].filter((s) => s.value > 0),
    [tokensInput, tokensOutput, tokensCached, tokensReasoning],
  );

  const total = data.reduce((a, s) => a + s.value, 0);

  if (total === 0) return null;

  const PieTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
      <div className="ov-chart-tooltip">
        <div className="ov-chart-tooltip-row">
          <span className="ov-chart-tooltip-swatch" style={{ background: entry.payload.color }} />
          <span>{entry.name}</span>
          <span className="ml-auto tabular-nums">
            {formatTokens(entry.value)} ({formatPct((entry.value / total) * 100)})
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="sess-overview-card">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={72}
            dataKey="value"
            strokeWidth={0}
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
        {data.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center gap-1.5 text-[11px] text-ov-text-secondary"
          >
            <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}</span>
            <span className="tabular-nums">{formatTokens(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
