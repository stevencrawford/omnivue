import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockRegistry } from "./useConversationScroll";
import type { Position } from "./types";

export interface UseConversationJumpsOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  registry: BlockRegistry | null;
  registryVersion: number;
  /** Renderered message block count; growing it lets a pending jump retry. */
  messageCount: number;
  focusMessageKey: number;
  /** Canonical jump target: bookmarks and notifications carry a Position. */
  focusPosition?: Position;
  /** Legacy raw-index jump target for diff navigation and search hits. */
  focusMessageIndex?: number;
  focusMessageId?: string;
  /** Maps a raw list index / message id to the rendered block index. */
  renderIndexResolver?: (
    rawIndex: number | undefined,
    messageId: string | undefined,
  ) => number | undefined;
  onClearFocus: () => void;
  /** Set true around programmatic scrolls so the pending-walk-away listener
   *  does not mistake the restore/follow for a user scroll. */
  suppressUserScrollRef: React.RefObject<boolean>;
  scrollToRendered: (
    target: number | string | HTMLElement,
    mode?: "center" | "top",
    smooth?: boolean,
    onArrive?: () => void,
  ) => boolean;
}

const FLASH_TIMEOUT_MS = 2000;
// A pending jump stops retrying once it has survived this many re-renders
// without finding its target. The target message is usually still streaming;
// without a cap the retry loop would spin forever on a stale jump.
const MAX_PENDING_ATTEMPTS = 50;

interface AppliedFocus {
  key: number | undefined;
  position: Position | undefined;
  index: number | undefined;
  id: string | undefined;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

interface ResolvedTarget {
  el: HTMLElement | undefined;
  /** Rendered block index when the geometry is already in the registry. */
  index: number | undefined;
}

function hasActiveFocus(options: UseConversationJumpsOptions): boolean {
  return (
    options.focusPosition !== undefined ||
    options.focusMessageIndex !== undefined ||
    options.focusMessageId !== undefined
  );
}

// One jump orchestrator: an identity-first resolution (Position when present,
// raw index/id for diff/search), a pending retry that waits for the target to
// exist (e.g. a session still loading), and a single, exactly-once scroll
// guarded against SSE re-renders.
export function useConversationJumps(options: UseConversationJumpsOptions) {
  const {
    scrollRef,
    registry,
    registryVersion,
    messageCount,
    focusMessageKey,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    renderIndexResolver,
    onClearFocus,
    suppressUserScrollRef,
    scrollToRendered,
  } = options;

  const appliedRef = useRef<AppliedFocus | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const attemptCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listenerCtlRef = useRef<{
    key: number;
    container: HTMLElement;
    handler: () => void;
  } | null>(null);
  const onClearFocusRef = useRef(onClearFocus);
  onClearFocusRef.current = onClearFocus;
  const attemptRef = useRef<() => void>(() => {});

  const release = useCallback(() => {
    if (listenerCtlRef.current) {
      listenerCtlRef.current.container.removeEventListener(
        "scroll",
        listenerCtlRef.current.handler,
      );
      listenerCtlRef.current = null;
    }
  }, []);

  const attempt = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (!hasActiveFocus(options)) {
      appliedRef.current = null;
      setPending(null);
      release();
      return;
    }

    // A different jump supersedes a still-pending one: drop its listener.
    if (listenerCtlRef.current && listenerCtlRef.current.key !== focusMessageKey) {
      release();
    }

    const resolved = resolveTarget({
      container,
      registry,
      focusPosition,
      focusMessageIndex,
      focusMessageId,
      renderIndexResolver,
    });

    if (!resolved.el) {
      // Not found yet — stay pending and keep watching the DOM. The session
      // may still be loading; once its message blocks render (or re-group),
      // the MutationObserver below re-runs this attempt and lands the jump.
      // The attempt count bounds the retry so a stale jump cannot spin
      // forever on a session that never produces its target.
      attemptCountRef.current += 1;
      if (attemptCountRef.current > MAX_PENDING_ATTEMPTS) {
        setPending(null);
        onClearFocusRef.current();
        return;
      }
      setPending(focusMessageKey);
      if (!listenerCtlRef.current) {
        const handler = () => {
          if (suppressUserScrollRef.current) {
            suppressUserScrollRef.current = false;
            return;
          }
          release();
          setPending(null);
          onClearFocusRef.current();
        };
        listenerCtlRef.current = { key: focusMessageKey, container, handler };
        container.addEventListener("scroll", handler, { passive: true });
      }
      return;
    }

    release();
    setPending(null);
    attemptCountRef.current = 0;

    const applied = appliedRef.current;
    const sameJump =
      applied !== null &&
      applied.key === focusMessageKey &&
      applied.position?.messageID === focusPosition?.messageID &&
      applied.position?.toolCallID === focusPosition?.toolCallID &&
      applied.index === focusMessageIndex &&
      applied.id === focusMessageId;
    if (sameJump) return;

    appliedRef.current = {
      key: focusMessageKey,
      position: focusPosition,
      index: focusMessageIndex,
      id: focusMessageId,
    };

    // Prefer the registry index (no forced layout); fall back to one-off
    // element measurement for tool-call targets inside a message block.
    const target: number | HTMLElement =
      resolved.index !== undefined && registry?.byIndex.has(resolved.index)
        ? resolved.index
        : resolved.el;
    const el = resolved.el;
    const scrolled = scrollToRendered(target, "center", true, () => {
      // Pulse on arrival: the smooth scroll has settled, so the highlight reads
      // as the view lands on the target. Clear focus once it has been seen.
      if (timerRef.current) clearTimeout(timerRef.current);
      el.classList.add("sess-message-highlight");
      timerRef.current = setTimeout(() => {
        el.classList.remove("sess-message-highlight");
        onClearFocusRef.current();
      }, FLASH_TIMEOUT_MS);
    });
    if (!scrolled) return;
  }, [
    scrollRef,
    registry,
    registryVersion,
    messageCount,
    focusMessageKey,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    renderIndexResolver,
    suppressUserScrollRef,
    scrollToRendered,
    release,
    options,
  ]);

  attemptRef.current = attempt;

  // Run on every relevant change.
  useEffect(() => {
    attempt();
  }, [attempt]);

  // While a jump is pending (target not yet in the DOM), watch the container
  // for the message blocks to appear and re-attempt. This is what makes a
  // bookmark click on a not-yet-loaded session land once it finishes loading.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || pending === null) return;
    const observer = new MutationObserver(() => {
      if (pending === null) {
        observer.disconnect();
        return;
      }
      attemptRef.current();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [
    scrollRef,
    focusMessageKey,
    focusMessageIndex,
    focusMessageId,
    focusPosition,
    messageCount,
    registryVersion,
    pending,
  ]);

  useEffect(() => {
    return () => {
      release();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pending !== null) {
        const el = scrollRef.current;
        if (el) el.classList.remove("sess-message-highlight");
      }
    };
  }, [scrollRef, release]);
}

function resolveTarget(params: {
  container: HTMLElement;
  registry: BlockRegistry | null;
  focusPosition: Position | undefined;
  focusMessageIndex: number | undefined;
  focusMessageId: string | undefined;
  renderIndexResolver:
    | ((rawIndex: number | undefined, messageId: string | undefined) => number | undefined)
    | undefined;
}): ResolvedTarget {
  const { container, registry } = params;
  const find = (sel: string): HTMLElement | undefined =>
    container.querySelector<HTMLElement>(sel) ?? undefined;

  // Canonical Position first: a tool call inside the message beats the
  // message itself, and the message resolves via its stable id (drift-proof:
  // indexById maps the id to whichever rendered block currently owns it).
  if (params.focusPosition) {
    if (params.focusPosition.toolCallID) {
      const el = find(`[data-tool-call-id="${cssEscape(params.focusPosition.toolCallID)}"]`);
      return { el, index: undefined };
    }
    const viaId = params.focusPosition.messageID;
    const index = registry?.indexById.get(viaId);
    if (index !== undefined) {
      const el = find(`[data-message-index="${index}"]`);
      if (el) return { el, index };
    }
    // The id may belong to a raw message merged into a rendered block; the
    // grouping resolver knows that mapping.
    const rendered = params.renderIndexResolver?.(undefined, viaId);
    if (rendered !== undefined) {
      const el = find(`[data-message-index="${rendered}"]`);
      if (el) return { el, index: rendered };
    }
    const el = find(`[data-message-id="${cssEscape(viaId)}"]`);
    return { el, index: undefined };
  }

  // Legacy raw-index targets (diff navigation / search hits).
  if (params.focusMessageId !== undefined) {
    const viaId = params.focusMessageId;
    const index = registry?.indexById.get(viaId);
    if (index !== undefined) {
      const el = find(`[data-message-index="${index}"]`);
      if (el) return { el, index };
    }
    const rendered = params.renderIndexResolver?.(params.focusMessageIndex, viaId);
    if (rendered !== undefined) {
      const el = find(`[data-message-index="${rendered}"]`);
      if (el) return { el, index: rendered };
    }
    const el = find(`[data-message-id="${cssEscape(viaId)}"]`);
    return { el, index: undefined };
  }

  if (params.focusMessageIndex !== undefined) {
    const rendered = params.renderIndexResolver?.(params.focusMessageIndex, undefined);
    if (rendered === undefined && !params.renderIndexResolver) {
      return {
        el: find(`[data-message-index="${params.focusMessageIndex}"]`),
        index: params.focusMessageIndex,
      };
    }
    if (rendered === undefined) return { el: undefined, index: undefined };
    const el = find(`[data-message-index="${rendered}"]`);
    return { el, index: rendered };
  }

  return { el: undefined, index: undefined };
}
