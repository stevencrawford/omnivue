import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "./types";
import { useSSE } from "./useSSE";
import { fetchSessions, ApiError } from "./apiClient";
import { runCatching } from "../utils/errors";

export interface SessionsState {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  liveChangedIds: Set<string>;
  activeSession: Session | null;
  connected: boolean;
  loadSessions: () => Promise<void>;
  setActiveSessionId: (id: string | null) => void;
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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

  useSSE({
    onUpdate: () => {
      loadSessions();
    },
    onSessionChanged: (ids) => {
      if (ids.length > 0) {
        setLiveChangedIds(new Set(ids));
      }
    },
    onPromptQueueChanged: () => {
      onPromptQueueChanged?.();
    },
    onConnectionChange: setConnected,
  });

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  useEffect(() => {
    document.title = activeSession ? `Omnivue \u2014 ${activeSession.title}` : "Omnivue";
  }, [activeSession]);

  return {
    sessions,
    loading,
    activeSessionId,
    liveChangedIds,
    activeSession,
    connected,
    loadSessions,
    setActiveSessionId,
  };
}
