import { createContext, useContext } from "react";

export interface FocusTarget {
  messageIndex?: number;
  messageId?: string;
  stepIndex?: number;
}

export interface FocusValue {
  focusStepIndex: number | undefined;
  focusMessageIndex: number | undefined;
  focusMessageKey: number;
  focusMessageId: string | undefined;
  jumpToMessage: (target: FocusTarget) => void;
  clearFocus: () => void;
}

// FocusContext lets leaf consumers (useSearchHighlight, useConversationScroll)
// read the message-jump + highlight concern without a 4-level prop thread. The
// value object is assembled in App.tsx alongside SessionNavContext.
export const FocusContext = createContext<FocusValue>({
  focusStepIndex: undefined,
  focusMessageIndex: undefined,
  focusMessageKey: 0,
  focusMessageId: undefined,
  jumpToMessage: () => {},
  clearFocus: () => {},
});

export function useFocus() {
  return useContext(FocusContext);
}

// parseMessageTarget extracts a jump target from a notification payload string.
// This is the single place that reads messageIndex/messageId out of payloads;
// every notification-jump path (session select, notification click) routes here.
export function parseMessageTarget(payload: string | undefined): FocusTarget {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const target: FocusTarget = {};
    if (typeof parsed.messageIndex === "number") target.messageIndex = parsed.messageIndex;
    if (typeof parsed.messageId === "string") target.messageId = parsed.messageId;
    if (typeof parsed.stepIndex === "number") target.stepIndex = parsed.stepIndex;
    return target;
  } catch {
    // ignore malformed payload
    return {};
  }
}
