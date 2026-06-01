import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "./useApi";

const SEEN_KEY = "sess-seen-sessions";

type SeenMap = Record<string, string>;

function loadSeen(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return JSON.parse(raw) as SeenMap;
  } catch {
    /* ignore */
  }
  return {};
}

function saveSeen(seen: SeenMap): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

/** Tracks sessions that are new or updated since last viewed. */
export function useNewSessions(sessions: Session[]) {
  const [newSessionIds, setNewSessionIds] = useState<Set<string>>(() => new Set());
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    const seen = loadSeen();

    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      const isFirstVisit = Object.keys(seen).length === 0;
      if (isFirstVisit) {
        for (const s of sessions) {
          seen[s.id] = s.updatedAt;
        }
        saveSeen(seen);
        setNewSessionIds(new Set());
        return;
      }
      const initial = new Set<string>();
      for (const s of sessions) {
        const lastSeen = seen[s.id];
        if (!lastSeen || s.updatedAt > lastSeen) {
          initial.add(s.id);
        }
      }
      setNewSessionIds(initial);
      return;
    }

    const next = new Set<string>();
    for (const s of sessions) {
      const lastSeen = seen[s.id];
      if (!lastSeen || s.updatedAt > lastSeen) {
        next.add(s.id);
      }
    }
    setNewSessionIds(next);
  }, [sessions]);

  const markSessionSeen = useCallback((session: Session) => {
    const seen = loadSeen();
    seen[session.id] = session.updatedAt;
    saveSeen(seen);
    setNewSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(session.id);
      return next;
    });
  }, []);

  return { newSessionIds, markSessionSeen };
}
