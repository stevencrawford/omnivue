import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "../useTheme";
import { STORAGE_KEYS } from "../../utils/storageKeys";

function matchMediaStub(matches: boolean) {
  return () =>
    ({
      matches,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }) as unknown as MediaQueryList;
}

function renderTheme() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>{children}</ThemeProvider>
  );
  return renderHook(() => useTheme(), { wrapper });
}

describe("useTheme contrast", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a persisted high-contrast preference", () => {
    localStorage.setItem(STORAGE_KEYS.CONTRAST, "high");
    const { result } = renderTheme();
    expect(result.current.contrast).toBe("high");
  });

  it("respects a persisted default preference over the OS", () => {
    vi.stubGlobal("matchMedia", matchMediaStub(true));
    localStorage.setItem(STORAGE_KEYS.CONTRAST, "default");
    const { result } = renderTheme();
    expect(result.current.contrast).toBe("default");
  });

  it("defaults to high when the OS requests more contrast", () => {
    vi.stubGlobal("matchMedia", matchMediaStub(true));
    const { result } = renderTheme();
    expect(result.current.contrast).toBe("high");
  });

  it("defaults to standard when the OS does not request more contrast", () => {
    vi.stubGlobal("matchMedia", matchMediaStub(false));
    const { result } = renderTheme();
    expect(result.current.contrast).toBe("default");
  });

  it("updates contrast", () => {
    vi.stubGlobal("matchMedia", matchMediaStub(false));
    const { result } = renderTheme();
    expect(result.current.contrast).toBe("default");
    act(() => {
      result.current.setContrast("high");
    });
    expect(result.current.contrast).toBe("high");
    act(() => {
      result.current.setContrast("default");
    });
    expect(result.current.contrast).toBe("default");
  });
});
