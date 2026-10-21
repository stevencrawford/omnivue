import type { Session } from "../hooks/types";
import { buildTree, type GroupMode, type TreeNode } from "./buildTree";

/**
 * Separator used by workspace-group fullPaths. Unlike buildTree's single-level
 * keys (a raw repository string), workspace mode builds a hierarchy, so keys
 * are joined with a delimiter that cannot appear inside a group segment.
 */
export const GROUP_SEPARATOR = "||";

export function buildSessionTree(sessions: Session[], groupMode: GroupMode): TreeNode[] {
  return groupMode === "workspace" ? buildWorkspaceTree(sessions) : buildTree(sessions, groupMode);
}

const byRecent = (a: Session, b: Session) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

/** Last path segment of a workspace root, for the top-level node label. */
function shortWorkspaceName(root: string): string {
  const parts = root.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : root;
}

interface SubGroup {
  key: string;
  name: string;
  kind: "worktree" | "branch";
  sessions: Session[];
}

interface WorkspaceGroup {
  root: string;
  latest: string;
  primary: Session[];
  subs: Map<string, SubGroup>;
}

/**
 * Groups sessions by their git workspace layout: one node per workspace root,
 * with linked worktrees (and, for flat repos, distinct branches) as child
 * group nodes. Degrades honestly:
 *
 * - A workspace whose sessions all share a single worktree and branch looks
 *   exactly like a repo-mode group (no child layer at all).
 * - Sessions without git resolution fall back to repository-name grouping,
 *   like repo mode.
 */
export function buildWorkspaceTree(sessions: Session[]): TreeNode[] {
  if (!sessions || sessions.length === 0) return [];

  // Sub-agents are surfaced in the main-view family selector, not the tree.
  const childIds = new Set<string>();
  for (const session of sessions) {
    if (session.parentId) childIds.add(session.id);
  }
  const roots = sessions.filter((s) => !childIds.has(s.id));

  const toLeaf = (session: Session): TreeNode => ({
    name: session.title || session.id,
    fullPath: session.id,
    children: [],
    session,
    isGroup: false,
  });

  const workspaces = new Map<string, WorkspaceGroup>();
  const unresolved: Session[] = [];
  for (const session of roots) {
    if (!session.workspaceRoot) {
      unresolved.push(session);
      continue;
    }
    let group = workspaces.get(session.workspaceRoot);
    if (!group) {
      group = { root: session.workspaceRoot, latest: "", primary: [], subs: new Map() };
      workspaces.set(session.workspaceRoot, group);
    }
    if (session.worktreeRelPath) {
      const key = `wt:${session.worktreeRelPath}`;
      let sub = group.subs.get(key);
      if (!sub) {
        sub = { key, name: session.worktreeRelPath, kind: "worktree", sessions: [] };
        group.subs.set(key, sub);
      }
      sub.sessions.push(session);
    } else {
      group.primary.push(session);
    }
  }

  // Flat-repo rule: split the primary worktree by branch only when more than
  // one branch is in play; otherwise the sessions attach directly to the
  // workspace node and the tree is indistinguishable from repo mode.
  const nodes: TreeNode[] = [];
  for (const group of workspaces.values()) {
    const branches = new Set(group.primary.map((s) => s.branch).filter(Boolean));
    const children: TreeNode[] = [];

    if (branches.size > 1) {
      const grouped = new Map<string, Session[]>();
      for (const session of group.primary) {
        const key = session.branch || "Unknown";
        const list = grouped.get(key);
        if (list) list.push(session);
        else grouped.set(key, [session]);
      }
      for (const [branch, list] of grouped) {
        children.push(...subToTree(list, branch, "branch", group));
      }
    } else {
      children.push(...group.primary.sort(byRecent).map(toLeaf));
    }

    for (const sub of group.subs.values()) {
      children.push(...subToTree(sub.sessions, sub.name, sub.kind, group));
    }

    // Newest-first, whether the child is a leaf or a sub group.
    children.sort((a, b) => firstUpdated(b).localeCompare(firstUpdated(a)));

    const node: TreeNode = {
      name: shortWorkspaceName(group.root),
      fullPath: `ws${GROUP_SEPARATOR}${group.root}`,
      children,
      isGroup: true,
      kind: "workspace",
    };
    nodes.push(node);
  }

  // Sessions without git resolution keep repo-mode grouping, so nothing is
  // ever lost by switching grouping modes.
  if (unresolved.length > 0) {
    nodes.push(...buildTree(unresolved, "repo"));
  }

  nodes.sort((a, b) => firstUpdated(b).localeCompare(firstUpdated(a)));
  return nodes;
}

function subToTree(
  groupSessions: Session[],
  name: string,
  kind: "worktree" | "branch",
  group: WorkspaceGroup,
): TreeNode[] {
  const sorted = [...groupSessions].sort(byRecent);
  return [
    {
      name,
      fullPath: `ws${GROUP_SEPARATOR}${group.root}${GROUP_SEPARATOR}${name}`,
      children: sorted.map((session) => ({
        name: session.title || session.id,
        fullPath: session.id,
        children: [],
        session,
        isGroup: false,
      })),
      isGroup: true,
      kind,
    },
  ];
}

/** Most recently updated session within a node, as a sortable string. */
function firstUpdated(node: TreeNode): string {
  if (node.session) return node.session.updatedAt;
  for (const child of node.children) {
    if (child.session) return child.session.updatedAt;
  }
  return "";
}

/**
 * Distinct worktrees seen across resolved sessions — the auto-detection
 * signal behind the "N worktrees detected" sidebar nudge.
 */
export function countDetectedWorktrees(sessions: Session[]): number {
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!session.workspaceRoot || !session.worktreeRelPath) continue;
    seen.add(`${session.workspaceRoot}${GROUP_SEPARATOR}${session.worktreeRelPath}`);
  }
  return seen.size;
}
