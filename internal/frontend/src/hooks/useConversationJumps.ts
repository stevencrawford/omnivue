import { useEffect, useRef } from "react";
import type { BlockRegistry } from "./useConversationScroll";

export interface UseConversationJumpsOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  registry: BlockRegistry | null;
  registryVersion: number;
  /** Renderered message block count; growing it lets a pending jump retry. */
  messageCount: number;
  focusMessageKey: number;
  focusMessageIndex?: number;
  focusMessageId?: string;
  focusToolCallId?: string;
  focusStepIndex?: number;
  focusRenderedIndex?: boolean;
  /** Maps a raw list index / message id to the rendered block index. */
  renderIndexResolver?: (
    rawIndex: number | undefined,
    messageId: string | undefined,
  ) => number | undefined;
  onClearFocus: () => void;
  /** Set true around programmatic scrolls so the pending-walk-away listener
   *  does not mistake the restore/follow for a user scroll. */
  suppressUserScrollRef: React.RefObject<boolean>;
  scrollToRendered: (target: number | string | HTMLElement, mode?: "center" | "top") => boolean;
}

const FLASH_TIMEOUT_MS = 2000;

interface AppliedFocus {
  key: number | undefined;
  index: number | undefined;
  id: string | undefined;
  toolCallId: string | undefined;
  rendered: boolean | undefined;
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

// One jump orchestrator replacing the three competing scroll effects (step /
// message / tool) that used to live in useSearchHighlight: an identity-first
// resolution, a pending retry (no give-up bails), and a single, exactly-once
// scroll guarded against SSE re-renders.
export function useConversationJumps(options: UseConversationJumpsOptions) {
  const {
    scrollRef,
    registry,
    registryVersion,
    messageCount,
    focusMessageKey,
    focusMessageIndex,
    focusMessageId,
    focusToolCallId,
    focusStepIndex,
    focusRenderedIndex,
    renderIndexResolver,
    onClearFocus,
    suppressUserScrollRef,
    scrollToRendered,
  } = options;

  const appliedRef = useRef<AppliedFocus | null>(null);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listenerCtlRef = useRef<{
    key: number;
    container: HTMLElement;
    handler: () => void;
  } | null>(null);
  const onClearFocusRef = useRef(onClearFocus);
  onClearFocusRef.current = onClearFocus;

  useEffect(() => {
    const focusActive =
      focusMessageIndex !== undefined ||
      focusMessageId !== undefined ||
      focusToolCallId !== undefined ||
      focusStepIndex !== undefined;

    if (!focusActive) {
      appliedRef.current = null;
      pendingRef.current = null;
      release();
      return;
    }

    const container = scrollRef.current;
    if (!container) return;

    // A different jump supersedes a still-pending one: drop its listener.
    if (listenerCtlRef.current && listenerCtlRef.current.key !== focusMessageKey) {
      release();
    }

    const resolved = resolveTarget({
      container,
      registry,
      focusMessageIndex,
      focusMessageId,
      focusToolCallId,
      focusStepIndex,
      focusRenderedIndex,
      renderIndexResolver,
    });

    if (!resolved.el) {
      // Not found yet — stay pending. Arm a one-time walk-away listener: if the
      // user scrolls, clear focus and abandon; otherwise retry on the next
      // count/registry change. Programmatic scrolls set the suppression flag
      // before this effect arms the listener, so their events never cancel.
      pendingRef.current = focusMessageKey;
      if (!listenerCtlRef.current) {
        const handler = () => {
          if (suppressUserScrollRef.current) {
            suppressUserScrollRef.current = false;
            return;
          }
          release();
          pendingRef.current = null;
          onClearFocusRef.current();
        };
        listenerCtlRef.current = { key: focusMessageKey, container, handler };
        container.addEventListener("scroll", handler, { passive: true });
      }
      return;
    }

    release();
    pendingRef.current = null;

    const applied = appliedRef.current;
    const sameJump =
      applied !== null &&
      applied.key === focusMessageKey &&
      applied.index === focusMessageIndex &&
      applied.id === focusMessageId &&
      applied.toolCallId === focusToolCallId &&
      applied.rendered === focusRenderedIndex;
    if (sameJump) return;

    appliedRef.current = {
      key: focusMessageKey,
      index: focusMessageIndex,
      id: focusMessageId,
      toolCallId: focusToolCallId,
      rendered: focusRenderedIndex,
    };

    // Prefer the registry index (no forced layout); fall back to one-off
    // element measurement for tool-call targets inside a message block.
    const target: number | HTMLElement =
      resolved.index !== undefined && registry?.byIndex.has(resolved.index)
        ? resolved.index
        : resolved.el;
    const scrolled = scrollToRendered(target, "center");
    if (!scrolled) return;

    const el = resolved.el;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      el.classList.remove("sess-message-highlight");
      onClearFocusRef.current();
    }, FLASH_TIMEOUT_MS);

    // Flash only once the target is actually in view after the scroll lands.
    requestAnimationFrame(() => {
      if (!el.isConnected || !container.isConnected) return;
      const cr = container.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (er.bottom >= cr.top && er.top <= cr.bottom) {
        el.classList.add("sess-message-highlight");
      }
    });
  }, [
    scrollRef,
    registry,
    registryVersion,
    messageCount,
    focusMessageKey,
    focusMessageIndex,
    focusMessageId,
    focusToolCallId,
    focusStepIndex,
    focusRenderedIndex,
    renderIndexResolver,
    scrollToRendered,
  ]);

  function release() {
    if (listenerCtlRef.current) {
      listenerCtlRef.current.container.removeEventListener(
        "scroll",
        listenerCtlRef.current.handler,
      );
      listenerCtlRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      release();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current !== null) {
        const el = scrollRef.current;
        if (el) el.classList.remove("sess-message-highlight");
      }
    };
  }, [scrollRef]);
}

function resolveTarget(params: {
  container: HTMLElement;
  registry: BlockRegistry | null;
  focusMessageIndex: number | undefined;
  focusMessageId: string | undefined;
  focusToolCallId: string | undefined;
  focusStepIndex: number | undefined;
  focusRenderedIndex: boolean | undefined;
  renderIndexResolver:
    | ((rawIndex: number | undefined, messageId: string | undefined) => number | undefined)
    | undefined;
}): ResolvedTarget {
  const { container, registry } = params;
  const find = (sel: string): HTMLElement | undefined =>
    container.querySelector<HTMLElement>(sel) ?? undefined;

  // Identity first: a tool call inside the message beats the message itself.
  if (params.focusToolCallId) {
    const el = find(`[data-tool-call-id="${cssEscape(params.focusToolCallId)}"]`);
    return { el, index: undefined };
  }

  // Message identity via the registry (drift-proof: indexById maps the stable
  // id to whichever rendered block currently owns it).
  if (params.focusMessageId !== undefined) {
    const viaId = params.focusMessageId;
    const index = registry?.indexById.get(viaId);
    if (index !== undefined) {
      const el = find(`[data-message-index="${index}"]`);
      if (el) return { el, index };
    }
    // The id may belong to a raw message merged into a rendered block; the
    // grouping resolver knows that mapping.
    const rendered = params.renderIndexResolver?.(params.focusMessageIndex, viaId);
    if (rendered !== undefined) {
      const el = find(`[data-message-index="${rendered}"]`);
      if (el) return { el, index: rendered };
    }
    const el = find(`[data-message-id="${cssEscape(viaId)}"]`);
    return { el, index: undefined };
  }

  if (params.focusStepIndex !== undefined) {
    const el = find(`[data-message-index="${params.focusStepIndex}"]`);
    return { el, index: params.focusStepIndex };
  }

  if (params.focusMessageIndex !== undefined) {
    let rendered = params.focusRenderedIndex
      ? params.focusMessageIndex
      : params.renderIndexResolver?.(params.focusMessageIndex, undefined);
    if (rendered === undefined && !params.renderIndexResolver) {
      rendered = params.focusMessageIndex;
    }
    if (rendered === undefined) return { el: undefined, index: undefined };
    const el = find(`[data-message-index="${rendered}"]`);
    return { el, index: rendered };
  }

  return { el: undefined, index: undefined };
}
