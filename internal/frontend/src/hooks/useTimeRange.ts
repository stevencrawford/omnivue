import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS, getStorageJSON, setStorageJSON } from "../utils/storageKeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeRangePreset = "1d" | "3d" | "7d" | "1mo" | "custom";

export interface TimeRange {
  preset: TimeRangePreset;
  /** Custom start date (ISO date string YYYY-MM-DD). Only used when preset === "custom". */
  start?: string;
  /** Custom end date (ISO date string YYYY-MM-DD). Only used when preset === "custom". */
  end?: string;
}

export interface TimeRangeResult {
  range: TimeRange;
  /** The resolved start Date, or null for "all". */
  startDate: Date | null;
  /** The resolved end Date (now for presets, custom end for custom, or null for "all"). */
  endDate: Date;
  /** Human-readable label for the current range. */
  label: string;
  setPreset: (preset: TimeRangePreset) => void;
  setCustomRange: (start: string, end: string) => void;
}

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

const DEFAULT_RANGE: TimeRange = { preset: "1d" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateFull(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rangeLabel(range: TimeRange): string {
  if (range.preset === "custom" && range.start && range.end) {
    const s = new Date(range.start + "T00:00:00");
    const e = new Date(range.end + "T00:00:00");
    if (s.getTime() === e.getTime()) return formatDateFull(s);
    return `${formatDateFull(s)} – ${formatDateFull(e)}`;
  }
  switch (range.preset) {
    case "1d":
      return "Last 24 hours";
    case "3d":
      return "Last 3 days";
    case "7d":
      return "Last 7 days";
    case "1mo":
      return "Last month";
    case "custom":
      return "Custom";
    default:
      return "Last 24 hours";
  }
}

function resolveDates(range: TimeRange): { start: Date | null; end: Date } {
  const now = new Date();
  const end = startOfDay(now);
  end.setDate(end.getDate() + 1); // end of today

  if (range.preset === "custom" && range.start) {
    const s = new Date(range.start + "T00:00:00");
    const e = range.end ? new Date(range.end + "T23:59:59.999") : end;
    return { start: s, end: e };
  }

  const days: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "1mo": 30 };
  const numDays = days[range.preset] ?? 1;
  const start = startOfDay(now);
  start.setDate(start.getDate() - numDays + 1);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTimeRange(): TimeRangeResult {
  const [range, setRange] = useState<TimeRange>(() => {
    const stored = getStorageJSON<TimeRange>(STORAGE_KEYS.OVERVIEW_TIME_RANGE);
    if (stored && typeof stored.preset === "string") {
      const validPresets = ["1d", "3d", "7d", "1mo", "custom"];
      if (validPresets.includes(stored.preset)) return stored;
    }
    return DEFAULT_RANGE;
  });

  // Sync to localStorage when range changes
  useEffect(() => {
    setStorageJSON(STORAGE_KEYS.OVERVIEW_TIME_RANGE, range);
  }, [range]);

  const { start: startDate, end: endDate } = useMemo(() => resolveDates(range), [range]);
  const label = useMemo(() => rangeLabel(range), [range]);

  const setPreset = useCallback((preset: TimeRangePreset) => {
    setRange({ preset });
  }, []);

  const setCustomRange = useCallback((start: string, end: string) => {
    setRange({ preset: "custom", start, end });
  }, []);

  return { range, startDate, endDate, label, setPreset, setCustomRange };
}
