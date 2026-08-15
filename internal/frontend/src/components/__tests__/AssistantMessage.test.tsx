import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantMessageView } from "../AssistantMessage";
import type { Message } from "../../hooks/types";

function msg(reasoning: string): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    reasoning,
    toolCalls: [],
    timestamp: "2026-01-01T00:00:00Z",
    agent: "main",
  } as Message;
}

const multiChunkReasoning = "p".repeat(400) + "\n\n" + "q".repeat(400) + "\n\n" + "r".repeat(400);

describe("AssistantMessageView ThinkingBlock", () => {
  it("collapses by default and shows the chunk count in the header", () => {
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" />);
    expect(screen.getByRole("button", { name: /Show thinking · 3/i })).toBeInTheDocument();
    expect(screen.queryByText(/Thinking 1/i)).not.toBeInTheDocument();
  });

  it("shows a single-chunk header without a count", () => {
    render(<AssistantMessageView message={msg("short thought")} sessionId="s" />);
    expect(screen.getByRole("button", { name: /Show thinking/i })).toBeInTheDocument();
  });

  it("renders numbered chunks when expanded", async () => {
    const user = userEvent.setup();
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" />);
    await user.click(screen.getByRole("button", { name: /Show thinking · 3/i }));
    expect(screen.getByText("Thinking 1")).toBeInTheDocument();
    expect(screen.getByText("Thinking 2")).toBeInTheDocument();
    expect(screen.getByText("Thinking 3")).toBeInTheDocument();
    // Chunks stay collapsed until individually clicked; header toggle closes all.
    await user.click(screen.getByRole("button", { name: /Hide thinking · 3/i }));
    expect(screen.queryByText("Thinking 1")).not.toBeInTheDocument();
  });

  it("auto-expands the newest chunk while live so streaming progress is visible", () => {
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" live />);
    expect(screen.getByText("Thinking 3")).toBeInTheDocument();
    // The newest chunk's label pulses while live.
    expect(screen.getByText("Thinking 3").className).toContain("animate-pulse");
  });

  it("renders no thinking UI for a message without reasoning", () => {
    render(<AssistantMessageView message={msg("")} sessionId="s" />);
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
  });
});
