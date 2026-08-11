import { render, screen } from "@testing-library/react";
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
});
