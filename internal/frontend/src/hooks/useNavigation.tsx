import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { AppNotification, Bookmark, Session } from "./types";
import {
  initialNavigationState,
  navigationReducer,
  nextSessionId,
  parseMessageTarget,
  type FocusTarget,
  type NavigationState,
} from "./navigationReducer";
import {
  HOME_ROUTE,
  sectionRoute,
  sessionRoute,
  sessionRouteWithSection,
  useRouteSync,
} from "./useRouteSync";
import type { Tab } from "../components/SessionViewer";
import type { Section } from "../components/IconChannel";

// ---------------------------------------------------------------------------
// Navigation intent — React binding
//
// The pure transition table lives in navigationReducer.ts; this hook wires it
// to React (useReducer) and to react-router (through useRouteSync, the app's
// single adapter for the URL hash). The router is *not* a competing state
// model: every URL-affecting transition is declared here first as an intent
// verb that dispatches into the reducer, then projected onto the hash via
// navigateTo. Browser back/forward re-applies the prior hash through the same
// reducer (via HYDRATE/SET_* actions), so the URL never writes state behind
// the reducer's back.
//
// Callers cross the seam with intent verbs — navigateToSession, jumpToMessage,
// goHome — never with raw setters.
// ---------------------------------------------------------------------------

export interface SearchHitTarget {
  sessionId: string;
  tab: Tab;
  query: string | null;
  messageIndex?: number;
}

// Per-session scroll restore entry. pos is the pixel scrollTop; topIndex/topId
// name the message block nearest the top of the viewport and offset is how far
// below that block the viewport top sat, so the restore can re-anchor on the
// block instead of trusting an absolute pixel (content-visibility estimates
// distort absolute scrollTop across mounts). ts drives the 24h expiry.
export interface ScrollPosition {
  pos: number;
  topIndex: number | undefined;
  topId: string | undefined;
  offset: number;
  ts: number;
}

export const SCROLL_POSITION_TTL_MS = 24 * 60 * 60 * 1000;

export function isScrollPositionFresh(sp: ScrollPosition, now: number): boolean {
  return now - sp.ts < SCROLL_POSITION_TTL_MS;
}

export interface NavigationValue extends NavigationState {
  activeSession: Session | null;
  scrollPositions: Map<string, ScrollPosition>;
  saveScrollPosition: (
    id: string,
    pos: number,
    topIndex: number | undefined,
    topId: string | undefined,
    offset: number,
  ) => void;
  getScrollPosition: (id: string) => ScrollPosition | undefined;
  navigateToSession: (id: string) => void;
  jumpToMessage: (target: FocusTarget) => void;
  clearFocus: () => void;
  goHome: () => void;
  openTag: (name: string) => void;
  clearFilterTag: () => void;
  handleSessionSelect: (id: string) => void;
  handlePromptClick: (sessionId: string, promptId: string) => void;
  handleBookmarkSelect: (bookmark: Bookmark) => void;
  handleNotificationClick: (n: AppNotification) => void;
  handleDiffNavigateToMessage: (messageIndex: number, messageId?: string) => void;
  handleHighlightDone: () => void;
  selectSearchHit: (target: SearchHitTarget) => void;
  setTab: (tab: Tab) => void;
  setSection: (section: Section) => void;
  setShowOverview: (v: boolean) => void;
  setSearchHighlightQuery: (q: string | null) => void;
  clearSearchHighlight: () => void;
  navigateSession: (delta: 1 | -1, sessions: Session[]) => void;
}

const defaultNavigationValue: NavigationValue = {
  ...initialNavigationState,
  activeSession: null,
  scrollPositions: new Map(),
  saveScrollPosition: () => {},
  getScrollPosition: () => undefined,
  navigateToSession: () => {},
  jumpToMessage: () => {},
  clearFocus: () => {},
  goHome: () => {},
  openTag: () => {},
  clearFilterTag: () => {},
  handleSessionSelect: () => {},
  handlePromptClick: () => {},
  handleBookmarkSelect: () => {},
  handleNotificationClick: () => {},
  handleDiffNavigateToMessage: () => {},
  handleHighlightDone: () => {},
  selectSearchHit: () => {},
  setTab: () => {},
  setSection: () => {},
  setShowOverview: () => {},
  setSearchHighlightQuery: () => {},
  clearSearchHighlight: () => {},
  navigateSession: () => {},
};

export const NavigationContext = createContext<NavigationValue>(defaultNavigationValue);

export function useNavigation(): NavigationValue {
  return useContext(NavigationContext);
}

const SCROLL_POSITION_CAP = 100;

export interface UseNavigationStateOptions {
  sessions: Session[];
  notifications: AppNotification[];
  markNotificationRead: (ids: string[]) => void;
}

export function useNavigationState({
  sessions,
  notifications,
  markNotificationRead,
}: UseNavigationStateOptions): NavigationValue {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigationState);

  // ---- Scroll position persistence (per session) ----
  const scrollPositions = useRef(new Map<string, ScrollPosition>());
  const saveScrollPosition = useCallback(
    (
      id: string,
      pos: number,
      topIndex: number | undefined,
      topId: string | undefined,
      offset: number,
    ) => {
      const map = scrollPositions.current;
      if (map.size >= SCROLL_POSITION_CAP && !map.has(id)) {
        const firstKey = map.keys().next().value;
        if (firstKey !== undefined) map.delete(firstKey);
      }
      map.set(id, { pos, topIndex, topId, offset, ts: Date.now() });
    },
    [],
  );
  const getScrollPosition = useCallback((id: string): ScrollPosition | undefined => {
    const sp = scrollPositions.current.get(id);
    if (!sp) return undefined;
    if (!isScrollPositionFresh(sp, Date.now())) {
      scrollPositions.current.delete(id);
      return undefined;
    }
    return sp;
  }, []);

  // ---- Router feeds the reducer ----
  // useRouteSync owns the URL hash and its history entries (back/forward undo).
  // Its four state-setters are bridged into the reducer so that a hash applied
  // on load, on in-app navigateTo, or on browser back/forward is always
  // replayed through the reducer's transition table. The reducer is the single
  // source of truth; the router is the adapter that feeds it.
  const applySection = useCallback(
    (section: Section) => dispatch({ type: "SET_SECTION", section }),
    [],
  );
  const applyOverview = useCallback(
    (overview: boolean) => dispatch({ type: "SET_OVERVIEW", overview }),
    [],
  );
  const applySessionId = useCallback((id: string | null) => {
    dispatch(
      id === null
        ? { type: "HYDRATE_OVERVIEW" }
        : { type: "HYDRATE_SESSION", id, stepIndex: undefined },
    );
  }, []);
  const applyFocusStep = useCallback(
    (stepIndex: number | undefined) => dispatch({ type: "SET_FOCUS_STEP", stepIndex }),
    [],
  );

  const { navigateTo } = useRouteSync({
    sessions,
    setActiveSection: applySection,
    setShowOverview: applyOverview,
    setActiveSessionId: applySessionId,
    setFocusStepIndex: applyFocusStep,
  });

  const { activeSessionId } = state;

  // When the selected session changes (e.g. via keyboard), clear any step focus
  // so a previously deep-linked step does not stay pinned on the next session.
  const isInitialIdRef = useRef(true);
  useEffect(() => {
    if (isInitialIdRef.current) {
      isInitialIdRef.current = false;
      return;
    }
    dispatch({ type: "CLEAR_FOCUS_STEP" });
  }, [activeSessionId]);

  // ---- Derived: active session + document title ----
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );
  useEffect(() => {
    document.title = activeSession ? `Omnivue \u2014 ${activeSession.title}` : "Omnivue";
  }, [activeSession]);

  // ---- Intent verbs ----
  const jumpToMessage = useCallback((target: FocusTarget) => {
    dispatch({ type: "JUMP_TO_MESSAGE", target });
  }, []);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      dispatch({ type: "SESSION_SELECT", id: sessionId });
      // Carry the active icon-channel section on the session route so a session
      // opened from a sidebar panel (e.g. a tag) keeps the user in that panel.
      // sessionRouteWithSection returns the plain route for the sessions
      // section, so the main session list and overview are unaffected.
      navigateTo(sessionRouteWithSection(sessionId, state.activeSection));
      // Mark all unread notifications for this session as read and jump to the
      // first notification's message if one exists. If the user has already
      // scrolled past that message (saved scroll), skip the jump and let normal
      // scroll restoration take them to where they left off.
      const unreadForSession = notifications.filter((n) => n.sessionId === sessionId && !n.readAt);
      const ids = unreadForSession.map((n) => n.id);
      if (ids.length > 0) {
        markNotificationRead(ids);
        const first = unreadForSession.sort((a, b) => a.createdAt - b.createdAt)[0];
        const saved = getScrollPosition(sessionId);
        const hasSavedScroll = saved !== undefined && saved.pos > 200;
        if (!hasSavedScroll) {
          dispatch({ type: "JUMP_TO_MESSAGE", target: parseMessageTarget(first.payload) });
        }
      }
    },
    [notifications, markNotificationRead, navigateTo, getScrollPosition, state.activeSection],
  );

  const handlePromptClick = useCallback(
    (sessionId: string, promptId: string) => {
      handleSessionSelect(sessionId);
      dispatch({ type: "HIGHLIGHT_PROMPT", promptId });
    },
    [handleSessionSelect],
  );

  const handleBookmarkSelect = useCallback(
    (bookmark: Bookmark) => {
      dispatch({ type: "BOOKMARK_SELECT", bookmark });
      // Bookmarks are opened from the bookmarks panel, so keep that icon-channel
      // section active instead of dropping back to the sessions section.
      navigateTo(sessionRouteWithSection(bookmark.sessionId, "bookmarks"));
    },
    [navigateTo],
  );

  const handleNotificationClick = useCallback(
    (n: AppNotification) => {
      dispatch({ type: "NOTIFICATION_SELECT", sessionId: n.sessionId, payload: n.payload });
      navigateTo(sessionRoute(n.sessionId));
      markNotificationRead([n.id]);
    },
    [markNotificationRead, navigateTo],
  );

  const handleDiffNavigateToMessage = useCallback((messageIndex: number, messageId?: string) => {
    dispatch({ type: "DIFF_NAV_TO_MESSAGE", messageIndex, messageId });
  }, []);

  const selectSearchHit = useCallback(
    (target: SearchHitTarget) => {
      dispatch({ type: "SEARCH_HIT_SELECT", ...target });
      navigateTo(sessionRoute(target.sessionId));
    },
    [navigateTo],
  );

  const setTab = useCallback((tab: Tab) => dispatch({ type: "SET_TAB", tab }), []);
  const setSection = useCallback(
    (section: Section) => {
      dispatch({ type: "SET_SECTION", section });
      // Switching the sidebar section must never close the open session. When a
      // session is showing, carry the new section on the session route so the
      // RHS keeps the conversation; only a bare section route when on overview.
      if (state.activeSessionId !== null && !state.showOverview) {
        navigateTo(sessionRouteWithSection(state.activeSessionId, section));
      } else {
        navigateTo(sectionRoute(section));
      }
    },
    [navigateTo, state.activeSessionId, state.showOverview],
  );
  const setShowOverview = useCallback(
    (v: boolean) => {
      if (v) navigateTo(HOME_ROUTE);
      dispatch({ type: "SET_OVERVIEW", overview: v });
    },
    [navigateTo],
  );
  const setSearchHighlightQuery = useCallback(
    (q: string | null) => dispatch({ type: "SET_SEARCH_HIGHLIGHT", query: q }),
    [],
  );
  const clearSearchHighlight = useCallback(() => dispatch({ type: "CLEAR_SEARCH_HIGHLIGHT" }), []);
  const goHome = useCallback(() => {
    dispatch({ type: "GO_HOME" });
    navigateTo(HOME_ROUTE);
  }, [navigateTo]);
  const openTag = useCallback(
    (name: string) => {
      dispatch({ type: "OPEN_TAG", name });
      navigateTo(sectionRoute("tags"));
    },
    [navigateTo],
  );
  const clearFilterTag = useCallback(() => dispatch({ type: "CLEAR_TAG" }), []);
  const clearFocus = useCallback(() => dispatch({ type: "CLEAR_FOCUS" }), []);
  const handleHighlightDone = useCallback(() => dispatch({ type: "HIGHLIGHT_DONE" }), []);
  const navigateSession = useCallback(
    (delta: 1 | -1, sessions: Session[]) => {
      const next = nextSessionId(sessions, activeSessionId, delta);
      dispatch({ type: "NAV_SESSION_DELTA", delta, sessions });
      navigateTo(next === null ? HOME_ROUTE : sessionRoute(next));
    },
    [activeSessionId, navigateTo],
  );

  const value = useMemo<NavigationValue>(
    () => ({
      ...state,
      activeSession,
      scrollPositions: scrollPositions.current,
      saveScrollPosition,
      getScrollPosition,
      navigateToSession: handleSessionSelect,
      jumpToMessage,
      clearFocus,
      goHome,
      openTag,
      clearFilterTag,
      handleSessionSelect,
      handlePromptClick,
      handleBookmarkSelect,
      handleNotificationClick,
      handleDiffNavigateToMessage,
      handleHighlightDone,
      selectSearchHit,
      setTab,
      setSection,
      setShowOverview,
      setSearchHighlightQuery,
      clearSearchHighlight,
      navigateSession,
    }),
    [
      state,
      activeSession,
      saveScrollPosition,
      getScrollPosition,
      handleSessionSelect,
      handlePromptClick,
      handleBookmarkSelect,
      handleNotificationClick,
      handleDiffNavigateToMessage,
      handleHighlightDone,
      selectSearchHit,
      setTab,
      setSection,
      setShowOverview,
      setSearchHighlightQuery,
      clearSearchHighlight,
      goHome,
      openTag,
      clearFilterTag,
      clearFocus,
      navigateSession,
      jumpToMessage,
    ],
  );

  return value;
}
