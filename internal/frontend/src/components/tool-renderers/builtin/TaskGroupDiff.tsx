import { Monitor } from "lucide-react";
import type { ToolCall } from "../../../hooks/types";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../ui/MarkdownContent";
import { ToolActionsBar } from "../ToolActionsBar";
import { useNavigation } from "../../../hooks/useNavigation";
import { SubAgentTranscriptToggle } from "./SubAgentTranscript";

interface TaskInput {
  description?: string;
  subagent_type?: string;
  agent_type?: string;
}

interface TaskCompleteInput {
  summary?: string;
  duration_ms?: number;
}

function parseTaskInput(input: string): TaskInput {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function parseCompleteInput(input: string): TaskCompleteInput {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

export interface TaskGroupDiffProps extends ToolRendererProps {
  task: ToolCall;
  complete?: ToolCall;
}

export function TaskGroupDiff({
  task,
  complete,
  variant,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession: navigateToSessionProp,
}: TaskGroupDiffProps) {
  const { navigateToSession: navigateHook } = useNavigation();
  const navigateToSession = navigateToSessionProp || navigateHook;
  const taskInput = parseTaskInput(task.input);
  const completeInput = complete ? parseCompleteInput(complete.input) : {};
  const description = taskInput.description || "";
  const agent = taskInput.subagent_type || taskInput.agent_type || "";

  let summaryMeta: Array<{ tool: string; state: { status: string; title?: string } }> | null = null;
  try {
    const meta = JSON.parse(task.metadata || "{}");
    summaryMeta = meta.summary || null;
  } catch {
    /* ignore */
  }
  const completedCount = summaryMeta?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summaryMeta?.length ?? 0;

  const taskOutput = (task.output || "").trim();
  const completeSummary = (completeInput.summary || "").trim();
  const completeOutput = (
    complete?.output && complete.output !== "completed" ? complete.output.trim() : ""
  ).trim();

  let combined = "";
  if (taskOutput) combined = taskOutput;
  const summaryToAdd = completeSummary || completeOutput;
  if (summaryToAdd) {
    if (combined) {
      if (!combined.includes(summaryToAdd) && !summaryToAdd.includes(combined.slice(-500))) {
        combined = combined + "\n\n---\n\n" + summaryToAdd;
      } else if (!combined.includes(summaryToAdd)) {
        combined = combined + "\n\n" + summaryToAdd;
      }
    } else {
      combined = summaryToAdd;
    }
  }

  const durationMs = complete
    ? (complete.duration ?? completeInput.duration_ms) || 0
    : task.duration || 0;
  const displayDuration = durationMs;

  if (variant === "summary") {
    const preview = (combined.split("\n")[0] || description || "Sub-task").slice(0, 80);
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Monitor size={12} className="text-violet-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">task:</span>
        {agent && <span className="text-violet-400/70 shrink-0">{agent}</span>}
        <span
          className="text-ov-text truncate min-w-0"
          title={description || preview}
          onClick={(e) => {
            if (combined && onOpenModal) {
              e.stopPropagation();
              onOpenModal(combined, description);
            }
          }}
        >
          {description || preview}
        </span>
        {displayDuration > 0 && (
          <span className="text-[11px] text-ov-text-secondary/40 shrink-0">
            {(displayDuration / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="px-0">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-violet-400">
        {agent && <span className="text-violet-400/70">{agent}</span>}
        <span className="font-medium text-violet-300 truncate flex-1">
          {description || "Sub-task"}
        </span>
        {totalCount > 0 && (
          <span className="text-violet-400/70">
            {completedCount}/{totalCount} steps
          </span>
        )}
        {displayDuration > 0 && (
          <span className="text-violet-400/50 shrink-0">
            {(displayDuration / 1000).toFixed(1)}s
          </span>
        )}
        <ToolActionsBar
          tool={complete || task}
          onPin={onPin}
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          childSessionId={childSessionId}
          navigateToSession={navigateToSession}
          showPin
          pinText={combined || description}
        />
      </div>
      {combined ? (
        <div className="px-3 py-2 border-t border-violet-500/20">
          <MarkdownContent content={combined} className="markdown-body--wide" />
        </div>
      ) : null}
      {childSessionId && <SubAgentTranscriptToggle sessionId={childSessionId} />}
    </div>
  );
}

// Wrapper compatible with ToolRendererProps for registry-less use via ToolCallList coalescing
export function TaskGroupRenderer(
  props: ToolRendererProps & { task?: ToolCall; complete?: ToolCall },
) {
  const t = (props as TaskGroupDiffProps).task || props.tool;
  const c = (props as TaskGroupDiffProps).complete;
  return <TaskGroupDiff {...props} task={t} complete={c} tool={c || t} />;
}
