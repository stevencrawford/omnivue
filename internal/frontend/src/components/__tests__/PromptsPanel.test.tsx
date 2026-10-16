import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptsPanel } from "../PromptsPanel";
import type { Prompt } from "../../hooks/types";
import { createPrompt, fetchPrompts, updatePrompt } from "../../hooks/apiClient";

vi.mock("../../hooks/apiClient", () => ({
  fetchPrompts: vi.fn(),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  reorderPrompts: vi.fn(),
}));

const openPrompt: Prompt = {
  id: "pr_1",
  promptText: "Summarize the diff",
  status: "open",
  pinned: false,
  position: 0,
  createdAt: Date.now(),
};

const donePrompt: Prompt = {
  id: "pr_2",
  promptText: "Old prompt",
  status: "done",
  pinned: false,
  position: 1,
  createdAt: Date.now(),
};

describe("PromptsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPrompts).mockResolvedValue([]);
    vi.mocked(createPrompt).mockResolvedValue(openPrompt);
    vi.mocked(updatePrompt).mockResolvedValue(undefined);
  });

  it("lists open prompts and collapses done ones behind a toggle", async () => {
    vi.mocked(fetchPrompts).mockResolvedValue([openPrompt, donePrompt]);
    render(<PromptsPanel />);

    expect(await screen.findByText("Summarize the diff")).toBeDefined();
    expect(screen.getByText("Done (1)")).toBeDefined();
    expect(screen.queryByText("Old prompt")).toBeNull();
  });

  it("creates a prompt from the composer", async () => {
    const user = userEvent.setup();
    render(<PromptsPanel />);

    const box = await screen.findByPlaceholderText("Type a prompt to save...");
    await user.type(box, "New idea");
    await user.click(screen.getByTitle("Add prompt"));

    await waitFor(() => expect(createPrompt).toHaveBeenCalledWith({ promptText: "New idea" }));
    expect(await screen.findByText("Summarize the diff")).toBeDefined();
  });

  it("checks a prompt off as done", async () => {
    vi.mocked(fetchPrompts).mockResolvedValue([openPrompt]);
    const user = userEvent.setup();
    render(<PromptsPanel />);

    await screen.findByText("Summarize the diff");
    await user.click(screen.getByTitle("Mark as done"));

    await waitFor(() => expect(updatePrompt).toHaveBeenCalledWith("pr_1", { status: "done" }));
    expect(await screen.findByText("Done (1)")).toBeDefined();
  });
});
