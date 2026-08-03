import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import { fetchNotifications } from "../apiClient";

const sseCallbacks: {
  onUpdate: () => void;
  onNotification?: () => void;
  onStarted?: () => void;
} = { onUpdate: () => {} };

vi.mock("../apiClient", () => ({
  fetchNotifications: vi.fn().mockResolvedValue([]),
  fetchNotificationSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("../useSSE", () => ({
  useSSE: (callbacks: {
    onUpdate: () => void;
    onNotification?: () => void;
    onStarted?: () => void;
  }) => {
    sseCallbacks.onUpdate = callbacks.onUpdate;
    sseCallbacks.onNotification = callbacks.onNotification;
    sseCallbacks.onStarted = callbacks.onStarted;
    return undefined;
  },
}));

describe("useNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not reload after unmount once the SSE-triggered debounce fires", async () => {
    const { unmount } = renderHook(() => useNotifications());
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    act(() => sseCallbacks.onUpdate());
    unmount();

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });
});
