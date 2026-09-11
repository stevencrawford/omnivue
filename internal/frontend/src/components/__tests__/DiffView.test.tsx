import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffView } from "../DiffView";
import { fetchEdits } from "../../hooks/apiClient";
import type { FileEdit } from "../../hooks/types";

vi.mock("../../hooks/apiClient", () => ({
  fetchEdits: vi.fn(),
}));

const edit = (overrides: Partial<FileEdit>): FileEdit =>
  ({
    filePath: "src/a.ts",
    toolName: "edit",
    oldStr: "",
    newStr: "",
    content: "",
    timestamp: "2024-01-01T00:00:00Z",
    messageIndex: 0,
    ...overrides,
  }) as FileEdit;

describe("DiffView", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    vi.mocked(fetchEdits).mockResolvedValue([
      edit({ filePath: "src/a.ts", oldStr: "line\n", newStr: "CHANGED\n" }),
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders the merged file tree and diff hunks from structured edits", async () => {
    render(<DiffView sessionId="s1" refreshKey={0} />);
    expect(await screen.findByText("a.ts")).toBeDefined();
    expect(await screen.findByText(/^@@ /)).toBeDefined();
    expect(screen.getByText("line")).toBeDefined();
    expect(screen.getByText("CHANGED")).toBeDefined();
  });

  it("shows an empty state when there are no edits", async () => {
    vi.mocked(fetchEdits).mockResolvedValue([]);
    render(<DiffView sessionId="s1" refreshKey={0} />);
    expect(await screen.findByText("No file changes in this session")).toBeDefined();
  });

  it("jumps to the owning message by stable message id", async () => {
    const onNavigateToMessage = vi.fn();
    vi.mocked(fetchEdits).mockResolvedValue([
      edit({
        filePath: "src/a.ts",
        oldStr: "line\n",
        newStr: "CHANGED\n",
        messageIndex: 3,
        messageId: "msg-42",
      }),
    ]);
    render(<DiffView sessionId="s1" refreshKey={0} onNavigateToMessage={onNavigateToMessage} />);
    const button = await screen.findByTitle("Jump to message #4");
    fireEvent.click(button);
    expect(onNavigateToMessage).toHaveBeenCalledWith(3, "msg-42");
  });

  it("still links an edit whose index was omitted but carries a message id", async () => {
    const onNavigateToMessage = vi.fn();
    vi.mocked(fetchEdits).mockResolvedValue([
      edit({
        filePath: "src/a.ts",
        oldStr: "line\n",
        newStr: "CHANGED\n",
        messageIndex: undefined,
        messageId: "msg-0",
      }),
    ]);
    render(<DiffView sessionId="s1" refreshKey={0} onNavigateToMessage={onNavigateToMessage} />);
    const button = await screen.findByRole("button", { name: /Message/ });
    fireEvent.click(button);
    expect(onNavigateToMessage).toHaveBeenCalledWith(-1, "msg-0");
  });
});
