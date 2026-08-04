import type { Message } from "../hooks/useApi";
import { shouldShowStepContent } from "./toolDisplay";

export interface GroupResult {
  grouped: Message[];
  ownerByRawIndex: number[];
}

// Groups consecutive assistant tool-call messages into the preceding assistant
// message so the conversation reads as a single turn. Returns both the grouped
// list and a per-raw-index mapping to the group index it was absorbed into, so
// notifications (which carry raw messageIndex/messageId) can be resolved.
export function groupMessages(messages: Message[]): GroupResult {
  const result: Message[] = [];
  const ownerByRawIndex: number[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0 && !shouldShowStepContent(msg.content ?? "", tools)) {
        const last = result[result.length - 1];
        if (last && last.role === "assistant" && last.toolCalls && last.toolCalls.length > 0) {
          if (!last.toolCalls.some((tc) => tc.name === "question")) {
            last.toolCalls = [...last.toolCalls, ...tools];
            if (msg.reasoning) {
              last.reasoning = last.reasoning
                ? last.reasoning + "\n\n" + msg.reasoning
                : msg.reasoning;
            }
            ownerByRawIndex.push(result.length - 1);
            continue;
          }
        }
        // Merge tool-call message into the preceding reasoning-only assistant message
        if (
          last &&
          last.role === "assistant" &&
          last.reasoning &&
          (!last.toolCalls || last.toolCalls.length === 0)
        ) {
          last.toolCalls = tools;
          if (msg.reasoning) {
            last.reasoning = last.reasoning + "\n\n" + msg.reasoning;
          }
          ownerByRawIndex.push(result.length - 1);
          continue;
        }
      }
    }
    result.push({ ...msg, toolCalls: msg.toolCalls ? [...msg.toolCalls] : undefined });
    ownerByRawIndex.push(result.length - 1);
  }
  return { grouped: result, ownerByRawIndex };
}
