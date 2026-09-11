import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditToolDiff } from "../builtin/EditToolDiff";
import type { ToolCall } from "../../../hooks/types";

const tool = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: "tc-1",
  name: "edit",
  input: JSON.stringify({ filePath: "src/a.ts", oldString: "old", newString: "new" }),
  output: "",
  status: "success",
  ...overrides,
});

describe("EditToolDiff", () => {
  it("renders the file name in summary variant", () => {
    render(<EditToolDiff tool={tool()} variant="summary" />);
    expect(screen.getByText("a.ts")).toBeDefined();
  });

  it("renders a structured hunk table for edit input", () => {
    render(<EditToolDiff tool={tool()} variant="detail" />);
    expect(screen.getByText(/^@@ -1,1 \+0,1 @@$/)).toBeDefined();
    expect(screen.getByText("old")).toBeDefined();
    expect(screen.getByText("new")).toBeDefined();
  });

  it("renders a unified diff supplied by the agent through the parser", () => {
    const input = JSON.stringify({
      filePath: "src/b.ts",
      newString: "@@ -1,2 +1,2 @@\n-a\n+b\n",
    });
    render(<EditToolDiff tool={tool({ input })} variant="detail" />);
    expect(screen.getByText("a")).toBeDefined();
    expect(screen.getByText("b")).toBeDefined();
  });
});
