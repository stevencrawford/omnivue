import { describe, expect, it } from "vitest";
import type { Message } from "../../hooks/types";
import { latestThinkingIndex } from "../latestThinking";

const chunkA = "aaa " + "x".repeat(300);
const chunkB = "bbb " + "y".repeat(300);

function assistantMsg(id: string, reasoning: string): Message {
  return {
    id,
    role: "assistant",
    content: "",
    reasoning,
    toolCalls: [],
    timestamp: "2026-01-01T00:00:00Z",
    agent: "main",
  } as Message;
}

const userMsg = {
  id: "u1",
  role: "user",
  content: "hello",
  reasoning: "",
  toolCalls: [],
  timestamp: "2026-01-01T00:00:00Z",
} as Message;

describe("latestThinkingIndex", () => {
  it("returns -1 when no assistant message carries reasoning", () => {
    expect(latestThinkingIndex([userMsg, assistantMsg("m1", "")])).toBe(-1);
  });

  it("returns the index of the most recent assistant message with reasoning", () => {
    const messages = [
      userMsg,
      assistantMsg("m1", chunkA),
      assistantMsg("m2", ""),
      assistantMsg("m3", chunkB),
    ];
    expect(latestThinkingIndex(messages)).toBe(3);
  });

  it("ignores a later assistant message without reasoning", () => {
    const messages = [assistantMsg("m1", chunkA), assistantMsg("m2", "")];
    expect(latestThinkingIndex(messages)).toBe(0);
  });
});
