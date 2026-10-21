import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotificationDrawer } from "../NotificationDrawer";
import { STORAGE_KEYS } from "../../../utils/storageKeys";
import { setDisableCustomRenderers } from "../../../hooks/useDisableCustomRenderers";
import type { Message, Session, ToolCall } from "../../../hooks/types";

// jsdom has no ResizeObserver; the drawer observes the activity list to keep the
// scroll controls in sync. A no-op stub is enough for the tests below.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("../../../hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToSession: () => {} }),
}));

const grepTool: ToolCall = {
  id: "grep-1",
  name: "grep",
  input: JSON.stringify({ pattern: "TODO" }),
  output: "src/a.ts:1: // TODO fix",
  status: "success",
};

const messages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    toolCalls: [grepTool],
  },
];

const session: Session = {
  id: "s1",
  sourceId: "src-1",
  title: "test",
  repository: "repo",
  branch: "main",
  agent: "opencode",
  model: "m",
  cost: 0,
  directory: "/tmp",
  status: "idle",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  tokensInput: 0,
  tokensOutput: 0,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  messageCount: 1,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
};

function renderDrawer() {
  return render(
    <NotificationDrawer session={session} messages={messages} cursor={0} maxIndex={0} />,
  );
}

describe("NotificationDrawer bookmarks", () => {
  const taskCompleteTool: ToolCall = {
    id: "tc-1",
    name: "task_complete",
    input: JSON.stringify({ summary: "Done thing" }),
    output: "",
    status: "success",
  };
  const exitPlanTool: ToolCall = {
    id: "ep-1",
    name: "exit_plan_mode",
    input: JSON.stringify({ summary: "My plan" }),
    output: "",
    status: "success",
  };
  const questionTool: ToolCall = {
    id: "q-1",
    name: "question",
    input: JSON.stringify({
      questions: [{ question: "Which?", header: "Which?", options: [{ label: "A" }] }],
    }),
    output: "",
    status: "success",
  };

  it("bookmarks assistant message content from the header button", () => {
    const onBookmark = vi.fn();
    const msgs: Message[] = [
      {
        id: "msg-assist",
        role: "assistant",
        content: "Hello world assistant response",
        timestamp: "2026-01-01T00:00:00Z",
        toolCalls: [],
      },
    ];
    render(
      <NotificationDrawer
        session={session}
        messages={msgs}
        cursor={10}
        maxIndex={10}
        onBookmark={onBookmark}
        bookmarkIdByRef={{}}
      />,
    );
    fireEvent.click(screen.getByTitle("Bookmark"));
    expect(onBookmark).toHaveBeenCalledTimes(1);
    expect(onBookmark).toHaveBeenCalledWith(
      "s1",
      "msg-assist",
      undefined,
      "Hello world assistant response",
    );
  });

  it("shows filled bookmark state for assistant messages", () => {
    const msgs: Message[] = [
      {
        id: "msg-assist",
        role: "assistant",
        content: "Hello world",
        timestamp: "2026-01-01T00:00:00Z",
        toolCalls: [],
      },
    ];
    render(
      <NotificationDrawer
        session={session}
        messages={msgs}
        cursor={10}
        maxIndex={10}
        onBookmark={() => {}}
        bookmarkIdByRef={{ "s1:msg-assist:": "bm-1" }}
      />,
    );
    expect(screen.getByTitle("Remove bookmark")).toBeDefined();
  });

  it("bookmarks task_complete, exit_plan_mode, and question tools", () => {
    const onBookmark = vi.fn();
    const msgs: Message[] = [
      {
        id: "msg-tools",
        role: "assistant",
        content: "",
        timestamp: "2026-01-01T00:00:00Z",
        toolCalls: [taskCompleteTool, exitPlanTool, questionTool],
      },
    ];
    render(
      <NotificationDrawer
        session={session}
        messages={msgs}
        cursor={10}
        maxIndex={10}
        onBookmark={onBookmark}
        bookmarkIdByRef={{}}
      />,
    );
    const buttons = screen.getAllByTitle("Bookmark");
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(onBookmark).toHaveBeenCalledWith("s1", "msg-tools", "tc-1", expect.any(String));
    fireEvent.click(buttons[1]);
    expect(onBookmark).toHaveBeenCalledWith("s1", "msg-tools", "ep-1", expect.any(String));
    fireEvent.click(buttons[2]);
    expect(onBookmark).toHaveBeenCalledWith("s1", "msg-tools", "q-1", expect.any(String));
  });

  it("does not offer bookmarks for non-bookmarkable tool kinds", () => {
    const onBookmark = vi.fn();
    render(
      <NotificationDrawer
        session={session}
        messages={messages}
        cursor={10}
        maxIndex={10}
        onBookmark={onBookmark}
        bookmarkIdByRef={{}}
      />,
    );
    expect(screen.queryByTitle("Bookmark")).toBeNull();
    expect(screen.queryByTitle("Remove bookmark")).toBeNull();
  });

  it("bookmarks the plan from the plan tab with kind plan", () => {
    const onBookmark = vi.fn();
    render(
      <NotificationDrawer
        session={session}
        messages={[]}
        cursor={0}
        maxIndex={0}
        plan={{ markdown: "# My plan", source: "test" }}
        activeTab="plan"
        onBookmark={onBookmark}
        bookmarkIdByRef={{}}
      />,
    );
    fireEvent.click(screen.getByTitle("Bookmark"));
    expect(onBookmark).toHaveBeenCalledWith("s1", "__plan__", undefined, "Plan", "plan");
  });

  it("shows filled bookmark state for the plan tab", () => {
    render(
      <NotificationDrawer
        session={session}
        messages={[]}
        cursor={0}
        maxIndex={0}
        plan={{ markdown: "# My plan", source: "test" }}
        activeTab="plan"
        onBookmark={() => {}}
        bookmarkIdByRef={{ "s1:__plan__:": "bm-plan" }}
      />,
    );
    expect(screen.getByTitle("Remove bookmark")).toBeDefined();
  });

  it("hides all bookmark buttons when onBookmark is not provided", () => {
    const msgs: Message[] = [
      {
        id: "msg-assist",
        role: "assistant",
        content: "Hello world",
        timestamp: "2026-01-01T00:00:00Z",
        toolCalls: [taskCompleteTool],
      },
    ];
    render(
      <NotificationDrawer
        session={session}
        messages={msgs}
        cursor={10}
        maxIndex={10}
        plan={{ markdown: "# My plan", source: "test" }}
        activeTab="plan"
      />,
    );
    expect(screen.queryByTitle("Bookmark")).toBeNull();
    expect(screen.queryByTitle("Remove bookmark")).toBeNull();
  });
});

describe("NotificationDrawer jump landing", () => {
  const scrollIntoView = vi.fn();
  beforeAll(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => scrollIntoView.mockClear());

  const jumpMessages: Message[] = [
    { id: "m0", role: "assistant", content: "zero", timestamp: "2026-01-01T00:00:00Z" },
    { id: "m1", role: "assistant", content: "one", timestamp: "2026-01-01T00:00:01Z" },
    { id: "m2", role: "assistant", content: "two", timestamp: "2026-01-01T00:00:02Z" },
  ];

  function renderJump(spotlightId: string | null, jumpKey: number) {
    return render(
      <NotificationDrawer
        session={session}
        messages={jumpMessages}
        cursor={0}
        maxIndex={2}
        spotlightId={spotlightId}
        jumpKey={jumpKey}
      />,
    );
  }

  it("scrolls to a message that sits outside the cursor window", () => {
    renderJump("m2", 1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("lands on each successive jump even though the focus key restarts at 1", () => {
    const { rerender } = renderJump("m1", 1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Landing leaves focus active (the spotlight keeps the message visible);
    // the owner clears it when the user scrubs, resetting the key to 0.
    rerender(
      <NotificationDrawer
        session={session}
        messages={jumpMessages}
        cursor={0}
        maxIndex={2}
        spotlightId={null}
        jumpKey={0}
      />,
    );
    rerender(
      <NotificationDrawer
        session={session}
        messages={jumpMessages}
        cursor={0}
        maxIndex={2}
        spotlightId="m2"
        jumpKey={1}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("NotificationDrawer raw fallback", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS);
  });

  it("renders the custom grep renderer by default", () => {
    const { container } = renderDrawer();
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
    expect(container.textContent).not.toContain("src/a.ts:1: // TODO fix");
  });

  it("renders a collapsed raw summary card when custom renderers are disabled", () => {
    localStorage.setItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS, "true");
    const { container } = renderDrawer();
    // Summary header visible, detail hidden — like the legacy view.
    expect(screen.getByText("grep:")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
    expect(container.textContent).not.toContain("src/a.ts:1: // TODO fix");
    expect(screen.queryByTitle("TODO")).toBeNull();
    // Expanding reveals the raw input/output detail.
    fireEvent.click(screen.getByText("grep:").closest("button")!);
    expect(screen.getByText("Input")).toBeDefined();
    expect(screen.getByText("Output")).toBeDefined();
    expect(container.textContent).toContain("src/a.ts:1: // TODO fix");
  });

  it("switches to the raw view live when the preference is toggled", () => {
    const { container } = renderDrawer();
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
    act(() => {
      setDisableCustomRenderers(true);
    });
    expect(screen.getByText("grep:")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
    expect(screen.queryByTitle("TODO")).toBeNull();
    expect(container.textContent).not.toContain("src/a.ts:1: // TODO fix");
    act(() => {
      setDisableCustomRenderers(false);
    });
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
  });
});

describe("NotificationDrawer scroll controls", () => {
  // Renders the drawer, then pins the activity list's geometry and scroll
  // offset so a scroll event reveals the floating top/bottom controls.
  function scrollDrawer(top: number) {
    const { container } = render(
      <NotificationDrawer session={session} messages={messages} cursor={10} maxIndex={10} />,
    );
    const item = container.querySelector("[data-message-index]") as HTMLElement;
    const scrollEl = item.parentElement as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", {
      value: top,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "scrollTo", {
      value: scrollTo,
      writable: true,
      configurable: true,
    });
    act(() => {
      fireEvent.scroll(scrollEl);
    });
    return { scrollTo };
  }

  it("shows the top and bottom controls once the activity list is scrolled", () => {
    scrollDrawer(500);
    expect(screen.getByTitle("Scroll to top")).toBeDefined();
    expect(screen.getByTitle("Scroll to bottom")).toBeDefined();
  });

  it("hides the controls while the activity list is not scrollable", () => {
    render(<NotificationDrawer session={session} messages={messages} cursor={0} maxIndex={0} />);
    expect(screen.queryByTitle("Scroll to top")).toBeNull();
    expect(screen.queryByTitle("Scroll to bottom")).toBeNull();
  });

  it("scrolls to the top and bottom on click", () => {
    const { scrollTo } = scrollDrawer(500);
    fireEvent.click(screen.getByTitle("Scroll to top"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    fireEvent.click(screen.getByTitle("Scroll to bottom"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });
});

describe("NotificationDrawer activity filters", () => {
  const filterMessages: Message[] = [
    {
      id: "u1",
      role: "user",
      content: "User prompt text",
      timestamp: "2026-01-01T00:00:00Z",
    },
    {
      id: "a1",
      role: "assistant",
      content: "Assistant reply text",
      reasoning: "Weighing options",
      reasoningAt: "2026-01-01T00:00:02Z",
      timestamp: "2026-01-01T00:00:01Z",
      toolCalls: [grepTool],
    },
  ];

  function renderFilterDrawer() {
    return render(
      <NotificationDrawer session={session} messages={filterMessages} cursor={10} maxIndex={10} />,
    );
  }

  function openFilters() {
    fireEvent.click(screen.getByRole("button", { name: /filter activity/i }));
  }

  function expectAllKindsVisible() {
    expect(screen.getByText("User prompt text")).toBeDefined();
    expect(screen.getByText("Assistant reply text")).toBeDefined();
    expect(screen.getByText("Thinking")).toBeDefined();
    expect(screen.getByTitle("TODO")).toBeDefined();
  }

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS);
  });

  it("shows every activity kind by default", () => {
    renderFilterDrawer();
    expectAllKindsVisible();
  });

  it("hides only the unchecked kind", () => {
    renderFilterDrawer();
    openFilters();
    fireEvent.click(screen.getByLabelText("Tool calls"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTitle("TODO")).toBeNull();
    expect(screen.getByText("User prompt text")).toBeDefined();
    expect(screen.getByText("Assistant reply text")).toBeDefined();
    expect(screen.getByText("Thinking")).toBeDefined();
  });

  it("shows the filtered empty state and restores everything with Show all", () => {
    renderFilterDrawer();
    openFilters();
    for (const label of ["User messages", "Assistant messages", "Thinking", "Tool calls"]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByText("No activity matches the current filters")).toBeDefined();
    fireEvent.click(screen.getByText("Show all"));
    fireEvent.keyDown(document, { key: "Escape" });
    expectAllKindsVisible();
  });

  it("persists the selection", () => {
    renderFilterDrawer();
    openFilters();
    fireEvent.click(screen.getByLabelText("Tool calls"));
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS) ?? "{}"),
    ).toMatchObject({ user: true, assistant: true, thinking: true, tool: false });
  });

  it("honours a stored partial selection on first render", () => {
    localStorage.setItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS, JSON.stringify({ tool: false }));
    renderFilterDrawer();
    expect(screen.queryByTitle("TODO")).toBeNull();
    expect(screen.getByText("Assistant reply text")).toBeDefined();
    expect(screen.getByText("Thinking")).toBeDefined();
    expect(screen.getByText("User prompt text")).toBeDefined();
  });
});
