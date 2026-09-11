import { useEffect, useMemo } from "react";
import type { Message, Position } from "./types";

// ---------------------------------------------------------------------------
// Cinematic search/message jumps
//
// Search hits carry only the raw messages[] index (the FTS index stores no
// stable message id), while diff navigation, bookmarks, and notifications
// carry the canonical Position. Either way the timeline cursor is never
// touched: the target message is "spotlighted" into the activity drawer
// (which is otherwise filtered by the cursor/span window) and the drawer
// scrolls to it. Markdown query highlighting inside the drawer needs no
// extra work — MarkdownContent picks the query up from SearchHighlightContext.
// ---------------------------------------------------------------------------

export interface CinematicJumpOptions {
  messages: Message[];
  loading: boolean;
  focusPosition?: Position;
  focusMessageIndex?: number;
  focusMessageId?: string;
  focusMessageKey: number;
  onClearFocus?: () => void;
}

export function resolveCinematicJumpId(
  messages: Message[],
  position: Position | undefined,
  messageIndex: number | undefined,
  messageId: string | undefined,
): string | null {
  const positionId = position?.messageID;
  if (positionId !== undefined && messages.some((m) => m.id === positionId)) return positionId;
  if (messageId !== undefined && messages.some((m) => m.id === messageId)) return messageId;
  if (messageIndex !== undefined) return messages[messageIndex]?.id ?? null;
  return null;
}

export function useCinematicSearchJump({
  messages,
  loading,
  focusPosition,
  focusMessageIndex,
  focusMessageId,
  focusMessageKey,
  onClearFocus,
}: CinematicJumpOptions): { spotlightId: string | null } {
  const spotlightId = useMemo(() => {
    if (focusMessageKey === 0) return null;
    return resolveCinematicJumpId(messages, focusPosition, focusMessageIndex, focusMessageId);
  }, [focusMessageKey, messages, focusPosition, focusMessageIndex, focusMessageId]);

  // A jump that is still unresolvable once loading finished is stale (e.g. a
  // hit indexed against a transcript that has since changed). Clear it so a
  // dead focus key cannot linger and hijack a later render.
  useEffect(() => {
    if (focusMessageKey === 0 || loading || messages.length === 0 || spotlightId !== null) return;
    onClearFocus?.();
  }, [focusMessageKey, loading, messages.length, spotlightId, onClearFocus]);

  return { spotlightId };
}
