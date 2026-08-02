import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreateTagModal } from "../CreateTagModal";

describe("CreateTagModal", () => {
  const noop = () => {};

  it("starts with an empty name by default", () => {
    render(<CreateTagModal isOpen onClose={noop} onCreate={noop} />);
    const input = screen.getByPlaceholderText("Tag name") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("pre-fills the name from initialName", () => {
    render(<CreateTagModal isOpen onClose={noop} onCreate={noop} initialName="feature" />);
    const input = screen.getByPlaceholderText("Tag name") as HTMLInputElement;
    expect(input.value).toBe("feature");
  });
});
