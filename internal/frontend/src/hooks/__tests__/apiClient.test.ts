import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchSessions, ApiError } from "../apiClient";

const fetchMock = vi.fn();

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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response;
}

describe("fetchSessions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("returns sessions on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([mockSession]));
    const result = await fetchSessions();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ses-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries on failure and eventually succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(jsonResponse([mockSession]));
    const result = await fetchSessions();
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws ApiError on validation failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ notAnArray: true }));
    const err = await fetchSessions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(200);
    expect((err as ApiError).endpoint).toBe("/_/api/sessions");
  });
});
