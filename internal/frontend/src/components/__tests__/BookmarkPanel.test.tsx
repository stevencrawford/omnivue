import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookmarkPanel } from "../BookmarkPanel";
import type { Bookmark, Session } from "../../hooks/types";

const session: Session = {
  id: "s-1",
  sourceId: "src-1",
  title: "My session",
  repository: "omnivue",
  branch: "main",
  agent: "opencode",
  model: "gpt-4o",
  cost: 0.1,
  directory: "/repo",
  status: "done",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  tokensInput: 100,
  tokensOutput: 200,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  messageCount: 10,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
};

const messageBookmark: Bookmark = {
  id: "bm-msg",
  sessionId: "s-1",
  messageId: "m-2",
  toolCallId: "",
  label: "Fix sidebar",
  kind: "message",
  createdAt: "2024-01-02T00:00:00Z",
};

const planBookmark: Bookmark = {
  id: "bm-plan",
  sessionId: "s-1",
  label: "Implementation plan",
  kind: "plan",
  createdAt: "2024-01-03T00:00:00Z",
};

function renderPanel(bookmarks: Bookmark[]) {
  const onBookmarkSelect = vi.fn();
  const onBookmarkDelete = vi.fn();
  const renderResult = render(
    <BookmarkPanel
      bookmarks={bookmarks}
      sessions={[session]}
      onBookmarkSelect={onBookmarkSelect}
      onBookmarkDelete={onBookmarkDelete}
    />,
  );
  return { ...renderResult, onBookmarkSelect, onBookmarkDelete };
}

describe("BookmarkPanel", () => {
  it("shows both message and plan bookmarks by default", () => {
    renderPanel([messageBookmark, planBookmark]);
    expect(screen.getByText("Fix sidebar")).toBeDefined();
    expect(screen.getByText("Implementation plan")).toBeDefined();
  });

  it("uses a speech bubble icon for message bookmarks and a todo icon for plans", () => {
    const { container } = renderPanel([messageBookmark, planBookmark]);
    expect(container.querySelector(".lucide-message-square-text")).not.toBeNull();
    expect(container.querySelector(".lucide-list-todo")).not.toBeNull();
  });

  it("filters to plans only when the type filter is set to Plans", async () => {
    const user = userEvent.setup();
    renderPanel([messageBookmark, planBookmark]);
    await user.click(screen.getByRole("button", { name: /Type: All Types/ }));
    await user.click(screen.getByRole("button", { name: "Plans" }));
    expect(screen.queryByText("Fix sidebar")).toBeNull();
    expect(screen.getByText("Implementation plan")).toBeDefined();
  });

  it("passes the full bookmark when a row is selected", async () => {
    const user = userEvent.setup();
    const { onBookmarkSelect } = renderPanel([messageBookmark, planBookmark]);
    await user.click(screen.getByText("Implementation plan"));
    expect(onBookmarkSelect).toHaveBeenCalledWith(planBookmark);
  });

  it("deletes a bookmark by id", async () => {
    const user = userEvent.setup();
    const { onBookmarkDelete } = renderPanel([messageBookmark, planBookmark]);
    await user.click(screen.getAllByTitle("Remove bookmark")[0]);
    expect(onBookmarkDelete).toHaveBeenCalledWith("bm-msg");
  });
});
