import { useCallback, useEffect, useState } from "react";
import type { Session } from "./types";
import { useSSE } from "./useSSE";
import { fetchSessions, ApiError } from "./apiClient";
import { runCatching } from "../utils/errors";

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  liveChangedIds: Set<string>;
  connected: boolean;
  loadSessions: () => Promise<void>;
  /** Remove a session id from the pending live-change set once handled. */
  ackSessionChange: (id: string) => void;
}

// Global callback for prompt-queue-changed SSE events.
// Components can register by calling setOnPromptQueueChanged.
let onPromptQueueChanged: (() => void) | null = null;
export function setOnPromptQueueChanged(cb: (() => void) | null) {
  onPromptQueueChanged = cb;
}

export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
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
    liveChangedIds,
    connected,
    loadSessions,
    ackSessionChange,
  };
}
