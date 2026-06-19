import { useState } from "react";
import { ChevronRight, CircleCheckBig, Check, Copy, ArrowRight, Circle } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { useSessionNav } from "../../hooks/useNav";
import { useCopy } from "../../hooks/useCopy";
import { BashToolDiff } from "./BashToolDiff";
import { EditToolDiff } from "./EditToolDiff";
import { ReadToolDiff } from "./ReadToolDiff";
import { GrepToolDiff } from "./GrepToolDiff";
import { GlobToolDiff } from "./GlobToolDiff";
import { TodoWriteToolDiff } from "./TodoWriteToolDiff";
import { TaskToolDiff } from "./TaskToolDiff";
import { QuestionToolDiff } from "./QuestionToolDiff";
import { ExitPlanModeToolDiff } from "./ExitPlanModeToolDiff";
import { DeleteToolDiff } from "./DeleteToolDiff";

const TOOL_CALL_VISIBLE_CAP = 5;

export function ToolCallList({
  toolCalls,
  agent,
  compact = false,
  onOpenModal,
}: {
  toolCalls: ToolCall[];
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped = toolCalls.length > TOOL_CALL_VISIBLE_CAP;
  const visible = capped && !showAll ? toolCalls.slice(0, TOOL_CALL_VISIBLE_CAP) : toolCalls;
  const hiddenCount = toolCalls.length - visible.length;

  if (compact) {
    return (
      <>
        {visible.map((tool) => (
          <ToolCallRow key={tool.id} tool={tool} agent={agent} compact onOpenModal={onOpenModal} />
        ))}
        {capped && (
          <button type="button" className="sess-tool-more" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "Show fewer"
              : `Show ${hiddenCount} more tool call${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <ToolCallRow key={tool.id} tool={tool} agent={agent} onOpenModal={onOpenModal} />
      ))}
    </div>
  );
}

function TaskCompleteBlock({ tool }: { tool: ToolCall }) {
  let taskSummary = "";
  const { copied, copy } = useCopy(2000);

  try {
    const parsed = JSON.parse(tool.input);
    taskSummary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  return (
    <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.03] relative group">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CircleCheckBig size={16} className="text-emerald-400 shrink-0" />
          <span className="font-semibold text-[11px] text-emerald-400">Task Complete</span>
        </div>
        {taskSummary && (
          <p className="mt-1 text-[11px] text-gh-text-secondary leading-relaxed">
            {taskSummary.split("\n")[0]}
          </p>
        )}
      </div>
      {tool.output && (
        <div className="border-t border-emerald-500/20">
          <div className="px-3 py-2">
            <pre className="text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap">
              {tool.output}
            </pre>
          </div>
        </div>
      )}
      {taskSummary && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copy(taskSummary);
          }}
          className="absolute top-2 right-2 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-all opacity-0 group-hover:opacity-100 border border-gh-border bg-surface-elevated"
          title="Copy summary"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}

function NonCompactCopyBtn({ tool }: { tool: ToolCall }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(tool.output || "");
      }}
      className="shrink-0 px-2 py-1.5 text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
      title="Copy"
    >
      <Copy size={12} />
    </button>
  );
}

export function ToolCallRow({
  tool,
  agent,
  compact = false,
  onOpenModal,
}: {
  tool: ToolCall;
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { navigateToSession } = useSessionNav();
  const completed = tool.status === "completed";
  const statusColor = completed ? "text-emerald-400" : "text-amber-400";
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool, agent);

  if (tool.name === "task_complete" && !compact) {
    return <TaskCompleteBlock tool={tool} />;
  }

  if (compact) {
    switch (kind) {
      case "bash":
        return <BashToolDiff tool={tool} />;
      case "edit":
      case "write":
        return <EditToolDiff tool={tool} />;
      case "read":
        return <ReadToolDiff tool={tool} />;
      case "grep":
        return <GrepToolDiff tool={tool} />;
      case "glob":
        return <GlobToolDiff tool={tool} />;
      case "delete":
        return <DeleteToolDiff tool={tool} />;
      case "todowrite":
        return <TodoWriteToolDiff tool={tool} />;
      case "task":
        return <TaskToolDiff tool={tool} onOpenModal={onOpenModal} />;
      case "question":
        return <QuestionToolDiff tool={tool} />;
      case "exit_plan_mode":
        return <ExitPlanModeToolDiff tool={tool} onOpenModal={onOpenModal} />;
      default:
        return <DefaultToolDiff tool={tool} />;
    }
  }

  let childSessionId: string | null = null;
  if (kind === "task" && tool.metadata) {
    try {
      const meta = JSON.parse(tool.metadata);
      childSessionId = meta.sessionId || null;
    } catch {
      /* ignore */
    }
  }

  const isTask = kind === "task";
  const rowClass =
    "flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors";

  const wrapperClass = isTask
    ? "border border-violet-500/30 rounded-lg overflow-hidden mb-3 bg-violet-500/[0.03]"
    : "border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center w-full">
        <button type="button" className={rowClass} onClick={() => setExpanded(!expanded)}>
          {!compact && (
            <ChevronRight size={12} className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
          )}
          <span className={`text-[11px] ${statusColor} font-bold shrink-0`}>
            {completed ? <Check size={11} className="text-emerald-400 shrink-0" /> : <Circle size={11} className="text-gh-text-secondary/40 shrink-0" />}
          </span>
          <span
            className={`font-mono text-[11px] truncate flex-1 min-w-0 ${isTask ? "text-violet-300" : "text-gh-text"}`}
          >
            {summary}
          </span>
          {!compact && tool.duration && tool.duration > 0 ? (
            <span className="text-[11px] text-gh-text-secondary shrink-0">
              {tool.duration < 1000
                ? `${tool.duration}ms`
                : `${(tool.duration / 1000).toFixed(1)}s`}
            </span>
          ) : null}
        </button>
        {!compact && <NonCompactCopyBtn tool={tool} />}
        {isTask && childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId);
            }}
          >
            <ArrowRight size={12} className="inline" /> View
          </button>
        )}
      </div>
      {expanded && (
        <div
          className={`border-t ${isTask ? "border-violet-500/20" : "border-gh-border"} px-3 py-2 space-y-2 bg-gh-bg-secondary/50`}
        >
          {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
          {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
        </div>
      )}
    </div>
  );
}

function DefaultToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool);

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight size={12} className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="font-medium text-gh-text truncate min-w-0">{summary}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
          {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
        </div>
      )}
    </div>
  );
}

function ToolDataBlock({ label, content }: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopy(2000);
  const isLong = content.length > 500;
  const displayContent = !expanded && isLong ? content.slice(0, 500) + "..." : content;

  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted =
        !expanded && isLong
          ? JSON.stringify(parsed, null, 2).slice(0, 500) + "..."
          : JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        {isLong && (
          <span className="text-[10px] text-gh-text-secondary/60">
            (
            {content.length > 1024
              ? `${(content.length / 1024).toFixed(1)}kb`
              : `${content.length}b`}
            )
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => copy(content)}
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}
