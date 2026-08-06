import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "./types";
import type { Section } from "../components/IconChannel";

const SESSION_WITH_STEP = /^\/session\/([^/]+)\/step\/(\d+)$/;
const SESSION_PATH = /^\/session\/([^/]+)$/;

const SECTION_ROUTES: Record<string, Section> = {
  sessions: "sessions",
  queue: "queue",
  tags: "tags",
  bookmarks: "bookmarks",
  notifications: "notifications",
};

export interface RouteState {
  sessionId: string | null;
  step: number | undefined;
  showOverview: boolean;
  section: Section;
}

// The canonical routes for the app's tracked top-level destinations.
// Overview ("/") and the Sessions icon-channel page ("/sessions") map to the
// same state but are distinct Back-stack entries.
export const HOME_ROUTE = "/";
export const SESSIONS_ROUTE = "/sessions";

export function sessionRoute(sessionId: string): string {
  return `/session/${encodeURIComponent(sessionId)}`;
}

export function sectionRoute(section: Section): string {
  return section === "sessions" ? SESSIONS_ROUTE : `/${section}`;
}

// Decode a pathname into the app state it represents. Anything unrecognised
// falls back to the Overview so a stale or hand-edited hash still opens a
// safe page.
export function pathToRoute(pathname: string): RouteState {
  const stepMatch = pathname.match(SESSION_WITH_STEP);
  if (stepMatch) {
    return {
      sessionId: decodeURIComponent(stepMatch[1]),
      step: parseInt(stepMatch[2], 10),
      showOverview: false,
      section: "sessions",
    };
  }
  const sessionMatch = pathname.match(SESSION_PATH);
  if (sessionMatch) {
    return {
      sessionId: decodeURIComponent(sessionMatch[1]),
      step: undefined,
      showOverview: false,
      section: "sessions",
    };
  }
  if (pathname === HOME_ROUTE || pathname === SESSIONS_ROUTE) {
    return { sessionId: null, step: undefined, showOverview: true, section: "sessions" };
  }
  const section = SECTION_ROUTES[pathname.replace(/^\//, "")];
  if (section) {
    return { sessionId: null, step: undefined, showOverview: true, section };
  }
  return { sessionId: null, step: undefined, showOverview: true, section: "sessions" };
}

interface UseRouteSyncOptions {
  sessions: Session[];
  setActiveSessionId: (id: string | null) => void;
  setShowOverview: (v: boolean) => void;
  setActiveSection: (section: Section) => void;
  setFocusStepIndex: (idx: number | undefined) => void;
}

export interface RouteSync {
  navigateTo: (path: string) => void;
  currentPath: string;
}

// Owns the URL hash as the single source of truth for navigation state. Every
// in-app destination change goes through navigateTo(), which pushes a history
// entry so the browser Back/Forward buttons can undo it. Browser-driven
// navigation (back/forward) re-applies the previous pathname to app state,
// which is what makes motion in either direction reversible.
export function useRouteSync(options: UseRouteSyncOptions): RouteSync {
  const { sessions, setActiveSessionId, setShowOverview, setActiveSection, setFocusStepIndex } =
    options;

  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  // Whether the current pathname has been read into state yet, so navigateTo
  // never pushes an un-read (initial/empty) state over a deep-link route.
  const appliedRef = useRef(false);

  // Apply the current pathname to app state on every change (initial load,
  // in-app push, and back/forward). The router never reacts to these setters,
  // so there is no echo loop.
  useEffect(() => {
    const route = pathToRoute(pathname);
    setActiveSection(route.section);
    setShowOverview(route.showOverview);
    setActiveSessionId(route.sessionId);
    setFocusStepIndex(route.step);
    appliedRef.current = true;
  }, [pathname, setActiveSection, setShowOverview, setActiveSessionId, setFocusStepIndex]);

  // Resolve a deep-linked session id once sessions are available. An id that
  // is not in the list (stale hash) falls back to Overview instead of
  // stranding the user on a blank session view.
  useEffect(() => {
    const route = pathToRoute(pathname);
    if (!route.sessionId || !appliedRef.current) return;
    if (sessions.length > 0 && !sessions.some((s) => s.id === route.sessionId)) {
      navigate(HOME_ROUTE, { replace: true });
    }
  }, [sessions, pathname, navigate]);

  const navigateTo = useCallback(
    (path: string) => {
      // Skip duplicate navigations so re-clicking the current destination does
      // not pile up identical history entries.
      if (appliedRef.current && path === pathname) return;
      navigate(path);
    },
    [navigate, pathname],
  );

  return { navigateTo, currentPath: pathname };
}
