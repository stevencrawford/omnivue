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
    messageIndex: 3,
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
        focusStepIndex: 2,
        focusMessageIndex: 5,
        focusMessageKey: 3,
        focusMessageId: "m1",
        focusToolCallId: "tc1",
        focusRenderedIndex: true,
      });
      const next = navigationReducer(state, { type: "SESSION_SELECT", id: "s2" });
      expect(next.activeSessionId).toBe("s2");
      expect(next.showOverview).toBe(false);
      expect(next.activeTab).toBe("session");
      expect(next.searchHighlightQuery).toBeNull();
      expect(next.highlightPromptId).toBeNull();
      expect(next.focusStepIndex).toBeUndefined();
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusMessageId).toBeUndefined();
      expect(next.focusMessageKey).toBe(0);
      expect(next.focusToolCallId).toBeUndefined();
      expect(next.focusRenderedIndex).toBeUndefined();
    });
  });

  describe("JUMP_TO_MESSAGE", () => {
    it("prefers messageId and clears a stale index (id wins over index)", () => {
      const state = base({ focusMessageIndex: 9, focusMessageKey: 4 });
      const next = navigationReducer(state, {
        type: "JUMP_TO_MESSAGE",
        target: { messageId: "m42", messageIndex: 7, stepIndex: 1 },
      });
      expect(next.focusMessageId).toBe("m42");
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusStepIndex).toBe(1);
      expect(next.focusMessageKey).toBe(5);
    });

    it("carries a tool call id and rendered index through jumpFields", () => {
      const next = navigationReducer(base({ focusMessageKey: 0 }), {
        type: "JUMP_TO_MESSAGE",
        target: { messageIndex: 2, toolCallId: "tc-9", renderedIndex: true },
      });
      expect(next.focusMessageIndex).toBe(2);
      expect(next.focusToolCallId).toBe("tc-9");
      expect(next.focusRenderedIndex).toBe(true);
      expect(next.focusMessageKey).toBe(1);
    });

    it("clears tool call focus when the target has none", () => {
      const state = base({ focusMessageKey: 0, focusToolCallId: "tc-9", focusRenderedIndex: true });
      const next = navigationReducer(state, {
        type: "JUMP_TO_MESSAGE",
        target: { messageIndex: 2 },
      });
      expect(next.focusToolCallId).toBeUndefined();
      expect(next.focusRenderedIndex).toBeUndefined();
    });

    it("sets the index when no id is present", () => {
      const next = navigationReducer(base({ focusMessageKey: 0 }), {
        type: "JUMP_TO_MESSAGE",
        target: { messageIndex: 2 },
      });
      expect(next.focusMessageIndex).toBe(2);
      expect(next.focusMessageId).toBeUndefined();
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

    it("routes a message bookmark to the session tab, focuses it, and keeps the section", () => {
      const next = navigationReducer(base({ activeSection: "bookmarks", focusMessageKey: 2 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({ kind: "message", sessionId: "s9", messageIndex: 4 }),
      });
      expect(next.activeTab).toBe("session");
      expect(next.focusMessageIndex).toBe(4);
      expect(next.focusMessageKey).toBe(3);
      expect(next.activeSection).toBe("bookmarks");
    });

    it("carries the rendered index and tool call id for message bookmarks", () => {
      const next = navigationReducer(base({ focusMessageKey: 2 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({
          kind: "message",
          sessionId: "s9",
          messageIndex: 4,
          toolCallId: "tc-1",
        }),
      });
      expect(next.focusMessageIndex).toBe(4);
      expect(next.focusToolCallId).toBe("tc-1");
      expect(next.focusRenderedIndex).toBe(true);
      expect(next.focusMessageKey).toBe(3);
    });

    it("clears a prior tool call focus when jumping to a plain message bookmark", () => {
      const next = navigationReducer(base({ focusToolCallId: "old-tc", focusMessageKey: 1 }), {
        type: "BOOKMARK_SELECT",
        bookmark: bookmark({ kind: "message", sessionId: "s9", messageIndex: 4 }),
      });
      expect(next.focusMessageIndex).toBe(4);
      expect(next.focusToolCallId).toBeUndefined();
      expect(next.focusRenderedIndex).toBe(true);
    });
  });

  describe("NOTIFICATION_SELECT", () => {
    it("parses the payload target and selects the session", () => {
      const next = navigationReducer(base({ focusMessageId: "old", focusMessageKey: 1 }), {
        type: "NOTIFICATION_SELECT",
        sessionId: "s3",
        payload: JSON.stringify({ messageId: "m77", stepIndex: 2 }),
      });
      expect(next.activeSessionId).toBe("s3");
      expect(next.activeTab).toBe("session");
      expect(next.focusMessageId).toBe("m77");
      expect(next.focusMessageIndex).toBeUndefined();
    });

    it("tolerates a malformed payload", () => {
      const next = navigationReducer(base(), {
        type: "NOTIFICATION_SELECT",
        sessionId: "s3",
        payload: "not json",
      });
      expect(next.activeSessionId).toBe("s3");
      expect(next.focusMessageIndex).toBeUndefined();
    });
  });

  describe("SEARCH_HIT_SELECT", () => {
    it("sets the tab from the chunk and focuses the hit without a key bump", () => {
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
      expect(next.focusStepIndex).toBeUndefined();
      expect(next.focusToolCallId).toBeUndefined();
      expect(next.focusRenderedIndex).toBeUndefined();
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
          focusMessageIndex: 2,
        }),
        { type: "GO_HOME" },
      );
      expect(next.activeSessionId).toBeNull();
      expect(next.showOverview).toBe(true);
      expect(next.activeTab).toBe("session");
      expect(next.searchHighlightQuery).toBeNull();
      expect(next.highlightPromptId).toBeNull();
      expect(next.focusMessageIndex).toBeUndefined();
    });

    it("CLEAR_FOCUS clears the message focus only", () => {
      const next = navigationReducer(
        base({
          focusMessageIndex: 2,
          focusMessageId: "m",
          focusMessageKey: 5,
          focusStepIndex: 1,
          focusToolCallId: "tc",
          focusRenderedIndex: true,
        }),
        { type: "CLEAR_FOCUS" },
      );
      expect(next.focusMessageIndex).toBeUndefined();
      expect(next.focusMessageId).toBeUndefined();
      expect(next.focusMessageKey).toBe(0);
      expect(next.focusStepIndex).toBe(1);
      expect(next.focusToolCallId).toBeUndefined();
      expect(next.focusRenderedIndex).toBeUndefined();
    });
  });

  describe("parseMessageTarget", () => {
    it("reads the recognised fields", () => {
      expect(
        parseMessageTarget(
          JSON.stringify({ messageIndex: 1, messageId: "m", stepIndex: 2, toolCallId: "tc" }),
        ),
      ).toEqual({ messageIndex: 1, messageId: "m", stepIndex: 2, toolCallId: "tc" });
    });

    it("returns empty for garbage", () => {
      expect(parseMessageTarget("")).toEqual({});
      expect(parseMessageTarget("nope")).toEqual({});
    });
  });
});
