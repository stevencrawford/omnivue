import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useStatus } from "../useStatus";

const fetchMock = vi.fn();

const mockStatus = { version: "0.2.3", pid: 123, sources: 2, sessions: 10 };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response;
}

describe("useStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("loads status on mount", async () => {
    fetchMock.mockResolvedValue(jsonResponse(mockStatus));
    const { result } = renderHook(() => useStatus());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.status?.version).toBe("0.2.3"));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/_/api/status", undefined);
  });

  it("reload fetches fresh status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(mockStatus))
      .mockResolvedValueOnce(jsonResponse({ ...mockStatus, version: "0.3.0" }));
    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(result.current.status?.version).toBe("0.2.3"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.status?.version).toBe("0.3.0");
  });

  it("keeps the last known status when a reload fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(mockStatus))
      .mockRejectedValueOnce(new Error("network error"));
    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(result.current.status?.version).toBe("0.2.3"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.status?.version).toBe("0.2.3");
  });
});
