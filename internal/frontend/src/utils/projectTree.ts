import type { Session } from "../hooks/types";
import { shortRepoName } from "./buildTree";
import { shortDir } from "./sessionUtils";

/**
 * Workspace-aware grouping. The server enriches each session with the git
 * placement of its final working directory; this module turns that flat list
 * into the two shapes the UI needs:
 *
 *   - buildProjectTree  → collapsible sidebar tree (workspace → worktree → branch)
 *   - buildWorkspaces   → Projects screen / sidebar summaries
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

export interface WorktreeSummary {
  root: string;
  label: string;
  relPath: string;
  branches: string[];
  sessions: Session[];
  external: boolean;
  missing: boolean;
  isMain: boolean;
  lastUpdated: string;
}

export interface WorkspaceSummary {
  key: string;
  root: string;
  name: string;
  kind: string;
  remoteUrl?: string;
  worktrees: WorktreeSummary[];
  sessions: Session[];
  sessionCount: number;
  lastUpdated: string;
  hasMultipleWorktrees: boolean;
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

function latest(sessions: Session[]): string {
  let value = "";
  for (const session of sessions) {
    if (session.updatedAt > value) value = session.updatedAt;
  }
  return value;
}

function worktreeSummary(workspaceRoot: string, sessions: Session[]): WorktreeSummary {
  const first = sessions[0];
  const branches = [...new Set(sessions.map(sessionBranch).filter(Boolean))].sort();
  const root = first?.worktreeRoot || sessionDirectory(first) || "";
  const relPath = first?.worktreeRelPath || "";
  return {
    root,
    label:
      displayRelPath(relPath) ||
      (root && root === workspaceRoot ? "main" : shortDir(root) || "main"),
    relPath,
    branches,
    sessions: [...sessions].sort(byRecent),
    external: sessions.some((session) => session.externalWorktree),
    missing: sessions.some((session) => session.worktreeMissing),
    isMain: !relPath && (!root || root === workspaceRoot),
    lastUpdated: latest(sessions),
  };
}

/**
 * buildWorkspaces returns git-derived workspaces, newest first. Sessions with
 * no git placement are omitted: the Projects surface is specifically about
 * repositories the user can see and navigate, not a second repository list.
 */
export function buildWorkspaces(sessions: Session[]): WorkspaceSummary[] {
  const roots = rootSessions(sessions).filter((session) => session.workspaceRoot);
  const grouped = new Map<string, Session[]>();
  for (const session of roots) {
    const key = workspaceKey(session);
    const existing = grouped.get(key);
    if (existing) existing.push(session);
    else grouped.set(key, [session]);
  }

  const workspaces: WorkspaceSummary[] = [];
  for (const [key, group] of grouped) {
    const first = group[0];
    const root = first.workspaceRoot || "";
    const worktreeGroups = new Map<string, Session[]>();
    for (const session of group) {
      const wtKey = worktreeKey(session);
      const existing = worktreeGroups.get(wtKey);
      if (existing) existing.push(session);
      else worktreeGroups.set(wtKey, [session]);
    }
    const worktrees = [...worktreeGroups.values()].map((group) => worktreeSummary(root, group));
    worktrees.sort((a, b) => {
      if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
      return b.lastUpdated.localeCompare(a.lastUpdated);
    });
    workspaces.push({
      key,
      root,
      name: first.workspaceName || shortRepoName(first.repository) || root,
      kind: first.workspaceKind || "standard",
      remoteUrl: first.remoteUrl,
      worktrees,
      sessions: [...group].sort(byRecent),
      sessionCount: group.length,
      lastUpdated: latest(group),
      hasMultipleWorktrees: worktrees.length > 1,
    });
  }

  workspaces.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  return workspaces;
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
    .sort((a, b) => {
      const aLatest = a.children[0]?.session?.updatedAt || "";
      const bLatest = b.children[0]?.session?.updatedAt || "";
      return bLatest.localeCompare(aLatest);
    });
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

      children = [...worktreeGroups.entries()].map(([wtKey, wtSessions]) => {
        const summary = worktreeSummary(workspaceRoot, wtSessions);
        const worktreeId = `${workspaceId}:wt:${wtKey}`;
        const branches = [...new Set(wtSessions.map(sessionBranch).filter(Boolean))];
        const branchLevel = branches.length > 1;
        const leafNodes = branchLevel
          ? branchNodes(worktreeId, wtSessions)
          : [...wtSessions].sort(byRecent).map(sessionNode);
        return {
          id: worktreeId,
          label: summary.label,
          kind: "worktree" as const,
          children: leafNodes,
          count: nestedCount(leafNodes),
          branch: !branchLevel ? summary.branches[0] : undefined,
          external: summary.external,
          missing: summary.missing,
          title: summary.root,
        };
      });

      children.sort((a, b) => {
        const aMain = a.label === "main" && !a.external;
        const bMain = b.label === "main" && !b.external;
        if (aMain !== bMain) return aMain ? -1 : 1;
        const aLatest = a.children[0]?.session?.updatedAt || "";
        const bLatest = b.children[0]?.session?.updatedAt || "";
        return bLatest.localeCompare(aLatest);
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

  workspaceNodes.sort((a, b) => {
    const aLatest = a.children[0]?.session?.updatedAt || "";
    const bLatest = b.children[0]?.session?.updatedAt || "";
    return bLatest.localeCompare(aLatest);
  });
  return workspaceNodes;
}

/** Branch label for a session header: end branch, falling back to git branch. */
export function sessionBranchLabel(session: Session): string {
  return sessionBranch(session);
}
