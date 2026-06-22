import { Monitor, ArrowRight } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { useSessionNav } from "../../hooks/useNav";
import { CopyButton } from "../CopyButton";

interface TaskInput {
  description?: string;
  subagent_type?: string;
  agent_type?: string;
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
  const agent = input.subagent_type || input.agent_type || "";

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;

  return (
    <div className="border border-violet-500/30 rounded-lg bg-violet-500/[0.03] overflow-hidden mb-3 group">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-violet-500/20 bg-violet-500/[0.04] text-[11px] font-mono text-violet-400">
        <Monitor size={14} className="shrink-0" />
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
          {tool.output && <CopyButton text={tool.output} />}
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
    </div>
  );
}
