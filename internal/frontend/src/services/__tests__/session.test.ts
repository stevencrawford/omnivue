import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { SessionService } from "../session";

vi.mock("../../hooks/apiClient", () => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchMessages: vi.fn(),
  fetchPlan: vi.fn(),
  fetchDiffs: vi.fn(),
  fetchEdits: vi.fn(),
  fetchResumeCommand: vi.fn(),
  setSessionName: vi.fn(),
  clearSessionName: vi.fn(),
}));

const mockSession = {
  id: "ses-1",
  sourceId: "src-1",
  title: "Test",
  repository: "org/repo",
  branch: "main",
  agent: "opencode",
  subAgent: undefined,
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
  messageCount: 5,
  diffFiles: 2,
  diffAdditions: 10,
  diffDeletions: 5,
};

describe("SessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns sessions on success", async () => {
      vi.mocked(api.fetchSessions).mockResolvedValue([mockSession]);

      const result = await runPromise(SessionService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ses-1");
      expect(api.fetchSessions).toHaveBeenCalledOnce();
    });

    it("retries on failure and eventually succeeds", async () => {
      vi.mocked(api.fetchSessions)
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce([mockSession]);

      const result = await runPromise(SessionService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(api.fetchSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe("getMessages", () => {
    it("returns messages for a session", async () => {
      const messages = [
        { id: "msg-1", role: "user" as const, content: "hello", timestamp: "2024-01-01T00:00:00Z" },
      ];
      vi.mocked(api.fetchMessages).mockResolvedValue(messages);

      const result = await runPromise(
        SessionService.pipe(Effect.flatMap((svc) => svc.getMessages("ses-1"))),
      );

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("hello");
      expect(api.fetchMessages).toHaveBeenCalledWith("ses-1");
    });
  });

  describe("getResumeCommand", () => {
    it("returns resume command", async () => {
      vi.mocked(api.fetchResumeCommand).mockResolvedValue("opencode ses-1");

      const result = await runPromise(
        SessionService.pipe(Effect.flatMap((svc) => svc.getResumeCommand("ses-1"))),
      );

      expect(result).toBe("opencode ses-1");
    });
  });
});
