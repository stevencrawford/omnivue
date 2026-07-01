import type { Session } from "../hooks/useApi";

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
    const created = new Date(s.createdAt);
    return created >= range.start! && created < range.end;
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
    const day = s.createdAt.slice(0, 10); // YYYY-MM-DD
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
        label: shortModelLabel(model),
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

function shortModelLabel(model: string): string {
  if (!model) return "unknown";
  return model
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("github-copilot/", "")
    .replace("claude-", "")
    .replace("gpt-", "");
}

function agentLabel(agent: string): string {
  const map: Record<string, string> = {
    opencode: "OpenCode",
    copilot: "Copilot",
    cursor: "Cursor",
    codex: "Codex",
    "claude-code": "Claude Code",
    pi: "Pi",
  };
  return map[agent] ?? agent;
}
