import type { Bookmark, Session } from "./types";
import type { Tab } from "../components/SessionViewer";
import type { Section } from "../components/IconChannel";

// ---------------------------------------------------------------------------
// Navigation intent — pure core
//
// This reducer owns every navigation state transition in the app: which
// session is selected, which view/tab/section is showing, and the message-jump
// focus target. The transition table is the whole navigation policy; the
// binding hook (useNavigation.tsx) only wires it to React, the URL, and the
// notification side-effects. Keeping it pure means the index-drift footguns
// are testable without React or a DOM.
// ---------------------------------------------------------------------------

export interface FocusTarget {
  messageIndex?: number;
  messageId?: string;
  stepIndex?: number;
}

export interface NavigationState {
  activeSessionId: string | null;
  showOverview: boolean;
  activeSection: Section;
  activeTab: Tab;
  focusStepIndex: number | undefined;
  focusMessageIndex: number | undefined;
  focusMessageKey: number;
  focusMessageId: string | undefined;
  searchHighlightQuery: string | null;
  highlightPromptId: string | null;
  filterTag: string | null;
}

export const initialNavigationState: NavigationState = {
  activeSessionId: null,
  showOverview: true,
  activeSection: "sessions",
  activeTab: "session",
  focusStepIndex: undefined,
  focusMessageIndex: undefined,
  focusMessageKey: 0,
  focusMessageId: undefined,
  searchHighlightQuery: null,
  highlightPromptId: null,
  filterTag: null,
};

export type NavigationAction =
  | { type: "SESSION_SELECT"; id: string }
  | { type: "JUMP_TO_MESSAGE"; target: FocusTarget }
  | { type: "CLEAR_FOCUS" }
  | { type: "CLEAR_FOCUS_STEP" }
  | { type: "GO_HOME" }
  | { type: "HIGHLIGHT_PROMPT"; promptId: string }
  | { type: "HIGHLIGHT_DONE" }
  | { type: "OPEN_TAG"; name: string }
  | { type: "CLEAR_TAG" }
  | { type: "BOOKMARK_SELECT"; bookmark: Bookmark }
  | { type: "NOTIFICATION_SELECT"; sessionId: string; payload: string | undefined }
  | { type: "DIFF_NAV_TO_MESSAGE"; messageIndex: number; messageId?: string }
  | {
      type: "SEARCH_HIT_SELECT";
      sessionId: string;
      tab: Tab;
      query: string | null;
      messageIndex?: number;
    }
  | { type: "SET_TAB"; tab: Tab }
  | { type: "SET_SECTION"; section: Section }
  | { type: "SET_OVERVIEW"; overview: boolean }
  | { type: "SET_SEARCH_HIGHLIGHT"; query: string | null }
  | { type: "CLEAR_SEARCH_HIGHLIGHT" }
  | { type: "NAV_SESSION_DELTA"; delta: 1 | -1; sessions: Session[] }
  | { type: "HYDRATE_SESSION"; id: string; stepIndex: number | undefined }
  | { type: "HYDRATE_OVERVIEW" };

// parseMessageTarget extracts a jump target from a notification payload string.
// This is the single place that reads messageIndex/messageId out of payloads;
// every notification-jump path (session select, notification click) routes here.
export function parseMessageTarget(payload: string | undefined): FocusTarget {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const target: FocusTarget = {};
    if (typeof parsed.messageIndex === "number") target.messageIndex = parsed.messageIndex;
    if (typeof parsed.messageId === "string") target.messageId = parsed.messageId;
    if (typeof parsed.stepIndex === "number") target.stepIndex = parsed.stepIndex;
    return target;
  } catch {
    // ignore malformed payload
    return {};
  }
}

function jumpFields(
  state: NavigationState,
  target: FocusTarget,
): Pick<
  NavigationState,
  "focusStepIndex" | "focusMessageIndex" | "focusMessageKey" | "focusMessageId"
> {
  return {
    focusStepIndex: target.stepIndex,
    focusMessageIndex: target.messageId !== undefined ? undefined : target.messageIndex,
    focusMessageKey: state.focusMessageKey + 1,
    focusMessageId: target.messageId,
  };
}

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "SESSION_SELECT":
      return {
        ...state,
        activeSessionId: action.id,
        showOverview: false,
        activeTab: "session",
        searchHighlightQuery: null,
        highlightPromptId: null,
        focusStepIndex: undefined,
        focusMessageIndex: undefined,
        focusMessageKey: 0,
        focusMessageId: undefined,
      };
    case "JUMP_TO_MESSAGE":
      return { ...state, ...jumpFields(state, action.target) };
    case "CLEAR_FOCUS":
      return {
        ...state,
        focusMessageIndex: undefined,
        focusMessageKey: 0,
        focusMessageId: undefined,
      };
    case "CLEAR_FOCUS_STEP":
      return { ...state, focusStepIndex: undefined };
    case "GO_HOME":
      return {
        ...state,
        activeSessionId: null,
        showOverview: true,
        activeTab: "session",
        searchHighlightQuery: null,
        highlightPromptId: null,
        focusStepIndex: undefined,
        focusMessageIndex: undefined,
      };
    case "HIGHLIGHT_PROMPT":
      return { ...state, highlightPromptId: action.promptId };
    case "HIGHLIGHT_DONE":
      return { ...state, highlightPromptId: null };
    case "OPEN_TAG":
      return { ...state, filterTag: action.name, activeSection: "tags" };
    case "CLEAR_TAG":
      return { ...state, filterTag: null };
    case "BOOKMARK_SELECT": {
      if (action.bookmark.kind === "plan") {
        return {
          ...state,
          showOverview: false,
          activeSessionId: action.bookmark.sessionId,
          activeTab: "plan",
          activeSection: "sessions",
          searchHighlightQuery: null,
        };
      }
      return {
        ...state,
        ...jumpFields(state, { messageIndex: action.bookmark.messageIndex }),
        showOverview: false,
        activeSessionId: action.bookmark.sessionId,
        activeTab: "session",
        activeSection: "sessions",
        searchHighlightQuery: null,
      };
    }
    case "NOTIFICATION_SELECT":
      return {
        ...state,
        ...jumpFields(state, parseMessageTarget(action.payload)),
        showOverview: false,
        activeSessionId: action.sessionId,
        activeTab: "session",
        activeSection: "sessions",
        searchHighlightQuery: null,
      };
    case "DIFF_NAV_TO_MESSAGE":
      return {
        ...state,
        ...jumpFields(state, { messageIndex: action.messageIndex, messageId: action.messageId }),
        activeTab: "session",
      };
    case "SEARCH_HIT_SELECT":
      return {
        ...state,
        showOverview: false,
        activeSessionId: action.sessionId,
        activeTab: action.tab,
        searchHighlightQuery: action.query,
        focusStepIndex: undefined,
        focusMessageIndex: action.messageIndex,
      };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_SECTION":
      return { ...state, activeSection: action.section };
    case "SET_OVERVIEW":
      return { ...state, showOverview: action.overview };
    case "SET_SEARCH_HIGHLIGHT":
      return { ...state, searchHighlightQuery: action.query };
    case "CLEAR_SEARCH_HIGHLIGHT":
      return { ...state, searchHighlightQuery: null, focusMessageIndex: undefined };
    case "NAV_SESSION_DELTA": {
      const sessions = action.sessions;
      const prev = state.activeSessionId;
      const idx =
        prev === null
          ? action.delta === 1
            ? -1
            : sessions.length
          : sessions.findIndex((s) => s.id === prev);
      let nextId: string | null;
      if (action.delta === 1) {
        nextId =
          idx < sessions.length - 1
            ? (sessions[idx + 1]?.id ?? null)
            : (prev ?? sessions[0]?.id ?? null);
      } else {
        nextId = idx > 0 ? (sessions[idx - 1]?.id ?? null) : (prev ?? sessions[0]?.id ?? null);
      }
      return {
        ...state,
        activeSessionId: nextId,
        showOverview: false,
        searchHighlightQuery: null,
      };
    }
    case "HYDRATE_SESSION":
      return {
        ...state,
        activeSessionId: action.id,
        showOverview: false,
        focusStepIndex: action.stepIndex,
      };
    case "HYDRATE_OVERVIEW":
      return {
        ...state,
        activeSessionId: null,
        showOverview: true,
        focusStepIndex: undefined,
      };
    default:
      return state;
  }
}
