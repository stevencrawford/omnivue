import { createElement } from "react";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import {
  isScrollPositionFresh,
  SCROLL_POSITION_TTL_MS,
  NavigationContext,
  defaultNavigationValue,
  type ScrollPosition,
} from "../useNavigation";
import {
  captureAnchor,
  RESTORE_CLASS,
  restoreTo,
  useConversationScroll,
} from "../useConversationScroll";

// jsdom gives every element offsetTop = 0 / scrollHeight = 0; define them so the
// anchor math is exercised with real numbers.
function makeContainer(blocks: Array<{ offsetTop: number; index?: number; id?: string }>) {
  const container = document.createElement("div");
  for (const b of blocks) {
    const el = document.createElement("div");
    if (b.index !== undefined) el.setAttribute("data-message-index", String(b.index));
    if (b.id !== undefined) el.setAttribute("data-message-id", b.id);
    Object.defineProperty(el, "offsetTop", { value: b.offsetTop, configurable: true });
    container.appendChild(el);
  }
  return container;
}

function setScrollProps(el: HTMLElement, scrollTop: number, scrollHeight: number) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
}

function sp(over: Partial<ScrollPosition> = {}): ScrollPosition {
  return { pos: 0, topIndex: undefined, topId: undefined, offset: 0, ts: 0, ...over };
}

function awaitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("isScrollPositionFresh", () => {
  it("accepts a recent entry", () => {
    const now = 1_000_000;
    expect(isScrollPositionFresh(sp({ ts: now - 1000 }), now)).toBe(true);
  });

  it("expires an entry older than one day", () => {
    const now = 1_000_000;
    expect(isScrollPositionFresh(sp({ ts: now - SCROLL_POSITION_TTL_MS - 1 }), now)).toBe(false);
  });

  it("expires exactly at the boundary", () => {
    const now = 1_000_000;
    expect(isScrollPositionFresh(sp({ ts: now - SCROLL_POSITION_TTL_MS }), now)).toBe(false);
  });
});

describe("captureAnchor", () => {
  it("picks the last block that starts at or above the viewport top", () => {
    const el = makeContainer([
      { offsetTop: 0, index: 0, id: "m0" },
      { offsetTop: 400, index: 1, id: "m1" },
      { offsetTop: 900, index: 2, id: "m2" },
    ]);
    setScrollProps(el, 450, 5000);
    expect(captureAnchor(el)).toEqual({
      topIndex: 1,
      topId: "m1",
      offset: 50,
    });
  });

  it("anchors the first block when scrolled exactly to its top edge", () => {
    const el = makeContainer([
      { offsetTop: 0, index: 0, id: "m0" },
      { offsetTop: 400, index: 1, id: "m1" },
    ]);
    setScrollProps(el, 0, 4000);
    expect(captureAnchor(el)).toEqual({ topIndex: 0, topId: "m0", offset: 0 });
  });

  it("returns empty when no block qualifies (scrolled above the first)", () => {
    const el = makeContainer([{ offsetTop: 200, index: 0, id: "m0" }]);
    setScrollProps(el, 0, 4000);
    expect(captureAnchor(el)).toEqual({ topIndex: undefined, topId: undefined, offset: 0 });
  });
});

describe("restoreTo", () => {
  it("re-lands on the saved block offset when the anchor exists", () => {
    const el = makeContainer([
      { offsetTop: 0, index: 0, id: "m0" },
      { offsetTop: 400, index: 1, id: "m1" },
      { offsetTop: 900, index: 2, id: "m2" },
    ]);
    setScrollProps(el, 0, 5000);
    const ok = restoreTo(el, sp({ pos: 99999, topIndex: 1, topId: "m1", offset: 50 }), false);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(450);
    expect(el.classList.contains(RESTORE_CLASS)).toBe(true);
  });

  it("falls back to the absolute pixel when the anchor is gone", () => {
    const el = makeContainer([{ offsetTop: 0, index: 0, id: "m0" }]);
    setScrollProps(el, 0, 5000);
    const ok = restoreTo(el, sp({ pos: 1234, topIndex: 7, topId: "m7", offset: 50 }), false);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(1234);
  });

  it("scrolls to bottom when requested on a stale entry", () => {
    const el = makeContainer([{ offsetTop: 0, index: 0, id: "m0" }]);
    setScrollProps(el, 0, 4321);
    const ok = restoreTo(el, sp({ pos: 0 }), true);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(4321);
  });

  it("bails out when the container is not laid out yet", () => {
    const el = makeContainer([]);
    Object.defineProperty(el, "scrollHeight", { value: 0, configurable: true });
    expect(restoreTo(el, sp({ pos: 100 }), false)).toBe(false);
    expect(el.scrollTop).toBe(0);
  });

  it("bails out on a sized container with no message blocks yet", () => {
    // The mount pass runs before messages load: the scroll container is sized
    // (scrollHeight > 0) but has no rendered blocks. restoreTo must not count
    // that as a successful restore, or the caller burns its once-only guard and
    // skips the real anchor restore once the blocks exist.
    const el = makeContainer([]);
    setScrollProps(el, 0, 4000);
    expect(restoreTo(el, sp({ pos: 100, topIndex: 1, topId: "m1", offset: 0 }), false)).toBe(false);
    expect(restoreTo(el, sp({ pos: 100 }), true)).toBe(false);
    expect(el.classList.contains(RESTORE_CLASS)).toBe(false);
    expect(el.scrollTop).toBe(0);
  });

  it("keeps the resolve class until the restore frame; clears it on the next", async () => {
    const el = makeContainer([{ offsetTop: 0, index: 0, id: "m0" }]);
    setScrollProps(el, 0, 1000);
    restoreTo(el, sp({ pos: 500, topIndex: 7, topId: "m7", offset: 0 }), false);
    expect(el.classList.contains(RESTORE_CLASS)).toBe(true);
    await awaitFrame();
    expect(el.classList.contains(RESTORE_CLASS)).toBe(false);
  });
});

// Renders the hook and owns the scroll container so an unmount flush can be
// observed against a real element with an attached ref.
function ScrollHarness({ sessionId }: { sessionId: string }) {
  const { scrollRef } = useConversationScroll({ sessionId, messageCount: 2 });
  return createElement(
    "div",
    { id: "scroll-container", ref: scrollRef },
    createElement("div", { "data-message-index": "0", "data-message-id": "m0" }),
    createElement("div", { "data-message-index": "1", "data-message-id": "m1" }),
  );
}

describe("useConversationScroll unmount flush", () => {
  beforeAll(() => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("saves the current position on unmount before the debounce fires", () => {
    const saveScrollPosition = vi.fn();
    const navValue = {
      ...defaultNavigationValue,
      getScrollPosition: () => undefined,
      saveScrollPosition,
    };
    const { unmount } = render(
      createElement(
        NavigationContext.Provider,
        { value: navValue },
        createElement(ScrollHarness, { sessionId: "s1" }),
      ),
    );
    const container = document.getElementById("scroll-container") as HTMLDivElement;
    const blocks = container.querySelectorAll("[data-message-index]");
    Object.defineProperty(container, "scrollTop", { value: 450, configurable: true });
    Object.defineProperty(blocks[1], "offsetTop", { value: 400, configurable: true });

    unmount();

    // Unmounting inside the 300ms scroll-debounce window must still persist the
    // position; the flush runs in a layout cleanup while the element is attached.
    expect(saveScrollPosition).toHaveBeenCalledTimes(1);
    expect(saveScrollPosition).toHaveBeenCalledWith("s1", 450, 1, "m1", 50);
  });
});
