import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GrepToolDiff } from "../builtin/GrepToolDiff";
import type { ToolCall } from "../../../hooks/types";

vi.mock("../../../hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToSession: () => {} }),
}));

function grepTool(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "grep-1",
    name: "grep",
    input: JSON.stringify({ pattern: "TODO", path: "src", include: "*.ts" }),
    output: "src/a.ts:1: // TODO fix\nsrc/b.ts:2: // TODO test",
    status: "success",
    ...overrides,
  };
}

describe("GrepToolDiff", () => {
  it("detail is a collapsed card showing the input pattern but not the output", () => {
    const { container } = render(<GrepToolDiff tool={grepTool()} variant="detail" />);
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(container.textContent).toContain("src · *.ts");
    expect(container.textContent).not.toContain("src/a.ts:1: // TODO fix");
  });

  it("detail expands to show the output on click", () => {
    const { container } = render(<GrepToolDiff tool={grepTool()} variant="detail" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeDefined();
    expect(container.textContent).toContain("src/a.ts:1: // TODO fix");
  });

  it("detail shows the input header with no matches when there are no results", () => {
    const { container } = render(<GrepToolDiff tool={grepTool({ output: "" })} variant="detail" />);
    expect(screen.getByTitle("TODO")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(container.textContent).toContain("No matches");
  });

  it("detail renders nothing when both input and output are empty", () => {
    const { container } = render(
      <GrepToolDiff tool={grepTool({ input: "{}", output: "" })} variant="detail" />,
    );
    expect(container.textContent).toBe("");
  });

  it("summary shows the pattern", () => {
    render(<GrepToolDiff tool={grepTool()} variant="summary" />);
    expect(screen.getByTitle("TODO")).toBeDefined();
  });
});
