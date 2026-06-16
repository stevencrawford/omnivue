import type { ToolCall } from "../../hooks/useApi";
import { useSessionNav } from "../../hooks/useNav";

interface TaskInput {
  description?: string;
  subagent_type?: string;
}

export function TaskToolDiff({ tool, onOpenModal }: { tool: ToolCall; onOpenModal?: (content: string, title?: string) => void }) {
  let input: TaskInput = {};
  let childSessionId: string | null = null;
  let summary: Array<{ tool: string; state: { status: string; title?: string } }> | null = null;
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    childSessionId = meta.sessionId || null;
    summary = meta.summary || null;
  } catch {
    /* ignore */
  }

  const { navigateToSession } = useSessionNav();
  const description = input.description || "";
  const agent = input.subagent_type || "";

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 2.75A1.75 1.75 0 0 1 3.25 1h9.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 12.75 15h-9.5A1.75 1.75 0 0 1 1.5 13.25V2.75Z" />
        </svg>
        <span
          className={`font-medium text-gh-text truncate ${tool.output && onOpenModal ? "cursor-pointer hover:text-accent" : ""}`}
          title={description || "Sub-task"}
          onClick={(e) => {
            if (tool.output && onOpenModal) {
              e.stopPropagation();
              onOpenModal(tool.output, description);
            }
          }}
        >
          {description || "Sub-task"}
        </span>
        {agent && <span className="text-gh-text-secondary/70">{agent}</span>}
        {totalCount > 0 && (
          <span className="text-gh-text-secondary/70">
            {completedCount}/{totalCount} steps
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {childSessionId && (
            <button
              type="button"
              className="text-accent hover:text-accent-secondary cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                navigateToSession(childSessionId!);
              }}
            >
              View session →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
