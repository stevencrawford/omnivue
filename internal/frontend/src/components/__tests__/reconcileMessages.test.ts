import { describe, expect, it } from "vitest";
import { reconcileMessages } from "../SessionViewer";
import type { Message } from "../../hooks/types";

function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: "assistant",
    content: "hi",
    ...overrides,
  } as unknown as Message;
}

describe("reconcileMessages", () => {
  it("returns next unchanged when lengths differ", () => {
    const prev = [msg("a")];
    const next = [msg("a"), msg("b")];
    expect(reconcileMessages(prev, next)).toBe(next);
  });

  it("returns prev unchanged when nothing differs", () => {
    const prev = [msg("a"), msg("b")];
    const next = [msg("a"), msg("b")];
    expect(reconcileMessages(prev, next)).toBe(prev);
  });

  it("returns next when a message changed", () => {
    const prev = [msg("a"), msg("b", { content: "old" })];
    const next = [msg("a"), msg("b", { content: "new" })];
    const merged = reconcileMessages(prev, next);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).toBe(next[1]);
  });

  it("preserves identity for unchanged messages in a mixed update", () => {
    const prev = [msg("a"), msg("b"), msg("c")];
    const next = [msg("a"), msg("b", { content: "changed" }), msg("c")];
    const merged = reconcileMessages(prev, next);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).toBe(next[1]);
    expect(merged[2]).toBe(prev[2]);
  });

  it("treats a tool call change as a difference", () => {
    const tool = (status: string) =>
      ({
        id: "t1",
        name: "bash",
        input: "x",
        output: "y",
        status,
      }) as NonNullable<Message["toolCalls"]>[number];
    const prev = [msg("a", { toolCalls: [tool("running")] })];
    const next = [msg("a", { toolCalls: [tool("completed")] })];
    const merged = reconcileMessages(prev, next);
    expect(merged[0]).toBe(next[0]);
  });

  it("returns next when prev is empty", () => {
    const next = [msg("a")];
    expect(reconcileMessages([], next)).toBe(next);
  });
});
