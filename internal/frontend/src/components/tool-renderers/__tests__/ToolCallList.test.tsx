import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ToolCallList } from "../ToolCallList";
import { bookmarkRefKey } from "../../../hooks/useBookmarks";
import type { ToolCall } from "../../../hooks/types";

vi.mock("../../../hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToSession: () => {} }),
}));

const tool: ToolCall = {
  id: "tc-1",
  name: "bash",
  input: "{}",
  output: "out",
  status: "success",
  messageId: "msg-7",
};

function renderList(bookmarkIdByRef?: Record<string, string>) {
  return render(
    <ToolCallList
      toolCalls={[tool]}
      agent={undefined}
      variant="summary"
      sessionId="s1"
      onBookmark={() => {}}
      bookmarkIdByRef={bookmarkIdByRef}
    />,
  );
}

describe("ToolCallList bookmark fill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fills the bookmark icon when a Position-keyed bookmark exists", () => {
    renderList({ [bookmarkRefKey("s1", "msg-7", "tc-1")]: "bm-1" });
    expect(screen.getByTitle("Remove bookmark")).toBeDefined();
    expect(screen.queryByTitle("Bookmark")).toBeNull();
  });

  it("does not fill the bookmark icon when the Position-keyed bookmark is absent", () => {
    renderList({});
    expect(screen.getByTitle("Bookmark")).toBeDefined();
    expect(screen.queryByTitle("Remove bookmark")).toBeNull();
  });

  it("does not match a legacy messageIndex-keyed bookmark", () => {
    renderList({ "s1:0:tc-1": "bm-legacy" });
    expect(screen.getByTitle("Bookmark")).toBeDefined();
    expect(screen.queryByTitle("Remove bookmark")).toBeNull();
  });
});
