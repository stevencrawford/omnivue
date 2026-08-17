import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConversationScroll, type UseConversationScrollOptions } from "../useConversationScroll";

// jsdom has no ResizeObserver; the hook observes the container for restore and
// button updates. A no-op stub is enough for the growth paths under test.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function awaitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function makeMessage(id: string, reasoning: string) {
  return { id, role: "assistant", reasoning, content: "" };
}

function makeContainer() {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  document.body.appendChild(container);
  Object.defineProperty(container, "scrollHeight", {
    value: 1000,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(container, "scrollTop", { value: 0, writable: true, configurable: true });
  const block = document.createElement("div");
  block.setAttribute("data-message-index", "0");
  block.setAttribute("data-message-id", "m1");
  container.appendChild(block);
  return container;
}

function renderScroll(props: Partial<UseConversationScrollOptions>) {
  const container = makeContainer();
  const base: UseConversationScrollOptions = {
    sessionId: "s",
    messageCount: 1,
    messages: [makeMessage("m1", "x".repeat(100))],
    ...props,
  };
  const { result, rerender, unmount } = renderHook(
    (p: UseConversationScrollOptions) => useConversationScroll(p),
    { initialProps: base },
  );
  act(() => {
    result.current.scrollRef.current = container;
  });
  return {
    container,
    result,
    rerender: (next: Partial<UseConversationScrollOptions>) => rerender({ ...base, ...next }),
    unmount,
  };
}

describe("useConversationScroll in-place tail growth", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("lands at the live bottom on first attach", async () => {
    const h = renderScroll({});
    act(() => {
      h.rerender({ messages: [makeMessage("m1", "x".repeat(100))] });
    });
    await awaitFrame();
    expect(h.container.scrollTop).toBe(1000);
  });

  it("follows the bottom when the tail message grows in place while pinned", async () => {
    const h = renderScroll({});
    act(() => {
      h.rerender({ messages: [makeMessage("m1", "x".repeat(100))] });
    });
    await awaitFrame();
    expect(h.container.scrollTop).toBe(1000);

    // Reasoning grows under the same message id (message count stays flat).
    act(() => {
      Object.defineProperty(h.container, "scrollHeight", {
        value: 1400,
        configurable: true,
      });
      h.rerender({ messageCount: 1, messages: [makeMessage("m1", "x".repeat(500))] });
    });
    expect(h.container.scrollTop).toBe(1400);
  });

  it("does not follow when the user scrolled away from the bottom", async () => {
    const h = renderScroll({});
    act(() => {
      h.rerender({ messages: [makeMessage("m1", "x".repeat(100))] });
    });
    await awaitFrame();
    expect(h.container.scrollTop).toBe(1000);

    // User scrolls up: soft-following disarms via scrollToTop.
    act(() => {
      h.result.current.scrollToTop();
      Object.defineProperty(h.container, "scrollTop", {
        value: 100,
        writable: true,
        configurable: true,
      });
    });

    act(() => {
      Object.defineProperty(h.container, "scrollHeight", {
        value: 1400,
        configurable: true,
      });
      h.rerender({ messageCount: 1, messages: [makeMessage("m1", "x".repeat(500))] });
    });
    expect(h.container.scrollTop).toBe(100);
  });
});
