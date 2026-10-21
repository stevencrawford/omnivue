import { describe, expect, it } from "vitest";
import {
  buildProjectTree,
  buildWorkspaces,
  hasWorkspaceData,
  rootSessions,
  workspaceLabel,
  worktreeLabel,
} from "../projectTree";
import type { Session } from "../../hooks/types";

const baseSession = (overrides: Partial<Session>): Session => ({
  id: "ses-1",
  sourceId: "src-1",
  title: "Test Session",
  repository: "",
  branch: "",
  agent: "opencode",
  model: "claude-3",
  cost: 0,
  directory: "/tmp",
  status: "completed",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  tokensInput: 0,
  tokensOutput: 0,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  messageCount: 0,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
  ...overrides,
});

const workspaceSession = (overrides: Partial<Session>): Session =>
  baseSession({
    workspaceRoot: "/work/repo",
    workspaceName: "repo",
    workspaceKind: "standard",
    worktreeRoot: "/work/repo",
    worktreeRelPath: "",
    repository: "acme/repo",
    branch: "main",
    branchEnd: "main",
    directory: "/work/repo",
    directoryEnd: "/work/repo",
    ...overrides,
  });

describe("rootSessions", () => {
  it("drops child sessions", () => {
    const parent = baseSession({ id: "parent" });
    const child = baseSession({ id: "child", parentId: "parent" });
    expect(rootSessions([parent, child]).map((s) => s.id)).toEqual(["parent"]);
  });
});

describe("workspace labels", () => {
  it("prefers the enriched workspace name", () => {
    expect(workspaceLabel(workspaceSession({}))).toBe("repo");
  });

  it("falls back to repository basename when there is no git data", () => {
    expect(workspaceLabel(baseSession({ repository: "acme/legacy" }))).toBe("legacy");
  });

  it("uses the main worktree label for the root checkout", () => {
    expect(worktreeLabel(workspaceSession({}))).toBe("main");
  });

  it("uses the relative path for linked worktrees", () => {
    expect(
      worktreeLabel(
        workspaceSession({
          worktreeRoot: "/work/repo/.worktrees/feat/x",
          worktreeRelPath: "feat/x",
          isWorktree: true,
        }),
      ),
    ).toBe("feat/x");
  });

  it("detects whether any session has git placement", () => {
    expect(hasWorkspaceData([baseSession({})])).toBe(false);
    expect(hasWorkspaceData([workspaceSession({})])).toBe(true);
  });
});

describe("buildProjectTree", () => {
  it("groups by workspace, then worktree", () => {
    const nodes = buildProjectTree([
      workspaceSession({ id: "main-1", title: "Main work" }),
      workspaceSession({
        id: "feature-1",
        title: "Feature work",
        worktreeRoot: "/work/repo/.worktrees/feat/x",
        worktreeRelPath: "feat/x",
        branch: "feat/x",
        branchEnd: "feat/x",
        isWorktree: true,
      }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("workspace");
    expect(nodes[0]?.label).toBe("repo");
    expect(nodes[0]?.children.map((child) => child.label)).toEqual(["main", "feat/x"]);
    expect(nodes[0]?.children[0]?.children[0]?.session?.id).toBe("main-1");
  });

  it("adds a branch level only when a worktree has multiple branches", () => {
    const nodes = buildProjectTree([
      workspaceSession({ id: "a", branch: "main", branchEnd: "main" }),
      workspaceSession({ id: "b", branch: "feat/a", branchEnd: "feat/a" }),
    ]);

    const worktree = nodes[0]?.children[0];
    expect(worktree?.kind).toBe("worktree");
    expect(worktree?.children.map((child) => child.kind)).toEqual(["branch", "branch"]);
    expect(worktree?.children.map((child) => child.label).sort()).toEqual(["feat/a", "main"]);
  });

  it("collapses the branch level when every session shares a branch", () => {
    const nodes = buildProjectTree([workspaceSession({ id: "a" }), workspaceSession({ id: "b" })]);
    const worktree = nodes[0]?.children[0];
    expect(worktree?.children.every((child) => child.kind === "session")).toBe(true);
    expect(worktree?.branch).toBe("main");
  });

  it("groups legacy sessions by repository without inventing a worktree", () => {
    const nodes = buildProjectTree([
      baseSession({ id: "legacy-1", repository: "acme/legacy" }),
      baseSession({ id: "legacy-2", repository: "acme/legacy" }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("legacy");
    expect(nodes[0]?.children.every((child) => child.kind === "session")).toBe(true);
  });

  it("excludes sub-agent sessions", () => {
    const nodes = buildProjectTree([
      workspaceSession({ id: "parent" }),
      workspaceSession({ id: "child", parentId: "parent" }),
    ]);
    expect(nodes[0]?.count).toBe(1);
  });
});

describe("buildWorkspaces", () => {
  it("summarises sessions, worktrees, and branches", () => {
    const workspaces = buildWorkspaces([
      workspaceSession({ id: "main-1" }),
      workspaceSession({
        id: "feature-1",
        worktreeRoot: "/work/repo/.worktrees/feat/x",
        worktreeRelPath: "feat/x",
        branch: "feat/x",
        branchEnd: "feat/x",
        isWorktree: true,
        externalWorktree: false,
      }),
      workspaceSession({
        id: "external-1",
        worktreeRoot: "/elsewhere/x",
        worktreeRelPath: "../elsewhere/x",
        branch: "fix/y",
        branchEnd: "fix/y",
        isWorktree: true,
        externalWorktree: true,
      }),
    ]);

    expect(workspaces).toHaveLength(1);
    const workspace = workspaces[0]!;
    expect(workspace.sessionCount).toBe(3);
    expect(workspace.worktrees).toHaveLength(3);
    expect(workspace.hasMultipleWorktrees).toBe(true);
    expect(workspace.worktrees[0]?.isMain).toBe(true);
    expect(workspace.worktrees.map((worktree) => worktree.label)).toEqual([
      "main",
      "feat/x",
      "elsewhere/x",
    ]);
  });

  it("omits sessions without git placement", () => {
    expect(buildWorkspaces([baseSession({ repository: "acme/legacy" })])).toEqual([]);
  });

  it("orders workspaces by most recent session", () => {
    const older = workspaceSession({
      id: "older",
      workspaceRoot: "/work/older",
      workspaceName: "older",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    const newer = workspaceSession({
      id: "newer",
      workspaceRoot: "/work/newer",
      workspaceName: "newer",
      updatedAt: "2024-06-01T00:00:00Z",
    });
    expect(buildWorkspaces([older, newer]).map((w) => w.name)).toEqual(["newer", "older"]);
  });
});
