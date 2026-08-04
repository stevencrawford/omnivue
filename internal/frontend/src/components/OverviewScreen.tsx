import { useMemo } from "react";
import { Bot, Coins, Sparkles, Zap } from "lucide-react";
import { SessionsIcon } from "./IconChannel";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { ActivityCharts } from "./ActivityCharts";
import { ModelAgentBreakdown } from "./ModelAgentBreakdown";
import { StatCard } from "./overview/StatCard";
import { RepoCard } from "./overview/RepoCard";
import type { Session } from "../hooks/types";
import { useTimeRange } from "../hooks/useTimeRange";
import { useHideCosts } from "../hooks/useHideCosts";
import { shortRepoName } from "../utils/buildTree";
import { formatCost, formatTokenBreakdown, formatTokens } from "../utils/sessionUtils";
import {
  aggregateByAgent,
  aggregateByDay,
  aggregateByModel,
  agentLabel,
  computeStats,
  filterSessionsByTimeRange,
  sortByRecent,
} from "../utils/overviewAnalytics";
import { TOKEN_COLOR_SEGMENTS } from "../utils/toolKindTaxonomy";

interface OverviewScreenProps {
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
}

export function OverviewScreen({ sessions, onSessionSelect }: OverviewScreenProps) {
  const hideCosts = useHideCosts();
  const { range, startDate, endDate, label, setPreset, setCustomRange } = useTimeRange();

  // ---- Time-filtered sessions ----
  const rangeFilter = useMemo(() => ({ start: startDate, end: endDate }), [startDate, endDate]);
  const filteredSessions = useMemo(
    () => filterSessionsByTimeRange(sessions, rangeFilter),
    [sessions, rangeFilter],
  );

  // ---- Stats (time-filtered) ----
  const stats = useMemo(() => computeStats(filteredSessions), [filteredSessions]);

  // ---- Analytics (time-filtered) ----
  const dailyStats = useMemo(
    () => aggregateByDay(filteredSessions, rangeFilter),
    [filteredSessions, rangeFilter],
  );
  const modelStats = useMemo(() => aggregateByModel(filteredSessions), [filteredSessions]);
  const agentStats = useMemo(() => aggregateByAgent(filteredSessions), [filteredSessions]);

  const maxModelTokens = modelStats[0]?.tokens ?? 1;
  const maxAgentTokens = agentStats[0]?.tokens ?? 1;

  // ---- All-time recent sessions (not time-filtered, for repo cards & latest session) ----
  const recentSessions = useMemo(() => sortByRecent(sessions).slice(0, 8), [sessions]);

  // ---- Repo groups (time-filtered) ----
  const repoGroups = useMemo(() => {
    const parentSessions = filteredSessions.filter((s) => !s.parentId);
    const byRepo = new Map<string, { label: string; sessions: Session[] }>();
    for (const s of parentSessions) {
      const key = s.repository || "Unknown";
      const existing = byRepo.get(key);
      if (existing) {
        existing.sessions.push(s);
      } else {
        byRepo.set(key, { label: shortRepoName(key), sessions: [s] });
      }
    }
    return [...byRepo.entries()]
      .map(([path, { label, sessions: repoSessions }]) => ({
        path,
        label,
        sessions: repoSessions,
        count: repoSessions.length,
        latestUpdatedAt: repoSessions.reduce(
          (latest, s) => Math.max(latest, new Date(s.updatedAt).getTime()),
          0,
        ),
      }))
      .sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)
      .slice(0, 3);
  }, [filteredSessions]);

  // ---- Token display helpers ----
  const totalTokens =
    stats.tokensInput + stats.tokensOutput + stats.tokensCacheRead + stats.tokensReasoning;

  const tokenSegments = [
    { label: "Input", value: stats.tokensInput, color: TOKEN_COLOR_SEGMENTS.input },
    { label: "Output", value: stats.tokensOutput, color: TOKEN_COLOR_SEGMENTS.output },
    {
      label: "Cache",
      value: stats.tokensCacheRead,
      color: TOKEN_COLOR_SEGMENTS.cache,
    },
    {
      label: "Reasoning",
      value: stats.tokensReasoning,
      color: TOKEN_COLOR_SEGMENTS.reasoning,
    },
  ].filter((s) => s.value > 0);

  const latestSessionTokens = recentSessions[0]
    ? formatTokenBreakdown(recentSessions[0])
    : undefined;
  const latestSessionCost = recentSessions[0]?.cost;

  return (
    <div className="flex-1 overflow-y-auto sess-overview">
      <div className="sess-overview-inner">
        {/* ---- Hero header with time range selector ---- */}
        <header className="sess-overview-hero">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="sess-overview-hero-icon shrink-0">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
                <p className="text-sm text-ov-text-secondary mt-0.5">
                  {label} · {stats.totalSessions} session
                  {stats.totalSessions !== 1 ? "s" : ""} across {stats.agents.length} agent
                  {stats.agents.length !== 1 ? "s" : ""} and {stats.totalWorkspaces} workspace
                  {stats.totalWorkspaces !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <TimeRangeSelector
              preset={range.preset}
              label={label}
              customStart={range.start}
              customEnd={range.end}
              onPresetChange={setPreset}
              onCustomRangeChange={setCustomRange}
            />
          </div>
        </header>

        {/* ---- Stat cards ---- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard
            icon={SessionsIcon}
            label="Sessions"
            value={String(stats.totalSessions)}
            sub={`${stats.totalMessages.toLocaleString()} messages`}
          />
          <StatCard
            icon={Zap}
            label="Tokens"
            value={(formatTokens(totalTokens) || "—").replace(/ tok$/, "")}
            sub={
              tokenSegments.length > 0 ? tokenSegments.map((s) => s.label).join(" · ") : undefined
            }
          />
          <StatCard
            icon={Coins}
            label="Spend"
            value={!hideCosts && stats.totalCost > 0 ? formatCost(stats.totalCost) : "***"}
            sub="In selected range"
          />
          <StatCard
            icon={Bot}
            label="Agents"
            value={String(stats.agents.length)}
            sub={stats.agents.map((a) => agentLabel(a.agent)).join(", ")}
          />
        </div>

        {/* ---- Recent sessions (repo cards) ---- */}
        {repoGroups.length > 0 && (
          <section className="mb-8">
            <div className="sess-overview-section-header">
              <SessionsIcon width={14} height={14} />
              <h3>Recent Sessions</h3>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {repoGroups.map(({ path, label: repoLabel, sessions: repoSessions }) => (
                <RepoCard
                  key={path}
                  repoLabel={repoLabel}
                  repoPath={path}
                  sessions={repoSessions}
                  onSessionSelect={onSessionSelect}
                />
              ))}
            </div>
          </section>
        )}

        {/* ---- Activity charts ---- */}
        <ActivityCharts dailyStats={dailyStats} hideCosts={hideCosts} />

        {/* ---- Model & Agent breakdown ---- */}
        <ModelAgentBreakdown
          models={modelStats}
          agents={agentStats}
          hideCosts={hideCosts}
          maxModelTokens={maxModelTokens}
          maxAgentTokens={maxAgentTokens}
          tokenSegments={tokenSegments}
          latestSessionTokens={latestSessionTokens}
          latestSessionCost={latestSessionCost}
        />
      </div>
    </div>
  );
}
