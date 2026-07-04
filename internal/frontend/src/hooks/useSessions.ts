import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "./types";
import { fetchSessions } from "./apiClient";
import { useSSE } from "./useSSE";

export interface SessionsState {
  sessions: Session[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
  liveChangedIds: Set<string>;
  activeSession: Session | null;
  loadSessions: () => Promise<void>;
  setActiveSessionId: (id: string | null) => void;
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
      setSessions(data || []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
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
