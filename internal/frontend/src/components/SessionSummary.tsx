import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Timer,
  DollarSign,
  Hash,
  Activity,
  Zap,
  TrendingUp,
  CheckCircle,
  Edit3,
  Target,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import type { Session, Message } from "../hooks/useApi";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { useSessionTokenomics } from "../hooks/useSessionTokenomics";
import type {
  TokenTimelinePoint,
  ToolTokenStat,
  EffectivenessMetrics,
} from "../hooks/useSessionTokenomics";
import {
  TOKENS_COLOR_INPUT,
  TOKENS_COLOR_OUTPUT,
  TOKENS_COLOR_CACHE,
  TOKENS_COLOR_REASONING,
} from "../hooks/useSessionTokenomics";
import { formatCost, formatTokens } from "../utils/sessionUtils";

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

function formatSmallPct(value: number | null): string {
  if (value === null || value === 0) return "—";
  if (value >= 99.95) return "100%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

function useHideCosts(): boolean {
  const [hide, setHide] = useState(() => {
    try {
      return localStorage.getItem("omnivue-hide-costs") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "omnivue-hide-costs") {
        setHide(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return hide;
}

// ---------------------------------------------------------------------------
// Token Breakdown — stacked horizontal bar
// ---------------------------------------------------------------------------

function TokenBreakdownBar({
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
  const segments = useMemo(
    () =>
      [
        { key: "Input", value: tokensInput, color: TOKENS_COLOR_INPUT },
        { key: "Output", value: tokensOutput, color: TOKENS_COLOR_OUTPUT },
        { key: "Cache", value: tokensCached, color: TOKENS_COLOR_CACHE },
        {
          key: "Reasoning",
          value: tokensReasoning,
          color: TOKENS_COLOR_REASONING,
        },
      ].filter((s) => s.value > 0),
    [tokensInput, tokensOutput, tokensCached, tokensReasoning],
  );

  const total = segments.reduce((a, s) => a + s.value, 0);

  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
        <Zap size={14} />
        <span>Token Breakdown</span>
      </div>
      <div
        className="flex h-8 w-full rounded-lg overflow-hidden border border-ov-border/50"
        role="img"
        aria-label={`Token breakdown: ${segments.map((s) => `${s.key} ${formatTokens(s.value)}`).join(", ")}`}
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="h-full transition-all first:rounded-l-lg last:rounded-r-lg relative group"
            style={{
              backgroundColor: seg.color,
              width: `${(seg.value / total) * 100}%`,
              minWidth: seg.value > 0 ? "3px" : "0",
            }}
            title={`${seg.key}: ${formatTokens(seg.value)} (${formatPct((seg.value / total) * 100)})`}
          >
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10">
              <div className="bg-ov-bg-active text-ov-text text-[11px] px-2 py-1 rounded-md whitespace-nowrap border border-ov-border shadow-md">
                <div className="font-medium">{seg.key}</div>
                <div className="text-ov-text-secondary">
                  {formatTokens(seg.value)} ({formatPct((seg.value / total) * 100)})
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="flex items-center gap-1.5 text-[11px] text-ov-text-secondary"
          >
            <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span>{seg.key}</span>
            <span className="tabular-nums">{formatTokens(seg.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token Timeline — area chart
// ---------------------------------------------------------------------------

function TimelineTooltip({
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
      {[
        { key: "cumulativeInput", label: "Input", color: TOKENS_COLOR_INPUT },
        {
          key: "cumulativeOutput",
          label: "Output",
          color: TOKENS_COLOR_OUTPUT,
        },
        {
          key: "cumulativeCached",
          label: "Cache",
          color: TOKENS_COLOR_CACHE,
        },
        {
          key: "cumulativeReasoning",
          label: "Reasoning",
          color: TOKENS_COLOR_REASONING,
        },
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
        <span className="ml-auto tabular-nums">{formatTokens(p.cumulativeTotal)}</span>
      </div>
    </div>
  );
}

function TokenTimelineChart({ timeline }: { timeline: TokenTimelinePoint[] }) {
  if (timeline.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
        <TrendingUp size={14} />
        <span>Token Timeline</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
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
          <Tooltip content={<TimelineTooltip />} cursor={{ fill: "var(--color-ov-bg-hover)" }} />
          <Area
            dataKey="cumulativeInput"
            stackId="1"
            fill={TOKENS_COLOR_INPUT}
            stroke={TOKENS_COLOR_INPUT}
            strokeWidth={0}
            fillOpacity={0.85}
          />
          <Area
            dataKey="cumulativeOutput"
            stackId="1"
            fill={TOKENS_COLOR_OUTPUT}
            stroke={TOKENS_COLOR_OUTPUT}
            strokeWidth={0}
            fillOpacity={0.85}
          />
          <Area
            dataKey="cumulativeCached"
            stackId="1"
            fill={TOKENS_COLOR_CACHE}
            stroke={TOKENS_COLOR_CACHE}
            strokeWidth={0}
            fillOpacity={0.85}
          />
          <Area
            dataKey="cumulativeReasoning"
            stackId="1"
            fill={TOKENS_COLOR_REASONING}
            stroke={TOKENS_COLOR_REASONING}
            strokeWidth={0}
            fillOpacity={0.85}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
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

// ---------------------------------------------------------------------------
// Cost Timeline — line chart
// ---------------------------------------------------------------------------

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
    </div>
  );
}

function CostTimelineChart({
  timeline,
  hideCosts,
}: {
  timeline: TokenTimelinePoint[];
  hideCosts: boolean;
}) {
  if (timeline.length === 0 || hideCosts) return null;
  const hasCost = timeline.some((p) => p.cost > 0);
  if (!hasCost) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
        <DollarSign size={14} />
        <span>Cost Timeline</span>
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
            fillOpacity={0}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Token Stats — horizontal bars
// ---------------------------------------------------------------------------

function ToolTokenBarChart({ stats }: { stats: ToolTokenStat[] }) {
  if (stats.length === 0) return null;
  const maxTokens = stats[0]?.tokens ?? 1;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
        <BarChart3 size={14} />
        <span>Token Per Tool Type</span>
      </div>
      <div className="space-y-1">
        {stats.map((s) => {
          const pct = (s.tokens / maxTokens) * 100;
          return (
            <div key={s.kind} className="flex items-center gap-2 text-xs">
              <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="w-12 text-ov-text-secondary shrink-0">{s.label}</span>
              <div className="flex-1 h-4 rounded-full bg-ov-bg-hover overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(pct, 1)}%`,
                    backgroundColor: s.color,
                  }}
                />
              </div>
              <span className="tabular-nums font-medium w-16 text-right">
                {formatTokens(s.tokens)}
              </span>
              <span className="text-[11px] text-ov-text-secondary tabular-nums w-8 text-right">
                {s.count}x
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effectiveness Metrics — 3×2 grid
// ---------------------------------------------------------------------------

function MiniMetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ov-bg-hover/40">
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

function EffectivenessCards({
  metrics,
  hideCosts,
}: {
  metrics: EffectivenessMetrics;
  hideCosts: boolean;
}) {
  const cards: {
    icon: React.ComponentType<{ size?: number }>;
    label: string;
    value: string;
  }[] = [
    {
      icon: Zap,
      label: "Cache Hit Rate",
      value: formatSmallPct(metrics.cacheHitRate),
    },
    {
      icon: TrendingUp,
      label: "Efficiency",
      value: metrics.efficiencyRatio !== null ? metrics.efficiencyRatio.toFixed(2) : "—",
    },
    {
      icon: Target,
      label: "Tokens / Tool",
      value:
        metrics.tokensPerToolCall !== null
          ? `${formatTokens(Math.round(metrics.tokensPerToolCall))}`
          : "—",
    },
    {
      icon: CheckCircle,
      label: "Tool Success",
      value: formatSmallPct(metrics.toolSuccessRate),
    },
    {
      icon: Edit3,
      label: "Edits / Request",
      value: metrics.editsPerUserRequest !== null ? metrics.editsPerUserRequest.toFixed(1) : "—",
    },
    {
      icon: DollarSign,
      label: "Cost / File",
      value:
        !hideCosts && metrics.costPerFile !== null
          ? formatCost(metrics.costPerFile)
          : hideCosts && metrics.costPerFile !== null
            ? "***"
            : "—",
    },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
        <Activity size={14} />
        <span>Effectiveness</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {cards.map((card) => (
          <MiniMetricCard key={card.label} icon={card.icon} label={card.label} value={card.value} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SessionSummary({ session, messages }: SessionSummaryProps) {
  const hideCosts = useHideCosts();
  const { categories, totalCount, totalDuration, hasTiming } = useSessionSummary(messages);
  const { tokenTimeline, toolTokenStats, effectiveness } = useSessionTokenomics(messages, session);

  const barSegments = useMemo(() => categories.filter((c) => c.count > 0), [categories]);

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ov-text-secondary p-8">
        <Activity size={32} className="mb-3 opacity-40" />
        <p className="text-sm">No session data to summarize</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 pb-2 space-y-5">
        {/* Activity Breakdown */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary">
            <BarChart3 size={14} />
            <span>Activity Breakdown</span>
          </div>
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
                        {hasTiming && seg.duration > 0 && ` · ${formatDuration(seg.duration)}`}
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
                <span
                  className="size-2 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span>{seg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-ov-text-secondary mb-1">
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

        {/* Token Breakdown */}
        <TokenBreakdownBar
          tokensInput={session.tokensInput}
          tokensOutput={session.tokensOutput}
          tokensCached={session.tokensCacheRead}
          tokensReasoning={session.tokensReasoning}
        />

        {/* Token Timeline */}
        <TokenTimelineChart timeline={tokenTimeline} />

        {/* Cost Timeline */}
        <CostTimelineChart timeline={tokenTimeline} hideCosts={hideCosts} />

        {/* Token Per Tool Type */}
        <ToolTokenBarChart stats={toolTokenStats} />

        {/* Effectiveness */}
        <EffectivenessCards metrics={effectiveness} hideCosts={hideCosts} />
      </div>

      {/* Stats footer */}
      {(session.cost > 0 || totalDuration > 0 || totalCount > 0) && (
        <div className="mt-auto border-t border-ov-border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-xs text-ov-text-secondary">
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
                <span className="tabular-nums font-medium text-ov-text">
                  {hideCosts ? "***" : formatCost(session.cost)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="font-medium text-ov-text">
                {formatTokens(effectiveness.totalTokens)}
              </span>
              <span>total tokens</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
