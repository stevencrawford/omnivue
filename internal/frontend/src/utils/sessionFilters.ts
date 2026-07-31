import type { Session } from "../hooks/useApi";

export interface SessionFilters {
  agent: string | null;
  project: string | null;
  repository: string | null;
  model: string | null;
}

export function getDistinctValues(
  sessions: Session[],
  field: "agent" | "directory" | "repository" | "model",
): string[] {
  const values = new Set<string>();
  for (const s of sessions) {
    const val = s[field];
    if (val && typeof val === "string") values.add(val);
  }
  return Array.from(values).sort();
}

export function filterSessions(sessions: Session[], filters: SessionFilters): Session[] {
  const hasFilters = Object.values(filters).some((v) => v !== null);
  if (!hasFilters) return sessions;

  return sessions.filter((s) => {
    if (filters.agent && s.agent !== filters.agent) return false;
    if (filters.project && s.directory !== filters.project) return false;
    if (filters.repository && s.repository !== filters.repository) return false;
    if (filters.model && s.model !== filters.model) return false;
    return true;
  });
}

// ─── Stale session filtering ─────────────────────────────────────────

/** Default number of idle days before a completed session is treated as stale. */
export const STALE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * A session is "stale" when it no longer represents active work:
 * explicitly archived by the user, or completed and idle beyond `staleDays`.
 * Active sessions are never stale regardless of age.
 */
export function isStaleSession(
  session: Session,
  now: number = Date.now(),
  staleDays: number = STALE_DAYS,
): boolean {
  if (session.status === "archived") return true;
  if (session.status === "active") return false;
  if (session.status === "completed") {
    const updated = new Date(session.updatedAt).getTime();
    return now - updated > staleDays * MS_PER_DAY;
  }
  return false;
}

/**
 * Splits sessions into those that should be shown by default and those
 * considered stale. Sessions in `keepIds` are always visible even when stale
 * (e.g. the currently-selected session or sessions with unread notifications).
 */
export function splitStaleSessions(
  sessions: Session[],
  now: number,
  staleDays: number,
  keepIds: ReadonlySet<string>,
): { visible: Session[]; stale: Session[] } {
  const visible: Session[] = [];
  const stale: Session[] = [];
  for (const s of sessions) {
    if (keepIds.has(s.id) || !isStaleSession(s, now, staleDays)) {
      visible.push(s);
    } else {
      stale.push(s);
    }
  }
  return { visible, stale };
}
