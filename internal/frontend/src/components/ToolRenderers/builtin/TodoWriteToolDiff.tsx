import { ListTodo, CircleCheckBig, CircleDot, Circle } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface TodoItem {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface TodowriteInput {
  todos: TodoItem[];
}

export function TodoWriteToolDiff({
  tool,
  compact,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let todos: TodoItem[] = [];
  try {
    const parsed: TodowriteInput = JSON.parse(tool.input);
    todos = parsed.todos || [];
  } catch {
    /* ignore */
  }

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <ListTodo size={12} className="text-amber-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">todowrite:</span>
        <span className="text-ov-text truncate min-w-0">
          {completed}/{todos.length} done
        </span>
        {inProgress > 0 && (
          <span className="text-amber-400 shrink-0 ml-auto">{inProgress} in progress</span>
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-0.5">
      {todos.map((todo) => (
        <div key={todo.id} className="flex items-start gap-2 py-0.5">
          <span className="mt-0.5 shrink-0">
            {todo.status === "completed" ? (
              <CircleCheckBig size={14} className="text-emerald-400" />
            ) : todo.status === "in_progress" ? (
              <CircleDot size={14} className="text-amber-400" />
            ) : (
              <Circle size={14} className="text-ov-text-secondary/50" />
            )}
          </span>
          <span
            className={`text-[11px] leading-relaxed ${
              todo.status === "completed"
                ? "text-ov-text-secondary/60 line-through"
                : "text-ov-text"
            }`}
          >
            {todo.content}
          </span>
          {todo.priority === "high" && todo.status !== "completed" && (
            <span className="shrink-0 text-[10px] font-medium text-red-400 bg-red-500/10 px-1 rounded">
              high
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
