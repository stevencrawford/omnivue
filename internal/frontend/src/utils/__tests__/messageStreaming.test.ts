import { describe, expect, it } from "vitest";
import { hasOpenStep, isMessageStreaming } from "../messageStreaming";
import type { Message } from "../../hooks/types";

function assistant(stepEvents?: Message["stepEvents"]): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    reasoning: "thought",
    toolCalls: [],
    timestamp: "2026-01-01T00:00:00Z",
    stepEvents,
  } as Message;
}

describe("hasOpenStep", () => {
  it("returns true while a message has an unclosed step start", () => {
    expect(hasOpenStep(assistant([{ step: "start" }]))).toBe(true);
    expect(hasOpenStep(assistant([{ step: "start" }, { step: "start" }]))).toBe(true);
  });

  it("returns false for closed or absent steps", () => {
    expect(hasOpenStep(assistant([{ step: "start" }, { step: "finish" }]))).toBe(false);
    expect(hasOpenStep(assistant([]))).toBe(false);
    expect(hasOpenStep(assistant())).toBe(false);
  });

  it("does not underflow on a stray finish", () => {
    expect(hasOpenStep(assistant([{ step: "finish" }]))).toBe(false);
  });
});

describe("isMessageStreaming", () => {
  it("marks a message with an open step as streaming when the session is active", () => {
    const msg = assistant([{ step: "start" }]);
    expect(isMessageStreaming(msg, false, true)).toBe(true);
  });

  it("never marks anything streaming when the session is inactive", () => {
    const msg = assistant([{ step: "start" }]);
    expect(isMessageStreaming(msg, false, false)).toBe(false);
    expect(isMessageStreaming(msg, true, false)).toBe(false);
  });

  it("does not fall back to the last assistant for agents with closed step events", () => {
    const msg = assistant([{ step: "start" }, { step: "finish" }]);
    expect(isMessageStreaming(msg, true, true)).toBe(false);
  });

  it("falls back to the last assistant message when the agent emits no step events", () => {
    const msg = assistant();
    expect(isMessageStreaming(msg, true, true)).toBe(true);
    expect(isMessageStreaming(msg, false, true)).toBe(false);
  });
});
