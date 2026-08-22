import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchSessions, fetchStatus, fetchFileGraph, ApiError } from "../apiClient";

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

describe("fetchStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const mockStatus = {
    version: "0.2.3",
    pid: 123,
    sources: 2,
    sessions: 10,
    schemaVersion: 9,
  };

  it("returns status on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(mockStatus));
    const result = await fetchStatus();
    expect(result.version).toBe("0.2.3");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a failed initial fetch and eventually succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(jsonResponse(mockStatus));
    const result = await fetchStatus();
    expect(result.version).toBe("0.2.3");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("fetchFileGraph", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const mockGraph = {
    nodes: [{ path: "a.go", reads: 3, writes: 1, total: 4, sessions: 2 }],
    edges: [{ source: "a.go", target: "b.go", weight: 2 }],
  };

  it("requests with filter params and validates the graph", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(mockGraph));
    const result = await fetchFileGraph({ agent: "opencode", repo: "org/repo" });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].total).toBe(4);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("agent=opencode");
    expect(url).toContain("repo=org%2Frepo");
  });

  it("throws ApiError on validation failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nodes: "not-an-array" }));
    const err = await fetchFileGraph({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});
