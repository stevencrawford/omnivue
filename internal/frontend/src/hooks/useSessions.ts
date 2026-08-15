import { useCallback, useEffect, useState } from "react";
import type { Session } from "./types";
import { useSSE } from "./useSSE";
import { fetchSessions, fetchStatus, ApiError } from "./apiClient";
import { runCatching } from "../utils/errors";

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  /**
   * Whether the initial ingest is still running (sources configured but the
   * first refresh/index pass has not completed). `null` while the status has
   * not been read yet; `false` once we know indexing is done or no sources
   * are configured.
   */
  indexing: boolean | null;
  liveChangedIds: Set<string>;
  connected: boolean;
  loadSessions: () => Promise<void>;
  /** Remove a session id from the pending live-change set once handled. */
  ackSessionChange: (id: string) => void;
}

const INDEXING_STATUS_POLL_MS = 3000;

// Global callback for prompt-queue-changed SSE events.
// Components can register by calling setOnPromptQueueChanged.
let onPromptQueueChanged: (() => void) | null = null;
export function setOnPromptQueueChanged(cb: (() => void) | null) {
  onPromptQueueChanged = cb;
}

export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState<boolean | null>(null);
  const [liveChangedIds, setLiveChangedIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const data = await runCatching(
      () => fetchSessions(),
      (err) => {
        if (err instanceof ApiError) console.error("[sessions] failed to load:", err.message);
        else console.error("[sessions] failed to load:", err);
      },
    );
    setSessions(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Probe the initial-ingest status: while sources are configured but the
  // first refresh/index pass has not completed, expose `indexing` so the UI
  // can show a loading placeholder instead of the "no sessions yet" init
  // screen. Poll only while it still matters and stop once resolved.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const check = async () => {
      const status = await runCatching(
        () => fetchStatus(),
        (err) => {
          if (err instanceof ApiError)
            console.error("[sessions] failed to read indexing status:", err.message);
          else console.error("[sessions] failed to read indexing status:", err);
        },
      );
      if (cancelled || !status) return;
      // An old backend that omits `indexed` is treated as already indexed,
      // preserving the pre-placeholder behavior.
      const stillIndexing = status.sources > 0 && !(status.indexed ?? true);
      setIndexing(stillIndexing);
      if (!stillIndexing) {
        if (timer) clearInterval(timer);
        // The initial refresh finished while we were waiting. Re-fetch the
        // session list so a just-populated cache reaches the UI even if the
        // SSE "update" event was missed.
        loadSessions();
      }
    };

    check();
    timer = setInterval(check, INDEXING_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [loadSessions]);

  const ackSessionChange = useCallback((id: string) => {
    setLiveChangedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useSSE({
    onUpdate: () => {
      loadSessions();
    },
    onSessionChanged: (ids) => {
      if (ids.length === 0) return;
      const next = new Set(ids);
      // Only replace the set when its contents differ so consumers' effects do
      // not re-run (and re-arm their reload debounce) on every SSE duplicate.
      setLiveChangedIds((prev) => {
        if (prev.size === next.size) {
          let same = true;
          for (const id of prev) {
            if (!next.has(id)) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return next;
      });
    },
    onPromptQueueChanged: () => {
      onPromptQueueChanged?.();
    },
    onConnectionChange: setConnected,
  });

  return {
    sessions,
    loading,
    indexing,
    liveChangedIds,
    connected,
    loadSessions,
    ackSessionChange,
  };
}
