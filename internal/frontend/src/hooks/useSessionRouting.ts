import { useEffect, useRef } from "react";
import type { Session } from "./useApi";

export function useSessionRouting(
  sessions: Session[],
  activeSessionId: string | null,
  setActiveSessionId: (id: string | null) => void,
  setFocusStepIndex: (idx: number | undefined) => void,
  showOverview: boolean,
  setShowOverview: (v: boolean) => void,
) {
  const isInitialHashRef = useRef(true);
  const hashReadRef = useRef(false);

  useEffect(() => {
    if (hashReadRef.current) return;
    if (sessions.length === 0) return;
    const hash = window.location.hash;
    const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (sessions.some((s) => s.id === id)) {
        setActiveSessionId(id);
        setShowOverview(false);
        if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
      }
    }
    hashReadRef.current = true;
  }, [sessions, setActiveSessionId, setFocusStepIndex, setShowOverview]);

  useEffect(() => {
    try {
      if (showOverview) {
        if (window.location.hash !== "#/" && window.location.hash !== "") {
          history.replaceState(null, "", "#/");
        }
      } else if (activeSessionId) {
        const hash = `#/session/${encodeURIComponent(activeSessionId)}`;
        history.replaceState(null, "", hash);
      }
    } catch {
      /* history.replaceState throws SecurityError in restricted contexts */
    }
  }, [showOverview, activeSessionId]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (sessions.some((s) => s.id === id)) {
          setActiveSessionId(id);
          setShowOverview(false);
          if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
          else setFocusStepIndex(undefined);
        }
      } else if (hash === "#/" || hash === "" || hash === "#") {
        setShowOverview(true);
        setActiveSessionId(null);
        setFocusStepIndex(undefined);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [sessions, setActiveSessionId, setFocusStepIndex, setShowOverview]);

  useEffect(() => {
    if (isInitialHashRef.current) {
      isInitialHashRef.current = false;
      return;
    }
    setFocusStepIndex(undefined);
  }, [activeSessionId]);
}
