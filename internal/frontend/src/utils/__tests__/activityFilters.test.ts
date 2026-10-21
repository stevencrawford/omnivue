import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVITY_FILTERS,
  isActivityKindVisible,
  loadActivityFilters,
  saveActivityFilters,
  type ActivityFilters,
} from "../activityFilters";
import { STORAGE_KEYS } from "../storageKeys";

describe("activityFilters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns every kind enabled when nothing is stored", () => {
    expect(loadActivityFilters()).toEqual(DEFAULT_ACTIVITY_FILTERS);
  });

  it("round-trips a saved selection", () => {
    const filters: ActivityFilters = { user: true, assistant: false, thinking: true, tool: false };
    saveActivityFilters(filters);
    expect(loadActivityFilters()).toEqual(filters);
    expect(isActivityKindVisible("assistant", filters)).toBe(false);
    expect(isActivityKindVisible("thinking", filters)).toBe(true);
  });

  it("defaults missing fields to visible", () => {
    localStorage.setItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS, JSON.stringify({ tool: false }));
    expect(loadActivityFilters()).toEqual({
      user: true,
      assistant: true,
      thinking: true,
      tool: false,
    });
  });

  it("ignores non-boolean values", () => {
    localStorage.setItem(
      STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS,
      JSON.stringify({ user: "no", assistant: false }),
    );
    expect(loadActivityFilters()).toEqual({
      user: true,
      assistant: false,
      thinking: true,
      tool: true,
    });
  });

  it("falls back to all enabled when the stored value is malformed", () => {
    localStorage.setItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS, "{not json");
    expect(loadActivityFilters()).toEqual(DEFAULT_ACTIVITY_FILTERS);
  });
});
