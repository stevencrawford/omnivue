import type { ToolCall } from "../../hooks/useApi";
import { useSessionNav } from "../../hooks/useNav";
import { useCopy } from "../../hooks/useCopy";

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

  function CopyBtn({ text }: { text: string }) {
    const { copied, copy } = useCopy(1500);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          copy(text);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity size-6 flex items-center justify-center rounded text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/10 cursor-pointer shrink-0"
        title="Copy"
      >
        {copied ? (
          <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
        ) : (
          <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <div className="border border-violet-500/30 rounded-lg bg-violet-500/[0.03] overflow-hidden mb-3 group">
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
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {tool.output && <CopyBtn text={tool.output} />}
          {childSessionId && (
            <button
              type="button"
              className="text-violet-400 hover:text-violet-300 cursor-pointer text-[11px]"
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
