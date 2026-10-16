import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScratchFiles } from "../useScratchFiles";
import { createScratchFile } from "../apiClient";
import type { ScratchFile } from "../types";

vi.mock("../apiClient", () => ({
  createScratchFile: vi.fn(),
}));

function scratchFile(id: string, sessionId: string): ScratchFile {
  return {
    id,
    sessionId,
    title: "Note",
    content: "# Note",
    mode: "readonly",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("useScratchFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a read-only scratch file from pinned content", async () => {
    const f1 = scratchFile("f1", "s1");
    vi.mocked(createScratchFile).mockResolvedValue(f1);

    const { result } = renderHook(() => useScratchFiles("s1"));
    const created = await result.current.handlePinAsScratch("Title", "body");

    expect(createScratchFile).toHaveBeenCalledWith("s1", "Title", "body", "readonly");
    expect(created).toEqual(f1);
  });

  it("returns null without creating when there is no active session", async () => {
    const { result } = renderHook(() => useScratchFiles(null));
    const created = await result.current.handlePinAsScratch("Title", "body");

    expect(createScratchFile).not.toHaveBeenCalled();
    expect(created).toBeNull();
  });

  it("returns null when creation fails", async () => {
    vi.mocked(createScratchFile).mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useScratchFiles("s1"));
    const created = await result.current.handlePinAsScratch("Title", "body");

    expect(created).toBeNull();
  });
});
