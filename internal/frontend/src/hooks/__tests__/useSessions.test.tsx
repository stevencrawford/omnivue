import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessions } from "../useSessions";
import { fetchSessions } from "../apiClient";
import type { Session } from "../types";

vi.mock("../apiClient", () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
  ApiError: class ApiError extends Error {
    status = 0;
    endpoint = "";
    constructor(message: string, status: number, endpoint: string) {
      super(message);
      this.status = status;
      this.endpoint = endpoint;
    }
  },
}));

const sseCallbacks: {
  onUpdate: () => void;
  onSessionChanged?: (ids: string[]) => void;
  onPromptQueueChanged?: () => void;
  onConnectionChange?: (connected: boolean) => void;
} = { onUpdate: () => {} };

vi.mock("../useSSE", () => ({
  useSSE: (callbacks: typeof sseCallbacks) => {
    sseCallbacks.onUpdate = callbacks.onUpdate;
    sseCallbacks.onSessionChanged = callbacks.onSessionChanged;
    sseCallbacks.onPromptQueueChanged = callbacks.onPromptQueueChanged;
    sseCallbacks.onConnectionChange = callbacks.onConnectionChange;
  },
}));

describe("useSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only replaces liveChangedIds when the changed-id list actually differs", () => {
    const { result } = renderHook(() => useSessions());

    act(() => sseCallbacks.onSessionChanged?.(["ses_a", "ses_b"]));
    const first = result.current.liveChangedIds;

    // Identical burst re-sent must not allocate a new set (which would re-arm
    // consumer reload debounces).
    act(() => sseCallbacks.onSessionChanged?.(["ses_a", "ses_b"]));
    expect(result.current.liveChangedIds).toBe(first);

    // A genuinely different set replaces it.
    act(() => sseCallbacks.onSessionChanged?.(["ses_a"]));
    expect(result.current.liveChangedIds).not.toBe(first);
    expect(result.current.liveChangedIds.has("ses_a")).toBe(true);
    expect(result.current.liveChangedIds.has("ses_b")).toBe(false);
  });

  it("ignores empty changed-id lists", () => {
    const { result } = renderHook(() => useSessions());

    act(() => sseCallbacks.onSessionChanged?.([]));
    expect(result.current.liveChangedIds.size).toBe(0);
  });

  it("ackSessionChange removes a single id once handled", () => {
    const { result } = renderHook(() => useSessions());

    act(() => sseCallbacks.onSessionChanged?.(["ses_a", "ses_b"]));
    expect(result.current.liveChangedIds.size).toBe(2);

    act(() => result.current.ackSessionChange("ses_a"));
    expect(result.current.liveChangedIds.has("ses_a")).toBe(false);
    expect(result.current.liveChangedIds.has("ses_b")).toBe(true);

    act(() => result.current.ackSessionChange("ses_a"));
    expect(result.current.liveChangedIds.has("ses_b")).toBe(true);
  });

  it("loads sessions on mount and exposes loadSessions", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([
      { id: "ses_a", title: "A" },
    ] as unknown as Session[]);

    const { result } = renderHook(() => useSessions());
    expect(fetchSessions).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.loadSessions();
    });
    expect(result.current.sessions).toHaveLength(1);
  });
});
