import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuestionToolDiff } from "../builtin/QuestionToolDiff";
import type { ToolCall } from "../../../hooks/types";

function questionTool(input: Record<string, unknown>, output = ""): ToolCall {
  return {
    id: "q-1",
    name: "question",
    input: JSON.stringify(input),
    output,
    status: "success",
  };
}

const singleQuestion = {
  questions: [
    {
      question: "Which threshold should I use?",
      header: "Choose threshold",
      options: [{ label: "3.0x" }, { label: "5.0x" }],
    },
  ],
};

describe("QuestionToolDiff copy placement", () => {
  it("detail header has no copy button", () => {
    const { container } = render(
      <QuestionToolDiff tool={questionTool(singleQuestion, "3.0x")} variant="detail" />,
    );
    // The header copy (ModeAwareCopyButton) titles itself "Copy output".
    expect(container.querySelector('[title="Copy output"]')).toBeNull();
  });

  it("detail question content exposes hover copy", () => {
    const { container } = render(
      <QuestionToolDiff tool={questionTool(singleQuestion, "3.0x")} variant="detail" />,
    );
    // MarkdownContent renders a hover-reveal copy button titled "Copy".
    const copyButtons = container.querySelectorAll('[title="Copy"]');
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("fallback detail has no header copy but exposes hover copy for the text", () => {
    const { container } = render(
      <QuestionToolDiff
        tool={{
          id: "q-2",
          name: "question",
          input: '{"question":"Proceed with the refactor?"}',
          output: "",
          status: "success",
        }}
        variant="detail"
      />,
    );
    expect(container.querySelector('[title="Copy output"]')).toBeNull();
    expect(container.querySelectorAll('[title="Copy"]')).toHaveLength(1);
  });
});
