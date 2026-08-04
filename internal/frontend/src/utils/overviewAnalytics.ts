import type { Session } from "../hooks/types";
import { agentLabel, shortModel } from "./sessionUtils";

export { agentLabel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DayStats {
  date: string; // YYYY-MM-DD
  cost: number;
  tokens: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensReasoning: number;
  sessions: number;
}

export interface ModelStats {
  model: string;
  label: string;
  sessions: number;
  cost: number;
  tokens: number;
  tokensInput: number;
  tokensOutput: number;
}

export interface AgentStats {
  agent: string;
  label: string;
  sessions: number;
  cost: number;
  tokens: number;
}

export interface TopSession {
  session: Session;
  tokens: number;
  cost: number;
}

// ---------------------------------------------------------------------------
// Time-range filtering
// ---------------------------------------------------------------------------

interface DateRange {
  start: Date | null;
  end: Date;
}

export function filterSessionsByTimeRange(sessions: Session[], range: DateRange): Session[] {
  if (!range.start) return sessions;
  return sessions.filter((s) => {
    const ts = new Date(s.updatedAt);
    return ts >= range.start! && ts < range.end;
  });
}

// ---------------------------------------------------------------------------
// Daily aggregation
// ---------------------------------------------------------------------------

export function aggregateByDay(sessions: Session[], range: DateRange): DayStats[] {
  // Build a map of all days in the range (so days with zero activity appear)
  const days: DayStats[] = [];
  if (range.start) {
    const cursor = new Date(range.start);
    const end = range.end;
    while (cursor < end) {
      days.push({
        date: cursor.toISOString().slice(0, 10),
        cost: 0,
        tokens: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensReasoning: 0,
        sessions: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const byDay = new Map<string, DayStats>();
  for (const d of days) {
    byDay.set(d.date, d);
  }

  for (const s of sessions) {
    const day = s.updatedAt.slice(0, 10); // YYYY-MM-DD
    let entry = byDay.get(day);
    if (!entry) {
      // Session falls outside the pre-filled range (shouldn't happen after filtering)
      entry = {
        date: day,
        cost: 0,
        tokens: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensReasoning: 0,
        sessions: 0,
      };
      byDay.set(day, entry);
    }
    entry.cost += s.cost;
    entry.tokensInput += s.tokensInput;
    entry.tokensOutput += s.tokensOutput;
    entry.tokensCacheRead += s.tokensCacheRead;
    entry.tokensReasoning += s.tokensReasoning;
    entry.tokens += s.tokensInput + s.tokensOutput + s.tokensCacheRead + s.tokensReasoning;
    entry.sessions += 1;
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Model aggregation
// ---------------------------------------------------------------------------

export function aggregateByModel(sessions: Session[]): ModelStats[] {
  const byModel = new Map<string, ModelStats>();
  for (const s of sessions) {
    const model = s.model || "unknown";
    let entry = byModel.get(model);
    if (!entry) {
      entry = {
        model,
        label: shortModel(model),
        sessions: 0,
        cost: 0,
        tokens: 0,
        tokensInput: 0,
        tokensOutput: 0,
      };
      byModel.set(model, entry);
    }
    entry.sessions += 1;
    entry.cost += s.cost;
    entry.tokensInput += s.tokensInput;
    entry.tokensOutput += s.tokensOutput;
    entry.tokens += s.tokensInput + s.tokensOutput + s.tokensCacheRead + s.tokensReasoning;
  }
  return Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens);
}

// ---------------------------------------------------------------------------
// Agent aggregation
// ---------------------------------------------------------------------------

export function aggregateByAgent(sessions: Session[]): AgentStats[] {
  const byAgent = new Map<string, AgentStats>();
  for (const s of sessions) {
    const agent = s.agent || "unknown";
    let entry = byAgent.get(agent);
    if (!entry) {
      entry = {
        agent,
        label: agentLabel(agent),
        sessions: 0,
        cost: 0,
        tokens: 0,
      };
      byAgent.set(agent, entry);
    }
    entry.sessions += 1;
    entry.cost += s.cost;
    entry.tokens += s.tokensInput + s.tokensOutput + s.tokensCacheRead + s.tokensReasoning;
  }
  return Array.from(byAgent.values()).sort((a, b) => b.tokens - a.tokens);
}

// ---------------------------------------------------------------------------
// Top sessions
// ---------------------------------------------------------------------------

export function topSessions(sessions: Session[], count = 5): TopSession[] {
  return sessions
    .map((s) => ({
      session: s,
      tokens: s.tokensInput + s.tokensOutput + s.tokensCacheRead + s.tokensReasoning,
      cost: s.cost,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface OverviewStats {
  totalSessions: number;
  totalMessages: number;
  totalCost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensReasoning: number;
  agents: { agent: string; count: number }[];
  models: { model: string; count: number; label: string }[];
  totalWorkspaces: number;
}

export function computeStats(sessions: Session[]): OverviewStats {
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
    .map(([model, count]) => ({ model, count, label: shortModel(model) }))
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

export function sortByRecent(list: Session[]): Session[] {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
