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

const chunkA = "aaa " + "x".repeat(300);
const chunkB = "bbb " + "y".repeat(300);
const chunkC = "ccc " + "z".repeat(300);
const multiChunkReasoning = [chunkA, chunkB, chunkC].join("\n\n");

describe("AssistantMessageView ThinkingBlock", () => {
  it("shows a 'thought <time>' header and collapses by default with no chunks visible", () => {
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" />);
    expect(screen.getByRole("button", { name: /^Thought / })).toBeInTheDocument();
    expect(screen.queryByText(/aaa x/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("thinking in progress")).not.toBeInTheDocument();
  });

  it("renders every chunk when expanded", async () => {
    const user = userEvent.setup();
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" />);
    await user.click(screen.getByRole("button", { name: /^Thought / }));
    expect(screen.getByText(/aaa x/)).toBeInTheDocument();
    expect(screen.getByText(/bbb y/)).toBeInTheDocument();
    expect(screen.getByText(/ccc z/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Thought / }));
    expect(screen.queryByText(/aaa x/)).not.toBeInTheDocument();
  });

  it("while live, shows a 'thinking' header with spinner and hangs the newest chunk beneath the folded parent", () => {
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" live />);
    expect(screen.getByRole("button", { name: /^Thinking$/ })).toBeInTheDocument();
    expect(screen.getByLabelText("thinking in progress")).toBeInTheDocument();
    expect(screen.queryByText(/aaa x/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bbb y/)).not.toBeInTheDocument();
    expect(screen.getByText(/ccc z/)).toBeInTheDocument();
  });

  it("while live and expanded, shows all chunks with no duplicated child", async () => {
    const user = userEvent.setup();
    render(<AssistantMessageView message={msg(multiChunkReasoning)} sessionId="s" live />);
    await user.click(screen.getByRole("button", { name: /^Thinking$/ }));
    expect(screen.getAllByText(/aaa x/)).toHaveLength(1);
    expect(screen.getAllByText(/ccc z/)).toHaveLength(1);
    expect(screen.getByLabelText("thinking in progress")).toBeInTheDocument();
  });

  it("hangs a single live chunk beneath the parent while it is the only chunk", () => {
    render(<AssistantMessageView message={msg(chunkC)} sessionId="s" live />);
    expect(screen.getByRole("button", { name: /^Thinking$/ })).toBeInTheDocument();
    expect(screen.getByText(/ccc z/)).toBeInTheDocument();
    expect(screen.getByLabelText("thinking in progress")).toBeInTheDocument();
  });

  it("renders no thinking UI for a message without reasoning", () => {
    render(<AssistantMessageView message={msg("")} sessionId="s" />);
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Thought /)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("thinking in progress")).not.toBeInTheDocument();
  });
});
