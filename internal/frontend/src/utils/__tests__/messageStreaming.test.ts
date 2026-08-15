import { describe, expect, it } from "vitest";
import { hasOpenStep, isMessageStreaming, latestThinkingChunk } from "../messageStreaming";
import type { Message } from "../../hooks/types";

function assistant(stepEvents?: Message["stepEvents"], reasoning = "thought"): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    reasoning,
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

describe("latestThinkingChunk", () => {
  const chunkA = "aaa " + "x".repeat(300);
  const chunkB = "bbb " + "y".repeat(300);
  const multi = [chunkA, chunkB].join("\n\n");

  it("returns the newest chunk of the streaming message when active", () => {
    const msgs = [assistant([{ step: "start" }], multi)];
    const result = latestThinkingChunk(msgs, true);
    expect(result).toEqual({ messageId: "m1", chunk: chunkB });
  });

  it("returns null when the session is inactive", () => {
    const msgs = [assistant([{ step: "start" }], multi)];
    expect(latestThinkingChunk(msgs, false)).toBeNull();
  });

  it("returns null when there is no assistant message", () => {
    const user = {
      id: "u1",
      role: "user",
      content: "hi",
      reasoning: undefined,
      toolCalls: [],
      timestamp: "2026-01-01T00:00:00Z",
    } as Message;
    expect(latestThinkingChunk([user], true)).toBeNull();
  });

  it("returns null when the last assistant has closed its step", () => {
    const msgs = [assistant([{ step: "start" }, { step: "finish" }], multi)];
    expect(latestThinkingChunk(msgs, true)).toBeNull();
  });
});
