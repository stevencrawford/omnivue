import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScratchFiles } from "../useScratchFiles";
import { fetchAllScratchFiles } from "../apiClient";
import type { ScratchFile, Session } from "../types";

vi.mock("../apiClient", () => ({
  fetchAllScratchFiles: vi.fn(),
  createScratchFile: vi.fn(),
  renameScratchFile: vi.fn(),
  ApiError: class ApiError extends Error {
    status = 0;
    endpoint = "";
    constructor(message: string, status: number, endpoint: string) {
      super(message);
      this.status = status;
      this.endpoint = endpoint;
    }
  },
}));

function scratchFile(id: string, sessionId: string): ScratchFile {
  return {
    id,
    sessionId,
    title: "Note",
    content: "# Note",
    mode: "writable",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function session(id: string): Session {
  return { id, title: id } as unknown as Session;
}

function renderScratch(sessions: Session[], activeSessionId: string | null) {
  return renderHook(
    (props: { sessions: Session[]; activeSessionId: string | null }) =>
      useScratchFiles(
        props.sessions,
        props.activeSessionId,
        "session",
        props.sessions.find((s) => s.id === props.activeSessionId) ?? null,
        () => {},
      ),
    { initialProps: { sessions, activeSessionId } },
  );
}

describe("useScratchFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens scratch tabs for a deep-linked session once its files load", async () => {
    const s1 = session("s1");
    const f1 = scratchFile("f1", "s1");
    let resolveFiles!: (files: ScratchFile[]) => void;
    vi.mocked(fetchAllScratchFiles).mockReturnValue(
      new Promise<ScratchFile[]>((resolve) => {
        resolveFiles = resolve;
      }),
    );

    const { result, rerender } = renderScratch([], null);
    // A deep link (mac app) hydrates the session id before the fetch resolves.
    rerender({ sessions: [s1], activeSessionId: "s1" });
    expect(result.current.openScratchTabs).toEqual([]);

    await act(async () => {
      resolveFiles([f1]);
    });
    expect(result.current.openScratchTabs).toEqual(["f1"]);
  });

  it("opens scratch tabs when a session with loaded files becomes active", async () => {
    const s1 = session("s1");
    const f1 = scratchFile("f1", "s1");
    vi.mocked(fetchAllScratchFiles).mockResolvedValue([f1]);

    const { result, rerender } = renderScratch([], null);
    await act(async () => {});
    rerender({ sessions: [s1], activeSessionId: "s1" });
    expect(result.current.openScratchTabs).toEqual(["f1"]);
  });

  it("does not re-open a closed tab on an unrelated file change", async () => {
    const s1 = session("s1");
    const s2 = session("s2");
    const f1 = scratchFile("f1", "s1");
    const f2 = scratchFile("f2", "s2");
    vi.mocked(fetchAllScratchFiles).mockResolvedValue([f1]);

    const { result, rerender } = renderScratch([s1], "s1");
    await act(async () => {});
    expect(result.current.openScratchTabs).toEqual(["f1"]);

    act(() => result.current.handleCloseScratchTab("f1"));
    expect(result.current.openScratchTabs).toEqual([]);

    // A new file appears for another session — must not resurrect the closed tab.
    vi.mocked(fetchAllScratchFiles).mockResolvedValue([f1, f2]);
    rerender({ sessions: [s1, s2], activeSessionId: "s1" });
    await act(async () => {
      await result.current.loadScratchFiles();
    });
    expect(result.current.openScratchTabs).toEqual([]);
  });

  it("re-opens all scratch tabs when returning to a previously-visited session", async () => {
    const s1 = session("s1");
    const s2 = session("s2");
    const f1 = scratchFile("f1", "s1");
    vi.mocked(fetchAllScratchFiles).mockResolvedValue([f1]);

    const { result, rerender } = renderScratch([s1], "s1");
    await act(async () => {});
    expect(result.current.openScratchTabs).toEqual(["f1"]);

    act(() => result.current.handleCloseScratchTab("f1"));
    expect(result.current.openScratchTabs).toEqual([]);

    rerender({ sessions: [s1, s2], activeSessionId: "s2" });
    expect(result.current.openScratchTabs).toEqual([]);

    rerender({ sessions: [s1, s2], activeSessionId: "s1" });
    expect(result.current.openScratchTabs).toEqual(["f1"]);
  });
});
