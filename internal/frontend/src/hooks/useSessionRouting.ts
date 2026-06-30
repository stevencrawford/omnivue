import { useEffect, useRef } from "react";
import type { Session } from "./useApi";

export function useSessionRouting(
  sessions: Session[],
  activeSessionId: string | null,
  setActiveSessionId: (id: string | null) => void,
  setFocusStepIndex: (idx: number | undefined) => void,
) {
  const isInitialHashRef = useRef(true);

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (sessions.some((s) => s.id === id)) {
        setActiveSessionId(id);
        if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
      }
    } else if (activeSessionId === null && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId === null]);

  useEffect(() => {
    if (activeSessionId) {
      const hash = `#/session/${encodeURIComponent(activeSessionId)}`;
      history.replaceState(null, "", hash);
    }
  }, [activeSessionId]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (sessions.some((s) => s.id === id)) {
          setActiveSessionId(id);
          if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
          else setFocusStepIndex(undefined);
        }
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [sessions]);

  useEffect(() => {
    if (isInitialHashRef.current) {
      isInitialHashRef.current = false;
      return;
    }
    setFocusStepIndex(undefined);
  }, [activeSessionId]);
}
