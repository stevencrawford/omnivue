import type { Session } from "../hooks/types";

export type GroupMode = "repo" | "cwd" | "model" | "none";

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

/** Last path segment of a working directory (e.g. `/Users/me/foo` → `foo`). */
function shortDir(directory: string): string {
  if (!directory) return "Unknown";
  const parts = directory.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : directory;
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
        children: buildChildTree(cs.id, childMap, childPath, depth + 1),
        session: cs,
        isGroup: false,
      };
    });
}

const byRecent = (a: Session, b: Session) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

export function buildTree(sessions: Session[], groupMode: GroupMode = "repo"): TreeNode[] {
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

  // Only root sessions go into grouping
  const rootSessions = sessions.filter((s) => !childIds.has(s.id));

  const toLeaf = (session: Session): TreeNode => ({
    name: session.title || session.id,
    fullPath: session.id,
    children: buildChildTree(session.id, childMap, session.id, 0),
    session,
    isGroup: false,
    childSessions: childMap.get(session.id),
  });

  // No grouping — a flat, latest-first list of root sessions
  if (groupMode === "none") {
    return [...rootSessions].sort(byRecent).map(toLeaf);
  }

  const groupKey = (session: Session): { key: string; label: string } => {
    switch (groupMode) {
      case "cwd": {
        const key = session.directory || "Unknown";
        return { key, label: session.directory ? shortDir(session.directory) : "Unknown" };
      }
      case "model": {
        const key = session.model || "Unknown";
        return { key, label: key };
      }
      default: {
        const key = session.repository || "Unknown";
        return { key, label: session.repository ? shortRepoName(session.repository) : "Unknown" };
      }
    }
  };

  const byGroup = new Map<string, { label: string; sessions: Session[] }>();
  for (const session of rootSessions) {
    const { key, label } = groupKey(session);
    const existing = byGroup.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      byGroup.set(key, { label, sessions: [session] });
    }
  }

  const groupNodes: TreeNode[] = [];
  for (const [key, { label, sessions: groupSessions }] of byGroup) {
    const children = [...groupSessions].sort(byRecent).map(toLeaf);
    groupNodes.push({
      name: label,
      fullPath: key,
      children,
      isGroup: true,
    });
  }

  // Groups ordered by their most recently updated session
  groupNodes.sort((a, b) => {
    const aLatest = a.children[0]?.session?.updatedAt || "";
    const bLatest = b.children[0]?.session?.updatedAt || "";
    return bLatest.localeCompare(aLatest);
  });

  return groupNodes;
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
