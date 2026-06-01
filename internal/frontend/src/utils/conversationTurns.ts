import type { Message, ToolCall } from "../hooks/useApi";

export interface AssistantStep {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  agent?: string;
  model?: string;
  timestamp: string;
}

export interface AssistantTurn {
  type: "assistant";
  id: string;
  steps: AssistantStep[];
  startedAt: string;
  agent?: string;
  model?: string;
}

export interface UserTurn {
  type: "user";
  id: string;
  content: string;
  timestamp: string;
}

export interface SystemTurn {
  type: "system";
  id: string;
  content: string;
  timestamp: string;
}

export type ConversationTurn = AssistantTurn | UserTurn | SystemTurn;

/** Build turns from messages after the initial pinned prompt. */
export function buildConversationTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let assistantSteps: AssistantStep[] = [];

  const flushAssistant = () => {
    if (assistantSteps.length === 0) return;
    turns.push({
      type: "assistant",
      id: assistantSteps[0].id,
      steps: assistantSteps,
      startedAt: assistantSteps[0].timestamp,
      agent: assistantSteps.find((s) => s.agent && s.agent !== "main")?.agent,
      model: assistantSteps.find((s) => s.model)?.model,
    });
    assistantSteps = [];
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushAssistant();
      turns.push({
        type: "user",
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
      });
      continue;
    }

    if (msg.role === "system") {
      flushAssistant();
      turns.push({
        type: "system",
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
      });
      continue;
    }

    // assistant (and unknown roles treated as assistant stream)
    const hasContent = Boolean(msg.content?.trim());
    const hasTools = Boolean(msg.toolCalls && msg.toolCalls.length > 0);
    if (!hasContent && !hasTools) continue;

    assistantSteps.push({
      id: msg.id,
      content: msg.content || "",
      toolCalls: msg.toolCalls,
      agent: msg.agent,
      model: msg.model,
      timestamp: msg.timestamp,
    });
  }

  flushAssistant();
  return turns;
}
