import type { Session } from "../hooks/types";
import { shortRepoName } from "./buildTree";
import { shortDir } from "./sessionUtils";

/**
 * Workspace-aware grouping. The server enriches each session with the git
 * placement of its final working directory; this module turns that flat list
 * into the collapsible sidebar tree (workspace → worktree → branch).
 *
 * Sessions without git placement fall back to repository grouping so nothing
 * disappears on an older backend or a directory outside a repository.
 */

export type ProjectNodeKind = "workspace" | "worktree" | "branch" | "session";

export interface ProjectNode {
  id: string;
  label: string;
  kind: ProjectNodeKind;
  children: ProjectNode[];
  session?: Session;
  count: number;
  branch?: string;
  external?: boolean;
  missing?: boolean;
  title?: string;
}

const byRecent = (a: Session, b: Session) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const sessionBranch = (session: Session): string => session.branchEnd || session.branch || "";

const sessionDirectory = (session: Session): string =>
  session.directoryEnd || session.directory || "";

/** Root sessions only: sub-agents live in the family selector, not the tree. */
export function rootSessions(sessions: Session[]): Session[] {
  const childIds = new Set<string>();
  for (const session of sessions) {
    if (session.parentId) childIds.add(session.id);
  }
  return sessions.filter((session) => !childIds.has(session.id));
}

export function hasWorkspaceData(sessions: Session[]): boolean {
  return sessions.some((session) => Boolean(session.workspaceRoot));
}

/** True when any workspace has sessions from more than one worktree. */
export function hasMultipleWorktrees(sessions: Session[]): boolean {
  const perWorkspace = new Map<string, Set<string>>();
  for (const session of sessions) {
    if (!session.workspaceRoot) continue;
    const worktrees = perWorkspace.get(session.workspaceRoot) ?? new Set<string>();
    worktrees.add(worktreeKey(session));
    perWorkspace.set(session.workspaceRoot, worktrees);
  }
  return [...perWorkspace.values()].some((worktrees) => worktrees.size > 1);
}

export function worktreeLabel(session: Session): string {
  if (session.worktreeRelPath) return displayRelPath(session.worktreeRelPath);
  if (session.workspaceRoot && session.worktreeRoot === session.workspaceRoot) return "main";
  if (session.isWorktree) return "worktree";
  return shortDir(sessionDirectory(session)) || "main";
}

/** Drop leading ../ segments from an external worktree path for display. */
function displayRelPath(relPath: string): string {
  return relPath.replace(/^(\.\.\/)+/, "");
}

export function workspaceLabel(session: Session): string {
  return (
    session.workspaceName ||
    shortRepoName(session.repository) ||
    shortDir(sessionDirectory(session)) ||
    "Unknown"
  );
}

/** Stable key for a workspace. Falls back to repository for legacy sessions. */
export function workspaceKey(session: Session): string {
  return session.workspaceRoot || `repo:${session.repository || "unknown"}`;
}

function worktreeKey(session: Session): string {
  return session.worktreeRoot || sessionDirectory(session) || "unknown";
}

function worktreeInfo(workspaceRoot: string, sessions: Session[]) {
  const first = sessions[0];
  const branches = [...new Set(sessions.map(sessionBranch).filter(Boolean))].sort();
  const root = first?.worktreeRoot || sessionDirectory(first) || "";
  const relPath = first?.worktreeRelPath || "";
  return {
    root,
    label:
      displayRelPath(relPath) ||
      (root && root === workspaceRoot ? "main" : shortDir(root) || "main"),
    branches,
    external: sessions.some((session) => session.externalWorktree),
    missing: sessions.some((session) => session.worktreeMissing),
    isMain: !relPath && (!root || root === workspaceRoot),
  };
}

function sessionNode(session: Session): ProjectNode {
  return {
    id: `s:${session.id}`,
    label: session.title || session.id,
    kind: "session",
    children: [],
    session,
    count: 1,
    branch: sessionBranch(session),
    title: sessionDirectory(session) || session.repository,
  };
}

function nestedCount(nodes: ProjectNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === "session" ? 1 : node.count), 0);
}

function latestOfNode(node: ProjectNode): string {
  if (node.session) return node.session.updatedAt;
  let value = "";
  for (const child of node.children) {
    const childLatest = latestOfNode(child);
    if (childLatest > value) value = childLatest;
  }
  return value;
}

function branchNodes(parentId: string, sessions: Session[]): ProjectNode[] {
  const grouped = new Map<string, Session[]>();
  for (const session of sessions) {
    const branch = sessionBranch(session) || "no branch";
    const existing = grouped.get(branch);
    if (existing) existing.push(session);
    else grouped.set(branch, [session]);
  }
  return [...grouped.entries()]
    .map(([branch, group]) => {
      const children = [...group].sort(byRecent).map(sessionNode);
      return {
        id: `${parentId}:br:${branch}`,
        label: branch,
        kind: "branch" as const,
        children,
        count: children.length,
        branch,
      };
    })
    .sort((a, b) => latestOfNode(b).localeCompare(latestOfNode(a)));
}

/**
 * buildProjectTree groups root sessions by workspace and worktree. A branch
 * level appears only when a worktree hosted more than one branch; otherwise it
 * would repeat the worktree's own branch badge for no benefit.
 */
export function buildProjectTree(sessions: Session[]): ProjectNode[] {
  const roots = rootSessions(sessions);
  const grouped = new Map<string, Session[]>();
  for (const session of roots) {
    const key = workspaceKey(session);
    const existing = grouped.get(key);
    if (existing) existing.push(session);
    else grouped.set(key, [session]);
  }

  const workspaceNodes: ProjectNode[] = [];
  for (const [key, group] of grouped) {
    const first = group[0];
    const workspaceRoot = first.workspaceRoot || "";
    const label = workspaceLabel(first);
    const workspaceId = `ws:${key}`;

    let children: ProjectNode[];
    if (!workspaceRoot) {
      // Legacy fallback: no git placement, so group by repository only.
      children = [...group].sort(byRecent).map(sessionNode);
    } else {
      const worktreeGroups = new Map<string, Session[]>();
      for (const session of group) {
        const wtKey = worktreeKey(session);
        const existing = worktreeGroups.get(wtKey);
        if (existing) existing.push(session);
        else worktreeGroups.set(wtKey, [session]);
      }

      children = [...worktreeGroups.entries()].flatMap(([wtKey, wtSessions]): ProjectNode[] => {
        const info = worktreeInfo(workspaceRoot, wtSessions);
        const worktreeId = `${workspaceId}:wt:${wtKey}`;
        const branches = [...new Set(wtSessions.map(sessionBranch).filter(Boolean))];
        const branchLevel = branches.length > 1;

        // The main checkout's worktree label is just "main"; adding a branch
        // level beneath it would show "main → main". Hoist its branches to
        // the workspace level instead, keeping linked worktrees as-is.
        if (branchLevel && info.isMain) {
          return branchNodes(worktreeId, wtSessions);
        }

        const leafNodes = branchLevel
          ? branchNodes(worktreeId, wtSessions)
          : [...wtSessions].sort(byRecent).map(sessionNode);
        return [
          {
            id: worktreeId,
            label: info.label,
            kind: "worktree",
            children: leafNodes,
            count: nestedCount(leafNodes),
            branch: !branchLevel ? info.branches[0] : undefined,
            external: info.external,
            missing: info.missing,
            title: info.root,
          },
        ];
      });

      children.sort((a, b) => {
        const aMain = a.label === "main" && !a.external;
        const bMain = b.label === "main" && !b.external;
        if (aMain !== bMain) return aMain ? -1 : 1;
        return latestOfNode(b).localeCompare(latestOfNode(a));
      });
    }

    workspaceNodes.push({
      id: workspaceId,
      label,
      kind: "workspace",
      children,
      count: nestedCount(children),
      title: workspaceRoot || first.repository,
      external: children.some((child) => child.external),
    });
  }

  workspaceNodes.sort((a, b) => latestOfNode(b).localeCompare(latestOfNode(a)));
  return workspaceNodes;
}

/** Branch label for a session header: end branch, falling back to git branch. */
export function sessionBranchLabel(session: Session): string {
  return sessionBranch(session);
}
