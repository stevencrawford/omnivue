import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanPanel } from "../PlanPanel";
import type { Session } from "../../../hooks/types";

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

describe("PlanPanel bookmarks", () => {
  it("bookmarks the plan with kind plan", () => {
    const onBookmark = vi.fn();
    render(
      <PlanPanel
        session={session}
        plan={{ markdown: "# My plan", source: "test" }}
        onBookmark={onBookmark}
        bookmarkIdByRef={{}}
      />,
    );
    fireEvent.click(screen.getByTitle("Bookmark"));
    expect(onBookmark).toHaveBeenCalledWith("s1", "__plan__", undefined, "Plan", "plan");
  });

  it("shows filled bookmark state for the plan", () => {
    render(
      <PlanPanel
        session={session}
        plan={{ markdown: "# My plan", source: "test" }}
        onBookmark={() => {}}
        bookmarkIdByRef={{ "s1:__plan__:": "bm-plan" }}
      />,
    );
    expect(screen.getByTitle("Remove bookmark")).toBeDefined();
  });

  it("hides bookmark buttons when onBookmark is not provided", () => {
    render(<PlanPanel session={session} plan={{ markdown: "# My plan", source: "test" }} />);
    expect(screen.queryByTitle("Bookmark")).toBeNull();
    expect(screen.queryByTitle("Remove bookmark")).toBeNull();
  });

  it("shows an empty state when there is no plan", () => {
    render(<PlanPanel session={session} plan={null} />);
    expect(screen.getByText("No plan for this session yet")).toBeDefined();
  });
});
