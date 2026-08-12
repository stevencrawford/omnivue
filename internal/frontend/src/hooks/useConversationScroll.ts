import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigation, type ScrollPosition } from "./useNavigation";

interface UseConversationScrollOptions {
  sessionId: string;
  messageCount: number;
  focusMessageIndex?: number;
  searchHighlightQuery?: string;
}

// Applied to the scroll container during a restore so every message block lays
// out at its real size: content-visibility estimates would otherwise distort
// offsetTop/scrollHeight and land the restore on the wrong message.
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

function updateButtons(el: HTMLDivElement) {
  const threshold = Math.max(el.clientHeight * 0.3, 100);
  const scrollable = el.scrollHeight > el.clientHeight + 2;
  return {
    showScrollTop: scrollable && el.scrollTop > threshold,
    showScrollBottom: scrollable && el.scrollHeight - el.scrollTop - el.clientHeight > threshold,
  };
}

// Captures the message block nearest the top of the viewport plus how far below
// it the viewport top sat. Restoring against the block is stable: absolute
// scrollTop is distorted by content-visibility estimates across mounts, but a
// resolved offsetTop of the same block re-lands on the exact spot.
export function captureAnchor(el: HTMLDivElement): {
  topIndex: number | undefined;
  topId: string | undefined;
  offset: number;
} {
  const blocks = el.querySelectorAll("[data-message-index]");
  let anchor: HTMLElement | null = null;
  for (const b of blocks) {
    const block = b as HTMLElement;
    if (block.offsetTop <= el.scrollTop + 1) {
      anchor = block;
    } else {
      break;
    }
  }
  if (!anchor) return { topIndex: undefined, topId: undefined, offset: 0 };
  const indexAttr = anchor.getAttribute("data-message-index");
  return {
    topIndex: indexAttr !== null ? parseInt(indexAttr, 10) : undefined,
    topId: anchor.getAttribute("data-message-id") || undefined,
    offset: el.scrollTop - anchor.offsetTop,
  };
}

// Resolves a saved position against the current DOM: exact block offset when the
// anchor still exists, absolute pixel otherwise. Returns undefined when nothing
// usable can be applied (e.g. the container is not laid out yet).
export function restoreTo(
  el: HTMLDivElement,
  sp: ScrollPosition,
  requestScrollToBottom: boolean,
): boolean {
  if (el.scrollHeight === 0) return false;
  el.classList.add(RESTORE_CLASS);
  try {
    if (!requestScrollToBottom && (sp.topIndex !== undefined || sp.topId !== undefined)) {
      const sel = sp.topId
        ? `[data-message-id="${sp.topId}"]`
        : `[data-message-index="${sp.topIndex}"]`;
      const anchor = el.querySelector(sel) as HTMLElement | null;
      if (anchor) {
        el.scrollTop = anchor.offsetTop + sp.offset;
        // content-visibility re-evaluates after the resolve class lifts; keep
        // the pixel where this frame's real layout put it.
        requestAnimationFrame(() => el.classList.remove(RESTORE_CLASS));
        return true;
      }
    }
    // Block the marker recalc from racing the restored layout by keeping the
    // resolve class one frame past the pixel restore too.
    requestAnimationFrame(() => el.classList.remove(RESTORE_CLASS));
    el.scrollTop = requestScrollToBottom ? el.scrollHeight : sp.pos;
    return true;
  } catch {
    requestAnimationFrame(() => el.classList.remove(RESTORE_CLASS));
    return false;
  }
}

export function useConversationScroll({
  sessionId,
  messageCount,
  focusMessageIndex,
  searchHighlightQuery,
}: UseConversationScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const restoredRef = useRef(false);
  const { getScrollPosition, saveScrollPosition } = useNavigation();

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const doSaveScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { topIndex, topId, offset } = captureAnchor(el);
    saveScrollPosition(sessionId, el.scrollTop, topIndex, topId, offset);
  }, [sessionId, saveScrollPosition]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isInitialLoad = prevLengthRef.current === 0;

    const isSearchNav = focusMessageIndex !== undefined || (searchHighlightQuery && isInitialLoad);

    try {
      if (isInitialLoad && !isSearchNav) {
        const saved = getScrollPosition(sessionId);
        if (saved !== undefined && !restoredRef.current) {
          if (restoreTo(el, saved, false)) restoredRef.current = true;
        } else if (saved === undefined && !restoredRef.current) {
          // Never visited (or stale beyond TTL): land on the most recent message.
          if (restoreTo(el, EMPTY_SCROLL, true)) {
            restoredRef.current = true;
          }
        }
      } else if (messageCount > prevLengthRef.current) {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (nearBottom) {
          el.scrollTop = el.scrollHeight;
        }
      }
    } catch {
      /* scrollTop assignment can throw in restricted contexts */
    }

    const btn = updateButtons(el);
    setShowScrollTop(btn.showScrollTop);
    setShowScrollBottom(btn.showScrollBottom);

    prevLengthRef.current = messageCount;
  }, [messageCount, sessionId, getScrollPosition, focusMessageIndex, searchHighlightQuery]);

  // If the restore ran while the container was hidden (inactive tab), it saw
  // scrollHeight === 0 and bailed; re-apply once real layout arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoredRef.current) return;
    const tryRestore = () => {
      if (restoredRef.current) return;
      const current = scrollRef.current;
      if (!current || current.scrollHeight === 0) return;
      const saved = getScrollPosition(sessionId);
      if (saved !== undefined) {
        if (restoreTo(current, saved, false)) restoredRef.current = true;
      } else if (restoreTo(current, EMPTY_SCROLL, true)) {
        restoredRef.current = true;
      }
    };
    const observer = new ResizeObserver(tryRestore);
    observer.observe(el);
    document.addEventListener("visibilitychange", tryRestore);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryRestore);
    };
  }, [sessionId, getScrollPosition]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const btn = updateButtons(el);
      setShowScrollTop(btn.showScrollTop);
      setShowScrollBottom(btn.showScrollBottom);
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
  }, [messageCount]);

  const scrollToTop = () => {
    try {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* scrollTo throws in restricted contexts or on detached elements */
    }
  };
  const scrollToBottom = () => {
    try {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    } catch {
      /* scrollTo throws in restricted contexts or on detached elements */
    }
  };

  return {
    scrollRef,
    showScrollTop,
    showScrollBottom,
    scrollToTop,
    scrollToBottom,
  };
}
