import type { Message } from "../hooks/types";

// The most recent assistant message that carries reasoning. Reasoning is what
// grows while a model thinks, so this is the message whose parent thinking
// block is still "receiving child chunks" while the session is active.
export function latestThinkingIndex(messages: Message[]): number {
  let idx = -1;
  messages.forEach((m, i) => {
    if (m.role === "assistant" && m.reasoning) idx = i;
  });
  return idx;
}
