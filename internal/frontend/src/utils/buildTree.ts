import type { Session } from "../hooks/useApi";

export type SortMode = "recent" | "name" | "agent";

export interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  session?: Session;
  isGroup: boolean;
  childSessions?: Session[];
}

export function buildTree(sessions: Session[], sortMode: SortMode = "recent"): TreeNode[] {
  if (!sessions || sessions.length === 0) return [];

  // Build parent -> children map
  const childMap = new Map<string, Session[]>();
  const childIds = new Set<string>();
  for (const session of sessions) {
    if (session.parentId) {
      childIds.add(session.id);
      const existing = childMap.get(session.parentId) || [];
      existing.push(session);
      childMap.set(session.parentId, existing);
    }
  }

  // Only root sessions go into repo grouping
  const rootSessions = sessions.filter((s) => !childIds.has(s.id));

  const byRepo = new Map<string, Session[]>();
  for (const session of rootSessions) {
    const repo = session.repository || "Unknown";
    const existing = byRepo.get(repo);
    if (existing) {
      existing.push(session);
    } else {
      byRepo.set(repo, [session]);
    }
  }

  const repoNodes: TreeNode[] = [];
  for (const [repo, repoSessions] of byRepo) {
    const sorted = [...repoSessions].sort((a, b) => {
      switch (sortMode) {
        case "name":
          return (a.title || a.id).localeCompare(b.title || b.id);
        case "agent":
          return (
            a.agent.localeCompare(b.agent) ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    const children: TreeNode[] = sorted.map((session) => {
      const childSessions = childMap.get(session.id);
      const childNodes = childSessions
        ? childSessions.map((cs) => ({
            name: cs.title || cs.id,
            fullPath: `${repo}/${session.id}/${cs.id}`,
            children: [],
            session: cs,
            isGroup: false,
          }))
        : [];

      return {
        name: session.title || session.id,
        fullPath: `${repo}/${session.id}`,
        children: childNodes,
        session,
        isGroup: false,
        childSessions,
      };
    });

    repoNodes.push({
      name: repo,
      fullPath: repo,
      children,
      isGroup: true,
    });
  }

  repoNodes.sort((a, b) => {
    switch (sortMode) {
      case "name":
        return a.name.localeCompare(b.name);
      case "agent": {
        const aAgent = a.children[0]?.session?.agent || "";
        const bAgent = b.children[0]?.session?.agent || "";
        return aAgent.localeCompare(bAgent) || a.name.localeCompare(b.name);
      }
      default: {
        const aLatest = a.children[0]?.session?.updatedAt || "";
        const bLatest = b.children[0]?.session?.updatedAt || "";
        return bLatest.localeCompare(aLatest);
      }
    }
  });

  return repoNodes;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function formatCost(cost: number): string {
  if (cost === 0) return "";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}
