import { describe, expect, it } from "vitest";
import { activeSessionFamily, buildSessionFamily, resolveFamilyRoot } from "../sessionFamily";
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

describe("resolveFamilyRoot", () => {
  it("returns null for a null id", () => {
    expect(resolveFamilyRoot([], null)).toBeNull();
  });

  it("returns the session itself when it has no parent", () => {
    const sessions = [baseSession({ id: "root" })];
    expect(resolveFamilyRoot(sessions, "root")).toBe("root");
  });

  it("walks up to the top-most ancestor", () => {
    const sessions = [
      baseSession({ id: "root" }),
      baseSession({ id: "child", parentId: "root" }),
      baseSession({ id: "grandchild", parentId: "child" }),
    ];
    expect(resolveFamilyRoot(sessions, "grandchild")).toBe("root");
  });

  it("returns the id unchanged when it is not in the list", () => {
    expect(resolveFamilyRoot([baseSession({ id: "root" })], "missing")).toBe("missing");
  });

  it("terminates on a parent cycle", () => {
    const sessions = [
      baseSession({ id: "a", parentId: "b" }),
      baseSession({ id: "b", parentId: "a" }),
    ];
    // A cycle has no true root; the guard just has to terminate on a member.
    expect(["a", "b"]).toContain(resolveFamilyRoot(sessions, "a"));
  });
});

describe("buildSessionFamily", () => {
  it("lists Main first, then sub-agents flattened in creation order", () => {
    const sessions = [
      baseSession({ id: "root", title: "Root", createdAt: "2024-01-01T00:00:00Z" }),
      baseSession({
        id: "sub-b",
        parentId: "root",
        subAgent: "Beta",
        createdAt: "2024-01-03T00:00:00Z",
      }),
      baseSession({
        id: "sub-a",
        parentId: "root",
        subAgent: "Alpha",
        createdAt: "2024-01-02T00:00:00Z",
      }),
    ];
    const family = buildSessionFamily(sessions, "root");
    expect(family.map((m) => m.session.id)).toEqual(["root", "sub-a", "sub-b"]);
    expect(family[0].isMain).toBe(true);
    expect(family[0].label).toBe("Main");
    expect(family[1].label).toBe("Alpha");
    expect(family[2].label).toBe("Beta");
  });

  it("flattens nested sub-agents under their branch", () => {
    const sessions = [
      baseSession({ id: "root" }),
      baseSession({ id: "child", parentId: "root", subAgent: "Child" }),
      baseSession({ id: "grandchild", parentId: "child", subAgent: "Grand" }),
    ];
    const family = buildSessionFamily(sessions, "root");
    expect(family.map((m) => m.session.id)).toEqual(["root", "child", "grandchild"]);
    expect(family.every((m) => m.isMain === (m.session.id === "root"))).toBe(true);
  });

  it("falls back to the title then a numbered label", () => {
    const sessions = [
      baseSession({ id: "root" }),
      baseSession({ id: "s1", parentId: "root", title: "Do the thing" }),
      baseSession({ id: "s2", parentId: "root", title: "" }),
    ];
    const family = buildSessionFamily(sessions, "root");
    expect(family[1].label).toBe("Do the thing");
    expect(family[2].label).toBe("Sub-agent 2");
  });

  it("returns an empty list for an unknown root", () => {
    expect(buildSessionFamily([baseSession({ id: "root" })], "nope")).toEqual([]);
  });
});

describe("activeSessionFamily", () => {
  it("resolves the family when a sub-agent is active", () => {
    const sessions = [
      baseSession({ id: "root" }),
      baseSession({ id: "child", parentId: "root", subAgent: "Child" }),
    ];
    const family = activeSessionFamily(sessions, "child");
    expect(family.map((m) => m.session.id)).toEqual(["root", "child"]);
  });

  it("returns only Main for a lone session, signalling no selector", () => {
    const sessions = [baseSession({ id: "root" })];
    const family = activeSessionFamily(sessions, "root");
    expect(family).toHaveLength(1);
    expect(family[0].isMain).toBe(true);
  });

  it("returns an empty family for a null id", () => {
    expect(activeSessionFamily([baseSession({ id: "root" })], null)).toEqual([]);
  });
});
