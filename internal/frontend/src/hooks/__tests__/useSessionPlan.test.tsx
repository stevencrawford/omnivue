import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionPlan } from "../useSessionPlan";
import { fetchPlan } from "../apiClient";
import type { Plan } from "../types";

vi.mock("../apiClient", () => ({
  fetchPlan: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useSessionPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the spinner only for the initial fetch", async () => {
    const first = deferred<Plan | null>();
    vi.mocked(fetchPlan).mockReturnValue(first.promise);

    const { result } = renderHook(() => useSessionPlan("ses_a", 0));
    expect(result.current.planLoading).toBe(true);

    await act(async () => {
      first.resolve({ markdown: "# Plan", source: "test" });
    });
    expect(result.current.planLoading).toBe(false);
    expect(result.current.plan?.markdown).toBe("# Plan");
  });

  it("re-checks the plan on a poll tick and reveals a late plan", async () => {
    vi.mocked(fetchPlan).mockResolvedValueOnce(null);

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useSessionPlan("ses_a", tick),
      { initialProps: { tick: 0 } },
    );
    await act(async () => {});
    expect(result.current.plan).toBeNull();

    vi.mocked(fetchPlan).mockResolvedValueOnce({ markdown: "# Late plan", source: "test" });
    await act(async () => {
      rerender({ tick: 1 });
    });

    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(result.current.plan?.markdown).toBe("# Late plan");
  });

  it("does not flash the spinner on a background poll", async () => {
    vi.mocked(fetchPlan).mockResolvedValueOnce({ markdown: "# Plan", source: "test" });

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useSessionPlan("ses_a", tick),
      { initialProps: { tick: 0 } },
    );
    await act(async () => {});
    expect(result.current.planLoading).toBe(false);

    const next = deferred<Plan | null>();
    vi.mocked(fetchPlan).mockReturnValueOnce(next.promise);
    await act(async () => {
      rerender({ tick: 1 });
    });
    expect(result.current.planLoading).toBe(false);

    await act(async () => {
      next.resolve({ markdown: "# Plan", source: "test" });
    });
    expect(result.current.planLoading).toBe(false);
  });

  it("keeps the same plan object when polled content is unchanged", async () => {
    vi.mocked(fetchPlan).mockResolvedValue({ markdown: "# Plan", source: "test" });

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useSessionPlan("ses_a", tick),
      { initialProps: { tick: 0 } },
    );
    await act(async () => {});
    const first = result.current.plan;
    expect(first).not.toBeNull();

    await act(async () => {
      rerender({ tick: 1 });
    });
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(result.current.plan).toBe(first);
  });

  it("keeps the last plan when a background refresh fails", async () => {
    vi.mocked(fetchPlan).mockResolvedValueOnce({ markdown: "# Plan", source: "test" });

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useSessionPlan("ses_a", tick),
      { initialProps: { tick: 0 } },
    );
    await act(async () => {});
    expect(result.current.plan?.markdown).toBe("# Plan");

    vi.mocked(fetchPlan).mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      rerender({ tick: 1 });
    });
    expect(result.current.plan?.markdown).toBe("# Plan");
  });
});
