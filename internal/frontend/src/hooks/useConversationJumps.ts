import { useCallback, useEffect, useRef, useState } from "react";
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
  scrollToRendered: (
    target: number | string | HTMLElement,
    mode?: "center" | "top",
    smooth?: boolean,
    onArrive?: () => void,
  ) => boolean;
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
// resolution, a pending retry that waits for the target to exist (e.g. a
// session still loading), and a single, exactly-once scroll guarded against
// SSE re-renders.
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
  const [pending, setPending] = useState<number | null>(null);
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

    const focusActive =
      focusMessageIndex !== undefined ||
      focusMessageId !== undefined ||
      focusToolCallId !== undefined ||
      focusStepIndex !== undefined;

    if (!focusActive) {
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
      focusMessageIndex,
      focusMessageId,
      focusToolCallId,
      focusStepIndex,
      focusRenderedIndex,
      renderIndexResolver,
    });

    if (!resolved.el) {
      // Not found yet — stay pending and keep watching the DOM. The session
      // may still be loading; once its message blocks render (or re-group),
      // the MutationObserver below re-runs this attempt and lands the jump.
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
    focusMessageIndex,
    focusMessageId,
    focusToolCallId,
    focusStepIndex,
    focusRenderedIndex,
    renderIndexResolver,
    suppressUserScrollRef,
    scrollToRendered,
    release,
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
    focusToolCallId,
    focusStepIndex,
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
