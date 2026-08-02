import { describe, expect, it } from "vitest";
import { isStaleSession, splitStaleSessions, STALE_DAYS } from "../sessionFilters";
import type { Session } from "../../hooks/useApi";

const MS_PER_DAY = 86_400_000;

const NOW = new Date("2024-06-15T12:00:00Z").getTime();

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
  updatedAt: new Date(NOW).toISOString(),
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

function updatedDaysAgo(days: number): string {
  return new Date(NOW - days * MS_PER_DAY).toISOString();
}

describe("isStaleSession", () => {
  it("never marks active sessions as stale", () => {
    expect(isStaleSession(baseSession({ status: "active" }), NOW, STALE_DAYS)).toBe(false);
  });

  it("marks archived sessions as stale regardless of age", () => {
    expect(
      isStaleSession(
        baseSession({ status: "archived", updatedAt: updatedDaysAgo(1) }),
        NOW,
        STALE_DAYS,
      ),
    ).toBe(true);
  });

  it("keeps completed sessions within the threshold visible", () => {
    expect(
      isStaleSession(
        baseSession({ status: "completed", updatedAt: updatedDaysAgo(STALE_DAYS - 1) }),
        NOW,
        STALE_DAYS,
      ),
    ).toBe(false);
  });

  it("marks completed sessions older than the threshold as stale", () => {
    expect(
      isStaleSession(
        baseSession({ status: "completed", updatedAt: updatedDaysAgo(STALE_DAYS + 1) }),
        NOW,
        STALE_DAYS,
      ),
    ).toBe(true);
  });

  it("treats the exact threshold boundary as not stale", () => {
    expect(
      isStaleSession(
        baseSession({ status: "completed", updatedAt: updatedDaysAgo(STALE_DAYS) }),
        NOW,
        STALE_DAYS,
      ),
    ).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(
      isStaleSession(baseSession({ status: "completed", updatedAt: updatedDaysAgo(30) }), NOW, 60),
    ).toBe(false);
    expect(
      isStaleSession(baseSession({ status: "completed", updatedAt: updatedDaysAgo(30) }), NOW, 7),
    ).toBe(true);
  });

  it("treats unknown statuses as visible", () => {
    expect(isStaleSession(baseSession({ status: "whatever" }), NOW, STALE_DAYS)).toBe(false);
  });
});

describe("splitStaleSessions", () => {
  const recent = baseSession({ id: "recent", updatedAt: updatedDaysAgo(1) });
  const oldCompleted = baseSession({
    id: "old",
    status: "completed",
    updatedAt: updatedDaysAgo(30),
  });
  const archived = baseSession({
    id: "archived",
    status: "archived",
    updatedAt: updatedDaysAgo(30),
  });
  const active = baseSession({ id: "active", status: "active", updatedAt: updatedDaysAgo(30) });

  it("splits into visible and stale buckets", () => {
    const { visible, stale } = splitStaleSessions(
      [recent, oldCompleted, archived, active],
      NOW,
      STALE_DAYS,
      new Set(),
    );
    expect(visible.map((s) => s.id)).toEqual(["recent", "active"]);
    expect(stale.map((s) => s.id).sort()).toEqual(["archived", "old"]);
  });

  it("forces stale sessions in keepIds into the visible bucket", () => {
    const { visible, stale } = splitStaleSessions(
      [recent, oldCompleted, archived],
      NOW,
      STALE_DAYS,
      new Set(["old"]),
    );
    expect(visible.map((s) => s.id).sort()).toEqual(["old", "recent"]);
    expect(stale.map((s) => s.id)).toEqual(["archived"]);
  });

  it("returns everything visible when nothing is stale", () => {
    const { visible, stale } = splitStaleSessions([recent, active], NOW, STALE_DAYS, new Set());
    expect(visible.map((s) => s.id)).toEqual(["recent", "active"]);
    expect(stale).toEqual([]);
  });
});
