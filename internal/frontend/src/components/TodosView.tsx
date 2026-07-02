import { CircleCheckBig, CircleDot, Circle, Ban } from "lucide-react";
import type { Todo } from "../hooks/useApi";

interface TodosViewProps {
  todos: Todo[];
}

const STATUS_ORDER: Record<string, number> = {
  done: 0,
  in_progress: 1,
  blocked: 2,
  pending: 3,
};

function statusIcon(status: string) {
  switch (status) {
    case "done":
      return <CircleCheckBig size={14} className="text-emerald-400" />;
    case "in_progress":
      return <CircleDot size={14} className="text-amber-400" />;
    case "blocked":
      return <Ban size={14} className="text-red-400" />;
    default:
      return <Circle size={14} className="text-ov-text-secondary/50" />;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "done":
      return "Done";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    default:
      return "Pending";
  }
}

export function TodosView({ todos }: TodosViewProps) {
  if (!todos || todos.length === 0) {
    return (
      <div className="p-6 text-sm text-ov-text-secondary text-center">
        No todos for this session.
      </div>
    );
  }

  const sorted = [...todos].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
  );

  const completed = todos.filter((t) => t.status === "done").length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const dependencyMap = new Map<string, string[]>();
  for (const t of todos) {
    if (t.depends_on && t.depends_on.length > 0) {
      dependencyMap.set(t.id, t.depends_on);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Progress bar */}
        <div className="bg-ov-bg-hover rounded-lg border border-ov-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ov-text-secondary">Progress</span>
            <span className="text-xs text-ov-text-secondary tabular-nums">
              {completed}/{total} done ({pct}%)
            </span>
          </div>
          <div className="h-2 bg-ov-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Todo list */}
        <div className="space-y-0.5">
          {sorted.map((todo) => (
            <div
              key={todo.id}
              className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-ov-bg-hover transition-colors"
            >
              <span className="mt-0.5 shrink-0">{statusIcon(todo.status)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[11px] leading-relaxed ${
                      todo.status === "done"
                        ? "text-ov-text-secondary/60 line-through"
                        : "text-ov-text"
                    }`}
                  >
                    {todo.title}
                  </span>
                  <span
                    className={`text-[10px] font-medium px-1 rounded ${
                      todo.status === "done"
                        ? "text-emerald-400 bg-emerald-500/10"
                        : todo.status === "in_progress"
                          ? "text-amber-400 bg-amber-500/10"
                          : todo.status === "blocked"
                            ? "text-red-400 bg-red-500/10"
                            : "text-ov-text-secondary/50 bg-ov-bg/50"
                    }`}
                  >
                    {statusLabel(todo.status)}
                  </span>
                </div>
                {todo.description && (
                  <div className="text-[11px] text-ov-text-secondary/60 mt-0.5 line-clamp-2">
                    {todo.description}
                  </div>
                )}
                {dependencyMap.has(todo.id) && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] text-ov-text-secondary/40">depends on:</span>
                    {dependencyMap.get(todo.id)!.map((dep) => {
                      const depTodo = todos.find((t) => t.id === dep);
                      return (
                        <span
                          key={dep}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-ov-bg border border-ov-border text-ov-text-secondary/60"
                        >
                          {depTodo?.title || dep}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
