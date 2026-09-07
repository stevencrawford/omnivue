export interface SpanBound {
  start: number;
  end: number;
}

/** True when `inner` lies fully inside `outer` (inclusive edges). */
export function isSpanContained(outer: SpanBound, inner: SpanBound): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Merge an anchor turn with a shift-clicked turn into a contiguous range.
 * Spans partition the timeline, so min/max of the bounds covers every turn
 * between them with no gaps.
 */
export function mergeSpanRange(anchor: SpanBound, clicked: SpanBound): SpanBound {
  return {
    start: Math.min(anchor.start, clicked.start),
    end: Math.max(anchor.end, clicked.end),
  };
}

export interface IndexedSpan extends SpanBound {
  idx: number;
}

/**
 * Locate the first/last turn indices covered by a selection. Returns null
 * when the selection does not align to span boundaries (stale state).
 */
export function findRangeIndices(
  spans: IndexedSpan[],
  selected: SpanBound,
): { first: number; last: number } | null {
  const first = spans.findIndex((s) => s.start === selected.start);
  if (first < 0) return null;
  const lastByEnd = spans.findIndex((s) => s.end === selected.end);
  if (lastByEnd >= 0) return { first, last: lastByEnd };
  // Trailing selections track live growth; fall back to the last span that
  // starts inside the selection.
  let last = -1;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]!.start >= selected.start && spans[i]!.start < selected.end) last = i;
  }
  if (last < first) return null;
  return { first, last };
}
