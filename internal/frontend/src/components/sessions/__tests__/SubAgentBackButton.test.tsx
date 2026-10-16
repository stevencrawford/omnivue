import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubAgentBackButton } from "../SubAgentBackButton";

describe("SubAgentBackButton", () => {
  it("labels itself with the parent session and invokes onBack on click", () => {
    const onBack = vi.fn();
    render(<SubAgentBackButton parentLabel="Main plan" onBack={onBack} />);

    const button = screen.getByRole("button", { name: "Back to Main plan" });
    expect(button).toHaveAttribute("title", "Back to Main plan");

    fireEvent.click(button);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
