import { describe, expect, it } from "vitest";
import { findRangeIndices, isSpanContained, mergeSpanRange } from "../spanRange";

describe("isSpanContained", () => {
  it("matches exact bounds", () => {
    expect(isSpanContained({ start: 2, end: 5 }, { start: 2, end: 5 })).toBe(true);
  });

  it("detects an inner turn", () => {
    expect(isSpanContained({ start: 2, end: 8 }, { start: 4, end: 6 })).toBe(true);
  });

  it("rejects an outer turn", () => {
    expect(isSpanContained({ start: 2, end: 5 }, { start: 1, end: 5 })).toBe(false);
    expect(isSpanContained({ start: 2, end: 5 }, { start: 2, end: 6 })).toBe(false);
  });
});

describe("mergeSpanRange", () => {
  it("extends forward from the anchor", () => {
    expect(mergeSpanRange({ start: 2, end: 4 }, { start: 6, end: 8 })).toEqual({
      start: 2,
      end: 8,
    });
  });

  it("extends backward from the anchor", () => {
    expect(mergeSpanRange({ start: 6, end: 8 }, { start: 2, end: 4 })).toEqual({
      start: 2,
      end: 8,
    });
  });

  it("keeps a single turn when anchor equals clicked", () => {
    expect(mergeSpanRange({ start: 2, end: 4 }, { start: 2, end: 4 })).toEqual({
      start: 2,
      end: 4,
    });
  });
});

describe("findRangeIndices", () => {
  const spans = [
    { start: 0, end: 3, idx: 0 },
    { start: 3, end: 6, idx: 1 },
    { start: 6, end: 9, idx: 2 },
  ];

  it("finds a single turn", () => {
    expect(findRangeIndices(spans, { start: 3, end: 6 })).toEqual({ first: 1, last: 1 });
  });

  it("finds a contiguous range", () => {
    expect(findRangeIndices(spans, { start: 0, end: 9 })).toEqual({ first: 0, last: 2 });
  });

  it("returns null for unaligned bounds", () => {
    expect(findRangeIndices(spans, { start: 1, end: 6 })).toBeNull();
  });
});
