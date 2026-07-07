import { describe, expect, it } from "vitest";
import { buildTree, shortRepoName, relativeTime } from "../buildTree";
import { formatCost } from "../sessionUtils";
import type { Session } from "../../hooks/useApi";

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

describe("shortRepoName", () => {
  it("returns the last path segment", () => {
    expect(shortRepoName("org/repo")).toBe("repo");
  });

  it("returns Unknown for empty string", () => {
    expect(shortRepoName("")).toBe("Unknown");
  });

  it("strips trailing slash", () => {
    expect(shortRepoName("org/repo/")).toBe("repo");
  });
});

describe("buildTree", () => {
  it("groups sessions by repository", () => {
    const sessions = [
      baseSession({ id: "s1", repository: "org/alpha" }),
      baseSession({ id: "s2", repository: "org/beta" }),
    ];
    const tree = buildTree(sessions, "name");
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("alpha");
    expect(tree[1].name).toBe("beta");
  });

  it("nests child sessions under parent", () => {
    const sessions = [
      baseSession({ id: "parent-1", repository: "org/repo" }),
      baseSession({ id: "child-1", parentId: "parent-1", repository: "org/repo" }),
    ];
    const tree = buildTree(sessions, "name");
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].session?.id).toBe("parent-1");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].session?.id).toBe("child-1");
  });

  it("nests grandchildren sessions recursively", () => {
    const sessions = [
      baseSession({ id: "root", repository: "org/repo" }),
      baseSession({ id: "child", parentId: "root", repository: "org/repo" }),
      baseSession({ id: "grandchild", parentId: "child", repository: "org/repo" }),
      baseSession({ id: "great-grandchild", parentId: "grandchild", repository: "org/repo" }),
    ];
    const tree = buildTree(sessions, "name");
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    // root → child → grandchild → great-grandchild
    expect(tree[0].children[0].session?.id).toBe("root");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].session?.id).toBe("child");
    expect(tree[0].children[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].session?.id).toBe("grandchild");
    expect(tree[0].children[0].children[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].children[0].session?.id).toBe("great-grandchild");
  });

  it("handles empty session list", () => {
    expect(buildTree([], "recent")).toEqual([]);
  });
});

describe("relativeTime", () => {
  it('returns "just now" for recent times', () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
  });

  it('returns "Xm ago" for minutes', () => {
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
    expect(relativeTime(fiveMinAgo)).toMatch(/\d+m ago/);
  });

  it('returns "Xh ago" for hours', () => {
    const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
    expect(relativeTime(twoHoursAgo)).toMatch(/\d+h ago/);
  });
});

describe("formatCost", () => {
  it("formats cost", () => {
    expect(formatCost(0.0123)).toBe("$0.01");
  });

  it("returns <$0.01 for very small costs", () => {
    expect(formatCost(0.0001)).toBe("<$0.01");
  });

  it("formats larger costs", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });
});
