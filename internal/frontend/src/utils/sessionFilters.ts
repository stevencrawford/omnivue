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

export function filterSessions(
  sessions: Session[],
  filters: SessionFilters,
): Session[] {
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
