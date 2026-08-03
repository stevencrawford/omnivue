import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownContent } from "../MarkdownContent";

const renderLog: string[] = [];

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    renderLog.push(children);
    return <div data-testid="markdown">{children}</div>;
  },
}));

describe("MarkdownContent oversized guard", () => {
  beforeEach(() => {
    renderLog.length = 0;
  });

  it("renders through ReactMarkdown for small content", () => {
    render(<MarkdownContent content="hello" hideCopy />);
    expect(renderLog).toEqual(["hello"]);
  });

  it("renders collapsed plain text instead of markdown for oversized content", () => {
    const big = "x".repeat(300 * 1024);
    render(<MarkdownContent content={big} hideCopy />);
    expect(renderLog).toHaveLength(0);
    expect(screen.getByText(/plain text/i)).toBeTruthy();
    expect(document.querySelector("pre")).toBeTruthy();
  });

  it("renders the oversized content as markdown only after the explicit action", () => {
    const big = "x".repeat(300 * 1024);
    render(<MarkdownContent content={big} hideCopy />);
    expect(renderLog).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /render as markdown/i }));

    expect(renderLog).toHaveLength(1);
    expect(renderLog[0]).toBe(big);
  });
});
