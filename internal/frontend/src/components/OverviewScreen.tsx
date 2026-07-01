import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Bot, Coins, Folder, GitBranch, Sparkles, Zap } from "lucide-react";
import { SessionsIcon } from "./IconChannel";
import type { Bookmark as BookmarkType, Folder as FolderType, Session } from "../hooks/useApi";
import { fetchFolderSessions, fetchFolders } from "../hooks/useApi";
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
import { STORAGE_KEYS } from "../utils/storageKeys";

interface OverviewScreenProps {
  sessions: Session[];
  bookmarks: BookmarkType[];
  onSessionSelect: (sessionId: string) => void;
  onBookmarkSelect: (sessionId: string, messageIndex: number, toolCallId?: string) => void;
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

function useShowCosts(): boolean {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SHOW_COSTS) !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SHOW_COSTS) {
        setShow(e.newValue !== "false");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return show;
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
  if (agent === "pi") return "Pi";
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
        {sub && <p className="text-[11px] text-ov-text-secondary truncate">{sub}</p>}
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

function ModelBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono text-ov-text">{label}</span>
        <span className="text-ov-text-secondary tabular-nums shrink-0">{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ov-bg-hover overflow-hidden">
        <div
          className="h-full rounded-full bg-accent/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function OverviewScreen({
  sessions,
  bookmarks,
  onSessionSelect,
  onBookmarkSelect,
  onOpenProjects,
}: OverviewScreenProps) {
  const showCosts = useShowCosts();
  const stats = useMemo(() => computeStats(sessions), [sessions]);
  const recentSessions = useMemo(() => sortByRecent(sessions).slice(0, 8), [sessions]);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const [folders, setFolders] = useState<FolderType[]>([]);
  const [folderSessions, setFolderSessions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchFolders();
        if (cancelled) return;
        setFolders(list || []);
        const map: Record<string, string[]> = {};
        await Promise.all(
          (list || []).map(async (f) => {
            try {
              const ids = await fetchFolderSessions(f.id);
              map[f.id] = ids || [];
            } catch {
              map[f.id] = [];
            }
          }),
        );
        if (!cancelled) setFolderSessions(map);
      } catch {
        if (!cancelled) {
          setFolders([]);
          setFolderSessions({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  const repoGroups = useMemo(() => {
    const parentSessions = sessions.filter((s) => !s.parentId);
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
  }, [sessions]);

  const totalTokens =
    stats.tokensInput + stats.tokensOutput + stats.tokensCacheRead + stats.tokensReasoning;
  const maxModelCount = stats.models[0]?.count ?? 1;
  const recentBookmarks = bookmarks.slice(0, 6);

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

  return (
    <div className="flex-1 overflow-y-auto sess-overview">
      <div className="sess-overview-inner">
        <header className="sess-overview-hero">
          <div className="flex items-start gap-3">
            <div className="sess-overview-hero-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
              <p className="text-sm text-ov-text-secondary mt-0.5">
                Your AI sessions across {stats.agents.length} agent
                {stats.agents.length !== 1 ? "s" : ""} and {stats.totalWorkspaces} workspace
                {stats.totalWorkspaces !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </header>

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
            value={showCosts && stats.totalCost > 0 ? formatCost(stats.totalCost) : "***"}
            sub="Across indexed sessions"
          />
          <StatCard
            icon={Bot}
            label="Agents"
            value={String(stats.agents.length)}
            sub={stats.agents.map((a) => agentLabel(a.agent)).join(", ")}
          />
        </div>

        <section className="mb-8">
          <div className="sess-overview-section-header">
            <SessionsIcon width={14} height={14} />
            <h3>Recent Sessions</h3>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {repoGroups.map(({ path, label, sessions: repoSessions }) => (
              <RepoCard
                key={path}
                repoLabel={label}
                repoPath={path}
                sessions={repoSessions}
                onSessionSelect={onSessionSelect}
              />
            ))}
          </div>
        </section>

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

        <div className="grid lg:grid-cols-3 gap-3">
          <section>
            <div className="sess-overview-section-header">
              <Bookmark size={14} />
              <h3>Bookmarks</h3>
              <span className="ml-auto text-[11px] text-ov-text-secondary tabular-nums">
                {bookmarks.length}
              </span>
            </div>
            <div className="sess-overview-card">
              {recentBookmarks.length === 0 ? (
                <p className="text-xs text-ov-text-secondary italic">
                  Bookmark messages and tool calls to find them quickly later.
                </p>
              ) : (
                <div className="space-y-1">
                  {recentBookmarks.map((bm) => {
                    const session = sessionById.get(bm.sessionId);
                    return (
                      <button
                        key={bm.id}
                        type="button"
                        onClick={() =>
                          onBookmarkSelect(bm.sessionId, bm.messageIndex, bm.toolCallId)
                        }
                        className="sess-overview-bookmark-row group"
                      >
                        <Bookmark size={12} className="shrink-0 text-accent" fill="currentColor" />
                        <span className="flex-1 min-w-0 text-left">
                          <span className="block text-xs truncate group-hover:text-accent transition-colors">
                            {bm.label}
                          </span>
                          {session && (
                            <span className="block text-[11px] text-ov-text-secondary truncate">
                              {sessionTitle(session)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="sess-overview-section-header">
              <Bot size={14} />
              <h3>Popular models</h3>
            </div>
            <div className="sess-overview-card space-y-3">
              {stats.models.length === 0 ? (
                <p className="text-xs text-ov-text-secondary italic">No model data yet.</p>
              ) : (
                stats.models.map((m) => (
                  <ModelBar key={m.model} label={m.label} count={m.count} max={maxModelCount} />
                ))
              )}
            </div>
          </section>

          <section>
            <div className="sess-overview-section-header">
              <Zap size={14} />
              <h3>Token analytics</h3>
            </div>
            <div className="sess-overview-card space-y-4">
              {totalTokens === 0 ? (
                <p className="text-xs text-ov-text-secondary italic">No token usage recorded.</p>
              ) : (
                <>
                  <div className="flex h-2 rounded-full overflow-hidden bg-ov-bg-hover">
                    {tokenSegments.map((seg) => (
                      <div
                        key={seg.label}
                        style={{
                          width: `${(seg.value / totalTokens) * 100}%`,
                          background: seg.color,
                        }}
                        title={`${seg.label}: ${formatTokens(seg.value)}`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {tokenSegments.map((seg) => (
                      <div key={seg.label} className="flex items-center gap-2 text-xs">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ background: seg.color }}
                        />
                        <span className="text-ov-text-secondary">{seg.label}</span>
                        <span className="ml-auto tabular-nums">{formatTokens(seg.value)}</span>
                      </div>
                    ))}
                  </div>
                  {recentSessions[0] && (
                    <p className="text-[11px] text-ov-text-secondary border-t border-ov-border pt-3">
                      Latest session: {formatTokenBreakdown(recentSessions[0])}
                      {showCosts && recentSessions[0].cost > 0 && (
                        <> · {formatCost(recentSessions[0].cost)}</>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
