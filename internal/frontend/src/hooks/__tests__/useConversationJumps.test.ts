import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConversationJumps, type UseConversationJumpsOptions } from "../useConversationJumps";
import type { BlockRegistry } from "../useConversationScroll";

function awaitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

interface Harness {
  container: HTMLDivElement;
  suppressUserScrollRef: { current: boolean };
  scrollToRendered: ReturnType<typeof vi.fn>;
  onClearFocus: ReturnType<typeof vi.fn>;
  rerender: (props: Partial<UseConversationJumpsOptions>) => void;
  unmount: () => void;
}

function renderJumps(props: Partial<UseConversationJumpsOptions>): Harness {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  document.body.appendChild(container);
  const scrollRef = { current: container };
  const suppressUserScrollRef = { current: true };
  const scrollToRendered = vi.fn(() => true);
  const onClearFocus = vi.fn();

  const base: UseConversationJumpsOptions = {
    scrollRef,
    registry: null,
    registryVersion: 0,
    messageCount: 0,
    focusMessageKey: 0,
    onClearFocus,
    suppressUserScrollRef,
    scrollToRendered,
  };

  const { rerender, unmount } = renderHook(
    (p: UseConversationJumpsOptions) => useConversationJumps(p),
    { initialProps: { ...base, ...props } },
  );

  return {
    container,
    suppressUserScrollRef,
    scrollToRendered,
    onClearFocus,
    rerender: (next) => rerender({ ...base, ...next }),
    unmount,
  };
}

function addBlock(container: HTMLElement, index: number, id?: string) {
  const el = document.createElement("div");
  el.setAttribute("data-message-index", String(index));
  if (id) el.setAttribute("data-message-id", id);
  Object.defineProperty(el, "offsetTop", { value: index * 200, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: 200, configurable: true });
  container.appendChild(el);
  return el;
}

function addTool(el: HTMLElement, toolCallId: string) {
  const tool = document.createElement("button");
  tool.setAttribute("data-tool-call-id", toolCallId);
  el.appendChild(tool);
  return tool;
}

function registryWith(id: string, index: number): BlockRegistry {
  const reg: BlockRegistry = {
    byIndex: new Map([[index, { top: index * 200, height: 200 }]]),
    indexById: new Map([[id, index]]),
    scrollHeight: 5000,
    version: 2,
  };
  return reg;
}

describe("useConversationJumps", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("resolves a message id through the registry to the rendered block index", () => {
    const h = renderJumps({});
    addBlock(h.container, 3, "m42");
    h.rerender({
      focusMessageKey: 1,
      focusMessageId: "m42",
      registry: registryWith("m42", 3),
      registryVersion: 2,
      messageCount: 4,
    });
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
    expect(h.scrollToRendered.mock.calls[0][0]).toBe(3);
    expect(h.scrollToRendered.mock.calls[0][1]).toBe("center");
  });

  it("prefers a tool call id inside the message over the message itself", () => {
    const h = renderJumps({});
    const block = addBlock(h.container, 1, "m42");
    const tool = addTool(block, "tc-9");
    h.rerender({
      focusMessageKey: 1,
      focusMessageId: "m42",
      focusToolCallId: "tc-9",
      registry: registryWith("m42", 1),
      registryVersion: 2,
      messageCount: 2,
    });
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
    expect(h.scrollToRendered.mock.calls[0][0]).toBe(tool);
  });

  it("stays pending when the target is missing and retries on the next registry change", () => {
    const h = renderJumps({});
    h.rerender({ focusMessageKey: 1, focusMessageId: "missing" });
    expect(h.scrollToRendered).not.toHaveBeenCalled();
    expect(h.onClearFocus).not.toHaveBeenCalled();

    addBlock(h.container, 5, "missing");
    h.rerender({
      focusMessageKey: 1,
      focusMessageId: "missing",
      registry: registryWith("missing", 5),
      registryVersion: 2,
      messageCount: 6,
    });
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
    expect(h.scrollToRendered.mock.calls[0][0]).toBe(5);
  });

  it("abandons a pending jump when the user scrolls manually", () => {
    const h = renderJumps({});
    h.rerender({ focusMessageKey: 1, focusMessageId: "missing" });
    h.suppressUserScrollRef.current = false;
    act(() => {
      h.container.dispatchEvent(new Event("scroll"));
    });
    expect(h.onClearFocus).toHaveBeenCalledTimes(1);

    // The parent cleared focus (CLEAR_FOCUS); with no focus a later data
    // change must not resurrect the jump.
    addBlock(h.container, 5, "missing");
    h.rerender({
      focusMessageId: undefined,
      registry: registryWith("missing", 5),
      registryVersion: 2,
      messageCount: 6,
    });
    expect(h.scrollToRendered).not.toHaveBeenCalled();
  });

  it("ignores a programmatic scroll while pending (suppression flag)", () => {
    const h = renderJumps({});
    h.rerender({ focusMessageKey: 1, focusMessageId: "missing" });
    // A restore/follow wrote scrollTop just before the listener armed.
    act(() => {
      h.container.dispatchEvent(new Event("scroll"));
    });
    expect(h.onClearFocus).not.toHaveBeenCalled();
    // A real user scroll consumes the flag the next time.
    h.suppressUserScrollRef.current = false;
    act(() => {
      h.container.dispatchEvent(new Event("scroll"));
    });
    expect(h.onClearFocus).toHaveBeenCalledTimes(1);
  });

  it("re-runs without re-yanking on SSE-triggered re-renders of the same jump", async () => {
    const h = renderJumps({});
    addBlock(h.container, 2, "m42");
    const focus = {
      focusMessageKey: 1,
      focusMessageId: "m42",
      registry: registryWith("m42", 2),
      registryVersion: 2,
      messageCount: 3,
    };
    h.rerender(focus);
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
    await act(async () => {
      await awaitFrame();
    });
    // SSE re-render keeps the exact same jump target.
    h.rerender({ ...focus, registryVersion: 3, messageCount: 4 });
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
  });

  it("flashes the target once it is in view and clears focus after the timeout", async () => {
    const h = renderJumps({});
    addBlock(h.container, 2, "m42");
    h.rerender({
      focusMessageKey: 1,
      focusMessageId: "m42",
      registry: registryWith("m42", 2),
      registryVersion: 2,
      messageCount: 3,
    });
    const el = h.container.querySelector('[data-message-index="2"]') as HTMLElement;
    await act(async () => {
      await awaitFrame();
    });
    expect(el.classList.contains("sess-message-highlight")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(el.classList.contains("sess-message-highlight")).toBe(false);
    expect(h.onClearFocus).toHaveBeenCalledTimes(1);
  });

  it("waits for the target block to render before jumping (race fix)", async () => {
    const h = renderJumps({});
    h.rerender({ focusMessageKey: 1, focusMessageId: "m99" });
    expect(h.scrollToRendered).not.toHaveBeenCalled();
    // Simulate the session finishing load: the message block appears in the DOM.
    act(() => {
      addBlock(h.container, 7, "m99");
    });
    // The MutationObserver re-attempts once the block exists.
    await act(async () => {
      await awaitFrame();
      await awaitFrame();
    });
    expect(h.scrollToRendered).toHaveBeenCalledTimes(1);
    expect(h.scrollToRendered.mock.calls[0][0]).toBe(
      h.container.querySelector('[data-message-id="m99"]'),
    );
  });
});
