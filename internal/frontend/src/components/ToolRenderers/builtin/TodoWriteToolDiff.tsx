import { ListTodo, CircleCheckBig, CircleDot, Circle } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { CopyButton } from "../../CopyButton";
import { BookmarkButton } from "../BookmarkButton";

interface TodoItem {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface TodowriteInput {
  todos: TodoItem[];
}

export function TodoWriteToolDiff({ tool, compact, onCopy, onBookmark, isBookmarked }: ToolRendererProps) {
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

  const todoText = todos
    .map(
      (t) =>
        `[${t.status === "completed" ? "x" : t.status === "in_progress" ? "~" : " "}] ${t.content}${t.priority === "high" ? " (high)" : ""}`,
    )
    .join("\n");

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <ListTodo size={12} className="text-amber-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">todowrite:</span>
        <span className="text-gh-text truncate min-w-0">
          {completed}/{todos.length} done
        </span>
        {inProgress > 0 && (
          <span className="text-amber-400 shrink-0 ml-auto">{inProgress} in progress</span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3 group">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <ListTodo size={14} className="shrink-0" />
        <span className="font-medium text-gh-text">Todo</span>
        <span className="text-gh-text-secondary/70">
          {completed}/{todos.length} done
        </span>
        {inProgress > 0 && <span className="text-amber-400">{inProgress} in progress</span>}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />}
          {onCopy ? (
            <button
              type="button"
              onClick={() => onCopy(todoText)}
              title="Copy todos"
            >
              <CopyButton text={todoText} />
            </button>
          ) : (
            <CopyButton text={todoText} />
          )}
        </div>
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 shrink-0">
              {todo.status === "completed" ? (
                <CircleCheckBig size={14} className="text-emerald-400" />
              ) : todo.status === "in_progress" ? (
                <CircleDot size={14} className="text-amber-400" />
              ) : (
                <Circle size={14} className="text-gh-text-secondary/50" />
              )}
            </span>
            <span
              className={`text-[11px] leading-relaxed ${
                todo.status === "completed"
                  ? "text-gh-text-secondary/60 line-through"
                  : "text-gh-text"
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
    </div>
  );
}
