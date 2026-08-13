import type { Bookmark, Position, Session } from "./types";
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
//
// Focus is anchored to the canonical Position identity (messageID +
// optional toolCallID) — the same key bookmarks, notifications, and the scroll
// registry use — so a jump is stable regardless of how assistant messages
// re-group during live reloads. Raw array indices are never used as identity.
// ---------------------------------------------------------------------------

export interface FocusTarget {
  position?: Position;
  // Legacy raw-index resolution for diff navigation and search hits (kept on
  // index/id per Q13 — never used as canonical identity).
  messageId?: string;
  messageIndex?: number;
}

export interface NavigationState {
  activeSessionId: string | null;
  showOverview: boolean;
  activeSection: Section;
  activeTab: Tab;
  focusPosition: Position | undefined;
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
  focusPosition: undefined,
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
  | { type: "HYDRATE_SESSION"; id: string }
  | { type: "HYDRATE_OVERVIEW" };

// parseMessageTarget extracts the canonical Position out of a notification
// payload string. This is the single place that reads identity out of payloads;
// every notification-jump path (session select, notification click) routes here.
export function parseMessageTarget(payload: string | undefined): FocusTarget {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const position = parsed.position as { messageID?: string; toolCallID?: string } | undefined;
    if (position && typeof position.messageID === "string" && position.messageID !== "") {
      return {
        position: { messageID: position.messageID, toolCallID: position.toolCallID || undefined },
      };
    }
    // Legacy payload (pre-position backend): fall back to a raw id. Kept so
    // stale in-flight notifications still navigate; identity still wins by
    // mapping the id into a Position.
    const legacyId = parsed.messageId;
    const legacyTool = parsed.toolCallId;
    if (typeof legacyId === "string" && legacyId !== "") {
      return {
        position: {
          messageID: legacyId,
          toolCallID: typeof legacyTool === "string" ? legacyTool : undefined,
        },
        messageId: legacyId,
      };
    }
    if (typeof parsed.messageIndex === "number") {
      return { messageIndex: parsed.messageIndex };
    }
    return {};
  } catch {
    // ignore malformed payload
    return {};
  }
}

function positionFromBookmark(b: Bookmark): Position | undefined {
  // Plan bookmarks have no message anchor; they are not a scroll target.
  if (b.kind === "plan" || !b.messageId) return undefined;
  return { messageID: b.messageId, toolCallID: b.toolCallId || undefined };
}

function jumpFields(
  state: NavigationState,
  target: FocusTarget,
): Pick<
  NavigationState,
  "focusPosition" | "focusMessageIndex" | "focusMessageKey" | "focusMessageId"
> {
  // Canonical identity wins: when a Position is present, a raw index is
  // meaningless (the block it used to name has no stable meaning), so it is
  // dropped rather than carried alongside.
  return {
    focusPosition: target.position,
    focusMessageIndex: target.position ? undefined : target.messageIndex,
    focusMessageKey: state.focusMessageKey + 1,
    focusMessageId: target.position ? undefined : target.messageId,
  };
}

// nextSessionId returns the session id delta=1/-1 moves to from prevId. This is
// the shared navigation-policy source for both the NAV_SESSION_DELTA transition
// and the URL-aware verb (useNavigation), so a keyboard jump and its URL stay
// in lockstep.
export function nextSessionId(
  sessions: Session[],
  prevId: string | null,
  delta: 1 | -1,
): string | null {
  const idx =
    prevId === null
      ? delta === 1
        ? -1
        : sessions.length
      : sessions.findIndex((s) => s.id === prevId);
  if (delta === 1) {
    return idx < sessions.length - 1
      ? (sessions[idx + 1]?.id ?? null)
      : (prevId ?? sessions[0]?.id ?? null);
  }
  return idx > 0 ? (sessions[idx - 1]?.id ?? null) : (prevId ?? sessions[0]?.id ?? null);
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
        focusPosition: undefined,
        focusMessageIndex: undefined,
        focusMessageId: undefined,
        focusMessageKey: 0,
      };
    case "JUMP_TO_MESSAGE":
      return { ...state, ...jumpFields(state, action.target) };
    case "CLEAR_FOCUS":
      return {
        ...state,
        focusPosition: undefined,
        focusMessageIndex: undefined,
        focusMessageId: undefined,
        focusMessageKey: 0,
      };
    case "GO_HOME":
      return {
        ...state,
        activeSessionId: null,
        showOverview: true,
        activeTab: "session",
        searchHighlightQuery: null,
        highlightPromptId: null,
        focusPosition: undefined,
        focusMessageIndex: undefined,
        focusMessageId: undefined,
        focusMessageKey: 0,
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
          searchHighlightQuery: null,
        };
      }
      const position = positionFromBookmark(action.bookmark);
      // A bookmark with no message anchor cannot drive a scroll target; select
      // the session but leave any existing focus untouched.
      return {
        ...state,
        ...(position
          ? jumpFields(state, { position })
          : { focusPosition: undefined, focusMessageKey: 0 }),
        showOverview: false,
        activeSessionId: action.bookmark.sessionId,
        activeTab: "session",
        searchHighlightQuery: null,
      };
    }
    case "NOTIFICATION_SELECT": {
      const target = parseMessageTarget(action.payload);
      return {
        ...state,
        ...(target.position || target.messageIndex !== undefined
          ? jumpFields(state, target)
          : { focusPosition: undefined, focusMessageKey: 0 }),
        showOverview: false,
        activeSessionId: action.sessionId,
        activeTab: "session",
        activeSection: "sessions",
        searchHighlightQuery: null,
      };
    }
    case "DIFF_NAV_TO_MESSAGE":
      // Diff navigation resolves by raw message index/id (unchanged from the
      // legacy diff path; the conversation maps it to a rendered block).
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
        focusPosition: undefined,
        focusMessageIndex: action.messageIndex,
        focusMessageKey: state.focusMessageKey + 1,
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
      return {
        ...state,
        searchHighlightQuery: null,
        focusPosition: undefined,
      };
    case "NAV_SESSION_DELTA": {
      const sessions = action.sessions;
      return {
        ...state,
        activeSessionId: nextSessionId(sessions, state.activeSessionId, action.delta),
        showOverview: false,
        searchHighlightQuery: null,
      };
    }
    case "HYDRATE_SESSION":
      return {
        ...state,
        activeSessionId: action.id,
        showOverview: false,
      };
    case "HYDRATE_OVERVIEW":
      return {
        ...state,
        activeSessionId: null,
        showOverview: true,
      };
    default:
      return state;
  }
}
