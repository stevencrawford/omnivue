import { useCallback, useEffect, useState } from "react";
import type { StatusInfo } from "./types";
import { fetchStatus } from "./apiClient";

export interface StatusState {
  status: StatusInfo | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useStatus(): StatusState {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchStatus());
    } catch {
      // Keep the last known status; version display is best-effort.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status, loading, reload };
}
