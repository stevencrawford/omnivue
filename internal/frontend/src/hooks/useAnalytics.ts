import { useCallback, useEffect, useState } from "react";
import { fetchAnalytics, ApiError } from "./apiClient";
import type { AnalyticsDaily } from "./types";
import { runCatching } from "../utils/errors";

export interface AnalyticsState {
  data: AnalyticsDaily[];
  loading: boolean;
}

// useAnalytics fetches the per-day tool-call aggregation for the given time
// window. The window derives from the overview's time range, so switching
// ranges (or opening the analytics tab) re-fetches the matching window. A null
// from means all time.
export function useAnalytics(from: number | null, to: number, active: boolean): AnalyticsState {
  const [data, setData] = useState<AnalyticsDaily[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await runCatching(
      () => fetchAnalytics(from, to),
      (err) => {
        if (err instanceof ApiError) console.error("[analytics] failed to load:", err.message);
        else console.error("[analytics] failed to load:", err);
      },
    );
    setData(result ?? []);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    if (!active) return;
    load();
  }, [load, active]);

  return { data, loading };
}
