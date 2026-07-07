import type { Session } from "../hooks/useApi";

export type SortMode = "recent" | "name" | "agent" | "cost-asc" | "cost-desc";

export interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  session?: Session;
  isGroup: boolean;
  childSessions?: Session[];
}

/** Last path segment for display (e.g. `~/dev/foo` → `foo`). */
export function shortRepoName(repository: string): string {
  if (!repository) return "Unknown";
  const normalized = repository.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : repository;
}

export function parentIdsWithChildren(sessions: Session[]): Set<string> {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (s.parentId) ids.add(s.parentId);
  }
  return ids;
}

const MAX_CHILD_DEPTH = 10;

function buildChildTree(
  parentId: string,
  childMap: Map<string, Session[]>,
  repoKey: string,
  parentPath: string,
  depth: number,
): TreeNode[] {
  if (depth >= MAX_CHILD_DEPTH) return [];
  const children = childMap.get(parentId);
  if (!children) return [];
  return [...children]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((cs) => {
      const childPath = `${parentPath}/${cs.id}`;
      return {
        name: cs.title || cs.id.slice(0, 8),
        fullPath: childPath,
        children: buildChildTree(cs.id, childMap, repoKey, childPath, depth + 1),
        session: cs,
        isGroup: false,
      };
    });
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

  const byRepo = new Map<string, { label: string; sessions: Session[] }>();
  for (const session of rootSessions) {
    const repoKey = session.repository || "Unknown";
    const existing = byRepo.get(repoKey);
    if (existing) {
      existing.sessions.push(session);
    } else {
      byRepo.set(repoKey, { label: shortRepoName(repoKey), sessions: [session] });
    }
  }

  const repoNodes: TreeNode[] = [];
  for (const [repoKey, { label: repoLabel, sessions: repoSessions }] of byRepo) {
    const sorted = [...repoSessions].sort((a, b) => {
      switch (sortMode) {
        case "name":
          return (a.title || a.id).localeCompare(b.title || b.id);
        case "agent":
          return (
            a.agent.localeCompare(b.agent) ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        case "cost-asc":
          return (
            a.cost - b.cost || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        case "cost-desc":
          return (
            b.cost - a.cost || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    const children: TreeNode[] = sorted.map((session) => {
      const childSessions = childMap.get(session.id);
      return {
        name: session.title || session.id,
        fullPath: `${repoKey}/${session.id}`,
        children: buildChildTree(session.id, childMap, repoKey, `${repoKey}/${session.id}`, 0),
        session,
        isGroup: false,
        childSessions,
      };
    });

    repoNodes.push({
      name: repoLabel,
      fullPath: repoKey,
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
      case "cost-asc": {
        const aCost = a.children[0]?.session?.cost ?? 0;
        const bCost = b.children[0]?.session?.cost ?? 0;
        return aCost - bCost || a.name.localeCompare(b.name);
      }
      case "cost-desc": {
        const aCost = a.children[0]?.session?.cost ?? 0;
        const bCost = b.children[0]?.session?.cost ?? 0;
        return bCost - aCost || a.name.localeCompare(b.name);
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
