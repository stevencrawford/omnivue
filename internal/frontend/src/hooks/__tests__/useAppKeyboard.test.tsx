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

describe("useAppKeyboard — sub-agent back", () => {
  it("returns to the parent on Escape while a sub-agent is open", () => {
    const backToParent = vi.fn();
    renderHook(() => useAppKeyboard(baseConfig({ backToParent })));

    pressEscape();

    expect(backToParent).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Escape when no parent is available", () => {
    const backToParent = vi.fn();
    renderHook(() => useAppKeyboard(baseConfig({ backToParent: null })));

    pressEscape();

    expect(backToParent).not.toHaveBeenCalled();
  });

  it("defers Escape to an open dialog", () => {
    const backToParent = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    try {
      renderHook(() => useAppKeyboard(baseConfig({ backToParent })));
      pressEscape();
      expect(backToParent).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it("ignores Escape originating from a text input", () => {
    const backToParent = vi.fn();
    renderHook(() => useAppKeyboard(baseConfig({ backToParent })));
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      pressEscape(input);
      expect(backToParent).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });
});
