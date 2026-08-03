import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolActionsBar } from "../ToolActionsBar";
import type { ToolCall } from "../../../hooks/types";

const tool: ToolCall = {
  id: "1",
  name: "bash",
  input: "{}",
  output: "hello world",
  status: "success",
};

describe("ToolActionsBar", () => {
  it("shows the screenshot button when explicit markdown content is provided", () => {
    render(
      <ToolActionsBar
        tool={tool}
        showPin
        pinText="# hello"
        onPin={() => {}}
        screenshotText="# hello"
      />,
    );
    expect(screen.getByTitle("Screenshot")).toBeDefined();
    expect(screen.getByTitle("Pin as scratch note")).toBeDefined();
  });

  it("does not show a screenshot button for raw (possibly truncated) tool output", () => {
    render(<ToolActionsBar tool={tool} showPin onPin={() => {}} />);
    expect(screen.queryByTitle("Screenshot")).toBeNull();
    expect(screen.getByTitle("Pin as scratch note")).toBeDefined();
  });

  it("hides pin and screenshot when onPin is not provided", () => {
    render(<ToolActionsBar tool={tool} showPin />);
    expect(screen.queryByTitle("Screenshot")).toBeNull();
    expect(screen.queryByTitle("Pin as scratch note")).toBeNull();
  });
});
