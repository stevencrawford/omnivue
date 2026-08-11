import { useState } from "react";
import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionViewer } from "../SessionViewer";
import { fetchMessages } from "../../hooks/apiClient";
import type { Message, Session } from "../../hooks/types";

vi.mock("../../hooks/apiClient", () => ({
  fetchMessages: vi.fn(),
}));

vi.mock("../../hooks/useToast", () => {
  const showErrorToast = vi.fn();
  return { useToast: () => ({ showErrorToast }) };
});

vi.mock("../ConversationView", () => ({ ConversationView: () => null }));
vi.mock("../SessionHeader", () => ({ SessionHeader: () => null }));
vi.mock("../SessionTabBar", () => ({ SessionTabBar: () => null }));
vi.mock("../DiffView", () => ({ DiffView: () => null }));
vi.mock("../PlanView", () => ({ PlanView: () => null }));
vi.mock("../SessionSummary", () => ({ SessionSummary: () => null }));
vi.mock("../TodosView", () => ({ TodosView: () => null }));
vi.mock("../TerminalPanel", () => ({ TerminalPanel: () => null }));
vi.mock("../ScratchEditor", () => ({ ScratchEditor: () => null }));
vi.mock("../Modal", () => ({ Modal: () => null }));
vi.mock("../MarkdownContent", () => ({ MarkdownContent: () => null }));
vi.mock("../MarkdownScreenshotButton", () => ({ MarkdownScreenshotButton: () => null }));

function makeSession(): Session {
  return {
    id: "ses_a",
    sourceId: "src_1",
    title: "Session A",
    repository: "repo",
    branch: "main",
    agent: "opencode",
    model: "gpt-4o",
    cost: 0,
    directory: "/tmp",
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    messageCount: 0,
    diffFiles: 0,
    diffAdditions: 0,
    diffDeletions: 0,
  } as unknown as Session;
}

const msg = () => ({ id: "m1", role: "user", content: "hi" }) as unknown as Message;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function viewerElement(liveChangedIds: Set<string>, ack: (id: string) => void) {
  return (
    <SessionViewer
      session={makeSession()}
      liveChangedIds={liveChangedIds}
      ackSessionChange={ack}
      openScratchTabs={[]}
      scratchFileMap={{}}
      onCloseScratchTab={() => {}}
    />
  );
}

/** Mirrors App.tsx: ack removes the id from the live-changed set. */
function Harness({
  initialChanged,
  ack,
}: {
  initialChanged: Set<string>;
  ack: (id: string) => void;
}) {
  const [ids, setIds] = useState(initialChanged);
  return (
    <SessionViewer
      session={makeSession()}
      liveChangedIds={ids}
      ackSessionChange={(id) => {
        ack(id);
        setIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }}
      openScratchTabs={[]}
      scratchFileMap={{}}
      onCloseScratchTab={() => {}}
    />
  );
}

describe("SessionViewer live refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchMessages).mockReset();
    vi.mocked(fetchMessages).mockResolvedValue([msg()]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not ack a change during the initial load, then catches up after it resolves", async () => {
    const first = deferred<Message[]>();
    vi.mocked(fetchMessages).mockReturnValueOnce(first.promise);

    const ack = vi.fn();
    let changedIds = new Set<string>();
    const { rerender } = render(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    // Live change arrives while the deep-link transcript fetch is in flight.
    changedIds = new Set(["ses_a"]);
    rerender(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);
    expect(ack).not.toHaveBeenCalled();
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    // Initial load completes; the pending change must now trigger one reload.
    await act(async () => {
      first.resolve([msg()]);
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith("ses_a");
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });

  it("refetches once per burst after a live change and acks at reload time", async () => {
    const ack = vi.fn();
    let changedIds = new Set<string>();
    const { rerender } = render(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    changedIds = new Set(["ses_a"]);
    rerender(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();

    // A second burst within the window re-arms the same debounce.
    changedIds = new Set(["ses_a"]);
    rerender(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith("ses_a");
  });

  it("never reloads or acks while the initial fetch is still in flight", async () => {
    const first = deferred<Message[]>();
    vi.mocked(fetchMessages).mockReturnValueOnce(first.promise);

    const ack = vi.fn();
    let changedIds = new Set<string>();
    const { rerender, unmount } = render(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);

    changedIds = new Set(["ses_a"]);
    rerender(viewerElement(changedIds, ack));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve([]);
    });
    unmount();
  });

  it("the ack-triggered re-render no longer cancels the pending reload", async () => {
    const first = deferred<Message[]>();
    vi.mocked(fetchMessages).mockReturnValueOnce(first.promise);

    const ack = vi.fn();
    render(<Harness initialChanged={new Set(["ses_a"])} ack={ack} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();

    // Initial load completes; the pending change must now trigger one reload.
    await act(async () => {
      first.resolve([msg()]);
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(1);

    // Ack removed the id from the set; no further reload may fire.
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });
});
