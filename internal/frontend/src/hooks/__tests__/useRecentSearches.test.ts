import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRecentSearches } from "../useRecentSearches";
import { addRecentSearches } from "../apiClient";

vi.mock("../apiClient", () => ({
  fetchRecentSearches: vi.fn().mockResolvedValue([]),
  addRecentSearches: vi.fn().mockResolvedValue(undefined),
}));

describe("useRecentSearches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes once per add, outside the state updater", async () => {
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      void result.current.addSearch("foo");
    });
    expect(addRecentSearches).toHaveBeenCalledTimes(1);
    expect(addRecentSearches).toHaveBeenCalledWith(["foo"]);

    await act(async () => {
      void result.current.addSearch("bar");
    });
    expect(addRecentSearches).toHaveBeenCalledTimes(2);
    expect(addRecentSearches).toHaveBeenLastCalledWith(["bar", "foo"]);
  });

  it("dedupes and caps the persisted list at MAX_SEARCHES without leaking writes", async () => {
    const { result } = renderHook(() => useRecentSearches());
    await act(async () => {
      await Promise.resolve();
    });

    for (let i = 0; i < 12; i++) {
      await act(async () => {
        void result.current.addSearch(`q${i}`);
      });
    }
    await act(async () => {
      void result.current.addSearch("q5");
    });

    expect(addRecentSearches).toHaveBeenCalledTimes(13);
    const last = vi.mocked(addRecentSearches).mock.calls.at(-1)![0] as string[];
    expect(last).toHaveLength(10);
    expect(last[0]).toBe("q5");
    expect(last).toContain("q5");
  });
});
