import { describe, expect, it } from "vitest";
import {
  isScrollPositionFresh,
  SCROLL_POSITION_TTL_MS,
  type ScrollPosition,
} from "../useNavigation";
import {
  captureAnchor,
  hasPendingFocus,
  measureRegistry,
  measureTail,
  RESTORE_CLASS,
  restoreTo,
  scrollToRendered,
  type BlockGeom,
  type BlockRegistry,
} from "../useConversationScroll";

// jsdom gives every element offsetTop = 0 / scrollHeight = 0; define them so the
// anchor geometry math is exercised with real numbers. scrollToRendered measures
// nested targets via getBoundingClientRect (viewport-relative), so provide both.
type BlockSpec = { top: number; height?: number; index?: number; id?: string };

function rect(top: number, height: number): DOMRect {
  return {
    top,
    left: 0,
    right: 0,
    bottom: top + height,
    x: 0,
    y: top,
    width: 0,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeContainer(blocks: BlockSpec[]) {
  const container = document.createElement("div");
  for (const b of blocks) {
    const el = document.createElement("div");
    if (b.index !== undefined) el.setAttribute("data-message-index", String(b.index));
    if (b.id !== undefined) el.setAttribute("data-message-id", b.id);
    Object.defineProperty(el, "offsetTop", { value: b.top, configurable: true });
    Object.defineProperty(el, "offsetHeight", {
      value: b.height ?? 200,
      configurable: true,
    });
    el.getBoundingClientRect = () => rect(b.top, b.height ?? 200);
    container.appendChild(el);
  }
  return container;
}

function setScrollProps(
  el: HTMLElement,
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 600,
) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.getBoundingClientRect = () => rect(0, clientHeight);
}

function makeRegistry(blocks: BlockSpec[], scrollHeight = 5000): BlockRegistry {
  const byIndex = new Map<number, BlockGeom>();
  const indexById = new Map<string, number>();
  for (const b of blocks) {
    if (b.index === undefined) continue;
    byIndex.set(b.index, { top: b.top, height: b.height ?? 200 });
    if (b.id) indexById.set(b.id, b.index);
  }
  return { byIndex, indexById, scrollHeight, version: 1 };
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

describe("hasPendingFocus", () => {
  it("is true for every jump kind", () => {
    expect(hasPendingFocus({ focusMessageIndex: 3 })).toBe(true);
    expect(hasPendingFocus({ focusMessageId: "m" })).toBe(true);
    expect(hasPendingFocus({ focusToolCallId: "tc" })).toBe(true);
    expect(hasPendingFocus({ focusStepIndex: 1 })).toBe(true);
  });

  it("is false when no focus field is set", () => {
    expect(hasPendingFocus({})).toBe(false);
  });
});

describe("measureRegistry", () => {
  it("records true geometry for every block and the real scrollHeight", () => {
    const el = makeContainer([
      { index: 0, top: 0, height: 100, id: "m0" },
      { index: 1, top: 400, height: 300, id: "m1" },
      { index: 2, top: 900, height: 80, id: "m2" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 4321);
    const reg = measureRegistry(el, null);
    expect(reg.byIndex.get(1)).toEqual({ top: 400, height: 300 });
    expect(reg.indexById.get("m2")).toBe(2);
    expect(reg.scrollHeight).toBe(4321);
    expect(reg.version).toBe(1);
  });

  it("lifts content-visibility for the pass and drops it on the next frame", async () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 1000);
    measureRegistry(el, null);
    expect(el.classList.contains(RESTORE_CLASS)).toBe(true);
    await awaitFrame();
    expect(el.classList.contains(RESTORE_CLASS)).toBe(false);
  });

  it("increments the version across consecutive passes", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 1000);
    const a = measureRegistry(el, null);
    const b = measureRegistry(el, a);
    expect(b.version).toBe(a.version + 1);
  });
});

describe("measureTail", () => {
  it("re-measures only blocks at or beyond fromIndex and keeps older geometry", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 5000);
    const base = measureRegistry(el, null);
    // New tail arrives; index 2 shifts because m1 grew underneath it.
    Object.defineProperty(
      el.querySelector('[data-message-index="2"]') as HTMLElement,
      "offsetTop",
      { value: 950, configurable: true },
    );
    const tail = measureTail(el, 2, base);
    expect(tail.byIndex.get(1)).toEqual({ top: 400, height: 200 });
    expect(tail.byIndex.get(2)).toEqual({ top: 950, height: 200 });
    expect(tail.indexById.get("m2")).toBe(2);
    expect(tail.version).toBe(base.version + 1);
  });
});

describe("captureAnchor", () => {
  it("picks the last block that starts at or above the viewport top via the registry", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    setScrollProps(el as HTMLDivElement, 450, 5000);
    const reg = makeRegistry([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    expect(captureAnchor(el, reg)).toEqual({
      topIndex: 1,
      topId: "m1",
      offset: 50,
    });
  });

  it("anchors the first block when scrolled exactly to its top edge", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 4000);
    const reg = makeRegistry([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
    ]);
    expect(captureAnchor(el, reg)).toEqual({ topIndex: 0, topId: "m0", offset: 0 });
  });

  it("falls back to the DOM when no registry measurement exists", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    setScrollProps(el as HTMLDivElement, 450, 5000);
    expect(captureAnchor(el, null)).toEqual({ topIndex: 1, topId: "m1", offset: 50 });
  });

  it("returns empty when no block qualifies (scrolled above the first)", () => {
    const el = makeContainer([{ index: 0, top: 200, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 4000);
    expect(captureAnchor(el, null)).toEqual({ topIndex: undefined, topId: undefined, offset: 0 });
  });
});

describe("restoreTo", () => {
  it("re-lands on the saved block offset using the registry's real top", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 5000);
    const reg = makeRegistry([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
      { index: 2, top: 900, id: "m2" },
    ]);
    const ok = restoreTo(el, sp({ pos: 99999, topIndex: 1, topId: "m1", offset: 50 }), false, reg);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(450);
  });

  it("resolves the anchor by id even when the index drifted", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 5000);
    const reg = makeRegistry([{ index: 3, top: 1200, id: "m1" }]);
    const ok = restoreTo(el, sp({ pos: 99999, topIndex: 9, topId: "m1", offset: 10 }), false, reg);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(1210);
  });

  it("falls back to the absolute pixel when the anchor is gone", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 5000);
    const ok = restoreTo(el, sp({ pos: 1234, topIndex: 7, topId: "m7", offset: 50 }), false, null);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(1234);
  });

  it("scrolls to the real bottom when requested", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 4321);
    const reg = makeRegistry([{ index: 0, top: 0, id: "m0" }], 4321);
    const ok = restoreTo(el, sp({ pos: 0 }), true, reg);
    expect(ok).toBe(true);
    expect(el.scrollTop).toBe(4321);
  });

  it("bails out when the container is not laid out yet", () => {
    const el = makeContainer([]);
    Object.defineProperty(el, "scrollHeight", { value: 0, configurable: true });
    expect(restoreTo(el, sp({ pos: 100 }), false, null)).toBe(false);
    expect(el.scrollTop).toBe(0);
  });
});

describe("scrollToRendered", () => {
  it("centers an index target using the registry geometry and clamps to the top", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 5000, 600);
    const reg = makeRegistry([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, height: 300, id: "m1" },
    ]);
    expect(scrollToRendered(el, reg, 1, "center")).toBe(true);
    // center: 400 - (600-300)/2 = 250
    expect(el.scrollTop).toBe(250);
  });

  it("clamps at the bottom of the content", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 1000, 300);
    const reg = makeRegistry([{ index: 0, top: 1900, id: "m0", height: 200 }], 2000);
    // center: 1900 - (300-200)/2 = 1850, clamped to max (2000-300)
    expect(scrollToRendered(el, reg, 0, "center")).toBe(true);
    expect(el.scrollTop).toBe(1700);
  });

  it("resolves an id target through indexById", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 5000, 600);
    const reg = makeRegistry([{ index: 0, top: 0, id: "m0", height: 100 }]);
    expect(scrollToRendered(el, reg, "m0", "top")).toBe(true);
    expect(el.scrollTop).toBe(0);
  });

  it("one-off measures an element target", () => {
    const el = makeContainer([
      { index: 0, top: 0, id: "m0" },
      { index: 1, top: 400, id: "m1" },
    ]);
    setScrollProps(el as HTMLDivElement, 0, 5000, 600);
    const child = el.querySelector('[data-message-index="1"]') as HTMLElement;
    expect(scrollToRendered(el, null, child, "center")).toBe(true);
    expect(el.scrollTop).toBe(200); // 400 - (600-200)/2 = 200 for height 200
  });

  it("measures a nested target by viewport rect, not offsetParent", () => {
    // A tool call buried inside a message block reports a small offsetTop
    // relative to its positioned wrapper, but its true on-screen position is
    // deep in the content. The old offsetTop reading scrolled to the wrong
    // place; getBoundingClientRect must anchor it correctly.
    const el = document.createElement("div");
    const wrapper = document.createElement("div");
    const nested = document.createElement("div");
    nested.setAttribute("data-tool-call-id", "tc-1");
    Object.defineProperty(nested, "offsetTop", { value: 40, configurable: true });
    Object.defineProperty(nested, "offsetHeight", { value: 120, configurable: true });
    nested.getBoundingClientRect = () => rect(1500, 120);
    wrapper.appendChild(nested);
    el.appendChild(wrapper);
    setScrollProps(el as HTMLDivElement, 0, 5000, 600);
    expect(scrollToRendered(el, null, nested, "center")).toBe(true);
    // 1500 - (600-120)/2 = 1260, clamped to max (5000-600)
    expect(el.scrollTop).toBe(1260);
  });

  it("returns false when the target has no geometry", () => {
    const el = makeContainer([{ index: 0, top: 0, id: "m0" }]);
    setScrollProps(el as HTMLDivElement, 0, 1000, 300);
    const reg = makeRegistry([{ index: 0, top: 0, id: "m0" }]);
    expect(scrollToRendered(el, reg, 9, "center")).toBe(false);
    expect(el.scrollTop).toBe(0);
  });
});
