import { CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";

export function TaskCompleteToolDiff({ tool, compact }: ToolRendererProps) {
  let taskSummary = "";

  try {
    const parsed = JSON.parse(tool.input);
    taskSummary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleCheckBig size={12} className="text-emerald-400 shrink-0" />
        <span className="text-emerald-400 font-semibold shrink-0">Task Complete</span>
        {taskSummary && (
          <span className="text-gh-text-secondary truncate min-w-0">
            {taskSummary.split("\n")[0]}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
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
    </>
  );
}
