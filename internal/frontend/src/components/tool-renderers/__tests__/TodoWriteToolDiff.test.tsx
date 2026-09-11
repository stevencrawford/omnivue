import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TodoWriteToolDiff } from "../builtin/TodoWriteToolDiff";
import type { ToolCall } from "../../../hooks/types";

function todoTool(
  todos: Array<{ id: string; content: string; status: string; priority: string }>,
): ToolCall {
  return {
    id: "todo-1",
    name: "todowrite",
    input: JSON.stringify({ todos }),
    output: "",
    status: "success",
  };
}

const sampleTodos = [
  { id: "1", content: "Write the failing test", status: "completed", priority: "high" },
  { id: "2", content: "Implement the fix", status: "in_progress", priority: "high" },
  { id: "3", content: "Run the full suite", status: "pending", priority: "medium" },
];

describe("TodoWriteToolDiff", () => {
  it("summary shows the done count and in-progress count", () => {
    const { container } = render(
      <TodoWriteToolDiff tool={todoTool(sampleTodos)} variant="summary" />,
    );
    expect(container.textContent).toContain("1/3 done");
    expect(container.textContent).toContain("1 in progress");
  });

  it("detail renders a titled card with every todo and 12px status icons", () => {
    const { container } = render(
      <TodoWriteToolDiff tool={todoTool(sampleTodos)} variant="detail" />,
    );
    expect(screen.getByText("Todos")).toBeDefined();
    expect(container.textContent).toContain("1/3 done");
    for (const todo of sampleTodos) {
      expect(screen.getByText(todo.content)).toBeDefined();
    }
    const icons = container.querySelectorAll("svg");
    // Header ListTodo + one status icon per todo + screenshot button
    // (screenshot renders whenever pinText exists, even without onPin).
    expect(icons).toHaveLength(sampleTodos.length + 2);
    for (const icon of icons) {
      expect(icon.getAttribute("width")).toBe("12");
      expect(icon.getAttribute("height")).toBe("12");
    }
    // No header copy button (copy lives in content on hover elsewhere).
    expect(container.querySelector('[title="Copy output"]')).toBeNull();
  });

  it("detail strikes through completed todos and badges pending high-priority ones", () => {
    const { container } = render(
      <TodoWriteToolDiff tool={todoTool(sampleTodos)} variant="detail" />,
    );
    expect(screen.getByText("Write the failing test").className).toContain("line-through");
    expect(container.textContent).toContain("high");
    // completed high-priority todo gets no badge: only one badge total
    expect(container.querySelectorAll("span.text-red-400")).toHaveLength(1);
  });

  it("renders nothing when there are no todos", () => {
    const { container } = render(<TodoWriteToolDiff tool={todoTool([])} variant="detail" />);
    expect(container.textContent).toBe("");
  });
});
