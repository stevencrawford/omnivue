import { render, screen } from "@testing-library/react";
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
  it("detail shows the input pattern, scope, and labeled results", () => {
    const { container } = render(<GrepToolDiff tool={grepTool()} variant="detail" />);
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(screen.getByText("Results")).toBeDefined();
    expect(container.textContent).toContain("src/a.ts:1: // TODO fix");
    expect(container.textContent).toContain("src · *.ts");
  });

  it("detail shows the input header even when there are no results", () => {
    const { container } = render(<GrepToolDiff tool={grepTool({ output: "" })} variant="detail" />);
    expect(screen.getByTitle("TODO")).toBeDefined();
    expect(screen.queryByText("Results")).toBeNull();
    expect(container.textContent).not.toContain("src/a.ts");
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
