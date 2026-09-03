import { Maximize2, Monitor } from "lucide-react";
import type { ToolCall } from "../../../hooks/types";
import type { ToolRendererProps } from "../types";
import { ToolActionsBar } from "../ToolActionsBar";
import { useNavigation } from "../../../hooks/useNavigation";

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

function stripTaskWrapper(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === "<task_result>" ||
      trimmed === "</task_result>" ||
      trimmed === "</task>" ||
      trimmed === "<output>" ||
      trimmed === "</output>"
    )
      continue;
    if (trimmed.startsWith("<task ") && trimmed.endsWith(">")) continue;
    if (trimmed.startsWith("<output>") && trimmed.endsWith("</output>")) {
      const inner = trimmed.slice("<output>".length, -"</output>".length);
      if (inner) out.push(inner);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

function displayAgent(agent: string, description: string): string | null {
  if (!agent) return null;
  if (description && description.toLowerCase().startsWith(agent.toLowerCase())) return null;
  return agent;
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
  const rawAgent = taskInput.subagent_type || taskInput.agent_type || "";
  const agent = displayAgent(rawAgent, description);

  let summaryMeta: Array<{ tool: string; state: { status: string; title?: string } }> | null = null;
  try {
    const meta = JSON.parse(task.metadata || "{}");
    summaryMeta = meta.summary || null;
  } catch {
    /* ignore */
  }
  const completedCount = summaryMeta?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summaryMeta?.length ?? 0;

  const taskOutput = stripTaskWrapper((task.output || "").trim());
  const completeSummary = stripTaskWrapper((completeInput.summary || "").trim());
  const completeOutput = stripTaskWrapper(
    (complete?.output && complete.output !== "completed" ? complete.output.trim() : "").trim(),
  );

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
        <div className="px-3 py-1.5 border-t border-violet-500/20 flex items-center justify-between gap-2">
          <span className="text-xs text-ov-text-secondary truncate flex-1 min-w-0">
            Output: {combined.split("\n")[0].slice(0, 100)}
            {combined.length > 100 ? "…" : ""}
            <span className="text-ov-text-secondary/60"> ({combined.length} chars)</span>
          </span>
          {onOpenModal && (
            <button
              type="button"
              onClick={() => onOpenModal(combined, description || "Sub-agent output")}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded cursor-pointer transition-colors"
              title="View output"
            >
              <Maximize2 size={12} />
              View Output
            </button>
          )}
        </div>
      ) : null}
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
