import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTabBar } from "../SessionTabBar";
import {
  loadActivityFilters,
  saveActivityFilters,
  type ActivityFilters,
} from "../../../utils/activityFilters";
import { STORAGE_KEYS } from "../../../utils/storageKeys";

function renderBar(onChange = vi.fn()) {
  return render(
    <SessionTabBar
      active="activity"
      onChange={onChange}
      activityFilters={{
        user: true,
        assistant: true,
        thinking: true,
        tool: true,
      }}
      onActivityFiltersChange={() => {}}
    />,
  );
}

describe("SessionTabBar", () => {
  it("renders the four workspace tabs", () => {
    renderBar();
    expect(screen.getByRole("tab", { name: "Prompt" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Diffs" })).toBeDefined();
  });

  it("marks the active tab selected", () => {
    renderBar();
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("false");
  });

  it("reports tab clicks", () => {
    const onChange = vi.fn();
    renderBar(onChange);
    fireEvent.click(screen.getByRole("tab", { name: "Diffs" }));
    expect(onChange).toHaveBeenCalledWith("diffs");
  });

  it("only shows the activity filter menu on the activity tab", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /filter activity/i })).toBeDefined();
  });
});

describe("SessionTabBar activity filters", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS);
  });

  function FilterHarness() {
    const [filters, setFilters] = useState<ActivityFilters>(loadActivityFilters);
    const handleChange = (next: ActivityFilters) => {
      setFilters(next);
      saveActivityFilters(next);
    };
    return (
      <SessionTabBar
        active="activity"
        onChange={() => {}}
        activityFilters={filters}
        onActivityFiltersChange={handleChange}
      />
    );
  }

  function openFilters() {
    fireEvent.click(screen.getByRole("button", { name: /filter activity/i }));
  }

  it("persists toggling a kind", () => {
    render(<FilterHarness />);
    openFilters();
    fireEvent.click(screen.getByLabelText("Tool calls"));
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS) ?? "{}"),
    ).toMatchObject({ user: true, assistant: true, thinking: true, tool: false });
  });

  it("honours a stored partial selection on first render", () => {
    localStorage.setItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS, JSON.stringify({ tool: false }));
    render(<FilterHarness />);
    expect(screen.getByRole("button", { name: /2 of 4|3 of 4/i })).toBeDefined();
  });
});
