import type { Message } from "../hooks/types";

// A message whose step has started but not finished is still being generated.
// OpenCode writes the step-start part before its reasoning, so an unbalanced
// start marks the message that is streaming right now.
export function hasOpenStep(msg: Message): boolean {
  let open = 0;
  for (const ev of msg.stepEvents ?? []) {
    if (ev.step === "start") {
      open++;
    } else if (ev.step === "finish") {
      open = Math.max(0, open - 1);
    }
  }
  return open > 0;
}

// Reasoning is only ever growing on the message the model is currently writing.
// Agents that emit step events (OpenCode, Copilot) let us tell exactly which
// message that is; for agents that never emit them, the last assistant message
// of an active session is the closest approximation.
export function isMessageStreaming(
  msg: Message,
  isLastAssistant: boolean,
  sessionActive: boolean,
): boolean {
  if (!sessionActive) return false;
  if (hasOpenStep(msg)) return true;
  if ((msg.stepEvents ?? []).length > 0) return false;
  return isLastAssistant;
}
