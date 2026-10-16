import { useEffect, useRef, useState } from "react";

/**
 * Observe an element's content width with a ResizeObserver.
 *
 * Returns a ref to attach and the latest measured width (`null` until the
 * first measurement). Used to drive width-based layout decisions — e.g.
 * auto-collapsing the cinematic activity drawer — without plumbing container
 * dimensions down through props. Safe where ResizeObserver is unavailable
 * (jsdom): it falls back to the initial rect measurement and never throws.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Seed with the current size so callers get a value without waiting for
    // the observer's first (asynchronous) callback.
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
