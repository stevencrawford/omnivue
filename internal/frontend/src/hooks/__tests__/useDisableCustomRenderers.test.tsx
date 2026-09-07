import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setDisableCustomRenderers, useDisableCustomRenderers } from "../useDisableCustomRenderers";
import { STORAGE_KEYS } from "../../utils/storageKeys";

describe("useDisableCustomRenderers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to false", () => {
    const { result } = renderHook(() => useDisableCustomRenderers());
    expect(result.current).toBe(false);
  });

  it("reads a persisted preference", () => {
    localStorage.setItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS, "true");
    const { result } = renderHook(() => useDisableCustomRenderers());
    expect(result.current).toBe(true);
  });

  it("updates live when the preference is toggled", () => {
    const { result } = renderHook(() => useDisableCustomRenderers());
    expect(result.current).toBe(false);
    act(() => {
      setDisableCustomRenderers(true);
    });
    expect(result.current).toBe(true);
    act(() => {
      setDisableCustomRenderers(false);
    });
    expect(result.current).toBe(false);
  });
});
