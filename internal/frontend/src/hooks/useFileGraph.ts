import { useCallback, useEffect, useState } from "react";
import { fetchFileGraph } from "./apiClient";
import type { FileGraph, FileGraphParams } from "./types";

interface FileGraphState {
  graph: FileGraph | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// useFileGraph fetches the cross-session file-activity graph for the given
// filters. Refetches whenever the filter params change.
export function useFileGraph(params: FileGraphParams): FileGraphState {
  const [graph, setGraph] = useState<FileGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const agent = params.agent ?? "";
  const repo = params.repo ?? "";
  const from = params.from ?? "";
  const to = params.to ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFileGraph({ agent, repo, from, to })
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, repo, from, to, nonce]);

  return { graph, loading, error, reload };
}
