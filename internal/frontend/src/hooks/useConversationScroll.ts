import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigation, type ScrollPosition } from "./useNavigation";

interface UseConversationScrollOptions {
  sessionId: string;
  messageCount: number;
  /**
   * The rendered conversation blocks (messagesWithoutReminders). Only its
   * identity is read: SSE-driven in-place updates swap the array while the
   * count stays the same, and the hook uses that as a "data changed" signal
   * to schedule a settle re-measure after the burst goes idle.
   */
  messages: unknown[];
  focusMessageIndex?: number;
  focusMessageId?: string;
  focusToolCallId?: string;
  focusStepIndex?: number;
  searchHighlightQuery?: string;
}

// Applied to the scroll container during a full measurement so every message
// block lays out at its real size: content-visibility estimates would
// otherwise distort offsetTop/scrollHeight and land the restore on the wrong
// message.
export const RESTORE_CLASS = "scroll-restoring";

// A never-saved position: requesting "scroll to bottom" restores to the most
// recent message regardless of these zeroed fields.
const EMPTY_SCROLL: ScrollPosition = {
  pos: 0,
  topIndex: undefined,
  topId: undefined,
  offset: 0,
  ts: 0,
};

// Re-measure cadence after a burst of streaming changes; only when no further
// change arrives inside the window does the full (lifted) measure run.
const SETTLE_DELAY_MS = 1500;

export interface BlockGeom {
  top: number;
  height: number;
}

// Per-session geometry of the rendered message blocks. byIndex keyed by the
// rendered block index (data-message-index), indexById maps the stable message
// id to its block index. scrollHeight is the container's measured scroll
// height. version increments on every measurement so effects can key on it.
export interface BlockRegistry {
  byIndex: Map<number, BlockGeom>;
  indexById: Map<string, number>;
  scrollHeight: number;
  version: number;
}

// The focus fields that make a jump "pending" — any one of them disables
// scroll restore / bottom-follow so the landing is left to the jump.
export interface PendingFocus {
  focusMessageIndex?: number | undefined;
  focusMessageId?: string | undefined;
  focusToolCallId?: string | undefined;
  focusStepIndex?: number | undefined;
}

export function hasPendingFocus(f: PendingFocus): boolean {
  return (
    f.focusMessageIndex !== undefined ||
    f.focusMessageId !== undefined ||
    f.focusToolCallId !== undefined ||
    f.focusStepIndex !== undefined
  );
}

// One full measurement pass: lifts content-visibility so every block reports
// its true offsetTop/offsetHeight and the container its true scrollHeight,
// then drops the class on the next frame. Returns a fresh registry.
export function measureRegistry(
  container: HTMLElement,
  prev?: BlockRegistry | null,
): BlockRegistry {
  container.classList.add(RESTORE_CLASS);
  const reg = scanBlocks(container, prev, 0);
  requestAnimationFrame(() => container.classList.remove(RESTORE_CLASS));
  return reg;
}

// Append-only tail measurement for live reloads: only blocks at index >=
// fromIndex are re-read, under content-visibility (no forced layout). Blocks
// above report their remembered-real sizes via contain-intrinsic-size: auto,
// so the newest block offsetTops are accurate and the cost stays cheap while
// a session streams.
export function measureTail(
  container: HTMLElement,
  fromIndex: number,
  prev?: BlockRegistry | null,
): BlockRegistry {
  return scanBlocks(container, prev, fromIndex);
}

function scanBlocks(
  container: HTMLElement,
  prev: BlockRegistry | null | undefined,
  fromIndex: number,
): BlockRegistry {
  const byIndex = new Map(prev?.byIndex ?? []);
  const indexById = new Map(prev?.indexById ?? []);
  const els = container.querySelectorAll<HTMLElement>("[data-message-index]");
  for (const el of els) {
    const idx = parseInt(el.getAttribute("data-message-index") || "", 10);
    if (Number.isNaN(idx) || idx < fromIndex) continue;
    byIndex.set(idx, { top: el.offsetTop, height: el.offsetHeight });
    const id = el.getAttribute("data-message-id");
    if (id) indexById.set(id, idx);
  }
  return {
    byIndex,
    indexById,
    scrollHeight: container.scrollHeight,
    version: (prev?.version ?? 0) + 1,
  };
}

function resolveGeomFromRegistry(
  registry: BlockRegistry | null,
  index: number | undefined,
  id: string | undefined,
): BlockGeom | undefined {
  if (!registry) return undefined;
  const idx = id !== undefined ? registry.indexById.get(id) : index;
  if (idx === undefined) return undefined;
  return registry.byIndex.get(idx);
}

function elementFor(
  container: HTMLElement,
  target: number | string | HTMLElement,
): HTMLElement | null {
  if (typeof target === "number") {
    return container.querySelector<HTMLElement>(`[data-message-index="${target}"]`);
  }
  if (typeof target === "string") {
    return container.querySelector<HTMLElement>(`[data-message-id="${target}"]`);
  }
  return target;
}

function geomFor(
  container: HTMLElement,
  registry: BlockRegistry | null,
  target: number | string | HTMLElement,
): BlockGeom | undefined {
  if (typeof target === "number") {
    return registry?.byIndex.get(target);
  }
  if (typeof target === "string") {
    return resolveGeomFromRegistry(registry, undefined, target);
  }
  // Element target: one-off measurement. Lift content-visibility so the block
  // (and everything above it) reports real geometry, then drop the class. Use
  // viewport-relative rects (not offsetTop) so nested targets — a tool call
  // buried inside a message block — resolve against the scroll container, not
  // an intermediate positioned ancestor.
  container.classList.add(RESTORE_CLASS);
  const cRect = container.getBoundingClientRect();
  const eRect = target.getBoundingClientRect();
  const geom = { top: eRect.top - cRect.top + container.scrollTop, height: eRect.height };
  requestAnimationFrame(() => container.classList.remove(RESTORE_CLASS));
  return geom;
}

// The only scroll path for target jumps and marker clicks. Resolves {top,
// height} from the registry for index/id targets (one-off measured when an
// element is passed), scrolls to center or top, then — for instant scrolls —
// verifies on the next frame and corrects once so late image/sub-content
// layout cannot leave the target out of view. Pass smooth=true for a jump so
// the view glides into place. Returns false when the target has no geometry.
export function scrollToRendered(
  container: HTMLDivElement,
  registry: BlockRegistry | null,
  target: number | string | HTMLElement,
  mode: "center" | "top" = "center",
  smooth = false,
  onArrive?: () => void,
): boolean {
  const geom = geomFor(container, registry, target);
  if (!geom) return false;
  const clientHeight = container.clientHeight;
  const max = Math.max(0, (registry?.scrollHeight ?? container.scrollHeight) - clientHeight);
  let y = mode === "center" ? geom.top - (clientHeight - geom.height) / 2 : geom.top;
  y = Math.max(0, Math.min(y, max));
  try {
    if (smooth) {
      container.scrollTo({ top: y, behavior: "smooth" });
      if (onArrive) scheduleArrival(container, onArrive);
      return true;
    }
    container.scrollTop = y;
  } catch {
    /* scrollTop assignment can throw in restricted contexts */
    return true;
  }
  const targetEl = elementFor(container, target);
  // Self-heal: if the block moved after the initial measure (sub-layout
  // drift), re-run the exact center/top calculation once using the on-screen
  // (real) position. Viewport-relative rects keep nested targets honest.
  requestAnimationFrame(() => {
    if (!targetEl || !container.isConnected || !targetEl.isConnected) return;
    const cRect = container.getBoundingClientRect();
    const eRect = targetEl.getBoundingClientRect();
    const targetTop = eRect.top - cRect.top + container.scrollTop;
    const drift = targetTop - geom.top;
    if (Math.abs(drift) <= 2) return;
    const y2 =
      mode === "center"
        ? targetTop - (container.clientHeight - targetEl.offsetHeight) / 2
        : targetTop;
    try {
      container.scrollTop = Math.max(
        0,
        Math.min(y2, Math.max(0, container.scrollHeight - container.clientHeight)),
      );
    } catch {
      /* restricted */
    }
  });
  return true;
}

// Fires onArrive once a smooth scroll has settled. Prefers the scrollend event
// and falls back to a timeout so the callback always runs even if the target
// is already in view (no scrollend) or the event is unsupported.
function scheduleArrival(container: HTMLElement, onArrive: () => void): void {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    container.removeEventListener("scrollend", fire);
    onArrive();
  };
  container.addEventListener("scrollend", fire);
  setTimeout(fire, 800);
}

function captureAnchorDOM(el: HTMLDivElement): {
  topIndex: number | undefined;
  topId: string | undefined;
  offset: number;
} {
  const blocks = el.querySelectorAll<HTMLElement>("[data-message-index]");
  let anchor: HTMLElement | null = null;
  for (const b of blocks) {
    if (b.offsetTop <= el.scrollTop + 1) {
      anchor = b;
    } else {
      break;
    }
  }
  if (!anchor) return { topIndex: undefined, topId: undefined, offset: 0 };
  const indexAttr = anchor.getAttribute("data-message-index");
  // Most anchors are near the viewport so their live offsetTop is real, but if
  // the registry is empty (very first scroll) the estimate could be off — lift
  // once to read the true value.
  el.classList.add(RESTORE_CLASS);
  const top = anchor.offsetTop;
  requestAnimationFrame(() => el.classList.remove(RESTORE_CLASS));
  return {
    topIndex: indexAttr !== null ? parseInt(indexAttr, 10) : undefined,
    topId: anchor.getAttribute("data-message-id") || undefined,
    offset: el.scrollTop - top,
  };
}

// Captures the message block nearest the top of the viewport plus how far below
// it the viewport top sat. Restoring against the block is stable: absolute
// scrollTop is distorted by content-visibility estimates across mounts, but a
// resolved top of the same block re-lands on the exact spot. Prefers the
// registry (recorded under a lifted measurement) so save-on-scroll never has to
// force layout.
export function captureAnchor(
  el: HTMLDivElement,
  registry: BlockRegistry | null,
): { topIndex: number | undefined; topId: string | undefined; offset: number } {
  if (registry && registry.byIndex.size > 0) {
    let anchorIndex: number | undefined;
    for (const [idx, geom] of registry.byIndex) {
      if (geom.top <= el.scrollTop + 1) {
        anchorIndex = idx;
      } else {
        break;
      }
    }
    if (anchorIndex === undefined) return { topIndex: undefined, topId: undefined, offset: 0 };
    const geom = registry.byIndex.get(anchorIndex);
    if (!geom) return { topIndex: undefined, topId: undefined, offset: 0 };
    let topId: string | undefined;
    for (const [id, idx] of registry.indexById) {
      if (idx === anchorIndex) {
        topId = id;
        break;
      }
    }
    return { topIndex: anchorIndex, topId, offset: el.scrollTop - geom.top };
  }
  return captureAnchorDOM(el);
}

// Resolves a saved position against the registry's real block tops: exact block
// offset when the anchor still exists, absolute pixel otherwise. Returns false
// when nothing usable can be applied (container not laid out yet). Callers must
// measure the registry fresh first; this function never forces layout itself.
export function restoreTo(
  el: HTMLDivElement,
  sp: ScrollPosition,
  requestScrollToBottom: boolean,
  registry: BlockRegistry | null,
): boolean {
  if (el.scrollHeight === 0) return false;
  try {
    if (!requestScrollToBottom && (sp.topIndex !== undefined || sp.topId !== undefined)) {
      const geom = resolveGeomFromRegistry(registry, sp.topIndex, sp.topId);
      if (geom) {
        el.scrollTop = geom.top + sp.offset;
        return true;
      }
    }
    el.scrollTop = requestScrollToBottom
      ? registry && registry.scrollHeight > 0
        ? registry.scrollHeight
        : el.scrollHeight
      : sp.pos;
    return true;
  } catch {
    /* scrollTop assignment can throw in restricted contexts */
    return false;
  }
}

// Smoothly eases the container to its real bottom. Message blocks use
// content-visibility:auto, so the resting scrollHeight is only an estimate; the
// lift class is held for the whole glide so every block reports its true size
// and the motion lands on the real bottom in one pass, then drops the class.
export function animateScrollToBottom(el: HTMLDivElement, onDone?: () => void): void {
  el.classList.add(RESTORE_CLASS);
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  const start = el.scrollTop;
  const distance = maxScroll - start;
  if (Math.abs(distance) < 1) {
    el.classList.remove(RESTORE_CLASS);
    onDone?.();
    return;
  }
  const duration = Math.min(600, Math.max(200, Math.abs(distance) * 0.4));
  const t0 = performance.now();
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    el.scrollTop = start + distance * ease(t);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      el.classList.remove(RESTORE_CLASS);
      onDone?.();
    }
  };
  requestAnimationFrame(step);
}

// Instant center-scroll of a single element within its own scroll container
// (no geometry registry involved). Used by the plan and pinned-prompt panes,
// whose content never uses content-visibility estimates.
export function scrollElementToCenter(container: HTMLElement, el: HTMLElement) {
  try {
    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    container.scrollTop += er.top - cr.top - container.clientHeight / 2 + er.height / 2;
  } catch {
    /* restricted */
  }
}

function updateButtons(el: HTMLDivElement) {
  const threshold = Math.max(el.clientHeight * 0.3, 100);
  const scrollable = el.scrollHeight > el.clientHeight + 2;
  return {
    showScrollTop: scrollable && el.scrollTop > threshold,
    showScrollBottom: scrollable && el.scrollHeight - el.scrollTop - el.clientHeight > threshold,
  };
}

export function useConversationScroll({
  sessionId,
  messageCount,
  messages,
  focusMessageIndex,
  focusMessageId,
  focusToolCallId,
  focusStepIndex,
  searchHighlightQuery,
}: UseConversationScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const restoredRef = useRef(false);
  const registryRef = useRef<BlockRegistry | null>(null);
  // Set true around every programmatic scrollTop write so a pending jump's
  // one-time user-scroll listener does not mistake the restore/follow for the
  // user walking away. The listener consumes the flag on its first event.
  const suppressUserScrollRef = useRef(true);
  // True while the user is "following" the bottom of a live session. Streaming
  // auto-follow only scrolls them down when this holds, so navigating to a
  // bookmark or scrolling up leaves them exactly where they are.
  const followingBottomRef = useRef(false);
  // True for the duration of a programmatic scroll, so the scroll listener does
  // not mistake it for a user navigation when updating followingBottomRef.
  const programmaticScrollingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { getScrollPosition, saveScrollPosition } = useNavigation();

  const [registryVersion, setRegistryVersion] = useState(0);
  const [markerPositions, setMarkerPositions] = useState<Record<string, number>>({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const doSaveScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { topIndex, topId, offset } = captureAnchor(el, registryRef.current);
    saveScrollPosition(sessionId, el.scrollTop, topIndex, topId, offset);
  }, [sessionId, saveScrollPosition]);

  const markProgrammaticScroll = useCallback(() => {
    suppressUserScrollRef.current = true;
    programmaticScrollingRef.current = true;
    requestAnimationFrame(() => {
      programmaticScrollingRef.current = false;
    });
  }, []);

  const applyRegistry = useCallback((reg: BlockRegistry) => {
    registryRef.current = reg;
    setRegistryVersion(reg.version);
  }, []);

  const settle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      applyRegistry(measureRegistry(el, registryRef.current));
    }, SETTLE_DELAY_MS);
  }, [applyRegistry]);

  const followToBottom = useCallback(
    (reg: BlockRegistry | null) => {
      const el = scrollRef.current;
      if (!el) return;
      markProgrammaticScroll();
      try {
        el.scrollTop = reg?.scrollHeight ?? el.scrollHeight;
      } catch {
        /* restricted */
      }
    },
    [markProgrammaticScroll],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isInitialLoad = prevLengthRef.current === 0;
    const focusPending = hasPendingFocus({
      focusMessageIndex,
      focusMessageId,
      focusToolCallId,
      focusStepIndex,
    });

    if (isInitialLoad && messageCount > 0) {
      // Landing pass: one full (lifted) measure — the same forced layout cost
      // restoreTo used to pay — then restore unless a jump owns the landing.
      settle();
      const reg = measureRegistry(el, registryRef.current);
      applyRegistry(reg);
      const isSearchNav = focusPending || !!searchHighlightQuery;
      if (!isSearchNav) {
        markProgrammaticScroll();
        try {
          const saved = getScrollPosition(sessionId);
          if (saved !== undefined && !restoredRef.current) {
            if (restoreTo(el, saved, false, reg)) restoredRef.current = true;
          } else if (saved === undefined && !restoredRef.current) {
            if (restoreTo(el, EMPTY_SCROLL, true, reg)) restoredRef.current = true;
          }
          followingBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        } catch {
          /* scrollTop assignment can throw in restricted contexts */
        }
      }
    } else if (messageCount > prevLengthRef.current) {
      // Live reload growth: cheap append-only tail measurement, then follow the
      // bottom when the user is already there (never for a pending jump).
      settle();
      const reg = measureTail(el, prevLengthRef.current, registryRef.current);
      applyRegistry(reg);
      // Only auto-follow the bottom while the user is actually pinned there.
      // Once they scroll up or jump to a bookmark, streaming never moves them.
      if (followingBottomRef.current) followToBottom(reg);
    } else {
      // Same block count but the render changed (SSE in-place updates re-group
      // middle blocks): let the idle settle re-measure them at true sizes.
      settle();
    }

    const btn = updateButtons(el);
    setShowScrollTop(btn.showScrollTop);
    setShowScrollBottom(btn.showScrollBottom);

    prevLengthRef.current = messageCount;
  }, [
    messageCount,
    messages,
    sessionId,
    getScrollPosition,
    focusMessageIndex,
    focusMessageId,
    focusToolCallId,
    focusStepIndex,
    searchHighlightQuery,
    applyRegistry,
    followToBottom,
    settle,
  ]);

  // If the restore ran while the container was hidden (inactive tab), it saw
  // scrollHeight === 0 and bailed; re-apply once real layout arrives. Also
  // fires when messages first become non-empty after an empty start, and skips
  // entirely while a focus jump is pending.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const tryRestore = () => {
      if (restoredRef.current) return;
      const current = scrollRef.current;
      if (!current || current.scrollHeight === 0) return;
      if (hasPendingFocus({ focusMessageIndex, focusMessageId, focusToolCallId, focusStepIndex })) {
        return;
      }
      const reg = measureRegistry(current, registryRef.current);
      applyRegistry(reg);
      const saved = getScrollPosition(sessionId);
      markProgrammaticScroll();
      let ok = false;
      if (saved !== undefined) {
        ok = restoreTo(current, saved, false, reg);
      } else if (restoreTo(current, EMPTY_SCROLL, true, reg)) {
        ok = true;
      }
      if (ok) restoredRef.current = true;
      followingBottomRef.current =
        current.scrollHeight - current.scrollTop - current.clientHeight < 80;
    };
    const observer = new ResizeObserver(tryRestore);
    observer.observe(el);
    document.addEventListener("visibilitychange", tryRestore);
    tryRestore();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryRestore);
    };
  }, [
    sessionId,
    getScrollPosition,
    messageCount,
    messages,
    focusMessageIndex,
    focusMessageId,
    focusToolCallId,
    focusStepIndex,
    applyRegistry,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const btn = updateButtons(el);
      setShowScrollTop(btn.showScrollTop);
      setShowScrollBottom(btn.showScrollBottom);
      if (!programmaticScrollingRef.current) {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        followingBottomRef.current = atBottom;
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => doSaveScroll(), 300);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Flush any in-flight position so an unmount does not lose the last spot.
      doSaveScroll();
    };
  }, [messageCount, doSaveScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const btn = updateButtons(el);
      setShowScrollTop(btn.showScrollTop);
      setShowScrollBottom(btn.showScrollBottom);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    requestAnimationFrame(update);
    return () => observer.disconnect();
  }, [messageCount, messages]);

  // Marker positions come straight from the registry (real tops over the real
  // scrollHeight), recomputed only when a measurement lands — not per frame or
  // per scroll.
  useEffect(() => {
    const reg = registryRef.current;
    const positions: Record<string, number> = {};
    if (reg && reg.scrollHeight > 0) {
      for (const [idx, geom] of reg.byIndex) {
        positions[`msg-${idx}`] = (geom.top / reg.scrollHeight) * 100;
      }
    }
    setMarkerPositions(positions);
  }, [registryVersion]);

  const scrollToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    markProgrammaticScroll();
    followingBottomRef.current = false;
    try {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* restricted */
    }
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    followingBottomRef.current = true;
    programmaticScrollingRef.current = true;
    animateScrollToBottom(el, () => {
      programmaticScrollingRef.current = false;
    });
  };

  // Bound jump/marker click path: resolves against the latest registry.
  const scrollToRenderedJump = useCallback(
    (
      target: number | string | HTMLElement,
      mode: "center" | "top" = "center",
      smooth = false,
      onArrive?: () => void,
    ): boolean => {
      const el = scrollRef.current;
      if (!el) return false;
      markProgrammaticScroll();
      return scrollToRendered(el, registryRef.current, target, mode, smooth, onArrive);
    },
    [markProgrammaticScroll],
  );

  return {
    scrollRef,
    registry: registryRef.current,
    registryVersion,
    markerPositions,
    suppressUserScrollRef,
    showScrollTop,
    showScrollBottom,
    scrollToTop,
    scrollToBottom,
    scrollToRendered: scrollToRenderedJump,
  };
}
