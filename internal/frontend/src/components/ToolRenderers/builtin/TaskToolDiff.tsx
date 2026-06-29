import { Monitor, ArrowRight } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { useSessionNav } from "../../../hooks/useNav";

interface TaskInput {
  description?: string;
  subagent_type?: string;
  agent_type?: string;
}

export function TaskToolDiff({
  tool,
  compact,
  onOpenModal,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
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
  const agent = input.subagent_type || input.agent_type || "";

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Monitor size={12} className="text-violet-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">task:</span>
        <span className="text-gh-text truncate min-w-0" title={description}>
          {description || "Sub-task"}
        </span>
        {agent && <span className="text-violet-400/70 shrink-0">{agent}</span>}
        {childSessionId && (
          <button
            type="button"
            className="text-violet-400 hover:text-violet-300 cursor-pointer text-[11px] shrink-0 ml-1"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId);
            }}
          >
            <ArrowRight size={11} className="inline" /> View
          </button>
        )}
        {tool.duration != null && tool.duration > 0 && (
          <span className="text-[10px] font-mono text-gh-text-secondary/40 shrink-0">
            {tool.duration < 1000 ? `${tool.duration}ms` : `${(tool.duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-violet-400">
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
      <div className="ml-auto flex items-center gap-1 shrink-0">
        {childSessionId && (
          <button
            type="button"
            className="text-violet-400 hover:text-violet-300 cursor-pointer text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId!);
            }}
          >
            <span className="inline-flex items-center gap-1">
              View session <ArrowRight size={11} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
