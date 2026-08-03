import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "./types";
import { useSSE } from "./useSSE";
import { fetchSessions, ApiError } from "./apiClient";

export interface SessionsState {
  sessions: Session[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
  liveChangedIds: Set<string>;
  activeSession: Session | null;
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
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [liveChangedIds, setLiveChangedIds] = useState<Set<string>>(new Set());

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await fetchSessions();
      setSessions(data ?? []);
    } catch (err) {
      if (err instanceof ApiError) console.error("[sessions] failed to load:", err.message);
      else console.error("[sessions] failed to load:", err);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
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
    sessionsLoading,
    activeSessionId,
    liveChangedIds,
    activeSession,
    loadSessions,
    setActiveSessionId,
  };
}
