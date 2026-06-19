import type { ToolCall } from "../../hooks/useApi";
import { useCopy } from "../../hooks/useCopy";

interface TodoItem {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface TodowriteInput {
  todos: TodoItem[];
}

function CopyBtn({ text }: { text: string }) {
  const { copied, copy } = useCopy(1500);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(text);
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated shrink-0"
      title="Copy"
    >
      {copied ? (
        <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
        </svg>
      )}
    </button>
  );
}

export function TodoWriteToolDiff({ tool }: { tool: ToolCall }) {
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

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3 group">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25h-8.5ZM6.5 5.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
        <span className="font-medium text-gh-text">Todo</span>
        <span className="text-gh-text-secondary/70">
          {completed}/{todos.length} done
        </span>
        {inProgress > 0 && <span className="text-amber-400">{inProgress} in progress</span>}
        <div className="ml-auto">
          <CopyBtn text={todoText} />
        </div>
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 shrink-0">
              {todo.status === "completed" ? (
                <svg className="size-3.5 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.36 4.76-4.25 4.5a.75.75 0 0 1-1.08.02L3.97 8.6a.75.75 0 0 1 1.06-1.06l1.7 1.7 3.72-3.94a.75.75 0 1 1 1.1 1.04Z" />
                </svg>
              ) : todo.status === "in_progress" ? (
                <svg className="size-3.5 text-amber-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                  <circle cx="8" cy="8" r="3.25" fill="currentColor" />
                </svg>
              ) : (
                <svg
                  className="size-3.5 text-gh-text-secondary/50"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                </svg>
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
