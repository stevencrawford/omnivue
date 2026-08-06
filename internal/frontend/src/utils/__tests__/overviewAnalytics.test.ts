import { describe, expect, it } from "vitest";
import { aggregateDailyAnalytics, sessionDurationMs } from "../overviewAnalytics";
import type { Session } from "../../hooks/types";

function mkSession(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    sourceId: "src1",
    title: "Test",
    repository: "org/repo",
    branch: "main",
    agent: "opencode",
    model: "claude-sonnet",
    cost: 0,
    directory: "/home/user/projects/my-app",
    status: "completed",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T01:00:00Z",
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
  };
}

describe("sessionDurationMs", () => {
  it("returns the wall-clock span for a completed session", () => {
    const s = mkSession({
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:45:00Z",
    });
    expect(sessionDurationMs(s)).toBe(45 * 60 * 1000);
  });

  it("returns null for an active session", () => {
    const s = mkSession({ status: "active" });
    expect(sessionDurationMs(s)).toBeNull();
  });

  it("returns null when timestamps are degenerate", () => {
    const s = mkSession({
      createdAt: "2024-01-01T01:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    expect(sessionDurationMs(s)).toBeNull();
  });
});

describe("aggregateDailyAnalytics", () => {
  const range = {
    start: new Date("2024-01-01T00:00:00Z"),
    end: new Date("2024-01-04T00:00:00Z"),
  };

  it("averages per-session metrics by day and prefills quiet days", () => {
    const sessions = [
      mkSession({
        id: "a",
        updatedAt: "2024-01-01T12:00:00Z",
        tokensInput: 100,
        tokensOutput: 50,
        tokensCacheRead: 0,
        tokensReasoning: 0,
        messageCount: 10,
        diffFiles: 2,
        cost: 1,
      }),
      mkSession({
        id: "b",
        updatedAt: "2024-01-02T12:00:00Z",
        tokensInput: 300,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensReasoning: 0,
        messageCount: 20,
        diffFiles: 4,
        cost: 2,
      }),
    ];

    const series = aggregateDailyAnalytics(sessions, range);

    expect(series.map((p) => p.date)).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(series[0]).toMatchObject({
      sessions: 1,
      avgTokensPerSession: 150,
      avgInput: 100,
      avgOutput: 50,
      avgMessagesPerSession: 10,
      avgDiffFilesPerSession: 2,
      avgCostPerSession: 1,
      avgDurationMs: 12 * 60 * 60 * 1000,
    });
    expect(series[1]).toMatchObject({
      sessions: 1,
      avgTokensPerSession: 300,
      avgMessagesPerSession: 20,
    });
    expect(series[2]).toMatchObject({ sessions: 0, avgTokensPerSession: 0 });
  });

  it("excludes active sessions from the duration average", () => {
    const sessions = [
      mkSession({
        id: "done",
        status: "completed",
        updatedAt: "2024-01-01T12:00:00Z",
      }),
      mkSession({
        id: "live",
        status: "active",
        updatedAt: "2024-01-01T13:00:00Z",
      }),
    ];

    const series = aggregateDailyAnalytics(sessions, range);

    expect(series[0].sessions).toBe(2);
    expect(series[0].avgDurationMs).toBe(12 * 60 * 60 * 1000);
  });

  it("computes cache-hit and output/input efficiency averages", () => {
    const sessions = [
      mkSession({
        updatedAt: "2024-01-01T12:00:00Z",
        tokensInput: 100,
        tokensCacheRead: 100,
        tokensOutput: 50,
      }),
      mkSession({
        updatedAt: "2024-01-01T13:00:00Z",
        tokensInput: 200,
        tokensCacheRead: 0,
        tokensOutput: 100,
      }),
    ];

    const series = aggregateDailyAnalytics(sessions, range);

    // cache hit rate: 50% for the first, 0% for the second -> avg 25%
    expect(series[0].avgCacheHitRate).toBeCloseTo(25);
    // efficiency: 0.5 and 0.5 -> avg 0.5
    expect(series[0].avgEfficiency).toBeCloseTo(0.5);
  });

  it("returns only activity days when no start bound is given", () => {
    const sessions = [
      mkSession({ updatedAt: "2024-01-01T12:00:00Z" }),
      mkSession({ updatedAt: "2024-01-05T12:00:00Z" }),
    ];

    const series = aggregateDailyAnalytics(sessions, { start: null, end: new Date() });

    expect(series.map((p) => p.date)).toEqual(["2024-01-01", "2024-01-05"]);
  });
});
