import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSessionNav } from "./useNav";

interface UseConversationScrollOptions {
  sessionId: string;
  messageCount: number;
  focusMessageIndex?: number;
  searchHighlightQuery?: string;
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
  focusMessageIndex,
  searchHighlightQuery,
}: UseConversationScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const { scrollPositions, saveScrollPosition } = useSessionNav();

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const doSaveScroll = useCallback(() => {
    if (scrollRef.current) {
      saveScrollPosition(sessionId, scrollRef.current.scrollTop);
    }
  }, [sessionId, saveScrollPosition]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPositions.get(sessionId);
    const isInitialLoad = prevLengthRef.current === 0;

    const isSearchNav = focusMessageIndex !== undefined || (searchHighlightQuery && isInitialLoad);

    if (isInitialLoad && !isSearchNav) {
      if (saved !== undefined) {
        el.scrollTop = saved;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else if (messageCount > prevLengthRef.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (nearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }

    const btn = updateButtons(el);
    setShowScrollTop(btn.showScrollTop);
    setShowScrollBottom(btn.showScrollBottom);

    prevLengthRef.current = messageCount;
  }, [messageCount, sessionId, scrollPositions, focusMessageIndex, searchHighlightQuery]);

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
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return {
    scrollRef,
    showScrollTop,
    showScrollBottom,
    scrollToTop,
    scrollToBottom,
  };
}
