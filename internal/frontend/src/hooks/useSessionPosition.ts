import { useCallback } from "react";
import type { Position } from "./types";
import { STORAGE_KEYS } from "../utils/storageKeys";

// A saved "last place" in a session: the canonical Position the user was
// viewing, plus how far the viewport top sat below that block, a flag for the
// live tail, and a timestamp for expiry. Persisted to localStorage so it
// survives full app restarts (Q7), keyed per session.
export interface SessionPosition {
  position: Position | null;
  // Pixels from the anchor block's top to the viewport top. The anchor is the
  // message block nearest the top of the viewport, so restoring against the
  // block re-lands on the exact spot regardless of content-visibility
  // estimates (which distort absolute scrollTop across mounts).
  offset: number;
  // True when the saved spot was the live tail. On reopen we land at the bottom
  // once but forget the tail lock (Q8) — this flag is read once, not re-armed.
  bottom: boolean;
  ts: number;
}

export const SESSION_POSITION_TTL_MS = 24 * 60 * 60 * 1000;

function positionKey(sessionId: string): string {
  return `${STORAGE_KEYS.SESSION_POSITION_PREFIX}${sessionId}`;
}

export function readSessionPosition(sessionId: string): SessionPosition | undefined {
  try {
    const raw = localStorage.getItem(positionKey(sessionId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SessionPosition;
    if (!parsed || typeof parsed.ts !== "number") return undefined;
    if (Date.now() - parsed.ts > SESSION_POSITION_TTL_MS) {
      localStorage.removeItem(positionKey(sessionId));
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeSessionPosition(sessionId: string, sp: SessionPosition): void {
  try {
    localStorage.setItem(positionKey(sessionId), JSON.stringify(sp));
  } catch {
    // ignore quota / private-mode failures
  }
}

export function clearSessionPosition(sessionId: string): void {
  try {
    localStorage.removeItem(positionKey(sessionId));
  } catch {
    /* ignore */
  }
}

// React-bound access to the persisted last-place position for a session.
export function useSessionPosition() {
  const getPosition = useCallback((sessionId: string) => readSessionPosition(sessionId), []);
  const savePosition = useCallback((sessionId: string, sp: SessionPosition) => {
    writeSessionPosition(sessionId, sp);
  }, []);
  const clearPosition = useCallback((sessionId: string) => clearSessionPosition(sessionId), []);
  return { getPosition, savePosition, clearPosition };
}
