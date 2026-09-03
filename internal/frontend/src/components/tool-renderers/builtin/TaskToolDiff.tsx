import { Maximize2, Monitor } from "lucide-react";
import { useState } from "react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../ui/MarkdownContent";
import { Modal } from "../../ui/Modal";
import { ToolActionsBar } from "../ToolActionsBar";

interface TaskInput {
  description?: string;
  subagent_type?: string;
  agent_type?: string;
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
    // also handle <output>content</output> on same line
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
  const rawAgent = input.subagent_type || input.agent_type || "";
  const agent = displayAgent(rawAgent, description);
  const strippedOutput = stripTaskWrapper(tool.output || "");

  const completedCount = summary?.filter((s) => s.state?.status === "completed").length ?? 0;
  const totalCount = summary?.length ?? 0;
  const [localModalOpen, setLocalModalOpen] = useState(false);

  const handleViewOutput = () => {
    if (onOpenModal && strippedOutput) {
      onOpenModal(strippedOutput, description || "Sub-agent output");
    } else if (strippedOutput) {
      setLocalModalOpen(true);
    }
  };

  if (variant === "summary") {
    return (
      <>
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
          <Monitor size={12} className="text-violet-400 shrink-0" />
          <span className="text-ov-text-secondary/70 shrink-0">task:</span>
          {agent && <span className="text-violet-400/70 shrink-0">{agent}</span>}
          <span
            className={`text-ov-text truncate min-w-0 ${strippedOutput ? "cursor-pointer hover:underline hover:text-violet-400" : ""}`}
            title={description || "Sub-task"}
            onClick={(e) => {
              if (strippedOutput) {
                e.stopPropagation();
                handleViewOutput();
              }
            }}
          >
            {description || "Sub-task"}
          </span>
          {strippedOutput && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleViewOutput();
              }}
              className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded cursor-pointer transition-colors"
              title="View output"
            >
              <Maximize2 size={12} />
              View Output
            </button>
          )}
        </div>
        {strippedOutput && localModalOpen && (
          <Modal
            isOpen={true}
            onClose={() => setLocalModalOpen(false)}
            title={description || "Sub-agent output"}
            size="xl"
          >
            <MarkdownContent content={strippedOutput} className="markdown-body--wide" />
          </Modal>
        )}
      </>
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
        <ToolActionsBar
          tool={tool}
          onPin={onPin}
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          childSessionId={childSessionId}
          navigateToSession={navigateToSession}
          showPin
          showCopy={false}
          pinText={strippedOutput || description}
        />
      </div>
      {strippedOutput && (
        <div className="px-3 py-1.5 border-t border-violet-500/20 flex items-center justify-between gap-2">
          <span className="text-xs text-ov-text-secondary truncate flex-1 min-w-0">
            Output: {strippedOutput.split("\n")[0].slice(0, 100)}
            {strippedOutput.length > 100 ? "…" : ""}
            <span className="text-ov-text-secondary/60"> ({strippedOutput.length} chars)</span>
          </span>
          <button
            type="button"
            onClick={handleViewOutput}
            className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded cursor-pointer transition-colors"
            title="View output"
          >
            <Maximize2 size={12} />
            View Output
          </button>
        </div>
      )}
      {localModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setLocalModalOpen(false)}
          title={description || "Sub-agent output"}
          size="xl"
        >
          <MarkdownContent content={strippedOutput} className="markdown-body--wide" />
        </Modal>
      )}
    </div>
  );
}
