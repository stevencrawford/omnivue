import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { SessionListSettingsProvider, useSessionListSettings } from "../useSessionListSettings";
import * as api from "../apiClient";

vi.mock("../apiClient", () => ({
  fetchConfig: vi.fn(),
  setConfig: vi.fn(),
}));

describe("useSessionListSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with defaults", () => {
    vi.mocked(api.fetchConfig).mockResolvedValue({});
    const { result } = renderHook(() => useSessionListSettings(), {
      wrapper: SessionListSettingsProvider,
    });
    expect(result.current.hideStale).toBe(true);
    expect(result.current.staleDays).toBe(7);
  });

  it("loads persisted values from config", async () => {
    vi.mocked(api.fetchConfig).mockResolvedValue({
      "sessions.hideStale": "false",
      "sessions.staleDays": "14",
    });
    const { result } = renderHook(() => useSessionListSettings(), {
      wrapper: SessionListSettingsProvider,
    });
    await waitFor(() => expect(result.current.hideStale).toBe(false));
    expect(result.current.staleDays).toBe(14);
  });

  it("falls back to defaults on malformed config", async () => {
    vi.mocked(api.fetchConfig).mockResolvedValue({
      "sessions.hideStale": "maybe",
      "sessions.staleDays": "abc",
    });
    const { result } = renderHook(() => useSessionListSettings(), {
      wrapper: SessionListSettingsProvider,
    });
    await waitFor(() => expect(result.current.staleDays).toBe(7));
    expect(result.current.hideStale).toBe(true);
  });

  it("persists hideStale changes to config", async () => {
    vi.mocked(api.fetchConfig).mockResolvedValue({});
    vi.mocked(api.setConfig).mockResolvedValue();
    const { result } = renderHook(() => useSessionListSettings(), {
      wrapper: SessionListSettingsProvider,
    });
    await waitFor(() => expect(api.fetchConfig).toHaveBeenCalled());
    act(() => result.current.setHideStale(false));
    expect(result.current.hideStale).toBe(false);
    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith("sessions.hideStale", "false"));
  });

  it("clamps staleDays to the allowed range", async () => {
    vi.mocked(api.fetchConfig).mockResolvedValue({});
    vi.mocked(api.setConfig).mockResolvedValue();
    const { result } = renderHook(() => useSessionListSettings(), {
      wrapper: SessionListSettingsProvider,
    });
    await waitFor(() => expect(api.fetchConfig).toHaveBeenCalled());
    act(() => result.current.setStaleDays(5000));
    expect(result.current.staleDays).toBe(365);
    act(() => result.current.setStaleDays(0));
    expect(result.current.staleDays).toBe(1);
  });
});
