import type { ToolCall } from "../../hooks/useApi";
import { useSessionNav } from "../../hooks/useNav";

interface TaskInput {
  description?: string;
  subagent_type?: string;
}

export function TaskToolDiff({
  tool,
  onOpenModal,
}: {
  tool: ToolCall;
  onOpenModal?: (content: string, title?: string) => void;
}) {
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
    <div className="border border-violet-500/30 rounded-lg bg-violet-500/[0.03] overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-violet-500/20 bg-violet-500/[0.04] text-[11px] font-mono text-violet-400">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.5 1.5A1.5 1.5 0 0 1 8 0h0a1.5 1.5 0 0 1 1.5 1.5V3h1.75A2.75 2.75 0 0 1 14 5.75v4.5A2.75 2.75 0 0 1 11.25 13H4.75A2.75 2.75 0 0 1 2 10.25v-4.5A2.75 2.75 0 0 1 4.75 3h1.75V1.5ZM4.75 4.5c-.69 0-1.25.56-1.25 1.25v4.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25v-4.5c0-.69-.56-1.25-1.25-1.25H4.75ZM5 7.5a.5.5 0 1 0 0 1h.5a.5.5 0 0 0 0-1H5Zm5.5.5a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1-.5-.5Zm-4 2a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" />
        </svg>
        <span
          className={`font-medium text-violet-300 truncate ${tool.output && onOpenModal ? "cursor-pointer hover:text-violet-200" : ""}`}
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
        {agent && <span className="text-violet-400/70">{agent}</span>}
        {totalCount > 0 && (
          <span className="text-violet-400/70">
            {completedCount}/{totalCount} steps
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {childSessionId && (
            <button
              type="button"
              className="text-violet-400 hover:text-violet-300 cursor-pointer"
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
