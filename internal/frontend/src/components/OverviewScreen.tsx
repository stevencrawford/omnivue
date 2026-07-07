import React, { useEffect, useMemo, useState } from "react";
import { Bot, Coins, Folder, GitBranch, Sparkles, Zap } from "lucide-react";
import { Effect } from "effect";
import { ResumeButton } from "./ResumeButton";
import { SessionsIcon } from "./IconChannel";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { ActivityCharts } from "./ActivityCharts";
import { ModelAgentBreakdown } from "./ModelAgentBreakdown";
import type { Folder as FolderType, Session } from "../hooks/types";
import { FolderService } from "../services";
import { runPromise } from "../lib/effect";
import { useTimeRange } from "../hooks/useTimeRange";
import { shortRepoName } from "../utils/buildTree";
import {
  formatCost,
  formatTokenBreakdown,
  formatTokens,
  relativeTime,
  sessionMetaParts,
  sessionTitle,
  shortModel,
} from "../utils/sessionUtils";
import {
  aggregateByAgent,
  aggregateByDay,
  aggregateByModel,
  filterSessionsByTimeRange,
} from "../utils/overviewAnalytics";

interface OverviewScreenProps {
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
  onOpenProjects?: () => void;
}

interface OverviewStats {
  totalSessions: number;
  totalMessages: number;
  totalCost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensReasoning: number;
  agents: { agent: string; count: number }[];
  models: { model: string; label: string; count: number }[];
  totalWorkspaces: number;
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

function computeStats(sessions: Session[]): OverviewStats {
  const agentCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  let totalMessages = 0;
  let totalCost = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let tokensReasoning = 0;

  for (const s of sessions) {
    totalMessages += s.messageCount;
    totalCost += s.cost;
    tokensInput += s.tokensInput;
    tokensOutput += s.tokensOutput;
    tokensCacheRead += s.tokensCacheRead;
    tokensReasoning += s.tokensReasoning;
    if (s.agent) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);
    const modelKey = s.model || "unknown";
    modelCounts.set(modelKey, (modelCounts.get(modelKey) || 0) + 1);
  }

  const agents = [...agentCounts.entries()]
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count);

  const models = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, label: shortModel(model) || model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const uniqueRepos = new Set<string>();
  for (const s of sessions) {
    uniqueRepos.add(s.repository || "Unknown");
  }

  return {
    totalSessions: sessions.length,
    totalMessages,
    totalCost,
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensReasoning,
    agents,
    models,
    totalWorkspaces: uniqueRepos.size,
  };
}

function sortByRecent(list: Session[]): Session[] {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function agentLabel(agent: string): string {
  if (agent === "opencode") return "OpenCode";
  if (agent === "copilot") return "Copilot";
  if (agent === "cursor") return "Cursor";
  if (agent === "codex") return "Codex";
  if (agent === "claude-code") return "Claude Code";
  if (agent === "pi") return "Pi";
  if (agent === "github-cloud") return "GitHub Cloud";
  return agent;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="sess-overview-stat">
      <div className="sess-overview-stat-icon">
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-widest text-ov-text-secondary">{label}</p>
        <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
        {sub && (
          <p className="text-[11px] text-ov-text-secondary truncate" title={sub}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function MiniSessionRow({
  session,
  onSelect,
  showModel,
}: {
  session: Session;
  onSelect: () => void;
  showModel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="sess-overview-session-row group"
      title={session.directory || session.repository}
    >
      {!showModel && (
        <span className={`sess-agent-badge sess-agent-badge--${session.agent} shrink-0`}>
          {agentLabel(session.agent).slice(0, 1)}
        </span>
      )}
      {showModel ? (
        <span className="flex-1 min-w-0 text-left">
          <span className="flex items-center gap-2">
            <span className="flex-1 text-xs truncate">{sessionTitle(session)}</span>
            <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
              {relativeTime(session.updatedAt)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={`sess-agent-badge sess-agent-badge--${session.agent}`}>
              {agentLabel(session.agent)}
            </span>
            <span className="text-[11px] text-ov-text-secondary truncate">
              {shortModel(session.model) || session.model}
            </span>
          </span>
        </span>
      ) : (
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-xs truncate group-hover:text-accent transition-colors">
            {sessionTitle(session)}
          </span>
          <span className="block text-[11px] text-ov-text-secondary truncate">
            {sessionMetaParts(session).join(" · ")}
          </span>
        </span>
      )}
      {!showModel && (
        <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
          {relativeTime(session.updatedAt)}
        </span>
      )}
      <ResumeButton sessionId={session.id} />
    </button>
  );
}

function ProjectCard({
  folder,
  sessions,
  onSessionSelect,
}: {
  folder: FolderType;
  sessions: Session[];
  onSessionSelect: (id: string) => void;
}) {
  const recent = sortByRecent(sessions).slice(0, 3);
  const color = folder.color || "var(--color-accent)";

  return (
    <div className="sess-overview-card">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="size-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
        >
          <Folder size={14} style={{ color }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium truncate">{folder.name}</h3>
          <p className="text-[11px] text-ov-text-secondary tabular-nums">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-ov-text-secondary italic py-2">No sessions yet</p>
      ) : (
        <div className="space-y-0.5">
          {recent.map((s) => (
            <MiniSessionRow key={s.id} session={s} onSelect={() => onSessionSelect(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoCard({
  repoLabel,
  repoPath,
  sessions,
  onSessionSelect,
}: {
  repoLabel: string;
  repoPath: string;
  sessions: Session[];
  onSessionSelect: (id: string) => void;
}) {
  const recent = sortByRecent(sessions).slice(0, 3);

  return (
    <div className="sess-overview-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="size-7 rounded-md flex items-center justify-center shrink-0 bg-ov-bg-hover">
          <GitBranch size={14} className="text-ov-text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium truncate" title={repoPath}>
            {repoLabel}
          </h3>
          <p className="text-[11px] text-ov-text-secondary tabular-nums">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="space-y-0.5">
        {recent.map((s) => (
          <MiniSessionRow key={s.id} session={s} onSelect={() => onSessionSelect(s.id)} showModel />
        ))}
      </div>
    </div>
  );
}

export function OverviewScreen({ sessions, onSessionSelect, onOpenProjects }: OverviewScreenProps) {
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
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  // ---- Folders ----
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [folderSessions, setFolderSessions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await runPromise(
        FolderService.pipe(
          Effect.flatMap((svc) => svc.list()),
          Effect.catchAll(() => Effect.succeed([] as FolderType[])),
        ),
      );
      if (cancelled) return;
      setFolders(list || []);
      const map: Record<string, string[]> = {};
      await Promise.all(
        (list || []).map(async (f) => {
          const ids = await runPromise(
            FolderService.pipe(
              Effect.flatMap((svc) => svc.listSessions(f.id)),
              Effect.catchAll(() => Effect.succeed([] as string[])),
            ),
          );
          map[f.id] = ids || [];
        }),
      );
      if (!cancelled) setFolderSessions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions]);

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
    { label: "Input", value: stats.tokensInput, color: "var(--color-accent)" },
    { label: "Output", value: stats.tokensOutput, color: "var(--color-accent-secondary)" },
    {
      label: "Cache",
      value: stats.tokensCacheRead,
      color: "color-mix(in srgb, var(--color-accent) 50%, cyan)",
    },
    {
      label: "Reasoning",
      value: stats.tokensReasoning,
      color: "color-mix(in srgb, var(--color-accent-secondary) 60%, violet)",
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

        {/* ---- Projects (folders) ---- */}
        {folders.length > 0 && (
          <section className="mb-8">
            <div className="sess-overview-section-header">
              <Folder size={14} />
              <h3>Projects</h3>
              {onOpenProjects && (
                <button
                  type="button"
                  onClick={onOpenProjects}
                  className="ml-auto text-[11px] text-accent hover:underline cursor-pointer"
                >
                  Manage
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {folders.slice(0, 4).map((folder) => {
                const ids = folderSessions[folder.id] || [];
                const folderSessionList = ids
                  .map((id) => sessionById.get(id))
                  .filter((s): s is Session => !!s);
                return (
                  <ProjectCard
                    key={folder.id}
                    folder={folder}
                    sessions={folderSessionList}
                    onSessionSelect={onSessionSelect}
                  />
                );
              })}
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
