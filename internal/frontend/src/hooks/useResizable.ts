import { useCallback, useEffect, useRef, useState } from "react";
import { getStorageItem, setStorageItem } from "../utils/storageKeys";

export interface UseResizableOptions {
  /** localStorage key (a `STORAGE_KEYS` entry) used to persist the value. */
  storageKey: string;
  /** Drag axis. "vertical" grows the value as the pointer moves up. */
  axis: "horizontal" | "vertical";
  min: number;
  max: number;
  defaultValue: number;
}

/**
 * Draggable resize of a panel dimension, persisted to localStorage and cleaned
 * up on unmount. Replaces the copy-pasted 3x drag-resize implementation.
 */
export function useResizable({ storageKey, axis, min, max, defaultValue }: UseResizableOptions) {
  const [value, setValue] = useState(() => {
    const stored = getStorageItem(storageKey);
    const n = stored ? Number(stored) : Number.NaN;
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaultValue;
  });
  const [isResizing, setIsResizing] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const dragRef = useRef<{ start: number; value: number } | null>(null);

  useEffect(() => {
    const clamp = (n: number) => Math.max(min, Math.min(max, n));

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = axis === "horizontal" ? ev.clientX - drag.start : drag.start - ev.clientY;
      setValue(clamp(drag.value + delta));
    };

    const onUp = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setIsResizing(false);
      const delta = axis === "horizontal" ? ev.clientX - drag.start : drag.start - ev.clientY;
      const next = clamp(drag.value + delta);
      setValue(next);
      setStorageItem(storageKey, String(next));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [axis, max, min, storageKey]);

  const startResize = useCallback(
    (e: { preventDefault(): void; clientX: number; clientY: number }) => {
      e.preventDefault();
      dragRef.current = {
        start: axis === "horizontal" ? e.clientX : e.clientY,
        value: valueRef.current,
      };
      setIsResizing(true);
    },
    [axis],
  );

  return { value, isResizing, startResize };
}
