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
  parseMessageTarget,
  type FocusTarget,
  type NavigationState,
} from "./navigationReducer";
import type { Tab } from "../components/SessionViewer";
import type { Section } from "../components/IconChannel";

// ---------------------------------------------------------------------------
// Navigation intent — React binding
//
// The pure transition table lives in navigationReducer.ts; this hook wires it
// to React (useReducer), to the URL hash (deep links, back/forward), and to
// the notification side-effects (mark-read + jump to the earliest unread).
// Callers cross the seam with intent verbs — navigateToSession, jumpToMessage,
// goHome — never with raw setters.
// ---------------------------------------------------------------------------

const SESSION_HASH = /^#\/session\/([^/]+)(?:\/step\/(\d+))?/;

// The canonical URL hash for an app state. Overview ("#/") wins over a selected
// session; an empty string means "no hash, no overview" (initial load).
function serializeHash(activeSessionId: string | null, showOverview: boolean): string {
  if (showOverview) return "#/";
  if (activeSessionId) return `#/session/${encodeURIComponent(activeSessionId)}`;
  return "";
}

export interface SearchHitTarget {
  sessionId: string;
  tab: Tab;
  query: string | null;
  messageIndex?: number;
}

export interface NavigationValue extends NavigationState {
  activeSession: Session | null;
  scrollPositions: Map<string, number>;
  saveScrollPosition: (id: string, pos: number) => void;
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
  const scrollPositions = useRef(new Map<string, number>());
  const saveScrollPosition = useCallback((id: string, pos: number) => {
    const map = scrollPositions.current;
    if (map.size >= SCROLL_POSITION_CAP && !map.has(id)) {
      const firstKey = map.keys().next().value;
      if (firstKey !== undefined) map.delete(firstKey);
    }
    map.set(id, pos);
  }, []);

  // ---- URL hash sync ----
  // True once the URL hash has been read into state, so the writer effect does
  // not push an un-read (initial/empty) state over a deep-link hash.
  const hashAppliedRef = useRef(false);

  const applyHash = useCallback(() => {
    const hash = window.location.hash;
    const match = hash.match(SESSION_HASH);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (sessions.some((s) => s.id === id)) {
        dispatch({
          type: "HYDRATE_SESSION",
          id,
          stepIndex: match[2] ? parseInt(match[2], 10) : undefined,
        });
      }
    } else if (hash === "#/" || hash === "" || hash === "#") {
      dispatch({ type: "HYDRATE_OVERVIEW" });
    }
    hashAppliedRef.current = true;
  }, [sessions]);

  // One-time: apply the URL hash (deep link) once sessions are available and
  // before the writer effect gets a chance to overwrite it.
  useEffect(() => {
    if (hashAppliedRef.current) return;
    if (sessions.length === 0) return;
    applyHash();
  }, [sessions, applyHash]);

  const { activeSessionId, showOverview } = state;

  // Push internal state changes to the URL. Idempotent guard: when the URL
  // already matches, do nothing, so an internal change never clobbers a hash
  // that the listener just applied from back/forward. replaceState does not
  // emit `hashchange`, so there is no echo loop.
  useEffect(() => {
    if (!hashAppliedRef.current) return;
    const target = serializeHash(activeSessionId, showOverview);
    const current = window.location.hash;
    if (target === "#/") {
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
  // deep-linked step does not stay pinned on the next session.
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
      // Mark all unread notifications for this session as read and jump to the
      // first notification's message if one exists. If the user has already
      // scrolled past that message (saved scroll), skip the jump and let normal
      // scroll restoration take them to where they left off.
      const unreadForSession = notifications.filter((n) => n.sessionId === sessionId && !n.readAt);
      const ids = unreadForSession.map((n) => n.id);
      if (ids.length > 0) {
        markNotificationRead(ids);
        const first = unreadForSession.sort((a, b) => a.createdAt - b.createdAt)[0];
        const savedPos = scrollPositions.current.get(sessionId);
        const hasSavedScroll = savedPos !== undefined && savedPos > 200;
        if (!hasSavedScroll) {
          dispatch({ type: "JUMP_TO_MESSAGE", target: parseMessageTarget(first.payload) });
        }
      }
    },
    [notifications, markNotificationRead],
  );

  const handlePromptClick = useCallback(
    (sessionId: string, promptId: string) => {
      handleSessionSelect(sessionId);
      dispatch({ type: "HIGHLIGHT_PROMPT", promptId });
    },
    [handleSessionSelect],
  );

  const handleBookmarkSelect = useCallback((bookmark: Bookmark) => {
    dispatch({ type: "BOOKMARK_SELECT", bookmark });
  }, []);

  const handleNotificationClick = useCallback(
    (n: AppNotification) => {
      dispatch({ type: "NOTIFICATION_SELECT", sessionId: n.sessionId, payload: n.payload });
      markNotificationRead([n.id]);
    },
    [markNotificationRead],
  );

  const handleDiffNavigateToMessage = useCallback((messageIndex: number, messageId?: string) => {
    dispatch({ type: "DIFF_NAV_TO_MESSAGE", messageIndex, messageId });
  }, []);

  const selectSearchHit = useCallback((target: SearchHitTarget) => {
    dispatch({ type: "SEARCH_HIT_SELECT", ...target });
  }, []);

  const setTab = useCallback((tab: Tab) => dispatch({ type: "SET_TAB", tab }), []);
  const setSection = useCallback(
    (section: Section) => dispatch({ type: "SET_SECTION", section }),
    [],
  );
  const setShowOverview = useCallback(
    (v: boolean) => dispatch({ type: "SET_OVERVIEW", overview: v }),
    [],
  );
  const setSearchHighlightQuery = useCallback(
    (q: string | null) => dispatch({ type: "SET_SEARCH_HIGHLIGHT", query: q }),
    [],
  );
  const clearSearchHighlight = useCallback(() => dispatch({ type: "CLEAR_SEARCH_HIGHLIGHT" }), []);
  const goHome = useCallback(() => dispatch({ type: "GO_HOME" }), []);
  const openTag = useCallback((name: string) => dispatch({ type: "OPEN_TAG", name }), []);
  const clearFilterTag = useCallback(() => dispatch({ type: "CLEAR_TAG" }), []);
  const clearFocus = useCallback(() => dispatch({ type: "CLEAR_FOCUS" }), []);
  const handleHighlightDone = useCallback(() => dispatch({ type: "HIGHLIGHT_DONE" }), []);
  const navigateSession = useCallback((delta: 1 | -1, sessions: Session[]) => {
    dispatch({ type: "NAV_SESSION_DELTA", delta, sessions });
  }, []);

  const value = useMemo<NavigationValue>(
    () => ({
      ...state,
      activeSession,
      scrollPositions: scrollPositions.current,
      saveScrollPosition,
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
