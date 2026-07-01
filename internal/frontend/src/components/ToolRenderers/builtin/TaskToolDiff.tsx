import { Monitor } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { ToolActionsBar } from "../ToolActionsBar";

interface TaskInput {
  description?: string;
  subagent_type?: string;
  agent_type?: string;
}

export function TaskToolDiff({
  tool,
  variant,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
}: ToolRendererProps) {
  let input: TaskInput = {};
  let summary: Array<{ tool: string; state: { status: string; title?: string } }> | null = null;
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    summary = meta.summary || null;
  } catch {
    /* ignore */
  }

  const description = input.description || "";
  const agent = input.subagent_type || input.agent_type || "";

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Monitor size={12} className="text-violet-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">task:</span>
        {agent && <span className="text-violet-400/70 shrink-0">{agent}</span>}
        <span
          className={`text-ov-text truncate min-w-0 ${tool.output && onOpenModal ? "cursor-pointer hover:underline hover:text-violet-400" : ""}`}
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
      </div>
    );
  }

  return (
    <div className="px-0">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-violet-400">
        {agent && <span className="text-violet-400/70">{agent}</span>}
        <span className="font-medium text-violet-300 truncate flex-1">{description || "Sub-task"}</span>
        {totalCount > 0 && (
          <span className="text-violet-400/70">
            {completedCount}/{totalCount} steps
          </span>
        )}
        <ToolActionsBar
          tool={tool}
          onPin={onPin}
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          childSessionId={childSessionId}
          navigateToSession={navigateToSession}
          showPin
        />
      </div>
      {tool.output && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-ov-text-secondary whitespace-pre-wrap break-all border-t border-violet-500/20">
          {tool.output}
        </pre>
      )}
    </div>
  );
}
