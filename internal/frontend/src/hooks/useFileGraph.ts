import { useEffect, useState } from "react";
import { fetchFileGraph } from "./apiClient";
import type { FileGraph } from "./types";
import type { FilesFilters } from "./types";

interface FileGraphState {
  graph: FileGraph | null;
  loading: boolean;
  error: string | null;
}

// useFileGraph fetches the cross-session file-activity graph for the given
// explorer filters. Nothing is fetched until a repository is selected; the
// graph only ever spans one project. Date filters arrive as YYYY-MM-DD
// strings and are widened to UTC-day ISO timestamps for the API.
export function useFileGraph(filters: FilesFilters): FileGraphState {
  const [graph, setGraph] = useState<FileGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { repo, from, to, agent } = filters;

  useEffect(() => {
    if (!repo) {
      setGraph(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFileGraph({
      agent,
      repo,
      from: from ? new Date(`${from}T00:00:00Z`).toISOString() : "",
      to: to ? new Date(`${to}T23:59:59Z`).toISOString() : "",
    })
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
  }, [repo, from, to, agent]);

  return { graph, loading, error };
}
