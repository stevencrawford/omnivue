import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppKeyboard, type AppKeyboardConfig } from "../useAppKeyboard";

const baseConfig = (overrides: Partial<AppKeyboardConfig> = {}): AppKeyboardConfig => ({
  sessions: [],
  activeSessionId: null,
  searchOpen: false,
  drawerOpen: false,
  searchHighlightQuery: null,
  setSearchOpen: vi.fn(),
  setSearchSessionScope: vi.fn(),
  setDrawerOpen: vi.fn(),
  setDrawerResults: vi.fn(),
  setSidebarOpen: vi.fn(),
  setActiveTab: vi.fn(),
  clearSearchHighlight: vi.fn(),
  setShowOverview: vi.fn(),
  navigateSession: vi.fn(),
  onOpenShortcuts: vi.fn(),
  ...overrides,
});

const pressEscape = (target: EventTarget = window) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

describe("useAppKeyboard — Escape", () => {
  it("closes the search drawer first", () => {
    const setDrawerOpen = vi.fn();
    const setDrawerResults = vi.fn();
    renderHook(() =>
      useAppKeyboard(baseConfig({ drawerOpen: true, setDrawerOpen, setDrawerResults })),
    );

    pressEscape();

    expect(setDrawerOpen).toHaveBeenCalledWith(false);
    expect(setDrawerResults).toHaveBeenCalledWith([]);
  });

  it("closes the search panel when the drawer is closed", () => {
    const setSearchOpen = vi.fn();
    renderHook(() => useAppKeyboard(baseConfig({ searchOpen: true, setSearchOpen })));

    pressEscape();

    expect(setSearchOpen).toHaveBeenCalledWith(false);
  });

  it("clears the search highlight last", () => {
    const clearSearchHighlight = vi.fn();
    renderHook(() =>
      useAppKeyboard(baseConfig({ searchHighlightQuery: "needle", clearSearchHighlight })),
    );

    pressEscape();

    expect(clearSearchHighlight).toHaveBeenCalledTimes(1);
  });
});
