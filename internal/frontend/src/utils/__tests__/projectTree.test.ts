import { describe, expect, it } from "vitest";
import type { Session } from "../../hooks/types";
import { buildSessionTree, buildWorkspaceTree, countDetectedWorktrees } from "../projectTree";

const WS = "/workspaces/ws-a";
const FLAT = "/repos/fleet";

function mkSession(overrides: Partial<Session> & Pick<Session, "id">): Session {
  return {
    sourceId: "",
    title: overrides.title ?? `Session ${overrides.id}`,
    repository: overrides.repository ?? "",
    branch: overrides.branch ?? "",
    agent: "claude-code",
    model: "",
    cost: 0,
    directory: overrides.directory ?? "",
    status: "completed",
    createdAt: "",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    messageCount: 2,
    diffFiles: 0,
    diffAdditions: 0,
    diffDeletions: 0,
    ...overrides,
  } as Session;
}

describe("buildSessionTree dispatch", () => {
  it("delegates non-workspace modes to buildTree", () => {
    const repoA = mkSession({ id: "a", repository: "fleet", directory: FLAT });
    expect(buildSessionTree([repoA], "repo")).toEqual(buildSessionTree([repoA], "repo"));
    expect(buildSessionTree([repoA], "none")).toHaveLength(1);
  });
});

describe("buildWorkspaceTree", () => {
  it("renders a flat repo identically to repo mode (no child layer)", () => {
    const s1 = mkSession({
      id: "s1",
      repository: "fleet",
      directory: FLAT,
      workspaceRoot: FLAT,
      worktreeRoot: FLAT,
      branch: "main",
    });
    const s2 = mkSession({
      id: "s2",
      repository: "fleet",
      directory: FLAT,
      workspaceRoot: FLAT,
      worktreeRoot: FLAT,
      branch: "main",
      updatedAt: "2026-02-01T00:00:00Z",
    });

    const nodes = buildWorkspaceTree([s1, s2]);
    expect(nodes).toHaveLength(1);
    const wsNode = nodes[0]!;
    expect(wsNode.kind).toBe("workspace");
    expect(wsNode.name).toBe("fleet");
    expect(wsNode.children.every((c) => !c.isGroup)).toBe(true);
    expect(wsNode.children).toHaveLength(2);
  });

  it("splits flat-repo sessions by branch only when branches differ", () => {
    const base = { workspaceRoot: FLAT, worktreeRoot: FLAT, directory: FLAT, repository: "fleet" };
    const s1 = mkSession({ id: "s1", branch: "main", ...base });
    const s2 = mkSession({ id: "s2", branch: "feat/panel", ...base });

    // Single branch: no branch layer.
    const single = buildWorkspaceTree([s1]);
    expect(single[0]!.children.every((c) => !c.isGroup)).toBe(true);

    // Two branches: branch sub-groups appear.
    const split = buildSessionTree([s1, s2], "workspace");
    expect(split[0]!.children).toHaveLength(2);
    const kinds = split[0]!.children.map((c) => c.kind);
    expect(kinds.every((k) => k === "branch")).toBe(true);
    expect(split[0]!.children.map((c) => c.name).sort()).toEqual(["feat/panel", "main"]);
  });

  it("groups the bare-workspace layout with worktree sub-nodes", () => {
    const s1 = mkSession({
      id: "s1",
      repository: "fleet",
      directory: `${WS}/main`,
      workspaceRoot: WS,
      worktreeRoot: `${WS}/main`,
      worktreeRelPath: "main",
      branch: "main",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    const s2 = mkSession({
      id: "s2",
      repository: "fleet",
      directory: `${WS}/fix/fix-a`,
      workspaceRoot: WS,
      worktreeRoot: `${WS}/fix/fix-a`,
      worktreeRelPath: "fix/fix-a",
      branch: "fix/fix-a",
    });
    const s3 = mkSession({
      id: "s3",
      repository: "fleet",
      directory: `${WS}/feat/feature-a`,
      workspaceRoot: WS,
      worktreeRoot: `${WS}/feat/feature-a`,
      worktreeRelPath: "feat/feature-a",
      branch: "feat/feature-a",
      updatedAt: "2026-01-05T00:00:00Z",
    });

    const nodes = buildWorkspaceTree([s1, s2, s3]);
    expect(nodes).toHaveLength(1);
    const wsNode = nodes[0]!;
    expect(wsNode.name).toBe("ws-a");
    // Worktree groups sorted by their most recent session: feat first.
    expect(wsNode.children.filter((c) => c.isGroup).map((c) => c.name)).toEqual([
      "feat/feature-a",
      "main",
      "fix/fix-a",
    ]);
  });

  it("keeps unresolved sessions grouped by repository (fallback)", () => {
    const resolved = mkSession({
      id: "r",
      repository: "fleet",
      directory: FLAT,
      workspaceRoot: FLAT,
      worktreeRoot: FLAT,
    });
    const stray = mkSession({
      id: "stray",
      repository: "notes-scratch",
      directory: "/Users/me/notes",
    });

    const nodes = buildWorkspaceTree([resolved, stray]);
    expect(nodes).toHaveLength(2);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("fleet");
    expect(names).toContain("notes-scratch");
  });

  it("sorts workspaces by their most recently updated session", () => {
    const newer = mkSession({
      id: "n",
      repository: "fleet",
      directory: FLAT,
      workspaceRoot: FLAT,
      worktreeRoot: FLAT,
      updatedAt: "2026-03-01T00:00:00Z",
    });
    const older = mkSession({
      id: "o",
      repository: "other",
      directory: WS,
      workspaceRoot: WS,
      worktreeRoot: WS,
      worktreeRelPath: "main",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const nodes = buildWorkspaceTree([older, newer]);
    expect(nodes[0]!.name).toBe("fleet");
    expect(nodes[1]!.name).toBe("ws-a");
  });

  it("returns an empty tree for empty input", () => {
    expect(buildWorkspaceTree([])).toEqual([]);
  });
});

describe("countDetectedWorktrees", () => {
  it("counts distinct workspace+worktree pairs", () => {
    const sessions: Session[] = [
      mkSession({ id: "1", workspaceRoot: WS, worktreeRelPath: "main" }),
      mkSession({ id: "2", workspaceRoot: WS, worktreeRelPath: "fix/fix-a" }),
      // Same pair as session 1: not double-counted.
      mkSession({ id: "3", workspaceRoot: WS, worktreeRelPath: "main" }),
      // Flat sessions and unresolved sessions are not worktrees.
      mkSession({ id: "4", workspaceRoot: FLAT, worktreeRoot: FLAT }),
      mkSession({ id: "5", directory: "/no/git" }),
    ];
    expect(countDetectedWorktrees(sessions)).toBe(2);
  });

  it("is zero when no session resolved to a worktree", () => {
    const sessions = [mkSession({ id: "1", workspaceRoot: FLAT, worktreeRoot: FLAT })];
    expect(countDetectedWorktrees(sessions)).toBe(0);
  });
});
