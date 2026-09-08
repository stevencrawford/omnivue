import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolRendererWrapper } from "../ToolRendererWrapper";
import { GlobToolDiff } from "../builtin/GlobToolDiff";
import { toolRendererRegistry } from "../registry";
import { effectiveToolKind } from "../../../utils/toolDisplay";
import type { ToolCall } from "../../../hooks/types";

vi.mock("../../../hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToSession: () => {} }),
}));

function longTool(): ToolCall {
  const output = Array.from({ length: 60 }, (_, i) => `line-${i}`).join("\n");
  return {
    id: "glob-1",
    name: "glob",
    input: JSON.stringify({ pattern: "**/*.ts" }),
    output,
    status: "success",
  };
}

const renderer = {
  kind: "glob",
  names: ["glob"],
  Component: GlobToolDiff,
  display: { type: "expandable" as const },
};

describe("ToolRendererWrapper truncation", () => {
  it("detail shows Show all only for long output and toggles to Show less and back", () => {
    const { container } = render(
      <ToolRendererWrapper renderer={renderer} tool={longTool()} variant="detail" />,
    );
    expect(container.textContent).toContain("line-0");
    expect(container.textContent).not.toContain("line-59");
    fireEvent.click(screen.getByText("Show all"));
    expect(screen.getByText("Show less")).toBeDefined();
    expect(container.textContent).toContain("line-59");
    fireEvent.click(screen.getByText("Show less"));
    expect(screen.getByText("Show all")).toBeDefined();
    expect(container.textContent).not.toContain("line-59");
  });

  it("detail shows no toggle for short output", () => {
    render(
      <ToolRendererWrapper
        renderer={renderer}
        tool={{ ...longTool(), output: "a\nb" }}
        variant="detail"
      />,
    );
    expect(screen.queryByText("Show all")).toBeNull();
    expect(screen.queryByText("Show less")).toBeNull();
  });
});

describe("ToolRendererWrapper with self-contained grep card", () => {
  function longGrepTool(): ToolCall {
    const output = Array.from({ length: 60 }, (_, i) => `src/f${i}.ts:1: match`).join("\n");
    return {
      id: "grep-1",
      name: "grep",
      input: JSON.stringify({ pattern: "match" }),
      output,
      status: "success",
    };
  }

  it("registry opts grep out of system truncation", () => {
    expect(toolRendererRegistry.getRenderer("grep")?.truncateOutput).toBe(0);
  });

  it("detail renders no outer Show all even for long grep output — the inner card toggle owns disclosure", () => {
    const tool = longGrepTool();
    const renderer = toolRendererRegistry.getRenderer(effectiveToolKind(tool))!;
    const { container } = render(
      <ToolRendererWrapper renderer={renderer} tool={tool} variant="detail" />,
    );
    // Collapsed inner card: results hidden, no system toggle alongside it.
    expect(container.textContent).not.toContain("src/f59.ts:1: match");
    expect(screen.queryByText("Show all")).toBeNull();
    expect(screen.queryByText("Show less")).toBeNull();
    // The inner card expands to the full output (no system truncation).
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeDefined();
    expect(container.textContent).toContain("src/f59.ts:1: match");
    expect(screen.queryByText("Show all")).toBeNull();
    expect(screen.queryByText("Show less")).toBeNull();
  });
});
