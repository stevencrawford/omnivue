import { useMemo } from "react";
import { Activity, BarChart3, Coins, Flame, Gauge, PenLine, Timer, Zap } from "lucide-react";
import { TrendChart, type TrendLine } from "./TrendChart";
import { StatCard } from "../overview/StatCard";
import { useAnalytics } from "../../hooks/useAnalytics";
import { aggregateDailyAnalytics, sessionDurationMs } from "../../utils/overviewAnalytics";
import { formatCost, formatDurationMs, formatTokens } from "../../utils/sessionUtils";
import { TOKEN_COLOR_SEGMENTS, TOOL_KIND_TAXONOMY } from "../../utils/toolKindTaxonomy";
import type { Session } from "../../hooks/types";

interface AnalyticsTabProps {
  sessions: Session[]; // filtered by the overview time range
  startDate: Date | null;
  endDate: Date;
  hideCosts: boolean;
}

const TOOL_LINES: TrendLine[] = [
  { key: "reads", name: "Reads", color: TOOL_KIND_TAXONOMY.read.color },
  { key: "edits", name: "Edits", color: TOOL_KIND_TAXONOMY.edit.color },
  { key: "bash", name: "Shell", color: TOOL_KIND_TAXONOMY.bash.color },
  { key: "search", name: "Search", color: TOOL_KIND_TAXONOMY.search.color },
  { key: "web", name: "Web", color: TOOL_KIND_TAXONOMY.web.color },
];

const stripTok = (v: number) => (formatTokens(v) || "0").replace(/ tok$/, "");

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="sess-overview-card">
      <div className="ov-chart-header">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function AnalyticsTab({ sessions, startDate, endDate, hideCosts }: AnalyticsTabProps) {
  const range = useMemo(() => ({ start: startDate, end: endDate }), [startDate, endDate]);
  const daily = useMemo(() => aggregateDailyAnalytics(sessions, range), [sessions, range]);

  const from = startDate ? startDate.getTime() : null;
  const to = endDate.getTime();
  const { data: toolDaily, loading: toolsLoading } = useAnalytics(from, to, true);

  // ---- Summary aggregates (whole filtered window) ----
  const summary = useMemo(() => {
    const n = sessions.length || 1;
    let tokens = 0;
    let cost = 0;
    let durationMs = 0;
    let durationCount = 0;
    let linesChanged = 0;
    for (const s of sessions) {
      tokens += s.tokensInput + s.tokensOutput + s.tokensCacheRead + s.tokensReasoning;
      cost += s.cost;
      const d = sessionDurationMs(s);
      if (d !== null) {
        durationMs += d;
        durationCount += 1;
      }
      linesChanged += (s.diffAdditions || 0) + (s.diffDeletions || 0);
    }
    return {
      avgTokens: tokens / n,
      avgCost: cost / n,
      avgDuration: durationCount > 0 ? durationMs / durationCount : null,
      avgLinesChanged: linesChanged / n,
    };
  }, [sessions, toolDaily]);

  // ---- Tool-call series (per-session averages per day) ----
  const toolChartData = useMemo(
    () =>
      toolDaily.map((d) => ({
        date: d.date,
        reads: d.sessions > 0 ? d.reads / d.sessions : 0,
        edits: d.sessions > 0 ? d.edits / d.sessions : 0,
        bash: d.sessions > 0 ? d.bash / d.sessions : 0,
        search: d.sessions > 0 ? d.search / d.sessions : 0,
        web: d.sessions > 0 ? d.web / d.sessions : 0,
      })),
    [toolDaily],
  );

  const failureData = useMemo(
    () =>
      toolDaily.map((d) => ({
        date: d.date,
        rate: d.total > 0 ? (d.failed / d.total) * 100 : 0,
      })),
    [toolDaily],
  );

  if (sessions.length === 0) {
    return (
      <div className="sess-overview-card">
        <p className="text-xs text-ov-text-secondary italic py-4 text-center">
          No sessions in this time range.
        </p>
      </div>
    );
  }

  const hasToolData = toolDaily.some((d) => d.total > 0);

  return (
    <div className="space-y-8">
      {/* ---- Summary ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Zap}
          label="Tokens / session"
          value={formatTokens(summary.avgTokens) || "0 tok"}
          sub="Average across sessions"
        />
        <StatCard
          icon={Timer}
          label="Session length"
          value={summary.avgDuration !== null ? formatDurationMs(summary.avgDuration) : "—"}
          sub="Wall-clock, completed only"
        />
        <StatCard
          icon={Coins}
          label="Spend / session"
          value={!hideCosts && summary.avgCost > 0 ? formatCost(summary.avgCost) : "***"}
          sub={!hideCosts ? "Average across sessions" : undefined}
        />
        <StatCard
          icon={PenLine}
          label="Lines changed / session"
          value={summary.avgLinesChanged > 0 ? Math.round(summary.avgLinesChanged).toString() : "—"}
          sub="Additions + deletions"
        />
      </div>

      {/* ---- Per-session trends ---- */}
      <section>
        <div className="sess-overview-section-header">
          <BarChart3 size={14} />
          <h3>Per-session trends</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ChartCard title="Avg tokens per session" icon={<Zap size={12} />}>
            <TrendChart
              data={daily}
              yFormatter={stripTok}
              lines={[{ key: "avgTokensPerSession", name: "Tokens", color: "var(--color-accent)" }]}
            />
          </ChartCard>
          <ChartCard title="Avg session length" icon={<Timer size={12} />}>
            <TrendChart
              data={daily}
              yFormatter={formatDurationMs}
              lines={[
                { key: "avgDurationMs", name: "Duration", color: "var(--color-accent-secondary)" },
              ]}
            />
          </ChartCard>
          <ChartCard title="Avg activity per session" icon={<Activity size={12} />}>
            <TrendChart
              data={daily}
              yFormatter={(v) => String(Math.round(v))}
              lines={[
                { key: "avgMessagesPerSession", name: "Messages", color: "#58a6ff" },
                { key: "avgDiffFilesPerSession", name: "Files changed", color: "#10b981" },
              ]}
            />
          </ChartCard>
          <ChartCard title="Cache hit rate" icon={<Gauge size={12} />}>
            <TrendChart
              data={daily}
              yFormatter={(v) => `${Math.round(v)}%`}
              yDomain={[0, 100]}
              lines={[
                { key: "avgCacheHitRate", name: "Cache hit", color: TOKEN_COLOR_SEGMENTS.cache },
              ]}
            />
          </ChartCard>
        </div>
      </section>

      {/* ---- Tool activity (server-side aggregation) ---- */}
      <section>
        <div className="sess-overview-section-header">
          <BarChart3 size={14} />
          <h3>Tool activity</h3>
        </div>
        {toolsLoading ? (
          <div className="sess-overview-card">
            <p className="text-xs text-ov-text-secondary italic py-4 text-center">
              Aggregating tool calls…
            </p>
          </div>
        ) : !hasToolData ? (
          <div className="sess-overview-card">
            <p className="text-xs text-ov-text-secondary italic py-4 text-center">
              No tool activity in this time range.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="Tool calls per session" icon={<Activity size={12} />}>
              <TrendChart
                data={toolChartData}
                lines={TOOL_LINES}
                yFormatter={(v) => v.toFixed(1)}
              />
            </ChartCard>
            <ChartCard title="Tool failure rate" icon={<Flame size={12} />}>
              <TrendChart
                data={failureData}
                yFormatter={(v) => `${Math.round(v)}%`}
                lines={[{ key: "rate", name: "Failed %", color: "#ef4444" }]}
              />
            </ChartCard>
          </div>
        )}
      </section>
    </div>
  );
}
