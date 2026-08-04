import { useCallback, useEffect, useRef } from "react";
import type { Session } from "./useApi";

const SESSION_HASH = /^#\/session\/([^/]+)(?:\/step\/(\d+))?/;

// The canonical URL hash for an app state. Overview ("#/") wins over a selected
// session; an empty string means "no hash, no overview" (initial load).
function serializeHash(activeSessionId: string | null, showOverview: boolean): string {
  if (showOverview) return "#/";
  if (activeSessionId) return `#/session/${encodeURIComponent(activeSessionId)}`;
  return "";
}

export function useSessionRouting(
  sessions: Session[],
  activeSessionId: string | null,
  setActiveSessionId: (id: string | null) => void,
  setFocusStepIndex: (idx: number | undefined) => void,
  showOverview: boolean,
  setShowOverview: (v: boolean) => void,
) {
  // True once the URL hash has been read into state, so the writer effect does
  // not push an un-read (initial/empty) state over a deep-link hash.
  const hashAppliedRef = useRef(false);

  // Single parser shared by the initial deep-link read and the hashchange
  // listener, so back/forward and a fresh load apply identical semantics.
  const applyHash = useCallback(() => {
    const hash = window.location.hash;
    const match = hash.match(SESSION_HASH);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (sessions.some((s) => s.id === id)) {
        setActiveSessionId(id);
        setShowOverview(false);
        setFocusStepIndex(match[2] ? parseInt(match[2], 10) : undefined);
      }
    } else if (hash === "#/" || hash === "" || hash === "#") {
      setShowOverview(true);
      setActiveSessionId(null);
      setFocusStepIndex(undefined);
    }
    hashAppliedRef.current = true;
  }, [sessions, setActiveSessionId, setFocusStepIndex, setShowOverview]);

  // One-time: apply the URL hash (deep link) once sessions are available and
  // before the writer effect gets a chance to overwrite it.
  useEffect(() => {
    if (hashAppliedRef.current) return;
    if (sessions.length === 0) return;
    applyHash();
  }, [sessions, applyHash]);

  // Push internal state changes to the URL. Idempotent guard: when the URL
  // already matches, do nothing, so an internal change never clobbers a hash
  // that the listener just applied from back/forward. replaceState does not
  // emit `hashchange`, so there is no echo loop.
  useEffect(() => {
    if (!hashAppliedRef.current) return;
    const target = serializeHash(activeSessionId, showOverview);
    const current = window.location.hash;
    if (target === "#/") {
      // "" and "#" read as overview too; no need to normalize a blank fresh load.
      if (current === "#/" || current === "" || current === "#") return;
    } else if (current === target) {
      return;
    }
    history.replaceState(null, "", target);
  }, [activeSessionId, showOverview]);

  // Browser back/forward or manual URL edits → state.
  useEffect(() => {
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [applyHash]);

  // When the selected session changes, clear step focus so a previously
  // deep-linked step does not stay pinned on the next session (applies to
  // internal clicks; hash-driven changes already set focus explicitly).
  const isInitialIdRef = useRef(true);
  useEffect(() => {
    if (isInitialIdRef.current) {
      isInitialIdRef.current = false;
      return;
    }
    setFocusStepIndex(undefined);
  }, [activeSessionId, setFocusStepIndex]);
}
