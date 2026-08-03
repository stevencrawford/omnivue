import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownScreenshotButton } from "../MarkdownScreenshotButton";

describe("MarkdownScreenshotButton", () => {
  it("renders a camera button labelled Screenshot", () => {
    render(<MarkdownScreenshotButton content="# hello" title="Proposed Plan" />);
    const btn = screen.getByTitle("Screenshot");
    expect(btn).toBeDefined();
  });

  it("does not open the capture window until clicked", () => {
    const { container } = render(<MarkdownScreenshotButton content="# hello" />);
    expect(container.querySelector("[data-screenshot-window]")).toBeNull();
  });
});
