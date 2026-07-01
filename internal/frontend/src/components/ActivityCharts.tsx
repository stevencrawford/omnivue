import { useMemo } from "react";
import { BarChart3, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { DayStats } from "../utils/overviewAnalytics";
import { formatCost, formatTokens } from "../utils/sessionUtils";

interface ActivityChartsProps {
  dailyStats: DayStats[];
  hideCosts: boolean;
}

const TOKEN_COLORS = {
  input: "var(--color-accent)",
  output: "var(--color-accent-secondary)",
  cache: "color-mix(in srgb, var(--color-accent) 50%, cyan)",
  reasoning: "color-mix(in srgb, var(--color-accent-secondary) 60%, violet)",
} as const;

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TokenUsageChart({ dailyStats }: { dailyStats: DayStats[] }) {
  const data = useMemo(
    () =>
      dailyStats.map((d) => ({
        date: d.date,
        input: d.tokensInput,
        output: d.tokensOutput,
        cache: d.tokensCacheRead,
        reasoning: d.tokensReasoning,
        total: d.tokens,
        sessions: d.sessions,
      })),
    [dailyStats],
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0].payload;
    return (
      <div className="ov-chart-tooltip">
        <p className="ov-chart-tooltip-date">{formatDayLabel(entry.date)}</p>
        {[
          { key: "input", label: "Input", color: TOKEN_COLORS.input },
          { key: "output", label: "Output", color: TOKEN_COLORS.output },
          { key: "cache", label: "Cache", color: TOKEN_COLORS.cache },
          { key: "reasoning", label: "Reasoning", color: TOKEN_COLORS.reasoning },
        ].map(({ key, label, color }) => (
          <div key={key} className="ov-chart-tooltip-row">
            <span className="ov-chart-tooltip-swatch" style={{ background: color }} />
            <span>{label}</span>
            <span className="ml-auto tabular-nums">{formatTokens(entry[key] || 0)}</span>
          </div>
        ))}
        <div className="ov-chart-tooltip-divider" />
        <div className="ov-chart-tooltip-row font-medium">
          <span>
            {entry.sessions} session{entry.sessions !== 1 ? "s" : ""}
          </span>
          <span className="ml-auto tabular-nums">{formatTokens(entry.total)}</span>
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ov-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDayLabel}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => formatTokens(v).replace(/ tok$/, "")}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-ov-bg-hover)" }} />
        <Bar dataKey="input" stackId="tokens" fill={TOKEN_COLORS.input} radius={[1, 1, 0, 0]} />
        <Bar dataKey="output" stackId="tokens" fill={TOKEN_COLORS.output} radius={[1, 1, 0, 0]} />
        <Bar dataKey="cache" stackId="tokens" fill={TOKEN_COLORS.cache} radius={[1, 1, 0, 0]} />
        <Bar
          dataKey="reasoning"
          stackId="tokens"
          fill={TOKEN_COLORS.reasoning}
          radius={[1, 1, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CostChart({ dailyStats }: { dailyStats: DayStats[] }) {
  const data = useMemo(
    () =>
      dailyStats.map((d) => ({
        date: d.date,
        cost: d.cost,
        sessions: d.sessions,
      })),
    [dailyStats],
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0].payload;
    return (
      <div className="ov-chart-tooltip">
        <p className="ov-chart-tooltip-date">{formatDayLabel(entry.date)}</p>
        <p className="text-sm font-semibold tabular-nums">{formatCost(entry.cost)}</p>
        <p className="text-[11px] text-ov-text-secondary tabular-nums">
          {entry.sessions} session{entry.sessions !== 1 ? "s" : ""}
        </p>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ov-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDayLabel}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => formatCost(v)}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-ov-bg-hover)" }} />
        <Bar dataKey="cost" fill="var(--color-accent-secondary)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActivityCharts({ dailyStats, hideCosts }: ActivityChartsProps) {
  const hasData = dailyStats.some((d) => d.tokens > 0);

  if (!hasData) {
    return (
      <section className="mb-8">
        <div className="sess-overview-section-header">
          <BarChart3 size={14} />
          <h3>Activity</h3>
        </div>
        <div className="sess-overview-card">
          <p className="text-xs text-ov-text-secondary italic py-4 text-center">
            No activity in this time range.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="sess-overview-section-header">
        <BarChart3 size={14} />
        <h3>Activity</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="sess-overview-card">
          <div className="ov-chart-header">
            <Zap size={12} />
            <span>Token usage</span>
          </div>
          <TokenUsageChart dailyStats={dailyStats} />
        </div>
        <div className="sess-overview-card">
          <div className="ov-chart-header">
            <span className="text-[11px]">$</span>
            <span>{hideCosts ? "Spend (hidden)" : "Spend"}</span>
          </div>
          {hideCosts ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-ov-text-secondary">***</p>
            </div>
          ) : (
            <CostChart dailyStats={dailyStats} />
          )}
        </div>
      </div>
    </section>
  );
}
