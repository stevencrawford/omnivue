import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../SearchPanel";

vi.mock("../../hooks/apiClient", () => ({
  fetchSearch: vi.fn(),
}));

function renderPanel(overrides: {
  searchScope?: string | null;
  searchScopeName?: string | null;
  onClearScope?: () => void;
}) {
  const onClearScope = overrides.onClearScope ?? vi.fn();
  render(
    <SearchPanel
      query=""
      onQueryChange={() => {}}
      onSelectSession={() => {}}
      onOpenDrawer={() => {}}
      onClose={() => {}}
      searchScope={overrides.searchScope ?? null}
      searchScopeName={overrides.searchScopeName ?? null}
      onClearScope={onClearScope}
      recentSearches={[]}
      onClearRecentSearches={() => {}}
    />,
  );
  return { onClearScope };
}

describe("SearchPanel scope badge", () => {
  it("shows the current session badge when search is scoped", () => {
    renderPanel({ searchScope: "s1", searchScopeName: "my-session" });
    expect(screen.getByText("my-session")).toBeDefined();
  });

  it("dismisses the scope through the badge cross", () => {
    const { onClearScope } = renderPanel({ searchScope: "s1", searchScopeName: "my-session" });
    const badge = screen.getByText("my-session").closest("span");
    const dismiss = badge?.querySelector("button");
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss!);
    expect(onClearScope).toHaveBeenCalledTimes(1);
  });

  it("shows no badge when search is unscoped", () => {
    const { container } = render(
      <SearchPanel
        query=""
        onQueryChange={() => {}}
        onSelectSession={() => {}}
        onOpenDrawer={() => {}}
        onClose={() => {}}
        searchScope={null}
        searchScopeName={null}
        onClearScope={() => {}}
        recentSearches={[]}
        onClearRecentSearches={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("my-session");
  });
});
