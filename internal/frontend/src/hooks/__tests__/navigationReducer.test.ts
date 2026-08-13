import { describe, expect, it } from "vitest";
import type { Session, Bookmark } from "../types";
import {
  navigationReducer,
  initialNavigationState,
  parseMessageTarget,
  type NavigationState,
} from "../navigationReducer";

function base(over: Partial<NavigationState> = {}): NavigationState {
  return { ...initialNavigationState, ...over };
}

function session(id: string): Session {
  return { id } as Session;
}

function bookmark(partial: Partial<Bookmark>): Bookmark {
  return {
    id: "b1",
    sessionId: "s1",
    messageId: "m1",
    label: "L",
    kind: "message",
    ...partial,
  } as Bookmark;
}

describe("navigationReducer", () => {
  describe("SESSION_SELECT", () => {
    it("switches to the session tab, clears highlight and all focus", () => {
      const state = base({
        activeSessionId: "old",
        showOverview: false,
        activeTab: "diff",
        searchHighlightQuery: "foo",
        highlightPromptId: "p",
        focusPosition: { messageID: "m9", toolCallID: "tc1" },
        focusMessageIndex: 5,
        focusMessageKey: 3,
        focusMessageId: "m1",
      });
      const next = navigationReducer(state, { type: "SESSION_SELECT", id: "s2" });
      expect(next.activeSessionId).toBe("s2");
      expect(next.showOverview).toBe(false);
      expect(next.activeTab).toBe("session");
      expect(next.searchHighlightQuery).toBeNull();
      expect(next.highlightPromptId).toBeNull();
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusMessageId).toBeUndefined();
      expect(next.focusMessageKey).toBe(0);
    });
  });

  describe("JUMP_TO_MESSAGE", () => {
    it("prefers the canonical position over a raw index", () => {
      const state = base({ focusMessageIndex: 9, focusMessageKey: 4 });
      const next = navigationReducer(state, {
        type: "JUMP_TO_MESSAGE",
        target: { position: { messageID: "m42" }, messageIndex: 7 },
      });
      expect(next.focusPosition?.messageID).toBe("m42");
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusMessageKey).toBe(5);
    });

    it("carries a tool call id through the position", () => {
      const next = navigationReducer(base({ focusMessageKey: 0 }), {
        type: "JUMP_TO_MESSAGE",
        target: { position: { messageID: "m2", toolCallID: "tc-9" } },
      });
      expect(next.focusPosition?.messageID).toBe("m2");
      expect(next.focusPosition?.toolCallID).toBe("tc-9");
      expect(next.focusMessageKey).toBe(1);
    });

    it("clears a stale position when the target has none", () => {
      const state = base({
        focusMessageKey: 0,
        focusPosition: { messageID: "m-old", toolCallID: "tc-9" },
      });
      const next = navigationReducer(state, {
        type: "JUMP_TO_MESSAGE",
        target: { messageIndex: 2 },
      });
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageIndex).toBe(2);
    });

    it("sets the raw index when no position is present", () => {
      const next = navigationReducer(base({ focusMessageKey: 0 }), {
        type: "JUMP_TO_MESSAGE",
        target: { messageIndex: 2 },
      });
      expect(next.focusMessageIndex).toBe(2);
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageKey).toBe(1);
    });
  });

  describe("BOOKMARK_SELECT", () => {
    it("routes a plan bookmark to the plan tab and keeps the section", () => {
      const next = navigationReducer(base({ activeSection: "bookmarks" }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({ kind: "plan", sessionId: "s9" }),
      });
      expect(next.activeTab).toBe("plan");
      expect(next.activeSessionId).toBe("s9");
      expect(next.showOverview).toBe(false);
      expect(next.activeSection).toBe("bookmarks");
    });

    it("routes a message bookmark to the session tab and focuses its position", () => {
      const next = navigationReducer(base({ activeSection: "bookmarks", focusMessageKey: 2 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({ kind: "message", sessionId: "s9", messageId: "m44" }),
      });
      expect(next.activeTab).toBe("session");
      expect(next.focusPosition?.messageID).toBe("m44");
      expect(next.focusPosition?.toolCallID).toBeUndefined();
      expect(next.focusMessageKey).toBe(3);
      expect(next.activeSection).toBe("bookmarks");
    });

    it("carries the tool call id for tool-level message bookmarks", () => {
      const next = navigationReducer(base({ focusMessageKey: 2 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({
          kind: "message",
          sessionId: "s9",
          messageId: "m44",
          toolCallId: "tc-1",
        }),
      });
      expect(next.focusPosition?.messageID).toBe("m44");
      expect(next.focusPosition?.toolCallID).toBe("tc-1");
      expect(next.focusMessageKey).toBe(3);
    });

    it("clears a prior position when jumping to a plain message bookmark", () => {
      const next = navigationReducer(
        base({ focusPosition: { messageID: "old-tc" }, focusMessageKey: 1 }),
        {
          type: "BOOKMARK_SELECT",
          bookmark: bookmark({ kind: "message", sessionId: "s9", messageId: "m44" }),
        },
      );
      expect(next.focusPosition?.messageID).toBe("m44");
      expect(next.focusPosition?.toolCallID).toBeUndefined();
    });

    it("drops bookmarks with no message anchor (cannot resolve a scroll target)", () => {
      const next = navigationReducer(base({ focusMessageKey: 1 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({ kind: "message", sessionId: "s9", messageId: undefined }),
      });
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageKey).toBe(0);
    });
  });

  describe("NOTIFICATION_SELECT", () => {
    it("parses the position payload and selects the session", () => {
      const next = navigationReducer(
        base({ focusPosition: { messageID: "old" }, focusMessageKey: 1 }),
        {
          type: "NOTIFICATION_SELECT",
          sessionId: "s3",
          payload: JSON.stringify({ position: { messageID: "m77", toolCallID: "tc-2" } }),
        },
      );
      expect(next.activeSessionId).toBe("s3");
      expect(next.activeTab).toBe("session");
      expect(next.focusPosition?.messageID).toBe("m77");
      expect(next.focusPosition?.toolCallID).toBe("tc-2");
      expect(next.focusMessageIndex).toBeUndefined();
    });

    it("falls back to a legacy id payload", () => {
      const next = navigationReducer(base(), {
        type: "NOTIFICATION_SELECT",
        sessionId: "s3",
        payload: JSON.stringify({ messageId: "m77" }),
      });
      expect(next.focusPosition?.messageID).toBe("m77");
    });

    it("tolerates a malformed payload", () => {
      const next = navigationReducer(base(), {
        type: "NOTIFICATION_SELECT",
        sessionId: "s3",
        payload: "not json",
      });
      expect(next.activeSessionId).toBe("s3");
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusPosition).toBeUndefined();
    });
  });

  describe("SEARCH_HIT_SELECT", () => {
    it("sets the tab from the chunk, highlights, and bumps the focus key", () => {
      const next = navigationReducer(base({ focusMessageKey: 4 }), {
        type: "SEARCH_HIT_SELECT",
        sessionId: "s1",
        tab: "plan",
        query: "needle",
        messageIndex: 2,
      });
      expect(next.activeSessionId).toBe("s1");
      expect(next.activeTab).toBe("plan");
      expect(next.searchHighlightQuery).toBe("needle");
      expect(next.focusMessageIndex).toBe(2);
      expect(next.focusMessageKey).toBe(5);
    });
  });

  describe("NAV_SESSION_DELTA", () => {
    const sessions = [session("a"), session("b"), session("c")];

    it("moves to the next session", () => {
      const next = navigationReducer(base({ activeSessionId: "a" }), {
        type: "NAV_SESSION_DELTA",
        delta: 1,
        sessions,
      });
      expect(next.activeSessionId).toBe("b");
      expect(next.showOverview).toBe(false);
    });

    it("moves to the previous session", () => {
      const next = navigationReducer(base({ activeSessionId: "b" }), {
        type: "NAV_SESSION_DELTA",
        delta: -1,
        sessions,
      });
      expect(next.activeSessionId).toBe("a");
    });

    it("wraps next from the last session", () => {
      const next = navigationReducer(base({ activeSessionId: "c" }), {
        type: "NAV_SESSION_DELTA",
        delta: 1,
        sessions,
      });
      expect(next.activeSessionId).toBe("c");
    });

    it("starts from the first session when none selected going forward", () => {
      const next = navigationReducer(base({ activeSessionId: null }), {
        type: "NAV_SESSION_DELTA",
        delta: 1,
        sessions,
      });
      expect(next.activeSessionId).toBe("a");
    });
  });

  describe("GO_HOME / CLEAR_* ", () => {
    it("GO_HOME resets selection, overview, tab and highlight", () => {
      const next = navigationReducer(
        base({
          activeSessionId: "s1",
          showOverview: false,
          activeTab: "diff",
          searchHighlightQuery: "q",
          highlightPromptId: "p",
          focusPosition: { messageID: "m9" },
          focusMessageIndex: 2,
        }),
        { type: "GO_HOME" },
      );
      expect(next.activeSessionId).toBeNull();
      expect(next.showOverview).toBe(true);
      expect(next.activeTab).toBe("session");
      expect(next.searchHighlightQuery).toBeNull();
      expect(next.highlightPromptId).toBeNull();
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageIndex).toBeUndefined();
    });

    it("CLEAR_FOCUS clears the message focus only", () => {
      const next = navigationReducer(
        base({
          focusMessageIndex: 2,
          focusMessageId: "m",
          focusMessageKey: 5,
          focusPosition: { messageID: "m9", toolCallID: "tc" },
        }),
        { type: "CLEAR_FOCUS" },
      );
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusMessageId).toBeUndefined();
      expect(next.focusPosition).toBeUndefined();
      expect(next.focusMessageKey).toBe(0);
    });
  });

  describe("parseMessageTarget", () => {
    it("reads the canonical position", () => {
      expect(
        parseMessageTarget(
          JSON.stringify({ position: { messageID: "m1", toolCallID: "tc" }, other: 1 }),
        ),
      ).toEqual({ position: { messageID: "m1", toolCallID: "tc" } });
    });

    it("falls back to a legacy messageId/toolCallId payload", () => {
      expect(parseMessageTarget(JSON.stringify({ messageId: "m1", toolCallId: "tc" }))).toEqual({
        position: { messageID: "m1", toolCallID: "tc" },
        messageId: "m1",
      });
      expect(parseMessageTarget(JSON.stringify({ messageId: "m2" }))).toEqual({
        position: { messageID: "m2" },
        messageId: "m2",
      });
    });

    it("returns empty for garbage or an empty position", () => {
      expect(parseMessageTarget("")).toEqual({});
      expect(parseMessageTarget("nope")).toEqual({});
      expect(parseMessageTarget(JSON.stringify({ position: {} }))).toEqual({});
    });
  });
});
