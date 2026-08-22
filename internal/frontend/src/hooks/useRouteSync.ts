import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "./types";
import type { Section } from "../components/IconChannel";

const SESSION_PATH = /^\/session\/([^/]+)$/;

const SECTION_ROUTES: Record<string, Section> = {
  sessions: "sessions",
  queue: "queue",
  tags: "tags",
  bookmarks: "bookmarks",
  notifications: "notifications",
  files: "files",
};

export interface RouteState {
  sessionId: string | null;
  showOverview: boolean;
  section: Section;
}

// The canonical routes for the app's tracked top-level destinations.
// Overview ("/") and the Sessions icon-channel page ("/sessions") map to the
// same state but are distinct Back-stack entries.
export const HOME_ROUTE = "/";
export const SESSIONS_ROUTE = "/sessions";

// Deep link for the full-search drawer: `#/search?q=<query>`. The bare route
// resolves to the overview view; App.tsx reads `q` and opens the drawer.
export const SEARCH_ROUTE = "/search";

export function searchRoute(query: string): string {
  return `${SEARCH_ROUTE}?q=${encodeURIComponent(query)}`;
}

// The query param that carries the active icon-channel section. The section is
// orthogonal to the RHS view: any session or overview route can be paired with
// any section, so switching sidebar sections never closes the open session.
const SECTION_PARAM = "section";

export function sessionRoute(sessionId: string): string {
  return `/session/${encodeURIComponent(sessionId)}`;
}

export function sessionRouteWithSection(sessionId: string, section: Section): string {
  return section === "sessions"
    ? sessionRoute(sessionId)
    : `${sessionRoute(sessionId)}?${SECTION_PARAM}=${section}`;
}

export function sectionRoute(section: Section): string {
  // A bare section route means "this section with no session open" (overview).
  if (section === "sessions") return SESSIONS_ROUTE;
  return `/${section}`;
}

// Read the section out of the query string. Missing or invalid values fall back
// to "sessions" so an old/external URL still lands somewhere sensible.
function sectionFromSearch(search: string): Section {
  const section = new URLSearchParams(search).get(SECTION_PARAM);
  if (section && section in SECTION_ROUTES) return section as Section;
  return "sessions";
}

// Decode a route into the app state it represents. The session/overview
// dimension comes from the pathname; the icon-channel section comes from the
// query string (falling back to a bare /:section path for legacy deep links).
// Anything unrecognised falls back to the Overview so a stale or hand-edited
// hash still opens a safe page.
export function pathToRoute(location: { pathname: string; search: string }): RouteState {
  const section = sectionFromSearch(location.search);
  const sessionMatch = location.pathname.match(SESSION_PATH);
  if (sessionMatch) {
    return {
      sessionId: decodeURIComponent(sessionMatch[1]),
      showOverview: false,
      section,
    };
  }
  if (location.pathname === HOME_ROUTE || location.pathname === SESSIONS_ROUTE) {
    return { sessionId: null, showOverview: true, section };
  }
  if (location.pathname === SEARCH_ROUTE) {
    // The search route rides on the overview; App.tsx drives the drawer from
    // the `q` query param so the URL still lands on a safe page.
    return { sessionId: null, showOverview: true, section };
  }
  const bareSection = SECTION_ROUTES[location.pathname.replace(/^\//, "")];
  if (bareSection) {
    return { sessionId: null, showOverview: true, section: bareSection };
  }
  return { sessionId: null, showOverview: true, section };
}

interface UseRouteSyncOptions {
  sessions: Session[];
  setActiveSessionId: (id: string | null) => void;
  setShowOverview: (v: boolean) => void;
  setActiveSection: (section: Section) => void;
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
  const { sessions, setActiveSessionId, setShowOverview, setActiveSection } = options;

  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const pathKey = `${location.pathname}${location.search}`;

  // Whether the current route has been read into state yet, so navigateTo
  // never pushes an un-read (initial/empty) state over a deep-link route.
  const appliedRef = useRef(false);

  // Apply the current route to app state on every change (initial load,
  // in-app push, and back/forward). The router never reacts to these setters,
  // so there is no echo loop.
  useEffect(() => {
    const route = pathToRoute(location);
    setActiveSection(route.section);
    setShowOverview(route.showOverview);
    setActiveSessionId(route.sessionId);
    appliedRef.current = true;
  }, [location, setActiveSection, setShowOverview, setActiveSessionId]);

  // Resolve a deep-linked session id once sessions are available. An id that
  // is not in the list (stale hash) falls back to Overview instead of
  // stranding the user on a blank session view.
  useEffect(() => {
    const route = pathToRoute(location);
    if (!route.sessionId || !appliedRef.current) return;
    if (sessions.length > 0 && !sessions.some((s) => s.id === route.sessionId)) {
      navigate(HOME_ROUTE, { replace: true });
    }
  }, [sessions, location, navigate]);

  const navigateTo = useCallback(
    (path: string) => {
      // Skip duplicate navigations so re-clicking the current destination does
      // not pile up identical history entries. Compare against the full route
      // (pathname + search) since a section can ride on a session route.
      if (appliedRef.current && path === pathKey) return;
      navigate(path);
    },
    [navigate, pathKey],
  );

  return { navigateTo, currentPath: pathname };
}
