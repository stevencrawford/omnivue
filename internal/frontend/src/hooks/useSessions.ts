import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const lastEventRef = useRef(Date.now());

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
      lastEventRef.current = Date.now();
      loadSessions();
    },
    onSessionChanged: (ids) => {
      lastEventRef.current = Date.now();
      if (ids.length > 0) {
        setLiveChangedIds(new Set(ids));
      }
    },
    onStarted: () => {
      lastEventRef.current = Date.now();
    },
  });

  // Heartbeat-gated polling: if no SSE event arrives for 60s, fall
  // back to a full reload so the conversation view does not go stale
  // when SSE events are dropped (e.g. tab backgrounded).
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastEventRef.current > 60000) {
        console.debug("[sessions] SSE heartbeat timeout, polling fallback");
        loadSessions();
        lastEventRef.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(id);
  }, [loadSessions]);

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
