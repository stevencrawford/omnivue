import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  resolveCinematicJumpId,
  useCinematicSearchJump,
  type CinematicJumpOptions,
} from "../useCinematicSearchJump";
import type { Message } from "../types";

function message(id: string): Message {
  return {
    id,
    role: "assistant",
    content: "hello",
    timestamp: "2026-01-01T00:00:00Z",
  } as Message;
}

const messages = [message("m0"), message("m1"), message("m2")];

function renderJump(overrides: Partial<CinematicJumpOptions> = {}) {
  const onClearFocus = vi.fn();
  const base: CinematicJumpOptions = {
    messages,
    loading: false,
    focusMessageKey: 0,
    onClearFocus,
  };
  const { result, rerender } = renderHook(
    (props: CinematicJumpOptions) => useCinematicSearchJump(props),
    { initialProps: { ...base, ...overrides } },
  );
  return {
    result,
    rerender: (next: Partial<CinematicJumpOptions>) => rerender({ ...base, ...next }),
    onClearFocus,
  };
}

describe("resolveCinematicJumpId", () => {
  it("resolves a raw search-hit index to the message id", () => {
    expect(resolveCinematicJumpId(messages, undefined, 1, undefined)).toBe("m1");
  });

  it("returns null for an out-of-range index", () => {
    expect(resolveCinematicJumpId(messages, undefined, 42, undefined)).toBeNull();
  });

  it("prefers the canonical position id over the raw index", () => {
    expect(resolveCinematicJumpId(messages, { messageID: "m2" }, 0, undefined)).toBe("m2");
  });

  it("falls back to the index when the position id is gone", () => {
    expect(resolveCinematicJumpId(messages, { messageID: "stale" }, 0, undefined)).toBe("m0");
  });

  it("resolves a legacy message id", () => {
    expect(resolveCinematicJumpId(messages, undefined, undefined, "m1")).toBe("m1");
  });

  it("returns null when nothing identifies a target", () => {
    expect(resolveCinematicJumpId(messages, undefined, undefined, undefined)).toBeNull();
  });
});

describe("useCinematicSearchJump", () => {
  it("returns no spotlight without an active jump", () => {
    const { result, onClearFocus } = renderJump({ focusMessageKey: 0, focusMessageIndex: 1 });
    expect(result.current.spotlightId).toBeNull();
    expect(onClearFocus).not.toHaveBeenCalled();
  });

  it("spotlights the indexed message while the jump is active", () => {
    const { result } = renderJump({ focusMessageKey: 3, focusMessageIndex: 2 });
    expect(result.current.spotlightId).toBe("m2");
  });

  it("resolves a pending jump once messages arrive", () => {
    const onClearFocus = vi.fn();
    const initialProps: CinematicJumpOptions = {
      messages: [],
      loading: true,
      focusMessageKey: 1,
      focusMessageIndex: 0,
      onClearFocus,
    };
    const { result, rerender } = renderHook(
      (props: CinematicJumpOptions) => useCinematicSearchJump(props),
      { initialProps },
    );
    expect(result.current.spotlightId).toBeNull();
    expect(onClearFocus).not.toHaveBeenCalled();
    rerender({ messages, loading: false, focusMessageKey: 1, focusMessageIndex: 0, onClearFocus });
    expect(result.current.spotlightId).toBe("m0");
    expect(onClearFocus).not.toHaveBeenCalled();
  });

  it("clears a stale jump once loading finished without a target", () => {
    const { onClearFocus } = renderJump({ focusMessageKey: 1, focusMessageIndex: 42 });
    expect(onClearFocus).toHaveBeenCalledTimes(1);
  });

  it("drops the spotlight when focus is cleared", () => {
    const { result, rerender } = renderJump({ focusMessageKey: 1, focusMessageIndex: 0 });
    expect(result.current.spotlightId).toBe("m0");
    rerender({ focusMessageKey: 0, focusMessageIndex: undefined });
    expect(result.current.spotlightId).toBeNull();
  });
});
