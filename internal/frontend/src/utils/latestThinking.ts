import type { Message } from "../hooks/types";
import { splitReasoning } from "./reasoningChunks";

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

// The newest chunk of the latest thinking message. The "latest thinking"
// section only exists for active sessions: once a session is no longer active
// the thinking UI makes no sense. The chunk itself is always recorded against
// the parent thinking block in the conversation.
export function latestThinkingChunk(
  messages: Message[],
  sessionActive: boolean,
): { messageId: string; chunk: string } | null {
  if (!sessionActive) return null;
  const idx = latestThinkingIndex(messages);
  if (idx === -1) return null;
  const chunks = splitReasoning(messages[idx].reasoning || "");
  if (chunks.length === 0) return null;
  return { messageId: messages[idx].id, chunk: chunks[chunks.length - 1] };
}
