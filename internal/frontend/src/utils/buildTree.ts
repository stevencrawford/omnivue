import type { Session } from "../hooks/useApi";

export interface TreeNode {
  /** Display name (repository name or session title) */
  name: string;
  /** Full path identifier */
  fullPath: string;
  /** Children nodes (sessions under a repo) */
  children: TreeNode[];
  /** Session data if this is a leaf node */
  session?: Session;
  /** Whether this is a repository group node */
  isGroup: boolean;
}

/**
 * Builds a tree of sessions grouped by repository.
 * Returns repo nodes at the top level, each containing session leaves
 * sorted by updatedAt descending.
 */
export function buildTree(sessions: Session[]): TreeNode[] {
  if (!sessions || sessions.length === 0) return [];

  // Group sessions by repository
  const byRepo = new Map<string, Session[]>();
  for (const session of sessions) {
    const repo = session.repository || "Unknown";
    const existing = byRepo.get(repo);
    if (existing) {
      existing.push(session);
    } else {
      byRepo.set(repo, [session]);
    }
  }

  // Build tree nodes
  const repoNodes: TreeNode[] = [];
  for (const [repo, repoSessions] of byRepo) {
    // Sort sessions by updatedAt descending (most recent first)
    const sorted = [...repoSessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const children: TreeNode[] = sorted.map((session) => ({
      name: session.title || session.id,
      fullPath: `${repo}/${session.id}`,
      children: [],
      session,
      isGroup: false,
    }));

    repoNodes.push({
      name: repo,
      fullPath: repo,
      children,
      isGroup: true,
    });
  }

  // Sort repos: most recently active first
  repoNodes.sort((a, b) => {
    const aLatest = a.children[0]?.session?.updatedAt || "";
    const bLatest = b.children[0]?.session?.updatedAt || "";
    return bLatest.localeCompare(aLatest);
  });

  return repoNodes;
}

/**
 * Formats a relative time string (e.g., "2h ago", "3d ago").
 */
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

/**
 * Formats cost as a readable string.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}
