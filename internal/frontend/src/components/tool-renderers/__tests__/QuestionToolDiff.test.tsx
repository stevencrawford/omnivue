import { fireEvent, render, screen } from "@testing-library/react";
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

const requestedSchemaInput = {
  message: "I recommend (A). Which do you want?",
  requestedSchema: {
    properties: {
      scope: {
        type: "string",
        title: "Context enrichment scope",
        oneOf: [
          { const: "carpool_only", title: "A) Carpool events only" },
          { const: "all_supplies", title: "B) All supply sources" },
        ],
        default: "carpool_only",
      },
      visitor_id_ok: {
        type: "boolean",
        title: "OK to leave x-visitor-id as default empty string?",
        default: true,
      },
    },
  },
};

describe("QuestionToolDiff requestedSchema", () => {
  it("renders raw message+requestedSchema input as tabs with options", () => {
    render(<QuestionToolDiff tool={questionTool(requestedSchemaInput)} variant="detail" />);
    expect(screen.getByText(/Which do you want\?/)).toBeDefined();
    expect(screen.getByText("A) Carpool events only")).toBeDefined();
    expect(screen.getByText("B) All supply sources")).toBeDefined();
    // Second tab holds the boolean question as Yes/No.
    fireEvent.click(screen.getByRole("button", { name: /OK to leave x-visitor-id/ }));
    expect(screen.getByText("Yes")).toBeDefined();
    expect(screen.getByText("No")).toBeDefined();
  });

  it("summary variant reports the question count", () => {
    const { container } = render(
      <QuestionToolDiff tool={questionTool(requestedSchemaInput)} variant="summary" />,
    );
    expect(container.textContent).toContain("2 questions");
  });

  it("highlights the option matching a JSON const answer in output", () => {
    const { container } = render(
      <QuestionToolDiff
        tool={questionTool(requestedSchemaInput, '{"scope":"carpool_only","visitor_id_ok":true}')}
        variant="detail"
      />,
    );
    // The carpool option row carries the chosen emerald highlight.
    expect(container.getElementsByClassName("border-emerald-500/40").length).toBeGreaterThan(0);
  });
});
